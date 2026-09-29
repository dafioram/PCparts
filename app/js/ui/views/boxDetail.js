// boxDetail.js — a single box: its parts, bulk move, rename/delete.

import { h, icon } from '../dom.js';
import * as M from '../../model.js';
import { getState, run, toastUndo } from '../store.js';
import { navigate } from '../nav.js';
import { partRow, emptyState, tagChips } from '../components.js';
import { formModal, confirmDialog } from '../modal.js';
import { tagInput, field } from '../forms.js';
import {
  openMoveDialog, openAddPartDialog, openEditPartDialog, openRetirePartDialog, openSplitDialog,
} from '../actions.js';
import { useSelection, toggleSelected, clearSelection } from '../selection.js';

export function render(container, boxId) {
  const state = getState();
  const box = M.getBox(state, boxId);
  if (!box) {
    container.appendChild(emptyState('box', 'That box no longer exists.'));
    return;
  }
  const parts = M.partsInBox(state, boxId);
  const selected = useSelection(`box:${boxId}`, parts.map((p) => p.id));

  container.appendChild(h('div', { class: 'detail-header' }, [
    h('div', { class: 'card-icon' }, icon('box')),
    h('div', { class: 'card-titles' }, [
      h('h1', { class: 'card-title' }, box.name),
      h('div', { class: 'card-subtitle' }, `${parts.length} part${parts.length === 1 ? '' : 's'}`),
      box.notes ? h('p', { class: 'notes', style: 'margin-top:8px' }, box.notes) : null,
      tagChips(box.tags),
    ]),
    h('div', { class: 'detail-actions' }, [
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openAddPartDialog({ into: { kind: 'box', id: box.id } }) }, [icon('plus', { size: 14 }), 'Add part']),
      !box.isDefault ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openEditBox(box) }, [icon('edit', { size: 14 }), 'Edit']) : null,
      !box.isDefault ? h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => confirmDeleteBox(box, parts.length) }, [icon('trash', { size: 14 }), 'Delete']) : null,
    ]),
  ]));

  if (parts.length === 0) {
    container.appendChild(emptyState('box', `No parts in ${box.name} yet — move some here.`));
    return;
  }

  const here = { kind: 'box', id: box.id };
  container.appendChild(h('div', { class: 'section' }, [h('div', { class: 'section-body', style: 'padding-top:10px' },
    parts.map((p) => partRow(p, state, {
      selectable: true,
      selected: selected.has(p.id),
      onToggleSelect: (id) => { toggleSelected(id); rerender(boxId); },
      actions: [
        { label: 'Move to…', icon: 'move', onClick: () => openMoveDialog([p.id], { exclude: here }) },
        ...(p.quantity > 1 ? [{ label: 'Split', icon: 'box', onClick: () => openSplitDialog(p) }] : []),
        { label: 'Edit', icon: 'edit', onClick: () => openEditPartDialog(p) },
        { label: 'Retire', icon: 'graveyard', onClick: () => openRetirePartDialog(p) },
      ],
    }))),
  ]));

  if (selected.size > 0) {
    container.appendChild(h('div', { class: 'selection-bar' }, [
      h('span', {}, `${selected.size} selected`),
      h('div', { class: 'card-row' }, [
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openMoveDialog([...selected], { exclude: here }) }, 'Move to…'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { clearSelection(); rerender(boxId); } }, 'Clear'),
      ]),
    ]));
  }
}

function rerender(boxId) {
  const container = document.getElementById('view');
  container.innerHTML = '';
  render(container, boxId);
}

function openEditBox(box) {
  let nameInput, notesInput, tags;
  formModal({
    title: 'Edit box',
    buildBody: () => {
      nameInput = h('input', { type: 'text', value: box.name });
      notesInput = h('textarea', {}, box.notes || '');
      tags = tagInput(box.tags || []);
      return h('div', {}, [field('Name', nameInput), field('Notes (optional)', notesInput), field('Tags', tags.el)]);
    },
    onSubmit: (close) => {
      run(M.updateBox, box.id, { name: nameInput.value, notes: notesInput.value.trim(), tags: tags.getTags() });
      close();
      toastUndo('Saved changes.');
    },
  });
}

function confirmDeleteBox(box, count) {
  confirmDialog({
    title: `Delete ${box.name}?`,
    body: count > 0 ? `Its ${count} part${count === 1 ? '' : 's'} will move to Unused first.` : 'This box is empty.',
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => {
      run(M.deleteBox, box.id);
      navigate('#/boxes');
      toastUndo(count > 0 ? `Deleted ${box.name}; its parts moved to Unused.` : `Deleted ${box.name}.`);
    },
  });
}
