import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { CashAccountsService } from './cash-accounts.service';

/** Party linkage, Phase 3 PR-8: one cash balance, the Cash Desk one when the book is unified. */
const row = (over: Record<string, unknown> = {}) => ({
  id: 'bank-1',
  companyId: 'c1',
  accountName: 'Main bank',
  currency: 'TZS',
  currentBalance: new Prisma.Decimal('90'),
  deskAccount: {
    id: 'desk-1',
    name: 'Main till',
    balance: new Prisma.Decimal('100'),
    currency: 'TZS',
  },
  ...over,
});
function setup(flag: string | undefined, rows: any[]) {
  const prisma: any = {
    cashAccount: {
      findMany: jest.fn(async () => rows),
      count: jest.fn(async () => rows.length),
      findFirst: jest.fn(async () => rows[0] ?? null),
    },
  };
  const companyScope: any = {
    companyWhereFor: jest.fn(async () => ({ companyId: 'c1' })),
    assertCanAccessCompany: jest.fn(),
  };
  const config = new ConfigService(flag === undefined ? {} : { CASH_BOOK_UNIFIED: flag });
  const service = new CashAccountsService(prisma, { log: jest.fn() } as any, companyScope, config);
  return { prisma, service, user: { id: 'u1' } as any };
}

describe('CashAccountsService one cash balance', () => {
  it('shows the Cash Desk balance as the balance when the book is unified, keeping the stored figure as the mirror', async () => {
    const { service, user, prisma } = setup('true', [row()]);
    const list = await service.findAll({ page: 1, limit: 20 } as any, user);
    expect(prisma.cashAccount.findMany.mock.calls[0][0].include).toMatchObject({
      deskAccount: { select: { id: true, name: true, balance: true, currency: true } },
    });
    expect(list.data[0]).toMatchObject({
      id: 'bank-1',
      currentBalance: new Prisma.Decimal('100'),
      mirrorBalance: new Prisma.Decimal('90'),
      balanceSource: 'cash-desk',
      cashDeskAccount: { id: 'desk-1', name: 'Main till', currency: 'TZS' },
    });
    expect(list.data[0]).not.toHaveProperty('deskAccount');
    const one = await service.findOne('bank-1', user);
    expect(one).toMatchObject({
      currentBalance: new Prisma.Decimal('100'),
      balanceSource: 'cash-desk',
    });
    const byCompany = await service.findByCompany('c1', user);
    expect(byCompany[0]).toMatchObject({ balanceSource: 'cash-desk' });
  });

  it('keeps the stored balance while the flag is off or the account has no Cash Desk connection', async () => {
    const off = setup('false', [row()]);
    expect(
      (await off.service.findAll({ page: 1, limit: 20 } as any, off.user)).data[0],
    ).toMatchObject({
      currentBalance: new Prisma.Decimal('90'),
      mirrorBalance: new Prisma.Decimal('90'),
      balanceSource: 'stored',
      cashDeskAccount: { id: 'desk-1' },
    });
    const unconnected = setup('true', [row({ deskAccount: null })]);
    expect(await unconnected.service.findOne('bank-1', unconnected.user)).toMatchObject({
      currentBalance: new Prisma.Decimal('90'),
      balanceSource: 'stored',
      cashDeskAccount: null,
    });
    const noConfig = new CashAccountsService(
      unconnected.prisma,
      { log: jest.fn() } as any,
      { assertCanAccessCompany: jest.fn(), companyWhereFor: jest.fn(async () => ({})) } as any,
    );
    expect(noConfig.unified()).toBe(false);
  });
});
