import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

export const cashFingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const cashOffsetTypes: Record<string, string[]> = {
  OPENING: ['EQUITY'],
  DAILY_SALES: ['INCOME'],
  OTHER_IN: ['INCOME', 'EQUITY', 'LIABILITY', 'ASSET'],
  EXPENSE: ['EXPENSE', 'COST_OF_GOODS_SOLD'],
};
export function exactCashAmount(value: Prisma.Decimal) {
  const cents = Math.round(Number(value) * 100);
  if (!value.gt(0) || !Number.isSafeInteger(cents) || !new Prisma.Decimal(cents / 100).eq(value))
    throw new BadRequestException('Amount is outside the exact precision supported by the ledger.');
}
export function cashLines(
  kind: string,
  amount: Prisma.Decimal,
  entries: { accountId: string; amount: Prisma.Decimal }[],
  offsetId?: string,
) {
  exactCashAmount(amount);
  if (kind === 'TRANSFER') {
    if (
      entries.length !== 2 ||
      entries[0].accountId === entries[1].accountId ||
      !entries[0].amount.plus(entries[1].amount).isZero() ||
      entries.some((e) => !e.amount.abs().eq(amount))
    )
      throw new BadRequestException(
        'Transfer must have equal and opposite entries in two different accounts.',
      );
  } else {
    const sign = ['EXPENSE', 'SUPPLIER_PAYMENT'].includes(kind) ? -1 : 1;
    if (
      entries.length !== 1 ||
      !entries[0].amount.eq(amount.mul(sign)) ||
      !offsetId ||
      offsetId === entries[0].accountId
    )
      throw new BadRequestException('Cash direction or offset account is invalid.');
  }
  const lines = entries.map((e) => ({
    accountId: e.accountId,
    debit: e.amount.gt(0) ? e.amount : new Prisma.Decimal(0),
    credit: e.amount.lt(0) ? e.amount.abs() : new Prisma.Decimal(0),
  }));
  if (kind !== 'TRANSFER')
    lines.push({ accountId: offsetId!, debit: lines[0].credit, credit: lines[0].debit });
  return lines;
}
