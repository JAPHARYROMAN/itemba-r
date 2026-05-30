'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatCard, PageSpinner } from '@/components/ui';
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
      setError(err instanceof Error ? err.message : 'Error loading dashboard');
    } finally {
      setLoading(false);
    }
  }, [canView, companyId]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

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
        <PageSpinner />
      ) : data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            <StatCard label="Total Income" value={fmtTZS(data.totalIncome)} />
            <StatCard label="Total Expenses" value={fmtTZS(data.totalExpenses)} />
            <StatCard
              label="Net Position"
              value={fmtTZS(data.netPosition)}
              hint={data.netPosition >= 0 ? 'Surplus' : 'Deficit'}
            />
            <StatCard label="Cash Balance" value={fmtTZS(data.cashBalance)} />
            <StatCard label="Open Expenses" value={data.openExpenses} hint="Awaiting processing" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Receivables
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Open Count</span>
                  <span className="font-semibold text-slate-800">{data.receivables.open}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-red-500">Overdue Count</span>
                  <span className="font-semibold text-red-600">{data.receivables.overdue}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-slate-100 pt-2">
                  <span className="text-slate-500">Total</span>
                  <span className="font-bold text-slate-900">{fmtTZS(data.receivables.total)}</span>
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Payables
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Open Count</span>
                  <span className="font-semibold text-slate-800">{data.payables.open}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-red-500">Overdue Count</span>
                  <span className="font-semibold text-red-600">{data.payables.overdue}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-slate-100 pt-2">
                  <span className="text-slate-500">Total</span>
                  <span className="font-bold text-slate-900">{fmtTZS(data.payables.total)}</span>
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Inter-Company
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
                  <span className="text-slate-500">Pending Approvals</span>
                  <span className="font-bold text-slate-900">{data.pendingApprovals}</span>
                </div>
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
