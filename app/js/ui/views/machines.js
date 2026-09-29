// machines.js — the Machines list view.

import { h, icon } from '../dom.js';
import * as M from '../../model.js';
import { getState, run, toastUndo } from '../store.js';
import { navigate } from '../nav.js';
import { machineCard, emptyState } from '../components.js';
import { formModal } from '../modal.js';
import { buildMachineFormBody, SLOT_TYPE_LABELS } from '../forms.js';

const filters = { type: 'all', status: 'all', tag: 'all', warningsOnly: false, freeSlot: 'all' };

export function render(container) {
  const state = getState();
  container.appendChild(h('div', { class: 'page-header' }, [
    h('h1', {}, 'Machines'),
    h('div', { class: 'page-actions' }, [
      h('button', { class: 'btn btn-primary', type: 'button', onclick: openAddMachine }, [icon('plus', { size: 16 }), 'Add machine']),
    ]),
  ]));

  container.appendChild(buildFilters(state, () => { container.innerHTML = ''; render(container); }));

  const machines = applyFilters(state);
  if (machines.length === 0) {
    const noneActive = state.machines.every((m) => M.isDevice(m) && m.retired);
    container.appendChild(emptyState('desktop', state.machines.length === 0 || (noneActive && filters.status === 'all')
      ? 'No machines yet — add your first desktop, server or device.'
      : 'Nothing matches these filters.'));
    return;
  }
  container.appendChild(h('div', { class: 'card-grid' }, machines.map((m) => machineCard(m, state))));
}

function applyFilters(state) {
  return state.machines.filter((m) => {
    const retiredDevice = M.isDevice(m) && m.retired;
    // Retired devices live in the graveyard (SPEC §8.5); they only show here
    // when asked for.
    if (filters.status === 'retired') {
      if (!retiredDevice) return false;
    } else if (retiredDevice) {
      return false;
    } else if (filters.status !== 'all' && m.status !== filters.status) {
      return false;
    }
    if (filters.type === 'build' && !M.isBuild(m)) return false;
    if (filters.type === 'device' && !M.isDevice(m)) return false;
    if (filters.tag !== 'all' && !(m.tags || []).includes(filters.tag)) return false;
    if (filters.warningsOnly) {
      if (!M.isBuild(m)) return false;
      if (M.deriveWarnings(m, M.partsInMachine(state, m.id)).length === 0) return false;
    }
    if (filters.freeSlot !== 'all') {
      if (!M.isBuild(m)) return false;
      if (!(M.freeSlotCounts(state, m)[filters.freeSlot] > 0)) return false;
    }
    return true;
  });
}

function buildFilters(state, onChange) {
  const row = h('div', { class: 'filters-row' });
  const select = (label, key, options) => {
    const sel = h('select', { 'aria-label': label, onchange: () => { filters[key] = sel.value; onChange(); } },
      options.map(([value, text]) => h('option', { value }, text)));
    sel.value = filters[key];
    row.appendChild(sel);
  };

  select('Type', 'type', [['all', 'All types'], ['build', 'Builds only'], ['device', 'Devices only']]);
  select('Status', 'status', [
    ['all', 'All statuses'],
    ...M.MACHINE_STATUSES.map((s) => [s, s[0].toUpperCase() + s.slice(1)]),
    ['retired', 'Retired devices'],
  ]);
  const tags = M.allTags(state);
  if (!tags.includes(filters.tag)) filters.tag = 'all';
  if (tags.length) select('Tag', 'tag', [['all', 'All tags'], ...tags.map((t) => [t, t])]);

  row.appendChild(h('button', {
    type: 'button',
    class: 'filter-chip' + (filters.warningsOnly ? ' active' : ''),
    'aria-pressed': String(filters.warningsOnly),
    onclick: () => { filters.warningsOnly = !filters.warningsOnly; onChange(); },
  }, [icon('warning', { size: 13 }), 'Has warnings']));

  select('Free slot', 'freeSlot', [['all', 'Any free slot'], ...M.SLOT_TYPES.map((t) => [t, `Free ${SLOT_TYPE_LABELS[t]} slot`])]);
  return row;
}

function openAddMachine() {
  let form;
  formModal({
    title: 'Add machine',
    submitLabel: 'Add',
    buildBody: () => { form = buildMachineFormBody({ defaultType: 'desktop' }); return form.el; },
    onSubmit: (close) => {
      const result = run(M.addMachine, form.getValues());
      close();
      navigate(`#/machines/${result.id}`);
      const machine = M.getMachine(getState(), result.id);
      toastUndo(`Added ${M.displayName(machine, getState().parts).title}.`);
    },
  });
}
