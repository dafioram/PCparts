// forms.js — reusable form building blocks: tag input, machine/part/retire
// forms, the move-to picker and the "M.2 or SATA?" question.

import { h, icon, todayStr } from './dom.js';
import * as M from '../model.js';
import { getState } from './store.js';
import { openModal } from './modal.js';

export const CATEGORY_LABELS = M.CATEGORY_LABELS;
export const SLOT_TYPE_LABELS = M.SLOT_LABEL_PREFIX;

export const MACHINE_TYPE_LABELS = {
  desktop: 'Desktop', server: 'Server',
  laptop: 'Laptop', 'mini-pc': 'Mini PC', sbc: 'Single-board computer (e.g. Raspberry Pi)', 'other-device': 'Other device',
};

export const RETIRE_REASON_LABELS = {
  died: 'Died', sold: 'Sold', 'given-away': 'Given away', trashed: 'Trashed', lost: 'Lost',
};

const NON_SLOT_CATEGORIES = M.PART_CATEGORIES.filter((c) => !M.usesSlotSystem(c));

// ---------------------------------------------------------------------------
// tag input
// ---------------------------------------------------------------------------

export function tagInput(initialTags = []) {
  const tags = [...initialTags];
  const suggestions = M.allTags(getState()).filter((t) => !tags.includes(t));

  const chipsWrap = h('div', { class: 'tag-input-wrap' });
  const textInput = h('input', { type: 'text', placeholder: tags.length ? '' : 'Add a tag and press Enter' });
  const suggestionsWrap = h('div', { class: 'tag-suggestions' });

  function renderChips() {
    chipsWrap.innerHTML = '';
    for (const tag of tags) {
      chipsWrap.appendChild(h('span', { class: 'tag-chip' }, [
        tag,
        h('button', { type: 'button', 'aria-label': `Remove tag ${tag}`, onclick: () => { removeTag(tag); } }, icon('close', { size: 11 })),
      ]));
    }
    chipsWrap.appendChild(textInput);
  }

  function renderSuggestions() {
    suggestionsWrap.innerHTML = '';
    for (const s of suggestions.filter((t) => !tags.includes(t)).slice(0, 8)) {
      suggestionsWrap.appendChild(h('button', { type: 'button', onclick: () => addTag(s) }, `+ ${s}`));
    }
  }

  function addTag(raw) {
    const t = raw.trim();
    if (!t || tags.includes(t)) return;
    tags.push(t);
    textInput.value = '';
    renderChips();
    renderSuggestions();
    textInput.focus();
  }
  function removeTag(t) {
    const i = tags.indexOf(t);
    if (i >= 0) tags.splice(i, 1);
    renderChips();
    renderSuggestions();
  }

  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(textInput.value);
    } else if (e.key === 'Backspace' && textInput.value === '' && tags.length) {
      removeTag(tags[tags.length - 1]);
    }
  });
  textInput.addEventListener('blur', () => { if (textInput.value.trim()) addTag(textInput.value); });

  renderChips();
  renderSuggestions();

  const wrap = h('div', {}, [chipsWrap, suggestionsWrap]);
  // A tag typed but not yet confirmed with Enter still counts on submit.
  return { el: wrap, getTags: () => (textInput.value.trim() && !tags.includes(textInput.value.trim()) ? [...tags, textInput.value.trim()] : [...tags]) };
}

// ---------------------------------------------------------------------------
// small field helpers
// ---------------------------------------------------------------------------

// The label wraps its input so the two are implicitly associated (no id
// plumbing needed), which both screen readers and getByLabel() rely on.
export function field(labelText, inputEl, hint) {
  const label = h('label', {}, [
    h('span', { class: 'field-label-text' }, labelText),
    inputEl,
  ]);
  return h('div', { class: 'field' }, [label, hint ? h('div', { class: 'hint' }, hint) : null]);
}

export function selectEl(options, selected, attrs = {}) {
  const sel = h('select', attrs);
  for (const opt of options) {
    const value = typeof opt === 'string' ? opt : opt.value;
    const label = typeof opt === 'string' ? opt : opt.label;
    sel.appendChild(h('option', { value, selected: value === selected }, label));
  }
  return sel;
}

// ---------------------------------------------------------------------------
// machine form (create + edit; type only editable on create)
// ---------------------------------------------------------------------------

export function buildMachineFormBody({ machine, defaultType }) {
  const isEdit = !!machine;
  const wrap = h('div', {});

  let typeSelect = null;
  if (!isEdit) {
    typeSelect = selectEl(
      Object.entries(MACHINE_TYPE_LABELS).map(([value, label]) => ({ value, label })),
      defaultType || 'desktop',
    );
    wrap.appendChild(field('Type', typeSelect));
  }

  const nickname = h('input', { type: 'text', value: machine?.nickname || '', placeholder: 'e.g. Jellyfin Server' });
  wrap.appendChild(field('Nickname (optional)', nickname, 'A short name for you — what you actually call it.'));

  const modelName = h('input', { type: 'text', value: machine?.modelName || '', placeholder: 'e.g. Optiplex 7040' });
  wrap.appendChild(field('Model name (optional)', modelName, 'Leave blank and a desktop/server will generate one from its parts.'));

  const purpose = h('input', { type: 'text', value: machine?.purpose || '', placeholder: 'e.g. Media server, runs 24/7' });
  wrap.appendChild(field('Purpose (optional)', purpose));

  const statusRow = h('div', { class: 'field-row' });
  const status = selectEl(M.MACHINE_STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })), machine?.status || 'active');
  statusRow.appendChild(field('Status', status));
  const serial = h('input', { type: 'text', value: machine?.serial || '', placeholder: 'Service tag / serial' });
  statusRow.appendChild(field('Serial (optional)', serial));
  wrap.appendChild(statusRow);

  // Specs only apply to devices; on create the field follows the type select.
  const specs = h('textarea', { placeholder: 'e.g. i7-1165G7, 16GB soldered, 512GB NVMe' }, machine?.specs || '');
  const specsField = field('Specs (optional)', specs, 'Devices aren’t broken into parts, so note what’s inside here.');
  wrap.appendChild(specsField);
  const syncSpecs = () => {
    const type = typeSelect ? typeSelect.value : machine.type;
    specsField.style.display = M.DEVICE_TYPES.includes(type) ? '' : 'none';
  };
  if (typeSelect) typeSelect.addEventListener('change', syncSpecs);
  syncSpecs();

  const link = h('input', { type: 'text', inputmode: 'url', value: machine?.link || '', placeholder: 'https://…' });
  wrap.appendChild(field('Link (optional)', link));

  const tags = tagInput(machine?.tags || []);
  wrap.appendChild(field('Tags', tags.el));

  const notes = h('textarea', { placeholder: 'Anything else worth remembering — e.g. benchmark scores' }, machine?.notes || '');
  wrap.appendChild(field('Notes (optional)', notes));

  return {
    el: wrap,
    getValues() {
      const type = typeSelect ? typeSelect.value : machine.type;
      return {
        type,
        nickname: nickname.value.trim(),
        modelName: modelName.value.trim(),
        purpose: purpose.value.trim(),
        status: status.value,
        serial: serial.value.trim(),
        specs: M.DEVICE_TYPES.includes(type) ? specs.value.trim() : (machine?.specs || ''),
        link: link.value.trim(),
        tags: tags.getTags(),
        notes: notes.value.trim(),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// part form (create + edit)
// ---------------------------------------------------------------------------

// Which categories an existing part may switch to, given where it is.
export function partEditRules(part) {
  if (part.location && part.location.kind === 'machine' && part.location.slotId) {
    return { lockCategory: true, categoryHint: 'Installed in a slot — move it to a box to change its category.' };
  }
  if (part.location && part.location.kind === 'machine') {
    return { allowedCategories: NON_SLOT_CATEGORIES, categoryHint: 'Move it to a box to make it a RAM, GPU, storage or expansion part.' };
  }
  return {};
}

// opts: { part, defaultCategory, allowedCategories, lockCategory,
//         categoryHint, askSlotType }
// askSlotType: the part is being added straight into a build, so a storage
// part with no kind gets a "Which slot? (M.2 or SATA)" question.
export function buildPartFormBody({ part, defaultCategory, allowedCategories, lockCategory, categoryHint, askSlotType }) {
  const wrap = h('div', {});
  const category = part?.category || defaultCategory || 'other';
  const options = (allowedCategories || M.PART_CATEGORIES).includes(category)
    ? (allowedCategories || M.PART_CATEGORIES)
    : [category, ...(allowedCategories || M.PART_CATEGORIES)];

  const categorySelect = selectEl(
    options.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
    category,
    { disabled: !!lockCategory },
  );
  wrap.appendChild(field('Category', categorySelect, categoryHint));

  const label = h('input', { type: 'text', value: part?.label || '', placeholder: 'e.g. 16GB DDR4' });
  wrap.appendChild(field('Label', label, 'A short description is enough — exact model is optional below.'));

  const quantityRow = h('div', { class: 'field-row' });
  const lockedQty = part && part.location && part.location.kind === 'machine' && part.location.slotId;
  const quantity = h('input', { type: 'number', min: '1', step: '1', value: String(part?.quantity || 1), disabled: !!lockedQty });
  quantityRow.appendChild(field('Quantity', quantity, lockedQty ? 'Installed in a slot — one part per slot.' : 'e.g. 2 for "2 × 8GB"'));
  wrap.appendChild(quantityRow);

  const detailsWrap = h('div', {});
  wrap.appendChild(detailsWrap);
  let detailInputs = {};
  let slotTypeSelect = null;
  function renderDetails() {
    detailsWrap.innerHTML = '';
    detailInputs = {};
    slotTypeSelect = null;
    const cat = categorySelect.value;
    const details = part && part.category === cat ? (part.details || {}) : {};
    const add = (key, labelText, inputEl, hint) => { detailInputs[key] = inputEl; detailsWrap.appendChild(field(labelText, inputEl, hint)); };

    if (cat === 'ram') {
      add('capacity', 'Capacity (optional)', h('input', { type: 'text', value: details.capacity || '', placeholder: 'e.g. 8GB (per stick)' }));
      add('generation', 'Generation (optional)', selectEl(['', 'DDR2', 'DDR3', 'DDR4', 'DDR5'], details.generation || ''));
      add('speed', 'Speed (optional)', h('input', { type: 'text', value: details.speed || '', placeholder: 'e.g. 3200MHz' }));
    } else if (cat === 'storage') {
      add('capacity', 'Capacity (optional)', h('input', { type: 'text', value: details.capacity || '', placeholder: 'e.g. 1TB' }));
      const kind = selectEl(['', ...M.STORAGE_KINDS], details.kind || '');
      add('kind', 'Kind', kind, 'Decides the slot: NVMe / M.2 SATA go in M.2, SATA SSD / HDD in SATA.');
      if (askSlotType) {
        slotTypeSelect = selectEl([{ value: '', label: 'Choose…' }, { value: 'm2', label: 'M.2 slot' }, { value: 'sata', label: 'SATA port' }], '');
        const slotField = field('Which slot? (M.2 or SATA)', slotTypeSelect, 'Needed because the kind isn’t set.');
        detailsWrap.appendChild(slotField);
        const sync = () => { slotField.style.display = kind.value === '' || kind.value === 'other' ? '' : 'none'; };
        kind.addEventListener('change', sync);
        sync();
      }
    } else if (cat === 'gpu') {
      add('vram', 'VRAM (optional)', h('input', { type: 'text', value: details.vram || '', placeholder: 'e.g. 6GB' }));
    } else if (cat === 'psu') {
      add('wattage', 'Wattage (optional)', h('input', { type: 'text', value: details.wattage || '', placeholder: 'e.g. 600W' }));
      add('formFactor', 'Form factor (optional)', h('input', { type: 'text', value: details.formFactor || '', placeholder: 'e.g. ATX' }));
    } else if (cat === 'motherboard') {
      add('formFactor', 'Form factor (optional)', h('input', { type: 'text', value: details.formFactor || '', placeholder: 'e.g. mATX' }));
      add('socket', 'Socket (optional)', h('input', { type: 'text', value: details.socket || '', placeholder: 'e.g. LGA1151' }));
    } else if (cat === 'case') {
      add('formFactor', 'Form factor (optional)', selectEl(['', ...M.CASE_FORM_FACTORS], details.formFactor || ''));
      add('description', 'Description (optional)', h('input', { type: 'text', value: details.description || '', placeholder: 'e.g. black, glass side panel' }));
    } else if (cat === 'cpu') {
      add('coresThreads', 'Cores / threads (optional)', h('input', { type: 'text', value: details.coresThreads || '', placeholder: 'e.g. 6/12' }));
      add('socket', 'Socket (optional)', h('input', { type: 'text', value: details.socket || '', placeholder: 'e.g. AM4' }));
    }
  }
  categorySelect.addEventListener('change', renderDetails);
  renderDetails();

  const brandRow = h('div', { class: 'field-row' });
  const brand = h('input', { type: 'text', value: part?.brand || '' });
  brandRow.appendChild(field('Brand (optional)', brand));
  const model = h('input', { type: 'text', value: part?.model || '' });
  brandRow.appendChild(field('Model (optional)', model));
  wrap.appendChild(brandRow);

  const serial = h('input', { type: 'text', value: part?.serial || '' });
  wrap.appendChild(field('Serial (optional)', serial));

  const link = h('input', { type: 'text', inputmode: 'url', value: part?.link || '', placeholder: 'https://…' });
  wrap.appendChild(field('Link (optional)', link));

  const tags = tagInput(part?.tags || []);
  wrap.appendChild(field('Tags', tags.el));

  const notes = h('textarea', {}, part?.notes || '');
  wrap.appendChild(field('Notes (optional)', notes));

  return {
    el: wrap,
    getValues() {
      const details = {};
      for (const [key, input] of Object.entries(detailInputs)) {
        if (input.value) details[key] = input.value.trim ? input.value.trim() : input.value;
      }
      const qty = Number(quantity.value);
      return {
        category: categorySelect.value,
        label: label.value.trim(),
        quantity: Number.isInteger(qty) && qty >= 1 ? qty : 1,
        details,
        brand: brand.value.trim(),
        model: model.value.trim(),
        serial: serial.value.trim(),
        link: link.value.trim(),
        tags: tags.getTags(),
        notes: notes.value.trim(),
        storageSlotType: slotTypeSelect && slotTypeSelect.value ? slotTypeSelect.value : undefined,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// retire form
// ---------------------------------------------------------------------------

export function buildRetireFormBody({ defaultReason = 'sold' } = {}) {
  const wrap = h('div', {});
  const reason = selectEl(M.RETIRE_REASONS.map((r) => ({ value: r, label: RETIRE_REASON_LABELS[r] })), defaultReason);
  wrap.appendChild(field('Reason', reason));

  const row = h('div', { class: 'field-row' });
  const date = h('input', { type: 'date', value: todayStr() });
  row.appendChild(field('Date', date));
  const price = h('input', { type: 'text', placeholder: 'e.g. 150', inputmode: 'decimal' });
  row.appendChild(field('Price (optional)', price));
  wrap.appendChild(row);

  const notes = h('textarea', { placeholder: 'e.g. Facebook Marketplace' });
  wrap.appendChild(field('Notes (optional)', notes));

  return {
    el: wrap,
    getValues() {
      return { reason: reason.value, date: date.value || todayStr(), price: price.value.trim(), notes: notes.value.trim() };
    },
  };
}

// ---------------------------------------------------------------------------
// move-to picker: lists boxes then builds, with a search filter
// ---------------------------------------------------------------------------

// `exclude` ({ kind, id }) hides the place the part(s) already are.
// Pressing Enter in the search box picks the first match.
export function buildMovePicker({ exclude = null, onPick, boxesOnly = false }) {
  const state = getState();
  const wrap = h('div', {});
  const searchBox = h('input', { type: 'text', placeholder: boxesOnly ? 'Search boxes…' : 'Search boxes and builds…' });
  wrap.appendChild(field(boxesOnly ? 'Restore to…' : 'Move to…', searchBox));
  const list = h('div', { class: 'picker-list' });
  wrap.appendChild(list);
  let first = null;

  const isExcluded = (kind, id) => exclude && exclude.kind === kind && exclude.id === id;

  function render(query = '') {
    list.innerHTML = '';
    first = null;
    const q = query.trim().toLowerCase();
    const boxes = state.boxes.filter((b) => !isExcluded('box', b.id) && (!q || b.name.toLowerCase().includes(q)));
    const builds = boxesOnly ? [] : state.machines.filter((m) => M.isBuild(m) && !isExcluded('machine', m.id)
      && (!q || M.displayName(m, state.parts).title.toLowerCase().includes(q)));

    for (const box of boxes) {
      const count = M.partsInBox(state, box.id).length;
      const dest = { kind: 'box', id: box.id };
      first = first || dest;
      list.appendChild(h('button', { type: 'button', class: 'picker-item', onclick: () => onPick(dest) }, [
        icon('box'),
        h('span', { class: 'picker-item-text' }, [
          h('span', { class: 'picker-item-title' }, box.name),
          h('span', { class: 'picker-item-sub' }, `${count} part${count === 1 ? '' : 's'}`),
        ]),
      ]));
    }
    for (const build of builds) {
      const { title, subtitle } = M.displayName(build, state.parts);
      const dest = { kind: 'machine', id: build.id };
      first = first || dest;
      list.appendChild(h('button', { type: 'button', class: 'picker-item', onclick: () => onPick(dest) }, [
        icon(build.type === 'server' ? 'server' : 'desktop'),
        h('span', { class: 'picker-item-text' }, [
          h('span', { class: 'picker-item-title' }, title),
          subtitle ? h('span', { class: 'picker-item-sub' }, subtitle) : null,
        ]),
      ]));
    }
    if (!first) list.appendChild(h('p', { class: 'picker-empty muted' }, 'Nothing matches.'));
  }
  searchBox.addEventListener('input', () => render(searchBox.value));
  searchBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (first) onPick(first);
    }
  });
  render();

  return wrap;
}

// ---------------------------------------------------------------------------
// "M.2 or SATA?" (SPEC §3.5) for storage parts with no kind set
// ---------------------------------------------------------------------------

export function askStorageSlotType(parts, onChoose) {
  const names = parts.length === 1 ? parts[0].label : `${parts.length} drives`;
  openModal((close) => h('div', {}, [
    h('h2', {}, 'M.2 or SATA?'),
    h('p', { class: 'muted' }, `${parts.length === 1 ? `${names} has` : `${names} have`} no kind set, so the app can’t tell which slot ${parts.length === 1 ? 'it goes' : 'they go'} in.`),
    h('div', { class: 'choice-row' }, [
      h('button', { type: 'button', class: 'btn', onclick: () => { close(); onChoose('m2'); } }, 'M.2 slot'),
      h('button', { type: 'button', class: 'btn', onclick: () => { close(); onChoose('sata'); } }, 'SATA port'),
    ]),
    h('div', { class: 'modal-actions' }, [h('button', { type: 'button', class: 'btn btn-ghost', onclick: close }, 'Cancel')]),
  ]));
}
