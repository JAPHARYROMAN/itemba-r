'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'BANK_CARD', 'CREDIT', 'OTHER'];
const CONTEXT_TYPES = ['ROOM_BOOKING', 'RESTAURANT_ORDER', 'BAR_ORDER', 'GENERAL'];
const fmtCurrency = (n: number | string | null | undefined, cur: string) => { const value = Number(n ?? 0); return `${cur} ${new Intl.NumberFormat('en-US').format(Number.isFinite(value) ? value : 0)}`; };
const fmtDate = (s: string) => s ? new Date(s).toLocaleDateString('en-GB') : '—';

interface Company { id: string; name: string; }
interface Guest { id: string; fullName: string; guestCode: string; }
interface Booking { id: string; bookingNumber: string; }
interface Order { id: string; orderNumber: string; }

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function HospitalityPaymentsPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [guests, setGuests] = useState<Guest[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ paymentNumber: '', paymentDate: new Date().toISOString().split('T')[0], amount: '', currency: 'TZS', paymentMethod: 'CASH', paymentContextType: 'GENERAL', roomBookingId: '', restaurantOrderId: '', guestId: '', reference: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j =>
      setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (!companyId) { setGuests([]); setBookings([]); setOrders([]); return; }
    Promise.all([
      fetch(`/api/backend/guests?companyId=${companyId}&limit=200`).then(r => r.json()),
      fetch(`/api/backend/room-bookings?companyId=${companyId}&limit=200`).then(r => r.json()),
      fetch(`/api/backend/restaurant-orders?companyId=${companyId}&limit=200`).then(r => r.json()),
    ]).then(([gj, bj, oj]) => {
      setGuests(Array.isArray(gj.data?.data) ? gj.data.data : []);
      setBookings(Array.isArray(bj.data?.data) ? bj.data.data : []);
      setOrders(Array.isArray(oj.data?.data) ? oj.data.data : []);
    });
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/hospitality-payments?companyId=${companyId}&limit=100`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      const list = Array.isArray(json.data?.data) ? json.data.data : [];
      setRows(list); setTotal(json.data?.total ?? list.length);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setForm({ paymentNumber: '', paymentDate: new Date().toISOString().split('T')[0], amount: '', currency: 'TZS', paymentMethod: 'CASH', paymentContextType: 'GENERAL', roomBookingId: '', restaurantOrderId: '', guestId: '', reference: '', notes: '' }); setShowModal(true); };

  const save = async () => {
    if (!user?.id) return;
    setSaving(true); setError('');
    try {
      const body: any = { ...form, companyId, receivedById: user.id, amount: parseFloat(form.amount) || 0 };
      if (!body.roomBookingId) delete body.roomBookingId;
      if (!body.restaurantOrderId) delete body.restaurantOrderId;
      if (!body.guestId) delete body.guestId;
      if (!body.reference) delete body.reference;
      if (!body.paymentContextType) delete body.paymentContextType;
      const res = await fetch('/api/backend/hospitality-payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(Array.isArray(j.message) ? j.message.join(', ') : j.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  };

  const doDelete = async () => {
    if (!deleteId) return;
    await fetch(`/api/backend/hospitality-payments/${deleteId}`, { method: 'DELETE' });
    setDeleteId(null); load();
  };

  const totalAmount = rows.reduce((s, r) => s + (Number(r.amount ?? 0) || 0), 0);
  const sf = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <PageHeader title="Hospitality Payments" subtitle="Room bookings and restaurant payment records" />
        <div className="flex items-center gap-3 flex-wrap">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {companyId && <Btn variant="primary" onClick={openNew}>+ Record Payment</Btn>}
        </div>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}

      {companyId && !loading && rows.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 flex gap-6 text-sm">
          <div><span className="text-emerald-600 font-medium">Total Payments:</span> <span className="font-bold text-emerald-800">{fmtCurrency(totalAmount, 'TZS')}</span></div>
          <div><span style={{ color: 'var(--aurora-text-muted)' }}>Count:</span> <span className="font-semibold" style={{ color: 'var(--aurora-text)' }}>{total}</span></div>
        </div>
      )}

      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{total} payments</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Payment #</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Date</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Guest</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Booking / Order</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Amount</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Method</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Context</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Reference</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No payments found.</td></tr>
                ) : rows.map(row => (
                  <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-mono font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.paymentNumber}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(row.paymentDate)}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.guest?.fullName ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.roomBooking?.bookingNumber ?? row.restaurantOrder?.orderNumber ?? '—'}</td>
                    <td className={`${tdCls} font-semibold`} style={{ color: 'var(--aurora-text)' }}>{row.amount ? fmtCurrency(row.amount, row.currency ?? 'TZS') : '—'}</td>
                    <td className={tdCls}><StatusBadge status={row.paymentMethod} /></td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.paymentContextType?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.reference ?? '—'}</td>
                    <td className={tdCls}><Btn size="sm" variant="danger" onClick={() => setDeleteId(row.id)}>Delete</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Record Payment" size="xl"
        footer={<><Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn><Btn variant="primary" loading={saving} onClick={save}>Record Payment</Btn></>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormInput label="Payment Number *" value={form.paymentNumber} onChange={sf('paymentNumber')} placeholder="e.g. PAY-001" />
            <FormInput label="Payment Date *" type="date" value={form.paymentDate} onChange={sf('paymentDate')} />
            <FormInput label="Amount *" type="number" value={form.amount} onChange={sf('amount')} placeholder="0" />
            <FormInput label="Currency" value={form.currency} onChange={sf('currency')} />
            <FormSelect label="Payment Method *" value={form.paymentMethod} onChange={sf('paymentMethod')}>
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
            </FormSelect>
            <FormSelect label="Context Type" value={form.paymentContextType} onChange={sf('paymentContextType')}>
              {CONTEXT_TYPES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </FormSelect>
          </div>
          <FormSelect label="Guest" value={form.guestId} onChange={sf('guestId')}>
            <option value="">— None —</option>
            {guests.map(g => <option key={g.id} value={g.id}>{g.fullName} ({g.guestCode})</option>)}
          </FormSelect>
          {['ROOM_BOOKING'].includes(form.paymentContextType) && (
            <FormSelect label="Room Booking" value={form.roomBookingId} onChange={sf('roomBookingId')}>
              <option value="">— None —</option>
              {bookings.map(b => <option key={b.id} value={b.id}>{b.bookingNumber}</option>)}
            </FormSelect>
          )}
          {['RESTAURANT_ORDER', 'BAR_ORDER'].includes(form.paymentContextType) && (
            <FormSelect label="Restaurant Order" value={form.restaurantOrderId} onChange={sf('restaurantOrderId')}>
              <option value="">— None —</option>
              {orders.map(o => <option key={o.id} value={o.id}>{o.orderNumber}</option>)}
            </FormSelect>
          )}
          <FormInput label="Reference" value={form.reference} onChange={sf('reference')} placeholder="e.g. receipt number or mobile money ref" />
          <FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={2} />
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Payment Record?" message="This action cannot be undone." variant="danger" onConfirm={doDelete} />
    </div>
  );
}
