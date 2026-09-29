// actions.js — part actions shared by every page (machine detail, box
// detail, all parts, part detail), so each behaves — and can be undone —
// the same way everywhere.

import { h } from './dom.js';
import * as M from '../model.js';
import { getState, run, runBatch, toastUndo } from './store.js';
import { openModal, formModal, confirmDialog } from './modal.js';
import {
  buildPartFormBody, buildMovePicker, buildRetireFormBody, partEditRules, askStorageSlotType, field,
} from './forms.js';
import { showToast } from './toast.js';
import { clearSelection } from './selection.js';

export function placeName(dest) {
  const state = getState();
  if (dest.kind === 'box') return M.getBox(state, dest.id)?.name || 'the box';
  const machine = M.getMachine(state, dest.id);
  return machine ? M.displayName(machine, state.parts).title : 'the build';
}

// ---------------------------------------------------------------------------
// moving
// ---------------------------------------------------------------------------

// Moves one or more parts as a single undoable step. If a drive with no kind
// is headed into a build, asks "M.2 or SATA?" first. If any part can't move,
// nothing moves.
export function moveParts(partIds, dest, { storageSlotType } = {}) {
  const state = getState();
  const parts = partIds.map((id) => M.getPart(state, id)).filter(Boolean);
  if (dest.kind === 'machine' && !storageSlotType) {
    const needChoice = parts.filter((p) => M.needsStorageSlotChoice(p) && !M.isAlreadyAt(p, dest));
    if (needChoice.length) {
      askStorageSlotType(needChoice, (choice) => moveParts(partIds, dest, { storageSlotType: choice }));
      return;
    }
  }

  const results = [];
  try {
    runBatch(() => {
      for (const p of parts) results.push({ part: p, result: run(M.movePart, p.id, dest, { storageSlotType }) });
    });
  } catch (e) {
    showToast(parts.length > 1 ? `${e.message} Nothing was moved.` : e.message, { warn: true, duration: 8000 });
    return;
  }
  clearSelection();

  const name = placeName(dest);
  const moved = results.filter((r) => !r.result.alreadyThere);
  if (moved.length === 0) {
    showToast(parts.length === 1 ? `${parts[0].label} is already in ${name}.` : `Those parts are already in ${name}.`);
    return;
  }
  let msg;
  if (moved.length === 1) {
    const { part, result } = moved[0];
    msg = result.split
      ? `Split ${result.count} × ${part.label} into single parts and installed them in ${name}.`
      : `Moved ${part.label} to ${name}.`;
  } else {
    msg = `Moved ${moved.length} parts to ${name}.`;
  }
  const overflow = moved.flatMap(({ result }) => (result.overflowMessage ? [result.overflowMessage] : result.overflowMessages || []));
  if (overflow.length) msg += ` ${overflow[overflow.length - 1]}`;
  toastUndo(msg);
}

// The Move to… dialog. `exclude` hides the place the parts already are.
export function openMoveDialog(partIds, { exclude = null } = {}) {
  const state = getState();
  const first = M.getPart(state, partIds[0]);
  const heading = partIds.length === 1 ? `Move ${first.label}` : `Move ${partIds.length} parts`;
  openModal((close) => h('div', {}, [
    h('h2', {}, heading),
    buildMovePicker({ exclude, onPick: (dest) => { close(); moveParts(partIds, dest); } }),
  ]));
}

// Where a single part is, as a picker exclusion.
export function currentPlace(part) {
  return part.location ? { kind: part.location.kind, id: part.location.id } : null;
}

// ---------------------------------------------------------------------------
// adding
// ---------------------------------------------------------------------------

// into: { kind: 'box' | 'machine', id }. installSlot: a specific empty slot
// (the "Install part here" → "Add a new part" path).
export function openAddPartDialog({ into, defaultCategory = 'other', allowedCategories, lockCategory, installSlot = null }) {
  let form;
  const intoBuild = into.kind === 'machine';
  formModal({
    title: installSlot ? `Add a part to ${installSlot.label}` : 'Add part',
    submitLabel: 'Add',
    buildBody: () => {
      form = buildPartFormBody({ defaultCategory, allowedCategories, lockCategory, askSlotType: intoBuild && !installSlot });
      return form.el;
    },
    onSubmit: (close) => {
      const { storageSlotType, ...values } = form.getValues();
      if (!values.label) throw new Error('Give the part a label, e.g. “16GB DDR4”.');
      let msg;
      if (installSlot) {
        const result = runBatch(() => {
          const added = run(M.addPart, values, { kind: 'box', id: M.UNUSED_BOX_ID });
          return run(M.installPartInSlot, added.id, into.id, installSlot.id);
        });
        msg = result.splitRemainderId
          ? `Added ${values.label} to ${installSlot.label}; the other ${values.quantity - 1} went to Unused.`
          : `Added ${values.label} to ${installSlot.label}.`;
      } else if (intoBuild) {
        if (M.needsStorageSlotChoice(values) && !storageSlotType) {
          throw new Error('Choose which slot this drive goes in (M.2 or SATA), or set its kind.');
        }
        const result = run(M.addPart, values, into, { storageSlotType });
        msg = result.split ? `Added ${values.quantity} × ${values.label}, one per slot.` : `Added ${values.label}.`;
        const overflow = result.overflowMessage || (result.overflowMessages || []).at(-1);
        if (overflow) msg += ` ${overflow}`;
      } else {
        run(M.addPart, values, into);
        msg = `Added ${values.label} to ${placeName(into)}.`;
      }
      close();
      toastUndo(msg);
    },
  });
}

// ---------------------------------------------------------------------------
// editing / deleting
// ---------------------------------------------------------------------------

export function openEditPartDialog(part, { onDeleted } = {}) {
  let form;
  const rules = partEditRules(part);
  formModal({
    title: 'Edit part',
    buildBody: () => { form = buildPartFormBody({ part, ...rules }); return form.el; },
    secondary: { label: 'Delete…', danger: true, onClick: (close) => { close(); confirmDeletePart(part, { onDeleted }); } },
    onSubmit: (close) => {
      const { storageSlotType: _unused, ...values } = form.getValues();
      if (rules.lockCategory) delete values.category;
      if (part.location && part.location.slotId) delete values.quantity; // one part per slot
      run(M.updatePart, part.id, values);
      close();
      toastUndo(`Updated ${values.label || part.label}.`);
    },
  });
}

export function confirmDeletePart(part, { onDeleted } = {}) {
  confirmDialog({
    title: `Delete ${part.label}?`,
    body: 'This removes the record entirely — use it for entries made by mistake. If the part left your hands (sold, died, given away), retire it instead so it stays in the graveyard.',
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => {
      run(M.deletePart, part.id);
      toastUndo(`Deleted ${part.label}.`);
      if (onDeleted) onDeleted();
    },
  });
}

// ---------------------------------------------------------------------------
// splitting / retiring / restoring
// ---------------------------------------------------------------------------

export function openSplitDialog(part) {
  if (part.quantity <= 1) { showToast('This part has a quantity of 1 — nothing to split.', { warn: true }); return; }
  let input;
  formModal({
    title: `Split ${part.label}`,
    submitLabel: 'Split',
    buildBody: () => {
      input = h('input', { type: 'number', min: '1', max: String(part.quantity - 1), value: '1' });
      return field(`How many to split off? (currently ×${part.quantity})`, input);
    },
    onSubmit: (close) => {
      const n = Number(input.value);
      run(M.splitPart, part.id, n);
      close();
      toastUndo(`Split ${n} off ${part.label} into a new part.`);
    },
  });
}

export function openRetirePartDialog(part) {
  let form;
  formModal({
    title: `Retire ${part.label}`,
    submitLabel: 'Retire',
    buildBody: () => { form = buildRetireFormBody(); return form.el; },
    onSubmit: (close) => {
      run(M.retirePart, part.id, form.getValues());
      close();
      toastUndo(`Retired ${part.label}.`);
    },
  });
}

export function openRestorePartDialog(part) {
  openModal((close) => h('div', {}, [
    h('h2', {}, `Restore ${part.label}`),
    buildMovePicker({
      boxesOnly: true,
      onPick: (dest) => {
        close();
        run(M.restorePart, part.id, dest.id);
        toastUndo(`Restored ${part.label} to ${placeName(dest)}.`);
      },
    }),
  ]));
}

export function restoreDevice(machine) {
  run(M.restoreDevice, machine.id);
  toastUndo(`Restored ${M.displayName(machine, []).title}.`);
}
