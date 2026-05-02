'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

const ORDER_TYPES = ['DINE_IN', 'TAKEAWAY', 'ROOM_SERVICE', 'BAR', 'DELIVERY', 'OTHER'];
const fmtDate = (s: string) => s ? new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

interface Company { id: string; name: string; }
interface Facility { id: string; facilityName: string; }
interface Table { id: string; tableNumber: string; }
interface Guest { id: string; fullName: string; guestCode: string; }

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function RestaurantOrdersPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityFilter, setFacilityFilter] = useState('');
  const [activeOrders, setActiveOrders] = useState<any[]>([]);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ orderNumber: '', hospitalityFacilityId: '', orderType: 'DINE_IN', currency: 'TZS', tableId: '', guestId: '', notes: '' });
  const [modalTables, setModalTables] = useState<Table[]>([]);
  const [modalGuests, setModalGuests] = useState<Guest[]>([]);
  const [saving, setSaving] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j =>
      setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (!companyId) { setFacilities([]); return; }
    fetch(`/api/backend/hospitality-facilities?companyId=${companyId}&limit=100`).then(r => r.json()).then(j =>
      setFacilities(Array.isArray(j.data?.data) ? j.data.data : []));
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ companyId, limit: '100' });
      if (facilityFilter) qs.set('hospitalityFacilityId', facilityFilter);
      const res = await fetch(`/api/backend/restaurant-orders?${qs}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      const all: any[] = Array.isArray(json.data?.data) ? json.data.data : [];
      setActiveOrders(all.filter(o => ['PLACED', 'PREPARING', 'SERVED'].includes(o.status)));
      setRecentOrders(all.filter(o => ['COMPLETED', 'CANCELLED', 'VOIDED', 'DRAFT'].includes(o.status)).slice(0, 20));
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId, facilityFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!companyId || !form.hospitalityFacilityId) { setModalTables([]); return; }
    fetch(`/api/backend/restaurant-tables?companyId=${companyId}&hospitalityFacilityId=${form.hospitalityFacilityId}&limit=100`).then(r => r.json()).then(j =>
      setModalTables(Array.isArray(j.data?.data) ? j.data.data : []));
  }, [companyId, form.hospitalityFacilityId]);

  useEffect(() => {
    if (!companyId) { setModalGuests([]); return; }
    fetch(`/api/backend/guests?companyId=${companyId}&limit=200`).then(r => r.json()).then(j =>
      setModalGuests(Array.isArray(j.data?.data) ? j.data.data : []));
  }, [companyId]);

  const openNew = () => { setForm({ orderNumber: '', hospitalityFacilityId: '', orderType: 'DINE_IN', currency: 'TZS', tableId: '', guestId: '', notes: '' }); setShowModal(true); };

  const save = async () => {
    if (!user?.id) return;
    setSaving(true); setError('');
    try {
      const body: any = { ...form, companyId, createdById: user.id };
      if (!body.tableId) delete body.tableId;
      if (!body.guestId) delete body.guestId;
      const res = await fetch('/api/backend/restaurant-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(Array.isArray(j.message) ? j.message.join(', ') : j.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  };

  const placeOrder = async (id: string) => {
    try { await fetch(`/api/backend/restaurant-orders/${id}/place`, { method: 'PATCH' }); load(); }
    catch { setError('Action failed'); }
  };

  const completeOrder = async (id: string) => {
    try { await fetch(`/api/backend/restaurant-orders/${id}/complete`, { method: 'PATCH' }); load(); }
    catch { setError('Action failed'); }
  };

  const doCancel = async () => {
    if (!cancelTarget) return;
    try { await fetch(`/api/backend/restaurant-orders/${cancelTarget}/cancel`, { method: 'PATCH' }); setCancelTarget(null); load(); }
    catch { setError('Cancel failed'); }
  };

  const needsTable = ['DINE_IN', 'BAR'].includes(form.orderType);

  const sf = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <PageHeader title="Restaurant Orders" subtitle="Order management and workflow" />
        <div className="flex items-center gap-3 flex-wrap">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {facilities.length > 0 && (
            <select value={facilityFilter} onChange={e => setFacilityFilter(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white" style={{ color: 'var(--aurora-text)' }}>
              <option value="">All Facilities</option>
              {facilities.map(f => <option key={f.id} value={f.id}>{f.facilityName}</option>)}
            </select>
          )}
          {companyId && <Btn variant="primary" onClick={openNew}>+ New Order</Btn>}
        </div>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}

      {companyId && !loading && (
        <>
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
              <span className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>Active Orders</span>
              <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-semibold">{activeOrders.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Order #</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Facility</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Table</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Guest</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Type</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Created</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {activeOrders.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No active orders.</td></tr>
                  ) : activeOrders.map(o => (
                    <tr key={o.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className={`${tdCls} font-mono font-semibold`} style={{ color: 'var(--aurora-text)' }}>{o.orderNumber}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{o.hospitalityFacility?.facilityName ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{o.restaurantTable?.tableNumber ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{o.guest?.fullName ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{o.orderType?.replace(/_/g, ' ') ?? '—'}</td>
                      <td className={tdCls}><StatusBadge status={o.status} /></td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(o.createdAt)}</td>
                      <td className={tdCls}>
                        <div className="flex gap-1">
                          {o.status === 'DRAFT' && <Btn size="sm" variant="primary" onClick={() => placeOrder(o.id)}>Place</Btn>}
                          {['PLACED', 'PREPARING', 'SERVED'].includes(o.status) && <Btn size="sm" variant="success" onClick={() => completeOrder(o.id)}>Complete</Btn>}
                          <Btn size="sm" variant="danger" onClick={() => setCancelTarget(o.id)}>Cancel</Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>Recent Orders (last 20)</div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Order #</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Type</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Table</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Guest</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No recent orders.</td></tr>
                  ) : recentOrders.map(o => (
                    <tr key={o.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className={`${tdCls} font-mono`} style={{ color: 'var(--aurora-text)' }}>{o.orderNumber}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{o.orderType?.replace(/_/g, ' ') ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{o.restaurantTable?.tableNumber ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{o.guest?.fullName ?? '—'}</td>
                      <td className={tdCls}><StatusBadge status={o.status} /></td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Restaurant Order" size="lg"
        footer={<><Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn><Btn variant="primary" loading={saving} onClick={save}>Create Order</Btn></>}
      >
        <div className="space-y-4">
          <FormInput label="Order Number *" value={form.orderNumber} onChange={sf('orderNumber')} placeholder="e.g. ORD-001" />
          <FormSelect label="Facility *" value={form.hospitalityFacilityId} onChange={e => setForm(f => ({ ...f, hospitalityFacilityId: e.target.value, tableId: '' }))}>
            <option value="">— Select Facility —</option>
            {facilities.map(f => <option key={f.id} value={f.id}>{f.facilityName}</option>)}
          </FormSelect>
          <div className="grid grid-cols-2 gap-4">
            <FormSelect label="Order Type *" value={form.orderType} onChange={sf('orderType')}>
              {ORDER_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </FormSelect>
            <FormInput label="Currency" value={form.currency} onChange={sf('currency')} />
          </div>
          {needsTable && (
            <FormSelect label="Table" value={form.tableId} onChange={sf('tableId')}>
              <option value="">— Select Table —</option>
              {modalTables.map(t => <option key={t.id} value={t.id}>Table {t.tableNumber}</option>)}
            </FormSelect>
          )}
          <FormSelect label="Guest (optional)" value={form.guestId} onChange={sf('guestId')}>
            <option value="">— None —</option>
            {modalGuests.map(g => <option key={g.id} value={g.id}>{g.fullName} ({g.guestCode})</option>)}
          </FormSelect>
          <FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={2} />
        </div>
      </Modal>

      <ConfirmDialog open={!!cancelTarget} onClose={() => setCancelTarget(null)} title="Cancel Order?" message="Cancel this order? This cannot be undone." variant="danger" onConfirm={doCancel} />
    </div>
  );
}
