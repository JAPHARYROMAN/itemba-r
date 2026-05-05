import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(
  rootDir,
  process.env.REGISTRY_UI_SMOKE_ENV_FILE ?? process.env.npm_config_env_file ?? '.env.staging',
);
const envValues = existsSync(envFile) ? loadEnv(envFile) : {};
const config = { ...envValues, ...process.env };

const frontendUrl = normalizeBaseUrl(
  config.REGISTRY_UI_SMOKE_FRONTEND_URL ?? 'http://127.0.0.1:3000',
);
const apiUrl = normalizeBaseUrl(config.REGISTRY_UI_SMOKE_API_URL ?? 'http://127.0.0.1:3001/api/v1');
const email =
  config.REGISTRY_UI_SMOKE_EMAIL ??
  config.REGISTRY_SMOKE_EMAIL ??
  config.SEED_ADMIN_EMAIL ??
  config.AUTH_SMOKE_EMAIL;
const password =
  config.REGISTRY_UI_SMOKE_PASSWORD ??
  config.REGISTRY_SMOKE_PASSWORD ??
  config.SEED_ADMIN_PASSWORD ??
  config.AUTH_SMOKE_PASSWORD;
const companyCode = config.REGISTRY_UI_SMOKE_COMPANY_CODE ?? 'ITEMBA_ENT';

const cleanupState = {
  token: null,
  divisionId: null,
  branchIds: new Set(),
};

test.setTimeout(90_000);

test.afterEach(async () => {
  await cleanupCreatedRecords();
});

test('registry UI division and branch CRUD workflow', async ({ page }) => {
  if (!email || !password) {
    throw new Error(
      'Missing UI registry smoke credentials. Set REGISTRY_UI_SMOKE_EMAIL/REGISTRY_UI_SMOKE_PASSWORD or SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD.',
    );
  }

  cleanupState.token = await apiLogin();
  const company = await selectCompany();
  const suffix = Date.now().toString();
  const short = suffix.slice(-8);
  const divisionCode = `RUI${short}`;
  const branchCode = `RUA${short}`;
  const secondBranchCode = `RUB${short}`;

  await test.step('log in through the visible login form', async () => {
    await page.goto(`${frontendUrl}/login?from=%2Fcompanies`);
    await expect(page.getByRole('heading', { name: 'Account sign in' })).toBeVisible();
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard', { timeout: 30_000 });
  });

  await test.step('open company divisions tab', async () => {
    await page.goto(`${frontendUrl}/companies/${company.id}`);
    await expect(page.getByRole('heading', { name: company.name })).toBeVisible();
    await page.getByRole('button', { name: /^Divisions/ }).click();
    await expect(page.getByRole('heading', { name: 'Divisions and branches' })).toBeVisible();
  });

  await test.step('create a division through the UI', async () => {
    await page.getByRole('button', { name: '+ Add Division' }).click();
    await page.getByLabel('Division Name').fill(`Registry UI Smoke Division ${short}`);
    await page.getByLabel('Code').fill(divisionCode);
    await page.getByLabel('Type').selectOption('PETROLEUM');
    await page.getByLabel('Description').fill(`Created by registry UI smoke ${suffix}`);
    await page.getByRole('button', { name: 'Create Division' }).click();

    const division = await waitForApiRecord(
      () => apiGet(`/divisions?companyId=${company.id}`),
      (item) => item.code === divisionCode,
      'created division persistence',
    );
    cleanupState.divisionId = division.id;
    await expect(page.getByTestId(`division-select-${divisionCode}`)).toBeVisible({ timeout: 15_000 });
  });

  await test.step('create a branch/station through the UI', async () => {
    await page.getByTestId(`division-select-${divisionCode}`).click();
    await page.getByTestId('add-branch-button').click();
    await page.getByLabel('Branch Name').fill(`Registry UI Smoke Station ${short}`);
    await page.getByLabel('Code').fill(branchCode);
    await page.getByLabel('Type').selectOption('FUEL_STATION');
    await page.getByLabel('Location').fill('Registry UI Smoke Location');
    await page.getByLabel('Phone').fill('+255 000 000 010');
    await page.getByLabel('Address').fill('Registry UI Smoke Address');
    await page.getByRole('button', { name: 'Create Branch' }).click();

    const branch = await waitForApiRecord(
      () => apiGet(`/branches?divisionId=${cleanupState.divisionId}`),
      (item) => item.code === branchCode,
      'created branch persistence',
    );
    cleanupState.branchIds.add(branch.id);
    await expect(page.getByTestId(`branch-row-${branchCode}`)).toContainText('Active', { timeout: 15_000 });
  });

  await test.step('edit the division and branch through the UI', async () => {
    const updatedDivisionName = `Registry UI Smoke Division Updated ${short}`;
    await page.getByTestId(`division-edit-${divisionCode}`).click();
    await page.getByLabel('Division Name').fill(updatedDivisionName);
    await page.getByRole('button', { name: 'Save Division' }).click();
    await expect(page.getByTestId(`division-select-${divisionCode}`)).toContainText(updatedDivisionName);

    const updatedBranchName = `Registry UI Smoke Station Updated ${short}`;
    await page.getByTestId(`branch-edit-${branchCode}`).click();
    await page.getByLabel('Branch Name').fill(updatedBranchName);
    await page.getByLabel('Location').fill('Registry UI Smoke Location Updated');
    await page.getByRole('button', { name: 'Save Branch' }).click();
    await expect(page.getByTestId(`branch-row-${branchCode}`)).toContainText(updatedBranchName);
    await expect(page.getByTestId(`branch-row-${branchCode}`)).toContainText(
      'Registry UI Smoke Location Updated',
    );
  });

  await test.step('deactivate and reactivate the branch', async () => {
    await page.getByTestId(`branch-toggle-${branchCode}`).click();
    await expect(page.getByTestId(`branch-row-${branchCode}`)).toContainText('Inactive');
    await page.getByTestId(`branch-toggle-${branchCode}`).click();
    await expect(page.getByTestId(`branch-row-${branchCode}`)).toContainText('Active');
  });

  await test.step('deactivate and reactivate the division with branch rules', async () => {
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId(`division-toggle-${divisionCode}`).click();
    await expect(page.getByTestId(`division-select-${divisionCode}`)).toContainText('Inactive');
    await expect(page.getByTestId(`branch-row-${branchCode}`)).toContainText('Inactive');
    await expect(page.getByTestId(`branch-toggle-${branchCode}`)).toBeDisabled();

    await page.getByTestId(`division-toggle-${divisionCode}`).click();
    await expect(page.getByTestId(`division-select-${divisionCode}`)).toContainText('Active');
    await expect(page.getByTestId(`branch-toggle-${branchCode}`)).toBeEnabled();
    await page.getByTestId(`branch-toggle-${branchCode}`).click();
    await expect(page.getByTestId(`branch-row-${branchCode}`)).toContainText('Active');
  });

  await test.step('archive a branch through the UI', async () => {
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId(`branch-archive-${branchCode}`).click();
    await expect(page.getByTestId(`branch-row-${branchCode}`)).toHaveCount(0);
    cleanupState.branchIds.clear();
  });

  await test.step('archive a division and confirm branch cascade', async () => {
    await page.getByTestId('add-branch-button').click();
    await page.getByLabel('Branch Name').fill(`Registry UI Smoke Cascade Station ${short}`);
    await page.getByLabel('Code').fill(secondBranchCode);
    await page.getByLabel('Type').selectOption('FUEL_STATION');
    await page.getByRole('button', { name: 'Create Branch' }).click();
    await expect(page.getByTestId(`branch-row-${secondBranchCode}`)).toContainText('Active');

    const secondBranch = await apiGet(`/branches?divisionId=${cleanupState.divisionId}`).then((items) =>
      items.find((item) => item.code === secondBranchCode),
    );
    if (secondBranch?.id) cleanupState.branchIds.add(secondBranch.id);

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId(`division-archive-${divisionCode}`).click();
    await expect(page.getByTestId(`division-select-${divisionCode}`)).toHaveCount(0);
    await expect(page.getByTestId(`branch-row-${secondBranchCode}`)).toHaveCount(0);
    cleanupState.branchIds.clear();
    cleanupState.divisionId = null;
  });
});

async function apiLogin() {
  const body = await apiRequest('POST', '/auth/login', { email, password }, null);
  const data = body.data ?? body;
  if (!data.accessToken) throw new Error('API login did not return an access token');
  return data.accessToken;
}

async function selectCompany() {
  const body = await apiGet('/companies?limit=50');
  const companies = Array.isArray(body) ? body : body.data;
  const company = companies?.find((item) => item.code === companyCode) ?? companies?.[0];
  if (!company) throw new Error('No accessible company found for registry UI smoke');
  return company;
}

async function cleanupCreatedRecords() {
  if (!cleanupState.token) return;
  for (const branchId of cleanupState.branchIds) {
    await apiRequest('DELETE', `/branches/${branchId}`, undefined, cleanupState.token, [200, 204, 404]).catch(
      () => undefined,
    );
  }
  cleanupState.branchIds.clear();
  if (cleanupState.divisionId) {
    await apiRequest(
      'DELETE',
      `/divisions/${cleanupState.divisionId}`,
      undefined,
      cleanupState.token,
      [200, 204, 404],
    ).catch(() => undefined);
    cleanupState.divisionId = null;
  }
}

async function apiGet(path) {
  const body = await apiRequest('GET', path, undefined, cleanupState.token);
  return body.data ?? body;
}

async function waitForApiRecord(fetchItems, predicate, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    const items = await fetchItems();
    const match = items.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} was not visible through the API within 15s`);
}

async function apiRequest(method, path, body, token = cleanupState.token, allowedStatuses = [200, 201]) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!allowedStatuses.includes(response.status)) {
    throw new Error(`${method} ${path} failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  if (!text) return null;
  return JSON.parse(text);
}

function loadEnv(file) {
  const values = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    values[trimmed.slice(0, separator).trim()] = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return values;
}

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, '');
}
