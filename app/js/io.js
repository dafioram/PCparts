// io.js — export/import/backup file handling. Browser-only.

import { serializeForExport, validateImport } from './schema.js';

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateTimeStamp(d = new Date()) {
  return `${dateStamp(d)}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Downloads the current state as the person-facing export file. Returns the
// filename used.
export function exportData(state) {
  const data = serializeForExport(state);
  const filename = `pc-inventory-${dateStamp()}.json`;
  downloadJson(data, filename);
  return filename;
}

// Downloads a timestamped backup, used automatically right before an import
// replaces existing data.
export function downloadBackup(state) {
  const data = serializeForExport(state);
  const filename = `pc-inventory-backup-before-import-${dateTimeStamp()}.json`;
  downloadJson(data, filename);
  return filename;
}

// Downloads raw text as-is (used for saved data the app couldn't read, which
// may not even be valid JSON).
export function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function unreadableFilename(savedAt) {
  return `pc-inventory-unreadable-${dateTimeStamp(new Date(savedAt))}.json`;
}

// Reads a File object (from an <input type="file">) and resolves to its
// parsed JSON, or rejects with a readable error.
export function readFileAsJson(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch {
        reject(new Error('That file is not valid JSON.'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsText(file);
  });
}

// Full import flow up to (not including) the "replace" confirmation step:
// reads the file and validates it. Returns { valid, errors, migrated }.
export async function prepareImport(file) {
  let raw;
  try {
    raw = await readFileAsJson(file);
  } catch (e) {
    return { valid: false, errors: [e.message] };
  }
  return validateImport(raw);
}
