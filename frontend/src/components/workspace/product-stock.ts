import type { Product } from './product-types';

export const productNumber = (value: number | string | null | undefined) =>
  value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

export function productStock(record: Product) {
  return {
    onHand: productNumber(record.inventoryBalance?.quantityOnHand),
    reserved: productNumber(record.inventoryBalance?.quantityReserved),
    available: productNumber(
      record.availableQuantity ?? record.inventoryBalance?.availableQuantity,
    ),
  };
}

export function productStockStatus(record: Product, branchId: string) {
  if (!record.trackInventory) return 'Not tracked';
  if (!branchId) return 'Choose a branch';
  const { onHand, reserved, available } = productStock(record);
  if (onHand !== null && onHand < 0) return 'Negative on hand';
  if (available === null) return 'Stock unavailable';
  if (available < 0) return 'Over-reserved';
  if (onHand === 0) return 'Out of stock';
  if (available === 0)
    return onHand !== null && onHand > 0 && reserved !== null && reserved > 0
      ? 'Fully reserved'
      : 'No available stock';
  const configured = productNumber(record.reorderLevel) ?? productNumber(record.minimumStockLevel);
  const threshold = configured !== null && configured > 0 ? configured : 10;
  if (available <= threshold) return 'Low stock';
  return 'In stock';
}

/** A metadata rename never re-sends or validates unrelated legacy prices. */
export function productRenameBody(record: Product, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a product name.');
  if (!record.updatedAt) throw new Error('Refresh this product before renaming it.');
  return { name: trimmed, expectedUpdatedAt: record.updatedAt };
}
