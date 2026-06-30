'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Btn } from '@/components/ui';

export interface OrderProductOption {
  id: string;
  name: string;
  productCode?: string | null;
  sku?: string | null;
  barcode?: string | null;
  baseUnitId?: string | null;
  baseUnit?: { name?: string | null; symbol?: string | null } | null;
  category?: {
    id?: string | null;
    name?: string | null;
    supplierLinks?: Array<{
      supplier?: {
        name?: string | null;
        legalName?: string | null;
        supplierCode?: string | null;
      } | null;
    }>;
  } | null;
  productFamily?: { name?: string | null; brand?: string | null } | null;
  defaultPurchasePrice?: number | string | null;
  defaultSellingPrice?: number | string | null;
  wholesalePrice?: number | string | null;
  retailPrice?: number | string | null;
  effectiveSellingPrice?: number | string | null;
  effectiveWholesalePrice?: number | string | null;
  effectiveRetailPrice?: number | string | null;
  priceSource?: string | null;
  productType?: string | null;
  trackInventory?: boolean | null;
  sellingPrice?: number | string | null;
  availableStock?: number | string | null;
  availableQuantity?: number | string | null;
  quantityAvailable?: number | string | null;
  inventoryBalance?: {
    quantityOnHand?: number | string | null;
    quantityReserved?: number | string | null;
    averageCost?: number | string | null;
    availableQuantity?: number | string | null;
    quantityAvailable?: number | string | null;
  } | null;
}

export interface OrderUnitOption {
  id: string;
  name: string;
  symbol: string;
}

export interface OrderProductCategoryOption {
  id: string;
  name: string;
  categoryType?: string | null;
  parentCategory?: { name?: string | null } | null;
}

export interface EditableOrderLine {
  productId: string;
  description: string;
  qty: number;
  unitId: string;
  unitPrice: number;
  discount: number;
  tax: number;
  batchNumber?: string;
  expiryDate?: string;
  batchId?: string;
}

type OrderVariant = 'purchase' | 'sales';

export interface OrderLineValidationState {
  hasBlockingErrors: boolean;
  stockWarnings: string[];
  profitWarnings?: string[];
}

interface OrderLineEditorProps<TLine extends EditableOrderLine> {
  variant: OrderVariant;
  lines: TLine[];
  products: OrderProductOption[];
  categories?: OrderProductCategoryOption[];
  units: OrderUnitOption[];
  currency: string;
  productSearchLoading?: boolean;
  enforceStockAvailability?: boolean;
  onAddLine: () => void;
  onRemoveLine: (index: number) => void;
  onLineChange: (index: number, patch: Partial<TLine>) => void;
  onProductSearch?: (query: string, filters?: { categoryId?: string }) => void;
  onValidationChange?: (state: OrderLineValidationState) => void;
}

const fieldClass =
  'aurora-input w-full rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-500';

function money(value: number, currency: string) {
  return `${currency} ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`;
}

function quantity(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value);
}

function numberOrZero(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Round to 2 decimal places so each line's contribution matches the persisted
// (already-rounded) money value; composing the footer from rounded lines keeps
// the displayed Total equal to the sum the backend stores.
function roundMoney(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// Parse a free-text numeric input. Returns null when the value is blank, NaN,
// negative, or non-finite so callers can reject it; otherwise the finite >= 0
// number. Used to harden the qty/price/discount/tax fields.
function parseNonNegativeNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function productLabel(product: OrderProductOption) {
  const code = product.productCode || product.sku || product.barcode;
  return code ? `${code} - ${product.name}` : product.name;
}

function productMatches(product: OrderProductOption, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const supplierTerms = productSupplierTerms(product);
  return [
    product.name,
    product.productCode,
    product.sku,
    product.barcode,
    product.category?.name,
    product.productFamily?.name,
    product.productFamily?.brand,
    product.baseUnit?.symbol,
    product.baseUnit?.name,
    ...supplierTerms,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q));
}

function productSupplierTerms(product: OrderProductOption) {
  return (
    product.category?.supplierLinks?.flatMap((link) => [
      link.supplier?.name,
      link.supplier?.legalName,
      link.supplier?.supplierCode,
    ]) ?? []
  ).filter(Boolean);
}

function productSupplierLabel(product: OrderProductOption) {
  const names = Array.from(new Set(productSupplierTerms(product).map(String)));
  if (!names.length) return '';
  return names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '');
}

function productMatchesCategory(product: OrderProductOption, categoryId: string) {
  if (!categoryId) return true;
  return product.category?.id === categoryId;
}

function defaultPriceForProduct(product: OrderProductOption, variant: OrderVariant) {
  if (variant === 'purchase') {
    return numberOrZero(product.defaultPurchasePrice ?? product.defaultSellingPrice);
  }
  return numberOrZero(
    product.effectiveSellingPrice ??
      product.sellingPrice ??
      product.defaultSellingPrice ??
      product.effectiveRetailPrice ??
      product.retailPrice ??
      product.effectiveWholesalePrice ??
      product.wholesalePrice,
  );
}

function productAvailableStock(product: OrderProductOption | undefined) {
  if (!product) return null;
  const value =
    product.availableStock ??
    product.availableQuantity ??
    product.quantityAvailable ??
    product.inventoryBalance?.availableQuantity ??
    product.inventoryBalance?.quantityAvailable;
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function productTracksInventory(product: OrderProductOption | undefined) {
  if (!product) return false;
  if (product.trackInventory === false) return false;
  return !['SERVICE', 'NON_STOCK_ITEM'].includes(String(product.productType ?? '').toUpperCase());
}

function effectiveCostForProduct(product: OrderProductOption | undefined) {
  if (!product || !productTracksInventory(product)) return null;
  const averageCost = numberOrZero(product.inventoryBalance?.averageCost);
  if (averageCost > 0) return averageCost;
  const purchaseCost = numberOrZero(product.defaultPurchasePrice);
  return purchaseCost > 0 ? purchaseCost : null;
}

function netUnitSalePrice(line: EditableOrderLine) {
  const qty = numberOrZero(line.qty);
  if (qty <= 0) return null;
  return numberOrZero(line.unitPrice) - numberOrZero(line.discount);
}

function availableAfterLocalAllocation(
  product: OrderProductOption | undefined,
  allocatedByProductId: Map<string, number>,
) {
  const available = productAvailableStock(product);
  if (available == null || !product) return null;
  return available - (allocatedByProductId.get(product.id) ?? 0);
}

function productSelectLabel(
  product: OrderProductOption,
  variant: OrderVariant,
  currency: string,
  allocatedByProductId: Map<string, number>,
) {
  const pieces = [productLabel(product)];
  if (product.category?.name) pieces.push(product.category.name);
  if (product.productFamily?.name) {
    pieces.push(
      `Family: ${
        product.productFamily.brand
          ? `${product.productFamily.brand} ${product.productFamily.name}`
          : product.productFamily.name
      }`,
    );
  }
  const unit = product.baseUnit?.symbol ?? product.baseUnit?.name;
  if (unit) pieces.push(unit);
  const price = defaultPriceForProduct(product, variant);
  if (price > 0) pieces.push(money(price, currency));
  const available = availableAfterLocalAllocation(product, allocatedByProductId);
  if (available != null && productTracksInventory(product)) {
    pieces.push(`Available: ${quantity(Math.max(0, available))}`);
  }
  return pieces.join(' | ');
}

export function mergeOrderProductOptions<TProduct extends OrderProductOption>(
  incoming: TProduct[],
  current: TProduct[],
  selectedProductIds: string[],
) {
  const selected = new Set(selectedProductIds.filter(Boolean));
  const byId = new Map<string, TProduct>();

  for (const product of incoming) byId.set(product.id, product);
  for (const product of current) {
    if (selected.has(product.id) && !byId.has(product.id)) byId.set(product.id, product);
  }

  return Array.from(byId.values());
}

// Discount field semantics differ by order variant:
//   - sales: `line.discount` is a PER-UNIT amount, so the line discount is
//     qty x discount.
//   - purchase: `line.discount` is a FLAT amount applied once to the whole line.
function lineDiscountTotal(line: EditableOrderLine, variant: OrderVariant) {
  const discount = numberOrZero(line.discount);
  if (variant === 'sales') return roundMoney(numberOrZero(line.qty) * discount);
  return roundMoney(discount);
}

function lineTotal(line: EditableOrderLine, variant: OrderVariant) {
  const subtotal = roundMoney(numberOrZero(line.qty) * numberOrZero(line.unitPrice));
  return roundMoney(subtotal - lineDiscountTotal(line, variant) + roundMoney(numberOrZero(line.tax)));
}

function missingFields(line: EditableOrderLine) {
  const missing: string[] = [];
  if (!line.productId) missing.push('product');
  if (!line.unitId) missing.push('unit');
  if (numberOrZero(line.qty) <= 0) missing.push('quantity');
  return missing;
}

export function OrderLineEditor<TLine extends EditableOrderLine>({
  variant,
  lines,
  products,
  categories = [],
  units,
  currency,
  productSearchLoading = false,
  enforceStockAvailability = false,
  onAddLine,
  onRemoveLine,
  onLineChange,
  onProductSearch,
  onValidationChange,
}: OrderLineEditorProps<TLine>) {
  const [productSearch, setProductSearch] = useState<Record<number, string>>({});
  const [productCategoryFilter, setProductCategoryFilter] = useState<Record<number, string>>({});
  // String-backed drafts for the numeric line fields (qty/unitPrice/discount/
  // tax). Inputs are uncontrolled-by-value while the user is mid-edit so partial
  // entries ("", "1.") are preserved; we only commit finite >= 0 numbers to the
  // line. Keyed by `${index}:${field}`.
  type NumericField = 'qty' | 'unitPrice' | 'discount' | 'tax';
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({});
  // Debounce timer for the typed product search so each keystroke does not
  // trigger a fetch (~300ms after the user stops typing).
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    },
    [],
  );
  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const categoryOptions = useMemo(() => {
    const byId = new Map<string, OrderProductCategoryOption>();
    for (const category of categories) {
      if (category.id) byId.set(category.id, category);
    }
    for (const product of products) {
      const category = product.category;
      if (category?.id && !byId.has(category.id)) {
        byId.set(category.id, { id: category.id, name: category.name ?? 'Unnamed category' });
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [categories, products]);
  const allocatedByProductId = useMemo(() => {
    const allocated = new Map<string, number>();
    for (const line of lines) {
      if (!line.productId) continue;
      allocated.set(line.productId, (allocated.get(line.productId) ?? 0) + numberOrZero(line.qty));
    }
    return allocated;
  }, [lines]);
  // Memoize the filtered product list per line so each line only recomputes
  // when its own search query / category filter (or the product catalog) change,
  // rather than on every keystroke in an unrelated line.
  const filteredProductsByLine = useMemo(() => {
    const byIndex: Record<number, OrderProductOption[]> = {};
    for (let index = 0; index < lines.length; index += 1) {
      const query = productSearch[index] ?? '';
      const selectedCategoryId = productCategoryFilter[index] ?? '';
      byIndex[index] = products.filter(
        (product) =>
          productMatchesCategory(product, selectedCategoryId) && productMatches(product, query),
      );
    }
    return byIndex;
  }, [lines.length, products, productSearch, productCategoryFilter]);
  const stockWarnings = useMemo(() => {
    if (!enforceStockAvailability || variant !== 'sales') return [];
    const warnings: string[] = [];
    for (const [productId, allocated] of allocatedByProductId) {
      const product = productById.get(productId);
      if (!product || !productTracksInventory(product)) continue;
      const available = productAvailableStock(product);
      if (available == null) continue;
      if (allocated > available) {
        warnings.push(
          `${productLabel(product)} only has ${quantity(available)} available; this order uses ${quantity(allocated)}.`,
        );
      }
    }
    return warnings;
  }, [allocatedByProductId, enforceStockAvailability, productById, variant]);
  const profitWarnings = useMemo(() => {
    if (variant !== 'sales') return [];
    const warnings: string[] = [];
    for (const [index, line] of lines.entries()) {
      if (numberOrZero(line.discount) > numberOrZero(line.unitPrice)) {
        warnings.push(`Line ${index + 1} discount per unit cannot exceed the unit price.`);
        continue;
      }
      const product = productById.get(line.productId);
      if (!product || !productTracksInventory(product)) continue;
      const cost = effectiveCostForProduct(product);
      if (cost == null) {
        warnings.push(`${productLabel(product)} is missing purchase/average cost and cannot be sold.`);
        continue;
      }
      const netUnitPrice = netUnitSalePrice(line);
      if (netUnitPrice != null && netUnitPrice <= cost) {
        warnings.push(
          `${productLabel(product)} net unit price ${money(netUnitPrice, currency)} must be greater than cost ${money(cost, currency)}.`,
        );
      }
    }
    return warnings;
  }, [currency, lines, productById, variant]);
  const validationState = useMemo<OrderLineValidationState>(
    () => ({
      hasBlockingErrors: stockWarnings.length > 0 || profitWarnings.length > 0,
      stockWarnings,
      profitWarnings,
    }),
    [profitWarnings, stockWarnings],
  );
  const totals = useMemo(
    () =>
      lines.reduce(
        (acc, line) => {
          // Round each line's contribution before summing so the footer equals
          // the persisted (per-line rounded) sum.
          const subtotal = roundMoney(numberOrZero(line.qty) * numberOrZero(line.unitPrice));
          return {
            subtotal: roundMoney(acc.subtotal + subtotal),
            discount: roundMoney(acc.discount + lineDiscountTotal(line, variant)),
            tax: roundMoney(acc.tax + roundMoney(numberOrZero(line.tax))),
          };
        },
        { subtotal: 0, discount: 0, tax: 0 },
      ),
    [lines, variant],
  );
  const total = roundMoney(totals.subtotal - totals.discount + totals.tax);
  const invalidCount = lines.filter((line) => missingFields(line).length > 0).length;
  const stockWarningCount = stockWarnings.length;
  const profitWarningCount = profitWarnings.length;
  const unitPriceLabel = variant === 'purchase' ? 'Unit Cost' : 'Unit Price';

  useEffect(() => {
    onValidationChange?.(validationState);
  }, [onValidationChange, validationState]);

  useEffect(() => {
    const validCategoryIds = new Set(categoryOptions.map((category) => category.id));
    setProductCategoryFilter((current) => {
      let changed = false;
      const next: Record<number, string> = {};
      for (const [index, categoryId] of Object.entries(current)) {
        if (!categoryId || validCategoryIds.has(categoryId)) {
          next[Number(index)] = categoryId;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [categoryOptions]);

  function patchLine(index: number, patch: Partial<EditableOrderLine>) {
    onLineChange(index, patch as Partial<TLine>);
  }

  function numericFieldValue(index: number, field: NumericField, committed: number) {
    const draft = numberDrafts[`${index}:${field}`];
    return draft ?? String(committed);
  }

  function handleNumericChange(index: number, field: NumericField, raw: string) {
    setNumberDrafts((current) => ({ ...current, [`${index}:${field}`]: raw }));
    // Commit only finite, non-negative parses; reject NaN/negatives so the
    // line never holds an invalid number while still letting the field show the
    // in-progress text.
    const parsed = parseNonNegativeNumber(raw);
    if (parsed != null) patchLine(index, { [field]: parsed });
  }

  function handleNumericBlur(index: number, field: NumericField, committed: number) {
    // On blur, normalize the visible text back to the committed numeric value
    // (drops invalid/blank drafts so the input reflects what was actually saved).
    setNumberDrafts((current) => {
      const next = { ...current };
      delete next[`${index}:${field}`];
      return next;
    });
    void committed;
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
    }

    patchLine(index, patch);
  }

  function handleProductSearch(index: number, value: string) {
    setProductSearch((current) => ({
      ...current,
      [index]: value,
    }));
    if (!onProductSearch) return;
    const categoryId = productCategoryFilter[index] ?? '';
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      onProductSearch(value, { categoryId: categoryId || undefined });
    }, 300);
  }

  function handleCategoryFilter(index: number, categoryId: string) {
    setProductCategoryFilter((current) => ({
      ...current,
      [index]: categoryId,
    }));
    // A category change is an explicit selection, not a keystroke: fetch
    // immediately and cancel any pending debounced search.
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    onProductSearch?.(productSearch[index] ?? '', {
      categoryId: categoryId || undefined,
    });

    const line = lines[index];
    const selectedProduct = productById.get(line?.productId);
    if (categoryId && selectedProduct && !productMatchesCategory(selectedProduct, categoryId)) {
      patchLine(index, {
        productId: '',
        description: '',
        unitId: '',
        unitPrice: 0,
      });
    }
  }

  function handleProductPick(index: number, productId: string) {
    handleProductSelect(index, productId);
    setProductSearch((current) => ({
      ...current,
      [index]: '',
    }));
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const categoryId = productCategoryFilter[index] ?? '';
    onProductSearch?.('', { categoryId: categoryId || undefined });
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
            {stockWarningCount
              ? `, ${stockWarningCount} stock warning${stockWarningCount === 1 ? '' : 's'}`
              : profitWarningCount
                ? `, ${profitWarningCount} profit warning${profitWarningCount === 1 ? '' : 's'}`
              : invalidCount
                ? `, ${invalidCount} incomplete`
                : ', ready'}
          </p>
        </div>
        <Btn variant="secondary" size="xs" onClick={onAddLine}>
          + Add Line
        </Btn>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-3">
          {lines.map((line, index) => {
            const selectedProduct = productById.get(line.productId);
            const query = productSearch[index] ?? '';
            const trimmedQuery = query.trim();
            const selectedCategoryId = productCategoryFilter[index] ?? '';
            const filteredProducts = filteredProductsByLine[index] ?? [];
            const productOptions =
              selectedProduct &&
              productMatchesCategory(selectedProduct, selectedCategoryId) &&
              !filteredProducts.some((product) => product.id === selectedProduct.id)
                ? [selectedProduct, ...filteredProducts]
                : filteredProducts;
            const searchResults = trimmedQuery ? filteredProducts.slice(0, 8) : [];
            const missing = missingFields(line);
            const lineTracksStock =
              enforceStockAvailability &&
              variant === 'sales' &&
              productTracksInventory(selectedProduct);
            const selectedAvailable = productAvailableStock(selectedProduct);
            const productAllocated = selectedProduct
              ? (allocatedByProductId.get(selectedProduct.id) ?? 0)
              : 0;
            const remainingAfterSale =
              selectedAvailable == null ? null : selectedAvailable - productAllocated;
            const lineHasStockError =
              lineTracksStock && selectedAvailable != null && productAllocated > selectedAvailable;
            const effectiveCost = effectiveCostForProduct(selectedProduct);
            const netUnitPrice = netUnitSalePrice(line);
            const lineHasProfitError =
              variant === 'sales' &&
              productTracksInventory(selectedProduct) &&
              (effectiveCost == null ||
                (netUnitPrice != null && netUnitPrice <= effectiveCost));
            const marginPreview =
              variant === 'sales' &&
              effectiveCost != null &&
              netUnitPrice != null &&
              netUnitPrice > 0
                ? ((netUnitPrice - effectiveCost) / netUnitPrice) * 100
                : null;

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
                      {lineHasStockError
                        ? 'Insufficient stock'
                        : lineHasProfitError
                          ? 'Below cost'
                        : missing.length
                          ? `Needs ${missing.join(', ')}`
                          : 'Complete'}
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
                      {money(lineTotal(line, variant), currency)}
                    </span>
                    {lines.length > 1 && (
                      <Btn
                        variant="ghost"
                        size="xs"
                        onClick={() => onRemoveLine(index)}
                        aria-label={`Remove line ${index + 1}`}
                      >
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
                        Category
                      </span>
                      <select
                        value={selectedCategoryId}
                        onChange={(event) => handleCategoryFilter(index, event.target.value)}
                        className={fieldClass}
                        aria-label={`Line ${index + 1} category filter`}
                      >
                        <option value="">All categories</option>
                        {categoryOptions.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.parentCategory?.name
                              ? `${category.parentCategory.name} / ${category.name}`
                              : category.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span
                        className="mb-1 block text-[12px] font-medium"
                        style={{ color: 'var(--aurora-text-secondary)' }}
                      >
                        Find Product
                      </span>
                      <input
                        value={query}
                        onChange={(event) => handleProductSearch(index, event.target.value)}
                        className={fieldClass}
                        placeholder="Search name, category, family, supplier, code, SKU, barcode"
                        aria-label={`Line ${index + 1} find product`}
                      />
                    </label>
                    {trimmedQuery && (
                      <div
                        className="max-h-56 overflow-y-auto rounded-lg border"
                        style={{
                          borderColor: 'var(--aurora-border)',
                          background: 'var(--aurora-card)',
                        }}
                        role="group"
                        aria-label={`Line ${index + 1} product search results`}
                      >
                        {productSearchLoading && !searchResults.length ? (
                          <div
                            className="px-3 py-2 text-[12px]"
                            style={{ color: 'var(--aurora-text-muted)' }}
                          >
                            Searching products...
                          </div>
                        ) : searchResults.length ? (
                          searchResults.map((product) => (
                            <button
                              key={product.id}
                              type="button"
                              onClick={() => handleProductPick(index, product.id)}
                              className="block w-full px-3 py-2 text-left text-[13px] transition hover:bg-brand-50 dark:hover:bg-slate-800"
                              style={{ color: 'var(--aurora-text)' }}
                              aria-label={`Select ${productLabel(product)} for line ${index + 1}`}
                            >
                              <span className="block font-medium">{productLabel(product)}</span>
                              <span
                                className="block text-[11px]"
                                style={{ color: 'var(--aurora-text-muted)' }}
                              >
                                {product.category?.name ?? 'Uncategorized'}
                                {product.productFamily?.name
                                  ? ` | Family: ${
                                      product.productFamily.brand
                                        ? `${product.productFamily.brand} ${product.productFamily.name}`
                                        : product.productFamily.name
                                    }`
                                  : ''}
                                {productSupplierLabel(product)
                                  ? ` | Suppliers: ${productSupplierLabel(product)}`
                                  : ''}
                                {product.baseUnit?.symbol
                                  ? ` | Unit: ${product.baseUnit.symbol}`
                                  : ''}
                                {defaultPriceForProduct(product, variant) > 0
                                  ? ` | ${money(defaultPriceForProduct(product, variant), currency)}`
                                  : ''}
                                {productTracksInventory(product) &&
                                availableAfterLocalAllocation(product, allocatedByProductId) != null
                                  ? ` | Available: ${quantity(
                                      Math.max(
                                        0,
                                        availableAfterLocalAllocation(
                                          product,
                                          allocatedByProductId,
                                        ) ?? 0,
                                      ),
                                    )}`
                                  : ''}
                              </span>
                            </button>
                          ))
                        ) : (
                          <div
                            className="px-3 py-2 text-[12px]"
                            style={{ color: 'var(--aurora-text-muted)' }}
                          >
                            No matching products
                          </div>
                        )}
                      </div>
                    )}
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
                        aria-label={`Line ${index + 1} product`}
                      >
                        <option value="">
                          {products.length
                            ? productOptions.length
                              ? 'Select product'
                              : 'No products in selected category'
                            : 'No products loaded'}
                        </option>
                        {productOptions.map((product) => (
                          <option key={product.id} value={product.id}>
                            {productSelectLabel(product, variant, currency, allocatedByProductId)}
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
                          Family:{' '}
                          {selectedProduct.productFamily?.name
                            ? selectedProduct.productFamily.brand
                              ? `${selectedProduct.productFamily.brand} ${selectedProduct.productFamily.name}`
                              : selectedProduct.productFamily.name
                            : '-'}
                        </span>
                        <span>Suppliers: {productSupplierLabel(selectedProduct) || '-'}</span>
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
                        <span>
                          Available stock:{' '}
                          {lineTracksStock ? quantity(selectedAvailable) : 'Not tracked'}
                        </span>
                        <span>
                          Cost:{' '}
                          {lineTracksStock && effectiveCost != null
                            ? money(effectiveCost, currency)
                            : lineTracksStock
                              ? 'Missing'
                              : 'Not tracked'}
                        </span>
                        <span>Quantity entered: {quantity(numberOrZero(line.qty))}</span>
                        <span
                          className={lineHasStockError ? 'text-red-600' : ''}
                          style={lineHasStockError ? undefined : { color: 'var(--aurora-text)' }}
                        >
                          Remaining after sale:{' '}
                          {lineTracksStock ? quantity(remainingAfterSale) : 'Not tracked'}
                        </span>
                        <span
                          className={lineHasProfitError ? 'text-red-600' : ''}
                          style={lineHasProfitError ? undefined : { color: 'var(--aurora-text)' }}
                        >
                          Margin:{' '}
                          {marginPreview == null
                            ? lineTracksStock
                              ? 'Missing'
                              : 'Not tracked'
                            : `${marginPreview.toFixed(2)}%`}
                        </span>
                      </div>
                    )}
                    {lineHasStockError && selectedProduct && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                        {productLabel(selectedProduct)} has {quantity(selectedAvailable)} available,
                        but this order uses {quantity(productAllocated)} across its lines.
                      </div>
                    )}
                    {lineHasProfitError && selectedProduct && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                        {effectiveCost == null
                          ? `${productLabel(selectedProduct)} is missing purchase/average cost and cannot be sold.`
                          : `${productLabel(selectedProduct)} must sell above cost ${money(effectiveCost, currency)}.`}
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
                        aria-label={`Line ${index + 1} description`}
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
                        value={numericFieldValue(index, 'qty', line.qty)}
                        onChange={(event) => handleNumericChange(index, 'qty', event.target.value)}
                        onBlur={() => handleNumericBlur(index, 'qty', line.qty)}
                        className={fieldClass}
                        aria-label={`Line ${index + 1} quantity`}
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
                        aria-label={`Line ${index + 1} unit`}
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
                        value={numericFieldValue(index, 'unitPrice', line.unitPrice)}
                        onChange={(event) =>
                          handleNumericChange(index, 'unitPrice', event.target.value)
                        }
                        onBlur={() => handleNumericBlur(index, 'unitPrice', line.unitPrice)}
                        className={fieldClass}
                        aria-label={`Line ${index + 1} ${unitPriceLabel.toLowerCase()}`}
                      />
                    </label>
                    <label className="block">
                      <span
                        className="mb-1 block text-[12px] font-medium"
                        style={{ color: 'var(--aurora-text-secondary)' }}
                      >
                        {variant === 'sales' ? 'Discount / Unit' : 'Discount'}
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={numericFieldValue(index, 'discount', line.discount)}
                        onChange={(event) =>
                          handleNumericChange(index, 'discount', event.target.value)
                        }
                        onBlur={() => handleNumericBlur(index, 'discount', line.discount)}
                        className={fieldClass}
                        aria-label={
                          variant === 'sales'
                            ? `Line ${index + 1} discount per unit`
                            : `Line ${index + 1} discount`
                        }
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
                        value={numericFieldValue(index, 'tax', line.tax)}
                        onChange={(event) => handleNumericChange(index, 'tax', event.target.value)}
                        onBlur={() => handleNumericBlur(index, 'tax', line.tax)}
                        className={fieldClass}
                        aria-label={`Line ${index + 1} tax`}
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
                            aria-label={`Line ${index + 1} batch`}
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
                            aria-label={`Line ${index + 1} expiry date`}
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
                          aria-label={`Line ${index + 1} batch ID`}
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
              Complete every product, unit, and quantity before saving.
            </div>
          )}
          {stockWarnings.length > 0 && (
            <div className="mt-4 space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
              <p className="font-semibold">Stock availability blocks this sale.</p>
              {stockWarnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
