import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupplierPaymentsService } from './supplier-payments.service';

const user = { id: 'user-1', permissions: [] } as any;
const d = (v: string | number) => new Prisma.Decimal(v);

function lockedPayable(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    companyId: 'company-1',
    divisionId: null,
    branchId: null,
    supplierId: 'supplier-1',
    supplierName: 'Acme',
    payableNumber: 'PAY-1',
    sourceType: 'SupplierInvoice',
    outstandingAmount: d('500'),
    paidAmount: d('0'),
    status: 'OPEN',
    currency: 'TZS',
    ...overrides,
  };
}

function setup(opts: { locked?: Record<string, unknown>; invoices?: any[]; existing?: any } = {}) {
  const locked = lockedPayable(opts.locked);
  let payable = { ...locked };
  const tx: any = {
    $queryRaw: jest.fn(async () => [payable]),
    payable: {
      update: jest.fn(async ({ data }: any) => {
        payable = { ...payable, ...data };
        return { ...payable };
      }),
      groupBy: jest.fn(async () => [{ currency: 'TZS', _sum: { outstandingAmount: d('0') } }]),
    },
    supplier: {
      findFirst: jest.fn(async () => ({
        id: 'supplier-1',
        name: 'Acme',
        divisionId: null,
        branchId: null,
      })),
      updateMany: jest.fn(),
    },
    supplierInvoice: {
      findMany: jest.fn(async () => opts.invoices ?? []),
      update: jest.fn(async ({ data }: any) => data),
    },
    supplierPayment: {
      findUnique: jest.fn(async () => opts.existing ?? null),
      findFirst: jest.fn(),
      create: jest.fn(async ({ data }: any) => ({
        id: 'spay-1',
        paymentNumber: 'SPAY-1',
        ...data,
      })),
      update: jest.fn(async ({ data }: any) => ({
        id: 'spay-1',
        paymentNumber: 'SPAY-1',
        ...data,
      })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    cashAccount: {
      findFirst: jest.fn(async () => ({
        id: 'bank-1',
        companyId: 'company-1',
        divisionId: null,
        branchId: null,
        accountType: 'BANK',
        accountName: 'Main bank',
        currency: 'TZS',
        ledgerAccountId: 'ledger-bank',
      })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    companyProfile: { findUnique: jest.fn(async () => ({ currency: 'TZS' })) },
    journalEntry: { findFirst: jest.fn(), updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const auditLogs = { log: jest.fn() } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn(),
    accessibleCompanyIds: jest.fn(async () => ['company-1']),
  } as any;
  const resolve = jest.fn(async (_c: string, role: string) => ({ id: `${role}-acc` }));
  const postLines = jest.fn(async () => ({ id: 'je-1', journalNumber: 'JE-1' }));
  const codes = { next: jest.fn(async () => 'SPAY-2026-000001') } as any;
  const service = new SupplierPaymentsService(
    prisma,
    auditLogs,
    companyScope,
    { resolve } as any,
    { postLines } as any,
    codes,
  );
  return { service, tx, prisma, postLines, resolve, readPayable: () => ({ ...payable }) };
}

const baseInput = () => ({
  companyId: 'company-1',
  supplierId: 'supplier-1',
  amount: 200,
  paymentDate: new Date('2026-10-01'),
  cashAccountId: 'bank-1',
  currency: 'TZS',
  allocations: [{ payableId: 'pay-1', amount: 200 }],
});

describe('SupplierPaymentsService.createInTransaction', () => {
  it('reduces the payable, posts DR AP / CR the mapped cash ledger account, relieves cash and records the payment', async () => {
    const { service, tx, postLines, readPayable } = setup();
    const { payment, payables } = await service.createInTransaction(tx, user, baseInput());

    expect(readPayable()).toMatchObject({
      paidAmount: d('200'),
      outstandingAmount: d('300'),
      status: 'PARTIALLY_PAID',
    });
    expect(payables).toHaveLength(1);
    expect(tx.supplierPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          supplierId: 'supplier-1',
          appliedAmount: d('200'),
          unappliedAmount: 0,
          sourceType: 'Payable',
          allocations: {
            create: [{ companyId: 'company-1', payableId: 'pay-1', amount: d('200') }],
          },
        }),
      }),
    );
    const posted = (postLines.mock.calls[0] as any[])[0];
    expect(posted.referenceType).toBe('SupplierPayment');
    expect(posted.lines).toEqual([
      expect.objectContaining({ accountId: 'AP_CONTROL-acc', debit: d('200') }),
      expect.objectContaining({ accountId: 'ledger-bank', credit: d('200') }),
    ]);
    expect(tx.cashAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentBalance: { decrement: d('200') } } }),
    );
    expect(tx.supplier.updateMany).toHaveBeenCalled();
    expect(payment.journalEntryId).toBe('je-1');
  });

  it('falls back to the role account when the cash account has no mapped ledger account, and to CASH_ON_HAND without a cash account', async () => {
    const { service, tx, postLines } = setup();
    tx.cashAccount.findFirst.mockResolvedValue({
      id: 'till-1',
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      accountType: 'CASH_ON_HAND',
      accountName: 'Till',
      currency: 'TZS',
      ledgerAccountId: null,
    });
    await service.createInTransaction(tx, user, { ...baseInput(), cashAccountId: 'till-1' });
    expect((postLines.mock.calls[0] as any[])[0].lines[1].accountId).toBe('CASH_ON_HAND-acc');

    const legacy = setup();
    await legacy.service.createInTransaction(legacy.tx, user, {
      ...baseInput(),
      cashAccountId: null,
    });
    expect((legacy.postLines.mock.calls[0] as any[])[0].lines[1].accountId).toBe(
      'CASH_ON_HAND-acc',
    );
    expect(legacy.tx.cashAccount.updateMany).not.toHaveBeenCalled();
  });

  it('keeps the approved supplier invoice behind the payable in step', async () => {
    const { service, tx } = setup({ invoices: [{ id: 'si-1', totalAmount: d('500') }] });
    await service.createInTransaction(tx, user, {
      ...baseInput(),
      amount: 500,
      allocations: [{ payableId: 'pay-1', amount: 500 }],
    });
    expect(tx.supplierInvoice.update).toHaveBeenCalledWith({
      where: { id: 'si-1' },
      data: { paidAmount: d('500'), outstandingAmount: d('0'), status: 'PAID' },
    });
  });

  it('refuses an unmatched payable, a payable of another supplier, an expense-sourced payable and a currency mismatch', async () => {
    const unmatched = setup({ locked: { supplierId: null } });
    await expect(
      unmatched.service.createInTransaction(unmatched.tx, user, baseInput()),
    ).rejects.toThrow(/Match payable/);

    const other = setup({ locked: { supplierId: 'supplier-2' } });
    await expect(other.service.createInTransaction(other.tx, user, baseInput())).rejects.toThrow(
      /different supplier/,
    );

    const expense = setup({ locked: { sourceType: 'Expense' } });
    await expect(
      expense.service.createInTransaction(expense.tx, user, baseInput()),
    ).rejects.toThrow(/Expenses/);
    expect(expense.postLines).not.toHaveBeenCalled();

    const fx = setup({ locked: { currency: 'USD' } });
    await expect(fx.service.createInTransaction(fx.tx, user, baseInput())).rejects.toThrow(
      /same currency/,
    );
  });

  it('requires the allocations to equal the payment amount (no supplier prepayments yet)', async () => {
    const { service, tx } = setup();
    await expect(
      service.createInTransaction(tx, user, { ...baseInput(), amount: 250 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.payable.update).not.toHaveBeenCalled();
  });

  it('returns the original payment on a replayed requestId without touching anything', async () => {
    const existing = { id: 'spay-old', requestId: 'req-1' };
    const { service, tx, postLines } = setup({ existing });
    const result = await service.createInTransaction(tx, user, {
      ...baseInput(),
      requestId: 'req-1',
    });
    expect(result.payment).toBe(existing);
    expect(tx.payable.update).not.toHaveBeenCalled();
    expect(postLines).not.toHaveBeenCalled();
  });
});

describe('SupplierPaymentsService.recordInTransaction', () => {
  it('records a desk payment with no allocation as applied to its source document, posting nothing', async () => {
    const { service, tx, postLines } = setup();
    const payment = await service.recordInTransaction(tx, user, {
      companyId: 'company-1',
      supplierId: 'supplier-1',
      amount: '120.50',
      paymentDate: new Date('2026-10-01'),
      currency: 'TZS',
      requestId: 'desk-req-1',
      source: { type: 'InvoiceDeskInvoice', id: 'inv-1' },
    });
    expect(payment.appliedAmount).toEqual(d('120.50'));
    expect(payment.unappliedAmount).toEqual(d('0'));
    expect(payment.sourceType).toBe('InvoiceDeskInvoice');
    expect(postLines).not.toHaveBeenCalled();
    expect(tx.payable.update).not.toHaveBeenCalled();
  });
});

describe('SupplierPaymentsService.reverseInTransaction', () => {
  function reversible(overrides: Record<string, unknown> = {}) {
    return {
      id: 'spay-1',
      companyId: 'company-1',
      supplierId: 'supplier-1',
      paymentNumber: 'SPAY-1',
      status: 'COMPLETED',
      amount: d('200'),
      cashAccountId: 'bank-1',
      journalEntryId: 'je-1',
      cashDeskMovementId: null,
      deskPayment: null,
      allocations: [{ payableId: 'pay-1', amount: d('200') }],
      ...overrides,
    };
  }

  it('restores the payable, mirrors the journal and gives the cash back', async () => {
    const { service, tx, postLines, readPayable } = setup({
      locked: { paidAmount: d('200'), outstandingAmount: d('300'), status: 'PARTIALLY_PAID' },
    });
    tx.supplierPayment.findFirst.mockResolvedValue(reversible());
    tx.journalEntry.findFirst.mockResolvedValue({
      id: 'je-1',
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      lines: [
        { accountId: 'AP_CONTROL-acc', debit: d('200'), credit: d('0'), description: 'ap' },
        { accountId: 'ledger-bank', debit: d('0'), credit: d('200'), description: 'cash' },
      ],
    });
    const { reversal } = await service.reverseInTransaction(
      tx,
      user,
      'spay-1',
      'wrong supplier',
      {},
    );
    expect(readPayable()).toMatchObject({
      paidAmount: d('0'),
      outstandingAmount: d('500'),
      status: 'OPEN',
    });
    expect(reversal?.id).toBe('je-1');
    expect((postLines.mock.calls[0] as any[])[0].lines[0]).toEqual(
      expect.objectContaining({ accountId: 'AP_CONTROL-acc', credit: d('200') }),
    );
    expect(tx.cashAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentBalance: { increment: d('200') } } }),
    );
  });

  it('refuses to reverse a desk-carried payment from outside the desk, and a second reversal', async () => {
    const desk = setup();
    desk.tx.supplierPayment.findFirst.mockResolvedValue(
      reversible({ deskPayment: { id: 'dp-1' }, journalEntryId: null, cashAccountId: null }),
    );
    await expect(
      desk.service.reverseInTransaction(desk.tx, user, 'spay-1', null, {}),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      desk.service.reverseInTransaction(desk.tx, user, 'spay-1', null, { fromDesk: true }),
    ).resolves.toBeDefined();

    const twice = setup();
    twice.tx.supplierPayment.updateMany.mockResolvedValue({ count: 0 });
    twice.tx.supplierPayment.findFirst.mockResolvedValue(reversible({ status: 'REVERSED' }));
    await expect(
      twice.service.reverseInTransaction(twice.tx, user, 'spay-1', null, {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
