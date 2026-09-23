import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export function loanMoney(value: unknown, label = 'Amount') {
  const text = String(value ?? '0');
  if (!/^\d+(\.\d{1,2})?$/.test(text))
    throw new BadRequestException(`${label} must be non-negative with at most two decimal places.`);
  const amount = new Prisma.Decimal(text);
  if (amount.mul(100).gt(Number.MAX_SAFE_INTEGER))
    throw new BadRequestException(`${label} exceeds the supported posting limit.`);
  return amount;
}
export function loanDate(value: string) {
  const date = new Date(value);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException('Use a valid date in YYYY-MM-DD format.');
  return date;
}

/** Largest-remainder allocation in integer cents; never exceeds any remaining component. */
export function allocateScheduledPayment(
  amountInput: unknown,
  remainingInput: { principal: unknown; interest: unknown; fees: unknown },
) {
  const amount = loanMoney(amountInput),
    keys = ['principal', 'interest', 'fees'] as const;
  const remaining = keys.map((k) =>
    BigInt(loanMoney(remainingInput[k], `Remaining ${k}`).mul(100).toFixed(0)),
  );
  const total = remaining.reduce((a, b) => a + b, 0n);
  const cents = BigInt(amount.mul(100).toFixed(0));
  if (cents <= 0n || cents > total)
    throw new BadRequestException(
      'Payment must be positive and cannot exceed the remaining installment.',
    );
  // BigInt retains every cent even when proportional numerators exceed Decimal precision.
  const allocated = remaining.map((value) => (cents * value) / total);
  const ranked = remaining
    .map((value, index) => ({ index, remainder: (cents * value) % total }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );
  let left = cents - allocated.reduce((a, b) => a + b, 0n);
  for (const { index } of ranked)
    if (left > 0n && allocated[index] < remaining[index]) {
      allocated[index]++;
      left--;
    }
  const decimal = (value: bigint) => new Prisma.Decimal(value.toString()).div(100);
  return {
    amount,
    principal: decimal(allocated[0]),
    interest: decimal(allocated[1]),
    fees: decimal(allocated[2]),
    penalties: new Prisma.Decimal(0),
  };
}

export function allocateLoanPayment(
  input: {
    amount: unknown;
    principal?: unknown;
    interest?: unknown;
    fees?: unknown;
    penalties?: unknown;
  },
  outstanding: Prisma.Decimal,
) {
  const amount = loanMoney(input.amount),
    interest = loanMoney(input.interest, 'Interest'),
    fees = loanMoney(input.fees, 'Fees'),
    penalties = loanMoney(input.penalties, 'Penalties');
  const principal =
    input.principal == null || input.principal === ''
      ? amount.minus(interest).minus(fees).minus(penalties)
      : loanMoney(input.principal, 'Principal');
  if (
    amount.lte(0) ||
    principal.lt(0) ||
    !principal.plus(interest).plus(fees).plus(penalties).eq(amount)
  )
    throw new BadRequestException(
      'Principal, interest, fees and penalties must equal the positive payment amount.',
    );
  if (principal.gt(outstanding))
    throw new BadRequestException('Principal repayment exceeds the remaining loan balance.');
  return { amount, principal, interest, fees, penalties };
}
