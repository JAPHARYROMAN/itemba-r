import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CashBookService } from './cash-book.service';

const user = {
  id: 'user-1',
  fullName: 'Cashier',
  email: 'cashier@example.invalid',
  permissions: [],
} as any;
const d = (v: string | number) => new Prisma.Decimal(v);

function setup(opts: { enabled?: boolean; account?: any | null; existing?: any } = {}) {
  const account =
    opts.account === undefined
      ? {
          id: 'desk-1',
          companyId: 'company-1',
          currency: 'TZS',
          version: 3,
          openingDate: new Date('2026-01-01'),
          balance: d('1000'),
        }
      : opts.account;
  const created: any[] = [];
  const tx: any = {
    cashDeskMovement: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.requestId ? (opts.existing ?? null) : (opts.existing ?? null),
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `mv-${created.length + 1}`, reversedAt: null, ...data };
        created.push(row);
        return row;
      }),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    cashDeskAccount: {
      findUnique: jest.fn(async () => account),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => ({})),
    },
    cashAccount: { findUnique: jest.fn(async () => ({ accountName: 'Main till' })) },
    cashDeskEntry: {
      groupBy: jest.fn(async () => [
        { businessDate: new Date('2026-09-01'), _sum: { amount: d('1000') } },
      ]),
      create: jest.fn(async ({ data }: any) => data),
    },
  };
  const audit = { logStrictInTransaction: jest.fn() } as any;
  const config = {
    get: jest.fn(() => (opts.enabled === false ? 'false' : 'true')),
  } as any;
  const service = new CashBookService({} as any, audit, {} as any, config);
  return { service, tx, audit, created };
}

const input = () => ({
  kind: 'SUPPLIER_PAYMENT' as const,
  companyId: 'company-1',
  cashAccountId: 'erp-1',
  amount: '250.00',
  currency: 'TZS',
  businessDate: new Date('2026-10-01T15:30:00.000Z'),
  description: 'Supplier payment SPAY-1 · Acme',
  reference: 'SPAY-1',
  requestId: 'SupplierPayment:spay-1',
  partyType: 'SUPPLIER' as const,
  supplierId: 'supplier-1',
  payableId: 'pay-1',
  supplierPaymentId: 'spay-1',
  journalEntryId: 'je-1',
  journalReferenceType: 'SupplierPayment',
});

describe('CashBookService.recordInTransaction', () => {
  it('preserves unmapped legacy accounts while the strict flag is off', async () => {
    const { service, tx } = setup({ enabled: false, account: null });
    await expect(service.recordInTransaction(tx, user, input())).resolves.toBeNull();
    expect(tx.cashDeskMovement.create).not.toHaveBeenCalled();
  });

  it('mirrors a connected account even while the strict flag is off', async () => {
    const { service, tx } = setup({ enabled: false });
    await service.recordInTransaction(tx, user, input());
    expect(tx.cashDeskEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'desk-1',
        amount: d(-250),
        erpBalanceApplied: true,
      }),
    });
    expect(tx.cashAccount.findUnique).not.toHaveBeenCalled();
  });

  it('writes one outgoing movement on the mapped Cash Desk account with party, document and journal', async () => {
    const { service, tx, audit } = setup();
    const movement = await service.recordInTransaction(tx, user, input());
    expect(movement).toMatchObject({
      kind: 'SUPPLIER_PAYMENT',
      partyType: 'SUPPLIER',
      supplierId: 'supplier-1',
      payableId: 'pay-1',
      supplierPaymentId: 'spay-1',
      journalEntryId: 'je-1',
      journalReferenceType: 'SupplierPayment',
      businessDate: new Date('2026-10-01T00:00:00.000Z'),
    });
    expect(tx.cashDeskAccount.findUnique).toHaveBeenCalledWith({
      where: { erpCashAccountId: 'erp-1' },
    });
    expect(tx.cashDeskAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'desk-1', version: 3 } }),
    );
    const entry = tx.cashDeskEntry.create.mock.calls[0][0].data;
    expect(entry.accountId).toBe('desk-1');
    expect(entry.amount.eq(-250)).toBe(true);
    expect(tx.cashDeskAccount.update).toHaveBeenCalledWith({
      where: { id: 'desk-1' },
      data: { balance: d('750') },
    });
    expect(audit.logStrictInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'CASH_BOOK_SUPPLIER_PAYMENT', companyId: 'company-1' }),
    );
  });

  it('writes an incoming entry for a customer receipt', async () => {
    const { service, tx } = setup();
    await service.recordInTransaction(tx, user, {
      ...input(),
      kind: 'CUSTOMER_RECEIPT',
      partyType: 'CUSTOMER',
      supplierId: null,
      customerId: 'cust-1',
      requestId: 'CustomerPayment:cpay-1',
    });
    expect(tx.cashDeskEntry.create.mock.calls[0][0].data.amount.eq(250)).toBe(true);
    expect(tx.cashDeskMovement.create.mock.calls[0][0].data).toMatchObject({
      customerId: 'cust-1',
      supplierId: null,
    });
  });

  it('refuses an ERP cash account with no Cash Desk connection, naming the account', async () => {
    const { service, tx } = setup({ account: null });
    await expect(service.recordInTransaction(tx, user, input())).rejects.toThrow(
      /Connect cash account Main till/,
    );
    expect(tx.cashDeskMovement.create).not.toHaveBeenCalled();
  });

  it('refuses a mapped account in another company or currency', async () => {
    const other = setup({
      account: {
        id: 'desk-2',
        companyId: 'company-2',
        currency: 'TZS',
        version: 1,
        openingDate: new Date('2026-01-01'),
      },
    });
    await expect(other.service.recordInTransaction(other.tx, user, input())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const fx = setup({
      account: {
        id: 'desk-3',
        companyId: 'company-1',
        currency: 'USD',
        version: 1,
        openingDate: new Date('2026-01-01'),
      },
    });
    await expect(fx.service.recordInTransaction(fx.tx, user, input())).rejects.toThrow(/USD/);
  });

  it('refuses a payment that would leave the Cash Desk account negative', async () => {
    const { service, tx } = setup();
    await expect(
      service.recordInTransaction(tx, user, { ...input(), amount: '1500' }),
    ).rejects.toThrow(/Insufficient funds/);
  });

  it('returns the original movement for a replayed requestId and conflicts on a different payload', async () => {
    const same = setup({ existing: { id: 'mv-old', payloadKey: 'x' } });
    // compute the real key by recording once with no existing row, then replay with that key
    const fresh = setup();
    const first = await fresh.service.recordInTransaction(fresh.tx, user, input());
    const replay = setup({ existing: { id: 'mv-old', payloadKey: first!.payloadKey } });
    await expect(
      replay.service.recordInTransaction(replay.tx, user, input()),
    ).resolves.toMatchObject({ id: 'mv-old' });
    expect(replay.tx.cashDeskMovement.create).not.toHaveBeenCalled();
    await expect(same.service.recordInTransaction(same.tx, user, input())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('CashBookService.reverseInTransaction', () => {
  it.each([true, false])(
    'restores the mapped book on reversal with strict rollout %s',
    async (enabled) => {
      const { service, tx } = setup({ enabled });
      const account = {
        id: 'desk-1',
        companyId: 'company-1',
        currency: 'TZS',
        version: 3,
        openingDate: new Date('2026-01-01'),
      };
      tx.cashDeskMovement.findUnique = jest.fn(async () => ({
        id: 'mv-1',
        requestId: 'SupplierPayment:spay-1',
        kind: 'SUPPLIER_PAYMENT',
        amount: d('250'),
        currency: 'TZS',
        businessDate: new Date('2026-10-01T00:00:00.000Z'),
        description: 'Supplier payment SPAY-1 · Acme',
        reference: 'SPAY-1',
        reversedAt: null,
        partyType: 'SUPPLIER',
        supplierId: 'supplier-1',
        customerId: null,
        payableId: 'pay-1',
        receivableId: null,
        expenseId: null,
        refundId: null,
        journalEntryId: 'je-1',
        journalReferenceType: 'SupplierPayment',
        entries: [{ accountId: 'desk-1', amount: d('-250'), account }],
      }));
      const reversal = await service.reverseInTransaction(
        tx,
        user,
        'mv-1',
        'wrong supplier',
        'je-rev',
      );
      expect(reversal).toMatchObject({
        kind: 'REVERSAL',
        reversalOfId: 'mv-1',
        partyType: 'SUPPLIER',
        supplierId: 'supplier-1',
        payableId: 'pay-1',
        journalEntryId: 'je-rev',
      });
      expect(tx.cashDeskMovement.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'mv-1', reversedAt: null } }),
      );
      expect(tx.cashDeskEntry.create.mock.calls[0][0].data.amount.eq(250)).toBe(true);
    },
  );

  it('is a no-op for an already reversed movement and refuses a Cash Desk-recorded one', async () => {
    const done = setup();
    done.tx.cashDeskMovement.findUnique = jest.fn(async () => ({
      id: 'mv-1',
      reversedAt: new Date(),
      kind: 'EXPENSE',
      entries: [],
    }));
    await expect(
      done.service.reverseInTransaction(done.tx, user, 'mv-1', null),
    ).resolves.toBeNull();

    const manual = setup();
    manual.tx.cashDeskMovement.findUnique = jest.fn(async () => ({
      id: 'mv-2',
      reversedAt: null,
      kind: 'EXPENSE',
      journalEntryId: null,
      entries: [],
    }));
    await expect(
      manual.service.reverseInTransaction(manual.tx, user, 'mv-2', null),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
