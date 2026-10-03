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

/** Party linkage, Phase 3 PR-3: the raw period close runs the same gate and snapshot. */
describe('AccountingPeriodsService party control gate', () => {
  function periodPrisma() {
    const prisma: any = makePrisma();
    prisma.accountingPeriod.findFirst.mockResolvedValue({
      id: 'period-1',
      companyId: 'company-1',
      fiscalYearId: 'fy-1',
      status: 'OPEN',
      endDate: new Date('2026-09-30T00:00:00.000Z'),
    });
    prisma.$transaction = async (fn: any) => fn(prisma);
    return prisma;
  }
  const gate = () => ({
    checkOrRefuse: jest.fn(async () => ({ hasDifferences: true, rows: [], differences: [] })),
    snapshot: jest.fn(async () => 1),
    auditMetadata: jest.fn(() => ({ partyControl: { acknowledged: true, reason: 'r' } })),
    check: jest.fn(async () => ({ hasDifferences: true })),
    snapshots: jest.fn(async () => ({ rows: [] })),
  });

  it('closes with an acknowledgement, snapshots the period and audits the metadata', async () => {
    const prisma = periodPrisma();
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const g = gate();
    const service = new AccountingPeriodsService(
      prisma,
      audit as any,
      new CompanyScopeService(prisma),
      g as any,
    );
    await service.close('period-1', authUser(), { reason: 'Legacy lines await the backfill' });
    expect(g.checkOrRefuse).toHaveBeenCalledWith(
      'company-1',
      new Date('2026-09-30T00:00:00.000Z'),
      expect.objectContaining({ id: 'period-user' }),
      { reason: 'Legacy lines await the backfill' },
    );
    expect(g.snapshot).toHaveBeenCalledWith(
      prisma,
      { companyId: 'company-1', accountingPeriodId: 'period-1', userId: 'period-user' },
      expect.objectContaining({ hasDifferences: true }),
    );
    expect(prisma.accountingPeriod.update).toHaveBeenCalledWith({
      where: { id: 'period-1' },
      data: { status: 'CLOSED' },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ACCOUNTING_PERIOD_CLOSE',
        metadata: { partyControl: { acknowledged: true, reason: 'r' } },
      }),
    );
  });

  it('refuses before writing when the gate refuses, and still closes without the gate', async () => {
    const prisma = periodPrisma();
    const g = gate();
    g.checkOrRefuse.mockRejectedValue(new BadRequestException('differences'));
    const service = new AccountingPeriodsService(
      prisma,
      { log: jest.fn() } as any,
      new CompanyScopeService(prisma),
      g as any,
    );
    await expect(service.close('period-1', authUser())).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.accountingPeriod.update).not.toHaveBeenCalled();
    const bare = makeService(prisma);
    await bare.close('period-1', authUser());
    expect(prisma.accountingPeriod.update).toHaveBeenCalledWith({
      where: { id: 'period-1' },
      data: { status: 'CLOSED' },
    });
    await service.partySnapshots('period-1', authUser());
    expect(g.snapshots).toHaveBeenCalledWith('period-1');
  });
});
