'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, Modal, Btn, PageToolbar, FormInput, FormSelect, FormTextarea, DateInput, PageSpinner, StatusBadge, ConfirmDialog } from '@/components/ui';
import Link from 'next/link';

const TRIP_STATUSES = ['PLANNED','DISPATCHED','IN_TRANSIT','COMPLETED','CLOSED','CANCELLED'];

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

interface Company { id: string; name: string; code: string; }
interface Division { id: string; name: string; code: string; }
interface Route { id: string; name: string; origin: string; destination: string; }

function fmtCurrency(n: number) { return `TZS ${new Intl.NumberFormat('en-US').format(n)}`; }
function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }

const ACTION_MAP: Record<string, { label: string; endpoint: string }> = {
  PLANNED: { label: 'Dispatch', endpoint: 'dispatch' },
  DISPATCHED: { label: 'In Transit', endpoint: 'in-transit' },
  IN_TRANSIT: { label: 'Complete', endpoint: 'complete' },
  COMPLETED: { label: 'Close', endpoint: 'close' },
};

const EMPTY_FORM = { vehicleId: '', driverId: '', routeId: '', origin: '', destination: '', cargoDescription: '', cargoWeight: '', tripDate: '', expectedReturnDate: '', revenueAmount: '', currency: 'TZS', customerName: '', notes: '' };

export default function TripsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [divisionId, setDivisionId] = useState('');
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [data, setData] = useState<{ data: any[]; total: number }>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'create'>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLabel, setDeleteLabel] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (!companyId) { setDivisions([]); setDivisionId(''); setVehicles([]); setDrivers([]); setRoutes([]); return; }
    fetch(`/api/backend/divisions?companyId=${companyId}&limit=50`)
      .then(r => r.json())
      .then(j => {
        const divs = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
        setDivisions(divs);
        if (divs.length > 0) setDivisionId(divs[0].id);
        else setDivisionId('');
      });
    fetch(`/api/backend/logistics/vehicles?companyId=${companyId}&limit=100`)
      .then(r => r.json())
      .then(j => setVehicles(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    fetch(`/api/backend/logistics/drivers?companyId=${companyId}&limit=100`)
      .then(r => r.json())
      .then(j => setDrivers(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    fetch(`/api/backend/logistics/routes?companyId=${companyId}&limit=100`)
      .then(r => r.json())
      .then(j => setRoutes(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, [companyId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ companyId, page: '1', limit: '20' });
      if (statusFilter) params.set('status', statusFilter);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await fetch(`/api/backend/logistics/trips?${params}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Failed to load');
      }
      const json = await res.json();
      setData(Array.isArray(json.data?.data) ? json.data : { data: Array.isArray(json.data) ? json.data : [], total: 0 });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally { setLoading(false); }
  }, [companyId, statusFilter, from, to]);

  useEffect(() => { load(); }, [load]);

  async function handleAction(tripId: string, endpoint: string) {
    setActionLoading(tripId);
    try {
      const res = await fetch(`/api/backend/logistics/trips/${tripId}/${endpoint}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error('Action failed');
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally { setActionLoading(null); }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/backend/logistics/trips/${deleteId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
      });
      if (!res.ok) throw new Error('Delete failed');
      setToast({ message: `${deleteLabel} deleted successfully.`, type: 'success' });
      await load();
    } catch {
      setToast({ message: `Failed to delete ${deleteLabel}.`, type: 'error' });
    } finally { setDeleteId(null); }
  }

  async function handleSave() {
    if (!divisionId) {
      setToast({ message: 'Create a division for this company before creating trips.', type: 'error' });
      return;
    }
    if (!form.vehicleId) {
      setToast({ message: 'Vehicle is required.', type: 'error' });
      return;
    }
    if (!form.driverId) {
      setToast({ message: 'Driver is required.', type: 'error' });
      return;
    }
    if (!form.origin.trim() || !form.destination.trim() || !form.tripDate) {
      setToast({ message: 'Origin, destination, and trip date are required.', type: 'error' });
      return;
    }
    const activeStatuses = ['DISPATCHED', 'IN_TRANSIT'];
    if (form.vehicleId) {
      const vehicleConflict = data.data.some(
        (t: any) => t.vehicleId === form.vehicleId && activeStatuses.includes(t.status)
      );
      if (vehicleConflict) {
        setToast({ message: 'Selected vehicle is already on an active trip.', type: 'error' });
        return;
      }
    }
    if (form.driverId) {
      const driverConflict = data.data.some(
        (t: any) => t.driverId === form.driverId && activeStatuses.includes(t.status)
      );
      if (driverConflict) {
        setToast({ message: 'Selected driver is already on an active trip.', type: 'error' });
        return;
      }
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        companyId,
        divisionId,
        vehicleId: form.vehicleId,
        driverId: form.driverId,
        origin: form.origin.trim(),
        destination: form.destination.trim(),
        tripDate: form.tripDate,
        currency: form.currency.trim() || 'TZS',
        cargoWeight: form.cargoWeight !== '' ? Number(form.cargoWeight) : undefined,
        revenueAmount: form.revenueAmount !== '' ? Number(form.revenueAmount) : undefined,
      };
      if (form.routeId) body.routeId = form.routeId;
      if (form.expectedReturnDate) body.expectedReturnDate = form.expectedReturnDate;
      if (form.customerName.trim()) body.customerName = form.customerName.trim();
      if (form.cargoDescription.trim()) body.cargoDescription = form.cargoDescription.trim();
      if (form.notes.trim()) body.notes = form.notes.trim();
      const res = await fetch('/api/backend/logistics/trips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message ?? 'Save failed'); }
      setModal(null);
      await load();
      setToast({ message: 'Trip created successfully.', type: 'success' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setToast({ message: 'Failed to save Trip.', type: 'error' });
    } finally { setSaving(false); }
  }

  return (
    <div className="p-6 space-y-4">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded shadow-lg text-sm font-medium text-white transition-all ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}

      <PageHeader title="Trips" subtitle="Logistics trip management and status tracking" />

      <PageToolbar
        filters={
          <>
            <select
              value={companyId}
              onChange={e => setCompanyId(e.target.value)}
              className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
              style={{ color: 'var(--aurora-text)' }}
            >
              <option value="">— Select Company —</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
              style={{ color: 'var(--aurora-text)' }}
            >
              <option value="">All Statuses</option>
              {TRIP_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border border-slate-200 rounded-md px-2 py-1.5 text-sm" style={{ color: 'var(--aurora-text)' }} />
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border border-slate-200 rounded-md px-2 py-1.5 text-sm" style={{ color: 'var(--aurora-text)' }} />
            <Btn variant="ghost" size="sm" onClick={() => { setFrom(''); setTo(''); }}>Clear</Btn>
          </>
        }
        actions={companyId ? <Btn onClick={() => { setForm({ ...EMPTY_FORM }); setModal('create'); }}>+ New Trip</Btn> : undefined}
      />

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{data.total} trips</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Trip #</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Origin</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Destination</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Trip Date</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Revenue</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Vehicle</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Driver</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No trips found.</td></tr>
                ) : data.data.map((t: any) => {
                  const action = ACTION_MAP[t.status];
                  const canDelete = t.status === 'PLANNED' || t.status === 'CANCELLED';
                  return (
                    <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>
                        <Link href={`/logistics/trips/${t.id}`} className="text-indigo-600 hover:text-indigo-800 hover:underline">{t.tripNumber}</Link>
                      </td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{t.origin ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{t.destination ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{t.tripDate ? fmtDate(t.tripDate) : '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{t.revenueAmount != null ? fmtCurrency(t.revenueAmount) : '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{t.vehicle?.registrationNumber ?? t.vehicleId ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{t.driver?.fullName ?? t.driverId ?? '—'}</td>
                      <td className={tdCls}><StatusBadge status={t.status} /></td>
                      <td className={tdCls}>
                        <div className="flex gap-2 flex-wrap">
                          {action && (
                            <Btn
                              size="xs"
                              onClick={() => handleAction(t.id, action.endpoint)}
                              loading={actionLoading === t.id}
                            >
                              {action.label}
                            </Btn>
                          )}
                          {canDelete && (
                            <Btn variant="danger" size="xs" onClick={() => { setDeleteId(t.id); setDeleteLabel(t.tripNumber || t.id?.slice(0, 8)); }}>Delete</Btn>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={modal === 'create'}
        onClose={() => setModal(null)}
        title="New Trip"
        size="lg"
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setModal(null)}>Cancel</Btn>
            <Btn loading={saving} onClick={handleSave}>Create Trip</Btn>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormInput label="Origin" value={form.origin} onChange={e => setForm(f => ({ ...f, origin: e.target.value }))} placeholder="e.g. Dar es Salaam" required />
          <FormInput label="Destination" value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} placeholder="e.g. Mwanza" required />
          <DateInput label="Trip Date" value={form.tripDate} onChange={e => setForm(f => ({ ...f, tripDate: e.target.value }))} required />
          <DateInput label="Expected Return Date" value={form.expectedReturnDate} onChange={e => setForm(f => ({ ...f, expectedReturnDate: e.target.value }))} />
          <FormSelect label="Vehicle" value={form.vehicleId} onChange={e => setForm(f => ({ ...f, vehicleId: e.target.value }))} placeholder="— Select Vehicle —" required>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.vehicleCode} – {v.registrationNumber}</option>)}
          </FormSelect>
          <FormSelect label="Driver" value={form.driverId} onChange={e => setForm(f => ({ ...f, driverId: e.target.value }))} placeholder="— Select Driver —" required>
            {drivers.map(d => <option key={d.id} value={d.id}>{d.fullName} ({d.driverCode})</option>)}
          </FormSelect>
          <FormSelect label="Route" value={form.routeId} onChange={e => setForm(f => ({ ...f, routeId: e.target.value }))} placeholder="— Optional Route —">
            {routes.map(r => <option key={r.id} value={r.id}>{r.name} ({r.origin} → {r.destination})</option>)}
          </FormSelect>
          <FormInput label="Customer Name" value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))} placeholder="Customer" />
          <FormInput label="Cargo Description" value={form.cargoDescription} onChange={e => setForm(f => ({ ...f, cargoDescription: e.target.value }))} placeholder="What's being transported" />
          <FormInput label="Cargo Weight (kg)" type="number" value={form.cargoWeight} onChange={e => setForm(f => ({ ...f, cargoWeight: e.target.value }))} placeholder="kg" min="0" />
          <FormInput label="Revenue Amount" type="number" value={form.revenueAmount} onChange={e => setForm(f => ({ ...f, revenueAmount: e.target.value }))} placeholder="0.00" min="0" />
          <FormInput label="Currency" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} placeholder="TZS" />
          {divisions.length > 1 && (
            <FormSelect label="Division" value={divisionId} onChange={e => setDivisionId(e.target.value)}>
              {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </FormSelect>
          )}
          <FormTextarea className="sm:col-span-2" label="Notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes…" rows={3} />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Trip"
        message={`Are you sure you want to delete trip "${deleteLabel}"? This cannot be undone.`}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
