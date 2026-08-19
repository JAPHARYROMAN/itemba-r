'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { downloadTablePdf } from '@/lib/export-download';

interface Company { id: string; name: string; code: string }
interface ExpenseCategory { id: string; name: string }
interface CashAccount {
  id: string;
  accountName: string;
  companyId?: string;
  accountType?: string;
  currency?: string;
  currentBalance?: number;
  division?: { name: string; code: string } | null;
  branch?: { name: string; code: string } | null;
}

interface Expense {
  id: string;
  expenseNumber?: string;
  expenseDate: string;
  vendorName?: string | null;
  description: string;
  amount: number;
  currency: string;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'PAID' | 'VOIDED';
  paymentMethod?: string | null;
  companyId: string;
  expenseCategoryId: string;
  cashAccountId?: string | null;
  company?: { name: string } | null;
  expenseCategory?: { name: string } | null;
  cashAccount?: { id: string; accountName: string } | null;
  createdAt: string;
  updatedAt?: string;
}

interface ExpenseDetail extends Expense {
  divisionId?: string | null;
  branchId?: string | null;
  approvedAt?: string | null;
  paidAt?: string | null;
  rejectedReason?: string | null;
  company?: { id: string; name: string; code: string } | null;
  division?: { id: string; name: string; code: string } | null;
  branch?: { id: string; name: string; code: string } | null;
  expenseCategory?: { id: string; name: string; description?: string | null } | null;
  cashAccount?: {
    id: string;
    accountName: string;
    accountType?: string;
    currency?: string;
    currentBalance?: number;
  } | null;
  createdBy?: { id: string; fullName: string; email?: string } | null;
  approvedBy?: { id: string; fullName: string; email?: string } | null;
  paidBy?: { id: string; fullName: string; email?: string } | null;
  journalEntry?: {
    id: string;
    journalNumber: string;
    transactionDate: string;
    description: string;
    status: string;
    totalDebit: number;
    totalCredit: number;
    postedAt?: string | null;
  } | null;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

interface ExpenseForm {
  companyId: string;
  expenseCategoryId: string;
  amount: number | '';
  currency: string;
  expenseDate: string;
  description: string;
  vendorName: string;
  paymentMethod: string;
  cashAccountId: string;
}

const BLANK_FORM: ExpenseForm = {
  companyId: '', expenseCategoryId: '', amount: '', currency: 'TZS',
  expenseDate: '', description: '', vendorName: '', paymentMethod: '', cashAccountId: '',
};

const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CHEQUE', 'CREDIT_CARD', 'OTHER'];
const CURRENCIES = ['TZS', 'USD', 'EUR', 'KES', 'UGX', 'GBP'];

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fmtMoney(currency: string, amount: number | string) {
  return `${currency} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Number(amount))}`;
}

function RejectDialog({ expense, onClose, onDone }: { expense: Expense; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!reason.trim()) { setError('Rejection reason is required'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/backend/expenses/${expense.id}/reject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Rejection failed'); }
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Reject Expense"
      subtitle={`Rejecting expense ${expense.expenseNumber ?? expense.id.slice(0, 8)}`}
      size="md"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="danger" onClick={handleSubmit} loading={saving}>Reject</Btn></>}
    >
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <FormTextarea label="Rejection Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for rejection…" />
    </Modal>
  );
}

function PayExpenseDialog({
  expense,
  onClose,
  onPaid,
}: {
  expense: Expense;
  onClose: () => void;
  onPaid: () => void;
}) {
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [cashAccountId, setCashAccountId] = useState(expense.cashAccountId ?? '');
  const [paymentMethod, setPaymentMethod] = useState(expense.paymentMethod ?? 'CASH');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/backend/expenses/${expense.id}/payment-options`)
      .then(async (response) => {
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json.message ?? 'Could not load payment accounts');
        return Array.isArray(json.data) ? json.data : [];
      })
      .then((items: CashAccount[]) => {
        if (cancelled) return;
        setAccounts(items);
        setCashAccountId((current) => {
          if (items.some((account) => account.id === current)) return current;
          return items.length === 1 ? items[0].id : '';
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load accounts');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [expense.id]);

  const selectedAccount = accounts.find((account) => account.id === cashAccountId);

  const submit = async () => {
    if (!cashAccountId) {
      setError('Select the cash or bank account used to pay this expense');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/backend/expenses/${expense.id}/pay`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cashAccountId, paymentMethod }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.message ?? 'Expense payment failed');
      onPaid();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Expense payment failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Pay Expense"
      subtitle={`${expense.expenseNumber ?? expense.id.slice(0, 8)} · ${expense.currency} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(expense.amount)}`}
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn
            variant="primary"
            onClick={submit}
            loading={saving}
            disabled={loading || !cashAccountId}
          >
            Confirm Payment
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="space-y-4">
        <FormSelect
          label="Cash / Bank Account"
          required
          value={cashAccountId}
          onChange={(event) => setCashAccountId(event.target.value)}
          placeholder={loading ? 'Loading accounts…' : 'Select account…'}
          disabled={loading}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.accountName} · {account.accountType?.replace(/_/g, ' ')} · {account.currency}
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Payment Method"
          required
          value={paymentMethod}
          onChange={(event) => setPaymentMethod(event.target.value)}
        >
          {PAYMENT_METHODS.map((method) => (
            <option key={method} value={method}>
              {method.replace(/_/g, ' ')}
            </option>
          ))}
        </FormSelect>
        {selectedAccount && (
          <div
            className="rounded-lg border px-3 py-3 text-sm"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <div className="flex items-center justify-between gap-3">
              <span style={{ color: 'var(--aurora-text-muted)' }}>Available balance</span>
              <span className="font-mono font-semibold">
                {selectedAccount.currency}{' '}
                {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(
                  Number(selectedAccount.currentBalance ?? 0),
                )}
              </span>
            </div>
            {(selectedAccount.branch || selectedAccount.division) && (
              <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                {[selectedAccount.division?.name, selectedAccount.branch?.name]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        )}
        {!loading && accounts.length === 0 && !error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
            No active {expense.currency} payment account is configured for this company.{' '}
            <Link
              href={`/finance/cash-accounts?companyId=${encodeURIComponent(expense.companyId)}`}
              className="font-semibold underline"
            >
              Open Cash Accounts
            </Link>
          </div>
        )}
        <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
          Confirming posts the expense journal and deducts the amount from the selected account.
        </p>
      </div>
    </Modal>
  );
}

function DetailField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase" style={{ color: 'var(--aurora-text-muted)' }}>{label}</p>
      <p className="mt-1 break-words text-sm font-medium" style={{ color: 'var(--aurora-text)' }}>{value || '—'}</p>
    </div>
  );
}

function ExpenseDetailDialog({
  expenseId,
  canEdit,
  onClose,
  onEdit,
  onDelete,
}: {
  expenseId: string;
  canEdit: boolean;
  onClose: () => void;
  onEdit: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
}) {
  const [expense, setExpense] = useState<ExpenseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/backend/expenses/${expenseId}`, { cache: 'no-store' })
      .then(async (response) => {
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json.message ?? 'Could not load expense details');
        return json.data as ExpenseDetail;
      })
      .then((detail) => {
        if (!cancelled) setExpense(detail);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load expense details');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [expenseId]);

  const exportPdf = async () => {
    if (!expense) return;
    setExporting(true);
    setError('');
    try {
      await downloadTablePdf({
        title: 'Expense Voucher',
        subtitle: `${expense.company?.name ?? 'Company expense'} · ${fmtDate(expense.expenseDate)}`,
        status: expense.status.replace(/_/g, ' '),
        orientation: 'portrait',
        companyId: expense.companyId,
        columns: ['Field', 'Recorded detail'],
        rows: [
          ['Expense number', expense.expenseNumber ?? expense.id],
          ['Expense date', fmtDate(expense.expenseDate)],
          ['Vendor / payee', expense.vendorName ?? 'Not specified'],
          ['Category', expense.expenseCategory?.name ?? 'Not specified'],
          ['Description', expense.description],
          ['Company', expense.company ? `${expense.company.name} (${expense.company.code})` : '—'],
          ['Division', expense.division ? `${expense.division.name} (${expense.division.code})` : 'All divisions'],
          ['Branch', expense.branch ? `${expense.branch.name} (${expense.branch.code})` : 'All branches'],
          ['Payment method', expense.paymentMethod?.replace(/_/g, ' ') ?? 'Not recorded'],
          ['Cash / bank account', expense.cashAccount?.accountName ?? 'Not paid'],
          ['Journal entry', expense.journalEntry?.journalNumber ?? 'Not posted'],
          ['Created by', expense.createdBy?.fullName ?? '—'],
          ['Created at', fmtDateTime(expense.createdAt)],
          ['Approved by', expense.approvedBy?.fullName ?? '—'],
          ['Approved at', fmtDateTime(expense.approvedAt)],
          ['Paid by', expense.paidBy?.fullName ?? '—'],
          ['Paid at', fmtDateTime(expense.paidAt)],
          ...(expense.rejectedReason ? [['Rejection reason', expense.rejectedReason]] : []),
        ],
        columnWeights: [1, 2.4],
        stripedRows: true,
        sectionTitle: 'Expense details',
        summary: [{ label: 'Amount', value: fmtMoney(expense.currency, expense.amount) }],
        note: 'Generated from the ITEMBA-R expense register. The status above reflects the record at export time.',
        baseName: `expense-${expense.expenseNumber ?? expense.id.slice(0, 8)}`,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not export expense PDF');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Expense Details"
      subtitle={expense?.expenseNumber ?? 'Loading expense record…'}
      size="xl"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Close</Btn>
          {expense?.status === 'DRAFT' && canEdit && (
            <Btn variant="danger" onClick={() => onDelete(expense)}>Delete</Btn>
          )}
          {expense && ['DRAFT', 'PENDING_APPROVAL'].includes(expense.status) && canEdit && (
            <Btn variant="secondary" onClick={() => onEdit(expense)}>Edit</Btn>
          )}
          <Btn variant="primary" onClick={exportPdf} loading={exporting} disabled={!expense}>Export PDF</Btn>
        </>
      }
    >
      {loading ? <PageSpinner /> : error && !expense ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : expense ? (
        <div className="space-y-5">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4" style={{ borderColor: 'var(--aurora-border)' }}>
            <div>
              <p className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>Recorded amount</p>
              <p className="mt-1 text-2xl font-semibold">{fmtMoney(expense.currency, expense.amount)}</p>
            </div>
            <StatusBadge status={expense.status} />
          </div>

          <section>
            <h3 className="mb-3 text-sm font-semibold">Expense</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <DetailField label="Expense number" value={expense.expenseNumber ?? expense.id} />
              <DetailField label="Expense date" value={fmtDate(expense.expenseDate)} />
              <DetailField label="Category" value={expense.expenseCategory?.name} />
              <DetailField label="Vendor / payee" value={expense.vendorName} />
              <div className="sm:col-span-2"><DetailField label="Description" value={expense.description} /></div>
            </div>
          </section>

          <section className="border-t pt-4" style={{ borderColor: 'var(--aurora-border)' }}>
            <h3 className="mb-3 text-sm font-semibold">Scope</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <DetailField label="Company" value={expense.company ? `${expense.company.name} (${expense.company.code})` : null} />
              <DetailField label="Division" value={expense.division ? `${expense.division.name} (${expense.division.code})` : 'All divisions'} />
              <DetailField label="Branch" value={expense.branch ? `${expense.branch.name} (${expense.branch.code})` : 'All branches'} />
            </div>
          </section>

          <section className="border-t pt-4" style={{ borderColor: 'var(--aurora-border)' }}>
            <h3 className="mb-3 text-sm font-semibold">Payment & Accounting</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <DetailField label="Payment method" value={expense.paymentMethod?.replace(/_/g, ' ')} />
              <DetailField label="Payment account" value={expense.cashAccount?.accountName} />
              <DetailField label="Journal entry" value={expense.journalEntry?.journalNumber} />
              <DetailField label="Journal status" value={expense.journalEntry?.status?.replace(/_/g, ' ')} />
            </div>
          </section>

          <section className="border-t pt-4" style={{ borderColor: 'var(--aurora-border)' }}>
            <h3 className="mb-3 text-sm font-semibold">Lifecycle</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <DetailField label="Created by" value={expense.createdBy?.fullName} />
              <DetailField label="Created at" value={fmtDateTime(expense.createdAt)} />
              <DetailField label="Last updated" value={fmtDateTime(expense.updatedAt)} />
              <DetailField label="Approved by" value={expense.approvedBy?.fullName} />
              <DetailField label="Approved at" value={fmtDateTime(expense.approvedAt)} />
              <DetailField label="Paid by / at" value={expense.paidBy ? `${expense.paidBy.fullName} · ${fmtDateTime(expense.paidAt)}` : null} />
              {expense.rejectedReason && <div className="sm:col-span-2 lg:col-span-3"><DetailField label="Rejection reason" value={expense.rejectedReason} /></div>}
            </div>
          </section>
        </div>
      ) : null}
    </Modal>
  );
}

function ExpenseModal({
  mode, initial, companies, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Expense;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ExpenseForm>(() =>
    initial ? {
      companyId: initial.companyId,
      expenseCategoryId: initial.expenseCategoryId,
      amount: initial.amount,
      currency: initial.currency,
      expenseDate: initial.expenseDate.split('T')[0],
      description: initial.description,
      vendorName: initial.vendorName ?? '',
      paymentMethod: initial.paymentMethod ?? '',
      cashAccountId: initial.cashAccountId ?? '',
    } : { ...BLANK_FORM }
  );
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof ExpenseForm, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    fetch('/api/backend/expense-categories?limit=200')
      .then((r) => r.json())
      .then((j) => setCategories(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (form.companyId) {
      fetch(`/api/backend/cash-accounts?companyId=${form.companyId}&isActive=true`)
        .then((r) => r.json())
        .then((j) => setCashAccounts(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    }
  }, [form.companyId]);

  const handleSubmit = async () => {
    if (!form.companyId) { setError('Company is required'); return; }
    if (!form.expenseCategoryId) { setError('Category is required'); return; }
    if (!form.amount || Number(form.amount) <= 0) { setError('Valid amount is required'); return; }
    if (!form.expenseDate) { setError('Expense date is required'); return; }
    if (!form.description.trim()) { setError('Description is required'); return; }
    setSaving(true); setError('');
    try {
      const body = {
        ...form,
        amount: Number(form.amount),
        vendorName: form.vendorName || undefined,
        paymentMethod: form.paymentMethod || undefined,
        cashAccountId: form.cashAccountId || undefined,
      };
      const res = await fetch(
        mode === 'create' ? '/api/backend/expenses' : `/api/backend/expenses/${initial!.id}`,
        { method: mode === 'create' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'Create Expense' : 'Edit Expense'}
      size="xl"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={handleSubmit} loading={saving}>{mode === 'create' ? 'Create' : 'Save Changes'}</Btn></>}
    >
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormSelect label="Company" required disabled={mode === 'edit'} value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="Select company…">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
          </FormSelect>
          <FormSelect label="Category" required value={form.expenseCategoryId} onChange={(e) => set('expenseCategoryId', e.target.value)} placeholder="Select category…">
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FormSelect>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormInput label="Amount" required type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value === '' ? '' : Number(e.target.value))} placeholder="0.00" />
          <FormSelect label="Currency" value={form.currency} onChange={(e) => set('currency', e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </FormSelect>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormInput label="Expense Date" required type="date" value={form.expenseDate} onChange={(e) => set('expenseDate', e.target.value)} />
          <FormInput label="Vendor Name" value={form.vendorName} onChange={(e) => set('vendorName', e.target.value)} placeholder="Supplier / vendor" />
        </div>
        <FormTextarea label="Description" required rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Expense description…" />
        <div className="grid grid-cols-2 gap-3">
          <FormSelect label="Payment Method" value={form.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)} placeholder="Select method…">
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
          </FormSelect>
          <FormSelect label="Cash Account (optional)" value={form.cashAccountId} onChange={(e) => set('cashAccountId', e.target.value)} placeholder="None">
            {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.accountName}</option>)}
          </FormSelect>
        </div>
      </div>
    </Modal>
  );
}

function DeleteConfirm({ expense, onClose, onDeleted }: { expense: Expense; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const confirm = async () => {
    setDeleting(true);
    setError('');
    try {
      const response = await fetch(`/api/backend/expenses/${expense.id}`, { method: 'DELETE' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.message ?? 'Could not delete expense');
      onDeleted();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not delete expense');
    } finally {
      setDeleting(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Delete Expense"
      size="md"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="danger" onClick={confirm} loading={deleting}>Delete</Btn></>}
    >
      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>Delete expense <span className="font-medium">{expense.expenseNumber ?? expense.id.slice(0, 8)}</span>?</p>
      <p className="mt-2 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>Only draft expenses can be deleted. Submitted, approved, and paid records remain in the audit trail.</p>
    </Modal>
  );
}

export default function ExpensesPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [data, setData] = useState<Paginated<Expense> | null>(null);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [rejecting, setRejecting] = useState<Expense | null>(null);
  const [paying, setPaying] = useState<Expense | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  const canView = hasPermission('expenses.view');
  const canCreate = hasPermission('expenses.create');
  const canApprove = hasPermission('expenses.approve');
  const canPay = hasPermission('expenses.pay');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    fetch('/api/backend/expense-categories?limit=200')
      .then((r) => r.json())
      .then((j) => setCategories(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (companyId) params.set('companyId', companyId);
      if (status) params.set('status', status);
      if (categoryId) params.set('expenseCategoryId', categoryId);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const res = await fetch(`/api/backend/expenses?${params}`);
      const json = await res.json();
      setData(json.data ?? null);
    } finally { setLoading(false); }
  }, [canView, page, companyId, status, categoryId, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (id: string, action: string) => {
    setActionMsg(''); setActionLoading(id + action);
    try {
      const res = await fetch(`/api/backend/expenses/${id}/${action}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Action failed'); }
      load();
    } catch (err: unknown) {
      setActionMsg(err instanceof Error ? err.message : 'Action failed');
    } finally { setActionLoading(null); }
  };

  const exportRegisterPdf = async () => {
    setExportingPdf(true);
    setActionMsg('');
    try {
      const params = new URLSearchParams({ page: '1', limit: '5000' });
      if (companyId) params.set('companyId', companyId);
      if (status) params.set('status', status);
      if (categoryId) params.set('expenseCategoryId', categoryId);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const response = await fetch(`/api/backend/expenses?${params}`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.message ?? 'Could not load expenses for export');
      const result = json.data as Paginated<Expense> | undefined;
      const expenses = result?.data ?? [];
      if (!expenses.length) throw new Error('No expenses match the active filters');

      const company = companies.find((item) => item.id === companyId);
      const category = categories.find((item) => item.id === categoryId);
      const filterParts = [
        company?.name ?? 'All companies',
        category?.name ?? 'All categories',
        status ? status.replace(/_/g, ' ') : 'All statuses',
        dateFrom || dateTo ? `${dateFrom || 'Beginning'} to ${dateTo || 'Today'}` : 'All dates',
      ];
      const currencyTotals = new Map<string, number>();
      expenses.forEach((expense) => {
        currencyTotals.set(
          expense.currency,
          (currencyTotals.get(expense.currency) ?? 0) + Number(expense.amount),
        );
      });

      await downloadTablePdf({
        title: 'Expense Register',
        subtitle: filterParts.join(' · '),
        orientation: 'portrait',
        companyId: companyId || undefined,
        columns: ['Expense #', 'Date', 'Vendor', 'Category', 'Amount', 'Status', 'Method', 'Account'],
        rows: expenses.map((expense) => [
          expense.expenseNumber ?? expense.id.slice(0, 8),
          fmtDate(expense.expenseDate),
          expense.vendorName ?? '—',
          expense.expenseCategory?.name ?? '—',
          fmtMoney(expense.currency, expense.amount),
          expense.status.replace(/_/g, ' '),
          expense.paymentMethod?.replace(/_/g, ' ') ?? '—',
          expense.cashAccount?.accountName ?? '—',
        ]),
        numericColumns: [4],
        columnWeights: [1.15, 0.85, 1.2, 1.15, 1.15, 0.9, 1, 1.2],
        stripedRows: true,
        sectionTitle: 'Filtered expenses',
        summary: [
          { label: 'Records', value: String(expenses.length) },
          ...Array.from(currencyTotals, ([currency, total]) => ({
            label: `${currency} total`,
            value: fmtMoney(currency, total),
          })),
        ],
        note: 'This register reflects the active filters and the expense statuses recorded at export time.',
        baseName: 'expense-register',
      });
    } catch (err: unknown) {
      setActionMsg(err instanceof Error ? err.message : 'Could not export expense register');
    } finally {
      setExportingPdf(false);
    }
  };

  const reset = (setter: (v: string) => void) => (v: string) => { setter(v); setPage(1); };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Expenses" subtitle="Manage expenses" />
        <div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div>
      </div>
    );
  }

  const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' } as const;

  return (
    <div className="p-6 space-y-6">
      {creating && <ExpenseModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {viewingId && (
        <ExpenseDetailDialog
          expenseId={viewingId}
          canEdit={canCreate}
          onClose={() => setViewingId(null)}
          onEdit={(expense) => { setViewingId(null); setEditing(expense); }}
          onDelete={(expense) => { setViewingId(null); setDeleting(expense); }}
        />
      )}
      {editing && <ExpenseModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {deleting && <DeleteConfirm expense={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); load(); }} />}
      {rejecting && <RejectDialog expense={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); load(); }} />}
      {paying && <PayExpenseDialog expense={paying} onClose={() => setPaying(null)} onPaid={() => { setPaying(null); load(); }} />}

      <PageHeader title="Expenses" subtitle="Track and manage company expenses" />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatCard label="Total" value={data?.total ?? 0} />
        <StatCard label="Draft" value={data?.data.filter((e) => e.status === 'DRAFT').length ?? 0} />
        <StatCard label="Pending" value={data?.data.filter((e) => e.status === 'PENDING_APPROVAL').length ?? 0} />
        <StatCard label="Approved" value={data?.data.filter((e) => e.status === 'APPROVED').length ?? 0} />
        <StatCard label="Paid" value={data?.data.filter((e) => e.status === 'PAID').length ?? 0} />
      </div>

      {actionMsg && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{actionMsg}</div>}

      <PageToolbar
        filters={
          <>
            <select value={companyId} onChange={(e) => reset(setCompanyId)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={categoryId} onChange={(e) => reset(setCategoryId)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              <option value="DRAFT">Draft</option>
              <option value="PENDING_APPROVAL">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="PAID">Paid</option>
            </select>
            <input type="date" value={dateFrom} onChange={(e) => reset(setDateFrom)(e.target.value)} className={filterSelectCls} style={filterStyle} title="From date" />
            <input type="date" value={dateTo} onChange={(e) => reset(setDateTo)(e.target.value)} className={filterSelectCls} style={filterStyle} title="To date" />
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <Btn variant="secondary" onClick={exportRegisterPdf} loading={exportingPdf}>Export PDF</Btn>
            {canCreate && <Btn variant="primary" onClick={() => setCreating(true)}>+ New Expense</Btn>}
          </div>
        }
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Expense #</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7}><PageSpinner /></td></tr>
              ) : !data?.data.length ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No expenses found</td></tr>
              ) : data.data.map((exp) => (
                <tr key={exp.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{exp.expenseNumber ?? exp.id.slice(0, 8)}</td>
                  <td className="px-4 py-3">{fmtDate(exp.expenseDate)}</td>
                  <td className="px-4 py-3">{exp.vendorName ?? '—'}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{exp.expenseCategory?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-mono">{exp.currency} {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(exp.amount)}</td>
                  <td className="px-4 py-3"><StatusBadge status={exp.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Btn variant="secondary" size="xs" onClick={() => setViewingId(exp.id)}>View</Btn>
                      {exp.status === 'DRAFT' && canCreate && (
                        <>
                          <Btn variant="primary" size="xs" onClick={() => handleAction(exp.id, 'submit')} loading={actionLoading === exp.id + 'submit'}>Submit</Btn>
                          <Btn variant="ghost" size="xs" onClick={() => setEditing(exp)}>Edit</Btn>
                          <Btn variant="danger" size="xs" onClick={() => setDeleting(exp)}>Delete</Btn>
                        </>
                      )}
                      {exp.status === 'PENDING_APPROVAL' && canApprove && (
                        <>
                          <Btn variant="success" size="xs" onClick={() => handleAction(exp.id, 'approve')} loading={actionLoading === exp.id + 'approve'}>Approve</Btn>
                          <Btn variant="danger" size="xs" onClick={() => setRejecting(exp)}>Reject</Btn>
                        </>
                      )}
                      {exp.status === 'PENDING_APPROVAL' && canCreate && (
                        <Btn variant="ghost" size="xs" onClick={() => setEditing(exp)}>Edit</Btn>
                      )}
                      {exp.status === 'APPROVED' && canPay && (
                        <Btn variant="primary" size="xs" onClick={() => setPaying(exp)}>Pay</Btn>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && data.totalPages > 1 && (
          <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--aurora-border)' }}>
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>Page {data.page} of {data.totalPages} · {data.total} total</span>
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
