import { Prisma } from '@prisma/client';
import { CashPurchasesService } from './cash-purchases.service';
import { CashDeskService } from './cash-desk.service';

const dec = (v: number) => new Prisma.Decimal(v);
const user: any = {
  id: 'office',
  permissions: [
    'payables.view',
    'supplier-payments.view',
    'supplier-payments.manage',
    'mobile_pos_lite.manage',
  ],
};
const input: any = {
  requestId: 'req',
  accountId: 'desk',
  kind: 'SUPPLIER_PAYMENT',
  payableId: 'payable',
  supplierId: 'supplier',
  amount: '25.00',
  businessDate: '2026-10-01',
  description: 'Purchase payment',
  reference: 'SI-1',
};
function setup() {
  const account: any = {
    id: 'desk',
    erpCashAccountId: 'cash',
    companyId: 'company',
    divisionId: 'division',
    branchId: 'branch',
    kind: 'CASH',
    currency: 'TZS',
    openingDate: new Date('2026-01-01'),
    version: 1,
  };
  const payable: any = {
    id: 'payable',
    companyId: 'company',
    divisionId: 'division',
    branchId: 'branch',
    supplierId: 'supplier',
    supplier: { id: 'supplier', name: 'Supplier' },
    currency: 'TZS',
    issueDate: new Date('2026-09-25'),
    status: 'OPEN',
    outstandingAmount: dec(100),
    supplierInvoices: [
      {
        id: 'invoice',
        supplierInvoiceNumber: 'SI-1',
        companyId: 'company',
        supplierId: 'supplier',
        currency: 'TZS',
        invoiceDate: new Date('2026-09-25'),
      },
    ],
    purchaseOrders: [],
  };
  const cash: any = {
    id: 'cash',
    companyId: 'company',
    divisionId: 'division',
    branchId: 'branch',
    accountType: 'CASH_ON_HAND',
    currency: 'TZS',
    currentBalance: dec(500),
    ledgerAccount: {
      id: 'ledger',
      companyId: 'company',
      accountType: 'ASSET',
      isActive: true,
      deletedAt: null,
    },
  };
  const tx: any = {
    $queryRaw: jest.fn(),
    mobilePosEnrollment: { findFirst: jest.fn(async () => null) },
    mobilePosTerminal: { findMany: jest.fn(async () => []) },
    cashAccount: { findFirst: jest.fn(async () => cash) },
    payable: {
      findFirst: jest.fn(async () => payable),
      findMany: jest.fn(async () => [payable]),
      count: jest.fn(async () => 1),
    },
    invoiceDeskInvoice: {
      fields: { totalAmount: 'field-ref' },
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    },
    purchaseOrder: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
    supplierPayment: {
      findUnique: jest.fn(async ({ where }: any) => (where.id ? { supplierId: 'supplier' } : null)),
      update: jest.fn(),
    },
    cashDeskAccount: {
      findFirst: jest.fn(async () => account),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    cashDeskMovement: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 'movement', ...data })),
    },
  };
  tx.$transaction = jest.fn(async (work: any) => work(tx));
  const companies: any = {
    companyWhereFor: jest.fn(async () => ({})),
    assertCanAccessCompany: jest.fn(),
  };
  const org: any = {
    recordWhereFor: jest.fn(async () => ({ branchId: 'branch' })),
    assertCanAccessScope: jest.fn(),
  };
  const payments: any = {
    lockPayable: jest.fn(async () => payable),
    createInTransaction: jest.fn(async () => ({
      payment: {
        id: 'payment',
        journalEntryId: 'journal',
        sourceType: 'CashDesk',
        sourceId: 'req',
      },
    })),
    reverseInTransaction: jest.fn(),
  };
  const purchases = new CashPurchasesService(tx, companies, org, payments);
  const service = new CashDeskService(
    tx,
    companies,
    org,
    {} as any,
    {} as any,
    undefined,
    undefined,
    undefined,
    purchases,
  );
  jest.spyOn(service as any, 'writable').mockResolvedValue(account);
  const entries = jest.spyOn(service as any, 'entries').mockResolvedValue(undefined);
  jest.spyOn(service as any, 'auditMovement').mockResolvedValue(undefined);
  return { account, payable, cash, tx, org, payments, purchases, service, entries };
}

describe('Cash Desk existing purchase settlements', () => {
  it('owns one movement while the canonical service owns AP, ERP cash and the journal', async () => {
    const { service, tx, payments, entries } = setup();
    const movement = await service.record(user, input);
    expect(movement).toMatchObject({
      kind: 'SUPPLIER_PAYMENT',
      payableId: 'payable',
      supplierPaymentId: 'payment',
      supplierId: 'supplier',
      journalEntryId: 'journal',
    });
    expect(payments.createInTransaction).toHaveBeenCalledWith(
      tx,
      user,
      expect.objectContaining({
        cashAccountId: 'cash',
        allocations: [{ payableId: 'payable', amount: dec(25) }],
      }),
      { cashDeskOwnsMovement: true },
    );
    expect(payments.createInTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      tx.cashDeskAccount.updateMany.mock.invocationCallOrder[0],
    );
    expect(tx.supplierPayment.update).toHaveBeenCalledWith({
      where: { id: 'payment' },
      data: { cashDeskMovementId: 'movement', sourceId: 'movement' },
    });
    expect((entries.mock.calls[0][3] as { amount: Prisma.Decimal }[])[0].amount.eq(-25)).toBe(true);
  });
  it('replays the original exact request before accounting effects and rejects changed actor/payload', async () => {
    const { service, tx, payments } = setup();
    const first = await service.record(user, input);
    tx.cashDeskMovement.findUnique.mockResolvedValue(first);
    await expect(service.record(user, { ...input })).resolves.toEqual(first);
    expect(payments.createInTransaction).toHaveBeenCalledTimes(1);
    await expect(service.record(user, { ...input, amount: '26' })).rejects.toThrow('already used');
    await expect(service.record({ ...user, id: 'different' }, input)).rejects.toThrow(
      'already used',
    );
  });
  it('rejects unrelated supplier-payment key collisions without creating any money effects', async () => {
    const { service, tx, payments } = setup();
    tx.supplierPayment.findUnique.mockResolvedValue({ id: 'unrelated' });
    await expect(service.record(user, input)).rejects.toThrow('another supplier payment');
    expect(payments.createInTransaction).not.toHaveBeenCalled();
    expect(tx.cashDeskMovement.create).not.toHaveBeenCalled();
  });
  it.each([
    { invoiceId: 'invoice' },
    { invoiceVersion: 2 },
    { supplierId: undefined },
    { customerId: 'customer' },
  ])('rejects ambiguous document or party inputs %j', async (change) => {
    const { service, payments } = setup();
    await expect(service.record(user, { ...input, ...change })).rejects.toThrow();
    expect(payments.createInTransaction).not.toHaveBeenCalled();
  });
  it.each([
    { tokenUse: 'mobile-pos' },
    { mobilePosRole: 'CASHIER' },
    { mobilePosRole: 'STOCKIST' },
  ])('denies POS staff before accounting effects %j', async (claims) => {
    const { service, tx, payments } = setup();
    await expect(service.record({ ...user, ...claims }, input)).rejects.toThrow('POS Draft');
    expect(payments.createInTransaction).not.toHaveBeenCalled();
    expect(tx.cashDeskMovement.create).not.toHaveBeenCalled();
  });
  it('denies enrolled workers using broad legacy password permissions', async () => {
    const { service, tx, payments } = setup();
    tx.mobilePosEnrollment.findFirst.mockResolvedValue({ id: 'staff-enrollment' });
    await expect(service.record(user, input)).rejects.toThrow('POS Draft');
    expect(payments.createInTransaction).not.toHaveBeenCalled();
  });
  it.each(['mapping', 'ledger', 'funds', 'supplier', 'date', 'scope'])(
    'rejects invalid %s before posting',
    async (issue) => {
      const { service, account, cash, payable, org, payments } = setup();
      if (issue === 'mapping') account.erpCashAccountId = null;
      if (issue === 'ledger') cash.ledgerAccount.accountType = 'EXPENSE';
      if (issue === 'funds') cash.currentBalance = dec(10);
      if (issue === 'supplier') payable.supplierId = 'other';
      if (issue === 'date') payable.supplierInvoices[0].invoiceDate = new Date('2026-10-02');
      if (issue === 'scope')
        org.assertCanAccessScope.mockRejectedValue(new Error('Forbidden branch'));
      await expect(service.record(user, input)).rejects.toThrow();
      expect(payments.createInTransaction).not.toHaveBeenCalled();
    },
  );
  it('returns scoped, bounded purchase choices and current selected paid state', async () => {
    const { purchases, tx, payable } = setup();
    payable.status = 'PAID';
    payable.outstandingAmount = dec(0);
    const page = await purchases.options(user, {
      accountId: 'desk',
      supplierId: 'supplier',
      source: 'PAYABLE',
      id: 'payable',
      page: 1,
      pageSize: 20,
    });
    expect(page.rows[0]).toMatchObject({
      source: 'PAYABLE',
      supplierId: 'supplier',
      status: 'PAID',
      outstanding: '0.00',
      canPay: false,
      purchaseInvoiceId: 'invoice',
    });
    expect(tx.payable.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 20,
        skip: 0,
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { branchId: 'branch' },
            expect.objectContaining({
              companyId: 'company',
              supplierId: 'supplier',
              id: 'payable',
            }),
          ]),
        }),
      }),
    );
  });
  it('uses separate source permissions and does not fetch canonical records without payable view', async () => {
    const { purchases, tx } = setup();
    await purchases.options(
      { ...user, permissions: ['invoice_desk.view', 'invoice_desk.payments'] },
      { accountId: 'desk', page: 1, pageSize: 20 },
    );
    expect(tx.payable.count).not.toHaveBeenCalled();
    expect(tx.payable.findMany).not.toHaveBeenCalled();
  });
  it('exposes existing PO and invoice identities while retaining the payable as the payment target', async () => {
    const { purchases, payable } = setup();
    payable.supplierInvoices = [];
    payable.purchaseOrders = [
      {
        id: 'order',
        purchaseOrderNumber: 'PO-1',
        internalInvoiceNumber: 'PINV-2026-000001',
        supplierInvoiceNumber: 'SUP-1',
      },
    ];
    const page = await purchases.options(user, {
      accountId: 'desk',
      search: 'PINV-2026-000001',
      page: 1,
      pageSize: 20,
    });
    expect(page.rows[0]).toMatchObject({
      id: 'payable',
      source: 'PAYABLE',
      number: 'SUP-1',
      internalInvoiceNumber: 'PINV-2026-000001',
      supplierInvoiceNumber: 'SUP-1',
      purchaseOrderNumber: 'PO-1',
    });
  });
  it('returns bounded scoped pending-order matches only with purchase view permission', async () => {
    const { purchases, tx } = setup();
    tx.payable.count.mockResolvedValue(0);
    tx.payable.findMany.mockResolvedValue([]);
    tx.purchaseOrder.findMany.mockResolvedValue([{ id: 'pending', status: 'CONFIRMED' }]);
    const query = {
      accountId: 'desk',
      supplierId: 'supplier',
      search: 'PINV-2026-000001',
      page: 1,
      pageSize: 20,
    };
    const page = await purchases.options(
      { ...user, permissions: [...user.permissions, 'purchases.view'] },
      query,
    );
    expect(page.rows).toEqual([]);
    expect(page.orderMatches).toEqual([{ id: 'pending', status: 'CONFIRMED' }]);
    expect(tx.purchaseOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5,
        where: {
          AND: expect.arrayContaining([
            { branchId: 'branch' },
            expect.objectContaining({
              companyId: 'company',
              supplierId: 'supplier',
              currency: 'TZS',
              NOT: expect.any(Array),
            }),
          ]),
        },
      }),
    );
    tx.purchaseOrder.findMany.mockClear();
    await purchases.options(user, query);
    expect(tx.purchaseOrder.findMany).not.toHaveBeenCalled();
  });
});
