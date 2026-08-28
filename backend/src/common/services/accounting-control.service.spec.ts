import { BadRequestException } from '@nestjs/common';
import { AccountingControlService } from './accounting-control.service';

const prisma = {
  accountingPeriod: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  accountingLock: {
    findFirst: jest.fn(),
  },
};

describe('AccountingControlService', () => {
  let service: AccountingControlService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AccountingControlService(prisma as any);
    prisma.accountingLock.findFirst.mockResolvedValue(null);
  });

  it('allows posting into an open period that contains the transaction date', async () => {
    prisma.accountingPeriod.findUnique.mockResolvedValue({
      id: 'period-1',
      companyId: 'company-1',
      status: 'OPEN',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-30'),
      fiscalYear: { id: 'fy-1', status: 'OPEN' },
    });

    await expect(
      service.assertPostingAllowed({
        companyId: 'company-1',
        accountingPeriodId: 'period-1',
        transactionDate: new Date('2026-04-15'),
        moduleName: 'journal_entries',
      }),
    ).resolves.toBeTruthy();
  });

  it('uses a supplied transaction client for authoritative period and lock checks', async () => {
    const transactionClient = {
      accountingPeriod: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'period-1',
          fiscalYearId: 'fy-1',
          companyId: 'company-1',
          status: 'OPEN',
          startDate: new Date('2026-04-01'),
          endDate: new Date('2026-04-30'),
          fiscalYear: { id: 'fy-1', status: 'OPEN' },
        }),
        findFirst: jest.fn(),
      },
      accountingLock: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    await service.assertPostingAllowed(
      {
        companyId: 'company-1',
        accountingPeriodId: 'period-1',
        transactionDate: new Date('2026-04-15'),
        moduleName: 'journal_entries',
      },
      transactionClient as any,
    );

    expect(transactionClient.accountingPeriod.findUnique).toHaveBeenCalledTimes(1);
    expect(transactionClient.accountingLock.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.accountingPeriod.findUnique).not.toHaveBeenCalled();
    expect(prisma.accountingLock.findFirst).not.toHaveBeenCalled();
  });

  it('rejects posting into a closed period', async () => {
    prisma.accountingPeriod.findUnique.mockResolvedValue({
      id: 'period-1',
      companyId: 'company-1',
      status: 'CLOSED',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-30'),
      fiscalYear: { id: 'fy-1', status: 'OPEN' },
    });

    await expect(
      service.assertPostingAllowed({
        companyId: 'company-1',
        accountingPeriodId: 'period-1',
        transactionDate: new Date('2026-04-15'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects period/company mismatch', async () => {
    prisma.accountingPeriod.findUnique.mockResolvedValue({
      id: 'period-1',
      companyId: 'company-2',
      status: 'OPEN',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-30'),
      fiscalYear: { id: 'fy-1', status: 'OPEN' },
    });

    await expect(
      service.assertPostingAllowed({
        companyId: 'company-1',
        accountingPeriodId: 'period-1',
        transactionDate: new Date('2026-04-15'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects transaction dates outside the period range', async () => {
    prisma.accountingPeriod.findUnique.mockResolvedValue({
      id: 'period-1',
      companyId: 'company-1',
      status: 'OPEN',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-30'),
      fiscalYear: { id: 'fy-1', status: 'OPEN' },
    });

    await expect(
      service.assertPostingAllowed({
        companyId: 'company-1',
        accountingPeriodId: 'period-1',
        transactionDate: new Date('2026-05-01'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects active accounting locks for the transaction date', async () => {
    prisma.accountingPeriod.findFirst.mockResolvedValue({
      id: 'period-1',
      fiscalYearId: 'fy-1',
      companyId: 'company-1',
      status: 'OPEN',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-30'),
      fiscalYear: { id: 'fy-1', status: 'OPEN' },
    });
    prisma.accountingLock.findFirst.mockResolvedValue({
      id: 'lock-1',
      accountingPeriodId: null,
      moduleName: null,
    });

    await expect(
      service.assertPostingAllowed({
        companyId: 'company-1',
        transactionDate: new Date('2026-04-15'),
        moduleName: 'journal_entries',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resolves the containing accounting period when no explicit period is supplied', async () => {
    prisma.accountingPeriod.findFirst.mockResolvedValue({
      id: 'period-2',
      fiscalYearId: 'fy-1',
      companyId: 'company-1',
      status: 'OPEN',
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-05-31'),
      fiscalYear: { id: 'fy-1', status: 'OPEN' },
    });

    const period = await service.assertPostingAllowed({
      companyId: 'company-1',
      transactionDate: new Date('2026-05-12'),
      moduleName: 'expenses',
    });

    expect(period.id).toBe('period-2');
    expect(prisma.accountingPeriod.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'company-1' }),
      }),
    );
  });

  it('rejects posting when the fiscal year is closed even if the period is open', async () => {
    prisma.accountingPeriod.findUnique.mockResolvedValue({
      id: 'period-1',
      companyId: 'company-1',
      status: 'OPEN',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-30'),
      fiscalYear: { id: 'fy-1', status: 'CLOSED' },
    });

    await expect(
      service.assertPostingAllowed({
        companyId: 'company-1',
        accountingPeriodId: 'period-1',
        transactionDate: new Date('2026-04-15'),
      }),
    ).rejects.toThrow('Fiscal year is not OPEN');
  });

  it('scopes the fiscal-year lock branch to year-wide locks only, not period-scoped locks (finding #11)', async () => {
    // Posting into an OPEN period whose fiscal year also contains a separately
    // closed period. The PERIOD_LOCK on the closed period carries fiscalYearId,
    // and it must NOT match this posting via the bare fiscalYearId branch.
    prisma.accountingPeriod.findFirst.mockResolvedValue({
      id: 'feb-period',
      fiscalYearId: 'fy-2026',
      companyId: 'company-1',
      status: 'OPEN',
      startDate: new Date('2026-02-01'),
      endDate: new Date('2026-02-28'),
      fiscalYear: { id: 'fy-2026', status: 'OPEN' },
    });
    prisma.accountingLock.findFirst.mockResolvedValue(null);

    await service.assertPostingAllowed({
      companyId: 'company-1',
      transactionDate: new Date('2026-02-15'),
      moduleName: 'journal_entries',
    });

    const whereArg = prisma.accountingLock.findFirst.mock.calls[0][0].where;
    const scopeOr = whereArg.AND[0].OR;
    // The fiscal-year branch must require accountingPeriodId IS NULL so a
    // period-scoped PERIOD_LOCK cannot over-match every period in the year.
    expect(scopeOr).toContainEqual({ accountingPeriodId: null, fiscalYearId: 'fy-2026' });
    // And it must NOT push a bare { fiscalYearId } that would match any
    // (period-scoped) lock in the fiscal year.
    expect(scopeOr).not.toContainEqual({ fiscalYearId: 'fy-2026' });
    // The exact-period branch is still present for the resolved period.
    expect(scopeOr).toContainEqual({ accountingPeriodId: 'feb-period' });
  });

  it('still blocks a genuine year-wide lock (no accountingPeriodId) for the fiscal year', async () => {
    prisma.accountingPeriod.findFirst.mockResolvedValue({
      id: 'feb-period',
      fiscalYearId: 'fy-2026',
      companyId: 'company-1',
      status: 'OPEN',
      startDate: new Date('2026-02-01'),
      endDate: new Date('2026-02-28'),
      fiscalYear: { id: 'fy-2026', status: 'OPEN' },
    });
    // A year-wide lock has accountingPeriodId null but fiscalYearId set; it must
    // match the { accountingPeriodId: null, fiscalYearId } branch.
    prisma.accountingLock.findFirst.mockResolvedValue({
      id: 'year-lock',
      accountingPeriodId: null,
      moduleName: null,
    });

    await expect(
      service.assertPostingAllowed({
        companyId: 'company-1',
        transactionDate: new Date('2026-02-15'),
        moduleName: 'journal_entries',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not let a journal-only module lock block unrelated modules', async () => {
    prisma.accountingPeriod.findFirst.mockResolvedValue({
      id: 'period-3',
      fiscalYearId: 'fy-1',
      companyId: 'company-1',
      status: 'OPEN',
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-06-30'),
      fiscalYear: { id: 'fy-1', status: 'OPEN' },
    });
    prisma.accountingLock.findFirst.mockResolvedValue(null);

    await service.assertPostingAllowed({
      companyId: 'company-1',
      transactionDate: new Date('2026-06-15'),
      moduleName: 'expenses',
    });

    expect(prisma.accountingLock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                { moduleName: null },
                { moduleName: { in: ['expenses', 'accounting', 'finance'] } },
              ]),
            }),
          ]),
        }),
      }),
    );
  });
});
