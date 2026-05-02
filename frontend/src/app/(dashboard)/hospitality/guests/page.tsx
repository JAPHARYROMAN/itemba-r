'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner, PageToolbar } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

const GUEST_STATUSES = ['ACTIVE', 'BLOCKED', 'INACTIVE'];
const ID_TYPES = ['PASSPORT', 'NATIONAL_ID', 'DRIVING_LICENSE', 'VOTER_ID', 'OTHER'];

interface Company { id: string; name: string; }

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function GuestsPage() {
  const { user } = useAuth();
  void user;
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ guestCode: '', fullName: '', status: 'ACTIVE', phone: '', email: '', nationality: '', identificationType: '', identificationNumber: '', address: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j =>
      setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ companyId, limit: '100' });
      if (search) qs.set('search', search);
      const res = await fetch(`/api/backend/guests?${qs}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      const list = Array.isArray(json.data?.data) ? json.data.data : [];
      setRows(list); setTotal(json.data?.total ?? list.length);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId, search]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm({ guestCode: '', fullName: '', status: 'ACTIVE', phone: '', email: '', nationality: '', identificationType: '', identificationNumber: '', address: '', notes: '' }); setShowModal(true); };
  const openEdit = (row: any) => {
    setEditing(row);
    setForm({ guestCode: row.guestCode ?? '', fullName: row.fullName ?? '', status: row.status ?? 'ACTIVE', phone: row.phone ?? '', email: row.email ?? '', nationality: row.nationality ?? '', identificationType: row.identificationType ?? '', identificationNumber: row.identificationNumber ?? '', address: row.address ?? '', notes: row.notes ?? '' });
    setShowModal(true);
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      const body: any = { ...form, companyId };
      if (!body.identificationType) delete body.identificationType;
      const url = editing ? `/api/backend/guests/${editing.id}` : '/api/backend/guests';
      const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  };

  const doDelete = async () => {
    if (!deleteId) return;
    await fetch(`/api/backend/guests/${deleteId}`, { method: 'DELETE' });
    setDeleteId(null); load();
  };

  const sf = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Guests" subtitle="Guest profiles and identification records" />
      <PageToolbar
        search={companyId ? search : undefined}
        onSearch={companyId ? setSearch : undefined}
        searchPlaceholder="Search guests…"
        filters={
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        }
        actions={companyId ? <Btn variant="primary" onClick={openCreate}>+ New Guest</Btn> : undefined}
      />

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}

      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{total} guests</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Guest Code</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Full Name</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Phone</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Email</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Nationality</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>ID Type</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>ID Number</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No guests found.</td></tr>
                ) : rows.map(row => (
                  <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-mono font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.guestCode}</td>
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.fullName}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.phone ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.email ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.nationality ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.identificationType ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.identificationNumber ?? '—'}</td>
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

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Guest' : 'New Guest'} size="xl"
        footer={<><Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn><Btn variant="primary" loading={saving} onClick={save}>{editing ? 'Update' : 'Create'}</Btn></>}
      >
        <div className="grid grid-cols-2 gap-4">
          <FormInput label="Guest Code *" value={form.guestCode} onChange={sf('guestCode')} placeholder="e.g. GST-001" />
          <FormInput label="Full Name *" value={form.fullName} onChange={sf('fullName')} placeholder="e.g. John Doe" />
          <FormInput label="Phone" value={form.phone} onChange={sf('phone')} placeholder="+255 xxx xxx xxx" />
          <FormInput label="Email" type="email" value={form.email} onChange={sf('email')} />
          <FormInput label="Nationality" value={form.nationality} onChange={sf('nationality')} placeholder="e.g. Tanzanian" />
          <FormSelect label="Status" value={form.status} onChange={sf('status')}>
            {GUEST_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </FormSelect>
          <FormSelect label="ID Type" value={form.identificationType} onChange={sf('identificationType')}>
            <option value="">— None —</option>
            {ID_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </FormSelect>
          <FormInput label="ID Number" value={form.identificationNumber} onChange={sf('identificationNumber')} />
          <div className="col-span-2"><FormInput label="Address" value={form.address} onChange={sf('address')} /></div>
          <div className="col-span-2"><FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={2} /></div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Guest?" message="This action cannot be undone." variant="danger" onConfirm={doDelete} />
    </div>
  );
}
