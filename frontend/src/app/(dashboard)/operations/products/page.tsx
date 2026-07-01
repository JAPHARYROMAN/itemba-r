'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card,
  PageHeader,
  PageToolbar,
  StatCard,
  StatusBadge,
  EmptyState,
  Modal,
  Btn,
  SkeletonTable,
  FormInput,
  FormSelect,
  FormTextarea,
  showToast,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { rowsToCsv, downloadTextFile } from '@/lib/report-export';
import {
  backendDelete,
  backendList,
  backendPage,
  backendPatch,
  backendPost,
} from '@/lib/api-client';

interface Company {
  id: string;
  name: string;
  code: string;
}
interface Category {
  id: string;
  name: string;
}
interface ProductFamily {
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
interface Unit {
  id: string;
  name: string;
  symbol: string;
}
interface Division {
  id: string;
  name: string;
  code: string;
}
interface Branch {
  id: string;
  name: string;
  code?: string | null;
}

interface Product {
  id: string;
  productCode?: string | null;
  sku?: string | null;
  barcode?: string | null;
  name: string;
  productType: string;
  status: string;
  defaultSellingPrice?: number | null;
  defaultPurchasePrice?: number | null;
  wholesalePrice?: number | null;
  retailPrice?: number | null;
  effectiveSellingPrice?: number | string | null;
  effectivePurchasePrice?: number | string | null;
  effectiveWholesalePrice?: number | string | null;
  effectiveRetailPrice?: number | string | null;
  priceSource?: 'PRODUCT_OVERRIDE' | 'FAMILY_DEFAULT' | 'MISSING';
  minimumStockLevel?: number | null;
  reorderLevel?: number | null;
  // Per-branch stock, populated by the backend only when the list query carries a
  // branchId. `availableQuantity` is exposed at top level; on-hand is nested.
  availableQuantity?: number | null;
  inventoryBalance?: { quantityOnHand?: number | null; availableQuantity?: number | null } | null;
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
  taxRate?: number | null;
  variantName?: string | null;
  variantColor?: string | null;
  variantSize?: string | null;
  variantFinish?: string | null;
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
}

type ProductCreateResponse = Product & {
  generatedFamilyProducts?: Product[];
  skippedFamilyProducts?: Array<{ productFamilyId: string; familyName: string; reason: string }>;
};

interface ProductForm {
  companyId: string;
  divisionId: string;
  productCode: string;
  sku: string;
  barcode: string;
  name: string;
  categoryId: string;
  productFamilyId: string;
  productFamilyName: string;
  productFamilyBrand: string;
  variantName: string;
  variantColor: string;
  variantSize: string;
  variantFinish: string;
  productType: string;
  baseUnitId: string;
  purchaseUnitId: string;
  salesUnitId: string;
  isTaxable: boolean;
  taxRate: string;
  defaultSellingPrice: string;
  defaultPurchasePrice: string;
  wholesalePrice: string;
  retailPrice: string;
  minimumStockLevel: string;
  reorderLevel: string;
  trackInventory: boolean;
  trackBatch: boolean;
  trackExpiry: boolean;
  status: string;
  description: string;
}

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

function emptyPaginated<T>(page = 1): Paginated<T> {
  return { data: [], total: 0, page, totalPages: 1 };
}

const PRODUCT_TYPES = ['STOCK_ITEM', 'SERVICE', 'NON_STOCK_ITEM', 'ASSET_RELATED'];
const PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE', 'DISCONTINUED'];

const TYPE_BADGE: Record<string, string> = {
  STOCK_ITEM: 'bg-blue-50 text-blue-700 border-blue-200',
  SERVICE: 'bg-purple-50 text-purple-700 border-purple-200',
  NON_STOCK_ITEM: 'bg-zinc-50 text-zinc-700 border-zinc-200',
  ASSET_RELATED: 'bg-amber-50 text-amber-700 border-amber-200',
};

const PRICE_SOURCE_BADGE: Record<string, string> = {
  PRODUCT_OVERRIDE: 'bg-blue-50 text-blue-700 border-blue-200',
  FAMILY_DEFAULT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  MISSING: 'bg-red-50 text-red-700 border-red-200',
};

function priceSourceLabel(source?: string | null) {
  if (source === 'PRODUCT_OVERRIDE') return 'Product override';
  if (source === 'FAMILY_DEFAULT') return 'Family default';
  return 'Missing price';
}

const BLANK: ProductForm = {
  companyId: '',
  divisionId: '',
  productCode: '',
  sku: '',
  barcode: '',
  name: '',
  categoryId: '',
  productFamilyId: '',
  productFamilyName: '',
  productFamilyBrand: '',
  variantName: '',
  variantColor: '',
  variantSize: '',
  variantFinish: '',
  productType: 'STOCK_ITEM',
  baseUnitId: '',
  purchaseUnitId: '',
  salesUnitId: '',
  isTaxable: false,
  taxRate: '',
  defaultSellingPrice: '',
  defaultPurchasePrice: '',
  wholesalePrice: '',
  retailPrice: '',
  minimumStockLevel: '',
  reorderLevel: '',
  trackInventory: true,
  trackBatch: false,
  trackExpiry: false,
  status: 'ACTIVE',
  description: '',
};

function fmtTZS(n?: number | string | null) {
  if (n == null) return '—';
  const value = Number(n);
  return (
    'TZS ' +
    new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      Number.isFinite(value) ? value : 0,
    )
  );
}

function fmtQty(n?: number | string | null) {
  if (n == null) return '—';
  const value = Number(n);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
    Number.isFinite(value) ? value : 0,
  );
}

function belowReorder(p: {
  trackInventory?: boolean;
  availableQuantity?: number | null;
  reorderLevel?: number | null;
}) {
  if (!p.trackInventory || p.reorderLevel == null) return false;
  return Number(p.availableQuantity ?? 0) <= Number(p.reorderLevel);
}

function priceInputValue(value?: number | string | null) {
  if (value == null || value === '') return '';
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? String(value) : '';
}

function familyPricePatch(family?: ProductFamily | null): Pick<
  ProductForm,
  'defaultPurchasePrice' | 'defaultSellingPrice' | 'wholesalePrice' | 'retailPrice'
> {
  return {
    defaultPurchasePrice: priceInputValue(family?.defaultPurchasePrice),
    defaultSellingPrice: priceInputValue(family?.defaultSellingPrice),
    wholesalePrice: priceInputValue(family?.wholesalePrice),
    retailPrice: priceInputValue(family?.retailPrice),
  };
}

function familySellingPriceValue(family?: ProductFamily | null) {
  return (
    Number(family?.defaultSellingPrice ?? 0) ||
    Number(family?.retailPrice ?? 0) ||
    Number(family?.wholesalePrice ?? 0)
  );
}

function familyVariantLabel(familyName: string) {
  const trimmed = familyName.trim();
  const match = trimmed.match(/^(\d+(?:[.,]\d+)?)\s*(l|ltr|litre|liter|litres|liters)$/i);
  if (!match) return trimmed;
  return `${match[1].replace(',', '.')} LTR`;
}

function productRequiresCost(productType: string, trackInventory: boolean) {
  if (!trackInventory) return false;
  return !['SERVICE', 'NON_STOCK_ITEM'].includes(String(productType).toUpperCase());
}

function ProductModal({
  mode,
  initial,
  companies,
  units,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Product;
  companies: Company[];
  units: Unit[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ProductForm>(() =>
    initial
      ? {
          companyId: initial.companyId,
          divisionId: initial.divisionId ?? '',
          productCode: initial.productCode ?? '',
          sku: initial.sku ?? '',
          barcode: initial.barcode ?? '',
          name: initial.name,
          categoryId: initial.categoryId,
          productFamilyId: initial.productFamilyId ?? '',
          productFamilyName: '',
          productFamilyBrand: initial.productFamily?.brand ?? '',
          variantName: initial.variantName ?? '',
          variantColor: initial.variantColor ?? '',
          variantSize: initial.variantSize ?? '',
          variantFinish: initial.variantFinish ?? '',
          productType: initial.productType,
          baseUnitId: initial.baseUnitId,
          purchaseUnitId: initial.purchaseUnitId ?? '',
          salesUnitId: initial.salesUnitId ?? '',
          isTaxable: Boolean(initial.isTaxable),
          taxRate: initial.taxRate != null ? String(initial.taxRate) : '',
          defaultSellingPrice:
            initial.defaultSellingPrice != null ? String(initial.defaultSellingPrice) : '',
          defaultPurchasePrice:
            initial.defaultPurchasePrice != null ? String(initial.defaultPurchasePrice) : '',
          wholesalePrice: initial.wholesalePrice != null ? String(initial.wholesalePrice) : '',
          retailPrice: initial.retailPrice != null ? String(initial.retailPrice) : '',
          minimumStockLevel:
            initial.minimumStockLevel != null ? String(initial.minimumStockLevel) : '',
          reorderLevel: initial.reorderLevel != null ? String(initial.reorderLevel) : '',
          trackInventory: initial.trackInventory,
          trackBatch: initial.trackBatch,
          trackExpiry: initial.trackExpiry,
          status: initial.status,
          description: initial.description ?? '',
        }
      : { ...BLANK },
  );
  const [categories, setCategories] = useState<Category[]>([]);
  const [families, setFamilies] = useState<ProductFamily[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [useFamilyPrice, setUseFamilyPrice] = useState(() =>
    Boolean(
      initial?.productFamilyId &&
        initial.defaultSellingPrice == null &&
        initial.wholesalePrice == null &&
        initial.retailPrice == null,
    ),
  );
  const [createFamilyVariants, setCreateFamilyVariants] = useState(mode === 'create');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const requiresCost = productRequiresCost(form.productType, form.trackInventory);
  const selectedFamily = families.find((family) => family.id === form.productFamilyId);
  const siblingFamilies =
    mode === 'create' && selectedFamily
      ? families.filter((family) => family.id !== selectedFamily.id)
      : [];
  const canCreateFamilyVariants = Boolean(selectedFamily && siblingFamilies.length > 0);
  const familySellingPrice = familySellingPriceValue(selectedFamily);
  const hasFamilyPrice = Boolean(selectedFamily && familySellingPrice > 0);
  const purchaseCost = Number(form.defaultPurchasePrice || selectedFamily?.defaultPurchasePrice || 0);
  const displayedSellingPrice =
    Number(form.defaultSellingPrice || 0) || (useFamilyPrice ? familySellingPrice : 0);
  const marginPreview =
    requiresCost && purchaseCost > 0 && displayedSellingPrice > 0
      ? ((displayedSellingPrice - purchaseCost) / displayedSellingPrice) * 100
      : null;

  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!form.companyId) {
      setCategories([]);
      setFamilies([]);
      setDivisions([]);
      return;
    }
    let cancelled = false;

    async function loadLookups() {
      const [categoryResult, divisionResult] = await Promise.allSettled([
        backendList<Category>('/product-categories', {
          query: { companyId: form.companyId, limit: 5000 },
        }),
        backendList<Division>('/divisions', {
          query: { companyId: form.companyId, limit: 200 },
        }),
      ]);
      if (cancelled) return;
      setCategories(categoryResult.status === 'fulfilled' ? categoryResult.value : []);
      setDivisions(divisionResult.status === 'fulfilled' ? divisionResult.value : []);
    }

    void loadLookups();

    return () => {
      cancelled = true;
    };
  }, [form.companyId]);

  useEffect(() => {
    if (!form.companyId || !form.categoryId) {
      setFamilies([]);
      return;
    }
    let cancelled = false;

    backendList<ProductFamily>('/products/families', {
      query: {
        companyId: form.companyId,
        categoryId: form.categoryId,
        divisionId: form.divisionId || undefined,
        isActive: true,
        limit: 500,
      },
    })
      .then((records) => {
        if (!cancelled) setFamilies(records);
      })
      .catch(() => {
        if (!cancelled) setFamilies([]);
      });

    return () => {
      cancelled = true;
    };
  }, [form.companyId, form.categoryId, form.divisionId]);

  useEffect(() => {
    if (useFamilyPrice && !form.productFamilyId) {
      setUseFamilyPrice(false);
    }
  }, [form.productFamilyId, useFamilyPrice]);

  const handleSubmit = async () => {
    if (!form.companyId) {
      setError('Company is required');
      return;
    }
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    if (!form.categoryId) {
      setError('Category is required');
      return;
    }
    if (!form.baseUnitId) {
      setError('Base unit is required');
      return;
    }
    if (requiresCost && (!Number.isFinite(purchaseCost) || purchaseCost <= 0)) {
      setError('Stock products must have a purchase price greater than zero');
      return;
    }
    if (requiresCost && useFamilyPrice) {
      if (!hasFamilyPrice) {
        setError('Select a priced product family or enter a product selling price');
        return;
      }
      if (familySellingPrice <= purchaseCost) {
        setError('Family selling price must be greater than purchase price');
        return;
      }
    }
    if (requiresCost) {
      for (const [label, value] of [
        ['Selling price', form.defaultSellingPrice],
        ['Wholesale price', form.wholesalePrice],
        ['Retail price', form.retailPrice],
      ] as const) {
        if (!value.trim()) continue;
        const price = Number(value);
        if (Number.isFinite(price) && price > 0 && price <= purchaseCost) {
          setError(`${label} must be greater than purchase price`);
          return;
        }
      }
    }
    setSaving(true);
    setError('');
    try {
      const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        categoryId: form.categoryId,
        productType: form.productType,
        baseUnitId: form.baseUnitId,
        status: form.status,
        trackInventory: form.trackInventory,
        trackBatch: form.trackBatch,
        trackExpiry: form.trackExpiry,
      };
      if (mode === 'create') body.companyId = form.companyId;
      if (form.productCode.trim()) body.productCode = form.productCode.trim();
      if (form.description.trim()) body.description = form.description.trim();
      // sku / barcode: send trimmed value on create; on edit send null to clear.
      for (const k of ['sku', 'barcode'] as const) {
        const v = (form[k] as string).trim();
        if (mode === 'edit') body[k] = v || null;
        else if (v) body[k] = v;
      }
      // Optional purchase/sales units: assign when picked, clear (null) on edit.
      if (mode === 'edit') {
        body.purchaseUnitId = form.purchaseUnitId || null;
        body.salesUnitId = form.salesUnitId || null;
      } else {
        if (form.purchaseUnitId) body.purchaseUnitId = form.purchaseUnitId;
        if (form.salesUnitId) body.salesUnitId = form.salesUnitId;
      }
      body.isTaxable = form.isTaxable;
      // Tax rate only meaningful when taxable; clear on edit when blank/exempt.
      if (form.isTaxable && form.taxRate.trim()) {
        body.taxRate = Number(form.taxRate);
      } else if (mode === 'edit') {
        body.taxRate = null;
      }
      if (form.productFamilyName.trim()) {
        body.productFamilyName = form.productFamilyName.trim();
        if (form.productFamilyBrand.trim()) body.productFamilyBrand = form.productFamilyBrand.trim();
      } else if (mode === 'edit') {
        body.productFamilyId = form.productFamilyId || null;
      } else if (form.productFamilyId) {
        body.productFamilyId = form.productFamilyId;
      }
      const textFields: (keyof ProductForm)[] = [
        'variantName',
        'variantColor',
        'variantSize',
        'variantFinish',
      ];
      for (const k of textFields) {
        const v = (form[k] as string).trim();
        if (mode === 'edit') body[k] = v || null;
        else if (v) body[k] = v;
      }
      // Division: empty string => clear in edit mode (send null);
      // populated => assign to that division; omit on create when blank.
      if (mode === 'edit') body.divisionId = form.divisionId || null;
      else if (form.divisionId) body.divisionId = form.divisionId;
      if (mode === 'create' && createFamilyVariants && canCreateFamilyVariants) {
        body.createFamilyVariants = true;
      }
      const fields: (keyof ProductForm)[] = [
        'defaultSellingPrice',
        'defaultPurchasePrice',
        'wholesalePrice',
        'retailPrice',
        'minimumStockLevel',
        'reorderLevel',
      ];
      for (const k of fields) {
        const v = num(form[k] as string);
        if (v !== undefined) body[k] = v;
      }
      if (useFamilyPrice) {
        body.defaultSellingPrice = null;
        body.wholesalePrice = null;
        body.retailPrice = null;
      }
      if (mode === 'create') {
        const created = await backendPost<ProductCreateResponse>('/products', body);
        const generatedCount = created.generatedFamilyProducts?.length ?? 0;
        showToast(
          'success',
          'Product created',
          generatedCount > 0
            ? `${form.name.trim()} plus ${generatedCount} family-size product${generatedCount === 1 ? '' : 's'}`
            : form.name.trim(),
        );
      } else {
        await backendPatch(`/products/${initial!.id}`, body);
        showToast('success', 'Product updated', form.name.trim());
      }
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed';
      setError(message);
      showToast('error', 'Could not save product', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'Create Product' : 'Edit Product'}
      size="xl"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={saving}>
            {mode === 'create' ? 'Create' : 'Save Changes'}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormSelect
          label="Company"
          required
          value={form.companyId}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              companyId: e.target.value,
              divisionId: '',
              categoryId: '',
              productFamilyId: '',
              productFamilyName: '',
              productFamilyBrand: '',
              ...(useFamilyPrice ? familyPricePatch(null) : {}),
            }))
          }
          placeholder="Select company"
          disabled={mode === 'edit'}
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Category"
          required
          value={form.categoryId}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              categoryId: e.target.value,
              productFamilyId: '',
              productFamilyName: '',
              productFamilyBrand: '',
              ...(useFamilyPrice ? familyPricePatch(null) : {}),
            }))
          }
          placeholder={form.companyId ? 'Select category' : 'Select company first'}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Division"
          value={form.divisionId}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              divisionId: e.target.value,
              productFamilyId: '',
              productFamilyName: '',
              productFamilyBrand: '',
              ...(useFamilyPrice ? familyPricePatch(null) : {}),
            }))
          }
          placeholder={form.companyId ? 'Company-wide (no division)' : 'Select company first'}
        >
          {divisions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code ? `${d.code} — ${d.name}` : d.name}
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Product Family"
          value={form.productFamilyId}
          onChange={(e) => {
            const family = families.find((item) => item.id === e.target.value);
            const shouldUseFamilyPrice = Boolean(family && familySellingPriceValue(family) > 0);
            setUseFamilyPrice(shouldUseFamilyPrice);
            setForm((f) => ({
              ...f,
              productFamilyId: e.target.value,
              productFamilyName: '',
              productFamilyBrand: family?.brand ?? '',
              ...(family ? familyPricePatch(family) : familyPricePatch(null)),
            }));
          }}
          placeholder={form.categoryId ? 'No family / create below' : 'Select category first'}
          disabled={!form.categoryId}
        >
          {families.map((family) => (
            <option key={family.id} value={family.id}>
              {family.brand ? `${family.brand} — ${family.name}` : family.name}
            </option>
          ))}
        </FormSelect>
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-secondary)' }}
        >
          <div className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Family price
          </div>
          {selectedFamily ? (
            <div className="mt-1 space-y-1">
              <div>Purchase: {fmtTZS(selectedFamily.defaultPurchasePrice)}</div>
              <div>Selling: {fmtTZS(selectedFamily.defaultSellingPrice)}</div>
              <div>Retail: {fmtTZS(selectedFamily.retailPrice)}</div>
              <div>Wholesale: {fmtTZS(selectedFamily.wholesalePrice)}</div>
            </div>
          ) : (
            <div className="mt-1">Select a priced family to inherit selling prices.</div>
          )}
        </div>
        <FormInput
          label="New Family Name"
          value={form.productFamilyName}
          onChange={(e) => {
            if (e.target.value.trim()) setUseFamilyPrice(false);
            setForm((f) => ({
              ...f,
              productFamilyName: e.target.value,
              productFamilyId: e.target.value.trim() ? '' : f.productFamilyId,
            }));
          }}
          placeholder="e.g. Coral Pro-Guard"
        />
        <FormInput
          label="Family Brand"
          value={form.productFamilyBrand}
          onChange={(e) => set('productFamilyBrand', e.target.value)}
          placeholder="e.g. Coral"
        />
        <FormInput
          label="Product Code"
          value={form.productCode}
          onChange={(e) => set('productCode', e.target.value)}
        />
        <FormInput
          label="Name"
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
        />
        <FormInput
          label="SKU"
          value={form.sku}
          onChange={(e) => set('sku', e.target.value)}
          placeholder="Stock-keeping unit"
        />
        <FormInput
          label="Barcode"
          value={form.barcode}
          onChange={(e) => set('barcode', e.target.value)}
          placeholder="EAN / UPC"
        />
        <FormInput
          label="Variant Name"
          value={form.variantName}
          onChange={(e) => set('variantName', e.target.value)}
          placeholder="e.g. White 4L"
        />
        <FormInput
          label="Color"
          value={form.variantColor}
          onChange={(e) => set('variantColor', e.target.value)}
          placeholder="White / Black / Summer Blue"
        />
        <FormInput
          label="Size / Pack"
          value={form.variantSize}
          onChange={(e) => set('variantSize', e.target.value)}
          placeholder="4L, 10L, 500ml"
        />
        <FormInput
          label="Finish"
          value={form.variantFinish}
          onChange={(e) => set('variantFinish', e.target.value)}
          placeholder="Matt, Gloss, Silk"
        />
        <FormSelect
          label="Product Type"
          required
          value={form.productType}
          onChange={(e) => set('productType', e.target.value)}
        >
          {PRODUCT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ')}
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Base Unit"
          required
          value={form.baseUnitId}
          onChange={(e) => set('baseUnitId', e.target.value)}
          placeholder="Select unit"
        >
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.symbol})
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Purchase Unit"
          value={form.purchaseUnitId}
          onChange={(e) => set('purchaseUnitId', e.target.value)}
          placeholder="Same as base unit"
        >
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.symbol})
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Sales Unit"
          value={form.salesUnitId}
          onChange={(e) => set('salesUnitId', e.target.value)}
          placeholder="Same as base unit"
        >
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.symbol})
            </option>
          ))}
        </FormSelect>
        <FormInput
          label="Selling Price"
          type="number"
          value={form.defaultSellingPrice}
          onChange={(e) => set('defaultSellingPrice', e.target.value)}
          disabled={useFamilyPrice}
        />
        <FormInput
          label="Purchase Price"
          type="number"
          value={form.defaultPurchasePrice}
          onChange={(e) => set('defaultPurchasePrice', e.target.value)}
        />
        {requiresCost && (
          <div
            className="col-span-2 rounded-lg border px-3 py-2 text-sm"
            style={{
              borderColor:
                purchaseCost > 0 ? 'var(--aurora-border)' : 'rgba(239, 68, 68, 0.45)',
              background: purchaseCost > 0 ? 'var(--aurora-card)' : 'rgba(239, 68, 68, 0.08)',
              color: purchaseCost > 0 ? 'var(--aurora-text-secondary)' : 'rgb(185, 28, 28)',
            }}
          >
            Purchase cost is required for stock products.{' '}
            {marginPreview != null
              ? `${useFamilyPrice ? 'Inherited family' : 'Default selling'} margin: ${marginPreview.toFixed(2)}%.`
              : 'Enter purchase and selling prices to preview margin.'}
          </div>
        )}
        <label
          className="col-span-2 flex items-start gap-3 rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
        >
          <input
            type="checkbox"
            className="mt-1 rounded"
            checked={useFamilyPrice}
            disabled={!selectedFamily}
            onChange={(event) => {
              setUseFamilyPrice(event.target.checked);
              if (event.target.checked && selectedFamily) {
                setForm((f) => ({
                  ...f,
                  ...familyPricePatch(selectedFamily),
                }));
              }
            }}
          />
          <span>
            <span className="block font-medium">Use family price</span>
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Clears product selling-price overrides so this product inherits prices from the selected family.
            </span>
          </span>
        </label>
        {mode === 'create' && (
          <label
            className="col-span-2 flex items-start gap-3 rounded-lg border px-3 py-2 text-sm"
            style={{
              borderColor: canCreateFamilyVariants
                ? 'var(--aurora-border)'
                : 'rgba(148, 163, 184, 0.28)',
              color: 'var(--aurora-text)',
            }}
          >
            <input
              type="checkbox"
              className="mt-1 rounded"
              checked={createFamilyVariants && canCreateFamilyVariants}
              disabled={!canCreateFamilyVariants}
              onChange={(event) => setCreateFamilyVariants(event.target.checked)}
            />
            <span>
              <span className="block font-medium">Create all family sizes</span>
              <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                Creates this product name across the other families in this category and applies each
                family&apos;s default purchase, selling, wholesale, and retail prices.
              </span>
              {canCreateFamilyVariants ? (
                <span
                  className="mt-2 grid gap-1 text-xs"
                  style={{ color: 'var(--aurora-text-secondary)' }}
                >
                  {siblingFamilies.slice(0, 6).map((family) => (
                    <span key={family.id}>
                      {form.name.trim() || 'Product'} {familyVariantLabel(family.name)} ·{' '}
                      {fmtTZS(family.defaultSellingPrice ?? family.retailPrice ?? family.wholesalePrice)}
                    </span>
                  ))}
                  {siblingFamilies.length > 6 && (
                    <span>+ {siblingFamilies.length - 6} more family sizes</span>
                  )}
                </span>
              ) : (
                <span className="mt-1 block text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                  Select a category family that has other active families to enable this.
                </span>
              )}
            </span>
          </label>
        )}
        <FormInput
          label="Wholesale Price"
          type="number"
          value={form.wholesalePrice}
          onChange={(e) => set('wholesalePrice', e.target.value)}
          disabled={useFamilyPrice}
        />
        <FormInput
          label="Retail Price"
          type="number"
          value={form.retailPrice}
          onChange={(e) => set('retailPrice', e.target.value)}
          disabled={useFamilyPrice}
        />
        <FormInput
          label="Min Stock Level"
          type="number"
          value={form.minimumStockLevel}
          onChange={(e) => set('minimumStockLevel', e.target.value)}
        />
        <FormInput
          label="Reorder Level"
          type="number"
          value={form.reorderLevel}
          onChange={(e) => set('reorderLevel', e.target.value)}
        />
        <label
          className="flex items-center gap-2 text-sm"
          style={{ color: 'var(--aurora-text)' }}
        >
          <input
            type="checkbox"
            className="rounded"
            checked={form.isTaxable}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                isTaxable: e.target.checked,
                taxRate: e.target.checked ? f.taxRate : '',
              }))
            }
          />
          Taxable (VAT)
        </label>
        <FormInput
          label="Tax Rate (%)"
          type="number"
          value={form.taxRate}
          onChange={(e) => set('taxRate', e.target.value)}
          disabled={!form.isTaxable}
          placeholder={form.isTaxable ? 'e.g. 18' : 'Exempt'}
        />
        <FormSelect
          label="Status"
          required
          value={form.status}
          onChange={(e) => set('status', e.target.value)}
        >
          {PRODUCT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </FormSelect>
        <div
          className="col-span-2 grid grid-cols-3 gap-2 text-sm"
          style={{ color: 'var(--aurora-text)' }}
        >
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="rounded"
              checked={form.trackInventory}
              onChange={(e) => set('trackInventory', e.target.checked)}
            />
            Track Inventory
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="rounded"
              checked={form.trackBatch}
              onChange={(e) => set('trackBatch', e.target.checked)}
            />
            Track Batch
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="rounded"
              checked={form.trackExpiry}
              onChange={(e) => set('trackExpiry', e.target.checked)}
            />
            Track Expiry
          </label>
        </div>
        <div className="col-span-2">
          <FormTextarea
            label="Description"
            rows={2}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

function DeleteConfirm({
  product,
  onClose,
  onConfirmed,
}: {
  product: Product;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const handleDelete = async () => {
    setSaving(true);
    setError('');
    try {
      await backendDelete(`/products/${product.id}`);
      showToast('success', 'Product deleted', product.name);
      onConfirmed();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed';
      setError(message);
      showToast('error', 'Could not delete product', message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Delete Product"
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="danger" onClick={handleDelete} loading={saving}>
            Delete
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>
        Are you sure you want to delete <strong>{product.name}</strong>? This will fail if the
        product has any inventory movement, sales, or purchase history.
      </p>
    </Modal>
  );
}

export default function ProductsPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [productFamilies, setProductFamilies] = useState<ProductFamily[]>([]);
  const [data, setData] = useState<Paginated<Product> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [productFamilyId, setProductFamilyId] = useState('');
  const [productType, setProductType] = useState('');
  const [status, setStatus] = useState('');
  const [priceSource, setPriceSource] = useState('');
  const [branchId, setBranchId] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);

  const canView = hasPermission('products.view');
  const canCreate = hasPermission('products.create');
  const canUpdate = hasPermission('products.update');
  const canDelete = hasPermission('products.delete');

  // Debounce the search box (~300ms) so we only refetch once typing settles.
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;

    async function loadBaseLookups() {
      const [companyResult, unitResult] = await Promise.allSettled([
        backendList<Company>('/companies', { query: { limit: 100 } }),
        backendList<Unit>('/units', { query: { limit: 200 } }),
      ]);
      if (cancelled) return;
      setCompanies(companyResult.status === 'fulfilled' ? companyResult.value : []);
      setUnits(unitResult.status === 'fulfilled' ? unitResult.value : []);
    }

    void loadBaseLookups();

    return () => {
      cancelled = true;
    };
  }, [canView]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;

    async function loadCategories() {
      try {
        const records = await backendList<Category>('/product-categories', {
          query: { limit: 5000, companyId: companyId || undefined },
        });
        if (!cancelled) setCategories(records);
      } catch {
        if (!cancelled) setCategories([]);
      }
    }

    void loadCategories();

    return () => {
      cancelled = true;
    };
  }, [canView, companyId]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;

    async function loadFamilies() {
      try {
        const records = await backendList<ProductFamily>('/products/families', {
          query: {
            limit: 500,
            companyId: companyId || undefined,
            categoryId: categoryId || undefined,
            isActive: true,
          },
        });
        if (!cancelled) setProductFamilies(records);
      } catch {
        if (!cancelled) setProductFamilies([]);
      }
    }

    void loadFamilies();

    return () => {
      cancelled = true;
    };
  }, [canView, companyId, categoryId]);

  // Branches power the per-branch stock columns; only relevant once a company is chosen.
  useEffect(() => {
    if (!canView || !companyId) {
      setBranches([]);
      return;
    }
    let cancelled = false;
    backendList<Branch>('/branches', { query: { companyId, activeOnly: true, limit: 500 } })
      .then((records) => {
        if (!cancelled) setBranches(records);
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canView, companyId]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const result = await backendPage<Product>('/products', {
        query: {
          page,
          limit: 20,
          search: search.trim() || undefined,
          companyId: companyId || undefined,
          categoryId: categoryId || undefined,
          productFamilyId: productFamilyId || undefined,
          productType: productType || undefined,
          status: status || undefined,
          priceSource: priceSource || undefined,
          branchId: branchId || undefined,
        },
      });
      setData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load products';
      setError(message);
      showToast('error', 'Could not load products', message);
      setData(emptyPaginated<Product>(page));
    } finally {
      setLoading(false);
    }
  }, [
    canView,
    page,
    search,
    companyId,
    categoryId,
    productFamilyId,
    productType,
    status,
    priceSource,
    branchId,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const handleExportCsv = () => {
    const rows = data?.data ?? [];
    if (!rows.length) {
      showToast('error', 'Nothing to export', 'No products match the current filters');
      return;
    }
    const csvRows = rows.map((p) => ({
      Code: p.productCode ?? '',
      Name: p.name,
      Family: p.productFamily
        ? p.productFamily.brand
          ? `${p.productFamily.brand} — ${p.productFamily.name}`
          : p.productFamily.name
        : '',
      Variant: [p.variantName, p.variantColor, p.variantSize, p.variantFinish]
        .filter(Boolean)
        .join(' · '),
      Category: p.category?.name ?? '',
      Division: p.division?.name ?? 'company-wide',
      Type: p.productType.replace(/_/g, ' '),
      Unit: p.baseUnit?.symbol ?? p.baseUnit?.name ?? '',
      Selling: Number(p.effectiveSellingPrice ?? p.defaultSellingPrice ?? 0),
      Purchase: Number(p.effectivePurchasePrice ?? p.defaultPurchasePrice ?? 0),
      'Price source': priceSourceLabel(p.priceSource),
      ...(branchId
        ? {
            'On hand': p.trackInventory ? Number(p.inventoryBalance?.quantityOnHand ?? 0) : '',
            Available: p.trackInventory ? Number(p.availableQuantity ?? 0) : '',
          }
        : {}),
      Status: p.status,
    }));
    const csv = rowsToCsv(csvRows as Record<string, unknown>[]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(`products-${stamp}.csv`, 'text/csv;charset=utf-8', csv);
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Products" subtitle="Catalogue" />
        <div className="mt-8 text-center">
          <p className="text-sm text-slate-500">Access Restricted</p>
        </div>
      </div>
    );
  }

  const filterSelectCls =
    'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = {
    borderColor: 'var(--aurora-border)',
    background: 'var(--aurora-card)',
    color: 'var(--aurora-text)',
  } as const;

  // Base columns (11) + the two per-branch stock columns (when a branch is picked) + Actions.
  const colCount = 11 + (branchId ? 2 : 0) + (canUpdate || canDelete ? 1 : 0);

  const counts = {
    active: data?.data.filter((p) => p.status === 'ACTIVE').length ?? 0,
    inactive: data?.data.filter((p) => p.status === 'INACTIVE').length ?? 0,
    discontinued: data?.data.filter((p) => p.status === 'DISCONTINUED').length ?? 0,
  };

  return (
    <div className="p-6 space-y-6">
      {creating && (
        <ProductModal
          mode="create"
          companies={companies}
          units={units}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {editing && (
        <ProductModal
          mode="edit"
          initial={editing}
          companies={companies}
          units={units}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {deleting && (
        <DeleteConfirm
          product={deleting}
          onClose={() => setDeleting(null)}
          onConfirmed={() => {
            setDeleting(null);
            load();
          }}
        />
      )}

      <PageHeader title="Products" subtitle="Master data for goods and services" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 aurora-stagger">
        <StatCard label="Total" value={data?.total ?? 0} />
        <StatCard label="Active (page)" value={counts.active} />
        <StatCard label="Inactive (page)" value={counts.inactive} />
        <StatCard label="Discontinued (page)" value={counts.discontinued} />
      </div>

      <PageToolbar
        search={searchInput}
        onSearch={(v) => setSearchInput(v)}
        searchPlaceholder="Search products…"
        filters={
          <>
            <select
              value={companyId}
              aria-label="Filter by company"
              onChange={(e) => {
                setCompanyId(e.target.value);
                setCategoryId('');
                setProductFamilyId('');
                setBranchId('');
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={categoryId}
              aria-label="Filter by category"
              onChange={(e) => {
                setCategoryId(e.target.value);
                setProductFamilyId('');
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={productFamilyId}
              aria-label="Filter by product family"
              onChange={(e) => {
                setProductFamilyId(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Families</option>
              {productFamilies.map((family) => (
                <option key={family.id} value={family.id}>
                  {family.brand ? `${family.brand} — ${family.name}` : family.name}
                </option>
              ))}
            </select>
            <select
              value={productType}
              aria-label="Filter by product type"
              onChange={(e) => {
                setProductType(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Types</option>
              {PRODUCT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <select
              value={status}
              aria-label="Filter by status"
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Status</option>
              {PRODUCT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={priceSource}
              aria-label="Filter by pricing source"
              onChange={(e) => {
                setPriceSource(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
              title="Filter by pricing source"
            >
              <option value="">All Pricing</option>
              <option value="PRODUCT_OVERRIDE">{priceSourceLabel('PRODUCT_OVERRIDE')}</option>
              <option value="FAMILY_DEFAULT">{priceSourceLabel('FAMILY_DEFAULT')}</option>
              <option value="MISSING">{priceSourceLabel('MISSING')}</option>
            </select>
            {companyId && (
              <select
                value={branchId}
                aria-label="Show stock on hand and available for a branch"
                onChange={(e) => {
                  setBranchId(e.target.value);
                  setPage(1);
                }}
                className={filterSelectCls}
                style={filterStyle}
                title="Show stock on hand / available for a branch"
              >
                <option value="">Stock: select branch…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code ? `${b.code} - ${b.name}` : b.name}
                  </option>
                ))}
              </select>
            )}
          </>
        }
        actions={
          <>
            <Btn
              variant="secondary"
              onClick={handleExportCsv}
              disabled={loading || !data?.data.length}
            >
              Export CSV
            </Btn>
            {canCreate && (
              <Btn variant="primary" onClick={() => setCreating(true)}>
                + New Product
              </Btn>
            )}
          </>
        }
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1200px]" aria-label="Products catalogue">
            <caption className="sr-only">
              Products catalogue with pricing, stock, and status for each item
            </caption>
            <thead>
              <tr
                className="text-left text-xs uppercase bg-gray-50"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th scope="col" className="px-4 py-3">Code</th>
                <th scope="col" className="px-4 py-3">Name</th>
                <th scope="col" className="px-4 py-3">Family</th>
                <th scope="col" className="px-4 py-3">Variant</th>
                <th scope="col" className="px-4 py-3">Category</th>
                <th scope="col" className="px-4 py-3">Division</th>
                <th scope="col" className="px-4 py-3">Type</th>
                <th scope="col" className="px-4 py-3">Unit</th>
                <th scope="col" className="px-4 py-3 text-right">Selling</th>
                <th scope="col" className="px-4 py-3 text-right">Purchase</th>
                {branchId && <th scope="col" className="px-4 py-3 text-right">On hand</th>}
                {branchId && <th scope="col" className="px-4 py-3 text-right">Available</th>}
                <th scope="col" className="px-4 py-3">Status</th>
                {(canUpdate || canDelete) && (
                  <th scope="col" className="px-4 py-3 text-right">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={colCount}>
                    <SkeletonTable rows={6} cols={colCount} />
                  </td>
                </tr>
              ) : !data?.data.length ? (
                <tr>
                  <td colSpan={colCount}>
                    <EmptyState
                      title="No products found"
                      description="Try adjusting your search or filters, or create a new product."
                    />
                  </td>
                </tr>
              ) : (
                data.data.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link
                        href={`/operations/products/${p.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {p.productCode ?? '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/operations/products/${p.id}`}
                        className="text-blue-600 hover:underline"
                        title={`View ${p.name}`}
                      >
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {p.productFamily
                        ? p.productFamily.brand
                          ? `${p.productFamily.brand} — ${p.productFamily.name}`
                          : p.productFamily.name
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div>{p.variantName || p.variantColor || '—'}</div>
                      {(p.variantSize || p.variantFinish) && (
                        <div style={{ color: 'var(--aurora-text-muted)' }}>
                          {[p.variantSize, p.variantFinish].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">{p.category?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs">
                      {p.division?.name ?? (
                        <span className="text-slate-400 italic">company-wide</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${TYPE_BADGE[p.productType] ?? 'bg-zinc-50 text-zinc-700 border-zinc-200'}`}
                      >
                        {p.productType.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {p.baseUnit?.symbol ?? p.baseUnit?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <div>{fmtTZS(p.effectiveSellingPrice ?? p.defaultSellingPrice)}</div>
                      <span
                        className={`mt-1 inline-flex items-center rounded border px-2 py-0.5 text-[10px] ${PRICE_SOURCE_BADGE[p.priceSource ?? 'MISSING'] ?? PRICE_SOURCE_BADGE.MISSING}`}
                      >
                        {priceSourceLabel(p.priceSource)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {fmtTZS(p.effectivePurchasePrice ?? p.defaultPurchasePrice)}
                    </td>
                    {branchId && (
                      <td className="px-4 py-3 text-right tabular-nums">
                        {p.trackInventory ? fmtQty(p.inventoryBalance?.quantityOnHand) : '—'}
                      </td>
                    )}
                    {branchId && (
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${
                          belowReorder(p) ? 'text-red-600 font-semibold' : ''
                        }`}
                        title={belowReorder(p) ? 'At or below reorder level' : undefined}
                      >
                        {p.trackInventory ? fmtQty(p.availableQuantity) : '—'}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <StatusBadge status={p.status} />
                    </td>
                    {(canUpdate || canDelete) && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {canUpdate && (
                          <Btn
                            variant="ghost"
                            size="xs"
                            aria-label={`Edit ${p.name}`}
                            onClick={() => setEditing(p)}
                          >
                            Edit
                          </Btn>
                        )}
                        {canDelete && (
                          <Btn
                            variant="ghost"
                            size="xs"
                            aria-label={`Delete ${p.name}`}
                            onClick={() => setDeleting(p)}
                          >
                            Delete
                          </Btn>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {data && data.totalPages > 1 && (
          <div
            className="px-5 py-3 border-t flex items-center justify-between"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Page {data.page} of {data.totalPages} · {data.total} total
            </span>
            <div className="flex gap-2">
              <Btn
                variant="secondary"
                size="xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Btn>
              <Btn
                variant="secondary"
                size="xs"
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
