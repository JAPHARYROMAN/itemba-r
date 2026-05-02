'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string }
interface TaxType { id: string; name: string }
interface TaxCode { id: string; taxCode: string }

interface TaxTransaction {
  id: string;
  companyId: string;
  company?: { name: string };
  taxTypeId: string;
  taxType?: { name: string };
  taxCodeId?: string;
  taxCode?: { taxCode: string };
  transactionDate: string;
  direction: string;
  taxableAmount: number;
  taxRate: number;
  taxAmount: number;
  referenceType?: string | null;
  referenceId?: string | null;
  notes?: string | null;
  status: string;
  createdAt: string;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

const DIRECTIONS = ['OUTGOING', 'INCOMING'];
const STATUSES = ['DRAFT', 'POSTED', 'REVERSED'];

const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' };

function fmt(n: number | string) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
}

interface TxnForm {
  companyId: string; transactionDate: string; taxTypeId: string; taxCodeId: string;
  direction: string; taxableAmount: string; taxRate: string; taxAmount: string;
  referenceType: string; referenceId: string; notes: string;
}
const BLANK: TxnForm = { companyId: '', transactionDate: '', taxTypeId: '', taxCodeId: '', direction: 'OUTGOING', taxableAmount: '', taxRate: '', taxAmount: '', referenceType: '', referenceId: '', notes: '' };

function CreateModal({ companies, taxTypes, taxCodes, onClose, onSaved }: { companies: Company[]; taxTypes: TaxType[]; taxCodes: TaxCode[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<TxnForm>({ ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof TxnForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.companyId || !form.transactionDate || !form.taxTypeId) { setError('Company, date, tax type required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        companyId: form.companyId, transactionDate: form.transactionDate,
        taxTypeId: form.taxTypeId, direction: form.direction,
        taxCodeId: form.taxCodeId || undefined,
        taxableAmount: form.taxableAmount ? Number(form.taxableAmount) : undefined,
        taxRate: form.taxRate ? Number(form.taxRate) : undefined,
        taxAmount: form.taxAmount ? Number(form.taxAmount) : undefined,
        referenceType: form.referenceType || undefined,
        referenceId: form.referenceId || undefined,
        notes: form.notes || undefined,
      };
      const res = await fetch('/api/backend/compliance/tax-transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title="New Tax Transaction" size="xl"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormSelect label="Company" required value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="Select…">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormInput label="Date" required type="date" value={form.transactionDate} onChange={(e) => set('transactionDate', e.target.value)} />
        <FormSelect label="Tax Type" required value={form.taxTypeId} onChange={(e) => set('taxTypeId', e.target.value)} placeholder="Select…">
          {taxTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </FormSelect>
        <FormSelect label="Tax Code" value={form.taxCodeId} onChange={(e) => set('taxCodeId', e.target.value)} placeholder="—">
          {taxCodes.map((tc) => <option key={tc.id} value={tc.id}>{tc.taxCode}</option>)}
        </FormSelect>
        <FormSelect label="Direction" value={form.direction} onChange={(e) => set('direction', e.target.value)}>
          {DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </FormSelect>
        <div />
        <FormInput label="Taxable Amount" type="number" step="0.01" value={form.taxableAmount} onChange={(e) => set('taxableAmount', e.target.value)} />
        <FormInput label="Tax Rate" type="number" step="0.0001" value={form.taxRate} onChange={(e) => set('taxRate', e.target.value)} />
        <FormInput label="Tax Amount" type="number" step="0.01" value={form.taxAmount} onChange={(e) => set('taxAmount', e.target.value)} />
        <div />
        <FormInput label="Reference Type" value={form.referenceType} onChange={(e) => set('referenceType', e.target.value)} />
        <FormInput label="Reference Id" value={form.referenceId} onChange={(e) => set('referenceId', e.target.value)} />
        <div className="col-span-2"><FormTextarea label="Notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function TaxTransactionsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('tax_transactions.manage');
  const canView = hasPermission('tax_transactions.view') || canManage;

  const [items, setItems] = useState<TaxTransaction[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [taxTypes, setTaxTypes] = useState<TaxType[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [taxTypeId, setTaxTypeId] = useState('');
  const [direction, setDirection] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [creating, setCreating] = useState(false);
  const [actingId, setActingId] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json()).then((j) => setCompanies(j.data?.data ?? j.data ?? []));
    fetch('/api/backend/compliance/tax-types?limit=100').then((r) => r.json()).then((j) => setTaxTypes(j.data?.data ?? j.data ?? []));
    fetch('/api/backend/compliance/tax-codes?limit=100').then((r) => r.json()).then((j) => setTaxCodes(j.data?.data ?? j.data ?? []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (companyId) params.set('companyId', companyId);
    if (taxTypeId) params.set('taxTypeId', taxTypeId);
    if (direction) params.set('direction', direction);
    if (status) params.set('status', status);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    const j = await fetch(`/api/backend/compliance/tax-transactions?${params}`).then((r) => r.json()).catch(() => ({}));
    const p: Paginated<TaxTransaction> = j.data ?? {};
    setItems(p.data ?? []); setTotal(p.total ?? 0); setTotalPages(p.totalPages ?? 1);
    setLoading(false);
  }, [page, companyId, taxTypeId, direction, status, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);
  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };
  const onSaved = () => { setCreating(false); load(); };
  const doAction = async (id: string, action: 'post' | 'reverse') => {
    setActingId(id);
    await fetch(`/api/backend/compliance/tax-transactions/${id}/${action}`, { method: 'POST' });
    setActingId(''); load();
  };

  const postedCount = items.filter((t) => t.status === 'POSTED').length;
  const draftCount = items.filter((t) => t.status === 'DRAFT').length;

  if (!canView) return <div className="p-6"><PageHeader title="Tax Transactions" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Tax Transactions" subtitle="Output, input, and withheld tax entries" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Total" value={total} />
        <StatCard label="Posted (page)" value={postedCount} />
        <StatCard label="Draft (page)" value={draftCount} />
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
            <select value={direction} onChange={(e) => reset(setDirection)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Directions</option>
              {DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input type="date" value={dateFrom} onChange={(e) => reset(setDateFrom)(e.target.value)} className={filterSelectCls} style={filterStyle} />
            <input type="date" value={dateTo} onChange={(e) => reset(setDateTo)(e.target.value)} className={filterSelectCls} style={filterStyle} />
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New Transaction</Btn> : null}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : items.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No transactions</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Tax Type</th>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Direction</th>
                  <th className="px-4 py-3 text-right">Taxable</th>
                  <th className="px-4 py-3 text-right">Rate</th>
                  <th className="px-4 py-3 text-right">Tax</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                    <td className="px-4 py-3 text-xs">{t.transactionDate?.split('T')[0]}</td>
                    <td className="px-4 py-3 text-xs">{t.company?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs">{t.taxType?.name ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{t.taxCode?.taxCode ?? '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={t.direction} /></td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(t.taxableAmount)}</td>
                    <td className="px-4 py-3 text-right font-mono">{Number(t.taxRate).toFixed(4)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(t.taxAmount)}</td>
                    <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                    {canManage && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {t.status === 'DRAFT' && <Btn variant="success" size="xs" loading={actingId === t.id} onClick={() => doAction(t.id, 'post')}>Post</Btn>}
                        {t.status === 'POSTED' && <Btn variant="warning" size="xs" loading={actingId === t.id} onClick={() => doAction(t.id, 'reverse')}>Reverse</Btn>}
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

      {creating && <CreateModal companies={companies} taxTypes={taxTypes} taxCodes={taxCodes} onClose={() => setCreating(false)} onSaved={onSaved} />}
    </div>
  );
}
