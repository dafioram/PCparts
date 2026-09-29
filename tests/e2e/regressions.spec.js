// Regression tests for problems found in review. Each test names the
// behavior it guards.
import {
  test, expect, seed, storedState, modal, submitModal, modalBackdrop, expectPage,
} from './fixtures.js';

const partIn = (state, label) => state.parts.find((p) => p.label === label);
const boxNamed = (state, name) => state.boxes.find((b) => b.name === name);

test('a selection made in one box does not carry over to another box', async ({ page }) => {
  await seed(page, (M) => {
    let s = M.createInitialState();
    let r = M.addBox(s, { name: 'Box A' }); s = r.state; const a = r.result.id;
    r = M.addBox(s, { name: 'Box B' }); s = r.state; const b = r.result.id;
    s = M.addPart(s, { category: 'fan', label: 'A1' }, { kind: 'box', id: a }).state;
    s = M.addPart(s, { category: 'fan', label: 'A2' }, { kind: 'box', id: a }).state;
    return M.addPart(s, { category: 'fan', label: 'B1' }, { kind: 'box', id: b }).state;
  });
  await page.goto('/#/boxes');
  await expectPage(page, 'Boxes');
  await page.locator('.card', { hasText: 'Box A' }).click();
  await page.getByRole('checkbox', { name: 'Select A1' }).click();
  await page.getByRole('checkbox', { name: 'Select A2' }).click();
  await expect(page.locator('.selection-bar')).toContainText('2 selected');

  await page.goto('/#/boxes');
  await expectPage(page, 'Boxes');
  await page.locator('.card', { hasText: 'Box B' }).click();
  await expectPage(page, 'Box B');
  await expect(page.locator('.selection-bar')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Select B1' })).not.toBeChecked();

  // Back in Box A the old selection is gone too — nothing stale to act on.
  await page.goto('/#/boxes');
  await expectPage(page, 'Boxes');
  await page.locator('.card', { hasText: 'Box A' }).click();
  await expectPage(page, 'Box A');
  await expect(page.locator('.selection-bar')).toHaveCount(0);
});

test('only the newest toast offers Undo, and it undoes that action', async ({ page }) => {
  await seed(page, (M) => {
    let s = M.createInitialState();
    const r = M.addMachine(s, { type: 'desktop', nickname: 'Rig' }); s = r.state;
    s = M.addPart(s, { category: 'cpu', label: 'Alpha' }, { kind: 'machine', id: r.result.id }).state;
    return M.addPart(s, { category: 'psu', label: 'Beta' }, { kind: 'machine', id: r.result.id }).state;
  });
  await page.locator('.card', { hasText: 'Rig' }).click();
  for (const label of ['Alpha', 'Beta']) {
    await page.locator('#view .part-row', { hasText: label }).getByRole('button', { name: 'Move to…' }).click();
    await modal(page).locator('.picker-item', { hasText: 'Unused' }).click();
  }
  const alphaToast = page.locator('.toast', { hasText: 'Moved Alpha' });
  const betaToast = page.locator('.toast', { hasText: 'Moved Beta' });
  await expect(alphaToast).toBeVisible();
  await expect(alphaToast.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  await betaToast.getByRole('button', { name: 'Undo' }).click();

  let s = await storedState(page);
  expect(partIn(s, 'Beta').location.kind).toBe('machine');
  expect(partIn(s, 'Alpha').location.kind).toBe('box');

  // The top-bar Undo keeps going back through earlier changes.
  await page.locator('#undo-btn').click();
  s = await storedState(page);
  expect(partIn(s, 'Alpha').location.kind).toBe('machine');
  await expect(page.locator('#undo-btn')).toBeHidden();
});

test('Escape closes a dialog even after typing in it', async ({ page }) => {
  await page.goto('/#/parts');
  await expectPage(page, 'All Parts');
  await page.getByRole('button', { name: 'Add part' }).click();
  await modal(page).getByLabel('Label').pressSequentially('abc');
  await page.keyboard.press('Escape');
  await expect(modalBackdrop(page)).toHaveCount(0);
});

test('Move to… never offers the place the part already is', async ({ page }) => {
  await seed(page, (M) => {
    let s = M.createInitialState();
    let r = M.addMachine(s, { type: 'desktop', nickname: 'Rig' }); s = r.state;
    s = M.setSlotCount(s, r.result.id, 'dimm', 2).state;
    s = M.addPart(s, { category: 'ram', label: '8GB', quantity: 2 }, { kind: 'machine', id: r.result.id }).state;
    s = M.addMachine(s, { type: 'desktop', nickname: 'Other Rig' }).state;
    r = M.addBox(s, { name: 'Shelf' }); s = r.state;
    return M.addPart(s, { category: 'fan', label: 'Fan' }, { kind: 'box', id: r.result.id }).state;
  });
  // ("No Motherboard" contains "other", so match the exact title.)
  await page.locator('.card').filter({ has: page.locator('.card-title', { hasText: /^Rig$/ }) }).click();
  await page.locator('[data-section="memory"] .section-header').click();
  await page.locator('#view .part-row').first().getByRole('button', { name: 'Move to…' }).click();
  const titles = await modal(page).locator('.picker-item-title').allTextContents();
  expect(titles).toContain('Other Rig');
  expect(titles).not.toContain('Rig');

  await page.goto('/#/boxes');
  await expectPage(page, 'Boxes');
  await page.locator('.card', { hasText: 'Shelf' }).click();
  await page.locator('#view .part-row', { hasText: 'Fan' }).getByRole('button', { name: 'Move to…' }).click();
  expect(await modal(page).locator('.picker-item-title').allTextContents()).not.toContain('Shelf');
});

test('the move picker is keyboard friendly: Enter picks the first match', async ({ page }) => {
  await seed(page, (M) => {
    let s = M.createInitialState();
    s = M.addBox(s, { name: 'Shelf B3' }).state;
    return M.addPart(s, { category: 'fan', label: 'Fan' }).state;
  });
  await page.goto('/#/parts');
  await expectPage(page, 'All Parts');
  await page.locator('#view .part-row', { hasText: 'Fan' }).getByRole('button', { name: 'Move to…' }).click();
  const search = modal(page).getByLabel('Move to…');
  await expect(search).toBeFocused();
  await search.fill('shelf');
  await search.press('Enter');
  await expect(page.locator('.toast', { hasText: 'Moved Fan to Shelf B3' })).toBeVisible();
});

test('section headers are buttons that toggle from the keyboard', async ({ page }) => {
  await seed(page, (M) => M.addMachine(M.createInitialState(), { type: 'desktop', nickname: 'Rig' }).state);
  await page.locator('.card', { hasText: 'Rig' }).click();
  const header = page.locator('[data-section="memory"]').getByRole('button', { name: /Memory/ });
  await header.focus();
  await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-section="memory"]')).not.toHaveClass(/collapsed/);
});

test('a mistaken part can be deleted (with confirmation) and the delete can be undone', async ({ page }) => {
  await seed(page, (M) => M.addPart(M.createInitialState(), { category: 'cpu', label: 'Typo part' }).state);
  await page.goto('/#/parts');
  await expectPage(page, 'All Parts');
  await page.locator('#view .part-row', { hasText: 'Typo part' }).getByRole('button', { name: 'Edit' }).click();
  await modal(page).getByRole('button', { name: 'Delete…' }).click();
  await expect(modal(page)).toContainText('retire it instead');
  await modal(page).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('#view .part-row', { hasText: 'Typo part' })).toHaveCount(0);

  await page.locator('.toast', { hasText: 'Deleted Typo part' }).getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#view .part-row', { hasText: 'Typo part' })).toBeVisible();
});

test('a part saved with the wrong category can be fixed', async ({ page }) => {
  await seed(page, (M) => M.addPart(M.createInitialState(), { category: 'cpu', label: 'ASUS B650' }).state);
  await page.goto('/#/parts');
  await expectPage(page, 'All Parts');
  await page.locator('#view .part-row', { hasText: 'ASUS B650' }).getByRole('button', { name: 'Edit' }).click();
  await modal(page).getByLabel('Category').selectOption('motherboard');
  await modal(page).getByLabel('Socket (optional)').fill('AM5');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);
  const s = await storedState(page);
  expect(partIn(s, 'ASUS B650').category).toBe('motherboard');
  expect(partIn(s, 'ASUS B650').details).toEqual({ socket: 'AM5' });
});

test('an installed RAM stick cannot change category; a CPU in a build can become a motherboard', async ({ page }) => {
  await seed(page, (M) => {
    let s = M.createInitialState();
    const r = M.addMachine(s, { type: 'desktop', nickname: 'Rig' }); s = r.state;
    s = M.addPart(s, { category: 'ram', label: 'Stick' }, { kind: 'machine', id: r.result.id }).state;
    return M.addPart(s, { category: 'cpu', label: 'Board saved as CPU' }, { kind: 'machine', id: r.result.id }).state;
  });
  await page.locator('.card', { hasText: 'Rig' }).click();
  await page.locator('[data-section="memory"] .section-header').click();
  await page.locator('#view .part-row', { hasText: 'Stick' }).getByRole('button', { name: 'Edit' }).click();
  await expect(modal(page).getByLabel('Category')).toBeDisabled();
  await page.keyboard.press('Escape');

  await page.locator('#view .part-row', { hasText: 'Board saved as CPU' }).getByRole('button', { name: 'Edit' }).click();
  const options = await modal(page).getByLabel('Category').locator('option').allTextContents();
  expect(options).not.toContain('RAM');
  await modal(page).getByLabel('Category').selectOption('motherboard');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);
  expect(partIn(await storedState(page), 'Board saved as CPU').category).toBe('motherboard');
});

test('moving a drive with no kind into a build asks "M.2 or SATA?"', async ({ page }) => {
  await seed(page, (M) => {
    let s = M.createInitialState();
    s = M.addMachine(s, { type: 'desktop', nickname: 'Rig' }).state;
    return M.addPart(s, { category: 'storage', label: 'Mystery 500GB' }).state;
  });
  await page.goto('/#/parts');
  await expectPage(page, 'All Parts');
  await page.locator('#view .part-row', { hasText: 'Mystery 500GB' }).getByRole('button', { name: 'Move to…' }).click();
  await modal(page).locator('.picker-item', { hasText: 'Rig' }).click();
  await expect(modal(page).locator('h2')).toHaveText('M.2 or SATA?');
  await modal(page).getByRole('button', { name: 'SATA port' }).click();
  await expect(page.locator('.toast', { hasText: 'Moved Mystery 500GB to Rig' })).toBeVisible();

  const s = await storedState(page);
  const rig = s.machines.find((m) => m.nickname === 'Rig');
  const slot = rig.slots.find((x) => x.id === partIn(s, 'Mystery 500GB').location.slotId);
  expect(slot.label).toBe('SATA 1');
});

test('adding a drive with no kind straight into a build asks which slot in the form', async ({ page }) => {
  await seed(page, (M) => M.addMachine(M.createInitialState(), { type: 'desktop', nickname: 'Rig' }).state);
  await page.locator('.card', { hasText: 'Rig' }).click();
  await page.locator('[data-section="storage"]').getByRole('button', { name: 'Add part' }).click();
  await modal(page).getByLabel('Label').fill('Old drive');
  await submitModal(page).click();
  await expect(modal(page).locator('.form-error')).toContainText('M.2 or SATA');
  await modal(page).getByLabel('Which slot?').selectOption('m2');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);
  await expect(page.locator('[data-section="storage"] .part-row', { hasText: 'Old drive' })).toContainText('M.2 1');
});

test('a failed "Install part here" leaves no stray parts behind', async ({ page }) => {
  await seed(page, (M) => {
    const r = M.addMachine(M.createInitialState(), { type: 'desktop', nickname: 'Rig' });
    return M.setSlotCount(r.state, r.result.id, 'sata', 1).state;
  });
  await page.locator('.card', { hasText: 'Rig' }).click();
  await page.locator('[data-section="storage"] .slot-placeholder').getByRole('button', { name: 'Install part here' }).click();
  await modal(page).getByRole('button', { name: 'Add a new part' }).click();
  await modal(page).getByLabel('Label').fill('1TB NVMe');
  await modal(page).getByLabel('Kind').selectOption('NVMe');
  await submitModal(page).click();
  await expect(modal(page).locator('.form-error')).toContainText("can't go in SATA 1");
  await submitModal(page).click(); // trying again changes nothing either
  expect((await storedState(page) || { parts: [] }).parts).toHaveLength(0);

  // Fix the kind and it installs.
  await modal(page).getByLabel('Kind').selectOption('SATA SSD');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);
  const s = await storedState(page);
  expect(s.parts).toHaveLength(1);
  expect(s.parts[0].location.slotId).toBeTruthy();
});

test('links must be web addresses', async ({ page }) => {
  await page.goto('/#/parts');
  await expectPage(page, 'All Parts');
  await page.getByRole('button', { name: 'Add part' }).click();
  await modal(page).getByLabel('Label').fill('Linked part');
  await modal(page).getByLabel('Link (optional)').fill('javascript:alert(1)');
  await submitModal(page).click();
  await expect(modal(page).locator('.form-error')).toContainText('http:// or https://');

  await modal(page).getByLabel('Link (optional)').fill('newegg.com/p/123');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);
  expect(partIn(await storedState(page), 'Linked part').link).toBe('https://newegg.com/p/123');
});

test('slot edits (rename, remove, set slots) can be undone', async ({ page }) => {
  await seed(page, (M) => {
    const r = M.addMachine(M.createInitialState(), { type: 'desktop', nickname: 'Rig' });
    return M.setSlotCount(r.state, r.result.id, 'm2', 2).state;
  });
  await page.locator('.card', { hasText: 'Rig' }).click();
  const storage = page.locator('[data-section="storage"]');
  await storage.locator('.slot-placeholder', { hasText: 'M.2 1' }).getByRole('button', { name: 'Rename slot' }).click();
  await modal(page).getByLabel('Slot label').fill('M.2 under heatsink');
  await submitModal(page).click();
  await expect(storage.locator('.slot-placeholder', { hasText: 'M.2 under heatsink' })).toBeVisible();
  await page.locator('.toast', { hasText: 'Renamed' }).getByRole('button', { name: 'Undo' }).click();
  await expect(storage.locator('.slot-placeholder', { hasText: 'M.2 1' })).toBeVisible();

  await storage.locator('.slot-placeholder', { hasText: 'M.2 2' }).getByRole('button', { name: 'Remove slot' }).click();
  await expect(storage.locator('.slot-placeholder')).toHaveCount(1);
  await page.locator('.toast', { hasText: 'Removed M.2 2' }).getByRole('button', { name: 'Undo' }).click();
  await expect(storage.locator('.slot-placeholder')).toHaveCount(2);
});

test('the Other parts form suggests the next missing category', async ({ page }) => {
  await seed(page, (M) => {
    const r = M.addMachine(M.createInitialState(), { type: 'desktop', nickname: 'Rig' });
    return M.addPart(r.state, { category: 'cpu', label: 'i5' }, { kind: 'machine', id: r.result.id }).state;
  });
  await page.locator('.card', { hasText: 'Rig' }).click();
  await page.locator('[data-section="other"]').getByRole('button', { name: 'Add part' }).click();
  await expect(modal(page).getByLabel('Category')).toHaveValue('motherboard');
});

test('retiring a whole build lists every part before confirming', async ({ page }) => {
  await seed(page, (M) => {
    const r = M.addMachine(M.createInitialState(), { type: 'desktop', nickname: 'Old Rig' });
    let s = M.addPart(r.state, { category: 'cpu', label: 'i7-4770' }, { kind: 'machine', id: r.result.id }).state;
    return M.addPart(s, { category: 'case', label: 'Tower' }, { kind: 'machine', id: r.result.id }).state;
  });
  await page.locator('.card', { hasText: 'Old Rig' }).click();
  await page.getByRole('button', { name: 'Retire whole build' }).click();
  const list = modal(page).locator('.confirm-list');
  await expect(list).toContainText('i7-4770');
  await expect(list).toContainText('Tower');
  await expect(modal(page).getByRole('button', { name: 'Retire all 2' })).toBeVisible();
});

test('the storage totals read naturally for mixed drive sizes', async ({ page }) => {
  await seed(page, (M) => {
    const r = M.addMachine(M.createInitialState(), { type: 'desktop', nickname: 'Rig' });
    let s = M.addPart(r.state, { category: 'storage', label: '1TB NVMe', details: { kind: 'NVMe' } }, { kind: 'machine', id: r.result.id }).state;
    return M.addPart(s, { category: 'storage', label: '500GB SSD', details: { kind: 'SATA SSD' } }, { kind: 'machine', id: r.result.id }).state;
  });
  await page.locator('.card', { hasText: 'Rig' }).click();
  await expect(page.locator('[data-section="storage"] .section-summary')).toContainText('1.5TB · 2 drives');
  // …with M.2 and SATA shown as separate groups.
  await expect(page.locator('[data-section="storage"] .slot-group-title')).toHaveText(['M.2', 'SATA']);
});

// CI failure (Sept 2026): after "Add box" the address bar already showed the
// new box while the Boxes list was still on screen, because the app waited
// for the browser's asynchronous hashchange event to draw the next page. On
// a slow machine a test (or a person) could catch that in-between state.
// Here hashchange handling is deliberately slowed down; navigation after a
// change must not depend on it.
test('after adding something, its page is on screen as soon as the URL changes', async ({ page }) => {
  await page.addInitScript(() => {
    const add = window.addEventListener.bind(window);
    window.addEventListener = (type, fn, opts) => (type === 'hashchange'
      ? add(type, (e) => setTimeout(() => fn(e), 600), opts)
      : add(type, fn, opts));
  });

  for (const [listHash, button, label, name, detailUrl] of [
    ['#/boxes', 'Add box', 'Name', 'Race Box', /#\/boxes\/.+/],
    ['#/machines', 'Add machine', 'Nickname (optional)', 'Race PC', /#\/machines\/.+/],
  ]) {
    await page.goto('/' + listHash);
    await page.reload(); // first render comes from startup, not from hashchange
    await page.getByRole('button', { name: button }).click();
    await modal(page).getByLabel(label).fill(name);
    await submitModal(page).click();
    await page.waitForURL(detailUrl);
    // No waiting or retrying here: the new page must already be showing.
    expect(await page.locator('#view h1').first().textContent()).toBe(name);
  }
});
