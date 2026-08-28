import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreditNotesService } from './credit-notes.service';
import { CreditNoteStatus } from './credit-note-status.enum';

/**
 * Fully-mocked unit tests. No Postgres / real Prisma client needed. The
 * credit-note delegates are stubbed on the mock `prisma` object; the service
 * accesses them through the `creditNoteDb()` cast, so these run today even
 * before `@prisma/client` is regenerated with the CreditNote model.
 */

const D = (v: number | string) => new Prisma.Decimal(v);

type CreditNoteState = {
  id: string;
  companyId: string;
  divisionId: string | null;
  branchId: string | null;
  customerId: string | null;
  customerName: string;
  salesOrderId: string | null;
  receivableId: string | null;
  reason: string | null;
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  appliedAmount: Prisma.Decimal;
  currency: string;
  issueDate: Date;
  status: CreditNoteStatus;
  notes: string | null;
  journalEntryId: string | null;
  createdById: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function makeService(opts?: {
  note?: Partial<CreditNoteState>;
  receivable?: any;
  /** status returned by prisma.receivable.findFirst (issue-time link guard). */
  receivableStatus?: string;
  /** number of live (DRAFT|PAID) refunds referencing this credit note. */
  liveRefundCount?: number;
  /** SalesOrder.receivableId returned by salesOrder.findFirst (SO→receivable link). */
  salesOrderReceivableId?: string | null;
  /**
   * Id returned by the receivable.findFirst({ sourceType:'SalesOrder', sourceId })
   * fallback lookup. When set, exercises the source-back-reference resolution path.
   */
  sourceReceivableId?: string | null;
}) {
  const note: CreditNoteState = {
    id: 'cn-1',
    companyId: 'company-1',
    divisionId: 'division-1',
    branchId: 'branch-1',
    customerId: 'customer-1',
    customerName: 'Acme Ltd',
    salesOrderId: null,
    receivableId: null,
    reason: 'Returned goods',
    subtotal: D('1000'),
    taxAmount: D('180'),
    totalAmount: D('1180'),
    appliedAmount: D('0'),
    currency: 'TZS',
    issueDate: new Date('2026-06-01'),
    status: CreditNoteStatus.DRAFT,
    notes: null,
    journalEntryId: null,
    createdById: 'user-1',
    deletedAt: null,
    createdAt: new Date('2026-06-01'),
    updatedAt: new Date('2026-06-01'),
    ...opts?.note,
  };

  // Mutable receivable row the FOR UPDATE query returns.
  const receivable = opts?.receivable ?? null;

  const creditNote = {
    findFirst: jest.fn(async () => ({ ...note })),
    findMany: jest.fn(async () => [{ ...note }]),
    count: jest.fn(async () => 1),
    create: jest.fn(async ({ data }: any) => {
      Object.assign(note, data);
      return { ...note };
    }),
    update: jest.fn(async ({ data }: any) => {
      Object.assign(note, data);
      return { ...note };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      // Emulate the atomic status-guarded claim.
      if (where.status && note.status !== where.status) return { count: 0 };
      Object.assign(note, data);
      return { count: 1 };
    }),
  };
  const creditNoteLine = { createMany: jest.fn(async () => ({ count: 1 })) };

  const receivableDelegate = {
    // receivable.findFirst is called in two contexts:
    //   1. resolveLinkedReceivableId fallback: where has sourceType/sourceId ->
    //      returns { id } of the receivable back-referenced by the sales order.
    //   2. issue-time dead-receivable guard: where has id -> returns { status }
    //      so a CANCELLED/WRITTEN_OFF receivable blocks issuing.
    findFirst: jest.fn(async ({ where }: any = {}) => {
      if (where?.sourceType === 'SalesOrder') {
        return opts?.sourceReceivableId ? { id: opts.sourceReceivableId } : null;
      }
      return receivable
        ? {
            companyId: receivable.companyId,
            status: opts?.receivableStatus ?? receivable.status ?? 'OPEN',
          }
        : null;
    }),
    update: jest.fn(async () => ({})),
    aggregate: jest.fn(async () => ({ _sum: { outstandingAmount: D('0') } })),
  };

  const refundDelegate = {
    // void() blocks when any non-VOID refund still references the note.
    count: jest.fn(async () => opts?.liveRefundCount ?? 0),
  };

  const journalEntry = {
    findFirst: jest.fn(async () => ({
      id: 'je-1',
      companyId: 'company-1',
      divisionId: 'division-1',
      branchId: 'branch-1',
      status: 'POSTED',
      lines: [
        {
          accountId: 'acc-rev',
          description: 'Sales returns & allowances',
          debit: D('1000'),
          credit: D('0'),
          divisionId: null,
          branchId: null,
        },
        {
          accountId: 'acc-vat',
          description: 'Output VAT reversal',
          debit: D('180'),
          credit: D('0'),
          divisionId: null,
          branchId: null,
        },
        {
          accountId: 'acc-ar',
          description: 'AR credit',
          debit: D('0'),
          credit: D('1180'),
          divisionId: null,
          branchId: null,
        },
      ],
    })),
    updateMany: jest.fn(async () => ({ count: 1 })),
    update: jest.fn(async () => ({})),
  };

  const $queryRaw = jest.fn(async (query: unknown) =>
    String(query).includes('credit_notes') ? [{ id: note.id }] : receivable ? [receivable] : [],
  );
  const $executeRaw = jest.fn(async () => 1);

  const prisma: any = {
    creditNote,
    creditNoteLine,
    receivable: receivableDelegate,
    refund: refundDelegate,
    journalEntry,
    customer: {
      findFirst: jest.fn(async () => ({
        companyId: 'company-1',
        divisionId: 'division-1',
        branchId: 'branch-1',
        name: 'Acme Ltd',
      })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    salesOrder: {
      findFirst: jest.fn(async () => ({
        companyId: 'company-1',
        customerId: 'customer-1',
        receivableId: opts?.salesOrderReceivableId ?? null,
      })),
    },
    $queryRaw,
    $executeRaw,
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };

  const auditLogs = {
    log: jest.fn().mockResolvedValue(undefined),
    logStrictInTransaction: jest.fn().mockResolvedValue(undefined),
  } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    accessibleCompanyIds: jest.fn().mockResolvedValue(['company-1']),
  } as any;
  const accountResolver = {
    resolveMany: jest.fn(async () => ({
      AR_CONTROL: { id: 'acc-ar' },
      SALES_REVENUE: { id: 'acc-rev' },
      TAX_VAT_PAYABLE: { id: 'acc-vat' },
    })),
  } as any;
  const postingEngine = {
    postLines: jest.fn(async () => ({ id: 'je-1', journalNumber: 'JE-CN-1' })),
  } as any;
  const codes = { next: jest.fn(async () => 'CN-2026-00001') } as any;

  const service = new CreditNotesService(
    prisma,
    auditLogs,
    companyScope,
    accountResolver,
    postingEngine,
    codes,
  );

  return { service, prisma, note, postingEngine, auditLogs, receivableDelegate, refundDelegate };
}

const user = { id: 'user-1', permissions: ['receivables.manage'] } as any;

describe('CreditNotesService.issue — balanced reversing journal entry', () => {
  it('posts Dr Sales Returns (net) + Dr VAT (tax) = Cr AR (gross), and the JE balances', async () => {
    const { service, postingEngine } = makeService();

    await service.issue('cn-1', user);

    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    const posting = postingEngine.postLines.mock.calls[0][0];
    const lines = posting.lines as Array<{ accountId: string; debit: any; credit: any }>;

    // Three lines: revenue (net), VAT (tax), AR (gross).
    expect(lines).toHaveLength(3);

    const rev = lines.find((l) => l.accountId === 'acc-rev')!;
    const vat = lines.find((l) => l.accountId === 'acc-vat')!;
    const ar = lines.find((l) => l.accountId === 'acc-ar')!;

    expect(new Prisma.Decimal(rev.debit).toString()).toBe('1000');
    expect(new Prisma.Decimal(vat.debit).toString()).toBe('180');
    expect(new Prisma.Decimal(ar.credit).toString()).toBe('1180');

    const totalDebit = lines.reduce((s, l) => s.plus(new Prisma.Decimal(l.debit ?? 0)), D('0'));
    const totalCredit = lines.reduce((s, l) => s.plus(new Prisma.Decimal(l.credit ?? 0)), D('0'));
    expect(totalDebit.equals(totalCredit)).toBe(true);
    expect(totalDebit.toString()).toBe('1180');

    expect(posting.referenceType).toBe('CreditNote');
  });

  it('omits the VAT line when tax is zero and still balances', async () => {
    const { service, postingEngine } = makeService({
      note: { subtotal: D('500'), taxAmount: D('0'), totalAmount: D('500') },
    });

    await service.issue('cn-1', user);

    const lines = postingEngine.postLines.mock.calls[0][0].lines as Array<any>;
    expect(lines.find((l) => l.accountId === 'acc-vat')).toBeUndefined();
    const totalDebit = lines.reduce(
      (s: any, l: any) => s.plus(new Prisma.Decimal(l.debit ?? 0)),
      D('0'),
    );
    const totalCredit = lines.reduce(
      (s: any, l: any) => s.plus(new Prisma.Decimal(l.credit ?? 0)),
      D('0'),
    );
    expect(totalDebit.equals(totalCredit)).toBe(true);
    expect(totalDebit.toString()).toBe('500');
  });
});

describe('CreditNotesService.issue — receivable reduction never goes negative', () => {
  it('applies at most the outstanding balance and leaves the excess as available credit', async () => {
    // Credit note gross = 1180, receivable outstanding = 400 -> apply 400, remainder 780 unapplied.
    const receivable = {
      id: 'rec-1',
      companyId: 'company-1',
      customerId: 'customer-1',
      outstandingAmount: D('400'),
      paidAmount: D('0'),
    };
    const { service, prisma } = makeService({
      note: { receivableId: 'rec-1' },
      receivable,
    });

    await service.issue('cn-1', user);

    // Receivable outstanding reduced to zero, never negative.
    expect(prisma.receivable.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rec-1' },
        data: expect.objectContaining({ outstandingAmount: expect.anything(), status: 'PAID' }),
      }),
    );
    const updateArg = prisma.receivable.update.mock.calls[0][0];
    expect(new Prisma.Decimal(updateArg.data.outstandingAmount).toString()).toBe('0');

    // appliedAmount stored on the credit note = 400 (the outstanding), not 1180.
    const finalUpdate = prisma.creditNote.update.mock.calls.find(
      (c: any) => c[0].data.appliedAmount !== undefined,
    );
    expect(new Prisma.Decimal(finalUpdate[0].data.appliedAmount).toString()).toBe('400');
  });

  it('applies the full credit when outstanding exceeds it, leaving a PARTIALLY_PAID balance', async () => {
    const receivable = {
      id: 'rec-1',
      companyId: 'company-1',
      customerId: 'customer-1',
      outstandingAmount: D('5000'),
      paidAmount: D('0'),
    };
    const { service, prisma } = makeService({
      note: { receivableId: 'rec-1' },
      receivable,
    });

    await service.issue('cn-1', user);

    const updateArg = prisma.receivable.update.mock.calls[0][0];
    expect(new Prisma.Decimal(updateArg.data.outstandingAmount).toString()).toBe('3820'); // 5000 - 1180
    expect(updateArg.data.status).toBe('PARTIALLY_PAID');
  });
});

describe('CreditNotesService.issue — salesOrderId-only relieves the receivable subledger', () => {
  it('resolves the receivable from SalesOrder.receivableId and relieves it (GL AR credit mirrored in subledger)', async () => {
    // Note links ONLY the sales order (receivableId is null). The SO points at
    // rec-1 via its FK. Issuing must relieve rec-1 so the AR subledger + customer
    // balance track the GL AR credit.
    const receivable = {
      id: 'rec-1',
      companyId: 'company-1',
      customerId: 'customer-1',
      outstandingAmount: D('1180'),
      paidAmount: D('0'),
    };
    const { service, prisma } = makeService({
      note: { receivableId: null, salesOrderId: 'so-1' },
      receivable,
      salesOrderReceivableId: 'rec-1',
    });

    await service.issue('cn-1', user);

    // The GL AR credit is mirrored: rec-1 outstanding driven to 0.
    expect(prisma.receivable.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rec-1' },
        data: expect.objectContaining({ outstandingAmount: expect.anything(), status: 'PAID' }),
      }),
    );
    const updateArg = prisma.receivable.update.mock.calls[0][0];
    expect(new Prisma.Decimal(updateArg.data.outstandingAmount).toString()).toBe('0');

    // Customer balance re-synced from receivable subledger.
    expect(prisma.customer.updateMany).toHaveBeenCalled();

    // Resolved receivableId persisted back onto the credit note (so void restores it).
    const finalUpdate = prisma.creditNote.update.mock.calls.find(
      (c: any) => c[0].data.appliedAmount !== undefined,
    );
    expect(finalUpdate[0].data.receivableId).toBe('rec-1');
    expect(new Prisma.Decimal(finalUpdate[0].data.appliedAmount).toString()).toBe('1180');
  });

  it('falls back to Receivable.sourceType=SalesOrder/sourceId when the SO has no direct FK', async () => {
    const receivable = {
      id: 'rec-2',
      companyId: 'company-1',
      customerId: 'customer-1',
      outstandingAmount: D('1180'),
      paidAmount: D('0'),
    };
    const { service, prisma } = makeService({
      note: { receivableId: null, salesOrderId: 'so-1' },
      receivable,
      salesOrderReceivableId: null, // no direct FK -> use the source back-reference
      sourceReceivableId: 'rec-2',
    });

    await service.issue('cn-1', user);

    const updateArg = prisma.receivable.update.mock.calls[0][0];
    expect(new Prisma.Decimal(updateArg.data.outstandingAmount).toString()).toBe('0');
    const finalUpdate = prisma.creditNote.update.mock.calls.find(
      (c: any) => c[0].data.appliedAmount !== undefined,
    );
    expect(finalUpdate[0].data.receivableId).toBe('rec-2');
  });

  it('blocks issuing when the sales-order-resolved receivable is WRITTEN_OFF (no JE, no relief)', async () => {
    const receivable = {
      id: 'rec-1',
      companyId: 'company-1',
      customerId: 'customer-1',
      outstandingAmount: D('0'),
      paidAmount: D('0'),
    };
    const { service, postingEngine, prisma } = makeService({
      note: { receivableId: null, salesOrderId: 'so-1' },
      receivable,
      salesOrderReceivableId: 'rec-1',
      receivableStatus: 'WRITTEN_OFF',
    });

    await expect(service.issue('cn-1', user)).rejects.toBeInstanceOf(ConflictException);
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(prisma.receivable.update).not.toHaveBeenCalled();
  });

  it('leaves AR as a standalone customer credit when neither link resolves a receivable', async () => {
    // salesOrderId set but the SO has no receivable and no source back-reference:
    // GL still credits AR (available customer credit), no subledger relief.
    const { service, prisma, postingEngine } = makeService({
      note: { receivableId: null, salesOrderId: 'so-1' },
      salesOrderReceivableId: null,
      sourceReceivableId: null,
    });

    await service.issue('cn-1', user);

    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    expect(prisma.receivable.update).not.toHaveBeenCalled();
    const finalUpdate = prisma.creditNote.update.mock.calls.find(
      (c: any) => c[0].data.appliedAmount !== undefined,
    );
    expect(new Prisma.Decimal(finalUpdate[0].data.appliedAmount).toString()).toBe('0');
    expect(finalUpdate[0].data.receivableId).toBeUndefined();
  });
});

describe('CreditNotesService.issue — DRAFT-only guard', () => {
  it('rejects issuing a credit note that is already ISSUED (no JE posted)', async () => {
    const { service, postingEngine } = makeService({ note: { status: CreditNoteStatus.ISSUED } });

    await expect(service.issue('cn-1', user)).rejects.toBeInstanceOf(ConflictException);
    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });

  it('rejects issuing a VOID credit note', async () => {
    const { service, postingEngine } = makeService({ note: { status: CreditNoteStatus.VOID } });
    await expect(service.issue('cn-1', user)).rejects.toBeInstanceOf(ConflictException);
    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });
});

describe('CreditNotesService.issue — dead-receivable double-reversal guard', () => {
  it('rejects issuing against a CANCELLED receivable (no JE posted)', async () => {
    const receivable = {
      id: 'rec-1',
      companyId: 'company-1',
      customerId: 'customer-1',
      amount: D('1180'),
      outstandingAmount: D('1180'),
      paidAmount: D('0'),
    };
    const { service, postingEngine } = makeService({
      note: { receivableId: 'rec-1' },
      receivable,
      receivableStatus: 'CANCELLED',
    });

    await expect(service.issue('cn-1', user)).rejects.toBeInstanceOf(ConflictException);
    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });

  it('rejects issuing against a WRITTEN_OFF receivable (no JE posted)', async () => {
    const receivable = {
      id: 'rec-1',
      companyId: 'company-1',
      customerId: 'customer-1',
      amount: D('1180'),
      outstandingAmount: D('0'),
      paidAmount: D('0'),
    };
    const { service, postingEngine } = makeService({
      note: { receivableId: 'rec-1' },
      receivable,
      receivableStatus: 'WRITTEN_OFF',
    });

    await expect(service.issue('cn-1', user)).rejects.toBeInstanceOf(ConflictException);
    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });

  it('still issues normally against a healthy OPEN receivable', async () => {
    const receivable = {
      id: 'rec-1',
      companyId: 'company-1',
      customerId: 'customer-1',
      amount: D('5000'),
      outstandingAmount: D('5000'),
      paidAmount: D('0'),
      status: 'OPEN',
    };
    const { service, postingEngine } = makeService({
      note: { receivableId: 'rec-1' },
      receivable,
    });

    await service.issue('cn-1', user);
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
  });
});

describe('CreditNotesService.void — reverses the issue JE', () => {
  it('posts a reversing entry that swaps every original line, and restores the receivable', async () => {
    // Original receivable amount 400, fully relieved by the credit note (paid 0,
    // outstanding 0). Voiding restores the 400 outstanding, capped at amount-paid.
    const receivable = {
      id: 'rec-1',
      companyId: 'company-1',
      customerId: 'customer-1',
      amount: D('400'),
      outstandingAmount: D('0'),
      paidAmount: D('0'),
      status: 'PAID',
    };
    const { service, prisma, postingEngine } = makeService({
      note: {
        status: CreditNoteStatus.ISSUED,
        journalEntryId: 'je-1',
        receivableId: 'rec-1',
        appliedAmount: D('400'),
      },
      receivable,
    });

    await service.void('cn-1', { reason: 'Issued in error' }, user);

    // Reversal JE posted with swapped sides of the original 3 lines.
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    const lines = postingEngine.postLines.mock.calls[0][0].lines as Array<any>;
    const rev = lines.find((l: any) => l.accountId === 'acc-rev')!;
    const ar = lines.find((l: any) => l.accountId === 'acc-ar')!;
    // Original: rev was a debit -> now a credit; AR was a credit -> now a debit.
    expect(new Prisma.Decimal(rev.credit).toString()).toBe('1000');
    expect(new Prisma.Decimal(ar.debit).toString()).toBe('1180');

    const totalDebit = lines.reduce(
      (s: any, l: any) => s.plus(new Prisma.Decimal(l.debit ?? 0)),
      D('0'),
    );
    const totalCredit = lines.reduce(
      (s: any, l: any) => s.plus(new Prisma.Decimal(l.credit ?? 0)),
      D('0'),
    );
    expect(totalDebit.equals(totalCredit)).toBe(true);

    // Original JE flipped to REVERSED.
    expect(prisma.journalEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REVERSED' }) }),
    );

    // Receivable outstanding restored by the previously-applied 400.
    const recUpdate = prisma.receivable.update.mock.calls[0][0];
    expect(new Prisma.Decimal(recUpdate.data.outstandingAmount).toString()).toBe('400');
  });

  it('appends the attributable void audit after all business writes on the same transaction', async () => {
    const { service, prisma, auditLogs } = makeService({
      note: { status: CreditNoteStatus.ISSUED, journalEntryId: 'je-1' },
    });

    await service.void('cn-1', { reason: 'Issued in error' }, user);

    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledWith(prisma, {
      action: 'CREDIT_NOTE_VOID',
      entityType: 'CreditNote',
      entityId: 'cn-1',
      userId: 'user-1',
      companyId: 'company-1',
      oldValue: { status: CreditNoteStatus.ISSUED },
      newValue: {
        status: CreditNoteStatus.VOID,
        reason: 'Issued in error',
        reversalJournalEntryId: 'je-1',
      },
    });
    expect(prisma.creditNote.update.mock.invocationCallOrder.at(-1)).toBeLessThan(
      auditLogs.logStrictInTransaction.mock.invocationCallOrder[0],
    );
  });

  it('rolls the void claim back when the mandatory audit append fails', async () => {
    const { service, prisma, note, auditLogs } = makeService({
      note: {
        status: CreditNoteStatus.ISSUED,
        journalEntryId: 'je-1',
        appliedAmount: D('400'),
      },
    });
    auditLogs.logStrictInTransaction.mockRejectedValueOnce(new Error('audit store unavailable'));
    prisma.$transaction.mockImplementationOnce(async (callback: any) => {
      const snapshot = { ...note };
      try {
        return await callback(prisma);
      } catch (error) {
        Object.assign(note, snapshot);
        throw error;
      }
    });

    await expect(service.void('cn-1', { reason: 'Issued in error' }, user)).rejects.toThrow(
      'audit store unavailable',
    );

    expect(note.status).toBe(CreditNoteStatus.ISSUED);
    expect(note.appliedAmount.toString()).toBe('400');
    expect(auditLogs.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREDIT_NOTE_VOID' }),
    );
  });

  it('rejects voiding a DRAFT credit note', async () => {
    const { service, postingEngine } = makeService({ note: { status: CreditNoteStatus.DRAFT } });
    await expect(service.void('cn-1', { reason: 'x' }, user)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });

  it('preserves the original notes and does NOT overwrite them with the void reason', async () => {
    const receivable = {
      id: 'rec-1',
      companyId: 'company-1',
      customerId: 'customer-1',
      amount: D('400'),
      outstandingAmount: D('0'),
      paidAmount: D('0'),
      status: 'PAID',
    };
    const { service, prisma } = makeService({
      note: {
        status: CreditNoteStatus.ISSUED,
        journalEntryId: 'je-1',
        receivableId: 'rec-1',
        appliedAmount: D('400'),
        notes: 'Original operator note',
      },
      receivable,
    });

    await service.void('cn-1', { reason: 'Issued in error' }, user);

    // No creditNote.update call should touch the `notes` field.
    const notesTouched = prisma.creditNote.update.mock.calls.some(
      (c: any) => c[0].data.notes !== undefined,
    );
    expect(notesTouched).toBe(false);
  });
});

describe('CreditNotesService.void — cross-module double-relief guard', () => {
  it('blocks voiding while a live (DRAFT/PAID) refund still references the note', async () => {
    const { service, prisma, postingEngine, refundDelegate } = makeService({
      note: { status: CreditNoteStatus.ISSUED, journalEntryId: 'je-1' },
      liveRefundCount: 1,
    });

    await expect(service.void('cn-1', { reason: 'x' }, user)).rejects.toBeInstanceOf(
      ConflictException,
    );

    // Blocked before any GL reversal is posted.
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    // The refund count query is company-scoped and filters to non-VOID refunds.
    expect(refundDelegate.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          creditNoteId: 'cn-1',
          companyId: 'company-1',
          status: { in: ['DRAFT', 'PAID'] },
        }),
      }),
    );
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.$queryRaw.mock.invocationCallOrder[0],
    );
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      refundDelegate.count.mock.invocationCallOrder[0],
    );
    expect(prisma.creditNote.updateMany).not.toHaveBeenCalled();
  });

  it('allows voiding when only VOID refunds reference the note', async () => {
    const { service, prisma, postingEngine, refundDelegate } = makeService({
      note: { status: CreditNoteStatus.ISSUED, journalEntryId: 'je-1' },
      liveRefundCount: 0,
    });

    await service.void('cn-1', { reason: 'ok' }, user);
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    expect(refundDelegate.count.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.creditNote.updateMany.mock.invocationCallOrder[0],
    );
  });
});

describe('CreditNotesService.void — missing-swing abort', () => {
  it('aborts (throws) when a reversal was expected but none posted', async () => {
    const { service } = makeService({
      note: { status: CreditNoteStatus.ISSUED, journalEntryId: 'je-1' },
    });
    // Force reverseCreditNoteJournal to see the original JE as already REVERSED so
    // its atomic claim yields count 0 -> returns null even though a JE existed.
    const svc: any = service;
    (svc.prisma.journalEntry.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });

    await expect(service.void('cn-1', { reason: 'x' }, user)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('CreditNotesService.void — restore guards', () => {
  it('does NOT resurrect a receivable that has since been WRITTEN_OFF', async () => {
    const receivable = {
      id: 'rec-1',
      companyId: 'company-1',
      customerId: 'customer-1',
      amount: D('1180'),
      outstandingAmount: D('0'),
      paidAmount: D('0'),
      status: 'WRITTEN_OFF',
    };
    const { service, prisma } = makeService({
      note: {
        status: CreditNoteStatus.ISSUED,
        journalEntryId: 'je-1',
        receivableId: 'rec-1',
        appliedAmount: D('400'),
      },
      receivable,
    });

    await service.void('cn-1', { reason: 'Issued in error' }, user);

    // Reversal still posts, but the dead receivable is left untouched.
    expect(prisma.receivable.update).not.toHaveBeenCalled();
  });

  it('caps the restored outstanding at the receivable original amount minus paid', async () => {
    // Original amount 400, paid 100 -> max restorable outstanding = 300, even
    // though the credit note applied 400 (a stale over-application).
    const receivable = {
      id: 'rec-1',
      companyId: 'company-1',
      customerId: 'customer-1',
      amount: D('400'),
      outstandingAmount: D('0'),
      paidAmount: D('100'),
      status: 'PAID',
    };
    const { service, prisma } = makeService({
      note: {
        status: CreditNoteStatus.ISSUED,
        journalEntryId: 'je-1',
        receivableId: 'rec-1',
        appliedAmount: D('400'),
      },
      receivable,
    });

    await service.void('cn-1', { reason: 'Issued in error' }, user);

    const recUpdate = prisma.receivable.update.mock.calls[0][0];
    expect(new Prisma.Decimal(recUpdate.data.outstandingAmount).toString()).toBe('300');
    // Some payment was made, so it re-opens as PARTIALLY_PAID (not blindly OPEN).
    expect(recUpdate.data.status).toBe('PARTIALLY_PAID');
  });
});
