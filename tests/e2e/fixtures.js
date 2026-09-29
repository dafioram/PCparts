// fixtures.js — a `test` that starts every case with a clean browser
// storage and the app already loaded at "/".

import { test as base, expect } from '@playwright/test';

// E2E_SLOW=1 simulates a slow CI machine: hash navigation (links, Back,
// page.goto('/#/…')) is delivered 300ms late, and Chromium's CPU is
// throttled 4×. Everything should still pass; a failure means a test is
// asserting before the page it navigated to is on screen.
const SLOW = !!process.env.E2E_SLOW;

export const test = base.extend({
  page: async ({ page, browserName }, use) => {
    // Clear storage once per test. The sessionStorage flag survives reloads
    // in the same tab, so a test can reload without losing what it saved.
    await page.addInitScript(() => {
      try {
        if (!window.sessionStorage.getItem('__e2e_cleared')) {
          window.localStorage.clear();
          window.sessionStorage.setItem('__e2e_cleared', '1');
        }
      } catch { /* storage blocked — nothing to clear */ }
    });
    if (SLOW) {
      await page.addInitScript(() => {
        const add = window.addEventListener.bind(window);
        window.addEventListener = (type, fn, opts) => (type === 'hashchange'
          ? add(type, (e) => setTimeout(() => fn(e), 300), opts)
          : add(type, fn, opts));
      });
      if (browserName === 'chromium') {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      }
    }
    await page.goto('/');
    await use(page);
  },
});

export { expect };

// Builds starting data with the app's own model functions, saves it, and
// reloads. `build` runs in the page and receives the model module:
//   await seed(page, (M) => M.addBox(M.createInitialState(), { name: 'A' }).state);
export async function seed(page, build) {
  await page.evaluate(async (src) => {
    const M = await import('/js/model.js');
    // eslint-disable-next-line no-eval
    const state = (0, eval)(`(${src})`)(M);
    localStorage.setItem('pc-inventory', JSON.stringify(state));
  }, build.toString());
  await page.reload();
}

export async function storedState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('pc-inventory') || 'null'));
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

// Links and page.goto('/#/…') are hash navigations, which the browser
// delivers asynchronously: the URL changes first, the page is drawn a moment
// later. Wait for the destination's heading before asserting anything about
// it, or an assertion can run against the page you just left.
export async function expectPage(page, heading) {
  await expect(page.locator('#view h1')).toHaveText(heading);
}

export const modal = (page) => page.locator('#modal-root');
export const submitModal = (page) => page.locator('#modal-root button.btn-primary[type="submit"]');
export const cancelModal = (page) => page.locator('#modal-root button:has-text("Cancel")');
// #modal-root itself always exists (it's a static container); "closed" means
// it has no backdrop child.
export const modalBackdrop = (page) => page.locator('#modal-root .modal-backdrop');

export async function addBuild(page, { nickname, type = 'desktop' } = {}) {
  await page.getByRole('button', { name: 'Add machine' }).click();
  if (type !== 'desktop') {
    await modal(page).getByLabel('Type').selectOption(type);
  }
  if (nickname) {
    await modal(page).getByLabel('Nickname (optional)').fill(nickname);
  }
  await submitModal(page).click();
  await page.waitForURL(/#\/machines\/.+/);
  await expect(page.locator('#view .detail-header')).toBeVisible();
}

export async function addDevice(page, { nickname, type = 'laptop' } = {}) {
  await page.getByRole('button', { name: 'Add machine' }).click();
  await modal(page).getByLabel('Type').selectOption(type);
  if (nickname) {
    await modal(page).getByLabel('Nickname (optional)').fill(nickname);
  }
  await submitModal(page).click();
  await page.waitForURL(/#\/machines\/.+/);
  await expect(page.locator('#view .detail-header')).toBeVisible();
}

export async function addBox(page, name) {
  await page.goto('/#/boxes');
  await expectPage(page, 'Boxes');
  await page.getByRole('button', { name: 'Add box' }).click();
  await modal(page).getByLabel('Name').fill(name);
  await submitModal(page).click();
  await page.waitForURL(/#\/boxes\/.+/);
  await expectPage(page, name);
}

// Adds a part directly into "Unused" from the All Parts view.
export async function addPartToUnused(page, { category, label, quantity, storageKind } = {}) {
  await page.goto('/#/parts');
  // Wait for All Parts: the page you came from may have its own "Add part".
  await expectPage(page, 'All Parts');
  await page.getByRole('button', { name: 'Add part' }).click();
  const m = modal(page);
  if (category) await m.getByLabel('Category').selectOption(category);
  await m.getByLabel('Label').fill(label);
  if (quantity) await m.getByLabel('Quantity').fill(String(quantity));
  if (storageKind) await m.getByLabel('Kind').selectOption(storageKind);
  await submitModal(page).click();
  await expect(modalBackdrop(page)).toHaveCount(0);
}

export function currentMachineId(page) {
  const url = page.url();
  const m = url.match(/#\/machines\/([^/]+)/);
  return m ? m[1] : null;
}
