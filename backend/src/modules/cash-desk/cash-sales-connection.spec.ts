import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CashSalesConnectionService } from './cash-sales-connection.service';

const D = (value: number) => new Prisma.Decimal(value);
const permissions = [
  'cash_desk.view',
  'sales.view',
  'receivables.view',
  'cash_accounts.view',
  'customer-payments.view',
];
const user = { id: 'u', permissions } as any;
function fixture() {
  const sales = [
    {
      id: 'cash',
      salesOrderNumber: 'SO-CASH',
      companyId: 'c',
      currency: 'TZS',
      paymentMethod: 'CASH',
      paidAmount: D(100),
      cashAccountId: 'a',
      journalEntryId: 'cash-journal',
      customerName: 'Walk-in',
      customerId: 'walk-in',
      company: { name: 'Company' },
    },
    {
      id: 'credit',
      salesOrderNumber: 'SO-CREDIT',
      companyId: 'c',
      currency: 'TZS',
      paymentMethod: 'CREDIT',
      paidAmount: D(0),
      receivableId: 'r',
      customerName: 'Customer',
      customerId: 'customer',
      company: { name: 'Company' },
    },
  ];
  const receivable = {
    id: 'r',
    companyId: 'c',
    customerName: 'Customer',
    customerId: 'customer',
    company: { name: 'Company' },
    currency: 'TZS',
    paidAmount: D(30),
    outstandingAmount: D(170),
    status: 'PARTIALLY_PAID',
    receivableNumber: 'REC',
    journalEntryId: 'accrual',
    sourceId: 'credit',
  };
  const db = {
    $transaction: jest.fn(async (work: any): Promise<any> => work(db)),
    salesOrder: { findMany: jest.fn().mockResolvedValue(sales) },
    receivable: { findMany: jest.fn().mockResolvedValue([receivable]) },
    cashAccount: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'a', accountName: 'Business till', currency: 'TZS', currentBalance: D(500) },
        ]),
    },
    journalEntry: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'cash-journal',
          referenceType: 'SalesOrder',
          referenceId: 'cash',
          transactionDate: new Date('2026-09-26'),
          journalNumber: 'JE1',
          totalDebit: D(165),
        },
        {
          id: 'settlement',
          referenceType: 'Receivable',
          referenceId: 'r',
          transactionDate: new Date('2026-09-26'),
          journalNumber: 'JE2',
          totalDebit: D(20),
        },
      ]),
    },
    customerPayment: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'p',
          paymentNumber: 'PAY1',
          companyId: 'c',
          customerId: 'customer',
          company: { name: 'Company' },
          currency: 'TZS',
          cashAccountId: 'a',
          paymentDate: new Date('2026-09-26'),
          allocations: [{ receivableId: 'r', amount: D(10) }],
        },
      ]),
    },
  };
  const companies = { companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'c' }) };
  const org = { recordWhereFor: jest.fn().mockResolvedValue({ branchId: { in: ['b'] } }) };
  return {
    db,
    companies,
    org,
    receivable,
    service: new CashSalesConnectionService(db as any, companies as any, org as any),
  };
}
describe('Sales Desk → Cash Desk live projection', () => {
  it('counts cash once, excludes sales COGS and shows the original account balance without changing any records', async () => {
    const { service } = fixture();
    const result = await service.read(user, { page: 1, date: '2026-09-26' });
    expect(result.currencies).toEqual([
      {
        currency: 'TZS',
        balance: '500.00',
        outstanding: '170.00',
        received: '130.00',
        notebook: null,
      },
    ]);
    expect(result.outstanding.rows[0]).toMatchObject({
      saleId: 'credit',
      salesOrderNumber: 'SO-CREDIT',
    });
    expect(result.receipts.rows).toHaveLength(3);
    expect(result.receipts.rows.find((row) => row.id === 'cash-journal')).toMatchObject({
      companyId: 'c',
      customerId: 'walk-in',
      company: { name: 'Company' },
    });
    for (const id of ['settlement', 'p'])
      expect(result.receipts.rows.find((row) => row.id === id)).toMatchObject({
        companyId: 'c',
        customerId: 'customer',
        company: { name: 'Company' },
      });
  });
  it('scopes every source by company and branch and only reads unreversed receipts on the selected date', async () => {
    const { db, service } = fixture();
    await service.read(user, { page: 1, companyId: 'c', branchId: 'b', date: '2026-09-26' });
    for (const delegate of [
      db.salesOrder,
      db.receivable,
      db.cashAccount,
      db.journalEntry,
      db.customerPayment,
    ]) {
      const where = delegate.findMany.mock.calls[0][0].where;
      expect(where.AND).toContainEqual({ companyId: 'c' });
      expect(where.AND).toContainEqual({ branchId: { in: ['b'] } });
      expect(where.deletedAt).toBeNull();
    }
    const journals = db.journalEntry.findMany.mock.calls[0][0].where;
    expect(journals.status).toBe('POSTED');
    expect(journals.reversalOfId).toBeNull();
    expect(journals.OR[1].id.notIn).toEqual(['accrual']);
    expect(journals.OR[1].lines.some).toEqual({
      debit: { gt: 0 },
      account: { accountType: 'ASSET' },
    });
    expect(journals.transactionDate).toEqual({
      gte: new Date('2026-09-26T00:00:00Z'),
      lte: new Date('2026-09-26T23:59:59.999Z'),
    });
    expect(db.customerPayment.findMany.mock.calls[0][0].where.status).toBe('COMPLETED');
    expect(db.customerPayment.findMany.mock.calls[0][0].where.journalEntry).toEqual({
      status: 'POSTED',
      deletedAt: null,
    });
  });
  it('does not expose accounts or payment history without their existing permissions', async () => {
    const { db, service } = fixture();
    const result = await service.read(
      { ...user, permissions: permissions.slice(0, 3) },
      { page: 1 },
    );
    expect(db.cashAccount.findMany).not.toHaveBeenCalled();
    expect(db.journalEntry.findMany).not.toHaveBeenCalled();
    expect(db.customerPayment.findMany).not.toHaveBeenCalled();
    expect(result.currencies[0]).toMatchObject({
      received: null,
      balance: null,
      outstanding: '170.00',
    });
    await expect(
      service.read({ ...user, permissions: ['cash_desk.view'] }, { page: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('does not add written-off debt or another currency to the outstanding amount', async () => {
    const { db, service, receivable } = fixture();
    db.receivable.findMany.mockResolvedValue([
      receivable,
      { ...receivable, id: 'written-off', status: 'WRITTEN_OFF', outstandingAmount: D(900) },
      { ...receivable, id: 'usd', currency: 'USD', outstandingAmount: D(5) },
    ]);
    const result = await service.read(user, { page: 1 });
    expect(result.currencies.find((r) => r.currency === 'TZS')?.outstanding).toBe('170.00');
    expect(result.currencies.find((r) => r.currency === 'USD')?.outstanding).toBe('5.00');
  });
  it('searches and pages outstanding sales while keeping summary totals complete', async () => {
    const { service } = fixture();
    const result = await service.read(user, { page: 1, search: 'no match' });
    expect(result.outstanding).toEqual({ rows: [], total: 0 });
    expect(result.currencies[0].outstanding).toBe('170.00');
  });
  it('lists Sales Desk direct sales and linked NoteBook debtors by source, counting only the sale in what customers owe', async () => {
    const { db, service } = fixture();
    (db as any).salesDeskSale = {
      fields: { totalAmount: { name: 'totalAmount' } },
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'desk-sale',
          saleNumber: 'SD-1',
          companyId: 'c',
          divisionId: 'd',
          branchId: 'b',
          currency: 'TZS',
          totalAmount: D(40),
          paidAmount: D(10),
          dueDate: new Date('2026-09-20'),
          customer: { name: 'Desk customer', canonicalCustomerId: 'cus-1' },
          branch: { name: 'Branch' },
        },
      ]),
    };
    (db as any).recordEntry = {
      fields: { amount: { name: 'amount' } },
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'note',
          title: 'Credit lunch',
          counterparty: 'Walk-in',
          reference: 'NB-1',
          companyId: 'c',
          divisionId: 'd',
          branchId: 'b',
          currency: 'TZS',
          amount: D(25),
          settledAmount: D(5),
          dueDate: null,
          customerId: 'cus-1',
          customer: { name: 'Desk customer' },
          branch: { name: 'Branch' },
        },
      ]),
    };
    const result = await service.read(
      { ...user, permissions: [...permissions, 'sales_desk.view', 'records.view'] },
      { page: 1 },
    );
    expect(result.outstanding.rows.map((r) => [r.source, r.id, r.customerId])).toEqual([
      ['SALES_DESK', 'desk-sale', 'cus-1'],
      ['NOTEBOOK', 'note', 'cus-1'],
      ['RECEIVABLE', 'r', 'customer'],
    ]);
    expect(result.outstanding.rows[0]).toMatchObject({
      deskSaleId: 'desk-sale',
      saleNumber: 'SD-1',
    });
    expect(result.outstanding.rows[0].outstandingAmount.toFixed(2)).toBe('30.00');
    expect(result.outstanding.rows[1]).toMatchObject({
      recordId: 'note',
      receivableNumber: 'NB-1',
    });
    expect(result.currencies[0]).toMatchObject({ outstanding: '200.00', notebook: '20.00' });
    const deskWhere = (db as any).salesDeskSale.findMany.mock.calls[0][0].where;
    expect(deskWhere).toMatchObject({
      voidedAt: null,
      canonicalSalesOrderId: null,
      customer: { canonicalCustomerId: { not: null } },
    });
    expect(deskWhere.AND).toContainEqual({ companyId: 'c' });
    expect((db as any).recordEntry.findMany.mock.calls[0][0].where).toMatchObject({
      kind: 'DEBTOR',
      voidedAt: null,
      customerId: { not: null },
    });
  });
  it('does not read Sales Desk sales or NoteBook records without their own permissions', async () => {
    const { db, service } = fixture();
    (db as any).salesDeskSale = { findMany: jest.fn() };
    (db as any).recordEntry = { findMany: jest.fn() };
    const result = await service.read(user, { page: 1 });
    expect((db as any).salesDeskSale.findMany).not.toHaveBeenCalled();
    expect((db as any).recordEntry.findMany).not.toHaveBeenCalled();
    expect(result.outstanding.rows.map((r) => r.source)).toEqual(['RECEIVABLE']);
    expect(result.currencies[0].notebook).toBeNull();
  });
});
