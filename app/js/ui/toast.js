// toast.js — small stacked toast notifications, each with an optional Undo
// button. Only the newest action can be undone from a toast: the store calls
// stripUndoButtons() whenever the undo stack changes, so an older toast can
// never undo a newer action.

import { h } from './dom.js';

function toastRoot() {
  return typeof document === 'undefined' ? null : document.getElementById('toast-root');
}

export function showToast(message, opts = {}) {
  const root = toastRoot();
  if (!root) return;
  const toast = h('div', { class: 'toast' + (opts.warn ? ' toast-warn' : ''), role: opts.warn ? 'alert' : 'status' }, [
    h('span', {}, message),
    opts.onUndo ? h('button', {
      type: 'button',
      class: 'toast-undo',
      onclick: () => { toast.remove(); opts.onUndo(); },
    }, 'Undo') : null,
  ]);
  root.appendChild(toast);
  // Keep at most a few toasts on screen.
  while (root.children.length > 4) root.firstElementChild.remove();
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, opts.duration || 6500);
}

export function stripUndoButtons() {
  const root = toastRoot();
  if (!root) return;
  for (const btn of root.querySelectorAll('.toast-undo')) btn.remove();
}
