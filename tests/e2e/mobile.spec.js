import {
  test, expect, modal, submitModal, modalBackdrop, expectPage,
} from './fixtures.js';

test.use({ viewport: { width: 390, height: 844 } });

test('mobile viewport smoke test: bottom nav, add a build, add a part, warnings, add a box', async ({ page }) => {
  // At a narrow viewport the bottom nav is the one that's visible.
  await expect(page.locator('.bottomnav')).toBeVisible();
  await expect(page.locator('.sidenav')).toBeHidden();

  await page.getByRole('button', { name: 'Add machine' }).click();
  await modal(page).getByLabel('Nickname (optional)').fill('Mobile PC');
  await submitModal(page).click();
  await page.waitForURL(/#\/machines\/.+/);
  await expectPage(page, 'Mobile PC');

  const view = page.locator('#view');
  await expect(view.locator('[data-section="warnings"]')).toContainText('No CPU assigned');

  await view.locator('[data-section="other"] button:has-text("Add part")').click();
  await modal(page).getByLabel('Label').fill('i3-9100');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);
  await expect(view.locator('[data-section="warnings"]')).not.toContainText('No CPU assigned');

  await page.locator('.bottomnav').getByRole('link', { name: 'Boxes' }).click();
  await page.waitForURL(/#\/boxes$/);
  await expectPage(page, 'Boxes');
  await page.getByRole('button', { name: 'Add box' }).click();
  await modal(page).getByLabel('Name').fill('Mobile Box');
  await submitModal(page).click();
  await page.waitForURL(/#\/boxes\/.+/);
  await expectPage(page, 'Mobile Box');

  await page.locator('.bottomnav').getByRole('link', { name: 'Parts' }).click();
  await page.waitForURL(/#\/parts$/);
  await expectPage(page, 'All Parts');
  await expect(page.locator('#view .part-row', { hasText: 'i3-9100' })).toBeVisible();
});
