import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end harness. There is deliberately no `webServer`: start the server
 * under test yourself (CI and the rebuild use the standalone build on 3191,
 * exactly as the Dockerfile runs it) and point BASE_URL at it.
 *
 *   BASE_URL=http://localhost:3191 npx playwright test
 *
 * Suites are tagged: @contract (URLs, metadata, JSON-LD, links, analytics,
 * QuickContact; must pass on origin/main and on every rebuild commit) and
 * @quality (axe, no-JS; the rebuild's targets, failing on origin/main).
 * Run them separately with `npm run test:e2e:contract` / `test:e2e:quality`;
 * E2E_ROUTES=/about,/companies/* narrows the per-route suites.
 */
const baseURL = process.env.BASE_URL || 'http://localhost:3191';

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'phone',
      // Server-HTML contracts do not depend on the viewport: run them once,
      // in the desktop project.
      testIgnore: /(route-inventory|link-crawl|jsonld)\.spec\.ts$/,
      use: {
        ...devices['Pixel 7'],
        browserName: 'chromium',
        viewport: { width: 360, height: 800 },
        userAgent: ANDROID_UA,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
