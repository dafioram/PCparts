import { test, expect, seed, modal, submitModal, expectPage } from './fixtures.js';

test('retired devices stay out of the Machines list unless asked for', async ({ page }) => {
  await seed(page, (M) => {
    let s = M.createInitialState();
    s = M.addMachine(s, { type: 'laptop', nickname: 'Daily Laptop' }).state;
    const r = M.addMachine(s, { type: 'laptop', nickname: 'Sold Laptop' });
    return M.retireDevice(r.state, r.result.id, { reason: 'sold' }).state;
  });
  const titles = page.locator('#view .card .card-title');
  await expect(titles).toHaveText(['Daily Laptop']);

  await page.getByRole('combobox', { name: 'Status' }).selectOption('retired');
  await expect(titles).toHaveText(['Sold Laptop']);

  await page.goto('/#/graveyard');
  await expectPage(page, 'Graveyard');
  await expect(page.locator('#view .card', { hasText: 'Sold Laptop' })).toBeVisible();
});

test('devices show their specs, a readable type, and a title even when unnamed', async ({ page }) => {
  await seed(page, (M) => {
    let s = M.createInitialState();
    s = M.addMachine(s, { type: 'laptop', nickname: 'Work Laptop', modelName: 'ThinkPad T14', specs: 'i7-1165G7, 16GB, 512GB' }).state;
    return M.addMachine(s, { type: 'mini-pc' }).state;
  });
  const work = page.locator('#view .card', { hasText: 'Work Laptop' });
  await expect(work).toContainText('ThinkPad T14 · i7-1165G7, 16GB, 512GB');
  await expect(work).toContainText('Laptop');
  await expect(page.locator('#view .card', { hasText: 'Unnamed mini PC' })).toContainText('Mini PC');

  await work.click();
  await expectPage(page, 'Work Laptop');
  await expect(page.locator('#view .detail-header')).toContainText('i7-1165G7, 16GB, 512GB');
});

test('adding a device shows the Specs field; a desktop does not need it', async ({ page }) => {
  await page.getByRole('button', { name: 'Add machine' }).click();
  await expect(modal(page).getByLabel('Specs (optional)')).toBeHidden();
  await modal(page).getByLabel('Type').selectOption('laptop');
  await modal(page).getByLabel('Specs (optional)').fill('Ryzen 7 7840U, 32GB');
  await submitModal(page).click();
  await page.waitForURL(/#\/machines\/.+/);
  await expect(page.locator('#view .detail-header')).toContainText('Ryzen 7 7840U, 32GB');
});

test('build cards show one warning badge per missing category', async ({ page }) => {
  await seed(page, (M) => {
    const r = M.addMachine(M.createInitialState(), { type: 'server', nickname: 'NAS', notNeeded: ['gpu'] });
    return M.addPart(r.state, { category: 'cpu', label: 'i3' }, { kind: 'machine', id: r.result.id }).state;
  });
  const badges = page.locator('#view .card', { hasText: 'NAS' }).locator('.chip.warn');
  await expect(badges).toHaveText(['No Motherboard', 'No RAM', 'No Storage', 'No PSU']);
});
