// selection.js — the bulk-select checkboxes shared by list pages.
//
// A selection belongs to one page ("box:<id>", "machine:<id>", "parts"). Going
// to a different page starts a fresh, empty selection, and ids that are no
// longer shown on the page (moved away, filtered out, retired) are dropped,
// so a bulk action only ever touches parts the person can see ticked.

let current = { context: null, ids: new Set() };

export function useSelection(context, visibleIds) {
  if (current.context !== context) current = { context, ids: new Set() };
  const visible = new Set(visibleIds);
  for (const id of [...current.ids]) if (!visible.has(id)) current.ids.delete(id);
  return current.ids;
}

export function toggleSelected(id) {
  if (current.ids.has(id)) current.ids.delete(id);
  else current.ids.add(id);
}

export function clearSelection() {
  current.ids.clear();
}
