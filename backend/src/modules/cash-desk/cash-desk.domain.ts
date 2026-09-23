import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { todayUtc } from '../invoice-desk/invoice-desk.domain';

export function cashDate(value: string) {
  const date = new Date(value);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value ||
    date > todayUtc()
  )
    throw new BadRequestException('Choose a valid date on or before today.');
  return date;
}
export function payloadKey(value: object) {
  return createHash('sha256')
    .update(JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))))
    .digest('hex');
}
export function checkDailyBalances(
  rows: { businessDate: Date; amount: Prisma.Decimal }[],
  date: Date,
  amount: Prisma.Decimal,
) {
  const days = new Map<string, Prisma.Decimal>();
  for (const row of [...rows, { businessDate: date, amount }]) {
    const key = row.businessDate.toISOString().slice(0, 10);
    days.set(key, (days.get(key) ?? new Prisma.Decimal(0)).plus(row.amount));
  }
  let balance = new Prisma.Decimal(0);
  for (const [day, delta] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    balance = balance.plus(delta);
    if (balance.lt(0))
      throw new BadRequestException(
        `Insufficient funds: this would leave a negative balance on ${day}.`,
      );
    if (balance.gte('10000000000000000'))
      throw new BadRequestException('The account balance exceeds the supported limit.');
  }
  return balance;
}
