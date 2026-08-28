import { ConflictException } from '@nestjs/common';
import { AuditScopeKind, Prisma } from '@prisma/client';
import { IntercompanyTransactionsService } from './intercompany-transactions.service';

/**
 * Fully-mocked unit tests for the intercompany post() path. No Postgres / real
 * Prisma client needed — the interCompanyTransaction delegate and the posting
 * engine / account resolver are stubbed the way peer specs
 * (credit-notes.service.spec.ts, customer-payments.service.spec.ts) do.
 *
 * Focus: the atomic status guard added to post(). Two concurrent posts of the
 * same APPROVED transaction must produce exactly ONE pair of balanced journal
 * entries — the loser sees the claim's count===0 and throws instead of
 * double-posting both companies' ledgers.
 */

const D = (v: number | string) => new Prisma.Decimal(v);

type TxnState = {
  id: string;
  transactionNumber: string;
  fromCompanyId: string;
  toCompanyId: string;
  transactionType: string;
  amount: Prisma.Decimal;
  currency: string;
  transactionDate: Date;
  description: string;
  status: string;
  postedAt: Date | null;
  fromCompanyJournalEntryId: string | null;
  toCompanyJournalEntryId: string | null;
  createdById: string | null;
  approvedById: string | null;
  approvedAt: Date | null;
  rejectedReason: string | null;
  deletedAt: Date | null;
};

function makeService(opts?: { txn?: Partial<TxnState> }) {
  const txn: TxnState = {
    id: 'ic-1',
    transactionNumber: 'IC-2026-00001',
    fromCompanyId: 'company-A',
    toCompanyId: 'company-B',
    transactionType: 'CASH_TRANSFER',
    amount: D('1000000'),
    currency: 'TZS',
    transactionDate: new Date('2026-06-15'),
    description: 'Working capital transfer',
    status: 'APPROVED',
    postedAt: null,
    fromCompanyJournalEntryId: null,
    toCompanyJournalEntryId: null,
    createdById: 'user-1',
    approvedById: 'user-1',
    approvedAt: new Date('2026-06-14'),
    rejectedReason: null,
    deletedAt: null,
    ...opts?.txn,
  };

  const interCompanyTransaction = {
    findFirst: jest.fn(async () => ({
      ...txn,
      fromCompany: { id: txn.fromCompanyId, name: 'A', code: 'A' },
      toCompany: { id: txn.toCompanyId, name: 'B', code: 'B' },
      createdBy: { id: 'user-1', fullName: 'User One' },
      approvedBy: { id: 'user-1', fullName: 'User One' },
    })),
    update: jest.fn(async ({ data }: any) => {
      Object.assign(txn, data);
      return { ...txn };
    }),
    // Emulate the atomic status-guarded claim: only succeeds while the row is
    // still in the required status; a second concurrent claim sees count 0.
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (where.status && txn.status !== where.status) return { count: 0 };
      Object.assign(txn, data);
      return { count: 1 };
    }),
  };

  const prisma: any = {
    interCompanyTransaction,
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };

  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const accountingControl = {
    assertPostingAllowed: jest.fn().mockResolvedValue(undefined),
  } as any;
  const accountResolver = {
    resolveMany: jest.fn(async (companyId: string, roles: string[]) => {
      const out: Record<string, { id: string }> = {};
      for (const role of roles) out[role] = { id: `${companyId}:${role}` };
      return out;
    }),
  } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    accessibleCompanyIds: jest.fn().mockResolvedValue(['company-A', 'company-B']),
    isGroupScoped: jest.fn().mockReturnValue(true),
  } as any;
  const codes = {
    next: jest.fn(async ({ companyId }: any) => `JE-${companyId}-1`),
  } as any;
  let jeSeq = 0;
  const postingEngine = {
    postLines: jest.fn(async (input: any) => ({
      id: `je-${input.companyId}-${++jeSeq}`,
      journalNumber: input.journalNumber,
    })),
  } as any;

  const service = new IntercompanyTransactionsService(
    prisma,
    auditLogs,
    accountingControl,
    accountResolver,
    companyScope,
    codes,
    postingEngine,
  );

  return {
    service,
    prisma,
    txn,
    postingEngine,
    accountResolver,
    interCompanyTransaction,
    auditLogs,
  };
}

const user = { id: 'user-1', permissions: [] } as any;

function totalDebit(lines: any[]) {
  return lines.reduce((s, l) => s.plus(new Prisma.Decimal(l.debit ?? 0)), D('0'));
}
function totalCredit(lines: any[]) {
  return lines.reduce((s, l) => s.plus(new Prisma.Decimal(l.credit ?? 0)), D('0'));
}

describe('IntercompanyTransactionsService.post — balanced dual-company journal entries', () => {
  it('posts Dr IC-Receivable / Cr Cash in the FROM company and Dr Cash / Cr IC-Payable in the TO company, both balanced', async () => {
    const { service, postingEngine } = makeService();

    await service.post('ic-1', user);

    expect(postingEngine.postLines).toHaveBeenCalledTimes(2);

    const fromPosting = postingEngine.postLines.mock.calls[0][0];
    const toPosting = postingEngine.postLines.mock.calls[1][0];

    expect(fromPosting.companyId).toBe('company-A');
    expect(toPosting.companyId).toBe('company-B');

    // FROM company: Dr IC-Receivable 1,000,000 / Cr Cash 1,000,000
    const fromAr = fromPosting.lines.find(
      (l: any) => l.accountId === 'company-A:INTERCOMPANY_RECEIVABLE',
    )!;
    const fromCash = fromPosting.lines.find((l: any) => l.accountId === 'company-A:CASH_ON_HAND')!;
    expect(new Prisma.Decimal(fromAr.debit).toString()).toBe('1000000');
    expect(new Prisma.Decimal(fromCash.credit).toString()).toBe('1000000');
    expect(totalDebit(fromPosting.lines).equals(totalCredit(fromPosting.lines))).toBe(true);

    // TO company: Dr Cash 1,000,000 / Cr IC-Payable 1,000,000
    const toCash = toPosting.lines.find((l: any) => l.accountId === 'company-B:CASH_ON_HAND')!;
    const toAp = toPosting.lines.find(
      (l: any) => l.accountId === 'company-B:INTERCOMPANY_PAYABLE',
    )!;
    expect(new Prisma.Decimal(toCash.debit).toString()).toBe('1000000');
    expect(new Prisma.Decimal(toAp.credit).toString()).toBe('1000000');
    expect(totalDebit(toPosting.lines).equals(totalCredit(toPosting.lines))).toBe(true);

    expect(fromPosting.referenceType).toBe('InterCompanyTransaction');
    expect(toPosting.referenceType).toBe('InterCompanyTransaction');
  });

  it('marks the record POSTED via the atomic claim and stores both journal entry ids', async () => {
    const { service, txn, interCompanyTransaction } = makeService();

    await service.post('ic-1', user);

    // The status flip happened through the guarded updateMany claim, not a
    // blind update.
    expect(interCompanyTransaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'ic-1', status: 'APPROVED', deletedAt: null }),
        data: expect.objectContaining({ status: 'POSTED' }),
      }),
    );
    expect(txn.status).toBe('POSTED');
    expect(txn.postedAt).toBeInstanceOf(Date);
    expect(txn.fromCompanyJournalEntryId).toBe('je-company-A-1');
    expect(txn.toCompanyJournalEntryId).toBe('je-company-B-2');

    // The final update only attaches JE ids; it must NOT re-flip status.
    const finalUpdate = interCompanyTransaction.update.mock.calls[0][0];
    expect(finalUpdate.data.status).toBeUndefined();
    expect(finalUpdate.data.fromCompanyJournalEntryId).toBe('je-company-A-1');
    expect(finalUpdate.data.toCompanyJournalEntryId).toBe('je-company-B-2');
  });

  it('attributes the post audit to both affected companies', async () => {
    const { service, auditLogs } = makeService();

    await service.post('ic-1', user);

    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'INTERCOMPANY_POST',
        scopeKind: AuditScopeKind.MULTI_COMPANY,
        companyScopeIds: ['company-A', 'company-B'],
      }),
    );
  });
});

describe('IntercompanyTransactionsService.post — atomic double-post guard', () => {
  it('rejects a non-APPROVED transaction before entering the transaction (no JE posted)', async () => {
    const { service, postingEngine } = makeService({ txn: { status: 'POSTED' } });

    await expect(service.post('ic-1', user)).rejects.toThrow(
      'Only APPROVED transactions can be posted',
    );
    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });

  it('the loser of a concurrent post sees the claim yield count 0 and throws ConflictException without posting', async () => {
    const { service, txn, postingEngine, interCompanyTransaction } = makeService();

    // Simulate a racing request that already won the claim: the first
    // updateMany call flips the row to POSTED (count 1); every later claim on
    // the same still-APPROVED where-clause now sees a mismatch (count 0).
    // We drive this by having the FIRST updateMany also record that the row
    // was already claimed by a competitor before our lines are written.
    const original = interCompanyTransaction.updateMany.getMockImplementation()!;
    interCompanyTransaction.updateMany.mockImplementationOnce(async (args: any) => {
      // A competitor won first: flip the shared row to POSTED, then our own
      // guarded claim (this very call) must observe the mismatch and lose.
      txn.status = 'POSTED';
      return original(args);
    });

    await expect(service.post('ic-1', user)).rejects.toBeInstanceOf(ConflictException);

    // Losing the claim means NO journal entries were written for this caller.
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    // And the JE-id attaching update never ran.
    expect(interCompanyTransaction.update).not.toHaveBeenCalled();
  });
});
