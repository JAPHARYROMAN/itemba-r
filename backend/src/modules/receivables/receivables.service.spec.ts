import { BadRequestException } from '@nestjs/common';
import { ReceivablesService } from './receivables.service';

const user = { id: 'user-1' } as any;

function lockedReceivable(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    companyId: 'company-1',
    divisionId: null,
    branchId: null,
    customerId: 'cust-1',
    customerName: 'Acme Ltd',
    receivableNumber: 'REC-2026-000001',
    outstandingAmount: '500',
    paidAmount: '0',
    status: 'OPEN',
    ...overrides,
  };
}

function makeService(
  lockedRow: Record<string, unknown>,
  opts: { cashAccount?: any; badDebtAccount?: any } = {},
) {
  let committedRow = { ...lockedRow };
  let stagedRow = { ...committedRow };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([lockedRow]),
    receivable: {
      update: jest.fn().mockImplementation(({ data }: any) => {
        stagedRow = { ...stagedRow, ...data };
        return { ...stagedRow };
      }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { outstandingAmount: '0' } }),
    },
    customer: { updateMany: jest.fn() },
    salesOrder: { updateMany: jest.fn() },
    cashAccount: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.cashAccount ?? { companyId: 'company-1', accountType: 'CASH' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    chartOfAccount: {
      // Use hasOwnProperty so an explicit `badDebtAccount: null` (the "no
      // dedicated bad-debt account seeded" case) actually resolves to null and
      // forces the GENERAL_EXPENSE fallback — `?? { id: 'bad-debt-acc' }` would
      // wrongly coalesce the null back to a found account.
      findFirst: jest
        .fn()
        .mockResolvedValue('badDebtAccount' in opts ? opts.badDebtAccount : { id: 'bad-debt-acc' }),
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
  const accountResolver = {
    resolve: jest.fn(async (_c: string, role: string) => ({ id: `${role}-acc` })),
  } as any;
  const postingEngine = { postLines: jest.fn().mockResolvedValue({ id: 'je-1' }) } as any;
  const auditLogs = {
    log: jest.fn().mockResolvedValue(undefined),
    logStrictInTransaction: jest.fn().mockResolvedValue(undefined),
  } as any;

  const service = new ReceivablesService(
    prisma,
    auditLogs,
    companyScope,
    accountResolver,
    postingEngine,
    { next: jest.fn() } as any,
  );

  // Stub findOne (used by writeOff to load the receivable before the tx).
  jest.spyOn(service as any, 'findOne').mockResolvedValue({ ...lockedRow });

  return {
    service,
    tx,
    postingEngine,
    accountResolver,
    auditLogs,
    readCommitted: () => ({ ...committedRow }),
  };
}

describe('ReceivablesService.recordPayment GL settlement', () => {
  it('posts a balanced DR Cash / CR AR_CONTROL settlement journal', async () => {
    const { service, postingEngine } = makeService(lockedReceivable());

    await service.recordPayment('rec-1', { amount: 500 } as any, user);

    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    const [postingInput] = postingEngine.postLines.mock.calls[0];
    const lines = postingInput.lines;

    const cashLine = lines.find((l: any) => l.accountId === 'CASH_ON_HAND-acc');
    const arLine = lines.find((l: any) => l.accountId === 'AR_CONTROL-acc');

    expect(Number(cashLine.debit)).toBe(500);
    expect(Number(cashLine.credit)).toBe(0);
    expect(Number(arLine.credit)).toBe(500);
    expect(Number(arLine.debit)).toBe(0);

    const totalDebit = lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
    const totalCredit = lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(500);
    expect(postingInput.referenceType).toBe('Receivable');
    expect(postingInput.referenceId).toBe('rec-1');
  });

  it('uses the BANK cash role when a bank cashAccountId is supplied', async () => {
    const { service, tx, postingEngine } = makeService(lockedReceivable(), {
      cashAccount: { companyId: 'company-1', accountType: 'BANK' },
    });

    await service.recordPayment('rec-1', { amount: 200, cashAccountId: 'bank-1' } as any, user);

    expect(tx.cashAccount.findFirst).toHaveBeenCalled();
    const [postingInput] = postingEngine.postLines.mock.calls[0];
    const bankLine = postingInput.lines.find((l: any) => l.accountId === 'BANK-acc');
    expect(Number(bankLine.debit)).toBe(200);

    // The denormalised CashAccount.currentBalance cache is incremented by the
    // payment amount in the same tx, scoped by id + companyId (mirrors
    // customer-payments.create). Direction: increment on cash receipt.
    expect(tx.cashAccount.updateMany).toHaveBeenCalledTimes(1);
    const [balanceUpdate] = tx.cashAccount.updateMany.mock.calls[0];
    expect(balanceUpdate.where).toMatchObject({
      id: 'bank-1',
      companyId: 'company-1',
      deletedAt: null,
    });
    expect(Number(balanceUpdate.data.currentBalance.increment)).toBe(200);
  });

  it('does not touch CashAccount.currentBalance when no cashAccountId is supplied', async () => {
    const { service, tx } = makeService(lockedReceivable());

    await service.recordPayment('rec-1', { amount: 500 } as any, user);

    expect(tx.cashAccount.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a cashAccountId that belongs to another company', async () => {
    const { service, postingEngine } = makeService(lockedReceivable(), {
      cashAccount: { companyId: 'other-company', accountType: 'BANK' },
    });

    await expect(
      service.recordPayment('rec-1', { amount: 100, cashAccountId: 'bank-x' } as any, user),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a payment against a WRITTEN_OFF receivable and posts no journal', async () => {
    const { service, tx, postingEngine } = makeService(lockedReceivable({ status: 'WRITTEN_OFF' }));

    await expect(
      service.recordPayment('rec-1', { amount: 100 } as any, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.receivable.update).not.toHaveBeenCalled();
    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });
});

describe('ReceivablesService.update customer balance projection', () => {
  it('does not recalculate or rewrite a customer for a notes-only update', async () => {
    const existing = lockedReceivable();
    const { service, tx } = makeService(existing);
    jest.spyOn(service as any, 'resolveReceivableScope').mockResolvedValue({
      divisionId: null,
      branchId: null,
      customerName: 'Acme Ltd',
    });

    await service.update('rec-1', { notes: 'Updated note' } as any, user);

    expect(tx.receivable.aggregate).not.toHaveBeenCalled();
    expect(tx.customer.updateMany).not.toHaveBeenCalled();
  });

  it('refreshes the old and new customer exactly once when reassigned', async () => {
    const existing = lockedReceivable();
    const { service, tx } = makeService(existing);
    jest.spyOn(service as any, 'resolveReceivableScope').mockResolvedValue({
      divisionId: null,
      branchId: null,
      customerName: 'Beta Ltd',
    });

    await service.update('rec-1', { customerId: 'cust-2' } as any, user);

    expect(tx.receivable.aggregate).toHaveBeenCalledTimes(2);
    expect(tx.customer.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.customer.updateMany.mock.calls.map(([args]: [any]) => args.where.id)).toEqual([
      'cust-1',
      'cust-2',
    ]);
  });
});

describe('ReceivablesService.writeOff bad-debt journal', () => {
  it('posts a balanced DR Bad debt / CR AR_CONTROL journal and zeroes outstanding', async () => {
    const { service, tx, postingEngine } = makeService(lockedReceivable());

    await service.writeOff('rec-1', { reason: 'uncollectible' } as any, user);

    // Outstanding is zeroed and status flipped so it can never be paid again.
    expect(tx.receivable.update).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      data: expect.objectContaining({ status: 'WRITTEN_OFF', outstandingAmount: 0 }),
    });

    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    const [postingInput] = postingEngine.postLines.mock.calls[0];
    const lines = postingInput.lines;

    const badDebtLine = lines.find((l: any) => l.accountId === 'bad-debt-acc');
    const arLine = lines.find((l: any) => l.accountId === 'AR_CONTROL-acc');

    expect(Number(badDebtLine.debit)).toBe(500);
    expect(Number(badDebtLine.credit)).toBe(0);
    expect(Number(arLine.credit)).toBe(500);
    expect(Number(arLine.debit)).toBe(0);

    const totalDebit = lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
    const totalCredit = lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(500);
  });

  it('appends the attributable audit after the subledger and customer projection on the same tx', async () => {
    const { service, tx, auditLogs, readCommitted } = makeService(lockedReceivable());

    await service.writeOff('rec-1', { reason: 'uncollectible' } as any, user);

    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledWith(tx, {
      action: 'RECEIVABLE_WRITE_OFF',
      entityType: 'Receivable',
      entityId: 'rec-1',
      userId: 'user-1',
      companyId: 'company-1',
      oldValue: { status: 'OPEN' },
      newValue: { status: 'WRITTEN_OFF', reason: 'uncollectible' },
    });
    expect(tx.receivable.update.mock.invocationCallOrder[0]).toBeLessThan(
      auditLogs.logStrictInTransaction.mock.invocationCallOrder[0],
    );
    expect(tx.customer.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      auditLogs.logStrictInTransaction.mock.invocationCallOrder[0],
    );
    expect(readCommitted()).toMatchObject({ status: 'WRITTEN_OFF', outstandingAmount: 0 });
  });

  it('does not commit the write-off when the mandatory audit append fails', async () => {
    const { service, tx, auditLogs, readCommitted } = makeService(lockedReceivable());
    auditLogs.logStrictInTransaction.mockRejectedValueOnce(new Error('audit store unavailable'));

    await expect(
      service.writeOff('rec-1', { reason: 'uncollectible' } as any, user),
    ).rejects.toThrow('audit store unavailable');

    expect(tx.receivable.update).toHaveBeenCalled();
    expect(readCommitted()).toMatchObject({ status: 'OPEN', outstandingAmount: '500' });
    expect(auditLogs.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RECEIVABLE_WRITE_OFF' }),
    );
  });

  it('falls back to GENERAL_EXPENSE when no dedicated bad-debt account is seeded', async () => {
    const { service, postingEngine } = makeService(lockedReceivable(), { badDebtAccount: null });

    await service.writeOff('rec-1', { reason: 'uncollectible' } as any, user);

    const [postingInput] = postingEngine.postLines.mock.calls[0];
    const expenseLine = postingInput.lines.find((l: any) => l.accountId === 'GENERAL_EXPENSE-acc');
    expect(Number(expenseLine.debit)).toBe(500);
  });

  it('posts no journal when there is nothing outstanding', async () => {
    const { service, tx, postingEngine } = makeService(
      lockedReceivable({ outstandingAmount: '0' }),
    );

    await service.writeOff('rec-1', { reason: 'already settled' } as any, user);

    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.receivable.update).toHaveBeenCalled();
  });

  it('rejects writing off an already-PAID receivable', async () => {
    const { service, tx, postingEngine } = makeService(lockedReceivable({ status: 'PAID' }));

    await expect(service.writeOff('rec-1', { reason: 'x' } as any, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.receivable.update).not.toHaveBeenCalled();
  });
});
