'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';

const FACILITY_STATUSES = ['ACTIVE', 'INACTIVE', 'FULL', 'UNDER_MAINTENANCE', 'CLOSED'];

interface Company { id: string; name: string; code: string; }
interface Division { id: string; name: string; }

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function ParkingFacilitiesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [form, setForm] = useState({ facilityCode: '', facilityName: '', location: '', status: 'ACTIVE', divisionId: '', capacityTrucks: '', notes: '' });
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
    fetch(`/api/backend/divisions?companyId=${companyId}&limit=100`).then(r => r.json()).then(j =>
      setDivisions(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/parking-facilities?companyId=${companyId}&page=1&limit=100`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      const list = json.data?.data ?? [];
      setRows(list); setTotal(json.data?.total ?? list.length);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditRow(null); setForm({ facilityCode: '', facilityName: '', location: '', status: 'ACTIVE', divisionId: '', capacityTrucks: '', notes: '' }); setShowModal(true); }
  function openEdit(row: any) {
    setEditRow(row);
    setForm({ facilityCode: row.facilityCode ?? '', facilityName: row.facilityName ?? '', location: row.location ?? '', status: row.status ?? 'ACTIVE', divisionId: row.divisionId ?? '', capacityTrucks: row.capacityTrucks ?? '', notes: row.notes ?? '' });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.facilityCode || !form.facilityName || !form.location) { setError('Code, Name and Location are required.'); return; }
    setSaving(true); setError('');
    try {
      const body: any = { facilityCode: form.facilityCode, facilityName: form.facilityName, location: form.location, companyId, status: form.status || undefined, divisionId: form.divisionId || undefined, capacityTrucks: form.capacityTrucks ? Number(form.capacityTrucks) : undefined, notes: form.notes || undefined };
      const url = editRow ? `/api/backend/parking-facilities/${editRow.id}` : '/api/backend/parking-facilities';
      const res = await fetch(url, { method: editRow ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await fetch(`/api/backend/parking-facilities/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null); load();
  }

  const sf = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Parking Facilities" subtitle="Parking facility registry" />
        <div className="flex items-center gap-3 flex-wrap">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {companyId && <Btn variant="primary" onClick={openCreate}>+ New Facility</Btn>}
        </div>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}

      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{total} facilities</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Code</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Name</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Location</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Capacity</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No facilities found.</td></tr>
                ) : rows.map((row: any) => (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.facilityCode}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.facilityName}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.location ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.capacityTrucks ?? '—'}</td>
                    <td className={tdCls}><StatusBadge status={row.status ?? 'UNKNOWN'} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-1">
                        <Btn size="sm" variant="secondary" onClick={() => openEdit(row)}>Edit</Btn>
                        <Btn size="sm" variant="danger" onClick={() => setDeleteTarget(row)}>Delete</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editRow ? 'Edit Facility' : 'New Parking Facility'} size="lg"
        footer={<><Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn><Btn variant="primary" loading={saving} onClick={handleSave}>{editRow ? 'Save Changes' : 'Create Facility'}</Btn></>}
      >
        <div className="grid grid-cols-2 gap-4">
          <FormInput label="Facility Code *" value={form.facilityCode} onChange={sf('facilityCode')} placeholder="e.g. FAC-001" />
          <FormSelect label="Status" value={form.status} onChange={sf('status')}>
            {FACILITY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </FormSelect>
          <div className="col-span-2"><FormInput label="Facility Name *" value={form.facilityName} onChange={sf('facilityName')} placeholder="e.g. Main Parking Yard" /></div>
          <div className="col-span-2"><FormInput label="Location *" value={form.location} onChange={sf('location')} placeholder="e.g. Dar es Salaam, Block A" /></div>
          <FormInput label="Capacity (Trucks)" type="number" value={form.capacityTrucks} onChange={sf('capacityTrucks')} placeholder="e.g. 50" />
          <FormSelect label="Division" value={form.divisionId} onChange={sf('divisionId')}>
            <option value="">— None —</option>
            {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </FormSelect>
          <div className="col-span-2"><FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={2} /></div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Facility" message={`Delete "${deleteTarget?.facilityName}"? This cannot be undone.`} variant="danger" onConfirm={handleDelete} />
    </div>
  );
}
