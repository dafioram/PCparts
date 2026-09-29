// machineDetail.js — the machine detail view: fields, slot sections
// (Memory/Storage/PCIe) for builds, other parts, warnings, and the
// part-out / retire-whole-build / retire-device actions.

import { h, icon, fmtDate } from '../dom.js';
import * as M from '../../model.js';
import { getState, run, runBatch, toastUndo } from '../store.js';
import { navigate } from '../nav.js';
import {
  machineIcon, statusChip, typeChip, tagChips, catDot, partRow, emptyState, warningLine, linkLine,
} from '../components.js';
import { openModal, formModal, confirmDialog } from '../modal.js';
import {
  buildMachineFormBody, buildRetireFormBody, field, selectEl, CATEGORY_LABELS, RETIRE_REASON_LABELS, SLOT_TYPE_LABELS,
} from '../forms.js';
import {
  openMoveDialog, openAddPartDialog, openEditPartDialog, openRetirePartDialog, placeName, restoreDevice,
} from '../actions.js';
import { useSelection, toggleSelected, clearSelection } from '../selection.js';
import { getPref, setPref } from '../prefs.js';
import { showToast } from '../toast.js';

const NON_SLOT_CATEGORIES = M.PART_CATEGORIES.filter((c) => !M.usesSlotSystem(c));
// "Other parts → Add part" suggests the next thing a build usually needs.
const OTHER_PARTS_ORDER = ['cpu', 'motherboard', 'psu', 'case', 'cooler', 'fan', 'other'];

const SECTIONS = [
  { key: 'memory', title: 'Memory', types: ['dimm'], defaultCollapsed: true },
  { key: 'storage', title: 'Storage', types: ['m2', 'sata'], defaultCollapsed: false },
  { key: 'pcie', title: 'PCIe', types: ['pcie-x16', 'pcie-x1'], defaultCollapsed: false },
];

const SLOT_FIELD_LABELS = {
  dimm: 'DIMM slots', m2: 'M.2 slots', sata: 'SATA ports', 'pcie-x16': 'PCIe x16 slots', 'pcie-x1': 'PCIe x1 slots',
};

function isCollapsed(section) {
  const prefs = getPref('collapsedSections', {});
  return section.key in prefs ? prefs[section.key] : section.defaultCollapsed;
}
function setCollapsed(section, value) {
  setPref('collapsedSections', { ...getPref('collapsedSections', {}), [section.key]: value });
}

export function render(container, machineId) {
  const state = getState();
  const machine = M.getMachine(state, machineId);
  if (!machine) {
    container.appendChild(emptyState('desktop', 'That machine no longer exists.'));
    return;
  }

  const isBuild = M.isBuild(machine);
  const machineParts = isBuild ? M.partsInMachine(state, machine.id) : [];
  const selected = useSelection(`machine:${machine.id}`, machineParts.map((p) => p.id));
  const { title, subtitle } = M.displayName(machine, state.parts);
  const warnings = isBuild ? M.deriveWarnings(machine, machineParts) : [];

  container.appendChild(h('div', { class: 'detail-header' }, [
    h('div', { class: 'card-icon' }, machineIcon(machine)),
    h('div', { class: 'card-titles' }, [
      h('h1', { class: 'card-title' }, title),
      subtitle ? h('div', { class: 'card-subtitle' }, subtitle) : null,
      h('div', { class: 'card-row', style: 'margin-top:8px' }, [
        machine.retired ? statusChip('retired') : statusChip(machine.status),
        typeChip(machine),
      ]),
      machine.purpose ? h('p', { class: 'muted', style: 'margin-top:8px' }, machine.purpose) : null,
      tagChips(machine.tags),
      machine.serial ? h('div', { class: 'detail-meta' }, `Serial: ${machine.serial}`) : null,
      linkLine(machine.link),
      machine.notes ? h('p', { class: 'notes', style: 'margin-top:8px' }, machine.notes) : null,
      machine.retired ? h('p', { class: 'muted' }, retiredLine(machine.retired)) : null,
    ]),
    h('div', { class: 'detail-actions' }, buildHeaderActions(machine, machineParts)),
  ]));

  if (!isBuild) return; // devices have no parts

  if (warnings.length || (machine.notNeeded && machine.notNeeded.length)) {
    container.appendChild(renderWarningsSection(machine, warnings));
  }
  for (const section of SECTIONS) {
    container.appendChild(renderSlotSection(machine, state, section, selected));
  }
  container.appendChild(renderOtherParts(machine, state, selected));
  container.appendChild(renderSelectionBar(machine, selected));
}

function retiredLine(r) {
  const bits = [`Retired — ${RETIRE_REASON_LABELS[r.reason] || r.reason}`];
  if (r.date) bits.push(fmtDate(r.date));
  if (r.price) bits.push(`$${r.price}`);
  return bits.join(' · ') + (r.notes ? ` — ${r.notes}` : '');
}

function rerender(machineId) {
  const container = document.getElementById('view');
  container.innerHTML = '';
  render(container, machineId);
}

// ---------------------------------------------------------------------------
// warnings + "integrated / not needed"
// ---------------------------------------------------------------------------

function renderWarningsSection(machine, warnings) {
  const notNeeded = machine.notNeeded || [];
  const body = h('div', { class: 'section-body', style: 'padding-top:12px' });

  if (warnings.length) {
    body.appendChild(h('div', { class: 'warnings-list' }, warnings.map((cat) => h('div', {
      class: 'card-row', style: 'justify-content:space-between',
    }, [
      warningLine(`No ${CATEGORY_LABELS[cat]} assigned`),
      h('label', { class: 'checkbox-row small muted' }, [
        h('input', {
          type: 'checkbox',
          onchange: () => {
            run(M.updateMachine, machine.id, { notNeeded: [...notNeeded, cat] });
            toastUndo(`${CATEGORY_LABELS[cat]} marked as not needed.`);
          },
        }),
        'Integrated / not needed',
      ]),
    ]))));
  }

  if (notNeeded.length) {
    body.appendChild(h('div', { class: 'card-row', style: 'margin-top:10px' }, notNeeded.map((cat) => h('span', { class: 'chip' }, [
      `${CATEGORY_LABELS[cat]} not needed`,
      h('button', {
        class: 'chip-remove', type: 'button', 'aria-label': `${CATEGORY_LABELS[cat]} is needed after all`,
        onclick: () => {
          run(M.updateMachine, machine.id, { notNeeded: notNeeded.filter((c) => c !== cat) });
          toastUndo(`${CATEGORY_LABELS[cat]} is expected again.`);
        },
      }, icon('close', { size: 11 })),
    ]))));
  }

  return h('div', { class: 'section', 'data-section': 'warnings' }, [body]);
}

// ---------------------------------------------------------------------------
// header actions
// ---------------------------------------------------------------------------

function buildHeaderActions(machine, machineParts) {
  const actions = [
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openEditMachine(machine) }, [icon('edit', { size: 14 }), 'Edit']),
  ];

  if (M.isBuild(machine)) {
    if (machineParts.length === 0) {
      actions.push(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => confirmDeleteMachine(machine, 'This build has no parts, so this just removes the empty record.') }, [icon('trash', { size: 14 }), 'Delete']));
    } else {
      actions.push(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openPartOut(machine) }, 'Part out'));
      actions.push(h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => openRetireWholeBuild(machine) }, 'Retire whole build'));
    }
  } else if (machine.retired) {
    actions.push(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => restoreDevice(machine) }, 'Restore'));
    actions.push(h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => confirmDeleteMachine(machine, 'This removes the device record entirely.') }, [icon('trash', { size: 14 }), 'Delete']));
  } else {
    actions.push(h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => openRetireDevice(machine) }, 'Retire'));
    actions.push(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => confirmDeleteMachine(machine, 'Use this for entries made by mistake. If you sold or gave it away, retire it instead so it stays in the graveyard.') }, [icon('trash', { size: 14 }), 'Delete']));
  }
  return actions;
}

function openEditMachine(machine) {
  let form;
  formModal({
    title: 'Edit machine',
    buildBody: () => { form = buildMachineFormBody({ machine }); return form.el; },
    onSubmit: (close) => {
      const values = form.getValues();
      delete values.type; // immutable after creation
      run(M.updateMachine, machine.id, values);
      close();
      toastUndo('Saved changes.');
    },
  });
}

function confirmDeleteMachine(machine, body) {
  const { title } = M.displayName(machine, getState().parts);
  confirmDialog({
    title: `Delete ${title}?`,
    body,
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => {
      run(M.deleteMachine, machine.id);
      navigate('#/machines');
      toastUndo(`Deleted ${title}.`);
    },
  });
}

function openRetireDevice(machine) {
  let form;
  const { title } = M.displayName(machine, []);
  formModal({
    title: `Retire ${title}`,
    submitLabel: 'Retire',
    buildBody: () => { form = buildRetireFormBody({ defaultReason: 'sold' }); return form.el; },
    onSubmit: (close) => {
      run(M.retireDevice, machine.id, form.getValues());
      close();
      toastUndo(`Retired ${title}.`);
    },
  });
}

// The parts a whole-build action will touch, listed for confirmation.
function partsList(machine, parts) {
  return h('ul', { class: 'confirm-list' }, parts.map((p) => {
    const slot = p.location.slotId ? (machine.slots || []).find((s) => s.id === p.location.slotId) : null;
    return h('li', {}, [catDot(p.category), h('span', {}, p.quantity > 1 ? `${p.quantity} × ${p.label}` : p.label), slot ? h('span', { class: 'muted' }, ` · ${slot.label}`) : null]);
  }));
}

// SPEC §8.1: choose a box (default Unused), confirm the full list, then part out.
function openPartOut(machine) {
  const state = getState();
  const parts = M.partsInMachine(state, machine.id);
  const { title } = M.displayName(machine, state.parts);
  let boxSelect;
  formModal({
    title: `Part out ${title}`,
    submitLabel: `Move ${parts.length} part${parts.length === 1 ? '' : 's'} and delete build`,
    buildBody: () => {
      boxSelect = selectEl(state.boxes.map((b) => ({ value: b.id, label: b.name })), M.UNUSED_BOX_ID);
      return h('div', {}, [
        h('p', { class: 'muted' }, 'Every part below — including the case — moves to the box you pick, then the build record is deleted.'),
        field('Move the parts to', boxSelect),
        partsList(machine, parts),
      ]);
    },
    onSubmit: (close) => {
      const dest = { kind: 'box', id: boxSelect.value };
      const result = run(M.partOutBuild, machine.id, dest.id);
      close();
      navigate('#/machines');
      toastUndo(`Parted out ${title}: ${result.partCount} part${result.partCount === 1 ? '' : 's'} moved to ${placeName(dest)}.`);
    },
  });
}

// SPEC §8.2: reason/date/price/notes, the full list, then retire together.
function openRetireWholeBuild(machine) {
  const state = getState();
  const parts = M.partsInMachine(state, machine.id);
  const { title } = M.displayName(machine, state.parts);
  let form;
  formModal({
    title: `Retire ${title} as a whole`,
    submitLabel: `Retire all ${parts.length}`,
    buildBody: () => {
      form = buildRetireFormBody({ defaultReason: 'sold' });
      return h('div', {}, [
        h('p', { class: 'muted' }, 'Every part below is retired together (they stay grouped in the graveyard), and the build record is deleted.'),
        partsList(machine, parts),
        form.el,
      ]);
    },
    onSubmit: (close) => {
      const result = run(M.retireWholeBuild, machine.id, form.getValues());
      close();
      navigate('#/graveyard');
      toastUndo(`Retired ${title} and its ${result.partCount} part${result.partCount === 1 ? '' : 's'} together.`);
    },
  });
}

// ---------------------------------------------------------------------------
// slot sections
// ---------------------------------------------------------------------------

function slotTypeOf(part, machine) {
  if (!part.location || !part.location.slotId) return null;
  const slot = (machine.slots || []).find((s) => s.id === part.location.slotId);
  return slot ? slot.type : null;
}

function renderSlotSection(machine, state, section, selected) {
  const allParts = M.partsInMachine(state, machine.id);
  const parts = allParts.filter((p) => M.usesSlotSystem(p.category) && section.types.includes(slotTypeOf(p, machine)));
  const slotsByType = section.types.map((type) => [type, (machine.slots || []).filter((s) => s.type === type)]);
  const typesWithSlots = slotsByType.filter(([, slots]) => slots.length > 0);

  const collapsed = isCollapsed(section);
  const sectionEl = h('div', { class: 'section' + (collapsed ? ' collapsed' : ''), 'data-section': section.key });
  const header = h('button', {
    type: 'button',
    class: 'section-header',
    'aria-expanded': String(!collapsed),
    onclick: () => {
      const nowCollapsed = !sectionEl.classList.contains('collapsed');
      sectionEl.classList.toggle('collapsed', nowCollapsed);
      header.setAttribute('aria-expanded', String(!nowCollapsed));
      setCollapsed(section, nowCollapsed);
    },
  }, [
    h('span', { class: 'section-title' }, [section.title, h('span', { class: 'section-summary' }, sectionSummary(section, machine, state, parts))]),
    icon('chevron', { class: 'chevron', size: 18 }),
  ]);
  sectionEl.appendChild(header);

  const body = h('div', { class: 'section-body' });
  body.appendChild(h('div', { class: 'section-actions' }, [
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openSetSlots(machine, section) }, 'Set slots'),
    h('button', {
      class: 'btn btn-sm', type: 'button',
      onclick: () => openAddPartDialog({ into: { kind: 'machine', id: machine.id }, defaultCategory: categoryForSection(section) }),
    }, [icon('plus', { size: 14 }), 'Add part']),
  ]));

  if (typesWithSlots.length === 0) {
    body.appendChild(h('p', { class: 'section-note' }, 'Nothing here yet. Add a part and a slot will be created automatically.'));
  }

  // M.2 before SATA, x16 before x1; sub-headings when both kinds are present.
  for (const [type, slots] of typesWithSlots) {
    if (typesWithSlots.length > 1) body.appendChild(h('div', { class: 'slot-group-title' }, SLOT_TYPE_LABELS[type]));
    for (const slot of slots) {
      const occupant = parts.find((p) => p.location.slotId === slot.id);
      body.appendChild(occupant ? renderInstalledPartRow(occupant, slot, machine, state, selected) : renderEmptySlot(machine, slot));
    }
  }

  sectionEl.appendChild(body);
  return sectionEl;
}

function renderEmptySlot(machine, slot) {
  return h('div', { class: 'slot-placeholder' }, [
    h('span', {}, slot.label),
    h('div', { class: 'card-row' }, [
      h('button', { class: 'icon-btn', type: 'button', title: 'Rename slot', 'aria-label': 'Rename slot', onclick: () => openRenameSlot(machine, slot) }, icon('edit', { size: 13 })),
      h('button', {
        class: 'icon-btn', type: 'button', title: 'Remove slot', 'aria-label': 'Remove slot',
        onclick: () => { run(M.removeSlot, machine.id, slot.id); toastUndo(`Removed ${slot.label}.`); },
      }, icon('trash', { size: 13 })),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openInstallHere(machine, slot) }, 'Install part here'),
    ]),
  ]);
}

function categoryForSection(section) {
  if (section.key === 'memory') return 'ram';
  if (section.key === 'storage') return 'storage';
  return 'gpu';
}

function sectionSummary(section, machine, state, parts) {
  const counts = M.freeSlotCounts(state, machine);
  if (section.key === 'memory') {
    const cap = M.capacityTotal(parts, { base: M.MEMORY_BASE });
    const gen = parts.map((p) => p.details && p.details.generation).find(Boolean);
    const size = `${cap.text || '0GB'}${gen ? ` ${gen}` : ''}`;
    if (M.isSlotTypeDefined(machine, 'dimm')) {
      const total = (machine.slots || []).filter((s) => s.type === 'dimm').length;
      return `${size} · ${total - (counts.dimm || 0)} of ${total} slots used`;
    }
    return `${size} · ${parts.length} stick${parts.length === 1 ? '' : 's'}`;
  }
  if (section.key === 'storage') {
    const cap = M.capacityTotal(parts);
    const bits = [cap.text || '0GB', `${parts.length} drive${parts.length === 1 ? '' : 's'}`];
    if (counts.m2 != null) bits.push(`${counts.m2} M.2 free`);
    if (counts.sata != null) bits.push(`${counts.sata} SATA free`);
    return bits.join(' · ');
  }
  const bits = [`${parts.length} installed`];
  if (counts['pcie-x16'] != null) bits.push(`${counts['pcie-x16']} x16 free`);
  if (counts['pcie-x1'] != null) bits.push(`${counts['pcie-x1']} x1 free`);
  return bits.join(' · ');
}

function renderInstalledPartRow(part, slot, machine, state, selected) {
  return partRow(part, state, {
    selectable: true,
    selected: selected.has(part.id),
    onToggleSelect: (id) => { toggleSelected(id); rerender(machine.id); },
    slotLabel: slot.label,
    actions: [
      { label: 'Rename slot', icon: 'tag', onClick: () => openRenameSlot(machine, slot) },
      { label: 'Change slot', icon: 'move', onClick: () => openChangeSlot(part, machine) },
      { label: 'Move to…', icon: 'box', onClick: () => openMoveDialog([part.id], { exclude: { kind: 'machine', id: machine.id } }) },
      { label: 'Edit', icon: 'edit', onClick: () => openEditPartDialog(part) },
      { label: 'Retire', icon: 'graveyard', onClick: () => openRetirePartDialog(part) },
    ],
  });
}

function openRenameSlot(machine, slot) {
  let input;
  formModal({
    title: 'Rename slot',
    submitLabel: 'Save',
    buildBody: () => {
      input = h('input', { type: 'text', value: slot.label });
      return field('Slot label', input, 'e.g. “DIMM A2”, “M.2 under heatsink”, “SATA port 3 (bottom)”.');
    },
    onSubmit: (close) => {
      const label = input.value.trim();
      run(M.renameSlot, machine.id, slot.id, label);
      close();
      toastUndo(`Renamed ${slot.label} to ${label}.`);
    },
  });
}

function openSetSlots(machine, section) {
  const inputs = {};
  formModal({
    title: `Set ${section.title.toLowerCase()} slots`,
    submitLabel: 'Save',
    buildBody: () => {
      const wrap = h('div', {});
      for (const type of section.types) {
        const current = (machine.slots || []).filter((s) => s.type === type).length;
        inputs[type] = h('input', { type: 'number', min: '0', max: '64', step: '1', value: String(current) });
        wrap.appendChild(field(SLOT_FIELD_LABELS[type], inputs[type]));
      }
      wrap.appendChild(h('p', { class: 'hint' }, 'Slots with a part in them are never removed, even if you lower the count below what’s occupied.'));
      return wrap;
    },
    onSubmit: (close) => {
      runBatch(() => {
        for (const type of section.types) {
          const raw = inputs[type].value.trim();
          run(M.setSlotCount, machine.id, type, raw === '' ? 0 : Number(raw));
        }
      });
      close();
      toastUndo(`Updated ${section.title.toLowerCase()} slots.`);
    },
  });
}

// "Install part here" on an empty slot: pick a compatible part from a box,
// or add a new one straight into the slot.
function openInstallHere(machine, slot) {
  const state = getState();
  const wantCategories = slot.type === 'dimm' ? ['ram']
    : (slot.type === 'm2' || slot.type === 'sata') ? ['storage']
      : slot.type === 'pcie-x16' ? ['gpu', 'expansion']
        : ['expansion'];

  const candidates = M.activeParts(state).filter((p) => p.location.kind === 'box'
    && wantCategories.includes(p.category) && M.compatibleSlotTypes(p).includes(slot.type));

  openModal((close) => {
    const wrap = h('div', {});
    wrap.appendChild(h('h2', {}, `Install into ${slot.label}`));
    wrap.appendChild(h('button', {
      class: 'btn btn-primary', type: 'button', style: 'margin-bottom:12px',
      onclick: () => {
        close();
        openAddPartDialog({
          into: { kind: 'machine', id: machine.id },
          installSlot: slot,
          defaultCategory: wantCategories[0],
          allowedCategories: wantCategories,
          lockCategory: wantCategories.length === 1,
        });
      },
    }, [icon('plus', { size: 14 }), 'Add a new part']));

    if (candidates.length === 0) {
      wrap.appendChild(h('p', { class: 'muted' }, 'No compatible parts in your boxes.'));
    } else {
      wrap.appendChild(h('p', { class: 'small muted' }, 'Or install one from a box:'));
      const list = h('div', { class: 'picker-list' });
      for (const p of candidates) {
        list.appendChild(h('button', {
          type: 'button', class: 'picker-item',
          onclick: () => {
            close();
            try {
              const result = run(M.installPartInSlot, p.id, machine.id, slot.id);
              toastUndo(result.splitRemainderId
                ? `Installed one ${p.label} in ${slot.label}; ${p.quantity - 1} stay in ${placeName(p.location)}.`
                : `Installed ${p.label} in ${slot.label}.`);
            } catch (e) {
              showToast(e.message, { warn: true });
            }
          },
        }, [
          catDot(p.category),
          h('span', { class: 'picker-item-text' }, [
            h('span', { class: 'picker-item-title' }, p.label),
            h('span', { class: 'picker-item-sub' }, `${placeName(p.location)}${p.quantity > 1 ? ` · ×${p.quantity}` : ''}`),
          ]),
        ]));
      }
      wrap.appendChild(list);
    }
    wrap.appendChild(h('div', { class: 'modal-actions' }, [h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel')]));
    return wrap;
  });
}

function openChangeSlot(part, machine) {
  const state = getState();
  const fits = M.compatibleSlotTypes(part);
  const slots = (machine.slots || []).filter((s) => fits.includes(s.type) && s.id !== part.location.slotId);

  openModal((close) => {
    const wrap = h('div', {});
    wrap.appendChild(h('h2', {}, `Change slot for ${part.label}`));
    if (slots.length === 0) {
      wrap.appendChild(h('p', { class: 'muted' }, 'No other compatible slots on this build. Use “Set slots” to add some.'));
    } else {
      const list = h('div', { class: 'picker-list' });
      for (const s of slots) {
        const occupant = M.partsInMachine(state, machine.id).find((p) => p.location.slotId === s.id);
        list.appendChild(h('button', {
          type: 'button', class: 'picker-item',
          onclick: () => {
            close();
            try {
              const result = run(M.changeSlot, part.id, s.id);
              toastUndo(result.swappedPartId ? `Swapped ${part.label} with ${occupant.label}.` : `Moved ${part.label} to ${s.label}.`);
            } catch (e) {
              showToast(e.message, { warn: true });
            }
          },
        }, [
          h('span', { class: 'picker-item-text' }, [
            h('span', { class: 'picker-item-title' }, s.label),
            h('span', { class: 'picker-item-sub' }, occupant ? `Has ${occupant.label} (will swap)` : 'Empty'),
          ]),
        ]));
      }
      wrap.appendChild(list);
    }
    wrap.appendChild(h('div', { class: 'modal-actions' }, [h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel')]));
    return wrap;
  });
}

// ---------------------------------------------------------------------------
// non-slot parts (CPU, motherboard, PSU, case, cooler, fan, other)
// ---------------------------------------------------------------------------

function renderOtherParts(machine, state, selected) {
  const parts = M.partsInMachine(state, machine.id).filter((p) => NON_SLOT_CATEGORIES.includes(p.category));
  const present = new Set(parts.map((p) => p.category));
  const notNeeded = machine.notNeeded || [];
  const suggested = OTHER_PARTS_ORDER.find((c) => !present.has(c) && !notNeeded.includes(c)) || 'other';

  const sectionEl = h('div', { class: 'section', 'data-section': 'other' });
  sectionEl.appendChild(h('div', { class: 'section-header static' }, [h('span', { class: 'section-title' }, 'Other parts')]));
  const body = h('div', { class: 'section-body' });
  body.appendChild(h('div', { class: 'section-actions' }, [
    h('button', {
      class: 'btn btn-sm', type: 'button',
      onclick: () => openAddPartDialog({ into: { kind: 'machine', id: machine.id }, defaultCategory: suggested, allowedCategories: NON_SLOT_CATEGORIES }),
    }, [icon('plus', { size: 14 }), 'Add part']),
  ]));
  if (parts.length === 0) body.appendChild(h('p', { class: 'section-note' }, 'Nothing here yet.'));
  for (const p of parts) {
    body.appendChild(partRow(p, state, {
      selectable: true,
      selected: selected.has(p.id),
      onToggleSelect: (id) => { toggleSelected(id); rerender(machine.id); },
      actions: [
        { label: 'Move to…', icon: 'box', onClick: () => openMoveDialog([p.id], { exclude: { kind: 'machine', id: machine.id } }) },
        { label: 'Edit', icon: 'edit', onClick: () => openEditPartDialog(p) },
        { label: 'Retire', icon: 'graveyard', onClick: () => openRetirePartDialog(p) },
      ],
    }));
  }
  sectionEl.appendChild(body);
  return sectionEl;
}

// ---------------------------------------------------------------------------
// bulk selection
// ---------------------------------------------------------------------------

function renderSelectionBar(machine, selected) {
  if (selected.size === 0) return h('div', {});
  return h('div', { class: 'selection-bar' }, [
    h('span', {}, `${selected.size} selected`),
    h('div', { class: 'card-row' }, [
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openMoveDialog([...selected], { exclude: { kind: 'machine', id: machine.id } }) }, 'Move to…'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { clearSelection(); rerender(machine.id); } }, 'Clear'),
    ]),
  ]);
}
