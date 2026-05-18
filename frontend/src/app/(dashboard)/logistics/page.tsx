'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, StatCard, PageSpinner, StatusBadge } from '@/components/ui';

function fmtCurrency(n: number | string | null | undefined) {
  const value = Number(n ?? 0);
  return `TZS ${new Intl.NumberFormat('en-US').format(Math.round(Number.isFinite(value) ? value : 0))}`;
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

interface Company { id: string; name: string; code: string; }

interface DashboardData {
  vehicles: { total: number; active: number; inMaintenance: number };
  drivers: { total: number; active: number };
  routes: { total: number };
  trips: { total: number; active: number; completed: number; planned: number; thisMonthRevenue: number };
  pendingMaintenance: number;
  recentTrips: Array<{
    id: string; tripNumber: string; origin: string; destination: string;
    status: string; revenueAmount: number; tripDate: string;
    vehiclePlate: string; driverName: string;
  }>;
  maintenanceDueSoon: Array<{
    vehicleId: string; vehicleCode: string; registrationNumber: string;
    nextServiceDate: string | null; currentOdometer: number;
  }>;
}

const quickLinks = [
  { href: '/logistics/vehicles', label: 'Vehicles', desc: 'Fleet management' },
  { href: '/logistics/drivers', label: 'Drivers', desc: 'Driver profiles' },
  { href: '/logistics/routes', label: 'Routes', desc: 'Route definitions' },
  { href: '/logistics/trips', label: 'Trips', desc: 'Trip management' },
  { href: '/logistics/maintenance', label: 'Maintenance', desc: 'Vehicle maintenance' },
  { href: '/logistics/trip-expenses', label: 'Trip Expenses', desc: 'Expense records' },
  { href: '/logistics/trip-fuel-usage', label: 'Fuel Usage', desc: 'Fuel consumption' },
  { href: '/logistics/reports', label: 'Reports', desc: 'Analytics & reports' },
];

export default function LogisticsDashboardPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then(r => r.json())
      .then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/logistics/dashboard?companyId=${companyId}`);
      if (!res.ok) throw new Error('Failed to load dashboard');
      const json = await res.json();
      const d = json.data?.data ?? json.data ?? json;
      setData(d as DashboardData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading dashboard');
    } finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const fleetUtilPct = data
    ? data.vehicles.total > 0 ? Math.round((data.vehicles.active / data.vehicles.total) * 100) : 0
    : 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header + Company Selector */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Logistics Dashboard" subtitle="Fleet, Trips & Transport Operations" />
        <select
          value={companyId}
          onChange={e => setCompanyId(e.target.value)}
          className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          style={{ color: 'var(--aurora-text)' }}
        >
          <option value="">— Select Company —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <PageSpinner />}

      {!companyId && !loading && (
        <div className="text-center py-16 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to view the dashboard</div>
      )}

      {data && !loading && (
        <>
          {/* Row 1: KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Active Trips" value={data.trips.active} hint={`${data.trips.planned} planned`} variant="blue" />
            <StatCard
              label="Total Vehicles"
              value={data.vehicles.total}
              hint={`${data.vehicles.inMaintenance} in maintenance`}
              variant="default"
            />
            <StatCard label="Active Drivers" value={data.drivers.active} hint={`of ${data.drivers.total} total`} variant="green" />
            <StatCard label="Pending Maintenance" value={data.pendingMaintenance} variant="amber" />
          </div>

          {/* Row 2: Revenue + Fleet Utilization */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-5">
              <p className="text-[11px] font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--aurora-text-muted)' }}>Revenue This Month</p>
              <p className="text-3xl font-bold text-emerald-600">{fmtCurrency(data.trips.thisMonthRevenue)}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--aurora-text-muted)' }}>{data.trips.completed} trips completed / closed</p>
            </Card>
            <Card className="p-5">
              <p className="text-[11px] font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--aurora-text-muted)' }}>Fleet Utilization</p>
              <p className="text-3xl font-bold text-indigo-600">{fleetUtilPct}%</p>
              <p className="text-xs mt-1" style={{ color: 'var(--aurora-text-muted)' }}>{data.vehicles.active} active of {data.vehicles.total} vehicles</p>
              <div className="mt-3 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${fleetUtilPct}%` }} />
              </div>
            </Card>
          </div>

          {/* Recent Trips */}
          <Card className="p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>Recent Trips</h3>
              <Link href="/logistics/trips" className="text-xs text-indigo-600 hover:underline">View all →</Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Trip #</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Route</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Vehicle</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Driver</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                    <th className={`${thCls} text-right`} style={{ color: 'var(--aurora-text-muted)' }}>Revenue</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Date</th>
                    <th className={thCls}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {data.recentTrips.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-6 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No recent trips</td></tr>
                  ) : data.recentTrips.map(t => (
                    <tr key={t.id} className="hover:bg-slate-50/50">
                      <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{t.tripNumber}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{t.origin} → {t.destination}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{t.vehiclePlate}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{t.driverName}</td>
                      <td className={tdCls}><StatusBadge status={t.status} /></td>
                      <td className={`${tdCls} text-right`} style={{ color: 'var(--aurora-text)' }}>{fmtCurrency(t.revenueAmount)}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(t.tripDate)}</td>
                      <td className={tdCls}>
                        <Link href={`/logistics/trips/${t.id}`} className="text-xs text-indigo-600 hover:underline">View</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Maintenance Due Soon */}
          {data.maintenanceDueSoon.length > 0 && (
            <Card className="p-0 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>Maintenance Due Soon</h3>
                <Link href="/logistics/maintenance" className="text-xs text-indigo-600 hover:underline">View all →</Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Vehicle Code</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Plate</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Next Service Date</th>
                      <th className={`${thCls} text-right`} style={{ color: 'var(--aurora-text-muted)' }}>Current Odometer</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {data.maintenanceDueSoon.map(m => (
                      <tr key={m.vehicleId} className="hover:bg-slate-50/50">
                        <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{m.vehicleCode}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{m.registrationNumber}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{m.nextServiceDate ? fmtDate(m.nextServiceDate) : <span className="text-amber-500">No date set</span>}</td>
                        <td className={`${tdCls} text-right`} style={{ color: 'var(--aurora-text)' }}>{m.currentOdometer.toLocaleString()} km</td>
                        <td className={tdCls}>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-700">
                            {m.nextServiceDate ? 'Due Soon' : 'Unscheduled'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {/* Quick Links */}
      <div>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--aurora-text-muted)' }}>Quick Links</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {quickLinks.map(l => (
            <Link key={l.href} href={l.href}>
              <Card className="p-4 hover:shadow-md transition-shadow cursor-pointer">
                <div className="font-medium text-sm" style={{ color: 'var(--aurora-text)' }}>{l.label}</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>{l.desc}</div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
