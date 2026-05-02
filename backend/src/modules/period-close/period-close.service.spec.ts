import { BadRequestException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PeriodCloseService } from './period-close.service';

function authUser(): AuthUser {
  return {
    id: 'closer-user',
    email: 'closer@itemba.local',
    roles: ['Accountant'],
    roleScopes: ['COMPANY'],
    permissions: ['period_close.close'],
    companyId: 'company-1',
    companyAccess: [{ companyId: 'company-1', accessLevel: AccessLevel.MANAGE }],
  };
}

function makePrisma() {
  const prisma: any = {
    accountingPeriodClose: {
      findFirst: jest.fn(),
      update: jest.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
      create: jest.fn(async (args: any) => ({ id: 'close-1', ...args.data })),
    },
    accountingPeriod: {
      findFirst: jest.fn(),
      update: jest.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
    },
    journalEntry: {
      count: jest.fn(async () => 0),
    },
    userCompanyAccess: {
      findMany: jest.fn(async () => []),
    },
  };
  prisma.$transaction = async (fn: any) => fn(prisma);
  return prisma;
}

function makeService(prisma: any) {
  return new PeriodCloseService(
    prisma,
    { log: jest.fn().mockResolvedValue(undefined) } as any,
    new CompanyScopeService(prisma),
  );
}

describe('PeriodCloseService GL controls', () => {
  beforeEach(() => jest.clearAllMocks());

  it('closes the underlying accounting period when the close is completed', async () => {
    const prisma = makePrisma();
    prisma.accountingPeriodClose.findFirst.mockResolvedValue({
      id: 'close-1',
      companyId: 'company-1',
      fiscalYearId: 'fy-1',
      accountingPeriodId: 'period-1',
      status: 'REVIEWING',
    });
    const service = makeService(prisma);

    await service.close('close-1', authUser());

    expect(prisma.accountingPeriodClose.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'close-1' },
        data: expect.objectContaining({ status: 'CLOSED', closedById: 'closer-user' }),
      }),
    );
    expect(prisma.accountingPeriod.update).toHaveBeenCalledWith({
      where: { id: 'period-1' },
      data: { status: 'CLOSED' },
    });
  });

  it('blocks period close while draft journals remain in the period', async () => {
    const prisma = makePrisma();
    prisma.accountingPeriodClose.findFirst.mockResolvedValue({
      id: 'close-1',
      companyId: 'company-1',
      fiscalYearId: 'fy-1',
      accountingPeriodId: 'period-1',
      status: 'REVIEWING',
    });
    prisma.journalEntry.count.mockResolvedValue(1);
    const service = makeService(prisma);

    await expect(service.close('close-1', authUser())).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.accountingPeriod.update).not.toHaveBeenCalled();
  });

  it('validates that close records match the requested company, fiscal year and period', async () => {
    const prisma = makePrisma();
    prisma.accountingPeriod.findFirst.mockResolvedValue({
      companyId: 'company-2',
      fiscalYearId: 'fy-1',
    });
    const service = makeService(prisma);

    await expect(
      service.create(
        {
          companyId: 'company-1',
          fiscalYearId: 'fy-1',
          accountingPeriodId: 'period-1',
          closeNumber: 'CLOSE-1',
        },
        authUser(),
      ),
    ).rejects.toThrow('Accounting period must belong to the requested company and fiscal year');
  });
});
