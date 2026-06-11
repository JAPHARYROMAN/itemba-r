'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card, PageHeader, PageToolbar, StatCard, StatusBadge, Btn, PageSpinner,
  Modal, FormInput, FormSelect, FormTextarea,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string; code: string }

interface Loan {
  id: string;
  lenderName: string;
  loanReference?: string | null;
  obligationType: string;
  borrowerLevel: string;
  principalAmount: string;
  outstandingBalance: string;
  interestRate: string;
  repaymentFrequency: string;
  maturityDate: string;
  status: string;
  riskLevel: string;
  currency: string;
  collateralDescription?: string | null;
  company?: { name: string; code: string } | null;
}

interface Debt {
  id: string;
  creditorName: string;
  description: string;
  invoiceNumber?: string | null;
  amount: string;
  amountPaid: string;
  currency: string;
  dueDate?: string | null;
  status: string;
  riskLevel: string;
  company?: { name: string; code: string } | null;
}

interface LoanSummary {
  totalCount: number;
  activeCount: number;
  settledCount: number;
  defaultedCount: number;
  highRiskCount: number;
  collateralCount: number;
  upcomingMaturity: number;
  totalPrincipal: string | number;
  totalOutstandingBalance: string | number;
  monthlyRepaymentBurden: string | number;
  byCompany?: { companyId: string | null; companyName: string; companyCode?: string; count: number; totalOutstanding: string | number | null }[];
}

interface DebtSummary {
  totalCount: number;
  outstandingCount: number;
  overdueCount: number;
  highRiskCount: number;
  totalAmount: string | number;
  totalOutstandingAmount: string | number;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

const LOAN_TYPES = ['BANK_LOAN', 'OVERDRAFT', 'SUPPLIER_CREDIT', 'ASSET_FINANCE', 'MORTGAGE', 'DIRECTOR_LOAN', 'INTER_COMPANY_LOAN', 'INSTITUTIONAL_DEBT', 'OTHER'];
const LOAN_STATUSES = ['ACTIVE', 'SETTLED', 'DEFAULTED', 'RESTRUCTURED', 'CANCELLED', 'WRITTEN_OFF'];
const DEBT_STATUSES = ['OUTSTANDING', 'PARTIALLY_PAID', 'PAID', 'DISPUTED', 'WRITTEN_OFF', 'RESTRUCTURED'];
const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const BORROWER_LEVELS = ['COMPANY', 'GROUP'];
const REPAYMENT_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUALLY', 'ANNUALLY', 'BULLET', 'OTHER'];
const CURRENCIES = ['TZS', 'USD', 'EUR', 'GBP', 'KES', 'UGX'];

function fmt(n: number | string) {
  const v = typeof n === 'string' ? Number(n) : n;
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(v || 0);
}
function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
}
function isOverdue(d?: string | null) { return !!d && new Date(d).getTime() < Date.now(); }

// ─── Loan Modal ───────────────────────────────────────────────────────────────

function LoanModal({
  mode, initial, companies, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Loan;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    lenderName: initial?.lenderName ?? '',
    lenderType: '' as string,
    lenderContact: '',
    loanReference: initial?.loanReference ?? '',
    obligationType: initial?.obligationType ?? 'BANK_LOAN',
    borrowerLevel: initial?.borrowerLevel ?? 'COMPANY',
    companyId: (initial as any)?.companyId ?? '',
    principalAmount: initial?.principalAmount ?? '',
    outstandingBalance: initial?.outstandingBalance ?? '',
    interestRate: initial?.interestRate ?? '',
    currency: initial?.currency ?? 'TZS',
    disbursementDate: '',
    maturityDate: initial?.maturityDate?.slice(0, 10) ?? '',
    repaymentFrequency: initial?.repaymentFrequency ?? 'MONTHLY',
    repaymentAmount: '',
    status: initial?.status ?? 'ACTIVE',
    riskLevel: initial?.riskLevel ?? 'LOW',
    purpose: '',
    collateralDescription: initial?.collateralDescription ?? '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const setField = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.lenderName.trim()) { setError('Lender name is required'); return; }
    if (mode === 'create') {
      if (!form.principalAmount || !form.interestRate || !form.disbursementDate || !form.maturityDate || !form.outstandingBalance) {
        setError('Principal, interest rate, disbursement date, maturity, and outstanding balance are required');
        return;
      }
    }
    if (form.borrowerLevel === 'COMPANY' && !form.companyId) {
      setError('Select a company when borrower level is COMPANY');
      return;
    }

    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        lenderName: form.lenderName.trim(),
        obligationType: form.obligationType,
        borrowerLevel: form.borrowerLevel,
        currency: form.currency,
        repaymentFrequency: form.repaymentFrequency,
        status: form.status,
        riskLevel: form.riskLevel,
      };
      if (form.companyId) body.companyId = form.companyId;
      if (form.lenderType) body.lenderType = form.lenderType;
      if (form.lenderContact) body.lenderContact = form.lenderContact;
      if (form.loanReference) body.loanReference = form.loanReference;
      if (form.principalAmount) body.principalAmount = form.principalAmount;
      if (form.outstandingBalance) body.outstandingBalance = form.outstandingBalance;
      if (form.interestRate) body.interestRate = form.interestRate;
      if (form.disbursementDate) body.disbursementDate = form.disbursementDate;
      if (form.maturityDate) body.maturityDate = form.maturityDate;
      if (form.repaymentAmount) body.repaymentAmount = form.repaymentAmount;
      if (form.purpose) body.purpose = form.purpose;
      if (form.collateralDescription) body.collateralDescription = form.collateralDescription;
      if (form.notes) body.notes = form.notes;

      const url = mode === 'create' ? '/api/backend/loans' : `/api/backend/loans/${initial!.id}`;
      const method = mode === 'create' ? 'POST' : 'PUT';
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const message = (Array.isArray(j?.message) && j.message.join(', ')) || j?.message || `HTTP ${res.status}`;
        throw new Error(message);
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'New Loan' : 'Edit Loan'}
      subtitle="Group obligation — bank loan, supplier credit, asset finance, etc."
      size="xl"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={saving}>
            {mode === 'create' ? 'Create' : 'Save'}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-sm rounded-lg px-3 py-2 border" style={{ color: 'var(--aurora-danger)', borderColor: 'var(--aurora-danger)', background: 'var(--aurora-danger-bg, #fef2f2)' }}>
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Lender Name" required value={form.lenderName} onChange={(e) => setField('lenderName', e.target.value)} />
        <FormInput label="Lender Type" placeholder="e.g. Bank, SACCO, Director" value={form.lenderType} onChange={(e) => setField('lenderType', e.target.value)} />
        <FormInput label="Lender Contact" value={form.lenderContact} onChange={(e) => setField('lenderContact', e.target.value)} />
        <FormInput label="Loan Reference" value={form.loanReference} onChange={(e) => setField('loanReference', e.target.value)} />

        <FormSelect label="Obligation Type" value={form.obligationType} onChange={(e) => setField('obligationType', e.target.value)}>
          {LOAN_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </FormSelect>
        <FormSelect label="Borrower Level" value={form.borrowerLevel} onChange={(e) => setField('borrowerLevel', e.target.value)}>
          {BORROWER_LEVELS.map((b) => <option key={b} value={b}>{b}</option>)}
        </FormSelect>

        <FormSelect label="Company" value={form.companyId} onChange={(e) => setField('companyId', e.target.value)} placeholder="— Select —">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormSelect label="Currency" value={form.currency} onChange={(e) => setField('currency', e.target.value)}>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </FormSelect>

        <FormInput label="Principal Amount" required={mode === 'create'} type="number" step="0.01" value={form.principalAmount} onChange={(e) => setField('principalAmount', e.target.value)} />
        <FormInput label="Outstanding Balance" required={mode === 'create'} type="number" step="0.01" value={form.outstandingBalance} onChange={(e) => setField('outstandingBalance', e.target.value)} />

        <FormInput label="Annual Interest Rate" required={mode === 'create'} type="number" step="0.0001" hint="0.18 = 18%" value={form.interestRate} onChange={(e) => setField('interestRate', e.target.value)} />
        <FormSelect label="Repayment Frequency" value={form.repaymentFrequency} onChange={(e) => setField('repaymentFrequency', e.target.value)}>
          {REPAYMENT_FREQUENCIES.map((f) => <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>)}
        </FormSelect>

        <FormInput label="Disbursement Date" required={mode === 'create'} type="date" value={form.disbursementDate} onChange={(e) => setField('disbursementDate', e.target.value)} />
        <FormInput label="Maturity Date" required={mode === 'create'} type="date" value={form.maturityDate} onChange={(e) => setField('maturityDate', e.target.value)} />

        <FormInput label="Scheduled Repayment Amount" type="number" step="0.01" value={form.repaymentAmount} onChange={(e) => setField('repaymentAmount', e.target.value)} />
        <FormInput label="Purpose" value={form.purpose} onChange={(e) => setField('purpose', e.target.value)} />

        <FormSelect label="Status" value={form.status} onChange={(e) => setField('status', e.target.value)}>
          {LOAN_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </FormSelect>
        <FormSelect label="Risk Level" value={form.riskLevel} onChange={(e) => setField('riskLevel', e.target.value)}>
          {RISK_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
        </FormSelect>

        <div className="col-span-2"><FormTextarea label="Collateral Description" rows={2} value={form.collateralDescription} onChange={(e) => setField('collateralDescription', e.target.value)} /></div>
        <div className="col-span-2"><FormTextarea label="Notes" rows={2} value={form.notes} onChange={(e) => setField('notes', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

// ─── Debt Modal ───────────────────────────────────────────────────────────────

function DebtModal({
  mode, initial, companies, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Debt;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    companyId: (initial as any)?.companyId ?? '',
    creditorName: initial?.creditorName ?? '',
    creditorContact: '',
    description: initial?.description ?? '',
    invoiceNumber: initial?.invoiceNumber ?? '',
    amount: initial?.amount ?? '',
    amountPaid: initial?.amountPaid ?? '',
    currency: initial?.currency ?? 'TZS',
    dueDate: initial?.dueDate?.slice(0, 10) ?? '',
    status: initial?.status ?? 'OUTSTANDING',
    riskLevel: initial?.riskLevel ?? 'LOW',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const setField = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (mode === 'create') {
      if (!form.companyId || !form.creditorName.trim() || !form.description.trim() || !form.amount) {
        setError('Company, creditor, description and amount are required');
        return;
      }
    }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        creditorName: form.creditorName.trim(),
        description: form.description.trim(),
        currency: form.currency,
        status: form.status,
        riskLevel: form.riskLevel,
      };
      if (form.companyId) body.companyId = form.companyId;
      if (form.creditorContact) body.creditorContact = form.creditorContact;
      if (form.invoiceNumber) body.invoiceNumber = form.invoiceNumber;
      if (form.amount) body.amount = form.amount;
      if (form.amountPaid) body.amountPaid = form.amountPaid;
      if (form.dueDate) body.dueDate = form.dueDate;
      if (form.notes) body.notes = form.notes;

      const url = mode === 'create' ? '/api/backend/debts' : `/api/backend/debts/${initial!.id}`;
      const method = mode === 'create' ? 'POST' : 'PUT';
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const message = (Array.isArray(j?.message) && j.message.join(', ')) || j?.message || `HTTP ${res.status}`;
        throw new Error(message);
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'New Trade Debt / Payable' : 'Edit Debt'}
      subtitle="Amount owed to a creditor (trade payable, accrual, statutory obligation, etc.)."
      size="lg"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={saving}>
            {mode === 'create' ? 'Create' : 'Save'}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-sm rounded-lg px-3 py-2 border" style={{ color: 'var(--aurora-danger)', borderColor: 'var(--aurora-danger)', background: 'var(--aurora-danger-bg, #fef2f2)' }}>
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormSelect label="Company" required value={form.companyId} onChange={(e) => setField('companyId', e.target.value)} placeholder="— Select —">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormSelect label="Currency" value={form.currency} onChange={(e) => setField('currency', e.target.value)}>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </FormSelect>

        <FormInput label="Creditor Name" required value={form.creditorName} onChange={(e) => setField('creditorName', e.target.value)} />
        <FormInput label="Creditor Contact" value={form.creditorContact} onChange={(e) => setField('creditorContact', e.target.value)} />

        <div className="col-span-2"><FormInput label="Description" required value={form.description} onChange={(e) => setField('description', e.target.value)} /></div>

        <FormInput label="Invoice Number" value={form.invoiceNumber} onChange={(e) => setField('invoiceNumber', e.target.value)} />
        <FormInput label="Due Date" type="date" value={form.dueDate} onChange={(e) => setField('dueDate', e.target.value)} />

        <FormInput label="Amount" required={mode === 'create'} type="number" step="0.01" value={form.amount} onChange={(e) => setField('amount', e.target.value)} />
        <FormInput label="Amount Paid" type="number" step="0.01" value={form.amountPaid} onChange={(e) => setField('amountPaid', e.target.value)} />

        <FormSelect label="Status" value={form.status} onChange={(e) => setField('status', e.target.value)}>
          {DEBT_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </FormSelect>
        <FormSelect label="Risk Level" value={form.riskLevel} onChange={(e) => setField('riskLevel', e.target.value)}>
          {RISK_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
        </FormSelect>

        <div className="col-span-2"><FormTextarea label="Notes" rows={2} value={form.notes} onChange={(e) => setField('notes', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

// ─── Delete Confirm (shared) ──────────────────────────────────────────────────

function DeleteConfirm({
  kind, label, id, onClose, onConfirmed,
}: {
  kind: 'loans' | 'debts';
  label: string;
  id: string;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const handleDelete = async () => {
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/backend/${kind}/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message ?? 'Delete failed');
      }
      onConfirmed();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally { setSaving(false); }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Delete ${kind === 'loans' ? 'loan' : 'debt'}?`}
      size="sm"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn variant="danger" onClick={handleDelete} loading={saving}>Delete</Btn>
        </>
      }
    >
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>
        Soft-delete <strong>{label}</strong>? The record stays in the database for audit but is hidden from lists.
      </p>
    </Modal>
  );
}

export default function LoansDebtsPage() {
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<'loans' | 'debts'>('loans');
  const [companies, setCompanies] = useState<Company[]>([]);

  const [loanData, setLoanData] = useState<Paginated<Loan> | null>(null);
  const [debtData, setDebtData] = useState<Paginated<Debt> | null>(null);
  const [loanSummary, setLoanSummary] = useState<LoanSummary | null>(null);
  const [debtSummary, setDebtSummary] = useState<DebtSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterRisk, setFilterRisk] = useState('');
  const [page, setPage] = useState(1);

  const canView = hasPermission('loans.read') || hasPermission('debts.read');
  const canManageLoans = hasPermission('loans.create');
  const canManageDebts = hasPermission('debts.create');

  // CRUD modal state, kept separate per kind so a loan and a debt can never
  // be open simultaneously and we don't mix shapes.
  const [creatingLoan, setCreatingLoan] = useState(false);
  const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
  const [deletingLoan, setDeletingLoan] = useState<Loan | null>(null);
  const [creatingDebt, setCreatingDebt] = useState(false);
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null);
  const [deletingDebt, setDeletingDebt] = useState<Debt | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=50').then((r) => r.json())
      .then((j) => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    fetch('/api/backend/loans/summary').then((r) => r.json()).then((j) => setLoanSummary(j.data ?? null));
    fetch('/api/backend/debts/summary').then((r) => r.json()).then((j) => setDebtSummary(j.data ?? null));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '15' });
      if (search.trim()) params.set('search', search.trim());
      if (filterCompany) params.set('companyId', filterCompany);
      if (filterStatus) params.set('status', filterStatus);
      if (filterRisk) params.set('riskLevel', filterRisk);
      if (tab === 'loans') {
        if (filterType) params.set('obligationType', filterType);
        const res = await fetch(`/api/backend/loans?${params}`);
        const json = await res.json();
        setLoanData(json.data ?? null);
      } else {
        const res = await fetch(`/api/backend/debts?${params}`);
        const json = await res.json();
        setDebtData(json.data ?? null);
      }
    } finally { setLoading(false); }
  }, [tab, page, search, filterCompany, filterType, filterStatus, filterRisk]);

  useEffect(() => { load(); }, [load]);

  if (!canView) {
    return <div className="p-6"><PageHeader title="Loans & Debts" subtitle="Group obligations" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;
  }

  const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' } as const;
  const totalExposure = Number(loanSummary?.totalOutstandingBalance ?? 0) + Number(debtSummary?.totalOutstandingAmount ?? 0);

  // Reload list + summary together after create/edit/delete.
  const refresh = () => {
    load();
    fetch('/api/backend/loans/summary').then((r) => r.json()).then((j) => setLoanSummary(j.data ?? null));
    fetch('/api/backend/debts/summary').then((r) => r.json()).then((j) => setDebtSummary(j.data ?? null));
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Loans & Debts" subtitle="Group obligations — loans, trade payables, and exposure" />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Active Loans" value={loanSummary?.activeCount ?? 0} hint={`TZS ${fmt(loanSummary?.totalOutstandingBalance ?? 0)}`} />
        <StatCard label="Monthly Burden" value={fmt(loanSummary?.monthlyRepaymentBurden ?? 0)} hint="TZS / month" />
        <StatCard label="High-Risk Loans" value={loanSummary?.highRiskCount ?? 0} hint="HIGH/CRITICAL" />
        <StatCard label="Outstanding Debts" value={debtSummary?.outstandingCount ?? 0} hint={`TZS ${fmt(debtSummary?.totalOutstandingAmount ?? 0)}`} />
        <StatCard label="Overdue Debts" value={debtSummary?.overdueCount ?? 0} hint="Past due" />
        <StatCard label="Total Exposure" value={fmt(totalExposure)} hint="Loans + debts" />
      </div>

      {(loanSummary?.upcomingMaturity ?? 0) > 0 && (
        <Card className="p-4 border-amber-300 bg-amber-50">
          <div className="text-sm font-semibold text-amber-900">{loanSummary?.upcomingMaturity} loan(s) maturing within 90 days</div>
        </Card>
      )}

      {tab === 'loans' && loanSummary?.byCompany?.length ? (
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--aurora-text)' }}>By Company</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {loanSummary.byCompany.map((row, i) => (
              <div key={i} className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)' }}>
                <div className="text-sm font-medium" style={{ color: 'var(--aurora-text)' }}>{row.companyName}</div>
                {row.companyCode && <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{row.companyCode}</div>}
                <div className="mt-2 text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>{row.count}</div>
                <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>Outstanding: TZS {fmt(row.totalOutstanding ?? 0)}</div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="flex items-center justify-between border-b" style={{ borderColor: 'var(--aurora-border)' }}>
        <div className="flex gap-2">
          {(['loans', 'debts'] as const).map((k) => (
            <button key={k} onClick={() => { setTab(k); setPage(1); setFilterStatus(''); setFilterType(''); }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === k ? 'border-brand-600 text-brand-600' : 'border-transparent'}`}
              style={tab === k ? {} : { color: 'var(--aurora-text-muted)' }}>
              {k === 'loans' ? 'Loans' : 'Trade Debts & Payables'}
            </button>
          ))}
        </div>
        <div className="pb-1">
          {tab === 'loans' && canManageLoans && (
            <Btn variant="primary" size="sm" onClick={() => setCreatingLoan(true)}>+ New Loan</Btn>
          )}
          {tab === 'debts' && canManageDebts && (
            <Btn variant="primary" size="sm" onClick={() => setCreatingDebt(true)}>+ New Debt</Btn>
          )}
        </div>
      </div>

      <PageToolbar
        search={search} onSearch={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder={tab === 'loans' ? 'Lender, reference…' : 'Creditor, invoice #…'}
        filters={
          <>
            <select value={filterCompany} onChange={(e) => { setFilterCompany(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {tab === 'loans' && (
              <select value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
                <option value="">All Types</option>
                {LOAN_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            )}
            <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              {(tab === 'loans' ? LOAN_STATUSES : DEBT_STATUSES).map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={filterRisk} onChange={(e) => { setFilterRisk(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Risk</option>
              {RISK_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          {tab === 'loans' ? (
            <table className="w-full text-sm min-w-[1200px]">
              <thead>
                <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-4 py-3">Lender</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3 text-right">Principal</th>
                  <th className="px-4 py-3 text-right">Outstanding</th>
                  <th className="px-4 py-3 text-right">Rate</th>
                  <th className="px-4 py-3">Maturity</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Risk</th>
                  {canManageLoans && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? <tr><td colSpan={canManageLoans ? 10 : 9}><PageSpinner /></td></tr>
                  : !loanData?.data.length ? <tr><td colSpan={canManageLoans ? 10 : 9} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No loans</td></tr>
                  : loanData.data.map((l) => {
                    const overdue = isOverdue(l.maturityDate) && l.status === 'ACTIVE';
                    return (
                      <tr key={l.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <Link href={`/group-control/loans-debts/loans/${l.id}`} className="text-brand-600 hover:underline">{l.lenderName}</Link>
                          {l.loanReference && <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{l.loanReference}</div>}
                        </td>
                        <td className="px-4 py-3 text-xs">{l.obligationType.replace(/_/g, ' ')}</td>
                        <td className="px-4 py-3 text-xs">{l.company?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{l.currency} {fmt(l.principalAmount)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{l.currency} {fmt(l.outstandingBalance)}</td>
                        <td className="px-4 py-3 text-right text-xs">{(Number(l.interestRate) * 100).toFixed(2)}%</td>
                        <td className={`px-4 py-3 text-xs ${overdue ? 'text-red-600 font-semibold' : ''}`}>{overdue ? 'Overdue - ' : ''}{fmtDate(l.maturityDate)}</td>
                        <td className="px-4 py-3"><StatusBadge value={l.status} /></td>
                        <td className="px-4 py-3"><StatusBadge value={l.riskLevel} /></td>
                        {canManageLoans && (
                          <td className="px-4 py-3 text-right space-x-1 whitespace-nowrap">
                            <Btn variant="ghost" size="xs" onClick={() => setEditingLoan(l)}>Edit</Btn>
                            <Btn variant="ghost" size="xs" onClick={() => setDeletingLoan(l)}>Delete</Btn>
                          </td>
                        )}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm min-w-[1100px]">
              <thead>
                <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-4 py-3">Creditor</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Invoice #</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3">Due</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Risk</th>
                  {canManageDebts && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? <tr><td colSpan={canManageDebts ? 10 : 9}><PageSpinner /></td></tr>
                  : !debtData?.data.length ? <tr><td colSpan={canManageDebts ? 10 : 9} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No debts</td></tr>
                  : debtData.data.map((d) => {
                    const overdue = isOverdue(d.dueDate) && d.status !== 'PAID';
                    return (
                      <tr key={d.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">{d.creditorName}</td>
                        <td className="px-4 py-3 text-xs">{d.description}</td>
                        <td className="px-4 py-3 font-mono text-xs">{d.invoiceNumber ?? '—'}</td>
                        <td className="px-4 py-3 text-xs">{d.company?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{d.currency} {fmt(d.amount)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{d.currency} {fmt(d.amountPaid)}</td>
                        <td className={`px-4 py-3 text-xs ${overdue ? 'text-red-600 font-semibold' : ''}`}>{overdue ? 'Overdue - ' : ''}{fmtDate(d.dueDate)}</td>
                        <td className="px-4 py-3"><StatusBadge value={d.status} /></td>
                        <td className="px-4 py-3"><StatusBadge value={d.riskLevel} /></td>
                        {canManageDebts && (
                          <td className="px-4 py-3 text-right space-x-1 whitespace-nowrap">
                            <Btn variant="ghost" size="xs" onClick={() => setEditingDebt(d)}>Edit</Btn>
                            <Btn variant="ghost" size="xs" onClick={() => setDeletingDebt(d)}>Delete</Btn>
                          </td>
                        )}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </div>
        {(() => {
          const d = tab === 'loans' ? loanData : debtData;
          if (!d || d.totalPages <= 1) return null;
          return (
            <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--aurora-border)' }}>
              <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>Page {d.page} of {d.totalPages} · {d.total} total</span>
              <div className="flex gap-2">
                <Btn variant="secondary" size="xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Btn>
                <Btn variant="secondary" size="xs" disabled={page >= d.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Btn>
              </div>
            </div>
          );
        })()}
      </Card>

      {/* CRUD modals */}
      {creatingLoan && (
        <LoanModal
          mode="create"
          companies={companies}
          onClose={() => setCreatingLoan(false)}
          onSaved={() => { setCreatingLoan(false); refresh(); }}
        />
      )}
      {editingLoan && (
        <LoanModal
          mode="edit"
          initial={editingLoan}
          companies={companies}
          onClose={() => setEditingLoan(null)}
          onSaved={() => { setEditingLoan(null); refresh(); }}
        />
      )}
      {deletingLoan && (
        <DeleteConfirm
          kind="loans"
          label={deletingLoan.lenderName}
          id={deletingLoan.id}
          onClose={() => setDeletingLoan(null)}
          onConfirmed={() => { setDeletingLoan(null); refresh(); }}
        />
      )}

      {creatingDebt && (
        <DebtModal
          mode="create"
          companies={companies}
          onClose={() => setCreatingDebt(false)}
          onSaved={() => { setCreatingDebt(false); refresh(); }}
        />
      )}
      {editingDebt && (
        <DebtModal
          mode="edit"
          initial={editingDebt}
          companies={companies}
          onClose={() => setEditingDebt(null)}
          onSaved={() => { setEditingDebt(null); refresh(); }}
        />
      )}
      {deletingDebt && (
        <DeleteConfirm
          kind="debts"
          label={deletingDebt.creditorName}
          id={deletingDebt.id}
          onClose={() => setDeletingDebt(null)}
          onConfirmed={() => { setDeletingDebt(null); refresh(); }}
        />
      )}
    </div>
  );
}
