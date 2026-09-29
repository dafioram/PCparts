import { test, expect, addBuild, modal, submitModal, modalBackdrop } from './fixtures.js';

async function expandMemory(view) {
  const section = view.locator('[data-section="memory"]');
  if (await section.evaluate((el) => el.classList.contains('collapsed'))) {
    await section.locator('.section-header').click();
  }
  return section;
}

async function setDimmSlots(page, view, count) {
  const memory = await expandMemory(view);
  await memory.locator('button:has-text("Set slots")').click();
  await modal(page).getByLabel('dimm slots').fill(String(count));
  await modal(page).locator('button:has-text("Save")').click();
  await expect(modalBackdrop(page)).toHaveCount(0);
  return memory;
}

test('setting up 4 DIMM slots and installing a 2x8GB part splits it and fills two slots', async ({ page }) => {
  await addBuild(page, { nickname: 'Slot Test PC' });
  const view = page.locator('#view');
  const memory = await setDimmSlots(page, view, 4);

  await expect(memory.locator('.slot-placeholder')).toHaveCount(4);

  await memory.locator('button:has-text("Add part")').click();
  await modal(page).getByLabel('Label').fill('8GB DDR4');
  await modal(page).getByLabel('Quantity').fill('2');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);

  // Two sticks installed, two placeholders left, and the summary says so.
  await expect(memory.locator('.part-row')).toHaveCount(2);
  await expect(memory.locator('.slot-placeholder')).toHaveCount(2);
  await expect(memory.locator('.section-summary')).toContainText('16GB');
  await expect(memory.locator('.section-summary')).toContainText('2 of 4 slots used');
});

test('filling all defined DIMM slots overflows with a new slot, a toast, and Undo works', async ({ page }) => {
  await addBuild(page, { nickname: 'Overflow PC' });
  const view = page.locator('#view');
  const memory = await setDimmSlots(page, view, 1);

  // Fill the only slot.
  await memory.locator('button:has-text("Add part")').click();
  await modal(page).getByLabel('Label').fill('Stick A');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);
  await expect(memory.locator('.slot-placeholder')).toHaveCount(0);

  // Add a second stick — no empty slot, so a new one is created with a toast.
  await memory.locator('button:has-text("Add part")').click();
  await modal(page).getByLabel('Label').fill('Stick B');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);

  const toast = page.locator('.toast', { hasText: 'was added' });
  await expect(toast).toBeVisible();
  await expect(memory.locator('.part-row')).toHaveCount(2);

  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#view').locator('[data-section="memory"] .part-row')).toHaveCount(1);
});

test('relabeling a slot, changing slot to swap two sticks, and installing via a placeholder', async ({ page }) => {
  await addBuild(page, { nickname: 'Swap PC' });
  const view = page.locator('#view');
  const memory = await setDimmSlots(page, view, 2);

  // Relabel DIMM 1 via its placeholder's rename button.
  const slot1 = memory.locator('.slot-placeholder', { hasText: 'DIMM 1' });
  await slot1.getByRole('button', { name: 'Rename slot' }).click();
  await modal(page).getByLabel('Slot label').fill('DIMM A2');
  await modal(page).locator('button:has-text("Save")').click();
  await expect(modalBackdrop(page)).toHaveCount(0);
  const renamedSlot = memory.locator('.slot-placeholder', { hasText: 'DIMM A2' });
  await expect(renamedSlot).toBeVisible();

  // Install stick A via that (now renamed) slot's "Add a new part".
  await renamedSlot.getByRole('button', { name: 'Install part here' }).click();
  await modal(page).getByRole('button', { name: 'Add a new part' }).click();
  await modal(page).getByLabel('Label').fill('Stick A');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);

  // Install stick B via the DIMM 2 placeholder.
  const slot2 = memory.locator('.slot-placeholder', { hasText: 'DIMM 2' });
  await slot2.getByRole('button', { name: 'Install part here' }).click();
  await modal(page).getByRole('button', { name: 'Add a new part' }).click();
  await modal(page).getByLabel('Label').fill('Stick B');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);

  await expect(memory.locator('.part-row')).toHaveCount(2);
  const rowA = memory.locator('.part-row', { hasText: 'Stick A' });
  await expect(rowA).toContainText('DIMM A2');

  // Change Stick A's slot to DIMM 2 — should swap with Stick B.
  await rowA.getByRole('button', { name: 'Change slot' }).click();
  await modal(page).locator('.picker-item', { hasText: 'DIMM 2' }).click();

  await expect(memory.locator('.part-row', { hasText: 'Stick A' })).toContainText('DIMM 2');
  await expect(memory.locator('.part-row', { hasText: 'Stick B' })).toContainText('DIMM A2');
});

test('the Memory section starts collapsed and shows a capacity total', async ({ page }) => {
  await addBuild(page, { nickname: 'Collapse PC' });
  const view = page.locator('#view');
  const memory = view.locator('[data-section="memory"]');
  await expect(memory).toHaveClass(/collapsed/);

  await memory.locator('.section-header').click();
  await memory.locator('button:has-text("Set slots")').click();
  await modal(page).getByLabel('dimm slots').fill('2');
  await modal(page).locator('button:has-text("Save")').click();

  await memory.locator('button:has-text("Add part")').click();
  await modal(page).getByLabel('Label').fill('8GB DDR4');
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);
  await expect(memory.locator('.section-summary')).toContainText('8GB');

  // Collapse it again and confirm the rows hide.
  await memory.locator('.section-header').click();
  await expect(memory).toHaveClass(/collapsed/);
  await expect(memory.locator('.part-row')).not.toBeVisible();
});
