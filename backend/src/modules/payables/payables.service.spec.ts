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
    sourceType: null,
    outstandingAmount: '500',
    paidAmount: '0',
    status: 'OPEN',
    currency: 'TZS',
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
    cashAccount: {
      // Default: an active CASH_ON_HAND till in the same company and currency.
      // Individual tests override for BANK / cross-company / cross-currency
      // scenarios.
      findFirst: jest
        .fn()
        .mockResolvedValue({ companyId: 'company-1', accountType: 'CASH_ON_HAND', currency: 'TZS' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
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

describe('PayablesService.recordPayment cash subledger + role (cashAccountId)', () => {
  // Role-aware resolver so we can assert which GL cash account the CR leg hit.
  function cashRoleResolver() {
    return jest.fn(async (_companyId: string, role: string) => {
      const ids: Record<string, string> = {
        AP_CONTROL: 'ap-acc',
        CASH_ON_HAND: 'cash-acc',
        BANK: 'bank-acc',
      };
      const id = ids[role];
      if (!id) throw new BadRequestException(`Cannot resolve role "${role}"`);
      return { id } as any;
    });
  }

  function openPayable(overrides: Record<string, unknown> = {}) {
    return lockedPayable({
      status: 'OPEN',
      outstandingAmount: '500',
      paidAmount: '0',
      ...overrides,
    });
  }

  it('posts DR AP_CONTROL / CR BANK and decrements the specific CashAccount for a bank payment', async () => {
    const { service, tx, postingEngine } = makeService(openPayable(), {
      resolve: cashRoleResolver(),
    });
    tx.payable.update.mockResolvedValue({
      ...openPayable(),
      outstandingAmount: '300',
      paidAmount: '200',
      status: 'PARTIALLY_PAID',
    });
    tx.cashAccount.findFirst.mockResolvedValue({ companyId: 'company-1', accountType: 'BANK' });

    await service.recordPayment('pay-1', { amount: 200, cashAccountId: 'bank-1' } as any, user);

    // GL: DR AP_CONTROL 200 / CR BANK 200 (not CASH_ON_HAND).
    const [postingInput] = postingEngine.postLines.mock.calls[0];
    const lines = postingInput.lines;
    const apLine = lines.find((l: any) => l.accountId === 'ap-acc');
    const bankLine = lines.find((l: any) => l.accountId === 'bank-acc');
    expect(Number(apLine.debit)).toBe(200);
    expect(Number(bankLine.credit)).toBe(200);
    expect(lines.some((l: any) => l.accountId === 'cash-acc')).toBe(false);
    const totalDebit = lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
    const totalCredit = lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
    expect(totalDebit).toBe(totalCredit);

    // Subledger: the chosen CashAccount is decremented by the payment amount,
    // company-scoped, in the same transaction.
    expect(tx.cashAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'bank-1', companyId: 'company-1', deletedAt: null },
      data: { currentBalance: { decrement: expect.anything() } },
    });
    const [{ data }] = tx.cashAccount.updateMany.mock.calls[0];
    expect(Number(data.currentBalance.decrement)).toBe(200);
  });

  it('credits CASH_ON_HAND and decrements the till for a cash payment', async () => {
    const { service, tx, postingEngine } = makeService(openPayable(), {
      resolve: cashRoleResolver(),
    });
    tx.payable.update.mockResolvedValue({
      ...openPayable(),
      outstandingAmount: '400',
      paidAmount: '100',
      status: 'PARTIALLY_PAID',
    });
    tx.cashAccount.findFirst.mockResolvedValue({
      companyId: 'company-1',
      accountType: 'CASH_ON_HAND',
    });

    await service.recordPayment('pay-1', { amount: 100, cashAccountId: 'till-1' } as any, user);

    const [postingInput] = postingEngine.postLines.mock.calls[0];
    const cashLine = postingInput.lines.find((l: any) => l.accountId === 'cash-acc');
    expect(Number(cashLine.credit)).toBe(100);
    expect(tx.cashAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'till-1', companyId: 'company-1', deletedAt: null },
      data: { currentBalance: { decrement: expect.anything() } },
    });
  });

  it('does not touch CashAccount.currentBalance when no cashAccountId is supplied (legacy)', async () => {
    const { service, tx, postingEngine } = makeService(openPayable(), {
      resolve: cashRoleResolver(),
    });
    tx.payable.update.mockResolvedValue({
      ...openPayable(),
      outstandingAmount: '0',
      paidAmount: '500',
      status: 'PAID',
    });

    await service.recordPayment('pay-1', { amount: 500 } as any, user);

    // Legacy path still posts DR AP / CR CASH_ON_HAND but relieves no subledger row.
    const [postingInput] = postingEngine.postLines.mock.calls[0];
    expect(postingInput.lines.find((l: any) => l.accountId === 'cash-acc')).toBeTruthy();
    expect(tx.cashAccount.findFirst).not.toHaveBeenCalled();
    expect(tx.cashAccount.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a cashAccountId that belongs to another company (no journal, no decrement)', async () => {
    const { service, tx, postingEngine } = makeService(openPayable(), {
      resolve: cashRoleResolver(),
    });
    tx.cashAccount.findFirst.mockResolvedValue({ companyId: 'other-company', accountType: 'BANK' });

    await expect(
      service.recordPayment('pay-1', { amount: 100, cashAccountId: 'bank-x' } as any, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.cashAccount.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a cash account whose currency differs from the payable currency (no journal, no decrement, rollback)', async () => {
    // USD payable paid from a TZS bank account: the raw USD amount would be
    // subtracted from a TZS-denominated CashAccount.currentBalance, desyncing
    // the cash subledger cache from the GL by the full FX spread.
    const { service, tx, postingEngine, readCommitted } = makeService(
      openPayable({ currency: 'USD', outstandingAmount: '1000' }),
      { resolve: cashRoleResolver() },
    );
    tx.cashAccount.findFirst.mockResolvedValue({
      companyId: 'company-1',
      accountType: 'BANK',
      currency: 'TZS',
    });

    await expect(
      service.recordPayment('pay-1', { amount: 1000, cashAccountId: 'bank-tzs' } as any, user),
    ).rejects.toThrow(/does not match the payable currency/);

    // No GL posting, no cash-cache decrement, and the subledger mutation rolled
    // back with the transaction.
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.cashAccount.updateMany).not.toHaveBeenCalled();
    expect(readCommitted()).toMatchObject({ status: 'OPEN', outstandingAmount: '1000' });
  });

  it('accepts a cash account matching the payable currency (USD payable, USD bank account)', async () => {
    const { service, tx, postingEngine } = makeService(
      openPayable({ currency: 'USD', outstandingAmount: '1000' }),
      { resolve: cashRoleResolver() },
    );
    tx.cashAccount.findFirst.mockResolvedValue({
      companyId: 'company-1',
      accountType: 'BANK',
      currency: 'USD',
    });

    await service.recordPayment('pay-1', { amount: 1000, cashAccountId: 'bank-usd' } as any, user);

    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    expect(tx.cashAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'bank-usd', companyId: 'company-1', deletedAt: null },
      data: { currentBalance: { decrement: expect.anything() } },
    });
  });
});

describe('PayablesService Expense-sourced settlement guards (single settlement path)', () => {
  it('rejects recordPayment on an Expense-sourced payable (no journal, no subledger move)', async () => {
    const { service, tx, postingEngine } = makeService(
      lockedPayable({ sourceType: 'Expense', sourceId: 'expense-1' }),
    );

    await expect(
      service.recordPayment('pay-1', { amount: 100 } as any, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.payable.update).not.toHaveBeenCalled();
    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });

  it('rejects writeOff on an Expense-sourced payable (no forgiveness journal)', async () => {
    const { service, tx, postingEngine } = makeService(
      lockedPayable({ sourceType: 'Expense', sourceId: 'expense-1' }),
    );

    await expect(service.writeOff('pay-1', { reason: 'x' } as any, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.payable.update).not.toHaveBeenCalled();
    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });

  it('rejects remove on an Expense-sourced payable (soft-deleting the mirror would resurrect the legacy cash-basis double posting)', async () => {
    // If the mirror payable disappears, ExpensesService.pay() finds no accrual
    // and falls back to the legacy DR Expense / CR Cash journal — recognising
    // the cost twice and stranding the accrual's AP_CONTROL credit forever.
    const { service, tx, prisma } = makeService(
      lockedPayable({ sourceType: 'Expense', sourceId: 'expense-1' }),
    );

    await expect(service.remove('pay-1', user)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.payable.update).not.toHaveBeenCalled();
  });

  it('still soft-deletes an ordinary manual payable', async () => {
    const { service, tx } = makeService(lockedPayable());

    await expect(service.remove('pay-1', user)).resolves.toEqual({ success: true });
    expect(tx.payable.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("rejects a manually created payable with the reserved sourceType 'Expense' before posting anything", async () => {
    // The Expense guards key on sourceType, so a caller-supplied 'Expense'
    // payable would post a real DR expense / CR AP journal at create yet be
    // permanently unsettleable (recordPayment and writeOff both reject it).
    const { service, prisma, postingEngine } = makeService(lockedPayable());

    await expect(
      service.create(
        {
          companyId: 'company-1',
          supplierName: 'Acme',
          sourceType: 'Expense',
          sourceId: 'expense-1',
          amount: 100,
          issueDate: '2026-01-15',
        } as any,
        user,
      ),
    ).rejects.toThrow(/reserved for system-generated payables/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
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
