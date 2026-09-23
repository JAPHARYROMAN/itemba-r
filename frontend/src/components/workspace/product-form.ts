import type { Product, ProductFamily } from './product-types';
export const PRODUCT_TYPES = ['STOCK_ITEM', 'SERVICE', 'NON_STOCK_ITEM', 'ASSET_RELATED'];
export const PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE', 'DISCONTINUED'];
export const PRODUCT_TEXT_FIELDS = [
  'companyId',
  'divisionId',
  'productCode',
  'sku',
  'barcode',
  'name',
  'categoryId',
  'productFamilyId',
  'productFamilyName',
  'productFamilyBrand',
  'variantName',
  'variantColor',
  'variantSize',
  'variantFinish',
  'productType',
  'baseUnitId',
  'purchaseUnitId',
  'salesUnitId',
  'status',
  'description',
] as const;
export const PRODUCT_NUMBERS = [
  'taxRate',
  'defaultSellingPrice',
  'defaultPurchasePrice',
  'wholesalePrice',
  'retailPrice',
  'minimumStockLevel',
  'maximumStockLevel',
  'reorderLevel',
] as const;
export const PRODUCT_FLAGS = ['isTaxable', 'trackInventory', 'trackBatch', 'trackExpiry'] as const;
export const SELLING_PRICES = ['defaultSellingPrice', 'wholesalePrice', 'retailPrice'] as const;
export type ProductForm = Record<
  (typeof PRODUCT_TEXT_FIELDS)[number] | (typeof PRODUCT_NUMBERS)[number],
  string
> &
  Record<(typeof PRODUCT_FLAGS)[number] | 'useFamilyPrice' | 'createFamilyVariants', boolean>;
export const productLabel = (value: string) =>
  value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (c) => c.toUpperCase());
export const priceSourceLabel = (source?: string | null) =>
  source === 'FAMILY_DEFAULT'
    ? 'Family default'
    : source === 'PRODUCT_OVERRIDE'
      ? 'Product override'
      : 'Missing price';
export function productQuantity(value?: number | string | null) {
  return value == null || value === '' || !Number.isFinite(Number(value))
    ? '—'
    : Number(value).toLocaleString('en-US', { maximumFractionDigits: 4 });
}
export function productForm(record?: Product, companyId = '', divisionId = ''): ProductForm {
  const form = Object.fromEntries(
    [...PRODUCT_TEXT_FIELDS, ...PRODUCT_NUMBERS].map((key) => [
      key,
      key in (record || {}) ? String(record?.[key as keyof Product] ?? '') : '',
    ]),
  ) as Record<(typeof PRODUCT_TEXT_FIELDS)[number] | (typeof PRODUCT_NUMBERS)[number], string>;
  return {
    ...form,
    companyId: record?.companyId || companyId,
    divisionId: record ? record.divisionId || '' : divisionId,
    productType: record?.productType || 'STOCK_ITEM',
    status: record?.status || 'ACTIVE',
    trackInventory: record?.trackInventory ?? true,
    trackBatch: record?.trackBatch ?? false,
    trackExpiry: record?.trackExpiry ?? false,
    isTaxable: record?.isTaxable ?? false,
    useFamilyPrice:
      !!record?.productFamilyId && SELLING_PRICES.every((key) => Number(record[key] || 0) <= 0),
    createFamilyVariants: !record,
  };
}
export function familySelling(
  family?: Pick<ProductFamily, 'defaultSellingPrice' | 'retailPrice' | 'wholesalePrice'> | null,
) {
  return (
    [family?.defaultSellingPrice, family?.retailPrice, family?.wholesalePrice]
      .map(Number)
      .find((value) => Number.isFinite(value) && value > 0) || 0
  );
}
/** Match the existing product API, preserving untouched values and explicit optional clears. */
export function productBody(
  form: ProductForm,
  initial: ProductForm,
  editing: boolean,
  family?: Partial<ProductFamily> | null,
  siblings = 0,
): Record<string, unknown> {
  if (!form.companyId || !form.name.trim() || !form.categoryId || !form.baseUnitId)
    throw new Error('Company, product name, category and base unit are required.');
  if (editing && initial.productCode && !form.productCode.trim())
    throw new Error('Product code cannot be cleared.');
  for (const key of PRODUCT_NUMBERS) {
    if (form[key].trim() && (!Number.isFinite(Number(form[key])) || Number(form[key]) < 0))
      throw new Error(
        `${productLabel(key.replace(/([A-Z])/g, '_$1'))} must be a finite, non-negative amount.`,
      );
  }
  const requiresCost =
    form.trackInventory && !['SERVICE', 'NON_STOCK_ITEM'].includes(form.productType);
  const clearingCost =
    editing &&
    form.defaultPurchasePrice !== initial.defaultPurchasePrice &&
    !form.defaultPurchasePrice.trim();
  const cost = Number(
    form.defaultPurchasePrice || (clearingCost ? 0 : family?.defaultPurchasePrice) || 0,
  );
  if (requiresCost && cost <= 0)
    throw new Error('Stock products must have a purchase price greater than zero.');
  if (form.useFamilyPrice && !form.productFamilyId)
    throw new Error('Select a family before inheriting its prices.');
  const inherits =
    !!form.productFamilyId &&
    (form.useFamilyPrice || SELLING_PRICES.every((key) => Number(form[key]) <= 0));
  if (requiresCost && inherits && familySelling(family) > 0 && familySelling(family) <= cost)
    throw new Error('The inherited family selling price must be greater than purchase price.');
  if (requiresCost && !form.useFamilyPrice)
    for (const key of SELLING_PRICES) {
      const amount = Number(form[key]);
      if (amount > 0 && amount <= cost)
        throw new Error(
          'Selling, wholesale and retail prices must be greater than purchase price.',
        );
    }
  const body: Record<string, unknown> = {};
  for (const key of PRODUCT_TEXT_FIELDS) {
    if (key === 'companyId' || key === 'productFamilyName' || key === 'productFamilyBrand')
      continue;
    if (!editing || form[key] !== initial[key]) {
      const value = form[key].trim();
      if (value || editing) body[key] = value || null;
    }
  }
  for (const key of PRODUCT_FLAGS)
    if (!editing || form[key] !== initial[key]) body[key] = form[key];
  for (const key of PRODUCT_NUMBERS) {
    if (key === 'taxRate' && !form.isTaxable) {
      if (editing && initial.isTaxable !== form.isTaxable) body[key] = null;
      continue;
    }
    if (!editing || form[key] !== initial[key])
      body[key] = form[key].trim() ? Number(form[key]) : null;
  }
  if (form.useFamilyPrice)
    for (const key of SELLING_PRICES) {
      if (!editing || form.useFamilyPrice !== initial.useFamilyPrice || form[key] !== initial[key])
        body[key] = null;
    }
  if (form.productFamilyName.trim()) {
    body.productFamilyName = form.productFamilyName.trim();
    body.productFamilyBrand = form.productFamilyBrand.trim() || undefined;
    delete body.productFamilyId;
  }
  if (!editing) {
    body.companyId = form.companyId;
    if (form.createFamilyVariants && form.productFamilyId && siblings > 0)
      body.createFamilyVariants = true;
  }
  return body;
}
