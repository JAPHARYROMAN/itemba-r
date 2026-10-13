/* Financial fixture writes are restricted to a newly created disposable local database. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json');
require('ts-node/register/transpile-only');
const { PrismaClient } = require('@prisma/client');
const { CompanyScopeService } = require('../src/common/services/company-scope.service');
const { OrganizationScopeService } = require('../src/common/services/organization-scope.service');
const {
  CustomerAccountProjectionService,
} = require('../src/modules/customer-statements/customer-account-projection.service');
const {
  CustomerStatementsService,
} = require('../src/modules/customer-statements/customer-statements.service');
const {
  CustomerPerformanceService,
} = require('../src/modules/customer-performance/customer-performance.service');

const date = (value) => new Date(value + 'T12:00:00.000Z');
const fixed = (value) => Number(value).toFixed(2);

async function main() {
  const target = new URL(
    process.env.CUSTOMER_PERFORMANCE_TEST_DATABASE_URL ?? process.env.DATABASE_URL,
  );
  if (process.env.CUSTOMER_PERFORMANCE_TEST_PORT) {
    assert(/^\d{1,5}$/.test(process.env.CUSTOMER_PERFORMANCE_TEST_PORT));
    target.port = process.env.CUSTOMER_PERFORMANCE_TEST_PORT;
  }
  assert(['localhost', '127.0.0.1'].includes(target.hostname), 'Only local PostgreSQL is allowed');
  const database = `customer_performance_test_${randomUUID().replaceAll('-', '')}`;
  assert(/^customer_performance_test_[a-f0-9]{32}$/.test(database));
  const admin = new PrismaClient({ datasources: { db: { url: target.toString() } } });
  let db;
  let created = false;
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
      {
        env: { ...process.env, DATABASE_URL: target.toString() },
        stdio: 'pipe',
        timeout: 120000,
      },
    );
    db = new PrismaClient({ datasources: { db: { url: target.toString() } } });
    // Rehearse the actual upgrade SQL, rather than relying only on db push.
    await db.$executeRawUnsafe(
      'ALTER TABLE "customer_statement_runs" DROP COLUMN "snapshot", DROP COLUMN "snapshotHash", DROP COLUMN "pdfContent", DROP COLUMN "calculationVersion"',
    );
    execFileSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'db',
        'execute',
        '--schema',
        path.resolve(__dirname, '../../database/prisma/schema.prisma'),
        '--file',
        path.resolve(
          __dirname,
          '../../database/prisma/migrations/20261013120000_customer_statement_snapshots/migration.sql',
        ),
      ],
      { env: { ...process.env, DATABASE_URL: target.toString() }, stdio: 'pipe', timeout: 120000 },
    );
    const group = await db.group.create({
      data: { name: 'Customer performance fixture', code: 'CP-TEST' },
    });
    const company = await db.company.create({
      data: { groupId: group.id, name: 'Example Company', code: 'CP-CO' },
    });
    const division = await db.division.create({
      data: { companyId: company.id, name: 'Trading', code: 'CP-DIV', type: 'OTHER' },
    });
    const branchA = await db.branch.create({
      data: { divisionId: division.id, name: 'Visible branch', code: 'CP-A', type: 'BRANCH' },
    });
    const branchB = await db.branch.create({
      data: { divisionId: division.id, name: 'Restricted branch', code: 'CP-B', type: 'BRANCH' },
    });
    const actor = await db.user.create({
      data: {
        email: 'customer-performance@example.invalid',
        passwordHash: 'non-authenticating-fixture',
        fullName: 'Fixture operator',
      },
    });
    const permissions = [
      'customers.view',
      'sales.view',
      'receivables.view',
      'customer-payments.view',
      'cash_desk.view',
      'customer_statements.view',
      'customer_statements.generate',
    ];
    const user = {
      id: actor.id,
      email: actor.email,
      roles: [],
      roleScopes: ['COMPANY'],
      permissions,
      companyAccess: [{ companyId: company.id, accessLevel: 'WRITE' }],
      divisionAccess: [],
      branchAccess: [],
    };
    const scope = { companyId: company.id, divisionId: division.id, branchId: branchA.id };
    const customer = await db.customer.create({
      data: {
        companyId: company.id,
        customerCode: 'CP-CUST',
        name: 'Example Customer',
        address: 'Fixture address',
        email: 'accounts@example.invalid',
      },
    });
    const cash = await db.chartOfAccount.create({
      data: {
        companyId: company.id,
        accountCode: '1000',
        accountName: 'Cash on hand',
        accountType: 'ASSET',
        accountSubType: 'CASH_ON_HAND',
      },
    });
    const ar = await db.chartOfAccount.create({
      data: {
        companyId: company.id,
        accountCode: '1200',
        accountName: 'Accounts receivable',
        accountType: 'ASSET',
        accountSubType: 'AR_CONTROL',
      },
    });
    const revenue = await db.chartOfAccount.create({
      data: {
        companyId: company.id,
        accountCode: '4000',
        accountName: 'Sales revenue',
        accountType: 'INCOME',
      },
    });
    const badDebt = await db.chartOfAccount.create({
      data: {
        companyId: company.id,
        accountCode: '6900',
        accountName: 'Bad debt expense',
        accountType: 'EXPENSE',
      },
    });
    let sequence = 0;
    async function journal({
      amount,
      on,
      referenceType,
      referenceId,
      debit = cash,
      credit = ar,
      description = 'Customer receipt',
      reversalOfId,
      extra = {},
    }) {
      return db.journalEntry.create({
        data: {
          ...scope,
          journalNumber: `CP-J-${++sequence}`,
          transactionDate: date(on),
          description,
          referenceType,
          referenceId,
          createdById: actor.id,
          status: 'POSTED',
          postedAt: date(on),
          totalDebit: amount,
          totalCredit: amount,
          ...(reversalOfId ? { reversalOfId } : {}),
          ...extra,
          lines: {
            create: [
              { companyId: company.id, accountId: debit.id, debit: amount, credit: 0 },
              { companyId: company.id, accountId: credit.id, debit: 0, credit: amount },
            ],
          },
        },
      });
    }
    const invoice = await db.receivable.create({
      data: {
        ...scope,
        customerId: customer.id,
        customerName: customer.name,
        receivableNumber: 'CP-INV-1',
        amount: 1000,
        paidAmount: 200,
        outstandingAmount: 0,
        issueDate: date('2026-02-01'),
        dueDate: date('2026-02-20'),
        status: 'WRITTEN_OFF',
        sourceType: 'SalesOrder',
      },
    });
    const invoiceJournal = await journal({
      amount: 1000,
      on: '2026-02-01',
      referenceType: 'Receivable',
      referenceId: invoice.id,
      debit: ar,
      credit: revenue,
      description: 'Invoice accrual',
    });
    const sale = await db.salesOrder.create({
      data: {
        ...scope,
        customerId: customer.id,
        customerName: customer.name,
        salesOrderNumber: 'CP-SALE-1',
        createdById: actor.id,
        orderDate: date('2026-02-01'),
        dueDate: date('2026-02-20'),
        status: 'CONFIRMED',
        salesType: 'CREDIT_SALE',
        paymentMethod: 'CREDIT',
        totalAmount: 1000,
        receivableId: invoice.id,
        journalEntryId: invoiceJournal.id,
      },
    });
    await db.receivable.update({
      where: { id: invoice.id },
      data: { sourceId: sale.id, journalEntryId: invoiceJournal.id },
    });
    const paymentJournal = await journal({
      amount: 400,
      on: '2026-02-10',
      referenceType: 'CustomerPayment',
      description: 'Allocated customer receipt',
      extra: { status: 'REVERSED', reversedAt: date('2026-03-05') },
    });
    const payment = await db.customerPayment.create({
      data: {
        ...scope,
        customerId: customer.id,
        paymentNumber: 'CP-PAY-1',
        amount: 400,
        appliedAmount: 400,
        unappliedAmount: 0,
        paymentDate: date('2026-02-10'),
        status: 'REVERSED',
        journalEntryId: paymentJournal.id,
        reversedAt: date('2026-03-05'),
        allocations: {
          create: {
            companyId: company.id,
            receivableId: invoice.id,
            amount: 400,
            createdAt: date('2026-02-10'),
          },
        },
      },
    });
    await db.journalEntry.update({
      where: { id: paymentJournal.id },
      data: { referenceId: payment.id },
    });
    const reversal = await journal({
      amount: 400,
      on: '2026-03-05',
      referenceType: 'CustomerPayment',
      referenceId: payment.id,
      debit: ar,
      credit: cash,
      reversalOfId: paymentJournal.id,
      description: 'Reverse allocated customer receipt',
    });
    await db.customerPayment.update({
      where: { id: payment.id },
      data: { reversalJournalEntryId: reversal.id },
    });
    await journal({
      amount: 200,
      on: '2026-02-12',
      referenceType: 'Receivable',
      referenceId: invoice.id,
      description: 'Receivable settlement CP-INV-1',
    });
    const noteJournal = await journal({
      amount: 50,
      on: '2026-02-18',
      referenceType: 'CreditNote',
      debit: revenue,
      credit: ar,
      description: 'Credit note return',
      extra: { status: 'REVERSED', reversedAt: date('2026-03-07') },
    });
    const note = await db.creditNote.create({
      data: {
        ...scope,
        customerId: customer.id,
        customerName: customer.name,
        creditNoteNumber: 'CP-CN-1',
        salesOrderId: sale.id,
        receivableId: invoice.id,
        subtotal: 50,
        totalAmount: 50,
        appliedAmount: 50,
        issueDate: date('2026-02-18'),
        status: 'VOID',
        journalEntryId: noteJournal.id,
      },
    });
    await db.journalEntry.update({ where: { id: noteJournal.id }, data: { referenceId: note.id } });
    await journal({
      amount: 50,
      on: '2026-03-07',
      referenceType: 'CreditNote',
      referenceId: note.id,
      debit: ar,
      credit: revenue,
      reversalOfId: noteJournal.id,
      description: 'Void credit note',
    });
    await journal({
      amount: 800,
      on: '2026-04-01',
      referenceType: 'Receivable',
      referenceId: invoice.id,
      debit: badDebt,
      credit: ar,
      description: 'Receivable write-off CP-INV-1',
    });
    const cashJournal = await journal({
      amount: 100,
      on: '2026-02-15',
      referenceType: 'SalesOrder',
      debit: cash,
      credit: revenue,
      description: 'Cash sale receipt',
    });
    const cashSale = await db.salesOrder.create({
      data: {
        ...scope,
        customerId: customer.id,
        salesOrderNumber: 'CP-CASH',
        createdById: actor.id,
        orderDate: date('2026-02-15'),
        status: 'PAID',
        paymentStatus: 'PAID',
        paymentMethod: 'CASH',
        totalAmount: 100,
        paidAmount: 100,
        journalEntryId: cashJournal.id,
      },
    });
    await db.journalEntry.update({
      where: { id: cashJournal.id },
      data: { referenceId: cashSale.id },
    });
    await db.receivable.create({
      data: {
        ...scope,
        branchId: branchB.id,
        customerId: customer.id,
        customerName: customer.name,
        receivableNumber: 'CP-HIDDEN',
        amount: 9000,
        outstandingAmount: 9000,
        issueDate: date('2026-02-01'),
        dueDate: date('2026-02-05'),
      },
    });
    await db.receivable.create({
      data: {
        ...scope,
        customerId: customer.id,
        customerName: customer.name,
        receivableNumber: 'CP-USD',
        amount: 7000,
        outstandingAmount: 7000,
        currency: 'USD',
        issueDate: date('2026-02-01'),
      },
    });

    const companies = new CompanyScopeService(db);
    const organizations = new OrganizationScopeService(db);
    const projection = new CustomerAccountProjectionService(db, companies, organizations);
    let failAudit = false;
    const audit = {
      log: async () => {},
      logStrictInTransaction: async () => {
        if (failAudit) throw new Error('Fixture audit store unavailable');
      },
    };
    const statements = new CustomerStatementsService(
      db,
      audit,
      companies,
      undefined,
      undefined,
      projection,
      organizations,
    );
    const performance = new CustomerPerformanceService(projection);
    const branchUser = {
      ...user,
      roleScopes: ['BRANCH'],
      branchAccess: [{ branchId: branchA.id, accessLevel: 'WRITE' }],
    };
    const selection = {
      ...scope,
      customerId: customer.id,
      currency: 'TZS',
      dateFrom: '2026-02-01',
      dateTo: '2026-02-28',
    };
    const february = await statements.buildStatement(selection, branchUser);
    assert.equal(
      fixed(february.closingBalance),
      '350.00',
      'February includes payment, legacy settlement, credit note and zero-net cash activity',
    );
    assert.equal(
      fixed(february.aging.total),
      '350.00',
      'Historical aging reconstructs the selected closing day',
    );
    assert.equal(february.agingAsOf.toISOString().slice(0, 10), '2026-02-28');
    assert(
      february.lines.some((line) => line.sourceId === cashSale.id && Number(line.debit) === 100),
    );
    assert(
      february.lines.some((line) => line.sourceId === cashSale.id && Number(line.credit) === 100),
    );
    const march = await statements.buildStatement(
      { ...selection, dateTo: '2026-03-31' },
      branchUser,
    );
    assert.equal(
      fixed(march.closingBalance),
      '800.00',
      'March includes dated payment reversal and credit-note void',
    );
    const april = await statements.buildStatement(
      { ...selection, dateTo: '2026-04-30' },
      branchUser,
    );
    assert.equal(
      fixed(april.closingBalance),
      '0.00',
      'Write-off is a dated adjustment, not erased invoice history',
    );
    const allBranches = await statements.buildStatement(
      { ...selection, divisionId: undefined, branchId: undefined },
      user,
    );
    assert.equal(fixed(allBranches.closingBalance), '9350.00');
    const denied = { ...branchUser, branchAccess: [] };
    await assert.rejects(
      statements.buildStatement(selection, denied),
      /access|scope|not found|belongs|No accessible/i,
    );
    const detail = await statements.getDetail(selection, branchUser);
    assert.equal(fixed(detail.closingBalance), '350.00');
    const run = await statements.generate(
      {
        ...scope,
        customerId: customer.id,
        currency: 'TZS',
        periodStart: selection.dateFrom,
        periodEnd: selection.dateTo,
      },
      branchUser,
    );
    assert(run.snapshotHash, 'Issued statement has an immutable content hash');
    const savedBefore = await statements.savedDetail(run.id, branchUser);
    await assert.rejects(
      db.customerStatementRun.update({ where: { id: run.id }, data: { closingBalance: 999 } }),
      /immutable/i,
    );
    for (const field of ['generatedAt', 'createdAt']) {
      await assert.rejects(
        db.customerStatementRun.update({
          where: { id: run.id },
          data: { [field]: date('2026-01-01') },
        }),
        /immutable/i,
      );
    }
    await assert.rejects(
      db.customerStatementRun.update({
        where: { id: run.id },
        data: { generatedById: 'altered-issuer' },
      }),
      /immutable/i,
    );
    await db.customerPayment.update({ where: { id: payment.id }, data: { amount: 999 } });
    await assert.rejects(
      statements.exportPdf({ ...selection, expectedHash: detail.contentHash }, branchUser),
      /changed after the preview/i,
    );
    const savedAfter = await statements.savedDetail(run.id, branchUser);
    assert.deepEqual(
      savedAfter,
      savedBefore,
      'Reopening an issued statement uses the saved snapshot',
    );
    const pdf = await statements.exportPdf({ ...selection, runId: run.id }, branchUser);
    assert.equal(pdf.buffer.subarray(0, 5).toString(), '%PDF-');
    const excel = await statements.exportExcel({ ...selection, runId: run.id }, branchUser);
    assert.equal(excel.buffer.subarray(0, 2).toString(), 'PK');
    await assert.rejects(
      statements.savedDetail(run.id, denied),
      /access|scope|not found|belongs|No accessible/i,
    );
    await db.customerPayment.update({ where: { id: payment.id }, data: { amount: 400 } });
    failAudit = true;
    await assert.rejects(
      statements.generate(
        {
          ...scope,
          customerId: customer.id,
          currency: 'TZS',
          periodStart: selection.dateFrom,
          periodEnd: selection.dateTo,
        },
        branchUser,
      ),
      /audit store unavailable/,
    );
    assert.equal(
      await db.customerStatementRun.count(),
      1,
      'Failed audit append rolls back statement issuance',
    );
    failAudit = false;
    const report = await performance.read(branchUser, {
      ...scope,
      dateFrom: selection.dateFrom,
      dateTo: selection.dateTo,
      currency: 'TZS',
      page: 1,
      limit: 25,
    });
    assert.equal(report.total, 1);
    assert.equal(report.rows[0].id, customer.id);
    assert.equal(
      fixed(report.rows[0].netSales),
      '1050.00',
      'Credit note reduces revenue once; cash sale included',
    );
    const history = await performance.history(branchUser, customer.id, {
      ...scope,
      dateFrom: selection.dateFrom,
      dateTo: selection.dateTo,
      currency: 'TZS',
      page: 1,
      limit: 25,
    });
    assert.equal(
      history.rows.length,
      3,
      'Header payment, legacy settlement and immediate cash receipt appear once each',
    );
    assert(history.rows.some((row) => row.status === 'REVERSED'));

    const crossCustomer = await db.customer.create({
      data: {
        companyId: company.id,
        customerCode: 'CP-CROSS',
        name: 'Cross-branch allocation fixture',
      },
    });
    const crossInvoice = await db.receivable.create({
      data: {
        ...scope,
        branchId: branchB.id,
        customerId: crossCustomer.id,
        customerName: crossCustomer.name,
        receivableNumber: 'CP-CROSS-INV',
        amount: 1000,
        outstandingAmount: 700,
        paidAmount: 300,
        issueDate: date('2026-02-01'),
        dueDate: date('2026-02-20'),
        status: 'PARTIALLY_PAID',
      },
    });
    const crossJournal = await journal({
      amount: 400,
      on: '2026-01-29',
      referenceType: 'CustomerPayment',
      description: 'Cross-branch customer receipt',
    });
    const crossPayment = await db.customerPayment.create({
      data: {
        ...scope,
        customerId: crossCustomer.id,
        paymentNumber: 'PRIVATE-HEADER-BRANCH-A',
        reference: 'PRIVATE-BANK-REFERENCE',
        method: 'BANK_TRANSFER',
        amount: 400,
        appliedAmount: 300,
        unappliedAmount: 100,
        paymentDate: date('2026-01-29'),
        createdAt: date('2026-01-29'),
        journalEntryId: crossJournal.id,
        allocations: {
          create: {
            companyId: company.id,
            receivableId: crossInvoice.id,
            amount: 300,
            createdAt: date('2026-02-10'),
          },
        },
      },
    });
    await db.journalEntry.update({
      where: { id: crossJournal.id },
      data: { referenceId: crossPayment.id },
    });
    const branchBUser = {
      ...user,
      roleScopes: ['BRANCH'],
      branchAccess: [{ branchId: branchB.id, accessLevel: 'WRITE' }],
    };
    const crossSelection = { ...selection, branchId: branchB.id, customerId: crossCustomer.id };
    const cross = await statements.buildStatement(crossSelection, branchBUser);
    assert.equal(
      fixed(cross.closingBalance),
      '700.00',
      'An outside-branch receipt settles the visible allocated invoice portion',
    );
    assert.equal(
      fixed(cross.openingBalance),
      '0.00',
      'Later allocation is not backdated into the opening balance',
    );
    const crossLines = JSON.stringify(cross.lines);
    assert(
      !crossLines.includes('PRIVATE-HEADER') &&
        !crossLines.includes('PRIVATE-BANK') &&
        !crossLines.includes(crossPayment.id),
      'Outside-scope receipt identifiers are redacted',
    );
    assert(
      cross.lines.some(
        (line) =>
          Number(line.credit) === 300 && line.date.toISOString().slice(0, 10) === '2026-02-10',
      ),
    );
    assert.equal(
      fixed(cross.customerCredit),
      '0.00',
      'Outside-scope customer deposits are not exposed',
    );
    const mixedCustomer = await db.customer.create({
      data: { companyId: company.id, customerCode: 'CP-MIXED', name: 'Mixed tender fixture' },
    });
    const mixedInvoice = await db.receivable.create({
      data: {
        ...scope,
        customerId: mixedCustomer.id,
        customerName: mixedCustomer.name,
        receivableNumber: 'CP-MIXED-INV',
        amount: 100,
        paidAmount: 80,
        outstandingAmount: 20,
        issueDate: date('2026-02-01'),
        dueDate: date('2026-02-20'),
        status: 'PARTIALLY_PAID',
        sourceType: 'SalesOrder',
      },
    });
    const mixedSale = await db.salesOrder.create({
      data: {
        ...scope,
        customerId: mixedCustomer.id,
        customerName: mixedCustomer.name,
        salesOrderNumber: 'CP-MIXED-SALE',
        createdById: actor.id,
        orderDate: date('2026-02-01'),
        status: 'CONFIRMED',
        salesType: 'CREDIT_SALE',
        paymentMethod: 'CREDIT',
        totalAmount: 100,
        paidAmount: 60,
        outstandingAmount: 40,
        receivableId: mixedInvoice.id,
      },
    });
    const mixedJournal = await db.journalEntry.create({
      data: {
        ...scope,
        journalNumber: `CP-J-${++sequence}`,
        transactionDate: date('2026-02-01'),
        status: 'POSTED',
        description: 'Mixed tender initial sale',
        referenceType: 'SalesOrder',
        referenceId: mixedSale.id,
        totalDebit: 100,
        totalCredit: 100,
        createdById: actor.id,
        lines: {
          create: [
            { accountId: cash.id, debit: 60, credit: 0 },
            { accountId: ar.id, debit: 40, credit: 0 },
            { accountId: revenue.id, debit: 0, credit: 100 },
          ],
        },
      },
    });
    await db.salesOrder.update({
      where: { id: mixedSale.id },
      data: { journalEntryId: mixedJournal.id },
    });
    await db.receivable.update({
      where: { id: mixedInvoice.id },
      data: {
        journalEntryId: mixedJournal.id,
        sourceId: mixedSale.id,
      },
    });
    const futureJournal = await journal({
      amount: 20,
      on: '2026-03-10',
      referenceType: 'CustomerPayment',
    });
    await db.customerPayment.create({
      data: {
        ...scope,
        customerId: mixedCustomer.id,
        paymentNumber: 'CP-FUTURE-PAY',
        amount: 20,
        appliedAmount: 20,
        unappliedAmount: 0,
        paymentDate: date('2026-03-10'),
        createdAt: date('2026-03-10'),
        journalEntryId: futureJournal.id,
        status: 'COMPLETED',
        allocations: {
          create: {
            companyId: company.id,
            receivableId: mixedInvoice.id,
            amount: 20,
            createdAt: date('2026-03-10'),
          },
        },
      },
    });
    const mixedSelection = { ...selection, customerId: mixedCustomer.id };
    const mixedStatement = await statements.buildStatement(mixedSelection, branchUser);
    assert.equal(
      fixed(mixedStatement.closingBalance),
      '40.00',
      'Gross 100 invoice minus proved initial cash 60',
    );
    assert.equal(fixed(mixedStatement.openInvoiceBalance), '40.00');
    assert.equal(
      mixedStatement.settlementHistory.status,
      'COMPLETE',
      'Future receipts reconcile current cumulative evidence',
    );
    assert.equal(mixedStatement.lines.filter((line) => line.type === 'PAYMENT').length, 1);
    await db.receivable.update({ where: { id: mixedInvoice.id }, data: { paidAmount: 85 } });
    const incomplete = await statements.getDetail(mixedSelection, branchUser);
    assert.equal(incomplete.settlementHistory.status, 'INCOMPLETE');
    assert.equal(incomplete.settlementHistory.unresolvedAmount, '5.00');
    await assert.rejects(
      statements.generate(
        {
          ...scope,
          customerId: mixedCustomer.id,
          periodStart: selection.dateFrom,
          periodEnd: selection.dateTo,
          currency: 'TZS',
        },
        branchUser,
      ),
      /incomplete|reconciled/i,
    );
    console.log(
      'PASS: PostgreSQL source coverage, historical aging/reversals/write-offs, currency and branch isolation, cross-branch allocation dates/redaction, cash/mixed tender activity, future receipt reconciliation, incomplete history issue blocking, immutable snapshot/custody migration, audit rollback, stale preview checks, PDF/Excel, customer performance and payment history.',
    );
  } finally {
    if (db) await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.$disconnect();
    console.log('Disposable Customer Performance database removed.');
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
