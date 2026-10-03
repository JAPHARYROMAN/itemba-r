import { CashDeskService } from './cash-desk.service';

/**
 * Party linkage, Phase 2 PR-3: parties are picked at entry. An expense may name its
 * supplier and other money in its customer; the id must exist in the account's company,
 * the payee stays a display snapshot (defaulting to the supplier's name), and no movement
 * carries two parties or a party of the wrong kind.
 */
const user: any = { id: 'u1', fullName: 'Test', permissions: [] };
function setup() {
  const account: any = {
    id: 'a1',
    companyId: 'c1',
    divisionId: 'd1',
    branchId: 'b1',
    currency: 'TZS',
    kind: 'CASH',
  };
  const tx: any = {
    $queryRaw: jest.fn(),
    cashDeskMovement: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: any) => ({ id: 'created', ...data })),
    },
    supplier: { findUnique: jest.fn(async () => ({ name: 'Mwanjalisi Station' })) },
  };
  tx.$transaction = jest.fn(async (work: any) => work(tx));
  const companies: any = {
    companyWhereFor: jest.fn(async () => ({})),
    assertCanAccessCompany: jest.fn(),
  };
  const org: any = { recordWhereFor: jest.fn(async () => ({})), assertCanAccessScope: jest.fn() };
  const parties = { assertSupplier: jest.fn(), assertCustomer: jest.fn() };
  const service = new CashDeskService(
    tx,
    companies,
    org,
    {} as any,
    {} as any,
    undefined,
    undefined,
    parties as any,
  );
  jest.spyOn(service as any, 'writable').mockResolvedValue(account);
  jest.spyOn(service as any, 'lockAccounts').mockResolvedValue(undefined);
  jest.spyOn(service as any, 'entries').mockResolvedValue(undefined);
  jest.spyOn(service as any, 'auditMovement').mockResolvedValue(undefined);
  return { service, tx, parties };
}
const base = {
  requestId: 'req1',
  accountId: 'a1',
  amount: '25.00',
  businessDate: '2026-09-10',
  description: 'Fuel delivery',
  reference: 'R1',
};

describe('Cash Desk entry party', () => {
  it('links an expense to a supplier of the account company and defaults the payee to its name', async () => {
    const { service, tx, parties } = setup();
    await service.record(user, {
      ...base,
      kind: 'EXPENSE',
      expenseCategory: 'OTHER',
      supplierId: 'sup-1',
    } as any);
    expect(parties.assertSupplier).toHaveBeenCalledWith('c1', 'sup-1', tx);
    expect(tx.cashDeskMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'EXPENSE',
        supplierId: 'sup-1',
        customerId: null,
        partyType: 'SUPPLIER',
        payee: 'Mwanjalisi Station',
      }),
    });
  });
  it('keeps a typed payee and links other money in to its customer', async () => {
    const { service, tx, parties } = setup();
    await service.record(user, {
      ...base,
      kind: 'EXPENSE',
      expenseCategory: 'OTHER',
      supplierId: 'sup-1',
      payee: 'Driver',
    } as any);
    expect(tx.cashDeskMovement.create.mock.calls[0][0].data.payee).toBe('Driver');
    await service.record(user, {
      ...base,
      requestId: 'req2',
      kind: 'OTHER_IN',
      customerId: 'cus-1',
    } as any);
    expect(parties.assertCustomer).toHaveBeenCalledWith('c1', 'cus-1', tx);
    expect(tx.cashDeskMovement.create.mock.calls[1][0].data).toMatchObject({
      kind: 'OTHER_IN',
      customerId: 'cus-1',
      supplierId: null,
      partyType: 'CUSTOMER',
      payee: null,
    });
  });
  it('refuses a customer on an expense, a supplier on money in, or both parties at once', async () => {
    const { service, tx } = setup();
    for (const input of [
      { ...base, kind: 'EXPENSE', expenseCategory: 'OTHER', customerId: 'cus-1' },
      { ...base, kind: 'OTHER_IN', supplierId: 'sup-1' },
      {
        ...base,
        kind: 'EXPENSE',
        expenseCategory: 'OTHER',
        supplierId: 'sup-1',
        customerId: 'cus-1',
      },
    ])
      await expect(service.record(user, input as any)).rejects.toThrow('one party per movement');
    expect(tx.cashDeskMovement.create).not.toHaveBeenCalled();
  });
});
