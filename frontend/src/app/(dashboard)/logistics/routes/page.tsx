'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, Modal, Btn, PageToolbar, FormInput, FormSelect, FormTextarea, PageSpinner, StatusBadge, ConfirmDialog } from '@/components/ui';

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

interface Company { id: string; name: string; code: string; }
interface Division { id: string; name: string; code: string; }

function fmtCurrency(n: number) { return `TZS ${new Intl.NumberFormat('en-US').format(n)}`; }

const ROUTE_STATUSES = ['ACTIVE', 'INACTIVE'];

const EMPTY_FORM = { routeCode: '', name: '', origin: '', destination: '', distanceKm: '', estimatedDuration: '', standardRate: '', currency: 'TZS', status: 'ACTIVE', notes: '' };

export default function RoutesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [divisionId, setDivisionId] = useState('');
  const [data, setData] = useState<{ data: any[]; total: number }>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<null | 'create' | Record<string, any>>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLabel, setDeleteLabel] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (!companyId) { setDivisions([]); setDivisionId(''); return; }
    fetch(`/api/backend/divisions?companyId=${companyId}&limit=50`)
      .then(r => r.json())
      .then(j => {
        const divs = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
        setDivisions(divs);
        if (divs.length > 0) setDivisionId(divs[0].id);
        else setDivisionId('');
      });
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
      const res = await fetch(`/api/backend/logistics/routes?companyId=${companyId}&page=1&limit=20`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setData(Array.isArray(json.data?.data) ? json.data : { data: Array.isArray(json.data) ? json.data : [], total: 0 });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setModal('create');
  }

  function openEdit(row: any) {
    setForm({
      routeCode: row.routeCode ?? '',
      name: row.name ?? '',
      origin: row.origin ?? '',
      destination: row.destination ?? '',
      distanceKm: row.distanceKm ?? '',
      estimatedDuration: row.estimatedDuration ?? '',
      standardRate: row.standardRate ?? '',
      currency: row.currency ?? 'TZS',
      status: row.status ?? 'ACTIVE',
      notes: row.notes ?? '',
    });
    setModal(row);
  }

  async function handleSave() {
    if (!form.routeCode || !form.name || !form.origin || !form.destination) {
      alert('Route Code, Name, Origin, and Destination are required.');
      return;
    }
    setSaving(true);
    try {
      const isEdit = modal !== null && typeof modal !== 'string';
      const url = isEdit ? `/api/backend/logistics/routes/${(modal as any).id}` : '/api/backend/logistics/routes';
      const method = isEdit ? 'PUT' : 'POST';
      const body = {
        ...form,
        companyId,
        divisionId,
        distanceKm: form.distanceKm !== '' ? Number(form.distanceKm) : undefined,
        standardRate: form.standardRate !== '' ? Number(form.standardRate) : undefined,
      };
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message ?? 'Save failed'); }
      setModal(null);
      await load();
      setToast({ message: 'Route saved successfully.', type: 'success' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setToast({ message: 'Failed to save Route.', type: 'error' });
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/backend/logistics/routes/${deleteId}`, {
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

  const isEdit = modal !== null && typeof modal !== 'string';

  return (
    <div className="p-6 space-y-4">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded shadow-lg text-sm font-medium text-white transition-all ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}

      <PageHeader title="Routes" subtitle="Logistics route definitions and rates" />

      <PageToolbar
        filters={
          <select
            value={companyId}
            onChange={e => setCompanyId(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            style={{ color: 'var(--aurora-text)' }}
          >
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        }
        actions={companyId ? <Btn onClick={openCreate}>+ New Route</Btn> : undefined}
      />

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{data.total} routes</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Code</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Name</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Origin</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Destination</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Distance (km)</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Standard Rate</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Currency</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No routes found.</td></tr>
                ) : data.data.map((r: any) => (
                  <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{r.routeCode}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{r.name}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{r.origin}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{r.destination}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{r.distanceKm ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{r.standardRate != null ? fmtCurrency(r.standardRate) : '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{r.currency ?? 'TZS'}</td>
                    <td className={tdCls}><StatusBadge status={r.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-3">
                        <Btn variant="ghost" size="xs" onClick={() => openEdit(r)}>Edit</Btn>
                        <Btn variant="danger" size="xs" onClick={() => { setDeleteId(r.id); setDeleteLabel(r.name || r.routeCode); }}>Delete</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={isEdit ? 'Edit Route' : 'New Route'}
        size="lg"
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setModal(null)}>Cancel</Btn>
            <Btn loading={saving} onClick={handleSave}>Save</Btn>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormInput label="Route Code" value={form.routeCode} onChange={e => setForm(f => ({ ...f, routeCode: e.target.value }))} placeholder="e.g. RT-001" required />
          <FormInput label="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Route name" required />
          <FormInput label="Origin" value={form.origin} onChange={e => setForm(f => ({ ...f, origin: e.target.value }))} placeholder="e.g. Dar es Salaam" required />
          <FormInput label="Destination" value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} placeholder="e.g. Mwanza" required />
          <FormInput label="Distance (km)" type="number" value={form.distanceKm} onChange={e => setForm(f => ({ ...f, distanceKm: e.target.value }))} placeholder="km" min="0" />
          <FormInput label="Estimated Duration" value={form.estimatedDuration} onChange={e => setForm(f => ({ ...f, estimatedDuration: e.target.value }))} placeholder="e.g. 4 hours" />
          <FormInput label="Standard Rate" type="number" value={form.standardRate} onChange={e => setForm(f => ({ ...f, standardRate: e.target.value }))} placeholder="0.00" min="0" />
          <FormInput label="Currency" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} placeholder="TZS" />
          <FormSelect label="Status" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            {ROUTE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </FormSelect>
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
        title="Delete Route"
        message={`Are you sure you want to delete "${deleteLabel}"? This cannot be undone.`}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
