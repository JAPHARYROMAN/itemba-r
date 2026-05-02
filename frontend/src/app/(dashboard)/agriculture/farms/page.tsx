'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, Btn, Modal, PageToolbar, FormInput, FormSelect, FormTextarea, PageSpinner, StatusBadge, ConfirmDialog } from '@/components/ui';

const OWNERSHIP_TYPES = ['OWNED', 'LEASED', 'RENTED', 'PARTNERSHIP', 'OTHER'];
const FARM_STATUSES = ['ACTIVE', 'INACTIVE', 'UNDER_PREPARATION', 'CLOSED'];

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

const EMPTY_FORM = { farmCode: '', name: '', location: '', sizeValue: '', sizeUnit: 'ACRES', ownershipType: 'OWNED', status: 'ACTIVE', notes: '' };

interface Company { id: string; name: string; }
interface Division { id: string; name: string; }

export default function FarmsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [divisionId, setDivisionId] = useState('');
  const [data, setData] = useState<{ data: any[]; total: number }>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (!companyId) { setDivisions([]); setDivisionId(''); return; }
    fetch(`/api/backend/divisions?companyId=${companyId}&limit=100`).then(r => r.json()).then(j => {
      const divs = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
      setDivisions(divs);
      if (divs.length > 0) setDivisionId(divs[0].id);
    });
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/agriculture/farms?companyId=${companyId}&page=1&limit=50`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setData(Array.isArray(json.data?.data) ? json.data : { data: Array.isArray(json.data) ? json.data : [], total: 0 });
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditing(null); setForm({ ...EMPTY_FORM }); setShowModal(true); }
  function openEdit(f: any) { setEditing(f); setForm({ farmCode: f.farmCode ?? '', name: f.name ?? '', location: f.location ?? '', sizeValue: f.sizeValue?.toString() ?? '', sizeUnit: f.sizeUnit ?? 'ACRES', ownershipType: f.ownershipType ?? 'OWNED', status: f.status ?? 'ACTIVE', notes: f.notes ?? '' }); setShowModal(true); }

  async function handleSave() {
    if (!form.name.trim()) { setError('Farm name is required'); return; }
    setSaving(true); setError('');
    try {
      const body = { ...form, sizeValue: form.sizeValue ? parseFloat(form.sizeValue) : undefined, companyId, divisionId };
      const url = editing ? `/api/backend/agriculture/farms/${editing.id}` : '/api/backend/agriculture/farms';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message ?? 'Save failed'); }
      setShowModal(false); await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/backend/agriculture/farms/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setDeleteId(null); await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Delete failed'); }
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Farms" subtitle="Farm registry and ownership records" />
      <PageToolbar
        filters={
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        }
        actions={companyId ? <Btn onClick={openCreate}>+ New Farm</Btn> : undefined}
      />
      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{data.total} farms</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Code</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Name</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Location</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Size</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Ownership</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No farms found.</td></tr>
                ) : data.data.map((f: any) => (
                  <tr key={f.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium text-indigo-600`}>{f.farmCode}</td>
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{f.name}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{f.location ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{f.sizeValue != null ? `${f.sizeValue} ${f.sizeUnit ?? ''}`.trim() : '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{f.ownershipType?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className={tdCls}><StatusBadge status={f.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-2">
                        <Btn variant="ghost" size="xs" onClick={() => openEdit(f)}>Edit</Btn>
                        <Btn variant="danger" size="xs" onClick={() => setDeleteId(f.id)}>Delete</Btn>
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
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Farm' : 'New Farm'}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn loading={saving} onClick={handleSave}>Save Farm</Btn>
          </>
        }
      >
        <div className="space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-red-600">{error}</div>}
          {divisions.length > 1 && (
            <FormSelect label="Division" value={divisionId} onChange={e => setDivisionId(e.target.value)}>
              {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </FormSelect>
          )}
          <div className="grid grid-cols-2 gap-4">
            <FormInput label="Farm Code" value={form.farmCode} onChange={e => setForm(p => ({ ...p, farmCode: e.target.value }))} placeholder="FARM-001" />
            <FormInput label="Name *" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Kilimani Farm" />
          </div>
          <FormInput label="Location" value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} placeholder="Moshi, Kilimanjaro" />
          <div className="grid grid-cols-2 gap-4">
            <FormInput label="Size" type="number" value={form.sizeValue} onChange={e => setForm(p => ({ ...p, sizeValue: e.target.value }))} placeholder="50" />
            <FormSelect label="Size Unit" value={form.sizeUnit} onChange={e => setForm(p => ({ ...p, sizeUnit: e.target.value }))}>
              {['ACRES', 'HECTARES', 'SQ_METERS', 'SQ_KM'].map(u => <option key={u} value={u}>{u}</option>)}
            </FormSelect>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormSelect label="Ownership Type" value={form.ownershipType} onChange={e => setForm(p => ({ ...p, ownershipType: e.target.value }))}>
              {OWNERSHIP_TYPES.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
            </FormSelect>
            <FormSelect label="Status" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
              {FARM_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </FormSelect>
          </div>
          <FormTextarea label="Notes" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={3} />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Farm"
        message="Delete this farm? This action cannot be undone."
        variant="danger"
        confirmLabel="Delete"
        onConfirm={() => handleDelete(deleteId!)}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}