'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

function Spinner() {
  return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;
}
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';
function fmtCurrency(n: number | string | null | undefined) { const value = Number(n ?? 0); return `TZS ${new Intl.NumberFormat('en-US').format(Number.isFinite(value) ? value : 0)}`; }
function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }

interface Company { id: string; name: string; code: string; }

export default function EquipmentUsagePage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [data, setData] = useState<{ data: any[]; total: number }>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/itemba/equipment-usage?companyId=${companyId}&page=1&limit=20`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      const inner = json.data?.data ?? json.data;
      const rows = Array.isArray(inner) ? inner : Array.isArray(inner?.data) ? inner.data : [];
      const total = typeof inner?.total === 'number' ? inner.total : rows.length;
      setData({ data: rows, total });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Equipment Usage" subtitle="Equipment usage records across operations" />
        <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
          <option value="">— Select Company —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {!companyId && <div className="text-center py-10 text-sm text-slate-400">Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <Spinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs text-slate-500">{data.total} records</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls}>Usage #</th>
                  <th className={thCls}>Equipment</th>
                  <th className={thCls}>Context Type</th>
                  <th className={thCls}>Usage Date</th>
                  <th className={thCls}>Hours Used</th>
                  <th className={thCls}>Fuel (L)</th>
                  <th className={thCls}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">No equipment usage records found.</td></tr>
                ) : data.data.map((u: any) => (
                  <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`}>{u.usageNumber}</td>
                    <td className={tdCls}>{u.equipmentName ?? '—'}</td>
                    <td className={tdCls}>{u.usageContextType?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className={tdCls}>{u.usageDate ? fmtDate(u.usageDate) : '—'}</td>
                    <td className={tdCls}>{u.hoursUsed ?? '—'}</td>
                    <td className={tdCls}>{u.fuelUsedLitres ?? '—'}</td>
                    <td className={tdCls}>{u.costAmount != null ? fmtCurrency(u.costAmount) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
