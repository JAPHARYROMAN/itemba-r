import { describe, expect, it } from 'vitest';
import { productBody, productForm } from './product-form';
import { productRenameBody, productStock, productStockStatus } from './product-stock';
import type { Product } from './product-types';

const legacy: Product = {
  id: 'exact-id',
  companyId: 'company',
  name: 'Legacy product',
  categoryId: 'category',
  baseUnitId: 'unit',
  productType: 'STOCK_ITEM',
  status: 'ACTIVE',
  trackInventory: true,
  trackBatch: false,
  trackExpiry: false,
  updatedAt: '2026-10-13T10:00:00.000Z',
  defaultPurchasePrice: 0,
  defaultSellingPrice: 0,
};

describe('product stock and changed-field contracts', () => {
  it('renames with the original version and leaves unrelated legacy pricing out of the patch', () => {
    expect(productRenameBody(legacy, '  New product name  ')).toEqual({
      name: 'New product name',
      expectedUpdatedAt: legacy.updatedAt,
    });
    const initial = productForm(legacy);
    expect(productBody({ ...initial, name: 'New product name' }, initial, true)).toEqual({
      name: 'New product name',
    });
  });
  it('rejects blank names and a rename without a source version', () => {
    expect(() => productRenameBody(legacy, '  ')).toThrow('Enter a product name');
    expect(() => productRenameBody({ ...legacy, updatedAt: undefined }, 'New')).toThrow('Refresh');
  });
  it('still validates pricing when the operator changes a price or stock tracking setting', () => {
    const initial = productForm(legacy);
    expect(() => productBody({ ...initial, defaultSellingPrice: '20' }, initial, true)).toThrow(
      'purchase price',
    );
    const service = productForm({ ...legacy, productType: 'SERVICE', trackInventory: false });
    expect(() =>
      productBody({ ...service, productType: 'STOCK_ITEM', trackInventory: true }, service, true),
    ).toThrow('purchase price');
  });
  it('does not clamp over-reserved availability and keeps reserved stock separate', () => {
    const record = {
      ...legacy,
      availableQuantity: '-3.5',
      inventoryBalance: { quantityOnHand: '2.5', quantityReserved: '6' },
    };
    expect(productStock(record)).toEqual({ onHand: 2.5, reserved: 6, available: -3.5 });
    expect(productStockStatus(record, 'branch')).toBe('Over-reserved');
  });
  it('distinguishes unknown stock, zero stock, and a missing branch selection', () => {
    expect(productStock(legacy)).toEqual({ onHand: null, reserved: null, available: null });
    expect(productStockStatus(legacy, 'branch')).toBe('Stock unavailable');
    expect(
      productStockStatus(
        { ...legacy, availableQuantity: 0, inventoryBalance: { quantityOnHand: 0 } },
        'branch',
      ),
    ).toBe('Out of stock');
    expect(productStockStatus({ ...legacy, availableQuantity: 0 }, '')).toBe('Choose a branch');
  });
  it('reports negative on-hand and uses the configured minimum when reorder level is absent', () => {
    expect(
      productStockStatus(
        { ...legacy, availableQuantity: -1, inventoryBalance: { quantityOnHand: -1 } },
        'branch',
      ),
    ).toBe('Negative on hand');
    expect(
      productStockStatus({ ...legacy, availableQuantity: 2, minimumStockLevel: 3 }, 'branch'),
    ).toBe('Low stock');
  });
  it('distinguishes fully reserved stock from zero on-hand and uses the same fallback as live stock', () => {
    expect(
      productStockStatus(
        {
          ...legacy,
          availableQuantity: 0,
          inventoryBalance: { quantityOnHand: 4, quantityReserved: 4 },
        },
        'branch',
      ),
    ).toBe('Fully reserved');
    expect(
      productStockStatus(
        { ...legacy, availableQuantity: 0, inventoryBalance: { quantityOnHand: 4 } },
        'branch',
      ),
    ).toBe('No available stock');
    expect(productStockStatus({ ...legacy, availableQuantity: 3, reorderLevel: 0 }, 'branch')).toBe(
      'Low stock',
    );
  });
});
