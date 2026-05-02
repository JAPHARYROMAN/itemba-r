'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, StatCard, StatusBadge, PageSpinner } from '@/components/ui';

function fmtCurrency(n: number) { return `TZS ${new Intl.NumberFormat('en-US').format(n)}`; }
function fmtDateTime(d: string) { return d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }
function fmtDuration(entryTime: string) {
  const mins = Math.round((Date.now() - new Date(entryTime).getTime()) / 60000);
  if (mins < 0) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

interface Company { id: string; name: string; }

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

const quickLinks = [
  { href: '/parking/sessions', label: '🚛 Gate Operations', desc: 'Live entry & exit management' },
  { href: '/parking/facilities', label: '🏗 Facilities', desc: 'Parking facility registry' },
  { href: '/parking/zones', label: '📦 Zones', desc: 'Zone configuration' },
  { href: '/parking/rates', label: '💰 Rates', desc: 'Pricing and tariffs' },
  { href: '/parking/payments', label: '💳 Payments', desc: 'Payment records' },
  { href: '/parking/reports', label: '📊 Reports', desc: 'Analytics and insights' },
];

export default function ParkingDashboardPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [facilities, setFacilities] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => {
      const list = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
      setCompanies(list);
      if (list.length > 0) setCompanyId(list[0].id);
    });
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const [facRes, zoneRes, sesRes, payRes] = await Promise.all([
        fetch(`/api/backend/parking-facilities?companyId=${companyId}&limit=100`),
        fetch(`/api/backend/parking-zones?companyId=${companyId}&limit=100`),
        fetch(`/api/backend/parking-sessions?companyId=${companyId}&status=ACTIVE&page=1&limit=50`),
        fetch(`/api/backend/parking-payments?companyId=${companyId}&page=1&limit=100`),
      ]);
      const [facJson, zoneJson, sesJson, payJson] = await Promise.all([facRes.json(), zoneRes.json(), sesRes.json(), payRes.json()]);
      setFacilities(facJson.data?.data ?? []);
      setZones(zoneJson.data?.data ?? []);
      setActiveSessions(sesJson.data?.data ?? []);
      setPayments(payJson.data?.data ?? []);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayRevenue = payments.filter(p => p.paymentDate && new Date(p.paymentDate) >= today).reduce((acc, p) => acc + (p.amount ?? 0), 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthRevenue = payments.filter(p => p.paymentDate && new Date(p.paymentDate) >= monthStart).reduce((acc, p) => acc + (p.amount ?? 0), 0);
  const totalCapacity = zones.reduce((acc, z) => acc + (z.capacity ?? 0), 0);
  const utilPct = totalCapacity > 0 ? Math.round((activeSessions.length / totalCapacity) * 100) : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Parking Dashboard" subtitle="Parking Facilities & Session Management" />
        <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
          <option value="">— Select Company —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <PageSpinner />}

      {!loading && companyId && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard label="Total Facilities" value={facilities.length} variant="blue" />
            <StatCard label="Total Zones" value={zones.length} variant="default" />
            <StatCard label="Active Sessions" value={activeSessions.length} variant="green" hint="Trucks inside" />
            <StatCard label="Today's Revenue" value={fmtCurrency(todayRevenue)} variant="purple" />
            <StatCard label="Monthly Revenue" value={fmtCurrency(monthRevenue)} variant="amber" />
            <StatCard label="Utilization" value={totalCapacity > 0 ? `${utilPct}%` : 'N/A'} variant={utilPct > 80 ? 'red' : 'green'} hint={totalCapacity > 0 ? `${activeSessions.length}/${totalCapacity}` : 'No capacity set'} />
          </div>

          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>Active Sessions</span>
              <span className="ml-1 inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-xs font-semibold">{activeSessions.length}</span>
              <Link href="/parking/sessions" className="ml-auto text-xs text-indigo-600 hover:text-indigo-800 font-medium">View All →</Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Session #</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Truck #</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Zone</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Entry Time</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Duration</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Rate</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {activeSessions.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No active sessions.</td></tr>
                  ) : activeSessions.map((s: any) => (
                    <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{s.sessionNumber}</td>
                      <td className={`${tdCls} font-semibold`} style={{ color: 'var(--aurora-text)' }}>{s.truckNumber}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{s.parkingZone?.zoneName ?? s.zone?.zoneName ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDateTime(s.entryTime)}</td>
                      <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{s.entryTime ? fmtDuration(s.entryTime) : '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{s.parkingRate?.rateName ?? s.rate?.rateName ?? '—'}</td>
                      <td className={tdCls}><StatusBadge status={s.paymentStatus ?? 'UNPAID'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {facilities.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>Facility Status Overview</div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Code</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Name</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Location</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Capacity</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facilities.map((f: any) => (
                      <tr key={f.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{f.facilityCode}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{f.facilityName}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{f.location ?? '—'}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{f.capacityTrucks ?? '—'}</td>
                        <td className={tdCls}><StatusBadge status={f.status ?? 'UNKNOWN'} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      <div>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--aurora-text-secondary)' }}>Quick Navigation</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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
