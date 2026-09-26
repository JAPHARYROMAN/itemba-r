/**
 * Harness smoke test: proves the Playwright config reaches the server under
 * test (BASE_URL) in both projects (phone 360x800, desktop 1280x800). The
 * route-inventory, axe, no-JS and analytics suites live alongside this file.
 */
import { expect, test } from '@playwright/test';

test('health endpoint keeps its contract', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body).toMatchObject({ status: 'ok', service: 'itemba-group-website' });
  expect(typeof body.timestamp).toBe('string');
});

test('home renders a headline and the group title', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/Itemba Group/);
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.locator('#main-content')).toHaveCount(1);
});

test('viewport matches the project', async ({ page }, testInfo) => {
  await page.goto('/');
  const width = await page.evaluate(() => window.innerWidth);
  expect(width).toBe(testInfo.project.name === 'phone' ? 360 : 1280);
});
