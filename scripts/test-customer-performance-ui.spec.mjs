/**
 * Synthetic browser proof of the compiled Customer Performance feature.
 * Run against a local frontend: npx playwright test scripts/test-customer-performance-ui.spec.mjs --workers=1 --reporter=line
 * Every backend/auth request is fulfilled here. No live customer or payment writes occur.
 */
import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseUrl = process.env.CUSTOMER_PERFORMANCE_UI_URL ?? 'http://localhost:3019';
if (!['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname))
  throw new Error('This synthetic proof requires a local frontend.');
const output = resolve('tmp/customer-performance-ui');
const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
const from = new Date(`${today}T00:00:00Z`);
from.setUTCDate(from.getUTCDate() - 89);
const period = { dateFrom: from.toISOString().slice(0, 10), dateTo: today };
const permissions = [
  'sales.view',
  'customers.view',
  'receivables.view',
  'cash_desk.view',
  'customer-payments.view',
  'customer_statements.view',
  'customer_statements.generate',
  'customer_statements.list',
  'companies.read',
  'divisions.read',
  'branches.read',
];
const user = {
  id: 'synthetic-customer-performance-user',
  email: 'synthetic@example.test',
  fullName: 'Synthetic Review',
  roles: ['GROUP_SUPER_ADMIN'],
  companyId: 'synthetic-company',
  permissions,
};
const row = (id, name, category, overrides = {}) => ({
  id,
  companyId: 'synthetic-company',
  code: `CUS-${id.toUpperCase()}`,
  name,
  category,
  reasons: ['Reliable payment history', 'No overdue invoices'],
  salesRank: 1,
  netSales: '128450000.00',
  previousNetSales: '102340000.00',
  salesCount: 31,
  collected: '120250000.00',
  receiptBasis: 'actual-receipts',
  lastPaymentDate: today,
  outstanding: '8200000.00',
  overdue: '0.00',
  customerCredit: '400000.00',
  netDue: '7800000.00',
  oldestDaysOverdue: 0,
  onTimePercent: 98.6,
  eligibleInvoiceCount: 23,
  missingDueDateCount: 0,
  paymentLabel: 'reliable',
  ...overrides,
});
const customers = [
  row('acacia', 'Acacia Trading', 'best', {
    reasons: ['Top 20% by sales contribution', '98.6% paid on time', 'No overdue invoices'],
  }),
  row('lakeview', 'Lakeview Hardware', 'good', {
    netSales: '48600000.00',
    collected: '43200000.00',
    outstanding: '5400000.00',
    customerCredit: '0.00',
    netDue: '5400000.00',
    salesRank: 2,
    onTimePercent: 93.2,
    eligibleInvoiceCount: 12,
  }),
  row('mlimani', 'Mlimani Supplies', 'needs-attention', {
    netSales: '32750000.00',
    collected: '25000000.00',
    outstanding: '7750000.00',
    overdue: '2400000.00',
    netDue: '7750000.00',
    customerCredit: '0.00',
    salesRank: 3,
    oldestDaysOverdue: 42,
    onTimePercent: 65,
    paymentLabel: 'needs-attention',
    reasons: ['TZS 2,400,000 overdue', 'Oldest invoice is 42 days late'],
  }),
  row('harbour', 'New Harbour Stores', 'insufficient-history', {
    netSales: '2600000.00',
    collected: '2600000.00',
    outstanding: '0.00',
    customerCredit: '0.00',
    netDue: '0.00',
    salesRank: 4,
    onTimePercent: null,
    eligibleInvoiceCount: 0,
    paymentLabel: 'paid-at-sale',
    reasons: ['Paid at sale', 'No credit-payment history to rate'],
  }),
];
const statement = (selection, runId) => ({
  companyId: selection.companyId,
  customerId: selection.customerId,
  company: {
    id: 'synthetic-company',
    name: 'ITEMBA Synthetic Company',
    code: 'SYN',
    email: 'accounts@example.test',
    phone: '+255 000 000 000',
  },
  customer: {
    id: 'acacia',
    name: 'Acacia Trading',
    customerCode: 'CUS-ACACIA',
    address: 'Synthetic account · Dar es Salaam',
  },
  customerName: 'Acacia Trading',
  customerEmail: 'customer@example.test',
  currency: selection.currency ?? 'TZS',
  dateFrom: selection.dateFrom ?? period.dateFrom,
  dateTo: selection.dateTo ?? today,
  openingBalance: '1000000.00',
  totalDebits: '2500000.00',
  totalCredits: '1500000.00',
  closingBalance: '2000000.00',
  openInvoiceBalance: '2400000.00',
  customerCredit: '400000.00',
  netBalance: '2000000.00',
  generatedAt: `${today}T09:30:00Z`,
  agingAsOf: selection.dateTo ?? today,
  contentHash: 'synthetic-preview-hash',
  scope: {
    companyId: 'synthetic-company',
    divisionId: selection.divisionId,
    branchId: selection.branchId,
    unrestricted: true,
  },
  scopeLabel: selection.branchId ? 'Central branch · Distribution' : 'ITEMBA Synthetic Company',
  ...(runId ? { runId, statementRunNumber: 'ST-SYNTHETIC-001' } : {}),
  warnings: ['Synthetic fixture. Direct entries remain separate.'],
  lines: [
    {
      date: selection.dateFrom ?? period.dateFrom,
      type: 'INVOICE',
      reference: 'SO-SYN-041',
      description: 'Building supplies · credit sale',
      sourceId: 'synthetic-sale',
      sourceUrl: '/sales-desk/sales/synthetic-sale',
      debit: '2500000.00',
      credit: '0.00',
      balance: '3500000.00',
    },
    {
      date: today,
      type: 'PAYMENT',
      reference: 'PAY-SYN-018',
      description: 'Bank transfer received',
      sourceId: 'synthetic-payment',
      credit: '1500000.00',
      debit: '0.00',
      balance: '2000000.00',
    },
  ],
  lineCount: 2,
  aging: {
    current: '2000000.00',
    days1_30: '400000.00',
    days31_60: '0.00',
    days61_90: '0.00',
    over90: '0.00',
    total: '2400000.00',
    oldestDaysOverdue: 14,
  },
});
test.use({
  browserName: 'chromium',
  channel: process.env.CUSTOMER_PERFORMANCE_UI_CHANNEL ?? 'chrome',
  viewport: { width: 1600, height: 1200 },
  serviceWorkers: 'block',
});
test.setTimeout(150000);

test('synthetic Sales Desk customer performance, payments, snapshots and mobile', async ({
  page,
  context,
}) => {
  await mkdir(output, { recursive: true });
  const requests = [],
    errors = [];
  let savedStatement = null;
  let savedRuns = [];
  let sessionRevision = 0;
  const sessionRows = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await context.addCookies([
    {
      name: 'itemba_access',
      value: 'synthetic-test-only',
      url: baseUrl,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await context.route('**/api/auth/**', (route) =>
    route.fulfill({
      json: route.request().url().includes('/me') ? { data: user } : { refreshed: true },
    }),
  );
  await context.route('**/api/backend/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice('/api/backend'.length);
    const query = Object.fromEntries(url.searchParams);
    const method = route.request().method();
    const body = route.request().postDataJSON();
    requests.push({ path, query, method, body });
    const fulfill = (json) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
    if (path === '/customer-performance') {
      const searched = customers.filter(
        (item) =>
          !query.search ||
          `${item.name} ${item.code}`.toLowerCase().includes(query.search.toLowerCase()),
      );
      const rows = searched.filter((item) => !query.category || item.category === query.category);
      return fulfill({
        period: {
          dateFrom: query.dateFrom ?? period.dateFrom,
          dateTo: query.dateTo ?? today,
          previousFrom: period.dateFrom,
          previousTo: today,
        },
        asOf: today,
        reliabilityAsOf: query.dateTo ?? today,
        currency: query.currency ?? 'TZS',
        receiptBasis: 'actual-receipts',
        access: { sales: true, balances: true, receipts: true },
        rules: {
          minimumDueInvoices: 5,
          bestOnTimePercent: 95,
          goodOnTimePercent: 90,
          topSalesPercent: 20,
          salesBasis: 'Document value after credit adjustments, including tax',
        },
        coverage: 'business-sales',
        warnings: [
          'Synthetic fixture. Standalone Direct entries are excluded from these balances.',
        ],
        summary: {
          customers: searched.length,
          best: 1,
          good: 1,
          needsAttention: 1,
          insufficientHistory: 1,
          inactive: 0,
          netSales: '212400000.00',
          collected: '191050000.00',
          outstanding: '21350000.00',
          overdue: '2400000.00',
          customerCredit: '400000.00',
          netDue: '20950000.00',
        },
        rows,
        total: rows.length,
        page: Number(query.page ?? 1),
        limit: Number(query.limit ?? 25),
      });
    }
    if (path.endsWith('/history') && path.startsWith('/customer-performance/'))
      return fulfill({
        customer: {
          id: 'acacia',
          name: 'Acacia Trading',
          code: 'CUS-ACACIA',
          companyId: 'synthetic-company',
        },
        performance: customers[0],
        currency: query.currency ?? 'TZS',
        asOf: today,
        reliabilityAsOf: query.dateTo ?? today,
        access: { sales: true, balances: true, receipts: true },
        period: { dateFrom: query.dateFrom ?? period.dateFrom, dateTo: query.dateTo ?? today },
        rows: [
          {
            id: 'receipt',
            date: today,
            reference: 'PAY-SYN-018',
            source: 'CustomerPayment',
            sourceType: 'CustomerPayment',
            sourceUrl: '/cash-desk/receivables?customerId=acacia',
            method: 'BANK_TRANSFER',
            amount: '1500000.00',
            appliedAmount: '1100000.00',
            unappliedAmount: '400000.00',
            status: 'COMPLETED',
            allocations: [
              {
                receivableId: 'synthetic-receivable',
                reference: 'REC-SYN-041',
                amount: '1100000.00',
                dueDate: today,
              },
            ],
          },
          {
            id: 'reversed',
            date: period.dateFrom,
            reference: 'PAY-SYN-009',
            source: 'JournalEntry',
            sourceType: 'JournalEntry',
            sourceUrl: '/finance/journal-entries',
            method: 'CASH',
            amount: '250000.00',
            appliedAmount: '250000.00',
            unappliedAmount: '0.00',
            status: 'REVERSED',
            reversedAt: today,
            reversalAmount: '-250000.00',
            allocations: [],
          },
        ],
        total: 2,
        page: 1,
        limit: 25,
      });
    if (path === '/customer-statements/detail') return fulfill(statement(query));
    if (path === '/customer-statements/synthetic-run/detail') return fulfill(savedStatement);
    if (path === '/customer-statements' && method === 'GET')
      return fulfill({ data: savedRuns, total: savedRuns.length, page: 1, limit: 20 });
    if (path === '/customer-statements/generate') {
      expect(body.expectedHash).toBe('synthetic-preview-hash');
      savedStatement = statement(
        { ...body, dateFrom: body.periodStart, dateTo: body.periodEnd },
        'synthetic-run',
      );
      const run = {
        id: 'synthetic-run',
        statementRunNumber: 'ST-SYNTHETIC-001',
        companyId: body.companyId,
        customerId: body.customerId,
        currency: body.currency,
        periodStart: body.periodStart,
        periodEnd: body.periodEnd,
        status: 'GENERATED',
        snapshot: savedStatement,
        hasSnapshot: true,
        hasPdf: true,
      };
      savedRuns = [run];
      return fulfill(run);
    }
    if (path === '/customer-statements/export/pdf') {
      expect(body).toEqual({ runId: 'synthetic-run' });
      return route.fulfill({
        contentType: 'application/pdf',
        headers: { 'Content-Disposition': 'attachment; filename="synthetic-statement.pdf"' },
        body: '%PDF-1.4\n% Synthetic download assertion only; real PDF rendering is verified separately.\n%%EOF',
      });
    }
    if (path === '/companies')
      return fulfill({
        data: [{ id: 'synthetic-company', name: 'ITEMBA Synthetic Company', code: 'SYN' }],
        total: 1,
        page: 1,
        limit: 100,
      });
    if (path === '/divisions')
      return fulfill({
        data: [{ id: 'synthetic-division', name: 'Distribution', code: 'DIV-SYN' }],
        total: 1,
        page: 1,
        limit: 100,
      });
    if (path === '/branches')
      return fulfill({
        data: [{ id: 'synthetic-branch', name: 'Central branch', code: 'BR-SYN' }],
        total: 1,
        page: 1,
        limit: 100,
      });
    if (path === '/user-preferences/me')
      return fulfill({
        desktop: {
          version: 1,
          theme: 'dune',
          mode: 'light',
          accent: '#a85d29',
          motion: 'reduced',
          widgets: { recent: false, drafts: false, approvals: false },
          shortcuts: [],
        },
        desktopRevision: 1,
      });
    if (path === '/workspace/sessions') return fulfill(sessionRows);
    if (path.startsWith('/workspace/sessions/') && method === 'PUT') {
      const record = {
        id: path.split('/').at(-1),
        ...body,
        revision: ++sessionRevision,
        updatedAt: new Date().toISOString(),
      };
      sessionRows.splice(0, sessionRows.length, record);
      return fulfill(record);
    }
    // Shell support reads and autosave are also synthetic; never let any API request through.
    if (path === '/workspace/drafts' || path.includes('notifications')) return fulfill([]);
    return fulfill(method === 'GET' ? [] : {});
  });

  await page.goto(`${baseUrl}/sales-desk/customer-performance`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  const feature = page.locator('.sales-desk-business').first();
  await expect(
    feature.getByRole('heading', { name: 'Customer Performance', exact: true }),
  ).toBeVisible({ timeout: 60000 });
  const maximise = page.getByRole('button', { name: 'Maximise Sales Desk window', exact: true });
  if (await maximise.count()) await maximise.click();
  await expect(
    feature.getByRole('link', { name: 'View performance for Acacia Trading' }),
  ).toBeVisible();
  await page.evaluate(() => {
    const banner = document.createElement('div');
    banner.id = 'synthetic-proof-banner';
    banner.textContent = 'SYNTHETIC FIXTURE · NO LIVE CUSTOMER DATA';
    Object.assign(banner.style, {
      position: 'fixed',
      zIndex: '99999',
      bottom: '4px',
      right: '8px',
      color: '#fff',
      background: '#4a382c',
      fontSize: '10px',
      padding: '5px 9px',
      borderRadius: '4px',
      pointerEvents: 'none',
    });
    document.body.append(banner);
  });
  await page.screenshot({ path: resolve(output, 'desktop-rankings-synthetic.png') });
  await feature
    .getByRole('region', { name: 'Customer rankings' })
    .screenshot({ path: resolve(output, 'desktop-table-synthetic.png') });
  await feature
    .getByRole('combobox', { name: 'Performance group', exact: true })
    .selectOption('needs-attention');
  await expect(
    feature.getByRole('link', { name: 'View performance for Mlimani Supplies' }),
  ).toBeVisible();
  await expect(
    feature.getByRole('link', { name: 'View performance for Acacia Trading' }),
  ).toHaveCount(0);
  await feature.getByRole('combobox', { name: 'Performance group', exact: true }).selectOption('');
  await feature.getByPlaceholder('Name or customer code').fill('Acacia');
  await feature.getByRole('combobox', { name: 'Currency', exact: true }).selectOption('USD');
  await feature
    .getByRole('combobox', { name: 'Division', exact: true })
    .selectOption('synthetic-division');
  await feature
    .getByRole('combobox', { name: 'Branch', exact: true })
    .selectOption('synthetic-branch');
  await feature.getByRole('button', { name: 'This month', exact: true }).click();
  await expect(feature.getByRole('table', { name: 'Customer performance in USD' })).toBeVisible();
  await feature.getByRole('link', { name: 'View performance for Acacia Trading' }).click();
  await expect(feature.getByRole('heading', { name: 'Acacia Trading', exact: true })).toBeVisible();
  await feature
    .getByRole('region', { name: 'Customer payment history' })
    .getByText('Payment allocations', { exact: true })
    .first()
    .click();
  await expect(feature.getByRole('link', { name: 'REC-SYN-041' })).toBeVisible();
  await expect(feature.getByText('Reversal: USD -250,000.00', { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(output, 'desktop-customer-focus-synthetic.png') });
  await feature
    .getByRole('region', { name: 'Customer payment history' })
    .screenshot({ path: resolve(output, 'desktop-payment-history-synthetic.png') });
  const statements = feature.getByRole('region', { name: 'Account statement for Acacia Trading' });
  await statements.getByRole('button', { name: 'Preview statement', exact: true }).click();
  await expect(
    statements.getByRole('table', { name: 'Account transactions with running balance in USD' }),
  ).toBeVisible();
  await statements.getByRole('button', { name: 'Save statement', exact: true }).click();
  await expect(statements.getByText(/^Saved snapshot$/i)).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await statements.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('synthetic-statement.pdf');
  await statements.getByRole('button', { name: /ST-SYNTHETIC-001/ }).click();
  await expect(statements.getByText(/^Saved snapshot$/i)).toBeVisible();
  await statements.screenshot({ path: resolve(output, 'desktop-statement-synthetic.png') });
  await feature.getByRole('link', { name: 'Back to customer performance' }).click();
  await expect(feature.getByPlaceholder('Name or customer code')).toHaveValue('Acacia');
  // Rail navigation enters the existing customer directory and returns to performance.
  await feature
    .getByRole('navigation', { name: 'Sales Desk', exact: true })
    .getByRole('link', { name: 'Customers', exact: true })
    .click();
  await feature
    .getByRole('navigation', { name: 'Sales Desk', exact: true })
    .getByRole('link', { name: 'Customer Performance', exact: true })
    .click();
  await expect(
    feature.getByRole('heading', { name: 'Customer Performance', exact: true }),
  ).toBeVisible();
  await expect(feature.getByPlaceholder('Name or customer code')).toHaveValue('Acacia');
  await feature.getByPlaceholder('Name or customer code').fill('');
  await page.setViewportSize({ width: 390, height: 844 });
  await feature
    .getByRole('heading', { name: 'Customer Performance', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'mobile-filters-synthetic.png') });
  await feature
    .getByRole('link', { name: 'View performance for Acacia Trading' })
    .evaluate((link) => link.closest('tr').scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: resolve(output, 'mobile-customer-card-synthetic.png') });
  await expect(
    feature.getByRole('link', { name: 'View performance for Acacia Trading' }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
  const financialWrites = requests.filter(
    (request) => request.method !== 'GET' && request.path.startsWith('/customer-'),
  );
  expect(financialWrites.map((request) => request.path)).toEqual([
    '/customer-statements/generate',
    '/customer-statements/export/pdf',
  ]);
  await writeFile(
    resolve(output, 'synthetic-browser-evidence.json'),
    JSON.stringify(
      {
        synthetic: true,
        errors,
        requests,
        screenshots: [
          'desktop-rankings-synthetic.png',
          'desktop-table-synthetic.png',
          'desktop-customer-focus-synthetic.png',
          'desktop-payment-history-synthetic.png',
          'desktop-statement-synthetic.png',
          'mobile-filters-synthetic.png',
          'mobile-customer-card-synthetic.png',
        ],
      },
      null,
      2,
    ),
  );
});
