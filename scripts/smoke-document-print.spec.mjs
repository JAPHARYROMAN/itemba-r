import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(
  rootDir,
  process.env.DOCUMENT_PRINT_SMOKE_ENV_FILE ?? process.env.npm_config_env_file ?? '.env.staging',
);
const envValues = existsSync(envFile) ? loadEnv(envFile) : {};
const config = { ...envValues, ...process.env };

const frontendUrl = normalizeBaseUrl(
  config.DOCUMENT_PRINT_SMOKE_FRONTEND_URL ?? 'http://127.0.0.1:3000',
);
const apiUrl = normalizeBaseUrl(config.DOCUMENT_PRINT_SMOKE_API_URL ?? 'http://127.0.0.1:3001/api/v1');
const email =
  config.DOCUMENT_PRINT_SMOKE_EMAIL ??
  config.SEED_ADMIN_EMAIL ??
  config.AUTH_SMOKE_EMAIL ??
  config.REGISTRY_SMOKE_EMAIL;
const password =
  config.DOCUMENT_PRINT_SMOKE_PASSWORD ??
  config.SEED_ADMIN_PASSWORD ??
  config.AUTH_SMOKE_PASSWORD ??
  config.REGISTRY_SMOKE_PASSWORD;

test.setTimeout(120_000);

test('document print pages and generated PDFs use shared letterhead', async ({ page }) => {
  if (!email || !password) {
    throw new Error(
      'Missing document print smoke credentials. Set DOCUMENT_PRINT_SMOKE_EMAIL/DOCUMENT_PRINT_SMOKE_PASSWORD or SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD.',
    );
  }

  const token = await apiLogin();
  const documents = await resolveDocumentFixtures(token);

  await frontendLogin(page, email, password);

  for (const document of documents) {
    await test.step(`render ${document.name} print page`, async () => {
      const detail = await apiGet(document.detailPath, token);
      const sourceCompany =
        document.entityType === 'CUSTOMER_PROFILE' ? detail.customer?.company : detail.company;
      const sourceBranch =
        document.entityType === 'CUSTOMER_PROFILE' ? detail.customer?.branch : detail.branch;
      const organization = organizationFor(sourceCompany, sourceBranch);

      await page.goto(`${frontendUrl}${document.printPath}`, { waitUntil: 'domcontentloaded' });
      const pageShell = page.locator('.document-page');
      await expect(page.getByRole('heading', { name: document.title })).toBeVisible({ timeout: 30_000 });
      await expect(pageShell).toContainText(organization.groupName);
      await expect(pageShell).toContainText(organization.name);

      if (organization.branchName) await expect(pageShell).toContainText(organization.branchName);
      if (organization.address) await expect(pageShell).toContainText(`Address: ${organization.address}`);
      if (organization.phone) await expect(pageShell).toContainText(`Tel: ${organization.phone}`);
      if (organization.email) await expect(pageShell).toContainText(`Email: ${organization.email}`);
      if (organization.tin) await expect(pageShell).toContainText(`TIN: ${organization.tin}`);
      if (organization.vrn) await expect(pageShell).toContainText(`VRN: ${organization.vrn}`);
      if (organization.logoUrl) await expect(pageShell.locator('img[alt*="logo" i]')).toBeVisible();
    });

    await test.step(`generate ${document.name} PDF artifact`, async () => {
      const generated = await apiRequest(
        'POST',
        '/generated-documents/pdf',
        { entityType: document.entityType, entityId: document.id },
        token,
      );
      const documentId = generated.document?.id;
      if (!documentId) throw new Error(`${document.name} PDF generation did not return a document id`);

      const pdf = await apiBinary(`/documents/${documentId}/download`, token);
      const signature = Buffer.from(pdf.bytes.slice(0, 5)).toString('ascii');
      expect(signature).toBe('%PDF-');
      expect(pdf.contentType).toContain('application/pdf');
      expect(pdf.bytes.byteLength).toBeGreaterThan(1000);
    });
  }
});

async function resolveDocumentFixtures(token) {
  const fixtures = [
    await fixture(token, {
      name: 'customer profile',
      title: 'Customer Profile',
      entityType: 'CUSTOMER_PROFILE',
      listPath: '/customers?limit=20',
      detailPath: (id) => `/customers/${id}/profile`,
      printPath: (id) => `/westsides/customers/${id}/print`,
    }),
    await fixture(token, {
      name: 'sales order',
      title: 'Sales Order',
      entityType: 'SALES_ORDER',
      listPath: '/sales-orders?limit=20',
      detailPath: (id) => `/sales-orders/${id}`,
      printPath: (id) => `/operations/sales-orders/${id}/print`,
    }),
    await fixture(token, {
      name: 'quotation',
      title: 'Quotation',
      entityType: 'QUOTATION',
      listPath: '/westsides/quotations?limit=20',
      detailPath: (id) => `/westsides/quotations/${id}`,
      printPath: (id) => `/westsides/quotations/${id}/print`,
    }),
    await fixture(token, {
      name: 'proforma invoice',
      title: 'Proforma Invoice',
      entityType: 'PROFORMA_INVOICE',
      listPath: '/westsides/proforma-invoices?limit=20',
      detailPath: (id) => `/westsides/proforma-invoices/${id}`,
      printPath: (id) => `/westsides/proforma-invoices/${id}/print`,
    }),
    await fixture(token, {
      name: 'delivery note',
      title: 'Delivery Note',
      entityType: 'DELIVERY_NOTE',
      listPath: '/westsides/delivery-notes?limit=20',
      detailPath: (id) => `/westsides/delivery-notes/${id}`,
      printPath: (id) => `/westsides/delivery-notes/${id}/print`,
    }),
  ];

  return fixtures;
}

async function fixture(token, definition) {
  const body = await apiGet(definition.listPath, token);
  const rows = Array.isArray(body) ? body : body.data ?? body.items ?? [];
  const record = rows.find((item) => item?.id);
  if (!record) {
    throw new Error(`No ${definition.name} record found. Create or seed one before running document print smoke.`);
  }

  return {
    ...definition,
    id: record.id,
    detailPath: definition.detailPath(record.id),
    printPath: definition.printPath(record.id),
  };
}

async function frontendLogin(page, loginEmail, loginPassword) {
  const response = await page.context().request.post(`${frontendUrl}/api/auth/login`, {
    data: { email: loginEmail, password: loginPassword },
    headers: { Origin: frontendUrl },
  });
  if (!response.ok()) {
    throw new Error(`Frontend login failed: HTTP ${response.status()} ${await response.text()}`);
  }
}

async function apiLogin() {
  const body = await apiRequest('POST', '/auth/login', { email, password }, null);
  const data = body.data ?? body;
  if (!data.accessToken) throw new Error('API login did not return an access token');
  return data.accessToken;
}

async function apiGet(path, token) {
  return apiRequest('GET', path, undefined, token);
}

async function apiRequest(method, path, body, token) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text };
    }
  }
  if (!response.ok) {
    const message = Array.isArray(parsed?.message) ? parsed.message.join(', ') : parsed?.message;
    throw new Error(`${method} ${path} failed: ${message ?? `HTTP ${response.status}`}`);
  }
  return parsed.data ?? parsed;
}

async function apiBinary(path, token) {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`GET ${path} failed: HTTP ${response.status}`);
  return {
    contentType: response.headers.get('content-type') ?? '',
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}

function organizationFor(company, branch) {
  const profile = company?.profile;
  const group = company?.group;
  return {
    groupName: firstPresent(group?.name, 'ITEMBA GROUP') ?? 'ITEMBA GROUP',
    name: firstPresent(profile?.registeredName, company?.name, 'ITEMBA-R Group') ?? 'ITEMBA-R Group',
    branchName: firstPresent(branch?.name),
    address: firstPresent(branch?.address, branch?.location, profile?.registeredAddress, profile?.postalAddress, group?.address),
    phone: firstPresent(branch?.phone, company?.phone, group?.phone),
    email: firstPresent(company?.email, group?.email, 'info@itembagrouptz.com'),
    tin: firstPresent(profile?.tin),
    vrn: firstPresent(profile?.vrn),
    logoUrl: firstPresent(company?.logoUrl),
  };
}

function firstPresent(...values) {
  return values.find((value) => String(value ?? '').trim().length > 0) ?? null;
}

function loadEnv(file) {
  const result = {};
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, '');
}
