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
  /** Detail lines returned by findOne (restock reads returnedQuantity from these). */
  lines?: any[];
  /** Row returned by salesOrderLine.findFirst (restock cost basis fallback). */
  salesOrderLine?: any;
  /** Row returned by inventoryBalance.findFirst (branch average-cost fallback). */
  branchBalance?: any;
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
    findFirst: jest.fn(async () => ({ ...note, lines: opts?.lines ?? [] })),
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

  const productDelegate = {
    // Restock lines resolve the product to confirm it is stock-tracked and to
    // read its default purchase cost fallback.
    findUnique: jest.fn(async () => ({
      id: 'prod-1',
      companyId: 'company-1',
      name: 'Widget',
      productType: 'STOCK_ITEM',
      trackInventory: true,
      defaultPurchasePrice: D('60'),
    })),
  };

  const prisma: any = {
    creditNote,
    creditNoteLine,
    receivable: receivableDelegate,
    refund: refundDelegate,
    journalEntry,
    product: productDelegate,
    salesOrderLine: {
      findFirst: jest.fn(async () => opts?.salesOrderLine ?? null),
    },
    inventoryBalance: {
      findFirst: jest.fn(async () => opts?.branchBalance ?? null),
    },
    inventoryMovement: {
      // Idempotency probe in unwindRestock: default no prior compensating movement.
      findFirst: jest.fn(async () => null),
    },
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
    resolveMany: jest.fn(async (_companyId: string, roles: string[]) => {
      const map: Record<string, { id: string }> = {
        AR_CONTROL: { id: 'acc-ar' },
        SALES_REVENUE: { id: 'acc-rev' },
        TAX_VAT_PAYABLE: { id: 'acc-vat' },
        INVENTORY_ASSET: { id: 'acc-inv' },
        COST_OF_GOODS_SOLD: { id: 'acc-cogs' },
      };
      return Object.fromEntries(roles.map((r) => [r, map[r]]));
    }),
  } as any;
  // postingEngine returns a distinct id per call so restock/reversal JEs are
  // distinguishable in assertions; also feeds reversalOfId updates.
  let jeCounter = 0;
  const postingEngine = {
    postLines: jest.fn(async () => ({
      id: `je-${++jeCounter}`,
      journalNumber: `JE-CN-${jeCounter}`,
    })),
  } as any;
  const codes = { next: jest.fn(async () => 'CN-2026-00001') } as any;

  const inventoryMovements = {
    createMovement: jest.fn(async () => ({ id: 'mov-1' })),
  } as any;
  const profit = {
    // Restock only touches stock-tracked products; mirror the real predicate.
    isStockProduct: jest.fn(
      (p: any) =>
        p?.trackInventory !== false &&
        !['SERVICE', 'NON_STOCK_ITEM'].includes(String(p?.productType ?? '').toUpperCase()),
    ),
  } as any;

  const service = new CreditNotesService(
    prisma,
    auditLogs,
    companyScope,
    accountResolver,
    postingEngine,
    codes,
    inventoryMovements,
    profit,
  );

  return {
    service,
    prisma,
    note,
    postingEngine,
    auditLogs,
    receivableDelegate,
    refundDelegate,
    inventoryMovements,
    profit,
  };
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

describe('CreditNotesService.create — restock opt-in validation', () => {
  const baseDto = () => ({
    companyId: 'company-1',
    customerId: 'customer-1',
    issueDate: '2026-06-01',
    lines: [
      {
        productId: 'prod-1',
        unitId: 'unit-1',
        description: 'Returned widget',
        quantity: 5,
        unitPrice: 100,
        taxAmount: 90,
      },
    ],
  });

  it('persists returnedQuantity + restockUnitCost onto the line when opted in', async () => {
    const { service, prisma } = makeService();
    const dto: any = baseDto();
    dto.lines[0].returnedQuantity = 3;
    dto.lines[0].restockUnitCost = 60;

    await service.create(dto, user);

    const created = prisma.creditNoteLine.createMany.mock.calls[0][0].data[0];
    expect(new Prisma.Decimal(created.returnedQuantity).toString()).toBe('3');
    expect(new Prisma.Decimal(created.restockUnitCost).toString()).toBe('60');
  });

  it('leaves returnedQuantity null for a pure financial credit (no restock intent)', async () => {
    const { service, prisma } = makeService();

    await service.create(baseDto() as any, user);

    const created = prisma.creditNoteLine.createMany.mock.calls[0][0].data[0];
    expect(created.returnedQuantity).toBeNull();
    expect(created.restockUnitCost).toBeNull();
  });

  it('rejects returnedQuantity greater than the credited quantity', async () => {
    const { service } = makeService();
    const dto: any = baseDto();
    dto.lines[0].returnedQuantity = 6; // credited only 5

    await expect(service.create(dto, user)).rejects.toThrow(/cannot exceed/i);
  });

  it('rejects returnedQuantity without a productId', async () => {
    const { service } = makeService();
    const dto: any = baseDto();
    delete dto.lines[0].productId;
    dto.lines[0].returnedQuantity = 2;

    await expect(service.create(dto, user)).rejects.toThrow(/productId/i);
  });
});

describe('CreditNotesService.issue — physical-return restock', () => {
  const returnLine = (over?: any) => ({
    productId: 'prod-1',
    unitId: 'unit-1',
    quantity: D('5'),
    returnedQuantity: D('3'),
    restockUnitCost: D('60'),
    ...over,
  });

  it('restocks the returned qty (SALES_RETURN) and posts a balanced Dr Inventory / Cr COGS', async () => {
    const { service, inventoryMovements, postingEngine } = makeService({
      lines: [returnLine()],
    });

    await service.issue('cn-1', user);

    // Inbound SALES_RETURN movement for the returned quantity at the frozen cost.
    expect(inventoryMovements.createMovement).toHaveBeenCalledTimes(1);
    const mv = inventoryMovements.createMovement.mock.calls[0][0];
    expect(mv.movementType).toBe('SALES_RETURN');
    expect(mv.quantity).toBe(3);
    expect(mv.unitCost).toBe(60);
    expect(mv.referenceType).toBe('CreditNote');
    expect(mv.branchId).toBe('branch-1');

    // Two JEs posted: [0] financial reversal, [1] restock COGS reversal.
    expect(postingEngine.postLines).toHaveBeenCalledTimes(2);
    const restock = postingEngine.postLines.mock.calls[1][0];
    const inv = restock.lines.find((l: any) => l.accountId === 'acc-inv');
    const cogs = restock.lines.find((l: any) => l.accountId === 'acc-cogs');
    // 3 * 60 = 180 -> Dr Inventory 180, Cr COGS 180 (balanced).
    expect(new Prisma.Decimal(inv.debit).toString()).toBe('180');
    expect(new Prisma.Decimal(cogs.credit).toString()).toBe('180');
    const dr = restock.lines.reduce(
      (s: any, l: any) => s.plus(new Prisma.Decimal(l.debit ?? 0)),
      D('0'),
    );
    const cr = restock.lines.reduce(
      (s: any, l: any) => s.plus(new Prisma.Decimal(l.credit ?? 0)),
      D('0'),
    );
    expect(dr.equals(cr)).toBe(true);
  });

  it('does NOT restock or post a COGS entry for a financial-only credit note', async () => {
    // No returnedQuantity on the line -> price adjustment / allowance.
    const { service, inventoryMovements, postingEngine } = makeService({
      lines: [returnLine({ returnedQuantity: null, restockUnitCost: null })],
    });

    await service.issue('cn-1', user);

    expect(inventoryMovements.createMovement).not.toHaveBeenCalled();
    // Only the single financial reversal JE — no restock JE.
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
  });

  it('skips restock for a non-stock product even when returnedQuantity is set', async () => {
    const { service, prisma, inventoryMovements, postingEngine } = makeService({
      lines: [returnLine()],
    });
    (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'prod-1',
      companyId: 'company-1',
      name: 'Consulting',
      productType: 'SERVICE',
      trackInventory: false,
      defaultPurchasePrice: D('0'),
    });

    await service.issue('cn-1', user);

    expect(inventoryMovements.createMovement).not.toHaveBeenCalled();
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1); // financial only
  });

  it('derives restock cost from the sales-order line when restockUnitCost is absent', async () => {
    const { service, inventoryMovements } = makeService({
      note: { salesOrderId: 'so-1' },
      lines: [returnLine({ restockUnitCost: null })],
      salesOrderLine: { quantity: D('5'), unitCostAtSale: D('55'), cogsAmount: D('275') },
    });

    await service.issue('cn-1', user);

    const mv = inventoryMovements.createMovement.mock.calls[0][0];
    expect(mv.unitCost).toBe(55); // from unitCostAtSale
  });
});

describe('CreditNotesService.void — unwinds the restock', () => {
  const returnLine = () => ({
    productId: 'prod-1',
    unitId: 'unit-1',
    quantity: D('5'),
    returnedQuantity: D('3'),
    restockUnitCost: D('60'),
  });

  // The original restock JE posted at issue time: Dr Inventory 180 / Cr COGS 180.
  // unwindRestock reverses THIS by swapping the stored line sides (Finding 1), so
  // the mock must carry the stored lines + amounts.
  const restockJe = (over?: any) => ({
    id: 'je-restock',
    companyId: 'company-1',
    divisionId: null,
    branchId: null,
    status: 'POSTED',
    lines: [
      {
        accountId: 'acc-inv',
        description: 'Inventory returned to stock',
        debit: D('180'),
        credit: D('0'),
        divisionId: null,
        branchId: null,
      },
      {
        accountId: 'acc-cogs',
        description: 'COGS reversal on returned goods',
        debit: D('0'),
        credit: D('180'),
        divisionId: null,
        branchId: null,
      },
    ],
    ...over,
  });

  const financialReversalJe = () => ({
    id: 'je-1',
    companyId: 'company-1',
    divisionId: null,
    branchId: null,
    status: 'POSTED',
    lines: [
      { accountId: 'acc-rev', debit: D('1000'), credit: D('0') },
      { accountId: 'acc-ar', debit: D('0'), credit: D('1180') },
    ],
  });

  it('removes the returned stock (ADJUSTMENT_OUT) and reverses the restock JE by its stored lines', async () => {
    const receivable = {
      id: 'rec-1',
      companyId: 'company-1',
      customerId: 'customer-1',
      amount: D('400'),
      outstandingAmount: D('0'),
      paidAmount: D('0'),
      status: 'PAID',
    };
    const { service, prisma, inventoryMovements, postingEngine } = makeService({
      note: {
        status: CreditNoteStatus.ISSUED,
        journalEntryId: 'je-1',
        receivableId: 'rec-1',
        appliedAmount: D('400'),
      },
      receivable,
      lines: [returnLine()],
    });
    // First journalEntry.findFirst (financial reversal) returns the AR/rev/vat JE;
    // second (restock JE lookup in unwindRestock) returns the stored restock JE.
    (prisma.journalEntry.findFirst as jest.Mock).mockResolvedValueOnce(financialReversalJe());
    (prisma.journalEntry.findFirst as jest.Mock).mockResolvedValueOnce(restockJe());

    await service.void('cn-1', { reason: 'Issued in error' }, user);

    // Finding 2: stock removed via ADJUSTMENT_OUT (ungated by the reserved guard),
    // NOT SALE_ISSUE.
    expect(inventoryMovements.createMovement).toHaveBeenCalledTimes(1);
    const mv = inventoryMovements.createMovement.mock.calls[0][0];
    expect(mv.movementType).toBe('ADJUSTMENT_OUT');
    expect(mv.quantity).toBe(3);
    expect(mv.referenceType).toBe('CreditNoteVoid');

    // Two JEs: [0] financial reversal, [1] restock reversal (swapped stored lines).
    expect(postingEngine.postLines).toHaveBeenCalledTimes(2);
    const restockRev = postingEngine.postLines.mock.calls[1][0];
    const cogs = restockRev.lines.find((l: any) => l.accountId === 'acc-cogs');
    const inv = restockRev.lines.find((l: any) => l.accountId === 'acc-inv');
    // Stored restock was Dr Inventory 180 / Cr COGS 180 -> reversal swaps to
    // Dr COGS 180 / Cr Inventory 180.
    expect(new Prisma.Decimal(cogs.debit).toString()).toBe('180');
    expect(new Prisma.Decimal(inv.credit).toString()).toBe('180');

    // The original restock JE is claimed REVERSED and linked as the reversalOf.
    expect(prisma.journalEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'je-restock', status: { not: 'REVERSED' } }),
        data: expect.objectContaining({ status: 'REVERSED' }),
      }),
    );
  });

  it('[Finding 1] reverses at the ORIGINAL stored amounts even when the recomputed cost would differ, netting inventory+COGS to zero', async () => {
    // The line carries NO frozen restockUnitCost, so resolveRestockUnitCost would
    // recompute the cost at void time from the branch average (now 999, drifted up
    // from the 60 the restock actually posted). The GL reversal must still be the
    // stored 180, not 3 * 999 = 2997 — otherwise the void wouldn't net to zero.
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
      // No restockUnitCost on the line -> void-time cost would be recomputed.
      lines: [
        {
          productId: 'prod-1',
          unitId: 'unit-1',
          quantity: D('5'),
          returnedQuantity: D('3'),
          restockUnitCost: null,
        },
      ],
      // Branch average cost has DRIFTED to 999 since issue.
      branchBalance: { averageCost: D('999') },
    });
    (prisma.journalEntry.findFirst as jest.Mock).mockResolvedValueOnce(financialReversalJe());
    (prisma.journalEntry.findFirst as jest.Mock).mockResolvedValueOnce(restockJe());

    await service.void('cn-1', { reason: 'Cost basis moved' }, user);

    const restockRev = postingEngine.postLines.mock.calls[1][0];
    const cogs = restockRev.lines.find((l: any) => l.accountId === 'acc-cogs');
    const inv = restockRev.lines.find((l: any) => l.accountId === 'acc-inv');

    // Reversal uses the STORED 180, NOT the drifted recompute (3 * 999 = 2997).
    expect(new Prisma.Decimal(cogs.debit).toString()).toBe('180');
    expect(new Prisma.Decimal(inv.credit).toString()).toBe('180');

    // Original restock (Dr Inv 180 / Cr COGS 180) + reversal (Dr COGS 180 /
    // Cr Inv 180) net to exactly zero per account.
    const origInvNet = D('180').minus(D('0')); // original Dr Inventory
    const revInvNet = new Prisma.Decimal(inv.credit); // reversal Cr Inventory
    expect(origInvNet.minus(revInvNet).toString()).toBe('0');
    const origCogsNet = D('180'); // original Cr COGS
    const revCogsNet = new Prisma.Decimal(cogs.debit); // reversal Dr COGS
    expect(origCogsNet.minus(revCogsNet).toString()).toBe('0');
  });

  it('[Finding 2] the stock unwind is NOT blocked by a reserved-availability condition', async () => {
    // Simulate the reserved-availability guard: if the unwind used SALE_ISSUE the
    // movement service would throw when the restocked stock is reserved/re-sold.
    // With ADJUSTMENT_OUT it must NOT be gated, so the void completes.
    const receivable = {
      id: 'rec-1',
      companyId: 'company-1',
      customerId: 'customer-1',
      amount: D('400'),
      outstandingAmount: D('0'),
      paidAmount: D('0'),
      status: 'PAID',
    };
    const { service, prisma, inventoryMovements } = makeService({
      note: {
        status: CreditNoteStatus.ISSUED,
        journalEntryId: 'je-1',
        receivableId: 'rec-1',
        appliedAmount: D('400'),
      },
      receivable,
      lines: [returnLine()],
    });
    (prisma.journalEntry.findFirst as jest.Mock).mockResolvedValueOnce(financialReversalJe());
    (prisma.journalEntry.findFirst as jest.Mock).mockResolvedValueOnce(restockJe());

    // Model the real inventory-movements reserved guard: SALE_ISSUE throws when
    // stock is reserved, ADJUSTMENT_OUT (real depletion) passes.
    (inventoryMovements.createMovement as jest.Mock).mockImplementation(async (input: any) => {
      if (input.movementType === 'SALE_ISSUE') {
        throw new Error('Insufficient available stock after reservations');
      }
      return { id: 'mov-void-1' };
    });

    // Must not throw — the unwind uses the ungated ADJUSTMENT_OUT path.
    await expect(service.void('cn-1', { reason: 'Issued in error' }, user)).resolves.toBeDefined();

    const mv = inventoryMovements.createMovement.mock.calls[0][0];
    expect(mv.movementType).toBe('ADJUSTMENT_OUT');
  });

  it('re-void is a no-op on the GL: skips reversal when the restock JE is already REVERSED', async () => {
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
      lines: [returnLine()],
    });
    (prisma.journalEntry.findFirst as jest.Mock).mockResolvedValueOnce(financialReversalJe());
    (prisma.journalEntry.findFirst as jest.Mock).mockResolvedValueOnce(restockJe());

    // Financial-reversal claim succeeds (count 1); restock-JE claim loses the
    // race / already reversed (count 0) -> no restock reversal JE.
    (prisma.journalEntry.updateMany as jest.Mock)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await service.void('cn-1', { reason: 'Issued in error' }, user);

    // Only the financial reversal posts; the already-reversed restock is skipped.
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
  });

  it('[Finding 14] unwinds EVERY line of a two-lines-same-product note (per-note, not per-product, idempotency)', async () => {
    // A realistic mirror of an invoice that sold the same item at two prices:
    // two return lines for the SAME product (qty 2 and qty 3). The old
    // per-product probe would see line 1's just-created ADJUSTMENT_OUT (same-tx
    // own-writes visibility) and skip line 2, leaving +3 phantom on-hand units
    // while the GL leg reverses the ENTIRE stored restock JE.
    const receivable = {
      id: 'rec-1',
      companyId: 'company-1',
      customerId: 'customer-1',
      amount: D('400'),
      outstandingAmount: D('0'),
      paidAmount: D('0'),
      status: 'PAID',
    };
    const createdVoidMovements: any[] = [];
    const { service, prisma, inventoryMovements, postingEngine } = makeService({
      note: {
        status: CreditNoteStatus.ISSUED,
        journalEntryId: 'je-1',
        receivableId: 'rec-1',
        appliedAmount: D('400'),
      },
      receivable,
      lines: [
        {
          productId: 'prod-1',
          unitId: 'unit-1',
          quantity: D('2'),
          returnedQuantity: D('2'),
          restockUnitCost: D('60'),
        },
        {
          productId: 'prod-1',
          unitId: 'unit-1',
          quantity: D('3'),
          returnedQuantity: D('3'),
          restockUnitCost: D('60'),
        },
      ],
    });
    (prisma.journalEntry.findFirst as jest.Mock).mockResolvedValueOnce(financialReversalJe());
    (prisma.journalEntry.findFirst as jest.Mock).mockResolvedValueOnce(
      restockJe({
        lines: [
          {
            accountId: 'acc-inv',
            description: 'Inventory returned to stock',
            debit: D('300'), // 2*60 + 3*60 — the FULL restock across both lines
            credit: D('0'),
            divisionId: null,
            branchId: null,
          },
          {
            accountId: 'acc-cogs',
            description: 'COGS reversal on returned goods',
            debit: D('0'),
            credit: D('300'),
            divisionId: null,
            branchId: null,
          },
        ],
      }),
    );
    // Model same-transaction own-writes visibility: once line 1's compensating
    // movement is created, a subsequent per-product findFirst WOULD see it. The
    // per-note probe must run BEFORE any movement is created and only once.
    (inventoryMovements.createMovement as jest.Mock).mockImplementation(async (input: any) => {
      const mov = { id: `mov-void-${createdVoidMovements.length + 1}`, ...input };
      createdVoidMovements.push(mov);
      return mov;
    });
    (prisma.inventoryMovement.findFirst as jest.Mock).mockImplementation(async ({ where }: any) => {
      const match = createdVoidMovements.find(
        (m) =>
          m.referenceType === where.referenceType &&
          m.referenceId === where.referenceId &&
          m.movementType === where.movementType &&
          (!where.productId || m.productId === where.productId),
      );
      return match ? { id: match.id } : null;
    });

    await service.void('cn-1', { reason: 'Issued in error' }, user);

    // BOTH same-product lines unwind — one compensating ADJUSTMENT_OUT each.
    expect(inventoryMovements.createMovement).toHaveBeenCalledTimes(2);
    const quantities = (inventoryMovements.createMovement as jest.Mock).mock.calls
      .map((c: any[]) => c[0].quantity)
      .sort();
    expect(quantities).toEqual([2, 3]);
    // The physical unwind (2+3 units @60 = 300) now matches the full GL
    // reversal of the stored 300 restock JE.
    expect(postingEngine.postLines).toHaveBeenCalledTimes(2);
    const restockRev = postingEngine.postLines.mock.calls[1][0];
    const inv = restockRev.lines.find((l: any) => l.accountId === 'acc-inv');
    expect(new Prisma.Decimal(inv.credit).toString()).toBe('300');
  });

  it('[Finding 14] a re-void skips the ENTIRE physical loop on the per-note probe but still runs the guarded GL reversal', async () => {
    const receivable = {
      id: 'rec-1',
      companyId: 'company-1',
      customerId: 'customer-1',
      amount: D('400'),
      outstandingAmount: D('0'),
      paidAmount: D('0'),
      status: 'PAID',
    };
    const { service, prisma, inventoryMovements, postingEngine } = makeService({
      note: {
        status: CreditNoteStatus.ISSUED,
        journalEntryId: 'je-1',
        receivableId: 'rec-1',
        appliedAmount: D('400'),
      },
      receivable,
      lines: [returnLine()],
    });
    (prisma.journalEntry.findFirst as jest.Mock).mockResolvedValueOnce(financialReversalJe());
    (prisma.journalEntry.findFirst as jest.Mock).mockResolvedValueOnce(restockJe());
    // A compensating movement from a prior void attempt already exists for the
    // note — the per-note probe must skip every line without creating movements.
    (prisma.inventoryMovement.findFirst as jest.Mock).mockResolvedValue({ id: 'mov-prior' });

    await service.void('cn-1', { reason: 'Issued in error' }, user);

    expect(inventoryMovements.createMovement).not.toHaveBeenCalled();
    // The probe is note-keyed: exactly ONE probe, and it carries NO productId.
    expect(prisma.inventoryMovement.findFirst).toHaveBeenCalledTimes(1);
    const probeWhere = (prisma.inventoryMovement.findFirst as jest.Mock).mock.calls[0][0].where;
    expect(probeWhere.productId).toBeUndefined();
    expect(probeWhere.referenceType).toBe('CreditNoteVoid');
    expect(probeWhere.referenceId).toBe('cn-1');
    // The GL reversal is guarded separately (REVERSED claim) and still runs.
    expect(postingEngine.postLines).toHaveBeenCalledTimes(2);
  });

  it('[Finding 15] void succeeds when interim sales drove on-hand below the returned qty (allowNegativeOnHand bypass)', async () => {
    // Scenario: restock +3 at issue, the 3 units were since re-sold (on-hand 0).
    // The compensating ADJUSTMENT_OUT of 3 would hit the negative-stock guard;
    // the void must thread allowNegativeOnHand so the unwind still posts.
    const receivable = {
      id: 'rec-1',
      companyId: 'company-1',
      customerId: 'customer-1',
      amount: D('400'),
      outstandingAmount: D('0'),
      paidAmount: D('0'),
      status: 'PAID',
    };
    const { service, prisma, inventoryMovements } = makeService({
      note: {
        status: CreditNoteStatus.ISSUED,
        journalEntryId: 'je-1',
        receivableId: 'rec-1',
        appliedAmount: D('400'),
      },
      receivable,
      lines: [returnLine()],
    });
    (prisma.journalEntry.findFirst as jest.Mock).mockResolvedValueOnce(financialReversalJe());
    (prisma.journalEntry.findFirst as jest.Mock).mockResolvedValueOnce(restockJe());

    // Model the REAL negative-stock guard in applyMovementToBalance: branch
    // on-hand is 0, so ANY outbound movement without the explicit bypass throws
    // (this is exactly what made an erroneous ISSUED note un-voidable).
    const onHand = 0;
    (inventoryMovements.createMovement as jest.Mock).mockImplementation(async (input: any) => {
      const outbound = ['SALE_ISSUE', 'ADJUSTMENT_OUT', 'DAMAGE', 'WASTAGE'].includes(
        input.movementType,
      );
      if (outbound && onHand - input.quantity < 0 && !input.allowNegativeOnHand) {
        throw new Error(
          `Insufficient stock at branch/location ${input.branchId}: requested ${input.quantity}, available ${onHand}`,
        );
      }
      return { id: 'mov-void-1' };
    });

    // The void must complete — not roll back the AR/revenue/VAT reversal.
    await expect(service.void('cn-1', { reason: 'Issued in error' }, user)).resolves.toBeDefined();

    const mv = (inventoryMovements.createMovement as jest.Mock).mock.calls[0][0];
    expect(mv.movementType).toBe('ADJUSTMENT_OUT');
    expect(mv.quantity).toBe(3);
    expect(mv.allowNegativeOnHand).toBe(true);
  });

  it('[Finding 16] void acquires the inventory-side locks BEFORE the receivable lock (same order as issue)', async () => {
    // issue() locks inventory (movement sequence + inventory_balances, via
    // restockReturnedLines) before the receivable FOR UPDATE (applyToReceivable).
    // void() must match — inventory unwind first, receivable restore second —
    // or a concurrent issue/void pair forms an ABBA deadlock (40P01).
    const receivable = {
      id: 'rec-1',
      companyId: 'company-1',
      customerId: 'customer-1',
      amount: D('400'),
      outstandingAmount: D('0'),
      paidAmount: D('0'),
      status: 'PAID',
    };
    const { service, prisma, inventoryMovements } = makeService({
      note: {
        status: CreditNoteStatus.ISSUED,
        journalEntryId: 'je-1',
        receivableId: 'rec-1',
        appliedAmount: D('400'),
      },
      receivable,
      lines: [returnLine()],
    });
    (prisma.journalEntry.findFirst as jest.Mock).mockResolvedValueOnce(financialReversalJe());
    (prisma.journalEntry.findFirst as jest.Mock).mockResolvedValueOnce(restockJe());

    const order: string[] = [];
    (inventoryMovements.createMovement as jest.Mock).mockImplementation(async () => {
      // Stands in for the inventory-side locks (sequence row + balance row).
      order.push('inventory-locks');
      return { id: 'mov-void-1' };
    });
    (prisma.$queryRaw as jest.Mock).mockImplementation(async (query: unknown) => {
      const sql = String(query);
      if (sql.includes('credit_notes')) return [{ id: 'cn-1' }];
      if (sql.includes('receivables')) {
        // The receivable FOR UPDATE taken by restoreReceivable.
        order.push('receivable-lock');
        return [receivable];
      }
      return [];
    });

    await service.void('cn-1', { reason: 'Issued in error' }, user);

    expect(order).toContain('inventory-locks');
    expect(order).toContain('receivable-lock');
    expect(order.indexOf('inventory-locks')).toBeLessThan(order.indexOf('receivable-lock'));
  });
});
