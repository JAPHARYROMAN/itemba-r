'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import {
  Btn,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  PageSpinner,
  StatCard,
  StatusBadge,
  SkeletonTable,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendGet, backendList, backendPage } from '@/lib/api-client';
import { toFiniteNumber } from '@/lib/design-system/formatters';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProductDetail {
  id: string;
  productCode?: string | null;
  sku?: string | null;
  barcode?: string | null;
  name: string;
  productType: string;
  status: string;
  description?: string | null;
  companyId: string;
  divisionId?: string | null;
  categoryId: string;
  productFamilyId?: string | null;
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
  trackInventory: boolean;
  trackBatch: boolean;
  trackExpiry: boolean;
  isTaxable?: boolean;
  taxRate?: number | string | null;
  variantName?: string | null;
  variantColor?: string | null;
  variantSize?: string | null;
  variantFinish?: string | null;
  company?: { id: string; name: string; code: string } | null;
  division?: { id: string; name: string; code: string } | null;
  category?: { name: string } | null;
  productFamily?: { id: string; name: string; brand?: string | null } | null;
  baseUnit?: { id: string; name: string; symbol: string } | null;
  purchaseUnit?: { id: string; name: string; symbol: string } | null;
  salesUnit?: { id: string; name: string; symbol: string } | null;
}

interface InventoryBalance {
  id: string;
  productId: string;
  branchId?: string | null;
  companyId: string;
  quantityOnHand: number | string;
  quantityReserved: number | string;
  averageCost: number | string;
  totalValue: number | string;
  lastMovementAt?: string | null;
  branch?: { name: string; code?: string | null } | null;
}

type MovementType = string;

interface InventoryMovement {
  id: string;
  movementNumber?: string;
  movementDate: string;
  movementType: MovementType;
  quantity: number | string;
  unitCost: number | string;
  totalCost: number | string;
  referenceNumber?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  notes?: string | null;
  branch?: { name: string; code?: string | null } | null;
  createdBy?: { fullName: string } | null;
}

interface LedgerRow {
  salesOrderId: string;
  salesOrderNumber: string;
  orderDate: string;
  customerName?: string | null;
  quantity: number | string;
  unitPrice: number | string;
  unitCostAtSale?: number | string | null;
  cogsAmount: number | string;
  grossProfitAmount: number | string;
  grossMarginPct?: number | string | null;
  profitCostSource?: string | null;
}

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const INBOUND_TYPES = new Set<string>([
  'OPENING_STOCK',
  'PURCHASE_RECEIPT',
  'SALES_RETURN',
  'TRANSFER_IN',
  'ADJUSTMENT_IN',
  'PRODUCTION_IN',
]);
const OUTBOUND_TYPES = new Set<string>([
  'SALE_ISSUE',
  'PURCHASE_RETURN',
  'TRANSFER_OUT',
  'ADJUSTMENT_OUT',
  'DAMAGE',
  'WASTAGE',
  'INTERNAL_USE',
  'PRODUCTION_OUT',
]);

const MOVEMENT_TYPE_STYLES: Record<string, string> = {
  OPENING_STOCK: 'bg-purple-100 text-purple-700',
  PURCHASE_RECEIPT: 'bg-green-100 text-green-700',
  SALE_ISSUE: 'bg-blue-100 text-blue-700',
  SALES_RETURN: 'bg-emerald-100 text-emerald-700',
  PURCHASE_RETURN: 'bg-orange-100 text-orange-700',
  TRANSFER_IN: 'bg-cyan-100 text-cyan-700',
  TRANSFER_OUT: 'bg-yellow-100 text-yellow-700',
  ADJUSTMENT_IN: 'bg-teal-100 text-teal-700',
  ADJUSTMENT_OUT: 'bg-amber-100 text-amber-700',
  DAMAGE: 'bg-red-100 text-red-700',
  WASTAGE: 'bg-rose-100 text-rose-700',
  INTERNAL_USE: 'bg-indigo-100 text-indigo-700',
  PRODUCTION_IN: 'bg-lime-100 text-lime-700',
  PRODUCTION_OUT: 'bg-fuchsia-100 text-fuchsia-700',
  OTHER: 'bg-slate-100 text-slate-600',
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

function fmtNum(n: number | string | null | undefined, decimals = 2) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(toFiniteNumber(n));
}

function fmtTZS(n: number | string | null | undefined) {
  if (n == null || n === '') return '—';
  return 'TZS ' + fmtNum(n);
}

function fmtQty(n: number | string | null | undefined) {
  if (n == null || n === '') return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(toFiniteNumber(n));
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function marginPct(sell?: number | string | null, cost?: number | string | null): number | null {
  const s = toFiniteNumber(sell);
  const c = toFiniteNumber(cost);
  if (s <= 0) return null;
  return ((s - c) / s) * 100;
}

const tdCls = 'px-4 py-3 text-sm';
const thCls = 'px-4 py-3';

function MovementBadge({ type }: { type: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        MOVEMENT_TYPE_STYLES[type] ?? 'bg-slate-100 text-slate-500'
      }`}
    >
      {type.replace(/_/g, ' ')}
    </span>
  );
}

// Source documents that have a per-id detail route today.
const REFERENCE_ROUTES: Record<string, (id: string) => string> = {
  SalesOrder: (id) => `/operations/sales-orders/${id}`,
};

function ReferenceCell({ mov }: { mov: InventoryMovement }) {
  if (!mov.referenceType || !mov.referenceId) return <span className="text-slate-400">—</span>;
  const label = mov.referenceType.replace(/([a-z])([A-Z])/g, '$1 $2');
  const short = mov.referenceId.slice(0, 8);
  const href = REFERENCE_ROUTES[mov.referenceType]?.(mov.referenceId);
  if (href) {
    return (
      <Link href={href} className="text-blue-600 hover:underline">
        {label} · {short}
      </Link>
    );
  }
  return (
    <span title={`${mov.referenceType} ${mov.referenceId}`}>
      {label} · <span className="text-slate-500">{short}</span>
    </span>
  );
}

// ─── Small presentation building blocks ───────────────────────────────────────

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="text-[11px] font-medium uppercase tracking-wide"
        style={{ color: 'var(--aurora-text-muted)' }}
      >
        {label}
      </div>
      <div className="mt-1 text-sm" style={{ color: 'var(--aurora-text)' }}>
        {children ?? '—'}
      </div>
    </div>
  );
}

type TabKey = 'stock' | 'movements' | 'profitability';

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const productId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const { hasPermission } = useAuth();
  const backToProductsHref = useMemo(() => {
    const next = new URLSearchParams({ tab: 'catalog', view: 'products' });
    for (const key of ['companyId', 'divisionId', 'branchId', 'q']) {
      const value = searchParams.get(key);
      if (value) next.set(key, value);
    }
    return `/inventory?${next.toString()}`;
  }, [searchParams]);

  const canView =
    hasPermission('products.view') ||
    hasPermission('inventory.view') ||
    hasPermission('inventory.adjustments.create') ||
    hasPermission('pos.create') ||
    hasPermission('sales.create') ||
    hasPermission('purchases.create') ||
    hasPermission('operations.dashboard.view');
  const canViewInventory = hasPermission('inventory.view');
  const canViewMovements = hasPermission('inventory.movements.view');
  const canViewProfit = hasPermission('profit.view') || hasPermission('operations.reports.view');

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [tab, setTab] = useState<TabKey>('stock');

  const [balances, setBalances] = useState<InventoryBalance[] | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);

  const [movements, setMovements] = useState<Paginated<InventoryMovement> | null>(null);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movementsPage, setMovementsPage] = useState(1);

  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // ── Load the product itself ──────────────────────────────────────────────
  const loadProduct = useCallback(async () => {
    if (!canView || !productId) return;
    setLoading(true);
    setError('');
    try {
      const record = await backendGet<ProductDetail>(`/products/${productId}`);
      setProduct(record);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load product');
      setProduct(null);
    } finally {
      setLoading(false);
    }
  }, [canView, productId]);

  useEffect(() => {
    void loadProduct();
  }, [loadProduct]);

  const companyId = product?.companyId;

  // ── Stock by branch (inventory balances filtered to this product) ─────────
  const loadBalances = useCallback(async () => {
    if (!canViewInventory || !companyId || !productId) return;
    setBalancesLoading(true);
    try {
      const rows = await backendList<InventoryBalance>('/inventory-balances', {
        query: { companyId, productId, limit: 200 },
      });
      setBalances(rows);
    } catch {
      setBalances([]);
    } finally {
      setBalancesLoading(false);
    }
  }, [canViewInventory, companyId, productId]);

  useEffect(() => {
    void loadBalances();
  }, [loadBalances]);

  // ── Movement history ──────────────────────────────────────────────────────
  const loadMovements = useCallback(async () => {
    if (!canViewMovements || !companyId || !productId) return;
    setMovementsLoading(true);
    try {
      const result = await backendPage<InventoryMovement>('/inventory-movements', {
        query: { companyId, productId, page: movementsPage, limit: 20 },
      });
      setMovements(result);
    } catch {
      setMovements({ data: [], total: 0, page: movementsPage, totalPages: 1 });
    } finally {
      setMovementsLoading(false);
    }
  }, [canViewMovements, companyId, productId, movementsPage]);

  useEffect(() => {
    void loadMovements();
  }, [loadMovements]);

  // ── Per-product profitability ledger ──────────────────────────────────────
  const loadLedger = useCallback(async () => {
    if (!canViewProfit || !companyId || !productId) return;
    setLedgerLoading(true);
    try {
      const rows = await backendGet<LedgerRow[]>(`/profit/products/${productId}/ledger`, {
        query: { companyId },
      });
      setLedger(Array.isArray(rows) ? rows : []);
    } catch {
      setLedger([]);
    } finally {
      setLedgerLoading(false);
    }
  }, [canViewProfit, companyId, productId]);

  useEffect(() => {
    void loadLedger();
  }, [loadLedger]);

  // ── Derived stock totals ──────────────────────────────────────────────────
  const stockTotals = useMemo(() => {
    const rows = balances ?? [];
    const onHand = rows.reduce((s, r) => s + toFiniteNumber(r.quantityOnHand), 0);
    const reserved = rows.reduce((s, r) => s + toFiniteNumber(r.quantityReserved), 0);
    const value = rows.reduce((s, r) => s + toFiniteNumber(r.totalValue), 0);
    return { onHand, reserved, available: onHand - reserved, value, branches: rows.length };
  }, [balances]);

  // ── Deep-link query for scoped quick actions ──────────────────────────────
  const scopedQuery = useMemo(() => {
    const parts: string[] = [];
    if (companyId) parts.push(`companyId=${encodeURIComponent(companyId)}`);
    if (productId) parts.push(`productId=${encodeURIComponent(productId)}`);
    return parts.length ? `?${parts.join('&')}` : '';
  }, [companyId, productId]);

  // ── Permission / loading / error guards ───────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Product" subtitle="Catalogue" />
        <div className="mt-8 text-center">
          <p className="text-sm text-slate-500">Access Restricted</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <PageSpinner />
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="p-6 space-y-4">
        <PageHeader
          title="Product"
          breadcrumbs={[
            { label: 'Operations', href: '/operations' },
            { label: 'Products', href: backToProductsHref },
            { label: 'Detail' },
          ]}
        />
        <ErrorState
          message={error || 'The product could not be found.'}
          onRetry={() => void loadProduct()}
        />
      </div>
    );
  }

  const variantBits = [
    product.variantName,
    product.variantColor,
    product.variantSize,
    product.variantFinish,
  ].filter(Boolean);

  const effSell = product.effectiveSellingPrice ?? product.defaultSellingPrice;
  const effCost = product.effectivePurchasePrice ?? product.defaultPurchasePrice;
  const margin = marginPct(effSell, effCost);

  const familyLabel = product.productFamily
    ? product.productFamily.brand
      ? `${product.productFamily.brand} — ${product.productFamily.name}`
      : product.productFamily.name
    : null;

  const tabs: Array<{ key: TabKey; label: string; enabled: boolean }> = [
    { key: 'stock', label: 'Stock by Branch', enabled: canViewInventory },
    { key: 'movements', label: 'Movement History', enabled: canViewMovements },
    { key: 'profitability', label: 'Profitability', enabled: canViewProfit },
  ];
  const visibleTabs = tabs.filter((t) => t.enabled);
  const activeTab = visibleTabs.some((t) => t.key === tab) ? tab : visibleTabs[0]?.key;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={product.name}
        subtitle={
          [product.productCode, familyLabel, product.category?.name].filter(Boolean).join(' · ') ||
          'Product profile'
        }
        breadcrumbs={[
          { label: 'Operations', href: '/operations' },
          { label: 'Products', href: backToProductsHref },
          { label: product.name },
        ]}
        actions={
          <>
            <Link href={backToProductsHref}>
              <Btn variant="secondary" size="sm">
                Back to Products
              </Btn>
            </Link>
            <StatusBadge status={product.status} />
          </>
        }
      />

      {/* ── Header profile card ──────────────────────────────────────────── */}
      <Card>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
          <DetailField label="Code">
            <span className="font-mono text-xs">{product.productCode ?? '—'}</span>
          </DetailField>
          <DetailField label="SKU">
            <span className="font-mono text-xs">{product.sku ?? '—'}</span>
          </DetailField>
          <DetailField label="Barcode">
            <span className="font-mono text-xs">{product.barcode ?? '—'}</span>
          </DetailField>
          <DetailField label="Type">{product.productType.replace(/_/g, ' ')}</DetailField>
          <DetailField label="Category">{product.category?.name ?? '—'}</DetailField>
          <DetailField label="Family">{familyLabel ?? '—'}</DetailField>
          <DetailField label="Division">
            {product.division?.name ?? <span className="italic text-slate-400">company-wide</span>}
          </DetailField>
          <DetailField label="Company">{product.company?.name ?? '—'}</DetailField>
          <DetailField label="Base Unit">
            {product.baseUnit ? `${product.baseUnit.name} (${product.baseUnit.symbol})` : '—'}
          </DetailField>
          <DetailField label="Purchase Unit">
            {product.purchaseUnit
              ? `${product.purchaseUnit.name} (${product.purchaseUnit.symbol})`
              : '—'}
          </DetailField>
          <DetailField label="Sales Unit">
            {product.salesUnit ? `${product.salesUnit.name} (${product.salesUnit.symbol})` : '—'}
          </DetailField>
          <DetailField label="Variant">
            {variantBits.length ? variantBits.join(' · ') : '—'}
          </DetailField>
          <DetailField label="Tax">
            {product.isTaxable
              ? `Taxable${product.taxRate != null ? ` · ${fmtNum(product.taxRate)}%` : ''}`
              : 'Exempt'}
          </DetailField>
          <DetailField label="Tracking">
            {[
              product.trackInventory ? 'Inventory' : null,
              product.trackBatch ? 'Batch' : null,
              product.trackExpiry ? 'Expiry' : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'None'}
          </DetailField>
          <DetailField label="Reorder Level">
            {product.reorderLevel != null ? fmtQty(product.reorderLevel) : '—'}
          </DetailField>
          <DetailField label="Min / Max Stock">
            {`${product.minimumStockLevel != null ? fmtQty(product.minimumStockLevel) : '—'} / ${
              product.maximumStockLevel != null ? fmtQty(product.maximumStockLevel) : '—'
            }`}
          </DetailField>
        </div>
        {product.description && (
          <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--aurora-border)' }}>
            <DetailField label="Description">{product.description}</DetailField>
          </div>
        )}
      </Card>

      {/* ── Pricing / margin stat tiles ──────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Selling" value={fmtTZS(effSell)} countUp={false} />
        <StatCard label="Purchase" value={fmtTZS(effCost)} countUp={false} />
        <StatCard
          label="Wholesale"
          value={fmtTZS(product.effectiveWholesalePrice ?? product.wholesalePrice)}
          countUp={false}
        />
        <StatCard
          label="Retail"
          value={fmtTZS(product.effectiveRetailPrice ?? product.retailPrice)}
          countUp={false}
        />
        <StatCard
          label="Margin"
          value={margin != null ? `${fmtNum(margin)}%` : '—'}
          variant={margin != null ? (margin >= 0 ? 'green' : 'red') : 'default'}
          countUp={false}
        />
        <StatCard
          label="Price Source"
          value={priceSourceLabel(product.priceSource)}
          countUp={false}
        />
      </div>

      {/* ── Product-scoped quick actions (deep-link with productId prefilled) ─ */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
              Quick actions
            </h2>
            <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Start a stock adjustment, receive goods, or raise a purchase order pre-scoped to this
              product.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {hasPermission('inventory.adjustments.create') && (
              <Link
                href={`/inventory?tab=controls&view=adjustments${scopedQuery ? `&${scopedQuery.slice(1)}` : ''}`}
              >
                <Btn variant="secondary" size="sm">
                  Adjust Stock
                </Btn>
              </Link>
            )}
            {hasPermission('purchases.create') && (
              <>
                <Link href={`/operations/procurement/grns${scopedQuery}`}>
                  <Btn variant="secondary" size="sm">
                    Receive Goods (GRN)
                  </Btn>
                </Link>
                <Link href={`/operations/purchase-orders${scopedQuery}`}>
                  <Btn variant="primary" size="sm">
                    New Purchase Order
                  </Btn>
                </Link>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      {visibleTabs.length > 0 && (
        <>
          <div
            className="flex flex-wrap gap-1 border-b"
            style={{ borderColor: 'var(--aurora-border)' }}
            role="tablist"
            aria-label="Product detail sections"
          >
            {visibleTabs.map((t) => {
              const isActive = t.key === activeTab;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setTab(t.key)}
                  className="relative px-4 py-2 text-sm font-medium transition-colors"
                  style={{
                    color: isActive ? 'var(--aurora-text)' : 'var(--aurora-text-muted)',
                    borderBottom: isActive
                      ? '2px solid var(--aurora-primary)'
                      : '2px solid transparent',
                    marginBottom: '-1px',
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* ── Stock by branch ────────────────────────────────────────── */}
          {activeTab === 'stock' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="On Hand" value={fmtQty(stockTotals.onHand)} countUp={false} />
                <StatCard label="Reserved" value={fmtQty(stockTotals.reserved)} countUp={false} />
                <StatCard
                  label="Available"
                  value={fmtQty(stockTotals.available)}
                  variant={stockTotals.available <= 0 ? 'red' : 'default'}
                  countUp={false}
                />
                <StatCard label="Stock Value" value={fmtTZS(stockTotals.value)} countUp={false} />
              </div>
              <Card className="overflow-hidden" padding="none">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[720px]">
                    <caption className="sr-only">Stock on hand by branch</caption>
                    <thead>
                      <tr
                        className="text-left text-xs uppercase bg-gray-50"
                        style={{ color: 'var(--aurora-text-muted)' }}
                      >
                        <th scope="col" className={thCls}>
                          Branch / Location
                        </th>
                        <th scope="col" className={`${thCls} text-right`}>
                          On Hand
                        </th>
                        <th scope="col" className={`${thCls} text-right`}>
                          Reserved
                        </th>
                        <th scope="col" className={`${thCls} text-right`}>
                          Available
                        </th>
                        <th scope="col" className={`${thCls} text-right`}>
                          Avg Cost
                        </th>
                        <th scope="col" className={`${thCls} text-right`}>
                          Total Value
                        </th>
                        <th scope="col" className={thCls}>
                          Last Movement
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {balancesLoading ? (
                        <tr>
                          <td colSpan={7}>
                            <SkeletonTable rows={4} cols={7} />
                          </td>
                        </tr>
                      ) : !balances?.length ? (
                        <tr>
                          <td colSpan={7}>
                            <EmptyState
                              title="No stock records"
                              description="This product has no inventory balances yet."
                            />
                          </td>
                        </tr>
                      ) : (
                        balances.map((bal) => {
                          const available =
                            toFiniteNumber(bal.quantityOnHand) -
                            toFiniteNumber(bal.quantityReserved);
                          return (
                            <tr key={bal.id} className="hover:bg-slate-50">
                              <td className={tdCls}>
                                {bal.branch
                                  ? `${bal.branch.code ? `${bal.branch.code} - ` : ''}${bal.branch.name}`
                                  : 'Company-wide'}
                              </td>
                              <td
                                className={`${tdCls} text-right font-mono ${
                                  toFiniteNumber(bal.quantityOnHand) <= 0
                                    ? 'text-red-600 font-semibold'
                                    : ''
                                }`}
                              >
                                {fmtQty(bal.quantityOnHand)}
                              </td>
                              <td className={`${tdCls} text-right font-mono`}>
                                {fmtQty(bal.quantityReserved)}
                              </td>
                              <td
                                className={`${tdCls} text-right font-mono ${
                                  available <= 0 ? 'text-red-600 font-semibold' : ''
                                }`}
                              >
                                {fmtQty(available)}
                              </td>
                              <td className={`${tdCls} text-right font-mono`}>
                                {fmtTZS(bal.averageCost)}
                              </td>
                              <td className={`${tdCls} text-right font-mono`}>
                                {fmtTZS(bal.totalValue)}
                              </td>
                              <td className={tdCls}>{fmtDate(bal.lastMovementAt)}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {/* ── Movement history ───────────────────────────────────────── */}
          {activeTab === 'movements' && (
            <Card className="overflow-hidden" padding="none">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[900px]">
                  <caption className="sr-only">Inventory movement history for this product</caption>
                  <thead>
                    <tr
                      className="text-left text-xs uppercase bg-gray-50"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      <th scope="col" className={thCls}>
                        Movement #
                      </th>
                      <th scope="col" className={thCls}>
                        Date
                      </th>
                      <th scope="col" className={thCls}>
                        Branch
                      </th>
                      <th scope="col" className={thCls}>
                        Type
                      </th>
                      <th scope="col" className={`${thCls} text-right`}>
                        Quantity
                      </th>
                      <th scope="col" className={`${thCls} text-right`}>
                        Unit Cost
                      </th>
                      <th scope="col" className={`${thCls} text-right`}>
                        Total Cost
                      </th>
                      <th scope="col" className={thCls}>
                        Reference
                      </th>
                      <th scope="col" className={thCls}>
                        By
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {movementsLoading ? (
                      <tr>
                        <td colSpan={9}>
                          <SkeletonTable rows={6} cols={9} />
                        </td>
                      </tr>
                    ) : !movements?.data.length ? (
                      <tr>
                        <td colSpan={9}>
                          <EmptyState
                            title="No movements"
                            description="This product has no recorded stock movements."
                          />
                        </td>
                      </tr>
                    ) : (
                      movements.data.map((mov) => (
                        <tr key={mov.id} className="hover:bg-slate-50">
                          <td className={`${tdCls} font-mono`}>
                            {mov.movementNumber ?? mov.id.slice(0, 8)}
                          </td>
                          <td className={tdCls}>{fmtDate(mov.movementDate)}</td>
                          <td className={tdCls}>
                            {mov.branch
                              ? `${mov.branch.code ? `${mov.branch.code} - ` : ''}${mov.branch.name}`
                              : '—'}
                          </td>
                          <td className={tdCls}>
                            <MovementBadge type={mov.movementType} />
                          </td>
                          <td
                            className={`${tdCls} text-right font-mono ${
                              INBOUND_TYPES.has(mov.movementType)
                                ? 'text-emerald-600'
                                : OUTBOUND_TYPES.has(mov.movementType)
                                  ? 'text-red-600'
                                  : ''
                            }`}
                          >
                            {INBOUND_TYPES.has(mov.movementType)
                              ? '+'
                              : OUTBOUND_TYPES.has(mov.movementType)
                                ? '−'
                                : ''}
                            {fmtQty(mov.quantity)}
                          </td>
                          <td className={`${tdCls} text-right font-mono`}>
                            {fmtTZS(mov.unitCost)}
                          </td>
                          <td className={`${tdCls} text-right font-mono`}>
                            {fmtTZS(mov.totalCost)}
                          </td>
                          <td className={`${tdCls} font-mono text-xs`}>
                            <ReferenceCell mov={mov} />
                          </td>
                          <td className={tdCls}>{mov.createdBy?.fullName ?? '—'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {movements && movements.totalPages > 1 && (
                <div
                  className="px-5 py-3 border-t flex items-center justify-between"
                  style={{ borderColor: 'var(--aurora-border)' }}
                >
                  <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                    Page {movements.page} of {movements.totalPages} · {movements.total} total
                  </span>
                  <div className="flex gap-2">
                    <Btn
                      variant="secondary"
                      size="xs"
                      disabled={movementsPage <= 1}
                      onClick={() => setMovementsPage((p) => p - 1)}
                    >
                      Previous
                    </Btn>
                    <Btn
                      variant="secondary"
                      size="xs"
                      disabled={movementsPage >= movements.totalPages}
                      onClick={() => setMovementsPage((p) => p + 1)}
                    >
                      Next
                    </Btn>
                  </div>
                </div>
              )}
              <div
                className="px-5 py-3 border-t text-right"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <Link
                  href={`/inventory?tab=stock&view=movements${scopedQuery ? `&${scopedQuery.slice(1)}` : ''}`}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Open full ledger →
                </Link>
              </div>
            </Card>
          )}

          {/* ── Profitability ledger ───────────────────────────────────── */}
          {activeTab === 'profitability' && (
            <Card className="overflow-hidden" padding="none">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[820px]">
                  <caption className="sr-only">Per-product profitability ledger</caption>
                  <thead>
                    <tr
                      className="text-left text-xs uppercase bg-gray-50"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      <th scope="col" className={thCls}>
                        Order
                      </th>
                      <th scope="col" className={thCls}>
                        Customer
                      </th>
                      <th scope="col" className={`${thCls} text-right`}>
                        Qty
                      </th>
                      <th scope="col" className={`${thCls} text-right`}>
                        Price
                      </th>
                      <th scope="col" className={`${thCls} text-right`}>
                        Cost
                      </th>
                      <th scope="col" className={`${thCls} text-right`}>
                        Profit
                      </th>
                      <th scope="col" className={`${thCls} text-right`}>
                        Margin
                      </th>
                      <th scope="col" className={thCls}>
                        Cost Source
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ledgerLoading ? (
                      <tr>
                        <td colSpan={8}>
                          <SkeletonTable rows={6} cols={8} />
                        </td>
                      </tr>
                    ) : !ledger?.length ? (
                      <tr>
                        <td colSpan={8}>
                          <EmptyState
                            title="No confirmed sales"
                            description="This product has no confirmed sales in the profit ledger yet."
                          />
                        </td>
                      </tr>
                    ) : (
                      ledger.map((row) => (
                        <tr
                          key={`${row.salesOrderId}-${row.orderDate}`}
                          className="hover:bg-slate-50"
                        >
                          <td className={tdCls}>
                            <Link
                              href={`/operations/sales-orders/${row.salesOrderId}`}
                              className="font-medium text-blue-600 hover:underline"
                            >
                              {row.salesOrderNumber}
                            </Link>
                            <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                              {fmtDate(row.orderDate)}
                            </div>
                          </td>
                          <td className={tdCls}>{row.customerName ?? 'Walk-in'}</td>
                          <td className={`${tdCls} text-right font-mono`}>
                            {fmtQty(row.quantity)}
                          </td>
                          <td className={`${tdCls} text-right font-mono`}>
                            {fmtTZS(row.unitPrice)}
                          </td>
                          <td className={`${tdCls} text-right font-mono`}>
                            {fmtTZS(row.unitCostAtSale)}
                          </td>
                          <td
                            className={`${tdCls} text-right font-mono ${
                              toFiniteNumber(row.grossProfitAmount) >= 0
                                ? 'text-emerald-600'
                                : 'text-red-600'
                            }`}
                          >
                            {fmtTZS(row.grossProfitAmount)}
                          </td>
                          <td className={`${tdCls} text-right font-mono`}>
                            {row.grossMarginPct != null ? `${fmtNum(row.grossMarginPct)}%` : '—'}
                          </td>
                          <td className={tdCls}>
                            {row.profitCostSource?.replace(/_/g, ' ') ?? '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div
                className="px-5 py-3 border-t text-right"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <Link href="/operations/profit" className="text-xs text-blue-600 hover:underline">
                  Open profit module →
                </Link>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
