// Frontend authentication and shell regression checks. API responses are mocked;
// real reporting persistence is covered by smoke-fuel-reporting.mjs.
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const user = {
  id: 'portal-test',
  fullName: 'Station Manager',
  email: 'manager@example.test',
  roles: ['BRANCH_MANAGER'],
  permissions: ['fuel_reporting.read'],
  companyId: 'test',
};
let signedIn = false;
let mustChangePassword = false;
await context.route('**/api/auth/me', (route) =>
  route.fulfill({
    status: signedIn ? 200 : 401,
    json: signedIn ? user : { message: 'Unauthorized' },
  }),
);
await context.route('**/api/auth/refresh', (route) =>
  route.fulfill({ status: 401, json: { message: 'Unauthorized' } }),
);
async function completeLogin(route) {
  signedIn = true;
  await context.addCookies([
    {
      name: 'itemba_access',
      value: 'portal-fixture',
      domain: 'localhost',
      path: '/',
      httpOnly: true,
    },
  ]);
  await route.fulfill({ json: { user } });
}
await context.route('**/api/auth/login', (route) =>
  mustChangePassword
    ? route.fulfill({ json: { requiresPasswordChange: true, tempToken: 'test-password-token' } })
    : completeLogin(route),
);
await context.route('**/api/auth/change-password', completeLogin);
await context.route('**/api/auth/logout', async (route) => {
  signedIn = false;
  await context.clearCookies();
  await route.fulfill({ json: { success: true } });
});
await context.route('**/api/backend/fuel-reporting/bootstrap', (route) =>
  route.fulfill({
    json: { success: true, data: { branches: [], canManage: true, canAdmin: false } },
  }),
);
await context.addInitScript(() => localStorage.setItem('aurora-theme', 'dark'));
fs.mkdirSync('.tmp-fuel-reporting', { recursive: true });
async function signIn() {
  await page.getByLabel('Email address', { exact: true }).fill('manager@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Test-only-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
try {
  await page.goto('http://localhost:3009/login');
  await expect(page.getByRole('heading', { name: 'Account sign in' })).toBeVisible();
  await page.getByRole('link', { name: /Fuel Reporting Station managers/ }).click();
  await expect(page).toHaveURL(/\/fuel-reporting\/login\?from=/);
  await expect(page.getByRole('heading', { name: 'Station manager sign in' })).toBeVisible();
  await expect(page.locator('aside')).toHaveCount(0);
  await expect(page.getByLabel('Email address')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await page.screenshot({ path: '.tmp-fuel-reporting/portal-login-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.tmp-fuel-reporting/portal-login-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Email address is required.', { exact: true })).toBeVisible();
  // A supplied ERP return path must not take a portal sign-in out of its workspace.
  await page.goto('http://localhost:3009/fuel-reporting/login?from=%2Fdashboard');
  await signIn();
  await expect(page).toHaveURL('http://localhost:3009/fuel-reporting');
  await expect(page.getByRole('heading', { name: 'Fuel Reporting', exact: true })).toBeVisible();
  await expect(page.locator('aside')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open Itemba' })).toHaveAttribute(
    'href',
    '/dashboard',
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/fuel-reporting\/login/);
  await expect(page.getByRole('heading', { name: 'Station manager sign in' })).toBeVisible();
  mustChangePassword = true;
  await signIn();
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill('Changed-test-password');
  await page.getByLabel('Confirm new password', { exact: true }).fill('Changed-test-password');
  await page.getByRole('button', { name: 'Update password and continue' }).click();
  await expect(page).toHaveURL('http://localhost:3009/fuel-reporting');
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('itemba:session-expired')));
  await expect(page).toHaveURL('http://localhost:3009/fuel-reporting/login?expired=1');
  await expect(
    page.getByText('Your session expired for security. Please sign in again to continue.'),
  ).toBeVisible();
  // A stale token must also return to the portal sign-in, without rendering reports.
  signedIn = false;
  await page.goto('http://localhost:3009/fuel-reporting');
  await expect(page).toHaveURL(/\/fuel-reporting\/login\?from=/);
  expect(errors).toEqual([]);
  console.log(
    'PASS: independent shell, main login link, portal sign-in, redirect confinement, password change, sign-out, expiry, stale session, dark-theme isolation and mobile layout. Auth APIs mocked.',
  );
} catch (error) {
  await page.screenshot({ path: '.tmp-fuel-reporting/portal-failure.png', fullPage: true });
  console.error(await page.locator('body').innerText());
  console.error(errors);
  throw error;
} finally {
  await browser.close();
}
