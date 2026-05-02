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
