import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { CustomerPaymentsService } from './customer-payments.service';
import { SupplierPaymentsService } from '../supplier-payments/supplier-payments.service';
import { ReverseCustomerPaymentDto } from './dto/reverse-customer-payment.dto';
import { ReverseSupplierPaymentDto } from '../supplier-payments/dto/reverse-supplier-payment.dto';

const user = { id: 'user' } as any;
const input = {
  requestId: 'aa31381c-a312-4a38-a33c-b8ee023e32a8',
  companyId: 'company',
  customerId: 'customer',
  supplierId: 'supplier',
  amount: 125,
  paymentDate: new Date('2026-10-22'),
  cashAccountId: 'bank',
  currency: 'TZS',
  allocations: [{ receivableId: 'document', payableId: 'document', amount: 125 }],
};

function existingPayment(overrides: Record<string, unknown> = {}) {
  return {
    ...input,
    id: 'payment',
    status: 'COMPLETED',
    deletedAt: null,
    method: 'CASH',
    divisionId: null,
    branchId: null,
    notes: null,
    reference: null,
    sourceType: 'Payable',
    sourceId: 'document',
    cashDeskMovementId: null,
    journalEntryId: null,
    ...overrides,
  };
}

function setup(side: 'AR' | 'AP', overrides: Record<string, unknown> = {}) {
  const existing = existingPayment(overrides);
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    customerPayment: { findFirst: jest.fn().mockResolvedValue(existing) },
    supplierPayment: {
      findUnique: jest.fn().mockResolvedValue(existing),
      findMany: jest.fn().mockResolvedValue([existing]),
    },
    journalEntry: { findFirst: jest.fn().mockResolvedValue(null) },
    receivable: { update: jest.fn() },
    payable: { update: jest.fn() },
    cashAccount: { updateMany: jest.fn() },
  };
  const prisma = { $transaction: jest.fn(async (run) => run(tx)) };
  const audit = { log: jest.fn(), logStrictInTransaction: jest.fn().mockResolvedValue(undefined) };
  const scope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) };
  const posting = { postLines: jest.fn() };
  const args = [prisma, audit, scope, {}, posting, {}] as any[];
  const service =
    side === 'AR'
      ? new CustomerPaymentsService(args[0], args[1], args[2], args[3], args[4], args[5])
      : new SupplierPaymentsService(args[0], args[1], args[2], args[3], args[4], args[5]);
  return { service, existing, tx, prisma, audit, posting };
}

describe.each(['AR', 'AP'] as const)('%s payment correction controls', (side) => {
  it('returns an identical recorded intent without changing cash, documents or journals', async () => {
    const { service, existing, tx, posting } = setup(side);
    const result = await service.createInTransaction(tx as any, user, input);
    expect(result.payment).toBe(existing);
    expect(tx.receivable.update).not.toHaveBeenCalled();
    expect(tx.payable.update).not.toHaveBeenCalled();
    expect(tx.cashAccount.updateMany).not.toHaveBeenCalled();
    expect(posting.postLines).not.toHaveBeenCalled();
  });

  it.each([
    { amount: new Prisma.Decimal(126) },
    { companyId: 'other-company' },
    { cashAccountId: 'other-bank' },
    { currency: 'USD' },
    { status: 'REVERSED' },
    { notes: 'changed' },
    { paymentDate: new Date('2026-10-23') },
    { allocations: [{ receivableId: 'another', payableId: 'another', amount: 125 }] },
  ])('rejects changed or consumed payment intents %p', async (changes) => {
    const { service, tx, posting } = setup(side, changes);
    await expect(service.createInTransaction(tx as any, user, input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(posting.postLines).not.toHaveBeenCalled();
  });

  it('requires an entered reversal reason before starting a transaction', async () => {
    const { service, prisma } = setup(side);
    await expect(service.reverse('payment', { reason: '  ' }, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a token already consumed by a legacy payment', async () => {
    const { service, tx, posting } = setup(side);
    tx.journalEntry.findFirst.mockResolvedValueOnce({ id: 'legacy-journal' });
    await expect(service.createInTransaction(tx as any, user, input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(posting.postLines).not.toHaveBeenCalled();
  });
});

describe('supplier payment intent normalization', () => {
  it('replays identical unordered allocations using the same canonical source', async () => {
    const allocations = [
      { payableId: 'z', amount: 25 },
      { payableId: 'a', amount: 100 },
    ];
    const { service, tx, existing } = setup('AP', { allocations, sourceId: 'a' });
    const result = await service.createInTransaction(tx as any, user, {
      ...input,
      allocations,
    } as any);
    expect(result.payment).toBe(existing);
  });

  it('rejects duplicate allocations before replaying an old intent', async () => {
    const { service, tx } = setup('AP');
    await expect(
      service.createInTransaction(tx as any, user, {
        ...input,
        allocations: [
          { payableId: 'document', amount: 50 },
          { payableId: 'document', amount: 75 },
        ],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.supplierPayment.findMany).not.toHaveBeenCalled();
  });

  it('normalizes UUID lock keys and safely finds historical mixed-case tokens', async () => {
    const { service, tx, existing } = setup('AP', { requestId: input.requestId.toUpperCase() });
    const result = await service.createInTransaction(tx as any, user, {
      ...input,
      requestId: input.requestId.toUpperCase(),
    });
    expect(result.payment).toBe(existing);
    expect(tx.$queryRaw.mock.calls[0][1]).toBe(`SupplierPaymentRequest:${input.requestId}`);
    expect(tx.supplierPayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requestId: { equals: input.requestId, mode: 'insensitive' } },
        take: 2,
      }),
    );
  });

  it('refuses an ambiguous historical token rather than choosing one payment', async () => {
    const { service, tx, existing } = setup('AP');
    tx.supplierPayment.findMany.mockResolvedValueOnce([existing, existing]);
    await expect(service.createInTransaction(tx as any, user, input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('supplier record-only payment request boundary', () => {
  const recordInput = {
    ...input,
    source: { type: 'InvoiceDeskInvoice', id: 'invoice' },
    allocations: [],
  };

  it('replays only the same source-owned settlement without posting or allocating again', async () => {
    const { service, tx, existing, posting } = setup('AP', {
      sourceType: 'InvoiceDeskInvoice',
      sourceId: 'invoice',
      allocations: [],
    });
    const result = await (service as SupplierPaymentsService).recordInTransaction(
      tx as any,
      user,
      recordInput,
    );
    expect(result).toBe(existing);
    expect(posting.postLines).not.toHaveBeenCalled();
    expect(tx.payable.update).not.toHaveBeenCalled();
  });

  it.each([
    { sourceId: 'other-invoice' },
    { sourceType: 'Payable' },
    { amount: 126 },
    { cashAccountId: 'other-bank' },
    { status: 'REVERSED' },
  ])('rejects reuse by another source or payload %p', async (changes) => {
    const { service, tx, posting } = setup('AP', {
      sourceType: 'InvoiceDeskInvoice',
      sourceId: 'invoice',
      allocations: [],
      ...changes,
    });
    await expect(
      (service as SupplierPaymentsService).recordInTransaction(tx as any, user, recordInput),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(posting.postLines).not.toHaveBeenCalled();
    expect(tx.payable.update).not.toHaveBeenCalled();
  });

  it('refuses a token already claimed by a legacy settlement before recording a source payment', async () => {
    const { service, tx } = setup('AP');
    tx.journalEntry.findFirst.mockResolvedValueOnce({ id: 'legacy' });
    await expect(
      (service as SupplierPaymentsService).recordInTransaction(tx as any, user, recordInput),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.supplierPayment.findMany).not.toHaveBeenCalled();
  });
});

describe('reversal reason DTOs', () => {
  it.each([ReverseCustomerPaymentDto, ReverseSupplierPaymentDto])(
    'trims and validates %p reasons',
    async (Dto) => {
      expect(await validate(plainToInstance(Dto, { reason: '   ' }))).not.toHaveLength(0);
      const valid = plainToInstance(Dto, { reason: '  Bank rejected the original payment  ' });
      expect(await validate(valid)).toHaveLength(0);
      expect(valid.reason).toBe('Bank rejected the original payment');
      expect(await validate(plainToInstance(Dto, { reason: 'x'.repeat(501) }))).not.toHaveLength(0);
    },
  );
});

describe('supplier reversal audit transaction', () => {
  it('appends the mandatory audit inside the same reversal transaction', async () => {
    const { service, tx, audit } = setup('AP');
    const supplier = service as SupplierPaymentsService;
    const reverse = jest.spyOn(supplier, 'reverseInTransaction').mockResolvedValue({
      before: { status: 'REVERSED' },
      record: { id: 'payment', companyId: 'company' },
      reversal: { id: 'mirror' },
    } as any);
    await supplier.reverse('payment', { reason: '  Duplicate payment  ' }, user);
    expect(reverse).toHaveBeenCalledWith(tx, user, 'payment', 'Duplicate payment', {
      publicReversal: true,
    });
    expect(audit.logStrictInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        oldValue: { status: 'COMPLETED' },
        newValue: expect.objectContaining({ reason: 'Duplicate payment' }),
      }),
    );
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('propagates audit failure instead of reporting a completed unaudited reversal', async () => {
    const { service, audit } = setup('AP');
    const supplier = service as SupplierPaymentsService;
    jest
      .spyOn(supplier, 'reverseInTransaction')
      .mockResolvedValue({ record: { companyId: 'company' }, reversal: { id: 'mirror' } } as any);
    audit.logStrictInTransaction.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(
      supplier.reverse('payment', { reason: 'Duplicate payment' }, user),
    ).rejects.toThrow('audit unavailable');
    expect(audit.log).not.toHaveBeenCalled();
  });
});
