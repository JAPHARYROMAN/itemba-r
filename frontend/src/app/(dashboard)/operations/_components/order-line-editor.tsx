'use client';

import { useMemo, useState } from 'react';
import { Btn } from '@/components/ui';

export interface OrderProductOption {
  id: string;
  name: string;
  productCode?: string | null;
  sku?: string | null;
  barcode?: string | null;
  baseUnitId?: string | null;
  baseUnit?: { name?: string | null; symbol?: string | null } | null;
  category?: { name?: string | null } | null;
  defaultPurchasePrice?: number | string | null;
  defaultSellingPrice?: number | string | null;
  wholesalePrice?: number | string | null;
  retailPrice?: number | string | null;
}

export interface OrderUnitOption {
  id: string;
  name: string;
  symbol: string;
}

export interface OrderLocationOption {
  id: string;
  name: string;
  locationCode: string;
}

export interface EditableOrderLine {
  productId: string;
  description: string;
  qty: number;
  unitId: string;
  unitPrice: number;
  discount: number;
  tax: number;
  inventoryLocationId: string;
  batchNumber?: string;
  expiryDate?: string;
  batchId?: string;
}

type OrderVariant = 'purchase' | 'sales';

interface OrderLineEditorProps<TLine extends EditableOrderLine> {
  variant: OrderVariant;
  lines: TLine[];
  products: OrderProductOption[];
  units: OrderUnitOption[];
  locations: OrderLocationOption[];
  currency: string;
  requireLocation?: boolean;
  onAddLine: () => void;
  onRemoveLine: (index: number) => void;
  onLineChange: (index: number, patch: Partial<TLine>) => void;
}

const fieldClass =
  'aurora-input w-full rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-500';

function money(value: number, currency: string) {
  return `${currency} ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`;
}

function numberOrZero(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function productLabel(product: OrderProductOption) {
  const code = product.productCode || product.sku || product.barcode;
  return code ? `${code} - ${product.name}` : product.name;
}

function productMatches(product: OrderProductOption, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    product.name,
    product.productCode,
    product.sku,
    product.barcode,
    product.category?.name,
    product.baseUnit?.symbol,
    product.baseUnit?.name,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q));
}

function defaultPriceForProduct(product: OrderProductOption, variant: OrderVariant) {
  if (variant === 'purchase') {
    return numberOrZero(product.defaultPurchasePrice ?? product.defaultSellingPrice);
  }
  return numberOrZero(product.defaultSellingPrice ?? product.retailPrice ?? product.wholesalePrice);
}

function lineTotal(line: EditableOrderLine) {
  const subtotal = numberOrZero(line.qty) * numberOrZero(line.unitPrice);
  return subtotal - numberOrZero(line.discount) + numberOrZero(line.tax);
}

function missingFields(line: EditableOrderLine, requireLocation: boolean) {
  const missing: string[] = [];
  if (!line.productId) missing.push('product');
  if (!line.unitId) missing.push('unit');
  if (requireLocation && !line.inventoryLocationId) missing.push('location');
  if (numberOrZero(line.qty) <= 0) missing.push('quantity');
  return missing;
}

export function OrderLineEditor<TLine extends EditableOrderLine>({
  variant,
  lines,
  products,
  units,
  locations,
  currency,
  requireLocation = true,
  onAddLine,
  onRemoveLine,
  onLineChange,
}: OrderLineEditorProps<TLine>) {
  const [productSearch, setProductSearch] = useState<Record<number, string>>({});
  const totals = useMemo(
    () =>
      lines.reduce(
        (acc, line) => {
          const subtotal = numberOrZero(line.qty) * numberOrZero(line.unitPrice);
          return {
            subtotal: acc.subtotal + subtotal,
            discount: acc.discount + numberOrZero(line.discount),
            tax: acc.tax + numberOrZero(line.tax),
          };
        },
        { subtotal: 0, discount: 0, tax: 0 },
      ),
    [lines],
  );
  const total = totals.subtotal - totals.discount + totals.tax;
  const invalidCount = lines.filter(
    (line) => missingFields(line, requireLocation).length > 0,
  ).length;
  const unitPriceLabel = variant === 'purchase' ? 'Unit Cost' : 'Unit Price';

  function patchLine(index: number, patch: Partial<EditableOrderLine>) {
    onLineChange(index, patch as Partial<TLine>);
  }

  function handleProductSelect(index: number, productId: string) {
    const line = lines[index];
    const product = products.find((item) => item.id === productId);
    const patch: Partial<EditableOrderLine> = { productId };

    if (product) {
      if (!line.description.trim()) patch.description = product.name;
      if (product.baseUnitId && !line.unitId) patch.unitId = product.baseUnitId;
      const defaultPrice = defaultPriceForProduct(product, variant);
      if (defaultPrice > 0 && numberOrZero(line.unitPrice) === 0) patch.unitPrice = defaultPrice;
      if (requireLocation && locations.length === 1 && !line.inventoryLocationId) {
        patch.inventoryLocationId = locations[0].id;
      }
    }

    patchLine(index, patch);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Line Items
          </h4>
          <p className="text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
            {lines.length} line{lines.length === 1 ? '' : 's'}
            {invalidCount ? `, ${invalidCount} incomplete` : ', ready'}
          </p>
        </div>
        <Btn variant="secondary" size="xs" onClick={onAddLine}>
          + Add Line
        </Btn>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-3">
          {lines.map((line, index) => {
            const selectedProduct = products.find((product) => product.id === line.productId);
            const query = productSearch[index] ?? '';
            const filteredProducts = products.filter((product) => productMatches(product, query));
            const productOptions =
              selectedProduct &&
              !filteredProducts.some((product) => product.id === selectedProduct.id)
                ? [selectedProduct, ...filteredProducts]
                : filteredProducts;
            const missing = missingFields(line, requireLocation);

            return (
              <div
                key={index}
                className="rounded-lg border p-3"
                style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg)' }}
              >
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p
                      className="text-[13px] font-semibold leading-snug"
                      style={{ color: 'var(--aurora-text)' }}
                    >
                      Line {index + 1}
                      {selectedProduct ? ` - ${productLabel(selectedProduct)}` : ''}
                    </p>
                    <p className="text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
                      {missing.length ? `Needs ${missing.join(', ')}` : 'Complete'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-lg border px-3 py-1.5 text-[13px] font-semibold tabular-nums"
                      style={{
                        borderColor: 'var(--aurora-border)',
                        color: 'var(--aurora-text)',
                        background: 'var(--aurora-card)',
                      }}
                    >
                      {money(lineTotal(line), currency)}
                    </span>
                    {lines.length > 1 && (
                      <Btn variant="ghost" size="xs" onClick={() => onRemoveLine(index)}>
                        Remove
                      </Btn>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                  <div className="space-y-2">
                    <label className="block">
                      <span
                        className="mb-1 block text-[12px] font-medium"
                        style={{ color: 'var(--aurora-text-secondary)' }}
                      >
                        Find Product
                      </span>
                      <input
                        value={query}
                        onChange={(event) =>
                          setProductSearch((current) => ({
                            ...current,
                            [index]: event.target.value,
                          }))
                        }
                        className={fieldClass}
                        placeholder="Search name, code, SKU, barcode"
                      />
                    </label>
                    <label className="block">
                      <span
                        className="mb-1 block text-[12px] font-medium"
                        style={{ color: 'var(--aurora-text-secondary)' }}
                      >
                        Product *
                      </span>
                      <select
                        value={line.productId}
                        onChange={(event) => handleProductSelect(index, event.target.value)}
                        className={fieldClass}
                        disabled={!products.length}
                      >
                        <option value="">
                          {products.length ? 'Select product' : 'No products loaded'}
                        </option>
                        {productOptions.map((product) => (
                          <option key={product.id} value={product.id}>
                            {productLabel(product)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedProduct && (
                      <div
                        className="grid grid-cols-2 gap-2 rounded-lg border px-3 py-2 text-[12px]"
                        style={{
                          borderColor: 'var(--aurora-border)',
                          background: 'var(--aurora-card)',
                          color: 'var(--aurora-text-muted)',
                        }}
                      >
                        <span>
                          Code: {selectedProduct.productCode ?? selectedProduct.sku ?? '-'}
                        </span>
                        <span>Category: {selectedProduct.category?.name ?? '-'}</span>
                        <span>
                          Unit:{' '}
                          {selectedProduct.baseUnit?.symbol ??
                            selectedProduct.baseUnit?.name ??
                            '-'}
                        </span>
                        <span>
                          Default:{' '}
                          {defaultPriceForProduct(selectedProduct, variant)
                            ? money(defaultPriceForProduct(selectedProduct, variant), currency)
                            : '-'}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="col-span-2 block">
                      <span
                        className="mb-1 block text-[12px] font-medium"
                        style={{ color: 'var(--aurora-text-secondary)' }}
                      >
                        Description
                      </span>
                      <input
                        value={line.description}
                        onChange={(event) => patchLine(index, { description: event.target.value })}
                        className={fieldClass}
                      />
                    </label>
                    <label className="block">
                      <span
                        className="mb-1 block text-[12px] font-medium"
                        style={{ color: 'var(--aurora-text-secondary)' }}
                      >
                        Qty *
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={line.qty}
                        onChange={(event) => patchLine(index, { qty: Number(event.target.value) })}
                        className={fieldClass}
                      />
                    </label>
                    <label className="block">
                      <span
                        className="mb-1 block text-[12px] font-medium"
                        style={{ color: 'var(--aurora-text-secondary)' }}
                      >
                        Unit *
                      </span>
                      <select
                        value={line.unitId}
                        onChange={(event) => patchLine(index, { unitId: event.target.value })}
                        className={fieldClass}
                      >
                        <option value="">Select unit</option>
                        {units.map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {unit.symbol} - {unit.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span
                        className="mb-1 block text-[12px] font-medium"
                        style={{ color: 'var(--aurora-text-secondary)' }}
                      >
                        {unitPriceLabel} *
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={line.unitPrice}
                        onChange={(event) =>
                          patchLine(index, { unitPrice: Number(event.target.value) })
                        }
                        className={fieldClass}
                      />
                    </label>
                    {requireLocation && (
                      <label className="block">
                        <span
                          className="mb-1 block text-[12px] font-medium"
                          style={{ color: 'var(--aurora-text-secondary)' }}
                        >
                          Location *
                        </span>
                        <select
                          value={line.inventoryLocationId}
                          onChange={(event) =>
                            patchLine(index, { inventoryLocationId: event.target.value })
                          }
                          className={fieldClass}
                        >
                          <option value="">
                            {locations.length ? 'Select location' : 'No locations loaded'}
                          </option>
                          {locations.map((location) => (
                            <option key={location.id} value={location.id}>
                              {location.locationCode} - {location.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="block">
                      <span
                        className="mb-1 block text-[12px] font-medium"
                        style={{ color: 'var(--aurora-text-secondary)' }}
                      >
                        Discount
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.discount}
                        onChange={(event) =>
                          patchLine(index, { discount: Number(event.target.value) })
                        }
                        className={fieldClass}
                      />
                    </label>
                    <label className="block">
                      <span
                        className="mb-1 block text-[12px] font-medium"
                        style={{ color: 'var(--aurora-text-secondary)' }}
                      >
                        Tax
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.tax}
                        onChange={(event) => patchLine(index, { tax: Number(event.target.value) })}
                        className={fieldClass}
                      />
                    </label>
                    {variant === 'purchase' ? (
                      <>
                        <label className="block">
                          <span
                            className="mb-1 block text-[12px] font-medium"
                            style={{ color: 'var(--aurora-text-secondary)' }}
                          >
                            Batch
                          </span>
                          <input
                            value={line.batchNumber ?? ''}
                            onChange={(event) =>
                              patchLine(index, { batchNumber: event.target.value })
                            }
                            className={fieldClass}
                          />
                        </label>
                        <label className="block">
                          <span
                            className="mb-1 block text-[12px] font-medium"
                            style={{ color: 'var(--aurora-text-secondary)' }}
                          >
                            Expiry
                          </span>
                          <input
                            type="date"
                            value={line.expiryDate ?? ''}
                            onChange={(event) =>
                              patchLine(index, { expiryDate: event.target.value })
                            }
                            className={fieldClass}
                          />
                        </label>
                      </>
                    ) : (
                      <label className="col-span-2 block">
                        <span
                          className="mb-1 block text-[12px] font-medium"
                          style={{ color: 'var(--aurora-text-secondary)' }}
                        >
                          Batch ID
                        </span>
                        <input
                          value={line.batchId ?? ''}
                          onChange={(event) => patchLine(index, { batchId: event.target.value })}
                          className={fieldClass}
                        />
                      </label>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <aside
          className="h-fit rounded-lg border p-4 lg:sticky lg:top-0"
          style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)' }}
        >
          <p className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Totals
          </p>
          <div className="space-y-2 text-[13px]">
            <div className="flex justify-between gap-4">
              <span style={{ color: 'var(--aurora-text-muted)' }}>Subtotal</span>
              <span className="font-medium tabular-nums" style={{ color: 'var(--aurora-text)' }}>
                {money(totals.subtotal, currency)}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span style={{ color: 'var(--aurora-text-muted)' }}>Discount</span>
              <span className="font-medium tabular-nums text-red-600">
                -{money(totals.discount, currency)}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span style={{ color: 'var(--aurora-text-muted)' }}>Tax</span>
              <span className="font-medium tabular-nums" style={{ color: 'var(--aurora-text)' }}>
                +{money(totals.tax, currency)}
              </span>
            </div>
            <div
              className="mt-3 flex justify-between gap-4 border-t pt-3 text-[15px] font-semibold"
              style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
            >
              <span>Total</span>
              <span className="tabular-nums">{money(total, currency)}</span>
            </div>
          </div>
          {invalidCount > 0 && (
            <div
              className="mt-4 rounded-lg border px-3 py-2 text-[12px]"
              style={{
                borderColor: 'var(--aurora-warning)',
                color: 'var(--aurora-text)',
                background: 'var(--aurora-bg-subtle)',
              }}
            >
              Complete every product, unit, location, and quantity before saving.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
