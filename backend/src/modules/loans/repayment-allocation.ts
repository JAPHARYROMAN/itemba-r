import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RecordRepaymentDto } from './dto/record-repayment.dto';

/** One allocation drives both the loan register and its journal posting. */
export function allocateRepayment(
  dto: Pick<
    RecordRepaymentDto,
    'amount' | 'principal' | 'interest' | 'penalties' | 'currency' | 'repaymentDate'
  >,
  outstanding: Prisma.Decimal,
  currency: string,
  disbursement: Date,
) {
  const read = (value: string | undefined, label: string) => {
    if (value === undefined) return new Prisma.Decimal(0);
    if (!/^\d+(\.\d{1,2})?$/.test(value))
      throw new BadRequestException(
        `${label} must be a non-negative amount with at most two decimal places`,
      );
    return new Prisma.Decimal(value);
  };
  const amount = read(dto.amount, 'Payment'),
    penalties = read(dto.penalties, 'Penalties');
  const specifiedInterest = read(dto.interest, 'Interest');
  const principal =
    dto.principal === undefined
      ? amount.minus(specifiedInterest).minus(penalties)
      : read(dto.principal, 'Principal');
  const interest =
    dto.interest === undefined ? amount.minus(principal).minus(penalties) : specifiedInterest;
  if (
    amount.lte(0) ||
    principal.lt(0) ||
    interest.lt(0) ||
    !principal.plus(interest).plus(penalties).eq(amount)
  )
    throw new BadRequestException(
      'Principal, interest and penalties must equal the positive payment amount',
    );
  if (principal.gt(outstanding))
    throw new BadRequestException('Principal repayment exceeds the remaining loan balance');
  if (dto.currency && dto.currency !== currency)
    throw new BadRequestException('Repayment currency must match the loan');
  const date = new Date(dto.repaymentDate);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dto.repaymentDate) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== dto.repaymentDate ||
    dto.repaymentDate < disbursement.toISOString().slice(0, 10)
  )
    throw new BadRequestException('Enter a valid repayment date on or after disbursement');
  return {
    amount,
    principal,
    interest,
    penalties,
    date,
    balance: outstanding.minus(principal),
    financeCharge: interest.plus(penalties),
  };
}
