import { Prisma, BorrowerLevel, LoanStatus } from '@prisma/client';
import { LoansService } from './loans.service';

/**
 * Fully-mocked unit tests for the loan disbursement poster. No Postgres / real
 * Prisma client needed — the delegates the service touches are stubbed on a
 * mock `prisma` object and `$transaction` runs the callback inline.
 *
 * Focus (GL FIX, audit MED): create() must post the full-principal disbursement
 * JE (DR Cash/Bank / CR LOAN_PRINCIPAL_PAYABLE) ONLY for a genuinely new
 * drawdown funded through this system (outstandingBalance == principalAmount).
 * For an opening-balance / migrated loan (outstandingBalance < principalAmount)
 * NO disbursement JE is posted, so cash and the liability are not double-booked.
 */

const D = (v: number | string) => new Prisma.Decimal(v);

const USER = { id: 'user-1' } as any;

function baseDto(overrides?: Partial<any>) {
  return {
    obligationType: 'LOAN',
    borrowerLevel: BorrowerLevel.COMPANY,
    companyId: 'company-1',
    lenderName: 'Acme Bank',
    principalAmount: '1000000',
    interestRate: '12',
    disbursementDate: '2026-01-15',
    maturityDate: '2027-01-15',
    outstandingBalance: '1000000',
    ...overrides,
  } as any;
}

function makeService() {
  const loanCreate = jest.fn(async ({ data }: any) => ({
    id: 'loan-1',
    loanReference: null,
    lenderName: data.lenderName,
    companyId: data.companyId ?? null,
    divisionId: data.divisionId ?? null,
    branchId: data.branchId ?? null,
    ...data,
  }));

  const prisma: any = {
    loan: { create: loanCreate },
    bankAccount: { findFirst: jest.fn() },
    branch: { findFirst: jest.fn() },
    division: { findFirst: jest.fn() },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };

  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const accountResolver = {
    resolve: jest.fn(async (_companyId: string, role: string) =>
      role === 'LOAN_PRINCIPAL_PAYABLE' ? { id: 'acc-loan-payable' } : { id: 'acc-cash' },
    ),
  } as any;
  const postingEngine = {
    postLines: jest.fn(async () => ({ id: 'je-1', journalNumber: 'LOAN-2026-00001' })),
  } as any;
  const codes = { next: jest.fn(async () => 'LOAN-2026-00001') } as any;

  const service = new LoansService(
    prisma,
    auditLogs,
    companyScope,
    accountResolver,
    postingEngine,
    codes,
  );

  return { service, prisma, postingEngine, accountResolver, loanCreate };
}

describe('LoansService.create — disbursement journal entry', () => {
  it('posts a balanced DR Cash / CR LOAN_PRINCIPAL_PAYABLE JE for a new drawdown (outstanding == principal)', async () => {
    const { service, postingEngine } = makeService();

    await service.create(
      baseDto({ principalAmount: '1000000', outstandingBalance: '1000000' }),
      USER,
    );

    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    const [payload] = postingEngine.postLines.mock.calls[0];
    const lines = payload.lines;
    expect(lines).toHaveLength(2);

    const debit = lines.find((l: any) => new Prisma.Decimal(l.debit).gt(0));
    const credit = lines.find((l: any) => new Prisma.Decimal(l.credit).gt(0));
    expect(debit.accountId).toBe('acc-cash');
    expect(new Prisma.Decimal(debit.debit).toString()).toBe('1000000');
    expect(credit.accountId).toBe('acc-loan-payable');
    expect(new Prisma.Decimal(credit.credit).toString()).toBe('1000000');

    // Balanced: total debits === total credits.
    const totalDebit = lines.reduce((s: Prisma.Decimal, l: any) => s.plus(l.debit), D(0));
    const totalCredit = lines.reduce((s: Prisma.Decimal, l: any) => s.plus(l.credit), D(0));
    expect(totalDebit.equals(totalCredit)).toBe(true);

    expect(payload.referenceType).toBe('Loan');
    expect(payload.referenceId).toBe('loan-1');
  });

  it('does NOT post a disbursement JE for an opening-balance loan (outstanding < principal) — no double-booking of a migrated loan', async () => {
    const { service, postingEngine, accountResolver } = makeService();

    // Migrated loan: principal 1,000,000 but only 600,000 still outstanding
    // (400,000 was already repaid before this record existed). The cash landed
    // before the system, so no disbursement JE should be booked.
    const record = await service.create(
      baseDto({ principalAmount: '1000000', outstandingBalance: '600000' }),
      USER,
    );

    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(accountResolver.resolve).not.toHaveBeenCalled();
    // The loan (subledger) is still created with the opening outstanding balance.
    expect(new Prisma.Decimal(record.outstandingBalance).toString()).toBe('600000');
  });

  it('does NOT post a JE for a GROUP-level loan (no companyId to resolve a chart)', async () => {
    const { service, postingEngine } = makeService();

    await service.create(
      baseDto({
        borrowerLevel: BorrowerLevel.GROUP,
        companyId: undefined,
        groupId: 'group-1',
        outstandingBalance: '1000000',
      }),
      USER,
    );

    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });

  it('forces status to ACTIVE and persists the opening outstanding balance on the subledger row', async () => {
    const { service, loanCreate } = makeService();

    await service.create(baseDto({ outstandingBalance: '600000' }), USER);

    const { data } = loanCreate.mock.calls[0][0];
    expect(data.status).toBe(LoanStatus.ACTIVE);
    expect(new Prisma.Decimal(data.outstandingBalance).toString()).toBe('600000');
  });
});
