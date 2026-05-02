import { BadRequestException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { JournalEntriesService } from './journal-entries.service';

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'poster-user',
    email: 'poster@itemba.local',
    roles: ['Accountant'],
    roleScopes: ['COMPANY'],
    permissions: ['journal_entries.create', 'journal_entries.post'],
    companyId: 'company-1',
    companyAccess: [{ companyId: 'company-1', accessLevel: AccessLevel.MANAGE }],
    ...overrides,
  };
}

function makePrisma() {
  const prisma: any = {
    chartOfAccount: {
      count: jest.fn(async (args: any) => args.where.id.in.length),
    },
    journalEntry: {
      create: jest.fn(async (args: any) => ({ id: 'je-1', ...args.data })),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(async () => ({
        id: 'je-1',
        status: 'POSTED',
        companyId: 'company-1',
      })),
      update: jest.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    journalEntryLine: {
      createMany: jest.fn(async () => ({ count: 2 })),
    },
    userCompanyAccess: {
      findMany: jest.fn(async () => []),
    },
  };
  prisma.$transaction = async (fn: any) => fn(prisma);
  return prisma;
}

function makeService(prisma: any) {
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const accountingControl = {
    assertPostingAllowed: jest.fn(async () => ({
      id: 'period-1',
      companyId: 'company-1',
      fiscalYearId: 'fy-1',
    })),
  } as any;
  const companyScope = new CompanyScopeService(prisma);
  const codes = { next: jest.fn().mockResolvedValue('JE-TEST-1') } as any;
  const service = new JournalEntriesService(
    prisma,
    auditLogs,
    accountingControl,
    companyScope,
    codes,
  );
  return { service, accountingControl, auditLogs, codes };
}

describe('JournalEntriesService GL controls', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stores the resolved accounting period when creating a manual journal', async () => {
    const prisma = makePrisma();
    const { service, accountingControl } = makeService(prisma);

    await service.create(
      {
        companyId: 'company-1',
        transactionDate: '2026-04-15',
        description: 'Accrual',
        lines: [
          { accountId: 'expense', debit: 100 },
          { accountId: 'ap', credit: 100 },
        ],
      },
      authUser({ id: 'creator-user' }),
    );

    expect(accountingControl.assertPostingAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'company-1', moduleName: 'journal_entries' }),
    );
    expect(prisma.journalEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ accountingPeriodId: 'period-1', status: 'DRAFT' }),
      }),
    );
  });

  it('prevents the creator from posting their own draft journal', async () => {
    const prisma = makePrisma();
    prisma.journalEntry.findFirst.mockResolvedValue({
      id: 'je-1',
      companyId: 'company-1',
      status: 'DRAFT',
      createdById: 'same-user',
      accountingPeriodId: 'period-1',
      transactionDate: new Date('2026-04-15'),
      lines: [],
    });
    const { service } = makeService(prisma);

    await expect(service.post('je-1', authUser({ id: 'same-user' }))).rejects.toThrow(
      'Journal entries must be posted by a different user than the creator',
    );
    expect(prisma.journalEntry.updateMany).not.toHaveBeenCalled();
  });

  it('revalidates stored lines and active accounts before posting', async () => {
    const prisma = makePrisma();
    prisma.journalEntry.findFirst
      .mockResolvedValueOnce({
        id: 'je-1',
        companyId: 'company-1',
        status: 'DRAFT',
        createdById: 'creator-user',
        accountingPeriodId: 'period-1',
        transactionDate: new Date('2026-04-15'),
        lines: [
          { accountId: 'expense', debit: 100, credit: 0 },
          { accountId: 'ap', debit: 0, credit: 100 },
        ],
      })
      .mockResolvedValueOnce({
        id: 'je-1',
        companyId: 'company-1',
        status: 'DRAFT',
        createdById: 'creator-user',
        lines: [
          { accountId: 'expense', debit: 100, credit: 0 },
          { accountId: 'ap', debit: 0, credit: 100 },
        ],
      });
    const { service } = makeService(prisma);

    await service.post('je-1', authUser({ id: 'poster-user' }));

    expect(prisma.chartOfAccount.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'company-1',
          isActive: true,
          deletedAt: null,
        }),
      }),
    );
    expect(prisma.journalEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'je-1', status: 'DRAFT', deletedAt: null },
        data: expect.objectContaining({
          status: 'POSTED',
          accountingPeriodId: 'period-1',
          postedById: 'poster-user',
        }),
      }),
    );
  });

  it('rejects posting if stored lines were tampered out of balance', async () => {
    const prisma = makePrisma();
    prisma.journalEntry.findFirst
      .mockResolvedValueOnce({
        id: 'je-1',
        companyId: 'company-1',
        status: 'DRAFT',
        createdById: 'creator-user',
        accountingPeriodId: 'period-1',
        transactionDate: new Date('2026-04-15'),
        lines: [
          { accountId: 'expense', debit: 100, credit: 0 },
          { accountId: 'ap', debit: 0, credit: 100 },
        ],
      })
      .mockResolvedValueOnce({
        id: 'je-1',
        companyId: 'company-1',
        status: 'DRAFT',
        createdById: 'creator-user',
        lines: [
          { accountId: 'expense', debit: 100, credit: 0 },
          { accountId: 'ap', debit: 0, credit: 90 },
        ],
      });
    const { service } = makeService(prisma);

    await expect(service.post('je-1', authUser({ id: 'poster-user' }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.journalEntry.updateMany).not.toHaveBeenCalled();
  });

  it('posts reversals into the resolved reversal period, not the original period', async () => {
    const prisma = makePrisma();
    const original = {
      id: 'je-original',
      journalNumber: 'JE-ORIG',
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      status: 'POSTED',
      createdById: 'creator-user',
      accountingPeriodId: 'old-period',
      transactionDate: new Date('2026-03-15'),
      description: 'Original',
      referenceType: null,
      referenceId: null,
      totalDebit: 100,
      totalCredit: 100,
      reversalOfId: null,
      lines: [
        {
          accountId: 'expense',
          debit: 100,
          credit: 0,
          companyId: 'company-1',
          divisionId: null,
          branchId: null,
        },
        {
          accountId: 'ap',
          debit: 0,
          credit: 100,
          companyId: 'company-1',
          divisionId: null,
          branchId: null,
        },
      ],
    };
    prisma.journalEntry.findFirst.mockResolvedValue(original);
    const { service, accountingControl } = makeService(prisma);
    accountingControl.assertPostingAllowed.mockResolvedValueOnce({
      id: 'current-period',
      companyId: 'company-1',
      fiscalYearId: 'fy-1',
    });

    await service.reverse(
      'je-original',
      { reversalReason: 'Correction', transactionDate: '2026-04-10' },
      authUser({ id: 'poster-user' }),
    );

    expect(prisma.journalEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accountingPeriodId: 'current-period',
          status: 'POSTED',
          reversalOfId: 'je-original',
        }),
      }),
    );
  });
});
