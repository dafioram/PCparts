import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  test, expect, addBuild, expectPage,
} from './fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VALID_FIXTURE = path.join(__dirname, '..', 'fixtures', 'valid-import.json');
const INVALID_FIXTURE = path.join(__dirname, '..', 'fixtures', 'invalid-import.json');

test('export downloads a valid JSON backup of the current data', async ({ page }) => {
  await addBuild(page, { nickname: 'Exported PC' });
  await page.goto('/#/data');
  await expectPage(page, 'Data');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export JSON' }).click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/^pc-inventory-\d{4}-\d{2}-\d{2}\.json$/);
  const filePath = await download.path();
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));

  expect(data.app).toBe('pc-inventory');
  expect(typeof data.schemaVersion).toBe('number');
  expect(Array.isArray(data.machines)).toBe(true);
  expect(data.machines.some((m) => m.nickname === 'Exported PC')).toBe(true);
  expect(data.boxes.some((b) => b.id === 'unused' && b.isDefault === true)).toBe(true);
});

test('importing an invalid file shows errors and changes nothing', async ({ page }) => {
  await addBuild(page, { nickname: 'Untouched PC' });
  await page.goto('/#/data');
  await expectPage(page, 'Data');

  await page.locator('input[type="file"]').setInputFiles(INVALID_FIXTURE);

  const status = page.locator('#view .form-error');
  await expect(status).toContainText('This file could not be imported');

  // Nothing was replaced — no "replace all data" warning, and existing data
  // is still there.
  await expect(page.locator('#view')).not.toContainText('will replace all current data');
  await page.goto('/#/machines');
  await expectPage(page, 'Machines');
  await expect(page.locator('.card', { hasText: 'Untouched PC' })).toBeVisible();
});

test('importing a valid file shows the replace warning, downloads a backup, and replaces all data', async ({ page }) => {
  await addBuild(page, { nickname: 'About To Be Replaced' });
  await page.goto('/#/data');
  await expectPage(page, 'Data');

  await page.locator('input[type="file"]').setInputFiles(VALID_FIXTURE);

  const warning = page.locator('#view .form-warning', { hasText: 'replace all current data' });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('1 machines');

  const [backup] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Replace all data' }).click(),
  ]);
  expect(backup.suggestedFilename()).toMatch(/^pc-inventory-backup-before-import-/);

  await expect(page.locator('.toast', { hasText: 'Import complete' })).toBeVisible();

  await page.goto('/#/machines');
  await expectPage(page, 'Machines');
  await expect(page.locator('.card', { hasText: 'About To Be Replaced' })).toHaveCount(0);
  await expect(page.locator('.card', { hasText: 'Imported Rig' })).toBeVisible();

  await page.goto('/#/boxes');
  await expectPage(page, 'Boxes');
  await expect(page.locator('.card', { hasText: 'Imported Box' })).toBeVisible();

  await page.goto('/#/parts');
  await expectPage(page, 'All Parts');
  await expect(page.locator('#view .part-row', { hasText: 'Imported CPU' })).toBeVisible();
});
