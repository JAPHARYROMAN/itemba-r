'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatCard, PageToolbar, Modal, Btn, StatusBadge, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string; }
interface TaxType { id: string; name: string; }
interface FilingPeriod { id: string; name: string; filingPeriodCode: string; }
interface TaxReturn {
  id: string; companyId: string; company?: { name: string };
  taxTypeId: string; taxType?: { name: string };
  filingPeriodId: string; filingPeriod?: { name: string };
  taxableIncome?: number; outputTax?: number; inputTax?: number;
  netTaxDue?: number; totalDue?: number; amountPaid?: number;
  outstandingAmount?: number; notes?: string | null; status: string; createdAt: string;
}
interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number; }
interface ReturnForm {
  companyId: string; taxTypeId: string; filingPeriodId: string;
  taxableIncome: string; outputTax: string; inputTax: string;
  netTaxDue: string; totalDue: string; notes: string;
}

const BLANK: ReturnForm = {
  companyId: '', taxTypeId: '', filingPeriodId: '',
  taxableIncome: '', outputTax: '', inputTax: '', netTaxDue: '', totalDue: '', notes: '',
};
const STATUSES = ['DRAFT', 'PREPARING', 'UNDER_REVIEW', 'APPROVED', 'SUBMITTED', 'PAID', 'CANCELLED'];

function ReturnModal({ companies, taxTypes, filingPeriods, onClose, onSaved }: {
  companies: Company[]; taxTypes: TaxType[]; filingPeriods: FilingPeriod[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<ReturnForm>({ ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof ReturnForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      const payload = {
        ...form,
        taxableIncome: parseFloat(form.taxableIncome) || 0,
        outputTax: parseFloat(form.outputTax) || 0,
        inputTax: parseFloat(form.inputTax) || 0,
        netTaxDue: parseFloat(form.netTaxDue) || 0,
        totalDue: parseFloat(form.totalDue) || 0,
      };
      const res = await fetch('/api/backend/compliance/tax-returns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'An error occurred'); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Create Tax Return"
      size="xl"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" type="submit" form="tax-return-form" loading={saving}>Create</Btn>
        </>
      }
    >
      <form id="tax-return-form" onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}
        <FormSelect label="Company" required value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="Select company…">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormSelect label="Tax Type" required value={form.taxTypeId} onChange={(e) => set('taxTypeId', e.target.value)} placeholder="Select tax type…">
          {taxTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </FormSelect>
        <FormSelect label="Filing Period" required value={form.filingPeriodId} onChange={(e) => set('filingPeriodId', e.target.value)} placeholder="Select period…">
          {filingPeriods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </FormSelect>
        <div className="grid grid-cols-2 gap-4">
          <FormInput label="Taxable Income" type="number" step="0.01" value={form.taxableIncome} onChange={(e) => set('taxableIncome', e.target.value)} />
          <FormInput label="Output Tax" type="number" step="0.01" value={form.outputTax} onChange={(e) => set('outputTax', e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <FormInput label="Input Tax" type="number" step="0.01" value={form.inputTax} onChange={(e) => set('inputTax', e.target.value)} />
          <FormInput label="Net Tax Due" type="number" step="0.01" value={form.netTaxDue} onChange={(e) => set('netTaxDue', e.target.value)} />
          <FormInput label="Total Due" type="number" step="0.01" value={form.totalDue} onChange={(e) => set('totalDue', e.target.value)} />
        </div>
        <FormTextarea label="Notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </form>
    </Modal>
  );
}

export default function TaxReturnsPage() {
  const { hasPermission } = useAuth();
  const [data, setData] = useState<Paginated<TaxReturn> | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [taxTypes, setTaxTypes] = useState<TaxType[]>([]);
  const [filingPeriods, setFilingPeriods] = useState<FilingPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [taxTypeId, setTaxTypeId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const canManage = hasPermission('tax_returns.manage');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json()).then((j) => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    fetch('/api/backend/compliance/tax-types?limit=100').then((r) => r.json()).then((j) => setTaxTypes(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    fetch('/api/backend/compliance/tax-filing-periods?limit=100').then((r) => r.json()).then((j) => setFilingPeriods(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (companyId) params.set('companyId', companyId);
      if (taxTypeId) params.set('taxTypeId', taxTypeId);
      if (status) params.set('status', status);
      const res = await fetch(`/api/backend/compliance/tax-returns?${params}`);
      const json = await res.json();
      setData(json.data ?? null);
    } finally { setLoading(false); }
  }, [page, companyId, taxTypeId, status]);

  useEffect(() => { load(); }, [load]);

  const reset = (setter: (v: string) => void) => (v: string) => { setter(v); setPage(1); };

  const doAction = async (id: string, action: string) => {
    setActionLoading(id + action);
    try { await fetch(`/api/backend/compliance/tax-returns/${id}/${action}`, { method: 'POST' }); load(); }
    finally { setActionLoading(null); }
  };

  const fmt = (n?: number) => n != null ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

  const WORKFLOW: Record<string, { label: string; action: string; variant: 'primary' | 'warning' | 'success' | 'secondary' }> = {
    DRAFT: { label: 'Prepare', action: 'prepare', variant: 'primary' },
    PREPARING: { label: 'Review', action: 'review', variant: 'warning' },
    UNDER_REVIEW: { label: 'Approve', action: 'approve', variant: 'success' },
    APPROVED: { label: 'Submit', action: 'submit', variant: 'secondary' },
    SUBMITTED: { label: 'Mark Paid', action: 'mark-paid', variant: 'success' },
  };

  return (
    <div className="p-6 space-y-6">
      {creating && <ReturnModal companies={companies} taxTypes={taxTypes} filingPeriods={filingPeriods} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      <PageHeader title="Tax Returns" subtitle="File and track tax return submissions" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total" value={data?.total ?? 0} />
        <StatCard label="Draft" value={data?.data.filter((r) => r.status === 'DRAFT').length ?? 0} />
        <StatCard label="Submitted" value={data?.data.filter((r) => r.status === 'SUBMITTED').length ?? 0} />
        <StatCard label="Paid" value={data?.data.filter((r) => r.status === 'PAID').length ?? 0} />
      </div>
      <PageToolbar
        filters={
          <>
            <select value={companyId} onChange={(e) => reset(setCompanyId)(e.target.value)} className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}>
              <option value="">All Companies</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={taxTypeId} onChange={(e) => reset(setTaxTypeId)(e.target.value)} className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}>
              <option value="">All Tax Types</option>{taxTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}>
              <option value="">All Status</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setCreating(true)}>+ Create Return</Btn> : undefined}
      />
      <Card>
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-slate-400">{data?.total ?? 0} returns</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500 border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">Company</th><th className="px-4 py-3">Tax Type</th>
                <th className="px-4 py-3">Period</th><th className="px-4 py-3 text-right">Net Tax Due</th>
                <th className="px-4 py-3 text-right">Total Due</th><th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Outstanding</th><th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <tr><td colSpan={9}><PageSpinner /></td></tr>
                : !data?.data.length ? <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">No tax returns found</td></tr>
                : data.data.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-800">{r.company?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{r.taxType?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{r.filingPeriod?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">{fmt(r.netTaxDue)}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">{fmt(r.totalDue)}</td>
                    <td className="px-4 py-3 text-right font-mono text-green-600">{fmt(r.amountPaid)}</td>
                    <td className="px-4 py-3 text-right font-mono text-red-600">{fmt(r.outstandingAmount)}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                          {WORKFLOW[r.status] && (
                            <Btn size="xs" variant={WORKFLOW[r.status].variant} onClick={() => doAction(r.id, WORKFLOW[r.status].action)} loading={actionLoading === r.id + WORKFLOW[r.status].action}>{WORKFLOW[r.status].label}</Btn>
                          )}
                          {r.status !== 'CANCELLED' && r.status !== 'PAID' && (
                            <Btn variant="danger" size="xs" onClick={() => doAction(r.id, 'cancel')} loading={actionLoading === r.id + 'cancel'}>Cancel</Btn>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {data && data.totalPages > 1 && (
          <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">Page {data.page} of {data.totalPages} · {data.total} total</span>
            <div className="flex gap-2">
              <Btn variant="secondary" size="xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Btn>
              <Btn variant="secondary" size="xs" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
