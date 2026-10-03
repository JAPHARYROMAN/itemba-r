import { BadRequestException } from '@nestjs/common';
import { Prisma, SalesPaymentMethod } from '@prisma/client';

export type PosTender = {
  method: SalesPaymentMethod;
  amount: number;
  cashAccountId: string;
  reference: string | null;
};
export function readPosTenders(value: unknown): PosTender[] | null {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 3 || value.length === 0)
    throw new BadRequestException('Invalid POS payment allocations');
  const seen = new Set<string>();
  return value
    .map((raw) => {
      if (!raw || typeof raw !== 'object')
        throw new BadRequestException('Invalid POS payment allocation');
      const v = raw as PosTender;
      if (
        !['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER'].includes(v.method) ||
        seen.has(v.method) ||
        typeof v.cashAccountId !== 'string' ||
        !v.cashAccountId ||
        (v.reference != null && typeof v.reference !== 'string') ||
        !Number.isFinite(v.amount) ||
        v.amount <= 0 ||
        !new Prisma.Decimal(v.amount).equals(new Prisma.Decimal(v.amount).toDecimalPlaces(2))
      )
        throw new BadRequestException('Invalid POS payment allocation');
      seen.add(v.method);
      if (v.method !== 'CASH' && !v.reference?.trim())
        throw new BadRequestException('Non-cash payments require a reference');
      return {
        method: v.method,
        amount: v.amount,
        cashAccountId: v.cashAccountId,
        reference: v.reference?.trim() || null,
      };
    })
    .sort((a, b) => a.method.localeCompare(b.method));
}
export function tenderTotal(tenders: PosTender[]) {
  return tenders.reduce((n, v) => n.plus(v.amount), new Prisma.Decimal(0)).toDecimalPlaces(2);
}
