import { Prisma } from '@prisma/client';

/**
 * Pure, Decimal-precise three-way-match variance computation. Mirrors the
 * authoritative matcher in supplier-invoices.service.ts so both the
 * supplier-invoice approval flow and the standalone three-way-matching register
 * derive variances the same way — never from operator-supplied values.
 */

export const MONEY_TOLERANCE = new Prisma.Decimal('0.01');
export const QTY_TOLERANCE = new Prisma.Decimal('0.0001');

type LineLike = Record<string, any>;

export function groupQuantities(lines: LineLike[], quantityField: string): Map<string, Prisma.Decimal> {
  const grouped = new Map<string, Prisma.Decimal>();
  for (const line of lines ?? []) {
    const key = line.productId ? `product:${line.productId}` : `desc:${line.description ?? line.id}`;
    const quantity = new Prisma.Decimal(line[quantityField] ?? 0);
    grouped.set(key, (grouped.get(key) ?? new Prisma.Decimal(0)).plus(quantity));
  }
  return grouped;
}

export function sumAbsQuantityVariance(
  expected: Map<string, Prisma.Decimal>,
  actual: Map<string, Prisma.Decimal>,
): Prisma.Decimal {
  let variance = new Prisma.Decimal(0);
  const keys = new Set([...expected.keys(), ...actual.keys()]);
  for (const key of keys) {
    variance = variance.plus(
      (expected.get(key) ?? new Prisma.Decimal(0))
        .minus(actual.get(key) ?? new Prisma.Decimal(0))
        .abs(),
    );
  }
  return variance;
}

export function amountVarianceAgainstPurchaseOrder(
  invoice: { lines: LineLike[]; totalAmount: Prisma.Decimal | number | string },
  purchaseOrderLines: LineLike[],
): Prisma.Decimal {
  const poLinesByProduct = new Map<string, LineLike>();
  let purchaseOrderTotal = new Prisma.Decimal(0);
  for (const line of purchaseOrderLines ?? []) {
    purchaseOrderTotal = purchaseOrderTotal.plus(line.lineTotal ?? 0);
    if (line.productId) poLinesByProduct.set(line.productId, line);
  }

  let expectedAmount = new Prisma.Decimal(0);
  let hasLineMatch = false;
  for (const line of invoice.lines ?? []) {
    const poLine = line.productId ? poLinesByProduct.get(line.productId) : null;
    if (!poLine) continue;
    hasLineMatch = true;
    expectedAmount = expectedAmount
      .plus(new Prisma.Decimal(line.quantity).mul(poLine.unitCost))
      .minus(line.discountAmount ?? 0)
      .plus(line.taxAmount ?? 0);
  }

  if (!hasLineMatch) {
    return new Prisma.Decimal(invoice.totalAmount).minus(purchaseOrderTotal).abs();
  }
  return new Prisma.Decimal(invoice.totalAmount).minus(expectedAmount).abs();
}

export interface ComputedThreeWayMatch {
  quantityVariance: Prisma.Decimal;
  amountVariance: Prisma.Decimal;
  matchStatus: 'MATCHED' | 'VARIANCE';
}

export function computeThreeWayMatch(params: {
  invoice: { lines: LineLike[]; totalAmount: Prisma.Decimal | number | string };
  purchaseOrderLines: LineLike[];
  grnLines?: LineLike[] | null;
}): ComputedThreeWayMatch {
  const { invoice, purchaseOrderLines, grnLines } = params;
  const quantityVariance = grnLines
    ? sumAbsQuantityVariance(
        groupQuantities(grnLines, 'acceptedQuantity'),
        groupQuantities(invoice.lines, 'quantity'),
      )
    : sumAbsQuantityVariance(
        groupQuantities(purchaseOrderLines, 'quantity'),
        groupQuantities(invoice.lines, 'quantity'),
      );
  const amountVariance = amountVarianceAgainstPurchaseOrder(invoice, purchaseOrderLines);
  const matchStatus =
    quantityVariance.lte(QTY_TOLERANCE) && amountVariance.lte(MONEY_TOLERANCE)
      ? 'MATCHED'
      : 'VARIANCE';
  return { quantityVariance, amountVariance, matchStatus };
}
