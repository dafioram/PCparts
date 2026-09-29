// main.js — bootstrap, hash router, and wiring for nav, search, banners,
// undo and syncing with other tabs.

import * as Store from './ui/store.js';
import * as Storage from './storage.js';
import * as IO from './io.js';
import { showToast } from './ui/toast.js';
import { closeModal, isModalOpen, confirmDialog } from './ui/modal.js';
import { h, icon, fmtDate } from './ui/dom.js';
import { getPref, setPref } from './ui/prefs.js';
import { setNavigator, navigate } from './ui/nav.js';

import * as MachinesView from './ui/views/machines.js';
import * as MachineDetailView from './ui/views/machineDetail.js';
import * as BoxesView from './ui/views/boxes.js';
import * as BoxDetailView from './ui/views/boxDetail.js';
import * as PartsView from './ui/views/parts.js';
import * as PartDetailView from './ui/views/partDetail.js';
import * as GraveyardView from './ui/views/graveyard.js';
import * as DataView from './ui/views/data.js';
import * as SearchView from './ui/views/search.js';

const viewEl = document.getElementById('view');
const bannersEl = document.getElementById('banners');
const searchInput = document.getElementById('global-search');
const undoBtn = document.getElementById('undo-btn');

const routes = [
  { pattern: /^machines$/, render: (c) => MachinesView.render(c) },
  { pattern: /^machines\/([^/]+)$/, render: (c, m) => MachineDetailView.render(c, m[1]) },
  { pattern: /^boxes$/, render: (c) => BoxesView.render(c) },
  { pattern: /^boxes\/([^/]+)$/, render: (c, m) => BoxDetailView.render(c, m[1]) },
  { pattern: /^parts$/, render: (c) => PartsView.render(c) },
  { pattern: /^parts\/([^/]+)$/, render: (c, m) => PartDetailView.render(c, m[1]) },
  { pattern: /^graveyard$/, render: (c) => GraveyardView.render(c) },
  { pattern: /^data$/, render: (c) => DataView.render(c) },
  { pattern: /^search$/, render: (c, m, params) => SearchView.render(c, params.get('q') || '') },
];

// "#/search?q=rtx" -> { path: 'search', params }
function parseHash() {
  const raw = (location.hash || '#/machines').replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  return { path: path || 'machines', params: new URLSearchParams(query) };
}

// The address the screen currently shows. A navigation event for the page
// that's already on screen (e.g. one delivered late, after startup already
// drew that page) must not re-render it or close an open dialog.
let renderedHash = null;

// Re-renders the current page. Focus only moves (to the page, for screen
// readers) on navigation — never on a re-render after a change, and never
// while someone is typing in the search box.
function renderRoute({ navigated = false } = {}) {
  renderedHash = location.hash;
  const { path, params } = parseHash();
  viewEl.innerHTML = '';
  const route = routes.find((r) => r.pattern.test(path));
  if (route) route.render(viewEl, path.match(route.pattern), params);
  else MachinesView.render(viewEl);
  updateNavHighlight(route ? path : 'machines');
  renderBanners();
  updateUndoButton();
  if (navigated && document.activeElement !== searchInput) {
    window.scrollTo(0, 0);
    viewEl.focus({ preventScroll: true });
  }
}

function updateNavHighlight(path) {
  const top = path.split('/')[0];
  document.querySelectorAll('[data-route]').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === top);
    if (a.dataset.route === top) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function onRouteChange() {
  if (!Store.getState()) return; // still starting up; bootstrap draws the current page
  if (location.hash === renderedHash) return;
  closeModal();
  const { path, params } = parseHash();
  if (path === 'search' && document.activeElement !== searchInput) searchInput.value = params.get('q') || '';
  renderRoute({ navigated: true });
}

// Links, Back/Forward and typed URLs arrive as (asynchronous) hashchange
// events. The app's own navigation after an action goes through navigate()
// (ui/nav.js), which updates the URL and draws the new page in the same step
// — pushState doesn't fire hashchange, so nothing renders twice.
window.addEventListener('hashchange', onRouteChange);
setNavigator((hash) => {
  if (location.hash === hash) {
    renderRoute();
    return;
  }
  history.pushState(null, '', hash);
  onRouteChange();
});

// ---------------------------------------------------------------------------
// search box in the header — the query lives in the URL (#/search?q=…)
// ---------------------------------------------------------------------------

let searchDebounce = null;

function showSearch(query) {
  const q = query.trim();
  const target = q ? `#/search?q=${encodeURIComponent(q)}` : '#/search';
  if (parseHash().path === 'search') {
    // Update in place: no history entry per keystroke, focus stays put.
    history.replaceState(null, '', target);
    renderRoute();
  } else if (q) {
    navigate(target);
  }
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => showSearch(searchInput.value), 200);
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(searchDebounce);
    showSearch(searchInput.value);
  } else if (e.key === 'Escape' && searchInput.value) {
    e.preventDefault();
    clearTimeout(searchDebounce);
    searchInput.value = '';
    showSearch('');
  }
});

// ---------------------------------------------------------------------------
// undo button (top bar) and keyboard shortcuts
// ---------------------------------------------------------------------------

function updateUndoButton() {
  const label = Store.peekUndoLabel();
  undoBtn.hidden = !label;
  if (label) undoBtn.title = `Undo: ${label}`;
}

function doUndo() {
  const label = Store.undo();
  if (label) showToast(`Undone: ${label}`);
}

undoBtn.addEventListener('click', doUndo);
undoBtn.addEventListener('pointerenter', updateUndoButton);
undoBtn.addEventListener('focus', updateUndoButton);

document.addEventListener('keydown', (e) => {
  const typing = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]');
  if (typing || isModalOpen()) return;
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    doUndo();
  } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});

// ---------------------------------------------------------------------------
// banners: storage off, unreadable saved data, export reminder (SPEC §10)
// ---------------------------------------------------------------------------

const SNOOZE_DAYS = 7;

function banner(kind, text, buttons) {
  return h('div', { class: `banner banner-${kind}`, role: kind === 'danger' ? 'alert' : 'status' }, [
    h('span', { class: 'banner-text' }, [icon('warning', { size: 15 }), h('span', {}, text)]),
    h('span', { class: 'banner-actions' }, buttons),
  ]);
}

function renderBanners() {
  bannersEl.innerHTML = '';
  const info = Store.getLoadInfo();

  if (!info.storageAvailable) {
    bannersEl.appendChild(banner('danger', 'Data will not be saved — this browser is blocking storage (e.g. a private window). Export before closing this tab.', [
      h('button', { type: 'button', onclick: DataView.doExport }, 'Export now'),
    ]));
  }

  const copies = Storage.getUnreadableCopies();
  if (copies.length) {
    const newest = copies[0];
    const blocked = Storage.isSaveBlocked();
    bannersEl.appendChild(banner('danger', `Saved data from ${fmtDate(newest.savedAt)} couldn’t be loaded (${newest.reason}) A copy was kept so nothing is lost.${blocked ? ' Changes aren’t being saved until you download or delete it.' : ''}`, [
      h('button', { type: 'button', onclick: () => IO.downloadText(newest.raw, IO.unreadableFilename(newest.savedAt)) }, 'Download copy'),
      h('button', {
        type: 'button',
        onclick: () => confirmDialog({
          title: 'Delete the kept copy?',
          body: 'Only do this once you’ve downloaded it or know you don’t need it.',
          confirmLabel: 'Delete copy',
          danger: true,
          onConfirm: () => { Storage.discardUnreadableCopies(); renderBanners(); },
        }),
      }, 'Delete copy'),
    ]));
  }

  const snoozedUntil = getPref('exportNudgeSnoozedUntil', 0);
  if (info.storageAvailable && Store.needsExportNudge() && Date.now() > snoozedUntil) {
    const exportedAt = Store.getState().meta && Store.getState().meta.lastExportedAt;
    bannersEl.appendChild(banner('warn', exportedAt
      ? `Your last backup was ${fmtDate(exportedAt)} and there are changes since. Browsers can clear site data — export a backup.`
      : 'You haven’t exported a backup yet. Your inventory lives only in this browser, which can clear site data — export a backup.', [
      h('button', { type: 'button', onclick: DataView.doExport }, 'Export now'),
      h('button', { type: 'button', onclick: () => { setPref('exportNudgeSnoozedUntil', Date.now() + SNOOZE_DAYS * 86400000); renderBanners(); } }, 'Remind me later'),
    ]));
  }
}

// ---------------------------------------------------------------------------
// other tabs: adopt their saves so tabs never overwrite each other
// ---------------------------------------------------------------------------

window.addEventListener('storage', (e) => {
  if (e.key === Storage.STORAGE_KEY) {
    const next = Storage.readCurrent();
    if (next) {
      Store.adoptExternalState(next);
      showToast('Updated with changes made in another tab.');
    }
  } else if (e.key === Storage.UNREADABLE_KEY) {
    renderBanners();
  }
});

// ---------------------------------------------------------------------------
// icon sprite
// ---------------------------------------------------------------------------

async function loadIcons() {
  try {
    const res = await fetch('icons.svg');
    document.getElementById('icon-sprite-mount').innerHTML = await res.text();
  } catch {
    // If icons can't load (e.g. opened via file://), the app still works —
    // buttons just show text without glyphs.
  }
}

// ---------------------------------------------------------------------------
// bootstrap
// ---------------------------------------------------------------------------

async function bootstrap() {
  await loadIcons();
  const info = Store.init();
  if (info.errors && info.errors.length) showToast(info.errors[0], { warn: true, duration: 10000 });
  if (info.storageAvailable) Storage.requestPersistence();

  const { path, params } = parseHash();
  if (path === 'search') searchInput.value = params.get('q') || '';

  Store.subscribe(() => renderRoute());
  renderRoute();
}

bootstrap();
