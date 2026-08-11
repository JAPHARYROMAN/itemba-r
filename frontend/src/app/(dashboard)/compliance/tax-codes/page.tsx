'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string }
interface TaxType { id: string; name: string }
interface TaxCode {
  id: string;
  taxCode: string;
  name: string;
  companyId: string;
  company?: { name: string };
  taxTypeId: string;
  taxType?: { name: string };
  appliesTo: string;
  isDefault: boolean;
  status: string;
  createdAt: string;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

const APPLIES = ['SALES', 'PURCHASES', 'PAYROLL', 'EXPENSES', 'ALL'];
const STATUSES = ['ACTIVE', 'INACTIVE'];

const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' };

interface TaxCodeForm {
  taxCode: string; name: string; companyId: string; taxTypeId: string;
  appliesTo: string; isDefault: boolean; status: string;
}
const BLANK: TaxCodeForm = { taxCode: '', name: '', companyId: '', taxTypeId: '', appliesTo: 'ALL', isDefault: false, status: 'ACTIVE' };

function TaxCodeModal({ mode, initial, companies, taxTypes, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: TaxCode; companies: Company[]; taxTypes: TaxType[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<TaxCodeForm>(() => initial ? {
    taxCode: initial.taxCode, name: initial.name, companyId: initial.companyId,
    taxTypeId: initial.taxTypeId, appliesTo: initial.appliesTo, isDefault: initial.isDefault, status: initial.status,
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof TaxCodeForm>(k: K, v: TaxCodeForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.taxCode.trim() || !form.name.trim()) { setError('Code and name required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = { ...form };
      if (!body.companyId) delete body.companyId;
      if (!body.taxTypeId) delete body.taxTypeId;
      const res = await fetch(mode === 'create' ? '/api/backend/tax/codes' : `/api/backend/tax/codes/${initial!.id}`,
        { method: mode === 'create' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Tax Code' : 'Edit Tax Code'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Code" required value={form.taxCode} onChange={(e) => set('taxCode', e.target.value)} />
        <FormInput label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} />
        <FormSelect label="Company" value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="—">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormSelect label="Tax Type" value={form.taxTypeId} onChange={(e) => set('taxTypeId', e.target.value)} placeholder="—">
          {taxTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </FormSelect>
        <FormSelect label="Applies To" value={form.appliesTo} onChange={(e) => set('appliesTo', e.target.value)}>
          {APPLIES.map((a) => <option key={a} value={a}>{a}</option>)}
        </FormSelect>
        <FormSelect label="Status" value={form.status} onChange={(e) => set('status', e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </FormSelect>
        <label className="flex items-center gap-2 text-sm col-span-2" style={{ color: 'var(--aurora-text)' }}>
          <input type="checkbox" checked={form.isDefault} onChange={(e) => set('isDefault', e.target.checked)} />
          Default code
        </label>
      </div>
    </Modal>
  );
}

export default function TaxCodesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('tax_codes.manage');
  const canView = hasPermission('tax_codes.view') || canManage;

  const [items, setItems] = useState<TaxCode[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [taxTypes, setTaxTypes] = useState<TaxType[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [taxTypeId, setTaxTypeId] = useState('');
  const [appliesTo, setAppliesTo] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TaxCode | null>(null);
  const [deleting, setDeleting] = useState<TaxCode | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json()).then((j) => setCompanies(j.data?.data ?? j.data ?? []));
    fetch('/api/backend/tax/types?limit=100').then((r) => r.json()).then((j) => setTaxTypes(j.data?.data ?? j.data ?? []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (companyId) params.set('companyId', companyId);
    if (taxTypeId) params.set('taxTypeId', taxTypeId);
    if (appliesTo) params.set('appliesTo', appliesTo);
    if (status) params.set('status', status);
    const j = await fetch(`/api/backend/tax/codes?${params}`).then((r) => r.json()).catch(() => ({}));
    const p: Paginated<TaxCode> = j.data ?? {};
    setItems(p.data ?? []); setTotal(p.total ?? 0); setTotalPages(p.totalPages ?? 1);
    setLoading(false);
  }, [page, companyId, taxTypeId, appliesTo, status]);

  useEffect(() => { load(); }, [load]);
  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };
  const onSaved = () => { setCreating(false); setEditing(null); load(); };
  const doDelete = async () => {
    if (!deleting) return;
    await fetch(`/api/backend/tax/codes/${deleting.id}`, { method: 'DELETE' });
    setDeleting(null); load();
  };

  const activeCount = items.filter((c) => c.status === 'ACTIVE').length;
  const defaultCount = items.filter((c) => c.isDefault).length;

  if (!canView) return <div className="p-6"><PageHeader title="Tax Codes" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Tax Codes" subtitle="Company-specific tax codes mapped to tax types" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Total" value={total} />
        <StatCard label="Active (page)" value={activeCount} />
        <StatCard label="Default (page)" value={defaultCount} />
      </div>

      <PageToolbar
        filters={
          <>
            <select value={companyId} onChange={(e) => reset(setCompanyId)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={taxTypeId} onChange={(e) => reset(setTaxTypeId)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Tax Types</option>
              {taxTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={appliesTo} onChange={(e) => reset(setAppliesTo)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Applies</option>
              {APPLIES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New Tax Code</Btn> : null}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : items.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No tax codes</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Tax Type</th>
                  <th className="px-4 py-3">Applies</th>
                  <th className="px-4 py-3">Default</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                    <td className="px-4 py-3 font-mono text-xs">{c.taxCode}</td>
                    <td className="px-4 py-3">{c.name}</td>
                    <td className="px-4 py-3 text-xs">{c.company?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs">{c.taxType?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs">{c.appliesTo}</td>
                    <td className="px-4 py-3 text-xs">{c.isDefault ? 'Yes' : 'No'}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                    {canManage && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Btn variant="ghost" size="xs" onClick={() => setEditing(c)}>Edit</Btn>
                        <Btn variant="ghost" size="xs" onClick={() => setDeleting(c)}>Delete</Btn>
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

      {creating && <TaxCodeModal mode="create" companies={companies} taxTypes={taxTypes} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <TaxCodeModal mode="edit" initial={editing} companies={companies} taxTypes={taxTypes} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title="Delete Tax Code" size="md"
          footer={<><Btn variant="secondary" onClick={() => setDeleting(null)}>Cancel</Btn><Btn variant="danger" onClick={doDelete}>Delete</Btn></>}>
          <p className="text-sm">Delete tax code <strong>{deleting.name}</strong>?</p>
        </Modal>
      )}
    </div>
  );
}
