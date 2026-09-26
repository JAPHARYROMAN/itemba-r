/* Financial integration proof. Creates and drops only a unique, disposable LOCAL database. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('ts-node').register({
  transpileOnly: true,
  project: path.join(__dirname, '../tsconfig.json'),
});
const { PrismaClient } = require('@prisma/client');
const {
  CashSalesConnectionService,
} = require('../src/modules/cash-desk/cash-sales-connection.service');
const { ReceivablesService } = require('../src/modules/receivables/receivables.service');
const { CompanyScopeService } = require('../src/common/services/company-scope.service');
const { OrganizationScopeService } = require('../src/common/services/organization-scope.service');
const { AccountResolverService } = require('../src/common/services/account-resolver.service');
const { AccountingControlService } = require('../src/common/services/accounting-control.service');
const { PostingEngineService } = require('../src/modules/accounting-engine/posting-engine.service');
const { AuditLogsService } = require('../src/modules/audit-logs/audit-logs.service');
const {
  CustomerPaymentsService,
} = require('../src/modules/customer-payments/customer-payments.service');
const {
  EntityCodeGeneratorService,
} = require('../src/modules/entity-code-generator/entity-code-generator.service');

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(url.hostname), 'Only local PostgreSQL is allowed.');
  const database = `sales_cash_proof_${randomUUID().replaceAll('-', '')}`;
  assert(/^sales_cash_proof_[a-f0-9]{32}$/.test(database));
  const admin = new PrismaClient();
  let db,
    created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    created = true;
    url.pathname = '/' + database;
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
      {
        env: { ...process.env, DATABASE_URL: url.toString() },
        stdio: 'pipe',
        timeout: 180000,
        windowsHide: true,
      },
    );
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    const group = await db.group.create({ data: { name: 'Proof group', code: 'PROOF' } });
    const company = await db.company.create({
      data: { groupId: group.id, name: 'Proof company', code: 'PROOF' },
    });
    const division = await db.division.create({
      data: { companyId: company.id, name: 'Proof division', code: 'PROOF', type: 'OTHER' },
    });
    const branch = await db.branch.create({
      data: { divisionId: division.id, name: 'Proof branch', code: 'PROOF', type: 'BRANCH' },
    });
    const otherBranch = await db.branch.create({
      data: { divisionId: division.id, name: 'Other branch', code: 'OTHER', type: 'BRANCH' },
    });
    const scope = { companyId: company.id, divisionId: division.id, branchId: branch.id };
    const actor = await db.user.create({
      data: {
        email: 'proof@example.invalid',
        fullName: 'Proof',
        passwordHash: 'disabled-proof-only',
      },
    });
    const user = {
      id: actor.id,
      email: actor.email,
      roleScopes: ['GROUP'],
      permissions: [
        'cash_desk.view',
        'sales.view',
        'receivables.view',
        'cash_accounts.view',
        'customer-payments.view',
      ],
      companyAccess: [{ companyId: company.id, accessLevel: 'MANAGE' }],
      divisionAccess: [],
      branchAccess: [],
    };
    const customer = await db.customer.create({
      data: { ...scope, customerCode: 'CUSTOMER', name: 'Proof customer', currentBalance: 200 },
    });
    const till = await db.cashAccount.create({
      data: { ...scope, accountName: 'Proof till', currentBalance: 100 },
    });
    const usd = await db.cashAccount.create({
      data: { ...scope, accountName: 'USD till', currency: 'USD' },
    });
    const otherTill = await db.cashAccount.create({
      data: { ...scope, branchId: otherBranch.id, accountName: 'Other till' },
    });
    const startDate = new Date('2026-01-01'),
      endDate = new Date('2026-12-31');
    const year = await db.fiscalYear.create({
      data: { companyId: company.id, name: '2026', startDate, endDate },
    });
    await db.accountingPeriod.create({
      data: { companyId: company.id, fiscalYearId: year.id, name: '2026', startDate, endDate },
    });
    const chart = {};
    for (const [role, accountType] of [
      ['CASH_ON_HAND', 'ASSET'],
      ['AR_CONTROL', 'ASSET'],
      ['SALES', 'INCOME'],
      ['COGS', 'COST_OF_GOODS_SOLD'],
      ['STOCK', 'ASSET'],
      ['BAD_DEBT', 'EXPENSE'],
    ]) {
      chart[role] = await db.chartOfAccount.create({
        data: {
          companyId: company.id,
          accountName: role,
          accountCode: role,
          accountSubType: role.toLowerCase(),
          accountType,
        },
      });
    }
    const companies = new CompanyScopeService(db),
      org = new OrganizationScopeService(db);
    const resolver = new AccountResolverService(db),
      engine = new PostingEngineService(db, new AccountingControlService(db), resolver);
    const audit = new AuditLogsService(db),
      codes = new EntityCodeGeneratorService(db);
    const receivables = new ReceivablesService(db, audit, companies, resolver, engine, codes, org);
    const payments = new CustomerPaymentsService(db, audit, companies, resolver, engine, codes);
    const connection = new CashSalesConnectionService(db, companies, org);
    const date = '2026-09-26';
    const sale = await db.salesOrder.create({
      data: {
        ...scope,
        customerId: customer.id,
        customerName: customer.name,
        salesOrderNumber: 'CREDIT',
        orderDate: new Date(date),
        totalAmount: 200,
        outstandingAmount: 200,
        status: 'CONFIRMED',
        paymentMethod: 'CREDIT',
        createdById: user.id,
      },
    });
    const rec = await db.receivable.create({
      data: {
        ...scope,
        customerId: customer.id,
        customerName: customer.name,
        receivableNumber: 'REC',
        amount: 200,
        outstandingAmount: 200,
        currency: 'TZS',
        issueDate: new Date(date),
        sourceType: 'SalesOrder',
        sourceId: sale.id,
      },
    });
    await db.salesOrder.update({ where: { id: sale.id }, data: { receivableId: rec.id } });
    const cashSale = await db.salesOrder.create({
      data: {
        ...scope,
        salesOrderNumber: 'CASH',
        orderDate: new Date(date),
        totalAmount: 100,
        paidAmount: 100,
        status: 'CONFIRMED',
        paymentMethod: 'CASH',
        paymentStatus: 'PAID',
        cashAccountId: till.id,
        createdById: user.id,
      },
    });
    const cashJournal = await engine.postLines({
      ...scope,
      transactionDate: new Date(date),
      description: 'Cash sale with stock costs',
      referenceType: 'SalesOrder',
      referenceId: cashSale.id,
      userId: user.id,
      lines: [
        { accountId: chart.CASH_ON_HAND.id, debit: 100 },
        { accountId: chart.SALES.id, credit: 100 },
        { accountId: chart.COGS.id, debit: 65 },
        { accountId: chart.STOCK.id, credit: 65 },
      ],
    });
    await db.salesOrder.update({
      where: { id: cashSale.id },
      data: { journalEntryId: cashJournal.id },
    });
    const read = () => connection.read(user, { page: 1, date, ...scope });
    assert.equal((await read()).currencies.find((c) => c.currency === 'TZS').received, '100.00');
    await receivables.recordPayment(
      rec.id,
      { amount: 30, cashAccountId: till.id, paymentDate: date },
      user,
    );
    const afterPartial = await read();
    assert.deepEqual(
      afterPartial.currencies.find((c) => c.currency === 'TZS'),
      { currency: 'TZS', balance: '130.00', outstanding: '170.00', received: '130.00' },
    );
    assert.equal(
      (await db.salesOrder.findUniqueOrThrow({ where: { id: sale.id } })).outstandingAmount.toFixed(
        2,
      ),
      '170.00',
    );
    assert.equal(
      (await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).currentBalance.toFixed(
        2,
      ),
      '170.00',
    );
    await assert.rejects(
      receivables.recordPayment(rec.id, { amount: 10, cashAccountId: usd.id }, user),
      /currency/,
    );
    await assert.rejects(
      receivables.recordPayment(rec.id, { amount: 10, cashAccountId: otherTill.id }, user),
      /branch/,
    );
    const restricted = {
      ...user,
      roleScopes: ['BRANCH'],
      branchAccess: [{ branchId: otherBranch.id, accessLevel: 'WRITE' }],
    };
    await assert.rejects(
      receivables.recordPayment(rec.id, { amount: 10, cashAccountId: till.id }, restricted),
      /access/,
    );
    assert.equal((await connection.read(restricted, { page: 1, date })).outstanding.total, 0);
    const multi = await payments.create(
      {
        ...scope,
        customerId: customer.id,
        amount: 20,
        cashAccountId: till.id,
        paymentDate: date,
        allocations: [{ receivableId: rec.id, amount: 20 }],
      },
      user,
    );
    assert.equal((await read()).currencies.find((c) => c.currency === 'TZS').received, '150.00');
    await payments.reverse(multi.id, { reason: 'Disposable reversal proof' }, user);
    assert.deepEqual(
      (await read()).currencies.find((c) => c.currency === 'TZS'),
      { currency: 'TZS', balance: '130.00', outstanding: '170.00', received: '130.00' },
    );
    const concurrent = await Promise.allSettled([
      receivables.recordPayment(
        rec.id,
        { amount: 170, cashAccountId: till.id, paymentDate: date },
        user,
      ),
      receivables.recordPayment(
        rec.id,
        { amount: 170, cashAccountId: till.id, paymentDate: date },
        user,
      ),
    ]);
    assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await read()).outstanding.total, 0);
    const badSale = await db.salesOrder.create({
      data: {
        ...scope,
        salesOrderNumber: 'WRITE-OFF',
        orderDate: new Date(date),
        totalAmount: 50,
        outstandingAmount: 50,
        paymentMethod: 'CREDIT',
        status: 'CONFIRMED',
        createdById: user.id,
      },
    });
    const badDebt = await db.receivable.create({
      data: {
        ...scope,
        customerName: 'Uncollectible customer',
        receivableNumber: 'BAD-DEBT',
        amount: 50,
        outstandingAmount: 50,
        issueDate: new Date(date),
        sourceType: 'SalesOrder',
        sourceId: badSale.id,
      },
    });
    await receivables.writeOff(badDebt.id, { reason: 'Disposable write-off proof' }, user);
    assert.equal(
      (await read()).currencies.find((c) => c.currency === 'TZS').received,
      '300.00',
      'Write-offs are not cash receipts.',
    );
    assert.equal(
      (await db.cashAccount.findUniqueOrThrow({ where: { id: till.id } })).currentBalance.toFixed(
        2,
      ),
      '300.00',
    );
    assert.equal(
      await db.cashDeskMovement.count(),
      0,
      'Business receipts must not be reposted into the desk ledger.',
    );
    const journals = await db.journalEntry.findMany({ include: { lines: true } });
    assert(journals.every((j) => j.totalDebit.equals(j.totalCredit)));
    console.log(
      'PASS: real PostgreSQL partial/full collections, sales/customer/account synchronization, balanced journals, no duplicate desk movements, payment reversal, concurrent settlement, branch access and currency protection.',
    );
  } finally {
    if (db) await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.$disconnect();
    console.log('Disposable sales/cash proof database removed.');
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
