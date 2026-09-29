import { Prisma } from '@prisma/client';
import { DeskTransactionLinksService } from './desk-transaction-links.service';
import { AuthUser } from '../decorators/current-user.decorator';

const user = {
  id: 'reviewer',
  permissions: [
    'sales_desk.view',
    'sales_desk.manage',
    'sales.view',
    'customers.view',
    'invoice_desk.view',
    'invoice_desk.manage',
    'supplier_invoices.view',
    'suppliers.view',
  ],
} as AuthUser;
function fixture(kind: 'sale' | 'invoice') {
  const source = {
    id: 'direct',
    companyId: 'company',
    divisionId: 'division',
    branchId: 'branch',
    currency: 'TZS',
    totalAmount: new Prisma.Decimal('100.30'),
    paidAmount: new Prisma.Decimal(0),
    version: 3,
    voidedAt: null,
    canonicalInvoiceId: null,
    canonicalSalesOrderId: null,
    customer: { canonicalCustomerId: 'party' },
    supplier: { canonicalSupplierId: 'party' },
    _count: { payments: 0 },
  };
  const target = { ...source, id: 'business', supplierId: 'party', customerId: 'party' };
  const direct = {
    findFirst: jest.fn().mockResolvedValue(source),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const canonical = { findFirst: jest.fn().mockResolvedValue(target) };
  const tx = {
    $queryRaw: jest.fn(),
    salesDeskSale: direct,
    invoiceDeskInvoice: direct,
    salesOrder: canonical,
    supplierInvoice: canonical,
    journalEntry: { count: jest.fn().mockResolvedValue(0) },
  };
  const db = { $transaction: jest.fn().mockImplementation((work) => work(tx)) };
  const companies = {
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company' }),
    assertCanAccessCompany: jest.fn(),
  };
  const org = { recordWhereFor: jest.fn().mockResolvedValue({ branchId: 'branch' }) };
  const audit = { logStrictInTransaction: jest.fn() };
  const service = new DeskTransactionLinksService(
    db as never,
    companies as never,
    org as never,
    audit as never,
  );
  return {
    source,
    target,
    direct,
    canonical,
    tx,
    audit,
    db,
    run: () => service.link(user, kind, 'direct', 'business'),
    service,
  };
}
describe.each(['sale', 'invoice'] as const)('%s reviewed linking', (kind) => {
  it('links a reviewed unpaid record without changing its amounts or creating cash/journal entries', async () => {
    const f = fixture(kind);
    await expect(f.run()).resolves.toEqual({ id: 'direct', canonicalId: 'business' });
    expect(f.direct.updateMany.mock.calls[0][0].data).toEqual({
      [kind === 'sale' ? 'canonicalSalesOrderId' : 'canonicalInvoiceId']: 'business',
      version: { increment: 1 },
    });
    expect(f.tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(f.audit.logStrictInTransaction).toHaveBeenCalledTimes(1);
    expect(f.db.$transaction.mock.calls[0][1].isolationLevel).toBe('ReadCommitted');
  });
  it.each(['companyId', 'divisionId', 'branchId', 'currency', 'supplierId', 'customerId'])(
    'rejects mismatched %s',
    async (field) => {
      if (
        (kind === 'sale' && field === 'supplierId') ||
        (kind === 'invoice' && field === 'customerId')
      )
        return;
      const f = fixture(kind);
      (f.target as Record<string, unknown>)[field] = 'other';
      await expect(f.run()).rejects.toThrow('must match');
      expect(f.direct.updateMany).not.toHaveBeenCalled();
    },
  );
  it('rejects an amount difference down to one cent', async () => {
    const f = fixture(kind);
    f.target.totalAmount = new Prisma.Decimal('100.29');
    await expect(f.run()).rejects.toThrow('must match');
  });
  it('rejects even reversed payment history', async () => {
    const f = fixture(kind);
    f.source._count.payments = 1;
    await expect(f.run()).rejects.toThrow('payment history');
    expect(f.direct.updateMany).not.toHaveBeenCalled();
  });
  it('rejects previous journal history', async () => {
    const f = fixture(kind);
    f.tx.journalEntry.count.mockResolvedValue(1);
    await expect(f.run()).rejects.toThrow('accounting history');
    expect(f.direct.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a racing payment/version claim', async () => {
    const f = fixture(kind);
    f.direct.updateMany.mockResolvedValue({ count: 0 });
    await expect(f.run()).rejects.toThrow('changed during review');
    expect(f.audit.logStrictInTransaction).not.toHaveBeenCalled();
  });
  it('does not mutate again after an acknowledged or uncertain successful retry', async () => {
    const f = fixture(kind);
    Object.assign(f.source, {
      [kind === 'sale' ? 'canonicalSalesOrderId' : 'canonicalInvoiceId']: 'business',
    });
    await expect(f.run()).resolves.toEqual({ id: 'direct', canonicalId: 'business' });
    expect(f.direct.updateMany).not.toHaveBeenCalled();
  });
  it('fails before data access without all source permissions', async () => {
    const f = fixture(kind);
    await expect(
      f.service.link({ ...user, permissions: [] }, kind, 'direct', 'business'),
    ).rejects.toThrow('Access');
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it('hides inaccessible or missing source records', async () => {
    const f = fixture(kind);
    f.direct.findFirst.mockResolvedValue(null);
    await expect(f.run()).rejects.toThrow('not found');
    expect(f.canonical.findFirst).not.toHaveBeenCalled();
    expect(f.direct.findFirst.mock.calls[0][0].where.AND).toContainEqual({ branchId: 'branch' });
  });
});
