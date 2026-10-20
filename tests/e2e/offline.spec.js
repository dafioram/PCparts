import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { test, expect } from '@playwright/test';

const APP_DIR = join(import.meta.dirname, '../../app');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

// A standalone copy of the site we can switch between healthy, hanging
// (accepts the request, never answers) and gone (connection refused) —
// Playwright's own routing can't see requests made by a service worker.
async function startSite() {
  const state = { mode: 'ok', sockets: new Set() };
  const server = createServer(async (req, res) => {
    if (state.mode === 'hang') return;
    const path = new URL(req.url, 'http://x').pathname;
    const file = normalize(path === '/' ? '/index.html' : path);
    try {
      const body = await readFile(join(APP_DIR, file));
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'text/plain', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  server.on('connection', (s) => { state.sockets.add(s); s.on('close', () => state.sockets.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    setMode: (m) => { state.mode = m; },
    // Stop listening and drop open connections so new requests are refused.
    async stop() {
      for (const s of state.sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
    async restart() {
      await new Promise((r) => server.listen(port, '127.0.0.1', r));
    },
  };
}

async function visitAndCache(page, url) {
  await page.goto(url);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.locator('#icon-sprite-mount svg')).toHaveCount(1);
}

test.describe('offline fallback', () => {
  let site;
  test.beforeEach(async () => { site = await startSite(); });
  test.afterEach(async () => { await site.stop().catch(() => {}); });

  test('browser offline: loads from cache', async ({ page, context, browserName }) => {
    // Playwright's WebKit throws "internal error" on any navigation while
    // setOffline(true) is active, before the service worker can answer. The
    // refused and hanging cases below cover the same fallback in WebKit.
    test.skip(browserName === 'webkit', 'setOffline navigations are unsupported in Playwright WebKit');
    await visitAndCache(page, site.url);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#icon-sprite-mount svg')).toHaveCount(1);
  });

  test('site unreachable (connection refused): loads from cache', async ({ page }) => {
    await visitAndCache(page, site.url);
    await site.stop();
    await page.reload();
    await expect(page.locator('#icon-sprite-mount svg')).toHaveCount(1);
  });

  test('site hangs: gives up after the timeout and loads from cache', async ({ page }) => {
    await visitAndCache(page, site.url);
    site.setMode('hang');
    const start = Date.now();
    await page.reload();
    await expect(page.locator('#icon-sprite-mount svg')).toHaveCount(1);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThan(2500); // it really did wait for the network first
    expect(elapsed).toBeLessThan(6000);
  });

  test('loads normally again once the site is back', async ({ page }) => {
    await visitAndCache(page, site.url);
    await site.stop();
    await page.reload();
    await site.restart();
    await page.reload();
    await expect(page.locator('#icon-sprite-mount svg')).toHaveCount(1);
  });
});
