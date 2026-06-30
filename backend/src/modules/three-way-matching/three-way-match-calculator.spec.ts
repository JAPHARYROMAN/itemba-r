import { computeThreeWayMatch } from './three-way-match-calculator';

describe('computeThreeWayMatch', () => {
  const poLines = [{ productId: 'p1', quantity: 10, unitCost: 5, lineTotal: 50 }];

  it('reports MATCHED with zero variance when the invoice equals the PO', () => {
    const result = computeThreeWayMatch({
      invoice: {
        totalAmount: 50,
        lines: [{ productId: 'p1', quantity: 10, discountAmount: 0, taxAmount: 0 }],
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
        lines: [{ productId: 'p1', quantity: 10, discountAmount: 0, taxAmount: 0 }],
      },
      purchaseOrderLines: poLines,
    });
    expect(result.matchStatus).toBe('VARIANCE');
    expect(result.amountVariance.toNumber()).toBe(10);
  });

  it('aggregates split PO lines per product (finding #27 — no last-line overwrite)', () => {
    // p1 is split across two PO lines: qty 5 @ 4 (lineTotal 20) and qty 5 @ 6
    // (lineTotal 30); true PO value for p1 = 50. The invoice bills qty 10 totalling
    // 50, which exactly matches. The buggy "keep last line" logic used unitCost 6
    // (10 * 6 = 60) and falsely flagged a 10 variance.
    const result = computeThreeWayMatch({
      invoice: {
        totalAmount: 50,
        lines: [{ productId: 'p1', quantity: 10, discountAmount: 0, taxAmount: 0 }],
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
        lines: [{ productId: 'p1', quantity: 10, discountAmount: 0, taxAmount: 0 }],
      },
      purchaseOrderLines: poLines,
      grnLines: [{ productId: 'p1', acceptedQuantity: 8 }],
    });
    expect(result.quantityVariance.toNumber()).toBe(2);
    expect(result.matchStatus).toBe('VARIANCE');
  });
});
