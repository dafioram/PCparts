// components.js — small shared render helpers used by several views:
// category dots, machine cards, part rows, warning badges, status chips.

import { h, icon } from './dom.js';
import * as M from '../model.js';

const CATEGORY_ICON = {
  cpu: 'cpu', motherboard: 'motherboard', ram: 'ram', gpu: 'gpu', storage: 'storage', psu: 'psu',
  case: 'case', cooler: 'cooler', fan: 'fan', expansion: 'expansion', other: 'other',
};

const MACHINE_ICON = {
  desktop: 'desktop', server: 'server', laptop: 'laptop', 'mini-pc': 'mini-pc', sbc: 'sbc', 'other-device': 'other-device',
};

export function catDot(category, opts = {}) {
  const label = opts.title || M.CATEGORY_LABELS[category] || category;
  return h('div', { class: 'cat-dot', title: label, role: 'img', 'aria-label': label, style: `color: var(--cat-${category})` },
    icon(CATEGORY_ICON[category] || 'other'));
}

export function machineIcon(machine) {
  return icon(MACHINE_ICON[machine.type] || 'desktop');
}

export function statusChip(status, opts = {}) {
  return h('span', { class: `chip status-${status}` }, opts.label || status[0].toUpperCase() + status.slice(1));
}

export function typeChip(machine) {
  return h('span', { class: 'chip' }, M.MACHINE_TYPE_SHORT_LABELS[machine.type] || machine.type);
}

export function tagChips(tags) {
  if (!tags || tags.length === 0) return null;
  return h('div', { class: 'card-row' }, tags.map((t) => h('span', { class: 'chip tag' }, [icon('tag', { size: 11 }), t])));
}

export function warningLine(text) {
  return h('div', { class: 'warning-line' }, [icon('warning', { size: 14 }), text]);
}

// One compact badge per missing category, e.g. "No GPU" (icon + text, so
// color is never the only signal).
export function warningBadgesCompact(warnings) {
  if (!warnings || warnings.length === 0) return null;
  return h('div', { class: 'card-row warn-badges' }, warnings.map((w) => h('span', { class: 'chip warn' }, [
    icon('warning', { size: 12 }), `No ${M.CATEGORY_LABELS[w]}`,
  ])));
}

// Category icon row for a machine card, one dot per distinct installed category.
export function categoryIconRow(parts) {
  const cats = [...new Set(parts.map((p) => p.category))];
  if (cats.length === 0) return null;
  return h('div', { class: 'cat-icons-row' }, cats.map((c) => catDot(c)));
}

// A stored link as a clickable web link, or plain text if it isn't http(s)
// (e.g. a javascript: URL from an imported file).
export function linkLine(link) {
  if (!link) return null;
  const href = M.safeHref(link);
  const content = [icon('link', { size: 12 }), ' ' + link];
  return h('div', { class: 'detail-meta' }, href
    ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, content)
    : h('span', { title: 'Not a web address, so it isn’t clickable' }, content));
}

export function machineCard(machine, state) {
  const parts = M.isBuild(machine) ? M.partsInMachine(state, machine.id) : [];
  const { title, subtitle } = M.displayName(machine, state.parts);
  const warnings = M.isBuild(machine) ? M.deriveWarnings(machine, parts) : [];
  const isRetiredDevice = M.isDevice(machine) && machine.retired;

  return h('a', { class: 'card' + (isRetiredDevice ? ' retired' : ''), href: `#/machines/${machine.id}` }, [
    h('div', { class: 'card-top' }, [
      h('div', { class: 'card-icon' }, machineIcon(machine)),
      h('div', { class: 'card-titles' }, [
        h('div', { class: 'card-title' }, title),
        subtitle ? h('div', { class: 'card-subtitle' }, subtitle) : null,
      ]),
    ]),
    machine.purpose ? h('div', { class: 'card-purpose' }, machine.purpose) : null,
    h('div', { class: 'card-row' }, [
      isRetiredDevice ? statusChip('retired') : statusChip(machine.status),
      typeChip(machine),
    ]),
    tagChips(machine.tags),
    categoryIconRow(parts),
    warningBadgesCompact(warnings),
  ]);
}

// A row representing one part, used in box detail / machine detail / all-parts.
// opts: { showLocation, selectable, selected, onToggleSelect, slotLabel,
//         actions: [{ label, onClick, icon }] }
export function partRow(part, state, opts = {}) {
  const children = [];
  if (opts.selectable) {
    children.push(h('input', {
      type: 'checkbox', checked: !!opts.selected, 'aria-label': `Select ${part.label}`,
      onchange: () => opts.onToggleSelect(part.id),
    }));
  }
  children.push(catDot(part.category));

  const subBits = [];
  if (part.brand || part.model) subBits.push([part.brand, part.model].filter(Boolean).join(' '));
  if (part.details) {
    const d = part.details;
    const bits = [d.capacity, d.generation, d.kind, d.vram, d.wattage, d.formFactor, d.coresThreads, d.socket, d.description].filter(Boolean);
    if (bits.length) subBits.push(bits.join(' · '));
  }
  if (part.quantity > 1) subBits.unshift(`×${part.quantity}`);
  if (opts.showLocation) {
    const loc = locationLabel(part, state);
    if (loc) subBits.push(loc);
  }
  if (opts.slotLabel) subBits.push(opts.slotLabel);

  const main = h('div', { class: 'part-row-main' }, [
    h('a', { class: 'part-row-label', href: `#/parts/${part.id}` }, part.label),
    subBits.length ? h('div', { class: 'part-row-sub' }, subBits.join(' · ')) : null,
    part.tags && part.tags.length ? tagChips(part.tags) : null,
  ]);
  children.push(main);

  const actions = h('div', { class: 'part-row-actions' });
  for (const a of opts.actions || []) {
    actions.appendChild(h('button', {
      class: 'btn btn-sm btn-ghost', type: 'button', title: a.label, 'aria-label': a.label, onclick: a.onClick,
    }, [a.icon ? icon(a.icon, { size: 15 }) : null, a.showLabel ? a.label : null]));
  }
  children.push(actions);

  return h('div', { class: 'part-row' }, children);
}

export function locationLabel(part, state) {
  if (part.retired) return 'Retired';
  if (!part.location) return '';
  if (part.location.kind === 'box') {
    const box = M.getBox(state, part.location.id);
    return box ? box.name : '';
  }
  const machine = M.getMachine(state, part.location.id);
  if (!machine) return '';
  const { title } = M.displayName(machine, state.parts);
  const slot = part.location.slotId ? (machine.slots || []).find((s) => s.id === part.location.slotId) : null;
  return slot ? `${title} · ${slot.label}` : title;
}

export function emptyState(iconName, message, action) {
  return h('div', { class: 'empty-state' }, [
    icon(iconName),
    h('p', {}, message),
    action || null,
  ]);
}
