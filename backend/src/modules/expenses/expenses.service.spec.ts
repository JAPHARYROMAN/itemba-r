import { BadRequestException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ExpensesService } from './expenses.service';

function authUser(): AuthUser {
  return {
    id: 'user-1',
    email: 'accountant@itemba.local',
    roles: ['Accountant'],
    permissions: ['expenses.pay'],
    companyId: 'company-1',
    companyAccess: [{ companyId: 'company-1', accessLevel: AccessLevel.MANAGE }],
  };
}

function approvedExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'expense-1',
    expenseNumber: 'EXP-2026-000001',
    companyId: 'company-1',
    divisionId: null,
    branchId: null,
    cashAccountId: null,
    currency: 'TZS',
    amount: 22500,
    description: 'Daily wages',
    paymentMethod: null,
    status: 'APPROVED',
    expenseCategory: { linkedAccountId: 'expense-ledger-1' },
    ...overrides,
  } as any;
}

function makeHarness() {
  const tx = {
    cashAccount: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    chartOfAccount: {
      findFirst: jest.fn().mockResolvedValue({ id: 'cash-ledger-1' }),
    },
    expense: {
      update: jest.fn().mockImplementation(async ({ data }: any) => ({
        ...approvedExpense(),
        ...data,
      })),
    },
  };
  const prisma = {
    cashAccount: { findMany: jest.fn() },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  } as any;
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const accountingControl = { assertPostingAllowed: jest.fn().mockResolvedValue(undefined) } as any;
  const codes = { next: jest.fn().mockResolvedValue('JE-2026-000001') } as any;
  const companyScope = {} as any;
  const postingEngine = { postLines: jest.fn().mockResolvedValue({ id: 'journal-1' }) } as any;
  const service = new ExpensesService(
    prisma,
    auditLogs,
    accountingControl,
    codes,
    companyScope,
    postingEngine,
  );

  return { service, prisma, tx, auditLogs, accountingControl, codes, postingEngine };
}

describe('ExpensesService payment account selection', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns only active accounts for the expense company and currency', async () => {
    const { service, prisma } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(approvedExpense());
    prisma.cashAccount.findMany.mockResolvedValue([{ id: 'cash-1', currency: 'TZS' }]);

    await expect(service.paymentOptions('expense-1', authUser())).resolves.toEqual([
      { id: 'cash-1', currency: 'TZS' },
    ]);

    expect(service.findOne).toHaveBeenCalledWith('expense-1', authUser(), AccessLevel.WRITE);
    expect(prisma.cashAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company-1',
          currency: 'TZS',
          deletedAt: null,
          isActive: true,
        },
      }),
    );
  });

  it('pays an approved expense from the account selected at payment time', async () => {
    const { service, tx, auditLogs, postingEngine } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(approvedExpense());
    tx.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-1',
      companyId: 'company-1',
      accountName: 'Kisimani Cash Account',
      accountType: 'CASH_ON_HAND',
      currency: 'TZS',
    });

    const result = await service.pay(
      'expense-1',
      { cashAccountId: 'cash-1', paymentMethod: 'CASH' },
      authUser(),
    );

    expect(tx.cashAccount.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'cash-1',
        companyId: 'company-1',
        currency: 'TZS',
        deletedAt: null,
        isActive: true,
      },
    });
    expect(tx.cashAccount.update).toHaveBeenCalledWith({
      where: { id: 'cash-1' },
      data: { currentBalance: { decrement: 22500 } },
    });
    expect(tx.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PAID',
          cashAccountId: 'cash-1',
          paymentMethod: 'CASH',
          journalEntryId: 'journal-1',
        }),
      }),
    );
    expect(postingEngine.postLines).toHaveBeenCalled();
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EXPENSE_PAY',
        newValue: expect.objectContaining({ cashAccountId: 'cash-1' }),
      }),
    );
    expect(result.status).toBe('PAID');
  });

  it('rejects an account that is inactive, belongs to another company, or uses another currency', async () => {
    const { service, tx, postingEngine } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(approvedExpense());
    tx.cashAccount.findFirst.mockResolvedValue(null);

    await expect(
      service.pay('expense-1', { cashAccountId: 'invalid-account' }, authUser()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.expense.update).not.toHaveBeenCalled();
  });
});
