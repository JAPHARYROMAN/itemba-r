'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

interface Company { id: string; name: string; code: string; }
interface ConstructionSite {
  id: string;
  siteCode: string;
  name: string;
  projectName?: string;
  location?: string;
  siteManager?: string;
  status: string;
}

function Spinner() {
  return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;
}

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide' as const;
const tdCls = 'px-4 py-3 text-sm' as const;

const STATUS_CLR: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  INACTIVE: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  COMPLETED: 'bg-teal-50 text-teal-700 border-teal-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status.replace(/_/g, ' ')}</span>;
}

export default function ConstructionSitesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [items, setItems] = useState<ConstructionSite[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/construction/sites?companyId=${companyId}&page=1&limit=50`);
      if (!res.ok) throw new Error(`Failed to load sites (HTTP ${res.status})`);
      const json = await res.json();
      const rows = json.data?.data ?? json.data ?? [];
      setItems(rows);
      setTotal(json.data?.total ?? rows.length);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading data');
    } finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Construction Sites" subtitle="Active construction sites and their project assignments" />
        <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
          <option value="">— Select Company —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? <Spinner /> : (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs text-slate-500">{total} sites</div>
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Site Code</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Name</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Project</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Location</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Site Manager</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">{companyId ? 'No sites found.' : 'Select a company to view sites.'}</td></tr>
              ) : items.map(s => (
                <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className={tdCls}><span className="font-mono text-xs" style={{ color: 'var(--aurora-text)' }}>{s.siteCode}</span></td>
                  <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{s.name}</td>
                  <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{s.projectName ?? '—'}</td>
                  <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{s.location ?? '—'}</td>
                  <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{s.siteManager ?? '—'}</td>
                  <td className={tdCls}><Badge status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
