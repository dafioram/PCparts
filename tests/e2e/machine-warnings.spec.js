import { test, expect, addBuild, modal, submitModal, modalBackdrop } from './fixtures.js';

test('warnings appear on an empty build and clear as required parts are added', async ({ page }) => {
  await addBuild(page, { nickname: 'Test Rig' });
  const view = page.locator('#view');

  for (const label of ['No CPU assigned', 'No Motherboard assigned', 'No RAM assigned', 'No Storage assigned', 'No PSU assigned', 'No GPU assigned']) {
    await expect(view.locator(`[data-section="warnings"]`)).toContainText(label);
  }

  // CPU, via "Other parts".
  await view.locator('[data-section="other"] button:has-text("Add part")').click();
  await modal(page).getByLabel('Label').fill('i5-6500');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);
  await expect(view.locator('[data-section="warnings"]')).not.toContainText('No CPU assigned');
  await expect(view.locator('[data-section="warnings"]')).toContainText('No Motherboard assigned');

  // Motherboard, also via "Other parts" — change the category.
  await view.locator('[data-section="other"] button:has-text("Add part")').click();
  await modal(page).getByLabel('Category').selectOption('motherboard');
  await modal(page).getByLabel('Label').fill('Some Board');
  await submitModal(page).click();
  await expect(view.locator('[data-section="warnings"]')).not.toContainText('No Motherboard assigned');

  // PSU, via "Other parts" too.
  await view.locator('[data-section="other"] button:has-text("Add part")').click();
  await modal(page).getByLabel('Category').selectOption('psu');
  await modal(page).getByLabel('Label').fill('600W PSU');
  await submitModal(page).click();
  await expect(view.locator('[data-section="warnings"]')).not.toContainText('No PSU assigned');

  // RAM, via the Memory section — it starts collapsed, so expand it first.
  await view.locator('[data-section="memory"] .section-header').click();
  await view.locator('[data-section="memory"] button:has-text("Add part")').click();
  await modal(page).getByLabel('Label').fill('8GB DDR4');
  await submitModal(page).click();
  await expect(view.locator('[data-section="warnings"]')).not.toContainText('No RAM assigned');

  // Storage, via the Storage section — needs an explicit M.2/SATA kind.
  await view.locator('[data-section="storage"] button:has-text("Add part")').click();
  await modal(page).getByLabel('Label').fill('1TB NVMe');
  await modal(page).getByLabel('Kind').selectOption('NVMe');
  await submitModal(page).click();
  await expect(view.locator('[data-section="warnings"]')).not.toContainText('No Storage assigned');

  // GPU, via the PCIe section.
  await view.locator('[data-section="pcie"] button:has-text("Add part")').click();
  await modal(page).getByLabel('Label').fill('GTX 1050');
  await submitModal(page).click();

  // No warnings section at all once everything is filled in.
  await expect(view.locator('[data-section="warnings"]')).toHaveCount(0);
});

test('marking a category "not needed" clears its warning without a part', async ({ page }) => {
  await addBuild(page, { nickname: 'Headless Server', type: 'server' });
  const view = page.locator('#view');
  await expect(view.locator('[data-section="warnings"]')).toContainText('No GPU assigned');

  const gpuRow = view.locator('[data-section="warnings"] .card-row', { hasText: 'No GPU assigned' });
  await gpuRow.getByRole('checkbox').click();

  await expect(view.locator('[data-section="warnings"]')).not.toContainText('No GPU assigned');
  await expect(view.locator('[data-section="warnings"]')).toContainText('GPU not needed');
  // Other warnings remain.
  await expect(view.locator('[data-section="warnings"]')).toContainText('No CPU assigned');

  // Un-mark it: the warning comes back.
  await view.locator('[data-section="warnings"] .chip', { hasText: 'GPU not needed' }).getByRole('button').click();
  await expect(view.locator('[data-section="warnings"]')).toContainText('No GPU assigned');
});
