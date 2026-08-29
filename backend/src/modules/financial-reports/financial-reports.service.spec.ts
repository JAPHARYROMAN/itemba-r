import { FinancialReportsService } from './financial-reports.service';

function makeService(receivables: any[]) {
  const findMany = jest.fn().mockResolvedValue(receivables);
  const prisma = {
    receivable: { findMany },
  } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const service = new FinancialReportsService(prisma, companyScope);
  return { service, prisma, companyScope, findMany };
}

const user = { id: 'user-1' } as any;

// Fixed "as of" date so day-diff buckets are deterministic.
const AS_OF = '2026-07-01';
const asOfMs = new Date(AS_OF).getTime();
const day = 24 * 60 * 60 * 1000;
const dueDaysAgo = (n: number) => new Date(asOfMs - n * day);

function receivable(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'r-1',
    receivableNumber: 'AR-1',
    customerId: 'cust-1',
    customerName: 'Customer One',
    amount: 100,
    paidAmount: 0,
    outstandingAmount: 100,
    currency: 'TZS',
    issueDate: dueDaysAgo(40),
    dueDate: dueDaysAgo(10),
    status: 'OPEN',
    journalEntryId: 'je-1',
    ...overrides,
  };
}

describe('FinancialReportsService.getCustomerAgingDetail', () => {
  it("buckets a customer's open receivables using the shared boundaries", async () => {
    const { service } = makeService([
      receivable({ id: 'r-current', dueDate: dueDaysAgo(0), outstandingAmount: 10 }),
      receivable({ id: 'r-future', dueDate: dueDaysAgo(-5), outstandingAmount: 5 }),
      receivable({ id: 'r-null', dueDate: null, outstandingAmount: 7 }),
      receivable({ id: 'r-1-30', dueDate: dueDaysAgo(15), outstandingAmount: 20 }),
      receivable({ id: 'r-31-60', dueDate: dueDaysAgo(45), outstandingAmount: 30 }),
      receivable({ id: 'r-61-90', dueDate: dueDaysAgo(75), outstandingAmount: 40 }),
      receivable({ id: 'r-over90', dueDate: dueDaysAgo(120), outstandingAmount: 50 }),
    ]);

    const result = await service.getCustomerAgingDetail('co-1', 'cust-1', AS_OF, user);

    expect(result.current).toBe(22); // 10 (0 days) + 5 (future) + 7 (null due date)
    expect(result.days1_30).toBe(20);
    expect(result.days31_60).toBe(30);
    expect(result.days61_90).toBe(40);
    expect(result.over90).toBe(50);
    expect(result.total).toBe(162);
    // total must equal the sum of all disjoint buckets
    expect(result.total).toBe(
      result.current + result.days1_30 + result.days31_60 + result.days61_90 + result.over90,
    );
  });

  it('respects exact bucket boundaries (30/60/90 inclusive, 31/61/91 spill up)', async () => {
    const { service } = makeService([
      receivable({ id: 'a', dueDate: dueDaysAgo(30), outstandingAmount: 1 }), // <=30 -> days1_30
      receivable({ id: 'b', dueDate: dueDaysAgo(31), outstandingAmount: 2 }), // ->days31_60
      receivable({ id: 'c', dueDate: dueDaysAgo(60), outstandingAmount: 4 }), // <=60 -> days31_60
      receivable({ id: 'd', dueDate: dueDaysAgo(61), outstandingAmount: 8 }), // ->days61_90
      receivable({ id: 'e', dueDate: dueDaysAgo(90), outstandingAmount: 16 }), // <=90 -> days61_90
      receivable({ id: 'f', dueDate: dueDaysAgo(91), outstandingAmount: 32 }), // ->over90
    ]);

    const result = await service.getCustomerAgingDetail('co-1', 'cust-1', AS_OF, user);

    expect(result.days1_30).toBe(1);
    expect(result.days31_60).toBe(2 + 4);
    expect(result.days61_90).toBe(8 + 16);
    expect(result.over90).toBe(32);
  });

  it('returns ALL open receivables (no take cap) with per-row buckets and oldest age', async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      receivable({ id: `r-${i}`, dueDate: dueDaysAgo(i + 1), outstandingAmount: 1 }),
    );
    const { service } = makeService(rows);

    const result = await service.getCustomerAgingDetail('co-1', 'cust-1', AS_OF, user);

    expect(result.receivableCount).toBe(25);
    expect(result.receivables).toHaveLength(25);
    expect(result.oldestDaysOverdue).toBe(25);
    expect(result.receivables[0]).toEqual(
      expect.objectContaining({ bucket: 'days1_30', daysOverdue: 1 }),
    );
  });

  it('scopes by company, customer, and only open statuses', async () => {
    const { service, findMany, companyScope } = makeService([]);

    await service.getCustomerAgingDetail('co-1', 'cust-9', AS_OF, user);

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'co-1');
    expect(findMany).toHaveBeenCalledTimes(1);
    const where = findMany.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.objectContaining({
        companyId: 'co-1',
        customerId: 'cust-9',
        deletedAt: null,
        status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
      }),
    );
  });

  it('defaults asOf to now and returns empty buckets for a customer with no open AR', async () => {
    const { service } = makeService([]);

    const result = await service.getCustomerAgingDetail('co-1', 'cust-1');

    expect(result.total).toBe(0);
    expect(result.receivableCount).toBe(0);
    expect(result.customerName).toBeNull();
    expect(result.asOf).toBeInstanceOf(Date);
  });

  it('rejects an invalid asOf date instead of silently mis-bucketing', async () => {
    const { service, findMany } = makeService([]);

    await expect(service.getCustomerAgingDetail('co-1', 'cust-1', 'garbage', user)).rejects.toThrow(
      'Invalid asOf date',
    );
    // Fail-closed: no query runs once the date is rejected.
    expect(findMany).not.toHaveBeenCalled();
  });
});

/**
 * Cover for the company-summary <-> aging tie-out finding: getCompanySummary
 * must aggregate receivables/payables on the SAME open-status basis the aging
 * endpoints use, so the dashboard summary can never diverge from AR/AP aging by
 * silently counting PAID / WRITTEN_OFF / CANCELLED rows.
 */
const OPEN_STATUS_FILTER = { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] };

function makeSummaryService(opts: {
  receivableSum?: unknown;
  payableSum?: unknown;
} = {}) {
  const groupBy = jest.fn().mockResolvedValue([{ _sum: { debit: 500, credit: 500 } }]);
  const cashAggregate = jest.fn().mockResolvedValue({ _sum: { currentBalance: 250 } });
  const receivableAggregate = jest
    .fn()
    .mockResolvedValue({ _sum: { outstandingAmount: opts.receivableSum ?? 100 } });
  const payableAggregate = jest
    .fn()
    .mockResolvedValue({ _sum: { outstandingAmount: opts.payableSum ?? 80 } });
  const prisma = {
    journalEntryLine: { groupBy },
    cashAccount: { aggregate: cashAggregate },
    receivable: { aggregate: receivableAggregate },
    payable: { aggregate: payableAggregate },
  } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const service = new FinancialReportsService(prisma, companyScope);
  return { service, receivableAggregate, payableAggregate, companyScope };
}

describe('FinancialReportsService.getCompanySummary open-status tie-out', () => {
  it('aggregates receivables and payables on the open-status basis (matching aging)', async () => {
    const { service, receivableAggregate, payableAggregate } = makeSummaryService();

    await service.getCompanySummary('co-1', user);

    const receivableWhere = receivableAggregate.mock.calls[0][0].where;
    const payableWhere = payableAggregate.mock.calls[0][0].where;

    // Excludes PAID / WRITTEN_OFF / CANCELLED just like getReceivablesAging /
    // getPayablesAging so the two finance surfaces always tie out.
    expect(receivableWhere).toEqual({
      companyId: 'co-1',
      deletedAt: null,
      status: OPEN_STATUS_FILTER,
    });
    expect(payableWhere).toEqual({
      companyId: 'co-1',
      deletedAt: null,
      status: OPEN_STATUS_FILTER,
    });
  });

  it('uses the SAME open-status filter as getReceivablesAging / getPayablesAging', async () => {
    const { service, receivableAggregate, payableAggregate } = makeSummaryService();

    // Also drive the aging endpoints against the same mocks and assert the
    // status filter object is identical across summary and aging.
    await service.getCompanySummary('co-1', user);
    await service.getReceivablesAging('co-1', user);
    await service.getPayablesAging('co-1', user);

    const summaryRecStatus = receivableAggregate.mock.calls[0][0].where.status;
    const agingRecStatus = receivableAggregate.mock.calls[1][0].where.status;
    const summaryPayStatus = payableAggregate.mock.calls[0][0].where.status;
    const agingPayStatus = payableAggregate.mock.calls[1][0].where.status;

    expect(summaryRecStatus).toEqual(agingRecStatus);
    expect(summaryPayStatus).toEqual(agingPayStatus);
  });

  it('enforces company scope before returning the summary', async () => {
    const { service, companyScope } = makeSummaryService();

    await service.getCompanySummary('co-9', user);

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'co-9');
  });

  it('returns outstanding sums (open rows only) for receivables and payables', async () => {
    const { service } = makeSummaryService({ receivableSum: 320, payableSum: 210 });

    const result = await service.getCompanySummary('co-1', user);

    expect(result.totalReceivables).toBe(320);
    expect(result.totalPayables).toBe(210);
    expect(result.companyId).toBe('co-1');
  });
});

/**
 * Regression cover for the reversal double-count finding: reports must include
 * REVERSED originals so they net against their POSTED reversal mirror instead
 * of leaving only the (negative) reversal in the totals.
 */
function makeJournalService(lines: any[]) {
  const findMany = jest.fn().mockResolvedValue(lines);
  const prisma = {
    journalEntryLine: { findMany },
  } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const service = new FinancialReportsService(prisma, companyScope);
  return { service, prisma, companyScope, findMany };
}

// A journal entry line as returned by prisma with the account include used by
// getTrialBalance / getProfitAndLoss.
function jeLine(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    accountId: 'acc-rev',
    journalEntryId: 'je-orig',
    debit: 0,
    credit: 0,
    account: {
      id: 'acc-rev',
      accountCode: '4000',
      accountName: 'Revenue',
      accountType: 'INCOME',
    },
    ...overrides,
  };
}

describe('FinancialReportsService reversal netting', () => {
  it('getTrialBalance queries POSTED and REVERSED journal entries', async () => {
    const { service, findMany } = makeJournalService([]);

    await service.getTrialBalance('co-1', undefined, undefined, undefined, user);

    const where = findMany.mock.calls[0][0].where;
    expect(where.journalEntry.status).toEqual({ in: ['POSTED', 'REVERSED'] });
  });

  it('getProfitAndLoss queries POSTED and REVERSED journal entries', async () => {
    const { service, findMany } = makeJournalService([]);

    await service.getProfitAndLoss('co-1', undefined, undefined, user);

    const where = findMany.mock.calls[0][0].where;
    expect(where.journalEntry.status).toEqual({ in: ['POSTED', 'REVERSED'] });
  });

  it('nets a reversed original against its reversal mirror to zero in P&L income', async () => {
    // Original sale (CR Revenue 100) -> flipped to REVERSED but still returned.
    // Reversal (DR Revenue 100) -> POSTED. Correct net income contribution = 0.
    const { service } = makeJournalService([
      jeLine({ journalEntryId: 'je-orig', credit: 100, debit: 0 }),
      jeLine({ journalEntryId: 'je-reversal', credit: 0, debit: 100 }),
    ]);

    const result = await service.getProfitAndLoss('co-1', undefined, undefined, user);

    expect(result.income).toBe(0);
    expect(result.netIncome).toBe(0);
  });

  it('nets a reversed original against its reversal mirror to zero in the trial balance', async () => {
    const { service } = makeJournalService([
      jeLine({ journalEntryId: 'je-orig', credit: 100, debit: 0 }),
      jeLine({ journalEntryId: 'je-reversal', credit: 0, debit: 100 }),
    ]);

    const result = await service.getTrialBalance('co-1', undefined, undefined, undefined, user);

    const revenueRow = result.rows.find((r) => r.account.accountCode === '4000');
    expect(revenueRow?.debit).toBe(100);
    expect(revenueRow?.credit).toBe(100);
    expect(revenueRow?.balance).toBe(0);
  });
});
