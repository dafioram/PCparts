import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../app/js/model.js';
import { validateImport, serializeForExport, SCHEMA_VERSION } from '../../app/js/schema.js';

function baseValidFile() {
  const s0 = M.createInitialState();
  const build = M.addMachine(s0, { type: 'desktop', nickname: 'Jellyfin Server' });
  const part = M.addPart(build.state, { category: 'gpu', label: 'GTX 1050' }, { kind: 'machine', id: build.result.id });
  return serializeForExport(part.state);
}

describe('validateImport: happy paths', () => {
  test('accepts a freshly created empty state', () => {
    const data = serializeForExport(M.createInitialState());
    const result = validateImport(data);
    assert.equal(result.valid, true);
  });

  test('accepts a populated, valid export', () => {
    const result = validateImport(baseValidFile());
    assert.equal(result.valid, true);
    assert.equal(result.migrated.machines.length, 1);
  });

  test('export -> import round trip preserves data', () => {
    let s0 = M.createInitialState();
    const build = M.addMachine(s0, { type: 'desktop', nickname: 'Test' });
    s0 = build.state;
    const slotted = M.setSlotCount(s0, build.result.id, 'dimm', 2);
    s0 = slotted.state;
    const part = M.addPart(s0, { category: 'ram', label: '8GB DDR4' }, { kind: 'machine', id: build.result.id });
    s0 = part.state;

    const exported = serializeForExport(s0);
    const result = validateImport(exported);
    assert.equal(result.valid, true);
    assert.deepEqual(result.migrated.machines, s0.machines);
    assert.deepEqual(result.migrated.parts, s0.parts);
    assert.deepEqual(result.migrated.boxes, s0.boxes);
  });
});

describe('validateImport: rejections', () => {
  test('rejects non-object input', () => {
    assert.equal(validateImport('nope').valid, false);
    assert.equal(validateImport(null).valid, false);
    assert.equal(validateImport([1, 2, 3]).valid, false);
  });

  test('rejects wrong app field', () => {
    const data = { ...baseValidFile(), app: 'something-else' };
    assert.equal(validateImport(data).valid, false);
  });

  test('rejects a newer schema version than supported', () => {
    const data = { ...baseValidFile(), schemaVersion: SCHEMA_VERSION + 1 };
    const result = validateImport(data);
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /newer version/);
  });

  test('rejects missing schemaVersion', () => {
    const data = baseValidFile();
    delete data.schemaVersion;
    assert.equal(validateImport(data).valid, false);
  });

  test('rejects duplicate ids within a collection', () => {
    const data = baseValidFile();
    data.machines.push({ ...data.machines[0] });
    const result = validateImport(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('not unique')));
  });

  test('requires exactly one unused/isDefault box', () => {
    const data = baseValidFile();
    data.boxes = [];
    assert.equal(validateImport(data).valid, false);

    const data2 = baseValidFile();
    data2.boxes.push({ id: 'unused', name: 'Unused 2', isDefault: true, notes: '', tags: [] });
    assert.equal(validateImport(data2).valid, false);
  });

  test('rejects duplicate box names (case-insensitive)', () => {
    const data = baseValidFile();
    data.boxes.push({ id: 'box2', name: 'unused', isDefault: false, notes: '', tags: [] });
    const result = validateImport(data);
    assert.equal(result.valid, false);
  });

  test('rejects a part with both location and retired', () => {
    const data = baseValidFile();
    data.parts[0].retired = { reason: 'sold', date: '2026-01-01', price: '', notes: '' };
    assert.equal(validateImport(data).valid, false);
  });

  test('rejects a part with neither location nor retired', () => {
    const data = baseValidFile();
    data.parts[0].location = null;
    assert.equal(validateImport(data).valid, false);
  });

  test('rejects a location pointing at a nonexistent build', () => {
    const data = baseValidFile();
    data.parts[0].location = { kind: 'machine', id: 'does-not-exist' };
    assert.equal(validateImport(data).valid, false);
  });

  test('rejects a location pointing at a nonexistent box', () => {
    const data = baseValidFile();
    data.parts[0].location = { kind: 'box', id: 'does-not-exist' };
    assert.equal(validateImport(data).valid, false);
  });

  test('rejects a slotId that does not exist on the build', () => {
    const data = baseValidFile();
    data.parts[0].location = { kind: 'machine', id: data.machines[0].id, slotId: 'nope' };
    assert.equal(validateImport(data).valid, false);
  });

  test('rejects two parts sharing the same slot', () => {
    let s0 = M.createInitialState();
    const build = M.addMachine(s0, { type: 'desktop' });
    s0 = build.state;
    const slotted = M.setSlotCount(s0, build.result.id, 'dimm', 1);
    s0 = slotted.state;
    const part = M.addPart(s0, { category: 'ram', label: '8GB' }, { kind: 'machine', id: build.result.id });
    s0 = part.state;
    const machine = M.getMachine(s0, build.result.id);
    const slotId = machine.slots[0].id;
    const data = serializeForExport(s0);
    // Add a second part squatting on the same slot.
    data.parts.push({
      id: 'extra-part', category: 'ram', label: '8GB', quantity: 1, brand: '', model: '', serial: '',
      details: {}, link: '', tags: [], notes: '', retired: null,
      location: { kind: 'machine', id: build.result.id, slotId },
      history: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const result = validateImport(data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('occupied by more than one part')));
  });

  test('rejects a retirementGroups reference that does not exist', () => {
    const data = baseValidFile();
    data.parts[0].location = null;
    data.parts[0].retired = { reason: 'sold', date: '2026-01-01', price: '', notes: '', groupId: 'ghost' };
    const result = validateImport(data);
    assert.equal(result.valid, false);
  });

  test('rejects an unrecognized machine type', () => {
    const data = baseValidFile();
    data.machines[0].type = 'toaster';
    assert.equal(validateImport(data).valid, false);
  });

  test('rejects an unrecognized part category', () => {
    const data = baseValidFile();
    data.parts[0].category = 'nonsense';
    assert.equal(validateImport(data).valid, false);
  });

  test('rejects an unrecognized retirement reason', () => {
    const data = baseValidFile();
    data.parts[0].location = null;
    data.parts[0].retired = { reason: 'raptured', date: '2026-01-01', price: '', notes: '' };
    assert.equal(validateImport(data).valid, false);
  });
});

// ---------------------------------------------------------------------------
// SPEC §11.4 rules added in review: each has a failing case here; the
// happy-path tests above are the passing cases.
// ---------------------------------------------------------------------------

function buildWithRam() {
  let s = M.createInitialState();
  const build = M.addMachine(s, { type: 'desktop', nickname: 'Rig' });
  s = M.setSlotCount(build.state, build.result.id, 'dimm', 2).state;
  s = M.addPart(s, { category: 'ram', label: '8GB' }, { kind: 'machine', id: build.result.id }).state;
  return { data: serializeForExport(s), buildId: build.result.id };
}

const errorsOf = (data) => validateImport(data).errors.join('\n');

describe('validateImport: slot rules', () => {
  test('accepts slot parts in compatible slots, including kind-less drives in either drive slot', () => {
    let s = M.createInitialState();
    const build = M.addMachine(s, { type: 'desktop' });
    s = M.addPart(build.state, { category: 'storage', label: 'Mystery drive' }, { kind: 'machine', id: build.result.id }, { storageSlotType: 'sata' }).state;
    s = M.addPart(s, { category: 'expansion', label: 'NIC' }, { kind: 'machine', id: build.result.id }).state;
    assert.equal(validateImport(serializeForExport(s)).valid, true);
  });

  test('rejects a slot-using part in a build without a slotId', () => {
    const { data } = buildWithRam();
    delete data.parts[0].location.slotId;
    assert.match(errorsOf(data), /must be in a slot/);
  });

  test('rejects a part in a slot of the wrong type', () => {
    const { data } = buildWithRam();
    data.parts[0].category = 'gpu';
    assert.match(errorsOf(data), /gpu part can't be in a dimm slot/);
  });

  test('rejects a drive whose kind does not match its slot', () => {
    let s = M.createInitialState();
    const build = M.addMachine(s, { type: 'desktop' });
    s = M.addPart(build.state, { category: 'storage', label: '1TB', details: { kind: 'NVMe' } }, { kind: 'machine', id: build.result.id }).state;
    const data = serializeForExport(s);
    data.parts[0].details.kind = 'HDD';
    assert.match(errorsOf(data), /storage part can't be in a m2 slot/);
  });

  test('rejects quantity > 1 in a slot', () => {
    const { data } = buildWithRam();
    data.parts[0].quantity = 2;
    assert.match(errorsOf(data), /quantity 1/);
  });

  test('rejects a slotId on a non-slot part in a build, and on a part in a box', () => {
    const { data, buildId } = buildWithRam();
    const slotId = data.machines[0].slots[1].id;
    data.parts.push({ ...data.parts[0], id: 'cpu-1', category: 'cpu', location: { kind: 'machine', id: buildId, slotId } });
    assert.match(errorsOf(data), /slotId must not be set for a cpu part/);

    const again = buildWithRam().data;
    again.parts[0].location = { kind: 'box', id: 'unused', slotId: 'x' };
    assert.match(errorsOf(again), /must not be set for a box location/);
  });

  test('rejects slot ids reused across builds', () => {
    const { data } = buildWithRam();
    const copy = structuredClone(data.machines[0]);
    copy.id = 'second-build';
    data.machines.push(copy);
    assert.match(errorsOf(data), /used by more than one slot/);
  });

  test('rejects slots on a device, and a retired build', () => {
    const { data } = buildWithRam();
    data.machines.push({ id: 'dev', type: 'laptop', slots: [{ id: 'd1', type: 'dimm', label: 'DIMM 1', origin: 'user' }] });
    assert.match(errorsOf(data), /devices have no slots/);

    const again = buildWithRam().data;
    again.machines[0].retired = { reason: 'sold', date: '2026-01-01' };
    assert.match(errorsOf(again), /builds are never retired/);
  });
});

describe('validateImport: field types', () => {
  test('rejects non-text free-text fields', () => {
    const data = baseValidFile();
    data.machines[0].notes = 42;
    data.parts[0].brand = { name: 'x' };
    const errors = errorsOf(data);
    assert.match(errors, /machines\[0\]\.notes must be text/);
    assert.match(errors, /parts\[0\]\.brand must be text/);
  });

  test('treats null free-text fields as empty', () => {
    const data = baseValidFile();
    data.machines[0].notes = null;
    const result = validateImport(data);
    assert.equal(result.valid, true);
    assert.equal(result.migrated.machines[0].notes, '');
  });

  test('rejects malformed details, history and tags', () => {
    const data = baseValidFile();
    data.parts[0].details = 'fast';
    data.parts[0].history = 'yesterday';
    data.parts[0].tags = [1, 2];
    const errors = errorsOf(data);
    assert.match(errors, /details must be an object/);
    assert.match(errors, /history must be a list/);
    assert.match(errors, /tags must be a list/);
  });

  test('rejects a retirement group without its machine snapshot', () => {
    let s = M.createInitialState();
    const build = M.addMachine(s, { type: 'desktop', nickname: 'Old' });
    s = M.addPart(build.state, { category: 'cpu', label: 'i5' }, { kind: 'machine', id: build.result.id }).state;
    s = M.retireWholeBuild(s, build.result.id, { reason: 'sold' }).state;
    const data = serializeForExport(s);
    assert.equal(validateImport(data).valid, true);
    delete data.retirementGroups[0].machineSnapshot;
    assert.match(errorsOf(data), /machineSnapshot is required/);
  });

  test('rejects a retired device without a reason, and a second default box', () => {
    const data = baseValidFile();
    data.machines.push({ id: 'dev', type: 'laptop', retired: { date: '2026-01-01' } });
    assert.match(errorsOf(data), /retired\.reason/);

    const again = baseValidFile();
    again.boxes.push({ id: 'b2', name: 'Other', isDefault: true });
    assert.match(errorsOf(again), /only the "unused" box can be the default/);
  });

  test('rejects notNeeded entries that are not categories', () => {
    const data = baseValidFile();
    data.machines[0].notNeeded = ['gpu', 'unicorn'];
    assert.match(errorsOf(data), /notNeeded must list part categories/);
  });
});
