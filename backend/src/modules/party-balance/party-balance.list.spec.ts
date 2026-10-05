import { Prisma } from '@prisma/client';
import { computePartyBalanceList } from './party-balance.helper';
import { PartyBalanceService } from './party-balance.service';

const d = (v: string | number) => new Prisma.Decimal(v);
const asOf = new Date('2026-10-03T12:00:00.000Z');
const fieldRef = (name: string) => ({ modelName: 'x', name, typeName: 'Decimal', isList: false });

/**
 * Party linkage, Phase 2 PR-2: the list form of the resolver is computed set-wise and keeps
 * the per-party rules (open documents only, overdue by due date, NoteBook out of the total).
 */
function db(overrides: Record<string, unknown> = {}) {
  return {
    supplier: {
      findMany: jest.fn(async () => [
        {
          id: 'sup-1',
          companyId: 'company-1',
          name: 'Mwanjalisi Station',
          supplierCode: 'SUP-001',
          creditLimit: d('2000'),
          currentBalance: d('900'),
        },
        {
          id: 'sup-2',
          companyId: 'company-1',
          name: 'Quiet Supplier',
          supplierCode: 'SUP-002',
          creditLimit: d('0'),
          currentBalance: d('0'),
        },
      ]),
    },
    customer: { findMany: jest.fn(async () => []) },
    payable: {
      groupBy: jest.fn(async (args: any) =>
        args.where.dueDate
          ? [{ supplierId: 'sup-1', currency: 'TZS', _sum: { outstandingAmount: d('400') } }]
          : [
              {
                supplierId: 'sup-1',
                currency: 'TZS',
                _sum: { outstandingAmount: d('1000') },
                _count: { _all: 3 },
              },
              {
                supplierId: 'sup-1',
                currency: 'USD',
                _sum: { outstandingAmount: d('50') },
                _count: { _all: 1 },
              },
            ],
      ),
    },
    receivable: { groupBy: jest.fn(async () => []) },
    invoiceDeskInvoice: {
      fields: { totalAmount: fieldRef('totalAmount') },
      groupBy: jest.fn(async (args: any) =>
        args.where.dueDate
          ? []
          : [
              {
                supplierId: 'desk-a',
                currency: 'TZS',
                _sum: { totalAmount: d('80'), paidAmount: d('30') },
                _count: { _all: 1 },
              },
              {
                supplierId: 'desk-b',
                currency: 'TZS',
                _sum: { totalAmount: d('100'), paidAmount: d('0') },
                _count: { _all: 2 },
              },
            ],
      ),
    },
    invoiceDeskSupplier: {
      findMany: jest.fn(async () => [
        { id: 'desk-a', canonicalSupplierId: 'sup-1' },
        { id: 'desk-b', canonicalSupplierId: 'sup-1' },
      ]),
    },
    salesDeskSale: { fields: { totalAmount: fieldRef('totalAmount') }, groupBy: jest.fn() },
    salesDeskCustomer: { findMany: jest.fn(async () => []) },
    recordEntry: {
      fields: { amount: fieldRef('amount') },
      groupBy: jest.fn(async () => [
        {
          supplierId: 'sup-1',
          currency: 'TZS',
          _sum: { amount: d('70'), settledAmount: d('20') },
          _count: { _all: 1 },
        },
      ]),
    },
    supplierPayment: {
      aggregate: jest.fn(async () => ({ _sum: { unappliedAmount: new Prisma.Decimal(0) } })),

      groupBy: jest.fn(async (args: any) =>
        args._sum
          ? []
          : [{ supplierId: 'sup-1', _max: { paymentDate: new Date('2026-09-30T00:00:00.000Z') } }],
      ),
    },
    customerPayment: { groupBy: jest.fn(async () => []) },
    companyProfile: {
      findMany: jest.fn(async () => [{ companyId: 'company-1', currency: 'TZS' }]),
    },
    ...overrides,
  } as any;
}

describe('computePartyBalanceList', () => {
  it('includes a supplier who only has an unapplied advance credit', async () => {
    const prisma = db();
    prisma.supplierPayment.groupBy.mockImplementation(async (args: any) =>
      args._sum
        ? [{ supplierId: 'sup-2', currency: 'TZS', _sum: { unappliedAmount: d(300) } }]
        : [],
    );
    const list = await computePartyBalanceList(
      prisma,
      'supplier',
      { companyId: 'company-1' },
      asOf,
    );
    const supplier = list.find((row) => row.partyId === 'sup-2')!;
    expect(supplier.total).toEqual([{ currency: 'TZS', amount: '-300.00' }]);
    expect(supplier.advances).toEqual([{ currency: 'TZS', amount: '300.00' }]);
    expect(supplier.erp).toEqual([]);
  });
  it('lists only parties with a balance, merges desk parties into the canonical one and keeps NoteBook out of the total', async () => {
    const prisma = db();
    const list = await computePartyBalanceList(
      prisma,
      'supplier',
      { companyId: 'company-1' },
      asOf,
    );
    expect(list.map((s) => s.partyId)).toEqual(['sup-1']);
    const [sup] = list;
    expect(sup).toMatchObject({
      kind: 'supplier',
      name: 'Mwanjalisi Station',
      code: 'SUP-001',
      baseCurrency: 'TZS',
      erp: [
        { currency: 'TZS', open: '1000.00', overdue: '400.00', documents: 3 },
        { currency: 'USD', open: '50.00', overdue: '0.00', documents: 1 },
      ],
      desk: [{ currency: 'TZS', outstanding: '150.00', overdue: '0.00', documents: 3 }],
      notebook: [{ currency: 'TZS', outstanding: '50.00', records: 1 }],
      total: [
        { currency: 'TZS', amount: '1150.00' },
        { currency: 'USD', amount: '50.00' },
      ],
      overdue: [
        { currency: 'TZS', amount: '400.00' },
        { currency: 'USD', amount: '0.00' },
      ],
      creditLimit: '2000.00',
      creditAvailable: '850.00',
      cached: '900.00',
      lastPaymentAt: '2026-09-30T00:00:00.000Z',
    });
  });

  it('runs every grouped read under the company scope and ignores documents without a balance', async () => {
    const prisma = db();
    await computePartyBalanceList(prisma, 'supplier', { companyId: { in: ['company-1'] } }, asOf);
    for (const delegate of [
      prisma.payable,
      prisma.invoiceDeskInvoice,
      prisma.recordEntry,
      prisma.supplierPayment,
    ]) {
      for (const call of delegate.groupBy.mock.calls)
        expect(call[0].where.companyId).toEqual({ in: ['company-1'] });
    }
    expect(prisma.supplier.findMany.mock.calls[0][0].where).toEqual({
      companyId: { in: ['company-1'] },
      deletedAt: null,
    });
    const [open, overdue] = prisma.payable.groupBy.mock.calls.map((c: any[]) => c[0].where);
    expect(open.outstandingAmount).toEqual({ gt: 0 });
    expect(open.status).toEqual({ in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] });
    expect(open.supplierId).toEqual({ not: null });
    expect(overdue.dueDate).toEqual({ lte: new Date(asOf.getTime() - 86400000) });
    const desk = prisma.invoiceDeskInvoice.groupBy.mock.calls[0][0].where;
    expect(desk.canonicalInvoiceId).toBeNull();
    expect(desk.supplier).toEqual({ canonicalSupplierId: { not: null } });
    expect(desk.paidAmount).toEqual({ lt: fieldRef('totalAmount') });
    expect(prisma.recordEntry.groupBy.mock.calls[0][0].where).toMatchObject({
      kind: 'CREDITOR',
      voidedAt: null,
      supplierId: { not: null },
    });
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
  });

  it('reads customers through receivables, Sales Desk sales and NoteBook debtors', async () => {
    const prisma = db({
      supplier: { findMany: jest.fn() },
      customer: {
        findMany: jest.fn(async () => [
          {
            id: 'cus-1',
            companyId: 'company-1',
            name: 'Westsides',
            customerCode: 'CUS-001',
            creditLimit: d('0'),
            currentBalance: d('0'),
          },
        ]),
      },
      receivable: {
        groupBy: jest.fn(async (args: any) =>
          args.where.dueDate
            ? []
            : [
                {
                  customerId: 'cus-1',
                  currency: 'TZS',
                  _sum: { outstandingAmount: d('10') },
                  _count: { _all: 1 },
                },
              ],
        ),
      },
      salesDeskSale: {
        fields: { totalAmount: fieldRef('totalAmount') },
        groupBy: jest.fn(async (args: any) => [
          {
            customerId: 'desk-c',
            currency: 'TZS',
            _sum: { totalAmount: d('30'), paidAmount: d('5') },
            _count: { _all: 1 },
          },
        ]),
      },
      salesDeskCustomer: {
        findMany: jest.fn(async () => [{ id: 'desk-c', canonicalCustomerId: 'cus-1' }]),
      },
      recordEntry: { fields: { amount: fieldRef('amount') }, groupBy: jest.fn(async () => []) },
      customerPayment: { groupBy: jest.fn(async () => []) },
    });
    const [cus] = await computePartyBalanceList(
      prisma,
      'customer',
      { companyId: 'company-1' },
      asOf,
    );
    expect(cus).toMatchObject({
      kind: 'customer',
      partyId: 'cus-1',
      erp: [{ currency: 'TZS', open: '10.00', overdue: '0.00', documents: 1 }],
      desk: [{ currency: 'TZS', outstanding: '25.00', overdue: '25.00', documents: 1 }],
      total: [{ currency: 'TZS', amount: '35.00' }],
      creditAvailable: null,
      lastPaymentAt: null,
    });
    expect(prisma.recordEntry.groupBy.mock.calls[0][0].where).toMatchObject({ kind: 'DEBTOR' });
    expect(prisma.supplier.findMany).not.toHaveBeenCalled();
  });
});

describe('PartyBalanceService lists', () => {
  it('scopes the list to the companies the user may read before computing anything', async () => {
    const prisma = db({ supplier: { findMany: jest.fn(async () => []) } });
    const companyScope = {
      companyWhereFor: jest.fn(async () => ({ companyId: { in: ['company-1'] } })),
    };
    const service = new PartyBalanceService(prisma, companyScope as any);
    const user = { id: 'u' } as any;
    expect(await service.suppliers(user, 'company-1')).toEqual([]);
    expect(companyScope.companyWhereFor).toHaveBeenCalledWith(user, 'company-1');
    expect(prisma.supplier.findMany.mock.calls[0][0].where).toEqual({
      companyId: { in: ['company-1'] },
      deletedAt: null,
    });
    expect(prisma.payable.groupBy).not.toHaveBeenCalled();
  });
});
