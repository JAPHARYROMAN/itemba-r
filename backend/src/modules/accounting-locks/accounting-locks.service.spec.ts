import { BadRequestException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AccountingLocksService } from './accounting-locks.service';

function authUser(): AuthUser {
  return {
    id: 'lock-user',
    email: 'lock@itemba.local',
    roles: ['Accountant'],
    roleScopes: ['COMPANY'],
    permissions: ['accounting_locks.create'],
    companyId: 'company-1',
    companyAccess: [{ companyId: 'company-1', accessLevel: AccessLevel.MANAGE }],
  };
}

function makePrisma() {
  return {
    accountingLock: {
      findFirst: jest.fn(),
      create: jest.fn(async (args: any) => ({ id: 'lock-1', ...args.data })),
      update: jest.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
    },
    accountingPeriod: {
      findFirst: jest.fn(async () => ({ companyId: 'company-1', fiscalYearId: 'fy-1' })),
    },
    fiscalYear: {
      findFirst: jest.fn(async () => ({ companyId: 'company-1' })),
    },
    userCompanyAccess: {
      findMany: jest.fn(async () => []),
    },
  } as any;
}

function makeService(prisma: any) {
  return new AccountingLocksService(
    prisma,
    { log: jest.fn().mockResolvedValue(undefined) } as any,
    new CompanyScopeService(prisma),
  );
}

describe('AccountingLocksService GL controls', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates active locks only after validating company scope and lock scope', async () => {
    const prisma = makePrisma();
    prisma.accountingLock.findFirst.mockResolvedValue(null);
    const service = makeService(prisma);

    await service.create(
      {
        lockCode: 'LOCK-1',
        companyId: 'company-1',
        lockType: 'PERIOD_LOCK',
        fiscalYearId: 'fy-1',
        accountingPeriodId: 'period-1',
        lockedFrom: new Date('2026-04-01'),
        lockedTo: new Date('2026-04-30'),
      },
      authUser(),
    );

    expect(prisma.accountingPeriod.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'period-1' } }),
    );
    expect(prisma.fiscalYear.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'fy-1' } }),
    );
    expect(prisma.accountingLock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACTIVE', createdById: 'lock-user' }),
      }),
    );
  });

  it('converts date-string lock bounds to Date objects before persisting', async () => {
    const prisma = makePrisma();
    prisma.accountingLock.findFirst.mockResolvedValue(null);
    const service = makeService(prisma);

    await service.create(
      {
        lockCode: 'LOCK-3',
        companyId: 'company-1',
        lockType: 'CUSTOM',
        lockedFrom: '2026-04-01',
        lockedTo: '2026-04-30',
      },
      authUser(),
    );

    expect(prisma.accountingLock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lockedFrom: new Date('2026-04-01'),
          lockedTo: new Date('2026-04-30'),
        }),
      }),
    );
  });

  it('rejects inverted lock date ranges', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    await expect(
      service.create(
        {
          lockCode: 'LOCK-1',
          companyId: 'company-1',
          lockType: 'CUSTOM',
          lockedFrom: new Date('2026-05-01'),
          lockedTo: new Date('2026-04-01'),
        },
        authUser(),
      ),
    ).rejects.toThrow('Lock start date cannot be after lock end date');
    expect(prisma.accountingLock.create).not.toHaveBeenCalled();
  });

  it('rejects overlapping active locks for the same scope', async () => {
    const prisma = makePrisma();
    prisma.accountingLock.findFirst.mockResolvedValue({ id: 'existing-lock' });
    const service = makeService(prisma);

    await expect(
      service.create(
        {
          lockCode: 'LOCK-2',
          companyId: 'company-1',
          lockType: 'PERIOD_LOCK',
          fiscalYearId: 'fy-1',
          accountingPeriodId: 'period-1',
          lockedFrom: new Date('2026-04-01'),
          lockedTo: new Date('2026-04-30'),
        },
        authUser(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.accountingLock.create).not.toHaveBeenCalled();
  });
});
