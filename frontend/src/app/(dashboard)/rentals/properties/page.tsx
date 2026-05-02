'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

const PROPERTY_TYPES = ['COMMERCIAL_BUILDING','SHOP_BLOCK','RESIDENTIAL_HOUSE','APARTMENT','MIXED_USE','LAND','OTHER'];
const OWNERSHIP_TYPES = ['OWNED','LEASED','MANAGED','RENTED','OTHER'];
const PROPERTY_STATUSES = ['ACTIVE','INACTIVE','UNDER_MAINTENANCE','FULLY_OCCUPIED','VACANT','CLOSED'];

interface Company { id: string; name: string; code: string; }
interface Division { id: string; name: string; }
interface Property {
  id: string; propertyCode: string; propertyName: string; propertyType: string;
  location: string; ownershipType: string; status: string; divisionId?: string;
  notes?: string; _count?: { rentalUnits: number };
}

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

const initForm = { propertyCode: '', propertyName: '', propertyType: 'COMMERCIAL_BUILDING', location: '', ownershipType: 'OWNED', status: 'ACTIVE', divisionId: '', notes: '' };

export default function RentalPropertiesPage() {
  const { user } = useAuth();
  void user;
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [rows, setRows] = useState<Property[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Property | null>(null);
  const [form, setForm] = useState<Record<string, string>>(initForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Property | null>(null);
  const [modalCompanyId, setModalCompanyId] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j =>
      setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (!modalCompanyId) { setDivisions([]); return; }
    fetch(`/api/backend/divisions?companyId=${modalCompanyId}&limit=100`).then(r => r.json()).then(j => {
      const divs = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
      setDivisions(divs);
    });
  }, [modalCompanyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/rental-properties?companyId=${companyId}&page=1&limit=100`);
      if (!res.ok) throw new Error('Failed to load');
      const j = await res.json();
      const list = j.data?.data ?? j.data ?? [];
      setRows(Array.isArray(list) ? list : []);
      setTotal(j.data?.total ?? list.length);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null);
    setModalCompanyId(companyId);
    setForm({ ...initForm });
    setShowModal(true);
  }
  function openEdit(row: Property) {
    setEditing(row);
    setModalCompanyId(companyId);
    setForm({
      propertyCode: row.propertyCode, propertyName: row.propertyName,
      propertyType: row.propertyType, location: row.location,
      ownershipType: row.ownershipType, status: row.status,
      divisionId: row.divisionId ?? '', notes: row.notes ?? '',
    });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.propertyCode.trim()) { setError('Property code is required'); return; }
    if (!form.propertyName.trim()) { setError('Property name is required'); return; }
    if (!form.location.trim()) { setError('Location is required'); return; }
    setSaving(true); setError('');
    try {
      const body = { ...form, companyId: modalCompanyId, divisionId: form.divisionId || undefined, notes: form.notes || undefined };
      const url = editing ? `/api/backend/rental-properties/${editing.id}` : '/api/backend/rental-properties';
      const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await fetch(`/api/backend/rental-properties/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null); load();
  }

  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Rental Properties" subtitle="Property registry for rentals" />
        <div className="flex items-center gap-3">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {companyId && <Btn variant="primary" onClick={openNew}>+ New Property</Btn>}
        </div>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load properties.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{total} {total === 1 ? 'property' : 'properties'}</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Code</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Name</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Type</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Ownership</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Location</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Units</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No properties found.</td></tr>
                ) : rows.map(row => (
                  <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.propertyCode}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.propertyName}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.propertyType?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.ownershipType ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.location}</td>
                    <td className={tdCls}><StatusBadge status={row.status} /></td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row._count?.rentalUnits ?? '—'}</td>
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

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Property' : 'New Rental Property'}
        size="lg"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" loading={saving} onClick={handleSave}>{editing ? 'Save Changes' : 'Create Property'}</Btn>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <FormSelect label="Company *" value={modalCompanyId} onChange={e => setModalCompanyId(e.target.value)}>
            <option value="">Select…</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FormSelect>
          <FormSelect label="Division" value={form.divisionId} onChange={sf('divisionId')}>
            <option value="">None</option>
            {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </FormSelect>
          <FormInput label="Property Code *" value={form.propertyCode} onChange={sf('propertyCode')} placeholder="e.g. PROP-001" />
          <FormInput label="Property Name *" value={form.propertyName} onChange={sf('propertyName')} placeholder="e.g. Main Street Plaza" />
          <div className="col-span-2">
            <FormInput label="Location *" value={form.location} onChange={sf('location')} placeholder="e.g. Dar es Salaam, Kariakoo" />
          </div>
          <FormSelect label="Property Type *" value={form.propertyType} onChange={sf('propertyType')}>
            {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </FormSelect>
          <FormSelect label="Ownership Type *" value={form.ownershipType} onChange={sf('ownershipType')}>
            {OWNERSHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </FormSelect>
          <div className="col-span-2">
            <FormSelect label="Status" value={form.status} onChange={sf('status')}>
              {PROPERTY_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </FormSelect>
          </div>
          <div className="col-span-2">
            <FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={3} placeholder="Optional notes…" />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Property"
        message={`Delete "${deleteTarget?.propertyName}"? This cannot be undone.`}
        variant="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
