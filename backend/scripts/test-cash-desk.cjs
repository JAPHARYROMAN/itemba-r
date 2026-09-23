/* Real PostgreSQL proof in a newly created, disposable database. Never writes
 * business records to the configured application database. Run after build. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { readFileSync } = require('node:fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const { CashDeskService } = require('../dist/modules/cash-desk/cash-desk.service');
const { InvoiceDeskService } = require('../dist/modules/invoice-desk/invoice-desk.service');
const { CompanyScopeService } = require('../dist/common/services/company-scope.service');
const { OrganizationScopeService } = require('../dist/common/services/organization-scope.service');

async function main() {
  const target = new URL(process.env.DATABASE_URL);
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname),
    'Only a local PostgreSQL server is permitted.',
  );
  const database = `cash_desk_test_${randomUUID().replaceAll('-', '')}`;
  assert(/^cash_desk_test_[a-f0-9]{32}$/.test(database));
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
    const migration = readFileSync(
      path.resolve(
        __dirname,
        '../../database/prisma/migrations/20260918120000_invoice_desk/migration.sql',
      ),
      'utf8',
    );
    const checks =
      migration.match(/ALTER TABLE "invoice_desk_[^"]+" ADD CONSTRAINT "[^"]+" CHECK .*?;/g) ?? [];
    assert.equal(checks.length, 4);
    for (const check of checks) await db.$executeRawUnsafe(check);
    const cashMigration = readFileSync(
      path.resolve(
        __dirname,
        '../../database/prisma/migrations/20260918160000_cash_desk/migration.sql',
      ),
      'utf8',
    );
    for (const check of cashMigration.match(
      /ALTER TABLE "cash_desk_[^"]+" ADD CONSTRAINT "[^"]+" CHECK .*?;/g,
    ) ?? [])
      await db.$executeRawUnsafe(check);

    const expenseMigration = readFileSync(
      path.resolve(
        __dirname,
        '../../database/prisma/migrations/20260918180000_cash_desk_expenses/migration.sql',
      ),
      'utf8',
    );
    const expenseChecks =
      expenseMigration.match(/ALTER TABLE "cash_desk_[^"]+" ADD CONSTRAINT "[^"]+" CHECK .*?;/g) ??
      [];
    assert.equal(expenseChecks.length, 2);
    for (const check of expenseChecks) await db.$executeRawUnsafe(check);
    const group = await db.group.create({ data: { name: 'Disposable group', code: 'TEST' } });
    async function org(code) {
      const company = await db.company.create({ data: { groupId: group.id, name: code, code } });
      const division = await db.division.create({
        data: { companyId: company.id, name: code, code, type: 'OTHER' },
      });
      const branch = await db.branch.create({
        data: { divisionId: division.id, name: code, code, type: 'BRANCH' },
      });
      return { companyId: company.id, divisionId: division.id, branchId: branch.id };
    }
    const a = await org('LENDER'),
      b = await org('BORROWER');
    const user = {
      id: randomUUID(),
      email: 'cash-test@example.invalid',
      roles: [],
      roleScopes: ['GROUP'],
      permissions: ['invoice_desk.view', 'invoice_desk.payments'],
      companyAccess: [a, b].map((s) => ({ companyId: s.companyId, accessLevel: 'WRITE' })),
      branchAccess: [],
      divisionAccess: [],
    };
    let failAudit = false,
      audits = 0;
    const audit = {
      logStrictInTransaction: async () => {
        if (failAudit) throw new Error('Audit unavailable');
        audits++;
      },
    };
    const companies = new CompanyScopeService(db),
      scopes = new OrganizationScopeService(db);
    const invoices = new InvoiceDeskService(db, companies, scopes, audit),
      cash = new CashDeskService(db, companies, scopes, audit, invoices);
    async function account(
      scope,
      name,
      openingBalance = '0',
      currency = 'TZS',
      openingDate = '2026-01-01',
    ) {
      return cash.createAccount(user, {
        ...scope,
        name,
        openingBalance,
        currency,
        openingDate,
        kind: 'CASH',
        requestId: randomUUID(),
      });
    }
    const till = await account(a, 'Main till', '1000.30'),
      bank = await account(a, 'Bank'),
      borrower = await account(b, 'Borrower till');
    const balance = async (id) =>
      (await db.cashDeskAccount.findUniqueOrThrow({ where: { id } })).balance.toFixed(2);
    const movement = (kind, accountId, amount, extra = {}) => ({
      requestId: randomUUID(),
      kind,
      accountId,
      amount,
      businessDate: '2026-01-02',
      description: `Test ${kind}`,
      reference: 'TEST',
      ...extra,
    });
    assert.equal(await balance(till.id), '1000.30');
    const daily = movement('DAILY_SALES', till.id, '0.20');
    const sale = await cash.record(user, daily);
    assert.equal((await cash.record(user, daily)).id, sale.id, 'Retry must return same movement');
    await assert.rejects(cash.record(user, { ...daily, amount: '0.30' }), /reference/);
    await assert.rejects(
      cash.record(user, { ...daily, requestId: randomUUID() }),
      /already exists/,
    );
    await cash.record(user, movement('TRANSFER', till.id, '100', { targetAccountId: bank.id }));
    assert.equal(await balance(bank.id), '100.00');
    assert.equal(await balance(till.id), '900.50');
    await assert.rejects(
      cash.record(user, movement('TRANSFER', till.id, '20', { targetAccountId: borrower.id })),
      /intercompany loan/,
    );
    const loanMovement = await cash.record(
      user,
      movement('LOAN', till.id, '200', { targetAccountId: borrower.id, dueDate: '2026-02-01' }),
    );
    assert.equal(await balance(borrower.id), '200.00');
    const repay = await cash.record(
      user,
      movement('LOAN_REPAYMENT', borrower.id, '50', {
        targetAccountId: till.id,
        loanId: loanMovement.loanId,
      }),
    );
    assert.equal(
      (
        await db.cashDeskLoan.findUnique({ where: { id: loanMovement.loanId } })
      ).outstanding.toFixed(2),
      '150.00',
    );
    const reason = () => ({
      requestId: randomUUID(),
      businessDate: '2026-01-02',
      reason: 'Test correction',
    });
    await assert.rejects(cash.reverse(user, loanMovement.id, reason()), /repayments/);
    await cash.reverse(user, repay.id, reason());
    await cash.reverse(user, loanMovement.id, reason());
    assert.equal(await balance(borrower.id), '0.00');
    assert.equal(await balance(till.id), '900.50');
    const supplier = await invoices.createSupplier(user, {
      companyId: a.companyId,
      name: 'Test supplier',
    });
    const invoice = await invoices.create(user, {
      ...a,
      supplierId: supplier.id,
      invoiceNumber: 'CASH-001',
      description: 'Test invoice',
      currency: 'TZS',
      invoiceDate: '2026-01-01',
      dueDate: '2026-01-20',
      totalAmount: '300.30',
    });
    const payment = await cash.record(
      user,
      movement('SUPPLIER_PAYMENT', till.id, '100.10', { invoiceId: invoice.id, invoiceVersion: 1 }),
    );
    let detail = await invoices.detail(user, invoice.id);
    assert.equal(detail.outstanding, '200.20');
    assert.equal(await balance(till.id), '800.40');
    await assert.rejects(
      invoices.reverse(user, invoice.id, payment.invoicePaymentId, {
        version: detail.version,
        reason: 'Wrong app',
      }),
      /Cash Desk/,
    );
    const correction = reason();
    await cash.reverse(user, payment.id, correction);
    await cash.reverse(user, payment.id, correction);
    detail = await invoices.detail(user, invoice.id);
    assert.equal(detail.outstanding, '300.30');
    assert.equal(await balance(till.id), '900.50');
    await assert.rejects(
      cash.record(
        { ...user, permissions: [] },
        movement('SUPPLIER_PAYMENT', till.id, '1', {
          invoiceId: invoice.id,
          invoiceVersion: detail.version,
        }),
      ),
      /permissions/,
    );
    await assert.rejects(
      cash.record(
        user,
        movement('SUPPLIER_PAYMENT', borrower.id, '1', {
          invoiceId: invoice.id,
          invoiceVersion: detail.version,
        }),
      ),
      /same company/,
    );
    // Invoice and cash mutations roll back together when the ledger cannot fund payment.
    await assert.rejects(
      cash.record(
        user,
        movement('SUPPLIER_PAYMENT', bank.id, '200', {
          invoiceId: invoice.id,
          invoiceVersion: detail.version,
        }),
      ),
      /Insufficient funds/,
    );
    assert.equal((await invoices.detail(user, invoice.id)).outstanding, '300.30');
    assert.equal(await balance(bank.id), '100.00');
    failAudit = true;
    await assert.rejects(
      cash.record(user, movement('EXPENSE', bank.id, '10')),
      /Audit unavailable/,
    );
    failAudit = false;
    assert.equal(await balance(bank.id), '100.00');
    const races = await Promise.allSettled([
      cash.record(user, movement('EXPENSE', bank.id, '80')),
      cash.record(user, movement('EXPENSE', bank.id, '80')),
    ]);
    assert.equal(
      races.filter((r) => r.status === 'fulfilled').length,
      1,
      'Concurrent spending must not overspend',
    );
    assert.equal(await balance(bank.id), '20.00');
    const later = await account(a, 'Later receipt');
    await cash.record(user, movement('OTHER_IN', later.id, '50', { businessDate: '2026-01-10' }));
    await assert.rejects(
      cash.record(user, movement('EXPENSE', later.id, '20')),
      /negative balance on 2026-01-02/,
    );
    const dollars = await account(a, 'Dollars', '100', 'USD');
    await assert.rejects(
      cash.record(user, movement('TRANSFER', dollars.id, '1', { targetAccountId: till.id })),
      /same currency/,
    );
    const branchUser = {
      ...user,
      roleScopes: ['BRANCH'],
      companyAccess: [{ companyId: a.companyId, accessLevel: 'WRITE' }],
      branchAccess: [{ branchId: a.branchId, accessLevel: 'WRITE' }],
    };
    assert(!(await cash.accounts(branchUser, { page: 1 })).some((x) => x.id === borrower.id));
    await assert.rejects(
      cash.record(branchUser, movement('LOAN', till.id, '1', { targetAccountId: borrower.id })),
      /not found/,
    );
    const scopedMovements = await cash.movements(branchUser, { page: 1 });
    assert(
      scopedMovements.rows.every((m) =>
        m.entries.every((e) => e.account.companyId === a.companyId),
      ),
      'Counterparty account balances must not leak',
    );
    await cash.reverse(user, sale.id, reason());
    await cash.record(user, { ...daily, requestId: randomUUID(), amount: '0.10' });
    const summary = await cash.overview(user, { page: 1, date: '2026-01-02' });
    assert.equal(
      summary.currencies.find((c) => c.currency === 'TZS').sales.toFixed(2),
      '0.10',
      'Transfers and loans must not inflate sales',
    );
    const expenseInput = movement('EXPENSE', till.id, '125.10', {
      businessDate: '2026-01-15',
      expenseCategory: 'RENT',
      payee: '  Test landlord  ',
      expenseNotes: 'Office January rent',
    });
    const rent = await cash.record(user, expenseInput);
    assert.equal(rent.payee, 'Test landlord');
    assert.equal((await cash.record(user, expenseInput)).id, rent.id);
    await assert.rejects(
      cash.record(user, { ...expenseInput, payee: 'Someone else' }),
      /reference/,
    );
    const legacy = await cash.record(
      user,
      movement('EXPENSE', bank.id, '5', { businessDate: '2026-01-15' }),
    );
    await db.cashDeskMovement.update({ where: { id: legacy.id }, data: { expenseCategory: null } });
    await cash.record(
      user,
      movement('EXPENSE', dollars.id, '10', {
        businessDate: '2026-01-15',
        expenseCategory: 'FEES',
        payee: 'Bank',
      }),
    );
    await cash.record(
      user,
      movement('OTHER_IN', borrower.id, '1000', { businessDate: '2026-01-15' }),
    );
    await cash.record(
      user,
      movement('EXPENSE', borrower.id, '600', {
        businessDate: '2026-01-15',
        expenseCategory: 'RENT',
        payee: 'Other landlord',
      }),
    );
    const period = { page: 1, from: '2026-01-15', to: '2026-01-15' };
    let expenses = await cash.expenses(branchUser, period);
    assert.equal(expenses.total, 3, 'Expense report must exclude other company and earlier dates');
    assert.equal(expenses.currencies.find((c) => c.currency === 'TZS').paid.toFixed(2), '130.10');
    assert.equal(expenses.currencies.find((c) => c.currency === 'USD').paid.toFixed(2), '10.00');
    assert.equal((await cash.expenses(branchUser, { ...period, search: 'landlord' })).total, 1);
    assert.equal(
      (await cash.expenses(branchUser, { ...period, expenseCategory: 'UNCATEGORIZED' })).total,
      1,
    );
    assert.equal((await cash.expenses(branchUser, { ...period, accountId: bank.id })).total, 1);
    await cash.reverse(user, rent.id, { ...reason(), businessDate: '2026-01-15' });
    expenses = await cash.expenses(branchUser, period);
    assert.equal(expenses.currencies.find((c) => c.currency === 'TZS').paid.toFixed(2), '5.00');
    assert.equal(
      expenses.currencies.find((c) => c.currency === 'TZS').reversed.toFixed(2),
      '125.10',
    );
    assert.equal(
      (await cash.expenses(branchUser, { ...period, status: 'reversed' })).rows[0].expenseNotes,
      'Office January rent',
    );
    assert.equal(
      (await cash.expenses(branchUser, { ...period, status: 'paid', expenseCategory: 'RENT' }))
        .total,
      0,
    );
    await assert.rejects(
      cash.expenses(branchUser, { page: 1, from: '2026-02-01', to: '2026-01-01' }),
      /start date/,
    );
    await assert.rejects(
      cash.record(user, movement('OTHER_IN', till.id, '1', { expenseCategory: 'RENT' })),
      /only be added to an expense/,
    );
    const accountRows = await db.cashDeskAccount.findMany();
    for (const row of accountRows) {
      const sum = await db.cashDeskEntry.aggregate({
        where: { accountId: row.id },
        _sum: { amount: true },
      });
      assert(row.balance.eq(sum._sum.amount || 0), 'Cached balances must match ledger');
    }
    assert(audits > 15);
    console.log(
      'PASS: Cash Desk PostgreSQL lifecycle, exact ledger, scope isolation, daily sale correction, idempotency, concurrent spending, atomic supplier payments/reversals, loans/repayments, history and audit rollback.',
    );
  } finally {
    if (db) await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.$disconnect();
    console.log('Disposable Cash Desk database removed.');
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
