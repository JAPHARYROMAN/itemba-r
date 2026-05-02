'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

interface Company { id: string; name: string; code: string; }
interface Subcontractor {
  id: string;
  subcontractorCode: string;
  companyName: string;
  projectName?: string;
  contactPerson?: string;
  contractValue?: number;
  amountPaid?: number;
  status: string;
}

function Spinner() {
  return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;
}

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide' as const;
const tdCls = 'px-4 py-3 text-sm' as const;

const STATUS_CLR: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  COMPLETED: 'bg-teal-50 text-teal-700 border-teal-200',
  TERMINATED: 'bg-red-50 text-red-600 border-red-200',
  SUSPENDED: 'bg-amber-50 text-amber-700 border-amber-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status.replace(/_/g, ' ')}</span>;
}

export default function SubcontractorsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [items, setItems] = useState<Subcontractor[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/construction/subcontractors?companyId=${companyId}&page=1&limit=50`);
      if (!res.ok) throw new Error(`Failed to load subcontractors (HTTP ${res.status})`);
      const json = await res.json();
      const rows = json.data?.data ?? json.data ?? [];
      setItems(rows);
      setTotal(json.data?.total ?? rows.length);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading data');
    } finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const handlePayment = async (id: string) => {
    const amount = parseFloat(payAmount);
    if (isNaN(amount) || amount <= 0) { alert('Enter a valid payment amount'); return; }
    try {
      const res = await fetch(`/api/backend/construction/subcontractors/${id}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentAmount: amount }),
      });
      if (!res.ok) throw new Error('Payment failed');
      setPayingId(null); setPayAmount('');
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Payment failed');
    }
  };

  const fmt = (v?: number) => v != null ? `TZS ${new Intl.NumberFormat('en-US').format(v)}` : '—';

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Subcontractors" subtitle="Construction subcontractor contracts and payment tracking" />
        <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
          <option value="">— Select Company —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? <Spinner /> : (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs text-slate-500">{total} subcontractors</div>
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Code</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Company</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Project</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Contact</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Contract Value</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Paid</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Status</th>
                <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400 text-sm">{companyId ? 'No subcontractors found.' : 'Select a company to view subcontractors.'}</td></tr>
              ) : items.map(s => (
                <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className={tdCls}><span className="font-mono text-xs" style={{ color: 'var(--aurora-text)' }}>{s.subcontractorCode}</span></td>
                  <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{s.companyName}</td>
                  <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{s.projectName ?? '—'}</td>
                  <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{s.contactPerson ?? '—'}</td>
                  <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmt(s.contractValue)}</td>
                  <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmt(s.amountPaid)}</td>
                  <td className={tdCls}><Badge status={s.status} /></td>
                  <td className={tdCls}>
                    {payingId === s.id ? (
                      <div className="flex gap-1 items-center">
                        <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                          placeholder="Amount" className="w-24 text-xs border border-slate-200 rounded px-2 py-1 text-slate-700" />
                        <button onClick={() => handlePayment(s.id)} className="text-xs font-medium text-emerald-600 hover:text-emerald-800">Pay</button>
                        <button onClick={() => { setPayingId(null); setPayAmount(''); }} className="text-xs text-slate-400 hover:text-slate-600">✕</button>
                      </div>
                    ) : (
                      s.status === 'ACTIVE' && (
                        <button onClick={() => setPayingId(s.id)} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">Record Payment</button>
                      )
                    )}
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
