// boxes.js — the Boxes list view.

import { h, icon } from '../dom.js';
import * as M from '../../model.js';
import { getState, run, toastUndo } from '../store.js';
import { navigate } from '../nav.js';
import { categoryIconRow, emptyState, tagChips } from '../components.js';
import { formModal } from '../modal.js';
import { tagInput, field } from '../forms.js';

export function render(container) {
  const state = getState();
  container.appendChild(h('div', { class: 'page-header' }, [
    h('h1', {}, 'Boxes'),
    h('div', { class: 'page-actions' }, [
      h('button', { class: 'btn btn-primary', type: 'button', onclick: openAddBox }, [icon('plus', { size: 16 }), 'Add box']),
    ]),
  ]));

  const boxes = [...state.boxes].sort((a, b) => (a.isDefault ? -1 : b.isDefault ? 1 : a.name.localeCompare(b.name)));
  if (boxes.length === 1) {
    container.appendChild(h('p', { class: 'muted' }, 'Parts that aren’t in a build live in Unused. Add boxes for the real places you keep things, like “Shelf B3” or “Box 768”.'));
  }
  container.appendChild(h('div', { class: 'card-grid' }, boxes.map((box) => boxCard(box, state))));
  if (boxes.length === 0) container.appendChild(emptyState('box', 'No boxes.'));
}

function boxCard(box, state) {
  const parts = M.partsInBox(state, box.id);
  return h('a', { class: 'card', href: `#/boxes/${box.id}` }, [
    h('div', { class: 'card-top' }, [
      h('div', { class: 'card-icon' }, icon('box')),
      h('div', { class: 'card-titles' }, [
        h('div', { class: 'card-title' }, box.name),
        h('div', { class: 'card-subtitle' }, `${parts.length} part${parts.length === 1 ? '' : 's'}`),
      ]),
    ]),
    box.notes ? h('div', { class: 'card-purpose' }, box.notes) : null,
    tagChips(box.tags),
    categoryIconRow(parts),
  ]);
}

function openAddBox() {
  let nameInput, notesInput, tags;
  formModal({
    title: 'Add box',
    submitLabel: 'Add',
    buildBody: () => {
      nameInput = h('input', { type: 'text', placeholder: 'e.g. Box 768' });
      notesInput = h('textarea', { placeholder: 'Where it is, what’s in it, etc.' });
      tags = tagInput([]);
      return h('div', {}, [field('Name', nameInput), field('Notes (optional)', notesInput), field('Tags', tags.el)]);
    },
    onSubmit: (close) => {
      const result = run(M.addBox, { name: nameInput.value, notes: notesInput.value.trim(), tags: tags.getTags() });
      close();
      navigate(`#/boxes/${result.id}`);
      toastUndo(`Added ${nameInput.value.trim()}.`);
    },
  });
}
