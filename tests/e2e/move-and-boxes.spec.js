import {
  test, expect, addBuild, addBox, addPartToUnused, modal, submitModal, modalBackdrop, currentMachineId, expectPage,
} from './fixtures.js';

test('moving a part from a build to a box, then to another build, via Move to…', async ({ page }) => {
  await addBuild(page, { nickname: 'PC A' });
  const view = page.locator('#view');

  await view.locator('[data-section="other"] button:has-text("Add part")').click();
  await modal(page).getByLabel('Label').fill('Widget');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);

  const row = view.locator('.part-row', { hasText: 'Widget' });
  await row.getByRole('button', { name: 'Move to…' }).click();
  await modal(page).locator('.picker-item', { hasText: 'Unused' }).click();
  await expect(modalBackdrop(page)).toHaveCount(0);
  await expect(view.locator('.part-row', { hasText: 'Widget' })).toHaveCount(0);
  await expect(page.locator('.toast', { hasText: 'Moved' })).toBeVisible();

  // A second build to move the part into.
  await page.goto('/#/machines');
  await expectPage(page, 'Machines');
  await addBuild(page, { nickname: 'PC B' });

  // Find the part in Unused and move it into PC B.
  await page.goto('/#/boxes');
  await expectPage(page, 'Boxes');
  await page.locator('.card', { hasText: 'Unused' }).click();
  const boxRow = page.locator('#view .part-row', { hasText: 'Widget' });
  await boxRow.getByRole('button', { name: 'Move to…' }).click();
  await modal(page).getByPlaceholder('Search boxes and builds…').fill('PC B');
  await modal(page).locator('.picker-item', { hasText: 'PC B' }).click();
  await expect(modalBackdrop(page)).toHaveCount(0);

  await page.goto('/#/machines');
  await expectPage(page, 'Machines');
  await page.locator('.card', { hasText: 'PC B' }).click();
  await expect(page.locator('#view .part-row', { hasText: 'Widget' })).toBeVisible();
});

test('bulk move selects several parts and moves them all into one box', async ({ page }) => {
  await addBox(page, 'Spare Parts');
  await addPartToUnused(page, { label: 'Fan 1' });
  await addPartToUnused(page, { label: 'Fan 2' });
  await addPartToUnused(page, { label: 'Fan 3' });

  await page.goto('/#/parts');
  await expectPage(page, 'All Parts');
  const view = page.locator('#view');
  await view.locator('.part-row', { hasText: 'Fan 1' }).locator('input[type="checkbox"]').click();
  await view.locator('.part-row', { hasText: 'Fan 2' }).locator('input[type="checkbox"]').click();
  await expect(page.locator('.selection-bar')).toContainText('2 selected');

  await page.locator('.selection-bar').getByRole('button', { name: 'Move to…' }).click();
  await modal(page).locator('.picker-item', { hasText: 'Spare Parts' }).click();
  await expect(modalBackdrop(page)).toHaveCount(0);

  await expect(page.locator('.toast', { hasText: 'Moved 2 parts' })).toBeVisible();

  await page.goto('/#/boxes');
  await expectPage(page, 'Boxes');
  await page.locator('.card', { hasText: 'Spare Parts' }).click();
  await expect(page.locator('#view .part-row', { hasText: 'Fan 1' })).toBeVisible();
  await expect(page.locator('#view .part-row', { hasText: 'Fan 2' })).toBeVisible();
  await expect(page.locator('#view .part-row', { hasText: 'Fan 3' })).toHaveCount(0);
});

test('parting out a build moves every part into a named box and deletes the build', async ({ page }) => {
  await addBuild(page, { nickname: 'Old Rig' });
  const oldRigId = currentMachineId(page);
  const view = page.locator('#view');

  await view.locator('[data-section="other"] button:has-text("Add part")').click();
  await modal(page).getByLabel('Label').fill('i5-6500');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);

  await addBox(page, 'Parted Out Box');

  await page.goto(`/#/machines/${oldRigId}`);
  await expectPage(page, 'Old Rig');
  await page.getByRole('button', { name: 'Part out' }).click();

  // The confirmation lists every part that will move and defaults to Unused.
  await expect(modal(page).locator('.confirm-list')).toContainText('i5-6500');
  const destination = modal(page).getByLabel('Move the parts to');
  await expect(destination).toHaveValue('unused');
  await destination.selectOption({ label: 'Parted Out Box' });
  await submitModal(page).click();

  await page.waitForURL(/#\/machines$/);
  await expectPage(page, 'Machines');
  await expect(page.locator('.toast', { hasText: 'Parted out Old Rig' })).toBeVisible();
  await expect(page.locator('.card', { hasText: 'Old Rig' })).toHaveCount(0);

  await page.goto('/#/boxes');
  await expectPage(page, 'Boxes');
  await page.locator('.card', { hasText: 'Parted Out Box' }).click();
  await expect(page.locator('#view .part-row', { hasText: 'i5-6500' })).toBeVisible();
});
