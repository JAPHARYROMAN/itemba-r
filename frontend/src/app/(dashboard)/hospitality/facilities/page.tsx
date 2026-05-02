'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

const FACILITY_TYPES = ['GUEST_HOUSE', 'HOTEL', 'RESTAURANT', 'BAR', 'MIXED_HOSPITALITY'];
const FACILITY_STATUSES = ['ACTIVE', 'INACTIVE', 'UNDER_MAINTENANCE', 'CLOSED'];

interface Company { id: string; name: string; }
interface Division { id: string; name: string; }

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function HospitalityFacilitiesPage() {
  const { user } = useAuth();
  void user;
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ facilityCode: '', facilityName: '', facilityType: 'HOTEL', location: '', status: 'ACTIVE', divisionId: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j =>
      setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (!companyId) { setDivisions([]); return; }
    fetch(`/api/backend/divisions?companyId=${companyId}&limit=100`).then(r => r.json()).then(j =>
      setDivisions(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/hospitality-facilities?companyId=${companyId}&limit=100`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      const list = Array.isArray(json.data?.data) ? json.data.data : [];
      setRows(list); setTotal(json.data?.total ?? list.length);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm({ facilityCode: '', facilityName: '', facilityType: 'HOTEL', location: '', status: 'ACTIVE', divisionId: '', notes: '' }); setShowModal(true); };
  const openEdit = (row: any) => {
    setEditing(row);
    setForm({ facilityCode: row.facilityCode ?? '', facilityName: row.facilityName ?? '', facilityType: row.facilityType ?? 'HOTEL', location: row.location ?? '', status: row.status ?? 'ACTIVE', divisionId: row.divisionId ?? '', notes: row.notes ?? '' });
    setShowModal(true);
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      const body = { ...form, companyId };
      const url = editing ? `/api/backend/hospitality-facilities/${editing.id}` : '/api/backend/hospitality-facilities';
      const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  };

  const doDelete = async () => {
    if (!deleteId) return;
    await fetch(`/api/backend/hospitality-facilities/${deleteId}`, { method: 'DELETE' });
    setDeleteId(null); load();
  };

  const sf = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <PageHeader title="Hospitality Facilities" subtitle="Hotels, restaurants and hospitality venues" />
        <div className="flex items-center gap-3">
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
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Type</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Location</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No facilities found.</td></tr>
                ) : rows.map(row => (
                  <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-mono font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.facilityCode}</td>
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.facilityName}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.facilityType?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.location ?? '—'}</td>
                    <td className={tdCls}><StatusBadge status={row.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-1">
                        <Btn size="sm" variant="secondary" onClick={() => openEdit(row)}>Edit</Btn>
                        <Btn size="sm" variant="danger" onClick={() => setDeleteId(row.id)}>Delete</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Facility' : 'New Facility'} size="lg"
        footer={<><Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn><Btn variant="primary" loading={saving} onClick={save}>{editing ? 'Update' : 'Create'}</Btn></>}
      >
        <div className="grid grid-cols-2 gap-4">
          <FormInput label="Facility Code *" value={form.facilityCode} onChange={sf('facilityCode')} placeholder="e.g. FAC-001" />
          <FormInput label="Facility Name *" value={form.facilityName} onChange={sf('facilityName')} placeholder="e.g. Grand Hotel" />
          <FormSelect label="Type *" value={form.facilityType} onChange={sf('facilityType')}>
            {FACILITY_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </FormSelect>
          <FormSelect label="Status" value={form.status} onChange={sf('status')}>
            {FACILITY_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </FormSelect>
          <div className="col-span-2"><FormInput label="Location" value={form.location} onChange={sf('location')} placeholder="e.g. Dar es Salaam, Tanzania" /></div>
          {divisions.length > 0 && (
            <div className="col-span-2">
              <FormSelect label="Division" value={form.divisionId} onChange={sf('divisionId')}>
                <option value="">— None —</option>
                {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </FormSelect>
            </div>
          )}
          <div className="col-span-2"><FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={2} /></div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Facility?" message="This action cannot be undone." variant="danger" onConfirm={doDelete} />
    </div>
  );
}
