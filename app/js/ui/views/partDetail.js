// partDetail.js — single part: fields plus its move/retire history timeline.

import { h, icon, fmtDateTime, fmtDate } from '../dom.js';
import * as M from '../../model.js';
import { getState } from '../store.js';
import { navigate } from '../nav.js';
import { catDot, tagChips, locationLabel, emptyState, linkLine } from '../components.js';
import { CATEGORY_LABELS, RETIRE_REASON_LABELS } from '../forms.js';
import {
  openMoveDialog, openEditPartDialog, openRetirePartDialog, openRestorePartDialog, openSplitDialog,
  confirmDeletePart, currentPlace,
} from '../actions.js';

export function render(container, partId) {
  const state = getState();
  const part = M.getPart(state, partId);
  if (!part) {
    container.appendChild(emptyState('parts', 'That part no longer exists.'));
    return;
  }

  const detailBits = [];
  for (const [k, v] of Object.entries(part.details || {})) if (v) detailBits.push(`${k}: ${v}`);
  const status = M.derivePartStatus(part);

  container.appendChild(h('div', { class: 'detail-header' }, [
    h('div', { class: 'card-icon' }, catDot(part.category)),
    h('div', { class: 'card-titles' }, [
      h('h1', { class: 'card-title' }, part.label + (part.quantity > 1 ? ` ×${part.quantity}` : '')),
      h('div', { class: 'card-subtitle' }, CATEGORY_LABELS[part.category]),
      h('div', { class: 'card-row', style: 'margin-top:8px' }, [
        h('span', { class: `chip${status === 'in-use' ? ' status-active' : status === 'removed' ? ' status-retired' : ''}` },
          status === 'in-use' ? 'In use' : status === 'removed' ? 'Retired' : 'Unused'),
        part.retired ? null : h('span', { class: 'chip' }, locationLabel(part, state) || '—'),
      ]),
      part.brand || part.model ? h('div', { class: 'detail-meta' }, [part.brand, part.model].filter(Boolean).join(' ')) : null,
      part.serial ? h('div', { class: 'detail-meta' }, `Serial: ${part.serial}`) : null,
      detailBits.length ? h('div', { class: 'detail-meta' }, detailBits.join(' · ')) : null,
      linkLine(part.link),
      part.notes ? h('p', { class: 'notes', style: 'margin-top:8px' }, part.notes) : null,
      tagChips(part.tags),
      part.retired ? h('p', { class: 'muted', style: 'margin-top:8px' }, retiredLine(part.retired)) : null,
    ]),
    h('div', { class: 'detail-actions' }, buildActions(part)),
  ]));

  container.appendChild(h('div', { class: 'section' }, [
    h('div', { class: 'section-header static' }, h('h2', { class: 'section-title' }, 'History')),
    h('div', { class: 'section-body' }, renderTimeline(part)),
  ]));
}

function retiredLine(r) {
  const bits = [`${RETIRE_REASON_LABELS[r.reason] || r.reason}`];
  if (r.date) bits.push(fmtDate(r.date));
  if (r.price) bits.push(`$${r.price}`);
  return bits.join(' · ') + (r.notes ? ` — ${r.notes}` : '');
}

function buildActions(part) {
  const afterDelete = () => navigate('#/parts');
  if (part.retired) {
    return [
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openRestorePartDialog(part) }, 'Restore'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => confirmDeletePart(part, { onDeleted: afterDelete }) }, [icon('trash', { size: 14 }), 'Delete']),
    ];
  }
  return [
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openEditPartDialog(part, { onDeleted: afterDelete }) }, [icon('edit', { size: 14 }), 'Edit']),
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openMoveDialog([part.id], { exclude: currentPlace(part) }) }, [icon('move', { size: 14 }), 'Move to…']),
    part.quantity > 1 && !part.location.slotId ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openSplitDialog(part) }, 'Split') : null,
    h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => openRetirePartDialog(part) }, 'Retire'),
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => confirmDeletePart(part, { onDeleted: afterDelete }) }, [icon('trash', { size: 14 }), 'Delete']),
  ].filter(Boolean);
}

function renderTimeline(part) {
  if (!part.history || part.history.length === 0) return h('p', { class: 'muted' }, 'No history yet.');
  const items = [...part.history].reverse().map((entry) => h('div', { class: 'timeline-item' }, [
    h('div', { class: 'timeline-dot' }),
    h('div', { class: 'timeline-body' }, [
      h('div', {}, [h('strong', {}, fmtDateTime(entry.at)), ` — ${describeEntry(entry)}`]),
    ]),
  ]));
  return h('div', { class: 'timeline' }, items);
}

function describeEntry(entry) {
  switch (entry.action) {
    case 'created': return `Added${entry.to ? ` to ${entry.to.name}` : ''}.`;
    case 'moved': return `Moved${entry.from ? ` from ${entry.from.name}` : ''}${entry.to ? ` to ${entry.to.name}` : ''}.`;
    case 'retired': return `Retired (${RETIRE_REASON_LABELS[entry.reason] || entry.reason})${entry.from ? ` from ${entry.from.name}` : ''}.`;
    case 'restored': return `Restored${entry.to ? ` to ${entry.to.name}` : ''}.`;
    case 'split': return entry.into ? `Split ${entry.quantity} off into a new part.` : `Split off from another part${entry.to ? ` in ${entry.to.name}` : ''}.`;
    default: return entry.action;
  }
}
