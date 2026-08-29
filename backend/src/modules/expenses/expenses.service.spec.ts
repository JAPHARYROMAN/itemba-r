import { BadRequestException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ExpensesService } from './expenses.service';

function authUser(): AuthUser {
  return {
    id: 'user-1',
    email: 'accountant@itemba.local',
    roles: ['Accountant'],
    permissions: ['expenses.pay'],
    companyId: 'company-1',
    companyAccess: [{ companyId: 'company-1', accessLevel: AccessLevel.MANAGE }],
  };
}

function approvedExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'expense-1',
    expenseNumber: 'EXP-2026-000001',
    companyId: 'company-1',
    divisionId: null,
    branchId: null,
    cashAccountId: null,
    currency: 'TZS',
    amount: 22500,
    description: 'Daily wages',
    paymentMethod: null,
    status: 'APPROVED',
    expenseDate: new Date('2026-03-10'),
    vendorName: 'Casual Labour Pool',
    journalEntryId: null,
    expenseCategory: { linkedAccountId: 'expense-ledger-1' },
    ...overrides,
  } as any;
}

function pendingExpense(overrides: Record<string, unknown> = {}) {
  return approvedExpense({
    status: 'PENDING_APPROVAL',
    approvedById: null,
    approvedAt: null,
    ...overrides,
  });
}

function makeHarness() {
  const tx = {
    // approve() re-reads amount/journalEntryId and pay() re-reads status under
    // a row lock (SELECT ... FOR UPDATE). The default committed row is an
    // APPROVED, un-accrued expense at the fixture amount; individual tests
    // override to simulate concurrent commits.
    $queryRaw: jest
      .fn()
      .mockResolvedValue([
        { id: 'expense-1', status: 'APPROVED', amount: 22500, journalEntryId: null },
      ]),
    cashAccount: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    chartOfAccount: {
      findFirst: jest.fn().mockResolvedValue({ id: 'cash-ledger-1' }),
    },
    expense: {
      // approve() re-reads status/journalEntryId when its atomic claim loses.
      findFirst: jest.fn().mockResolvedValue({ journalEntryId: null }),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({
        ...approvedExpense(),
        ...data,
      })),
      // approve()'s atomic status claim (compare-and-set); default: claim won.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    payable: {
      // pay() looks for the Expense-sourced payable opened at approval; the
      // default (no accrued payable) keeps the legacy cash-basis path.
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'payable-1', ...data })),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'payable-1', ...data })),
    },
  };
  const prisma = {
    // reject()/update() run their status-guarded compare-and-set outside a tx.
    expense: { findFirst: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    division: { findFirst: jest.fn() },
    branch: { findFirst: jest.fn() },
    cashAccount: { findMany: jest.fn() },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  } as any;
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const accountingControl = { assertPostingAllowed: jest.fn().mockResolvedValue(undefined) } as any;
  const codes = { next: jest.fn().mockResolvedValue('JE-2026-000001') } as any;
  const companyScope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) } as any;
  const postingEngine = { postLines: jest.fn().mockResolvedValue({ id: 'journal-1' }) } as any;
  const accountResolver = {
    resolve: jest.fn(async (_companyId: string, role: string) => ({ id: `${role}-acc` })),
  } as any;
  // Input-VAT compliance mirror (TaxTransaction ledger). Disabled-by-default
  // no-op, mirroring the env-gated service.
  const taxAutoApply = {
    applyForExpense: jest
      .fn()
      .mockResolvedValue({ skipped: 0, booked: 0, total: 0, disabled: true }),
  } as any;
  const service = new ExpensesService(
    prisma,
    auditLogs,
    accountingControl,
    codes,
    companyScope,
    postingEngine,
    accountResolver,
    taxAutoApply,
  );

  return {
    service,
    prisma,
    tx,
    auditLogs,
    accountingControl,
    codes,
    companyScope,
    postingEngine,
    accountResolver,
    taxAutoApply,
  };
}

function sumLegs(lines: any[]) {
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit), 0);
  return { totalDebit, totalCredit };
}

describe('ExpensesService detail', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns scoped lifecycle, accounting, division, and branch context', async () => {
    const { service, prisma, companyScope } = makeHarness();
    prisma.expense.findFirst.mockResolvedValue({
      ...approvedExpense({ divisionId: 'division-1', branchId: 'branch-1' }),
      company: { id: 'company-1', name: 'Westsides Company Ltd', code: '001' },
      createdBy: { id: 'user-1', fullName: 'Accountant', email: 'accountant@itemba.local' },
      approvedBy: null,
      paidBy: null,
      cashAccount: null,
      journalEntry: null,
    });
    prisma.division.findFirst.mockResolvedValue({
      id: 'division-1',
      name: 'Hardware',
      code: 'HWB',
    });
    prisma.branch.findFirst.mockResolvedValue({
      id: 'branch-1',
      name: 'Kisimani Main Branch',
      code: 'TDM-001',
    });

    const result = await service.findOne('expense-1', authUser());

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      authUser(),
      'company-1',
      AccessLevel.READ,
    );
    expect(prisma.expense.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'expense-1', deletedAt: null },
        include: expect.objectContaining({ journalEntry: expect.any(Object) }),
      }),
    );
    expect(prisma.division.findFirst).toHaveBeenCalledWith({
      where: { id: 'division-1', companyId: 'company-1', deletedAt: null },
      select: { id: true, name: true, code: true },
    });
    expect(prisma.branch.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'branch-1',
        deletedAt: null,
        division: { companyId: 'company-1' },
      },
      select: { id: true, name: true, code: true },
    });
    expect(result).toEqual(
      expect.objectContaining({
        division: expect.objectContaining({ id: 'division-1' }),
        branch: expect.objectContaining({ id: 'branch-1' }),
      }),
    );
  });
});

describe('ExpensesService payment account selection', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns only active accounts for the expense company and currency', async () => {
    const { service, prisma } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(approvedExpense());
    prisma.cashAccount.findMany.mockResolvedValue([{ id: 'cash-1', currency: 'TZS' }]);

    await expect(service.paymentOptions('expense-1', authUser())).resolves.toEqual([
      { id: 'cash-1', currency: 'TZS' },
    ]);

    expect(service.findOne).toHaveBeenCalledWith('expense-1', authUser(), AccessLevel.WRITE);
    expect(prisma.cashAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company-1',
          currency: 'TZS',
          deletedAt: null,
          isActive: true,
        },
      }),
    );
  });

  it('pays an approved expense from the account selected at payment time', async () => {
    const { service, tx, auditLogs, postingEngine } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(approvedExpense());
    tx.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-1',
      companyId: 'company-1',
      accountName: 'Kisimani Cash Account',
      accountType: 'CASH_ON_HAND',
      currency: 'TZS',
    });

    const result = await service.pay(
      'expense-1',
      { cashAccountId: 'cash-1', paymentMethod: 'CASH' },
      authUser(),
    );

    expect(tx.cashAccount.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'cash-1',
        companyId: 'company-1',
        currency: 'TZS',
        deletedAt: null,
        isActive: true,
      },
    });
    expect(tx.cashAccount.update).toHaveBeenCalledWith({
      where: { id: 'cash-1' },
      data: { currentBalance: { decrement: 22500 } },
    });
    expect(tx.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PAID',
          cashAccountId: 'cash-1',
          paymentMethod: 'CASH',
          journalEntryId: 'journal-1',
        }),
      }),
    );
    expect(postingEngine.postLines).toHaveBeenCalled();
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EXPENSE_PAY',
        newValue: expect.objectContaining({ cashAccountId: 'cash-1' }),
      }),
    );
    expect(result.status).toBe('PAID');
  });

  it('rejects an account that is inactive, belongs to another company, or uses another currency', async () => {
    const { service, tx, postingEngine } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(approvedExpense());
    tx.cashAccount.findFirst.mockResolvedValue(null);

    await expect(
      service.pay('expense-1', { cashAccountId: 'invalid-account' }, authUser()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.expense.update).not.toHaveBeenCalled();
  });
});

describe('ExpensesService.approve accrual (DR Expense / CR AP at expense date)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts a balanced DR Expense / CR AP_CONTROL JE at the expense date and opens an OPEN Expense-sourced payable', async () => {
    const existing = pendingExpense();
    const { service, tx, postingEngine } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(existing);

    await service.approve('expense-1', authUser());

    // One accrual JE was posted.
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    const [postingInput] = postingEngine.postLines.mock.calls[0];

    // Booked at the EXPENSE date (accrual accounting), not "now".
    expect(postingInput.transactionDate).toEqual(new Date(existing.expenseDate));

    const lines = postingInput.lines;
    // DR the category-linked expense account for the full (gross) amount.
    const expenseLine = lines.find((l: any) => l.accountId === 'expense-ledger-1');
    expect(Number(expenseLine.debit)).toBe(22500);
    expect(Number(expenseLine.credit)).toBe(0);
    // CR AP_CONTROL for the full amount.
    const apLine = lines.find((l: any) => l.accountId === 'AP_CONTROL-acc');
    expect(Number(apLine.credit)).toBe(22500);
    expect(Number(apLine.debit)).toBe(0);
    // Exactly two legs (no phantom input-VAT leg), balanced.
    expect(lines).toHaveLength(2);
    const { totalDebit, totalCredit } = sumLegs(lines);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(22500);

    // An OPEN Expense-sourced payable was opened for the full gross.
    expect(tx.payable.create).toHaveBeenCalledTimes(1);
    const [{ data }] = tx.payable.create.mock.calls[0];
    expect(data.sourceType).toBe('Expense');
    expect(data.sourceId).toBe('expense-1');
    expect(data.status).toBe('OPEN');
    expect(Number(data.amount)).toBe(22500);
    expect(Number(data.outstandingAmount)).toBe(22500);
    expect(Number(data.paidAmount)).toBe(0);

    // Status claimed atomically (compare-and-set, guarded on PENDING_APPROVAL)
    // BEFORE any posting, so a concurrent approver can never double-post.
    expect(tx.expense.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'expense-1',
        companyId: 'company-1',
        status: 'PENDING_APPROVAL',
        deletedAt: null,
      },
      data: expect.objectContaining({ status: 'APPROVED', approvedById: 'user-1' }),
    });
    expect(tx.expense.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      postingEngine.postLines.mock.invocationCallOrder[0],
    );
    // The accrual JE is linked in the same transaction.
    expect(tx.expense.update).toHaveBeenCalledWith({
      where: { id: 'expense-1' },
      data: expect.objectContaining({ journalEntryId: 'journal-1' }),
    });
  });

  it('falls back to the GENERAL_EXPENSE role when the category has no linked account', async () => {
    const existing = pendingExpense({ expenseCategory: { linkedAccountId: null } });
    const { service, postingEngine, accountResolver } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(existing);

    await service.approve('expense-1', authUser());

    expect(accountResolver.resolve).toHaveBeenCalledWith(
      'company-1',
      'GENERAL_EXPENSE',
      expect.anything(),
    );
    const [postingInput] = postingEngine.postLines.mock.calls[0];
    const expenseLine = postingInput.lines.find((l: any) => l.accountId === 'GENERAL_EXPENSE-acc');
    expect(Number(expenseLine.debit)).toBe(22500);
  });

  it('does not re-accrue when the expense already carries an accrual JE (idempotent)', async () => {
    const existing = pendingExpense({ journalEntryId: 'je-accrual' });
    const { service, tx, postingEngine } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(existing);
    // The locked in-tx re-read shows the accrual JE already linked.
    tx.$queryRaw.mockResolvedValue([{ amount: 22500, journalEntryId: 'je-accrual' }]);

    await service.approve('expense-1', authUser());

    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.payable.create).not.toHaveBeenCalled();
    expect(tx.expense.update).toHaveBeenCalledWith({
      where: { id: 'expense-1' },
      data: expect.objectContaining({ journalEntryId: 'je-accrual' }),
    });
  });
});

describe('ExpensesService.approve atomic claim + locked amount (double-approve / stale-amount races)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('no-ops idempotently when a concurrent approval already claimed and accrued the expense', async () => {
    const { service, tx, postingEngine } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(pendingExpense());
    // The compare-and-set loses: the other approver committed first.
    tx.expense.updateMany.mockResolvedValue({ count: 0 });
    tx.expense.findFirst.mockResolvedValue({
      ...approvedExpense({ journalEntryId: 'je-accrual' }),
      status: 'APPROVED',
    });

    const result = await service.approve('expense-1', authUser());

    // The loser posts NOTHING: no second accrual JE, no second payable.
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.payable.create).not.toHaveBeenCalled();
    expect(tx.expense.update).not.toHaveBeenCalled();
    expect(result.journalEntryId).toBe('je-accrual');
  });

  it('throws when the claim fails and the expense was not approved (e.g. rejected concurrently) — no accrual posted', async () => {
    const { service, tx, postingEngine } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(pendingExpense());
    tx.expense.updateMany.mockResolvedValue({ count: 0 });
    tx.expense.findFirst.mockResolvedValue({ status: 'REJECTED', journalEntryId: null });

    await expect(service.approve('expense-1', authUser())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.payable.create).not.toHaveBeenCalled();
  });

  it('books the accrual and the payable at the COMMITTED (locked) amount, not the stale pre-transaction read', async () => {
    // Outer findOne read amount 22500, but a concurrent update() committed
    // amount 50000 before the claim: the accrual must book 50000.
    const { service, tx, postingEngine } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(pendingExpense());
    tx.$queryRaw.mockResolvedValue([{ amount: 50000, journalEntryId: null }]);

    await service.approve('expense-1', authUser());

    const [postingInput] = postingEngine.postLines.mock.calls[0];
    const lines = postingInput.lines;
    const expenseLine = lines.find((l: any) => l.accountId === 'expense-ledger-1');
    const apLine = lines.find((l: any) => l.accountId === 'AP_CONTROL-acc');
    expect(Number(expenseLine.debit)).toBe(50000);
    expect(Number(apLine.credit)).toBe(50000);
    const { totalDebit, totalCredit } = sumLegs(lines);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(50000);

    // The payable mirrors the same committed amount, so pay() settles exactly
    // what was accrued.
    const [{ data }] = tx.payable.create.mock.calls[0];
    expect(Number(data.amount)).toBe(50000);
    expect(Number(data.outstandingAmount)).toBe(50000);
  });
});

describe('ExpensesService.reject atomic claim', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects via a status-guarded compare-and-set', async () => {
    const { service, prisma, auditLogs } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(pendingExpense());
    prisma.expense.findFirst.mockResolvedValue(
      pendingExpense({ status: 'REJECTED', rejectedReason: 'no budget' }),
    );

    const result = await service.reject('expense-1', { reason: 'no budget' } as any, authUser());

    expect(prisma.expense.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'expense-1',
        companyId: 'company-1',
        status: 'PENDING_APPROVAL',
        deletedAt: null,
      },
      data: { status: 'REJECTED', rejectedReason: 'no budget' },
    });
    expect(result.status).toBe('REJECTED');
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EXPENSE_REJECT' }),
    );
  });

  it('does not clobber a concurrent approval: a stale reject fails when the expense is no longer PENDING_APPROVAL', async () => {
    const { service, prisma, auditLogs } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(pendingExpense());
    // Between the outer status read and the write, approve() committed.
    prisma.expense.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.reject('expense-1', { reason: 'too late' } as any, authUser()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(auditLogs.log).not.toHaveBeenCalled();
  });
});

describe('ExpensesService.update status-guarded write', () => {
  beforeEach(() => jest.clearAllMocks());

  it('applies the edit through a status-guarded updateMany and returns the fresh row', async () => {
    const { service, prisma } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(pendingExpense());
    prisma.expense.findFirst.mockResolvedValue(pendingExpense({ amount: 50000 }));

    const result = await service.update('expense-1', { amount: 50000 } as any, authUser());

    expect(prisma.expense.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'expense-1',
        status: { in: ['DRAFT', 'PENDING_APPROVAL'] },
        deletedAt: null,
      },
      data: { amount: 50000 },
    });
    expect(Number(result.amount)).toBe(50000);
  });

  it('fails cleanly when the guarded write races a concurrent approval (no post-approval amount edit)', async () => {
    const { service, prisma, auditLogs } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(pendingExpense());
    // approve() committed between the outer status read and this write; the
    // WHERE re-evaluates against APPROVED and matches nothing.
    prisma.expense.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.update('expense-1', { amount: 50000 } as any, authUser()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(auditLogs.log).not.toHaveBeenCalled();
  });
});

describe('ExpensesService.pay single settlement path', () => {
  beforeEach(() => jest.clearAllMocks());

  function armCashAccount(tx: any) {
    tx.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-1',
      companyId: 'company-1',
      accountName: 'Kisimani Cash Account',
      accountType: 'CASH_ON_HAND',
      currency: 'TZS',
    });
  }

  it('settles the accrual once: DR AP_CONTROL / CR Cash, decrements the CashAccount, marks the payable PAID', async () => {
    const existing = approvedExpense({ journalEntryId: 'je-accrual' });
    const { service, tx, postingEngine } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(existing);
    armCashAccount(tx);
    // The linked accrued payable exists and is still OPEN.
    tx.payable.findFirst.mockResolvedValue({ id: 'payable-1', amount: 22500, status: 'OPEN' });

    await service.pay('expense-1', { cashAccountId: 'cash-1' }, authUser());

    // One settlement JE: DR AP_CONTROL / CR Cash ledger, balanced.
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    const [postingInput] = postingEngine.postLines.mock.calls[0];
    const lines = postingInput.lines;
    const apLine = lines.find((l: any) => l.accountId === 'AP_CONTROL-acc');
    const cashLine = lines.find((l: any) => l.accountId === 'cash-ledger-1');
    expect(Number(apLine.debit)).toBe(22500);
    expect(Number(apLine.credit)).toBe(0);
    expect(Number(cashLine.credit)).toBe(22500);
    expect(Number(cashLine.debit)).toBe(0);
    // Never re-debits the expense account on settlement.
    expect(lines.some((l: any) => l.accountId === 'expense-ledger-1')).toBe(false);
    const { totalDebit, totalCredit } = sumLegs(lines);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(22500);

    // CashAccount subledger decremented once by the amount.
    expect(tx.cashAccount.update).toHaveBeenCalledTimes(1);
    expect(tx.cashAccount.update).toHaveBeenCalledWith({
      where: { id: 'cash-1' },
      data: { currentBalance: { decrement: 22500 } },
    });

    // The linked payable is closed (PAID / zero outstanding) in the SAME tx.
    expect(tx.payable.update).toHaveBeenCalledWith({
      where: { id: 'payable-1' },
      data: expect.objectContaining({ status: 'PAID', outstandingAmount: 0 }),
    });

    // Expense flipped to PAID; the accrual JE link is preserved (the cash JE is
    // NOT written over it).
    expect(tx.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'expense-1' },
        data: expect.objectContaining({ status: 'PAID' }),
      }),
    );
    const [{ data: expenseData }] = tx.expense.update.mock.calls[0];
    expect(expenseData).not.toHaveProperty('journalEntryId');
  });

  it('is idempotent: a second pay() on an already-PAID expense posts nothing and does not decrement cash', async () => {
    const existing = approvedExpense({ status: 'PAID' });
    const { service, tx, postingEngine, prisma } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(existing);

    const result = await service.pay('expense-1', {}, authUser());

    expect(result).toBe(existing);
    // No transaction, no JE, no cash movement, no payable update.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.cashAccount.update).not.toHaveBeenCalled();
    expect(tx.payable.update).not.toHaveBeenCalled();
  });

  it('defensively no-ops inside the tx when the linked payable is already PAID (race guard)', async () => {
    const existing = approvedExpense();
    const { service, tx, postingEngine } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(existing);
    armCashAccount(tx);
    tx.payable.findFirst.mockResolvedValue({ id: 'payable-1', amount: 22500, status: 'PAID' });

    await service.pay('expense-1', { cashAccountId: 'cash-1' }, authUser());

    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.cashAccount.update).not.toHaveBeenCalled();
    expect(tx.payable.update).not.toHaveBeenCalled();
    expect(tx.expense.update).not.toHaveBeenCalled();
  });

  it('no-ops when the in-tx locked status shows a concurrent pay() already settled the expense', async () => {
    // Double-click race: both callers saw APPROVED outside the tx. The loser
    // blocks on the FOR UPDATE row lock, then reads the committed PAID status
    // and must post nothing — no second JE, no second cash decrement.
    const existing = approvedExpense();
    const { service, tx, postingEngine } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(existing);
    armCashAccount(tx);
    tx.payable.findFirst.mockResolvedValue({ id: 'payable-1', amount: 22500, status: 'OPEN' });
    tx.$queryRaw.mockResolvedValue([{ status: 'PAID' }]);

    const result = await service.pay('expense-1', { cashAccountId: 'cash-1' }, authUser());

    expect(result).toBe(existing);
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.cashAccount.update).not.toHaveBeenCalled();
    expect(tx.payable.update).not.toHaveBeenCalled();
    expect(tx.expense.update).not.toHaveBeenCalled();
  });

  it('locks the expense row (FOR UPDATE) inside the settlement transaction', async () => {
    const existing = approvedExpense({ journalEntryId: 'je-accrual' });
    const { service, tx } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(existing);
    armCashAccount(tx);
    tx.payable.findFirst.mockResolvedValue({ id: 'payable-1', amount: 22500, status: 'OPEN' });

    await service.pay('expense-1', { cashAccountId: 'cash-1' }, authUser());

    // The locked status re-read runs before any posting side-effect.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const rawSql = tx.$queryRaw.mock.calls[0][0].join('?');
    expect(rawSql).toContain('FOR UPDATE');
  });

  it('requires a linked category ledger account only on the legacy (un-accrued) path', async () => {
    const existing = approvedExpense({ expenseCategory: { linkedAccountId: null } });
    const { service, tx, postingEngine } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(existing);
    armCashAccount(tx);
    // No accrued payable -> legacy cash-basis path -> the link is mandatory.
    tx.payable.findFirst.mockResolvedValue(null);

    await expect(
      service.pay('expense-1', { cashAccountId: 'cash-1' }, authUser()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.expense.update).not.toHaveBeenCalled();
  });
});

describe('ExpensesService.pay branch custody guard (shared cash-account-scope helper)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects a cash account scoped to a DIFFERENT branch than the expense', async () => {
    const { service, tx, postingEngine } = makeHarness();
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue(approvedExpense({ divisionId: 'division-1', branchId: 'branch-1' }));
    tx.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-1',
      companyId: 'company-1',
      accountName: 'Mwanza Cash',
      accountType: 'CASH_ON_HAND',
      currency: 'TZS',
      divisionId: 'division-1',
      branchId: 'branch-2',
    });

    await expect(service.pay('expense-1', { cashAccountId: 'cash-1' }, authUser())).rejects.toThrow(
      'Cash account does not belong to the selected branch',
    );
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.cashAccount.update).not.toHaveBeenCalled();
    expect(tx.expense.update).not.toHaveBeenCalled();
  });

  it('rejects a cash account scoped to a DIFFERENT division than the expense', async () => {
    const { service, tx, postingEngine } = makeHarness();
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue(approvedExpense({ divisionId: 'division-1', branchId: 'branch-1' }));
    tx.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-1',
      companyId: 'company-1',
      accountName: 'Other Division Cash',
      accountType: 'CASH_ON_HAND',
      currency: 'TZS',
      divisionId: 'division-2',
      branchId: 'branch-9',
    });

    await expect(service.pay('expense-1', { cashAccountId: 'cash-1' }, authUser())).rejects.toThrow(
      'Cash account does not belong to the selected division',
    );
    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });

  it('still pays from an unscoped (NULL-branch) legacy account when the expense is branch-scoped', async () => {
    const { service, tx } = makeHarness();
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue(approvedExpense({ divisionId: 'division-1', branchId: 'branch-1' }));
    tx.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-1',
      companyId: 'company-1',
      accountName: 'Company Till',
      accountType: 'CASH_ON_HAND',
      currency: 'TZS',
      divisionId: null,
      branchId: null,
    });

    const result = await service.pay('expense-1', { cashAccountId: 'cash-1' }, authUser());

    expect(result.status).toBe('PAID');
    expect(tx.cashAccount.update).toHaveBeenCalledWith({
      where: { id: 'cash-1' },
      data: { currentBalance: { decrement: 22500 } },
    });
  });

  it('still pays an unscoped legacy expense from a branch-scoped account (no context, no guard)', async () => {
    const { service, tx } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(approvedExpense()); // NULL scope
    tx.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-1',
      companyId: 'company-1',
      accountName: 'Branch Cash',
      accountType: 'CASH_ON_HAND',
      currency: 'TZS',
      divisionId: 'division-1',
      branchId: 'branch-1',
    });

    const result = await service.pay('expense-1', { cashAccountId: 'cash-1' }, authUser());
    expect(result.status).toBe('PAID');
  });

  it('pays from a company-wide BANK account regardless of the expense branch', async () => {
    const { service, tx } = makeHarness();
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue(approvedExpense({ divisionId: 'division-1', branchId: 'branch-1' }));
    tx.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-1',
      companyId: 'company-1',
      accountName: 'Main Bank',
      accountType: 'BANK',
      currency: 'TZS',
      divisionId: null,
      branchId: null,
    });

    const result = await service.pay('expense-1', { cashAccountId: 'cash-1' }, authUser());
    expect(result.status).toBe('PAID');
  });
});

describe('ExpensesService.approve input-VAT split (DR net Expense + DR TAX_VAT_RECEIVABLE / CR gross AP)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('splits recoverable input VAT out of the gross: three balanced legs, payable still at gross', async () => {
    const existing = pendingExpense({ isTaxable: true, taxAmount: 3430 });
    const { service, tx, postingEngine, accountResolver } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(existing);
    tx.$queryRaw.mockResolvedValue([
      { amount: 22500, journalEntryId: null, isTaxable: true, taxAmount: 3430 },
    ]);

    await service.approve('expense-1', authUser());

    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    const [postingInput] = postingEngine.postLines.mock.calls[0];
    const lines = postingInput.lines;

    // Exactly three legs: net expense + input VAT + gross AP.
    expect(lines).toHaveLength(3);
    const expenseLine = lines.find((l: any) => l.accountId === 'expense-ledger-1');
    expect(Number(expenseLine.debit)).toBe(19070);
    expect(Number(expenseLine.credit)).toBe(0);
    const vatLine = lines.find((l: any) => l.accountId === 'TAX_VAT_RECEIVABLE-acc');
    expect(Number(vatLine.debit)).toBe(3430);
    expect(Number(vatLine.credit)).toBe(0);
    expect(vatLine.description).toContain('Input VAT');
    const apLine = lines.find((l: any) => l.accountId === 'AP_CONTROL-acc');
    expect(Number(apLine.credit)).toBe(22500);
    expect(Number(apLine.debit)).toBe(0);
    const { totalDebit, totalCredit } = sumLegs(lines);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(22500);

    // The VAT receivable role was resolved (first GL consumer of this role).
    expect(accountResolver.resolve).toHaveBeenCalledWith(
      'company-1',
      'TAX_VAT_RECEIVABLE',
      expect.anything(),
    );

    // The payable stays at GROSS: pay() settles the full obligation and needs
    // no knowledge of the split.
    const [{ data }] = tx.payable.create.mock.calls[0];
    expect(Number(data.amount)).toBe(22500);
    expect(Number(data.outstandingAmount)).toBe(22500);
  });

  it('never resolves TAX_VAT_RECEIVABLE on an untaxed approval (missing-account charts keep working)', async () => {
    const { service, accountResolver } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(pendingExpense());

    await service.approve('expense-1', authUser());

    expect(accountResolver.resolve).not.toHaveBeenCalledWith(
      'company-1',
      'TAX_VAT_RECEIVABLE',
      expect.anything(),
    );
  });

  it('posts the legacy two-leg gross shape for an assessed-exempt expense (isTaxable, taxAmount 0)', async () => {
    const existing = pendingExpense({ isTaxable: true, taxAmount: 0 });
    const { service, tx, postingEngine, accountResolver } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(existing);
    // The locked re-read drives the split: assessed but exempt (tax 0).
    tx.$queryRaw.mockResolvedValue([
      { amount: 22500, journalEntryId: null, isTaxable: true, taxAmount: 0 },
    ]);

    await service.approve('expense-1', authUser());

    const [postingInput] = postingEngine.postLines.mock.calls[0];
    expect(postingInput.lines).toHaveLength(2);
    const expenseLine = postingInput.lines.find((l: any) => l.accountId === 'expense-ledger-1');
    expect(Number(expenseLine.debit)).toBe(22500);
    expect(accountResolver.resolve).not.toHaveBeenCalledWith(
      'company-1',
      'TAX_VAT_RECEIVABLE',
      expect.anything(),
    );
  });

  it('splits from the COMMITTED (locked) amount+tax pair, not the stale pre-transaction snapshot', async () => {
    // Outer findOne read 22500/3430, but a concurrent update() committed
    // 50000/5000 before the claim: the accrual must split the committed pair.
    const existing = pendingExpense({ isTaxable: true, taxAmount: 3430 });
    const { service, tx, postingEngine } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(existing);
    tx.$queryRaw.mockResolvedValue([
      { amount: 50000, journalEntryId: null, isTaxable: true, taxAmount: 5000 },
    ]);

    await service.approve('expense-1', authUser());

    const [postingInput] = postingEngine.postLines.mock.calls[0];
    const lines = postingInput.lines;
    expect(Number(lines.find((l: any) => l.accountId === 'expense-ledger-1').debit)).toBe(45000);
    expect(Number(lines.find((l: any) => l.accountId === 'TAX_VAT_RECEIVABLE-acc').debit)).toBe(
      5000,
    );
    expect(Number(lines.find((l: any) => l.accountId === 'AP_CONTROL-acc').credit)).toBe(50000);
    const [{ data }] = tx.payable.create.mock.calls[0];
    expect(Number(data.amount)).toBe(50000);
  });

  it('rejects a locked tax at or above the gross amount — nothing posted, no payable', async () => {
    const existing = pendingExpense({ isTaxable: true, taxAmount: 22500 });
    const { service, tx, postingEngine } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(existing);
    tx.$queryRaw.mockResolvedValue([
      { amount: 22500, journalEntryId: null, isTaxable: true, taxAmount: 22500 },
    ]);

    await expect(service.approve('expense-1', authUser())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.payable.create).not.toHaveBeenCalled();
  });
});

describe('ExpensesService.approve tax-auto-apply mirror (TaxTransaction compliance ledger)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('mirrors the expense into the TaxTransaction ledger inside the accrual transaction', async () => {
    const { service, tx, taxAutoApply } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(pendingExpense());

    await service.approve('expense-1', authUser());

    expect(taxAutoApply.applyForExpense).toHaveBeenCalledTimes(1);
    expect(taxAutoApply.applyForExpense).toHaveBeenCalledWith('expense-1', 'user-1', tx);
  });

  it('does not re-mirror on the idempotent already-accrued path', async () => {
    const existing = pendingExpense({ journalEntryId: 'je-accrual' });
    const { service, tx, taxAutoApply } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(existing);
    tx.$queryRaw.mockResolvedValue([{ amount: 22500, journalEntryId: 'je-accrual' }]);

    await service.approve('expense-1', authUser());

    expect(taxAutoApply.applyForExpense).not.toHaveBeenCalled();
  });

  it('soft-fails: a throwing tax mirror never rolls back a legitimate approval', async () => {
    const { service, postingEngine, taxAutoApply } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(pendingExpense());
    taxAutoApply.applyForExpense.mockRejectedValue(new Error('ledger offline'));

    const result = await service.approve('expense-1', authUser());

    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    expect(result.journalEntryId).toBe('journal-1');
  });
});

describe('ExpensesService input-VAT write validation and legacy-path guard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('create() rejects a tax amount at or above the gross amount', async () => {
    const { service, prisma } = makeHarness();
    prisma.expense.create = jest.fn();

    await expect(
      service.create(
        {
          companyId: 'company-1',
          expenseCategoryId: 'category-1',
          amount: 22500,
          expenseDate: '2026-03-10',
          description: 'Daily wages',
          isTaxable: true,
          taxAmount: 22500,
        } as any,
        authUser(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  it('update() rejects a tax amount at or above the (unchanged) gross amount', async () => {
    const { service, prisma } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(pendingExpense());

    await expect(
      service.update('expense-1', { taxAmount: 30000 } as any, authUser()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.expense.updateMany).not.toHaveBeenCalled();
  });

  it('pay() refuses to settle a taxable expense through the legacy un-accrued path (input VAT would be absorbed)', async () => {
    const existing = approvedExpense({ isTaxable: true, taxAmount: 3430 });
    const { service, tx, postingEngine } = makeHarness();
    jest.spyOn(service, 'findOne').mockResolvedValue(existing);
    tx.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-1',
      companyId: 'company-1',
      accountName: 'Kisimani Cash Account',
      accountType: 'CASH_ON_HAND',
      currency: 'TZS',
    });
    // No accrued payable -> the legacy cash-basis branch would silently absorb
    // the recoverable VAT into the expense account: must fail loudly instead.
    tx.payable.findFirst.mockResolvedValue(null);

    await expect(
      service.pay('expense-1', { cashAccountId: 'cash-1' }, authUser()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.expense.update).not.toHaveBeenCalled();
  });
});
