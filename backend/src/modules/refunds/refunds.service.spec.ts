import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RefundsService } from './refunds.service';
import { RefundStatus } from './dto/refund-status.enum';

const user = { id: 'user-1' } as any;

function draftRefund(overrides: Record<string, unknown> = {}) {
  return {
    id: 'refund-1',
    refundNumber: 'Refund-2026-000001',
    companyId: 'company-1',
    divisionId: 'division-1',
    branchId: 'branch-1',
    customerId: 'customer-1',
    customerName: 'Acme Ltd',
    creditNoteId: 'cn-1',
    receivableId: null,
    cashAccountId: 'cash-1',
    amount: new Prisma.Decimal(100),
    currency: 'TZS',
    refundDate: new Date('2026-06-01T00:00:00.000Z'),
    status: RefundStatus.DRAFT,
    reason: null,
    notes: null,
    journalEntryId: null,
    reversalJournalEntryId: null,
    createdById: 'user-1',
    postedById: null,
    postedAt: null,
    voidedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeService(opts: {
  refund?: Record<string, any>;
  creditNote?: Record<string, any>;
  cashAccount?: Record<string, any> | null;
  journalEntry?: Record<string, any>;
  postLines?: jest.Mock;
} = {}) {
  const cashAccount =
    opts.cashAccount === undefined
      ? {
          id: 'cash-1',
          companyId: 'company-1',
          divisionId: 'division-1',
          branchId: 'branch-1',
          accountType: 'CASH_ON_HAND',
          accountName: 'Main Till',
        }
      : opts.cashAccount;

  const refundDelegate = {
    findFirst: jest.fn(async () => draftRefund()),
    findMany: jest.fn(async () => [draftRefund()]),
    count: jest.fn(async () => 1),
    create: jest.fn(async ({ data }: any) => ({ ...draftRefund(), ...data })),
    update: jest.fn(async ({ data }: any) => ({ ...draftRefund(), ...data })),
    updateMany: jest.fn(async () => ({ count: 1 })),
    aggregate: jest.fn(async () => ({ _sum: { amount: new Prisma.Decimal(0) } })),
    ...opts.refund,
  };

  const creditNoteDelegate = {
    findFirst: jest.fn(async () => ({
      id: 'cn-1',
      companyId: 'company-1',
      customerId: 'customer-1',
      receivableId: null,
      totalAmount: new Prisma.Decimal(100),
      appliedAmount: new Prisma.Decimal(0),
      currency: 'TZS',
      status: 'ISSUED',
      deletedAt: null,
    })),
    ...opts.creditNote,
  };

  const journalEntryDelegate = {
    findFirst: jest.fn(async () => ({
      id: 'je-1',
      companyId: 'company-1',
      divisionId: 'division-1',
      branchId: 'branch-1',
      referenceType: 'Refund',
      referenceId: 'refund-1',
      status: 'POSTED',
      lines: [
        { accountId: 'acc-ar', debit: new Prisma.Decimal(100), credit: new Prisma.Decimal(0), description: 'Release customer credit', divisionId: null, branchId: null },
        { accountId: 'acc-cash', debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(100), description: 'Refund paid', divisionId: null, branchId: null },
      ],
    })),
    updateMany: jest.fn(async () => ({ count: 1 })),
    ...opts.journalEntry,
  };

  const prisma: any = {
    refund: refundDelegate,
    creditNote: creditNoteDelegate,
    journalEntry: journalEntryDelegate,
    cashAccount: {
      findFirst: jest.fn(async () => cashAccount),
      update: jest.fn(async ({ data }: any) => ({ ...(cashAccount ?? {}), ...data })),
    },
    customer: { findFirst: jest.fn(async () => ({ companyId: 'company-1' })) },
    $executeRaw: jest.fn(async () => 1),
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    accessibleCompanyIds: jest.fn().mockResolvedValue(['company-1']),
  } as any;
  const accountResolver = {
    resolve: jest.fn(async (_c: string, role: string) => ({
      id: role === 'AR_CONTROL' ? 'acc-ar' : 'acc-cash',
      accountCode: role === 'AR_CONTROL' ? '1100' : '1000',
      accountName: role,
    })),
  } as any;
  const postLines =
    opts.postLines ?? jest.fn(async () => ({ id: 'je-1', journalNumber: 'JE-REFUNDS-1' }));
  const postingEngine = { postLines } as any;
  const codes = { next: jest.fn(async () => 'Refund-2026-000001') } as any;

  const service = new RefundsService(
    prisma,
    auditLogs,
    companyScope,
    accountResolver,
    postingEngine,
    codes,
  );
  return { service, prisma, auditLogs, companyScope, accountResolver, postingEngine, postLines, codes };
}

describe('RefundsService.create — double-refund guard & cash account resolution', () => {
  it('rejects a refund that would push total refunded above the credit note total', async () => {
    const { service } = makeService({
      // 60 already refunded, note total 100, this refund 50 -> 110 > 100.
      refund: { aggregate: jest.fn(async () => ({ _sum: { amount: new Prisma.Decimal(60) } })) },
    });

    await expect(
      service.create(
        {
          companyId: 'company-1',
          creditNoteId: 'cn-1',
          cashAccountId: 'cash-1',
          amount: 50,
          refundDate: '2026-06-01',
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows a partial refund that stays within the credit note total', async () => {
    const { service, prisma } = makeService({
      refund: { aggregate: jest.fn(async () => ({ _sum: { amount: new Prisma.Decimal(60) } })) },
    });

    const created = await service.create(
      {
        companyId: 'company-1',
        creditNoteId: 'cn-1',
        cashAccountId: 'cash-1',
        amount: 40,
        refundDate: '2026-06-01',
      } as any,
      user,
    );

    expect(created.status).toBe(RefundStatus.DRAFT);
    expect(prisma.refund.create).toHaveBeenCalled();
  });

  it('reduces the refundable ceiling by the credit note appliedAmount', async () => {
    // Note total 100, 70 already applied to a receivable at issue -> only 30
    // refundable in cash. A 40 refund must be rejected.
    const { service } = makeService({
      creditNote: {
        findFirst: jest.fn(async () => ({
          id: 'cn-1',
          companyId: 'company-1',
          totalAmount: new Prisma.Decimal(100),
          appliedAmount: new Prisma.Decimal(70),
          status: 'ISSUED',
          deletedAt: null,
        })),
      },
    });

    await expect(
      service.create(
        { companyId: 'company-1', creditNoteId: 'cn-1', cashAccountId: 'cash-1', amount: 40, refundDate: '2026-06-01' } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('takes a transaction-scoped advisory lock on the credit note before the ceiling check', async () => {
    const { service, prisma } = makeService();
    await service.create(
      { companyId: 'company-1', creditNoteId: 'cn-1', cashAccountId: 'cash-1', amount: 10, refundDate: '2026-06-01' } as any,
      user,
    );
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('rejects when the credit note is not ISSUED', async () => {
    const { service } = makeService({
      creditNote: {
        findFirst: jest.fn(async () => ({
          id: 'cn-1',
          companyId: 'company-1',
          totalAmount: new Prisma.Decimal(100),
          status: 'DRAFT',
          deletedAt: null,
        })),
      },
    });

    await expect(
      service.create(
        { companyId: 'company-1', creditNoteId: 'cn-1', cashAccountId: 'cash-1', amount: 10, refundDate: '2026-06-01' } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a cash account that does not belong to the company', async () => {
    const { service } = makeService({
      cashAccount: { id: 'cash-1', companyId: 'other-company', accountType: 'CASH_ON_HAND', accountName: 'Foreign Till' },
    });

    await expect(
      service.create(
        { companyId: 'company-1', creditNoteId: 'cn-1', cashAccountId: 'cash-1', amount: 10, refundDate: '2026-06-01' } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires an ISSUED credit note (rejects standalone receivable-only refunds)', async () => {
    const { service, prisma } = makeService();
    // A receivable-only refund (no creditNoteId) must be rejected fail-closed and
    // must never reach the create/posting path.
    await expect(
      service.create(
        {
          companyId: 'company-1',
          receivableId: 'rec-1',
          cashAccountId: 'cash-1',
          amount: 10,
          refundDate: '2026-06-01',
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.refund.create).not.toHaveBeenCalled();
  });

  it('rejects a refund when no credit note is supplied at all', async () => {
    const { service } = makeService();
    await expect(
      service.create(
        { companyId: 'company-1', cashAccountId: 'cash-1', amount: 10, refundDate: '2026-06-01' } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the supplied customer does not belong to the company', async () => {
    const { service, prisma } = makeService();
    prisma.customer = { findFirst: jest.fn(async () => ({ companyId: 'other-company' })) };
    await expect(
      service.create(
        {
          companyId: 'company-1',
          customerId: 'customer-1',
          creditNoteId: 'cn-1',
          cashAccountId: 'cash-1',
          amount: 10,
          refundDate: '2026-06-01',
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.refund.create).not.toHaveBeenCalled();
  });

  it('rejects when the credit note belongs to a different customer', async () => {
    const { service, prisma } = makeService({
      creditNote: {
        findFirst: jest.fn(async () => ({
          id: 'cn-1',
          companyId: 'company-1',
          customerId: 'customer-OTHER',
          totalAmount: new Prisma.Decimal(100),
          appliedAmount: new Prisma.Decimal(0),
          status: 'ISSUED',
          deletedAt: null,
        })),
      },
    });
    prisma.customer = { findFirst: jest.fn(async () => ({ companyId: 'company-1' })) };
    await expect(
      service.create(
        {
          companyId: 'company-1',
          customerId: 'customer-1',
          creditNoteId: 'cn-1',
          cashAccountId: 'cash-1',
          amount: 10,
          refundDate: '2026-06-01',
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.refund.create).not.toHaveBeenCalled();
  });

  it('allows a credit-note refund when the customer matches the note and company', async () => {
    const { service, prisma } = makeService();
    prisma.customer = { findFirst: jest.fn(async () => ({ companyId: 'company-1' })) };
    const created = await service.create(
      {
        companyId: 'company-1',
        customerId: 'customer-1',
        creditNoteId: 'cn-1',
        cashAccountId: 'cash-1',
        amount: 10,
        refundDate: '2026-06-01',
      } as any,
      user,
    );
    expect(created.status).toBe(RefundStatus.DRAFT);
    expect(prisma.customer.findFirst).toHaveBeenCalled();
    expect(prisma.refund.create).toHaveBeenCalled();
  });
});

describe('RefundsService.pay — balanced JE & DRAFT-only guard', () => {
  it('posts a balanced JE (DR AR, CR Cash) and stores the journalEntryId', async () => {
    const { service, postLines, prisma } = makeService();

    const result = await service.pay('refund-1', {} as any, user);

    expect(postLines).toHaveBeenCalledTimes(1);
    const posting = postLines.mock.calls[0][0];
    // Two lines, balanced.
    expect(posting.lines).toHaveLength(2);
    const totalDebit = posting.lines.reduce((s: number, l: any) => s + Number(l.debit ?? 0), 0);
    const totalCredit = posting.lines.reduce((s: number, l: any) => s + Number(l.credit ?? 0), 0);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(100);
    // AR is debited (credit released), Cash is credited (money out).
    const arLine = posting.lines.find((l: any) => l.accountId === 'acc-ar');
    const cashLine = posting.lines.find((l: any) => l.accountId === 'acc-cash');
    expect(Number(arLine.debit)).toBe(100);
    expect(Number(cashLine.credit)).toBe(100);
    // journalEntryId persisted back onto the refund.
    expect(prisma.refund.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ journalEntryId: 'je-1' }) }),
    );
    expect(result.status).toBe(RefundStatus.PAID);
  });

  it('resolves the BANK GL role when the cash account is a bank account', async () => {
    const { service, accountResolver } = makeService({
      cashAccount: {
        id: 'cash-1',
        companyId: 'company-1',
        divisionId: 'division-1',
        branchId: 'branch-1',
        accountType: 'BANK',
        accountName: 'CRDB Current',
      },
    });

    await service.pay('refund-1', {} as any, user);

    const roles = accountResolver.resolve.mock.calls.map((c: any[]) => c[1]);
    expect(roles).toContain('BANK');
    expect(roles).toContain('AR_CONTROL');
    expect(roles).not.toContain('CASH_ON_HAND');
  });

  it('throws ConflictException and never posts when the refund is not DRAFT (atomic claim lost)', async () => {
    const { service, postLines } = makeService({
      refund: {
        updateMany: jest.fn(async () => ({ count: 0 })),
        findFirst: jest.fn(async () => draftRefund({ status: RefundStatus.PAID })),
      },
    });

    await expect(service.pay('refund-1', {} as any, user)).rejects.toBeInstanceOf(ConflictException);
    expect(postLines).not.toHaveBeenCalled();
  });

  it('claims DRAFT -> PAID via a guarded updateMany', async () => {
    const { service, prisma } = makeService();
    await service.pay('refund-1', {} as any, user);
    expect(prisma.refund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'refund-1', status: RefundStatus.DRAFT, deletedAt: null }),
        data: expect.objectContaining({ status: RefundStatus.PAID }),
      }),
    );
  });

  it('decrements CashAccount.currentBalance by the refund amount (subledger consistent with GL cash CR)', async () => {
    const { service, prisma } = makeService();
    await service.pay('refund-1', {} as any, user);
    expect(prisma.cashAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cash-1' },
        data: { currentBalance: { decrement: new Prisma.Decimal(100) } },
      }),
    );
  });

  it('does NOT touch CashAccount.currentBalance when the pay claim is lost (never posts)', async () => {
    const { service, prisma } = makeService({
      refund: {
        updateMany: jest.fn(async () => ({ count: 0 })),
        findFirst: jest.fn(async () => draftRefund({ status: RefundStatus.PAID })),
      },
    });
    await expect(service.pay('refund-1', {} as any, user)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.cashAccount.update).not.toHaveBeenCalled();
  });
});

describe('RefundsService.void — reversing JE', () => {
  it('posts a reversal that swaps debit/credit on every original line', async () => {
    const { service, postLines, prisma } = makeService({
      refund: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        findFirst: jest.fn(async () => draftRefund({ status: RefundStatus.PAID, journalEntryId: 'je-1' })),
      },
    });

    await service.void('refund-1', { reason: 'issued in error' } as any, user);

    expect(postLines).toHaveBeenCalledTimes(1);
    const posting = postLines.mock.calls[0][0];
    // Original: DR AR 100 / CR Cash 100 -> reversal: CR AR 100 / DR Cash 100.
    const arLine = posting.lines.find((l: any) => l.accountId === 'acc-ar');
    const cashLine = posting.lines.find((l: any) => l.accountId === 'acc-cash');
    expect(Number(arLine.credit)).toBe(100);
    expect(Number(arLine.debit)).toBe(0);
    expect(Number(cashLine.debit)).toBe(100);
    expect(Number(cashLine.credit)).toBe(0);
    // Original JE claimed REVERSED before the reversal is posted.
    expect(prisma.journalEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REVERSED' }) }),
    );
    // Reversal re-debits GL cash (money back in), so the subledger cache is
    // incremented back by the same amount.
    expect(prisma.cashAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cash-1' },
        data: { currentBalance: { increment: new Prisma.Decimal(100) } },
      }),
    );
  });

  it('throws ConflictException and never reverses when the refund is not PAID', async () => {
    const { service, postLines } = makeService({
      refund: {
        updateMany: jest.fn(async () => ({ count: 0 })),
        findFirst: jest.fn(async () => draftRefund({ status: RefundStatus.DRAFT })),
      },
    });

    await expect(
      service.void('refund-1', { reason: 'x' } as any, user),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(postLines).not.toHaveBeenCalled();
  });

  it('is a no-op reversal (still voids) when no original journal exists', async () => {
    const { service, postLines } = makeService({
      refund: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        findFirst: jest.fn(async () => draftRefund({ status: RefundStatus.PAID, journalEntryId: null })),
      },
      journalEntry: { findFirst: jest.fn(async () => null), updateMany: jest.fn(async () => ({ count: 0 })) },
    });

    const result = await service.void('refund-1', { reason: 'x' } as any, user);
    expect(postLines).not.toHaveBeenCalled();
    expect(result.status).toBe(RefundStatus.VOID);
  });

  it('does NOT increment CashAccount.currentBalance when no reversal JE is posted', async () => {
    const { service, prisma } = makeService({
      refund: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        findFirst: jest.fn(async () => draftRefund({ status: RefundStatus.PAID, journalEntryId: null })),
      },
      journalEntry: { findFirst: jest.fn(async () => null), updateMany: jest.fn(async () => ({ count: 0 })) },
    });

    await service.void('refund-1', { reason: 'x' } as any, user);
    // No reversal posted -> the pay() decrement was never unwound, so we must
    // not increment (avoids inflating cash on a void with no cash swing).
    expect(prisma.cashAccount.update).not.toHaveBeenCalled();
  });
});
