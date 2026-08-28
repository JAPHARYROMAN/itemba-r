import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { MobileMoneyAccountsController } from './mobile-money-accounts.controller';
import { MobileMoneyAccountsService } from './mobile-money-accounts.service';

const USER = {
  id: 'user-a',
  companyId: 'company-a',
  companyAccess: [],
  roleScopes: ['COMPANY'],
} as any;

describe('MobileMoneyAccountsService read scope', () => {
  function makeService(employee: { id: string } | null) {
    const employeeFindFirst = jest.fn().mockResolvedValue(employee);
    const accountFindMany = jest.fn().mockResolvedValue([{ id: 'account-a' }]);
    const prisma = {
      employee: { findFirst: employeeFindFirst },
      mobileMoneyAccount: { findMany: accountFindMany },
    } as any;
    const companyScope = {
      companyWhereFor: jest.fn().mockResolvedValue({ companyId: { in: ['company-a'] } }),
    } as any;
    const service = new MobileMoneyAccountsService(prisma, {} as any, companyScope);
    return { service, employeeFindFirst, accountFindMany, companyScope };
  }

  it('resolves the employee through the authenticated caller company filter', async () => {
    const { service, employeeFindFirst, accountFindMany, companyScope } = makeService({
      id: 'employee-a',
    });

    await expect(service.findByEmployee('employee-a', USER)).resolves.toEqual([
      { id: 'account-a' },
    ]);

    expect(companyScope.companyWhereFor).toHaveBeenCalledWith(USER);
    expect(employeeFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'employee-a',
        deletedAt: null,
        companyId: { in: ['company-a'] },
      },
      select: { id: true },
    });
    expect(accountFindMany).toHaveBeenCalledWith({
      where: { employeeId: 'employee-a', deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  });

  it('returns not-found without reading accounts when the scoped employee is foreign', async () => {
    const { service, accountFindMany } = makeService(null);

    await expect(service.findByEmployee('employee-b', USER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(accountFindMany).not.toHaveBeenCalled();
  });
});

describe('MobileMoneyAccountsService remove company scope', () => {
  const ACCOUNT = {
    id: 'account-a',
    employeeId: 'employee-a',
    provider: 'MPESA',
    msisdn: '+255700000001',
    isPrimary: false,
    status: 'ACTIVE',
    deletedAt: null,
    employee: { companyId: 'company-a' },
  };

  function makeRemoveHarness() {
    const prisma = {
      mobileMoneyAccount: {
        findFirst: jest.fn().mockResolvedValue(ACCOUNT),
        update: jest.fn().mockResolvedValue({ ...ACCOUNT, status: 'CLOSED' }),
      },
    } as any;
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const companyScope = {
      assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    } as any;
    const service = new MobileMoneyAccountsService(prisma, audit, companyScope);
    return { service, prisma, audit, companyScope };
  }

  it('passes the full actor context from the controller to the service', async () => {
    const remove = jest.fn().mockResolvedValue({ success: true });
    const controller = new MobileMoneyAccountsController({ remove } as any);

    await expect(controller.remove('account-a', USER)).resolves.toEqual({ success: true });

    expect(remove).toHaveBeenCalledWith('account-a', USER);
  });

  it('requires employee-company WRITE before soft deletion', async () => {
    const { service, prisma, audit, companyScope } = makeRemoveHarness();

    await expect(service.remove('account-a', USER)).resolves.toEqual({ success: true });

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      USER,
      'company-a',
      AccessLevel.WRITE,
    );
    expect(prisma.mobileMoneyAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-a' },
      data: { deletedAt: expect.any(Date), status: 'CLOSED' },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER.id,
        action: 'DELETE',
        entityType: 'MobileMoneyAccount',
        entityId: 'account-a',
        companyId: 'company-a',
        oldValue: expect.not.objectContaining({ employee: expect.anything() }),
      }),
    );
  });

  it('rejects READ-only access before mutation or audit', async () => {
    const { service, prisma, audit, companyScope } = makeRemoveHarness();
    const denied = new ForbiddenException('write access required');
    companyScope.assertCanAccessCompany.mockRejectedValueOnce(denied);

    await expect(service.remove('account-a', USER)).rejects.toBe(denied);

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      USER,
      'company-a',
      AccessLevel.WRITE,
    );
    expect(prisma.mobileMoneyAccount.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});
