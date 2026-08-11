'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string }
interface Authority { id: string; name: string }
interface TaxRegistration {
  id: string;
  registrationCode: string;
  companyId: string;
  company?: { name: string };
  authorityId: string;
  authority?: { name: string };
  registrationType: string;
  registrationNumber: string;
  registeredName: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  status: string;
  notes?: string | null;
  createdAt: string;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

const TYPES = ['VAT', 'INCOME_TAX', 'PAYE', 'WITHHOLDING_TAX', 'CUSTOMS', 'EXCISE', 'OTHER'];
const STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'CANCELLED'];

const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' };

interface RegForm {
  registrationCode: string; companyId: string; authorityId: string;
  registrationType: string; registrationNumber: string; registeredName: string;
  effectiveFrom: string; effectiveTo: string; status: string; notes: string;
}
const BLANK: RegForm = { registrationCode: '', companyId: '', authorityId: '', registrationType: 'VAT', registrationNumber: '', registeredName: '', effectiveFrom: '', effectiveTo: '', status: 'ACTIVE', notes: '' };

function RegModal({ mode, initial, companies, authorities, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: TaxRegistration; companies: Company[]; authorities: Authority[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<RegForm>(() => initial ? {
    registrationCode: initial.registrationCode, companyId: initial.companyId,
    authorityId: initial.authorityId, registrationType: initial.registrationType,
    registrationNumber: initial.registrationNumber, registeredName: initial.registeredName,
    effectiveFrom: initial.effectiveFrom?.split('T')[0] ?? '',
    effectiveTo: initial.effectiveTo?.split('T')[0] ?? '',
    status: initial.status, notes: initial.notes ?? '',
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof RegForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.registrationCode.trim() || !form.companyId || !form.registrationNumber.trim() || !form.registeredName.trim()) {
      setError('Code, company, number, registered name required'); return;
    }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        registrationCode: form.registrationCode, registrationType: form.registrationType,
        companyId: form.companyId, registrationNumber: form.registrationNumber, registeredName: form.registeredName, status: form.status,
        authorityId: form.authorityId || undefined,
        effectiveFrom: form.effectiveFrom || undefined,
        effectiveTo: form.effectiveTo || undefined,
        notes: form.notes || undefined,
      };
      const res = await fetch(mode === 'create' ? '/api/backend/tax/registrations' : `/api/backend/tax/registrations/${initial!.id}`,
        { method: mode === 'create' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Tax Registration' : 'Edit Tax Registration'} size="xl"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Code" required value={form.registrationCode} onChange={(e) => set('registrationCode', e.target.value)} />
        <FormSelect label="Type" value={form.registrationType} onChange={(e) => set('registrationType', e.target.value)}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </FormSelect>
        <FormSelect label="Company" required value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="Select…">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormSelect label="Authority" value={form.authorityId} onChange={(e) => set('authorityId', e.target.value)} placeholder="—">
          {authorities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </FormSelect>
        <FormInput label="Registration Number" required value={form.registrationNumber} onChange={(e) => set('registrationNumber', e.target.value)} />
        <FormInput label="Registered Name" required value={form.registeredName} onChange={(e) => set('registeredName', e.target.value)} />
        <FormInput label="Effective From" type="date" value={form.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} />
        <FormInput label="Effective To" type="date" value={form.effectiveTo} onChange={(e) => set('effectiveTo', e.target.value)} />
        <FormSelect label="Status" value={form.status} onChange={(e) => set('status', e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </FormSelect>
        <div className="col-span-2"><FormTextarea label="Notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function TaxRegistrationsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('tax_registrations.manage');
  const canView = hasPermission('tax_registrations.view') || canManage;

  const [items, setItems] = useState<TaxRegistration[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [authorities, setAuthorities] = useState<Authority[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [registrationType, setRegistrationType] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TaxRegistration | null>(null);
  const [deleting, setDeleting] = useState<TaxRegistration | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json()).then((j) => setCompanies(j.data?.data ?? j.data ?? []));
    fetch('/api/backend/tax/authorities?limit=100').then((r) => r.json()).then((j) => setAuthorities(j.data?.data ?? j.data ?? []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (companyId) params.set('companyId', companyId);
    if (registrationType) params.set('registrationType', registrationType);
    if (status) params.set('status', status);
    const j = await fetch(`/api/backend/tax/registrations?${params}`).then((r) => r.json()).catch(() => ({}));
    const p: Paginated<TaxRegistration> = j.data ?? {};
    setItems(p.data ?? []); setTotal(p.total ?? 0); setTotalPages(p.totalPages ?? 1);
    setLoading(false);
  }, [page, companyId, registrationType, status]);

  useEffect(() => { load(); }, [load]);
  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };
  const onSaved = () => { setCreating(false); setEditing(null); load(); };
  const doDelete = async () => {
    if (!deleting) return;
    await fetch(`/api/backend/tax/registrations/${deleting.id}`, { method: 'DELETE' });
    setDeleting(null); load();
  };

  const activeCount = items.filter((r) => r.status === 'ACTIVE').length;

  if (!canView) return <div className="p-6"><PageHeader title="Tax Registrations" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Tax Registrations" subtitle="TIN, VRN, PAYE and other registrations per company" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Total" value={total} />
        <StatCard label="Active (page)" value={activeCount} />
        <StatCard label="On this page" value={items.length} />
      </div>

      <PageToolbar
        filters={
          <>
            <select value={companyId} onChange={(e) => reset(setCompanyId)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={registrationType} onChange={(e) => reset(setRegistrationType)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Types</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New Registration</Btn> : null}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : items.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No registrations</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Authority</th>
                  <th className="px-4 py-3">Reg No</th>
                  <th className="px-4 py-3">Registered Name</th>
                  <th className="px-4 py-3">Effective</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                    <td className="px-4 py-3 font-mono text-xs">{r.registrationCode}</td>
                    <td className="px-4 py-3 text-xs">{r.registrationType}</td>
                    <td className="px-4 py-3 text-xs">{r.company?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs">{r.authority?.name ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{r.registrationNumber}</td>
                    <td className="px-4 py-3">{r.registeredName}</td>
                    <td className="px-4 py-3 text-xs">{r.effectiveFrom?.split('T')[0]}{r.effectiveTo ? ` → ${r.effectiveTo.split('T')[0]}` : ''}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    {canManage && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Btn variant="ghost" size="xs" onClick={() => setEditing(r)}>Edit</Btn>
                        <Btn variant="ghost" size="xs" onClick={() => setDeleting(r)}>Delete</Btn>
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

      {creating && <RegModal mode="create" companies={companies} authorities={authorities} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <RegModal mode="edit" initial={editing} companies={companies} authorities={authorities} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title="Delete Registration" size="md"
          footer={<><Btn variant="secondary" onClick={() => setDeleting(null)}>Cancel</Btn><Btn variant="danger" onClick={doDelete}>Delete</Btn></>}>
          <p className="text-sm">Delete registration <strong>{deleting.registrationCode}</strong>?</p>
        </Modal>
      )}
    </div>
  );
}
