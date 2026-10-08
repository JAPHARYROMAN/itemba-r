import { Prisma } from '@prisma/client';
import {
  computePartyBalance,
  liveCustomerExposure,
  refreshCachedPartyBalance,
} from './party-balance.helper';

const d = (v: string | number) => new Prisma.Decimal(v);
const asOf = new Date('2026-10-02T12:00:00.000Z');
const daysAgo = (n: number) => new Date(asOf.getTime() - n * 86400000);

function db(overrides: Record<string, unknown> = {}) {
  return {
    companyProfile: { findUnique: jest.fn(async () => ({ currency: 'TZS' })) },
    payable: {
      findMany: jest.fn(async () => []),
      aggregate: jest.fn(async () => ({ _sum: { outstandingAmount: d('0') } })),
    },
    receivable: {
      findMany: jest.fn(async () => []),
      aggregate: jest.fn(async () => ({ _sum: { outstandingAmount: d('0') } })),
    },
    invoiceDeskInvoice: { findMany: jest.fn(async () => []) },
    salesDeskSale: { findMany: jest.fn(async () => []) },
    recordEntry: { findMany: jest.fn(async () => []) },
    supplierPayment: {
      groupBy: jest.fn(async () => []),
      aggregate: jest.fn(async () => ({ _sum: { unappliedAmount: new Prisma.Decimal(0) } })),
      findFirst: jest.fn(async () => null),
    },
    customerPayment: { findFirst: jest.fn(async () => null) },
    supplier: { updateMany: jest.fn(async () => ({ count: 1 })) },
    customer: { updateMany: jest.fn(async () => ({ count: 1 })) },
    ...overrides,
  } as any;
}

describe('computePartyBalance', () => {
  it('treats due dates consistently by UTC calendar day across ERP and desk aging', async () => {
    const prisma = db();
    prisma.receivable.findMany.mockResolvedValue([
      { currency: 'TZS', outstandingAmount: d(100), dueDate: new Date('2026-10-02T00:00:00Z') },
      { currency: 'TZS', outstandingAmount: d(40), dueDate: new Date('2026-10-01T23:59:00Z') },
    ]);
    prisma.salesDeskSale.findMany.mockResolvedValue([
      {
        currency: 'TZS',
        totalAmount: d(10),
        paidAmount: d(0),
        dueDate: new Date('2026-10-02T00:00:00Z'),
      },
      {
        currency: 'TZS',
        totalAmount: d(20),
        paidAmount: d(0),
        dueDate: new Date('2026-10-01T23:59:00Z'),
      },
    ]);
    const balance = await computePartyBalance(
      prisma,
      'customer',
      {
        id: 'cus-1',
        companyId: 'company-1',
        creditLimit: d(0),
        currentBalance: d(140),
      },
      asOf,
    );
    expect(balance.erp[0]).toMatchObject({
      overdue: '40.00',
      current: '100.00',
      days1to30: '40.00',
    });
    expect(balance.desk[0].overdue).toBe('20.00');
  });

  it('shows unapplied supplier advances as credit without adding them to payable aging', async () => {
    const prisma = db();
    prisma.supplierPayment.groupBy.mockResolvedValue([
      { currency: 'TZS', _sum: { unappliedAmount: d(300) } },
    ]);
    const balance = await computePartyBalance(
      prisma,
      'supplier',
      { id: 'sup-1', companyId: 'company-1', creditLimit: d(0), currentBalance: d(-300) },
      asOf,
    );
    expect(balance.total).toEqual([{ currency: 'TZS', amount: '-300.00' }]);
    expect(balance.advances).toEqual([{ currency: 'TZS', amount: '300.00' }]);
    expect(balance.erp).toEqual([]);
    prisma.supplierPayment.aggregate.mockResolvedValue({ _sum: { unappliedAmount: d(300) } });
    await refreshCachedPartyBalance(prisma, 'supplier', 'company-1', 'sup-1');
    expect(prisma.supplier.updateMany.mock.calls[0][0].data.currentBalance.toFixed(2)).toBe(
      '-300.00',
    );
  });
  it('splits a supplier balance by currency with date-based overdue and aging, desk and notebook buckets', async () => {
    const prisma = db({
      payable: {
        findMany: jest.fn(async () => [
          { currency: 'TZS', outstandingAmount: d('100'), dueDate: daysAgo(-5) }, // not yet due
          { currency: 'TZS', outstandingAmount: d('200'), dueDate: daysAgo(10) }, // 1-30
          { currency: 'TZS', outstandingAmount: d('300'), dueDate: daysAgo(45) }, // 31-60
          { currency: 'TZS', outstandingAmount: d('400'), dueDate: daysAgo(100) }, // 90+
          { currency: 'USD', outstandingAmount: d('50'), dueDate: null }, // current
          { currency: 'TZS', outstandingAmount: d('0'), dueDate: daysAgo(400) }, // ignored
        ]),
        aggregate: jest.fn(),
      },
      invoiceDeskInvoice: {
        findMany: jest.fn(async () => [
          { currency: 'TZS', totalAmount: d('80'), paidAmount: d('30'), dueDate: daysAgo(3) },
          { currency: 'TZS', totalAmount: d('20'), paidAmount: d('20'), dueDate: daysAgo(3) },
        ]),
      },
      recordEntry: {
        findMany: jest.fn(async () => [
          { currency: 'TZS', amount: d('70'), settledAmount: d('20') },
        ]),
      },
      supplierPayment: {
        groupBy: jest.fn(async () => []),
        aggregate: jest.fn(async () => ({ _sum: { unappliedAmount: new Prisma.Decimal(0) } })),

        findFirst: jest.fn(async () => ({ paymentDate: new Date('2026-09-30T00:00:00.000Z') })),
      },
    });
    const balance = await computePartyBalance(
      prisma,
      'supplier',
      { id: 'sup-1', companyId: 'company-1', creditLimit: d('2000'), currentBalance: d('900') },
      asOf,
    );
    expect(balance.erp).toEqual([
      {
        currency: 'TZS',
        open: '1000.00',
        overdue: '900.00',
        current: '100.00',
        days1to30: '200.00',
        days31to60: '300.00',
        days61to90: '0.00',
        over90: '400.00',
        documents: 4,
      },
      {
        currency: 'USD',
        open: '50.00',
        overdue: '0.00',
        current: '50.00',
        days1to30: '0.00',
        days31to60: '0.00',
        days61to90: '0.00',
        over90: '0.00',
        documents: 1,
      },
    ]);
    expect(balance.desk).toEqual([
      { currency: 'TZS', outstanding: '50.00', overdue: '50.00', documents: 1 },
    ]);
    expect(balance.notebook).toEqual([{ currency: 'TZS', outstanding: '50.00', records: 1 }]);
    expect(balance.total).toEqual([
      { currency: 'TZS', amount: '1050.00' },
      { currency: 'USD', amount: '50.00' },
    ]);
    expect(balance.creditAvailable).toBe('950.00');
    expect(balance.cached).toBe('900.00');
    expect(balance.lastPaymentAt).toBe('2026-09-30T00:00:00.000Z');
    expect(prisma.recordEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ kind: 'CREDITOR', supplierId: 'sup-1' }),
      }),
    );
  });

  it('reads receivables, Sales Desk sales and DEBTOR records for a customer and reports no credit when no limit is set', async () => {
    const prisma = db({
      receivable: {
        findMany: jest.fn(async () => [
          { currency: 'TZS', outstandingAmount: d('120'), dueDate: daysAgo(1) },
        ]),
        aggregate: jest.fn(),
      },
      salesDeskSale: {
        findMany: jest.fn(async () => [
          { currency: 'TZS', totalAmount: d('30'), paidAmount: d('0'), dueDate: null },
        ]),
      },
    });
    const balance = await computePartyBalance(
      prisma,
      'customer',
      { id: 'cus-1', companyId: 'company-1', creditLimit: d('0'), currentBalance: d('120') },
      asOf,
    );
    expect(balance.total).toEqual([{ currency: 'TZS', amount: '150.00' }]);
    expect(balance.erp[0].overdue).toBe('120.00');
    expect(balance.creditAvailable).toBeNull();
    expect(prisma.recordEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ kind: 'DEBTOR', customerId: 'cus-1' }),
      }),
    );
  });
});

describe('refreshCachedPartyBalance', () => {
  it('writes the base-currency open ERP outstanding and nothing else', async () => {
    const prisma = db({
      companyProfile: { findUnique: jest.fn(async () => ({ currency: 'USD' })) },
      payable: {
        findMany: jest.fn(),
        aggregate: jest.fn(async () => ({ _sum: { outstandingAmount: d('410.50') } })),
      },
    });
    await refreshCachedPartyBalance(prisma, 'supplier', 'company-1', 'sup-1');
    expect(prisma.payable.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ supplierId: 'sup-1', currency: 'USD' }),
      }),
    );
    expect(prisma.supplier.updateMany).toHaveBeenCalledWith({
      where: { id: 'sup-1', companyId: 'company-1', deletedAt: null },
      data: { currentBalance: d('410.50') },
    });
  });

  it('is a no-op without a party id', async () => {
    const prisma = db();
    await refreshCachedPartyBalance(prisma, 'customer', 'company-1', null);
    expect(prisma.customer.updateMany).not.toHaveBeenCalled();
  });
});

describe('liveCustomerExposure', () => {
  it('adds only base-currency open receivables and unpromoted Sales Desk sales', async () => {
    const prisma = db({
      receivable: {
        findMany: jest.fn(),
        aggregate: jest.fn(async () => ({ _sum: { outstandingAmount: d('100') } })),
      },
      salesDeskSale: {
        findMany: jest.fn(async () => [{ totalAmount: d('60'), paidAmount: d('15') }]),
      },
    });
    await expect(liveCustomerExposure(prisma, 'company-1', 'cus-1')).resolves.toBe(145);
    expect(prisma.receivable.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ currency: 'TZS' }) }),
    );
    expect(prisma.salesDeskSale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ currency: 'TZS' }) }),
    );
  });

  it('uses a USD base currency without adding foreign TZS exposure', async () => {
    const prisma = db({
      companyProfile: { findUnique: jest.fn(async () => ({ currency: 'USD' })) },
    });
    prisma.receivable.aggregate.mockImplementation(async ({ where }: any) => ({
      _sum: { outstandingAmount: d(where.currency === 'USD' ? 30 : 900000) },
    }));
    prisma.salesDeskSale.findMany.mockImplementation(async ({ where }: any) =>
      where.currency === 'USD'
        ? [{ totalAmount: d(40), paidAmount: d(10) }]
        : [{ totalAmount: d(500000), paidAmount: d(0) }],
    );
    await expect(liveCustomerExposure(prisma, 'company-1', 'cus-1', 'USD')).resolves.toBe(60);
  });

  it('rejects a credit-limit comparison in a different denomination before loading exposure', async () => {
    const prisma = db();
    await expect(liveCustomerExposure(prisma, 'company-1', 'cus-1', 'USD')).rejects.toThrow(
      'denominated in TZS',
    );
    expect(prisma.receivable.aggregate).not.toHaveBeenCalled();
    expect(prisma.salesDeskSale.findMany).not.toHaveBeenCalled();
  });
});
