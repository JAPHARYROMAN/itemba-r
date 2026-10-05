import { Prisma } from '@prisma/client';
import { SupplierPurchaseAdvancesService } from './supplier-purchase-advances.service';

const d = (n: string | number) => new Prisma.Decimal(n);
const user: any = { id: 'office', permissions: ['purchases.view'] };
const input: any = {
  requestId: 'request',
  purchaseOrderId: 'po',
  supplierId: 'supplier',
  reference: 'PINV',
  description: 'Advance',
};
const drawer: any = {
  companyId: 'company',
  divisionId: 'division',
  branchId: 'branch',
  currency: 'TZS',
  kind: 'CASH',
  erpCashAccountId: 'cash',
  openingDate: new Date('2026-01-01'),
};
function setup() {
  const order: any = {
    id: 'po',
    ...drawer,
    supplierId: 'supplier',
    orderDate: new Date('2026-09-30'),
    purchaseOrderNumber: 'PO-1',
    status: 'CONFIRMED',
    purchaseType: 'STOCK_PURCHASE',
    payableId: null,
    supplierInvoices: [],
    totalAmount: d(100),
    outstandingAmount: d(100),
    payable: null,
  };
  const cash: any = {
    id: 'cash',
    ...drawer,
    isActive: true,
    accountType: 'CASH_ON_HAND',
    currentBalance: d(500),
    ledgerAccount: {
      id: 'cash-ledger',
      companyId: 'company',
      divisionId: null,
      branchId: null,
      accountType: 'ASSET',
      isActive: true,
      deletedAt: null,
    },
  };
  const tx: any = {
    $queryRaw: jest.fn(),
    purchaseOrder: {
      findFirst: jest.fn(async () => order),
      findUniqueOrThrow: jest.fn(async () => order),
      update: jest.fn(),
    },
    cashAccount: { findFirst: jest.fn(async () => cash), update: jest.fn() },
    chartOfAccount: {
      findFirst: jest.fn(async () => ({ id: 'advance-asset', accountType: 'ASSET' })),
      create: jest.fn(),
    },
    supplierPayment: {
      create: jest.fn(async ({ data }: any) => ({ id: 'payment', paymentNumber: 'SP-1', ...data })),
      update: jest.fn(async () => ({ id: 'payment', journalEntryId: 'journal' })),
      aggregate: jest.fn(async () => ({ _sum: { unappliedAmount: d(25) } })),
    },
    companyProfile: { findUnique: jest.fn(async () => ({ currency: 'TZS' })) },
    payable: { aggregate: jest.fn(async () => ({ _sum: { outstandingAmount: d(0) } })) },
    supplier: { updateMany: jest.fn() },
    supplierPurchaseAdvance: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
  };
  const posting: any = { postLines: jest.fn(async () => ({ id: 'journal' })) };
  const org: any = { assertCanAccessScope: jest.fn() };
  const service = new SupplierPurchaseAdvancesService(
    posting,
    { resolve: jest.fn() } as any,
    { next: jest.fn(async () => 'SP-1') } as any,
    {} as any,
    org,
    { logStrictInTransaction: jest.fn() } as any,
  );
  const pay = (amount = '25.00', date = new Date('2026-10-01')) =>
    service.pay(tx, user, drawer, input, date, d(amount));
  return { service, tx, order, cash, posting, org, pay };
}
describe('supplier purchase advances', () => {
  it('posts an advance asset and cash payment with no premature payable allocation', async () => {
    const { pay, tx, posting } = setup();
    await pay();
    expect(tx.supplierPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        appliedAmount: 0,
        unappliedAmount: d(25),
        purchaseAdvance: { create: { purchaseOrderId: 'po', advanceAccountId: 'advance-asset' } },
      }),
    });
    expect(tx.supplierPayment.create.mock.calls[0][0].data).not.toHaveProperty('allocations');
    expect(posting.postLines.mock.calls[0][0].lines).toEqual([
      expect.objectContaining({
        accountId: 'advance-asset',
        debit: d(25),
        credit: 0,
        supplierId: 'supplier',
      }),
      { accountId: 'cash-ledger', debit: 0, credit: d(25) },
    ]);
    expect(tx.cashAccount.update).toHaveBeenCalledWith({
      where: { id: 'cash' },
      data: { currentBalance: { decrement: d(25) } },
    });
    expect(tx.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: 'po' },
      data: { paidAmount: d(25), outstandingAmount: d(75), paymentStatus: 'PARTIALLY_PAID' },
    });
    expect(tx.supplier.updateMany.mock.calls[0][0].data.currentBalance.toFixed(2)).toBe('-25.00');
  });
  it.each(['DRAFT', 'CANCELLED', 'RECEIVED'])(
    'rejects %s orders before moving money',
    async (status) => {
      const { pay, order, tx } = setup();
      order.status = status;
      await expect(pay()).rejects.toThrow('confirmed');
      expect(tx.supplierPayment.create).not.toHaveBeenCalled();
    },
  );
  it.each(['0', '-1', '100.01'])('rejects an invalid advance %s', async (amount) => {
    const { pay, tx } = setup();
    await expect(pay(amount)).rejects.toThrow('remaining');
    expect(tx.cashAccount.update).not.toHaveBeenCalled();
  });
  it('requires a purchase officer and validates company, supplier and currency in the lookup', async () => {
    const { service, tx, pay } = setup();
    await expect(
      service.pay(tx, { ...user, permissions: [] }, drawer, input, new Date(), d(25)),
    ).rejects.toThrow('permission');
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    tx.purchaseOrder.findFirst.mockResolvedValue(null);
    await expect(pay()).rejects.toThrow('confirmed');
    expect(tx.purchaseOrder.findFirst.mock.calls[0][0].where).toMatchObject({
      companyId: 'company',
      supplierId: 'supplier',
      currency: 'TZS',
      deletedAt: null,
    });
  });
  it('rejects a branch mismatch or insufficient cash before posting', async () => {
    const { pay, cash, posting } = setup();
    cash.branchId = 'other-branch';
    await expect(pay()).rejects.toThrow();
    cash.branchId = 'branch';
    cash.currentBalance = d(1);
    await expect(pay()).rejects.toThrow('Insufficient');
    expect(posting.postLines).not.toHaveBeenCalled();
  });
  it('requires the advance to be reversed before cancellation', async () => {
    const { service, tx } = setup();
    tx.supplierPurchaseAdvance.count.mockResolvedValue(1);
    await expect(service.assertCanCancel(tx, 'po')).rejects.toThrow('Reverse');
  });
  it('does not create a journal or touch cash when there is no unapplied advance', async () => {
    const { service, tx, posting } = setup();
    await service.apply(tx, user, 'po', 'payable', new Date());
    expect(posting.postLines).not.toHaveBeenCalled();
    expect(tx.cashAccount.update).not.toHaveBeenCalled();
  });
});
