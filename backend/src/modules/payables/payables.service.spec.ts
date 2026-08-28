import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayablesService } from './payables.service';

const user = { id: 'user-1' } as any;

function lockedPayable(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    companyId: 'company-1',
    divisionId: null,
    branchId: null,
    supplierId: 'supplier-1',
    supplierName: 'Acme',
    payableNumber: 'PAY-2026-000001',
    outstandingAmount: '500',
    paidAmount: '0',
    status: 'OPEN',
    journalEntryId: 'je-original',
    issueDate: new Date('2026-01-15'),
    ...overrides,
  };
}

function makeService(
  lockedRow: Record<string, unknown>,
  opts: { originalJe?: any; resolve?: jest.Mock } = {},
) {
  let committedRow = { ...lockedRow };
  let stagedRow = { ...committedRow };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([lockedRow]),
    payable: {
      update: jest.fn().mockImplementation(async ({ data }: any) => {
        stagedRow = { ...stagedRow, ...data };
        return { ...stagedRow };
      }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    supplier: { updateMany: jest.fn() },
    companyProfile: { findUnique: jest.fn().mockResolvedValue({ currency: 'TZS' }) },
    journalEntry: {
      findFirst: jest.fn().mockResolvedValue(opts.originalJe ?? null),
    },
  } as any;
  const prisma = {
    $transaction: jest.fn(async (fn: any) => {
      stagedRow = { ...committedRow };
      try {
        const result = await fn(tx);
        committedRow = { ...stagedRow };
        return result;
      } catch (error) {
        stagedRow = { ...committedRow };
        throw error;
      }
    }),
  } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const postingEngine = { postLines: jest.fn().mockResolvedValue({ id: 'je-rev' }) } as any;
  // Resolve accounts by semantic role so writeOff posts DR AP_CONTROL /
  // CR LIABILITY_WRITEOFF_INCOME. Default returns a role-named stub account.
  const resolve =
    opts.resolve ??
    jest.fn(async (_companyId: string, role: string) => ({ id: `${role}-acc` }) as any);
  const auditLogs = {
    log: jest.fn().mockResolvedValue(undefined),
    logStrictInTransaction: jest.fn().mockResolvedValue(undefined),
  } as any;
  const service = new PayablesService(
    prisma,
    auditLogs,
    companyScope,
    { resolve } as any,
    postingEngine,
    { next: jest.fn() } as any,
  );
  // Stub findOne (used by writeOff to load the payable before the tx).
  jest
    .spyOn(service as any, 'findOne')
    .mockResolvedValue({ ...lockedRow, status: lockedRow.status });
  return {
    service,
    tx,
    postingEngine,
    prisma,
    resolve,
    auditLogs,
    readCommitted: () => ({ ...committedRow }),
  };
}

describe('PayablesService.recordPayment status guard', () => {
  it('rejects a payment against a WRITTEN_OFF payable and posts no settlement journal', async () => {
    // writeOff() zeroes outstandingAmount, but even when it did not the status
    // guard is what blocks this.
    const { service, tx, postingEngine } = makeService(lockedPayable({ status: 'WRITTEN_OFF' }));

    await expect(
      service.recordPayment('pay-1', { amount: 100 } as any, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.payable.update).not.toHaveBeenCalled();
    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });
});

describe('PayablesService.update supplier balance projection', () => {
  it('does not recalculate or rewrite a supplier for a notes-only update', async () => {
    const existing = lockedPayable();
    const { service, tx } = makeService(existing);
    jest.spyOn(service as any, 'resolvePayableScope').mockResolvedValue({
      divisionId: null,
      branchId: null,
      supplierName: 'Acme',
    });
    tx.payable.update.mockResolvedValue({ ...existing, notes: 'Updated note' });

    await service.update('pay-1', { notes: 'Updated note' } as any, user);

    expect(tx.payable.groupBy).not.toHaveBeenCalled();
    expect(tx.supplier.updateMany).not.toHaveBeenCalled();
  });

  it('refreshes the old and new supplier exactly once when reassigned', async () => {
    const existing = lockedPayable();
    const { service, tx } = makeService(existing);
    jest.spyOn(service as any, 'resolvePayableScope').mockResolvedValue({
      divisionId: null,
      branchId: null,
      supplierName: 'Beta',
    });
    tx.payable.update.mockResolvedValue({
      ...existing,
      supplierId: 'supplier-2',
      supplierName: 'Beta',
    });

    await service.update('pay-1', { supplierId: 'supplier-2' } as any, user);

    expect(tx.payable.groupBy).toHaveBeenCalledTimes(2);
    expect(tx.supplier.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.supplier.updateMany.mock.calls.map(([args]: [any]) => args.where.id)).toEqual([
      'supplier-1',
      'supplier-2',
    ]);
  });
});

describe('PayablesService.writeOff forgiveness journal (#H write-off, ITMB)', () => {
  // Role-aware resolver: writeOff must post DR AP_CONTROL / CR
  // LIABILITY_WRITEOFF_INCOME. It must NEVER credit INVENTORY_ASSET (the bug:
  // reversing an SI-backed payable's DR INVENTORY_ASSET / CR AP_CONTROL wiped
  // inventory still on hand).
  function roleResolver() {
    return jest.fn(async (_companyId: string, role: string) => {
      const ids: Record<string, string> = {
        AP_CONTROL: 'ap-acc',
        LIABILITY_WRITEOFF_INCOME: 'writeoff-income-acc',
        INVENTORY_ASSET: 'inventory-acc',
        GENERAL_EXPENSE: 'expense-acc',
      };
      const id = ids[role];
      if (!id) throw new BadRequestException(`Cannot resolve role "${role}"`);
      return { id } as any;
    });
  }

  it('posts DR AP_CONTROL / CR LIABILITY_WRITEOFF_INCOME (never touches inventory) and zeroes outstanding', async () => {
    const { service, tx, postingEngine } = makeService(lockedPayable(), {
      resolve: roleResolver(),
    });

    await service.writeOff('pay-1', { reason: 'supplier dispute' } as any, user);

    // Outstanding is zeroed and status flipped so it can never be paid again.
    expect(tx.payable.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: expect.objectContaining({ status: 'WRITTEN_OFF', outstandingAmount: 0 }),
    });

    // A single forgiveness journal was posted.
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    const [postingInput] = postingEngine.postLines.mock.calls[0];
    const lines = postingInput.lines;

    // DR AP_CONTROL for the outstanding amount.
    const apLine = lines.find((l: any) => l.accountId === 'ap-acc');
    expect(Number(apLine.debit)).toBe(500);
    expect(Number(apLine.credit)).toBe(0);

    // CR the liabilities-written-off / other-income account.
    const incomeLine = lines.find((l: any) => l.accountId === 'writeoff-income-acc');
    expect(Number(incomeLine.credit)).toBe(500);
    expect(Number(incomeLine.debit)).toBe(0);

    // The bug regression guard: NO inventory (or expense) line is emitted, so
    // stock still on hand is left in the GL.
    expect(lines.some((l: any) => l.accountId === 'inventory-acc')).toBe(false);
    expect(lines.some((l: any) => l.accountId === 'expense-acc')).toBe(false);

    // The entry balances at the outstanding amount.
    const totalDebit = lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
    const totalCredit = lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(500);
  });

  it('appends the attributable audit after the subledger and supplier projection on the same tx', async () => {
    const { service, tx, auditLogs, readCommitted } = makeService(lockedPayable(), {
      resolve: roleResolver(),
    });

    await service.writeOff('pay-1', { reason: 'supplier dispute' } as any, user);

    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledWith(tx, {
      action: 'PAYABLE_WRITE_OFF',
      entityType: 'Payable',
      entityId: 'pay-1',
      userId: 'user-1',
      companyId: 'company-1',
      oldValue: { status: 'OPEN' },
      newValue: { status: 'WRITTEN_OFF', reason: 'supplier dispute' },
    });
    expect(tx.payable.update.mock.invocationCallOrder[0]).toBeLessThan(
      auditLogs.logStrictInTransaction.mock.invocationCallOrder[0],
    );
    expect(tx.supplier.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      auditLogs.logStrictInTransaction.mock.invocationCallOrder[0],
    );
    expect(readCommitted()).toMatchObject({ status: 'WRITTEN_OFF', outstandingAmount: 0 });
  });

  it('does not commit the write-off when the mandatory audit append fails', async () => {
    const { service, tx, auditLogs, readCommitted } = makeService(lockedPayable(), {
      resolve: roleResolver(),
    });
    auditLogs.logStrictInTransaction.mockRejectedValueOnce(new Error('audit store unavailable'));

    await expect(
      service.writeOff('pay-1', { reason: 'supplier dispute' } as any, user),
    ).rejects.toThrow('audit store unavailable');

    expect(tx.payable.update).toHaveBeenCalled();
    expect(readCommitted()).toMatchObject({ status: 'OPEN', outstandingAmount: '500' });
    expect(auditLogs.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYABLE_WRITE_OFF' }),
    );
  });

  it('writes off only the unpaid remainder when the payable is partially paid', async () => {
    // Original was 500; 300 already paid, 200 outstanding. Only the 200 unpaid
    // remainder is forgiven so the prior payment is not double-relieved.
    const { service, postingEngine } = makeService(
      lockedPayable({ status: 'PARTIALLY_PAID', outstandingAmount: '200', paidAmount: '300' }),
      { resolve: roleResolver() },
    );

    await service.writeOff('pay-1', { reason: 'settle remainder' } as any, user);

    const [postingInput] = postingEngine.postLines.mock.calls[0];
    const lines = postingInput.lines;
    const apLine = lines.find((l: any) => l.accountId === 'ap-acc');
    const incomeLine = lines.find((l: any) => l.accountId === 'writeoff-income-acc');
    expect(Number(apLine.debit)).toBe(200);
    expect(Number(incomeLine.credit)).toBe(200);
    const totalDebit = lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
    const totalCredit = lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(200);
  });

  it('posts no journal when there is nothing outstanding', async () => {
    const { service, postingEngine, tx } = makeService(lockedPayable({ outstandingAmount: '0' }), {
      resolve: roleResolver(),
    });

    await service.writeOff('pay-1', { reason: 'already settled' } as any, user);

    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.payable.update).toHaveBeenCalled();
  });

  it('rejects writing off an already-PAID payable', async () => {
    const { service, postingEngine, tx } = makeService(lockedPayable({ status: 'PAID' }), {
      resolve: roleResolver(),
    });

    await expect(service.writeOff('pay-1', { reason: 'x' } as any, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.payable.update).not.toHaveBeenCalled();
  });

  it('fails loudly (no journal, no status change) when the write-off income account is unconfigured', async () => {
    // Resolver has AP_CONTROL but NOT LIABILITY_WRITEOFF_INCOME: rather than
    // posting the forgiveness gain to a wrong/zero account, writeOff throws.
    const resolve = jest.fn(async (_companyId: string, role: string) => {
      if (role === 'AP_CONTROL') return { id: 'ap-acc' } as any;
      throw new BadRequestException(`Cannot resolve role "${role}"`);
    });
    const { service, postingEngine, tx } = makeService(lockedPayable(), { resolve });

    await expect(
      service.writeOff('pay-1', { reason: 'dispute' } as any, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.payable.update).not.toHaveBeenCalled();
  });
});

describe('PayablesService.syncSupplierBalance mixed-currency (#22)', () => {
  it('writes only the base-currency outstanding, not a cross-currency sum', async () => {
    const { service, tx } = makeService(lockedPayable());

    // Supplier has 1,000,000 TZS and 1,000 USD open. Base currency is TZS.
    tx.payable.groupBy.mockResolvedValue([
      { currency: 'TZS', _sum: { outstandingAmount: new Prisma.Decimal('1000000') } },
      { currency: 'USD', _sum: { outstandingAmount: new Prisma.Decimal('1000') } },
    ]);

    await (service as any).syncSupplierBalance(tx, 'company-1', 'supplier-1');

    expect(tx.supplier.updateMany).toHaveBeenCalledWith({
      where: { id: 'supplier-1', companyId: 'company-1', deletedAt: null },
      data: { currentBalance: new Prisma.Decimal('1000000') },
    });
  });

  it('writes zero when no payable matches the base currency', async () => {
    const { service, tx } = makeService(lockedPayable());
    tx.companyProfile.findUnique.mockResolvedValue({ currency: 'TZS' });
    tx.payable.groupBy.mockResolvedValue([
      { currency: 'USD', _sum: { outstandingAmount: new Prisma.Decimal('1000') } },
    ]);

    await (service as any).syncSupplierBalance(tx, 'company-1', 'supplier-1');

    expect(tx.supplier.updateMany).toHaveBeenCalledWith({
      where: { id: 'supplier-1', companyId: 'company-1', deletedAt: null },
      data: { currentBalance: 0 },
    });
  });
});
