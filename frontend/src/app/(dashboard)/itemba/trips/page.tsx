'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

interface Company { id: string; name: string; code: string; }
interface Trip {
  id: string;
  tripNumber: string;
  vehiclePlate?: string;
  driverName?: string;
  origin?: string;
  destination?: string;
  departureDate?: string;
  status: string;
  revenueAmount?: number;
}

function Spinner() {
  return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;
}

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide' as const;
const tdCls = 'px-4 py-3 text-sm' as const;

const STATUS_CLR: Record<string, string> = {
  DRAFT: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  SCHEDULED: 'bg-blue-50 text-blue-700 border-blue-200',
  DISPATCHED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  IN_TRANSIT: 'bg-amber-50 text-amber-700 border-amber-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CLOSED: 'bg-teal-50 text-teal-700 border-teal-200',
  CANCELLED: 'bg-red-50 text-red-600 border-red-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status.replace(/_/g, ' ')}</span>;
}

const TRIP_ACTIONS: { action: string; label: string; validFrom: string[]; cls: string }[] = [
  { action: 'dispatch', label: 'Dispatch', validFrom: ['SCHEDULED'], cls: 'text-indigo-600 hover:text-indigo-800' },
  { action: 'in-transit', label: 'In Transit', validFrom: ['DISPATCHED'], cls: 'text-amber-600 hover:text-amber-800' },
  { action: 'complete', label: 'Complete', validFrom: ['IN_TRANSIT'], cls: 'text-emerald-600 hover:text-emerald-800' },
  { action: 'close', label: 'Close', validFrom: ['COMPLETED'], cls: 'text-teal-600 hover:text-teal-800' },
  { action: 'cancel', label: 'Cancel', validFrom: ['SCHEDULED', 'DISPATCHED'], cls: 'text-red-500 hover:text-red-700' },
];

export default function TripsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [items, setItems] = useState<Trip[]>([]);
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
      const res = await fetch(`/api/backend/logistics/trips?companyId=${companyId}&page=1&limit=50`);
      if (!res.ok) throw new Error(`Failed to load trips (HTTP ${res.status})`);
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
      const res = await fetch(`/api/backend/logistics/trips/${id}/${action}`, { method: 'PATCH' });
      if (!res.ok) throw new Error('Action failed');
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Action failed');
    } finally { setActioning(null); }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Trips" subtitle="Logistics trips — dispatch, transit and delivery tracking" />
        <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
          <option value="">— Select Company —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? <Spinner /> : (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs text-slate-500">{total} trips</div>
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Trip #</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Vehicle</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Driver</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Route</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Departure</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Revenue</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Status</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400 text-sm">{companyId ? 'No trips found.' : 'Select a company to view trips.'}</td></tr>
              ) : items.map(t => (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className={tdCls}><span className="font-mono text-xs" style={{ color: 'var(--aurora-text)' }}>{t.tripNumber}</span></td>
                  <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{t.vehiclePlate ?? '—'}</td>
                  <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{t.driverName ?? '—'}</td>
                  <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{[t.origin, t.destination].filter(Boolean).join(' → ') || '—'}</td>
                  <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{t.departureDate ? new Date(t.departureDate).toLocaleDateString() : '—'}</td>
                  <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{t.revenueAmount != null ? `TZS ${new Intl.NumberFormat('en-US').format(t.revenueAmount)}` : '—'}</td>
                  <td className={tdCls}><Badge status={t.status} /></td>
                  <td className={tdCls}>
                    <div className="flex gap-2 flex-wrap">
                      {TRIP_ACTIONS.filter(a => a.validFrom.includes(t.status)).map(a => (
                        <button key={a.action} disabled={!!actioning} onClick={() => handleAction(t.id, a.action)}
                          className={`text-xs font-medium disabled:opacity-50 ${a.cls}`}>
                          {actioning === `${t.id}-${a.action}` ? '...' : a.label}
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
