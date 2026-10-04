import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const RECEIPT_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER'] as const;
export const PRICE_REASONS = ['REGULAR_CUSTOMER', 'BULK_OFFER', 'DAMAGED', 'OTHER'];
export const DAMAGE_TYPES = [
  'BREAKAGE',
  'EXPIRED',
  'SPOILED',
  'LOST',
  'THEFT',
  'DAMAGED_PACKAGING',
  'OTHER',
];
export const FINAL_STATUSES = ['POSTED', 'REJECTED'];
export type DraftRole = 'CASHIER' | 'STOCKIST' | 'ADMIN';
export type JsonRecord = Record<string, any>;
export function object(value: unknown, keys?: string[]): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Invalid transaction payload');
  const record = value as JsonRecord;
  if (keys && Object.keys(record).some((key) => !keys.includes(key)))
    throw new BadRequestException('Unexpected transaction field');
  return record;
}
export function decimal(
  value: unknown,
  label: string,
  places = 2,
  allowZero = false,
): Prisma.Decimal {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new BadRequestException(`${label} must be a number`);
  const n = new Prisma.Decimal(value);
  if ((allowZero ? n.lt(0) : n.lte(0)) || n.decimalPlaces() > places || n.gt(1000000000))
    throw new BadRequestException(`Invalid ${label}`);
  return n;
}
export function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100)
    throw new BadRequestException(`${label} is required`);
  return value.trim();
}
export function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function digest(value: any): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}
export function eatDay(value: Date | string): string {
  return new Date(new Date(value).getTime() + 3 * 3600000).toISOString().slice(0, 10);
}
export { saleSignature } from '../../common/services/pos-sale-duplicates';
