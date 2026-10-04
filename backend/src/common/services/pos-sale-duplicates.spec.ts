import { createHash } from 'node:crypto';
import { canonicalSaleSignature, eatDay, saleSignature } from './pos-sale-duplicates';

describe('shared POS/canonical sale identity', () => {
  it('retains the exact persisted hash and aggregates split/reordered lines', () => {
    const persistedHash = createHash('sha256')
      .update(
        '{"companyId":"company","customerId":"customer","day":"2026-10-04","lines":[["product:100.00","2.0000"]],"total":"200.00"}',
      )
      .digest('hex');
    expect(
      saleSignature(
        'company',
        '2026-10-04',
        'customer',
        [
          { productId: 'product', quantity: 1.5, unitPrice: 100 },
          { productId: 'product', quantity: 0.5, unitPrice: 100 },
        ],
        200,
      ),
    ).toBe(persistedHash);
  });

  it('matches captured gross prices to canonical VAT/discount-inclusive line totals rounded per unit', () => {
    const canonical = canonicalSaleSignature({
      companyId: 'company',
      customerId: 'customer',
      orderDate: '2026-10-04',
      totalAmount: 350,
      lines: [{ productId: 'product', quantity: 3, lineTotal: 350 }],
    });
    expect(canonical).toBe(
      saleSignature(
        'company',
        '2026-10-04',
        'customer',
        [{ productId: 'product', quantity: 3, unitPrice: 116.67 }],
        350,
      ),
    );
    expect(
      canonicalSaleSignature({
        companyId: 'company',
        customerId: 'customer',
        orderDate: '2026-10-04',
        totalAmount: 236,
        lines: [{ productId: 'product', quantity: 2, lineTotal: 236 }],
      }),
    ).toBe(
      saleSignature(
        'company',
        '2026-10-04',
        'customer',
        [{ productId: 'product', quantity: 2, unitPrice: 118 }],
        236,
      ),
    );
  });

  it('places both representations on the same EAT day at midnight', () => {
    expect(eatDay('2026-10-03T20:59:59.999Z')).toBe('2026-10-03');
    expect(eatDay('2026-10-03T21:00:00.000Z')).toBe('2026-10-04');
    expect(
      canonicalSaleSignature({
        companyId: 'company',
        customerId: 'customer',
        orderDate: '2026-10-03T21:00:00.000Z',
        totalAmount: 100,
        lines: [{ productId: 'product', quantity: 1, lineTotal: 100 }],
      }),
    ).toBe(
      saleSignature(
        'company',
        '2026-10-04',
        'customer',
        [{ productId: 'product', quantity: 1, unitPrice: 100 }],
        100,
      ),
    );
  });
});
