'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, Btn, Modal, PageToolbar, FormInput, FormSelect, FormTextarea, PageSpinner, StatusBadge, ConfirmDialog } from '@/components/ui';

const FIELD_STATUSES = ['ACTIVE', 'INACTIVE', 'FALLOW', 'PLANTED', 'HARVESTED'];

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

const EMPTY_FORM = { fieldCode: '', name: '', farmId: '', sizeValue: '', soilType: '', irrigationType: '', status: 'ACTIVE', notes: '' };

interface Company { id: string; name: string; }
interface Division { id: string; name: string; }
interface Farm { id: string; name: string; }

export default function FieldsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [divisionId, setDivisionId] = useState('');
  const [farms, setFarms] = useState<Farm[]>([]);
  const [farmFilter, setFarmFilter] = useState('');
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
    if (!companyId) { setDivisions([]); setDivisionId(''); setFarms([]); return; }
    fetch(`/api/backend/divisions?companyId=${companyId}&limit=100`).then(r => r.json()).then(j => {
      const divs = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
      setDivisions(divs);
      if (divs.length > 0) setDivisionId(divs[0].id);
    });
    fetch(`/api/backend/agriculture/farms?companyId=${companyId}&page=1&limit=100`).then(r => r.json()).then(j => {
      setFarms(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    });
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ companyId, page: '1', limit: '50' });
      if (farmFilter) params.set('farmId', farmFilter);
      const res = await fetch(`/api/backend/agriculture/farm-fields?${params}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setData(Array.isArray(json.data?.data) ? json.data : { data: Array.isArray(json.data) ? json.data : [], total: 0 });
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId, farmFilter]);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditing(null); setForm({ ...EMPTY_FORM }); setShowModal(true); }
  function openEdit(f: any) {
    setEditing(f);
    setForm({ fieldCode: f.fieldCode ?? '', name: f.name ?? '', farmId: f.farmId ?? '', sizeValue: f.sizeValue?.toString() ?? '', soilType: f.soilType ?? '', irrigationType: f.irrigationType ?? '', status: f.status ?? 'ACTIVE', notes: f.notes ?? '' });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Field name is required'); return; }
    setSaving(true); setError('');
    try {
      const body = { ...form, sizeValue: form.sizeValue ? parseFloat(form.sizeValue) : undefined, companyId, divisionId };
      const url = editing ? `/api/backend/agriculture/farm-fields/${editing.id}` : '/api/backend/agriculture/farm-fields';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message ?? 'Save failed'); }
      setShowModal(false); await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/backend/agriculture/farm-fields/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setDeleteId(null); await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Delete failed'); }
  }

  const farmName = (id: string) => farms.find(f => f.id === id)?.name ?? id ?? '—';

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Farm Fields" subtitle="Field records, soil and irrigation data" />
      <PageToolbar
        filters={
          <>
            <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
              <option value="">— Select Company —</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {companyId && (
              <select value={farmFilter} onChange={e => setFarmFilter(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
                <option value="">All Farms</option>
                {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            )}
          </>
        }
        actions={companyId ? <Btn onClick={openCreate}>+ New Field</Btn> : undefined}
      />
      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{data.total} fields</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Code</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Name</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Farm</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Size</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Soil Type</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Irrigation</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No fields found.</td></tr>
                ) : data.data.map((f: any) => (
                  <tr key={f.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium text-indigo-600`}>{f.fieldCode}</td>
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{f.name}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{farmName(f.farmId)}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{f.sizeValue != null ? `${f.sizeValue}`.trim() : '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{f.soilType?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{f.irrigationType?.replace(/_/g, ' ') ?? '—'}</td>
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
        title={editing ? 'Edit Field' : 'New Field'}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn loading={saving} onClick={handleSave}>Save Field</Btn>
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
            <FormInput label="Field Code" value={form.fieldCode} onChange={e => setForm(p => ({ ...p, fieldCode: e.target.value }))} placeholder="FLD-001" />
            <FormInput label="Name *" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="North Field" />
          </div>
          <FormSelect label="Farm" value={form.farmId} onChange={e => setForm(p => ({ ...p, farmId: e.target.value }))}>
            <option value="">— Select Farm —</option>
            {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </FormSelect>
          <div className="grid grid-cols-2 gap-4">
            <FormInput label="Size (ha/acres)" type="number" value={form.sizeValue} onChange={e => setForm(p => ({ ...p, sizeValue: e.target.value }))} placeholder="10" />
            <FormSelect label="Status" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
              {FIELD_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </FormSelect>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormInput label="Soil Type" value={form.soilType} onChange={e => setForm(p => ({ ...p, soilType: e.target.value }))} placeholder="Clay, Loam…" />
            <FormInput label="Irrigation Type" value={form.irrigationType} onChange={e => setForm(p => ({ ...p, irrigationType: e.target.value }))} placeholder="Drip, Flood…" />
          </div>
          <FormTextarea label="Notes" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={3} />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Field"
        message="Delete this field? This action cannot be undone."
        variant="danger"
        confirmLabel="Delete"
        onConfirm={() => handleDelete(deleteId!)}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
