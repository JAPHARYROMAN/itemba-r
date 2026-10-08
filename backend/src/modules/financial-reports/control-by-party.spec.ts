import { Prisma } from '@prisma/client';
import { FinancialReportsService } from './financial-reports.service';

/**
 * Party linkage, Phase 3 PR-2: the control account per party beside the open sub-ledger,
 * read-only, in the company base currency, with untagged control lines as their own row.
 */
const d = (v: string | number) => new Prisma.Decimal(v);
function setup(overrides: Record<string, unknown> = {}) {
  const prisma: any = {
    journalEntryLine: {
      groupBy: jest.fn(async () => [
        {
          partyType: 'SUPPLIER',
          supplierId: 'sup-1',
          customerId: null,
          _sum: { debit: d('300'), credit: d('1300') },
        },
        {
          partyType: 'SUPPLIER',
          supplierId: 'sup-2',
          customerId: null,
          _sum: { debit: d('0'), credit: d('250') },
        },
        {
          partyType: 'NONE',
          supplierId: null,
          customerId: null,
          _sum: { debit: d('10'), credit: d('60') },
        },
      ]),
    },
    supplier: {
      findMany: jest.fn(async () => [
        { id: 'sup-2', name: 'Quiet Supplier', supplierCode: 'SUP-002' },
      ]),
    },
    customer: { findMany: jest.fn(async () => []) },
    companyProfile: { findUnique: jest.fn(async () => ({ currency: 'TZS' })) },
    payable: { findMany: jest.fn(async () => []) },
    ...overrides,
  };
  const companyScope: any = { assertCanAccessCompany: jest.fn() };
  const partyBalance: any = {
    suppliers: jest.fn(async () => [
      {
        partyId: 'sup-1',
        name: 'Mwanjalisi Station',
        code: 'SUP-001',
        erp: [
          { currency: 'TZS', open: '1000.00', overdue: '0.00', documents: 3 },
          { currency: 'USD', open: '50.00', overdue: '0.00', documents: 1 },
        ],
      },
      {
        partyId: 'sup-3',
        name: 'Desk Only',
        code: 'SUP-003',
        erp: [{ currency: 'TZS', open: '80.00', overdue: '0.00', documents: 1 }],
      },
    ]),
    customers: jest.fn(async () => []),
  };
  const accountResolver: any = {
    resolve: jest.fn(async (_c: string, role: string) => ({
      id: role === 'AP_CONTROL' ? 'ap' : 'ar',
      accountCode: role === 'AP_CONTROL' ? '2000' : '1100',
      accountName: role === 'AP_CONTROL' ? 'Accounts Payable' : 'Accounts Receivable',
    })),
  };
  const service = new FinancialReportsService(prisma, companyScope, partyBalance, accountResolver);
  return { prisma, companyScope, partyBalance, accountResolver, service, user: { id: 'u' } as any };
}

describe('Control by party', () => {
  it.each(['AP', 'AR'] as const)(
    'nets reversed payment originals against their posted mirrors in %s control',
    async (role) => {
      const supplier = role === 'AP';
      const partyId = supplier ? 'sup-1' : 'cus-1';
      const party = supplier
        ? { partyType: 'SUPPLIER', supplierId: partyId, customerId: null }
        : { partyType: 'CUSTOMER', supplierId: null, customerId: partyId };
      const accountId = supplier ? 'ap' : 'ar';
      const entry = (
        status: string,
        amount: number,
        transactionDate: string,
        deletedAt: Date | null = null,
        companyId = 'c1',
      ) => ({
        companyId,
        accountId,
        debit: d(supplier ? Math.max(0, -amount) : Math.max(0, amount)),
        credit: d(supplier ? Math.max(0, amount) : Math.max(0, -amount)),
        journalEntry: { status, deletedAt, transactionDate: new Date(transactionDate) },
      });
      const entries = [
        entry('POSTED', 100, '2026-01-01'),
        entry('REVERSED', -40, '2026-01-02'), // Original cash payment retains its original date.
        entry('POSTED', 40, '2026-02-02'), // Mirror restores the open liability/receivable.
        entry('DRAFT', 500, '2026-01-03'),
        entry('VOIDED', 500, '2026-01-03'),
        entry('POSTED', 700, '2026-01-03', new Date('2026-01-04')),
        entry('POSTED', 800, '2026-01-03', null, 'other-company'),
        entry('POSTED', 900, '2026-03-01'),
      ];
      const groupBy = jest.fn(async ({ where }: any) => {
        const filter = where.journalEntry;
        const statuses = typeof filter.status === 'string' ? [filter.status] : filter.status.in;
        const selected = entries.filter(
          (line) =>
            line.companyId === where.companyId &&
            line.accountId === where.accountId &&
            statuses.includes(line.journalEntry.status) &&
            (filter.deletedAt === undefined || line.journalEntry.deletedAt === filter.deletedAt) &&
            line.journalEntry.transactionDate <= filter.transactionDate.lte,
        );
        return [
          {
            ...party,
            _sum: {
              debit: selected.reduce((sum, line) => sum.plus(line.debit), d(0)),
              credit: selected.reduce((sum, line) => sum.plus(line.credit), d(0)),
            },
          },
        ];
      });
      const { service, user, partyBalance, companyScope } = setup({
        journalEntryLine: { groupBy },
      });
      (supplier ? partyBalance.suppliers : partyBalance.customers).mockResolvedValue([
        {
          partyId,
          name: 'Trading party',
          code: 'PARTY-1',
          erp: [{ currency: 'TZS', open: '100.00', overdue: '0.00', documents: 1 }],
        },
      ]);

      const report = await service.getControlByParty('c1', role, '2026-02-28', user);
      expect(report.totals).toEqual({ control: '100.00', subLedger: '100.00', difference: '0.00' });
      expect(report.partiesWithDifference).toBe(0);
      expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'c1');

      // Before the later reversal, the original payment still reduced that dated GL balance.
      const earlier = await service.getControlByParty('c1', role, '2026-01-31', user);
      expect(earlier.totals.control).toBe('60.00');
    },
  );
  it('nets the AP control as credit minus debit per supplier, merges the sub-ledger and names control-only parties', async () => {
    const { service, user, prisma, companyScope } = setup();
    const report = await service.getControlByParty('c1', 'AP', '2026-10-03', user);
    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'c1');
    const { where } = prisma.journalEntryLine.groupBy.mock.calls[0][0];
    expect(where).toMatchObject({ companyId: 'c1', accountId: 'ap' });
    expect(where.journalEntry).toMatchObject({
      status: { in: ['POSTED', 'REVERSED'] },
      deletedAt: null,
    });
    expect(report.controlAccount).toEqual({
      id: 'ap',
      accountCode: '2000',
      accountName: 'Accounts Payable',
    });
    expect(report.baseCurrency).toBe('TZS');
    expect(report.rows).toEqual([
      {
        partyId: 'sup-2',
        name: 'Quiet Supplier',
        code: 'SUP-002',
        control: '250.00',
        subLedger: '0.00',
        difference: '250.00',
        documents: 0,
      },
      {
        partyId: 'sup-3',
        name: 'Desk Only',
        code: 'SUP-003',
        control: '0.00',
        subLedger: '80.00',
        difference: '-80.00',
        documents: 1,
      },
      {
        partyId: 'sup-1',
        name: 'Mwanjalisi Station',
        code: 'SUP-001',
        control: '1000.00',
        subLedger: '1000.00',
        difference: '0.00',
        documents: 3,
      },
    ]);
    expect(report.untaggedControl).toBe('50.00');
    expect(report.totals).toEqual({
      control: '1300.00',
      subLedger: '1080.00',
      difference: '220.00',
    });
    expect(report.partiesWithDifference).toBe(2);
    expect(prisma.supplier.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['sup-2'] } });
  });

  it('reads the AR control as debit minus credit and reports no control account without failing', async () => {
    const { service, user, prisma, partyBalance, accountResolver } = setup({
      journalEntryLine: {
        groupBy: jest.fn(async () => [
          {
            partyType: 'CUSTOMER',
            supplierId: null,
            customerId: 'cus-1',
            _sum: { debit: d('400'), credit: d('100') },
          },
        ]),
      },
    });
    partyBalance.customers.mockResolvedValue([
      {
        partyId: 'cus-1',
        name: 'Westsides',
        code: 'CUS-001',
        erp: [{ currency: 'TZS', open: '300.00', overdue: '0.00', documents: 2 }],
      },
    ]);
    const ar = await service.getControlByParty('c1', 'AR', undefined, user);
    expect(ar.rows[0]).toMatchObject({
      partyId: 'cus-1',
      control: '300.00',
      subLedger: '300.00',
      difference: '0.00',
    });
    expect(ar.partiesWithDifference).toBe(0);
    accountResolver.resolve.mockRejectedValue(new Error('no account'));
    const none = await service.getControlByParty('c1', 'AR', undefined, user);
    expect(none.controlAccount).toBeNull();
    expect(prisma.journalEntryLine.groupBy).toHaveBeenCalledTimes(1);
    expect(none.rows[0]).toMatchObject({ control: '0.00', subLedger: '300.00' });
  });

  it('buckets a supplier aging detail by due date like the customer one', async () => {
    const asOf = new Date('2026-10-03T12:00:00.000Z');
    const daysAgo = (n: number) => new Date(asOf.getTime() - n * 86400000);
    const { service, user } = setup({
      payable: {
        findMany: jest.fn(async () => [
          {
            id: 'p1',
            payableNumber: 'PAY-1',
            supplierId: 'sup-1',
            supplierName: 'Mwanjalisi',
            amount: d('100'),
            paidAmount: d('0'),
            outstandingAmount: d('100'),
            currency: 'TZS',
            issueDate: daysAgo(40),
            dueDate: daysAgo(-5),
            status: 'OPEN',
            journalEntryId: 'je',
          },
          {
            id: 'p2',
            payableNumber: 'PAY-2',
            supplierId: 'sup-1',
            supplierName: 'Mwanjalisi',
            amount: d('200'),
            paidAmount: d('50'),
            outstandingAmount: d('150'),
            currency: 'TZS',
            issueDate: daysAgo(70),
            dueDate: daysAgo(45),
            status: 'PARTIALLY_PAID',
            journalEntryId: null,
          },
        ]),
      },
    });
    const detail = await service.getSupplierAgingDetail('c1', 'sup-1', asOf.toISOString(), user);
    expect(detail).toMatchObject({
      supplierName: 'Mwanjalisi',
      current: 100,
      days31_60: 150,
      total: 250,
      oldestDaysOverdue: 45,
      payableCount: 2,
    });
    expect(detail.payables[1]).toMatchObject({
      payableNumber: 'PAY-2',
      bucket: 'days31_60',
      daysOverdue: 45,
    });
  });
});
