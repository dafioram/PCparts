import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../app/js/model.js';

function withMachine(state, input) {
  const { state: s1, result } = M.addMachine(state, input);
  return { state: s1, id: result.id };
}
function withBox(state, input) {
  const { state: s1, result } = M.addBox(state, input);
  return { state: s1, id: result.id };
}
function withPart(state, input, location) {
  const { state: s1, result } = M.addPart(state, input, location);
  return { state: s1, id: result.id };
}

describe('machines', () => {
  test('addMachine creates a build with defaults', () => {
    const s0 = M.createInitialState();
    const { state, id } = withMachine(s0, { type: 'desktop', nickname: 'Jellyfin Server' });
    const m = M.getMachine(state, id);
    assert.equal(m.nickname, 'Jellyfin Server');
    assert.equal(m.status, 'active');
    assert.deepEqual(m.slots, []);
    assert.deepEqual(m.notNeeded, []);
    assert.equal(m.retired, null);
  });

  test('addMachine rejects unknown type', () => {
    assert.throws(() => M.addMachine(M.createInitialState(), { type: 'toaster' }));
  });

  test('updateMachine patches allowed fields only', () => {
    const s0 = M.createInitialState();
    const { state, id } = withMachine(s0, { type: 'desktop' });
    const { state: s2 } = M.updateMachine(state, id, { nickname: 'New name', purpose: 'testing' });
    const m = M.getMachine(s2, id);
    assert.equal(m.nickname, 'New name');
    assert.equal(m.purpose, 'testing');
  });

  test('deleteMachine deletes an empty build', () => {
    const s0 = M.createInitialState();
    const { state, id } = withMachine(s0, { type: 'desktop' });
    const { state: s2 } = M.deleteMachine(state, id);
    assert.equal(M.getMachine(s2, id), null);
  });

  test('deleteMachine refuses a build that still has parts', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop' });
    s0 = build.state;
    const part = withPart(s0, { category: 'psu', label: 'EVGA 600W' }, { kind: 'machine', id: build.id });
    assert.throws(() => M.deleteMachine(part.state, build.id));
  });

  test('deleteMachine deletes a device regardless of contents', () => {
    const s0 = M.createInitialState();
    const { state, id } = withMachine(s0, { type: 'laptop', nickname: 'Old Dell' });
    const { state: s2 } = M.deleteMachine(state, id);
    assert.equal(M.getMachine(s2, id), null);
  });
});

describe('boxes', () => {
  test('Unused box exists by default and cannot be renamed or deleted', () => {
    const s0 = M.createInitialState();
    const box = M.getBox(s0, M.UNUSED_BOX_ID);
    assert.equal(box.name, 'Unused');
    assert.equal(box.isDefault, true);
    assert.throws(() => M.updateBox(s0, M.UNUSED_BOX_ID, { name: 'Nope' }));
    assert.throws(() => M.deleteBox(s0, M.UNUSED_BOX_ID));
  });

  test('addBox enforces unique names (case-insensitive)', () => {
    const s0 = M.createInitialState();
    const { state } = M.addBox(s0, { name: 'Box 768' });
    assert.throws(() => M.addBox(state, { name: 'box 768' }));
  });

  test('deleteBox moves its parts to Unused', () => {
    let s0 = M.createInitialState();
    const box = withBox(s0, { name: 'Box 768' });
    const part = withPart(box.state, { category: 'ram', label: '8GB DDR4' }, { kind: 'box', id: box.id });
    const { state: s2, result } = M.deleteBox(part.state, box.id);
    assert.equal(result.movedCount, 1);
    const p = M.getPart(s2, part.id);
    assert.equal(p.location.kind, 'box');
    assert.equal(p.location.id, M.UNUSED_BOX_ID);
    assert.equal(M.getBox(s2, box.id), null);
  });
});

describe('parts: add/edit/delete', () => {
  test('addPart defaults quantity to 1 and lands in Unused when no location given', () => {
    const s0 = M.createInitialState();
    const { state, id } = withPart(s0, { category: 'ram', label: '16GB DDR4' });
    const p = M.getPart(state, id);
    assert.equal(p.quantity, 1);
    assert.equal(p.location.kind, 'box');
    assert.equal(p.location.id, M.UNUSED_BOX_ID);
    assert.equal(p.history.length, 1);
    assert.equal(p.history[0].action, 'created');
  });

  test('addPart requires a label', () => {
    assert.throws(() => M.addPart(M.createInitialState(), { category: 'ram', label: '' }));
  });

  test('updatePart edits fields and bumps updatedAt', () => {
    const s0 = M.createInitialState();
    const { state, id } = withPart(s0, { category: 'gpu', label: 'GTX 1050' });
    const before = M.getPart(state, id).updatedAt;
    const { state: s2 } = M.updatePart(state, id, { label: 'GTX 1050 Ti', notes: 'has a bent fan' });
    const p = M.getPart(s2, id);
    assert.equal(p.label, 'GTX 1050 Ti');
    assert.equal(p.notes, 'has a bent fan');
    assert.ok(p.updatedAt >= before);
  });

  test('deletePart removes the record entirely', () => {
    const s0 = M.createInitialState();
    const { state, id } = withPart(s0, { category: 'other', label: 'Spare screws' });
    const { state: s2 } = M.deletePart(state, id);
    assert.equal(M.getPart(s2, id), null);
  });
});

describe('derived part status', () => {
  test('unused, in-use, removed', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop' });
    s0 = build.state;
    const unused = withPart(s0, { category: 'ram', label: '8GB DDR4' });
    s0 = unused.state;
    const inUse = withPart(s0, { category: 'psu', label: '600W' }, { kind: 'machine', id: build.id });
    s0 = inUse.state;
    const { state: s2 } = M.retirePart(s0, unused.id, { reason: 'sold', date: '2026-01-01' });

    assert.equal(M.derivePartStatus(M.getPart(s2, inUse.id)), 'in-use');
    assert.equal(M.derivePartStatus(M.getPart(s2, unused.id)), 'removed');

    const another = withPart(s2, { category: 'case', label: 'NZXT H510' });
    assert.equal(M.derivePartStatus(M.getPart(another.state, another.id)), 'unused');
  });
});

describe('missing-part warnings', () => {
  test('an empty desktop warns on all required categories', () => {
    const s0 = M.createInitialState();
    const { state, id } = withMachine(s0, { type: 'desktop' });
    const m = M.getMachine(state, id);
    const warnings = M.deriveWarnings(m, M.partsInMachine(state, id));
    assert.deepEqual(warnings.sort(), [...M.REQUIRED_CATEGORIES].sort());
  });

  test('warnings clear as required parts are added', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop' });
    s0 = build.state;
    for (const category of M.REQUIRED_CATEGORIES) {
      const details = category === 'storage' ? { kind: 'NVMe' } : {};
      const added = withPart(s0, { category, label: category.toUpperCase(), details }, { kind: 'machine', id: build.id });
      s0 = added.state;
    }
    const m = M.getMachine(s0, build.id);
    const warnings = M.deriveWarnings(m, M.partsInMachine(s0, build.id));
    assert.deepEqual(warnings, []);
  });

  test('notNeeded clears a warning without a part', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'server' });
    s0 = build.state;
    const { state: s2 } = M.updateMachine(s0, build.id, { notNeeded: ['gpu'] });
    const m = M.getMachine(s2, build.id);
    const warnings = M.deriveWarnings(m, M.partsInMachine(s2, build.id));
    assert.ok(!warnings.includes('gpu'));
    assert.ok(warnings.includes('cpu'));
  });

  test('devices never warn', () => {
    const s0 = M.createInitialState();
    const { state, id } = withMachine(s0, { type: 'laptop' });
    const m = M.getMachine(state, id);
    assert.deepEqual(M.deriveWarnings(m, []), []);
  });
});

describe('display names', () => {
  test('nickname is the title, model name the subtitle', () => {
    const s0 = M.createInitialState();
    const { state, id } = withMachine(s0, { type: 'desktop', nickname: 'Jellyfin Server', modelName: 'Optiplex 7040' });
    const m = M.getMachine(state, id);
    const { title, subtitle } = M.displayName(m, state.parts);
    assert.equal(title, 'Jellyfin Server');
    assert.equal(subtitle, 'Optiplex 7040');
  });

  test('falls back to generated summary when nothing is named', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop' });
    s0 = build.state;
    const cpu = withPart(s0, { category: 'cpu', label: 'i5-6500' }, { kind: 'machine', id: build.id });
    s0 = cpu.state;
    const ram = withPart(s0, { category: 'ram', label: '8GB DDR4', details: { capacity: '8GB' } }, { kind: 'machine', id: build.id });
    s0 = ram.state;
    const gpu = withPart(s0, { category: 'gpu', label: 'GTX 1050' }, { kind: 'machine', id: build.id });
    s0 = gpu.state;

    const m = M.getMachine(s0, build.id);
    const { title } = M.displayName(m, s0.parts);
    assert.equal(title, 'i5-6500 · 8GB · GTX 1050');
  });

  test('empty build summary', () => {
    const s0 = M.createInitialState();
    const { state, id } = withMachine(s0, { type: 'server' });
    const m = M.getMachine(state, id);
    const { title } = M.displayName(m, state.parts);
    assert.equal(title, 'Empty server');
  });
});

describe('capacity totals', () => {
  test('sums parseable sizes and counts unreadable ones', () => {
    const parts = [
      { label: '8GB DDR4', quantity: 1, details: {} },
      { label: '8GB DDR4', quantity: 1, details: {} },
      { label: 'some ram stick', quantity: 1, details: {} },
    ];
    const cap = M.capacityTotal(parts);
    assert.equal(cap.totalGb, 16);
    assert.equal(cap.unknownCount, 1);
    assert.equal(cap.text, '16GB (+1 unknown)');
  });

  test('parses TB and MB, and quantity multiplies', () => {
    assert.equal(M.parseSizeToGb('1TB'), 1000);
    assert.equal(M.parseSizeToGb('1TB', M.MEMORY_BASE), 1024);
    assert.equal(M.parseSizeToGb('512MB', M.MEMORY_BASE), 0.5);
    const cap = M.capacityTotal([{ label: '', details: { capacity: '2TB' }, quantity: 2 }]);
    assert.equal(cap.totalGb, 4000);
    assert.equal(cap.text, '4TB');
  });

  test('drive totals use decimal units, so mixed GB and TB read naturally', () => {
    const total = (...labels) => M.capacityTotal(labels.map((label) => ({ label, quantity: 1, details: {} }))).text;
    assert.equal(total('1TB', '500GB'), '1.5TB');
    assert.equal(total('500GB', '500GB'), '1TB');
    assert.equal(total('500GB', '2TB'), '2.5TB'); // the SPEC §3.5 example
  });

  test('memory totals use binary units', () => {
    const sticks = [{ label: '512MB DDR', quantity: 2, details: {} }];
    assert.equal(M.capacityTotal(sticks, { base: M.MEMORY_BASE }).text, '1GB');
  });

  test('nothing readable gives an empty total', () => {
    const cap = M.capacityTotal([{ label: 'mystery stick', quantity: 1, details: {} }]);
    assert.equal(cap.text, '');
    assert.equal(cap.unknownCount, 1);
  });
});

describe('slots: auto-assign and definition', () => {
  function buildWithSlots(slotSpecs) {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop' });
    s0 = build.state;
    for (const [type, count] of slotSpecs) {
      const r = M.setSlotCount(s0, build.id, type, count);
      s0 = r.state;
    }
    return { state: s0, buildId: build.id };
  }

  test('installing RAM auto-assigns to the first empty DIMM slot in order', () => {
    let { state, buildId } = buildWithSlots([['dimm', 2]]);
    const p1 = withPart(state, { category: 'ram', label: '8GB DDR4' });
    state = p1.state;
    const move1 = M.movePart(state, p1.id, { kind: 'machine', id: buildId });
    state = move1.state;
    const machine = M.getMachine(state, buildId);
    assert.equal(move1.result.slotLabel, 'DIMM 1');
    assert.equal(machine.slots.length, 2);

    const p2 = withPart(state, { category: 'ram', label: '8GB DDR4' });
    state = p2.state;
    const move2 = M.movePart(state, p2.id, { kind: 'machine', id: buildId });
    assert.equal(move2.result.slotLabel, 'DIMM 2');
  });

  test('an undefined slot type is created silently and removed when emptied', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop' });
    s0 = build.state;
    const part = withPart(s0, { category: 'gpu', label: 'GTX 1050' });
    s0 = part.state;
    const move = M.movePart(s0, part.id, { kind: 'machine', id: build.id });
    s0 = move.state;
    assert.equal(move.result.overflow, false);
    let machine = M.getMachine(s0, build.id);
    assert.equal(machine.slots.length, 1);
    assert.equal(machine.slots[0].origin, 'auto');
    assert.equal(M.isSlotTypeDefined(machine, 'pcie-x16'), false);

    // Move it back out: the auto slot should disappear.
    const back = M.movePart(s0, part.id, { kind: 'box', id: M.UNUSED_BOX_ID });
    machine = M.getMachine(back.state, build.id);
    assert.equal(machine.slots.length, 0);
  });

  test('a defined slot type overflows with a new user slot and a message, and stays after emptied', () => {
    let { state, buildId } = buildWithSlots([['dimm', 1]]);
    const p1 = withPart(state, { category: 'ram', label: '8GB DDR4' });
    state = p1.state;
    let r = M.movePart(state, p1.id, { kind: 'machine', id: buildId });
    state = r.state;

    const p2 = withPart(state, { category: 'ram', label: '8GB DDR4' });
    state = p2.state;
    r = M.movePart(state, p2.id, { kind: 'machine', id: buildId });
    state = r.state;
    assert.equal(r.result.overflow, true);
    assert.match(r.result.overflowMessage, /All 1 DIMM slots were full/);

    let machine = M.getMachine(state, buildId);
    assert.equal(machine.slots.length, 2);
    assert.equal(machine.slots[1].origin, 'user');

    // Remove p2: since dimm is a defined type, the now-empty slot stays.
    const back = M.movePart(state, p2.id, { kind: 'box', id: M.UNUSED_BOX_ID });
    machine = M.getMachine(back.state, buildId);
    assert.equal(machine.slots.length, 2);
  });

  test('quantity > 1 is split into single units on install', () => {
    let { state, buildId } = buildWithSlots([['dimm', 4]]);
    const part = withPart(state, { category: 'ram', label: '8GB DDR4', quantity: 2 });
    state = part.state;
    const r = M.movePart(state, part.id, { kind: 'machine', id: buildId });
    state = r.state;
    assert.equal(r.result.split, true);
    assert.equal(r.result.count, 2);
    const machine = M.getMachine(state, buildId);
    const installedParts = M.partsInMachine(state, buildId);
    assert.equal(installedParts.length, 2);
    assert.ok(installedParts.every((p) => p.quantity === 1));
    const usedSlotIds = new Set(installedParts.map((p) => p.location.slotId));
    assert.equal(usedSlotIds.size, 2);
  });

  test('expansion cards prefer pcie-x1 before pcie-x16', () => {
    let { state, buildId } = buildWithSlots([['pcie-x1', 1], ['pcie-x16', 1]]);
    const part = withPart(state, { category: 'expansion', label: 'Wi-Fi card' });
    state = part.state;
    const r = M.movePart(state, part.id, { kind: 'machine', id: buildId });
    assert.equal(r.result.slotLabel, 'PCIe x1 1');
  });

  test('GPUs only use pcie-x16', () => {
    let { state, buildId } = buildWithSlots([['pcie-x1', 1]]);
    const part = withPart(state, { category: 'gpu', label: 'RTX 3060' });
    state = part.state;
    const r = M.movePart(state, part.id, { kind: 'machine', id: buildId });
    assert.equal(r.result.slotLabel, 'PCIe x16 1');
  });

  test('storage with unknown kind requires an explicit slot type', () => {
    const s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop' });
    const part = withPart(build.state, { category: 'storage', label: '1TB drive' });
    assert.throws(() => M.movePart(part.state, part.id, { kind: 'machine', id: build.id }));
  });

  test('setSlotCount never removes an occupied slot', () => {
    let { state, buildId } = buildWithSlots([['dimm', 2]]);
    const p1 = withPart(state, { category: 'ram', label: '8GB DDR4' });
    state = p1.state;
    const r = M.movePart(state, p1.id, { kind: 'machine', id: buildId });
    state = r.state;
    const shrink = M.setSlotCount(state, buildId, 'dimm', 0);
    const machine = M.getMachine(shrink.state, buildId);
    assert.equal(machine.slots.length, 1); // the occupied one stays
  });

  test('changeSlot swaps two parts in the same build', () => {
    let { state, buildId } = buildWithSlots([['dimm', 2]]);
    const p1 = withPart(state, { category: 'ram', label: 'Stick A' });
    state = p1.state;
    let r = M.movePart(state, p1.id, { kind: 'machine', id: buildId });
    state = r.state;
    const slot1Id = r.result.slotId;

    const p2 = withPart(state, { category: 'ram', label: 'Stick B' });
    state = p2.state;
    r = M.movePart(state, p2.id, { kind: 'machine', id: buildId });
    state = r.state;
    const slot2Id = r.result.slotId;

    const swap = M.changeSlot(state, p1.id, slot2Id);
    state = swap.state;
    assert.equal(swap.result.swappedPartId, p2.id);
    assert.equal(M.getPart(state, p1.id).location.slotId, slot2Id);
    assert.equal(M.getPart(state, p2.id).location.slotId, slot1Id);
  });

  test('relabeling and removing slots', () => {
    let { state, buildId } = buildWithSlots([['m2', 1]]);
    let machine = M.getMachine(state, buildId);
    const slotId = machine.slots[0].id;
    const renamed = M.renameSlot(state, buildId, slotId, 'M.2 under heatsink');
    machine = M.getMachine(renamed.state, buildId);
    assert.equal(machine.slots[0].label, 'M.2 under heatsink');

    const removed = M.removeSlot(renamed.state, buildId, slotId);
    machine = M.getMachine(removed.state, buildId);
    assert.equal(machine.slots.length, 0);
  });

  test('removeSlot refuses to remove an occupied slot', () => {
    let { state, buildId } = buildWithSlots([['dimm', 1]]);
    const part = withPart(state, { category: 'ram', label: '8GB' });
    state = part.state;
    const r = M.movePart(state, part.id, { kind: 'machine', id: buildId });
    state = r.state;
    const machine = M.getMachine(state, buildId);
    assert.throws(() => M.removeSlot(state, buildId, machine.slots[0].id));
  });

  test('free slot counts only report defined types', () => {
    let { state, buildId } = buildWithSlots([['dimm', 4]]);
    const gpuPart = withPart(state, { category: 'gpu', label: 'GPU' });
    state = gpuPart.state;
    const r = M.movePart(state, gpuPart.id, { kind: 'machine', id: buildId });
    state = r.state;
    const machine = M.getMachine(state, buildId);
    const counts = M.freeSlotCounts(state, machine);
    assert.equal(counts.dimm, 4);
    assert.equal('pcie-x16' in counts, false); // undefined type omitted

    const withFree = M.machinesWithFreeSlot(state, 'dimm');
    assert.equal(withFree.length, 1);
  });
});

describe('installPartInSlot', () => {
  test('installing one unit of a multi-quantity part leaves the rest behind', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop' });
    s0 = build.state;
    const setup = M.setSlotCount(s0, build.id, 'dimm', 2);
    s0 = setup.state;
    const stack = withPart(s0, { category: 'ram', label: '8GB DDR4', quantity: 3 });
    s0 = stack.state;
    const machine = M.getMachine(s0, build.id);
    const slotId = machine.slots[0].id;

    const { state: s2, result } = M.installPartInSlot(s0, stack.id, build.id, slotId);
    const installed = M.getPart(s2, stack.id);
    assert.equal(installed.quantity, 1);
    assert.equal(installed.location.slotId, slotId);
    const remainder = M.getPart(s2, result.splitRemainderId);
    assert.equal(remainder.quantity, 2);
    assert.equal(remainder.location.kind, 'box');
  });

  test('installing a single-quantity part behaves like a normal move', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop' });
    s0 = build.state;
    const setup = M.setSlotCount(s0, build.id, 'dimm', 1);
    s0 = setup.state;
    const part = withPart(s0, { category: 'ram', label: '8GB' });
    s0 = part.state;
    const machine = M.getMachine(s0, build.id);
    const slotId = machine.slots[0].id;
    const { state: s2, result } = M.installPartInSlot(s0, part.id, build.id, slotId);
    assert.equal(result.splitRemainderId, undefined);
    assert.equal(M.getPart(s2, part.id).location.slotId, slotId);
  });
});

describe('splitting parts', () => {
  test('splits quantity and copies fields, keeping history', () => {
    const s0 = M.createInitialState();
    const box = withBox(s0, { name: 'Box 768' });
    const { state, id } = withPart(box.state, { category: 'ram', label: '4x 4GB DDR3', quantity: 4, tags: ['spare'] });
    const moved = M.movePart(state, id, { kind: 'box', id: box.id });
    const { state: s2, result } = M.splitPart(moved.state, id, 1);
    const original = M.getPart(s2, id);
    const newPart = M.getPart(s2, result.newPartId);
    assert.equal(original.quantity, 3);
    assert.equal(newPart.quantity, 1);
    assert.equal(newPart.label, '4x 4GB DDR3');
    assert.deepEqual(newPart.tags, ['spare']);
    assert.equal(newPart.location.id, box.id);
    // SPEC §4.4: the new part copies the history so far, then records the split.
    assert.deepEqual(newPart.history.map((h) => h.action), ['created', 'moved', 'split']);
    assert.equal(newPart.history.at(-1).from, id);
    assert.deepEqual(original.history.map((h) => h.action), ['created', 'moved', 'split']);
    assert.equal(original.history.at(-1).into, newPart.id);
  });

  test('auto-split units on install also carry the earlier history', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop' });
    const part = withPart(build.state, { category: 'ram', label: '8GB', quantity: 2 });
    const r = M.movePart(part.state, part.id, { kind: 'machine', id: build.id });
    for (const unit of M.partsInMachine(r.state, build.id)) {
      assert.equal(unit.history[0].action, 'created');
      assert.equal(unit.history.at(-1).action, 'moved');
    }
  });

  test('cannot split a part installed in a slot', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop' });
    s0 = build.state;
    const setup = M.setSlotCount(s0, build.id, 'dimm', 2);
    s0 = setup.state;
    const part = withPart(s0, { category: 'ram', label: '8GB', quantity: 2 });
    s0 = part.state;
    const moved = M.movePart(s0, part.id, { kind: 'machine', id: build.id });
    const installedId = moved.result.installed[0].id;
    assert.throws(() => M.splitPart(moved.state, installedId, 1));
  });
});

describe('moving parts', () => {
  test('bulk-style sequential moves keep history consistent', () => {
    let s0 = M.createInitialState();
    const boxA = withBox(s0, { name: 'Box A' });
    s0 = boxA.state;
    const boxB = withBox(s0, { name: 'Box B' });
    s0 = boxB.state;
    const part = withPart(s0, { category: 'fan', label: '120mm fan' }, { kind: 'box', id: boxA.id });
    s0 = part.state;
    const { state: s2 } = M.movePart(s0, part.id, { kind: 'box', id: boxB.id });
    const p = M.getPart(s2, part.id);
    assert.equal(p.location.id, boxB.id);
    assert.equal(p.history.length, 2);
    assert.equal(p.history[1].from.name, 'Box A');
    assert.equal(p.history[1].to.name, 'Box B');
  });

  test('history snapshot includes slot label', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop', nickname: 'Test PC' });
    s0 = build.state;
    const setup = M.setSlotCount(s0, build.id, 'dimm', 1);
    s0 = setup.state;
    const part = withPart(s0, { category: 'ram', label: '8GB' });
    s0 = part.state;
    const moved = M.movePart(s0, part.id, { kind: 'machine', id: build.id });
    const p = M.getPart(moved.state, part.id);
    const lastEntry = p.history[p.history.length - 1];
    assert.match(lastEntry.to.name, /Test PC.*DIMM 1/);
  });

  test('cannot move a retired part', () => {
    const s0 = M.createInitialState();
    const { state, id } = withPart(s0, { category: 'ram', label: '8GB' });
    const retired = M.retirePart(state, id, { reason: 'died', date: '2026-01-01' });
    assert.throws(() => M.movePart(retired.state, id, { kind: 'box', id: M.UNUSED_BOX_ID }));
  });
});

describe('part out a build', () => {
  test('moves every part including the case, then deletes the build', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop', nickname: 'Old Rig' });
    s0 = build.state;
    const cpu = withPart(s0, { category: 'cpu', label: 'i5' }, { kind: 'machine', id: build.id });
    s0 = cpu.state;
    const kase = withPart(s0, { category: 'case', label: 'NZXT H510' }, { kind: 'machine', id: build.id });
    s0 = kase.state;

    const box = withBox(s0, { name: 'Box 768' });
    s0 = box.state;

    const { state: s2, result } = M.partOutBuild(s0, build.id, box.id);
    assert.equal(result.partCount, 2);
    assert.equal(M.getMachine(s2, build.id), null);
    assert.equal(M.getPart(s2, cpu.id).location.id, box.id);
    assert.equal(M.getPart(s2, kase.id).location.id, box.id);
  });
});

describe('retire whole build', () => {
  test('creates a retirement group and retires all parts together', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop', nickname: 'Old Gaming PC' });
    s0 = build.state;
    const cpu = withPart(s0, { category: 'cpu', label: 'i7' }, { kind: 'machine', id: build.id });
    s0 = cpu.state;
    const gpu = withPart(s0, { category: 'gpu', label: 'RTX 2060' }, { kind: 'machine', id: build.id });
    s0 = gpu.state;

    const { state: s2, result } = M.retireWholeBuild(s0, build.id, { reason: 'sold', date: '2026-09-01', price: '150', notes: 'FB Marketplace' });
    assert.equal(result.partCount, 2);
    assert.equal(M.getMachine(s2, build.id), null);
    const group = M.getRetirementGroup(s2, result.groupId);
    assert.equal(group.reason, 'sold');
    assert.equal(group.machineSnapshot.nickname, 'Old Gaming PC');

    const p1 = M.getPart(s2, cpu.id);
    const p2 = M.getPart(s2, gpu.id);
    assert.equal(p1.retired.groupId, result.groupId);
    assert.equal(p2.retired.groupId, result.groupId);
    assert.equal(M.derivePartStatus(p1), 'removed');
  });
});

describe('retire and restore', () => {
  test('retire and restore a single part', () => {
    const s0 = M.createInitialState();
    const { state, id } = withPart(s0, { category: 'gpu', label: 'GTX 1660' });
    const retired = M.retirePart(state, id, { reason: 'died', date: '2026-01-01', notes: 'no display output' });
    assert.equal(M.getPart(retired.state, id).location, null);
    assert.equal(M.derivePartStatus(M.getPart(retired.state, id)), 'removed');

    const box = withBox(retired.state, { name: 'Box 768' });
    const restored = M.restorePart(box.state, id, box.id);
    const p = M.getPart(restored.state, id);
    assert.equal(p.retired, null);
    assert.equal(p.location.id, box.id);
  });

  test('restoring the last part in a group removes the group', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop' });
    s0 = build.state;
    const p1 = withPart(s0, { category: 'cpu', label: 'i5' }, { kind: 'machine', id: build.id });
    s0 = p1.state;
    const retiredWhole = M.retireWholeBuild(s0, build.id, { reason: 'sold', date: '2026-01-01' });
    s0 = retiredWhole.state;
    assert.equal(s0.retirementGroups.length, 1);

    const restored = M.restorePart(s0, p1.id, M.UNUSED_BOX_ID);
    assert.equal(restored.state.retirementGroups.length, 0);
  });

  test('retire and restore a device', () => {
    const s0 = M.createInitialState();
    const { state, id } = withMachine(s0, { type: 'laptop', nickname: 'Old Dell' });
    const retired = M.retireDevice(state, id, { reason: 'sold', date: '2026-01-01', price: '80' });
    assert.equal(M.getMachine(retired.state, id).retired.reason, 'sold');
    const restored = M.restoreDevice(retired.state, id);
    assert.equal(M.getMachine(restored.state, id).retired, null);
  });

  test('cannot retire an already-retired part', () => {
    const s0 = M.createInitialState();
    const { state, id } = withPart(s0, { category: 'gpu', label: 'GTX 1660' });
    const retired = M.retirePart(state, id, { reason: 'died', date: '2026-01-01' });
    assert.throws(() => M.retirePart(retired.state, id, { reason: 'lost', date: '2026-01-02' }));
  });
});

describe('search and tags', () => {
  test('searchAll matches parts, machines and boxes by various fields', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop', nickname: 'Jellyfin Server' });
    s0 = build.state;
    const part = withPart(s0, { category: 'storage', label: '1TB NVMe', tags: ['spare'] });
    s0 = part.state;
    const box = withBox(s0, { name: 'Box 768' });
    s0 = box.state;

    assert.equal(M.searchAll(s0, 'jellyfin').machines.length, 1);
    assert.equal(M.searchAll(s0, 'nvme').parts.length, 1);
    assert.equal(M.searchAll(s0, '768').boxes.length, 1);
    assert.equal(M.searchAll(s0, 'spare').parts.length, 1);
    assert.equal(M.searchAll(s0, 'nonexistent-xyz').parts.length, 0);
  });

  test('allTags collects tags from machines, parts and boxes', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop', tags: ['always-on'] });
    s0 = build.state;
    const part = withPart(s0, { category: 'gpu', label: 'GPU', tags: ['for-sale'] });
    s0 = part.state;
    const tags = M.allTags(s0);
    assert.ok(tags.includes('always-on'));
    assert.ok(tags.includes('for-sale'));
  });
});

// ---------------------------------------------------------------------------
// Regression tests for issues found in review
// ---------------------------------------------------------------------------

function slotLabelOf(state, part) {
  const machine = M.getMachine(state, part.location.id);
  return machine.slots.find((s) => s.id === part.location.slotId).label;
}

describe('slot labels stay unique', () => {
  test('re-installing after a removal reuses the lowest free number (no duplicate "DIMM 2")', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop' });
    s0 = build.state;
    const a = withPart(s0, { category: 'ram', label: 'Stick A' }, { kind: 'machine', id: build.id });
    const b = withPart(a.state, { category: 'ram', label: 'Stick B' }, { kind: 'machine', id: build.id });
    s0 = M.movePart(b.state, a.id, { kind: 'box', id: M.UNUSED_BOX_ID }).state;
    const c = withPart(s0, { category: 'ram', label: 'Stick C' }, { kind: 'machine', id: build.id });
    const labels = M.partsInMachine(c.state, build.id).map((p) => slotLabelOf(c.state, p));
    assert.deepEqual([...labels].sort(), ['DIMM 1', 'DIMM 2']);
    // and slot order follows the numbers
    assert.deepEqual(M.getMachine(c.state, build.id).slots.map((s) => s.label), ['DIMM 1', 'DIMM 2']);
  });

  test('Set slots fills gaps left by removed slots', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop' });
    s0 = M.setSlotCount(build.state, build.id, 'dimm', 4).state;
    const dimm2 = M.getMachine(s0, build.id).slots.find((s) => s.label === 'DIMM 2');
    s0 = M.removeSlot(s0, build.id, dimm2.id).state;
    s0 = M.setSlotCount(s0, build.id, 'dimm', 4).state;
    assert.deepEqual(M.getMachine(s0, build.id).slots.map((s) => s.label), ['DIMM 1', 'DIMM 2', 'DIMM 3', 'DIMM 4']);
  });

  test('setSlotCount rejects nonsense counts', () => {
    const build = withMachine(M.createInitialState(), { type: 'desktop' });
    assert.throws(() => M.setSlotCount(build.state, build.id, 'dimm', -1));
    assert.throws(() => M.setSlotCount(build.state, build.id, 'dimm', 1.5));
    assert.throws(() => M.setSlotCount(build.state, build.id, 'dimm', 1000));
  });
});

describe('any slot edit defines the slot type (SPEC §3.5)', () => {
  test('renaming an auto slot keeps it (and its name) after the part is removed', () => {
    const build = withMachine(M.createInitialState(), { type: 'desktop' });
    const stick = withPart(build.state, { category: 'ram', label: '8GB' }, { kind: 'machine', id: build.id });
    const slotId = M.getPart(stick.state, stick.id).location.slotId;
    let s = M.renameSlot(stick.state, build.id, slotId, 'DIMM A2').state;
    assert.equal(M.isSlotTypeDefined(M.getMachine(s, build.id), 'dimm'), true);
    s = M.movePart(s, stick.id, { kind: 'box', id: M.UNUSED_BOX_ID }).state;
    assert.deepEqual(M.getMachine(s, build.id).slots.map((x) => x.label), ['DIMM A2']);
  });

  test('renaming to an empty label is refused', () => {
    const build = withMachine(M.createInitialState(), { type: 'desktop' });
    const s = M.setSlotCount(build.state, build.id, 'm2', 1).state;
    const slot = M.getMachine(s, build.id).slots[0];
    assert.throws(() => M.renameSlot(s, build.id, slot.id, '   '));
  });

  test('addSlot marks existing auto slots of that type as user slots', () => {
    const build = withMachine(M.createInitialState(), { type: 'desktop' });
    const gpu = withPart(build.state, { category: 'gpu', label: 'GPU' }, { kind: 'machine', id: build.id });
    const s = M.addSlot(gpu.state, build.id, 'pcie-x16').state;
    const slots = M.getMachine(s, build.id).slots;
    assert.deepEqual(slots.map((x) => [x.label, x.origin]), [['PCIe x16 1', 'user'], ['PCIe x16 2', 'user']]);
  });
});

describe('moving a part to where it already is', () => {
  test('is a no-op that returns the same state and no history entry', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop' });
    s0 = M.setSlotCount(build.state, build.id, 'dimm', 2).state;
    const kit = withPart(s0, { category: 'ram', label: '8GB', quantity: 2 }, { kind: 'machine', id: build.id });
    const stick = M.partsInMachine(kit.state, build.id)[0];
    const r = M.movePart(kit.state, stick.id, { kind: 'machine', id: build.id });
    assert.equal(r.state, kit.state);
    assert.equal(r.result.alreadyThere, true);
    assert.equal(M.getMachine(r.state, build.id).slots.length, 2); // no phantom 3rd slot

    const boxed = withPart(s0, { category: 'fan', label: 'Fan' });
    const same = M.movePart(boxed.state, boxed.id, { kind: 'box', id: M.UNUSED_BOX_ID });
    assert.equal(same.state, boxed.state);
    assert.equal(M.getPart(same.state, boxed.id).history.length, 1);
  });
});

describe('M.2 or SATA? for storage of unknown kind', () => {
  test('storageSlotType installs a kind-less drive, without inventing a kind', () => {
    const build = withMachine(M.createInitialState(), { type: 'desktop' });
    const drive = withPart(build.state, { category: 'storage', label: '1TB drive' });
    assert.equal(M.needsStorageSlotChoice(M.getPart(drive.state, drive.id)), true);
    const r = M.movePart(drive.state, drive.id, { kind: 'machine', id: build.id }, { storageSlotType: 'sata' });
    const p = M.getPart(r.state, drive.id);
    assert.equal(slotLabelOf(r.state, p), 'SATA 1');
    assert.equal(p.details.kind, undefined);
  });

  test('works for a multi-quantity kind-less drive added straight into a build', () => {
    const build = withMachine(M.createInitialState(), { type: 'desktop' });
    const r = M.addPart(build.state, { category: 'storage', label: '500GB', quantity: 2, details: { kind: 'other' } },
      { kind: 'machine', id: build.id }, { storageSlotType: 'm2' });
    const labels = M.partsInMachine(r.state, build.id).map((p) => slotLabelOf(r.state, p)).sort();
    assert.deepEqual(labels, ['M.2 1', 'M.2 2']);
  });

  test('a drive with a known kind never needs the question', () => {
    const drive = withPart(M.createInitialState(), { category: 'storage', label: '2TB', details: { kind: 'HDD' } });
    assert.equal(M.needsStorageSlotChoice(M.getPart(drive.state, drive.id)), false);
  });
});

describe('slot compatibility', () => {
  test('installing into an incompatible slot explains why', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop' });
    s0 = M.setSlotCount(build.state, build.id, 'sata', 1).state;
    const nvme = withPart(s0, { category: 'storage', label: '1TB NVMe', details: { kind: 'NVMe' } });
    const slotId = M.getMachine(nvme.state, build.id).slots[0].id;
    assert.throws(() => M.installPartInSlot(nvme.state, nvme.id, build.id, slotId), /NVMe drives can't go in SATA 1/);
  });

  test('a non-slot part cannot be installed into a slot', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop' });
    s0 = M.setSlotCount(build.state, build.id, 'pcie-x16', 1).state;
    const cpu = withPart(s0, { category: 'cpu', label: 'i5' });
    const slotId = M.getMachine(cpu.state, build.id).slots[0].id;
    assert.throws(() => M.installPartInSlot(cpu.state, cpu.id, build.id, slotId), /can't go in PCIe x16 1/);
  });

  test('changeSlot refuses a swap the other part would not fit', () => {
    let s0 = M.createInitialState();
    const build = withMachine(s0, { type: 'desktop' });
    s0 = M.setSlotCount(build.state, build.id, 'pcie-x16', 1).state;
    s0 = M.setSlotCount(s0, build.id, 'pcie-x1', 1).state;
    const nic = withPart(s0, { category: 'expansion', label: 'NIC' }, { kind: 'machine', id: build.id }); // takes x1
    const gpu = withPart(nic.state, { category: 'gpu', label: 'GPU' }, { kind: 'machine', id: build.id }); // takes x16
    const x16 = M.getPart(gpu.state, gpu.id).location.slotId;
    // Moving the NIC into the GPU's x16 slot would push the GPU into an x1 slot.
    assert.throws(() => M.changeSlot(gpu.state, nic.id, x16), /GPU doesn't fit/);
  });
});

describe('editing an installed part keeps it valid', () => {
  function installed(category, label, details) {
    const build = withMachine(M.createInitialState(), { type: 'desktop' });
    const part = withPart(build.state, { category, label, details }, { kind: 'machine', id: build.id });
    return { state: part.state, id: part.id, buildId: build.id };
  }

  test('a slotted part cannot change to a non-slot category or quantity > 1', () => {
    const { state, id } = installed('ram', '8GB');
    assert.throws(() => M.updatePart(state, id, { category: 'cpu' }), /Move the part to a box/);
    assert.throws(() => M.updatePart(state, id, { quantity: 2 }), /single item/);
  });

  test('a drive cannot change to a kind its slot does not take', () => {
    const { state, id } = installed('storage', '1TB', { kind: 'NVMe' });
    assert.throws(() => M.updatePart(state, id, { details: { kind: 'HDD' } }), /doesn't fit M.2 1/);
    // switching between compatible kinds is fine
    const ok = M.updatePart(state, id, { details: { kind: 'M.2 SATA' } });
    assert.equal(M.getPart(ok.state, id).details.kind, 'M.2 SATA');
  });

  test('a non-slot part in a build can change between non-slot categories only', () => {
    const { state, id } = installed('cpu', 'Wrong category');
    const ok = M.updatePart(state, id, { category: 'motherboard' });
    assert.equal(M.getPart(ok.state, id).category, 'motherboard');
    assert.throws(() => M.updatePart(state, id, { category: 'ram' }), /go in slots/);
  });

  test('a part in a box can change to any category', () => {
    const part = withPart(M.createInitialState(), { category: 'cpu', label: 'Actually a board' });
    const r = M.updatePart(part.state, part.id, { category: 'ram' });
    assert.equal(M.getPart(r.state, part.id).category, 'ram');
  });

  test('labels and quantities are validated', () => {
    const part = withPart(M.createInitialState(), { category: 'fan', label: 'Fan', quantity: 3 });
    assert.throws(() => M.updatePart(part.state, part.id, { label: '  ' }));
    assert.throws(() => M.updatePart(part.state, part.id, { quantity: 0 }));
    assert.throws(() => M.updatePart(part.state, part.id, { category: 'toaster' }));
  });

  test('deleting a part frees its slot', () => {
    const { state, id, buildId } = installed('gpu', 'GPU');
    const r = M.deletePart(state, id);
    assert.equal(M.getMachine(r.state, buildId).slots.length, 0); // auto slot removed
  });
});

describe('links', () => {
  test('normalizeLink adds https:// to bare addresses and rejects other schemes', () => {
    assert.equal(M.normalizeLink(''), '');
    assert.equal(M.normalizeLink('  https://example.com/a '), 'https://example.com/a');
    assert.equal(M.normalizeLink('newegg.com/p/123'), 'https://newegg.com/p/123');
    assert.equal(M.normalizeLink('localhost:8080/x'), 'https://localhost:8080/x');
    assert.throws(() => M.normalizeLink('javascript:alert(1)'));
    assert.throws(() => M.normalizeLink('data:text/html,hi'));
  });

  test('safeHref only allows http(s)', () => {
    assert.equal(M.safeHref('https://example.com'), 'https://example.com');
    assert.equal(M.safeHref('javascript:alert(1)'), null);
    assert.equal(M.safeHref(''), null);
    assert.equal(M.safeHref(42), null);
  });

  test('parts and machines store normalized links', () => {
    const part = withPart(M.createInitialState(), { category: 'gpu', label: 'GPU', link: 'example.com/gpu' });
    assert.equal(M.getPart(part.state, part.id).link, 'https://example.com/gpu');
    assert.throws(() => M.addPart(M.createInitialState(), { category: 'gpu', label: 'GPU', link: 'javascript:x' }));
    const m = withMachine(M.createInitialState(), { type: 'laptop' });
    assert.throws(() => M.updateMachine(m.state, m.id, { link: 'javascript:x' }));
  });
});

describe('device display names', () => {
  test('specs show as the subtitle when there is a model name', () => {
    const { state, id } = withMachine(M.createInitialState(),
      { type: 'laptop', nickname: 'Work Laptop', modelName: 'ThinkPad T14', specs: 'i7, 16GB' });
    assert.deepEqual(M.displayName(M.getMachine(state, id), []), { title: 'Work Laptop', subtitle: 'ThinkPad T14 · i7, 16GB' });
  });

  test('an unnamed device gets a readable fallback title', () => {
    const { state, id } = withMachine(M.createInitialState(), { type: 'mini-pc' });
    assert.equal(M.displayName(M.getMachine(state, id), []).title, 'Unnamed mini PC');
  });

  test('a device named only by specs does not repeat them', () => {
    const { state, id } = withMachine(M.createInitialState(), { type: 'sbc', specs: 'Pi 4, 4GB' });
    assert.deepEqual(M.displayName(M.getMachine(state, id), []), { title: 'Pi 4, 4GB', subtitle: '' });
  });
});

describe('search covers details and categories', () => {
  test('finds parts by detail values and category name, and devices by specs', () => {
    let s0 = M.createInitialState();
    s0 = withPart(s0, { category: 'ram', label: 'Stick', details: { generation: 'DDR5' } }).state;
    s0 = withMachine(s0, { type: 'laptop', specs: 'Ryzen 7 7840U' }).state;
    assert.equal(M.searchAll(s0, 'ddr5').parts.length, 1);
    assert.equal(M.searchAll(s0, 'ram').parts.length, 1);
    assert.equal(M.searchAll(s0, '7840u').machines.length, 1);
  });
});
