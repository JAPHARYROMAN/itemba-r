'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

interface Company { id: string; name: string; code: string; }
interface HarvestRecord {
  id: string;
  harvestNumber: string;
  farmName?: string;
  cropName?: string;
  harvestDate?: string;
  quantityKg?: number;
  gradeOrQuality?: string;
  status: string;
}

function Spinner() {
  return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;
}

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide' as const;
const tdCls = 'px-4 py-3 text-sm' as const;

const STATUS_CLR: Record<string, string> = {
  DRAFT: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  SUBMITTED: 'bg-blue-50 text-blue-700 border-blue-200',
  APPROVED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  POSTED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-600 border-red-200',
};

const ACTIONS: { action: string; label: string; validFrom: string[]; cls: string }[] = [
  { action: 'submit', label: 'Submit', validFrom: ['DRAFT'], cls: 'text-blue-600 hover:text-blue-800' },
  { action: 'approve', label: 'Approve', validFrom: ['SUBMITTED'], cls: 'text-indigo-600 hover:text-indigo-800' },
  { action: 'post', label: 'Post', validFrom: ['APPROVED'], cls: 'text-emerald-600 hover:text-emerald-800' },
  { action: 'reject', label: 'Reject', validFrom: ['SUBMITTED', 'APPROVED'], cls: 'text-red-500 hover:text-red-700' },
];

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status.replace(/_/g, ' ')}</span>;
}

export default function HarvestRecordsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [items, setItems] = useState<HarvestRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actioning, setActioning] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/agriculture/harvest-records?companyId=${companyId}&page=1&limit=50`);
      if (!res.ok) throw new Error(`Failed to load harvest records (HTTP ${res.status})`);
      const json = await res.json();
      const rows = json.data?.data ?? json.data ?? [];
      setItems(rows);
      setTotal(json.data?.total ?? rows.length);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading data');
    } finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (id: string, action: string) => {
    setActioning(`${id}-${action}`);
    try {
      const res = await fetch(`/api/backend/agriculture/harvest-records/${id}/${action}`, { method: 'PATCH' });
      if (!res.ok) throw new Error('Action failed');
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Action failed');
    } finally { setActioning(null); }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Harvest Records" subtitle="Agricultural harvest records — quantity, grade, and approval status" />
        <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
          <option value="">— Select Company —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? <Spinner /> : (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs text-slate-500">{total} records</div>
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Harvest #</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Farm</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Crop</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Date</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Quantity (kg)</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Grade</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Status</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400 text-sm">{companyId ? 'No records found.' : 'Select a company to view harvest records.'}</td></tr>
              ) : items.map(h => (
                <tr key={h.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className={tdCls}><span className="font-mono text-xs" style={{ color: 'var(--aurora-text)' }}>{h.harvestNumber}</span></td>
                  <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{h.farmName ?? '—'}</td>
                  <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{h.cropName ?? '—'}</td>
                  <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{h.harvestDate ? new Date(h.harvestDate).toLocaleDateString() : '—'}</td>
                  <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{h.quantityKg != null ? `${new Intl.NumberFormat('en-US').format(h.quantityKg)} kg` : '—'}</td>
                  <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{h.gradeOrQuality ?? '—'}</td>
                  <td className={tdCls}><Badge status={h.status} /></td>
                  <td className={tdCls}>
                    <div className="flex gap-2 flex-wrap">
                      {ACTIONS.filter(a => a.validFrom.includes(h.status)).map(a => (
                        <button key={a.action} disabled={!!actioning} onClick={() => handleAction(h.id, a.action)}
                          className={`text-xs font-medium disabled:opacity-50 ${a.cls}`}>
                          {actioning === `${h.id}-${a.action}` ? '...' : a.label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
