// Run after backend/scripts/verify-fuel-reporting.cjs --serve and the frontend dev server.
// Auth is a disposable fixture; all reporting requests pass through the real Next
// proxy, DTO validation, permission guard, service, and isolated PostgreSQL database.
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, '.tmp-fuel-reporting/fixture.json'), 'utf8'),
);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1536, height: 1000 } });
const page = await context.newPage();
// Optional isolated API mode keeps the user's running backend and data untouched.
if (process.env.FUEL_REPORTING_DIRECT_FIXTURE === '1') {
  await context.route('**/api/backend/fuel-reporting/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const token = (await context.cookies()).find((c) => c.name === 'itemba_access')?.value;
    const response = await route.fetch({
      url: `${fixture.baseUrl}${url.pathname.replace('/api/backend', '')}${url.search}`,
      headers: { ...request.headers(), Authorization: `Bearer ${token}` },
    });
    await route.fulfill({ response });
  });
}
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto('http://localhost:3009/login');
  await page.getByRole('link', { name: /Fuel Reporting Station managers/ }).click();
  await expect(page).toHaveURL(/fuel-reporting\/login\?from=%2Ffuel-reporting/);
  await context.route('**/api/auth/me', (route) => route.fulfill({ json: fixture.manager }));
  await context.addCookies([
    {
      name: 'itemba_access',
      value: 'fixture-manager',
      domain: 'localhost',
      path: '/',
      httpOnly: true,
    },
    { name: 'itemba_csrf', value: 'fuel-reporting-verification', domain: 'localhost', path: '/' },
  ]);
  await page.goto('http://localhost:3009/fuel-reporting');
  await expect(page.getByRole('heading', { name: 'Fuel Reporting', exact: true })).toBeVisible();
  await expect(page.getByLabel('Branch', { exact: true })).toHaveValue(fixture.branchId);
  await expect(page.getByRole('button', { name: 'Station setup', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stations', exact: true })).toHaveCount(0);
  await page.getByLabel('Business date', { exact: true }).fill('2026-09-02');
  await expect(page.getByRole('heading', { name: 'Day shift · 2026-09-02' })).toBeVisible();
  if (await page.getByText('Closed shift', { exact: true }).count()) {
    await page.getByLabel('Correction reason', { exact: true }).fill('Repeat browser verification');
    await page.getByRole('button', { name: 'Reopen for correction' }).click();
    await expect(page.getByText('Draft shift', { exact: true })).toBeVisible();
  }
  // Set a complete, balanced paper shift with one delivery and two attendants.
  async function fill(label, value) {
    await page.getByLabel(label, { exact: true }).fill(String(value));
  }
  await fill('Opening N1 interval 1', 1200);
  await fill('Closing N1 interval 1', 1300);
  await fill('Opening dip Petrol Tank 1', 1798);
  await fill('Closing dip Petrol Tank 1', 2698);
  await fill('Closing N2 interval 1', 2050);
  await fill('Closing dip Diesel Tank 1', 950);
  await fill('Cash sales collected', 445000);
  await fill('Cash handed over', 445000);
  // Blank closing dips block closure on the server, not just in the browser.
  await fill('Closing dip Petrol Tank 1', '');
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: /Saved · revision/ })
      .first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Review & close shift' })).toBeDisabled();
  await expect(
    page.getByText('Manually enter opening and closing dip litres for Petrol Tank 1.', {
      exact: true,
    }),
  ).toBeVisible();
  await fill('Closing dip Petrol Tank 1', 2698);
  await expect(page.getByRole('button', { name: 'Review & close shift' })).toBeEnabled({
    timeout: 15000,
  });
  await page.getByRole('heading', { name: 'Fuel Reporting', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(root, '.tmp-fuel-reporting/desktop.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Review & close shift' }).click();
  await page.getByRole('button', { name: 'Submit & close shift', exact: true }).click();
  await expect(
    page.getByText('Shift closed. Its figures are now included in the daily summary.'),
  ).toBeVisible();
  await page.reload();
  await page.getByLabel('Business date', { exact: true }).fill('2026-09-02');
  await expect(page.getByText('Closed shift', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Attendant N1 interval 1')).toHaveValue('Asha Juma');
  await expect(page.getByLabel('Attendant N2 interval 1')).toHaveValue('John Musa');
  await page.getByRole('button', { name: /Daily summary/ }).click();
  await expect(page.getByText('1 of 2 shifts closed')).toBeVisible();
  await page.getByLabel('Business date', { exact: true }).fill('2026-09-01');
  await expect(page.getByText('Complete day', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(root, '.tmp-fuel-reporting/daily.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('aside')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Open Itemba/ })).toBeVisible();
  await page.getByRole('heading', { name: 'Fuel Reporting', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(root, '.tmp-fuel-reporting/mobile.png'),
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBe(false);
  await page.getByRole('button', { name: 'Report history', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open report →' }).first()).toBeVisible();
  await page.setViewportSize({ width: 1536, height: 1000 });
  await context.unroute('**/api/auth/me');
  await context.route('**/api/auth/me', (route) => route.fulfill({ json: fixture.administrator }));
  await context.addCookies([
    {
      name: 'itemba_access',
      value: 'fixture-admin',
      domain: 'localhost',
      path: '/',
      httpOnly: true,
    },
  ]);
  await page.reload();
  await page.getByLabel('Branch', { exact: true }).selectOption(fixture.branchId);
  await page.getByRole('button', { name: 'Station setup', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add pump', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove pump', exact: true })).toBeVisible();
  await page.getByLabel('Pump code', { exact: true }).fill(`UI-${Date.now()}`);
  await page.getByLabel('Pump name', { exact: true }).fill('Temporary verification pump');
  await page.getByLabel('Nozzle code', { exact: true }).fill('TEST-NOZZLE');
  await page.getByRole('button', { name: 'Add pump', exact: true }).click();
  await expect(page.getByText('Pump added.', { exact: true })).toBeVisible();
  const pumpRow = page.getByRole('row').filter({ hasText: 'Temporary verification pump' });
  page.once('dialog', (dialog) => dialog.accept());
  await pumpRow.getByRole('button', { name: 'Remove pump' }).click();
  await expect(pumpRow.getByText('Inactive', { exact: true })).toBeVisible();
  await expect(pumpRow.getByText('History retained', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Station management' })).toBeVisible();
  const stationName = `Browser station ${Date.now()}`;
  await page.getByLabel('Station code', { exact: true }).fill(`UI-ST-${Date.now()}`);
  await page.getByLabel('Station name', { exact: true }).fill(stationName);
  await page.getByLabel('Station location', { exact: true }).fill('Test location');
  await page.getByRole('button', { name: 'Add station', exact: true }).click();
  const stationRow = page.getByRole('row').filter({ hasText: stationName });
  await expect(stationRow).toBeVisible();
  await expect(page.getByLabel('Branch', { exact: true }).locator('option:checked')).toHaveText(
    stationName,
  );
  await stationRow.getByRole('button', { name: 'Edit station' }).click();
  await page.getByLabel('Station location', { exact: true }).fill('Updated location');
  await page.getByRole('button', { name: 'Save station', exact: true }).click();
  await expect(stationRow.getByText('Updated location')).toBeVisible();
  await stationRow.getByRole('button', { name: 'Configure', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add pump', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stations', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await stationRow.getByRole('button', { name: 'Remove station' }).click();
  await expect(stationRow.getByText('Removed · history retained')).toBeVisible();
  await expect(
    page.getByLabel('Branch', { exact: true }).locator('option').filter({ hasText: stationName }),
  ).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Stations', exact: true }).click();
  await expect(stationRow.getByRole('button', { name: 'Restore station' })).toBeVisible();
  await stationRow.getByRole('button', { name: 'Restore station' }).click();
  await expect(stationRow.getByText('Active', { exact: true })).toBeVisible();
  await page.screenshot({
    path: path.join(root, '.tmp-fuel-reporting/stations-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({
    path: path.join(root, '.tmp-fuel-reporting/stations-mobile.png'),
    fullPage: true,
  });
  console.log(
    'PASS: admin station creation, editing, configuration, removal, persisted status, restore and mobile layout.',
  );
  expect(errors).toEqual([]);
  console.log(
    'PASS: login gateway, manager branch selection, real autosave, mandatory dips, shift closure, reload persistence, daily completeness, history, admin pump creation/deactivation and 390px layout.',
  );
} finally {
  await browser.close();
}
