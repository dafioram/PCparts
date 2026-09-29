// model.js — pure state functions for the PC Inventory app.
//
// Nothing in this file touches the DOM or storage. Every mutating function
// takes a state object and returns { state, result } where `state` is a new
// object (the input is never mutated) and `result` describes what happened,
// for the UI to turn into toasts / messages.
//
// State shape (matches the export JSON, see SPEC.md §11.3):
// {
//   app: 'pc-inventory', schemaVersion: 1,
//   machines: [...], boxes: [...], parts: [...], retirementGroups: [...],
//   meta: { lastExportedAt }
// }

export const SCHEMA_VERSION = 1;

export const BUILD_TYPES = ['desktop', 'server'];
export const DEVICE_TYPES = ['laptop', 'mini-pc', 'sbc', 'other-device'];
export const MACHINE_TYPES = [...BUILD_TYPES, ...DEVICE_TYPES];
export const MACHINE_STATUSES = ['active', 'standby', 'broken'];

export const PART_CATEGORIES = [
  'cpu', 'motherboard', 'ram', 'gpu', 'storage', 'psu',
  'case', 'cooler', 'fan', 'expansion', 'other',
];

export const REQUIRED_CATEGORIES = ['cpu', 'motherboard', 'ram', 'storage', 'psu', 'gpu'];

export const STORAGE_KINDS = ['NVMe', 'M.2 SATA', 'SATA SSD', 'HDD', 'other'];
export const CASE_FORM_FACTORS = ['ATX', 'mATX', 'ITX', 'SFF', 'tower', 'other'];

export const SLOT_TYPES = ['dimm', 'm2', 'sata', 'pcie-x16', 'pcie-x1'];
export const SLOT_LABEL_PREFIX = {
  dimm: 'DIMM',
  m2: 'M.2',
  sata: 'SATA',
  'pcie-x16': 'PCIe x16',
  'pcie-x1': 'PCIe x1',
};

export const RETIRE_REASONS = ['died', 'sold', 'given-away', 'trashed', 'lost'];

export const CATEGORY_LABELS = {
  cpu: 'CPU', motherboard: 'Motherboard', ram: 'RAM', gpu: 'GPU', storage: 'Storage', psu: 'PSU',
  case: 'Case', cooler: 'Cooler', fan: 'Fan', expansion: 'Expansion card', other: 'Other',
};

// Short labels for chips and cards ("Mini PC"), and nouns for fallback titles
// ("Unnamed mini PC").
export const MACHINE_TYPE_SHORT_LABELS = {
  desktop: 'Desktop', server: 'Server', laptop: 'Laptop', 'mini-pc': 'Mini PC', sbc: 'SBC', 'other-device': 'Other device',
};
const DEVICE_NOUNS = { laptop: 'laptop', 'mini-pc': 'mini PC', sbc: 'single-board computer', 'other-device': 'device' };

const UNUSED_BOX_ID = 'unused';
export { UNUSED_BOX_ID };

// ---------------------------------------------------------------------------
// ids / time
// ---------------------------------------------------------------------------

function newId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function clone(x) {
  return structuredClone(x);
}

// ---------------------------------------------------------------------------
// initial state
// ---------------------------------------------------------------------------

export function createInitialState() {
  return {
    app: 'pc-inventory',
    schemaVersion: SCHEMA_VERSION,
    machines: [],
    boxes: [
      { id: UNUSED_BOX_ID, name: 'Unused', isDefault: true, notes: '', tags: [] },
    ],
    parts: [],
    retirementGroups: [],
    meta: { lastExportedAt: null },
  };
}

// ---------------------------------------------------------------------------
// lookups
// ---------------------------------------------------------------------------

export function isBuild(machine) {
  return BUILD_TYPES.includes(machine.type);
}

export function isDevice(machine) {
  return DEVICE_TYPES.includes(machine.type);
}

export function getMachine(state, id) {
  return state.machines.find((m) => m.id === id) || null;
}

export function getBox(state, id) {
  return state.boxes.find((b) => b.id === id) || null;
}

export function getPart(state, id) {
  return state.parts.find((p) => p.id === id) || null;
}

export function getRetirementGroup(state, id) {
  return state.retirementGroups.find((g) => g.id === id) || null;
}

export function activeParts(state) {
  return state.parts.filter((p) => !p.retired);
}

export function partsInMachine(state, machineId) {
  return activeParts(state).filter(
    (p) => p.location && p.location.kind === 'machine' && p.location.id === machineId,
  );
}

export function partsInBox(state, boxId) {
  return activeParts(state).filter(
    (p) => p.location && p.location.kind === 'box' && p.location.id === boxId,
  );
}

export function retiredParts(state) {
  return state.parts.filter((p) => p.retired);
}

// ---------------------------------------------------------------------------
// derived: part status
// ---------------------------------------------------------------------------

export function derivePartStatus(part) {
  if (part.retired) return 'removed';
  if (part.location && part.location.kind === 'machine') return 'in-use';
  return 'unused';
}

// ---------------------------------------------------------------------------
// derived: size parsing / capacity totals
// ---------------------------------------------------------------------------

// Drives are sold in decimal units (1TB = 1000GB); memory is binary
// (1GB = 1024MB). Totals use the matching base so "1TB + 500GB" reads 1.5TB.
export const STORAGE_BASE = 1000;
export const MEMORY_BASE = 1024;

// Parses a size like "16GB", "1TB", "512MB" (case-insensitive, optional
// space) into a value in GB. Returns null if nothing recognizable is found.
export function parseSizeToGb(text, base = STORAGE_BASE) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/(\d+(?:\.\d+)?)\s*(TB|GB|MB)\b/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  if (unit === 'TB') return value * base;
  if (unit === 'MB') return value / base;
  return value;
}

export function formatSize(gb, base = STORAGE_BASE) {
  const round = (n) => Math.round(n * 100) / 100;
  if (gb >= base) return `${round(gb / base)}TB`;
  return `${round(gb)}GB`;
}

// Sums capacity across parts (reading details.capacity, falling back to the
// label). Returns { totalGb, unknownCount, text }. `text` is '' when there is
// nothing to report.
export function capacityTotal(parts, { base = STORAGE_BASE } = {}) {
  let totalGb = 0;
  let known = 0;
  let unknownCount = 0;
  for (const p of parts) {
    const raw = (p.details && p.details.capacity) || p.label || '';
    const gb = parseSizeToGb(raw, base);
    if (gb == null) {
      unknownCount += 1;
    } else {
      totalGb += gb * (p.quantity || 1);
      known += 1;
    }
  }
  if (known === 0) return { totalGb: 0, unknownCount, text: '' };
  let text = formatSize(totalGb, base);
  if (unknownCount > 0) text += ` (+${unknownCount} unknown)`;
  return { totalGb, unknownCount, text };
}

// ---------------------------------------------------------------------------
// derived: display names
// ---------------------------------------------------------------------------

export function generateBuildSummary(machine, parts) {
  const cpu = parts.find((p) => p.category === 'cpu' && !p.retired);
  const gpu = parts.find((p) => p.category === 'gpu' && !p.retired);
  const ramParts = parts.filter((p) => p.category === 'ram' && !p.retired);

  let ramText = '';
  if (ramParts.length > 0) {
    const cap = capacityTotal(ramParts, { base: MEMORY_BASE });
    if (cap.text) {
      // Use the generation from the first stick that has one, e.g. "16GB DDR4".
      const gen = ramParts.map((p) => p.details && p.details.generation).find(Boolean);
      ramText = gen ? `${cap.text} ${gen}` : cap.text;
    } else {
      ramText = ramParts.map((p) => p.label).join(', ');
    }
  }

  const pieces = [cpu && cpu.label, ramText, gpu && gpu.label].filter(Boolean);
  if (pieces.length === 0) {
    const kind = machine.type === 'server' ? 'server' : 'desktop';
    return `Empty ${kind}`;
  }
  return pieces.join(' · ');
}

export function displayName(machine, allParts) {
  if (!isBuild(machine)) {
    // Devices: nickname, then model name, then specs, then "Unnamed laptop".
    // The subtitle carries whatever of model name / specs isn't the title, so
    // specs always show somewhere.
    const title = machine.nickname || machine.modelName || machine.specs
      || `Unnamed ${DEVICE_NOUNS[machine.type] || 'device'}`;
    const subtitle = [machine.modelName, machine.specs].filter((x) => x && x !== title).join(' · ');
    return { title, subtitle };
  }

  const parts = partsInMachineList(machine, allParts);
  const summary = generateBuildSummary(machine, parts);

  const title = machine.nickname || machine.modelName || summary;

  let subtitle;
  if (machine.modelName && machine.modelName !== title) {
    subtitle = machine.modelName;
  } else {
    subtitle = summary;
  }
  if (subtitle === title) subtitle = '';
  return { title, subtitle };
}

function partsInMachineList(machine, allParts) {
  return allParts.filter(
    (p) => !p.retired && p.location && p.location.kind === 'machine' && p.location.id === machine.id,
  );
}

// ---------------------------------------------------------------------------
// derived: missing-part warnings
// ---------------------------------------------------------------------------

export function deriveWarnings(machine, machineParts) {
  if (!isBuild(machine)) return [];
  const notNeeded = machine.notNeeded || [];
  const present = new Set(machineParts.map((p) => p.category));
  return REQUIRED_CATEGORIES.filter((cat) => !notNeeded.includes(cat) && !present.has(cat));
}

// ---------------------------------------------------------------------------
// history helper
// ---------------------------------------------------------------------------

function locationSnapshot(state, location) {
  if (!location) return null;
  if (location.kind === 'box') {
    const box = getBox(state, location.id);
    return { kind: 'box', id: location.id, name: box ? box.name : location.id };
  }
  if (location.kind === 'machine') {
    const machine = getMachine(state, location.id);
    let name = location.id;
    if (machine) {
      const { title, subtitle } = displayName(machine, state.parts);
      name = subtitle ? `${title} (${subtitle})` : title;
    }
    if (location.slotId && machine) {
      const slot = (machine.slots || []).find((s) => s.id === location.slotId);
      if (slot) name = `${name} · ${slot.label}`;
    }
    return { kind: 'machine', id: location.id, name, slotId: location.slotId };
  }
  return null;
}

function pushHistory(state, partId, entry) {
  const part = state.parts.find((p) => p.id === partId);
  part.history.push({ at: nowIso(), ...entry });
  part.updatedAt = nowIso();
}

// ---------------------------------------------------------------------------
// links
// ---------------------------------------------------------------------------

// Cleans up a link typed by a person: "" stays "", http(s) URLs pass through,
// a bare address like "newegg.com/p/123" gets "https://" added, and any other
// scheme (javascript:, data:, file:, ...) is rejected.
export function normalizeLink(raw) {
  const text = (raw || '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  const looksLikeScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^:/]+:\d/.test(text);
  if (looksLikeScheme) throw new Error('Links must be web addresses starting with http:// or https://.');
  return `https://${text}`;
}

// The href to render for a stored link, or null if it isn't a web address
// (e.g. a javascript: URL in an imported file). Such links show as text.
export function safeHref(link) {
  if (typeof link !== 'string') return null;
  const text = link.trim();
  return /^https?:\/\/\S+$/i.test(text) ? text : null;
}

// ---------------------------------------------------------------------------
// machines
// ---------------------------------------------------------------------------

export function addMachine(state, input) {
  if (!MACHINE_TYPES.includes(input.type)) {
    throw new Error(`Unknown machine type: ${input.type}`);
  }
  const next = clone(state);
  const now = nowIso();
  const machine = {
    id: newId(),
    type: input.type,
    nickname: input.nickname || '',
    modelName: input.modelName || '',
    purpose: input.purpose || '',
    status: input.status || 'active',
    serial: input.serial || '',
    tags: input.tags ? [...input.tags] : [],
    notes: input.notes || '',
    link: normalizeLink(input.link),
    notNeeded: input.notNeeded ? [...input.notNeeded] : [],
    slots: [],
    specs: input.specs || '',
    retired: null,
    createdAt: now,
    updatedAt: now,
  };
  next.machines.push(machine);
  return { state: next, result: { id: machine.id } };
}

export function updateMachine(state, id, patch) {
  const next = clone(state);
  const machine = next.machines.find((m) => m.id === id);
  if (!machine) throw new Error(`Machine not found: ${id}`);
  const allowed = [
    'nickname', 'modelName', 'purpose', 'status', 'serial', 'tags', 'notes', 'link',
    'notNeeded', 'specs',
  ];
  if ('status' in patch && !MACHINE_STATUSES.includes(patch.status)) {
    throw new Error(`Unknown status: ${patch.status}`);
  }
  for (const key of allowed) {
    if (key in patch) machine[key] = key === 'link' ? normalizeLink(patch.link) : patch[key];
  }
  machine.updatedAt = nowIso();
  return { state: next, result: {} };
}

// Deletes an empty build, or a device (mistaken-entry cleanup). Refuses to
// delete a build that still has parts assigned to it.
export function deleteMachine(state, id) {
  const machine = getMachine(state, id);
  if (!machine) throw new Error(`Machine not found: ${id}`);
  if (isBuild(machine)) {
    const parts = partsInMachine(state, id);
    if (parts.length > 0) {
      throw new Error('Cannot delete a build that still has parts. Part it out or retire it instead.');
    }
  }
  const next = clone(state);
  next.machines = next.machines.filter((m) => m.id !== id);
  return { state: next, result: {} };
}

// ---------------------------------------------------------------------------
// boxes
// ---------------------------------------------------------------------------

function boxNameTaken(state, name, excludeId) {
  const lower = name.trim().toLowerCase();
  return state.boxes.some((b) => b.id !== excludeId && b.name.trim().toLowerCase() === lower);
}

export function addBox(state, input) {
  const name = (input.name || '').trim();
  if (!name) throw new Error('Box name is required.');
  if (boxNameTaken(state, name)) throw new Error(`A box named "${name}" already exists.`);
  const next = clone(state);
  const box = {
    id: newId(),
    name,
    isDefault: false,
    notes: input.notes || '',
    tags: input.tags ? [...input.tags] : [],
  };
  next.boxes.push(box);
  return { state: next, result: { id: box.id } };
}

export function updateBox(state, id, patch) {
  if (id === UNUSED_BOX_ID && 'name' in patch) {
    throw new Error('The Unused box cannot be renamed.');
  }
  if ('name' in patch) {
    const name = (patch.name || '').trim();
    if (!name) throw new Error('Box name is required.');
    if (boxNameTaken(state, name, id)) throw new Error(`A box named "${name}" already exists.`);
  }
  const next = clone(state);
  const box = next.boxes.find((b) => b.id === id);
  if (!box) throw new Error(`Box not found: ${id}`);
  if ('name' in patch) box.name = patch.name.trim();
  if ('notes' in patch) box.notes = patch.notes;
  if ('tags' in patch) box.tags = [...patch.tags];
  return { state: next, result: {} };
}

export function deleteBox(state, id) {
  if (id === UNUSED_BOX_ID) throw new Error('The Unused box cannot be deleted.');
  const box = getBox(state, id);
  if (!box) throw new Error(`Box not found: ${id}`);
  let next = clone(state);
  const parts = partsInBox(state, id);
  for (const p of parts) {
    ({ state: next } = movePart(next, p.id, { kind: 'box', id: UNUSED_BOX_ID }));
  }
  next.boxes = next.boxes.filter((b) => b.id !== id);
  return { state: next, result: { movedCount: parts.length } };
}

// ---------------------------------------------------------------------------
// slots
// ---------------------------------------------------------------------------

export function isSlotTypeDefined(machine, type) {
  return (machine.slots || []).some((s) => s.type === type && s.origin === 'user');
}

function slotsOfType(machine, type) {
  return (machine.slots || []).filter((s) => s.type === type);
}

// The number in a default label like "DIMM 3", or null for custom labels.
function defaultLabelNumber(label, type) {
  const prefix = `${SLOT_LABEL_PREFIX[type]} `;
  if (typeof label !== 'string' || !label.startsWith(prefix)) return null;
  const rest = label.slice(prefix.length);
  return /^\d+$/.test(rest) ? Number(rest) : null;
}

// Picks the lowest unused default number, so labels never repeat: with
// "DIMM 2" left after "DIMM 1" was removed, the next slot is "DIMM 1" again.
function nextSlotLabel(machine, type) {
  const used = new Set(slotsOfType(machine, type).map((s) => defaultLabelNumber(s.label, type)));
  let n = 1;
  while (used.has(n)) n += 1;
  return { label: `${SLOT_LABEL_PREFIX[type]} ${n}`, n };
}

// Creates a slot with the next free default label and inserts it in label
// order among its type (slot order is display order and auto-assign order).
function createSlot(machine, type, origin) {
  machine.slots = machine.slots || [];
  const { label, n } = nextSlotLabel(machine, type);
  const slot = { id: newId(), type, label, origin };
  let insertAt = machine.slots.findIndex((s) => s.type === type && (defaultLabelNumber(s.label, type) ?? -1) > n);
  if (insertAt === -1) {
    const lastOfType = machine.slots.map((s) => s.type).lastIndexOf(type);
    insertAt = lastOfType === -1 ? machine.slots.length : lastOfType + 1;
  }
  machine.slots.splice(insertAt, 0, slot);
  return slot;
}

// Per SPEC §3.5, any user edit to a type's slots makes the whole type
// user-defined (so a renamed slot isn't silently dropped when emptied).
function markTypeUser(machine, type) {
  for (const s of machine.slots || []) {
    if (s.type === type) s.origin = 'user';
  }
}

function slotOccupant(state, machineId, slotId) {
  return activeParts(state).find(
    (p) => p.location && p.location.kind === 'machine' && p.location.id === machineId && p.location.slotId === slotId,
  );
}

function findEmptySlot(state, machine, type) {
  const slots = slotsOfType(machine, type);
  for (const s of slots) {
    if (!slotOccupant(state, machine.id, s.id)) return s;
  }
  return null;
}

// Sets the number of user slots for a type on a build. Never removes an
// occupied slot; if there are more occupied slots than requested, the count
// ends up higher than asked. Marks every slot of that type as origin 'user'.
export function setSlotCount(state, machineId, type, count) {
  if (!SLOT_TYPES.includes(type)) throw new Error(`Unknown slot type: ${type}`);
  if (!Number.isInteger(count) || count < 0 || count > 64) {
    throw new Error('Enter a number of slots from 0 to 64.');
  }
  const next = clone(state);
  const machine = next.machines.find((m) => m.id === machineId);
  if (!machine || !isBuild(machine)) throw new Error(`Build not found: ${machineId}`);
  machine.slots = machine.slots || [];

  // Every existing slot of this type becomes user-owned.
  markTypeUser(machine, type);

  const current = slotsOfType(machine, type);
  if (count > current.length) {
    const toAdd = count - current.length;
    for (let i = 0; i < toAdd; i += 1) createSlot(machine, type, 'user');
  } else if (count < current.length) {
    let toRemove = current.length - count;
    // Remove empty slots, starting from the end of the list, until we reach
    // the target count or run out of empty slots.
    for (let i = machine.slots.length - 1; i >= 0 && toRemove > 0; i -= 1) {
      const s = machine.slots[i];
      if (s.type !== type) continue;
      if (slotOccupant(next, machineId, s.id)) continue;
      machine.slots.splice(i, 1);
      toRemove -= 1;
    }
  }
  return { state: next, result: {} };
}

export function addSlot(state, machineId, type, label) {
  if (!SLOT_TYPES.includes(type)) throw new Error(`Unknown slot type: ${type}`);
  const next = clone(state);
  const machine = next.machines.find((m) => m.id === machineId);
  if (!machine || !isBuild(machine)) throw new Error(`Build not found: ${machineId}`);
  markTypeUser(machine, type);
  const slot = createSlot(machine, type, 'user');
  if (label && label.trim()) slot.label = label.trim();
  return { state: next, result: { id: slot.id } };
}

export function renameSlot(state, machineId, slotId, label) {
  const clean = (label || '').trim();
  if (!clean) throw new Error('Slot label is required.');
  const next = clone(state);
  const machine = next.machines.find((m) => m.id === machineId);
  if (!machine) throw new Error(`Machine not found: ${machineId}`);
  const slot = (machine.slots || []).find((s) => s.id === slotId);
  if (!slot) throw new Error(`Slot not found: ${slotId}`);
  slot.label = clean;
  markTypeUser(machine, slot.type);
  return { state: next, result: {} };
}

export function removeSlot(state, machineId, slotId) {
  const machine = getMachine(state, machineId);
  if (!machine) throw new Error(`Machine not found: ${machineId}`);
  if (slotOccupant(state, machineId, slotId)) {
    throw new Error('Cannot remove a slot that has a part in it.');
  }
  const next = clone(state);
  const m = next.machines.find((x) => x.id === machineId);
  const slot = (m.slots || []).find((s) => s.id === slotId);
  if (!slot) throw new Error(`Slot not found: ${slotId}`);
  m.slots = m.slots.filter((s) => s.id !== slotId);
  markTypeUser(m, slot.type);
  return { state: next, result: {} };
}

// Frees the slot a part currently occupies (if any). If the slot's type is
// undefined (no user slots of that type), the now-empty auto slot is
// removed entirely, per SPEC §3.5.
function freeSlot(state, part) {
  if (!part.location || part.location.kind !== 'machine' || !part.location.slotId) return;
  const machine = state.machines.find((m) => m.id === part.location.id);
  if (!machine) return;
  const slot = (machine.slots || []).find((s) => s.id === part.location.slotId);
  if (!slot) return;
  if (!isSlotTypeDefined(machine, slot.type)) {
    machine.slots = machine.slots.filter((s) => s.id !== slot.id);
  }
}

function categorySlotCandidates(category, explicitKind) {
  if (category === 'ram') return ['dimm'];
  if (category === 'gpu') return ['pcie-x16'];
  if (category === 'expansion') return ['pcie-x1', 'pcie-x16'];
  if (category === 'storage') {
    const kind = explicitKind;
    if (kind === 'NVMe' || kind === 'M.2 SATA') return ['m2'];
    if (kind === 'SATA SSD' || kind === 'HDD') return ['sata'];
    return null; // ambiguous — caller must resolve
  }
  return []; // categories that don't use slots
}

export function usesSlotSystem(category) {
  return ['ram', 'gpu', 'storage', 'expansion'].includes(category);
}

// True for a storage part whose kind is blank or "other": installing it
// needs the person to say "M.2 or SATA?" (SPEC §3.5).
export function needsStorageSlotChoice(part) {
  return part.category === 'storage' && categorySlotCandidates('storage', part.details && part.details.kind) === null;
}

// The slot types a part may occupy, or null for a storage part of unknown kind
// (which fits either an M.2 or a SATA slot, whichever the person picks).
export function compatibleSlotTypes(part) {
  const candidates = categorySlotCandidates(part.category, part.details && part.details.kind);
  if (candidates === null) return ['m2', 'sata'];
  return candidates;
}

function incompatibleSlotMessage(part, slot) {
  const kind = part.category === 'storage' && part.details && part.details.kind;
  const what = kind ? `${kind} drives` : `${CATEGORY_LABELS[part.category] || part.category} parts`;
  return `${what} can't go in ${slot.label} (a ${SLOT_LABEL_PREFIX[slot.type]} slot).`;
}

// Places a single (quantity-1) part into a specific empty slot, or
// auto-assigns / grows slots as needed. Mutates `next` in place (already a
// clone). Returns info about what happened for the toast.
function installUnit(next, part, machineId, opts) {
  const machine = next.machines.find((m) => m.id === machineId);
  if (!machine) throw new Error(`Build not found: ${machineId}`);

  const info = { overflow: false, overflowMessage: null, slotId: null, slotLabel: null, swappedPartId: null };

  if (!usesSlotSystem(part.category)) {
    if (opts.explicitSlotId) {
      const slot = (machine.slots || []).find((s) => s.id === opts.explicitSlotId);
      throw new Error(slot ? incompatibleSlotMessage(part, slot) : `${CATEGORY_LABELS[part.category]} parts don't go in slots.`);
    }
    freeSlot(next, part);
    const from = locationSnapshot(next, part.location);
    part.location = { kind: 'machine', id: machineId };
    pushHistory(next, part.id, { action: 'moved', from, to: locationSnapshot(next, part.location) });
    return info;
  }

  const storageKind = part.category === 'storage' ? (part.details && part.details.kind) : undefined;

  if (opts.explicitSlotId) {
    const slot = (machine.slots || []).find((s) => s.id === opts.explicitSlotId);
    if (!slot) throw new Error(`Slot not found: ${opts.explicitSlotId}`);
    if (!compatibleSlotTypes(part).includes(slot.type)) {
      throw new Error(incompatibleSlotMessage(part, slot));
    }
    const occupant = slotOccupant(next, machineId, slot.id);
    const oldLocation = part.location;
    const from = locationSnapshot(next, part.location); // snapshot before any slot is freed/removed
    if (occupant && occupant.id !== part.id) {
      // Swap: the occupant takes the part's old slot. Only possible within
      // the same build, and only if the occupant fits that slot.
      const sameBuild = oldLocation && oldLocation.kind === 'machine' && oldLocation.id === machineId && oldLocation.slotId;
      if (!sameBuild) throw new Error(`${slot.label} already holds ${occupant.label}.`);
      const oldSlot = (machine.slots || []).find((s) => s.id === oldLocation.slotId);
      if (!oldSlot || !compatibleSlotTypes(occupant).includes(oldSlot.type)) {
        throw new Error(`Can't swap: ${occupant.label} doesn't fit ${oldSlot ? oldSlot.label : 'the other slot'}.`);
      }
      const occupantFrom = locationSnapshot(next, occupant.location);
      occupant.location = { kind: 'machine', id: machineId, slotId: oldLocation.slotId };
      pushHistory(next, occupant.id, { action: 'moved', from: occupantFrom, to: locationSnapshot(next, occupant.location) });
      info.swappedPartId = occupant.id;
    } else {
      freeSlot(next, part);
    }
    part.location = { kind: 'machine', id: machineId, slotId: slot.id };
    pushHistory(next, part.id, { action: 'moved', from, to: locationSnapshot(next, part.location) });
    info.slotId = slot.id;
    info.slotLabel = slot.label;
    return info;
  }

  // Auto-assign.
  let candidates = categorySlotCandidates(part.category, storageKind);
  if (candidates === null) {
    if (opts.storageSlotType === 'm2' || opts.storageSlotType === 'sata') {
      candidates = [opts.storageSlotType];
    } else {
      throw new Error(`Is ${part.label} an M.2 or a SATA drive? Choose one to install it.`);
    }
  }

  let chosenSlot = null;
  for (const type of candidates) {
    chosenSlot = findEmptySlot(next, machine, type);
    if (chosenSlot) break;
  }

  if (!chosenSlot) {
    const targetType = candidates[0];
    const defined = isSlotTypeDefined(machine, targetType);
    chosenSlot = createSlot(machine, targetType, defined ? 'user' : 'auto');
    if (defined) {
      const countOfType = slotsOfType(machine, targetType).length;
      info.overflow = true;
      info.overflowMessage = `All ${countOfType - 1} ${SLOT_LABEL_PREFIX[targetType]} slots were full, so a ${ordinal(countOfType)} was added.`;
    }
  }

  const from = locationSnapshot(next, part.location); // snapshot before the old slot is freed/removed
  freeSlot(next, part);
  part.location = { kind: 'machine', id: machineId, slotId: chosenSlot.id };
  pushHistory(next, part.id, { action: 'moved', from, to: locationSnapshot(next, part.location) });
  info.slotId = chosenSlot.id;
  info.slotLabel = chosenSlot.label;
  return info;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---------------------------------------------------------------------------
// parts
// ---------------------------------------------------------------------------

// `opts.storageSlotType` ('m2' | 'sata') answers "M.2 or SATA?" for a
// storage part of unknown kind created directly into a build.
export function addPart(state, input, location, opts = {}) {
  if (!PART_CATEGORIES.includes(input.category)) {
    throw new Error(`Unknown part category: ${input.category}`);
  }
  if (!input.label || !input.label.trim()) {
    throw new Error('Part label is required.');
  }
  const dest = location || { kind: 'box', id: UNUSED_BOX_ID };
  if (dest.kind === 'box' && !getBox(state, dest.id)) throw new Error(`Box not found: ${dest.id}`);

  const next = clone(state);
  const now = nowIso();
  const part = {
    id: newId(),
    category: input.category,
    label: input.label.trim(),
    quantity: Number.isInteger(input.quantity) && input.quantity > 0 ? input.quantity : 1,
    brand: input.brand || '',
    model: input.model || '',
    serial: input.serial || '',
    details: input.details ? { ...input.details } : {},
    link: normalizeLink(input.link),
    tags: input.tags ? [...input.tags] : [],
    notes: input.notes || '',
    location: null,
    retired: null,
    history: [],
    createdAt: now,
    updatedAt: now,
  };
  next.parts.push(part);

  if (dest.kind === 'box') {
    part.location = { kind: 'box', id: dest.id };
    part.history.push({ at: now, action: 'created', to: locationSnapshot(next, part.location) });
    return { state: next, result: { id: part.id } };
  }

  // Creating directly into a machine: reuse the move machinery, then relabel
  // the resulting history entry/entries as 'created' rather than 'moved'
  // since there was no prior location.
  const moved = movePart(next, part.id, dest, opts);
  const createdIds = moved.result.installed ? moved.result.installed.map((u) => u.id) : [part.id];
  for (const pid of createdIds) {
    const p = moved.state.parts.find((x) => x.id === pid);
    const entry = p.history.find((h) => h.action === 'moved' && h.from === null);
    if (entry) entry.action = 'created';
  }
  return { state: moved.state, result: { id: part.id, ...moved.result } };
}

export function updatePart(state, id, patch) {
  const next = clone(state);
  const part = next.parts.find((p) => p.id === id);
  if (!part) throw new Error(`Part not found: ${id}`);
  if ('category' in patch && !PART_CATEGORIES.includes(patch.category)) {
    throw new Error(`Unknown part category: ${patch.category}`);
  }
  if ('label' in patch && !(patch.label || '').trim()) throw new Error('Part label is required.');
  if ('quantity' in patch && (!Number.isInteger(patch.quantity) || patch.quantity < 1)) {
    throw new Error('Quantity must be a whole number, 1 or more.');
  }
  const allowed = ['category', 'label', 'quantity', 'brand', 'model', 'serial', 'details', 'link', 'tags', 'notes'];
  for (const key of allowed) {
    if (!(key in patch)) continue;
    if (key === 'link') part.link = normalizeLink(patch.link);
    else if (key === 'label') part.label = patch.label.trim();
    else part[key] = patch[key];
  }

  // A part installed in a build must still fit where it is: slot parts stay
  // quantity 1 in a compatible slot, and nothing can cross between slot and
  // non-slot categories without first going back to a box.
  if (part.location && part.location.kind === 'machine') {
    const machine = next.machines.find((m) => m.id === part.location.id);
    const slot = part.location.slotId && machine ? (machine.slots || []).find((s) => s.id === part.location.slotId) : null;
    if (slot) {
      if (!usesSlotSystem(part.category) || !compatibleSlotTypes(part).includes(slot.type)) {
        throw new Error(`That change doesn't fit ${slot.label}. Move the part to a box first.`);
      }
      if (part.quantity !== 1) {
        throw new Error('A part in a slot is a single item. Move it to a box to change the quantity.');
      }
    } else if (usesSlotSystem(part.category)) {
      throw new Error(`${CATEGORY_LABELS[part.category]} parts go in slots. Move this part to a box before changing its category.`);
    }
  }
  part.updatedAt = nowIso();
  return { state: next, result: {} };
}

export function deletePart(state, id) {
  const part = getPart(state, id);
  if (!part) throw new Error(`Part not found: ${id}`);
  const next = clone(state);
  const p = next.parts.find((x) => x.id === id);
  freeSlot(next, p);
  next.parts = next.parts.filter((x) => x.id !== id);
  return { state: next, result: {} };
}

// Splits `splitQty` units off a part into a new part record. The new part
// starts in the same box as the original (splitting a part that is
// installed in a machine slot is not supported — such parts always have
// quantity 1 by the time they're installed).
export function splitPart(state, id, splitQty) {
  const part = getPart(state, id);
  if (!part) throw new Error(`Part not found: ${id}`);
  if (part.retired) throw new Error('Cannot split a retired part.');
  if (part.location && part.location.kind === 'machine' && part.location.slotId) {
    throw new Error('Cannot split a part that is installed in a slot.');
  }
  if (!Number.isInteger(splitQty) || splitQty < 1 || splitQty >= part.quantity) {
    throw new Error('Split quantity must be at least 1 and less than the current quantity.');
  }
  const next = clone(state);
  const newPartId = splitOffUnits(next, id, splitQty);
  return { state: next, result: { newPartId } };
}

// Shared by splitPart and the automatic split on install. Mutates `next`.
// Per SPEC §4.4 the new part copies every field *and* the history so far,
// then both records get a "split" entry.
function splitOffUnits(next, id, qty) {
  const now = nowIso();
  const original = next.parts.find((p) => p.id === id);
  const newPart = {
    ...clone(original),
    id: newId(),
    quantity: qty,
    createdAt: now,
    updatedAt: now,
  };
  original.quantity -= qty;
  original.updatedAt = now;

  const snap = locationSnapshot(next, original.location);
  original.history.push({ at: now, action: 'split', into: newPart.id, quantity: qty });
  newPart.history.push({ at: now, action: 'split', from: original.id, to: snap });

  next.parts.push(newPart);
  return newPart.id;
}

// True when `destination` is where the part already is (same box, or the
// same build). Moving there is a no-op; Change slot handles slots in a build.
export function isAlreadyAt(part, destination) {
  return !!part.location && part.location.kind === destination.kind && part.location.id === destination.id;
}

// Moves a part to a box or into a build (optionally a specific slot).
// Handles: quantity>1 auto-split when the destination is a build and the
// category uses the slot system; auto-assignment; slot overflow.
// opts: { explicitSlotId, storageSlotType: 'm2' | 'sata' }.
// Moving a part to where it already is returns the *same* state object and
// `{ alreadyThere: true }`, so callers can skip it.
export function movePart(state, id, destination, opts = {}) {
  const part = getPart(state, id);
  if (!part) throw new Error(`Part not found: ${id}`);
  if (part.retired) throw new Error('Cannot move a retired part; restore it first.');
  if (destination.kind !== 'box' && destination.kind !== 'machine') {
    throw new Error(`Unknown destination kind: ${destination.kind}`);
  }
  if (destination.kind === 'box' && !getBox(state, destination.id)) {
    throw new Error(`Box not found: ${destination.id}`);
  }
  if (destination.kind === 'machine') {
    const m = getMachine(state, destination.id);
    if (!m) throw new Error(`Machine not found: ${destination.id}`);
    if (!isBuild(m)) throw new Error('Only builds can hold parts.');
  }
  if (!opts.explicitSlotId && isAlreadyAt(part, destination)) {
    return { state, result: { alreadyThere: true } };
  }

  let next = clone(state);

  if (destination.kind === 'box') {
    const p = next.parts.find((x) => x.id === id);
    const from = locationSnapshot(next, p.location); // snapshot before the old slot is freed/removed
    freeSlot(next, p);
    p.location = { kind: 'box', id: destination.id };
    const to = locationSnapshot(next, p.location);
    pushHistory(next, id, { action: 'moved', from, to });
    return { state: next, result: {} };
  }

  // destination.kind === 'machine'
  const p = next.parts.find((x) => x.id === id);
  const machineId = destination.id;

  if (usesSlotSystem(p.category) && p.quantity > 1 && !opts.explicitSlotId) {
    // Split into `quantity` single units and install each one.
    const originalQty = p.quantity;
    const unitIds = [p.id];
    for (let i = 1; i < originalQty; i += 1) {
      unitIds.push(splitOffUnits(next, p.id, 1));
    }
    const installed = [];
    const overflowMessages = [];
    for (const unitId of unitIds) {
      const unitPart = next.parts.find((x) => x.id === unitId);
      const info = installUnit(next, unitPart, machineId, { storageSlotType: opts.storageSlotType });
      installed.push({ id: unitId, slotId: info.slotId, slotLabel: info.slotLabel });
      if (info.overflow) overflowMessages.push(info.overflowMessage);
    }
    return {
      state: next,
      result: {
        split: true,
        count: originalQty,
        installed,
        overflowMessages,
        message: `Split ${originalQty} × ${p.label} into ${originalQty} separate parts, one per slot.`,
      },
    };
  }

  const info = installUnit(next, p, machineId, { explicitSlotId: opts.explicitSlotId, storageSlotType: opts.storageSlotType });
  return {
    state: next,
    result: {
      slotId: info.slotId,
      slotLabel: info.slotLabel,
      overflow: info.overflow,
      overflowMessage: info.overflowMessage,
      swappedPartId: info.swappedPartId,
    },
  };
}

// Installs a part into one specific empty slot (used by the "Install part
// here" picker on an empty-slot placeholder). If the part's quantity is
// greater than 1, only a single unit is split off and installed — the rest
// stays behind in its current location, unlike movePart's auto-assign path
// (which spreads a whole multi-quantity part across several slots).
export function installPartInSlot(state, partId, machineId, slotId) {
  const part = getPart(state, partId);
  if (!part) throw new Error(`Part not found: ${partId}`);
  if (part.retired) throw new Error('Cannot install a retired part; restore it first.');
  if (part.quantity > 1) {
    const { state: afterSplit, result: splitResult } = splitPart(state, partId, part.quantity - 1);
    const installed = movePart(afterSplit, partId, { kind: 'machine', id: machineId }, { explicitSlotId: slotId });
    return { state: installed.state, result: { ...installed.result, splitRemainderId: splitResult.newPartId } };
  }
  return movePart(state, partId, { kind: 'machine', id: machineId }, { explicitSlotId: slotId });
}

// Moves a part already installed in a build to a specific slot in the same
// build (swapping with any occupant).
export function changeSlot(state, partId, newSlotId) {
  const part = getPart(state, partId);
  if (!part) throw new Error(`Part not found: ${partId}`);
  if (!part.location || part.location.kind !== 'machine') {
    throw new Error('Part is not installed in a build.');
  }
  const machineId = part.location.id;
  const next = clone(state);
  const p = next.parts.find((x) => x.id === partId);
  const info = installUnit(next, p, machineId, { explicitSlotId: newSlotId });
  return { state: next, result: info };
}

// ---------------------------------------------------------------------------
// retiring / restoring
// ---------------------------------------------------------------------------

function normalizeRetireInfo(info) {
  if (!RETIRE_REASONS.includes(info.reason)) {
    throw new Error(`Unknown retirement reason: ${info.reason}`);
  }
  return {
    reason: info.reason,
    date: info.date || new Date().toISOString().slice(0, 10),
    price: info.price || '',
    notes: info.notes || '',
  };
}

export function retirePart(state, id, info) {
  const part = getPart(state, id);
  if (!part) throw new Error(`Part not found: ${id}`);
  if (part.retired) throw new Error('Part is already retired.');
  const retireInfo = normalizeRetireInfo(info);
  const next = clone(state);
  const p = next.parts.find((x) => x.id === id);
  const from = locationSnapshot(next, p.location); // snapshot before the slot is freed/removed
  freeSlot(next, p);
  p.retired = { ...retireInfo };
  p.location = null;
  pushHistory(next, id, { action: 'retired', from, reason: retireInfo.reason });
  return { state: next, result: {} };
}

export function restorePart(state, id, boxId = UNUSED_BOX_ID) {
  const part = getPart(state, id);
  if (!part) throw new Error(`Part not found: ${id}`);
  if (!part.retired) throw new Error('Part is not retired.');
  if (!getBox(state, boxId)) throw new Error(`Box not found: ${boxId}`);
  const next = clone(state);
  const p = next.parts.find((x) => x.id === id);
  const groupId = p.retired.groupId;
  p.retired = null;
  p.location = { kind: 'box', id: boxId };
  const to = locationSnapshot(next, p.location);
  pushHistory(next, id, { action: 'restored', to });

  if (groupId) {
    const stillInGroup = next.parts.some((x) => x.retired && x.retired.groupId === groupId);
    if (!stillInGroup) {
      next.retirementGroups = next.retirementGroups.filter((g) => g.id !== groupId);
    }
  }
  return { state: next, result: { groupId } };
}

export function retireDevice(state, id, info) {
  const machine = getMachine(state, id);
  if (!machine) throw new Error(`Machine not found: ${id}`);
  if (!isDevice(machine)) throw new Error('Only devices can be retired directly.');
  if (machine.retired) throw new Error('Device is already retired.');
  const retireInfo = normalizeRetireInfo(info);
  const next = clone(state);
  const m = next.machines.find((x) => x.id === id);
  m.retired = { ...retireInfo };
  m.updatedAt = nowIso();
  return { state: next, result: {} };
}

export function restoreDevice(state, id) {
  const machine = getMachine(state, id);
  if (!machine) throw new Error(`Machine not found: ${id}`);
  if (!machine.retired) throw new Error('Device is not retired.');
  const next = clone(state);
  const m = next.machines.find((x) => x.id === id);
  m.retired = null;
  m.updatedAt = nowIso();
  return { state: next, result: {} };
}

// Disassembles a build: every part (including the case) moves to a box, and
// the build record is deleted.
export function partOutBuild(state, buildId, destinationBoxId = UNUSED_BOX_ID) {
  const machine = getMachine(state, buildId);
  if (!machine) throw new Error(`Build not found: ${buildId}`);
  if (!isBuild(machine)) throw new Error('Only builds can be parted out.');
  if (!getBox(state, destinationBoxId)) throw new Error(`Box not found: ${destinationBoxId}`);

  let next = clone(state);
  const parts = partsInMachine(state, buildId);
  for (const part of parts) {
    ({ state: next } = movePart(next, part.id, { kind: 'box', id: destinationBoxId }));
  }
  next.machines = next.machines.filter((m) => m.id !== buildId);
  return { state: next, result: { partCount: parts.length } };
}

// Retires a whole build: every part is retired together under one
// retirement group, and the build record is deleted.
export function retireWholeBuild(state, buildId, info) {
  const machine = getMachine(state, buildId);
  if (!machine) throw new Error(`Build not found: ${buildId}`);
  if (!isBuild(machine)) throw new Error('Only builds can be retired whole.');
  const retireInfo = normalizeRetireInfo(info);

  const next = clone(state);
  const m = next.machines.find((x) => x.id === buildId);
  const { title, subtitle } = displayName(m, next.parts);
  const group = {
    id: newId(),
    machineSnapshot: {
      type: m.type,
      nickname: m.nickname,
      modelName: m.modelName,
      purpose: m.purpose,
      tags: [...m.tags],
      displayTitle: title,
      displaySubtitle: subtitle,
    },
    reason: retireInfo.reason,
    date: retireInfo.date,
    price: retireInfo.price,
    notes: retireInfo.notes,
  };
  next.retirementGroups.push(group);

  const parts = partsInMachine(state, buildId);
  for (const part of parts) {
    const p = next.parts.find((x) => x.id === part.id);
    const from = locationSnapshot(next, p.location); // snapshot before the slot is freed/removed
    freeSlot(next, p);
    p.retired = { ...retireInfo, groupId: group.id };
    p.location = null;
    pushHistory(next, part.id, { action: 'retired', from, reason: retireInfo.reason, group: title });
  }

  next.machines = next.machines.filter((x) => x.id !== buildId);
  return { state: next, result: { groupId: group.id, partCount: parts.length } };
}

// ---------------------------------------------------------------------------
// search / filter helpers
// ---------------------------------------------------------------------------

export function searchAll(state, query) {
  const q = query.trim().toLowerCase();
  if (!q) return { machines: [], parts: [], boxes: [] };

  const matches = (fields) => fields.some((s) => typeof s === 'string' && s.toLowerCase().includes(q));

  const machines = state.machines.filter((m) => {
    const { title, subtitle } = displayName(m, state.parts);
    return matches([title, subtitle, m.nickname, m.modelName, m.purpose, m.serial, m.specs, m.notes, ...(m.tags || [])]);
  });

  const parts = state.parts.filter((p) => matches([
    p.label, p.brand, p.model, p.serial, p.notes, CATEGORY_LABELS[p.category],
    ...Object.values(p.details || {}), ...(p.tags || []),
  ]));

  const boxes = state.boxes.filter((b) => {
    return [b.name, b.notes, ...(b.tags || [])].filter(Boolean).some((s) => s.toLowerCase().includes(q));
  });

  return { machines, parts, boxes };
}

export function allTags(state) {
  const set = new Set();
  for (const m of state.machines) for (const t of m.tags || []) set.add(t);
  for (const p of state.parts) for (const t of p.tags || []) set.add(t);
  for (const b of state.boxes) for (const t of b.tags || []) set.add(t);
  return [...set].sort();
}

// Returns, for a build, the free-slot count per defined slot type, e.g.
// { dimm: 2, m2: 1 }. Undefined types are omitted.
export function freeSlotCounts(state, machine) {
  const counts = {};
  for (const type of SLOT_TYPES) {
    if (!isSlotTypeDefined(machine, type)) continue;
    const slots = slotsOfType(machine, type);
    const free = slots.filter((s) => !slotOccupant(state, machine.id, s.id)).length;
    counts[type] = free;
  }
  return counts;
}

export function machinesWithFreeSlot(state, type) {
  return state.machines.filter((m) => isBuild(m) && (freeSlotCounts(state, m)[type] || 0) > 0);
}
