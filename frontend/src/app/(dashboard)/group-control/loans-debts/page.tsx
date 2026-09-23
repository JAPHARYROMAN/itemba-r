'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Btn, EmptyState, ErrorState, FormDateField, FormInput, FormSelect, FormTextarea, Modal, PageHeader, PageSpinner, PageToolbar, PermissionDeniedState, showToast, StatusBadge } from '@/components/ui';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import '@/components/workspace/workspace.css';
import '@/features/loans/loans-workspace.css';
import { useFormGuard } from '@/components/workspace/unsaved-work-provider';
import { useAuth } from '@/hooks/use-auth';
import { ScopeSelector } from '@/components/ui/scope-selector';
import { LoanFundingFields, emptyFunding } from '@/features/loans/loan-finance';

interface Company {
  id: string;
  name: string;
  code: string;
}

interface Loan {
  companyId?: string;
  divisionId?: string;
  branchId?: string;
  notes?: string;
  purpose?: string;
  lenderType?: string;
  lenderContact?: string;
  disbursementDate?: string;
  repaymentAmount?: string;
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
  byCompany?: {
    companyId: string | null;
    companyName: string;
    companyCode?: string;
    count: number;
    totalOutstanding: string | number | null;
  }[];
}

interface DebtSummary {
  totalCount: number;
  outstandingCount: number;
  overdueCount: number;
  highRiskCount: number;
  totalAmount: string | number;
  totalOutstandingAmount: string | number;
}

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

const LOAN_TYPES = [
  'BANK_LOAN',
  'OVERDRAFT',
  'SUPPLIER_CREDIT',
  'ASSET_FINANCE',
  'MORTGAGE',
  'DIRECTOR_LOAN',
  'INTER_COMPANY_LOAN',
  'INSTITUTIONAL_DEBT',
  'OTHER',
];
const LOAN_STATUSES = [
  'ACTIVE',
  'SETTLED',
  'DEFAULTED',
  'RESTRUCTURED',
  'CANCELLED',
  'WRITTEN_OFF',
];
const DEBT_STATUSES = [
  'OUTSTANDING',
  'PARTIALLY_PAID',
  'PAID',
  'DISPUTED',
  'WRITTEN_OFF',
  'RESTRUCTURED',
];
const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const BORROWER_LEVELS = ['COMPANY', 'GROUP'];
const REPAYMENT_FREQUENCIES = [
  'MONTHLY',
  'QUARTERLY',
  'SEMI_ANNUALLY',
  'ANNUALLY',
  'BULLET',
  'OTHER',
];
const CURRENCIES = ['TZS', 'USD', 'EUR', 'GBP', 'KES', 'UGX'];

function fmt(n: number | string) {
  const v = typeof n === 'string' ? Number(n) : n;
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(v || 0);
}
function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ─── Loan Modal ───────────────────────────────────────────────────────────────

function LoanModal({
  mode,
  initial,
  companies,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Loan;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    lenderName: initial?.lenderName ?? '',
    lenderType: initial?.lenderType ?? '',
    lenderContact: initial?.lenderContact ?? '',
    loanReference: initial?.loanReference ?? '',
    obligationType: initial?.obligationType ?? 'BANK_LOAN',
    borrowerLevel: initial?.borrowerLevel ?? 'COMPANY',
    companyId: initial?.companyId ?? '',
    divisionId: initial?.divisionId ?? '',
    branchId: initial?.branchId ?? '',
    principalAmount: initial?.principalAmount ?? '',
    outstandingBalance: initial?.outstandingBalance ?? '',
    interestRate: initial?.interestRate ?? '',
    currency: initial?.currency ?? 'TZS',
    disbursementDate: initial?.disbursementDate?.slice(0, 10) ?? '',
    maturityDate: initial?.maturityDate?.slice(0, 10) ?? '',
    repaymentFrequency: initial?.repaymentFrequency ?? 'MONTHLY',
    repaymentAmount: initial?.repaymentAmount ?? '',
    status: initial?.status ?? 'ACTIVE',
    riskLevel: initial?.riskLevel ?? 'LOW',
    purpose: initial?.purpose ?? '',
    collateralDescription: initial?.collateralDescription ?? '',
    notes: initial?.notes ?? '',
  });
  const [funding, setFunding] = useState(emptyFunding);
  const [ack, setAck] = useState(false);
  const request = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const draft = useFormGuard({ form, funding });
  const close = () => {
    if (!saving) draft.requestClose(onClose);
  };
  const setField = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setAck(false);
    if (k === 'companyId' || k === 'currency')
      setFunding({ ...emptyFunding, fundingMode: funding.fundingMode });
  };

  const handleSubmit = async () => {
    if (saving) return;
    if (mode === 'create' && !ack) {
      setError('Review the accounting connection before saving.');
      return;
    }
    if (!form.lenderName.trim()) {
      setError('Lender name is required');
      return;
    }
    if (mode === 'create') {
      if (
        !form.principalAmount ||
        !form.interestRate ||
        !form.disbursementDate ||
        !form.maturityDate ||
        (funding.fundingMode === 'OPENING' && !form.outstandingBalance)
      ) {
        setError(
          'Principal, interest rate, disbursement date, maturity, and outstanding balance are required',
        );
        return;
      }
    }
    if (!form.companyId) {
      setError('Select the accounting company that holds this loan');
      return;
    }

    setSaving(true);
    setError('');
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
      if (mode === 'create') {
        body.divisionId = form.divisionId || undefined;
        body.branchId = form.branchId || undefined;
      }
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

      if (mode === 'create') {
        request.current ??= crypto.randomUUID();
        Object.assign(body, {
          ...funding,
          requestId: request.current,
          cashDeskAccountId: funding.fundingMode === 'NEW' ? funding.cashDeskAccountId : undefined,
          fees: funding.fundingMode === 'NEW' ? funding.fees : '0',
          openingOffsetAccountId:
            funding.fundingMode === 'OPENING' ? funding.openingOffsetAccountId : undefined,
          recognitionDate: funding.recognitionDate || undefined,
          feeAccountId: funding.feeAccountId || undefined,
        });
        if (funding.fundingMode === 'NEW') body.outstandingBalance = form.principalAmount;
      } else {
        for (const key of Object.keys(body))
          if (
            ![
              'lenderName',
              'lenderType',
              'lenderContact',
              'loanReference',
              'riskLevel',
              'purpose',
              'collateralDescription',
              'notes',
            ].includes(key)
          )
            delete body[key];
      }
      const url = mode === 'create' ? '/api/backend/loans' : `/api/backend/loans/${initial!.id}`;
      const method = mode === 'create' ? 'POST' : 'PUT';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const message =
          (Array.isArray(j?.message) && j.message.join(', ')) || j?.message || `HTTP ${res.status}`;
        throw new Error(message);
      }
      draft.markSaved();
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onChangeCapture={draft.touch}
      onClose={close}
      title={mode === 'create' ? 'New Loan' : 'Edit Loan'}
      subtitle="Borrowing — bank loans, director loans and asset finance"
      size="xl"
      footer={
        <>
          <Btn variant="secondary" onClick={close}>
            Cancel
          </Btn>
          <Btn
            variant="primary"
            onClick={handleSubmit}
            loading={saving}
            disabled={mode === 'create' && !ack}
          >
            {mode === 'create' ? 'Create' : 'Save'}
          </Btn>
        </>
      }
    >
      {error && (
        <div
          role="alert"
          className="mb-3 text-sm rounded-lg px-3 py-2 border"
          style={{
            color: 'var(--aurora-danger)',
            borderColor: 'var(--aurora-danger)',
            background: 'var(--aurora-danger-bg, #fef2f2)',
          }}
        >
          {error}
        </div>
      )}
      {mode === 'edit' && (
        <p className="mb-3 text-sm text-slate-500">
          Financial values are controlled by loan events. Only descriptive details can be edited
          here.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormInput
          label="Lender Name"
          required
          value={form.lenderName}
          onChange={(e) => setField('lenderName', e.target.value)}
        />
        <FormInput
          label="Lender Type"
          placeholder="e.g. Bank, SACCO, Director"
          value={form.lenderType}
          onChange={(e) => setField('lenderType', e.target.value)}
        />
        <FormInput
          label="Lender Contact"
          value={form.lenderContact}
          onChange={(e) => setField('lenderContact', e.target.value)}
        />
        <FormInput
          label="Loan Reference"
          value={form.loanReference}
          onChange={(e) => setField('loanReference', e.target.value)}
        />

        <FormSelect
          label="Obligation Type"
          disabled={mode === 'edit'}
          value={form.obligationType}
          onChange={(e) => setField('obligationType', e.target.value)}
        >
          {LOAN_TYPES.filter((t) => !['INTER_COMPANY_LOAN', 'SUPPLIER_CREDIT'].includes(t)).map(
            (t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ),
          )}
        </FormSelect>
        <FormSelect
          label="Borrower Level"
          disabled={mode === 'edit'}
          value={form.borrowerLevel}
          onChange={(e) => setField('borrowerLevel', e.target.value)}
        >
          {BORROWER_LEVELS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </FormSelect>

        <div className="col-span-2">
          <ScopeSelector
            value={{
              companyId: form.companyId,
              divisionId: form.divisionId,
              branchId: form.branchId,
            }}
            disabled={mode === 'edit'}
            onChange={(scope) => {
              setForm((f) => ({ ...f, ...scope }));
              setAck(false);
              setFunding({ ...emptyFunding, fundingMode: funding.fundingMode });
            }}
          />
        </div>
        <FormSelect
          label="Currency"
          disabled={mode === 'edit'}
          value={form.currency}
          onChange={(e) => setField('currency', e.target.value)}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </FormSelect>

        <FormInput
          label="Principal Amount"
          disabled={mode === 'edit'}
          required={mode === 'create'}
          type="number"
          step="0.01"
          value={form.principalAmount}
          onChange={(e) => setField('principalAmount', e.target.value)}
        />
        <FormInput
          label="Outstanding Balance"
          disabled={mode === 'edit' || funding.fundingMode === 'NEW'}
          required={mode === 'create'}
          type="number"
          step="0.01"
          value={
            funding.fundingMode === 'NEW' && mode === 'create'
              ? form.principalAmount
              : form.outstandingBalance
          }
          onChange={(e) => setField('outstandingBalance', e.target.value)}
        />

        <FormInput
          label="Annual Interest Rate"
          disabled={mode === 'edit'}
          required={mode === 'create'}
          type="number"
          step="0.0001"
          hint="0.18 = 18%"
          value={form.interestRate}
          onChange={(e) => setField('interestRate', e.target.value)}
        />
        <FormSelect
          label="Repayment Frequency"
          disabled={mode === 'edit'}
          value={form.repaymentFrequency}
          onChange={(e) => setField('repaymentFrequency', e.target.value)}
        >
          {REPAYMENT_FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {f.replace(/_/g, ' ')}
            </option>
          ))}
        </FormSelect>

        <FormDateField
          label="Disbursement Date"
          disabled={mode === 'edit'}
          required={mode === 'create'}
          value={form.disbursementDate}
          onChange={(value) => setField('disbursementDate', value)}
        />
        <FormDateField
          label="Maturity Date"
          disabled={mode === 'edit'}
          required={mode === 'create'}
          value={form.maturityDate}
          onChange={(value) => setField('maturityDate', value)}
        />

        <FormInput
          label="Scheduled Repayment Amount"
          disabled={mode === 'edit'}
          type="number"
          step="0.01"
          value={form.repaymentAmount}
          onChange={(e) => setField('repaymentAmount', e.target.value)}
        />
        <FormInput
          label="Purpose"
          value={form.purpose}
          onChange={(e) => setField('purpose', e.target.value)}
        />

        <FormSelect
          label="Status"
          disabled
          value={form.status}
          onChange={(e) => setField('status', e.target.value)}
        >
          {LOAN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Risk Level"
          value={form.riskLevel}
          onChange={(e) => setField('riskLevel', e.target.value)}
        >
          {RISK_LEVELS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </FormSelect>

        <div className="col-span-2">
          <FormTextarea
            label="Collateral Description"
            rows={2}
            value={form.collateralDescription}
            onChange={(e) => setField('collateralDescription', e.target.value)}
          />
        </div>
        {mode === 'create' && (
          <LoanFundingFields
            companyId={form.companyId}
            currency={form.currency}
            value={funding}
            onChange={(value) => {
              setFunding(value);
              setAck(false);
            }}
          />
        )}
        {mode === 'create' && (
          <label className="col-span-2 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I have
            checked the accounts and confirmed this borrowing or opening balance has not already
            been recorded.
          </label>
        )}
        <div className="col-span-2">
          <FormTextarea
            label="Notes"
            rows={2}
            value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

// ─── Debt Modal ───────────────────────────────────────────────────────────────

function DebtModal({
  mode,
  initial,
  companies,
  onClose,
  onSaved,
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
  const draft = useFormGuard(form);
  const close = () => {
    if (!saving) draft.requestClose(onClose);
  };
  const setField = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (mode === 'create') {
      if (
        !form.companyId ||
        !form.creditorName.trim() ||
        !form.description.trim() ||
        !form.amount
      ) {
        setError('Company, creditor, description and amount are required');
        return;
      }
    }
    setSaving(true);
    setError('');
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
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const message =
          (Array.isArray(j?.message) && j.message.join(', ')) || j?.message || `HTTP ${res.status}`;
        throw new Error(message);
      }
      draft.markSaved();
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onChangeCapture={draft.touch}
      onClose={close}
      title={mode === 'create' ? 'New Trade Debt / Payable' : 'Edit Debt'}
      subtitle="Amount owed to a creditor (trade payable, accrual, statutory obligation, etc.)."
      size="lg"
      footer={
        <>
          <Btn variant="secondary" onClick={close}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={saving}>
            {mode === 'create' ? 'Create' : 'Save'}
          </Btn>
        </>
      }
    >
      {error && (
        <div
          className="mb-3 text-sm rounded-lg px-3 py-2 border"
          style={{
            color: 'var(--aurora-danger)',
            borderColor: 'var(--aurora-danger)',
            background: 'var(--aurora-danger-bg, #fef2f2)',
          }}
        >
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormSelect
          label="Company"
          required
          value={form.companyId}
          onChange={(e) => setField('companyId', e.target.value)}
          placeholder="— Select —"
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Currency"
          value={form.currency}
          onChange={(e) => setField('currency', e.target.value)}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </FormSelect>

        <FormInput
          label="Creditor Name"
          required
          value={form.creditorName}
          onChange={(e) => setField('creditorName', e.target.value)}
        />
        <FormInput
          label="Creditor Contact"
          value={form.creditorContact}
          onChange={(e) => setField('creditorContact', e.target.value)}
        />

        <div className="col-span-2">
          <FormInput
            label="Description"
            required
            value={form.description}
            onChange={(e) => setField('description', e.target.value)}
          />
        </div>

        <FormInput
          label="Invoice Number"
          value={form.invoiceNumber}
          onChange={(e) => setField('invoiceNumber', e.target.value)}
        />
        <FormDateField
          label="Due Date"
          value={form.dueDate}
          onChange={(value) => setField('dueDate', value)}
        />

        <FormInput
          label="Amount"
          required={mode === 'create'}
          type="number"
          step="0.01"
          value={form.amount}
          onChange={(e) => setField('amount', e.target.value)}
        />
        <FormInput
          label="Amount Paid"
          type="number"
          step="0.01"
          value={form.amountPaid}
          onChange={(e) => setField('amountPaid', e.target.value)}
        />

        <FormSelect
          label="Status"
          value={form.status}
          onChange={(e) => setField('status', e.target.value)}
        >
          {DEBT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Risk Level"
          value={form.riskLevel}
          onChange={(e) => setField('riskLevel', e.target.value)}
        >
          {RISK_LEVELS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </FormSelect>

        <div className="col-span-2">
          <FormTextarea
            label="Notes"
            rows={2}
            value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

// ─── Delete Confirm (shared) ──────────────────────────────────────────────────

function DeleteConfirm({
  kind,
  label,
  id,
  onClose,
  onConfirmed,
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
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/backend/${kind}/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message ?? 'Delete failed');
      }
      onConfirmed();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Delete ${kind === 'loans' ? 'loan' : 'debt'}?`}
      size="sm"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="danger" onClick={handleDelete} loading={saving}>
            Delete
          </Btn>
        </>
      }
    >
      {error && (
        <div
          role="alert"
          className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2"
        >
          {error}
        </div>
      )}
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>
        Soft-delete <strong>{label}</strong>? The record stays in the database for audit but is
        hidden from lists.
      </p>
    </Modal>
  );
}

export default function LoansDebtsPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const readLoans = hasPermission('loans.read');
  const readDebts = hasPermission('debts.read');
  const [tab, setTab] = useState<'loans' | 'debts'>(readLoans ? 'loans' : 'debts');
  const [search, setSearch] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterRisk, setFilterRisk] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const inspector = useRef<HTMLHeadingElement>(null);
  const selectionTrigger = useRef<HTMLButtonElement | null>(null);
  const [creatingLoan, setCreatingLoan] = useState(false);
  const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
  const [deletingLoan, setDeletingLoan] = useState<Loan | null>(null);
  const [creatingDebt, setCreatingDebt] = useState(false);
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null);
  const [deletingDebt, setDeletingDebt] = useState<Debt | null>(null);
  const companies = useWorkspaceChoices<Company>('/companies', {}, readLoans || readDebts);
  const query = {
    page,
    limit: 15,
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(filterCompany ? { companyId: filterCompany } : {}),
    ...(filterStatus ? { status: filterStatus } : {}),
    ...(filterRisk ? { riskLevel: filterRisk } : {}),
    ...(tab === 'loans' && filterType ? { obligationType: filterType } : {}),
  };
  const records = useWorkspaceResource<Paginated<Loan | Debt>>(
    `/${tab}`,
    query,
    tab === 'loans' ? readLoans : readDebts,
  );
  const loanSummary = useWorkspaceResource<LoanSummary>('/loans/summary', {}, readLoans);
  const debtSummary = useWorkspaceResource<DebtSummary>('/debts/summary', {}, readDebts);
  const rows = records.data?.data ?? [];
  const selected = rows.find((row) => row.id === selectedId);
  const loan = selected && tab === 'loans' ? (selected as Loan) : null;
  const debt = selected && tab === 'debts' ? (selected as Debt) : null;
  const canCreate = hasPermission(`${tab}.create`);
  const canEdit = hasPermission(`${tab}.update`);
  const canDelete = hasPermission(`${tab}.delete`);
  const activeFilters = [filterCompany, filterType, filterStatus, filterRisk].filter(
    Boolean,
  ).length;
  function changeFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
    setSelectedId(null);
  }
  function reset() {
    setSearch('');
    setFilterCompany('');
    setFilterType('');
    setFilterStatus('');
    setFilterRisk('');
    setPage(1);
    setSelectedId(null);
  }
  function closeDetails() {
    setSelectedId(null);
    requestAnimationFrame(() => selectionTrigger.current?.focus());
  }
  function refresh() {
    records.reload();
    loanSummary.reload();
    debtSummary.reload();
  }
  function saved() {
    refresh();
    showToast('success', 'Record saved');
  }
  function select(row: Loan | Debt, trigger: HTMLButtonElement) {
    selectionTrigger.current = trigger;
    setSelectedId(row.id);
    requestAnimationFrame(() => inspector.current?.focus());
  }
  if (authLoading)
    return (
      <div className="business-workspace">
        <PageHeader title="Loans & Debts" subtitle="Loading" />
      </div>
    );
  if (!readLoans && !readDebts)
    return (
      <div className="business-workspace">
        <PageHeader title="Loans & Debts" />
        <PermissionDeniedState />
      </div>
    );
  const description =
    tab === 'loans'
      ? 'Borrowing, balances and the next repayment, together.'
      : 'Track creditors, due dates and outstanding trade obligations.';
  return (
    <div className="business-workspace obligations-workspace">
      <PageHeader
        title="Loans & Debts"
        subtitle={description}
        actions={
          <>
            {hasPermission('loan_schedules.list') && (
              <Link className="os-workspace-link" href="/accounting-engine/loan-repayments">
                Repayment schedules
              </Link>
            )}
            {canCreate && (
              <Btn
                onClick={() => (tab === 'loans' ? setCreatingLoan(true) : setCreatingDebt(true))}
              >
                + New {tab === 'loans' ? 'loan' : 'debt'}
              </Btn>
            )}
          </>
        }
      />
      <p className="text-xs mb-3" style={{ color: 'var(--aurora-text-muted)' }}>
        Overview · all accessible companies
      </p>
      <div className="workspace-summary" aria-label="Obligation overview">
        {readLoans && tab === 'loans' && (
          <>
            <div>
              <span>Active loans</span>
              <strong>{loanSummary.data?.activeCount ?? '—'}</strong>
            </div>
            <div>
              <span>High-risk loans</span>
              <strong>{loanSummary.data?.highRiskCount ?? '—'}</strong>
            </div>
            <div>
              <span>Maturing within 90 days</span>
              <strong>{loanSummary.data?.upcomingMaturity ?? '—'}</strong>
            </div>
          </>
        )}
        {readDebts && tab === 'debts' && (
          <>
            <div>
              <span>Outstanding debts</span>
              <strong>{debtSummary.data?.outstandingCount ?? '—'}</strong>
            </div>
            <div>
              <span>Overdue debts</span>
              <strong>{debtSummary.data?.overdueCount ?? '—'}</strong>
            </div>
          </>
        )}
      </div>
      {(loanSummary.error || debtSummary.error) && (
        <div role="alert" className="workspace-error my-4">
          Summary unavailable. <button onClick={refresh}>Try again</button>
        </div>
      )}
      <details className="obligation-exposure">
        <summary>Exposure and company breakdown</summary>
        <p>
          All accessible companies. These recorded amounts are summed without currency conversion;
          individual records show their currency.
        </p>
        <dl>
          {readLoans && (
            <>
              <div>
                <dt>Outstanding loans</dt>
                <dd>{loanSummary.data ? fmt(loanSummary.data.totalOutstandingBalance) : '—'}</dd>
              </div>
              <div>
                <dt>Monthly scheduled repayments</dt>
                <dd>{loanSummary.data ? fmt(loanSummary.data.monthlyRepaymentBurden) : '—'}</dd>
              </div>
            </>
          )}
          {readDebts && (
            <div>
              <dt>Outstanding trade debts</dt>
              <dd>{debtSummary.data ? fmt(debtSummary.data.totalOutstandingAmount) : '—'}</dd>
            </div>
          )}
        </dl>
        {!!loanSummary.data?.byCompany?.length && (
          <ul>
            {loanSummary.data.byCompany.map((company) => (
              <li key={company.companyId ?? 'group'}>
                <span>
                  {company.companyName} · {company.count} loans
                </span>
                <strong>{fmt(company.totalOutstanding ?? 0)}</strong>
              </li>
            ))}
          </ul>
        )}
      </details>
      <div className="os-section-tabs my-5" role="group" aria-label="Obligation type">
        {readLoans && (
          <button
            aria-pressed={tab === 'loans'}
            onClick={() => {
              setTab('loans');
              reset();
            }}
          >
            Loans
          </button>
        )}
        {readDebts && (
          <button
            aria-pressed={tab === 'debts'}
            onClick={() => {
              setTab('debts');
              reset();
            }}
          >
            Trade debts & payables
          </button>
        )}
      </div>
      <PageToolbar
        search={search}
        onSearch={(value) => changeFilter(setSearch, value)}
        searchPlaceholder={
          tab === 'loans' ? 'Search lender or reference' : 'Search creditor or invoice'
        }
        collapsibleFilters
        activeFilterCount={activeFilters}
        actions={
          <>
            <Btn variant="secondary" onClick={refresh} disabled={records.loading}>
              Refresh
            </Btn>
            {(activeFilters > 0 || search) && (
              <Btn variant="ghost" onClick={reset}>
                Reset
              </Btn>
            )}
          </>
        }
        filters={
          <>
            <FormSelect
              label="Company"
              value={filterCompany}
              onChange={(e) => changeFilter(setFilterCompany, e.target.value)}
            >
              <option value="">All companies</option>
              {companies.rows.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </FormSelect>
            {tab === 'loans' && (
              <FormSelect
                label="Loan type"
                value={filterType}
                onChange={(e) => changeFilter(setFilterType, e.target.value)}
              >
                <option value="">All types</option>
                {LOAN_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {value.replace(/_/g, ' ')}
                  </option>
                ))}
              </FormSelect>
            )}
            <FormSelect
              label="Status"
              value={filterStatus}
              onChange={(e) => changeFilter(setFilterStatus, e.target.value)}
            >
              <option value="">All statuses</option>
              {(tab === 'loans' ? LOAN_STATUSES : DEBT_STATUSES).map((value) => (
                <option key={value} value={value}>
                  {value.replace(/_/g, ' ')}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              label="Risk"
              value={filterRisk}
              onChange={(e) => changeFilter(setFilterRisk, e.target.value)}
            >
              <option value="">All risks</option>
              {RISK_LEVELS.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </FormSelect>
            {companies.error && (
              <div role="alert">
                {companies.error} <button onClick={companies.retry}>Retry companies</button>
              </div>
            )}
          </>
        }
      />
      <div className={`record-browser ${selected ? 'record-selected' : ''}`}>
        <section
          className="record-list"
          aria-label={tab === 'loans' ? 'Loan register' : 'Debt register'}
          aria-busy={records.loading}
        >
          <div className="record-list-heading">
            <span>{tab === 'loans' ? 'Loan register' : 'Trade obligations'}</span>
            <span aria-live="polite">
              {records.loading ? 'Loading…' : `${records.data?.total ?? 0} records`}
            </span>
          </div>
          {records.error ? (
            <ErrorState message={records.error} onRetry={records.reload} />
          ) : records.loading ? (
            <PageSpinner />
          ) : rows.length === 0 ? (
            <EmptyState
              title={search || activeFilters ? 'No matching obligations' : `No ${tab} recorded`}
              description={
                search || activeFilters
                  ? 'Try another search or clear your filters.'
                  : 'Add an obligation to keep its balance, due dates and history in one place.'
              }
              action={
                search || activeFilters ? (
                  <Btn variant="secondary" onClick={reset}>
                    Clear filters
                  </Btn>
                ) : canCreate ? (
                  <Btn
                    onClick={() =>
                      tab === 'loans' ? setCreatingLoan(true) : setCreatingDebt(true)
                    }
                  >
                    Add {tab === 'loans' ? 'a loan' : 'a debt'}
                  </Btn>
                ) : undefined
              }
            />
          ) : (
            <ul className="obligation-list">
              {rows.map((row) => {
                const itemLoan = tab === 'loans' ? (row as Loan) : null;
                const itemDebt = tab === 'debts' ? (row as Debt) : null;
                const name = itemLoan?.lenderName ?? itemDebt?.creditorName ?? '';
                const due = itemLoan?.maturityDate ?? itemDebt?.dueDate;
                const amount =
                  itemLoan?.outstandingBalance ??
                  Number(itemDebt?.amount ?? 0) - Number(itemDebt?.amountPaid ?? 0);
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      aria-pressed={selectedId === row.id}
                      aria-label={`Review ${name}`}
                      onClick={(event) => select(row, event.currentTarget)}
                    >
                      <div className="obligation-identity">
                        <strong>{name}</strong>
                        <span>
                          {itemLoan?.loanReference ??
                            itemDebt?.invoiceNumber ??
                            row.company?.name ??
                            'Group obligation'}
                        </span>
                        <small>
                          {row.company?.name ?? 'Group'} ·{' '}
                          {due ? `Due ${fmtDate(due)}` : 'No due date'}
                        </small>
                      </div>
                      <div className="obligation-balance">
                        <strong>
                          {row.currency} {fmt(amount)}
                        </strong>
                        <span>Outstanding</span>
                        <StatusBadge value={row.status} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {!!records.data && (
            <div className="record-pagination">
              <span>
                Page {records.data.page} of {Math.max(1, records.data.totalPages)}
              </span>
              <button
                disabled={page <= 1 || records.loading}
                onClick={() => {
                  setPage(page - 1);
                  setSelectedId(null);
                }}
              >
                Previous
              </button>
              <button
                disabled={page >= records.data.totalPages || records.loading}
                onClick={() => {
                  setPage(page + 1);
                  setSelectedId(null);
                }}
              >
                Next
              </button>
            </div>
          )}
        </section>
        <aside className="record-inspector" aria-label="Obligation details">
          {selected ? (
            <>
              <header>
                <span className="text-xs">{loan ? 'Loan overview' : 'Debt overview'}</span>
                <button type="button" onClick={closeDetails}>
                  Back to list
                </button>
              </header>
              <h2 tabIndex={-1} ref={inspector}>
                {loan?.lenderName ?? debt?.creditorName}
              </h2>
              <p className="record-reference">
                {loan?.loanReference ??
                  debt?.invoiceNumber ??
                  selected.company?.name ??
                  'Group obligation'}
              </p>
              <StatusBadge value={selected.status} />
              <dl>
                <div>
                  <dt>Company</dt>
                  <dd>{selected.company?.name ?? 'Group'}</dd>
                </div>
                <div>
                  <dt>Outstanding balance</dt>
                  <dd className="obligation-detail-amount">
                    {selected.currency}{' '}
                    {fmt(
                      loan?.outstandingBalance ??
                        Number(debt?.amount ?? 0) - Number(debt?.amountPaid ?? 0),
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{loan ? 'Principal' : 'Original amount'}</dt>
                  <dd>
                    {selected.currency} {fmt(loan?.principalAmount ?? debt?.amount ?? 0)}
                  </dd>
                </div>
                {loan ? (
                  <>
                    <div>
                      <dt>Loan type</dt>
                      <dd>{loan.obligationType.replace(/_/g, ' ')}</dd>
                    </div>
                    <div>
                      <dt>Interest rate</dt>
                      <dd>{(Number(loan.interestRate) * 100).toFixed(2)}%</dd>
                    </div>
                    <div>
                      <dt>Repayment frequency</dt>
                      <dd>{loan.repaymentFrequency.replace(/_/g, ' ')}</dd>
                    </div>
                    <div>
                      <dt>Maturity</dt>
                      <dd>{fmtDate(loan.maturityDate)}</dd>
                    </div>
                    {loan.collateralDescription && (
                      <div>
                        <dt>Collateral</dt>
                        <dd>{loan.collateralDescription}</dd>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div>
                      <dt>Amount paid</dt>
                      <dd>
                        {selected.currency} {fmt(debt?.amountPaid ?? 0)}
                      </dd>
                    </div>
                    <div>
                      <dt>Due date</dt>
                      <dd>{fmtDate(debt?.dueDate)}</dd>
                    </div>
                    <div>
                      <dt>Description</dt>
                      <dd>{debt?.description}</dd>
                    </div>
                  </>
                )}
                <div>
                  <dt>Risk level</dt>
                  <dd>
                    <StatusBadge value={selected.riskLevel} />
                  </dd>
                </div>
              </dl>
              <div className="record-actions">
                {loan && (
                  <Link href={`/group-control/loans-debts/loans/${loan.id}`}>
                    Open loan & payment history
                  </Link>
                )}
                {canEdit && (
                  <Btn
                    variant="secondary"
                    onClick={() => (loan ? setEditingLoan(loan) : setEditingDebt(debt))}
                  >
                    Edit details
                  </Btn>
                )}
                {canDelete && (
                  <Btn
                    variant="ghost"
                    onClick={() => (loan ? setDeletingLoan(loan) : setDeletingDebt(debt))}
                  >
                    Delete {loan ? 'loan' : 'debt'}
                  </Btn>
                )}
              </div>
            </>
          ) : (
            <div className="record-empty">
              <h2>Your obligations, in focus</h2>
              <p>Select a record to review its balance, dates and available actions.</p>
            </div>
          )}
        </aside>
      </div>
      {creatingLoan && (
        <LoanModal
          mode="create"
          companies={companies.rows}
          onClose={() => setCreatingLoan(false)}
          onSaved={() => {
            setCreatingLoan(false);
            saved();
          }}
        />
      )}
      {editingLoan && (
        <LoanModal
          mode="edit"
          initial={editingLoan}
          companies={companies.rows}
          onClose={() => setEditingLoan(null)}
          onSaved={() => {
            setEditingLoan(null);
            saved();
          }}
        />
      )}
      {deletingLoan && (
        <DeleteConfirm
          kind="loans"
          label={deletingLoan.lenderName}
          id={deletingLoan.id}
          onClose={() => setDeletingLoan(null)}
          onConfirmed={() => {
            setDeletingLoan(null);
            setSelectedId(null);
            refresh();
            showToast('success', 'Loan deleted');
          }}
        />
      )}
      {creatingDebt && (
        <DebtModal
          mode="create"
          companies={companies.rows}
          onClose={() => setCreatingDebt(false)}
          onSaved={() => {
            setCreatingDebt(false);
            saved();
          }}
        />
      )}
      {editingDebt && (
        <DebtModal
          mode="edit"
          initial={editingDebt}
          companies={companies.rows}
          onClose={() => setEditingDebt(null)}
          onSaved={() => {
            setEditingDebt(null);
            saved();
          }}
        />
      )}
      {deletingDebt && (
        <DeleteConfirm
          kind="debts"
          label={deletingDebt.creditorName}
          id={deletingDebt.id}
          onClose={() => setDeletingDebt(null)}
          onConfirmed={() => {
            setDeletingDebt(null);
            setSelectedId(null);
            refresh();
            showToast('success', 'Debt deleted');
          }}
        />
      )}
    </div>
  );
}
