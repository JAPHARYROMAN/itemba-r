'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, StatCard, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendGet, backendList, backendPage } from '@/lib/api-client';
import { toFiniteNumber } from '@/lib/design-system/formatters';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company {
  id: string;
  name: string;
  code: string;
}
interface Product {
  id: string;
  name: string;
  productCode: string;
}
interface InventoryBalance {
  id: string;
  productId: string;
  branchId?: string | null;
  companyId: string;
  quantityOnHand: number;
  quantityReserved: number;
  averageCost: number;
  totalValue: number;
  lastMovementAt?: string | null;
  product?: {
    name: string;
    productCode: string;
    reorderLevel?: number | null;
    minimumStockLevel?: number | null;
  } | null;
  branch?: { name: string; code?: string | null } | null;
  company?: { name: string; code: string } | null;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const tdCls = 'px-4 py-2 text-sm text-slate-700';
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';

function fmtNum(n: number | string | null | undefined, decimals = 2) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(toFiniteNumber(n));
}

function fmtTZS(n: number | string | null | undefined) {
  return 'TZS ' + fmtNum(n);
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function StockBadge({ balance }: { balance: InventoryBalance }) {
  const quantityOnHand = toFiniteNumber(balance.quantityOnHand);
  const available = quantityOnHand - toFiniteNumber(balance.quantityReserved);
  if (quantityOnHand <= 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
        Out of Stock
      </span>
    );
  }
  if (available < 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
        Oversold
      </span>
    );
  }
  const reorderLevel = balance.product?.reorderLevel;
  if (reorderLevel != null && quantityOnHand <= toFiniteNumber(reorderLevel)) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
        Low Stock
      </span>
    );
  }
  return null;
}

// Company-wide totals from /inventory-balances/live (computed with per-product
// reorder thresholds), used to drive the KPI tiles instead of the 20-row page.
interface LiveTotals {
  totalSkus: number;
  out: number;
  low: number;
  negative: number;
  totalValue: number;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InventoryBalancesPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [data, setData] = useState<Paginated<InventoryBalance> | null>(null);
  const [liveTotals, setLiveTotals] = useState<LiveTotals | null>(null);
  const [loading, setLoading] = useState(false);
  const [companyId, setCompanyId] = useState('');
  const [productId, setProductId] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  const canView = hasPermission('inventory.view');

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;

    async function loadLookups() {
      const [companyResult, productResult] = await Promise.allSettled([
        backendList<Company>('/companies', { query: { limit: 100 } }),
        backendList<Product>('/products', { query: { limit: 300 } }),
      ]);
      if (cancelled) return;
      setCompanies(companyResult.status === 'fulfilled' ? companyResult.value : []);
      setProducts(productResult.status === 'fulfilled' ? productResult.value : []);
    }

    void loadLookups();

    return () => {
      cancelled = true;
    };
  }, [canView]);

  const load = useCallback(async () => {
    if (!canView || !companyId) return;
    setLoading(true);
    setError('');
    try {
      const result = await backendPage<InventoryBalance>('/inventory-balances', {
        query: {
          page,
          limit: 20,
          companyId,
          productId: productId || undefined,
          lowStock: lowStock || undefined,
        },
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inventory balances');
      setData(emptyPaginated<InventoryBalance>(page));
    } finally {
      setLoading(false);
    }
  }, [canView, page, companyId, productId, lowStock]);

  useEffect(() => {
    load();
  }, [load]);

  // Company-wide KPI totals (per-product low-stock threshold) — independent of the
  // page filters so the tiles reflect the whole company, not the visible page.
  useEffect(() => {
    if (!canView || !companyId) {
      setLiveTotals(null);
      return;
    }
    let cancelled = false;
    backendGet<{ totals: LiveTotals }>('/inventory-balances/live', { query: { companyId } })
      .then((res) => {
        if (!cancelled) setLiveTotals(res?.totals ?? null);
      })
      .catch(() => {
        if (!cancelled) setLiveTotals(null);
      });
    return () => {
      cancelled = true;
    };
  }, [canView, companyId]);

  useEffect(() => {
    // Drill-through from the operations dashboard "Out of Stock" / "Low Stock"
    // cards (e.g. ?lowStock=1).
    const params = new URLSearchParams(window.location.search);
    if (params.get('lowStock') === '1' || params.get('stock') === 'low') setLowStock(true);
  }, []);

  const reset = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Inventory Balances" subtitle="View stock on hand across branches" />
        <div className="mt-8 text-center">
          <p className="text-sm text-slate-500">Access Restricted</p>
        </div>
      </div>
    );
  }

  const rows = data?.data ?? [];
  const totalValue = rows.reduce((s, r) => s + toFiniteNumber(r.totalValue), 0);
  const outOfStock = rows.filter((r) => toFiniteNumber(r.quantityOnHand) <= 0).length;
  const lowStockCount = rows.filter((r) => {
    const rl = r.product?.reorderLevel;
    const quantityOnHand = toFiniteNumber(r.quantityOnHand);
    return quantityOnHand > 0 && rl != null && quantityOnHand <= toFiniteNumber(rl);
  }).length;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Inventory Balances"
        subtitle="Real-time stock on hand by product and branch/location"
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Lines" value={liveTotals?.totalSkus ?? data?.total ?? 0} />
        <StatCard label="Out of Stock" value={liveTotals?.out ?? outOfStock} />
        <StatCard label="Low Stock" value={liveTotals?.low ?? lowStockCount} />
        <StatCard
          label={liveTotals ? 'Total Value' : 'Total Value (page)'}
          value={'TZS ' + fmtNum(liveTotals?.totalValue ?? totalValue)}
        />
      </div>

      <Card>
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={companyId}
              onChange={(e) => {
                reset(setCompanyId)(e.target.value);
                setPage(1);
              }}
              className="text-sm border border-slate-200 rounded-md px-3 py-1.5 bg-white text-slate-700 focus:outline-none"
            >
              <option value="">Select Company (required)…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={productId}
              onChange={(e) => reset(setProductId)(e.target.value)}
              className="text-sm border border-slate-200 rounded-md px-3 py-1.5 bg-white text-slate-700 focus:outline-none"
            >
              <option value="">All Products</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.productCode} – {p.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={lowStock}
                onChange={(e) => {
                  setLowStock(e.target.checked);
                  setPage(1);
                }}
                className="w-4 h-4 rounded border-slate-300"
              />
              Low stock only
            </label>
            <div className="ml-auto">
              <span className="text-xs text-slate-400">{data?.total ?? 0} records</span>
            </div>
          </div>
          {!companyId && (
            <p className="mt-2 text-xs text-amber-600">
              Please select a company to load inventory balances.
            </p>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className={thCls}>Product Code</th>
                <th className={thCls}>Product Name</th>
                <th className={thCls}>Branch / Location</th>
                <th className={thCls}>Company</th>
                <th className={`${thCls} text-right`}>Qty On Hand</th>
                <th className={`${thCls} text-right`}>Qty Reserved</th>
                <th className={`${thCls} text-right`}>Qty Available</th>
                <th className={`${thCls} text-right`}>Avg Cost</th>
                <th className={`${thCls} text-right`}>Total Value</th>
                <th className={thCls}>Last Movement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10}>
                    <PageSpinner />
                  </td>
                </tr>
              ) : !companyId ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-400">
                    Select a company to view balances.
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-400">
                    No inventory balances found.
                  </td>
                </tr>
              ) : (
                rows.map((bal) => (
                  <tr key={bal.id} className="hover:bg-slate-50">
                    <td className={`${tdCls} font-mono`}>{bal.product?.productCode ?? '—'}</td>
                    <td className={tdCls}>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/operations/inventory-movements?companyId=${encodeURIComponent(bal.companyId)}&productId=${encodeURIComponent(bal.productId)}`}
                          className="text-blue-600 hover:underline"
                          title="View this product's stock movements"
                        >
                          {bal.product?.name ?? '—'}
                        </Link>
                        <StockBadge balance={bal} />
                      </div>
                    </td>
                    <td className={tdCls}>
                      {bal.branch
                        ? `${bal.branch.code ? `${bal.branch.code} - ` : ''}${bal.branch.name}`
                        : '—'}
                    </td>
                    <td className={tdCls}>{bal.company?.name ?? '—'}</td>
                    <td
                      className={`${tdCls} text-right font-mono ${toFiniteNumber(bal.quantityOnHand) <= 0 ? 'text-red-600 font-semibold' : ''}`}
                    >
                      {fmtNum(bal.quantityOnHand)}
                    </td>
                    <td className={`${tdCls} text-right font-mono`}>
                      {fmtNum(bal.quantityReserved)}
                    </td>
                    <td
                      className={`${tdCls} text-right font-mono ${
                        toFiniteNumber(bal.quantityOnHand) - toFiniteNumber(bal.quantityReserved) <= 0
                          ? 'text-red-600 font-semibold'
                          : ''
                      }`}
                    >
                      {fmtNum(
                        toFiniteNumber(bal.quantityOnHand) - toFiniteNumber(bal.quantityReserved),
                      )}
                    </td>
                    <td className={`${tdCls} text-right font-mono`}>{fmtTZS(bal.averageCost)}</td>
                    <td className={`${tdCls} text-right font-mono`}>{fmtTZS(bal.totalValue)}</td>
                    <td className={tdCls}>{fmtDate(bal.lastMovementAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {data && data.totalPages > 1 && (
          <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-400">
              Page {page} of {data.totalPages}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="text-xs px-3 py-1.5 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
              >
                Previous
              </button>
              <button
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="text-xs px-3 py-1.5 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
