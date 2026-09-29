// Tests for storage.js and ui/store.js, run in Node against an in-memory
// localStorage (toasts are no-ops here because there is no document).
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.map = new Map(); this.quota = Infinity; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    const size = [...this.map.entries()].filter(([key]) => key !== k).reduce((n, [, val]) => n + val.length, 0) + String(v).length;
    if (size > this.quota) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
    this.map.set(k, String(v));
  }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

const memory = new MemoryStorage();
globalThis.window = { localStorage: memory };

const M = await import('../../app/js/model.js');
const Storage = await import('../../app/js/storage.js');
const Store = await import('../../app/js/ui/store.js');

beforeEach(() => {
  memory.clear();
  memory.quota = Infinity;
  Storage.discardUnreadableCopies();
});

function savedState() {
  return JSON.parse(memory.getItem(Storage.STORAGE_KEY));
}

describe('storage: unreadable saved data is never thrown away', () => {
  test('corrupt JSON: the app starts empty but keeps a copy, and saving still works', () => {
    memory.setItem(Storage.STORAGE_KEY, '{"app":"pc-inventory", oops');
    const info = Storage.load();
    assert.equal(info.unreadable, true);
    assert.equal(info.state.parts.length, 0);
    const copies = Storage.getUnreadableCopies();
    assert.equal(copies.length, 1);
    assert.equal(copies[0].raw, '{"app":"pc-inventory", oops');
    assert.match(copies[0].reason, /not valid JSON/);
    assert.equal(Storage.save(info.state).ok, true);
    // the kept copy survives the overwrite
    assert.equal(Storage.getUnreadableCopies()[0].raw, '{"app":"pc-inventory", oops');
  });

  test('data that fails validation is kept with the reason', () => {
    let s = M.createInitialState();
    for (const label of ['Keep 1', 'Keep 2', 'Keep 3']) s = M.addPart(s, { category: 'fan', label }).state;
    s.parts[0].category = 'bogus';
    const raw = JSON.stringify(s);
    memory.setItem(Storage.STORAGE_KEY, raw);
    const info = Storage.load();
    assert.equal(info.unreadable, true);
    const [copy] = Storage.getUnreadableCopies();
    assert.equal(copy.raw, raw);
    assert.match(copy.reason, /bogus/);
  });

  test('the same unreadable data is only kept once, and at most three copies are kept', () => {
    memory.setItem(Storage.STORAGE_KEY, 'broken-1');
    Storage.load();
    Storage.load();
    assert.equal(Storage.getUnreadableCopies().length, 1);
    for (const raw of ['broken-2', 'broken-3', 'broken-4']) {
      memory.setItem(Storage.STORAGE_KEY, raw);
      Storage.load();
    }
    assert.deepEqual(Storage.getUnreadableCopies().map((c) => c.raw), ['broken-4', 'broken-3', 'broken-2']);
  });

  test('if the copy cannot be written, saving is blocked until the data is discarded', () => {
    memory.setItem(Storage.STORAGE_KEY, 'x'.repeat(50));
    memory.quota = 60; // room for the original, not for a second copy
    const info = Storage.load();
    assert.equal(info.unreadable, true);
    assert.equal(Storage.isSaveBlocked(), true);
    assert.equal(Storage.getUnreadableCopies()[0].raw, 'x'.repeat(50)); // still available to download
    assert.deepEqual(Storage.save(info.state), { ok: false, error: 'blocked' });
    assert.equal(memory.getItem(Storage.STORAGE_KEY), 'x'.repeat(50)); // original untouched

    Storage.discardUnreadableCopies();
    assert.equal(Storage.isSaveBlocked(), false);
  });

  test('readCurrent returns valid stored state and ignores anything else', () => {
    assert.equal(Storage.readCurrent(), null);
    memory.setItem(Storage.STORAGE_KEY, 'nope');
    assert.equal(Storage.readCurrent(), null);
    assert.equal(Storage.getUnreadableCopies().length, 0); // no side effects
    memory.setItem(Storage.STORAGE_KEY, JSON.stringify(M.createInitialState()));
    assert.equal(Storage.readCurrent().boxes[0].id, 'unused');
  });
});

describe('store: undo is tied to the action it describes', () => {
  beforeEach(() => { Store.init(); });

  test('an older toast cannot undo a newer action', () => {
    Store.run(M.addBox, { name: 'A' });
    const idA = Store.toastUndo('Added A');
    Store.run(M.addBox, { name: 'B' });
    const idB = Store.toastUndo('Added B');
    assert.notEqual(idA, idB);
    assert.equal(Store.undo(idA), null); // stale — B is newer
    assert.deepEqual(Store.getState().boxes.map((b) => b.name), ['Unused', 'A', 'B']);
    assert.equal(Store.undo(idB), 'Added B');
    assert.deepEqual(Store.getState().boxes.map((b) => b.name), ['Unused', 'A']);
    // plain undo continues down the stack
    assert.equal(Store.undo(), 'Added A');
    assert.equal(Store.canUndo(), false);
  });

  test('an action that changes nothing records nothing and its toast has no Undo', () => {
    Store.run(M.addBox, { name: 'A' });
    Store.toastUndo('Added A');
    const part = Store.run(M.addPart, { category: 'fan', label: 'Fan' });
    Store.toastUndo('Added Fan');
    const r = Store.run(M.movePart, part.id, { kind: 'box', id: M.UNUSED_BOX_ID });
    assert.equal(r.alreadyThere, true);
    assert.equal(Store.toastUndo('Already there'), null);
    assert.equal(Store.peekUndoLabel(), 'Added Fan');
  });

  test('undo keeps export bookkeeping', () => {
    Store.run(M.addBox, { name: 'A' });
    Store.toastUndo('Added A');
    Store.markExported();
    const exportedAt = Store.getState().meta.lastExportedAt;
    Store.undo();
    assert.equal(Store.getState().meta.lastExportedAt, exportedAt);
  });
});

describe('store: batches are all-or-nothing', () => {
  beforeEach(() => { Store.init(); });

  test('a failing batch rolls back everything and records no undo entry', () => {
    const before = Store.getState();
    assert.throws(() => Store.runBatch(() => {
      Store.run(M.addPart, { category: 'storage', label: 'Stray', details: { kind: 'NVMe' } });
      throw new Error('second step failed');
    }), /second step failed/);
    assert.equal(Store.getState(), before);
    assert.equal(Store.canUndo(), false);
    assert.equal(memory.getItem(Storage.STORAGE_KEY), null); // nothing was saved
  });

  test('a successful batch is one undo step, saved once', () => {
    Store.runBatch(() => {
      Store.run(M.addBox, { name: 'A' });
      Store.run(M.addBox, { name: 'B' });
    });
    assert.deepEqual(savedState().boxes.map((b) => b.name), ['Unused', 'A', 'B']);
    Store.undo();
    assert.deepEqual(Store.getState().boxes.map((b) => b.name), ['Unused']);
    assert.equal(Store.canUndo(), false);
  });
});

describe('store: other tabs and imports reset undo', () => {
  beforeEach(() => { Store.init(); });

  test('adopting another tab’s data clears the undo stack', () => {
    Store.run(M.addBox, { name: 'Mine' });
    const other = M.addBox(M.createInitialState(), { name: 'From other tab' }).state;
    Store.adoptExternalState(other);
    assert.equal(Store.canUndo(), false);
    assert.deepEqual(Store.getState().boxes.map((b) => b.name), ['Unused', 'From other tab']);
  });

  test('replaceAll clears the undo stack and saves', () => {
    Store.run(M.addBox, { name: 'Old' });
    Store.replaceAll(M.createInitialState());
    assert.equal(Store.canUndo(), false);
    assert.deepEqual(savedState().boxes.map((b) => b.name), ['Unused']);
  });
});

describe('store: export nudge (SPEC §10)', () => {
  beforeEach(() => { Store.init(); });

  test('no data, no nudge', () => {
    assert.equal(Store.needsExportNudge(), false);
  });

  test('changes that were never exported need a nudge; a fresh export clears it', () => {
    Store.run(M.addBox, { name: 'A' });
    assert.equal(Store.needsExportNudge(), true);
    Store.markExported();
    assert.equal(Store.needsExportNudge(), false);
  });

  test('box changes count as changes', async () => {
    Store.run(M.addBox, { name: 'A' });
    Store.markExported();
    const later = Date.now() + 20 * 86400000;
    assert.equal(Store.needsExportNudge(later), false); // nothing changed since the export
    await new Promise((resolve) => setTimeout(resolve, 5)); // a change strictly after the export
    Store.run(M.updateBox, Store.getState().boxes[1].id, { notes: 'shelf 3' });
    assert.equal(Store.needsExportNudge(later), true);
    assert.equal(Store.needsExportNudge(), false); // exported less than 14 days ago
  });
});
