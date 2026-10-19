import { test, expect } from '@playwright/test';

test('app shell loads offline after the first visit', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#icon-sprite-mount svg')).toHaveCount(1);
  await expect(page.locator('body')).not.toBeEmpty();
});
