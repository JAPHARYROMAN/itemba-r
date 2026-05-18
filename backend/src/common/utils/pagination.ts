import { BadRequestException } from '@nestjs/common';

export function pagination(input: {
  page?: string | number;
  limit?: string | number;
  maxLimit?: number;
}) {
  const page = Number(input.page ?? 1);
  const rawLimit = Number(input.limit ?? 20);
  const maxLimit = input.maxLimit ?? 200;
  if (!Number.isInteger(page) || page < 1 || page > 10_000) {
    throw new BadRequestException('Invalid page parameter');
  }
  if (!Number.isInteger(rawLimit) || rawLimit < 1) {
    throw new BadRequestException('Invalid limit parameter');
  }
  const limit = Math.min(rawLimit, maxLimit);
  return { page, limit, skip: (page - 1) * limit };
}
