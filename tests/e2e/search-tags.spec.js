import {
  test, expect, addBox, addPartToUnused, modal, submitModal, modalBackdrop, expectPage,
} from './fixtures.js';

test('search finds a part and shows its location', async ({ page }) => {
  await addBox(page, 'Shelf B');
  await page.locator('#view').getByRole('button', { name: 'Add part' }).click();
  await modal(page).getByLabel('Label').fill('RTX 3080');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);

  await page.getByLabel('Search').fill('RTX');
  await page.waitForURL(/#\/search\?q=RTX$/);

  const view = page.locator('#view');
  await expect(view.locator('h3', { hasText: 'Parts' })).toBeVisible();
  const result = view.locator('.part-row', { hasText: 'RTX 3080' });
  await expect(result).toBeVisible();
  await expect(result).toContainText('Shelf B');
});

test('search finds nothing for a made-up query', async ({ page }) => {
  await page.getByLabel('Search').fill('doesnotexistanywhere');
  await page.waitForURL(/#\/search\?q=/);
  await expect(page.locator('#view')).toContainText('Nothing matches');
});

test('typing at a normal pace keeps focus in the search box and the whole query', async ({ page }) => {
  await page.getByLabel('Search').click();
  // Slower than the debounce: every pause re-renders the results.
  await page.keyboard.type('rtx 3080', { delay: 260 });
  await expect(page.getByLabel('Search')).toHaveValue('rtx 3080');
  await expect(page.getByLabel('Search')).toBeFocused();
  await expect(page).toHaveURL(/#\/search\?q=rtx%203080$/);
});

test('a search opens from its URL, and Escape clears it', async ({ page }) => {
  await addPartToUnused(page, { label: 'GTX 1060' });
  await page.goto('/#/search?q=gtx');
  await expectPage(page, 'Search: "gtx"');
  await expect(page.locator('#view .part-row', { hasText: 'GTX 1060' })).toBeVisible();
  await expect(page.getByLabel('Search')).toHaveValue('gtx');
  await page.getByLabel('Search').press('Escape');
  await expect(page.getByLabel('Search')).toHaveValue('');
  await expect(page.locator('#view')).toContainText('Type something');
});

test('tagging a part and filtering the All Parts list by that tag', async ({ page }) => {
  await addPartToUnused(page, { label: 'Tagged Part 1' });
  await addPartToUnused(page, { label: 'Tagged Part 2' });

  const view = page.locator('#view');
  const row1 = view.locator('.part-row', { hasText: 'Tagged Part 1' });
  await row1.getByRole('button', { name: 'Edit' }).click();
  const tagField = modal(page).getByLabel('Tags');
  await tagField.fill('ddr4');
  await tagField.press('Enter');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);

  await expect(view.locator('.part-row', { hasText: 'Tagged Part 1' })).toContainText('ddr4');

  const tagFilter = view.locator('.filters-row select').last();
  await tagFilter.selectOption('ddr4');

  await expect(view.locator('.part-row', { hasText: 'Tagged Part 1' })).toBeVisible();
  await expect(view.locator('.part-row', { hasText: 'Tagged Part 2' })).toHaveCount(0);

  await tagFilter.selectOption('all');
  await expect(view.locator('.part-row', { hasText: 'Tagged Part 2' })).toBeVisible();
});
