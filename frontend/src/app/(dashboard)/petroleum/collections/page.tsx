'use client';

/**
 * Petroleum → Collections page.
 *
 * Single page that shows every fuel-shift collection captured at any branch
 * a user has access to, with filtering by:
 *   - Company / branch (CompanyBranchPicker)
 *   - Collection type (CASH / MOBILE_MONEY / BANK_CARD / BANK_DEPOSIT /
 *     CREDIT_SALE / VOUCHER / OTHER)
 *   - Date range (dateFrom / dateTo on createdAt)
 *   - Free-text search (matches reference, notes, shift number)
 *
 * Stats card at the top sums the same `where` clause that paginates the
 * table, so the totals always reflect the active filter.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui';
import { CompanyBranchPicker } from '@/components/petroleum/CompanyBranchPicker';

// ─── Types ────────────────────────────────────────────────────────────────────

type CollectionType =
  | 'CASH'
  | 'MOBILE_MONEY'
  | 'BANK_CARD'
  | 'BANK_DEPOSIT'
  | 'CREDIT_SALE'
  | 'VOUCHER'
  | 'OTHER';

interface ShiftCollection {
  id: string;
  fuelShiftId: string;
  collectionType: CollectionType;
  amount: number | string;
  reference?: string | null;
  notes?: string | null;
  cashAccountId?: string | null;
  collectedById?: string | null;
  createdAt: string;
  fuelShift?: {
    id: string;
    shiftNumber: string;
    shiftDate: string;
    status: string;
  } | null;
  branch?: { id: string; name: string; branchCode: string } | null;
  cashAccount?: { id: string; accountName: string; accountType: string } | null;
  collectedBy?: { id: string; fullName: string; email?: string } | null;
}

interface ListResponse {
  data: ShiftCollection[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  totals: {
    amount: number;
    byType: Array<{ collectionType: CollectionType; count: number; amount: number }>;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fieldCls =
  'w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const thCls =
  'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const TYPE_OPTIONS: Array<{ value: '' | CollectionType; label: string }> = [
  { value: '', label: '— All types —' },
  { value: 'CASH', label: 'Cash' },
  { value: 'MOBILE_MONEY', label: 'Mobile Money' },
  { value: 'BANK_CARD', label: 'Bank Card' },
  { value: 'BANK_DEPOSIT', label: 'Bank Deposit' },
  { value: 'CREDIT_SALE', label: 'Credit Sale' },
  { value: 'VOUCHER', label: 'Voucher' },
  { value: 'OTHER', label: 'Other' },
];

const TYPE_PILL: Record<CollectionType, string> = {
  CASH: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  MOBILE_MONEY: 'bg-amber-50 text-amber-700 border-amber-200',
  BANK_CARD: 'bg-sky-50 text-sky-700 border-sky-200',
  BANK_DEPOSIT: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  CREDIT_SALE: 'bg-rose-50 text-rose-700 border-rose-200',
  VOUCHER: 'bg-violet-50 text-violet-700 border-violet-200',
  OTHER: 'bg-zinc-100 text-zinc-600 border-zinc-200',
};

function TypeBadge({ type }: { type: CollectionType }) {
  return (
    <span
      className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${TYPE_PILL[type] ?? TYPE_PILL.OTHER}`}
    >
      {type.replace(/_/g, ' ')}
    </span>
  );
}

function fmtNum(n: number | string) {
  const v = typeof n === 'string' ? Number(n) : n;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(v) ? v : 0);
}

function fmtDateTime(d: string) {
  const dt = new Date(d);
  return dt.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

// 30-day default window so the page lands on something useful when first opened.
function defaultDateRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today.getTime() - 30 * 24 * 3600 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(today) };
}

export default function CollectionsPage() {
  const initialRange = defaultDateRange();

  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [collectionType, setCollectionType] = useState<'' | CollectionType>('');
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!companyId) {
      setResult(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        companyId,
      });
      if (branchId) params.set('branchId', branchId);
      if (collectionType) params.set('collectionType', collectionType);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`/api/backend/petroleum/fuel-shift-collections?${params}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? `Failed to load collections (HTTP ${res.status})`);
      }
      const json = await res.json();
      const payload: ListResponse = json.data ?? json;
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load collections');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, branchId, collectionType, dateFrom, dateTo, search, page]);

  useEffect(() => {
    load();
  }, [load]);

  // Whenever a non-page filter changes, reset to page 1 so the operator
  // doesn't end up on an out-of-range page after narrowing the result set.
  useEffect(() => {
    setPage(1);
  }, [companyId, branchId, collectionType, dateFrom, dateTo, search]);

  const total = result?.total ?? 0;
  const totalPages = result?.totalPages ?? 1;
  const data = result?.data ?? [];
  const totals = result?.totals;

  const exportCsv = () => {
    if (!data.length) return;
    const header = [
      'Created',
      'Shift #',
      'Shift Date',
      'Branch',
      'Type',
      'Amount',
      'Reference',
      'Cash Account',
      'Collected By',
      'Notes',
    ];
    const rows = data.map((c) => [
      fmtDateTime(c.createdAt),
      c.fuelShift?.shiftNumber ?? '',
      c.fuelShift ? fmtDate(c.fuelShift.shiftDate) : '',
      c.branch?.name ?? '',
      c.collectionType,
      String(Number(c.amount).toFixed(2)),
      c.reference ?? '',
      c.cashAccount?.accountName ?? '',
      c.collectedBy?.fullName ?? '',
      (c.notes ?? '').replace(/[\r\n]+/g, ' '),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `collections-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="Shift Collections"
          subtitle="All payments captured against fuel shifts — cash, mobile money, card, deposit, credit"
        />
        <button
          onClick={exportCsv}
          disabled={!data.length}
          className="text-sm bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 px-4 py-2 rounded-md font-medium border border-slate-200"
        >
          Export CSV
        </button>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <Card className="p-4">
        <div className="space-y-3">
          <CompanyBranchPicker
            companyId={companyId}
            branchId={branchId}
            onCompanyChange={setCompanyId}
            onBranchChange={setBranchId}
            allBranchesLabel="All branches (every station)"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className={labelCls}>Collection Type</label>
              <select
                value={collectionType}
                onChange={(e) => setCollectionType(e.target.value as '' | CollectionType)}
                className={fieldCls}
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Date From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className={fieldCls}
              />
            </div>
            <div>
              <label className={labelCls}>Date To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className={fieldCls}
              />
            </div>
            <div>
              <label className={labelCls}>Search</label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={fieldCls}
                placeholder="Reference, note, shift #…"
              />
            </div>
          </div>
        </div>
      </Card>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Card className="p-3">
            <div className="text-xs text-slate-500">Total Collections</div>
            <div className="text-xl font-bold text-slate-900 mt-1">
              {fmtNum(totals.amount)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {total.toLocaleString()} record{total === 1 ? '' : 's'}
            </div>
          </Card>
          {(['CASH', 'MOBILE_MONEY', 'BANK_CARD', 'CREDIT_SALE'] as const).map((t) => {
            const row = totals.byType.find((x) => x.collectionType === t);
            return (
              <Card key={t} className="p-3">
                <div className="text-xs text-slate-500">
                  <TypeBadge type={t} />
                </div>
                <div className="text-lg font-semibold text-slate-900 mt-1 font-mono">
                  {fmtNum(row?.amount ?? 0)}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {(row?.count ?? 0).toLocaleString()} record
                  {(row?.count ?? 0) === 1 ? '' : 's'}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {loading && <Spinner />}

      {/* ── Empty / Picker prompt ─────────────────────────────────────────── */}
      {!companyId && !loading && (
        <div className="text-center py-10 text-sm text-slate-400">
          Select a company to view collections.
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {!loading && companyId && (
        <Card className="overflow-hidden">
          {data.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">
              No collections match the current filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>Recorded</th>
                    <th className={thCls}>Shift</th>
                    <th className={thCls}>Branch</th>
                    <th className={thCls}>Type</th>
                    <th className={`${thCls} text-right`}>Amount</th>
                    <th className={thCls}>Reference</th>
                    <th className={thCls}>Cash Account</th>
                    <th className={thCls}>Collected By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} whitespace-nowrap`}>
                        {fmtDateTime(c.createdAt)}
                      </td>
                      <td className={tdCls}>
                        {c.fuelShift ? (
                          <Link
                            href={`/petroleum/fuel-shifts/${c.fuelShift.id}`}
                            className="text-indigo-600 hover:text-indigo-800 hover:underline font-medium"
                          >
                            {c.fuelShift.shiftNumber}
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                        {c.fuelShift && (
                          <div className="text-[11px] text-slate-400">
                            {fmtDate(c.fuelShift.shiftDate)} · {c.fuelShift.status}
                          </div>
                        )}
                      </td>
                      <td className={tdCls}>
                        {c.branch ? (
                          <>
                            {c.branch.name}
                            <div className="text-[11px] text-slate-400">
                              {c.branch.branchCode}
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className={tdCls}>
                        <TypeBadge type={c.collectionType} />
                      </td>
                      <td className={`${tdCls} text-right font-mono whitespace-nowrap`}>
                        {fmtNum(c.amount)}
                      </td>
                      <td className={`${tdCls} max-w-[200px] truncate`} title={c.reference ?? ''}>
                        {c.reference ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td className={tdCls}>
                        {c.cashAccount?.accountName ?? (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className={tdCls}>
                        {c.collectedBy?.fullName ?? (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {totals && (
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-50">
                      <td
                        colSpan={4}
                        className="px-4 py-2 text-xs font-semibold text-slate-600 uppercase"
                      >
                        Page total ({data.length} of {total.toLocaleString()})
                      </td>
                      <td className="px-4 py-2 text-right text-sm font-bold text-slate-900 font-mono">
                        {fmtNum(
                          data.reduce((s, c) => s + Number(c.amount || 0), 0),
                        )}
                      </td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {/* ── Pagination ─────────────────────────────────────────────── */}
          {data.length > 0 && totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 text-sm">
              <span className="text-slate-500">
                Page {page} of {totalPages} · {total.toLocaleString()} record
                {total === 1 ? '' : 's'}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
