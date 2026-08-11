import { Prisma } from '@prisma/client';
import { BankReconciliationsService } from './bank-reconciliations.service';

/**
 * Unit coverage for the Wave B bank-reconciliation GL fixes:
 *   1. recomputeBalances signs each matched amount by the statement line's
 *      direction (bank DEBIT/outbound subtracts, bank CREDIT/inbound adds)
 *      instead of summing every match as a positive magnitude.
 *   2. runMatching resolves the GL cash/bank ChartOfAccount by role and queries
 *      JournalEntryLine.accountId against THAT ChartOfAccount id — not the
 *      CashAccount PK (which lives in a disjoint id pool and never matches).
 *
 * PrismaService, AccountResolverService and PostingEngineService are mocked in
 * the same style as peer service specs.
 */

const RECON_ID = 'recon-1';
const COMPANY_ID = 'company-1';
const CASH_ACCOUNT_ID = 'cash-account-1'; // CashAccount PK (NOT a ChartOfAccount id)
const CASH_CHART_ID = 'acct-BANK'; // ChartOfAccount id returned by the resolver

const user = { id: 'user-1', companyId: COMPANY_ID, permissions: [] } as any;

function baseReconciliation(overrides: any = {}) {
  return {
    id: RECON_ID,
    companyId: COMPANY_ID,
    cashAccountId: CASH_ACCOUNT_ID,
    reconciliationNumber: 'BR-0001',
    status: 'DRAFT',
    preparedById: 'preparer-1',
    bookOpeningBalance: new Prisma.Decimal(1000),
    statementClosingBalance: new Prisma.Decimal(0),
    statementLines: [],
    matches: [],
    ...overrides,
  };
}

function makeService(opts: {
  findOneReconciliation: any;
  recomputeReconciliation: any;
  candidates?: any[];
}) {
  const bankReconciliationUpdate = jest.fn(async ({ data }: any) => ({ id: RECON_ID, ...data }));
  const prisma = {
    // findOne() -> findFirst with statementLines + matches include
    bankReconciliation: {
      findFirst: jest.fn(async () => opts.findOneReconciliation),
      // recomputeBalances() -> findUniqueOrThrow with statementLines.matches include
      findUniqueOrThrow: jest.fn(async () => opts.recomputeReconciliation),
      update: bankReconciliationUpdate,
    },
    cashAccount: {
      findFirst: jest.fn(async () => ({
        accountType: 'BANK',
        divisionId: 'division-1',
        branchId: 'branch-1',
      })),
    },
    journalEntryLine: {
      findMany: jest.fn(async () => opts.candidates ?? []),
    },
    bankReconciliationMatch: {
      create: jest.fn(async ({ data }: any) => ({ id: 'match-created-1', ...data })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    bankStatementLine: {
      update: jest.fn(async ({ data }: any) => ({ id: 'line-1', ...data })),
    },
  } as any;

  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const postingEngine = {
    postLines: jest.fn().mockResolvedValue({ id: 'je-1', journalNumber: 'JE-1' }),
  } as any;
  const accountResolver = {
    resolve: jest.fn(async (_companyId: string, role: string) => ({
      id: `acct-${role}`,
      accountCode: role,
      accountName: role,
    })),
  } as any;

  const service = new BankReconciliationsService(prisma, auditLogs, accountResolver, postingEngine);
  return { service, prisma, accountResolver, postingEngine, bankReconciliationUpdate };
}

describe('BankReconciliationsService.recomputeBalances signing', () => {
  it('SUBTRACTS an outbound (bank DEBIT / withdrawal) matched line from the reconciled balance', async () => {
    const outboundLine = {
      id: 'line-out',
      debitAmount: new Prisma.Decimal(300), // bank debit => cash decreased
      creditAmount: new Prisma.Decimal(0),
      matches: [{ id: 'm1', amount: new Prisma.Decimal(300) }],
    };
    const { service, bankReconciliationUpdate } = makeService({
      findOneReconciliation: baseReconciliation({
        statementLines: [{ id: 'line-out', matched: true }],
      }),
      recomputeReconciliation: baseReconciliation({
        bookOpeningBalance: new Prisma.Decimal(1000),
        statementClosingBalance: new Prisma.Decimal(700),
        statementLines: [outboundLine],
      }),
    });

    // unmatch() is the simplest public entry point that calls recomputeBalances.
    await service.unmatch(RECON_ID, 'line-out', user);

    const updateArg = bankReconciliationUpdate.mock.calls.at(-1)![0];
    // reconciled = 1000 - 300 = 700 (outbound subtracted)
    expect(new Prisma.Decimal(updateArg.data.reconciledBalance).toNumber()).toBe(700);
    // difference = statementClosing(700) - reconciled(700) = 0 (fully reconciled)
    expect(new Prisma.Decimal(updateArg.data.differenceAmount).toNumber()).toBe(0);
  });

  it('ADDS an inbound (bank CREDIT / deposit) matched line to the reconciled balance', async () => {
    const inboundLine = {
      id: 'line-in',
      debitAmount: new Prisma.Decimal(0),
      creditAmount: new Prisma.Decimal(500), // bank credit => cash increased
      matches: [{ id: 'm2', amount: new Prisma.Decimal(500) }],
    };
    const { service, bankReconciliationUpdate } = makeService({
      findOneReconciliation: baseReconciliation({
        statementLines: [{ id: 'line-in', matched: true }],
      }),
      recomputeReconciliation: baseReconciliation({
        bookOpeningBalance: new Prisma.Decimal(1000),
        statementClosingBalance: new Prisma.Decimal(1500),
        statementLines: [inboundLine],
      }),
    });

    await service.unmatch(RECON_ID, 'line-in', user);

    const updateArg = bankReconciliationUpdate.mock.calls.at(-1)![0];
    // reconciled = 1000 + 500 = 1500 (inbound added)
    expect(new Prisma.Decimal(updateArg.data.reconciledBalance).toNumber()).toBe(1500);
    // difference = statementClosing(1500) - reconciled(1500) = 0
    expect(new Prisma.Decimal(updateArg.data.differenceAmount).toNumber()).toBe(0);
  });

  it('nets a mix of inbound and outbound matched lines with correct signs', async () => {
    const lines = [
      {
        id: 'line-in',
        debitAmount: new Prisma.Decimal(0),
        creditAmount: new Prisma.Decimal(500),
        matches: [{ id: 'm-in', amount: new Prisma.Decimal(500) }],
      },
      {
        id: 'line-out',
        debitAmount: new Prisma.Decimal(200),
        creditAmount: new Prisma.Decimal(0),
        matches: [{ id: 'm-out', amount: new Prisma.Decimal(200) }],
      },
    ];
    const { service, bankReconciliationUpdate } = makeService({
      findOneReconciliation: baseReconciliation({
        statementLines: [{ id: 'line-in', matched: true }],
      }),
      recomputeReconciliation: baseReconciliation({
        bookOpeningBalance: new Prisma.Decimal(1000),
        statementClosingBalance: new Prisma.Decimal(1300),
        statementLines: lines,
      }),
    });

    await service.unmatch(RECON_ID, 'line-in', user);

    const updateArg = bankReconciliationUpdate.mock.calls.at(-1)![0];
    // reconciled = 1000 + 500 - 200 = 1300
    expect(new Prisma.Decimal(updateArg.data.reconciledBalance).toNumber()).toBe(1300);
    expect(new Prisma.Decimal(updateArg.data.differenceAmount).toNumber()).toBe(0);
  });
});

describe('BankReconciliationsService.runMatching account resolution', () => {
  it('queries journal lines by the role-resolved ChartOfAccount id, not the CashAccount id', async () => {
    const statementLine = {
      id: 'line-1',
      matched: false,
      transactionDate: new Date('2026-06-15T00:00:00.000Z'),
      debitAmount: new Prisma.Decimal(0),
      creditAmount: new Prisma.Decimal(250),
    };
    const { service, prisma, accountResolver } = makeService({
      findOneReconciliation: baseReconciliation({
        statementLines: [statementLine],
      }),
      recomputeReconciliation: baseReconciliation({
        statementLines: [{ ...statementLine, matches: [] }],
      }),
      candidates: [],
    });

    await service.runMatching(RECON_ID, user);

    // Resolver was asked for the BANK role (cashAccount.accountType === 'BANK').
    expect(accountResolver.resolve).toHaveBeenCalledWith(COMPANY_ID, 'BANK');

    expect(prisma.journalEntryLine.findMany).toHaveBeenCalledTimes(1);
    const findManyArg = prisma.journalEntryLine.findMany.mock.calls[0][0];
    // Must query by the ChartOfAccount id from the resolver...
    expect(findManyArg.where.accountId).toBe(CASH_CHART_ID);
    // ...NOT the CashAccount PK (the old, always-empty behaviour).
    expect(findManyArg.where.accountId).not.toBe(CASH_ACCOUNT_ID);
    expect(findManyArg.where.companyId).toBe(COMPANY_ID);
  });

  it('auto-matches a statement line against a journal line on the resolved GL account', async () => {
    const statementLine = {
      id: 'line-1',
      matched: false,
      transactionDate: new Date('2026-06-15T00:00:00.000Z'),
      debitAmount: new Prisma.Decimal(0),
      creditAmount: new Prisma.Decimal(250), // inbound => expect a debit on cash
    };
    // Single candidate JE line: a debit of 250 on the resolved GL cash account.
    const candidate = {
      id: 'jel-1',
      accountId: CASH_CHART_ID,
      companyId: COMPANY_ID,
      debit: new Prisma.Decimal(250),
      credit: new Prisma.Decimal(0),
      description: 'Customer deposit',
      journalEntry: {
        id: 'je-1',
        transactionDate: new Date('2026-06-15T00:00:00.000Z'),
        description: 'Deposit',
        referenceType: null,
        referenceId: null,
      },
    };
    const { service, prisma } = makeService({
      findOneReconciliation: baseReconciliation({
        statementLines: [statementLine],
      }),
      recomputeReconciliation: baseReconciliation({
        statementLines: [{ ...statementLine, matches: [] }],
      }),
      candidates: [candidate],
    });

    const result = await service.runMatching(RECON_ID, user);

    expect(result.summary.autoMatched).toBe(1);
    expect(result.summary.ambiguous).toBe(0);
    expect(prisma.bankReconciliationMatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bankStatementLineId: 'line-1',
          matchedEntityType: 'JournalEntryLine',
          matchedEntityId: 'jel-1',
          matchType: 'AUTO_EXACT',
        }),
      }),
    );
    expect(prisma.bankStatementLine.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'line-1' },
        data: expect.objectContaining({ matched: true, matchedTransactionId: 'jel-1' }),
      }),
    );
  });
});
