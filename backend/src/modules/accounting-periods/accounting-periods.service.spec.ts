import { BadRequestException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AccountingPeriodsService } from './accounting-periods.service';

function authUser(): AuthUser {
  return {
    id: 'period-user',
    email: 'period@itemba.local',
    roles: ['Accountant'],
    roleScopes: ['COMPANY'],
    permissions: ['accounting_periods.manage'],
    companyId: 'company-1',
    companyAccess: [{ companyId: 'company-1', accessLevel: AccessLevel.MANAGE }],
  };
}

function makePrisma() {
  return {
    accountingPeriod: {
      create: jest.fn(async (args: any) => ({ id: 'period-1', ...args.data })),
      findFirst: jest.fn(),
      update: jest.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
    },
    fiscalYear: {
      findFirst: jest.fn(async () => ({
        companyId: 'company-1',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      })),
    },
    userCompanyAccess: {
      findMany: jest.fn(async () => []),
    },
  } as any;
}

function makeService(prisma: any) {
  return new AccountingPeriodsService(
    prisma,
    { log: jest.fn().mockResolvedValue(undefined) } as any,
    new CompanyScopeService(prisma),
  );
}

describe('AccountingPeriodsService GL controls', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects accounting periods outside the fiscal year', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    await expect(
      service.create(
        {
          companyId: 'company-1',
          fiscalYearId: 'fy-1',
          name: 'JAN-2027',
          startDate: '2027-01-01',
          endDate: '2027-01-31',
        },
        authUser(),
      ),
    ).rejects.toThrow('Accounting period must fall within the fiscal year');
    expect(prisma.accountingPeriod.create).not.toHaveBeenCalled();
  });

  it('rejects overlapping accounting periods in the same fiscal year', async () => {
    const prisma = makePrisma();
    prisma.accountingPeriod.findFirst.mockResolvedValue({ id: 'existing-period' });
    const service = makeService(prisma);

    await expect(
      service.create(
        {
          companyId: 'company-1',
          fiscalYearId: 'fy-1',
          name: 'JAN-2026',
          startDate: '2026-01-01',
          endDate: '2026-01-31',
        },
        authUser(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.accountingPeriod.create).not.toHaveBeenCalled();
  });

  it('creates non-overlapping periods within the fiscal year', async () => {
    const prisma = makePrisma();
    prisma.accountingPeriod.findFirst.mockResolvedValue(null);
    const service = makeService(prisma);

    const period = await service.create(
      {
        companyId: 'company-1',
        fiscalYearId: 'fy-1',
        name: 'JAN-2026',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      },
      authUser(),
    );

    expect(period.id).toBe('period-1');
    expect(prisma.accountingPeriod.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          fiscalYearId: 'fy-1',
        }),
      }),
    );
  });
});
