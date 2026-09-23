/* Runs financial writes only in a newly created disposable local PostgreSQL database. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { readFileSync } = require('node:fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const { SalesDeskService } = require('../dist/modules/sales-desk/sales-desk.service');
const { CashDeskService } = require('../dist/modules/cash-desk/cash-desk.service');
const { InvoiceDeskService } = require('../dist/modules/invoice-desk/invoice-desk.service');
const { CompanyScopeService } = require('../dist/common/services/company-scope.service');
const { OrganizationScopeService } = require('../dist/common/services/organization-scope.service');

async function main() {
  const target = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(target.hostname));
  const database = `sales_desk_test_${randomUUID().replaceAll('-', '')}`;
  assert(/^sales_desk_test_[a-f0-9]{32}$/.test(database));
  const admin = new PrismaClient();
  let db,
    created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    created = true;
    target.pathname = '/' + database;
    execFileSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'db',
        'push',
        '--schema',
        path.resolve(__dirname, '../../database/prisma/schema.prisma'),
        '--skip-generate',
      ],
      { env: { ...process.env, DATABASE_URL: target.toString() }, stdio: 'pipe', timeout: 120000 },
    );
    db = new PrismaClient({ datasources: { db: { url: target.toString() } } });
    for (const migration of [
      '20260918120000_invoice_desk',
      '20260918160000_cash_desk',
      '20260918180000_cash_desk_expenses',
      '20260918200000_sales_desk',
    ]) {
      const sql = readFileSync(
        path.resolve(__dirname, `../../database/prisma/migrations/${migration}/migration.sql`),
        'utf8',
      );
      for (const check of sql.match(
        /ALTER TABLE "(?:invoice|cash|sales)_desk_[^"]+" ADD CONSTRAINT "[^"]+" CHECK .*?;/g,
      ) ?? [])
        await db.$executeRawUnsafe(check);
    }
    const group = await db.group.create({ data: { name: 'Disposable sales group', code: 'TEST' } });
    async function org(code) {
      const c = await db.company.create({ data: { groupId: group.id, name: code, code } });
      const d = await db.division.create({
        data: { companyId: c.id, name: code, code, type: 'OTHER' },
      });
      const b = await db.branch.create({
        data: { divisionId: d.id, name: code, code, type: 'BRANCH' },
      });
      return { companyId: c.id, divisionId: d.id, branchId: b.id };
    }
    const a = await org('A'),
      b = await org('B');
    const user = {
      id: randomUUID(),
      email: 'sales-test@example.invalid',
      roles: [],
      roleScopes: ['GROUP'],
      permissions: [
        'sales_desk.view',
        'sales_desk.manage',
        'sales_desk.payments',
        'cash_desk.view',
        'cash_desk.record',
        'cash_desk.reverse',
      ],
      companyAccess: [a, b].map((s) => ({ companyId: s.companyId, accessLevel: 'WRITE' })),
      branchAccess: [],
      divisionAccess: [],
    };
    let failAudit = false;
    const audit = {
      logStrictInTransaction: async () => {
        if (failAudit) throw new Error('Audit unavailable');
      },
    };
    const companies = new CompanyScopeService(db),
      scopes = new OrganizationScopeService(db);
    const invoices = new InvoiceDeskService(db, companies, scopes, audit);
    const cash = new CashDeskService(db, companies, scopes, audit, invoices);
    const sales = new SalesDeskService(db, companies, scopes, audit, cash);
    const customer = await sales.createCustomer(user, { companyId: a.companyId, name: 'Acme' });
    const foreign = await sales.createCustomer(user, { companyId: b.companyId, name: 'Elsewhere' });
    await assert.rejects(
      sales.createCustomer(user, { companyId: a.companyId, name: ' ACME ' }),
      /already exists/,
    );
    const saleDraft = (extra = {}) => ({
      ...a,
      customerId: customer.id,
      requestId: randomUUID(),
      currency: 'TZS',
      saleDate: '2026-01-02',
      dueDate: '2026-01-03',
      lines: [
        { description: 'Goods', quantity: '1', unitPrice: '100.10' },
        { description: 'Service', quantity: '0.5', unitPrice: '0.01' },
      ],
      ...extra,
    });
    const draft = saleDraft();
    const sale = await sales.create(user, draft);
    assert.equal(sale.totalAmount.toFixed(2), '100.11');
    assert.equal((await sales.create(user, draft)).id, sale.id);
    await assert.rejects(sales.create(user, { ...draft, notes: 'Changed' }), /reference/);
    await assert.rejects(sales.create(user, saleDraft({ customerId: foreign.id })), /belonging/);
    await assert.rejects(sales.create(user, saleDraft({ branchId: b.branchId })), /belonging/);
    await assert.rejects(sales.create(user, saleDraft({ dueDate: '2026-01-01' })), /precede/);
    async function account(scope, name, currency = 'TZS') {
      return cash.createAccount(user, {
        ...scope,
        name,
        currency,
        kind: 'CASH',
        openingBalance: '0',
        openingDate: '2026-01-01',
        requestId: randomUUID(),
      });
    }
    const till = await account(a, 'Till'),
      foreignTill = await account(b, 'Foreign'),
      usd = await account(a, 'USD', 'USD');
    const balance = async (id) =>
      (await db.cashDeskAccount.findUniqueOrThrow({ where: { id } })).balance.toFixed(2);
    const payment = (extra = {}) => ({
      requestId: randomUUID(),
      version: 1,
      accountId: till.id,
      amount: '40.10',
      paymentDate: '2026-01-02',
      reference: 'Received',
      ...extra,
    });
    const reason = () => ({
      requestId: randomUUID(),
      businessDate: '2026-01-02',
      reason: 'Correct receipt',
    });
    const movement = (accountId, extra = {}) => ({
      requestId: randomUUID(),
      kind: 'DAILY_SALES',
      accountId,
      amount: '5',
      businessDate: '2026-01-02',
      description: 'Daily receipts',
      reference: '',
      ...extra,
    });
    await assert.rejects(
      sales.payment({ ...user, permissions: [] }, sale.id, payment()),
      /Cash Desk/,
    );
    await assert.rejects(
      sales.payment(user, sale.id, payment({ accountId: foreignTill.id })),
      /same company/,
    );
    await assert.rejects(
      sales.payment(user, sale.id, payment({ accountId: usd.id })),
      /same company/,
    );
    await assert.rejects(sales.payment(user, sale.id, payment({ amount: '100.12' })), /exceeds/);
    assert.equal(
      (await cash.overview(user, { page: 1, date: '2026-01-02' })).currencies
        .find((c) => c.currency === 'TZS')
        .sales.toFixed(2),
      '0.00',
    );
    const payDraft = payment(),
      received = await sales.payment(user, sale.id, payDraft);
    assert.equal((await sales.payment(user, sale.id, payDraft)).id, received.id);
    assert.equal(await balance(till.id), '40.10');
    assert.equal((await sales.detail(user, sale.id)).outstanding, '60.01');
    assert.equal(
      (await cash.overview(user, { page: 1, date: '2026-01-02' })).currencies
        .find((c) => c.currency === 'TZS')
        .sales.toFixed(2),
      '40.10',
    );
    assert.equal((await cash.movements(user, { page: 1, kind: 'SALES_INCOME' })).total, 1);
    await assert.rejects(cash.record(user, movement(till.id)), /Sales Desk/);
    await assert.rejects(
      sales.void(user, sale.id, { version: 2, reason: 'Correction' }),
      /reverse/,
    );
    const receipt = await db.cashDeskMovement.findUniqueOrThrow({
      where: { salesPaymentId: received.id },
    });
    await assert.rejects(
      cash.reverse(
        { ...user, permissions: ['cash_desk.view', 'cash_desk.reverse'] },
        receipt.id,
        reason(),
      ),
      /Sales Desk/,
    );
    const spent = await cash.record(
      user,
      movement(till.id, {
        kind: 'EXPENSE',
        amount: '40.10',
        expenseCategory: 'OTHER',
        payee: 'Test vendor',
      }),
    );
    await assert.rejects(cash.reverse(user, receipt.id, reason()), /balance|funds/i);
    assert.equal((await sales.detail(user, sale.id)).paidAmount.toFixed(2), '40.10');
    assert.equal(
      (await db.salesDeskPayment.findUniqueOrThrow({ where: { id: received.id } })).reversedAt,
      null,
    );
    await cash.reverse(user, spent.id, reason());
    const reverseDraft = reason(),
      reversed = await cash.reverse(user, receipt.id, reverseDraft);
    assert.equal((await cash.reverse(user, receipt.id, reverseDraft)).id, reversed.id);
    assert.equal(await balance(till.id), '0.00');
    const restored = await sales.detail(user, sale.id);
    assert.equal(restored.outstanding, '100.11');
    assert(restored.payments[0].reversedAt);
    assert(restored.events.some((e) => e.action === 'PAYMENT_REVERSED'));
    await sales.void(user, sale.id, { version: restored.version, reason: 'Correction' });
    assert.equal((await sales.overview(user, { page: 1 })).currencies.length, 0);
    await assert.rejects(
      sales.payment(user, sale.id, payment({ version: restored.version + 1 })),
      /changed/,
    );
    const second = await sales.create(user, saleDraft());
    const manual = await cash.record(user, movement(till.id));
    await assert.rejects(sales.payment(user, second.id, payment()), /manual daily sales/);
    assert.equal((await sales.detail(user, second.id)).paidAmount.toFixed(2), '0.00');
    await cash.reverse(user, manual.id, reason());
    const contenders = await Promise.allSettled([
      sales.payment(user, second.id, payment()),
      sales.payment(user, second.id, payment()),
    ]);
    assert.equal(contenders.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await balance(till.id), '40.10');
    const v = (await sales.detail(user, second.id)).version;
    failAudit = true;
    await assert.rejects(
      sales.payment(user, second.id, payment({ version: v, amount: '1' })),
      /Audit unavailable/,
    );
    await assert.rejects(sales.create(user, saleDraft()), /Audit unavailable/);
    failAudit = false;
    assert.equal(await balance(till.id), '40.10');
    assert.equal((await sales.detail(user, second.id)).version, v);
    await sales.create(user, saleDraft({ ...b, customerId: foreign.id, currency: 'USD' }));
    const onlyA = { ...user, companyAccess: [{ companyId: a.companyId, accessLevel: 'WRITE' }] };
    assert.equal((await sales.customers(onlyA, { page: 1 })).length, 1);
    assert.equal((await sales.list(onlyA, { page: 1 })).total, 2);
    const summary = await sales.overview(onlyA, { page: 1 });
    assert.equal(summary.currencies.length, 1);
    assert.equal(summary.currencies[0].outstanding.toFixed(2), '60.01');
    assert.equal(summary.customers[0].name, 'Acme');
    const branchOnly = {
      ...user,
      roleScopes: ['BRANCH'],
      divisionAccess: [],
      branchAccess: [{ branchId: a.branchId, accessLevel: 'WRITE' }],
    };
    assert.equal((await sales.list(branchOnly, { page: 1 })).total, 2);
    for (const row of await db.cashDeskAccount.findMany()) {
      const sum = await db.cashDeskEntry.aggregate({
        where: { accountId: row.id },
        _sum: { amount: true },
      });
      assert(row.balance.eq(sum._sum.amount || 0));
    }
    console.log(
      'PASS: Sales Desk exact totals, scoped customers and sales, credit balances, atomic cash receipts/reversals, idempotency, concurrent payments, daily-total conflict checks, audit rollback and ledger integrity.',
    );
  } finally {
    if (db) await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.$disconnect();
    console.log('Disposable Sales Desk database removed.');
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
