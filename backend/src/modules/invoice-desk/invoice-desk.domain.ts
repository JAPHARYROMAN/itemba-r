import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const deskKey = (value: string) => value.trim().replace(/\s+/g, ' ').toUpperCase();
// East Africa business date, represented at UTC midnight for @db.Date comparisons.
export const todayUtc = () =>
  new Date(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()),
  );
export function positiveAmount(value: string) {
  if (!/^\d{1,16}(\.\d{1,2})?$/.test(value))
    throw new BadRequestException('Use an amount with at most two decimal places.');
  const amount = new Prisma.Decimal(value);
  if (amount.lte(0)) throw new BadRequestException('The amount must be greater than zero.');
  return amount;
}
export function deskBalance(
  row: {
    totalAmount: Prisma.Decimal;
    paidAmount: Prisma.Decimal;
    voidedAt: Date | null;
    dueDate: Date;
  },
  today = todayUtc(),
) {
  const outstanding = row.voidedAt ? new Prisma.Decimal(0) : row.totalAmount.minus(row.paidAmount);
  const status = row.voidedAt
    ? 'Void'
    : outstanding.eq(0)
      ? 'Paid'
      : row.dueDate < today
        ? 'Overdue'
        : row.paidAmount.gt(0)
          ? 'Part paid'
          : 'Unpaid';
  return { outstanding: outstanding.toFixed(2), status };
}
