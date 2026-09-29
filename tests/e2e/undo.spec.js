import {
  test, expect, addBox, addPartToUnused, modal, modalBackdrop, expectPage,
} from './fixtures.js';

test('undo after a move puts the part back where it was', async ({ page }) => {
  await addBox(page, 'Target Box');
  await addPartToUnused(page, { label: 'Movable Part' });

  const view = page.locator('#view');
  const row = view.locator('.part-row', { hasText: 'Movable Part' });
  await row.getByRole('button', { name: 'Move to…' }).click();
  await modal(page).locator('.picker-item', { hasText: 'Target Box' }).click();
  await expect(modalBackdrop(page)).toHaveCount(0);

  // The All Parts list shows every part everywhere, so it still lists the
  // part — but now under its new location.
  await expect(row).toContainText('Target Box');

  const toast = page.locator('.toast', { hasText: 'Moved' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();

  await expect(page.locator('.toast', { hasText: 'Undone' })).toBeVisible();
  await expect(row).toContainText('Unused');

  await page.goto('/#/boxes');
  await expectPage(page, 'Boxes');
  await page.locator('.card', { hasText: 'Target Box' }).click();
  await expectPage(page, 'Target Box');
  await expect(page.locator('#view .part-row', { hasText: 'Movable Part' })).toHaveCount(0);
});
