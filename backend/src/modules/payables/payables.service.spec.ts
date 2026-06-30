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

function makeService(lockedRow: Record<string, unknown>, opts: { originalJe?: any } = {}) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([lockedRow]),
    payable: {
      update: jest.fn().mockResolvedValue({ ...lockedRow, status: 'WRITTEN_OFF' }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    supplier: { updateMany: jest.fn() },
    companyProfile: { findUnique: jest.fn().mockResolvedValue({ currency: 'TZS' }) },
    journalEntry: {
      findFirst: jest.fn().mockResolvedValue(opts.originalJe ?? null),
    },
  } as any;
  const prisma = {
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const postingEngine = { postLines: jest.fn().mockResolvedValue({ id: 'je-rev' }) } as any;
  const service = new PayablesService(
    prisma,
    { log: jest.fn() } as any,
    companyScope,
    { resolve: jest.fn() } as any,
    postingEngine,
    { next: jest.fn() } as any,
  );
  // Stub findOne (used by writeOff to load the payable before the tx).
  jest
    .spyOn(service as any, 'findOne')
    .mockResolvedValue({ ...lockedRow, status: lockedRow.status });
  return { service, tx, postingEngine, prisma };
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

describe('PayablesService.writeOff reversing journal (#9)', () => {
  const originalTwoLine = {
    totalDebit: '500',
    lines: [
      { accountId: 'expense-acc', debit: '500', credit: '0', description: 'Payable expense' },
      { accountId: 'ap-acc', debit: '0', credit: '500', description: 'Accounts payable' },
    ],
  };

  it('posts a balanced reversing JE (swapped debit/credit) and zeroes outstanding', async () => {
    const { service, tx, postingEngine } = makeService(lockedPayable(), {
      originalJe: originalTwoLine,
    });

    await service.writeOff('pay-1', { reason: 'uncollectible' } as any, user);

    // Outstanding is zeroed and status flipped so it can never be paid again.
    expect(tx.payable.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: expect.objectContaining({ status: 'WRITTEN_OFF', outstandingAmount: 0 }),
    });

    // A reversing journal was posted.
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    const [postingInput] = postingEngine.postLines.mock.calls[0];
    const lines = postingInput.lines;

    // Debit/credit are swapped relative to the original: AP is now debited,
    // expense credited.
    const apLine = lines.find((l: any) => l.accountId === 'ap-acc');
    const expenseLine = lines.find((l: any) => l.accountId === 'expense-acc');
    expect(Number(apLine.debit)).toBe(500);
    expect(Number(apLine.credit)).toBe(0);
    expect(Number(expenseLine.credit)).toBe(500);
    expect(Number(expenseLine.debit)).toBe(0);

    // The entry balances.
    const totalDebit = lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
    const totalCredit = lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(500);
  });

  it('reverses only the unpaid remainder when the payable is partially paid', async () => {
    // Original was 500; 300 already paid, 200 outstanding. Only 200 of AP should
    // be derecognised so the prior payment is not double-relieved.
    const { service, postingEngine } = makeService(
      lockedPayable({ status: 'PARTIALLY_PAID', outstandingAmount: '200', paidAmount: '300' }),
      { originalJe: originalTwoLine },
    );

    await service.writeOff('pay-1', { reason: 'settle remainder' } as any, user);

    const [postingInput] = postingEngine.postLines.mock.calls[0];
    const lines = postingInput.lines;
    const apLine = lines.find((l: any) => l.accountId === 'ap-acc');
    expect(Number(apLine.debit)).toBe(200);
    const totalDebit = lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
    const totalCredit = lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(200);
  });

  it('posts no journal when there is nothing outstanding', async () => {
    const { service, postingEngine, tx } = makeService(
      lockedPayable({ outstandingAmount: '0' }),
      { originalJe: originalTwoLine },
    );

    await service.writeOff('pay-1', { reason: 'already settled' } as any, user);

    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.payable.update).toHaveBeenCalled();
  });

  it('rejects writing off an already-PAID payable', async () => {
    const { service, postingEngine, tx } = makeService(lockedPayable({ status: 'PAID' }));

    await expect(
      service.writeOff('pay-1', { reason: 'x' } as any, user),
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
