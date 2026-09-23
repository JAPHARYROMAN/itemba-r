export interface CatalogueCompany {
  id: string;
  name: string;
  code?: string;
}
export interface ProductCategory {
  updatedAt?: string;
  id: string;
  companyId: string;
  name: string;
  categoryType: string;
  isActive: boolean;
  parentCategoryId?: string | null;
  description?: string | null;
  company?: CatalogueCompany | null;
  parentCategory?: { id: string; name: string } | null;
}
export interface ProductFamily {
  updatedAt?: string;
  id: string;
  companyId: string;
  categoryId: string;
  divisionId?: string | null;
  name: string;
  brand?: string | null;
  description?: string | null;
  isActive: boolean;
  defaultPurchasePrice?: number | string | null;
  defaultSellingPrice?: number | string | null;
  wholesalePrice?: number | string | null;
  retailPrice?: number | string | null;
  productCount?: number;
  inheritedPriceCount?: number;
  overridePriceCount?: number;
  missingPriceCount?: number;
  priceExceptionCount?: number;
  division?: { id: string; name: string; code?: string | null } | null;
}
export interface PriceReviewProduct {
  id: string;
  name: string;
  productCode?: string | null;
  priceSource?: string | null;
  defaultSellingPrice?: number | string | null;
  wholesalePrice?: number | string | null;
  retailPrice?: number | string | null;
  effectiveSellingPrice?: number | string | null;
}
export const CATEGORY_TYPES = [
  'TRADING_GOODS',
  'RAW_MATERIAL',
  'FINISHED_GOODS',
  'FUEL',
  'LUBRICANT',
  'BEVERAGE_ALCOHOLIC',
  'BEVERAGE_NON_ALCOHOLIC',
  'HARDWARE',
  'BUILDING_MATERIAL',
  'AGRICULTURE_INPUT',
  'AGRICULTURE_PRODUCE',
  'CONSTRUCTION_MATERIAL',
  'SPARE_PART',
  'SERVICE',
  'OTHER',
];
export const categoryTypeLabel = (value: string) =>
  value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (c) => c.toUpperCase());
export const familyLabel = (family: ProductFamily) =>
  family.brand ? `${family.brand} · ${family.name}` : family.name;
export function catalogueMoney(value: number | string | null | undefined) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
  return `TZS ${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export const FAMILY_PRICES = [
  ['defaultPurchasePrice', 'Purchase price'],
  ['defaultSellingPrice', 'Selling price'],
  ['wholesalePrice', 'Wholesale price'],
  ['retailPrice', 'Retail price'],
] as const;
export function priceReviewReason(product: PriceReviewProduct, family: ProductFamily) {
  const different = FAMILY_PRICES.slice(1).some(([key]) => {
    const left = Number(product[key as keyof PriceReviewProduct]),
      right = Number(family[key]);
    return left > 0 && right > 0 && Math.abs(left - right) > 0.0001;
  });
  if (different) return 'Differs from family';
  if (product.priceSource !== 'FAMILY_DEFAULT')
    return product.priceSource === 'PRODUCT_OVERRIDE'
      ? 'Product override'
      : categoryTypeLabel(product.priceSource || 'MISSING');
  return '';
}
