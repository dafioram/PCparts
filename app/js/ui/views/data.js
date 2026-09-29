// data.js — export / import / storage status.

import { h, icon, fmtDateTime } from '../dom.js';
import { getState, replaceAll, markExported } from '../store.js';
import * as IO from '../../io.js';
import { isPersisted, isStorageAvailable } from '../../storage.js';
import { showToast } from '../toast.js';

// Shared with the app-wide export reminder banner.
export function doExport() {
  IO.exportData(getState());
  markExported();
  showToast('Exported. Keep the file somewhere safe (not just this browser).');
}

export function render(container) {
  const state = getState();
  container.appendChild(h('div', { class: 'page-header' }, [h('h1', {}, 'Data')]));

  const counts = h('div', {}, [
    h('p', {}, `${state.machines.length} machine${state.machines.length === 1 ? '' : 's'}, ${state.parts.length} part${state.parts.length === 1 ? '' : 's'}, ${state.boxes.length} box${state.boxes.length === 1 ? '' : 'es'}.`),
    h('p', { class: 'muted' }, state.meta && state.meta.lastExportedAt
      ? `Last exported ${fmtDateTime(state.meta.lastExportedAt)}.`
      : 'Never exported yet.'),
  ]);

  container.appendChild(h('div', { class: 'two-col' }, [
    h('div', { class: 'stack' }, [
      h('div', { class: 'section' }, [
        h('div', { class: 'section-header', style: 'cursor:default' }, h('div', { class: 'section-title' }, 'Export')),
        h('div', { class: 'section-body' }, [
          h('p', { class: 'muted' }, 'Downloads everything — machines, parts, boxes and the graveyard — as one JSON file. This is your real backup: browser storage can be cleared.'),
          counts,
          h('button', { class: 'btn btn-primary', type: 'button', onclick: doExport }, [icon('data', { size: 16 }), 'Export JSON']),
        ]),
      ]),
      h('div', { class: 'section' }, [
        h('div', { class: 'section-header', style: 'cursor:default' }, h('div', { class: 'section-title' }, 'Import')),
        h('div', { class: 'section-body' }, buildImportBody()),
      ]),
    ]),
    h('div', { class: 'section' }, [
      h('div', { class: 'section-header', style: 'cursor:default' }, h('div', { class: 'section-title' }, 'Storage status')),
      h('div', { class: 'section-body' }, buildStorageStatus()),
    ]),
  ]));
}

function buildImportBody() {
  const wrap = h('div', {});
  wrap.appendChild(h('p', { class: 'form-warning' }, [
    icon('warning', { size: 14 }),
    ' Importing a file replaces ALL current data. A backup of what you have now is downloaded automatically first.',
  ]));
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json' });
  wrap.appendChild(fileInput);
  const status = h('div', { style: 'margin-top:10px' });
  wrap.appendChild(status);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    status.innerHTML = '';
    status.appendChild(h('p', { class: 'muted' }, 'Checking file…'));

    const result = await IO.prepareImport(file);
    status.innerHTML = '';

    if (!result.valid) {
      status.appendChild(h('div', { class: 'form-error' }, [
        h('strong', {}, 'This file could not be imported:'),
        h('ul', {}, result.errors.slice(0, 8).map((e) => h('li', {}, e))),
      ]));
      fileInput.value = '';
      return;
    }

    const current = getState();
    const incoming = result.migrated;
    status.appendChild(h('div', { class: 'form-warning' }, [
      h('p', { class: 'mt-0' }, [
        `This will replace all current data (${current.machines.length} machines, ${current.parts.length} parts, ${current.boxes.length} boxes) `,
        `with the file's data (${incoming.machines.length} machines, ${incoming.parts.length} parts, ${incoming.boxes.length} boxes). `,
        h('strong', {}, 'This cannot be undone.'),
      ]),
      h('button', {
        type: 'button', class: 'btn btn-danger', style: 'margin-top:8px',
        onclick: () => {
          const hasCurrentData = current.machines.length || current.parts.length || current.boxes.length > 1;
          if (hasCurrentData) IO.downloadBackup(current);
          replaceAll(incoming);
          showToast('Import complete. All data was replaced.' + (hasCurrentData ? ' A backup of your previous data was downloaded.' : ''));
          fileInput.value = '';
          status.innerHTML = '';
        },
      }, 'Replace all data'),
      h('button', { type: 'button', class: 'btn', style: 'margin-top:8px;margin-left:8px', onclick: () => { fileInput.value = ''; status.innerHTML = ''; } }, 'Cancel'),
    ]));
  });

  return wrap;
}

function buildStorageStatus() {
  const wrap = h('div', {});
  const available = isStorageAvailable();
  wrap.appendChild(h('p', {}, [
    h('strong', {}, 'Saved in this browser: '),
    available ? 'Yes' : 'No — export before closing this tab.',
  ]));
  const persistLine = h('p', {}, [h('strong', {}, 'Protected from automatic cleanup: '), 'Checking…']);
  wrap.appendChild(persistLine);
  isPersisted().then((persisted) => {
    persistLine.lastChild.textContent = persisted == null ? 'Unknown (your browser doesn’t report this).' : (persisted ? 'Yes.' : 'Not guaranteed — export regularly.');
  });
  wrap.appendChild(h('p', { class: 'muted' }, 'This app never sends your data anywhere. Everything lives only in this browser until you export it.'));
  return wrap;
}
