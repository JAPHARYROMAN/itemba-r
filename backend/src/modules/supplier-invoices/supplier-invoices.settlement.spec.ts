import { Prisma } from '@prisma/client';
import { SupplierInvoicesService } from './supplier-invoices.service';

describe('Supplier invoice settlement views', () => {
  const invoice = {
    id: 'invoice',
    companyId: 'company',
    supplierId: 'supplier',
    currency: 'TZS',
    status: 'APPROVED',
    totalAmount: new Prisma.Decimal(100),
    paidAmount: new Prisma.Decimal(0),
    outstandingAmount: new Prisma.Decimal(100),
    payableId: 'payable',
  };
  const payable = {
    id: 'payable',
    companyId: 'company',
    supplierId: 'supplier',
    currency: 'TZS',
    status: 'PAID',
    amount: new Prisma.Decimal(100),
    paidAmount: new Prisma.Decimal(100),
    outstandingAmount: new Prisma.Decimal(0),
    deletedAt: null,
  };
  function make(overrides: Record<string, unknown> = {}) {
    const prisma = {
      supplierInvoice: {
        findFirst: jest.fn().mockResolvedValue(invoice),
        findMany: jest.fn().mockResolvedValue([invoice]),
        count: jest.fn().mockResolvedValue(1),
      },
      supplier: { findMany: jest.fn().mockResolvedValue([]) },
      payable: { findMany: jest.fn().mockResolvedValue([{ ...payable, ...overrides }]) },
      threeWayMatch: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const scope = {
      assertCanAccessCompany: jest.fn(),
      companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company' }),
    };
    return {
      prisma,
      service: new SupplierInvoicesService(
        prisma as any,
        {} as any,
        scope as any,
        {} as any,
        {} as any,
        {} as any,
      ),
    };
  }

  it('uses the same canonical payable cash and balance in list and detail without changing approval lifecycle', async () => {
    const { service } = make();
    const detail = await service.findOne('invoice', {} as any);
    const list = await service.findAll({} as any, {} as any);
    for (const record of [detail, list.data[0]]) {
      expect(record.paidAmount.toFixed(2)).toBe('100.00');
      expect(record.outstandingAmount.toFixed(2)).toBe('0.00');
      expect(record.status).toBe('APPROVED');
      expect(record.paymentStatus).toBe('PAID');
      expect(record.settlementConflict).toBe(false);
    }
  });

  it('reports written-off debt as a non-cash adjustment', async () => {
    const { service } = make({ status: 'WRITTEN_OFF', paidAmount: new Prisma.Decimal(20) });
    const record = await service.findOne('invoice', {} as any);
    expect(record.paidAmount.toFixed(2)).toBe('20.00');
    expect(record.settlementAdjustmentAmount.toFixed(2)).toBe('80.00');
    expect(record.outstandingAmount.toFixed(2)).toBe('0.00');
    expect(record.paymentStatus).toBe('PARTIALLY_PAID');
    expect(record.settlementStatus).toBe('WRITTEN_OFF');
  });

  it('also refreshes an invoice whose stored lifecycle is PARTIALLY_PAID', async () => {
    const { service, prisma } = make();
    prisma.supplierInvoice.findFirst.mockResolvedValue({ ...invoice, status: 'PARTIALLY_PAID' });
    const record = await service.findOne('invoice', {} as any);
    expect(record.outstandingAmount.toFixed(2)).toBe('0.00');
    expect(record.paidAmount.toFixed(2)).toBe('100.00');
    expect(record.paymentStatus).toBe('PAID');
    expect(record.status).toBe('PARTIALLY_PAID');
  });

  it.each([
    { companyId: 'other-company' },
    { supplierId: 'other-supplier' },
    { currency: 'USD' },
    { amount: new Prisma.Decimal(150) },
    { deletedAt: new Date() },
    { status: 'CANCELLED' },
  ])(
    'preserves original invoice amounts and flags inconsistent payable linkage %j',
    async (overrides) => {
      const { service } = make(overrides);
      const record = await service.findOne('invoice', {} as any);
      expect(record.paidAmount.toFixed(2)).toBe('0.00');
      expect(record.outstandingAmount.toFixed(2)).toBe('100.00');
      expect(record.settlementConflict).toBe(true);
      if (overrides.companyId || overrides.supplierId || overrides.currency)
        expect(record.payable).toBeNull();
    },
  );
});
