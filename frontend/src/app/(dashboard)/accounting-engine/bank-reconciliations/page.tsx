'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Btn, Card, FormInput, FormSelect, FormTextarea, Modal, PageHeader, PageSpinner, StatCard, StatusBadge } from '@/components/ui';

interface Company { id: string; name: string; code?: string | null }
interface CashAccount { id: string; accountName: string; accountType: string; companyId: string; currentBalance?: number }
interface Reconciliation {
  id: string;
  reconciliationNumber: string;
  companyId: string;
  cashAccountId: string;
  statementStartDate: string;
  statementEndDate: string;
  statementClosingBalance: number;
  bookClosingBalance: number;
  reconciledBalance: number;
  differenceAmount: number;
  status: string;
  statementLines?: StatementLine[];
}
interface StatementLine {
  id: string;
  transactionDate: string;
  description: string;
  reference?: string | null;
  debitAmount: number;
  creditAmount: number;
  balance?: number | null;
  matched: boolean;
}

const today = new Date().toISOString().slice(0, 10);
const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

function unwrapList<T>(json: any): T[] {
  const payload = json?.data ?? json;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload)) return payload;
  return [];
}

function fmtMoney(amount: number | string | null | undefined, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Number(amount ?? 0))}`;
}

function label(row: { name?: string; code?: string | null; accountName?: string; accountType?: string }) {
  if (row.accountName) return `${row.accountName}${row.accountType ? ` (${row.accountType})` : ''}`;
  return row.code ? `${row.code} - ${row.name}` : (row.name ?? '');
}

export default function BankReconciliationsPage() {
  const [rows, setRows] = useState<Reconciliation[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Reconciliation | null>(null);
  const [lineOpen, setLineOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    reconciliationNumber: '',
    companyId: '',
    cashAccountId: '',
    statementStartDate: monthStart,
    statementEndDate: today,
    statementOpeningBalance: '0',
    statementClosingBalance: '0',
    bookOpeningBalance: '0',
    bookClosingBalance: '0',
    notes: '',
  });
  const [lineForm, setLineForm] = useState({ transactionDate: today, description: '', reference: '', debitAmount: '0', creditAmount: '0', balance: '' });

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json()).then((j) => setCompanies(unwrapList<Company>(j))).catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    if (!companyId && !form.companyId) {
      setCashAccounts([]);
      return;
    }
    const id = form.companyId || companyId;
    fetch(`/api/backend/cash-accounts?companyId=${id}&isActive=true&limit=200`)
      .then((r) => r.json())
      .then((j) => setCashAccounts(unwrapList<CashAccount>(j)))
      .catch(() => setCashAccounts([]));
  }, [companyId, form.companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (companyId) params.set('companyId', companyId);
      if (status) params.set('status', status);
      const json = await fetch(`/api/backend/bank-reconciliations?${params}`).then((r) => r.json());
      setRows(unwrapList<Reconciliation>(json));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reconciliations');
    } finally {
      setLoading(false);
    }
  }, [companyId, status]);

  useEffect(() => { load(); }, [load]);

  const cashAccountById = useMemo(() => new Map(cashAccounts.map((account) => [account.id, account])), [cashAccounts]);

  const openCreate = () => {
    setForm({
      reconciliationNumber: `BR-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`,
      companyId,
      cashAccountId: '',
      statementStartDate: monthStart,
      statementEndDate: today,
      statementOpeningBalance: '0',
      statementClosingBalance: '0',
      bookOpeningBalance: '0',
      bookClosingBalance: '0',
      notes: '',
    });
    setCreating(true);
  };

  const saveReconciliation = async () => {
    if (!form.companyId || !form.cashAccountId || !form.reconciliationNumber.trim()) {
      setError('Company, cash account, and reconciliation number are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        ...form,
        statementOpeningBalance: Number(form.statementOpeningBalance || 0),
        statementClosingBalance: Number(form.statementClosingBalance || 0),
        bookOpeningBalance: Number(form.bookOpeningBalance || 0),
        bookClosingBalance: Number(form.bookClosingBalance || 0),
        notes: form.notes || undefined,
      };
      const response = await fetch('/api/backend/bank-reconciliations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.message ?? 'Save failed');
      setCreating(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const refreshSelected = async (id: string) => {
    const json = await fetch(`/api/backend/bank-reconciliations/${id}`).then((r) => r.json());
    setSelected(json.data ?? json);
  };

  const saveLine = async () => {
    if (!selected || !lineForm.description.trim()) {
      setError('Statement line description is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        ...lineForm,
        debitAmount: Number(lineForm.debitAmount || 0),
        creditAmount: Number(lineForm.creditAmount || 0),
        balance: lineForm.balance ? Number(lineForm.balance) : undefined,
        reference: lineForm.reference || undefined,
      };
      const response = await fetch(`/api/backend/bank-reconciliations/${selected.id}/lines`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.message ?? 'Line save failed');
      setLineOpen(false);
      setLineForm({ transactionDate: today, description: '', reference: '', debitAmount: '0', creditAmount: '0', balance: '' });
      refreshSelected(selected.id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Line save failed');
    } finally {
      setSaving(false);
    }
  };

  const action = async (id: string, path: string, body?: unknown) => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/backend/bank-reconciliations/${id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.message ?? 'Action failed');
      await load();
      await refreshSelected(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setSaving(false);
    }
  };

  const openCount = rows.filter((row) => ['DRAFT', 'IN_PROGRESS'].includes(row.status)).length;
  const totalDifference = rows.reduce((sum, row) => sum + Number(row.differenceAmount ?? 0), 0);

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Bank Reconciliations" subtitle="Prepare, match, approve, and close bank reconciliation workpapers" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Reconciliations" value={rows.length} />
        <StatCard label="Open" value={openCount} />
        <StatCard label="Total Difference" value={fmtMoney(totalDifference)} />
        <StatCard label="Selected Lines" value={selected?.statementLines?.length ?? 0} />
      </div>

      <Card className="p-4">
        <div className="grid md:grid-cols-[1fr_180px_auto] gap-3 items-end">
          <FormSelect label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder="All companies">
            {companies.map((company) => <option key={company.id} value={company.id}>{label(company)}</option>)}
          </FormSelect>
          <FormSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses">
            {['DRAFT', 'IN_PROGRESS', 'RECONCILED', 'APPROVED', 'CLOSED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}
          </FormSelect>
          <Btn onClick={openCreate}>New Reconciliation</Btn>
        </div>
      </Card>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_420px] gap-5">
        <Card className="overflow-hidden">
          {loading ? <PageSpinner /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}><th className="px-4 py-3">Reconciliation</th><th className="px-4 py-3">Cash Account</th><th className="px-4 py-3">Period</th><th className="px-4 py-3 text-right">Difference</th><th className="px-4 py-3">Status</th></tr></thead>
                <tbody>
                  {rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No reconciliations</td></tr> : rows.map((row) => (
                    <tr key={row.id} onClick={() => refreshSelected(row.id)} className="border-t cursor-pointer hover:bg-slate-50" style={{ borderColor: 'var(--aurora-border)' }}>
                      <td className="px-4 py-3 font-mono text-xs">{row.reconciliationNumber}</td>
                      <td className="px-4 py-3">{cashAccountById.get(row.cashAccountId)?.accountName ?? row.cashAccountId}</td>
                      <td className="px-4 py-3 text-xs">{row.statementStartDate?.slice(0, 10)} to {row.statementEndDate?.slice(0, 10)}</td>
                      <td className={`px-4 py-3 text-right font-mono ${Math.abs(Number(row.differenceAmount ?? 0)) > 0.01 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtMoney(row.differenceAmount)}</td>
                      <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-4 space-y-4">
          {!selected ? (
            <div className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a reconciliation to work on statement lines and matching.</div>
          ) : (
            <>
              <div>
                <div className="font-semibold">{selected.reconciliationNumber}</div>
                <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{selected.statementStartDate?.slice(0, 10)} to {selected.statementEndDate?.slice(0, 10)}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <StatCard label="Statement Close" value={fmtMoney(selected.statementClosingBalance)} />
                <StatCard label="Reconciled" value={fmtMoney(selected.reconciledBalance)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Btn size="sm" variant="secondary" onClick={() => setLineOpen(true)} disabled={selected.status !== 'DRAFT'}>Add Line</Btn>
                <Btn size="sm" variant="secondary" loading={saving} onClick={() => action(selected.id, 'run-matching', { dateWindowDays: 3, amountToleranceCents: 1 })} disabled={selected.status !== 'DRAFT'}>Run Matching</Btn>
                <Btn size="sm" variant="success" loading={saving} onClick={() => action(selected.id, 'approve')} disabled={selected.status !== 'DRAFT'}>Approve</Btn>
                <Btn size="sm" variant="primary" loading={saving} onClick={() => action(selected.id, 'close')} disabled={selected.status !== 'APPROVED'}>Close</Btn>
              </div>
              <div className="max-h-[360px] overflow-auto border rounded-lg" style={{ borderColor: 'var(--aurora-border)' }}>
                {(selected.statementLines ?? []).map((line) => (
                  <div key={line.id} className="border-b p-3 text-sm" style={{ borderColor: 'var(--aurora-border)' }}>
                    <div className="flex justify-between gap-3">
                      <div className="font-medium">{line.description}</div>
                      <StatusBadge status={line.matched ? 'MATCHED' : 'OPEN'} />
                    </div>
                    <div className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{line.transactionDate?.slice(0, 10)} {line.reference ? `- ${line.reference}` : ''}</div>
                    <div className="mt-1 font-mono text-xs">DR {fmtMoney(line.debitAmount)} / CR {fmtMoney(line.creditAmount)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {creating && (
        <Modal open title="Create Bank Reconciliation" onClose={() => setCreating(false)} size="xl" footer={<><Btn variant="secondary" onClick={() => setCreating(false)}>Cancel</Btn><Btn loading={saving} onClick={saveReconciliation}>Create</Btn></>}>
          <div className="grid md:grid-cols-2 gap-3">
            <FormInput label="Reconciliation Number" required value={form.reconciliationNumber} onChange={(e) => setForm((f) => ({ ...f, reconciliationNumber: e.target.value }))} />
            <FormSelect label="Company" required value={form.companyId} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value, cashAccountId: '' }))} placeholder="Select company">
              {companies.map((company) => <option key={company.id} value={company.id}>{label(company)}</option>)}
            </FormSelect>
            <FormSelect label="Cash / Bank Account" required value={form.cashAccountId} onChange={(e) => setForm((f) => ({ ...f, cashAccountId: e.target.value }))} placeholder={form.companyId ? 'Select account' : 'Select company first'} disabled={!form.companyId}>
              {cashAccounts.filter((account) => account.companyId === form.companyId).map((account) => <option key={account.id} value={account.id}>{label(account)}</option>)}
            </FormSelect>
            <div />
            <FormInput label="Statement Start" type="date" value={form.statementStartDate} onChange={(e) => setForm((f) => ({ ...f, statementStartDate: e.target.value }))} />
            <FormInput label="Statement End" type="date" value={form.statementEndDate} onChange={(e) => setForm((f) => ({ ...f, statementEndDate: e.target.value }))} />
            <FormInput label="Statement Opening" type="number" value={form.statementOpeningBalance} onChange={(e) => setForm((f) => ({ ...f, statementOpeningBalance: e.target.value }))} />
            <FormInput label="Statement Closing" type="number" value={form.statementClosingBalance} onChange={(e) => setForm((f) => ({ ...f, statementClosingBalance: e.target.value }))} />
            <FormInput label="Book Opening" type="number" value={form.bookOpeningBalance} onChange={(e) => setForm((f) => ({ ...f, bookOpeningBalance: e.target.value }))} />
            <FormInput label="Book Closing" type="number" value={form.bookClosingBalance} onChange={(e) => setForm((f) => ({ ...f, bookClosingBalance: e.target.value }))} />
            <div className="md:col-span-2"><FormTextarea label="Notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          </div>
        </Modal>
      )}

      {lineOpen && selected && (
        <Modal open title="Add Statement Line" onClose={() => setLineOpen(false)} size="lg" footer={<><Btn variant="secondary" onClick={() => setLineOpen(false)}>Cancel</Btn><Btn loading={saving} onClick={saveLine}>Add Line</Btn></>}>
          <div className="grid md:grid-cols-2 gap-3">
            <FormInput label="Date" type="date" value={lineForm.transactionDate} onChange={(e) => setLineForm((f) => ({ ...f, transactionDate: e.target.value }))} />
            <FormInput label="Reference" value={lineForm.reference} onChange={(e) => setLineForm((f) => ({ ...f, reference: e.target.value }))} />
            <div className="md:col-span-2"><FormInput label="Description" required value={lineForm.description} onChange={(e) => setLineForm((f) => ({ ...f, description: e.target.value }))} /></div>
            <FormInput label="Debit" type="number" value={lineForm.debitAmount} onChange={(e) => setLineForm((f) => ({ ...f, debitAmount: e.target.value }))} />
            <FormInput label="Credit" type="number" value={lineForm.creditAmount} onChange={(e) => setLineForm((f) => ({ ...f, creditAmount: e.target.value }))} />
            <FormInput label="Running Balance" type="number" value={lineForm.balance} onChange={(e) => setLineForm((f) => ({ ...f, balance: e.target.value }))} />
          </div>
        </Modal>
      )}
    </div>
  );
}
