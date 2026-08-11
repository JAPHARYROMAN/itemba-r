'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface TaxAuthority {
  id: string;
  authorityCode: string;
  name: string;
  country: string;
  region?: string | null;
  authorityType: string;
  website?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: string | null;
  status: string;
  createdAt: string;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

interface AuthorityForm {
  authorityCode: string;
  name: string;
  country: string;
  region: string;
  authorityType: string;
  website: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  status: string;
}

const BLANK: AuthorityForm = { authorityCode: '', name: '', country: '', region: '', authorityType: 'NATIONAL', website: '', contactEmail: '', contactPhone: '', address: '', status: 'ACTIVE' };
const TYPES = ['NATIONAL', 'PROVINCIAL', 'MUNICIPAL', 'INTERNATIONAL'];
const STATUSES = ['ACTIVE', 'INACTIVE'];

const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' };

function AuthorityModal({ mode, initial, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: TaxAuthority; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<AuthorityForm>(() => initial ? {
    authorityCode: initial.authorityCode, name: initial.name, country: initial.country,
    region: initial.region ?? '', authorityType: initial.authorityType,
    website: initial.website ?? '', contactEmail: initial.contactEmail ?? '',
    contactPhone: initial.contactPhone ?? '', address: initial.address ?? '', status: initial.status,
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof AuthorityForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.authorityCode.trim() || !form.name.trim() || !form.country.trim()) { setError('Code, name, country required'); return; }
    setSaving(true); setError('');
    try {
      const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v || undefined]));
      body.authorityCode = form.authorityCode; body.name = form.name; body.country = form.country;
      body.authorityType = form.authorityType; body.status = form.status;
      const res = await fetch(mode === 'create' ? '/api/backend/tax/authorities' : `/api/backend/tax/authorities/${initial!.id}`,
        { method: mode === 'create' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Tax Authority' : 'Edit Tax Authority'} size="xl"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Code" required value={form.authorityCode} onChange={(e) => set('authorityCode', e.target.value)} />
        <FormInput label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} />
        <FormInput label="Country" required value={form.country} onChange={(e) => set('country', e.target.value)} />
        <FormInput label="Region" value={form.region} onChange={(e) => set('region', e.target.value)} />
        <FormSelect label="Type" value={form.authorityType} onChange={(e) => set('authorityType', e.target.value)}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </FormSelect>
        <FormSelect label="Status" value={form.status} onChange={(e) => set('status', e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </FormSelect>
        <FormInput label="Website" value={form.website} onChange={(e) => set('website', e.target.value)} />
        <FormInput label="Email" type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />
        <FormInput label="Phone" value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} />
        <div className="col-span-2"><FormTextarea label="Address" rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function TaxAuthoritiesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('tax_authorities.manage');
  const canView = hasPermission('tax_authorities.view') || canManage;

  const [items, setItems] = useState<TaxAuthority[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [authorityType, setAuthorityType] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TaxAuthority | null>(null);
  const [deleting, setDeleting] = useState<TaxAuthority | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (search) params.set('search', search);
    if (authorityType) params.set('authorityType', authorityType);
    if (status) params.set('status', status);
    const j = await fetch(`/api/backend/tax/authorities?${params}`).then((r) => r.json()).catch(() => ({}));
    const p: Paginated<TaxAuthority> = j.data ?? {};
    setItems(p.data ?? []); setTotal(p.total ?? 0); setTotalPages(p.totalPages ?? 1);
    setLoading(false);
  }, [page, search, authorityType, status]);

  useEffect(() => { load(); }, [load]);

  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };
  const onSaved = () => { setCreating(false); setEditing(null); load(); };
  const doDelete = async () => {
    if (!deleting) return;
    await fetch(`/api/backend/tax/authorities/${deleting.id}`, { method: 'DELETE' });
    setDeleting(null); load();
  };

  const activeCount = items.filter((a) => a.status === 'ACTIVE').length;
  const nationalCount = items.filter((a) => a.authorityType === 'NATIONAL').length;

  if (!canView) return <div className="p-6"><PageHeader title="Tax Authorities" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Tax Authorities" subtitle="Tax agencies and regulatory bodies" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Total" value={total} />
        <StatCard label="Active (page)" value={activeCount} />
        <StatCard label="National (page)" value={nationalCount} />
      </div>

      <PageToolbar
        search={search}
        onSearch={reset(setSearch)}
        searchPlaceholder="Search by name or code…"
        filters={
          <>
            <select value={authorityType} onChange={(e) => reset(setAuthorityType)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Types</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New Authority</Btn> : null}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : items.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No authorities</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Country</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                    <td className="px-4 py-3 font-mono text-xs">{a.authorityCode}</td>
                    <td className="px-4 py-3">{a.name}</td>
                    <td className="px-4 py-3">{a.country}{a.region ? ` / ${a.region}` : ''}</td>
                    <td className="px-4 py-3 text-xs">{a.authorityType}</td>
                    <td className="px-4 py-3 text-xs">{a.contactEmail ?? a.contactPhone ?? '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                    {canManage && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Btn variant="ghost" size="xs" onClick={() => setEditing(a)}>Edit</Btn>
                        <Btn variant="ghost" size="xs" onClick={() => setDeleting(a)}>Delete</Btn>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between p-3 border-t" style={{ borderColor: 'var(--aurora-border)' }}>
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>Page {page} of {totalPages} ({total} total)</span>
            <div className="flex gap-2">
              <Btn variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Btn>
              <Btn variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Btn>
            </div>
          </div>
        )}
      </Card>

      {creating && <AuthorityModal mode="create" onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <AuthorityModal mode="edit" initial={editing} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title="Delete Tax Authority" size="md"
          footer={<><Btn variant="secondary" onClick={() => setDeleting(null)}>Cancel</Btn><Btn variant="danger" onClick={doDelete}>Delete</Btn></>}>
          <p className="text-sm">Delete authority <strong>{deleting.name}</strong>?</p>
        </Modal>
      )}
    </div>
  );
}
