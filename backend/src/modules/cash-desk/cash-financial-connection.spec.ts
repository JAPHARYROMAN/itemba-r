import { Prisma } from '@prisma/client';
import { CashDeskService } from './cash-desk.service';
const d = (n: number) => new Prisma.Decimal(n);
const user: any = {
  id: 'u1',
  fullName: 'Test',
  permissions: ['invoice_desk.view', 'invoice_desk.payments'],
};
function setup() {
  const account: any = {
    id: 'a1',
    companyId: 'c1',
    divisionId: 'd1',
    branchId: 'b1',
    currency: 'TZS',
    kind: 'BANK',
  };
  const original: any = {
    id: 'm1',
    kind: 'EXPENSE',
    amount: d(25),
    currency: 'TZS',
    businessDate: new Date('2026-09-10'),
    entries: [{ accountId: 'a1', amount: d(-25) }],
  };
  const tx: any = {
    $queryRaw: jest.fn(),
    cashDeskMovement: {
      findFirst: jest.fn(async () => original),
      findUnique: jest.fn(async () => null),
      updateMany: jest.fn(async () => ({ count: 1 })),
      create: jest.fn(async ({ data }: any) => ({ id: 'created', ...data })),
    },
    invoiceDeskPayment: {
      findFirst: jest.fn(async () => ({
        id: 'p1',
        amount: d(25),
        paymentDate: new Date('2026-09-10'),
      })),
    },
  };
  tx.$transaction = jest.fn(async (work: any) => work(tx));
  const companies: any = {
    companyWhereFor: jest.fn(async () => ({})),
    assertCanAccessCompany: jest.fn(),
  };
  const org: any = { recordWhereFor: jest.fn(async () => ({})), assertCanAccessScope: jest.fn() };
  const invoices: any = {
    detail: jest.fn(async () => ({ ...account, id: 'i1' })),
    paymentInTransaction: jest.fn(),
  };
  const connections: any = { reverseInTransaction: jest.fn() };
  const service = new CashDeskService(tx, companies, org, {} as any, invoices, connections);
  jest.spyOn(service as any, 'writable').mockResolvedValue(account);
  jest.spyOn(service as any, 'lockAccounts').mockResolvedValue(undefined);
  const entries = jest.spyOn(service as any, 'entries').mockResolvedValue(undefined);
  jest.spyOn(service as any, 'auditMovement').mockResolvedValue(undefined);
  return { service, tx, invoices, connections, entries };
}
describe('Cash operational and financial connection', () => {
  const input: any = {
    requestId: 'req1',
    kind: 'SUPPLIER_PAYMENT',
    accountId: 'a1',
    invoiceId: 'i1',
    existingInvoicePaymentId: 'p1',
    amount: '25.00',
    businessDate: '2026-09-10',
    description: 'Link payment',
    reference: 'P1',
  };
  it('links an existing invoice payment without paying the invoice twice', async () => {
    const { service, tx, invoices, entries } = setup();
    await service.record(user, input);
    expect(invoices.paymentInTransaction).not.toHaveBeenCalled();
    expect(tx.cashDeskMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ invoicePaymentId: 'p1', kind: 'SUPPLIER_PAYMENT' }),
    });
    expect((entries.mock.calls[0][3] as { amount: Prisma.Decimal }[])[0].amount.eq(-25)).toBe(true);
  });
  it('blocks linking the same payment again or with a changed amount', async () => {
    const { service, tx } = setup();
    await expect(service.record(user, { ...input, amount: '26.00' })).rejects.toThrow(
      'original amount',
    );
    tx.cashDeskMovement.findUnique.mockImplementation(async ({ where }: any) =>
      where.invoicePaymentId ? { id: 'already-linked' } : null,
    );
    await expect(service.record(user, input)).rejects.toThrow('already linked');
    expect(tx.cashDeskMovement.create).not.toHaveBeenCalled();
  });
  it('runs the cash journal reversal inside the same transaction and propagates failures', async () => {
    const { service, connections, tx } = setup();
    const request: any = {
      requestId: 'reverse1',
      businessDate: '2026-09-19',
      reason: 'Correction',
    };
    await service.reverse(user, 'm1', request);
    expect(connections.reverseInTransaction).toHaveBeenCalledWith(
      tx,
      user,
      'm1',
      'created',
      new Date('2026-09-19'),
      'Correction',
    );
    connections.reverseInTransaction.mockRejectedValue(new Error('Period is closed'));
    await expect(service.reverse(user, 'm1', request)).rejects.toThrow('Period is closed');
  });
});
