'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'BANK_CARD', 'CREDIT', 'OTHER'];

function fmtCurrency(n: number | string | null | undefined) { const value = Number(n ?? 0); return `TZS ${new Intl.NumberFormat('en-US').format(Number.isFinite(value) ? value : 0)}`; }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function genPaymentNumber() { const d = new Date(); return `PP-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(Math.floor(Math.random() * 9000) + 1000)}`; }

interface Session { id: string; sessionNumber: string; truckNumber: string; }

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function ParkingPaymentsPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ paymentNumber: genPaymentNumber(), parkingSessionId: '', paymentDate: todayStr(), amount: '', currency: 'TZS', paymentMethod: 'CASH', notes: '' });
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => {
      const list = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
      setCompanies(list);
      if (list.length > 0) setCompanyId(list[0].id);
    });
  }, []);

  useEffect(() => {
    if (!companyId) return;
    fetch(`/api/backend/parking-sessions?companyId=${companyId}&limit=100`).then(r => r.json()).then(j =>
      setSessions(Array.isArray(j.data?.data) ? j.data.data : []));
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/parking-payments?companyId=${companyId}&page=1&limit=50`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      const list = json.data?.data ?? [];
      setRows(list); setTotal(json.data?.total ?? list.length);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setForm({ paymentNumber: genPaymentNumber(), parkingSessionId: '', paymentDate: todayStr(), amount: '', currency: 'TZS', paymentMethod: 'CASH', notes: '' }); setShowModal(true); setError(''); }

  async function handleSave() {
    if (!form.parkingSessionId || !form.amount) { setError('Session and amount are required.'); return; }
    setSaving(true); setError('');
    try {
      const body: any = { paymentNumber: form.paymentNumber, companyId, parkingSessionId: form.parkingSessionId, paymentDate: form.paymentDate, amount: Number(form.amount), currency: form.currency, paymentMethod: form.paymentMethod, receivedById: user?.id, notes: form.notes || undefined };
      const res = await fetch('/api/backend/parking-payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(Array.isArray(j.message) ? j.message.join(', ') : j.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await fetch(`/api/backend/parking-payments/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null); load();
  }

  const sf = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Parking Payments" subtitle="Payment records for parking sessions" />
        <div className="flex items-center gap-3 flex-wrap">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {companyId && <Btn variant="primary" onClick={openCreate}>+ Record Payment</Btn>}
        </div>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}

      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{total} payments</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Payment #</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Session #</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Truck #</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Date</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Amount</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Currency</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Method</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Notes</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No payments found.</td></tr>
                ) : rows.map((row: any) => (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.paymentNumber ?? row.receiptNumber ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.parkingSession?.sessionNumber ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.parkingSession?.truckNumber ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(row.paymentDate)}</td>
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.amount != null ? fmtCurrency(row.amount) : '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.currency ?? '—'}</td>
                    <td className={tdCls}><StatusBadge status={row.paymentMethod ?? 'CASH'} /></td>
                    <td className={`${tdCls} max-w-[200px] truncate`} style={{ color: 'var(--aurora-text)' }}>{row.notes ?? '—'}</td>
                    <td className={tdCls}><Btn size="sm" variant="danger" onClick={() => setDeleteTarget(row)}>Delete</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Record Payment" size="md"
        footer={<><Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn><Btn variant="primary" loading={saving} onClick={handleSave}>Record Payment</Btn></>}
      >
        <div className="grid grid-cols-2 gap-4">
          <FormInput label="Payment Number" value={form.paymentNumber} onChange={sf('paymentNumber')} />
          <FormInput label="Payment Date" type="date" value={form.paymentDate} onChange={sf('paymentDate')} />
          <div className="col-span-2">
            <FormSelect label="Session *" value={form.parkingSessionId} onChange={sf('parkingSessionId')}>
              <option value="">— Select Session —</option>
              {sessions.map(s => <option key={s.id} value={s.id}>{s.sessionNumber} — {s.truckNumber}</option>)}
            </FormSelect>
          </div>
          <FormInput label="Amount *" type="number" value={form.amount} onChange={sf('amount')} placeholder="e.g. 50000" />
          <FormInput label="Currency" value={form.currency} onChange={sf('currency')} placeholder="TZS" />
          <div className="col-span-2">
            <FormSelect label="Payment Method" value={form.paymentMethod} onChange={sf('paymentMethod')}>
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
            </FormSelect>
          </div>
          <div className="col-span-2"><FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={2} /></div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Payment" message={`Delete payment "${deleteTarget?.paymentNumber}"? This cannot be undone.`} variant="danger" onConfirm={handleDelete} />
    </div>
  );
}
