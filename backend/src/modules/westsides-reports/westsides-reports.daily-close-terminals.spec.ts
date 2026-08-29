import { businessDayWindow } from '../../common/utils/business-day';
import { WestsidesReportsService } from './westsides-reports.service';

/**
 * Per-till attribution inside the Daily Close / Z-Report.
 *
 * The invariants frozen here are the ones the POS reform's custody chain
 * depends on:
 *  - the till rows (terminals + the COUNTER remainder) always sum EXACTLY to
 *    the branch-day totals, because they reuse the Z-report's own day window;
 *  - a MobilePosDayReport is CUMULATIVE PER REP-DAY, so the terminal-day
 *    truth is the SUM of the latest report per rep: a same-rep re-close is
 *    superseded, a cross-rep shift handover is summed so the first shift's
 *    sales and declared held cash never vanish; `reportCount` discloses how
 *    many reports were filed and `repCount` how many cashiers were summed;
 *  - the reported-vs-expected comparison uses `businessDayExpectedTotal`,
 *    aggregated over the SAME business-day window the day report covers
 *    (00:00-24:00 in the pinned business zone) — never the Z-report's own
 *    process-local window, which can sit three hours away on a UTC host;
 *  - the day report's declared held figures are surfaced BESIDE the expected
 *    figures ("sent plus held is the drawer"), never folded into them;
 *  - the non-terminal remainder (counter / quick sale) is its own row, always
 *    last, so no confirmed sale can vanish from the attribution.
 */
describe('WestsidesReportsService.dailyClose per-terminal attribution', () => {
  const closeDateKey = new Date(Date.UTC(2031, 0, 15));

  const totalsAggregate = {
    _sum: {
      totalAmount: 3200,
      paidAmount: 3200,
      outstandingAmount: 0,
      taxAmount: 0,
      discountAmount: 0,
    },
    _count: { id: 93 },
  };
  const yesterdayAggregate = { _sum: { totalAmount: 0 }, _count: { id: 0 } };

  const branchMethodGroups = [
    {
      paymentMethod: 'CASH',
      cashAccountId: 'acc-cash',
      _sum: { totalAmount: 3200, paidAmount: 3200 },
      _count: { id: 93 },
    },
  ];

  const terminalMethodGroups = [
    {
      mobilePosTerminalId: 't1',
      paymentMethod: 'CASH',
      cashAccountId: 'acc-cash',
      _sum: { totalAmount: 1180, paidAmount: 1180 },
      _count: { id: 41 },
    },
    {
      mobilePosTerminalId: 't2',
      paymentMethod: 'CASH',
      cashAccountId: 'acc-cash',
      _sum: { totalAmount: 910, paidAmount: 910 },
      _count: { id: 33 },
    },
    // The counter remainder is LARGER than t2 on purpose: the COUNTER row must
    // still sort last, because it is a remainder, not a till.
    {
      mobilePosTerminalId: null,
      paymentMethod: 'CASH',
      cashAccountId: 'acc-cash',
      _sum: { totalAmount: 1110, paidAmount: 1110 },
      _count: { id: 19 },
    },
  ];

  // The SAME terminals aggregated over the BUSINESS-day window the day
  // reports cover. Deliberately different from the process-local figures
  // above (a UTC host cuts the day three hours into the EAT trading day), and
  // t3 — the Usiku night till — traded ONLY inside the business window, so it
  // has no process-local group at all.
  const businessDayTerminalGroups = [
    { mobilePosTerminalId: 't1', _sum: { totalAmount: 1250 }, _count: { id: 43 } },
    { mobilePosTerminalId: 't2', _sum: { totalAmount: 910 }, _count: { id: 33 } },
    { mobilePosTerminalId: 't3', _sum: { totalAmount: 400 }, _count: { id: 12 } },
    { mobilePosTerminalId: null, _sum: { totalAmount: 1110 }, _count: { id: 19 } },
  ];

  const terminals = [
    {
      id: 't1',
      terminalCode: 'KAU-01',
      name: 'Kaunta 1',
      assignedUser: { id: 'u-amina', fullName: 'Amina' },
      paymentMethods: [{ paymentMethod: 'CASH', label: 'Till 01' }],
    },
    {
      id: 't2',
      terminalCode: 'KAU-02',
      name: 'Kaunta 2',
      assignedUser: { id: 'u-juma', fullName: 'Juma' },
      paymentMethods: [{ paymentMethod: 'CASH', label: null }],
    },
    {
      id: 't3',
      terminalCode: 'KAU-03',
      name: 'Usiku',
      assignedUser: null,
      paymentMethods: [],
    },
  ];

  // Newest first, as the service orders the query. Terminal t1 saw a shift
  // handover: Zena closed her morning at 13:00, Amina closed the evening at
  // 18:30 after a premature close at 17:00 that her own 18:30 report
  // supersedes (reports are cumulative per rep-day). The terminal-day truth
  // is Amina's latest PLUS Zena's latest — never just the newest report.
  const dayReports = [
    {
      terminalId: 't1',
      repUserId: 'u-amina',
      repName: 'Amina',
      submittedAt: new Date('2031-01-15T18:30:00.000Z'),
      salesCount: 21,
      grossTotal: 750,
      byMethod: [{ paymentMethod: 'CASH', label: 'Till 01', count: 21, amount: 750 }],
      declaredHeldCount: 2,
      declaredHeldAmount: 60,
    },
    {
      terminalId: 't1',
      repUserId: 'u-amina',
      repName: 'Amina',
      submittedAt: new Date('2031-01-15T17:00:00.000Z'),
      salesCount: 18,
      grossTotal: 600,
      byMethod: [{ paymentMethod: 'CASH', label: 'Till 01', count: 18, amount: 600 }],
      declaredHeldCount: 9,
      declaredHeldAmount: 999,
    },
    {
      terminalId: 't1',
      repUserId: 'u-zena',
      repName: 'Zena',
      submittedAt: new Date('2031-01-15T13:00:00.000Z'),
      salesCount: 20,
      grossTotal: 500,
      byMethod: [{ paymentMethod: 'CASH', label: null, count: 20, amount: 500 }],
      declaredHeldCount: 1,
      declaredHeldAmount: 40,
    },
    {
      terminalId: 't3',
      repUserId: 'u-rehema',
      repName: 'Rehema',
      submittedAt: new Date('2031-01-15T03:05:00.000Z'),
      salesCount: 12,
      grossTotal: 400,
      byMethod: [{ paymentMethod: 'CASH', label: null, count: 12, amount: 400 }],
      declaredHeldCount: 1,
      declaredHeldAmount: 25,
    },
  ];

  function buildService() {
    const prisma = {
      salesOrder: {
        aggregate: jest
          .fn()
          .mockResolvedValueOnce(totalsAggregate)
          .mockResolvedValueOnce(yesterdayAggregate),
        groupBy: jest.fn().mockImplementation(({ by }: { by: string[] }) => {
          if (by.includes('mobilePosTerminalId') && by.includes('paymentMethod')) {
            return Promise.resolve(terminalMethodGroups);
          }
          if (by.includes('mobilePosTerminalId')) {
            return Promise.resolve(businessDayTerminalGroups);
          }
          if (by.includes('cashAccountId')) return Promise.resolve(branchMethodGroups);
          return Promise.resolve([]);
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      salesOrderLine: { groupBy: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      cashAccount: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'acc-cash', accountName: 'Kariakoo Cash', accountType: 'CASH_ON_HAND' },
          ]),
      },
      employee: { findMany: jest.fn().mockResolvedValue([]) },
      mobilePosTerminal: { findMany: jest.fn().mockResolvedValue(terminals) },
      mobilePosDayReport: { findMany: jest.fn().mockResolvedValue(dayReports) },
      westsidesDailyClose: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any;
    const companyScope = { assertCanAccessCompany: jest.fn() } as any;
    const auditLogs = { log: jest.fn() } as any;
    return { prisma, service: new WestsidesReportsService(prisma, companyScope, auditLogs) };
  }

  const user = { id: 'user-1' } as any;
  const query = { companyId: 'company-1', branchId: 'branch-1', date: '2031-01-15' };

  it('attributes the day per till, with the counter remainder last, summing exactly to the branch totals', async () => {
    const { service } = buildService();
    const result: any = await service.dailyClose(query, user);

    expect(result.byTerminal).toHaveLength(4);
    // Terminals by expected size first, counter remainder ALWAYS last — even
    // though the counter (1110) out-sold t2 (910). The business-day-only
    // night till (t3) rides at 0 expected, still ahead of the remainder.
    expect(result.byTerminal.map((row: any) => row.terminalId)).toEqual(['t1', 't2', 't3', null]);
    expect(result.byTerminal[3].kind).toBe('COUNTER');
    expect(result.byTerminal[3].terminalName).toBe('Counter / quick sale');
    expect(result.byTerminal[3].dayReport).toBeNull();
    expect(result.byTerminal[3].cashier).toEqual({ userId: null, name: null, source: null });

    // The attribution invariant: every confirmed sale of the day is in exactly
    // one row, so the rows sum to the branch-day totals — the business-day
    // figures are carried BESIDE the rows and never disturb this sum.
    const attributedTotal = result.byTerminal.reduce(
      (sum: number, row: any) => sum + row.expectedTotal,
      0,
    );
    const attributedCount = result.byTerminal.reduce(
      (sum: number, row: any) => sum + row.salesCount,
      0,
    );
    expect(attributedTotal).toBe(result.totals.totalSales);
    expect(attributedCount).toBe(result.totals.salesCount);

    // The branch-level rows are untouched (the addition is purely additive).
    expect(result.byMethod).toHaveLength(1);
    expect(result.byMethod[0].expected).toBe(3200);
  });

  it('labels the till, resolves the cash account, and keeps the terminal method label', async () => {
    const { service } = buildService();
    const result: any = await service.dailyClose(query, user);

    const t1 = result.byTerminal[0];
    expect(t1.terminalCode).toBe('KAU-01');
    expect(t1.terminalName).toBe('Kaunta 1');
    expect(t1.tillLabel).toBe('Till 01');
    expect(t1.expectedByMethod).toEqual([
      {
        paymentMethod: 'CASH',
        cashAccountId: 'acc-cash',
        cashAccountName: 'Kariakoo Cash',
        cashAccountType: 'CASH_ON_HAND',
        methodLabel: 'Till 01',
        count: 41,
        expected: 1180,
        paid: 1180,
      },
    ]);
  });

  it('sums the latest day report PER REP by business-date label, so a handover never drops the first shift', async () => {
    const { prisma, service } = buildService();
    const result: any = await service.dailyClose(query, user);

    // Joined by the business-day LABEL, newest first.
    expect(prisma.mobilePosDayReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'company-1',
          businessDate: closeDateKey,
          terminalId: { in: expect.arrayContaining(['t1', 't2', 't3']) },
        }),
        orderBy: { submittedAt: 'desc' },
      }),
    );

    const t1 = result.byTerminal[0];
    // Amina's 18:30 close supersedes her own 17:00 one (cumulative per
    // rep-day); Zena's 13:00 morning close is SUMMED, not discarded — so the
    // gross, the declared held custody cash, and the method breakdown all
    // cover the whole terminal-day. Three filed reports, two cashiers summed.
    expect(t1.dayReport).toMatchObject({
      repUserId: 'u-amina',
      repName: 'Amina + Zena',
      salesCount: 41,
      grossTotal: 1250,
      declaredHeldCount: 3,
      declaredHeldAmount: 100,
      reportCount: 3,
      repCount: 2,
    });
    expect(t1.dayReport.submittedAt).toBe('2031-01-15T18:30:00.000Z');
    expect(t1.dayReport.byMethod).toEqual([
      { paymentMethod: 'CASH', label: 'Till 01', count: 41, amount: 1250 },
    ]);
    // Declared held is the terminal's own custody figure — beside expected,
    // never folded into it; the cashier attribution stays the newest closer.
    expect(t1.expectedTotal).toBe(1180);
    expect(t1.cashier).toEqual({ userId: 'u-amina', name: 'Amina', source: 'DAY_REPORT' });
  });

  it('compares the day report against expected receipts over the SAME business-day window', async () => {
    const { prisma, service } = buildService();
    const result: any = await service.dailyClose(query, user);

    // The comparison aggregate runs over the business-day window — the
    // window computeDayReport itself uses — not the Z-report's process-local
    // one. Asserted from the zone by NAME, never a hard-coded +3.
    const window = businessDayWindow('2031-01-15');
    const businessDayCall = (prisma.salesOrder.groupBy as jest.Mock).mock.calls.find(
      ([args]: [{ by: string[] }]) =>
        args.by.includes('mobilePosTerminalId') && !args.by.includes('paymentMethod'),
    );
    expect(businessDayCall).toBeDefined();
    expect(businessDayCall![0].where.orderDate).toEqual({
      gte: window.dayStart,
      lt: window.dayEnd,
    });

    const t1 = result.byTerminal[0];
    // The delta's two sides now share a window: 1250 reported vs 1250
    // business-day expected — while the roll-up figure keeps the Z-report
    // window (1180) so the rows still sum to the branch totals.
    expect(t1.expectedTotal).toBe(1180);
    expect(t1.businessDayExpectedTotal).toBe(1250);
    expect(t1.businessDaySalesCount).toBe(43);
    expect(t1.dayReport.grossTotal).toBe(t1.businessDayExpectedTotal);

    // The Usiku night till traded only inside the business window (its sales
    // fall before the process-local boundary): it still gets a row, its
    // roll-up figures are an honest zero, and its close reconciles cleanly
    // against the business-day figure instead of showing a phantom shortfall.
    const t3 = result.byTerminal[2];
    expect(t3.terminalId).toBe('t3');
    expect(t3.kind).toBe('TERMINAL');
    expect(t3.expectedTotal).toBe(0);
    expect(t3.salesCount).toBe(0);
    expect(t3.expectedByMethod).toEqual([]);
    expect(t3.businessDayExpectedTotal).toBe(400);
    expect(t3.dayReport).toMatchObject({ repName: 'Rehema', grossTotal: 400, repCount: 1 });
  });

  it('falls back to the terminal-assigned user as the business-day owner when no day report exists', async () => {
    const { service } = buildService();
    const result: any = await service.dailyClose(query, user);

    const t2 = result.byTerminal[1];
    expect(t2.terminalId).toBe('t2');
    expect(t2.dayReport).toBeNull();
    expect(t2.tillLabel).toBeNull();
    expect(t2.businessDayExpectedTotal).toBe(910);
    expect(t2.cashier).toEqual({ userId: 'u-juma', name: 'Juma', source: 'TERMINAL_ASSIGNED' });
  });
});
