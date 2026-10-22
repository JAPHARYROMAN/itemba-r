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
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 'payment', paymentNumber: 'SP-1', ...data })),
      update: jest.fn(async () => ({ id: 'payment', journalEntryId: 'journal' })),
      aggregate: jest.fn(async () => ({ _sum: { unappliedAmount: d(25) } })),
    },
    companyProfile: { findUnique: jest.fn(async () => ({ currency: 'TZS' })) },
    payable: { aggregate: jest.fn(async () => ({ _sum: { outstandingAmount: d(0) } })) },
    supplier: { updateMany: jest.fn() },
    supplierPurchaseAdvance: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    journalEntry: { findFirst: jest.fn(async () => null) },
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
  const uuid = 'AA31381C-A312-4A38-A33C-B8EE023E32A8';
  const intent = { ...input, requestId: uuid };
  const prior = (overrides: Record<string, unknown> = {}) => ({
    id: 'payment',
    paymentNumber: 'SP-1',
    requestId: uuid.toLowerCase(),
    companyId: 'company',
    divisionId: 'division',
    branchId: 'branch',
    supplierId: 'supplier',
    currency: 'TZS',
    amount: d(25),
    paymentDate: new Date('2026-10-01'),
    method: 'CASH',
    reference: 'PINV',
    notes: 'Advance',
    cashAccountId: 'cash',
    sourceType: 'CashDesk',
    sourceId: uuid.toLowerCase(),
    status: 'COMPLETED',
    deletedAt: null,
    reversedAt: null,
    purchaseAdvance: { purchaseOrderId: 'po' },
    journalEntry: {
      id: 'journal',
      status: 'POSTED',
      deletedAt: null,
      referenceType: 'SupplierPayment',
      referenceId: 'payment',
    },
    cashDeskMovement: null,
    carriedMovement: null,
    ...overrides,
  });
  const payIntent = (fixture: ReturnType<typeof setup>, request = intent) =>
    fixture.service.pay(fixture.tx, user, drawer, request, new Date('2026-10-01'), d(25));

  it('normalizes a UUID and claims the canonical token before source or cash locks', async () => {
    const f = setup();
    await payIntent(f);
    expect(f.tx.$queryRaw.mock.calls[0][1]).toBe(`SupplierPaymentRequest:${uuid.toLowerCase()}`);
    const sql = f.tx.$queryRaw.mock.calls.map(([query]: any[]) =>
      Array.from(query.strings ?? query).join('?'),
    );
    expect(sql[0]).toContain('pg_advisory_xact_lock');
    expect(sql[1]).toContain('purchase_orders');
    expect(sql[2]).toContain('cash_accounts');
    expect(f.tx.journalEntry.findFirst).toHaveBeenCalledWith({
      where: { journalNumber: `AP-PAY-${uuid.toLowerCase()}` },
      select: { id: true },
    });
    expect(f.tx.supplierPayment.create.mock.calls[0][0].data).toMatchObject({
      requestId: uuid.toLowerCase(),
      sourceId: uuid.toLowerCase(),
    });
  });

  it('keeps opaque internal token casing and bytes unchanged', async () => {
    const f = setup();
    await payIntent(f, { ...intent, requestId: 'CashDesk:Internal-SourceA' });
    expect(f.tx.supplierPayment.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { requestId: 'CashDesk:Internal-SourceA' } }),
    );
    expect(f.tx.supplierPayment.create.mock.calls[0][0].data.requestId).toBe(
      'CashDesk:Internal-SourceA',
    );
    expect(f.tx.journalEntry.findFirst).not.toHaveBeenCalled();
  });

  it('replays an identical own-source advance without cash, journal, or source mutations', async () => {
    const f = setup();
    const existing = prior();
    f.tx.supplierPayment.findMany.mockResolvedValue([existing]);
    expect((await payIntent(f)).payment.id).toBe(existing.id);
    expect(f.tx.purchaseOrder.findFirst).not.toHaveBeenCalled();
    expect(f.tx.cashAccount.findFirst).not.toHaveBeenCalled();
    expect(f.tx.supplierPayment.create).not.toHaveBeenCalled();
    expect(f.posting.postLines).not.toHaveBeenCalled();
    expect(f.tx.cashAccount.update).not.toHaveBeenCalled();
  });

  it('recognizes an own-source token after Cash Desk replaces sourceId with its movement identity', async () => {
    const f = setup();
    f.tx.supplierPayment.findMany.mockResolvedValue([
      prior({
        sourceId: 'movement',
        cashDeskMovement: {
          id: 'movement',
          requestId: uuid,
          supplierPaymentId: 'payment',
          kind: 'SUPPLIER_PAYMENT',
          reversedAt: null,
        },
      }),
    ]);
    await expect(payIntent(f)).resolves.toHaveProperty('payment.id', 'payment');
    expect(f.posting.postLines).not.toHaveBeenCalled();
  });

  it.each([
    { companyId: 'other' },
    { supplierId: 'other' },
    { amount: d(30) },
    { currency: 'USD' },
    { paymentDate: new Date('2026-10-02') },
    { cashAccountId: 'other' },
    { method: 'BANK_TRANSFER' },
    { reference: 'other' },
    { notes: 'other' },
    { sourceType: 'Payable' },
    { sourceId: 'other' },
    { purchaseAdvance: null },
    { purchaseAdvance: { purchaseOrderId: 'other' } },
    { status: 'REVERSED' },
    { deletedAt: new Date() },
    { journalEntry: { status: 'DRAFT' } },
  ])('refuses a previously consumed token with changed payload or source: %j', async (changed) => {
    const f = setup();
    f.tx.supplierPayment.findMany.mockResolvedValue([prior(changed)]);
    await expect(payIntent(f)).rejects.toThrow('different or reversed payment');
    expect(f.tx.purchaseOrder.findFirst).not.toHaveBeenCalled();
    expect(f.tx.cashAccount.update).not.toHaveBeenCalled();
    expect(f.posting.postLines).not.toHaveBeenCalled();
  });

  it('rejects ambiguous historical UUID casing duplicates', async () => {
    const f = setup();
    f.tx.supplierPayment.findMany.mockResolvedValue([
      prior(),
      prior({ id: 'other-payment', requestId: uuid }),
    ]);
    await expect(payIntent(f)).rejects.toThrow('conflicting historical');
    expect(f.tx.purchaseOrder.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a legacy AP settlement claim before touching a source or cash account', async () => {
    const f = setup();
    f.tx.journalEntry.findFirst.mockResolvedValue({ id: 'legacy' });
    await expect(payIntent(f)).rejects.toThrow('legacy payment');
    expect(f.tx.purchaseOrder.findFirst).not.toHaveBeenCalled();
    expect(f.tx.supplierPayment.findMany).not.toHaveBeenCalled();
    expect(f.posting.postLines).not.toHaveBeenCalled();
  });

  it('uses actual advances for a cash PO instead of its old inferred PAID flag', async () => {
    const { pay, tx, order } = setup();
    order.purchaseType = 'CASH_PURCHASE';
    order.paidAmount = d(100);
    order.outstandingAmount = d(0);
    tx.supplierPayment.aggregate.mockResolvedValue({
      _sum: { amount: d(25), unappliedAmount: d(50) },
    });
    await expect(pay('25.00')).resolves.toBeDefined();
    await expect(pay('75.01')).rejects.toThrow('remaining');
    expect(tx.supplierPayment.create).toHaveBeenCalledTimes(1);
  });
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
  it.each([false, true])(
    'preserves payment amounts when undoing application %s and allows reversal on the application business date',
    async (applied) => {
      const { service, tx, posting } = setup();
      tx.supplierPurchaseAdvance.findUnique = jest.fn(async () => ({
        id: 'advance',
        purchaseOrderId: 'po',
      }));
      tx.supplierPayment.findUniqueOrThrow = jest.fn(async () => ({
        id: 'payment',
        paymentNumber: 'SP-1',
        status: 'COMPLETED',
        paymentDate: new Date('2026-10-01'),
        amount: d(25),
        appliedAmount: d(applied ? 25 : 0),
        unappliedAmount: d(applied ? 0 : 25),
      }));
      tx.supplierPurchaseAdvanceApplication = {
        findMany: jest.fn(async () =>
          applied
            ? [
                {
                  id: 'application',
                  payable: { status: 'PARTIALLY_PAID' },
                  journalEntry: {
                    id: 'application-journal',
                    ...drawer,
                    transactionDate: new Date('2026-10-01T14:00:00Z'),
                    lines: [
                      { accountId: 'ap', debit: d(25), credit: d(0) },
                      { accountId: 'advance-asset', debit: d(0), credit: d(25) },
                    ],
                  },
                },
              ]
            : [],
        ),
        update: jest.fn(),
      };
      tx.journalEntry = { updateMany: jest.fn(async () => ({ count: 1 })) };
      await service.reverseApplications(tx, user, 'payment', new Date('2026-10-01'));
      expect(tx.supplierPayment.update).not.toHaveBeenCalled();
      expect(tx.cashAccount.update).not.toHaveBeenCalled();
      expect(posting.postLines).toHaveBeenCalledTimes(applied ? 1 : 0);
      if (applied)
        expect(posting.postLines.mock.calls[0][0].lines).toEqual([
          expect.objectContaining({ accountId: 'ap', debit: d(0), credit: d(25) }),
          expect.objectContaining({ accountId: 'advance-asset', debit: d(25), credit: d(0) }),
        ]);
    },
  );
});
