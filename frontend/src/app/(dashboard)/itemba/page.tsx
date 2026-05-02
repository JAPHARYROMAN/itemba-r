'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, StatCard } from '@/components/ui';

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

interface Company { id: string; name: string; code: string; }
interface Summary {
  logistics: { totalActiveVehicles: number; activeTrips: number };
  agriculture: { totalActiveFarms: number };
  construction: { totalActiveProjects: number };
  labor: { totalLaborRecords: number; unpaidLaborCount: number };
}

export default function ItembaDashboardPage() {
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
      const res = await fetch(`/api/backend/itemba/dashboard/summary?companyId=${companyId}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      const payload = json?.data ?? json;
      setSummary(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const quickLinks = [
    { href: '/logistics/vehicles', label: 'Vehicles', desc: 'Fleet registry' },
    { href: '/logistics/drivers', label: 'Drivers', desc: 'Driver records' },
    { href: '/logistics/trips', label: 'Trips', desc: 'Trip management' },
    { href: '/logistics/maintenance', label: 'Maintenance', desc: 'Vehicle maintenance' },
    { href: '/agriculture/farms', label: 'Farms', desc: 'Farm registry' },
    { href: '/agriculture/crops', label: 'Crops', desc: 'Crop catalogue' },
    { href: '/agriculture/seasons', label: 'Crop Seasons', desc: 'Season planning' },
    { href: '/agriculture/harvests', label: 'Harvests', desc: 'Harvest records' },
    { href: '/construction/projects', label: 'Projects', desc: 'Construction projects' },
    { href: '/construction/sites', label: 'Sites', desc: 'Construction sites' },
    { href: '/construction/subcontractors', label: 'Subcontractors', desc: 'Subcontractor records' },
    { href: '/itemba/work-units', label: 'Work Units', desc: 'Work unit records' },
    { href: '/itemba/equipment-usage', label: 'Equipment Usage', desc: 'Equipment logs' },
    { href: '/itemba/labor-records', label: 'Labor Records', desc: 'Worker records' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Itemba Enterprises Dashboard" subtitle="Logistics, Agriculture & Construction Operations" />
        <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
          <option value="">— Select Company —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <Spinner />}

      {summary && !loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Active Vehicles" value={summary.logistics.totalActiveVehicles} hint={`${summary.logistics.activeTrips} active trips`} />
          <StatCard label="Active Farms" value={summary.agriculture.totalActiveFarms} />
          <StatCard label="Active Projects" value={summary.construction.totalActiveProjects} />
          <StatCard label="Labor Records" value={summary.labor.totalLaborRecords} hint={`${summary.labor.unpaidLaborCount} unpaid`} />
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-slate-600 mb-3">Quick Links</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {quickLinks.map(l => (
            <Link key={l.href} href={l.href}>
              <Card className="p-4 hover:shadow-md transition-shadow cursor-pointer">
                <div className="font-medium text-slate-800 text-sm">{l.label}</div>
                <div className="text-xs text-slate-500 mt-0.5">{l.desc}</div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

