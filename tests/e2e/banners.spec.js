import { test, expect, seed, storedState, modal, submitModal, modalBackdrop, expectPage } from './fixtures.js';

const REMINDER = 'export a backup';

test('the export reminder appears on every page once there are unexported changes', async ({ page }) => {
  await expect(page.locator('#banners')).not.toContainText(REMINDER); // nothing to back up yet

  await page.goto('/#/boxes');
  await expectPage(page, 'Boxes');
  await page.getByRole('button', { name: 'Add box' }).click();
  await modal(page).getByLabel('Name').fill('Shelf');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);

  for (const [route, heading] of [['/#/machines', 'Machines'], ['/#/parts', 'All Parts'], ['/#/graveyard', 'Graveyard']]) {
    await page.goto(route);
    await expectPage(page, heading);
    await expect(page.locator('#banners')).toContainText(REMINDER);
  }

  // Export from the banner itself clears it.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#banners').getByRole('button', { name: 'Export now' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^pc-inventory-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.locator('#banners')).not.toContainText(REMINDER);
});

test('the export reminder can be put off, and stays off after a reload', async ({ page }) => {
  await seed(page, (M) => M.addPart(M.createInitialState(), { category: 'fan', label: 'Fan' }).state);
  await expect(page.locator('#banners')).toContainText(REMINDER);
  await page.locator('#banners').getByRole('button', { name: 'Remind me later' }).click();
  await expect(page.locator('#banners')).not.toContainText(REMINDER);
  await page.reload();
  await expect(page.locator('#view h1')).toHaveText('Machines');
  await expect(page.locator('#banners')).not.toContainText(REMINDER);
});

test('an old export with newer changes brings the reminder back', async ({ page }) => {
  await seed(page, (M) => {
    const s = M.addBox(M.createInitialState(), { name: 'Shelf' }).state;
    const now = Date.now();
    s.meta.lastExportedAt = new Date(now - 30 * 86400000).toISOString();
    s.meta.lastChangedAt = new Date(now - 86400000).toISOString();
    return s;
  });
  await expect(page.locator('#banners')).toContainText('Your last backup was');
});

test('two tabs stay in sync instead of overwriting each other', async ({ page, context }) => {
  const other = await context.newPage();
  await other.goto('/#/boxes');
  await expectPage(other, 'Boxes');
  await page.goto('/#/boxes');
  await expectPage(page, 'Boxes');

  for (const [tab, name] of [[page, 'From tab A'], [other, 'From tab B']]) {
    await tab.getByRole('button', { name: 'Add box' }).click();
    await modal(tab).getByLabel('Name').fill(name);
    await submitModal(tab).click();
    await expect(modalBackdrop(tab)).toHaveCount(0);
  }

  const names = (await storedState(page)).boxes.map((b) => b.name);
  expect(names).toEqual(expect.arrayContaining(['Unused', 'From tab A', 'From tab B']));
  await page.goto('/#/boxes');
  await expectPage(page, 'Boxes');
  await expect(page.locator('#view .card', { hasText: 'From tab B' })).toBeVisible();
  await expect(other.locator('.toast', { hasText: 'another tab' })).toBeVisible();
});
