import { computeThreeWayMatch } from './three-way-match-calculator';

describe('computeThreeWayMatch', () => {
  const poLines = [{ productId: 'p1', quantity: 10, unitCost: 5, lineTotal: 50 }];

  it('reports MATCHED with zero variance when the invoice equals the PO', () => {
    const result = computeThreeWayMatch({
      invoice: {
        totalAmount: 50,
        lines: [
          { productId: 'p1', quantity: 10, unitPrice: 5, lineTotal: 50, discountAmount: 0, taxAmount: 0 },
        ],
      },
      purchaseOrderLines: poLines,
    });
    expect(result.matchStatus).toBe('MATCHED');
    expect(result.amountVariance.toNumber()).toBe(0);
    expect(result.quantityVariance.toNumber()).toBe(0);
  });

  it('reports VARIANCE on an amount discrepancy', () => {
    const result = computeThreeWayMatch({
      invoice: {
        totalAmount: 60,
        // Billed 10 @ 6 = 60 against a PO priced 10 @ 5 = 50 → matched-line
        // variance of 10.
        lines: [
          { productId: 'p1', quantity: 10, unitPrice: 6, lineTotal: 60, discountAmount: 0, taxAmount: 0 },
        ],
      },
      purchaseOrderLines: poLines,
    });
    expect(result.matchStatus).toBe('VARIANCE');
    expect(result.amountVariance.toNumber()).toBe(10);
  });

  it('does not flag an amount variance for an extra non-PO line (freight) on a matched invoice', () => {
    // The PO-priced product line matches exactly (10 @ 5 = 50). The invoice also
    // carries a non-PO freight line (250) with no PO product to match. The amount
    // variance must compare the matched expected (50) against the matched actual
    // (50) — NOT against the whole-invoice total (300) — so the freight line does
    // not manufacture a bogus amount variance. (A flat charge line with quantity 0
    // keeps the separate quantity-variance path clean so we isolate the amount side.)
    const result = computeThreeWayMatch({
      invoice: {
        totalAmount: 300,
        lines: [
          { productId: 'p1', quantity: 10, unitPrice: 5, lineTotal: 50, discountAmount: 0, taxAmount: 0 },
          { productId: null, description: 'Freight', quantity: 0, unitPrice: 0, lineTotal: 250 },
        ],
      },
      purchaseOrderLines: poLines,
    });
    expect(result.amountVariance.toNumber()).toBe(0);
    expect(result.matchStatus).toBe('MATCHED');
  });

  it('aggregates split PO lines per product (finding #27 — no last-line overwrite)', () => {
    // p1 is split across two PO lines: qty 5 @ 4 (lineTotal 20) and qty 5 @ 6
    // (lineTotal 30); true PO value for p1 = 50. The invoice bills qty 10 totalling
    // 50, which exactly matches. The buggy "keep last line" logic used unitCost 6
    // (10 * 6 = 60) and falsely flagged a 10 variance.
    const result = computeThreeWayMatch({
      invoice: {
        totalAmount: 50,
        lines: [
          { productId: 'p1', quantity: 10, unitPrice: 5, lineTotal: 50, discountAmount: 0, taxAmount: 0 },
        ],
      },
      purchaseOrderLines: [
        { productId: 'p1', quantity: 5, unitCost: 4, lineTotal: 20 },
        { productId: 'p1', quantity: 5, unitCost: 6, lineTotal: 30 },
      ],
    });
    expect(result.amountVariance.toNumber()).toBe(0);
    expect(result.matchStatus).toBe('MATCHED');
  });

  it('measures quantity variance against GRN accepted quantity when a GRN is present', () => {
    const result = computeThreeWayMatch({
      invoice: {
        totalAmount: 50,
        lines: [
          { productId: 'p1', quantity: 10, unitPrice: 5, lineTotal: 50, discountAmount: 0, taxAmount: 0 },
        ],
      },
      purchaseOrderLines: poLines,
      grnLines: [{ productId: 'p1', acceptedQuantity: 8 }],
    });
    // Amount matches (50 vs 50); the VARIANCE is driven purely by the quantity gap.
    expect(result.quantityVariance.toNumber()).toBe(2);
    expect(result.amountVariance.toNumber()).toBe(0);
    expect(result.matchStatus).toBe('VARIANCE');
  });
});
