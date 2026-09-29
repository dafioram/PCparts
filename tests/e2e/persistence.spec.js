import { readFileSync } from 'node:fs';
import {
  test, expect, addBuild, modal, submitModal, modalBackdrop, currentMachineId, storedState, expectPage,
} from './fixtures.js';

test('data persists across a page reload', async ({ page }) => {
  await addBuild(page, { nickname: 'Persisted PC' });
  const machineId = currentMachineId(page);
  const view = page.locator('#view');

  await view.locator('[data-section="other"] button:has-text("Add part")').click();
  await modal(page).getByLabel('Label').fill('Persistent CPU');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);

  await page.reload();

  await expectPage(page, 'Persisted PC');
  await expect(page.locator('#view .part-row', { hasText: 'Persistent CPU' })).toBeVisible();
  expect(currentMachineId(page)).toBe(machineId);

  await page.goto('/#/machines');
  await expectPage(page, 'Machines');
  await expect(page.locator('.card', { hasText: 'Persisted PC' })).toBeVisible();
});

test('collapsed sections stay the way you left them after a reload', async ({ page }) => {
  await addBuild(page, { nickname: 'Prefs PC' });
  const memory = page.locator('[data-section="memory"]');
  const storage = page.locator('[data-section="storage"]');
  await expect(memory).toHaveClass(/collapsed/);
  await expect(memory.locator('.section-header')).toHaveAttribute('aria-expanded', 'false');

  await memory.locator('.section-header').click(); // open Memory
  await storage.locator('.section-header').click(); // close Storage
  await page.reload();

  await expect(page.locator('[data-section="memory"]')).not.toHaveClass(/collapsed/);
  await expect(page.locator('[data-section="storage"]')).toHaveClass(/collapsed/);
  // UI preferences are kept apart from the inventory data (never exported).
  const saved = await storedState(page);
  expect(JSON.stringify(saved)).not.toContain('collapsed');
});

test('saved data that can’t be loaded is kept, downloadable, and survives new changes', async ({ page }) => {
  // One bad field makes the saved data fail validation.
  const bad = await page.evaluate(async () => {
    const M = await import('/js/model.js');
    let s = M.createInitialState();
    for (const label of ['Keep 1', 'Keep 2', 'Keep 3']) s = M.addPart(s, { category: 'fan', label }).state;
    s.parts[0].category = 'bogus';
    const raw = JSON.stringify(s);
    localStorage.setItem('pc-inventory', raw);
    return raw;
  });
  await page.reload();

  const banner = page.locator('#banners .banner', { hasText: 'couldn’t be loaded' });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('bogus');

  // Make a change: the app saves over the main copy, but the kept copy stays.
  await page.goto('/#/boxes');
  await expectPage(page, 'Boxes');
  await page.getByRole('button', { name: 'Add box' }).click();
  await modal(page).getByLabel('Name').fill('New box');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    banner.getByRole('button', { name: 'Download copy' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^pc-inventory-unreadable-.*\.json$/);
  expect(readFileSync(await download.path(), 'utf-8')).toBe(bad);

  // Deleting the kept copy asks first, then removes the banner.
  await banner.getByRole('button', { name: 'Delete copy' }).click();
  await modal(page).getByRole('button', { name: 'Delete copy' }).click();
  await expect(page.locator('#banners')).not.toContainText('couldn’t be loaded');
});

test('when the browser blocks storage, a lasting banner says so and the app still works', async ({ page }) => {
  // Every write throws, as in some private modes (works the same in all engines).
  await page.addInitScript(() => {
    Storage.prototype.setItem = function setItem() {
      throw new DOMException('Storage is disabled', 'SecurityError');
    };
  });
  await page.reload();

  const banner = page.locator('#banners .banner', { hasText: 'Data will not be saved' });
  await expect(banner).toBeVisible();

  await page.getByRole('button', { name: 'Add machine' }).click();
  await modal(page).getByLabel('Nickname (optional)').fill('Memory-only PC');
  await submitModal(page).click();
  await page.waitForURL(/#\/machines\/.+/);
  await expectPage(page, 'Memory-only PC');
  // Still there after other actions — it is a banner, not a passing toast.
  await page.waitForTimeout(500);
  await expect(banner).toBeVisible();
  await expect(page.locator('.toast', { hasText: 'Could not save' })).toHaveCount(0);
});
