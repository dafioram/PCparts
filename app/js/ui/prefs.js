// prefs.js — per-browser UI preferences (collapsed sections, snoozed
// banners). Kept under their own localStorage key: they are not inventory
// data, so they are never exported or imported (SPEC §11.1).

const PREFS_KEY = 'pc-inventory-prefs';

let prefs = read();

function read() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function getPref(key, fallback) {
  return Object.prototype.hasOwnProperty.call(prefs, key) ? prefs[key] : fallback;
}

export function setPref(key, value) {
  prefs = { ...prefs, [key]: value };
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable: the preference lasts for this session only.
  }
}
