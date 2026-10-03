import { CashDeskService } from './cash-desk.service';

/**
 * Party linkage, Phase 2 PR-1: the register says who the money went to and what it
 * settled, can be filtered by party, and search reaches the payee and the party name.
 */
describe('Cash Desk register party linkage', () => {
  const user = { id: 'branch-user' } as any;
  function setup() {
    const db = {
      cashDeskMovement: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'movement', entries: [] }),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const companies = { companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company' }) };
    const org = {
      recordWhereFor: jest.fn().mockResolvedValue({ divisionId: 'division', branchId: 'branch' }),
    };
    const service = new CashDeskService(
      db as any,
      companies as any,
      org as any,
      {} as any,
      {} as any,
    );
    return { db, service };
  }
  const linkageKeys = [
    'supplier',
    'customer',
    'payable',
    'receivable',
    'expense',
    'refund',
    'supplierPayment',
    'customerPayment',
    'invoicePayment',
    'salesPayment',
  ];

  it('includes the party and the settled documents on every register row and on the detail', async () => {
    const { db, service } = setup();
    await service.movements(user, { page: 1 } as any);
    const list = db.cashDeskMovement.findMany.mock.calls[0][0];
    expect(Object.keys(list.include)).toEqual(expect.arrayContaining(linkageKeys));
    expect(list.include.supplier).toEqual({ select: { id: true, name: true } });
    expect(list.include.invoicePayment.select.invoice).toEqual({
      select: { invoiceNumber: true },
    });
    expect(list.include.salesPayment.select.sale).toEqual({ select: { saleNumber: true } });
    expect(list.include.loanFinancialEvent).toEqual({ select: { loanId: true, id: true } });
    await service.movement(user, 'movement');
    const detail = db.cashDeskMovement.findFirst.mock.calls[0][0];
    expect(Object.keys(detail.include)).toEqual(expect.arrayContaining(linkageKeys));
  });

  it('filters the register by supplier, customer or party type without touching the account scope', async () => {
    const { db, service } = setup();
    await service.movements(user, {
      page: 1,
      supplierId: 'supplier-1',
      partyType: 'SUPPLIER',
    } as any);
    const { where } = db.cashDeskMovement.findMany.mock.calls[0][0];
    expect(where.AND).toEqual(
      expect.arrayContaining([{ supplierId: 'supplier-1', partyType: 'SUPPLIER' }]),
    );
    expect(where.AND[0]).toEqual({ entries: { some: { account: expect.anything() } } });
    expect(db.cashDeskMovement.count).toHaveBeenCalledWith({ where });
  });

  it('search reaches the payee and the linked party names on the register and the expense list', async () => {
    const { db, service } = setup();
    await service.movements(user, { page: 1, search: 'Mwanjalisi' } as any);
    const register = db.cashDeskMovement.findMany.mock.calls[0][0].where.AND.find(
      (clause: any) => clause.OR,
    );
    expect(register.OR).toEqual(
      expect.arrayContaining([
        { payee: { contains: 'Mwanjalisi', mode: 'insensitive' } },
        { supplier: { name: { contains: 'Mwanjalisi', mode: 'insensitive' } } },
        { customer: { name: { contains: 'Mwanjalisi', mode: 'insensitive' } } },
      ]),
    );
    await service.expenses(user, {
      page: 1,
      search: ' Mwanjalisi ',
      customerId: 'customer-1',
    } as any);
    const expenses = db.cashDeskMovement.findMany.mock.calls[1][0];
    expect(expenses.where.AND.find((clause: any) => clause.OR).OR).toEqual(
      expect.arrayContaining([
        { expenseNotes: { contains: 'Mwanjalisi', mode: 'insensitive' } },
        { supplier: { name: { contains: 'Mwanjalisi', mode: 'insensitive' } } },
      ]),
    );
    expect(expenses.where.AND).toEqual(expect.arrayContaining([{ customerId: 'customer-1' }]));
    expect(expenses.include.customer).toEqual({ select: { id: true, name: true } });
  });
});
