// graveyard.js — retired parts, retired devices, and retirement groups.

import { h, fmtDate } from '../dom.js';
import * as M from '../../model.js';
import { getState } from '../store.js';
import { catDot, machineIcon, emptyState, tagChips } from '../components.js';
import { RETIRE_REASON_LABELS, CATEGORY_LABELS } from '../forms.js';
import { openRestorePartDialog, restoreDevice } from '../actions.js';

let filters = { reason: 'all', category: 'all', tag: 'all', since: '' };

export function render(container) {
  const state = getState();
  container.appendChild(h('div', { class: 'page-header' }, [h('h1', {}, 'Graveyard')]));
  container.appendChild(buildFilters(state, rerenderSelf));

  const retiredParts = M.retiredParts(state).filter(matchesFilters);
  const groupedIds = new Set(retiredParts.filter((p) => p.retired.groupId).map((p) => p.retired.groupId));
  const standaloneParts = retiredParts.filter((p) => !p.retired.groupId);
  const retiredDevices = state.machines.filter((m) => M.isDevice(m) && m.retired && matchesDeviceFilters(m));

  const groups = state.retirementGroups
    .filter((g) => groupedIds.has(g.id))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const nothing = groups.length === 0 && standaloneParts.length === 0 && retiredDevices.length === 0;
  if (nothing) {
    container.appendChild(emptyState('graveyard', state.parts.some((p) => p.retired) || state.machines.some((m) => m.retired)
      ? 'Nothing matches these filters.'
      : 'Nothing retired yet.'));
    return;
  }

  const items = [
    ...groups.map((g) => ({ type: 'group', date: g.date, node: groupCard(g, state) })),
    ...standaloneParts.map((p) => ({ type: 'part', date: p.retired.date, node: standalonePartCard(p, state) })),
    ...retiredDevices.map((m) => ({ type: 'device', date: m.retired.date, node: deviceCard(m, state) })),
  ].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  container.appendChild(h('div', { class: 'card-grid' }, items.map((i) => i.node)));
}

function rerenderSelf() { const c = document.getElementById('view'); c.innerHTML = ''; render(c); }

function matchesFilters(part) {
  if (filters.reason !== 'all' && part.retired.reason !== filters.reason) return false;
  if (filters.category !== 'all' && part.category !== filters.category) return false;
  if (filters.tag !== 'all' && !(part.tags || []).includes(filters.tag)) return false;
  if (filters.since && part.retired.date && part.retired.date < filters.since) return false;
  return true;
}
function matchesDeviceFilters(machine) {
  if (filters.reason !== 'all' && machine.retired.reason !== filters.reason) return false;
  if (filters.category !== 'all') return false; // devices have no category
  if (filters.tag !== 'all' && !(machine.tags || []).includes(filters.tag)) return false;
  if (filters.since && machine.retired.date && machine.retired.date < filters.since) return false;
  return true;
}

function buildFilters(state, onChange) {
  const row = h('div', { class: 'filters-row' });
  const reasonSel = h('select', { onchange: () => { filters.reason = reasonSel.value; onChange(); } }, [
    h('option', { value: 'all' }, 'Any reason'),
    ...M.RETIRE_REASONS.map((r) => h('option', { value: r }, RETIRE_REASON_LABELS[r])),
  ]);
  reasonSel.value = filters.reason;
  row.appendChild(reasonSel);

  const catSel = h('select', { onchange: () => { filters.category = catSel.value; onChange(); } }, [
    h('option', { value: 'all' }, 'Any category'),
    ...M.PART_CATEGORIES.map((c) => h('option', { value: c }, CATEGORY_LABELS[c])),
  ]);
  catSel.value = filters.category;
  row.appendChild(catSel);

  const tags = M.allTags(state);
  if (tags.length) {
    const tagSel = h('select', { onchange: () => { filters.tag = tagSel.value; onChange(); } }, [
      h('option', { value: 'all' }, 'All tags'),
      ...tags.map((t) => h('option', { value: t }, t)),
    ]);
    tagSel.value = filters.tag;
    row.appendChild(tagSel);
  }

  const sinceInput = h('input', { type: 'date', value: filters.since, onchange: () => { filters.since = sinceInput.value; onChange(); } });
  row.appendChild(h('label', { class: 'muted', style: 'display:flex;align-items:center;gap:6px;font-size:12px' }, ['Since', sinceInput]));

  return row;
}

function groupCard(group, state) {
  const parts = state.parts.filter((p) => p.retired && p.retired.groupId === group.id);
  const snap = group.machineSnapshot;
  return h('div', { class: 'card group-card retired' }, [
    h('div', { class: 'card-top' }, [
      h('div', { class: 'card-icon' }, machineIcon({ type: snap.type })),
      h('div', { class: 'card-titles' }, [
        h('div', { class: 'card-title' }, `Retired together as ${snap.displayTitle || snap.nickname || snap.modelName || 'a build'}`),
        snap.displaySubtitle ? h('div', { class: 'card-subtitle' }, snap.displaySubtitle) : null,
      ]),
    ]),
    h('div', { class: 'card-row' }, [
      h('span', { class: 'chip' }, RETIRE_REASON_LABELS[group.reason]),
      h('span', { class: 'chip' }, fmtDate(group.date)),
      group.price ? h('span', { class: 'chip' }, `$${group.price}`) : null,
    ]),
    group.notes ? h('div', { class: 'card-purpose' }, group.notes) : null,
    tagChips(snap.tags),
    h('details', {}, [
      h('summary', { style: 'cursor:pointer;color:var(--text-muted);font-size:13px' }, `${parts.length} part${parts.length === 1 ? '' : 's'}`),
      h('div', { style: 'margin-top:8px;display:flex;flex-direction:column;gap:6px' }, parts.map((p) => h('div', { class: 'part-row' }, [
        catDot(p.category),
        h('div', { class: 'part-row-main' }, [
          h('a', { class: 'part-row-label', href: `#/parts/${p.id}` }, p.label),
        ]),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => openRestorePartDialog(p) }, 'Restore'),
      ]))),
    ]),
  ]);
}

function standalonePartCard(part, state) {
  return h('div', { class: 'card retired' }, [
    h('div', { class: 'card-top' }, [
      h('div', { class: 'card-icon' }, catDot(part.category)),
      h('div', { class: 'card-titles' }, [
        h('a', { class: 'card-title', href: `#/parts/${part.id}` }, part.label),
        h('div', { class: 'card-subtitle' }, CATEGORY_LABELS[part.category]),
      ]),
    ]),
    h('div', { class: 'card-row' }, [
      h('span', { class: 'chip' }, RETIRE_REASON_LABELS[part.retired.reason]),
      h('span', { class: 'chip' }, fmtDate(part.retired.date)),
      part.retired.price ? h('span', { class: 'chip' }, `$${part.retired.price}`) : null,
    ]),
    part.retired.notes ? h('div', { class: 'card-purpose' }, part.retired.notes) : null,
    tagChips(part.tags),
    h('div', { class: 'card-row' }, [
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openRestorePartDialog(part) }, 'Restore'),
    ]),
  ]);
}

function deviceCard(machine, state) {
  const { title } = M.displayName(machine, state.parts);
  return h('div', { class: 'card retired' }, [
    h('div', { class: 'card-top' }, [
      h('div', { class: 'card-icon' }, machineIcon(machine)),
      h('div', { class: 'card-titles' }, [
        h('a', { class: 'card-title', href: `#/machines/${machine.id}` }, title),
        h('div', { class: 'card-subtitle' }, M.MACHINE_TYPE_SHORT_LABELS[machine.type] || 'Device'),
      ]),
    ]),
    h('div', { class: 'card-row' }, [
      h('span', { class: 'chip' }, RETIRE_REASON_LABELS[machine.retired.reason]),
      h('span', { class: 'chip' }, fmtDate(machine.retired.date)),
      machine.retired.price ? h('span', { class: 'chip' }, `$${machine.retired.price}`) : null,
    ]),
    machine.retired.notes ? h('div', { class: 'card-purpose' }, machine.retired.notes) : null,
    tagChips(machine.tags),
    h('div', { class: 'card-row' }, [
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => restoreDevice(machine) }, 'Restore'),
    ]),
  ]);
}
