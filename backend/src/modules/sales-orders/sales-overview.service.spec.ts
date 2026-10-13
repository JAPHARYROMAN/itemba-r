import { Prisma } from '@prisma/client';
import { SalesOverviewService, overviewPeriod } from './sales-overview.service';

const D = (value: number | string) => new Prisma.Decimal(value);
const date = (value: string) => new Date(`${value}T00:00:00Z`);
const journalLines = (cash: number, ar: number, cogs = 0) => [
  {
    debit: D(cash),
    credit: D(0),
    account: { accountCode: '1000', accountSubType: 'cash_on_hand', mappedCashAccount: null },
  },
  {
    debit: D(Math.max(ar, 0)),
    credit: D(Math.max(-ar, 0)),
    account: { accountCode: '1100', accountSubType: 'ar_control', mappedCashAccount: null },
  },
  {
    debit: D(cogs),
    credit: D(0),
    account: { accountCode: '5000', accountSubType: 'cost_of_goods_sold', mappedCashAccount: null },
  },
];
const user = {
  id: 'u',
  permissions: [
    'sales.view',
    'customers.view',
    'receivables.view',
    'cash_desk.view',
    'customer-payments.view',
  ],
} as any;
const query = {
  companyId: 'company',
  branchId: 'branch',
  dateFrom: '2026-10-01',
  dateTo: '2026-10-09',
};
function fixture() {
  const sale = (
    id: string,
    amount: number,
    orderDate: string,
    status = 'CONFIRMED',
    credit = false,
  ) => ({
    id,
    salesOrderNumber: id,
    companyId: 'company',
    customerId: credit ? 'customer' : null,
    customerName: credit ? 'Acacia' : 'Walk-in',
    customer: null,
    orderDate: date(orderDate),
    createdAt: date(orderDate),
    dueDate: null,
    status,
    paymentStatus: credit ? 'UNPAID' : 'PAID',
    paymentMethod: credit ? 'CREDIT' : 'CASH',
    currency: 'TZS',
    totalAmount: D(amount),
    paidAmount: D(credit ? 0 : amount),
    outstandingAmount: D(credit ? amount : 0),
    receivableId: credit ? `r-${id}` : null,
    journalEntryId: credit ? null : `j-${id}`,
    branchId: 'branch',
    branch: { name: 'Main' },
    salespersonId: null,
    salesperson: null,
  });
  const sales = [
    sale('cash', 100, '2026-10-07'),
    sale('credit', 300, '2026-10-08', 'CONFIRMED', true),
    sale('old', 200, '2026-09-29', 'CONFIRMED', true),
    sale('draft', 999, '2026-10-05', 'DRAFT'),
    sale('cancelled', 777, '2026-10-05', 'CANCELLED'),
    sale('voided', 888, '2026-10-05', 'VOIDED'),
  ];
  const receivables = [
    {
      id: 'r-credit',
      companyId: 'company',
      sourceId: 'credit',
      journalEntryId: 'accrual-credit',
      paidAmount: D(0),
      outstandingAmount: D(300),
      dueDate: date('2026-10-06'),
      status: 'OPEN',
    },
    {
      id: 'r-old',
      companyId: 'company',
      sourceId: 'old',
      journalEntryId: 'accrual-old',
      paidAmount: D(70),
      outstandingAmount: D(130),
      dueDate: date('2026-10-09'),
      status: 'PARTIALLY_PAID',
    },
  ];
  const db = {
    $transaction: jest.fn(async (work: any): Promise<any> => work(db)),
    salesOrder: { findMany: jest.fn().mockResolvedValue(sales) },
    salesOrderLine: {
      findMany: jest.fn().mockResolvedValue([
        {
          productId: 'p',
          product: { name: 'Rice' },
          unitId: 'kg',
          unit: { name: 'kg' },
          quantity: D('1.5'),
          lineTotal: D('99.95'),
        },
        {
          productId: 'p',
          product: { name: 'Rice' },
          unitId: 'bag',
          unit: { name: 'bags' },
          quantity: D(2),
          lineTotal: D(300),
        },
      ]),
    },
    receivable: { findMany: jest.fn().mockResolvedValue(receivables) },
    customer: { count: jest.fn().mockResolvedValue(1) },
    journalEntry: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'j-cash',
          journalNumber: 'JE-CASH',
          transactionDate: date('2026-10-07'),
          referenceType: 'SalesOrder',
          referenceId: 'cash',
          totalDebit: D(165),
          description: 'Sales order cash',
          lines: journalLines(100, 0, 65),
        },
        {
          id: 'settlement',
          journalNumber: 'JE-SETTLEMENT',
          transactionDate: date('2026-10-07'),
          referenceType: 'Receivable',
          referenceId: 'r-old',
          totalDebit: D(20),
          description: 'Receivable settlement r-old',
          lines: journalLines(20, -20),
        },
      ]),
    },
    customerPayment: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'pay',
          journalEntryId: 'pay-journal',
          paymentNumber: 'PAY1',
          paymentDate: date('2026-10-07'),
          createdAt: date('2026-10-07'),
          amount: D(25),
          divisionId: null,
          branchId: 'branch',
          _count: { allocations: 2 },
          method: 'CHEQUE',
          unappliedAmount: D(15),
          allocations: [
            { receivableId: 'r-old', amount: D(10), createdAt: date('2026-10-07') },
            { receivableId: 'unrelated', amount: D(1000), createdAt: date('2026-10-07') },
          ],
        },
      ]),
    },
  };
  const companies = { companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company' }) };
  const organization = {
    recordWhereFor: jest.fn().mockResolvedValue({ branchId: { in: ['branch'] } }),
    accessibleIds: jest
      .fn()
      .mockResolvedValue({ unrestricted: false, divisionIds: [], branchIds: ['branch'] }),
  };
  return {
    db,
    sales,
    receivables,
    companies,
    organization,
    service: new SalesOverviewService(db as any, companies as any, organization as any),
  };
}
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-09T10:00:00Z'));
});
afterEach(() => jest.useRealTimers());
describe('Sales Overview', () => {
  it('excludes drafts, cancellations and voids; compares equal periods; keeps current debts from older sales', async () => {
    const { service, db } = fixture();
    const result = await service.read(user, query);
    expect(result.metrics).toMatchObject({
      salesValue: '400.00',
      salesCount: 2,
      averageSale: '200.00',
      previousSalesValue: '200.00',
      previousSalesCount: 1,
      outstanding: '430.00',
      overdue: '300.00',
      purchasingCustomers: 1,
      newCustomers: 1,
    });
    expect(result.attention).toMatchObject({ drafts: 1, overdue: 1, dueSoon: 1 });
    expect(result.attention.dueSoonSales).toEqual([
      expect.objectContaining({ id: 'old', outstanding: '130.00', dueDate: '2026-10-09' }),
    ]);
    expect(result.period).toMatchObject({ previousFrom: '2026-09-22', previousTo: '2026-09-30' });
    expect(result.aging.map((bucket) => bucket.amount)).toEqual([
      '130.00',
      '300.00',
      '0.00',
      '0.00',
      '0.00',
    ]);
    expect(db.customer.count.mock.calls[0][0].where.createdAt).toEqual({
      gte: new Date('2026-09-30T21:00:00.000Z'),
      lte: new Date('2026-10-09T20:59:59.999Z'),
    });
  });
  it('counts cash and later allocations once, excludes COGS and unrelated allocations, and uses receipt dates', async () => {
    const { service, db } = fixture();
    const result = await service.read(user, query);
    expect(result.metrics.collected).toBe('130.00');
    expect(result.trend.find((point) => point.date === '2026-10-07')).toMatchObject({
      sales: '100.00',
      collected: '130.00',
    });
    expect(result.recentReceipts).toHaveLength(3);
    expect(result.attention.unappliedPayments).toBe(1);
    expect(db.journalEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          reversalOfId: null,
          reversedBy_: { none: { status: 'POSTED', deletedAt: null } },
          id: { notIn: ['pay-journal'] },
        }),
      }),
    );
    expect(db.customerPayment.findMany.mock.calls[0][0].where).toMatchObject({
      status: 'COMPLETED',
      currency: 'TZS',
    });
  });
  it('intersects organization grants with requested scope on every source, and never combines currencies', async () => {
    const { service, db, companies, organization } = fixture();
    await service.read(user, { ...query, currency: 'USD' as any });
    expect(companies.companyWhereFor).toHaveBeenCalledWith(user, 'company');
    expect(organization.recordWhereFor).toHaveBeenCalledWith(user);
    for (const delegate of [db.salesOrder, db.receivable, db.journalEntry, db.customer]) {
      expect(
        ('findMany' in delegate ? delegate.findMany : delegate.count).mock.calls[0][0].where,
      ).toMatchObject({
        AND: [{ companyId: 'company' }, { branchId: { in: ['branch'] } }, { branchId: 'branch' }],
        deletedAt: null,
      });
    }
    expect(db.salesOrder.findMany.mock.calls[0][0].where.currency).toBe('USD');
    expect(db.salesOrderLine.findMany.mock.calls[0][0].where.salesOrder.is.currency).toBe('USD');
    expect(db.customerPayment.findMany.mock.calls[0][0].where).toMatchObject({
      currency: 'USD',
      AND: [
        { companyId: 'company' },
        {
          OR: [
            { AND: [{ branchId: { in: ['branch'] } }, { branchId: 'branch' }] },
            { allocations: { some: { receivableId: { in: ['r-credit', 'r-old'] } } } },
          ],
        },
        expect.any(Object),
      ],
    });
    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'RepeatableRead' }),
    );
  });
  it('preserves unit distinctions and exact fractional quantities in product rankings', async () => {
    const { service } = fixture();
    expect((await service.read(user, query)).topProducts).toEqual([
      { id: 'p:bag', name: 'Rice', unit: 'bags', quantity: '2', amount: '300.00' },
      { id: 'p:kg', name: 'Rice', unit: 'kg', quantity: '1.5', amount: '99.95' },
    ]);
  });
  it('uses proved cash legs for mixed credit tenders rather than cumulative paid fields or COGS', async () => {
    const { service, db, sales } = fixture();
    sales[0].paidAmount = D(900);
    sales[1].journalEntryId = 'mixed-credit';
    sales[1].paidAmount = D(200);
    db.journalEntry.findMany.mockResolvedValue([
      {
        id: 'j-cash',
        journalNumber: 'JE-CASH',
        transactionDate: date('2026-10-07'),
        referenceType: 'SalesOrder',
        referenceId: 'cash',
        description: 'Sale',
        lines: journalLines(100, 0, 65),
      },
      {
        id: 'mixed-credit',
        journalNumber: 'JE-MIXED',
        transactionDate: date('2026-10-08'),
        referenceType: 'SalesOrder',
        referenceId: 'credit',
        description: 'Sale',
        lines: journalLines(50, 250, 70),
      },
    ] as any);
    db.customerPayment.findMany.mockResolvedValue([]);
    expect((await service.read(user, query)).metrics.collected).toBe('150.00');
  });
  it('includes mapped cash accounts with custom codes and excludes write-offs or unverified settlements', async () => {
    const { service, db } = fixture();
    const customLines = journalLines(20, -20);
    customLines[0].account = {
      accountCode: '1001',
      accountSubType: null,
      mappedCashAccount: { currency: 'TZS' },
    } as any;
    db.journalEntry.findMany.mockResolvedValue([
      {
        id: 'mapped',
        journalNumber: 'JE-MAPPED',
        transactionDate: date('2026-10-07'),
        referenceType: 'Receivable',
        referenceId: 'r-old',
        description: 'Receivable settlement r-old',
        lines: customLines,
      },
      {
        id: 'writeoff',
        journalNumber: 'JE-WRITEOFF',
        transactionDate: date('2026-10-07'),
        referenceType: 'Receivable',
        referenceId: 'r-old',
        description: 'Receivable write-off r-old',
        lines: journalLines(0, -20, 20),
      },
      {
        id: 'invalid',
        journalNumber: 'JE-INVALID',
        transactionDate: date('2026-10-07'),
        referenceType: 'Receivable',
        referenceId: 'r-old',
        description: 'Receivable settlement r-old',
        lines: journalLines(20, -30),
      },
    ] as any);
    db.customerPayment.findMany.mockResolvedValue([]);
    const result = await service.read(user, query);
    expect(result.metrics.collected).toBe('20.00');
    expect(result.recentReceipts.map((row) => row.id)).toEqual(['mapped']);
    expect(result.warnings).toHaveLength(1);
  });
  it('dates a later allocation when applied and masks a receipt header outside the permitted branch', async () => {
    const { service, db } = fixture();
    db.journalEntry.findMany.mockResolvedValue([]);
    db.customerPayment.findMany.mockResolvedValue([
      {
        id: 'private-receipt',
        journalEntryId: 'private-journal',
        paymentNumber: 'PRIVATE-REFERENCE',
        paymentDate: date('2026-09-01'),
        createdAt: date('2026-09-01'),
        amount: D(110),
        divisionId: null,
        branchId: 'foreign-branch',
        method: 'BANK_TRANSFER',
        unappliedAmount: D(10),
        _count: { allocations: 2 },
        allocations: [
          { receivableId: 'r-old', amount: D(30), createdAt: date('2026-10-07') },
          { receivableId: 'foreign', amount: D(70), createdAt: date('2026-10-07') },
        ],
      },
    ]);
    const result = await service.read(user, query);
    expect(result.metrics.collected).toBe('30.00');
    expect(result.metrics.previousCollected).toBe('0.00');
    expect(result.receiptBasis).toBe('scoped-settlements');
    expect(result.attention.unappliedPayments).toBe(0);
    expect(result.recentReceipts).toEqual([
      expect.objectContaining({
        date: '2026-10-07',
        reference: 'Invoice payment allocation',
        method: 'OTHER',
        amount: '30.00',
        saleId: 'old',
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE-REFERENCE');
    expect(JSON.stringify(result)).not.toContain('private-receipt');
  });
  it('does not count future allocations in a past period', async () => {
    const { service, db } = fixture();
    db.journalEntry.findMany.mockResolvedValue([]);
    const payment = (db.customerPayment.findMany as jest.Mock).getMockImplementation()!();
    const rows = await payment;
    rows[0].allocations[0].createdAt = date('2026-10-10');
    db.customerPayment.findMany.mockResolvedValue(rows);
    expect((await service.read(user, query)).metrics.collected).toBe('0.00');
  });
  it('uses East Africa business days for later allocation timestamps at the UTC boundary', async () => {
    const { service, db } = fixture();
    db.journalEntry.findMany.mockResolvedValue([]);
    const rows = await (db.customerPayment.findMany as jest.Mock).getMockImplementation()!();
    rows[0].paymentDate = date('2026-09-01');
    rows[0].createdAt = date('2026-09-01');
    rows[0].allocations[0].createdAt = new Date('2026-10-08T22:00:00.000Z');
    db.customerPayment.findMany.mockResolvedValue(rows);
    const result = await service.read(user, query);
    expect(result.recentReceipts[0].date).toBe('2026-10-09');
    expect(result.trend.find((point) => point.date === '2026-10-08')!.collected).toBe('0.00');
    expect(result.trend.find((point) => point.date === '2026-10-09')!.collected).toBe('10.00');
    const allocationWindow =
      db.customerPayment.findMany.mock.calls[0][0].where.AND[2].OR[1].allocations.some.createdAt;
    expect(allocationWindow.gte).toEqual(new Date('2026-09-21T21:00:00.000Z'));
    expect(allocationWindow.lte).toEqual(new Date('2026-10-09T20:59:59.999Z'));
    rows[0].allocations[0].createdAt = new Date('2026-10-09T22:00:00.000Z');
    expect((await service.read(user, query)).metrics.collected).toBe('0.00');
  });
  it('does not read or expose receipt, receivable or customer sources without their permissions', async () => {
    const { service, db } = fixture();
    const result = await service.read({ ...user, permissions: ['sales.view'] }, query);
    expect(result.access).toEqual({ balances: false, receipts: false, customers: false });
    expect(result.metrics).toMatchObject({
      collected: null,
      outstanding: null,
      overdue: null,
      newCustomers: null,
      purchasingCustomers: null,
    });
    expect(result.topCustomers).toEqual([]);
    for (const delegate of [db.receivable, db.customerPayment, db.journalEntry])
      expect(delegate.findMany).not.toHaveBeenCalled();
    expect(db.customer.count).not.toHaveBeenCalled();
    expect(result.recentSales.every((sale) => sale.outstanding === null)).toBe(true);
  });
  it('fails explicitly instead of silently truncating totals', async () => {
    const { service, db, sales } = fixture();
    db.salesOrder.findMany.mockResolvedValue(Array(10001).fill(sales[0]));
    await expect(service.read(user, query)).rejects.toThrow('Choose a smaller');
  });
  it('rejects sales access violations and invalid, future or excessive date ranges', async () => {
    const { service, db } = fixture();
    await expect(service.read({ ...user, permissions: [] }, query)).rejects.toThrow('Sales access');
    for (const dates of [
      { dateFrom: '2026-10-10', dateTo: '2026-10-09' },
      { dateFrom: 'bad', dateTo: '2026-10-09' },
      { dateFrom: '2025-01-01', dateTo: '2026-10-09' },
      { dateFrom: '2026-02-30', dateTo: '2026-03-02' },
      { dateFrom: '2026-10-09', dateTo: '2026-10-10' },
    ])
      expect(() => overviewPeriod(dates)).toThrow('Choose a valid date range');
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(overviewPeriod({}, new Date('2026-09-30T22:00:00Z'))).toMatchObject({
      dateFrom: '2026-10-01',
      dateTo: '2026-10-01',
    });
  });
});
