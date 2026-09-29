import {
  test, expect, addBuild, addPartToUnused, modal, submitModal, modalBackdrop, expectPage,
} from './fixtures.js';

test('retiring a whole build creates a graveyard group with all its parts, and deletes the build', async ({ page }) => {
  await addBuild(page, { nickname: 'Retire Me' });
  const view = page.locator('#view');

  await view.locator('[data-section="other"] button:has-text("Add part")').click();
  await modal(page).getByLabel('Label').fill('i5-6500');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Retire whole build' }).click();
  await submitModal(page).click();

  await page.waitForURL(/#\/graveyard$/);

  const groupCard = page.locator('.group-card', { hasText: 'Retire Me' });
  await expect(groupCard).toBeVisible();
  await expect(groupCard).toContainText('Sold');
  await groupCard.locator('summary').click();
  await expect(groupCard.locator('.part-row', { hasText: 'i5-6500' })).toBeVisible();

  // The build itself is gone from the Machines list.
  await page.goto('/#/machines');
  await expectPage(page, 'Machines');
  await expect(page.locator('.card', { hasText: 'Retire Me' })).toHaveCount(0);
});

test('retiring a single part moves it to the graveyard, and restoring returns it to a box', async ({ page }) => {
  await addPartToUnused(page, { label: 'Old CPU' });

  const view = page.locator('#view');
  const row = view.locator('.part-row', { hasText: 'Old CPU' });
  await row.getByRole('button', { name: 'Retire' }).click();
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);
  await expect(page.locator('.toast', { hasText: 'Retired Old CPU' })).toBeVisible();
  await expect(view.locator('.part-row', { hasText: 'Old CPU' })).toHaveCount(0);

  await page.goto('/#/graveyard');
  await expectPage(page, 'Graveyard');
  const card = page.locator('.card', { hasText: 'Old CPU' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Sold');

  await card.getByRole('button', { name: 'Restore' }).click();
  await modal(page).locator('.picker-item', { hasText: 'Unused' }).click();
  await expect(modalBackdrop(page)).toHaveCount(0);

  await expect(page.locator('#view .card', { hasText: 'Old CPU' })).toHaveCount(0);

  await page.goto('/#/parts');
  await expectPage(page, 'All Parts');
  await expect(page.locator('#view .part-row', { hasText: 'Old CPU' })).toBeVisible();
});
