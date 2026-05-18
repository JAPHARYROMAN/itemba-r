'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatCard, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendList, backendPage } from '@/lib/api-client';

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
type MovementType =
  | 'PURCHASE_RECEIPT'
  | 'SALE_ISSUE'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'OPENING_STOCK'
  | 'DAMAGE'
  | 'WASTAGE'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT';

interface InventoryMovement {
  id: string;
  movementNumber?: string;
  movementDate: string;
  movementType: MovementType;
  quantity: number;
  unitCost: number;
  totalCost: number;
  referenceNumber?: string | null;
  notes?: string | null;
  productId: string;
  companyId: string;
  product?: { name: string; productCode: string } | null;
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

const MOVEMENT_TYPE_STYLES: Record<string, string> = {
  PURCHASE_RECEIPT: 'bg-green-100 text-green-700',
  SALE_ISSUE: 'bg-blue-100 text-blue-700',
  ADJUSTMENT_IN: 'bg-teal-100 text-teal-700',
  ADJUSTMENT_OUT: 'bg-orange-100 text-orange-700',
  OPENING_STOCK: 'bg-purple-100 text-purple-700',
  DAMAGE: 'bg-red-100 text-red-700',
  WASTAGE: 'bg-red-100 text-red-700',
  TRANSFER_IN: 'bg-cyan-100 text-cyan-700',
  TRANSFER_OUT: 'bg-yellow-100 text-yellow-700',
};

const MOVEMENT_TYPES: MovementType[] = [
  'PURCHASE_RECEIPT',
  'SALE_ISSUE',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'OPENING_STOCK',
  'DAMAGE',
  'WASTAGE',
  'TRANSFER_IN',
  'TRANSFER_OUT',
];

function MovementBadge({ type }: { type: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${MOVEMENT_TYPE_STYLES[type] ?? 'bg-slate-100 text-slate-500'}`}
    >
      {type.replace(/_/g, ' ')}
    </span>
  );
}

function fmtNum(n: number | string | null | undefined, decimals = 2) {
  const value = Number(n ?? 0);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number.isFinite(value) ? value : 0);
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InventoryMovementsPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [data, setData] = useState<Paginated<InventoryMovement> | null>(null);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [productId, setProductId] = useState('');
  const [movementType, setMovementType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  const canView = hasPermission('inventory.movements.view');

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
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const result = await backendPage<InventoryMovement>('/inventory-movements', {
        query: {
          page,
          limit: 20,
          companyId: companyId || undefined,
          productId: productId || undefined,
          movementType: movementType || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        },
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inventory movements');
      setData(emptyPaginated<InventoryMovement>(page));
    } finally {
      setLoading(false);
    }
  }, [canView, page, companyId, productId, movementType, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const reset = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Inventory Movements" subtitle="View all stock movements" />
        <div className="mt-8 text-center">
          <p className="text-sm text-slate-500">Access Restricted</p>
        </div>
      </div>
    );
  }

  const rows = data?.data ?? [];
  const totalCost = rows.reduce((s, r) => s + (Number(r.totalCost ?? 0) || 0), 0);

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Inventory Movements" subtitle="Audit trail of all stock movements" />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Movements" value={data?.total ?? 0} />
        <StatCard
          label="Receipts (page)"
          value={rows.filter((r) => r.movementType === 'PURCHASE_RECEIPT').length}
        />
        <StatCard
          label="Issues (page)"
          value={rows.filter((r) => r.movementType === 'SALE_ISSUE').length}
        />
        <StatCard label="Total Cost (page)" value={'TZS ' + fmtNum(totalCost)} />
      </div>

      <Card>
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={companyId}
              onChange={(e) => reset(setCompanyId)(e.target.value)}
              className="text-sm border border-slate-200 rounded-md px-3 py-1.5 bg-white text-slate-700 focus:outline-none"
            >
              <option value="">All Companies</option>
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
            <select
              value={movementType}
              onChange={(e) => reset(setMovementType)(e.target.value)}
              className="text-sm border border-slate-200 rounded-md px-3 py-1.5 bg-white text-slate-700 focus:outline-none"
            >
              <option value="">All Types</option>
              {MOVEMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => reset(setDateFrom)(e.target.value)}
              className="text-sm border border-slate-200 rounded-md px-3 py-1.5 bg-white text-slate-700 focus:outline-none"
              title="Date from"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => reset(setDateTo)(e.target.value)}
              className="text-sm border border-slate-200 rounded-md px-3 py-1.5 bg-white text-slate-700 focus:outline-none"
              title="Date to"
            />
            <div className="ml-auto">
              <span className="text-xs text-slate-400">{data?.total ?? 0} movements</span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className={thCls}>Movement #</th>
                <th className={thCls}>Date</th>
                <th className={thCls}>Product</th>
                <th className={thCls}>Branch / Location</th>
                <th className={thCls}>Type</th>
                <th className={`${thCls} text-right`}>Quantity</th>
                <th className={`${thCls} text-right`}>Unit Cost</th>
                <th className={`${thCls} text-right`}>Total Cost</th>
                <th className={thCls}>Reference</th>
                <th className={thCls}>Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10}>
                    <PageSpinner />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-400">
                    No movements found.
                  </td>
                </tr>
              ) : (
                rows.map((mov) => (
                  <tr key={mov.id} className="hover:bg-slate-50">
                    <td className={`${tdCls} font-mono`}>
                      {mov.movementNumber ?? mov.id.slice(0, 8)}
                    </td>
                    <td className={tdCls}>{fmtDate(mov.movementDate)}</td>
                    <td className={tdCls}>
                      {mov.product ? (
                        <span>
                          <span className="font-mono text-xs text-slate-500">
                            {mov.product.productCode}
                          </span>{' '}
                          {mov.product.name}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={tdCls}>
                      {mov.branch
                        ? `${mov.branch.code ? `${mov.branch.code} - ` : ''}${mov.branch.name}`
                        : '-'}
                    </td>
                    <td className={tdCls}>
                      <MovementBadge type={mov.movementType} />
                    </td>
                    <td className={`${tdCls} text-right font-mono`}>{fmtNum(mov.quantity)}</td>
                    <td className={`${tdCls} text-right font-mono`}>{fmtTZS(mov.unitCost)}</td>
                    <td className={`${tdCls} text-right font-mono`}>{fmtTZS(mov.totalCost)}</td>
                    <td className={`${tdCls} font-mono text-xs`}>{mov.referenceNumber ?? '—'}</td>
                    <td
                      className={`${tdCls} max-w-[160px] truncate`}
                      title={mov.notes ?? undefined}
                    >
                      {mov.notes ?? '—'}
                    </td>
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
