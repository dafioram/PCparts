// search.js — full-text search across machines, parts and boxes.

import { h } from '../dom.js';
import * as M from '../../model.js';
import { getState } from '../store.js';
import { machineCard, catDot, locationLabel, emptyState } from '../components.js';

export function render(container, query) {
  container.appendChild(h('div', { class: 'page-header' }, [h('h1', {}, query ? `Search: "${query}"` : 'Search')]));

  if (!query || !query.trim()) {
    container.appendChild(emptyState('search', 'Type something in the search box above.'));
    return;
  }

  const state = getState();
  const results = M.searchAll(state, query);
  const wrap = h('div', { class: 'search-results' });

  if (results.machines.length === 0 && results.parts.length === 0 && results.boxes.length === 0) {
    wrap.appendChild(emptyState('search', `Nothing matches "${query}".`));
    container.appendChild(wrap);
    return;
  }

  if (results.machines.length) {
    wrap.appendChild(h('h3', {}, `Machines (${results.machines.length})`));
    wrap.appendChild(h('div', { class: 'card-grid' }, results.machines.map((m) => machineCard(m, state))));
  }
  if (results.parts.length) {
    wrap.appendChild(h('h3', {}, `Parts (${results.parts.length})`));
    wrap.appendChild(h('div', { class: 'section' }, [h('div', { class: 'section-body', style: 'padding-top:10px' },
      results.parts.map((p) => h('a', { href: `#/parts/${p.id}`, class: 'part-row', style: 'text-decoration:none;color:inherit' }, [
        catDot(p.category),
        h('div', { class: 'part-row-main' }, [
          h('div', { class: 'part-row-label' }, p.label),
          h('div', { class: 'part-row-sub' }, p.retired ? 'Retired' : locationLabel(p, state)),
        ]),
      ]))),
    ]));
  }
  if (results.boxes.length) {
    wrap.appendChild(h('h3', {}, `Boxes (${results.boxes.length})`));
    wrap.appendChild(h('div', { class: 'card-grid' }, results.boxes.map((b) => {
      const count = M.partsInBox(state, b.id).length;
      return h('a', { class: 'card', href: `#/boxes/${b.id}` }, [
        h('div', { class: 'card-title' }, b.name),
        h('div', { class: 'card-subtitle' }, `${count} part${count === 1 ? '' : 's'}`),
      ]);
    })));
  }

  container.appendChild(wrap);
}
