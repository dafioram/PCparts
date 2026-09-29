// parts.js — the All Parts view: every active part, filterable, with bulk move.

import { h, icon } from '../dom.js';
import * as M from '../../model.js';
import { getState } from '../store.js';
import { partRow, emptyState } from '../components.js';
import { CATEGORY_LABELS } from '../forms.js';
import {
  openMoveDialog, openAddPartDialog, openEditPartDialog, openRetirePartDialog, currentPlace,
} from '../actions.js';
import { useSelection, toggleSelected, clearSelection } from '../selection.js';

const filters = { category: 'all', location: 'all', tag: 'all', status: 'all' };

export function render(container) {
  const state = getState();
  container.appendChild(h('div', { class: 'page-header' }, [
    h('h1', {}, 'All Parts'),
    h('div', { class: 'page-actions' }, [
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openAddPartDialog({ into: { kind: 'box', id: M.UNUSED_BOX_ID } }) }, [icon('plus', { size: 16 }), 'Add part']),
    ]),
  ]));

  container.appendChild(buildFilters(state));

  const parts = applyFilters(state);
  // Only parts shown on screen can stay selected (filters hide the rest).
  const selected = useSelection('parts', parts.map((p) => p.id));
  if (parts.length === 0) {
    container.appendChild(emptyState('parts', state.parts.length === 0 ? 'No parts yet.' : 'Nothing matches these filters.'));
    return;
  }

  container.appendChild(h('div', { class: 'section' }, [h('div', { class: 'section-body', style: 'padding-top:10px' },
    parts.map((p) => partRow(p, state, {
      showLocation: true,
      selectable: true,
      selected: selected.has(p.id),
      onToggleSelect: (id) => { toggleSelected(id); rerender(); },
      actions: [
        { label: 'Move to…', icon: 'move', onClick: () => openMoveDialog([p.id], { exclude: currentPlace(p) }) },
        { label: 'Edit', icon: 'edit', onClick: () => openEditPartDialog(p) },
        { label: 'Retire', icon: 'graveyard', onClick: () => openRetirePartDialog(p) },
      ],
    }))),
  ]));

  if (selected.size > 0) {
    container.appendChild(h('div', { class: 'selection-bar' }, [
      h('span', {}, `${selected.size} selected`),
      h('div', { class: 'card-row' }, [
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openMoveDialog([...selected]) }, 'Move to…'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { clearSelection(); rerender(); } }, 'Clear'),
      ]),
    ]));
  }
}

function rerender() {
  const c = document.getElementById('view');
  c.innerHTML = '';
  render(c);
}

function applyFilters(state) {
  return M.activeParts(state).filter((p) => {
    if (filters.category !== 'all' && p.category !== filters.category) return false;
    if (filters.tag !== 'all' && !(p.tags || []).includes(filters.tag)) return false;
    if (filters.status !== 'all' && M.derivePartStatus(p) !== filters.status) return false;
    if (filters.location === 'unused' && !(p.location.kind === 'box' && p.location.id === M.UNUSED_BOX_ID)) return false;
    if (filters.location === 'box' && p.location.kind !== 'box') return false;
    if (filters.location === 'machine' && p.location.kind !== 'machine') return false;
    return true;
  });
}

function filterSelect(label, key, options) {
  const sel = h('select', { 'aria-label': label, onchange: () => { filters[key] = sel.value; rerender(); } },
    options.map(([value, text]) => h('option', { value }, text)));
  sel.value = filters[key];
  return sel;
}

function buildFilters(state) {
  const row = h('div', { class: 'filters-row' });
  row.appendChild(filterSelect('Category', 'category', [['all', 'All categories'], ...M.PART_CATEGORIES.map((c) => [c, CATEGORY_LABELS[c]])]));
  row.appendChild(filterSelect('Status', 'status', [['all', 'Any status'], ['in-use', 'In use'], ['unused', 'Unused']]));
  row.appendChild(filterSelect('Location', 'location', [['all', 'Anywhere'], ['machine', 'In a build'], ['box', 'In any box'], ['unused', 'In Unused specifically']]));
  const tags = M.allTags(state);
  if (!tags.includes(filters.tag)) filters.tag = 'all';
  if (tags.length) row.appendChild(filterSelect('Tag', 'tag', [['all', 'All tags'], ...tags.map((t) => [t, t])]));
  return row;
}
