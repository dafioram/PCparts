// schema.js — pure validation and migration for the pc-inventory JSON format.
// No DOM or storage access here; see SPEC.md §11.

import {
  SCHEMA_VERSION, MACHINE_TYPES, MACHINE_STATUSES, PART_CATEGORIES, RETIRE_REASONS,
  SLOT_TYPES, UNUSED_BOX_ID, isBuild, usesSlotSystem, compatibleSlotTypes,
} from './model.js';

export { SCHEMA_VERSION };

function isString(x) {
  return typeof x === 'string';
}
function isArrayOfStrings(x) {
  return Array.isArray(x) && x.every(isString);
}
function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

const MACHINE_TEXT_FIELDS = ['nickname', 'modelName', 'purpose', 'serial', 'notes', 'link', 'specs'];
const PART_TEXT_FIELDS = ['brand', 'model', 'serial', 'notes', 'link'];

// Optional free-text fields may be missing or null (treated as empty), but
// anything else must be a string.
function checkTextFields(obj, fields, where, errors) {
  for (const f of fields) {
    if (obj[f] != null && !isString(obj[f])) errors.push(`${where}.${f} must be text.`);
  }
}

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

// Returns { valid, errors, migrated } where `migrated` is the (possibly
// version-migrated) data ready to become app state, only present when valid.
export function validateImport(raw) {
  const errors = [];

  if (!isPlainObject(raw)) {
    return { valid: false, errors: ['File is not a JSON object.'] };
  }
  if (raw.app !== 'pc-inventory') {
    return { valid: false, errors: ['This does not look like a PC Inventory export (missing or wrong "app" field).'] };
  }
  if (typeof raw.schemaVersion !== 'number' || !Number.isInteger(raw.schemaVersion) || raw.schemaVersion < 1) {
    return { valid: false, errors: ['Missing or invalid "schemaVersion".'] };
  }
  if (raw.schemaVersion > SCHEMA_VERSION) {
    return { valid: false, errors: ['This file is from a newer version of the app. Update the app before importing it.'] };
  }

  // Shape is checked before migrating so migrations can rely on arrays.
  validateCollections(raw, errors);
  if (errors.length > 0) return { valid: false, errors };

  let data;
  try {
    data = migrate(raw);
  } catch (e) {
    return { valid: false, errors: [`Could not migrate this file: ${e.message}`] };
  }

  validateShape(data, errors);
  if (errors.length > 0) return { valid: false, errors };

  return { valid: true, errors: [], migrated: data };
}

function validateCollections(data, errors) {
  if (!Array.isArray(data.machines)) errors.push('"machines" must be an array.');
  if (!Array.isArray(data.boxes)) errors.push('"boxes" must be an array.');
  if (!Array.isArray(data.parts)) errors.push('"parts" must be an array.');
  if (data.retirementGroups !== undefined && !Array.isArray(data.retirementGroups)) {
    errors.push('"retirementGroups" must be an array.');
  }
  if (data.meta !== undefined && data.meta !== null && !isPlainObject(data.meta)) {
    errors.push('"meta" must be an object.');
  }
}

function validateShape(data, errors) {
  const { machines, boxes, parts } = data;
  const groups = data.retirementGroups || [];

  // --- boxes ---
  const boxIds = new Set();
  let unusedCount = 0;
  for (const [i, box] of boxes.entries()) {
    const where = `boxes[${i}]`;
    if (!isPlainObject(box)) { errors.push(`${where} is not an object.`); continue; }
    if (!isString(box.id) || !box.id) errors.push(`${where}.id is required.`);
    else if (boxIds.has(box.id)) errors.push(`${where}.id "${box.id}" is not unique.`);
    else boxIds.add(box.id);
    if (!isString(box.name) || !box.name.trim()) errors.push(`${where}.name is required.`);
    checkTextFields(box, ['notes'], where, errors);
    if (box.tags != null && !isArrayOfStrings(box.tags)) errors.push(`${where}.tags must be a list of text tags.`);
    if (box.isDefault != null && typeof box.isDefault !== 'boolean') errors.push(`${where}.isDefault must be true or false.`);
    if (box.id === UNUSED_BOX_ID) {
      if (box.isDefault !== true) errors.push(`${where}: the box with id "unused" must have isDefault: true.`);
      unusedCount += 1;
    } else if (box.isDefault === true) {
      errors.push(`${where}: only the "unused" box can be the default box.`);
    }
  }
  if (unusedCount !== 1) errors.push('Exactly one box must have id "unused" and isDefault: true.');
  const nameCounts = new Map();
  for (const box of boxes) {
    if (!isPlainObject(box) || !isString(box.name)) continue;
    const key = box.name.trim().toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }
  for (const [name, count] of nameCounts.entries()) {
    if (count > 1) errors.push(`Box name "${name}" is used more than once.`);
  }

  // --- machines (and their slots) ---
  const machineIds = new Set();
  const buildIds = new Set();
  const slotTypeByKey = new Map(); // `${machineId}::${slotId}` -> slot type
  const allSlotIds = new Set();
  for (const [i, m] of machines.entries()) {
    const where = `machines[${i}]`;
    if (!isPlainObject(m)) { errors.push(`${where} is not an object.`); continue; }
    if (!isString(m.id) || !m.id) errors.push(`${where}.id is required.`);
    else if (machineIds.has(m.id)) errors.push(`${where}.id "${m.id}" is not unique.`);
    else machineIds.add(m.id);
    if (!MACHINE_TYPES.includes(m.type)) errors.push(`${where}.type "${m.type}" is not a recognized machine type.`);
    if (m.status != null && !MACHINE_STATUSES.includes(m.status)) {
      errors.push(`${where}.status "${m.status}" is not recognized.`);
    }
    checkTextFields(m, MACHINE_TEXT_FIELDS, where, errors);
    if (m.tags != null && !isArrayOfStrings(m.tags)) errors.push(`${where}.tags must be a list of text tags.`);
    if (m.notNeeded != null && !(isArrayOfStrings(m.notNeeded) && m.notNeeded.every((c) => PART_CATEGORIES.includes(c)))) {
      errors.push(`${where}.notNeeded must list part categories.`);
    }

    const build = MACHINE_TYPES.includes(m.type) && isBuild(m);
    if (m.retired != null) {
      if (build) errors.push(`${where}: builds are never retired (they are parted out or retired whole).`);
      else validateRetiredInfo(m.retired, `${where}.retired`, errors);
    }

    if (m.slots != null && !Array.isArray(m.slots)) {
      errors.push(`${where}.slots must be an array.`);
    } else if (Array.isArray(m.slots) && m.slots.length > 0) {
      if (!build) {
        errors.push(`${where}: devices have no slots.`);
      } else {
        for (const [j, s] of m.slots.entries()) {
          const swhere = `${where}.slots[${j}]`;
          if (!isPlainObject(s)) { errors.push(`${swhere} is not an object.`); continue; }
          if (!isString(s.id) || !s.id) errors.push(`${swhere}.id is required.`);
          else if (allSlotIds.has(s.id)) errors.push(`${swhere}.id "${s.id}" is used by more than one slot.`);
          else allSlotIds.add(s.id);
          if (!SLOT_TYPES.includes(s.type)) errors.push(`${swhere}.type "${s.type}" is not recognized.`);
          if (!isString(s.label) || !s.label.trim()) errors.push(`${swhere}.label is required.`);
          if (s.origin !== 'user' && s.origin !== 'auto') errors.push(`${swhere}.origin must be "user" or "auto".`);
          if (isString(s.id) && isString(m.id)) slotTypeByKey.set(`${m.id}::${s.id}`, s.type);
        }
      }
    }
    if (build && isString(m.id)) buildIds.add(m.id);
  }

  // --- retirement groups ---
  const groupIds = new Set();
  for (const [i, g] of groups.entries()) {
    const where = `retirementGroups[${i}]`;
    if (!isPlainObject(g)) { errors.push(`${where} is not an object.`); continue; }
    if (!isString(g.id) || !g.id) errors.push(`${where}.id is required.`);
    else if (groupIds.has(g.id)) errors.push(`${where}.id is not unique.`);
    else groupIds.add(g.id);
    if (!RETIRE_REASONS.includes(g.reason)) errors.push(`${where}.reason "${g.reason}" is not recognized.`);
    if (!isPlainObject(g.machineSnapshot)) errors.push(`${where}.machineSnapshot is required.`);
    checkTextFields(g, ['date', 'price', 'notes'], where, errors);
  }

  // --- parts ---
  const partIds = new Set();
  const slotOccupants = new Map(); // `${machineId}::${slotId}` -> count
  for (const [i, p] of parts.entries()) {
    const where = `parts[${i}]`;
    if (!isPlainObject(p)) { errors.push(`${where} is not an object.`); continue; }
    if (!isString(p.id) || !p.id) errors.push(`${where}.id is required.`);
    else if (partIds.has(p.id)) errors.push(`${where}.id "${p.id}" is not unique.`);
    else partIds.add(p.id);
    const knownCategory = PART_CATEGORIES.includes(p.category);
    if (!knownCategory) errors.push(`${where}.category "${p.category}" is not recognized.`);
    if (!isString(p.label) || !p.label.trim()) errors.push(`${where}.label is required.`);
    if (p.quantity !== undefined && (!Number.isInteger(p.quantity) || p.quantity < 1)) {
      errors.push(`${where}.quantity must be an integer >= 1.`);
    }
    checkTextFields(p, PART_TEXT_FIELDS, where, errors);
    if (p.tags != null && !isArrayOfStrings(p.tags)) errors.push(`${where}.tags must be a list of text tags.`);
    if (p.details != null && !isPlainObject(p.details)) errors.push(`${where}.details must be an object.`);
    if (p.history != null && !(Array.isArray(p.history) && p.history.every(isPlainObject))) {
      errors.push(`${where}.history must be a list of entries.`);
    }

    const hasLocation = p.location != null;
    const hasRetired = p.retired != null;
    if (hasLocation === hasRetired) {
      errors.push(`${where} must have exactly one of "location" or "retired".`);
    }

    if (hasLocation) validatePartLocation(p, where, { boxIds, buildIds, slotTypeByKey, slotOccupants, knownCategory }, errors);

    if (hasRetired) {
      validateRetiredInfo(p.retired, `${where}.retired`, errors);
      if (isPlainObject(p.retired) && p.retired.groupId != null && !groupIds.has(p.retired.groupId)) {
        errors.push(`${where}.retired.groupId points to a retirement group that does not exist.`);
      }
    }
  }
  for (const [key, count] of slotOccupants.entries()) {
    if (count > 1) errors.push(`Slot "${key}" is occupied by more than one part.`);
  }
}

function validatePartLocation(p, where, ctx, errors) {
  const loc = p.location;
  if (!isPlainObject(loc) || (loc.kind !== 'box' && loc.kind !== 'machine')) {
    errors.push(`${where}.location.kind must be "box" or "machine".`);
    return;
  }
  const hasSlotId = loc.slotId != null;
  if (loc.kind === 'box') {
    if (!ctx.boxIds.has(loc.id)) errors.push(`${where}.location points to a box that does not exist ("${loc.id}").`);
    if (hasSlotId) errors.push(`${where}.location.slotId must not be set for a box location.`);
    return;
  }

  if (!ctx.buildIds.has(loc.id)) {
    errors.push(`${where}.location points to a build that does not exist ("${loc.id}").`);
    return;
  }
  if (!ctx.knownCategory) return; // already reported
  if (!usesSlotSystem(p.category)) {
    if (hasSlotId) errors.push(`${where}.location.slotId must not be set for a ${p.category} part.`);
    return;
  }
  if (!hasSlotId) {
    errors.push(`${where}: a ${p.category} part in a build must be in a slot (location.slotId is missing).`);
    return;
  }
  const key = `${loc.id}::${loc.slotId}`;
  const slotType = ctx.slotTypeByKey.get(key);
  if (!slotType) {
    errors.push(`${where}.location.slotId does not exist on that build.`);
    return;
  }
  if (p.quantity !== undefined && p.quantity !== 1) {
    errors.push(`${where}: a part in a slot must have quantity 1.`);
  }
  const details = isPlainObject(p.details) ? p.details : {};
  if (!compatibleSlotTypes({ category: p.category, details }).includes(slotType)) {
    errors.push(`${where}: a ${p.category} part can't be in a ${slotType} slot.`);
  }
  ctx.slotOccupants.set(key, (ctx.slotOccupants.get(key) || 0) + 1);
}

function validateRetiredInfo(info, where, errors) {
  if (!isPlainObject(info)) {
    errors.push(`${where} must be an object.`);
    return;
  }
  if (!RETIRE_REASONS.includes(info.reason)) errors.push(`${where}.reason "${info.reason}" is not recognized.`);
  checkTextFields(info, ['date', 'price', 'notes'], where, errors);
}

// ---------------------------------------------------------------------------
// migrations
// ---------------------------------------------------------------------------

// vN -> vN+1 pure migration functions. None yet; framework is ready for the
// first format change.
const MIGRATIONS = {
  // 1: (data) => ({ ...data, schemaVersion: 2, /* ... */ }),
};

export function migrate(raw) {
  let data = raw;
  while (data.schemaVersion < SCHEMA_VERSION) {
    const step = MIGRATIONS[data.schemaVersion];
    if (!step) {
      throw new Error(`No migration available from schema version ${data.schemaVersion}.`);
    }
    data = step(data);
  }
  return normalizeShape(data);
}

// Missing or null text fields become '' so the rest of the app can rely on
// strings.
function withText(obj, fields) {
  const out = { ...obj };
  for (const f of fields) if (out[f] == null) out[f] = '';
  return out;
}

// Fills in any optional collections/fields so the rest of the app can rely
// on their presence.
function normalizeShape(data) {
  const now = new Date().toISOString();
  return {
    app: 'pc-inventory',
    schemaVersion: SCHEMA_VERSION,
    machines: (data.machines || []).map((m) => withText({
      ...m,
      notNeeded: m.notNeeded || [],
      slots: m.slots || [],
      retired: m.retired || null,
      tags: m.tags || [],
      status: m.status || 'active',
      createdAt: m.createdAt || now,
      updatedAt: m.updatedAt || now,
    }, MACHINE_TEXT_FIELDS)),
    boxes: (data.boxes || []).map((b) => withText({ ...b, tags: b.tags || [], isDefault: b.isDefault === true }, ['notes'])),
    parts: (data.parts || []).map((p) => withText({
      ...p,
      details: p.details || {},
      tags: p.tags || [],
      quantity: p.quantity || 1,
      history: p.history || [],
      retired: p.retired || null,
      location: p.location || null,
      createdAt: p.createdAt || now,
      updatedAt: p.updatedAt || now,
    }, PART_TEXT_FIELDS)),
    retirementGroups: data.retirementGroups || [],
    meta: { lastExportedAt: null, ...(data.meta || {}) },
  };
}

// ---------------------------------------------------------------------------
// export serialization
// ---------------------------------------------------------------------------

export function serializeForExport(state) {
  return {
    app: 'pc-inventory',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    machines: state.machines,
    boxes: state.boxes,
    parts: state.parts,
    retirementGroups: state.retirementGroups,
    meta: { ...(state.meta || {}), lastExportedAt: state.meta ? state.meta.lastExportedAt : null },
  };
}
