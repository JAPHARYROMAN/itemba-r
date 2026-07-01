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

export function groupQuantities(
  lines: LineLike[],
  quantityField: string,
): Map<string, Prisma.Decimal> {
  const grouped = new Map<string, Prisma.Decimal>();
  for (const line of lines ?? []) {
    const key = line.productId
      ? `product:${line.productId}`
      : `desc:${line.description ?? line.id}`;
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
  // Aggregate ALL PO lines per product. A product can be split across several PO
  // lines (e.g. qty 5 @ 4 and qty 5 @ 6); keeping only the last line (Map.set
  // overwrite) discards the others and mis-values the expected amount. We sum
  // quantity and lineTotal per product and derive a quantity-weighted average
  // unitCost, consistent with the quantity-variance path which also sums all PO
  // lines for a product.
  const poByProduct = new Map<string, { quantity: Prisma.Decimal; lineTotal: Prisma.Decimal }>();
  let purchaseOrderTotal = new Prisma.Decimal(0);
  for (const line of purchaseOrderLines ?? []) {
    purchaseOrderTotal = purchaseOrderTotal.plus(line.lineTotal ?? 0);
    if (!line.productId) continue;
    const agg = poByProduct.get(line.productId) ?? {
      quantity: new Prisma.Decimal(0),
      lineTotal: new Prisma.Decimal(0),
    };
    agg.quantity = agg.quantity.plus(line.quantity ?? 0);
    agg.lineTotal = agg.lineTotal.plus(
      line.lineTotal ?? new Prisma.Decimal(line.quantity ?? 0).mul(line.unitCost ?? 0),
    );
    poByProduct.set(line.productId, agg);
  }

  let expectedAmount = new Prisma.Decimal(0);
  // Accumulate the ACTUAL billed amount over the SAME matched-line set that builds
  // expectedAmount. The amount variance must compare like against like: expected
  // (PO-priced) vs actual (invoice-priced) for the matched lines only. Comparing
  // the matched expected against the WHOLE invoice total falsely flags a variance
  // whenever the invoice carries an extra non-PO line (e.g. freight/service) that
  // has no PO product to match — that line inflates totalAmount but has no expected
  // counterpart. Both sides are net-of-discount, plus-tax (SupplierInvoiceLine
  // stores lineTotal = qty*unitPrice - discount + tax), so the bases align.
  let actualMatchedAmount = new Prisma.Decimal(0);
  let hasLineMatch = false;
  for (const line of invoice.lines ?? []) {
    const agg = line.productId ? poByProduct.get(line.productId) : null;
    if (!agg) continue;
    hasLineMatch = true;
    // Quantity-weighted average PO unit cost for this product across all its split
    // PO lines: total PO value for the product / total PO quantity ordered.
    const avgUnitCost = agg.quantity.isZero()
      ? new Prisma.Decimal(0)
      : agg.lineTotal.div(agg.quantity);
    expectedAmount = expectedAmount
      .plus(new Prisma.Decimal(line.quantity).mul(avgUnitCost))
      .minus(line.discountAmount ?? 0)
      .plus(line.taxAmount ?? 0);
    // Actual billed amount for this matched line. Prefer the persisted lineTotal
    // (already net-of-discount, plus-tax); fall back to reconstructing it from
    // quantity/unitPrice when a caller supplies bare lines without lineTotal.
    const actualLine =
      line.lineTotal != null
        ? new Prisma.Decimal(line.lineTotal)
        : new Prisma.Decimal(line.quantity ?? 0)
            .mul(line.unitPrice ?? 0)
            .minus(line.discountAmount ?? 0)
            .plus(line.taxAmount ?? 0);
    actualMatchedAmount = actualMatchedAmount.plus(actualLine);
  }

  if (!hasLineMatch) {
    return new Prisma.Decimal(invoice.totalAmount).minus(purchaseOrderTotal).abs();
  }
  return actualMatchedAmount.minus(expectedAmount).abs();
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
