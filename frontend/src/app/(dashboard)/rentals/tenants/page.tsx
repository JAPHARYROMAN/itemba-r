'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

const TENANT_TYPES = ['INDIVIDUAL','COMPANY','ORGANIZATION','OTHER'];
const TENANT_STATUSES = ['ACTIVE','INACTIVE','BLOCKED'];
const ID_TYPES = ['NATIONAL_ID','PASSPORT','DRIVING_LICENSE','VOTER_ID','OTHER'];

interface Company { id: string; name: string; code: string; }
interface Tenant {
  id: string; tenantCode: string; name: string; tenantType: string; status: string;
  legalName?: string; tin?: string; phone?: string; email?: string; address?: string;
  contactPerson?: string; identificationType?: string; identificationNumber?: string;
  notes?: string; companyId: string;
}

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function TenantsPage() {
  const { user } = useAuth();
  void user;
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [rows, setRows] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ tenantCode: '', name: '', tenantType: 'INDIVIDUAL', status: 'ACTIVE', legalName: '', tin: '', phone: '', email: '', address: '', contactPerson: '', identificationType: '', identificationNumber: '', notes: '' });
  const [modalCompanyId, setModalCompanyId] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Tenant | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j =>
      setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/tenants?companyId=${companyId}&page=1&limit=100`);
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
    setEditing(null); setModalCompanyId(companyId);
    setForm({ tenantCode: '', name: '', tenantType: 'INDIVIDUAL', status: 'ACTIVE', legalName: '', tin: '', phone: '', email: '', address: '', contactPerson: '', identificationType: '', identificationNumber: '', notes: '' });
    setShowModal(true);
  }
  function openEdit(row: Tenant) {
    setEditing(row); setModalCompanyId(companyId);
    setForm({ tenantCode: row.tenantCode, name: row.name, tenantType: row.tenantType, status: row.status, legalName: row.legalName ?? '', tin: row.tin ?? '', phone: row.phone ?? '', email: row.email ?? '', address: row.address ?? '', contactPerson: row.contactPerson ?? '', identificationType: row.identificationType ?? '', identificationNumber: row.identificationNumber ?? '', notes: row.notes ?? '' });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.tenantCode.trim()) { setError('Tenant code required'); return; }
    if (!form.name.trim()) { setError('Name required'); return; }
    setSaving(true); setError('');
    try {
      const body = { ...form, companyId: modalCompanyId, legalName: form.legalName || undefined, tin: form.tin || undefined, phone: form.phone || undefined, email: form.email || undefined, address: form.address || undefined, contactPerson: form.contactPerson || undefined, identificationType: form.identificationType || undefined, identificationNumber: form.identificationNumber || undefined, notes: form.notes || undefined };
      const url = editing ? `/api/backend/tenants/${editing.id}` : '/api/backend/tenants';
      const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await fetch(`/api/backend/tenants/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null); load();
  }

  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Tenants" subtitle="Tenant profiles and contact information" />
        <div className="flex items-center gap-3">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {companyId && <Btn variant="primary" onClick={openNew}>+ New Tenant</Btn>}
        </div>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load tenants.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{total} {total === 1 ? 'tenant' : 'tenants'}</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Code</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Name</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Type</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Contact Person</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Phone</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Email</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No tenants found.</td></tr>
                ) : rows.map(row => (
                  <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.tenantCode}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.name}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.tenantType}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.contactPerson ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.phone ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.email ?? '—'}</td>
                    <td className={tdCls}><StatusBadge status={row.status} /></td>
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
        title={editing ? 'Edit Tenant' : 'New Tenant'}
        size="lg"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" loading={saving} onClick={handleSave}>{editing ? 'Save Changes' : 'Create Tenant'}</Btn>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <FormSelect label="Company *" value={modalCompanyId} onChange={e => setModalCompanyId(e.target.value)}>
            <option value="">Select…</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FormSelect>
          <FormInput label="Tenant Code *" value={form.tenantCode} onChange={sf('tenantCode')} placeholder="e.g. TEN-001" />
          <FormInput label="Name *" value={form.name} onChange={sf('name')} placeholder="Full name" />
          <FormInput label="Legal Name" value={form.legalName} onChange={sf('legalName')} placeholder="Registered legal name" />
          <FormSelect label="Tenant Type *" value={form.tenantType} onChange={sf('tenantType')}>
            {TENANT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </FormSelect>
          <FormSelect label="Status" value={form.status} onChange={sf('status')}>
            {TENANT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </FormSelect>
          <FormInput label="Phone" type="tel" value={form.phone} onChange={sf('phone')} placeholder="+255 7xx xxx xxx" />
          <FormInput label="Email" type="email" value={form.email} onChange={sf('email')} placeholder="tenant@email.com" />
          <FormInput label="TIN" value={form.tin} onChange={sf('tin')} placeholder="Tax ID Number" />
          <FormInput label="Contact Person" value={form.contactPerson} onChange={sf('contactPerson')} />
          <FormSelect label="ID Type" value={form.identificationType} onChange={sf('identificationType')}>
            <option value="">None</option>
            {ID_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </FormSelect>
          <FormInput label="ID Number" value={form.identificationNumber} onChange={sf('identificationNumber')} />
          <div className="col-span-2">
            <FormInput label="Address" value={form.address} onChange={sf('address')} placeholder="Physical address" />
          </div>
          <div className="col-span-2">
            <FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={2} />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Tenant"
        message={`Delete tenant "${deleteTarget?.name}"? This cannot be undone.`}
        variant="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
