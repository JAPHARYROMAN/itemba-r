'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, Modal, Btn, PageToolbar, FormInput, FormSelect, FormTextarea, DateInput, PageSpinner, StatusBadge, ConfirmDialog } from '@/components/ui';

const LICENSE_CLASSES = ['A','B','C','D','E','C1','C1E'];
const DRIVER_STATUSES = ['ACTIVE','INACTIVE','SUSPENDED','TERMINATED'];

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

interface Company { id: string; name: string; code: string; }
interface Division { id: string; name: string; code: string; }

const EMPTY_FORM = { driverCode: '', fullName: '', phone: '', licenseNumber: '', licenseClass: 'C', licenseExpiryDate: '', status: 'ACTIVE', emergencyContact: '', notes: '' };

export default function DriversPage() {
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
      const res = await fetch(`/api/backend/logistics/drivers?companyId=${companyId}&page=1&limit=20`);
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
      driverCode: row.driverCode ?? '',
      fullName: row.fullName ?? '',
      phone: row.phone ?? '',
      licenseNumber: row.licenseNumber ?? '',
      licenseClass: row.licenseClass ?? 'C',
      licenseExpiryDate: row.licenseExpiryDate ? row.licenseExpiryDate.slice(0, 10) : '',
      status: row.status ?? 'ACTIVE',
      emergencyContact: row.emergencyContact ?? '',
      notes: row.notes ?? '',
    });
    setModal(row);
  }

  async function handleSave() {
    if (!form.driverCode || !form.fullName) {
      alert('Driver Code and Full Name are required.');
      return;
    }
    setSaving(true);
    try {
      const isEdit = modal !== null && typeof modal !== 'string';
      const url = isEdit ? `/api/backend/logistics/drivers/${(modal as any).id}` : '/api/backend/logistics/drivers';
      const method = isEdit ? 'PUT' : 'POST';
      const body = { ...form, companyId, divisionId };
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message ?? 'Save failed'); }
      setModal(null);
      await load();
      setToast({ message: 'Driver saved successfully.', type: 'success' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setToast({ message: 'Failed to save Driver.', type: 'error' });
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/backend/logistics/drivers/${deleteId}`, {
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

      <PageHeader title="Drivers" subtitle="Driver profiles and license management" />

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
        actions={companyId ? <Btn onClick={openCreate}>+ New Driver</Btn> : undefined}
      />

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{data.total} drivers</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Code</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Full Name</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Phone</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>License #</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>License Class</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>License Expiry</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No drivers found.</td></tr>
                ) : data.data.map((d: any) => (
                  <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{d.driverCode}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{d.fullName}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{d.phone ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{d.licenseNumber ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{d.licenseClass ?? '—'}</td>
                    <td className={`${tdCls} ${d.licenseExpiryDate && new Date(d.licenseExpiryDate) < new Date() ? 'text-red-600 font-semibold' : ''}`} style={d.licenseExpiryDate && new Date(d.licenseExpiryDate) < new Date() ? {} : { color: 'var(--aurora-text)' }}>
                      {d.licenseExpiryDate ? new Date(d.licenseExpiryDate).toLocaleDateString() : '—'}
                      {d.licenseExpiryDate && new Date(d.licenseExpiryDate) < new Date() && <span className="ml-1 text-xs bg-red-100 text-red-700 px-1 rounded">EXPIRED</span>}
                    </td>
                    <td className={tdCls}><StatusBadge status={d.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-3">
                        <Btn variant="ghost" size="xs" onClick={() => openEdit(d)}>Edit</Btn>
                        <Btn variant="danger" size="xs" onClick={() => { setDeleteId(d.id); setDeleteLabel(d.fullName || d.driverCode); }}>Delete</Btn>
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
        title={isEdit ? 'Edit Driver' : 'New Driver'}
        size="lg"
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setModal(null)}>Cancel</Btn>
            <Btn loading={saving} onClick={handleSave}>Save</Btn>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormInput label="Driver Code" value={form.driverCode} onChange={e => setForm(f => ({ ...f, driverCode: e.target.value }))} placeholder="e.g. DRV-001" required />
          <FormInput label="Full Name" value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} placeholder="Full name" required />
          <FormInput label="Phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+255…" />
          <FormInput label="Emergency Contact" value={form.emergencyContact} onChange={e => setForm(f => ({ ...f, emergencyContact: e.target.value }))} placeholder="Name / phone" />
          <FormInput label="License Number" value={form.licenseNumber} onChange={e => setForm(f => ({ ...f, licenseNumber: e.target.value }))} placeholder="License #" />
          <FormSelect label="License Class" value={form.licenseClass} onChange={e => setForm(f => ({ ...f, licenseClass: e.target.value }))}>
            {LICENSE_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
          </FormSelect>
          <DateInput label="License Expiry" value={form.licenseExpiryDate} onChange={e => setForm(f => ({ ...f, licenseExpiryDate: e.target.value }))} />
          <FormSelect label="Status" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            {DRIVER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
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
        title="Delete Driver"
        message={`Are you sure you want to delete "${deleteLabel}"? This cannot be undone.`}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
