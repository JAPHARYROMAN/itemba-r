'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Btn,
  Card,
  PageHeader,
  PageToolbar,
  ProductPicker,
  StatCard,
  SkeletonTable,
  EmptyState,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendList, backendPage } from '@/lib/api-client';
import { rowsToCsv, downloadTextFile } from '@/lib/report-export';
import { downloadTablePdf } from '@/lib/export-download';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company {
  id: string;
  name: string;
  code: string;
}
interface Branch {
  id: string;
  name: string;
  code?: string | null;
}
type MovementType =
  | 'OPENING_STOCK'
  | 'PURCHASE_RECEIPT'
  | 'SALE_ISSUE'
  | 'SALES_RETURN'
  | 'PURCHASE_RETURN'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'DAMAGE'
  | 'WASTAGE'
  | 'INTERNAL_USE'
  | 'PRODUCTION_IN'
  | 'PRODUCTION_OUT'
  | 'OTHER';

// Direction sets mirror the backend (inventory-movements.service.ts INBOUND/OUTBOUND_TYPES).
const INBOUND_TYPES = new Set<MovementType>([
  'OPENING_STOCK',
  'PURCHASE_RECEIPT',
  'SALES_RETURN',
  'TRANSFER_IN',
  'ADJUSTMENT_IN',
  'PRODUCTION_IN',
]);
const OUTBOUND_TYPES = new Set<MovementType>([
  'SALE_ISSUE',
  'PURCHASE_RETURN',
  'TRANSFER_OUT',
  'ADJUSTMENT_OUT',
  'DAMAGE',
  'WASTAGE',
  'INTERNAL_USE',
  'PRODUCTION_OUT',
]);

interface InventoryMovement {
  id: string;
  movementNumber?: string;
  movementDate: string;
  movementType: MovementType;
  quantity: number;
  unitCost: number;
  totalCost: number;
  referenceNumber?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  notes?: string | null;
  productId: string;
  companyId: string;
  product?: { name: string; productCode: string } | null;
  branch?: { name: string; code?: string | null } | null;
  company?: { name: string; code: string } | null;
  createdBy?: { fullName: string } | null;
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

const MOVEMENT_TYPES: MovementType[] = [
  'OPENING_STOCK',
  'PURCHASE_RECEIPT',
  'SALE_ISSUE',
  'SALES_RETURN',
  'PURCHASE_RETURN',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'DAMAGE',
  'WASTAGE',
  'INTERNAL_USE',
  'PRODUCTION_IN',
  'PRODUCTION_OUT',
  'OTHER',
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

// Source documents that have a per-id detail route today. Others (StockAdjustment,
// PurchaseOrder, GoodsReceivedNote) are shown as a readable label until their
// detail routes land in later tickets.
const REFERENCE_ROUTES: Record<string, (id: string) => string> = {
  SalesOrder: (id) => `/operations/sales-orders/${id}`,
};

function ReferenceCell({ mov }: { mov: InventoryMovement }) {
  if (!mov.referenceType || !mov.referenceId) {
    return <span className="text-slate-400">—</span>;
  }
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InventoryMovementsPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [data, setData] = useState<Paginated<InventoryMovement> | null>(null);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [productId, setProductId] = useState('');
  const [movementType, setMovementType] = useState('');
  const [referenceType, setReferenceType] = useState('');
  const [referenceId, setReferenceId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);

  const canView = hasPermission('inventory.movements.view');

  useEffect(() => {
    // Drill-through: hydrate filters from the URL — e.g. a balance row links here
    // with ?companyId&productId, and a source document with ?referenceType&referenceId.
    const params = new URLSearchParams(window.location.search);
    const get = (k: string) => params.get(k) ?? '';
    if (get('companyId')) setCompanyId(get('companyId'));
    if (get('productId')) setProductId(get('productId'));
    if (get('movementType')) setMovementType(get('movementType'));
    if (get('referenceType')) setReferenceType(get('referenceType'));
    if (get('referenceId')) setReferenceId(get('referenceId'));
    if (get('locationId')) setLocationId(get('locationId'));
  }, []);

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

  // Branches for the selected company (the branch/location filter).
  useEffect(() => {
    if (!canView || !companyId) {
      setBranches([]);
      return;
    }
    let cancelled = false;
    backendList<Branch>('/branches', {
      query: { companyId, activeOnly: true, limit: 200 },
    })
      .then((rows) => {
        if (!cancelled) setBranches(rows);
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
      const result = await backendPage<InventoryMovement>('/inventory-movements', {
        query: {
          page,
          limit: 20,
          companyId: companyId || undefined,
          locationId: locationId || undefined,
          productId: productId || undefined,
          movementType: movementType || undefined,
          referenceType: referenceType || undefined,
          referenceId: referenceId || undefined,
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
  }, [
    canView,
    page,
    companyId,
    locationId,
    productId,
    movementType,
    referenceType,
    referenceId,
    dateFrom,
    dateTo,
  ]);

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

  const buildExportRows = (): Record<string, string>[] =>
    rows.map((mov) => ({
      'Movement #': mov.movementNumber ?? mov.id.slice(0, 8),
      Date: fmtDate(mov.movementDate),
      'Product Code': mov.product?.productCode ?? '',
      Product: mov.product?.name ?? '',
      Branch: mov.branch
        ? `${mov.branch.code ? `${mov.branch.code} - ` : ''}${mov.branch.name}`
        : '',
      Type: mov.movementType.replace(/_/g, ' '),
      Quantity: fmtNum(mov.quantity),
      'Unit Cost': fmtNum(mov.unitCost),
      'Total Cost': fmtNum(mov.totalCost),
      Reference:
        mov.referenceType && mov.referenceId
          ? `${mov.referenceType} ${mov.referenceId}`
          : '',
      By: mov.createdBy?.fullName ?? '',
      Notes: mov.notes ?? '',
    }));

  const exportCsv = () => {
    const csv = rowsToCsv(buildExportRows());
    if (!csv) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(`inventory-movements-${stamp}.csv`, 'text/csv;charset=utf-8', csv);
  };

  const exportPdf = async () => {
    const exportRows = buildExportRows();
    if (!exportRows.length) return;
    const columns = Object.keys(exportRows[0]);
    const subtitle =
      [
        companyId ? companies.find((c) => c.id === companyId)?.name : '',
        locationId
          ? branches.find((b) => b.id === locationId)?.name ?? ''
          : '',
        movementType ? movementType.replace(/_/g, ' ') : '',
        dateFrom ? `From ${dateFrom}` : '',
        dateTo ? `To ${dateTo}` : '',
      ]
        .filter(Boolean)
        .join(' · ') || undefined;
    setExportingPdf(true);
    try {
      await downloadTablePdf({
        title: 'Inventory Movements',
        subtitle,
        companyId: companyId || undefined,
        columns,
        rows: exportRows.map((r) => columns.map((c) => r[c] ?? '')),
        numericColumns: [6, 7, 8],
        baseName: 'inventory-movements',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export PDF');
    } finally {
      setExportingPdf(false);
    }
  };

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

      <PageToolbar
        actions={
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              {data?.total ?? 0} movements
            </span>
            <Btn
              variant="secondary"
              size="xs"
              onClick={exportCsv}
              disabled={rows.length === 0}
              aria-label="Export filtered movements to CSV"
            >
              Export CSV
            </Btn>
            <Btn
              variant="secondary"
              size="xs"
              onClick={exportPdf}
              disabled={rows.length === 0 || exportingPdf}
              aria-label="Export filtered movements to PDF"
            >
              {exportingPdf ? 'Exporting…' : 'Export PDF'}
            </Btn>
          </div>
        }
        filters={
          <>
            <select
              value={companyId}
              onChange={(e) => {
                setLocationId('');
                reset(setCompanyId)(e.target.value);
              }}
              className={filterSelectCls}
              style={filterStyle}
              aria-label="Filter by company"
            >
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={locationId}
              onChange={(e) => reset(setLocationId)(e.target.value)}
              disabled={!companyId}
              title="Branch / location"
              className={`${filterSelectCls} disabled:opacity-50`}
              style={filterStyle}
              aria-label="Filter by branch or location"
            >
              <option value="">All Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code ? `${b.code} - ${b.name}` : b.name}
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
            <select
              value={movementType}
              onChange={(e) => reset(setMovementType)(e.target.value)}
              className={filterSelectCls}
              style={filterStyle}
              aria-label="Filter by movement type"
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
              className={filterSelectCls}
              style={filterStyle}
              title="Date from"
              aria-label="Date from"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => reset(setDateTo)(e.target.value)}
              className={filterSelectCls}
              style={filterStyle}
              title="Date to"
              aria-label="Date to"
            />
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <caption className="sr-only">Inventory movements audit trail</caption>
            <thead>
              <tr
                className="text-left text-xs uppercase bg-gray-50"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th scope="col" className={thCls}>Movement #</th>
                <th scope="col" className={thCls}>Date</th>
                <th scope="col" className={thCls}>Product</th>
                <th scope="col" className={thCls}>Branch / Location</th>
                <th scope="col" className={thCls}>Type</th>
                <th scope="col" className={`${thCls} text-right`}>Quantity</th>
                <th scope="col" className={`${thCls} text-right`}>Unit Cost</th>
                <th scope="col" className={`${thCls} text-right`}>Total Cost</th>
                <th scope="col" className={thCls}>Reference</th>
                <th scope="col" className={thCls}>By</th>
                <th scope="col" className={thCls}>Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={11} className="p-4">
                    <SkeletonTable rows={6} cols={11} />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={11}>
                    <EmptyState
                      title="No movements found"
                      description="No stock movements match the current filters."
                    />
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
                      {fmtNum(mov.quantity)}
                    </td>
                    <td className={`${tdCls} text-right font-mono`}>{fmtTZS(mov.unitCost)}</td>
                    <td className={`${tdCls} text-right font-mono`}>{fmtTZS(mov.totalCost)}</td>
                    <td className={`${tdCls} font-mono text-xs`}>
                      <ReferenceCell mov={mov} />
                    </td>
                    <td className={tdCls}>{mov.createdBy?.fullName ?? '—'}</td>
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
