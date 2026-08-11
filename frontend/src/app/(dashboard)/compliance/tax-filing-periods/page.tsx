'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string }
interface TaxType { id: string; name: string }
interface FilingPeriod {
  id: string;
  filingPeriodCode: string;
  companyId: string;
  company?: { name: string };
  taxTypeId: string;
  taxType?: { name: string };
  name: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  filingFrequency: string;
  status: string;
  createdAt: string;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

const FREQS = ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL'];
const STATUSES = ['OPEN', 'CLOSED', 'PENDING', 'SUBMITTED', 'ACCEPTED', 'REJECTED'];

const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' };

interface PeriodForm {
  filingPeriodCode: string; companyId: string; taxTypeId: string; name: string;
  periodStart: string; periodEnd: string; dueDate: string;
  filingFrequency: string; status: string;
}
const BLANK: PeriodForm = { filingPeriodCode: '', companyId: '', taxTypeId: '', name: '', periodStart: '', periodEnd: '', dueDate: '', filingFrequency: 'MONTHLY', status: 'OPEN' };

function PeriodModal({ mode, initial, companies, taxTypes, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: FilingPeriod; companies: Company[]; taxTypes: TaxType[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<PeriodForm>(() => initial ? {
    filingPeriodCode: initial.filingPeriodCode, companyId: initial.companyId,
    taxTypeId: initial.taxTypeId, name: initial.name,
    periodStart: initial.periodStart?.split('T')[0] ?? '',
    periodEnd: initial.periodEnd?.split('T')[0] ?? '',
    dueDate: initial.dueDate?.split('T')[0] ?? '',
    filingFrequency: initial.filingFrequency, status: initial.status,
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof PeriodForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.filingPeriodCode.trim() || !form.companyId || !form.taxTypeId || !form.name.trim()) {
      setError('Code, company, tax type, name required'); return;
    }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        filingPeriodCode: form.filingPeriodCode, companyId: form.companyId, taxTypeId: form.taxTypeId,
        name: form.name, filingFrequency: form.filingFrequency, status: form.status,
        periodStart: form.periodStart || undefined,
        periodEnd: form.periodEnd || undefined,
        dueDate: form.dueDate || undefined,
      };
      const res = await fetch(mode === 'create' ? '/api/backend/tax/filing-periods' : `/api/backend/tax/filing-periods/${initial!.id}`,
        { method: mode === 'create' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Filing Period' : 'Edit Filing Period'} size="xl"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Code" required value={form.filingPeriodCode} onChange={(e) => set('filingPeriodCode', e.target.value)} />
        <FormInput label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} />
        <FormSelect label="Company" required value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="Select…">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormSelect label="Tax Type" required value={form.taxTypeId} onChange={(e) => set('taxTypeId', e.target.value)} placeholder="Select…">
          {taxTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </FormSelect>
        <FormSelect label="Frequency" value={form.filingFrequency} onChange={(e) => set('filingFrequency', e.target.value)}>
          {FREQS.map((f) => <option key={f} value={f}>{f}</option>)}
        </FormSelect>
        <FormSelect label="Status" value={form.status} onChange={(e) => set('status', e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </FormSelect>
        <FormInput label="Period Start" type="date" value={form.periodStart} onChange={(e) => set('periodStart', e.target.value)} />
        <FormInput label="Period End" type="date" value={form.periodEnd} onChange={(e) => set('periodEnd', e.target.value)} />
        <div className="col-span-2"><FormInput label="Due Date" type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function FilingPeriodsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('tax_filing_periods.manage');
  const canView = hasPermission('tax_filing_periods.view') || canManage;

  const [items, setItems] = useState<FilingPeriod[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [taxTypes, setTaxTypes] = useState<TaxType[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [taxTypeId, setTaxTypeId] = useState('');
  const [filingFrequency, setFilingFrequency] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<FilingPeriod | null>(null);
  const [deleting, setDeleting] = useState<FilingPeriod | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json()).then((j) => setCompanies(j.data?.data ?? j.data ?? []));
    fetch('/api/backend/tax/types?limit=100').then((r) => r.json()).then((j) => setTaxTypes(j.data?.data ?? j.data ?? []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (companyId) params.set('companyId', companyId);
    if (taxTypeId) params.set('taxTypeId', taxTypeId);
    if (filingFrequency) params.set('filingFrequency', filingFrequency);
    if (status) params.set('status', status);
    const j = await fetch(`/api/backend/tax/filing-periods?${params}`).then((r) => r.json()).catch(() => ({}));
    const p: Paginated<FilingPeriod> = j.data ?? {};
    setItems(p.data ?? []); setTotal(p.total ?? 0); setTotalPages(p.totalPages ?? 1);
    setLoading(false);
  }, [page, companyId, taxTypeId, filingFrequency, status]);

  useEffect(() => { load(); }, [load]);
  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };
  const onSaved = () => { setCreating(false); setEditing(null); load(); };
  const doDelete = async () => {
    if (!deleting) return;
    await fetch(`/api/backend/tax/filing-periods/${deleting.id}`, { method: 'DELETE' });
    setDeleting(null); load();
  };

  const openCount = items.filter((p) => p.status === 'OPEN').length;
  const submittedCount = items.filter((p) => p.status === 'SUBMITTED' || p.status === 'ACCEPTED').length;

  if (!canView) return <div className="p-6"><PageHeader title="Tax Filing Periods" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Tax Filing Periods" subtitle="Filing windows and due dates per tax type" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Total" value={total} />
        <StatCard label="Open (page)" value={openCount} />
        <StatCard label="Submitted (page)" value={submittedCount} />
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
            <select value={filingFrequency} onChange={(e) => reset(setFilingFrequency)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Frequencies</option>
              {FREQS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New Period</Btn> : null}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : items.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No filing periods</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Tax Type</th>
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3">Due</th>
                  <th className="px-4 py-3">Freq</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                    <td className="px-4 py-3 font-mono text-xs">{p.filingPeriodCode}</td>
                    <td className="px-4 py-3">{p.name}</td>
                    <td className="px-4 py-3 text-xs">{p.company?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs">{p.taxType?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs">{p.periodStart?.split('T')[0]} → {p.periodEnd?.split('T')[0]}</td>
                    <td className="px-4 py-3 text-xs">{p.dueDate?.split('T')[0]}</td>
                    <td className="px-4 py-3 text-xs">{p.filingFrequency}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    {canManage && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Btn variant="ghost" size="xs" onClick={() => setEditing(p)}>Edit</Btn>
                        <Btn variant="ghost" size="xs" onClick={() => setDeleting(p)}>Delete</Btn>
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

      {creating && <PeriodModal mode="create" companies={companies} taxTypes={taxTypes} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <PeriodModal mode="edit" initial={editing} companies={companies} taxTypes={taxTypes} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title="Delete Filing Period" size="md"
          footer={<><Btn variant="secondary" onClick={() => setDeleting(null)}>Cancel</Btn><Btn variant="danger" onClick={doDelete}>Delete</Btn></>}>
          <p className="text-sm">Delete period <strong>{deleting.filingPeriodCode}</strong>?</p>
        </Modal>
      )}
    </div>
  );
}
