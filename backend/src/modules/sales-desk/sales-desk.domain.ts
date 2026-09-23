import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { positiveAmount } from '../invoice-desk/invoice-desk.domain';
import { SalesLineDto } from './sales-desk.dto';
export function salesLines(input: SalesLineDto[]) {
  if (!input.length || input.length > 30)
    throw new BadRequestException('Add between 1 and 30 sale lines.');
  const lines = input.map((line, position) => {
    if (!line.description.trim() || !/^\d{1,9}(\.\d{1,3})?$/.test(line.quantity))
      throw new BadRequestException('Enter an item or service and a valid quantity.');
    const quantity = new Prisma.Decimal(line.quantity),
      unitPrice = positiveAmount(line.unitPrice);
    const Exact = Prisma.Decimal.clone({ precision: 40, rounding: Prisma.Decimal.ROUND_HALF_UP });
    const totalAmount = new Prisma.Decimal(
      new Exact(line.quantity).times(line.unitPrice).toFixed(2),
    );
    if (quantity.lte(0) || totalAmount.lte(0) || totalAmount.gte('10000000000000000'))
      throw new BadRequestException(
        'Each sale line must have a positive amount within the supported limit.',
      );
    return { position, description: line.description.trim(), quantity, unitPrice, totalAmount };
  });
  const totalAmount = lines.reduce(
    (sum, line) => sum.plus(line.totalAmount),
    new Prisma.Decimal(0),
  );
  if (totalAmount.gte('10000000000000000'))
    throw new BadRequestException('The sale total exceeds the supported limit.');
  return { lines, totalAmount };
}
