'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, StatCard, PageSpinner } from '@/components/ui';

const fmtNum = (n: number) => new Intl.NumberFormat('en-US').format(n);
const fmtCurrency = (n: number | string | null | undefined) => { const value = Number(n ?? 0); return `TZS ${new Intl.NumberFormat('en-US').format(Math.round(Number.isFinite(value) ? value : 0))}`; };
const fmtDate = (d: string | Date | null) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const STATUS_CLR: Record<string, string> = {
  PLANNED: 'bg-slate-100 text-slate-600',
  LAND_PREPARATION: 'bg-orange-50 text-orange-700',
  PLANTED: 'bg-blue-50 text-blue-700',
  GROWING: 'bg-emerald-50 text-emerald-700',
  HARVESTING: 'bg-amber-50 text-amber-800',
  HARVESTED: 'bg-green-100 text-green-700',
  CLOSED: 'bg-zinc-100 text-zinc-500',
  CANCELLED: 'bg-red-50 text-red-600',
};

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

interface Company { id: string; name: string; code: string; }
interface SeasonItem { id: string; seasonName: string; cropName: string; farmName: string; status: string; plantingDate: string; expectedHarvestDate: string; }
interface HarvestItem { id: string; harvestNumber: string; farmName: string; cropName: string; quantity: number; harvestDate: string; estimatedTotalValue: number; }
interface Summary {
  totalFarms: number; activeFarms: number; totalFields: number; totalCrops: number;
  totalSeasons: number; activeSeasons: number; totalHarvests: number; postedHarvests: number; pendingHarvests: number;
  totalInputCost: number; totalHarvestValue: number; totalHarvestQuantity: number;
  activeSeasonsData: SeasonItem[]; recentHarvests: HarvestItem[];
}

export default function AgricultureDashboardPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/agriculture/dashboard?companyId=${companyId}`);
      if (!res.ok) throw new Error('Failed to load dashboard');
      const json = await res.json();
      const d = json.data ?? json;
      setSummary(d);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const quickLinks = [
    { href: '/agriculture/farms', label: 'Farms', desc: 'Farm management', icon: '🌾' },
    { href: '/agriculture/fields', label: 'Farm Fields', desc: 'Field records', icon: '🗺️' },
    { href: '/agriculture/crops', label: 'Crops', desc: 'Crop catalog', icon: '🌱' },
    { href: '/agriculture/seasons', label: 'Crop Seasons', desc: 'Season tracking', icon: '📅' },
    { href: '/agriculture/inputs', label: 'Farm Inputs', desc: 'Input applications', icon: '🧪' },
    { href: '/agriculture/harvests', label: 'Harvests', desc: 'Harvest records', icon: '🚜' },
    { href: '/agriculture/activities', label: 'Activities', desc: 'Farm activities', icon: '⚒️' },
    { href: '/agriculture/labor', label: 'Labor Records', desc: 'Worker & labor costs', icon: '👷' },
    { href: '/agriculture/reports', label: 'Reports', desc: 'Analytics & reports', icon: '📊' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Agriculture Dashboard" subtitle="Farms, Crops & Harvest Operations" />
        <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
          <option value="">— Select Company —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load the agriculture dashboard.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}

      {summary && !loading && (
        <div className="space-y-6">
          {/* KPI Row 1 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard label="Total Farms" value={fmtNum(summary.totalFarms)} hint={`${summary.activeFarms} active`} />
            <StatCard label="Total Fields" value={fmtNum(summary.totalFields)} />
            <StatCard label="Crop Types" value={fmtNum(summary.totalCrops)} />
            <StatCard label="Active Seasons" value={fmtNum(summary.activeSeasons)} hint={`${summary.totalSeasons} total`} />
            <StatCard label="Pending Harvests" value={fmtNum(summary.pendingHarvests)} hint={`${summary.postedHarvests} posted`} />
          </div>

          {/* KPI Row 2 — Financial */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="p-4">
              <div className="text-xs font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--aurora-text-muted)' }}>Total Input Cost</div>
              <div className="text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>{fmtCurrency(summary.totalInputCost)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--aurora-text-muted)' }}>Harvest Value (Posted)</div>
              <div className="text-2xl font-bold text-emerald-700">{fmtCurrency(summary.totalHarvestValue)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--aurora-text-muted)' }}>Total Qty Harvested</div>
              <div className="text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>{fmtNum(summary.totalHarvestQuantity)} units</div>
            </Card>
          </div>

          {/* Active Seasons */}
          {summary.activeSeasonsData.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 font-semibold text-sm" style={{ color: 'var(--aurora-text)' }}>Active Seasons</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Season</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Crop</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Farm</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Planting</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Expected Harvest</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.activeSeasonsData.map(s => (
                      <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{s.seasonName}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{s.cropName}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{s.farmName}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(s.plantingDate)}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(s.expectedHarvestDate)}</td>
                        <td className={tdCls}>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLR[s.status] ?? 'bg-zinc-100 text-zinc-600'}`}>
                            {s.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Recent Harvests */}
          {summary.recentHarvests.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 font-semibold text-sm" style={{ color: 'var(--aurora-text)' }}>Recent Posted Harvests</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>#</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Farm</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Crop</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Qty</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Est. Value</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.recentHarvests.map(h => (
                      <tr key={h.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className={`${tdCls} font-medium text-indigo-600`}>{h.harvestNumber}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{h.farmName}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{h.cropName}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtNum(h.quantity)}</td>
                        <td className={`${tdCls} text-emerald-700 font-medium`}>{fmtCurrency(h.estimatedTotalValue)}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(h.harvestDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Quick Links */}
      <div>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--aurora-text-muted)' }}>Quick Navigation</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {quickLinks.map(l => (
            <Link key={l.href} href={l.href}>
              <Card className="p-4 hover:shadow-md transition-shadow cursor-pointer">
                <div className="text-xl mb-1">{l.icon}</div>
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

