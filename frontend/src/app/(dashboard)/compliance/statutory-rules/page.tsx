'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface StatutoryRule {
  id: string;
  ruleCode: string;
  name: string;
  description?: string | null;
  calculationMethod: string;
  employeeContributionRate: number;
  employerContributionRate: number;
  minGrossForContribution?: number | null;
  maxContributionBase?: number | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  status: string;
  createdAt: string;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

const METHODS = ['PERCENTAGE', 'FLAT_AMOUNT', 'TIERED'];
const STATUSES = ['ACTIVE', 'INACTIVE', 'DRAFT'];

const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' };

interface RuleForm {
  ruleCode: string; name: string; description: string;
  calculationMethod: string; status: string;
  employeeContributionRate: string; employerContributionRate: string;
  minGrossForContribution: string; maxContributionBase: string;
  effectiveFrom: string; effectiveTo: string;
}
const BLANK: RuleForm = { ruleCode: '', name: '', description: '', calculationMethod: 'PERCENTAGE', status: 'DRAFT', employeeContributionRate: '', employerContributionRate: '', minGrossForContribution: '', maxContributionBase: '', effectiveFrom: '', effectiveTo: '' };

function RuleModal({ mode, initial, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: StatutoryRule; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<RuleForm>(() => initial ? {
    ruleCode: initial.ruleCode, name: initial.name, description: initial.description ?? '',
    calculationMethod: initial.calculationMethod, status: initial.status,
    employeeContributionRate: String(initial.employeeContributionRate ?? ''),
    employerContributionRate: String(initial.employerContributionRate ?? ''),
    minGrossForContribution: initial.minGrossForContribution != null ? String(initial.minGrossForContribution) : '',
    maxContributionBase: initial.maxContributionBase != null ? String(initial.maxContributionBase) : '',
    effectiveFrom: initial.effectiveFrom?.split('T')[0] ?? '',
    effectiveTo: initial.effectiveTo?.split('T')[0] ?? '',
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof RuleForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.ruleCode.trim() || !form.name.trim()) { setError('Code and name required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        ruleCode: form.ruleCode, name: form.name, calculationMethod: form.calculationMethod, status: form.status,
        description: form.description || undefined,
        employeeContributionRate: form.employeeContributionRate ? Number(form.employeeContributionRate) : undefined,
        employerContributionRate: form.employerContributionRate ? Number(form.employerContributionRate) : undefined,
        minGrossForContribution: form.minGrossForContribution ? Number(form.minGrossForContribution) : undefined,
        maxContributionBase: form.maxContributionBase ? Number(form.maxContributionBase) : undefined,
        effectiveFrom: form.effectiveFrom || undefined,
        effectiveTo: form.effectiveTo || undefined,
      };
      const res = await fetch(mode === 'create' ? '/api/backend/compliance/statutory-rules' : `/api/backend/compliance/statutory-rules/${initial!.id}`,
        { method: mode === 'create' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Statutory Rule' : 'Edit Statutory Rule'} size="xl"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Code" required value={form.ruleCode} onChange={(e) => set('ruleCode', e.target.value)} />
        <FormInput label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} />
        <FormSelect label="Calculation Method" value={form.calculationMethod} onChange={(e) => set('calculationMethod', e.target.value)}>
          {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </FormSelect>
        <FormSelect label="Status" value={form.status} onChange={(e) => set('status', e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </FormSelect>
        <FormInput label="Employee Rate" type="number" step="0.0001" value={form.employeeContributionRate} onChange={(e) => set('employeeContributionRate', e.target.value)} />
        <FormInput label="Employer Rate" type="number" step="0.0001" value={form.employerContributionRate} onChange={(e) => set('employerContributionRate', e.target.value)} />
        <FormInput label="Min Gross" type="number" step="0.01" value={form.minGrossForContribution} onChange={(e) => set('minGrossForContribution', e.target.value)} />
        <FormInput label="Max Base" type="number" step="0.01" value={form.maxContributionBase} onChange={(e) => set('maxContributionBase', e.target.value)} />
        <FormInput label="Effective From" type="date" value={form.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} />
        <FormInput label="Effective To" type="date" value={form.effectiveTo} onChange={(e) => set('effectiveTo', e.target.value)} />
        <div className="col-span-2"><FormTextarea label="Description" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function StatutoryRulesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('statutory_rules.manage');
  const canView = hasPermission('statutory_rules.view') || canManage;

  const [items, setItems] = useState<StatutoryRule[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StatutoryRule | null>(null);
  const [deleting, setDeleting] = useState<StatutoryRule | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (status) params.set('status', status);
    const j = await fetch(`/api/backend/compliance/statutory-rules?${params}`).then((r) => r.json()).catch(() => ({}));
    const p: Paginated<StatutoryRule> = j.data ?? {};
    setItems(p.data ?? []); setTotal(p.total ?? 0); setTotalPages(p.totalPages ?? 1);
    setLoading(false);
  }, [page, status]);

  useEffect(() => { load(); }, [load]);
  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };
  const onSaved = () => { setCreating(false); setEditing(null); load(); };
  const doDelete = async () => {
    if (!deleting) return;
    await fetch(`/api/backend/compliance/statutory-rules/${deleting.id}`, { method: 'DELETE' });
    setDeleting(null); load();
  };

  const activeCount = items.filter((r) => r.status === 'ACTIVE').length;
  const draftCount = items.filter((r) => r.status === 'DRAFT').length;

  if (!canView) return <div className="p-6"><PageHeader title="Statutory Rules" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Statutory Rules" subtitle="NSSF, PAYE, SDL and other statutory contribution rules" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Total" value={total} />
        <StatCard label="Active (page)" value={activeCount} />
        <StatCard label="Draft (page)" value={draftCount} />
      </div>

      <PageToolbar
        filters={
          <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={filterSelectCls} style={filterStyle}>
            <option value="">All Status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New Rule</Btn> : null}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : items.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No rules</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3 text-right">Employee</th>
                  <th className="px-4 py-3 text-right">Employer</th>
                  <th className="px-4 py-3">Effective</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                    <td className="px-4 py-3 font-mono text-xs">{r.ruleCode}</td>
                    <td className="px-4 py-3">{r.name}</td>
                    <td className="px-4 py-3 text-xs">{r.calculationMethod}</td>
                    <td className="px-4 py-3 text-right font-mono">{Number(r.employeeContributionRate).toFixed(4)}</td>
                    <td className="px-4 py-3 text-right font-mono">{Number(r.employerContributionRate).toFixed(4)}</td>
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

      {creating && <RuleModal mode="create" onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <RuleModal mode="edit" initial={editing} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title="Delete Rule" size="md"
          footer={<><Btn variant="secondary" onClick={() => setDeleting(null)}>Cancel</Btn><Btn variant="danger" onClick={doDelete}>Delete</Btn></>}>
          <p className="text-sm">Delete rule <strong>{deleting.name}</strong>?</p>
        </Modal>
      )}
    </div>
  );
}
