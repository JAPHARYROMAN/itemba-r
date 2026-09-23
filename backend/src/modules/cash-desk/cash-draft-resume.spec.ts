import { NotFoundException } from '@nestjs/common';
import { CashDeskService } from './cash-desk.service';
import { CashDeskController } from './cash-desk.controller';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';

describe('Cash Desk draft source reads', () => {
  const user = { id: 'branch-user' } as any;
  function setup() {
    const db = {
      cashDeskMovement: { findFirst: jest.fn() },
      cashDeskLoan: { findFirst: jest.fn() },
    };
    const companies = {
      companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'allowed-company' }),
    };
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
    return { db, companies, org, service };
  }
  it('requires Cash Desk view access on both new source routes', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, CashDeskController)).toEqual(['cash_desk.view']);
    for (const method of ['movement', 'loan'] as const) {
      expect(
        Reflect.getMetadata(PERMISSIONS_KEY, CashDeskController.prototype[method]),
      ).toBeUndefined();
    }
  });
  it('finds a movement only through an accessible account and excludes inaccessible account entries', async () => {
    const { db, companies, org, service } = setup();
    const row = { id: 'movement', entries: [{ accountId: 'visible-account' }] };
    db.cashDeskMovement.findFirst.mockResolvedValue(row);
    expect(await service.movement(user, 'movement')).toBe(row);
    const query = db.cashDeskMovement.findFirst.mock.calls[0][0];
    expect(query.where.id).toBe('movement');
    const scope = query.where.entries.some.account;
    expect(scope.AND).toEqual(
      expect.arrayContaining([
        { companyId: 'allowed-company' },
        { divisionId: 'division', branchId: 'branch' },
      ]),
    );
    expect(query.include.entries.where.account).toEqual(scope);
    expect(query.include.loanFinancialEvent).toEqual({ select: { loanId: true, id: true } });
    expect(companies.companyWhereFor).toHaveBeenCalledWith(user, undefined);
    expect(org.recordWhereFor).toHaveBeenCalledWith(user);
  });
  it('requires at least one scoped party when reading an intercompany loan', async () => {
    const { db, service } = setup();
    db.cashDeskLoan.findFirst.mockResolvedValue({ id: 'loan', outstanding: '80' });
    expect(await service.loan(user, 'loan')).toEqual({ id: 'loan', outstanding: '80' });
    const query = db.cashDeskLoan.findFirst.mock.calls[0][0];
    expect(query.where.id).toBe('loan');
    expect(query.where.OR).toHaveLength(2);
    expect(query.where.OR[0].lender.AND).toEqual(
      expect.arrayContaining([
        { companyId: 'allowed-company' },
        { divisionId: 'division', branchId: 'branch' },
      ]),
    );
    expect(query.where.OR[1].borrower).toEqual(query.where.OR[0].lender);
    expect(Object.keys(query.include.lender.select).sort()).toEqual([
      'company',
      'companyId',
      'currency',
      'id',
      'name',
    ]);
  });
  it.each(['movement', 'loan'] as const)(
    'does not reveal an absent or out-of-scope %s',
    async (kind) => {
      const { db, service } = setup();
      db.cashDeskMovement.findFirst.mockResolvedValue(null);
      db.cashDeskLoan.findFirst.mockResolvedValue(null);
      await expect(service[kind](user, 'unavailable')).rejects.toBeInstanceOf(NotFoundException);
    },
  );
});
