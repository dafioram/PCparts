// modal.js — a single generic modal host, plus confirm() and form helpers.

import { h, clear } from './dom.js';

const root = () => document.getElementById('modal-root');

let keyHandler = null;
let returnFocusTo = null;

export function closeModal() {
  if (keyHandler) {
    document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
  }
  const hadModal = root().childElementCount > 0;
  clear(root());
  if (hadModal && returnFocusTo && returnFocusTo.isConnected) returnFocusTo.focus({ preventScroll: true });
  returnFocusTo = null;
}

export function isModalOpen() {
  return root().childElementCount > 0;
}

// buildContent(closeFn) should return a DOM node for the modal body. Escape
// closes the modal for as long as it is open (not just on the first key).
export function openModal(buildContent, opts = {}) {
  if (!isModalOpen()) returnFocusTo = document.activeElement;
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  clear(root());

  const backdrop = h('div', {
    class: 'modal-backdrop',
    onclick: (e) => { if (e.target === backdrop && !opts.persistent) closeModal(); },
  });
  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
  backdrop.appendChild(modal);
  root().appendChild(backdrop);
  modal.appendChild(buildContent(closeModal));

  const title = modal.querySelector('h2');
  if (title) {
    title.id = 'modal-title';
    modal.setAttribute('aria-labelledby', 'modal-title');
  }
  const firstInput = modal.querySelector('input:not([type="checkbox"]), select, textarea') || modal.querySelector('button');
  if (firstInput) firstInput.focus();

  keyHandler = (e) => {
    if (e.key === 'Escape' && !opts.persistent) {
      e.preventDefault();
      closeModal();
    }
  };
  document.addEventListener('keydown', keyHandler);
}

export function confirmDialog({ title, body, confirmLabel = 'Confirm', danger = false, onConfirm }) {
  openModal((close) => h('div', {}, [
    h('h2', {}, title),
    typeof body === 'string' ? h('p', { class: 'muted' }, body) : body,
    h('div', { class: 'modal-actions' }, [
      h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'),
      h('button', {
        class: danger ? 'btn btn-danger' : 'btn btn-primary',
        type: 'button',
        onclick: () => { close(); onConfirm(); },
      }, confirmLabel),
    ]),
  ]));
}

// A form in a modal. onSubmit(close) may throw: the message is shown in the
// form and the modal stays open. `secondary` adds a left-aligned extra
// action, e.g. { label: 'Delete part…', danger: true, onClick }.
export function formModal({ title, buildBody, onSubmit, submitLabel = 'Save', secondary = null }) {
  openModal((close) => {
    const errorBox = h('div', { class: 'form-error', role: 'alert', style: 'display:none' });
    const form = h('form', { class: 'modal-form', novalidate: 'novalidate' });
    form.appendChild(buildBody(form));
    form.appendChild(h('div', { class: 'modal-actions' }, [
      secondary ? h('button', {
        type: 'button',
        class: 'btn' + (secondary.danger ? ' btn-danger' : '') + ' modal-secondary',
        onclick: () => secondary.onClick(close),
      }, secondary.label) : null,
      h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, submitLabel),
    ]));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      errorBox.style.display = 'none';
      try {
        onSubmit(close);
      } catch (err) {
        errorBox.textContent = err.message || String(err);
        errorBox.style.display = '';
      }
    });
    return h('div', {}, [h('h2', {}, title), errorBox, form]);
  });
}
