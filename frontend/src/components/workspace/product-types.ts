export interface Company {
  id: string;
  name: string;
  code: string;
}
export interface Category {
  id: string;
  name: string;
}
export interface ProductFamily {
  id: string;
  name: string;
  brand?: string | null;
  categoryId: string;
  divisionId?: string | null;
  defaultPurchasePrice?: number | string | null;
  defaultSellingPrice?: number | string | null;
  wholesalePrice?: number | string | null;
  retailPrice?: number | string | null;
  productCount?: number;
  inheritedPriceCount?: number;
  overridePriceCount?: number;
  missingPriceCount?: number;
}
export interface Unit {
  id: string;
  name: string;
  symbol: string;
}
export interface Division {
  id: string;
  name: string;
  code: string;
}
export interface Branch {
  id: string;
  name: string;
  code?: string | null;
}

export interface Product {
  id: string;
  updatedAt?: string;
  productCode?: string | null;
  sku?: string | null;
  barcode?: string | null;
  name: string;
  productType: string;
  status: string;
  defaultSellingPrice?: number | string | null;
  defaultPurchasePrice?: number | string | null;
  wholesalePrice?: number | string | null;
  retailPrice?: number | string | null;
  effectiveSellingPrice?: number | string | null;
  effectivePurchasePrice?: number | string | null;
  effectiveWholesalePrice?: number | string | null;
  effectiveRetailPrice?: number | string | null;
  priceSource?: 'PRODUCT_OVERRIDE' | 'FAMILY_DEFAULT' | 'MISSING';
  minimumStockLevel?: number | string | null;
  maximumStockLevel?: number | string | null;
  reorderLevel?: number | string | null;
  // Per-branch stock, populated by the backend only when the list query carries a
  // branchId. `availableQuantity` is exposed at top level; on-hand is nested.
  availableQuantity?: number | string | null;
  inventoryBalance?: {
    quantityOnHand?: number | string | null;
    availableQuantity?: number | null;
  } | null;
  trackInventory: boolean;
  trackBatch: boolean;
  trackExpiry: boolean;
  description?: string | null;
  companyId: string;
  divisionId?: string | null;
  categoryId: string;
  productFamilyId?: string | null;
  baseUnitId: string;
  purchaseUnitId?: string | null;
  salesUnitId?: string | null;
  isTaxable?: boolean | null;
  taxRate?: number | string | null;
  variantName?: string | null;
  variantColor?: string | null;
  variantSize?: string | null;
  variantFinish?: string | null;
  imageUrl?: string | null;
  company?: { name: string } | null;
  division?: { id: string; name: string; code: string } | null;
  category?: { name: string } | null;
  productFamily?: {
    id: string;
    name: string;
    brand?: string | null;
    defaultPurchasePrice?: number | string | null;
    defaultSellingPrice?: number | string | null;
    wholesalePrice?: number | string | null;
    retailPrice?: number | string | null;
  } | null;
  baseUnit?: { name: string; symbol: string } | null;
  purchaseUnit?: { name: string; symbol: string } | null;
  salesUnit?: { name: string; symbol: string } | null;
}

export type ProductCreateResponse = Product & {
  generatedFamilyProducts?: Product[];
  skippedFamilyProducts?: Array<{ productFamilyId: string; familyName: string; reason: string }>;
};
