'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, PageHeader, PageToolbar, StatusBadge, Btn, PageSpinner, StatCard } from '@/components/ui';
import { unwrapList } from '@/lib/unwrap';

interface ExternalPayment {
  id: string;
  paymentNumber: string;
  provider?: { name: string };
  paymentContextType: string;
  payerName: string;
  amount: number;
  currency: string;
  status: string;
  paymentMethod: string;
  initiatedAt: string;
}

export default function ExternalPaymentsPage() {
  const [payments, setPayments] = useState<ExternalPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ initiated: 0, successful: 0, failed: 0, pending: 0 });
  const [filterStatus, setFilterStatus] = useState('');
  const [filterContextType, setFilterContextType] = useState('');
  const [filterMethod, setFilterMethod] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '50' });
    if (filterStatus) params.set('status', filterStatus);
    if (filterContextType) params.set('paymentContextType', filterContextType);
    if (filterMethod) params.set('paymentMethod', filterMethod);
    fetch(`/api/backend/external-payments?${params}`)
      .then(r => r.json())
      .then(data => {
        const list = unwrapList<ExternalPayment>(data);
        setPayments(list);
        setStats({
          initiated: list.filter(p => p.status === 'INITIATED').length,
          successful: list.filter(p => p.status === 'SUCCESSFUL').length,
          failed: list.filter(p => p.status === 'FAILED').length,
          pending: list.filter(p => p.status === 'PENDING').length,
        });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filterStatus, filterContextType, filterMethod]);

  useEffect(() => { load(); }, [load]);

  async function performAction(id: string, action: 'confirm' | 'reverse') {
    setActionId(id + action);
    try {
      await fetch(`/api/backend/external-payments/${id}/${action}`, { method: 'POST' });
      load();
    } catch (e) { console.error(e); }
    finally { setActionId(null); }
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="External Payments" subtitle="Track external payment transactions" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Initiated" value={stats.initiated} />
        <StatCard label="Successful" value={stats.successful} />
        <StatCard label="Failed" value={stats.failed} />
        <StatCard label="Pending" value={stats.pending} />
      </div>

      <PageToolbar
        filters={
          <>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}>
              <option value="">All Status</option>
              {['INITIATED','PENDING','SUCCESSFUL','FAILED','REVERSED','CONFIRMED'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <input value={filterContextType} onChange={e => setFilterContextType(e.target.value)} placeholder="Context type…" className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }} />
            <input value={filterMethod} onChange={e => setFilterMethod(e.target.value)} placeholder="Payment method…" className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }} />
          </>
        }
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Context Type</th>
                <th className="px-4 py-3">Payer</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Initiated At</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No payments found</td></tr>
              ) : payments.map(p => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{p.paymentNumber}</td>
                  <td className="px-4 py-3">{p.provider?.name ?? '—'}</td>
                  <td className="px-4 py-3">{p.paymentContextType}</td>
                  <td className="px-4 py-3">{p.payerName}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    {p.currency}{' '}
                    {Number.isFinite(Number(p.amount)) ? Number(p.amount).toLocaleString() : '0'}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-3">{p.paymentMethod}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{p.initiatedAt ? new Date(p.initiatedAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1 flex-wrap">
                      {p.status === 'INITIATED' && (
                        <Btn variant="success" size="xs" onClick={() => performAction(p.id, 'confirm')} loading={actionId === p.id + 'confirm'}>Confirm</Btn>
                      )}
                      {['INITIATED','CONFIRMED','SUCCESSFUL'].includes(p.status) && (
                        <Btn variant="danger" size="xs" onClick={() => performAction(p.id, 'reverse')} loading={actionId === p.id + 'reverse'}>Reverse</Btn>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
