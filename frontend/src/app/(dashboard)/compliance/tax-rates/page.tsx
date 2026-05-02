'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface TaxType { id: string; name: string }
interface TaxRate {
  id: string;
  taxTypeId: string;
  taxType?: { name: string };
  rateName: string;
  rate: number;
  calculationMethod: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  notes?: string | null;
  status: string;
  createdAt: string;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

const METHODS = ['PERCENTAGE', 'FLAT_AMOUNT', 'TIERED'];
const STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE'];

const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' };

interface RateForm {
  taxTypeId: string; rateName: string; rate: string;
  calculationMethod: string; effectiveFrom: string; effectiveTo: string; notes: string;
}
const BLANK: RateForm = { taxTypeId: '', rateName: '', rate: '', calculationMethod: 'PERCENTAGE', effectiveFrom: '', effectiveTo: '', notes: '' };

function RateModal({ mode, initial, taxTypes, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: TaxRate; taxTypes: TaxType[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<RateForm>(() => initial ? {
    taxTypeId: initial.taxTypeId, rateName: initial.rateName, rate: String(initial.rate),
    calculationMethod: initial.calculationMethod,
    effectiveFrom: initial.effectiveFrom?.split('T')[0] ?? '',
    effectiveTo: initial.effectiveTo?.split('T')[0] ?? '',
    notes: initial.notes ?? '',
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof RateForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.taxTypeId) { setError('Tax type required'); return; }
    if (!form.rateName.trim()) { setError('Rate name required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        taxTypeId: form.taxTypeId, rateName: form.rateName,
        calculationMethod: form.calculationMethod,
        rate: form.rate ? Number(form.rate) : undefined,
        effectiveFrom: form.effectiveFrom || undefined,
        effectiveTo: form.effectiveTo || undefined,
        notes: form.notes || undefined,
      };
      const res = await fetch(mode === 'create' ? '/api/backend/compliance/tax-rates' : `/api/backend/compliance/tax-rates/${initial!.id}`,
        { method: mode === 'create' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Tax Rate' : 'Edit Tax Rate'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormSelect label="Tax Type" required value={form.taxTypeId} onChange={(e) => set('taxTypeId', e.target.value)} placeholder="Select…">
          {taxTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </FormSelect>
        <FormInput label="Rate Name" required value={form.rateName} onChange={(e) => set('rateName', e.target.value)} />
        <FormInput label="Rate" type="number" step="0.0001" value={form.rate} onChange={(e) => set('rate', e.target.value)} />
        <FormSelect label="Calculation" value={form.calculationMethod} onChange={(e) => set('calculationMethod', e.target.value)}>
          {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </FormSelect>
        <FormInput label="Effective From" type="date" value={form.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} />
        <FormInput label="Effective To" type="date" value={form.effectiveTo} onChange={(e) => set('effectiveTo', e.target.value)} />
        <div className="col-span-2"><FormTextarea label="Notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function TaxRatesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('tax_rates.manage');
  const canView = hasPermission('tax_rates.view') || canManage;

  const [items, setItems] = useState<TaxRate[]>([]);
  const [taxTypes, setTaxTypes] = useState<TaxType[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [taxTypeId, setTaxTypeId] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TaxRate | null>(null);
  const [deleting, setDeleting] = useState<TaxRate | null>(null);
  const [actingId, setActingId] = useState('');

  useEffect(() => {
    fetch('/api/backend/compliance/tax-types?limit=100').then((r) => r.json()).then((j) => setTaxTypes(j.data?.data ?? j.data ?? []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (taxTypeId) params.set('taxTypeId', taxTypeId);
    if (status) params.set('status', status);
    const j = await fetch(`/api/backend/compliance/tax-rates?${params}`).then((r) => r.json()).catch(() => ({}));
    const p: Paginated<TaxRate> = j.data ?? {};
    setItems(p.data ?? []); setTotal(p.total ?? 0); setTotalPages(p.totalPages ?? 1);
    setLoading(false);
  }, [page, taxTypeId, status]);

  useEffect(() => { load(); }, [load]);
  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };
  const onSaved = () => { setCreating(false); setEditing(null); load(); };
  const doDelete = async () => {
    if (!deleting) return;
    await fetch(`/api/backend/compliance/tax-rates/${deleting.id}`, { method: 'DELETE' });
    setDeleting(null); load();
  };
  const doAction = async (id: string, action: 'approve' | 'deactivate') => {
    setActingId(id);
    await fetch(`/api/backend/compliance/tax-rates/${id}/${action}`, { method: 'POST' });
    setActingId(''); load();
  };

  const activeCount = items.filter((r) => r.status === 'ACTIVE').length;
  const draftCount = items.filter((r) => r.status === 'DRAFT').length;

  if (!canView) return <div className="p-6"><PageHeader title="Tax Rates" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Tax Rates" subtitle="Tax rates with effective periods and approval workflow" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Total Rates" value={total} />
        <StatCard label="Active (page)" value={activeCount} />
        <StatCard label="Draft (page)" value={draftCount} />
      </div>

      <PageToolbar
        filters={
          <>
            <select value={taxTypeId} onChange={(e) => reset(setTaxTypeId)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Tax Types</option>
              {taxTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New Rate</Btn> : null}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : items.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No tax rates</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-4 py-3">Tax Type</th>
                  <th className="px-4 py-3">Rate Name</th>
                  <th className="px-4 py-3 text-right">Rate</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3">Effective</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                    <td className="px-4 py-3 text-xs">{r.taxType?.name ?? '—'}</td>
                    <td className="px-4 py-3">{r.rateName}</td>
                    <td className="px-4 py-3 text-right font-mono">{Number(r.rate).toFixed(4)}</td>
                    <td className="px-4 py-3 text-xs">{r.calculationMethod}</td>
                    <td className="px-4 py-3 text-xs">{r.effectiveFrom?.split('T')[0]}{r.effectiveTo ? ` → ${r.effectiveTo.split('T')[0]}` : ''}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    {canManage && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {r.status === 'DRAFT' && <Btn variant="success" size="xs" loading={actingId === r.id} onClick={() => doAction(r.id, 'approve')}>Approve</Btn>}
                        {r.status === 'ACTIVE' && <Btn variant="warning" size="xs" loading={actingId === r.id} onClick={() => doAction(r.id, 'deactivate')}>Deactivate</Btn>}
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

      {creating && <RateModal mode="create" taxTypes={taxTypes} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <RateModal mode="edit" initial={editing} taxTypes={taxTypes} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title="Delete Tax Rate" size="md"
          footer={<><Btn variant="secondary" onClick={() => setDeleting(null)}>Cancel</Btn><Btn variant="danger" onClick={doDelete}>Delete</Btn></>}>
          <p className="text-sm">Delete rate <strong>{deleting.rateName}</strong>?</p>
        </Modal>
      )}
    </div>
  );
}
