'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatCard } from '@/components/ui';
import { CompanyBranchPicker } from '@/components/petroleum/CompanyBranchPicker';

// ─── Types ────────────────────────────────────────────────────────────────────
// These types intentionally mirror the backend response from
// `petroleum-dashboard.service.ts`. Several fields (`product`, `supplier`,
// `openedBy`) come back as `{ name }` / `{ fullName }` objects via Prisma's
// `select`, NOT as bare strings — rendering them directly trips the React
// "Objects are not valid as a React child" error.

interface Company { id: string; name: string; code: string }

interface DashboardSummary {
  tankCount: number;
  activeTankCount: number;
  pumpCount: number;
  nozzleCount: number;
  openShiftCount: number;
  todayShiftCount: number;
  pendingDeliveries: number;
  fuelCreditOpenCount: number;
  pendingDipCount: number;
}

interface DashboardData {
  summary: DashboardSummary;
  tanks: TankRow[];
  recentShifts: ShiftRow[];
  recentDeliveries: DeliveryRow[];
}

interface TankRow {
  id: string;
  tankName: string;
  tankCode?: string | null;
  product: { name: string } | null;
  capacityLitres: number;
  currentBookBalance: number;
  status: string;
}

interface ShiftRow {
  id: string;
  shiftNumber: string;
  shiftDate: string;
  shiftType: string;
  openedBy: { fullName: string } | null;
  status: string;
}

interface DeliveryRow {
  id: string;
  deliveryNumber: string;
  deliveredLitres: number;
  supplier: { name: string } | null;
  status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const STATUS_CLR: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  OPEN: 'bg-amber-50 text-amber-700 border-amber-200',
  CLOSED: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  DRAFT: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  RECEIVED: 'bg-blue-50 text-blue-700 border-blue-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  POSTED: 'bg-blue-50 text-blue-700 border-blue-200',
  CANCELLED: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  INACTIVE: 'bg-zinc-100 text-zinc-500 border-zinc-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return (
    <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function fmtNum(n: number) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n); }
function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PetroleumDashboardPage() {
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      params.set('companyId', companyId);
      // Branch is optional. When empty we get the consolidated view across
      // every station the user can see for this company.
      if (branchId) params.set('branchId', branchId);
      const res = await fetch(`/api/backend/petroleum/dashboard?${params.toString()}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(`HTTP ${res.status}: ${errJson?.message ?? 'Failed to load dashboard'}`);
      }
      const json = await res.json();
      // Endpoint returns a single DashboardData object — unwrap the standard
      // `{ data: ... }` envelope and reject array-shaped payloads outright so
      // a missing field can't masquerade as a list.
      const payload = json?.data ?? json;
      setData(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading dashboard');
    } finally { setLoading(false); }
  }, [companyId, branchId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="Petroleum Dashboard"
          subtitle={
            branchId
              ? 'Station-level view — tanks, pumps, shifts, deliveries, and credit sales.'
              : 'Group view across all petrol stations — pick a branch to drill into one station.'
          }
        />
        <CompanyBranchPicker
          companyId={companyId}
          branchId={branchId}
          onCompanyChange={setCompanyId}
          onBranchChange={setBranchId}
          allBranchesLabel="All branches (consolidated)"
        />
      </div>

      {!companyId && <div className="text-center py-10 text-sm text-slate-400">Select a company to load the dashboard.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <Spinner />}

      {companyId && !loading && data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard
              label="Active Tanks"
              value={String(data.summary.activeTankCount)}
              hint={`${data.summary.tankCount} total`}
            />
            <StatCard label="Pumps" value={String(data.summary.pumpCount)} />
            <StatCard label="Nozzles" value={String(data.summary.nozzleCount)} />
            <StatCard
              label="Open Shifts"
              value={String(data.summary.openShiftCount)}
              hint={`${data.summary.todayShiftCount} today`}
            />
            <StatCard label="Pending Deliveries" value={String(data.summary.pendingDeliveries)} />
            <StatCard label="Open Credit Sales" value={String(data.summary.fuelCreditOpenCount)} />
          </div>

          {/* Tanks stock */}
          <Card className="p-5">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Tank Stock Levels</div>
            {data.tanks.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">No tanks found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className={thCls}>Tank</th>
                      <th className={thCls}>Product</th>
                      <th className={`${thCls} text-right`}>Capacity (L)</th>
                      <th className={`${thCls} text-right`}>Book Balance (L)</th>
                      <th className={`${thCls} text-right`}>Fill %</th>
                      <th className={thCls}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tanks.map((t) => {
                      const pct = t.capacityLitres > 0 ? (t.currentBookBalance / t.capacityLitres) * 100 : 0;
                      return (
                        <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className={`${tdCls} font-medium`}>{t.tankName}</td>
                          <td className={tdCls}>{t.product?.name ?? '—'}</td>
                          <td className={`${tdCls} text-right`}>{fmtNum(t.capacityLitres)}</td>
                          <td className={`${tdCls} text-right`}>{fmtNum(t.currentBookBalance)}</td>
                          <td className={`${tdCls} text-right`}>
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 bg-slate-100 rounded-full h-1.5">
                                <div
                                  className={`h-1.5 rounded-full ${pct < 20 ? 'bg-red-400' : pct < 50 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                                  style={{ width: `${Math.min(pct, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs">{pct.toFixed(0)}%</span>
                            </div>
                          </td>
                          <td className={tdCls}><Badge status={t.status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Recent shifts */}
            <Card className="p-5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Recent Shifts</div>
              {data.recentShifts.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">No shifts</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className={thCls}>Shift #</th>
                      <th className={thCls}>Date</th>
                      <th className={thCls}>Type</th>
                      <th className={thCls}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentShifts.map((s) => (
                      <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className={`${tdCls} font-medium`}>{s.shiftNumber}</td>
                        <td className={tdCls}>{fmtDate(s.shiftDate)}</td>
                        <td className={tdCls}>{s.shiftType}</td>
                        <td className={tdCls}><Badge status={s.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            {/* Recent deliveries */}
            <Card className="p-5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Recent Deliveries</div>
              {data.recentDeliveries.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">No deliveries</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className={thCls}>Delivery #</th>
                      <th className={thCls}>Supplier</th>
                      <th className={`${thCls} text-right`}>Litres</th>
                      <th className={thCls}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentDeliveries.map((d) => (
                      <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className={`${tdCls} font-medium`}>{d.deliveryNumber}</td>
                        <td className={tdCls}>{d.supplier?.name ?? '—'}</td>
                        <td className={`${tdCls} text-right`}>{fmtNum(d.deliveredLitres)}</td>
                        <td className={tdCls}><Badge status={d.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
