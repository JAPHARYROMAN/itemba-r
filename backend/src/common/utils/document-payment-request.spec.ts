import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  assertNoLegacyPaymentClaim,
  legacyPaymentRequest,
  lockDocumentPaymentRequest,
  replayLegacyPayment,
} from './document-payment-request';

const request = {
  requestId: 'AA31381C-A312-4A38-A33C-B8EE023E32A8',
  amount: 125,
  paymentDate: '2026-10-22',
  cashAccountId: 'bank',
  notes: 'Replacement after reversal',
};
const canonicalModels = () => ({
  customerPayment: { findFirst: jest.fn().mockResolvedValue(null) },
  supplierPayment: { findFirst: jest.fn().mockResolvedValue(null) },
});

describe('document payment request claims', () => {
  it.each(['Receivable', 'Payable'] as const)(
    'refuses reuse of canonical %s tokens for name-only documents',
    async (kind) => {
      const tx = { ...canonicalModels(), journalEntry: { findUnique: jest.fn() } };
      tx.customerPayment.findFirst.mockResolvedValue({ id: 'canonical' });
      tx.supplierPayment.findFirst.mockResolvedValue({ id: 'canonical' });
      await expect(
        replayLegacyPayment(tx as any, 'company', kind, 'document', request),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.journalEntry.findUnique).not.toHaveBeenCalled();
      await expect(
        replayLegacyPayment(tx as any, 'company', kind, 'document', request, true),
      ).resolves.toBe(false);
    },
  );

  it.each(['Receivable', 'Payable'] as const)(
    'refuses reuse of legacy %s claims for canonical payments',
    async (kind) => {
      const tx = { journalEntry: { findFirst: jest.fn().mockResolvedValue({ id: 'legacy' }) } };
      await expect(
        assertNoLegacyPaymentClaim(tx as any, 'company', kind, request.requestId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.journalEntry.findFirst).toHaveBeenCalledWith({
        where: {
          journalNumber: `${kind === 'Receivable' ? 'AR' : 'AP'}-PAY-${request.requestId.toLowerCase()}`,
          ...(kind === 'Receivable' ? { companyId: 'company' } : {}),
        },
        select: { id: true },
      });
    },
  );

  it('uses a consistent lowercase request lock before document locks', async () => {
    const tx = { $queryRaw: jest.fn() };
    await lockDocumentPaymentRequest(tx as any, 'Receivable', request);
    expect(tx.$queryRaw.mock.calls[0][1]).toBe(
      `CustomerPaymentRequest:${request.requestId.toLowerCase()}`,
    );
  });

  it('rejects an undated retryable intent before touching any ledger', async () => {
    const tx = { $queryRaw: jest.fn() };
    await expect(
      lockDocumentPaymentRequest(tx as any, 'Payable', { ...request, paymentDate: undefined }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it.each(['Receivable', 'Payable'] as const)(
    'recognizes an identical legacy %s payment without writing again',
    async (kind) => {
      const key = legacyPaymentRequest(kind, 'document', request)!;
      const tx = {
        ...canonicalModels(),
        journalEntry: {
          findUnique: jest.fn().mockResolvedValue({
            status: 'POSTED',
            referenceType: kind,
            referenceId: 'document',
            description: `${kind} settlement DOC${key.suffix}`,
            deletedAt: null,
          }),
        },
      };
      await expect(
        replayLegacyPayment(tx as any, 'company', kind, 'document', request),
      ).resolves.toBe(true);
      expect(tx.journalEntry.findUnique).toHaveBeenCalledWith({
        where: {
          companyId_journalNumber: { companyId: 'company', journalNumber: key.journalNumber },
        },
      });
    },
  );

  it.each([
    { amount: 126 },
    { cashAccountId: 'another-bank' },
    { notes: 'Different instruction' },
    { paymentDate: '2026-10-23' },
  ])('refuses changed legacy payload %p under the same token', async (changes) => {
    const key = legacyPaymentRequest('Payable', 'document', request)!;
    const tx = {
      ...canonicalModels(),
      journalEntry: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'POSTED',
          referenceType: 'Payable',
          referenceId: 'document',
          description: `Payable settlement DOC${key.suffix}`,
          deletedAt: null,
        }),
      },
    };
    await expect(
      replayLegacyPayment(tx as any, 'company', 'Payable', 'document', { ...request, ...changes }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('never turns a reversed payment request into a fresh payment', async () => {
    const key = legacyPaymentRequest('Receivable', 'document', request)!;
    const tx = {
      ...canonicalModels(),
      journalEntry: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'REVERSED',
          referenceType: 'Receivable',
          referenceId: 'document',
          description: key.suffix,
          deletedAt: null,
        }),
      },
    };
    await expect(
      replayLegacyPayment(tx as any, 'company', 'Receivable', 'document', request),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
