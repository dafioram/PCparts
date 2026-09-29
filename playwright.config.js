import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// In some sandboxed dev containers only a pre-installed, unversioned
// chromium binary is available (no network access to fetch the exact
// revision this @playwright/test version expects). Use it when present and
// we're not on CI; on CI, `playwright install --with-deps` fetches the
// matching browsers and this override is skipped.
function chromiumLaunchOptions() {
  const localChromium = '/opt/pw-browsers/chromium';
  if (!process.env.CI && existsSync(localChromium)) {
    return { executablePath: localChromium };
  }
  return {};
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npx http-server app -p 4173 -c-1 -s',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: chromiumLaunchOptions() } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], launchOptions: chromiumLaunchOptions() } },
  ],
});
