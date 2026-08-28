#!/usr/bin/env node
/**
 * Westsides tone-down end-to-end verification.
 *
 * Self-provisions an ISOLATED fixture company (group, company, division,
 * branch, CoA role accounts, unit, category, product, customer, role, user)
 * directly via Prisma — the same pattern as scripts/smoke-dynamic-frontend-
 * records.mjs — then exercises the REAL running API end to end:
 *
 *   login → companies → mobile-pos bootstrap → product search →
 *   customer search → explicit receipt-account provisioning → CASH quick-sale →
 *   idempotent replay → CREDIT quick-sale (receivable) → journal entries →
 *   sales-order list — then cleans the fixture up.
 *
 * Usage: node scripts/tone-down/verify-westsides-flows.mjs
 * Requires: backend running (default http://localhost:3014/api/v1),
 *           Postgres up, backend/.env(.local) present for DATABASE_URL.
 */
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = join(here, '..', '..', 'backend');
const require = createRequire(join(backendDir, 'package.json'));

// Load DATABASE_URL from backend env files without extra deps.
for (const file of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(join(backendDir, file), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
    }
  } catch {
    /* file optional */
  }
}

const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
const prisma = new PrismaClient();

const API = process.env.VERIFY_API_BASE ?? 'http://localhost:3014/api/v1';
const suffix = Date.now().toString().slice(-8);
const PASSWORD = 'WestsidesVerify123!';
const results = [];

function step(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function unwrap(body) {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-json */
  }
  return { status: res.status, body: json, data: unwrap(json) };
}

const PERMS = [
  'companies.read',
  'pos.create',
  'pos.view',
  'sales.create',
  'sales.view',
  'sales.confirm',
  'products.view',
  'products.create',
  'customers.view',
  'customers.create',
  'journal_entries.view',
  'cash_accounts.view',
  'cash_accounts.manage',
  'units.view',
  'reports.view',
  'finance.reports.view',
  'operations.reports.view',
];

async function createFixture() {
  const permissions = await Promise.all(
    PERMS.map((code) =>
      prisma.permission.upsert({
        where: { code },
        update: {},
        create: {
          code,
          description: `Westsides verify permission ${code}`,
          module: code.split('.')[0],
          action: code.split('.')[1] ?? 'view',
        },
      }),
    ),
  );

  const group = await prisma.group.create({
    data: { code: `WVG${suffix}`, name: `Westsides Verify Group ${suffix}` },
  });
  const company = await prisma.company.create({
    data: { groupId: group.id, code: `WVC${suffix}`, name: `Westsides Verify Co ${suffix}` },
  });
  const division = await prisma.division.create({
    data: {
      companyId: company.id,
      code: `WVD${suffix}`,
      name: 'Hardware & Building Materials',
      type: 'OTHER',
    },
  });
  const branch = await prisma.branch.create({
    data: {
      divisionId: division.id,
      code: `WVB${suffix}`,
      name: 'Main Branch',
      type: 'BRANCH',
      location: 'Dar es Salaam',
    },
  });

  // Posting requires an OPEN accounting period covering the transaction date.
  const year = new Date().getUTCFullYear();
  const fiscalYear = await prisma.fiscalYear.create({
    data: {
      companyId: company.id,
      name: `FY${year} Verify ${suffix}`,
      startDate: new Date(Date.UTC(year, 0, 1)),
      endDate: new Date(Date.UTC(year, 11, 31)),
      status: 'OPEN',
    },
  });
  const accountingPeriod = await prisma.accountingPeriod.create({
    data: {
      companyId: company.id,
      fiscalYearId: fiscalYear.id,
      name: `P${new Date().getUTCMonth() + 1} ${year} Verify`,
      startDate: new Date(Date.UTC(year, new Date().getUTCMonth(), 1)),
      endDate: new Date(Date.UTC(year, new Date().getUTCMonth() + 1, 0, 23, 59, 59)),
      status: 'OPEN',
    },
  });

  // CoA accounts the sales posting engine resolves by role (accountSubType).
  const coa = {};
  for (const [role, accountCode, accountName, accountType] of [
    ['cash_on_hand', '1010', 'Cash on Hand', 'ASSET'],
    ['ar_control', '1100', 'Accounts Receivable', 'ASSET'],
    ['sales_revenue', '4000', 'Sales Revenue', 'INCOME'],
  ]) {
    coa[role] = await prisma.chartOfAccount.create({
      data: {
        companyId: company.id,
        accountCode,
        accountName,
        accountType,
        accountSubType: role,
      },
    });
  }

  const unit = await prisma.unitOfMeasure.create({
    data: { name: `Piece ${suffix}`, symbol: `pc${suffix.slice(-3)}` },
  });
  const category = await prisma.productCategory.create({
    data: { companyId: company.id, name: `Building Materials ${suffix}` },
  });
  const product = await prisma.product.create({
    data: {
      companyId: company.id,
      categoryId: category.id,
      productCode: `CEM${suffix}`,
      name: `Cement Bag 50kg ${suffix}`,
      baseUnitId: unit.id,
      defaultSellingPrice: 5000,
      trackInventory: false,
      status: 'ACTIVE',
    },
  });
  const customer = await prisma.customer.create({
    data: {
      companyId: company.id,
      customerCode: `CUST${suffix}`,
      name: `Mkandarasi Builders ${suffix}`,
      phone: `+25571${suffix.slice(-6)}`,
      status: 'ACTIVE',
    },
  });

  const role = await prisma.role.create({
    data: {
      name: `westsides_verify_${suffix}`,
      displayName: 'Westsides Verify',
      scope: 'COMPANY',
      rolePermissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
    },
  });
  const email = `westsides-verify-${suffix}@itemba.local`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await argon2.hash(PASSWORD),
      fullName: 'Westsides Verify User',
      status: 'ACTIVE',
      companyId: company.id,
      userRoles: { create: { roleId: role.id } },
      companyAccess: { create: { companyId: company.id, accessLevel: 'MANAGE' } },
    },
  });

  return {
    group,
    company,
    division,
    branch,
    unit,
    category,
    product,
    customer,
    role,
    user,
    email,
    coa,
    fiscalYear,
    accountingPeriod,
  };
}

async function cleanup(f) {
  const cid = f.company.id;
  const tryDel = async (label, fn) => {
    try {
      await fn();
    } catch (e) {
      console.log(`  cleanup skip: ${label} (${e.code ?? e.message?.slice(0, 60)})`);
    }
  };
  await tryDel('tax transactions', () => prisma.taxTransaction.deleteMany({ where: { companyId: cid } }));
  await tryDel('receivables', () => prisma.receivable.deleteMany({ where: { companyId: cid } }));
  await tryDel('JE lines', () =>
    prisma.journalEntryLine.deleteMany({ where: { journalEntry: { companyId: cid } } }),
  );
  await tryDel('sales order lines', () =>
    prisma.salesOrderLine.deleteMany({ where: { salesOrder: { companyId: cid } } }),
  );
  await tryDel('sales orders', () => prisma.salesOrder.deleteMany({ where: { companyId: cid } }));
  await tryDel('journal entries', () => prisma.journalEntry.deleteMany({ where: { companyId: cid } }));
  await tryDel('cash accounts', () => prisma.cashAccount.deleteMany({ where: { companyId: cid } }));
  await tryDel('code sequences', () =>
    prisma.documentNumberSequence.deleteMany({ where: { companyId: cid } }),
  );
  await tryDel('accounting periods', () =>
    prisma.accountingPeriod.deleteMany({ where: { companyId: cid } }),
  );
  await tryDel('fiscal years', () => prisma.fiscalYear.deleteMany({ where: { companyId: cid } }));
  await tryDel('audit logs', () => prisma.auditLog.deleteMany({ where: { companyId: cid } }));
  await tryDel('customer', () => prisma.customer.deleteMany({ where: { companyId: cid } }));
  await tryDel('product', () => prisma.product.deleteMany({ where: { companyId: cid } }));
  await tryDel('category', () => prisma.productCategory.deleteMany({ where: { companyId: cid } }));
  await tryDel('unit', () => prisma.unitOfMeasure.delete({ where: { id: f.unit.id } }));
  await tryDel('CoA', () => prisma.chartOfAccount.deleteMany({ where: { companyId: cid } }));
  await tryDel('active sessions', () => prisma.activeSession.deleteMany({ where: { userId: f.user.id } }));
  await tryDel('user roles', () => prisma.userRole.deleteMany({ where: { userId: f.user.id } }));
  await tryDel('company access', () =>
    prisma.userCompanyAccess.deleteMany({ where: { userId: f.user.id } }),
  );
  await tryDel('user', () => prisma.user.delete({ where: { id: f.user.id } }));
  await tryDel('role perms', () => prisma.rolePermission.deleteMany({ where: { roleId: f.role.id } }));
  await tryDel('role', () => prisma.role.delete({ where: { id: f.role.id } }));
  await tryDel('branch', () => prisma.branch.delete({ where: { id: f.branch.id } }));
  await tryDel('division', () => prisma.division.delete({ where: { id: f.division.id } }));
  await tryDel('company', () => prisma.company.delete({ where: { id: cid } }));
  await tryDel('group', () => prisma.group.delete({ where: { id: f.group.id } }));
}

async function main() {
  console.log(`Fixture suffix: ${suffix}`);
  const f = await createFixture();
  console.log(`Fixture company: ${f.company.name} (${f.company.id})`);

  try {
    // 1. Login
    const login = await api('POST', '/auth/login', {
      body: { email: f.email, password: PASSWORD },
    });
    const token =
      login.data?.accessToken ?? login.data?.tokens?.accessToken ?? login.body?.accessToken;
    step('auth: login', login.status === 200 || login.status === 201, `status ${login.status}`);
    if (!token) {
      step('auth: access token present', false, JSON.stringify(login.body)?.slice(0, 200));
      return;
    }
    step('auth: access token present', true);

    // 2. Companies list contains fixture company
    const companies = await api('GET', '/companies?limit=200', { token });
    const companyRows = Array.isArray(companies.data) ? companies.data : (companies.data?.data ?? []);
    step(
      'companies: fixture company visible',
      companyRows.some((c) => c.id === f.company.id),
      `${companyRows.length} companies returned`,
    );

    // 3. Mobile POS bootstrap honours explicit companyId
    const boot = await api('GET', `/sales-orders/mobile-pos/bootstrap?companyId=${f.company.id}`, {
      token,
    });
    step(
      'mobile-pos bootstrap: company + division + branch + customer',
      boot.data?.company?.id === f.company.id &&
        (boot.data?.divisions ?? []).some((d) => d.id === f.division.id) &&
        (boot.data?.branches ?? []).some((b) => b.id === f.branch.id) &&
        (boot.data?.customers ?? []).some((c) => c.id === f.customer.id),
      `status ${boot.status}`,
    );

    // 4. Product search (POS search path)
    const prod = await api(
      'GET',
      `/products?companyId=${f.company.id}&search=Cement&status=ACTIVE&limit=12`,
      { token },
    );
    const prodRows = Array.isArray(prod.data) ? prod.data : (prod.data?.data ?? []);
    step('products: search finds fixture product', prodRows.some((p) => p.id === f.product.id));

    // 5. Customer search by phone fragment (new server-side search)
    const cust = await api(
      'GET',
      `/customers?companyId=${f.company.id}&search=${f.customer.phone.slice(-6)}&limit=12`,
      { token },
    );
    const custRows = Array.isArray(cust.data) ? cust.data : (cust.data?.data ?? []);
    step('customers: server-side search by phone', custRows.some((c) => c.id === f.customer.id));

    // 6. Provision through the explicit, permissioned write path. The receipt
    // account GET is intentionally read-only and must never create or reactivate
    // accounts as a side effect.
    const provisionedAccount = await api('POST', '/cash-accounts', {
      token,
      body: {
        companyId: f.company.id,
        divisionId: f.division.id,
        branchId: f.branch.id,
        accountName: `${f.branch.code} Cash Account`,
        accountType: 'CASH_ON_HAND',
        currency: 'TZS',
        openingBalance: 0,
        isActive: true,
        notes: 'Explicitly provisioned by Westsides flow verification.',
      },
    });
    step(
      'cash-accounts: branch cash drawer explicitly provisioned',
      provisionedAccount.status === 201 && Boolean(provisionedAccount.data?.id),
      `status ${provisionedAccount.status}`,
    );
    if (!provisionedAccount.data?.id) return;

    const accounts = await api(
      'GET',
      `/sales-orders/receipt-accounts?companyId=${f.company.id}&divisionId=${f.division.id}&branchId=${f.branch.id}&paymentMethod=CASH&limit=50`,
      { token },
    );
    const accountRows = Array.isArray(accounts.data) ? accounts.data : (accounts.data?.data ?? []);
    const cashAccount = accountRows.find((a) => a.accountType === 'CASH_ON_HAND');
    step(
      'receipt-accounts: read returns the explicitly provisioned drawer',
      cashAccount?.id === provisionedAccount.data.id,
      cashAccount ? cashAccount.accountName : `status ${accounts.status}`,
    );
    if (!cashAccount) return;

    // 7. CASH quick-sale with idempotency key
    const idemKey = `verify-${suffix}-1`;
    const saleBody = {
      companyId: f.company.id,
      divisionId: f.division.id,
      branchId: f.branch.id,
      salesType: 'CASH_SALE',
      orderDate: new Date().toISOString().slice(0, 10),
      currency: 'TZS',
      paymentMethod: 'CASH',
      cashAccountId: cashAccount.id,
      customerId: f.customer.id,
      idempotencyKey: idemKey,
      lines: [
        {
          productId: f.product.id,
          quantity: 2,
          unitId: f.unit.id,
          unitPrice: 5000,
          discountAmount: 0,
          taxAmount: 0,
        },
      ],
    };
    const sale = await api('POST', '/sales-orders/mobile-pos/quick-sale', { token, body: saleBody });
    const order = sale.data;
    step(
      'quick-sale CASH: confirmed + paid + posted',
      (sale.status === 200 || sale.status === 201) &&
        order?.status === 'CONFIRMED' &&
        order?.paymentStatus === 'PAID' &&
        Number(order?.totalAmount) === 10000 &&
        Boolean(order?.journalEntryId),
      `status ${sale.status}, order ${order?.salesOrderNumber ?? '?'}${order ? '' : ` body=${JSON.stringify(sale.body)?.slice(0, 200)}`}`,
    );

    // 8. Idempotent replay returns the SAME order
    const replay = await api('POST', '/sales-orders/mobile-pos/quick-sale', {
      token,
      body: saleBody,
    });
    step(
      'quick-sale CASH: duplicate submit replays same order (idempotency)',
      Boolean(order?.id) && replay.data?.id === order.id,
      `first=${order?.id?.slice(0, 8) ?? '?'} replay=${replay.data?.id?.slice(0, 8) ?? '?'}`,
    );

    // 9. CREDIT quick-sale creates a receivable
    const creditSale = await api('POST', '/sales-orders/mobile-pos/quick-sale', {
      token,
      body: {
        ...saleBody,
        salesType: 'CREDIT_SALE',
        paymentMethod: 'CREDIT',
        cashAccountId: undefined,
        idempotencyKey: `verify-${suffix}-2`,
      },
    });
    const credit = creditSale.data;
    step(
      'quick-sale CREDIT: confirmed + receivable + unpaid',
      (creditSale.status === 200 || creditSale.status === 201) &&
        credit?.status === 'CONFIRMED' &&
        credit?.paymentMethod === 'CREDIT' &&
        credit?.paymentStatus !== 'PAID' &&
        Number(credit?.outstandingAmount) === 10000 &&
        Boolean(credit?.receivableId ?? credit?.receivable?.id),
      `status ${creditSale.status}${credit ? `, outstanding ${credit.outstandingAmount}` : ` body=${JSON.stringify(creditSale.body)?.slice(0, 200)}`}`,
    );

    // 10. Journal entries exist and balance
    const jes = await api('GET', `/journal-entries?companyId=${f.company.id}&limit=20`, { token });
    const jeRows = Array.isArray(jes.data) ? jes.data : (jes.data?.data ?? []);
    const balanced = jeRows.every((je) => Number(je.totalDebit) === Number(je.totalCredit));
    step(
      'journal entries: >=2 postings, all balanced',
      jeRows.length >= 2 && balanced,
      `${jeRows.length} entries`,
    );

    // 11. Sales-order list shows both orders
    const orders = await api('GET', `/sales-orders?companyId=${f.company.id}&limit=20`, { token });
    const orderRows = Array.isArray(orders.data) ? orders.data : (orders.data?.data ?? []);
    step('sales orders: both sales listed', orderRows.length === 2, `${orderRows.length} orders`);

    // 12. Cash account balance was credited by the CASH sale
    const updatedAccount = await prisma.cashAccount.findUnique({ where: { id: cashAccount.id } });
    step(
      'cash account: balance credited 10,000 by CASH sale',
      Number(updatedAccount?.currentBalance) === 10000,
      `balance ${updatedAccount?.currentBalance}`,
    );

    // ── Reports enhancement (R1/R2/O2) ──────────────────────────────────────

    // 13. Catalog lists only the live sectors and includes the new reports
    const catalog = await api('GET', '/reports/catalog', { token });
    const sectors = catalog.data?.sectors ?? [];
    const catalogIds = (catalog.data?.entries ?? []).map((e) => e.id);
    const liveSectors = ['FINANCE', 'OPERATIONS', 'WESTSIDES', 'HR', 'COMPLIANCE'];
    step(
      'reports catalog: only live sectors (no petroleum/itemba/construction/BI)',
      sectors.length > 0 && sectors.every((s) => liveSectors.includes(s)),
      `sectors ${sectors.join(',') || '(none)'}`,
    );
    step(
      'reports catalog: the 5 new money reports are discoverable',
      [
        'finance.customer-aging',
        'finance.supplier-aging',
        'ops.low-stock',
        'ops.stock-ageing',
        'ops.branch-profitability',
      ].every((id) => catalogIds.includes(id)),
      `${catalogIds.length} entries`,
    );

    // 14. A removed enterprise-BI route is actually gone
    const deadRoute = await api('GET', '/reports/command-center', { token });
    step(
      'reports: removed BI route (command-center) no longer exists',
      deadRoute.status === 404,
      `status ${deadRoute.status}`,
    );

    // 15. Customer credit aging reflects the CREDIT sale's receivable
    const customerAging = await api('GET', `/financial-reports/customer-aging/${f.company.id}`, {
      token,
    });
    const caTotal = Number(customerAging.data?.totals?.total ?? 0);
    step(
      'report customer-aging: CREDIT sale shows 10,000 outstanding for the customer',
      customerAging.status === 200 &&
        caTotal === 10000 &&
        (customerAging.data?.rows ?? []).some((r) => String(r.customer).includes('Mkandarasi')),
      `total ${caTotal}, rows ${(customerAging.data?.rows ?? []).length}`,
    );

    // 16. Supplier aging is zero (the fixture creates no payables)
    const supplierAging = await api('GET', `/financial-reports/supplier-aging/${f.company.id}`, {
      token,
    });
    step(
      'report supplier-aging: no payables -> zero total',
      supplierAging.status === 200 && Number(supplierAging.data?.totals?.total ?? 0) === 0,
      `status ${supplierAging.status}`,
    );

    // 17. sales-by-product (groupBy) sums both sales of the same product
    const salesByProduct = await api(
      'GET',
      `/operations-reports/sales-by-product?companyId=${f.company.id}&limit=200`,
      { token },
    );
    const sbpRows = Array.isArray(salesByProduct.data)
      ? salesByProduct.data
      : (salesByProduct.data?.data ?? []);
    const productRow = sbpRows.find((r) => String(r.product ?? '').includes('Cement'));
    step(
      'report sales-by-product: groupBy totals 4 units / 20,000 across both sales',
      Boolean(productRow) &&
        Number(productRow.quantity) === 4 &&
        Number(productRow.totalAmount) === 20000,
      productRow ? `qty ${productRow.quantity}, total ${productRow.totalAmount}` : `rows ${sbpRows.length}`,
    );

    // 18. sales-by-customer (groupBy) sums both orders for the fixture customer
    const salesByCustomer = await api(
      'GET',
      `/operations-reports/sales-by-customer?companyId=${f.company.id}&limit=200`,
      { token },
    );
    const sbcRows = Array.isArray(salesByCustomer.data)
      ? salesByCustomer.data
      : (salesByCustomer.data?.data ?? []);
    const customerRow = sbcRows.find((r) => String(r.customer ?? '').includes('Mkandarasi'));
    step(
      'report sales-by-customer: groupBy totals 2 orders / 20,000 for the customer',
      Boolean(customerRow) &&
        Number(customerRow.orderCount) === 2 &&
        Number(customerRow.totalAmount) === 20000,
      customerRow
        ? `orders ${customerRow.orderCount}, total ${customerRow.totalAmount}`
        : `rows ${sbcRows.length}`,
    );

    // 19. New operations analytics endpoints are reachable and return tables
    const branchProfit = await api(
      'GET',
      `/operations-reports/branch-profitability?companyId=${f.company.id}`,
      { token },
    );
    step(
      'report branch-profitability: endpoint returns 200 + array',
      branchProfit.status === 200 &&
        Array.isArray(Array.isArray(branchProfit.data) ? branchProfit.data : branchProfit.data?.data ?? []),
      `status ${branchProfit.status}`,
    );
    const stockAgeing = await api(
      'GET',
      `/operations-reports/stock-ageing?companyId=${f.company.id}`,
      { token },
    );
    step(
      'report stock-ageing: endpoint returns 200',
      stockAgeing.status === 200,
      `status ${stockAgeing.status}`,
    );
  } finally {
    console.log('\nCleaning up fixture…');
    await cleanup(f);
    await prisma.$disconnect();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error('FATAL:', e);
  await prisma.$disconnect();
  process.exit(1);
});
