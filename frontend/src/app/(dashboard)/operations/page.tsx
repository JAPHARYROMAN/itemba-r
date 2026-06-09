'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatCard, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendGet, backendList } from '@/lib/api-client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company {
  id: string;
  name: string;
  code: string;
}

interface OperationsReadiness {
  score: number;
  target: number;
  maturity: string;
  updatedAt: string;
  indicators: {
    activeProducts: number;
    activeCustomers: number;
    activeSuppliers: number;
    negativeBalances: number;
    lowStockProducts: number;
    transactionIntegrityIssues: number;
    workflowBacklog: number;
  };
  checks: Array<{
    key: string;
    title: string;
    status: 'PASS' | 'WARN' | 'FAIL';
    score: number;
    message: string;
    details: Record<string, number | string>;
  }>;
}

interface DashboardSummary {
  customers: { total: number; active: number; blocked: number };
  suppliers: { total: number; active: number; blocked: number };
  products: { total: number; active: number; outOfStock: number };
  salesOrders: {
    total: number;
    draft: number;
    confirmed: number;
    cancelled: number;
    totalValue: number;
    outstandingValue: number;
  };
  purchaseOrders: {
    total: number;
    draft: number;
    confirmed: number;
    received: number;
    cancelled: number;
    totalValue: number;
    outstandingValue: number;
  };
  stockAdjustments: { total: number; pendingApproval: number; posted: number };
  topProducts: Array<{ id: string; name: string; quantityOnHand: number; totalValue: number }>;
  lowStockProducts: Array<{
    id: string;
    name: string;
    quantityOnHand: number;
    reorderLevel: number;
  }>;
  readiness?: OperationsReadiness;
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

function fmtNum(n: number | string | null | undefined) {
  const value = Number(n ?? 0);
  return new Intl.NumberFormat('en-US').format(Number.isFinite(value) ? value : 0);
}

function readinessStatusClass(status: OperationsReadiness['checks'][number]['status']) {
  if (status === 'PASS') return 'bg-emerald-100 text-emerald-700';
  if (status === 'WARN') return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
}

const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OperationsDashboardPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canView = hasPermission('operations.dashboard.view');

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;

    async function loadCompanies() {
      try {
        const records = await backendList<Company>('/companies', { query: { limit: 100 } });
        if (!cancelled) setCompanies(records);
      } catch {
        if (!cancelled) setCompanies([]);
      }
    }

    void loadCompanies();

    return () => {
      cancelled = true;
    };
  }, [canView]);

  const loadDashboard = useCallback(async () => {
    if (!canView || !companyId) return;
    setLoading(true);
    setError('');
    try {
      const payload = await backendGet<DashboardSummary>('/operations-dashboard/summary', {
        query: { companyId },
      });
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
        <PageHeader
          title="Operations Dashboard"
          subtitle="Overview of customers, products, inventory, sales, and purchases"
        />
        <div className="mt-8 flex flex-col items-center gap-3 text-center">
          <p className="text-sm font-medium text-slate-600">Access Restricted</p>
          <p className="text-xs text-slate-400 max-w-sm">
            You do not have permission to view operations data.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="Operations Dashboard"
          subtitle="Overview of customers, products, inventory, sales, and purchases"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <a
                href="/operations/mobile-pos"
                className="inline-flex min-h-9 items-center rounded-lg bg-brand-600 px-3 text-[12px] font-semibold text-white transition hover:bg-brand-700"
              >
                Mobile POS
              </a>
              <a
                href="/operations/sales-orders"
                className="inline-flex min-h-9 items-center rounded-lg border px-3 text-[12px] font-semibold transition"
                style={{
                  borderColor: 'var(--aurora-border)',
                  color: 'var(--aurora-text-secondary)',
                }}
              >
                Sales Orders
              </a>
            </div>
          }
        />
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          <option value="">— Select a Company —</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </select>
      </div>

      {!companyId && (
        <div className="text-center py-10 text-sm text-slate-400">
          Select a company to load the dashboard.
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {companyId && loading && <PageSpinner />}

      {companyId && !loading && data && (
        <div className="space-y-6">
          {data.readiness && (
            <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-4">
              <Card className="p-5">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Operations Readiness
                </div>
                <div className="mt-3 flex items-end gap-2">
                  <span className="text-5xl font-bold text-slate-900">{data.readiness.score}</span>
                  <span className="pb-2 text-sm text-slate-500">/100</span>
                </div>
                <div className="mt-3 text-sm font-medium text-slate-700 capitalize">
                  {data.readiness.maturity.replace(/-/g, ' ')}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-500">
                  <div>
                    <div className="font-semibold text-slate-700">
                      {fmtNum(data.readiness.indicators.transactionIntegrityIssues)}
                    </div>
                    cash issues
                  </div>
                  <div>
                    <div className="font-semibold text-slate-700">
                      {fmtNum(data.readiness.indicators.negativeBalances)}
                    </div>
                    negative stock
                  </div>
                  <div>
                    <div className="font-semibold text-slate-700">
                      {fmtNum(data.readiness.indicators.workflowBacklog)}
                    </div>
                    workflow backlog
                  </div>
                  <div>
                    <div className="font-semibold text-slate-700">
                      {fmtNum(data.readiness.indicators.activeProducts)}
                    </div>
                    active products
                  </div>
                </div>
              </Card>

              <Card className="p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Control Checks
                    </div>
                    <div className="mt-1 text-sm text-slate-500">
                      Live sales, purchases, inventory, and payment integrity checks.
                    </div>
                  </div>
                  <span className="text-xs text-slate-400">Target {data.readiness.target}+</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {data.readiness.checks.map((check) => (
                    <div
                      key={check.key}
                      className="rounded-lg border border-slate-100 bg-slate-50 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-800">{check.title}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${readinessStatusClass(
                            check.status,
                          )}`}
                        >
                          {check.status}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">{check.message}</div>
                      <div className="mt-3 text-xs font-semibold text-slate-700">
                        {check.score}/100
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {/* Row 1 — Entity counts */}
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="Total Customers"
              value={fmtNum(data.customers.total)}
              hint={`${data.customers.active} active`}
            />
            <StatCard
              label="Active Suppliers"
              value={fmtNum(data.suppliers.active)}
              hint={`${data.suppliers.total} total`}
            />
            <StatCard
              label="Total Products"
              value={fmtNum(data.products.total)}
              hint={`${data.products.outOfStock} out of stock`}
            />
            <StatCard label="Out of Stock" value={fmtNum(data.products.outOfStock)} />
          </div>

          {/* Row 2 — Financial values */}
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Total Sales Value (TZS)" value={fmtTZS(data.salesOrders.totalValue)} />
            <StatCard
              label="Outstanding Sales (TZS)"
              value={fmtTZS(data.salesOrders.outstandingValue)}
            />
            <StatCard
              label="Total Purchase Value (TZS)"
              value={fmtTZS(data.purchaseOrders.totalValue)}
            />
            <StatCard
              label="Outstanding Purchases (TZS)"
              value={fmtTZS(data.purchaseOrders.outstandingValue)}
            />
          </div>

          {/* Row 3 — Order status cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
                Sales Orders
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                    Draft
                  </span>
                  <span className="text-sm font-bold text-slate-800">
                    {fmtNum(data.salesOrders.draft)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                    Confirmed
                  </span>
                  <span className="text-sm font-bold text-slate-800">
                    {fmtNum(data.salesOrders.confirmed)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                    Cancelled
                  </span>
                  <span className="text-sm font-bold text-slate-800">
                    {fmtNum(data.salesOrders.cancelled)}
                  </span>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-400">
                Total: {fmtNum(data.salesOrders.total)} orders
              </div>
            </Card>

            <Card className="p-5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
                Purchase Orders
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                    Draft
                  </span>
                  <span className="text-sm font-bold text-slate-800">
                    {fmtNum(data.purchaseOrders.draft)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                    Confirmed
                  </span>
                  <span className="text-sm font-bold text-slate-800">
                    {fmtNum(data.purchaseOrders.confirmed)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                    Received
                  </span>
                  <span className="text-sm font-bold text-slate-800">
                    {fmtNum(data.purchaseOrders.received)}
                  </span>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-400">
                Total: {fmtNum(data.purchaseOrders.total)} orders
              </div>
            </Card>
          </div>

          {/* Row 4 — Top products & low stock */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Top Products by Value
              </div>
              {data.topProducts.length === 0 ? (
                <p className="text-sm text-slate-400 py-4 text-center">No data</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className={thCls}>Name</th>
                        <th className={`${thCls} text-right`}>Qty On Hand</th>
                        <th className={`${thCls} text-right`}>Total Value (TZS)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topProducts.map((p) => (
                        <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className={tdCls}>{p.name}</td>
                          <td className={`${tdCls} text-right`}>{fmtNum(p.quantityOnHand)}</td>
                          <td className={`${tdCls} text-right`}>{fmtTZS(p.totalValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card className="p-5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Low Stock Alert
              </div>
              {data.lowStockProducts.length === 0 ? (
                <p className="text-sm text-slate-400 py-4 text-center">No low stock items</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className={thCls}>Name</th>
                        <th className={`${thCls} text-right`}>Qty On Hand</th>
                        <th className={`${thCls} text-right`}>Reorder Level</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.lowStockProducts.map((p) => {
                        const critical = p.quantityOnHand <= p.reorderLevel;
                        return (
                          <tr
                            key={p.id}
                            className={`border-b border-slate-50 ${critical ? 'bg-red-50' : 'hover:bg-slate-50'}`}
                          >
                            <td
                              className={`${tdCls} ${critical ? 'text-red-700 font-medium' : ''}`}
                            >
                              {p.name}
                            </td>
                            <td
                              className={`${tdCls} text-right ${critical ? 'text-red-700 font-semibold' : ''}`}
                            >
                              {fmtNum(p.quantityOnHand)}
                            </td>
                            <td className={`${tdCls} text-right`}>{fmtNum(p.reorderLevel)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
