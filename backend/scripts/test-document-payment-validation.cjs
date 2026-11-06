/* All financial fixture writes are confined to a new disposable local database.
 * Run after prisma:generate, for example:
 * DOCUMENT_PAYMENT_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/postgres \
 *   node scripts/test-document-payment-validation.cjs
 * DATABASE_URL is deliberately never used as a fallback.
 */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const date = (value) => new Date(`${value}T00:00:00.000Z`);
const fixed = (value) => Number(value).toFixed(2);

async function main() {
  assert(
    process.env.DOCUMENT_PAYMENT_TEST_DATABASE_URL,
    'Set DOCUMENT_PAYMENT_TEST_DATABASE_URL explicitly to a local PostgreSQL administrative database',
  );
  const target = new URL(process.env.DOCUMENT_PAYMENT_TEST_DATABASE_URL);
  assert(['postgres:', 'postgresql:'].includes(target.protocol), 'PostgreSQL is required');
  assert(
    ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname),
    'Only local PostgreSQL is allowed',
  );
  assert(!target.searchParams.has('host'), 'A socket/host override is not allowed');
  const database = `document_payment_test_${randomUUID().replaceAll('-', '')}`;
  const databaseNamePattern = /^document_payment_test_[a-f0-9]{32}$/;
  assert(databaseNamePattern.test(database));

  process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json');
  require('ts-node/register/transpile-only');
  const { PrismaClient } = require('@prisma/client');
  const admin = new PrismaClient({ datasources: { db: { url: target.toString() } } });
  let db;
  let created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    created = true;
    target.pathname = `/${database}`;
    process.env.DATABASE_URL = target.toString();
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
      { env: { ...process.env }, stdio: 'pipe', timeout: 120000 },
    );

    const { ConfigService } = require('@nestjs/config');
    const { PrismaService } = require('../src/prisma/prisma.service');
    const {
      PersistenceSecretGuard,
    } = require('../src/common/services/persistence-secret-guard.service');
    const {
      EphemeralSecretFingerprintRegistry,
    } = require('../src/common/services/ephemeral-secret-fingerprint-registry.service');
    const { CompanyScopeService } = require('../src/common/services/company-scope.service');
    const {
      OrganizationScopeService,
    } = require('../src/common/services/organization-scope.service');
    const { AccountResolverService } = require('../src/common/services/account-resolver.service');
    const {
      AccountingControlService,
    } = require('../src/common/services/accounting-control.service');
    const { AuditLogsService } = require('../src/modules/audit-logs/audit-logs.service');
    const {
      PostingEngineService,
    } = require('../src/modules/accounting-engine/posting-engine.service');
    const {
      EntityCodeGeneratorService,
    } = require('../src/modules/entity-code-generator/entity-code-generator.service');
    const {
      CustomerPaymentsService,
    } = require('../src/modules/customer-payments/customer-payments.service');
    const { ReceivablesService } = require('../src/modules/receivables/receivables.service');
    const { CashBookService } = require('../src/modules/cash-book/cash-book.service');
    const {
      legacyPaymentRequest,
      replayLegacyPayment,
    } = require('../src/common/utils/document-payment-request');

    // Exercise the application's real middleware, not a bare PrismaClient or mock.
    db = new PrismaService(new PersistenceSecretGuard(new EphemeralSecretFingerprintRegistry()));
    await db.$connect();
    const group = await db.group.create({
      data: { name: 'Payment validation fixture', code: 'DP-TEST' },
    });
    const company = await db.company.create({
      data: { groupId: group.id, name: 'Fixture company', code: 'DP-CO' },
    });
    const division = await db.division.create({
      data: { companyId: company.id, name: 'Trading', code: 'DP-DIV', type: 'OTHER' },
    });
    const branch = await db.branch.create({
      data: { divisionId: division.id, name: 'Fixture branch', code: 'DP-BR', type: 'BRANCH' },
    });
    const scope = { companyId: company.id, divisionId: division.id, branchId: branch.id };
    const actor = await db.user.create({
      data: {
        email: 'document-payment@example.invalid',
        passwordHash: 'non-authenticating-fixture',
        fullName: 'Fixture operator',
      },
    });
    const user = {
      id: actor.id,
      fullName: actor.fullName,
      email: actor.email,
      roles: [],
      roleScopes: ['COMPANY'],
      permissions: [],
      companyAccess: [{ companyId: company.id, accessLevel: 'MANAGE' }],
      divisionAccess: [],
      branchAccess: [],
    };
    const customer = await db.customer.create({
      data: { ...scope, customerCode: 'DP-CUST', name: 'Fixture customer' },
    });
    const cashLedger = await db.chartOfAccount.create({
      data: {
        companyId: company.id,
        accountCode: '1000',
        accountName: 'Cash on hand',
        accountType: 'ASSET',
        accountSubType: 'CASH_ON_HAND',
      },
    });
    const arLedger = await db.chartOfAccount.create({
      data: {
        companyId: company.id,
        accountCode: '1200',
        accountName: 'Accounts receivable',
        accountType: 'ASSET',
        accountSubType: 'AR_CONTROL',
      },
    });
    await db.chartOfAccount.create({
      data: {
        companyId: company.id,
        accountCode: '4000',
        accountName: 'Income',
        accountType: 'INCOME',
        accountSubType: 'INCOME_SUMMARY',
      },
    });
    const cash = await db.cashAccount.create({
      data: {
        ...scope,
        ledgerAccountId: cashLedger.id,
        accountName: 'TDM-01 Cash Account',
        accountType: 'CASH_ON_HAND',
        currency: 'TZS',
      },
    });
    const desk = await db.cashDeskAccount.create({
      data: {
        ...scope,
        erpCashAccountId: cash.id,
        name: 'Fixture cash book',
        nameKey: 'fixture-cash-book',
        kind: 'CASH_ON_HAND',
        currency: 'TZS',
        openingDate: date('2026-01-01'),
      },
    });
    const year = await db.fiscalYear.create({
      data: {
        companyId: company.id,
        name: '2026',
        startDate: date('2026-01-01'),
        endDate: date('2026-12-31'),
      },
    });
    await db.accountingPeriod.create({
      data: {
        companyId: company.id,
        fiscalYearId: year.id,
        name: 'October',
        startDate: date('2026-10-01'),
        endDate: date('2026-10-31'),
      },
    });

    // Both document types execute this company-scoped compound unique lookup,
    // including before the first payment when no journal exists yet.
    for (const kind of ['Receivable', 'Payable']) {
      const id = randomUUID();
      const dto = {
        requestId: randomUUID(),
        amount: 100,
        paymentDate: '2026-10-23',
        cashAccountId: cash.id,
      };
      const replay = () =>
        db.$transaction((tx) => replayLegacyPayment(tx, company.id, kind, id, dto));
      assert.equal(await replay(), false, `${kind}: a new request has no legacy journal`);
      const claim = legacyPaymentRequest(kind, id, dto);
      const journal = await db.journalEntry.create({
        data: {
          ...scope,
          journalNumber: claim.journalNumber,
          transactionDate: date('2026-10-23'),
          description: `Fixture legacy payment${claim.suffix}`,
          referenceType: kind,
          referenceId: id,
          status: 'POSTED',
          totalDebit: 100,
          totalCredit: 100,
          createdById: actor.id,
          lines: {
            create: [
              { companyId: company.id, accountId: cashLedger.id, debit: 100, credit: 0 },
              { companyId: company.id, accountId: arLedger.id, debit: 0, credit: 100 },
            ],
          },
        },
      });
      const where = {
        companyId_journalNumber: { companyId: company.id, journalNumber: claim.journalNumber },
      };
      assert.equal((await db.journalEntry.findUnique({ where })).id, journal.id);
      assert.equal(await replay(), true, `${kind}: an identical legacy payment replays`);
      await assert.rejects(
        db.$transaction((tx) =>
          replayLegacyPayment(tx, company.id, kind, id, { ...dto, amount: 101 }),
        ),
        (error) => error.getStatus?.() === 409,
        `${kind}: changed payment details cannot reuse a request`,
      );
      await db.journalEntry.delete({ where: { id: journal.id } });
      assert.equal(
        await db.journalEntry.findUnique({ where }),
        null,
        `${kind}: compound lookup hides a soft-deleted journal`,
      );
      assert.equal(
        await db.journalEntry.findUnique({ where: { id: journal.id } }),
        null,
        `${kind}: simple unique lookup still hides a soft-deleted journal`,
      );
      assert.equal(
        (await db.journalEntry.findUnique({ where: { ...where, deletedAt: { not: null } } })).id,
        journal.id,
        `${kind}: an explicit deletedAt filter is respected`,
      );
    }
    console.log('PASS: real PrismaService AR/AP compound replay lookup and soft-delete filtering');

    const audit = new AuditLogsService(db);
    const companies = new CompanyScopeService(db);
    const org = new OrganizationScopeService(db);
    const resolver = new AccountResolverService(db);
    const posting = new PostingEngineService(db, new AccountingControlService(db), resolver);
    const codes = new EntityCodeGeneratorService(db);
    const cashBook = new CashBookService(
      db,
      audit,
      companies,
      new ConfigService({ CASH_BOOK_UNIFIED: 'true' }),
    );
    const customerPayments = new CustomerPaymentsService(
      db,
      audit,
      companies,
      resolver,
      posting,
      codes,
      cashBook,
      org,
    );
    const receivables = new ReceivablesService(
      db,
      audit,
      companies,
      resolver,
      posting,
      codes,
      org,
      customerPayments,
      cashBook,
    );

    // Recreate the screenshot's TZS 280,000 invoice / 251,000 remaining balance
    // using the real services, then submit its dated, idempotent payment request.
    const invoice = await receivables.create(
      {
        ...scope,
        customerId: customer.id,
        customerName: customer.name,
        amount: 280000,
        currency: 'TZS',
        issueDate: '2026-10-22',
        dueDate: '2026-11-21',
      },
      user,
    );
    await receivables.recordPayment(
      invoice.id,
      { amount: 29000, cashAccountId: cash.id, paymentDate: '2026-10-22' },
      user,
    );
    const before = await db.receivable.findUnique({ where: { id: invoice.id } });
    assert.equal(fixed(before.outstandingAmount), '251000.00');
    const dto = {
      requestId: randomUUID(),
      amount: 251000,
      cashAccountId: cash.id,
      paymentDate: '2026-10-23',
    };
    const journalCountBefore = await db.journalEntry.count();
    const settled = await receivables.recordPayment(invoice.id, dto, user);
    assert.equal(settled.status, 'PAID');
    assert.equal(fixed(settled.paidAmount), '280000.00');
    assert.equal(fixed(settled.outstandingAmount), '0.00');
    const payment = await db.customerPayment.findFirstOrThrow({
      where: { requestId: dto.requestId },
      include: { allocations: true, journalEntry: { include: { lines: true } } },
    });
    assert.equal(fixed(payment.amount), '251000.00');
    assert.equal(payment.currency, 'TZS');
    assert.equal(payment.paymentDate.toISOString(), date('2026-10-23').toISOString());
    assert.equal(payment.allocations.length, 1);
    assert.equal(payment.allocations[0].receivableId, invoice.id);
    assert.equal(fixed(payment.allocations[0].amount), '251000.00');
    assert.equal(payment.journalEntry.status, 'POSTED');
    assert.equal(fixed(payment.journalEntry.totalDebit), '251000.00');
    assert.equal(fixed(payment.journalEntry.totalCredit), '251000.00');
    assert.equal(payment.journalEntry.lines.length, 2);
    assert(
      payment.journalEntry.lines.some(
        (line) => line.accountId === cashLedger.id && fixed(line.debit) === '251000.00',
      ),
    );
    assert(
      payment.journalEntry.lines.some(
        (line) =>
          line.accountId === arLedger.id &&
          line.customerId === customer.id &&
          fixed(line.credit) === '251000.00',
      ),
    );
    assert.equal(await db.journalEntry.count(), journalCountBefore + 1);

    async function snapshot(receivableId = invoice.id) {
      const [
        stored,
        storedCash,
        storedDesk,
        storedCustomer,
        payments,
        allocations,
        journals,
        movements,
        entries,
      ] = await Promise.all([
        db.receivable.findUnique({ where: { id: receivableId } }),
        db.cashAccount.findUnique({ where: { id: cash.id } }),
        db.cashDeskAccount.findUnique({ where: { id: desk.id } }),
        db.customer.findUnique({ where: { id: customer.id } }),
        db.customerPayment.count(),
        db.paymentAllocation.count(),
        db.journalEntry.count(),
        db.cashDeskMovement.count(),
        db.cashDeskEntry.count(),
      ]);
      return {
        paid: fixed(stored.paidAmount),
        outstanding: fixed(stored.outstandingAmount),
        status: stored.status,
        cash: fixed(storedCash.currentBalance),
        desk: fixed(storedDesk.balance),
        customer: fixed(storedCustomer.currentBalance),
        payments,
        allocations,
        journals,
        movements,
        entries,
      };
    }
    const committed = await snapshot();
    assert.equal(committed.cash, '280000.00');
    assert.equal(committed.desk, '280000.00');
    assert.equal(committed.customer, '0.00');
    assert.equal(committed.payments, 2);
    assert.equal(committed.allocations, 2);
    assert.equal(committed.movements, 2);
    assert.equal(committed.entries, 2);
    const retry = await receivables.recordPayment(invoice.id, dto, user);
    assert.equal(retry.id, invoice.id);
    assert.deepEqual(
      await snapshot(),
      committed,
      'Retry must not duplicate payment, allocation, journal, cash book entry or cash balance',
    );
    await assert.rejects(
      receivables.recordPayment(invoice.id, { ...dto, amount: 250999 }, user),
      (error) => error.getStatus?.() === 409,
    );
    assert.deepEqual(
      await snapshot(),
      committed,
      'A conflicting retry must leave every financial balance unchanged',
    );
    console.log(
      'PASS: TZS 251,000 receivable payment dated 2026-10-23, balanced journal, cash book and idempotent retry',
    );

    // A whole-shilling display must not turn an actual TZS 187.50 balance into
    // a TZS 188 payment. Recreate the production amounts with real postings.
    const fractionalInvoice = await receivables.create(
      {
        ...scope,
        customerId: customer.id,
        customerName: customer.name,
        amount: 979687.5,
        currency: 'TZS',
        issueDate: '2026-10-22',
        dueDate: '2026-11-21',
      },
      user,
    );
    await receivables.recordPayment(
      fractionalInvoice.id,
      { amount: 979500, cashAccountId: cash.id, paymentDate: '2026-10-22' },
      user,
    );
    const fractionalBefore = await snapshot(fractionalInvoice.id);
    assert.equal(fractionalBefore.paid, '979500.00');
    assert.equal(fractionalBefore.outstanding, '187.50');
    assert.equal(fractionalBefore.status, 'PARTIALLY_PAID');
    assert.equal(fractionalBefore.customer, '187.50');
    const fractionalDto = {
      requestId: randomUUID(),
      amount: 187.5,
      cashAccountId: cash.id,
      paymentDate: '2026-10-23',
    };
    await assert.rejects(
      receivables.recordPayment(fractionalInvoice.id, { ...fractionalDto, amount: 188 }, user),
      (error) => error.getStatus?.() === 400 && /exceeds outstanding amount/.test(error.message),
      'TZS 188 must be rejected against an exact TZS 187.50 outstanding balance',
    );
    assert.deepEqual(
      await snapshot(fractionalInvoice.id),
      fractionalBefore,
      'The rounded-up overpayment must not create financial records or change balances',
    );
    assert.equal(
      await db.customerPayment.count({ where: { requestId: fractionalDto.requestId } }),
      0,
      'A rejected overpayment must not claim its payment request',
    );

    const fractionalSettled = await receivables.recordPayment(
      fractionalInvoice.id,
      fractionalDto,
      user,
    );
    assert.equal(fractionalSettled.status, 'PAID');
    assert.equal(fixed(fractionalSettled.amount), '979687.50');
    assert.equal(fixed(fractionalSettled.paidAmount), '979687.50');
    assert.equal(fixed(fractionalSettled.outstandingAmount), '0.00');
    const fractionalPayment = await db.customerPayment.findFirstOrThrow({
      where: { requestId: fractionalDto.requestId },
      include: { allocations: true, journalEntry: { include: { lines: true } } },
    });
    assert.equal(fixed(fractionalPayment.amount), '187.50');
    assert.equal(fixed(fractionalPayment.appliedAmount), '187.50');
    assert.equal(fixed(fractionalPayment.unappliedAmount), '0.00');
    assert.equal(fractionalPayment.currency, 'TZS');
    assert.equal(fractionalPayment.allocations.length, 1);
    assert.equal(fractionalPayment.allocations[0].receivableId, fractionalInvoice.id);
    assert.equal(fixed(fractionalPayment.allocations[0].amount), '187.50');
    assert.equal(fractionalPayment.journalEntry.status, 'POSTED');
    assert.equal(fixed(fractionalPayment.journalEntry.totalDebit), '187.50');
    assert.equal(fixed(fractionalPayment.journalEntry.totalCredit), '187.50');
    assert.equal(fractionalPayment.journalEntry.lines.length, 2);
    assert(
      fractionalPayment.journalEntry.lines.some(
        (line) => line.accountId === cashLedger.id && fixed(line.debit) === '187.50',
      ),
    );
    assert(
      fractionalPayment.journalEntry.lines.some(
        (line) =>
          line.accountId === arLedger.id &&
          line.customerId === customer.id &&
          fixed(line.credit) === '187.50',
      ),
    );
    const fractionalMovement = await db.cashDeskMovement.findUniqueOrThrow({
      where: { customerPaymentId: fractionalPayment.id },
      include: { entries: true },
    });
    assert.equal(fixed(fractionalMovement.amount), '187.50');
    assert.equal(fractionalMovement.receivableId, fractionalInvoice.id);
    assert.equal(fractionalMovement.journalEntryId, fractionalPayment.journalEntryId);
    assert.equal(fractionalMovement.entries.length, 1);
    assert.equal(fractionalMovement.entries[0].accountId, desk.id);
    assert.equal(fixed(fractionalMovement.entries[0].amount), '187.50');
    const fractionalCommitted = await snapshot(fractionalInvoice.id);
    assert.equal(fractionalCommitted.cash, '1259687.50');
    assert.equal(fractionalCommitted.desk, '1259687.50');
    assert.equal(fractionalCommitted.customer, '0.00');
    for (const count of ['payments', 'allocations', 'journals', 'movements', 'entries']) {
      assert.equal(
        fractionalCommitted[count],
        fractionalBefore[count] + 1,
        `${count}: one exact settlement`,
      );
    }
    const fractionalRetry = await receivables.recordPayment(
      fractionalInvoice.id,
      fractionalDto,
      user,
    );
    assert.equal(fractionalRetry.id, fractionalInvoice.id);
    assert.deepEqual(
      await snapshot(fractionalInvoice.id),
      fractionalCommitted,
      'Retrying TZS 187.50 must not duplicate financial records or change exact balances',
    );
    console.log(
      'PASS: TZS 188 overpayment rejected unchanged; exact TZS 187.50 settles with exact journal, allocation, cash book and idempotent retry',
    );
  } finally {
    if (db) await db.$disconnect();
    try {
      if (created) {
        // The only DROP target is the exact random database this process created.
        assert(databaseNamePattern.test(database));
        await admin.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
      }
    } finally {
      await admin.$disconnect();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
