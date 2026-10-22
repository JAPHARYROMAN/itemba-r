import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';

type PaymentRequest = {
  requestId?: string;
  amount: number;
  paymentDate?: string;
  cashAccountId?: string;
  notes?: string;
};

/** Serialize an intent before taking any source/document lock. */
export async function lockDocumentPaymentRequest(
  tx: Prisma.TransactionClient,
  kind: 'Receivable' | 'Payable',
  dto: PaymentRequest,
) {
  if (!dto.requestId) return;
  if (!dto.paymentDate)
    throw new BadRequestException('An idempotent payment requires a payment date');
  const prefix = kind === 'Receivable' ? 'CustomerPaymentRequest' : 'SupplierPaymentRequest';
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`${prefix}:${dto.requestId.toLowerCase()}`}, 0))`;
}

/** Legacy name-only payments use the journal's company-scoped unique number as their claim. */
export function legacyPaymentRequest(
  kind: 'Receivable' | 'Payable',
  id: string,
  dto: PaymentRequest,
) {
  if (!dto.requestId) return undefined;
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        kind,
        id,
        amount: new Prisma.Decimal(dto.amount).toFixed(2),
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate).toISOString() : null,
        cashAccountId: dto.cashAccountId ?? null,
        notes: dto.notes ?? null,
      }),
    )
    .digest('hex');
  return {
    journalNumber: `${kind === 'Receivable' ? 'AR' : 'AP'}-PAY-${dto.requestId.toLowerCase()}`,
    suffix: ` [request:${fingerprint}]`,
  };
}

export async function replayLegacyPayment(
  tx: Prisma.TransactionClient,
  companyId: string,
  kind: 'Receivable' | 'Payable',
  id: string,
  dto: PaymentRequest,
  allowCanonicalReplay = false,
) {
  const request = legacyPaymentRequest(kind, id, dto);
  if (!request) return false;
  const canonical =
    kind === 'Receivable'
      ? await tx.customerPayment.findFirst({
          where: { companyId, requestId: dto.requestId!.toLowerCase() },
          select: { id: true },
        })
      : await tx.supplierPayment.findFirst({
          where: { requestId: { equals: dto.requestId!.toLowerCase(), mode: 'insensitive' } },
          select: { id: true },
        });
  if (canonical) {
    if (allowCanonicalReplay) return false;
    throw new ConflictException(
      'This payment request already belongs to a recorded payment. Start a new payment.',
    );
  }
  const existing = await tx.journalEntry.findUnique({
    where: { companyId_journalNumber: { companyId, journalNumber: request.journalNumber } },
  });
  if (!existing) return false;
  if (
    existing.deletedAt ||
    existing.status !== 'POSTED' ||
    existing.referenceType !== kind ||
    existing.referenceId !== id ||
    !existing.description.endsWith(request.suffix)
  ) {
    throw new ConflictException(
      'This payment request was already used with different details or has been reversed. Start a new payment.',
    );
  }
  return true;
}

/** One request cannot move between the legacy and canonical payment paths. */
export async function assertNoLegacyPaymentClaim(
  tx: Prisma.TransactionClient,
  companyId: string,
  kind: 'Receivable' | 'Payable',
  requestId?: string | null,
) {
  if (
    !requestId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)
  )
    return;
  const existing = await tx.journalEntry.findFirst({
    where: {
      journalNumber: `${kind === 'Receivable' ? 'AR' : 'AP'}-PAY-${requestId.toLowerCase()}`,
      ...(kind === 'Receivable' ? { companyId } : {}),
    },
    select: { id: true },
  });
  if (existing)
    throw new ConflictException(
      'This payment request already belongs to a legacy payment. Start a new payment.',
    );
}
