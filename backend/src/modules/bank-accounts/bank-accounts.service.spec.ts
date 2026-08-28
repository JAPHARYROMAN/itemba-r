import { ForbiddenException } from '@nestjs/common';
import { BankAccountsService } from './bank-accounts.service';

const user = { id: 'user-1' } as any;

function bankAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bank-1',
    companyId: 'company-1',
    divisionId: null,
    branchId: null,
    groupId: null,
    bankName: 'Evidence Bank',
    branchName: null,
    accountName: 'Operating Account',
    accountNumber: '123456780001',
    accountType: 'CURRENT',
    currency: 'TZS',
    isActive: true,
    isPrimary: false,
    openedDate: null,
    swiftCode: null,
    bankAddress: null,
    notes: null,
    createdById: 'user-1',
    deletedAt: null,
    ...overrides,
  };
}

function makeHarness() {
  const existing = bankAccount();
  const prisma = {
    bankAccount: {
      findFirst: jest.fn().mockResolvedValue(existing),
      create: jest.fn(async ({ data }: any) => bankAccount({ ...data })),
      update: jest.fn(async ({ data }: any) => bankAccount({ ...data })),
    },
    cashAccount: {
      findFirst: jest.fn().mockResolvedValue({ id: 'cash-1' }),
      create: jest.fn(async ({ data }: any) => ({ id: 'cash-created', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'cash-1', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    branch: { findFirst: jest.fn() },
    division: { findFirst: jest.fn() },
  } as any;
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = {
    assertGroupScoped: jest.fn(),
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;
  return {
    service: new BankAccountsService(prisma, auditLogs, companyScope),
    prisma,
    auditLogs,
    companyScope,
  };
}

describe('BankAccountsService governed mutation lookup', () => {
  it('retains the explicit sensitive-read audit on the human findOne path', async () => {
    const { service, auditLogs, companyScope } = makeHarness();

    await expect(service.findOne('bank-1', user)).resolves.toMatchObject({ id: 'bank-1' });

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'company-1');
    expect(auditLogs.log).toHaveBeenCalledTimes(1);
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SENSITIVE_VIEW',
        entityType: 'BankAccount',
        entityId: 'bank-1',
        userId: 'user-1',
        companyId: 'company-1',
      }),
    );
  });

  it('updates the bank and linked cash projection without an internal read audit', async () => {
    const { service, prisma, auditLogs, companyScope } = makeHarness();

    await service.update('bank-1', { accountName: 'Updated Account' }, user);

    expect(companyScope.assertGroupScoped).toHaveBeenCalledWith(user, 'update bank accounts');
    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'company-1');
    expect(prisma.cashAccount.update).toHaveBeenCalledWith({
      where: { id: 'cash-1' },
      data: {
        companyId: 'company-1',
        divisionId: null,
        branchId: null,
        accountName: 'Evidence Bank - Updated Account (0001)',
        accountType: 'BANK',
        currency: 'TZS',
        isActive: true,
      },
    });
    expect(auditLogs.log).toHaveBeenCalledTimes(1);
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityType: 'BankAccount',
        entityId: 'bank-1',
        userId: 'user-1',
        companyId: 'company-1',
      }),
    );
    expect(auditLogs.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SENSITIVE_VIEW' }),
    );
  });

  it('archives the bank and linked cash projection without an internal read audit', async () => {
    const { service, prisma, auditLogs, companyScope } = makeHarness();

    await service.remove('bank-1', user);

    expect(companyScope.assertGroupScoped).toHaveBeenCalledWith(user, 'delete bank accounts');
    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'company-1');
    expect(prisma.cashAccount.updateMany).toHaveBeenCalledWith({
      where: { linkedBankAccountId: 'bank-1', deletedAt: null },
      data: { isActive: false, deletedAt: expect.any(Date) },
    });
    expect(auditLogs.log).toHaveBeenCalledTimes(1);
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DELETE',
        entityType: 'BankAccount',
        entityId: 'bank-1',
        userId: 'user-1',
        companyId: 'company-1',
      }),
    );
    expect(auditLogs.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SENSITIVE_VIEW' }),
    );
  });

  it.each(['update', 'remove'] as const)(
    'denies a foreign-company %s before either projection can mutate',
    async (operation) => {
      const { service, prisma, auditLogs, companyScope } = makeHarness();
      companyScope.assertCanAccessCompany.mockRejectedValueOnce(
        new ForbiddenException('Company access denied'),
      );

      const call =
        operation === 'update'
          ? service.update('bank-1', { accountName: 'Forbidden' }, user)
          : service.remove('bank-1', user);
      await expect(call).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.bankAccount.update).not.toHaveBeenCalled();
      expect(prisma.cashAccount.update).not.toHaveBeenCalled();
      expect(prisma.cashAccount.updateMany).not.toHaveBeenCalled();
      expect(auditLogs.log).not.toHaveBeenCalled();
    },
  );

  it('denies a foreign-company create before either compound row can be written', async () => {
    const { service, prisma, auditLogs, companyScope } = makeHarness();
    companyScope.assertCanAccessCompany.mockRejectedValueOnce(
      new ForbiddenException('Company access denied'),
    );

    await expect(
      service.create(
        {
          companyId: 'company-2',
          bankName: 'Forbidden Bank',
          accountName: 'Forbidden Account',
          accountNumber: '999900001111',
        },
        user,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.bankAccount.create).not.toHaveBeenCalled();
    expect(prisma.cashAccount.create).not.toHaveBeenCalled();
    expect(auditLogs.log).not.toHaveBeenCalled();
  });
});
