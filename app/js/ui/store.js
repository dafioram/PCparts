// store.js — single source of truth for app state, undo stack, persistence
// and the toast wiring around mutations. Views call `run` / `runBatch` with
// pure model.js functions and then `toastUndo(message)`; this module records
// undo history, saves, and notifies subscribers to re-render.

import * as Storage from '../storage.js';
import { showToast, stripUndoButtons } from './toast.js';

const UNDO_LIMIT = 20;

let state = null;
let undoStack = []; // [{ id, state, label }], newest last
let undoSeq = 0;
let pendingUndoId = null; // entry pushed by the latest run/runBatch, until a toast claims it
let listeners = [];
let loadInfo = { errors: [], storageAvailable: true };
let batchDepth = 0;

export function init() {
  loadInfo = Storage.load();
  state = loadInfo.state;
  undoStack = [];
  pendingUndoId = null;
  return loadInfo;
}

export function getLoadInfo() {
  return loadInfo;
}

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((f) => f !== fn); };
}

function notify() {
  for (const fn of listeners) fn(state);
}

function persist() {
  const result = Storage.save(state);
  if (!result.ok && result.error === 'quota-exceeded') {
    showToast('Could not save — browser storage is full. Export a backup now.', { warn: true, duration: 9000 });
  } else if (!result.ok && result.error === 'unknown') {
    showToast('Could not save changes to this browser. Export a backup to be safe.', { warn: true, duration: 9000 });
  }
  // 'storage-unavailable' and 'blocked' are shown as persistent banners.
  return result;
}

function stamped(s) {
  return { ...s, meta: { ...(s.meta || {}), lastChangedAt: new Date().toISOString() } };
}

function commit(before) {
  state = stamped(state);
  undoSeq += 1;
  undoStack.push({ id: undoSeq, state: before, label: '' });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  pendingUndoId = undoSeq;
  stripUndoButtons(); // older toasts can't undo past this change
  persist();
  notify();
}

// Applies a pure mutation and returns its `result`. A mutation that returns
// the same state object (e.g. moving a part to where it already is) changes
// nothing and records nothing. Inside runBatch(), changes are only committed
// when the batch finishes.
export function run(mutatorFn, ...args) {
  if (batchDepth === 0) pendingUndoId = null;
  const before = state;
  const { state: newState, result } = mutatorFn(state, ...args);
  if (newState === state) return result;
  state = newState;
  if (batchDepth === 0) commit(before);
  return result;
}

// Runs `fn` (which calls run() any number of times) as one all-or-nothing
// step: one undo entry, one save, one re-render. If `fn` throws, everything
// it changed is rolled back and the error is re-thrown.
export function runBatch(fn) {
  if (batchDepth > 0) return fn();
  pendingUndoId = null;
  const before = state;
  batchDepth = 1;
  let returned;
  try {
    returned = fn();
  } catch (e) {
    state = before;
    throw e;
  } finally {
    batchDepth = 0;
  }
  if (state !== before) commit(before);
  return returned;
}

// Shows a toast for the action that just ran, with an Undo button that
// reverts exactly that action. If the action changed nothing, the toast has
// no Undo. Returns the undo entry id the toast is bound to, or null.
export function toastUndo(message, opts = {}) {
  if (!message) return null;
  const id = pendingUndoId;
  pendingUndoId = null;
  const top = undoStack[undoStack.length - 1];
  if (id == null || !top || top.id !== id) {
    showToast(message, opts);
    return null;
  }
  top.label = message;
  showToast(message, {
    ...opts,
    onUndo: () => {
      if (undo(id)) showToast('Undone.');
    },
  });
  return id;
}

// Undoes the newest change (or, with `id`, only if that change is still the
// newest). Returns the undone change's label, or null if nothing happened.
// Export bookkeeping (lastExportedAt) is not rolled back.
export function undo(id = null) {
  const top = undoStack[undoStack.length - 1];
  if (!top || (id != null && top.id !== id)) return null;
  undoStack.pop();
  const exportedAt = state.meta ? state.meta.lastExportedAt : null;
  state = stamped({ ...top.state, meta: { ...(top.state.meta || {}), lastExportedAt: exportedAt } });
  pendingUndoId = null;
  stripUndoButtons();
  persist();
  notify();
  return top.label || 'the last change';
}

export function canUndo() {
  return undoStack.length > 0;
}

export function peekUndoLabel() {
  const top = undoStack[undoStack.length - 1];
  return top ? top.label || 'the last change' : null;
}

function resetUndo() {
  undoStack = [];
  pendingUndoId = null;
  stripUndoButtons();
}

// Used by import: replaces all data outright and clears the undo stack.
export function replaceAll(newState) {
  state = stamped(newState);
  resetUndo();
  persist();
  notify();
}

// Another tab saved new data: adopt it. The undo stack is cleared because
// its entries predate the other tab's change.
export function adoptExternalState(newState) {
  state = newState;
  resetUndo();
  notify();
}

export function markExported() {
  state = { ...state, meta: { ...(state.meta || {}), lastExportedAt: new Date().toISOString() } };
  persist();
  notify();
}

// ---------------------------------------------------------------------------
// export nudge (SPEC §10)
// ---------------------------------------------------------------------------

// Older data has no meta.lastChangedAt; fall back to record timestamps.
function legacyLastChange(s) {
  let latest = null;
  for (const m of s.machines) if (m.updatedAt && (!latest || m.updatedAt > latest)) latest = m.updatedAt;
  for (const p of s.parts) if (p.updatedAt && (!latest || p.updatedAt > latest)) latest = p.updatedAt;
  return latest;
}

// True when there are unexported changes and the last export is older than
// 14 days or never happened.
export function needsExportNudge(now = Date.now()) {
  const meta = state.meta || {};
  const lastChange = meta.lastChangedAt || legacyLastChange(state);
  if (!lastChange) return false;
  const exportedAt = meta.lastExportedAt;
  const hasUnexported = !exportedAt || lastChange > exportedAt;
  const stale = !exportedAt || (now - Date.parse(exportedAt)) / 86400000 > 14;
  return hasUnexported && stale;
}
