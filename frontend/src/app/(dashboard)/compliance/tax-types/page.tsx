'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface TaxType {
  id: string;
  taxTypeCode: string;
  name: string;
  taxCategory: string;
  description?: string | null;
  isRecoverable: boolean;
  isWithholding: boolean;
  appliesToSales: boolean;
  appliesToPurchases: boolean;
  appliesToPayroll: boolean;
  appliesToExpenses: boolean;
  status: string;
  createdAt: string;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

interface TaxTypeForm {
  taxTypeCode: string;
  name: string;
  taxCategory: string;
  description: string;
  status: string;
  isRecoverable: boolean;
  isWithholding: boolean;
  appliesToSales: boolean;
  appliesToPurchases: boolean;
  appliesToPayroll: boolean;
  appliesToExpenses: boolean;
}

const BLANK_FORM: TaxTypeForm = {
  taxTypeCode: '', name: '', taxCategory: 'INDIRECT', description: '', status: 'ACTIVE',
  isRecoverable: false, isWithholding: false, appliesToSales: false, appliesToPurchases: false, appliesToPayroll: false, appliesToExpenses: false,
};

const CATEGORIES = ['DIRECT', 'INDIRECT', 'WITHHOLDING', 'STATUTORY'];
const STATUSES = ['ACTIVE', 'INACTIVE'];

const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' };

function TaxTypeModal({ mode, initial, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: TaxType; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<TaxTypeForm>(() => initial ? {
    taxTypeCode: initial.taxTypeCode, name: initial.name, taxCategory: initial.taxCategory,
    description: initial.description ?? '', status: initial.status,
    isRecoverable: initial.isRecoverable, isWithholding: initial.isWithholding,
    appliesToSales: initial.appliesToSales, appliesToPurchases: initial.appliesToPurchases,
    appliesToPayroll: initial.appliesToPayroll, appliesToExpenses: initial.appliesToExpenses,
  } : { ...BLANK_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof TaxTypeForm>(k: K, v: TaxTypeForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.taxTypeCode.trim()) { setError('Code is required'); return; }
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      const body = { ...form, description: form.description || undefined };
      const res = await fetch(mode === 'create' ? '/api/backend/tax/types' : `/api/backend/tax/types/${initial!.id}`,
        { method: mode === 'create' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Tax Type' : 'Edit Tax Type'} size="xl"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Code" required value={form.taxTypeCode} onChange={(e) => set('taxTypeCode', e.target.value)} />
        <FormInput label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} />
        <FormSelect label="Category" value={form.taxCategory} onChange={(e) => set('taxCategory', e.target.value)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </FormSelect>
        <FormSelect label="Status" value={form.status} onChange={(e) => set('status', e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </FormSelect>
        <div className="col-span-2">
          <FormTextarea label="Description" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="col-span-2 grid grid-cols-2 gap-2 pt-2 border-t" style={{ borderColor: 'var(--aurora-border)' }}>
          {[
            ['isRecoverable', 'Recoverable'], ['isWithholding', 'Withholding'],
            ['appliesToSales', 'Applies to Sales'], ['appliesToPurchases', 'Applies to Purchases'],
            ['appliesToPayroll', 'Applies to Payroll'], ['appliesToExpenses', 'Applies to Expenses'],
          ].map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm" style={{ color: 'var(--aurora-text)' }}>
              <input type="checkbox" checked={form[k as keyof TaxTypeForm] as boolean} onChange={(e) => set(k as keyof TaxTypeForm, e.target.checked as never)} />
              {label}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export default function TaxTypesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('tax_types.manage');
  const canView = hasPermission('tax_types.view') || canManage;

  const [items, setItems] = useState<TaxType[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [taxCategory, setTaxCategory] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TaxType | null>(null);
  const [deleting, setDeleting] = useState<TaxType | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (taxCategory) params.set('taxCategory', taxCategory);
    if (status) params.set('status', status);
    const j = await fetch(`/api/backend/tax/types?${params}`).then((r) => r.json()).catch(() => ({}));
    const p: Paginated<TaxType> = j.data ?? {};
    setItems(p.data ?? []); setTotal(p.total ?? 0); setTotalPages(p.totalPages ?? 1);
    setLoading(false);
  }, [page, taxCategory, status]);

  useEffect(() => { load(); }, [load]);

  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };

  const onSaved = () => { setCreating(false); setEditing(null); load(); };

  const doDelete = async () => {
    if (!deleting) return;
    await fetch(`/api/backend/tax/types/${deleting.id}`, { method: 'DELETE' });
    setDeleting(null); load();
  };

  const activeCount = items.filter((t) => t.status === 'ACTIVE').length;
  const whtCount = items.filter((t) => t.isWithholding).length;

  if (!canView) return <div className="p-6"><PageHeader title="Tax Types" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Tax Types" subtitle="Catalog of taxes and statutory categories" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Total" value={total} />
        <StatCard label="Active (page)" value={activeCount} />
        <StatCard label="Withholding (page)" value={whtCount} />
      </div>

      <PageToolbar
        filters={
          <>
            <select value={taxCategory} onChange={(e) => reset(setTaxCategory)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New Tax Type</Btn> : null}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : items.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No tax types</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Recoverable</th>
                  <th className="px-4 py-3">WHT</th>
                  <th className="px-4 py-3">Applies</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                    <td className="px-4 py-3 font-mono text-xs">{t.taxTypeCode}</td>
                    <td className="px-4 py-3">{t.name}</td>
                    <td className="px-4 py-3 text-xs">{t.taxCategory}</td>
                    <td className="px-4 py-3 text-xs">{t.isRecoverable ? 'Yes' : 'No'}</td>
                    <td className="px-4 py-3 text-xs">{t.isWithholding ? 'Yes' : 'No'}</td>
                    <td className="px-4 py-3 text-xs">
                      {[t.appliesToSales && 'Sales', t.appliesToPurchases && 'Purch', t.appliesToPayroll && 'Payroll', t.appliesToExpenses && 'Exp'].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                    {canManage && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Btn variant="ghost" size="xs" onClick={() => setEditing(t)}>Edit</Btn>
                        <Btn variant="ghost" size="xs" onClick={() => setDeleting(t)}>Delete</Btn>
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

      {creating && <TaxTypeModal mode="create" onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <TaxTypeModal mode="edit" initial={editing} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title="Delete Tax Type" size="md"
          footer={<><Btn variant="secondary" onClick={() => setDeleting(null)}>Cancel</Btn><Btn variant="danger" onClick={doDelete}>Delete</Btn></>}>
          <p className="text-sm">Delete tax type <strong>{deleting.name}</strong>? This cannot be undone.</p>
        </Modal>
      )}
    </div>
  );
}
