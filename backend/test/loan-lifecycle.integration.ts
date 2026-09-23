import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { CompanyScopeService } from '../src/common/services/company-scope.service';
import { OrganizationScopeService } from '../src/common/services/organization-scope.service';
import { AccountingControlService } from '../src/common/services/accounting-control.service';
import { PostingEngineService } from '../src/modules/accounting-engine/posting-engine.service';
import { LoanLedgerService } from '../src/modules/loans/loan-ledger.service';
import { LoanLifecycleService } from '../src/modules/loans/loan-lifecycle.service';
import { IntercompanyLoanLedgerService } from '../src/modules/loans/intercompany-loan-ledger.service';
import { LoanRepaymentSchedulesService } from '../src/modules/loan-repayment-schedules/loan-repayment-schedules.service';
import { CashConnectionsService } from '../src/modules/desk-reports/cash-connections.service';
import { CashDeskService } from '../src/modules/cash-desk/cash-desk.service';
import { FinancingReportsService } from '../src/modules/desk-reports/financing.service';

const url = new URL(process.env.LOAN_PROOF_DATABASE_URL || 'http://invalid');
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  !/^\/itemba_loan_proof_[a-z0-9_]+$/.test(url.pathname)
)
  throw Error('This proof requires a separately created local itemba_loan_proof_* database.');
const db = new PrismaClient({ datasources: { db: { url: url.href } } });
const D = (n: string | number) => new Prisma.Decimal(n);
const date = (s: string) => new Date(s + 'T00:00:00.000Z');
let checks = 0;
function equal(actual: any, expected: any) {
  assert.equal(String(actual), String(expected));
  checks++;
}
async function rejects(fn: () => Promise<unknown>, text: RegExp) {
  await assert.rejects(fn, text);
  checks++;
}
async function main() {
  assert.equal(await db.loan.count(), 0, 'Use a fresh proof database');
  const group = await db.group.create({ data: { name: 'Proof Group', code: 'PROOF' } });
  const actor = await db.user.create({
    data: {
      email: 'loans-proof@example.invalid',
      passwordHash: 'disabled',
      fullName: 'Loan proof',
    },
  });
  const companies = new CompanyScopeService(db as any),
    org = new OrganizationScopeService(db as any);
  const audit: any = {
    logStrictInTransaction: async (tx: any, input: any) =>
      tx.auditLog.create({
        data: {
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          userId: input.userId,
          companyId: input.companyId,
          metadata: input.metadata,
        },
      }),
  };
  const engine = new PostingEngineService(
    db as any,
    new AccountingControlService(db as any),
    {} as any,
  );
  const ledger = new LoanLedgerService(companies, org, engine, audit);
  const lifecycle = new LoanLifecycleService(db as any, ledger, audit);
  const internal = new IntercompanyLoanLedgerService(ledger, audit);
  const connections = new CashConnectionsService(db as any, companies, org, engine, audit);
  const schedules = new LoanRepaymentSchedulesService(
    db as any,
    audit,
    {} as any,
    {} as any,
    {} as any,
    engine,
    companies,
    lifecycle,
    ledger,
  );
  const cash = new CashDeskService(
    db as any,
    companies,
    org,
    audit,
    {} as any,
    undefined,
    internal,
  );
  const report = new FinancingReportsService(db as any, companies, org, {
    resolve: async () => {
      throw Error('Legacy resolver must not be used for connected loans');
    },
  } as any);
  async function company(code: string) {
    const co = await db.company.create({ data: { groupId: group.id, name: code, code } });
    const div = await db.division.create({
      data: { companyId: co.id, name: code, code, type: 'OTHER' },
    });
    const branch = await db.branch.create({
      data: { divisionId: div.id, name: code, code, type: 'OTHER' },
    });
    await db.companyProfile.create({
      data: {
        companyId: co.id,
        registeredName: code,
        brelaRegNumber: code,
        tin: code,
        registeredAddress: 'Proof',
        currency: 'TZS',
      },
    });
    const fy = await db.fiscalYear.create({
      data: {
        companyId: co.id,
        name: '2026',
        startDate: date('2026-01-01'),
        endDate: date('2026-12-31'),
        status: 'OPEN',
      },
    });
    const period = await db.accountingPeriod.create({
      data: {
        companyId: co.id,
        fiscalYearId: fy.id,
        name: '2026',
        startDate: fy.startDate,
        endDate: fy.endDate,
        status: 'OPEN',
      },
    });
    const gl: Record<string, string> = {};
    for (const [name, type] of Object.entries({
      cash: 'ASSET',
      receivable: 'ASSET',
      payable: 'LIABILITY',
      interest: 'EXPENSE',
      fees: 'EXPENSE',
      income: 'INCOME',
      feeIncome: 'INCOME',
      equity: 'EQUITY',
    }))
      gl[name] = (
        await db.chartOfAccount.create({
          data: {
            companyId: co.id,
            accountCode: name,
            accountName: name,
            accountType: type as any,
          },
        })
      ).id;
    const bank = await db.cashAccount.create({
      data: { companyId: co.id, accountName: code, currency: 'TZS', ledgerAccountId: gl.cash },
    });
    const till = await db.cashDeskAccount.create({
      data: {
        companyId: co.id,
        divisionId: div.id,
        branchId: branch.id,
        name: code,
        nameKey: code,
        kind: 'BANK',
        currency: 'TZS',
        openingDate: date('2026-01-01'),
        erpCashAccountId: bank.id,
      },
    });
    return { co, div, branch, period, gl, till };
  }
  const a = await company('LENDER'),
    b = await company('BORROWER');
  const user: any = {
    id: actor.id,
    email: actor.email,
    fullName: actor.fullName,
    roles: [],
    roleScopes: ['GROUP'],
    permissions: [
      'journal_entries.view',
      'journal_entries.create',
      'journal_entries.post',
      'journal_entries.reverse',
      'cash_desk.view',
      'cash_desk.record',
    ],
    companyAccess: [a, b].map((x) => ({ companyId: x.co.id, accessLevel: 'MANAGE' })),
  };
  const base: any = {
    requestId: randomUUID(),
    fundingMode: 'NEW',
    companyId: a.co.id,
    lenderName: 'Proof bank',
    obligationType: 'BANK_LOAN',
    principalAmount: '1000',
    outstandingBalance: '1000',
    currency: 'TZS',
    interestRate: '0.12',
    disbursementDate: '2026-01-02',
    maturityDate: '2026-12-31',
    repaymentFrequency: 'MONTHLY',
    cashDeskAccountId: a.till.id,
    principalLedgerAccountId: a.gl.payable,
    fees: '20',
    feeAccountId: a.gl.fees,
  };
  const loan = await lifecycle.create(base, user);
  equal((await db.cashDeskAccount.findUniqueOrThrow({ where: { id: a.till.id } })).balance, 980);
  equal((await lifecycle.review(loan.id, user)).agrees, true);
  equal((await lifecycle.create(base, user)).id, loan.id);
  equal(await db.loan.count(), 1);
  await rejects(
    () => lifecycle.create({ ...base, principalAmount: '2000', outstandingBalance: '2000' }, user),
    /different loan details/,
  );
  const payment: any = {
    requestId: randomUUID(),
    amount: '115',
    principal: '100',
    interest: '10',
    fees: '3',
    penalties: '2',
    repaymentDate: '2026-02-01',
    cashDeskAccountId: a.till.id,
    interestAccountId: a.gl.interest,
    feeAccountId: a.gl.fees,
  };
  const settled = await lifecycle.repay(loan.id, payment, user);
  const event = await db.loanFinancialEvent.findUniqueOrThrow({
    where: { requestId: payment.requestId },
  });
  equal((await db.loan.findUniqueOrThrow({ where: { id: loan.id } })).outstandingBalance, 900);
  equal((await db.cashDeskAccount.findUniqueOrThrow({ where: { id: a.till.id } })).balance, 865);
  equal((await lifecycle.review(loan.id, user)).agrees, true);
  const retry = await lifecycle.repay(loan.id, payment, user);
  equal((retry as any).id, (settled as any).id);
  await rejects(
    () =>
      cash.reverse(user, event.cashMovementId!, {
        requestId: randomUUID(),
        businessDate: '2026-02-02',
        reason: 'Correction',
      }),
    /loan financial history/,
  );
  const reversal = { requestId: randomUUID(), businessDate: '2026-03-01', reason: 'Wrong payment' };
  await lifecycle.reverse(loan.id, event.id, reversal, user);
  await lifecycle.reverse(loan.id, event.id, reversal, user);
  equal((await db.loan.findUniqueOrThrow({ where: { id: loan.id } })).outstandingBalance, 1000);
  equal((await lifecycle.review(loan.id, user)).agrees, true);
  const historical = await report.borrowings(user, { from: '2026-01-01', to: '2026-02-15' });
  equal(historical.tables[0].rows.find((x) => x.id === loan.id)?.principal, '900.00');
  // Closed periods roll back the loan, cash and event writes already attempted in the transaction.
  const before = {
    loans: await db.loan.count(),
    movements: await db.cashDeskMovement.count(),
    journals: await db.journalEntry.count(),
    events: await db.loanFinancialEvent.count(),
  };
  await db.accountingPeriod.update({ where: { id: a.period.id }, data: { status: 'CLOSED' } });
  await rejects(() => lifecycle.create({ ...base, requestId: randomUUID() }, user), /not OPEN/);
  equal(await db.loan.count(), before.loans);
  equal(await db.cashDeskMovement.count(), before.movements);
  equal(await db.journalEntry.count(), before.journals);
  equal(await db.loanFinancialEvent.count(), before.events);
  await db.accountingPeriod.update({ where: { id: a.period.id }, data: { status: 'OPEN' } });
  const denied = { ...user, companyAccess: [{ companyId: a.co.id, accessLevel: 'READ' }] };
  await rejects(
    () => lifecycle.repay(loan.id, { ...payment, requestId: randomUUID() }, denied),
    /access level/,
  );
  // Opening recognition posts only the remaining principal and never creates cash.
  const opening = await lifecycle.create(
    {
      ...base,
      requestId: randomUUID(),
      fundingMode: 'OPENING',
      cashDeskAccountId: undefined,
      fees: '0',
      openingOffsetAccountId: a.gl.equity,
      recognitionDate: '2026-01-03',
      principalAmount: '100',
      outstandingBalance: '80',
    },
    user,
  );
  equal((await db.cashDeskAccount.findUniqueOrThrow({ where: { id: a.till.id } })).balance, 980);
  const schedule = await schedules.create(
    {
      loanDebtId: opening.id,
      repaymentScheduleNumber: 'PROOF-1',
      installmentNumber: 1,
      dueDate: '2026-06-01',
      principalAmount: 80,
      interestAmount: 8,
      feeAmount: 2,
    },
    user,
  );
  const preview = await lifecycle.previewScheduled(schedule.id, '45', user);
  equal(preview.principal, 40);
  equal(preview.interest, 4);
  equal(preview.fees, 1);
  const scheduled: any = {
    requestId: randomUUID(),
    amount: '45',
    paymentDate: '2026-03-02',
    cashDeskAccountId: a.till.id,
    interestAccountId: a.gl.interest,
    feeAccountId: a.gl.fees,
    allocationFingerprint: preview.allocationFingerprint,
  };
  await schedules.recordPayment(schedule.id, scheduled, user);
  await rejects(
    () => schedules.recordPayment(schedule.id, { ...scheduled, requestId: randomUUID() }, user),
    /allocation changed/,
  );
  const next = await lifecycle.previewScheduled(schedule.id, '45', user);
  const finalId = randomUUID();
  await schedules.recordPayment(
    schedule.id,
    { ...scheduled, requestId: finalId, allocationFingerprint: next.allocationFingerprint },
    user,
  );
  equal((await db.loan.findUniqueOrThrow({ where: { id: opening.id } })).status, 'FULLY_PAID');
  equal((await lifecycle.review(opening.id, user)).agrees, true);
  const finalEvent = await db.loanFinancialEvent.findUniqueOrThrow({
    where: { requestId: finalId },
  });
  await lifecycle.reverse(
    opening.id,
    finalEvent.id,
    { requestId: randomUUID(), businessDate: '2026-03-03', reason: 'Correct installment' },
    user,
  );
  equal(
    (await db.loanRepaymentSchedule.findUniqueOrThrow({ where: { id: schedule.id } }))
      .outstandingAmount,
    45,
  );
  equal((await lifecycle.review(opening.id, user)).agrees, true);
  // Opposite company postings, principal-only reduction and full reversal.
  const transfer: any = {
    requestId: randomUUID(),
    kind: 'LOAN',
    reference: 'Proof',
    accountId: a.till.id,
    targetAccountId: b.till.id,
    amount: '200',
    businessDate: '2026-03-04',
    description: 'Intercompany advance',
    receivableAccountId: a.gl.receivable,
    payableAccountId: b.gl.payable,
  };
  const moved = await cash.record(user, transfer);
  equal(
    await db.journalEntry.count({
      where: { referenceType: 'DeskIntercompany', referenceId: moved.id },
    }),
    2,
  );
  equal((await cash.record(user, transfer)).id, moved.id);
  const internalPayment: any = {
    requestId: randomUUID(),
    kind: 'LOAN_REPAYMENT',
    reference: 'Proof payment',
    accountId: b.till.id,
    targetAccountId: a.till.id,
    loanId: moved.loanId,
    amount: '60',
    principal: '50',
    interest: '8',
    fees: '2',
    businessDate: '2026-03-05',
    description: 'Intercompany repayment',
    interestIncomeAccountId: a.gl.income,
    interestExpenseAccountId: b.gl.interest,
    feeIncomeAccountId: a.gl.feeIncome,
    feeExpenseAccountId: b.gl.fees,
  };
  const repaid = await cash.record(user, internalPayment);
  equal(
    (await db.cashDeskLoan.findUniqueOrThrow({ where: { id: moved.loanId! } })).outstanding,
    150,
  );
  equal(
    await db.journalEntry.count({
      where: { referenceType: 'DeskIntercompany', referenceId: repaid.id },
    }),
    2,
  );
  const icBefore = await db.cashDeskAccount.findMany({ orderBy: { id: 'asc' } });
  await db.accountingPeriod.update({ where: { id: b.period.id }, data: { status: 'CLOSED' } });
  await rejects(
    () => cash.record(user, { ...internalPayment, requestId: randomUUID() }),
    /not OPEN/,
  );
  const icAfter = await db.cashDeskAccount.findMany({ orderBy: { id: 'asc' } });
  equal(icAfter.map((x) => x.balance).join(','), icBefore.map((x) => x.balance).join(','));
  equal(
    (await db.cashDeskLoan.findUniqueOrThrow({ where: { id: moved.loanId! } })).outstanding,
    150,
  );
  await db.accountingPeriod.update({ where: { id: b.period.id }, data: { status: 'OPEN' } });
  await cash.reverse(user, repaid.id, {
    requestId: randomUUID(),
    businessDate: '2026-03-06',
    reason: 'Correct payment',
  });
  equal(
    (await db.cashDeskLoan.findUniqueOrThrow({ where: { id: moved.loanId! } })).outstanding,
    200,
  );
  const internalHistory = await report.internal(user, { from: '2026-01-01', to: '2026-03-05' });
  equal(internalHistory.tables[0].rows[0].outstanding, '150.00');
  await cash.reverse(user, moved.id, {
    requestId: randomUUID(),
    businessDate: '2026-03-07',
    reason: 'Cancel loan',
  });
  equal(
    (await report.internal(user, { from: '2026-01-01', to: '2026-03-07' })).tables[0].rows[0]
      .outstanding,
    '0.00',
  );
  // Generated installments conserve principal and clamp month ends.
  const generated = await lifecycle.create(
    {
      ...base,
      requestId: randomUUID(),
      principalAmount: '100.01',
      outstandingBalance: '100.01',
      fees: '0',
      interestRate: '0',
      disbursementDate: '2026-01-31',
      maturityDate: '2026-04-30',
    },
    user,
  );
  await schedules.generateForLoan(generated.id, user);
  const plan = await db.loanRepaymentSchedule.findMany({
    where: { loanDebtId: generated.id },
    orderBy: { installmentNumber: 'asc' },
  });
  equal(
    plan.reduce((n, r) => n.plus(r.principalAmount), D(0)),
    '100.01',
  );
  equal(plan[0].dueDate.toISOString().slice(0, 10), '2026-02-28');
  for (const row of plan) {
    const preview = await lifecycle.previewScheduled(row.id, row.totalAmount.toFixed(2), user);
    await schedules.recordPayment(
      row.id,
      {
        ...scheduled,
        requestId: randomUUID(),
        amount: row.totalAmount.toFixed(2),
        paymentDate: '2026-05-01',
        allocationFingerprint: preview.allocationFingerprint,
      },
      user,
    );
  }
  equal((await db.loan.findUniqueOrThrow({ where: { id: generated.id } })).status, 'FULLY_PAID');
  equal((await lifecycle.review(generated.id, user)).agrees, true);
  // Concurrent requests cannot both spend the same remaining principal.
  const competing = await Promise.allSettled(
    [1, 2].map(() =>
      lifecycle.repay(
        loan.id,
        {
          requestId: randomUUID(),
          amount: '750',
          repaymentDate: '2026-06-01',
          cashDeskAccountId: a.till.id,
        },
        user,
      ),
    ),
  );
  equal(competing.filter((r) => r.status === 'fulfilled').length, 1);
  equal(competing.filter((r) => r.status === 'rejected').length, 1);
  equal((await db.loan.findUniqueOrThrow({ where: { id: loan.id } })).outstandingBalance, 250);
  equal((await lifecycle.review(loan.id, user)).agrees, true);
  const connectionRows = await connections.list(user, { from: '2026-01-01', to: '2026-12-31' });
  equal(
    connectionRows.every((row) => ['Posted', 'Reversed'].includes(row.status)),
    true,
  );
  // Full-ledger equality for every mapped cash account, including all reversed originals.
  for (const side of [a, b]) {
    const entries = await db.cashDeskEntry.aggregate({
      where: { accountId: side.till.id },
      _sum: { amount: true },
    });
    const lines = await db.journalEntryLine.aggregate({
      where: { accountId: side.gl.cash, journalEntry: { status: { in: ['POSTED', 'REVERSED'] } } },
      _sum: { debit: true, credit: true },
    });
    const balance = (await db.cashDeskAccount.findUniqueOrThrow({ where: { id: side.till.id } }))
      .balance;
    equal(entries._sum.amount, balance);
    equal((lines._sum.debit || D(0)).minus(lines._sum.credit || D(0)), balance);
  }
  console.log(
    'PASS: ' +
      checks +
      ' database assertions — borrowing, fees, opening recognition, schedules, retries, access, closed-period rollback, dated reversals, paired intercompany journals and cash reconciliation.',
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
