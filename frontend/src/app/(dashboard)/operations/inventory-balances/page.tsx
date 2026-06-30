'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Btn, Card, PageHeader, PageToolbar, ProductPicker, StatCard, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendGet, backendList, backendPage } from '@/lib/api-client';
import { toFiniteNumber } from '@/lib/design-system/formatters';
import { rowsToCsv, downloadTextFile } from '@/lib/report-export';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company {
  id: string;
  name: string;
  code: string;
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

const tdCls = 'px-4 py-3 text-sm';
const thCls = 'px-4 py-3';
const filterSelectCls =
  'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
const filterStyle = {
  borderColor: 'var(--aurora-border)',
  background: 'var(--aurora-card)',
  color: 'var(--aurora-text)',
} as const;

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

function stockStatus(balance: InventoryBalance): string {
  const quantityOnHand = toFiniteNumber(balance.quantityOnHand);
  const available = quantityOnHand - toFiniteNumber(balance.quantityReserved);
  if (quantityOnHand <= 0) return 'Out of Stock';
  if (available < 0) return 'Oversold';
  const reorderLevel = balance.product?.reorderLevel;
  if (reorderLevel != null && quantityOnHand <= toFiniteNumber(reorderLevel)) return 'Low Stock';
  return 'In Stock';
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
      const companyResult = await backendList<Company>('/companies', {
        query: { limit: 100 },
      }).catch(() => [] as Company[]);
      if (cancelled) return;
      setCompanies(companyResult);
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

  const exportCsv = () => {
    const exportRows = (data?.data ?? []).map((bal) => ({
      'Product Code': bal.product?.productCode ?? '',
      'Product Name': bal.product?.name ?? '',
      'Branch / Location': bal.branch
        ? `${bal.branch.code ? `${bal.branch.code} - ` : ''}${bal.branch.name}`
        : '',
      Company: bal.company?.name ?? '',
      Status: stockStatus(bal),
      'Qty On Hand': fmtNum(bal.quantityOnHand),
      'Qty Reserved': fmtNum(bal.quantityReserved),
      'Qty Available': fmtNum(
        toFiniteNumber(bal.quantityOnHand) - toFiniteNumber(bal.quantityReserved),
      ),
      'Avg Cost': fmtNum(bal.averageCost),
      'Total Value': fmtNum(bal.totalValue),
      'Last Movement': fmtDate(bal.lastMovementAt),
    }));
    const csv = rowsToCsv(exportRows as Record<string, unknown>[]);
    if (!csv) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(`inventory-balances-${stamp}.csv`, 'text/csv;charset=utf-8', csv);
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

      <PageToolbar
        actions={
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              {data?.total ?? 0} records
            </span>
            <Btn
              variant="secondary"
              size="xs"
              onClick={exportCsv}
              disabled={!rows.length}
              aria-label="Export filtered inventory balances to CSV"
            >
              Export CSV
            </Btn>
          </div>
        }
        filters={
          <>
            <select
              value={companyId}
              onChange={(e) => {
                reset(setCompanyId)(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
              aria-label="Filter by company"
            >
              <option value="">Select Company (required)…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <ProductPicker
              value={productId}
              onChange={(id) => reset(setProductId)(id)}
              companyId={companyId}
              placeholder="All products"
              className="w-56"
            />
            <label
              className="flex items-center gap-1.5 text-sm cursor-pointer"
              style={{ color: 'var(--aurora-text-secondary)' }}
            >
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
          </>
        }
      />

      {!companyId && (
        <p className="-mt-2 text-xs text-amber-600">
          Please select a company to load inventory balances.
        </p>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <caption className="sr-only">
              Inventory balances by product and branch/location
            </caption>
            <thead>
              <tr
                className="text-left text-xs uppercase bg-gray-50"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th scope="col" className={thCls}>Product Code</th>
                <th scope="col" className={thCls}>Product Name</th>
                <th scope="col" className={thCls}>Branch / Location</th>
                <th scope="col" className={thCls}>Company</th>
                <th scope="col" className={`${thCls} text-right`}>Qty On Hand</th>
                <th scope="col" className={`${thCls} text-right`}>Qty Reserved</th>
                <th scope="col" className={`${thCls} text-right`}>Qty Available</th>
                <th scope="col" className={`${thCls} text-right`}>Avg Cost</th>
                <th scope="col" className={`${thCls} text-right`}>Total Value</th>
                <th scope="col" className={thCls}>Last Movement</th>
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
          <div
            className="px-5 py-3 border-t flex items-center justify-between"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Page {page} of {data.totalPages} · {data.total} total
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
