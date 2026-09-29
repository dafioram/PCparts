# PC Inventory — Specification

A fully static web app for tracking computers and the parts inside them: which machine has which GPU, which parts are sitting in which box, and what has died, been sold or given away. Hosted on GitHub Pages; all data lives in the browser and moves in and out as a single JSON file.

---

## 1. Goals and constraints

- **Fully static.** Plain HTML, CSS and JavaScript (ES modules), no build step, no server, no runtime dependencies. The app folder can be served as-is by GitHub Pages or any static host.
- **No network requests at runtime.** No CDNs, web fonts, analytics or APIs. Icons are bundled SVGs; fonts use the system font stack. The app works fully offline once loaded.
- **Browser storage** holds the working copy of the data.
- **JSON import/export** of *all* data is the backup and the way to move between devices.
- **Loose part descriptions.** "16GB DDR4" is a complete, valid part. Detail is optional and can be added later.
- **Easy moves.** Parts move between machines and boxes constantly; moving must be one or two taps, and the app must make it obvious where every part is right now.
- **Pretty and mobile-friendly.** Category icons, color coding, readable cards, works well on a phone.

---

## 2. Core concepts

Everything is modeled as **parts that live in locations**.

| Concept | Description |
|---|---|
| **Build** | A customizable machine (desktop, server) made of parts. It is a location. |
| **Device** | An atomic machine (laptop, mini PC, single-board computer like a Raspberry Pi). It records that you own it; it has no parts. |
| **Box** | A named storage location for parts not in a build, e.g. "Box 768". |
| **Unused** | The permanent default box. Cannot be renamed or deleted. |
| **Graveyard** | Not a location — a view of everything with a *retired* record (died, sold, given away, trashed, lost). |

Builds and devices together are called **machines**.

---

## 3. Machines

### 3.1 Common fields

| Field | Required | Notes |
|---|---|---|
| Type | yes | Build types: `desktop`, `server`. Device types: `laptop`, `mini-pc`, `sbc`, `other-device`. |
| Nickname | no | Primary display name, e.g. "Jellyfin Server". |
| Model name | no | Secondary name, e.g. "Optiplex 7040". See 3.3 for the auto-generated fallback. |
| Purpose | no | Free text, e.g. "Media server for the house, runs 24/7". |
| Status | yes | Manual: `active`, `standby`, `broken`. Default `active`. |
| Serial / service tag | no | Free text. |
| Tags | no | List of free-form strings (see §6). |
| Notes | no | Free text. |
| Link | no | A URL (manual, product page, listing). Displayed as a link; never fetched. |

### 3.2 Builds

- Contain parts (§4). Parts are listed grouped by category.
- Have individual **slots** for RAM, storage and PCIe cards (§3.5).
- Have **missing-part warnings** (§7).
- Can be **parted out** or **retired whole** (§8). Both delete the build record.
- An empty build (e.g. just created, no parts yet) can be deleted directly.

### 3.3 Display names

- Title: nickname if set, otherwise model name, otherwise the generated summary.
- Subtitle: model name if set (and different from the title), otherwise the generated summary.
- **Generated summary** (builds only): CPU label · total RAM · GPU label, skipping missing categories, e.g. `i5-6500 · 16GB DDR4 · GTX 1050`. Total RAM is summed from the sticks' capacities (§3.5, *Capacity totals*); if none can be read, the RAM labels are used instead. Empty build: "Empty desktop".

### 3.4 Devices

- Extra field: **Specs** — free text, e.g. "i7-1165G7, 16GB soldered, 512GB NVMe".
- No parts, no slots, no missing-part warnings. If a device's upgradable part was swapped (e.g. its SSD), note it in Specs; the removed part is added as a normal part in a box.
- Can be **retired directly** to the graveyard (§8.3). The device record is kept with its retired record.
- Can be deleted outright (for entries made by mistake), with confirmation.

### 3.5 Slots (builds only)

Builds have **individual slots**, each holding at most one part: two 8GB sticks occupy two DIMM slots, never one "2 × 8GB" entry. Setting up slots is optional — installing a part creates a slot automatically when needed.

**Slot types**

| Slot type | Used by |
|---|---|
| `dimm` | RAM |
| `m2` | Storage of kind NVMe or M.2 SATA |
| `sata` | Storage of kind SATA SSD or HDD |
| `pcie-x16` | GPUs; expansion cards when no x1 slot is free |
| `pcie-x1` | Expansion cards (preferred) |

Other categories (CPU, motherboard, PSU, case, cooler, fan, other) don't use slots and are listed normally; they may keep a quantity > 1 (e.g. "3 × 120mm fans"). If a storage part's kind is blank or "other", the app asks "M.2 or SATA?" when installing it.

**Slot fields**

- `id`
- `type` — from the table above
- `label` — location description. Defaults to "DIMM 1", "M.2 1", "SATA 1", "PCIe x16 1", "PCIe x1 1"; editable, e.g. "DIMM A2", "M.2 under heatsink", "SATA port 3 (bottom)".
- `origin` — `user` (set up by the user) or `auto` (created by the app to hold a part)

**Setting up slots**

- **Set slots** per type: enter a count (e.g. DIMM × 4) and the app adds slots up to that count. It never removes occupied slots.
- Individual slots can be added, relabeled, and removed (only when empty).
- Any user edit to a type's slots marks all slots of that type as `user`.

**Defined vs. undefined slot types**

- A slot type is **defined** for a build when it has at least one `user` slot. Only defined types show free/full, e.g. "2 of 4 DIMM slots free".
- An **undefined** type just lists what's installed. Its `auto` slots are removed automatically when emptied, so they never show as free.

**Installing a part** (adding a new part to a build, or moving one in):

1. **Quantity > 1** — the part is split into single parts (§4.4), each installed separately; a toast says so, e.g. "Split 2 × 8GB DDR4 into 2 sticks."
2. **Auto-assign** — each part goes into the first empty compatible slot, in slot order. Expansion cards try `pcie-x1` before `pcie-x16`; GPUs only use `pcie-x16`.
3. **No empty compatible slot:**
   - Undefined type: an `auto` slot is created silently.
   - Defined type: a new `user` slot is created and a toast says "All 4 DIMM slots were full, so a 5th was added." with **Undo**.
4. **Change slot** — a part can be moved to a specific slot in the same build. If that slot holds another compatible part, the two swap.

**Removing a part** from a build leaves its slot empty in a defined type (the slot is physically still there); in an undefined type the `auto` slot is removed.

**Display** (build detail)

- Slot-using parts are grouped into collapsible sections: **Memory**, **Storage** (M.2 and SATA sub-groups), **PCIe**. Each part row shows its slot label.
- Each section header shows a summary, e.g. "Memory — 32GB DDR4 · 4 of 4 slots used", "Storage — 2.5TB · 3 drives · 1 M.2 free".
- Memory is collapsed by default (sticks are repetitive); the others are expanded. Collapse state is remembered per viewer as a UI preference.
- Empty slots show as dashed placeholders with **Install part here**, which opens a picker of compatible parts from boxes (with their box shown) or lets you add a new part.

**Capacity totals** sum each part's `details.capacity`, or a size read from its label (e.g. "8GB", "1TB") if capacity is blank. Parts whose size can't be read are left out and noted, e.g. "24GB (+1 unknown)".

**Finding free slots:** the Machines view can filter to builds with a free slot of a given type ("which PC has a free M.2?"). Only defined types count.

---

## 4. Parts

### 4.1 Categories

Each category has its own icon and color.

`cpu`, `motherboard`, `ram`, `gpu`, `storage`, `psu`, `case`, `cooler`, `fan`, `expansion` (NIC, Wi-Fi, capture card, etc.), `other`.

### 4.2 Fields

| Field | Required | Notes |
|---|---|---|
| Category | yes | From 4.1. |
| Label | yes | Short description, e.g. "16GB DDR4", "RTX 3060", "1TB NVMe". |
| Quantity | yes | Integer ≥ 1, default 1. "4 × 4GB DDR3" can be one entry in a box; slot-using parts are split to one per slot when installed in a build (§3.5). |
| Brand | no | |
| Model | no | |
| Serial | no | |
| Details | no | Optional category-specific fields (4.3). |
| Link | no | URL, never fetched. |
| Tags | no | |
| Notes | no | |

### 4.3 Optional category details

All optional; shown as suggested fields in the edit form for that category. Anything not covered goes in Notes.

| Category | Suggested fields |
|---|---|
| ram | capacity (per stick), generation (DDR2/3/4/5), speed |
| storage | capacity, kind (NVMe / M.2 SATA / SATA SSD / HDD / other) — kind decides the slot type |
| gpu | VRAM |
| psu | wattage, form factor |
| motherboard | form factor, socket |
| case | form factor (ATX, mATX, ITX, SFF, tower, other), description (e.g. "black, glass side panel") |
| cpu | cores/threads, socket |

### 4.4 Splitting

A part with quantity > 1 can be **split**: choose how many to split off; the new part copies all fields and history and can then be moved separately. Splitting also happens automatically when a multi-quantity slot-using part is installed in a build (§3.5). Parts are never merged automatically when they return to a box.

### 4.5 Location and status

Every part is in exactly one of these states:

- **In a build** → derived status **In Use**
- **In a box** (Unused or named) → derived status **Unused**
- **Retired** → derived status **Removed**, with its retired reason

Part status is **always derived**, never set by hand, so it can never contradict where the part is.

### 4.6 Moving

- Every part has a **Move to…** action listing all builds and boxes (searchable). No drag and drop required.
- **Bulk move:** select multiple parts in any list and move them together.
- Moving a slot-using part into a build follows the installing rules in §3.5 (split, auto-assign, overflow notice). **Change slot** moves it within the same build.
- Moving is allowed from any location to any other; retired parts must be restored first (§8.4).

### 4.7 History

Each part keeps an append-only history:

- created (with initial location)
- moved (from → to)
- retired (reason)
- restored (to location)
- split (from/into)

Each entry stores a timestamp and a **snapshot of location names**, including the slot label when there is one (e.g. "Jellyfin Server (Optiplex 7040) · DIMM 2"), so history stays readable after a build is deleted. Slot changes within a build are recorded as moves. Shown as a timeline on the part's detail screen.

### 4.8 Deleting parts

Deletion (removing the record entirely) is for entries made by mistake and requires confirmation. Anything that physically left your possession should be retired instead, which keeps the record.

---

## 5. Boxes

- **Unused** always exists, is listed first and cannot be renamed or deleted.
- Named boxes can be created, renamed, and deleted.
- Deleting a box that still holds parts moves those parts to Unused (with history entries), after confirmation.
- Fields: name (required, unique), notes, tags.

---

## 6. Tags

- Free-form strings on machines, parts and boxes (e.g. "for sale", "needs testing", "spare").
- The tag input suggests existing tags.
- Tags are filterable everywhere and searchable.
- A tag disappears from suggestions when nothing uses it.

---

## 7. Missing-part warnings (builds only)

A build shows a warning badge for each **expected category** with no part assigned:

- Required: `cpu`, `motherboard`, `ram`, `storage`, `psu`, `gpu`.
- Each required category has a per-build **"Integrated / not needed"** checkbox that clears the warning. Examples: integrated graphics, soldered RAM, a headless server with no GPU.
- `case`, `cooler`, `fan`, `expansion`, `other` never warn.
- Warnings appear on the build card (compact badges) and on the build detail screen (full text, e.g. "No PSU assigned").
- The machines list can be filtered to "builds with warnings".

---

## 8. Retiring and the graveyard

### 8.1 Part out a build

For disassembling a machine into storage.

1. Choose a destination box (default: Unused).
2. Confirmation screen lists every part that will move, including the case.
3. On confirm: all parts move to the box (history entries recorded), then the build record is deleted.

### 8.2 Retire a whole build

For selling or giving away a complete machine.

1. Enter reason (died / sold / given away / trashed / lost), date (default today), optional price, optional notes.
2. Confirmation screen lists every part that will be retired.
3. On confirm: every part is retired with the same details, linked to a **retirement group** that stores a snapshot of the build's display names, type, purpose and tags. The build record is deleted.
4. The graveyard shows the group as a single entry, "Retired together as Jellyfin Server (Optiplex 7040)", expandable to its parts.

### 8.3 Retire a single part or device

From a part (in any build or box) or a device: enter reason, date, optional price, optional notes. A part leaves its location; a device stays as a record marked retired.

### 8.4 Restore

Any retired part or device can be restored (mistake, sale fell through). A part is restored to a chosen box. Restoring one part from a retirement group removes it from the group; the group entry disappears when empty.

### 8.5 Graveyard view

Lists retired parts, retired devices and retirement groups, newest first, filterable by reason, category, tag and date. Retired items are excluded from normal views and totals but included in search (clearly marked as retired).

---

## 9. Views and navigation

Mobile-first; bottom navigation on small screens, sidebar on wide screens.

| View | Contents |
|---|---|
| **Machines** | Cards for builds and devices. Card: icon, title, subtitle, purpose, status chip, tags, a row of category icons for installed parts, warning badges. Filters: type, status, tag, has warnings, has a free slot of a given type. |
| **Machine detail** | All fields; slot sections (Memory, Storage, PCIe) with summaries, empty-slot placeholders and "Set slots"; other parts grouped by category; Move / Change slot / Retire per part; bulk select; warnings; "Add part", "Part out", "Retire whole build". |
| **Boxes** | Unused first, then named boxes, each with part count and category icons. Box detail lists parts with Move/Retire and bulk select. |
| **All parts** | Every active part with its location, filterable by category, location, tag, status. |
| **Graveyard** | See 8.5. |
| **Data** | Export, import, storage status, last-export info. |
| **Global search** | Always reachable. Matches labels, brand, model, serial, notes, tags, nicknames, model names, purposes, box names. Results show icon, name and current location. |

**Undo:** every state-changing action shows a toast with **Undo**. The app keeps an in-memory stack of the last 20 states (session only, not persisted, not exported).

**Theme:** follows the system light/dark preference.

**Accessibility:** all actions keyboard-reachable, icons have text labels or accessible names, color is never the only signal (warnings use icon + text).

---

## 10. Storage and persistence

- The working copy is stored in `localStorage` under the key `pc-inventory`, in the same shape as the export file (§11). The data is text-only, well within `localStorage` limits.
- Saved immediately after every change.
- On first save, the app calls `navigator.storage.persist()` to ask the browser not to evict the data. The Data view shows whether persistence was granted.
- If `localStorage` is unavailable (e.g. some private modes), the app still works in memory and shows a persistent banner: "Data will not be saved. Export before closing."
- **Export nudge:** the app records `lastExportedAt` and whether data changed since. If there are unexported changes and the last export is older than 14 days (or never happened), show a dismissible banner. Browsers can clear site data (Safari may clear it after about 7 days without a visit), so the exported JSON is the real source of truth.

---

## 11. Import and export

### 11.1 Export

- One button downloads all data as `pc-inventory-YYYY-MM-DD.json`.
- Includes machines, boxes, parts (with history), retirement groups, and metadata. Excludes the undo stack and UI preferences.
- Updates `lastExportedAt`.

### 11.2 Import

1. User picks a file.
2. The app parses and **fully validates it before touching anything** (11.4). If invalid, show the errors and change nothing.
3. Show a warning with a summary: "This will **replace all current data** (X machines, Y parts, Z boxes) with the file's data (A machines, B parts, C boxes). This cannot be undone."
4. On confirm: if current data is non-empty, **automatically download a backup** of it first (`pc-inventory-backup-before-import-YYYY-MM-DD-HHMM.json`), then replace everything and save.
5. Clear the undo stack.

### 11.3 File format

```json
{
  "app": "pc-inventory",
  "schemaVersion": 1,
  "exportedAt": "2026-09-22T17:40:00.000Z",
  "machines": [
    {
      "id": "uuid",
      "type": "desktop",
      "nickname": "Jellyfin Server",
      "modelName": "Optiplex 7040",
      "purpose": "Media server",
      "status": "active",
      "serial": "",
      "tags": ["always-on"],
      "notes": "",
      "link": "",
      "notNeeded": ["gpu"],
      "slots": [
        { "id": "uuid", "type": "dimm", "label": "DIMM 1", "origin": "user" },
        { "id": "uuid", "type": "dimm", "label": "DIMM 2", "origin": "user" },
        { "id": "uuid", "type": "m2", "label": "M.2 under heatsink", "origin": "user" }
      ],
      "specs": "",
      "retired": null,
      "createdAt": "ISO-8601",
      "updatedAt": "ISO-8601"
    }
  ],
  "boxes": [
    { "id": "unused", "name": "Unused", "isDefault": true, "notes": "", "tags": [] },
    { "id": "uuid", "name": "Box 768", "isDefault": false, "notes": "", "tags": [] }
  ],
  "parts": [
    {
      "id": "uuid",
      "category": "ram",
      "label": "8GB DDR4",
      "quantity": 1,
      "brand": "", "model": "", "serial": "",
      "details": { "capacity": "8GB", "generation": "DDR4" },
      "link": "", "tags": [], "notes": "",
      "location": { "kind": "machine", "id": "uuid", "slotId": "uuid" },
      "retired": null,
      "history": [
        { "at": "ISO-8601", "action": "created", "to": { "kind": "box", "id": "unused", "name": "Unused" } }
      ],
      "createdAt": "ISO-8601",
      "updatedAt": "ISO-8601"
    }
  ],
  "retirementGroups": [
    {
      "id": "uuid",
      "machineSnapshot": { "type": "desktop", "nickname": "Old Gaming PC", "modelName": "", "purpose": "", "tags": [] },
      "reason": "sold",
      "date": "2026-09-01",
      "price": "150",
      "notes": "Facebook Marketplace"
    }
  ],
  "meta": { "lastExportedAt": "ISO-8601 or null" }
}
```

Field rules:

- IDs are `crypto.randomUUID()` strings, except the Unused box, whose ID is always `"unused"`.
- `location` is `{ "kind": "machine" | "box", "id": string, "slotId"?: string }` or `null`. `slotId` is present only for slot-using parts in a build.
- `slots` (builds only) is an ordered list; order is display order and auto-assign order. Slot `type` is one of `dimm`, `m2`, `sata`, `pcie-x16`, `pcie-x1`; `origin` is `user` or `auto`.
- `retired` is `null` or `{ "reason", "date", "price", "notes", "groupId" }` (`groupId` optional, parts only).
- `notNeeded` (builds only) lists categories whose missing-part warning is cleared.
- `specs` and `retired` are used only on devices; builds are never retired (they are deleted).
- Retirement reasons: `died`, `sold`, `given-away`, `trashed`, `lost`.

### 11.4 Validation

Import is rejected if any of these fail:

- `app` is `"pc-inventory"` and `schemaVersion` is a supported number. Newer than the app supports → reject with "This file is from a newer version." Older → run migrations in order.
- All required fields are present with valid types and enum values.
- IDs are unique within each collection.
- Exactly one box has `id: "unused"` and `isDefault: true`.
- Every part has **exactly one** of `location` or `retired`.
- Every `location` points to an existing build (not a device) or box.
- Every slot-using part in a build has a `slotId` pointing to a slot in that same build, of a compatible type; no two parts share a slot; such parts have quantity 1.
- Parts in boxes, and non-slot parts in builds, have no `slotId`.
- Slot IDs are unique; devices have no slots.
- Every `groupId` points to an existing retirement group.
- Box names are unique.

### 11.5 Migrations

`schemaVersion` starts at 1. Any change to the format bumps it and adds a pure migration function `vN → vN+1`. Migrations are applied on import and when loading from `localStorage`.

---

## 12. Visual design

- **Icons:** a custom bundled SVG set, one per part category plus machine types (desktop, server, laptop, mini PC, SBC) and box, graveyard, warning, tag. Consistent stroke style, stored as an inline sprite.
- **Category colors:** each category has a distinct accent color used on its icon and chips, tuned for both light and dark themes with sufficient contrast.
- **Cards** with clear hierarchy: title, subtitle, status chip, icon row, warnings.
- **Graveyard** styling is muted (desaturated) to set it apart.
- Empty states with a helpful next action, e.g. "No parts in Box 768 yet — move some here".

---

## 13. Architecture

```
app/
  index.html
  styles.css
  icons.svg
  js/
    main.js          UI bootstrap and routing
    ui/              view rendering and event handling (DOM only)
    model.js         pure state functions: add/edit/move/split/retire/restore/part-out, derived status, warnings, display names
    schema.js        validation and migrations (pure)
    storage.js       localStorage load/save, persist() request
    io.js            export download and import file reading
tests/
  unit/              node:test tests for model.js and schema.js
  e2e/               Playwright tests against the served app
  fixtures/          sample JSON files (valid, invalid, old-version)
.github/workflows/
  test.yml
  deploy.yml
.gitignore
package.json         dev dependencies and scripts only
README.md
SPEC.md
```

- All business logic lives in **pure functions** (`model.js`, `schema.js`) that take state and return new state, with no DOM or storage access, so they are fully unit-testable and make undo trivial.
- The UI renders from state and dispatches actions; every action goes through one `commit(newState)` that pushes undo, saves and re-renders.
- `package.json` exists only for dev tooling; the app itself ships with zero dependencies.

---

## 14. Repository requirements

### 14.1 `.gitignore`

Must include at least:

```
# Dependencies
node_modules/

# Test output
test-results/
playwright-report/
blob-report/
playwright/.cache/
coverage/

# Personal inventory exports — never commit real data
pc-inventory-*.json

# OS / editor
.DS_Store
Thumbs.db
*.swp
.idea/
.vscode/

# Logs and env
*.log
npm-debug.log*
.env
```

Test fixtures live in `tests/fixtures/` with names that don't match `pc-inventory-*.json` so they are committed normally.

### 14.2 Tests

**Unit tests** — Node's built-in test runner (`node --test`), no extra framework. Cover `model.js` and `schema.js`:

- adding/editing machines, parts, boxes
- moving (single and bulk) and history entries with name snapshots
- splitting quantities
- slots: auto-assign to first empty compatible slot; expansion cards prefer x1; GPUs only x16; auto-split of multi-quantity parts on install; silent auto slot in undefined types; overflow slot plus notice in defined types; "Set slots" never removes occupied slots; auto slots removed when emptied; user slots kept empty; change slot and swap; storage with blank kind requires a slot-type choice
- capacity totals and label parsing ("8GB", "1TB", unreadable labels)
- free-slot counts only for defined types
- derived part status for all three states
- missing-part warnings, including `notNeeded`
- generated display names and summaries
- part out (parts moved, build deleted, history correct)
- retire whole build (group created, all parts retired, build deleted)
- retire and restore parts and devices; group cleanup when emptied
- deleting a box moves its parts to Unused; Unused cannot be deleted or renamed
- validation: every rule in 11.4 has a passing and a failing case
- export → import round trip produces identical data
- migrations (once a v2 exists)

**End-to-end tests** — Playwright, against the app served by a small static server started by Playwright's `webServer` config. Cover:

- create a build, add parts, see warnings appear and clear
- set up 4 DIMM slots, install a 2 × 8GB part, see it split into two sticks and "2 of 4 slots free"; fill all slots and see the overflow notice and Undo
- relabel a slot; change slot and swap two sticks; install into an empty slot from its placeholder
- Memory section collapses and shows the total
- mark a category "not needed"
- move a part between builds and boxes via Move to…
- bulk move
- part out a build into a named box
- retire a whole build; verify the graveyard group
- retire and restore a single part
- search finds a part and shows its location
- tags: add, filter
- undo after a move
- data persists across page reload
- export downloads valid JSON
- import: invalid file shows errors and changes nothing; valid file shows the replace warning, downloads a backup, and replaces data
- mobile viewport smoke test

**Headless and headed:**

- `npm test` runs unit tests then E2E headless.
- `npm run test:unit`, `npm run test:e2e` (headless), `npm run test:e2e:headed` (headed).
- Playwright projects: Chromium, Firefox, WebKit, plus a mobile-viewport Chromium project.

**GitHub Actions (`.github/workflows/test.yml`):**

- Runs on push and pull request to `main`.
- Unit test job on Node LTS.
- E2E job with a matrix `mode: [headless, headed]`:
  - installs dependencies and browsers with `npx playwright install --with-deps`
  - headless: `npx playwright test`
  - headed: `xvfb-run --auto-servernum npx playwright test --headed` (virtual display on the Linux runner)
- On failure, uploads the Playwright HTML report and traces as workflow artifacts.
- All jobs must pass on GitHub before merging.

**Deploy (`.github/workflows/deploy.yml`):**

- On push to `main`, after the test workflow succeeds, deploys the `app/` folder to GitHub Pages using the official Pages actions. Only `app/` is published.

### 14.3 `README.md`

Must include:

1. What the app is, in two or three sentences, with a link to the live GitHub Pages site.
2. A screenshot or two.
3. Feature list.
4. **Privacy and backups:** data stays in your browser and never leaves your device; browsers can clear site data; export regularly; importing replaces everything (a backup is downloaded automatically first).
5. How to use: adding machines and parts, moving parts, part out vs retire, graveyard, import/export.
6. Local development: serve `app/` with any static server (e.g. `npx http-server app`), no build step.
7. Running tests: install, unit, E2E headless, E2E headed.
8. Deploying: enabling GitHub Pages with "GitHub Actions" as the source.
9. JSON format: short summary with a link to SPEC.md §11.

---

## 15. Out of scope

- QR codes and printable labels
- Peripherals (monitors, keyboards, mice, etc.)
- Compatibility checking (sockets, RAM generations, PSU wattage)
- Any web lookups: spec autofill, pricing, images
- Accounts, cloud sync, multi-user
- Photos (possible future version; would require IndexedDB and larger exports)
- Retiring a build without its parts (builds are always parted out or retired whole)
