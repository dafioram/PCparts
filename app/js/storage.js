// storage.js — localStorage persistence for the pc-inventory app.
// Browser-only; not part of the pure model/schema layer.
//
// Safety rule: saved data that can't be read (corrupt JSON, or data that
// fails validation) is never silently thrown away. A copy is kept under
// UNREADABLE_KEY before the app starts fresh, and the UI offers to download
// it. If even that copy can't be written, saving is blocked until the person
// downloads or discards the data, so the original is never overwritten.

import { createInitialState } from './model.js';
import { validateImport } from './schema.js';

export const STORAGE_KEY = 'pc-inventory';
export const UNREADABLE_KEY = 'pc-inventory-unreadable';
const MAX_UNREADABLE_COPIES = 3;

let saveBlocked = false;
let inMemoryUnreadable = null;

function ls() {
  return window.localStorage;
}

export function isStorageAvailable() {
  try {
    const testKey = '__pc-inventory-test__';
    ls().setItem(testKey, '1');
    ls().removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

// Parses and validates a stored JSON string. Returns { state } or { reason }.
function readStored(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { reason: 'It is not valid JSON.' };
  }
  const result = validateImport(parsed);
  if (result.valid) return { state: result.migrated };
  const extra = result.errors.length > 3 ? ` (and ${result.errors.length - 3} more problems)` : '';
  return { reason: result.errors.slice(0, 3).join(' ') + extra };
}

// Loads state from localStorage. Returns
// { state, errors, fromStorage, storageAvailable, unreadable }.
export function load() {
  const fresh = (extra) => ({ state: createInitialState(), errors: [], fromStorage: false, storageAvailable: true, unreadable: false, ...extra });
  if (!isStorageAvailable()) return fresh({ storageAvailable: false });
  let raw;
  try {
    raw = ls().getItem(STORAGE_KEY);
  } catch {
    return fresh({ storageAvailable: false });
  }
  if (!raw) return fresh();

  const read = readStored(raw);
  if (read.state) return { state: read.state, errors: [], fromStorage: true, storageAvailable: true, unreadable: false };

  const kept = keepUnreadableCopy(raw, read.reason);
  return fresh({
    unreadable: true,
    errors: [kept
      ? 'Your saved data could not be loaded, so the app started empty. A copy was kept — download it from the banner.'
      : 'Your saved data could not be loaded or backed up. Download it from the banner — changes won’t be saved until you do.'],
  });
}

// For syncing with another tab: reads what is stored now, without side
// effects. Returns the state, or null if nothing valid is stored.
export function readCurrent() {
  try {
    const raw = ls().getItem(STORAGE_KEY);
    if (!raw) return null;
    return readStored(raw).state || null;
  } catch {
    return null;
  }
}

function keepUnreadableCopy(raw, reason) {
  const entry = { savedAt: new Date().toISOString(), reason, raw };
  const copies = getUnreadableCopies().filter((c) => c.raw !== raw);
  copies.unshift(entry);
  try {
    ls().setItem(UNREADABLE_KEY, JSON.stringify(copies.slice(0, MAX_UNREADABLE_COPIES)));
    return true;
  } catch {
    inMemoryUnreadable = entry;
    saveBlocked = true;
    return false;
  }
}

// Kept copies of saved data that couldn't be loaded, newest first:
// [{ savedAt, reason, raw }].
export function getUnreadableCopies() {
  const list = [];
  try {
    const stored = JSON.parse(ls().getItem(UNREADABLE_KEY) || '[]');
    if (Array.isArray(stored)) list.push(...stored.filter((c) => c && typeof c.raw === 'string'));
  } catch {
    // ignore — nothing usable stored
  }
  if (inMemoryUnreadable && !list.some((c) => c.raw === inMemoryUnreadable.raw)) list.unshift(inMemoryUnreadable);
  return list;
}

export function discardUnreadableCopies() {
  try {
    ls().removeItem(UNREADABLE_KEY);
  } catch {
    // ignore
  }
  inMemoryUnreadable = null;
  saveBlocked = false;
}

export function isSaveBlocked() {
  return saveBlocked;
}

// Persists state immediately. Returns { ok, error }.
export function save(state) {
  if (saveBlocked) return { ok: false, error: 'blocked' };
  if (!isStorageAvailable()) return { ok: false, error: 'storage-unavailable' };
  try {
    ls().setItem(STORAGE_KEY, JSON.stringify(state));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.name === 'QuotaExceededError' ? 'quota-exceeded' : 'unknown', message: e && e.message };
  }
}

// Asks the browser not to evict this origin's storage. Returns a promise of
// boolean (granted), or null if the API isn't available.
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // ignore — treated the same as "not available"
  }
  return null;
}

export async function isPersisted() {
  try {
    if (navigator.storage && navigator.storage.persisted) {
      return await navigator.storage.persisted();
    }
  } catch {
    // ignore
  }
  return null;
}
