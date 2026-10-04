import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export function eatDay(value: Date | string): string {
  return new Date(new Date(value).getTime() + 3 * 3600000).toISOString().slice(0, 10);
}

export function posDraftSaleRequestKey(companyId: string, requestId: string): string {
  return `PD-${createHash('sha256').update(stableJson({ companyId, requestId })).digest('hex').slice(0, 60)}`;
}

/** Preserve the exact persisted POS Draft hash, including gross prices and company-wide scope. */
export function saleSignature(
  companyId: string,
  day: string,
  customerId: string,
  lines: Record<string, any>[],
  total: unknown,
): string {
  const quantities = new Map<string, Prisma.Decimal>();
  for (const line of lines) {
    const key = `${line.productId}:${new Prisma.Decimal(line.unitPrice).toFixed(2)}`;
    quantities.set(key, (quantities.get(key) ?? new Prisma.Decimal(0)).plus(line.quantity));
  }
  return createHash('sha256')
    .update(
      stableJson({
        companyId,
        day,
        customerId,
        lines: [...quantities.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, quantity]) => [key, quantity.toFixed(4)]),
        total: new Prisma.Decimal(total as any).toFixed(2),
      }),
    )
    .digest('hex');
}

export function canonicalSaleSignature(order: {
  companyId: string;
  customerId: string | null;
  orderDate: Date | string;
  totalAmount: unknown;
  lines: Array<{ productId: string; quantity: unknown; lineTotal: unknown }>;
}): string | null {
  if (!order.customerId) return null;
  return saleSignature(
    order.companyId,
    eatDay(order.orderDate),
    order.customerId,
    order.lines.map((line) => ({
      productId: line.productId,
      quantity: Number(line.quantity),
      unitPrice: Number(
        new Prisma.Decimal(line.lineTotal as any).div(line.quantity as any).toDecimalPlaces(2),
      ),
    })),
    order.totalAmount,
  );
}

/** Request identities and duplicate fingerprints use the original shared POS Draft namespace. */
export function lockPosDuplicateIdentity(
  tx: Prisma.TransactionClient,
  companyId: string,
  identity: string,
) {
  return tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`POSDraft:${companyId}:${identity}`}, 0))`,
  );
}

/** Acquire before stock or numbering locks so different sale fingerprints cannot invert their order. */
export function lockPosSalePosting(tx: Prisma.TransactionClient, companyId: string) {
  return tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`PosSalePosting:${companyId}`}, 0))`,
  );
}
