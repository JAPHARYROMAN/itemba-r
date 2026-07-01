'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Card, PageHeader, SkeletonCardGrid, StatCard, showToast } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company {
  id: string;
  name: string;
  code: string;
}

interface DashboardData {
  totalIncome: number;
  totalExpenses: number;
  netPosition: number;
  cashBalance: number;
  receivables: { open: number; overdue: number; total: number };
  payables: { open: number; overdue: number; total: number };
  openExpenses: number;
  pendingApprovals: number;
  intercompany: { fromTotal: number; toTotal: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTZS(n: number | string | null | undefined) {
  const value = Number(n ?? 0);
  return (
    'TZS ' +
    new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      Number.isFinite(value) ? value : 0,
    )
  );
}

/** Compact TZS for terse subtitles/context lines (e.g. "TZS 1.2M"). */
function compactTZS(n: number | string | null | undefined) {
  const value = Number(n ?? 0);
  const num = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(num);
  if (abs >= 1_000_000_000) return `TZS ${(num / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `TZS ${(num / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `TZS ${(num / 1_000).toFixed(1)}K`;
  return fmtTZS(num);
}

/** Percentage of `part` over `whole`, guarded against divide-by-zero. */
function pct(part: number, whole: number) {
  if (!Number.isFinite(whole) || whole === 0) return 0;
  return Math.round((part / whole) * 100);
}

/**
 * Wraps a StatCard in a click-through Link to a (optionally filtered) list.
 * Keeps the company scope in the query so the destination stays in context.
 */
function StatLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 aurora-transition hover:-translate-y-0.5 hover:shadow-md"
    >
      {children}
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FinanceDashboardPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canView = hasPermission('finance.view');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) =>
        setCompanies(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      );
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (companyId) params.set('companyId', companyId);
      const res = await fetch(`/api/backend/finance/dashboard?${params}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(`HTTP ${res.status}: ${errJson?.message ?? 'Failed to load dashboard'}`);
      }
      const json = await res.json();
      // Response is a single DashboardData object (not paginated). Unwrap the
      // standard envelope `{ data: ... }` if present, otherwise use the body.
      const payload = json?.data ?? json;
      setData(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error loading dashboard';
      setError(message);
      showToast('error', 'Finance dashboard unavailable', message);
    } finally {
      setLoading(false);
    }
  }, [canView, companyId]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Preserve the selected company scope when navigating into list pages so the
  // destination stays in the same context the user was reading here.
  const scopeQuery = (extra?: Record<string, string>) => {
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', companyId);
    for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Finance Dashboard" subtitle="Finance overview" />
        <div className="mt-8 flex flex-col items-center gap-3 text-center">
          <p className="text-sm font-medium text-slate-600">Access Restricted</p>
          <p className="text-xs text-slate-400 max-w-sm">
            You do not have permission to view finance data.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Finance Dashboard" subtitle="Financial overview across the group" />
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          <option value="">All Companies (Group View)</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <SkeletonCardGrid
          count={5}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
        />
      ) : data ? (
        <div className="space-y-6">
          <div className="aurora-stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            <StatLink href={`/finance/reports${scopeQuery()}`}>
              <StatCard
                label="Total Income"
                value={fmtTZS(data.totalIncome)}
                variant="green"
                hint="Recognised inflows to date"
              />
            </StatLink>
            <StatLink href={`/finance/expenses${scopeQuery()}`}>
              <StatCard
                label="Total Expenses"
                value={fmtTZS(data.totalExpenses)}
                variant="amber"
                hint={
                  data.totalIncome > 0
                    ? `${pct(data.totalExpenses, data.totalIncome)}% of income`
                    : 'Recognised outflows to date'
                }
              />
            </StatLink>
            <StatLink href={`/finance/reports${scopeQuery()}`}>
              <StatCard
                label="Net Position"
                value={fmtTZS(data.netPosition)}
                variant={
                  data.netPosition > 0 ? 'green' : data.netPosition < 0 ? 'red' : 'default'
                }
                tier={data.netPosition < 0 ? 'critical' : 'default'}
                hint={
                  data.totalIncome > 0
                    ? `${data.netPosition >= 0 ? 'Surplus' : 'Deficit'} · ${pct(
                        data.netPosition,
                        data.totalIncome,
                      )}% margin`
                    : data.netPosition >= 0
                      ? 'Surplus'
                      : 'Deficit'
                }
              />
            </StatLink>
            <StatLink href={`/finance/cash-accounts${scopeQuery()}`}>
              <StatCard
                label="Cash Balance"
                value={fmtTZS(data.cashBalance)}
                variant={data.cashBalance < 0 ? 'red' : 'blue'}
                hint="Across active cash accounts"
              />
            </StatLink>
            <StatLink href={`/finance/expenses${scopeQuery({ status: 'APPROVED' })}`}>
              <StatCard
                label="Open Expenses"
                value={data.openExpenses}
                variant={data.openExpenses > 0 ? 'amber' : 'default'}
                hint={data.openExpenses > 0 ? 'Awaiting processing →' : 'All processed'}
              />
            </StatLink>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card
              className={`p-5 ${data.receivables.overdue > 0 ? 'border-red-200' : ''}`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Receivables
                </span>
                <Link
                  href={`/finance/receivables${scopeQuery()}`}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                >
                  View all →
                </Link>
              </div>
              <div className="space-y-2">
                <Link
                  href={`/finance/receivables${scopeQuery({ status: 'OPEN' })}`}
                  className="flex justify-between text-sm rounded-md -mx-1 px-1 py-0.5 hover:bg-slate-50"
                >
                  <span className="text-slate-600">Open Count</span>
                  <span className="font-semibold text-slate-800">{data.receivables.open}</span>
                </Link>
                <Link
                  href={`/finance/receivables${scopeQuery()}`}
                  className={`flex justify-between text-sm rounded-md -mx-1 px-1 py-0.5 ${
                    data.receivables.overdue > 0 ? 'hover:bg-red-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <span className={data.receivables.overdue > 0 ? 'text-red-500' : 'text-slate-600'}>
                    Overdue Count
                  </span>
                  <span
                    className={`font-semibold ${
                      data.receivables.overdue > 0 ? 'text-red-600' : 'text-slate-800'
                    }`}
                  >
                    {data.receivables.overdue}
                  </span>
                </Link>
                <div className="flex justify-between text-sm border-t border-slate-100 pt-2">
                  <span className="text-slate-500">Total</span>
                  <span className="font-bold text-slate-900">{fmtTZS(data.receivables.total)}</span>
                </div>
                {data.receivables.open > 0 && (
                  <p className="text-[11px] text-slate-400 pt-1">
                    {pct(data.receivables.overdue, data.receivables.open)}% of open receivables are
                    overdue
                  </p>
                )}
              </div>
            </Card>

            <Card className={`p-5 ${data.payables.overdue > 0 ? 'border-red-200' : ''}`}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Payables
                </span>
                <Link
                  href={`/finance/payables${scopeQuery()}`}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                >
                  View all →
                </Link>
              </div>
              <div className="space-y-2">
                <Link
                  href={`/finance/payables${scopeQuery({ status: 'OPEN' })}`}
                  className="flex justify-between text-sm rounded-md -mx-1 px-1 py-0.5 hover:bg-slate-50"
                >
                  <span className="text-slate-600">Open Count</span>
                  <span className="font-semibold text-slate-800">{data.payables.open}</span>
                </Link>
                <Link
                  href={`/finance/payables${scopeQuery()}`}
                  className={`flex justify-between text-sm rounded-md -mx-1 px-1 py-0.5 ${
                    data.payables.overdue > 0 ? 'hover:bg-red-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <span className={data.payables.overdue > 0 ? 'text-red-500' : 'text-slate-600'}>
                    Overdue Count
                  </span>
                  <span
                    className={`font-semibold ${
                      data.payables.overdue > 0 ? 'text-red-600' : 'text-slate-800'
                    }`}
                  >
                    {data.payables.overdue}
                  </span>
                </Link>
                <div className="flex justify-between text-sm border-t border-slate-100 pt-2">
                  <span className="text-slate-500">Total</span>
                  <span className="font-bold text-slate-900">{fmtTZS(data.payables.total)}</span>
                </div>
                {data.payables.open > 0 && (
                  <p className="text-[11px] text-slate-400 pt-1">
                    {pct(data.payables.overdue, data.payables.open)}% of open payables are overdue
                  </p>
                )}
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Inter-Company
                </span>
                <Link
                  href={`/finance/intercompany${scopeQuery()}`}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                >
                  View all →
                </Link>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">From (Receivable)</span>
                  <span className="font-semibold text-slate-800">
                    {fmtTZS(data.intercompany.fromTotal)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">To (Payable)</span>
                  <span className="font-semibold text-slate-800">
                    {fmtTZS(data.intercompany.toTotal)}
                  </span>
                </div>
                <div className="flex justify-between text-sm border-t border-slate-100 pt-2">
                  <span className={data.pendingApprovals > 0 ? 'text-amber-600' : 'text-slate-500'}>
                    Pending Approvals
                  </span>
                  <span
                    className={`font-bold ${
                      data.pendingApprovals > 0 ? 'text-amber-700' : 'text-slate-900'
                    }`}
                  >
                    {data.pendingApprovals}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 pt-1">
                  Net intercompany:{' '}
                  {compactTZS(data.intercompany.fromTotal - data.intercompany.toTotal)}
                </p>
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <div className="text-center py-10 text-sm text-slate-400">No data available</div>
      )}
    </div>
  );
}
