'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Btn,
  Card,
  EmptyState,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
  PageHeader,
  SkeletonTable,
  StatCard,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import {
  BACKEND_PROXY_URL,
  backendDelete,
  backendGet,
  backendList,
  backendPage,
  backendPatch,
  backendPost,
  buildQuery,
  type PaginatedResult,
} from '@/lib/api-client';
import { cellToString, downloadTextFile, rowsToCsv } from '@/lib/report-export';
import { downloadTablePdf } from '@/lib/export-download';

type Tab = 'dashboard' | 'daily-sales' | 'expenses' | 'categories';
type Status = 'DRAFT' | 'FINALIZED' | 'VOIDED';
type Currency = 'TZS' | 'USD' | 'EUR' | 'GBP' | 'KES' | 'UGX';
type ReceiptType = 'CASH' | 'MPESA' | 'LIPA_NAMBA' | 'BANK' | 'CARD' | 'OTHER';
type PaymentMethod = 'CASH' | 'MPESA' | 'LIPA_NAMBA' | 'BANK' | 'CARD' | 'OTHER';

interface Company {
  id: string;
  name: string;
  code: string;
}

interface Division {
  id: string;
  companyId: string;
  name: string;
  code: string;
}

interface Branch {
  id: string;
  divisionId: string;
  name: string;
  code: string;
}

interface Category {
  id: string;
  companyId: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  company?: Company;
  _count?: { expenses: number };
}

interface Receipt {
  id?: string;
  receiptType: ReceiptType;
  label?: string | null;
  amount: number;
  reference?: string | null;
  notes?: string | null;
}

interface DailySale {
  id: string;
  companyId: string;
  divisionId?: string | null;
  branchId?: string | null;
  recordDate: string;
  currency: Currency;
  totalSalesAmount: number;
  status: Status;
  notes?: string | null;
  receipts: Receipt[];
  company?: Company;
  division?: Division | null;
  branch?: Branch | null;
}

interface RecordExpense {
  id: string;
  companyId: string;
  divisionId?: string | null;
  branchId?: string | null;
  expenseCategoryId: string;
  recordDate: string;
  currency: Currency;
  amount: number;
  description: string;
  paidTo?: string | null;
  paymentMethod: PaymentMethod;
  paymentLabel?: string | null;
  reference?: string | null;
  status: Status;
  notes?: string | null;
  company?: Company;
  division?: Division | null;
  branch?: Branch | null;
  expenseCategory?: { id: string; name: string };
}

interface Summary {
  totalRecordedSales: number;
  cashTotal: number;
  mobileMoneyTotal: number;
  bankTotal: number;
  cardTotal: number;
  otherReceiptTotal: number;
  expensesTotal: number;
  netMovement: number;
  draftRecords: number;
  salesCount: number;
  expenseCount: number;
}

interface Filters {
  companyId: string;
  divisionId: string;
  branchId: string;
  dateFrom: string;
  dateTo: string;
  status: string;
  search: string;
}

const today = new Date().toISOString().slice(0, 10);

const BLANK_FILTERS: Filters = {
  companyId: '',
  divisionId: '',
  branchId: '',
  dateFrom: today,
  dateTo: today,
  status: '',
  search: '',
};

const RECEIPT_LABELS: Record<ReceiptType, string> = {
  CASH: 'Cash',
  MPESA: 'M-Pesa',
  LIPA_NAMBA: 'Lipa Namba',
  BANK: 'Bank',
  CARD: 'Card',
  OTHER: 'Other',
};

const DEFAULT_RECEIPTS: Receipt[] = [
  { receiptType: 'CASH', label: 'Cash', amount: 0 },
  { receiptType: 'MPESA', label: 'M-Pesa', amount: 0 },
  { receiptType: 'LIPA_NAMBA', label: 'Lipa Namba', amount: 0 },
  { receiptType: 'BANK', label: 'CRDB Bank', amount: 0 },
  { receiptType: 'OTHER', label: 'Other', amount: 0 },
];

const PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'MPESA', 'LIPA_NAMBA', 'BANK', 'CARD', 'OTHER'];
const CURRENCIES: Currency[] = ['TZS', 'USD', 'EUR', 'GBP', 'KES', 'UGX'];

function money(value: number | string | null | undefined, currency = 'TZS') {
  const n = Number(value ?? 0);
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateOnly(value: string) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString().slice(0, 10);
}

function statusClass(status: Status) {
  if (status === 'FINALIZED') return 'bg-emerald-900/40 text-emerald-200 border-emerald-700';
  if (status === 'VOIDED') return 'bg-red-900/40 text-red-200 border-red-700';
  return 'bg-amber-900/40 text-amber-200 border-amber-700';
}

function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClass(status)}`}>
      {status}
    </span>
  );
}

function pagePath(tab: Tab) {
  if (tab === 'dashboard') return '/record-book';
  if (tab === 'daily-sales') return '/record-book/daily-sales';
  if (tab === 'expenses') return '/record-book/expenses';
  return '/record-book/categories';
}

function buildFilterQuery(filters: Filters, extras?: Record<string, string | number | undefined>) {
  return {
    companyId: filters.companyId,
    divisionId: filters.divisionId,
    branchId: filters.branchId,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    status: filters.status,
    search: filters.search,
    ...extras,
  };
}

async function downloadBlob(path: string, filename: string) {
  const res = await fetch(`${BACKEND_PROXY_URL}${path}`, { cache: 'no-store' });
  if (!res.ok) {
    let message = `Export failed (${res.status})`;
    try {
      const json = await res.json();
      if (json?.message) message = Array.isArray(json.message) ? json.message.join(', ') : json.message;
    } catch {
      // keep fallback
    }
    throw new Error(message);
  }
  const disposition = res.headers.get('Content-Disposition');
  const match = /filename="?([^"]+)"?/i.exec(disposition ?? '');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match?.[1] ?? filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function SaleModal({
  initial,
  filters,
  companies,
  divisions,
  branches,
  onClose,
  onSaved,
}: {
  initial?: DailySale | null;
  filters: Filters;
  companies: Company[];
  divisions: Division[];
  branches: Branch[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => ({
    companyId: initial?.companyId ?? filters.companyId,
    divisionId: initial?.divisionId ?? filters.divisionId,
    branchId: initial?.branchId ?? filters.branchId,
    recordDate: initial ? dateOnly(initial.recordDate) : today,
    currency: initial?.currency ?? 'TZS',
    totalSalesAmount: String(initial?.totalSalesAmount ?? ''),
    notes: initial?.notes ?? '',
    receipts: initial?.receipts?.length ? initial.receipts : DEFAULT_RECEIPTS,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const scopedDivisions = divisions.filter((d) => !form.companyId || d.companyId === form.companyId);
  const scopedBranches = branches.filter((b) => !form.divisionId || b.divisionId === form.divisionId);
  const receiptTotal = form.receipts.reduce((sum, receipt) => sum + Number(receipt.amount || 0), 0);
  const total = Number(form.totalSalesAmount || 0);
  const difference = total - receiptTotal;
  const canSave = total > 0 && Math.abs(difference) < 0.005 && form.companyId && form.recordDate;

  const setReceipt = (index: number, patch: Partial<Receipt>) => {
    setForm((current) => ({
      ...current,
      receipts: current.receipts.map((receipt, i) => (i === index ? { ...receipt, ...patch } : receipt)),
    }));
  };

  const submit = async () => {
    if (!canSave) {
      setError('Receipt split must equal total sales before saving.');
      return;
    }
    setSaving(true);
    setError('');
    const body = {
      companyId: form.companyId,
      divisionId: form.divisionId || undefined,
      branchId: form.branchId || undefined,
      recordDate: form.recordDate,
      currency: form.currency,
      totalSalesAmount: total,
      notes: form.notes || undefined,
      receipts: form.receipts
        .filter((receipt) => Number(receipt.amount) > 0)
        .map((receipt) => ({
          receiptType: receipt.receiptType,
          label: receipt.label || RECEIPT_LABELS[receipt.receiptType],
          amount: Number(receipt.amount),
          reference: receipt.reference || undefined,
          notes: receipt.notes || undefined,
        })),
    };
    try {
      if (initial) await backendPatch(`/record-book/daily-sales/${initial.id}`, body);
      else await backendPost('/record-book/daily-sales', body);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save daily sales record');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Edit Daily Sales Record' : 'New Daily Sales Record'}
      size="xl"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={submit} loading={saving} disabled={!canSave}>
            Save Draft
          </Btn>
        </>
      }
    >
      {error && <div className="mb-3 rounded-lg border border-red-700 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</div>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <FormSelect label="Company" required value={form.companyId} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value, divisionId: '', branchId: '' }))} placeholder="Select company">
          {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
        </FormSelect>
        <FormSelect label="Division" value={form.divisionId ?? ''} onChange={(e) => setForm((f) => ({ ...f, divisionId: e.target.value, branchId: '' }))} placeholder="All divisions">
          {scopedDivisions.map((division) => <option key={division.id} value={division.id}>{division.code} - {division.name}</option>)}
        </FormSelect>
        <FormSelect label="Branch" value={form.branchId ?? ''} onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))} placeholder="All branches">
          {scopedBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} - {branch.name}</option>)}
        </FormSelect>
        <FormInput label="Record Date" required type="date" value={form.recordDate} onChange={(e) => setForm((f) => ({ ...f, recordDate: e.target.value }))} />
        <FormSelect label="Currency" value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as Currency }))}>
          {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
        </FormSelect>
        <FormInput label="Total Sales" required type="number" min="0" step="0.01" value={form.totalSalesAmount} onChange={(e) => setForm((f) => ({ ...f, totalSalesAmount: e.target.value }))} />
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>Receipt split</h3>
          <span className={`text-sm font-semibold ${Math.abs(difference) < 0.005 ? 'text-emerald-300' : 'text-amber-300'}`}>
            Difference: {money(difference, form.currency)}
          </span>
        </div>
        <div className="space-y-2">
          {form.receipts.map((receipt, index) => (
            <div key={`${receipt.receiptType}-${index}`} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-700/80 p-3 md:grid-cols-4">
              <FormSelect label="Method" value={receipt.receiptType} onChange={(e) => setReceipt(index, { receiptType: e.target.value as ReceiptType })}>
                {Object.keys(RECEIPT_LABELS).map((type) => <option key={type} value={type}>{RECEIPT_LABELS[type as ReceiptType]}</option>)}
              </FormSelect>
              <FormInput label="Label / Account" value={receipt.label ?? ''} onChange={(e) => setReceipt(index, { label: e.target.value })} placeholder="CRDB Bank, M-Pesa, cash drawer" />
              <FormInput label="Amount" type="number" min="0" step="0.01" value={String(receipt.amount ?? 0)} onChange={(e) => setReceipt(index, { amount: Number(e.target.value) })} />
              <FormInput label="Reference" value={receipt.reference ?? ''} onChange={(e) => setReceipt(index, { reference: e.target.value })} />
            </div>
          ))}
        </div>
      </div>

      <FormTextarea className="mt-4" label="Notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
    </Modal>
  );
}

function ExpenseModal({
  initial,
  filters,
  companies,
  divisions,
  branches,
  categories,
  onClose,
  onSaved,
}: {
  initial?: RecordExpense | null;
  filters: Filters;
  companies: Company[];
  divisions: Division[];
  branches: Branch[];
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => ({
    companyId: initial?.companyId ?? filters.companyId,
    divisionId: initial?.divisionId ?? filters.divisionId,
    branchId: initial?.branchId ?? filters.branchId,
    expenseCategoryId: initial?.expenseCategoryId ?? '',
    recordDate: initial ? dateOnly(initial.recordDate) : today,
    currency: initial?.currency ?? 'TZS',
    amount: String(initial?.amount ?? ''),
    description: initial?.description ?? '',
    paidTo: initial?.paidTo ?? '',
    paymentMethod: initial?.paymentMethod ?? 'CASH',
    paymentLabel: initial?.paymentLabel ?? '',
    reference: initial?.reference ?? '',
    notes: initial?.notes ?? '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const scopedDivisions = divisions.filter((d) => !form.companyId || d.companyId === form.companyId);
  const scopedBranches = branches.filter((b) => !form.divisionId || b.divisionId === form.divisionId);
  const scopedCategories = categories.filter((c) => c.isActive && (!form.companyId || c.companyId === form.companyId));
  const canSave = form.companyId && form.expenseCategoryId && form.description.trim() && Number(form.amount) > 0 && form.recordDate;

  const submit = async () => {
    if (!canSave) {
      setError('Company, category, date, description, and amount are required.');
      return;
    }
    setSaving(true);
    setError('');
    const body = {
      companyId: form.companyId,
      divisionId: form.divisionId || undefined,
      branchId: form.branchId || undefined,
      expenseCategoryId: form.expenseCategoryId,
      recordDate: form.recordDate,
      currency: form.currency,
      amount: Number(form.amount),
      description: form.description,
      paidTo: form.paidTo || undefined,
      paymentMethod: form.paymentMethod,
      paymentLabel: form.paymentLabel || undefined,
      reference: form.reference || undefined,
      notes: form.notes || undefined,
    };
    try {
      if (initial) await backendPatch(`/record-book/expenses/${initial.id}`, body);
      else await backendPost('/record-book/expenses', body);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save expense');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Edit Money Out Record' : 'New Money Out Record'}
      size="xl"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={submit} loading={saving} disabled={!canSave}>Save Draft</Btn>
        </>
      }
    >
      {error && <div className="mb-3 rounded-lg border border-red-700 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</div>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <FormSelect label="Company" required value={form.companyId} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value, divisionId: '', branchId: '', expenseCategoryId: '' }))} placeholder="Select company">
          {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
        </FormSelect>
        <FormSelect label="Division" value={form.divisionId ?? ''} onChange={(e) => setForm((f) => ({ ...f, divisionId: e.target.value, branchId: '' }))} placeholder="All divisions">
          {scopedDivisions.map((division) => <option key={division.id} value={division.id}>{division.code} - {division.name}</option>)}
        </FormSelect>
        <FormSelect label="Branch" value={form.branchId ?? ''} onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))} placeholder="All branches">
          {scopedBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} - {branch.name}</option>)}
        </FormSelect>
        <FormInput label="Record Date" required type="date" value={form.recordDate} onChange={(e) => setForm((f) => ({ ...f, recordDate: e.target.value }))} />
        <FormSelect label="Category" required value={form.expenseCategoryId} onChange={(e) => setForm((f) => ({ ...f, expenseCategoryId: e.target.value }))} placeholder="Select category">
          {scopedCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </FormSelect>
        <FormInput label="Amount" required type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
        <FormSelect label="Currency" value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as Currency }))}>
          {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
        </FormSelect>
        <FormSelect label="Payment Method" value={form.paymentMethod} onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value as PaymentMethod }))}>
          {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method.replace('_', ' ')}</option>)}
        </FormSelect>
        <FormInput label="Payment Label" value={form.paymentLabel} onChange={(e) => setForm((f) => ({ ...f, paymentLabel: e.target.value }))} placeholder="Cash, M-Pesa, CRDB Bank" />
        <FormInput label="Paid To" value={form.paidTo} onChange={(e) => setForm((f) => ({ ...f, paidTo: e.target.value }))} />
        <FormInput label="Reference" value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
      </div>
      <FormTextarea className="mt-4" label="Description" required value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      <FormTextarea className="mt-3" label="Notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
    </Modal>
  );
}

function CategoryModal({
  initial,
  filters,
  companies,
  onClose,
  onSaved,
}: {
  initial?: Category | null;
  filters: Filters;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => ({
    companyId: initial?.companyId ?? filters.companyId,
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    isActive: initial?.isActive ?? true,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const canSave = form.companyId && form.name.trim();

  const submit = async () => {
    if (!canSave) {
      setError('Company and category name are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        companyId: form.companyId,
        name: form.name,
        description: form.description || undefined,
        isActive: form.isActive,
      };
      if (initial) await backendPatch(`/record-book/expense-categories/${initial.id}`, body);
      else await backendPost('/record-book/expense-categories', body);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save category');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Edit Records Book Category' : 'New Records Book Category'}
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={submit} loading={saving} disabled={!canSave}>Save Category</Btn>
        </>
      }
    >
      {error && <div className="mb-3 rounded-lg border border-red-700 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</div>}
      <div className="space-y-3">
        <FormSelect label="Company" required value={form.companyId} disabled={Boolean(initial)} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))} placeholder="Select company">
          {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
        </FormSelect>
        <FormInput label="Category Name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <FormTextarea label="Description" value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--aurora-text)' }}>
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
          Active
        </label>
      </div>
    </Modal>
  );
}

export function RecordBookClient({ initialTab }: { initialTab: Tab }) {
  const { hasPermission } = useAuth();
  const canView = hasPermission('record_book.view');
  const canCreate = hasPermission('record_book.create');
  const canUpdate = hasPermission('record_book.update') || canCreate;
  const canFinalize = hasPermission('record_book.finalize');
  const canVoid = hasPermission('record_book.void');
  const canAdmin = hasPermission('record_book.admin');
  const canExport = hasPermission('record_book.export');

  const [filters, setFilters] = useState<Filters>({ ...BLANK_FILTERS });
  const [companies, setCompanies] = useState<Company[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sales, setSales] = useState<PaginatedResult<DailySale> | null>(null);
  const [expenses, setExpenses] = useState<PaginatedResult<RecordExpense> | null>(null);
  const [categoryPage, setCategoryPage] = useState<PaginatedResult<Category> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saleModal, setSaleModal] = useState<DailySale | null | 'new'>(null);
  const [expenseModal, setExpenseModal] = useState<RecordExpense | null | 'new'>(null);
  const [categoryModal, setCategoryModal] = useState<Category | null | 'new'>(null);
  const [exporting, setExporting] = useState('');

  const scopedDivisions = useMemo(
    () => divisions.filter((d) => !filters.companyId || d.companyId === filters.companyId),
    [divisions, filters.companyId],
  );
  const scopedBranches = useMemo(
    () => branches.filter((b) => !filters.divisionId || b.divisionId === filters.divisionId),
    [branches, filters.divisionId],
  );

  const loadRefs = useCallback(async () => {
    const [companyRows, divisionRows, branchRows] = await Promise.all([
      backendList<Company>('/companies', { query: { limit: 1000 } }),
      backendList<Division>('/divisions', { query: { limit: 1000 } }),
      backendList<Branch>('/branches', { query: { limit: 1000 } }),
    ]);
    setCompanies(companyRows);
    setDivisions(divisionRows);
    setBranches(branchRows);
    setFilters((current) => current.companyId || !companyRows[0] ? current : { ...current, companyId: companyRows[0].id });
  }, []);

  const loadData = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const query = buildFilterQuery(filters, { limit: 100 });
      const [summaryData, salesData, expenseData, categoryData] = await Promise.all([
        backendGet<Summary>('/record-book/summary', { query }),
        backendPage<DailySale>('/record-book/daily-sales', { query }),
        backendPage<RecordExpense>('/record-book/expenses', { query }),
        backendPage<Category>('/record-book/expense-categories', {
          query: { companyId: filters.companyId, search: filters.search, limit: 500 },
        }),
      ]);
      setSummary(summaryData);
      setSales(salesData);
      setExpenses(expenseData);
      setCategoryPage(categoryData);
      setCategories(categoryData.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Records Book');
    } finally {
      setLoading(false);
    }
  }, [canView, filters]);

  useEffect(() => {
    loadRefs().catch((err) => setError(err instanceof Error ? err.message : 'Could not load scope data'));
  }, [loadRefs]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const refreshAfterModal = async () => {
    setSaleModal(null);
    setExpenseModal(null);
    setCategoryModal(null);
    await loadData();
  };

  const patchAction = async (path: string, body?: unknown) => {
    await backendPatch(path, body ?? {});
    await loadData();
  };

  const handleVoid = async (path: string) => {
    const reason = window.prompt('Reason for voiding this record');
    if (reason === null) return;
    await patchAction(path, { reason });
  };

  const exportRowsForPdf = async (type: 'sales' | 'expenses' | 'combined') => {
    const query = buildFilterQuery(filters, { type, format: 'json' });
    const payload = await backendGet<{ type: string; rows: Record<string, unknown>[] }>('/record-book/export', { query });
    return payload.rows;
  };

  const handleExport = async (type: 'sales' | 'expenses' | 'combined', format: 'pdf' | 'csv' | 'json' | 'xlsx') => {
    setExporting(`${type}-${format}`);
    setError('');
    try {
      const query = buildFilterQuery(filters, { type, format: format === 'pdf' ? 'json' : format });
      if (format === 'pdf') {
        const rows = await exportRowsForPdf(type);
        if (!rows.length) throw new Error('No rows to export');
        const columns = Array.from(rows.reduce((set, row) => {
          Object.keys(row).forEach((key) => set.add(key));
          return set;
        }, new Set<string>()));
        await downloadTablePdf({
          title: `Records Book - ${type}`,
          subtitle: `${filters.dateFrom || 'All'} to ${filters.dateTo || 'All'}`,
          companyId: filters.companyId || undefined,
          columns,
          rows: rows.map((row) => columns.map((column) => cellToString(row[column]))),
          baseName: `record-book-${type}`,
        });
      } else if (format === 'json') {
        const rows = await exportRowsForPdf(type);
        downloadTextFile(`record-book-${type}-${today}.json`, 'application/json', JSON.stringify(rows, null, 2));
      } else if (format === 'csv') {
        await downloadBlob(`/record-book/export${buildQuery(query)}`, `record-book-${type}.csv`);
      } else {
        await downloadBlob(`/record-book/export${buildQuery(query)}`, `record-book-${type}.xlsx`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting('');
    }
  };

  if (!canView) {
    return (
      <div>
        <PageHeader title="Records Book" subtitle="Manual daily sales and money-out records" />
        <Card><EmptyState title="Permission required" description="You need record_book.view to use Records Book." /></Card>
      </div>
    );
  }

  const activeType = initialTab === 'expenses' ? 'expenses' : initialTab === 'daily-sales' ? 'sales' : 'combined';

  return (
    <div>
      <PageHeader
        title="Records Book"
        subtitle="Manual day-end sales and money-out records. Independent from accounting and operations."
        actions={
          <div className="flex flex-wrap gap-2">
            {canCreate && <Btn variant="secondary" onClick={() => setExpenseModal('new')}>+ Money Out</Btn>}
            {canCreate && <Btn variant="primary" onClick={() => setSaleModal('new')}>+ Daily Sales</Btn>}
          </div>
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {([
          ['dashboard', 'Dashboard'],
          ['daily-sales', 'Daily Sales'],
          ['expenses', 'Money Out'],
          ['categories', 'Categories'],
        ] as Array<[Tab, string]>).map(([tab, label]) => (
          <Link
            key={tab}
            href={pagePath(tab)}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
              initialTab === tab ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <Card className="mb-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <FormSelect label="Company" value={filters.companyId} onChange={(e) => setFilters((f) => ({ ...f, companyId: e.target.value, divisionId: '', branchId: '' }))} placeholder="All companies">
            {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </FormSelect>
          <FormSelect label="Division" value={filters.divisionId} onChange={(e) => setFilters((f) => ({ ...f, divisionId: e.target.value, branchId: '' }))} placeholder="All divisions">
            {scopedDivisions.map((division) => <option key={division.id} value={division.id}>{division.code} - {division.name}</option>)}
          </FormSelect>
          <FormSelect label="Branch" value={filters.branchId} onChange={(e) => setFilters((f) => ({ ...f, branchId: e.target.value }))} placeholder="All branches">
            {scopedBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} - {branch.name}</option>)}
          </FormSelect>
          <FormInput label="From" type="date" value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
          <FormInput label="To" type="date" value={filters.dateTo} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} />
          <FormSelect label="Status" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} placeholder="Active records">
            <option value="DRAFT">Draft</option>
            <option value="FINALIZED">Finalized</option>
            <option value="VOIDED">Voided</option>
          </FormSelect>
        </div>
        <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
          <FormInput className="flex-1" label="Search" value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} placeholder="Receipt label, reference, paid to, description..." />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={() => setFilters((f) => ({ ...f, dateFrom: today, dateTo: today }))}>Today</Btn>
            <Btn variant="secondary" onClick={() => setFilters((f) => ({ ...f, dateFrom: '', dateTo: '' }))}>All Time</Btn>
            <Btn variant="ghost" onClick={() => setFilters({ ...BLANK_FILTERS, companyId: filters.companyId })}>Reset</Btn>
          </div>
        </div>
      </Card>

      {error && <div className="mb-4 rounded-lg border border-red-700 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>}

      <div className="mb-5 flex flex-wrap gap-2">
        {canExport && (['pdf', 'csv', 'json', 'xlsx'] as const).map((format) => (
          <Btn
            key={format}
            variant="secondary"
            size="sm"
            loading={exporting === `${activeType}-${format}`}
            onClick={() => handleExport(activeType as 'sales' | 'expenses' | 'combined', format)}
          >
            Export {format.toUpperCase()}
          </Btn>
        ))}
      </div>

      {loading ? (
        <SkeletonTable rows={6} cols={6} />
      ) : (
        <>
          {(initialTab === 'dashboard' || !summary) && (
            <>
              <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-4">
                <StatCard label="Recorded Sales" value={money(summary?.totalRecordedSales ?? 0)} />
                <StatCard label="Expenses" value={money(summary?.expensesTotal ?? 0)} />
                <StatCard label="Net Movement" value={money(summary?.netMovement ?? 0)} />
                <StatCard label="Draft Records" value={summary?.draftRecords ?? 0} />
              </div>
              <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-4">
                <StatCard label="Cash" value={money(summary?.cashTotal ?? 0)} />
                <StatCard label="Mobile Money" value={money(summary?.mobileMoneyTotal ?? 0)} />
                <StatCard label="Bank" value={money(summary?.bankTotal ?? 0)} />
                <StatCard label="Card / Other" value={money((summary?.cardTotal ?? 0) + (summary?.otherReceiptTotal ?? 0))} />
              </div>
            </>
          )}

          {(initialTab === 'dashboard' || initialTab === 'daily-sales') && (
            <Card className="mb-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold" style={{ color: 'var(--aurora-text)' }}>Daily Sales</h2>
                {canCreate && <Btn size="sm" onClick={() => setSaleModal('new')}>+ Daily Sales</Btn>}
              </div>
              {!sales?.data.length ? (
                <EmptyState title="No daily sales recorded" description="Create a day-end sales summary and split it by cash, M-Pesa, Lipa Namba, bank, or other receipts." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-900/70 text-left text-slate-400">
                      <tr>
                        <th className="px-3 py-3">Date</th>
                        <th className="px-3 py-3">Scope</th>
                        <th className="px-3 py-3 text-right">Total</th>
                        <th className="px-3 py-3">Receipts</th>
                        <th className="px-3 py-3">Status</th>
                        <th className="px-3 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sales.data.map((sale) => (
                        <tr key={sale.id} className="border-b border-slate-800">
                          <td className="px-3 py-3 font-medium">{dateOnly(sale.recordDate)}</td>
                          <td className="px-3 py-3">
                            <div>{sale.company?.name ?? 'Company'}</div>
                            <div className="text-xs text-slate-400">{sale.branch?.name ?? sale.division?.name ?? 'All branches'}</div>
                          </td>
                          <td className="px-3 py-3 text-right font-semibold">{money(sale.totalSalesAmount, sale.currency)}</td>
                          <td className="px-3 py-3 text-xs text-slate-300">
                            {sale.receipts.map((r) => `${r.label || RECEIPT_LABELS[r.receiptType]}: ${money(r.amount, sale.currency)}`).join(' | ')}
                          </td>
                          <td className="px-3 py-3"><StatusPill status={sale.status} /></td>
                          <td className="px-3 py-3">
                            <div className="flex justify-end gap-2">
                              {canUpdate && sale.status === 'DRAFT' && <Btn size="xs" variant="secondary" onClick={() => setSaleModal(sale)}>Edit</Btn>}
                              {canFinalize && sale.status === 'DRAFT' && <Btn size="xs" variant="success" onClick={() => patchAction(`/record-book/daily-sales/${sale.id}/finalize`)}>Finalize</Btn>}
                              {canAdmin && sale.status === 'FINALIZED' && <Btn size="xs" variant="warning" onClick={() => patchAction(`/record-book/daily-sales/${sale.id}/reopen`)}>Reopen</Btn>}
                              {canVoid && sale.status !== 'VOIDED' && <Btn size="xs" variant="danger" onClick={() => handleVoid(`/record-book/daily-sales/${sale.id}/void`)}>Void</Btn>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {(initialTab === 'dashboard' || initialTab === 'expenses') && (
            <Card className="mb-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold" style={{ color: 'var(--aurora-text)' }}>Money Out</h2>
                {canCreate && <Btn size="sm" onClick={() => setExpenseModal('new')}>+ Money Out</Btn>}
              </div>
              {!expenses?.data.length ? (
                <EmptyState title="No money-out records" description="Record food, labour, transport, utilities, and other manual outflows here." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-900/70 text-left text-slate-400">
                      <tr>
                        <th className="px-3 py-3">Date</th>
                        <th className="px-3 py-3">Category</th>
                        <th className="px-3 py-3">Description</th>
                        <th className="px-3 py-3">Paid To</th>
                        <th className="px-3 py-3 text-right">Amount</th>
                        <th className="px-3 py-3">Method</th>
                        <th className="px-3 py-3">Status</th>
                        <th className="px-3 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenses.data.map((expense) => (
                        <tr key={expense.id} className="border-b border-slate-800">
                          <td className="px-3 py-3 font-medium">{dateOnly(expense.recordDate)}</td>
                          <td className="px-3 py-3">{expense.expenseCategory?.name ?? 'Category'}</td>
                          <td className="px-3 py-3">{expense.description}</td>
                          <td className="px-3 py-3">{expense.paidTo || '-'}</td>
                          <td className="px-3 py-3 text-right font-semibold">{money(expense.amount, expense.currency)}</td>
                          <td className="px-3 py-3">{expense.paymentLabel || expense.paymentMethod.replace('_', ' ')}</td>
                          <td className="px-3 py-3"><StatusPill status={expense.status} /></td>
                          <td className="px-3 py-3">
                            <div className="flex justify-end gap-2">
                              {canUpdate && expense.status === 'DRAFT' && <Btn size="xs" variant="secondary" onClick={() => setExpenseModal(expense)}>Edit</Btn>}
                              {canFinalize && expense.status === 'DRAFT' && <Btn size="xs" variant="success" onClick={() => patchAction(`/record-book/expenses/${expense.id}/finalize`)}>Finalize</Btn>}
                              {canAdmin && expense.status === 'FINALIZED' && <Btn size="xs" variant="warning" onClick={() => patchAction(`/record-book/expenses/${expense.id}/reopen`)}>Reopen</Btn>}
                              {canVoid && expense.status !== 'VOIDED' && <Btn size="xs" variant="danger" onClick={() => handleVoid(`/record-book/expenses/${expense.id}/void`)}>Void</Btn>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {initialTab === 'categories' && (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold" style={{ color: 'var(--aurora-text)' }}>Records Book Categories</h2>
                {canCreate && <Btn size="sm" onClick={() => setCategoryModal('new')}>+ Category</Btn>}
              </div>
              {!categoryPage?.data.length ? (
                <EmptyState title="No categories" description="Create manual money-out categories such as Food, Labour, Repairs, or Supplies." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-900/70 text-left text-slate-400">
                      <tr>
                        <th className="px-3 py-3">Name</th>
                        <th className="px-3 py-3">Company</th>
                        <th className="px-3 py-3">Description</th>
                        <th className="px-3 py-3">Records</th>
                        <th className="px-3 py-3">Status</th>
                        <th className="px-3 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryPage.data.map((category) => (
                        <tr key={category.id} className="border-b border-slate-800">
                          <td className="px-3 py-3 font-semibold">{category.name}</td>
                          <td className="px-3 py-3">{category.company?.name ?? '-'}</td>
                          <td className="px-3 py-3">{category.description ?? '-'}</td>
                          <td className="px-3 py-3">{category._count?.expenses ?? 0}</td>
                          <td className="px-3 py-3">{category.isActive ? 'Active' : 'Inactive'}</td>
                          <td className="px-3 py-3">
                            <div className="flex justify-end gap-2">
                              {canUpdate && <Btn size="xs" variant="secondary" onClick={() => setCategoryModal(category)}>Edit</Btn>}
                              {canUpdate && <Btn size="xs" variant="danger" onClick={async () => { await backendDelete(`/record-book/expense-categories/${category.id}`); await loadData(); }}>Delete</Btn>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {saleModal && (
        <SaleModal
          initial={saleModal === 'new' ? null : saleModal}
          filters={filters}
          companies={companies}
          divisions={divisions}
          branches={branches}
          onClose={() => setSaleModal(null)}
          onSaved={refreshAfterModal}
        />
      )}
      {expenseModal && (
        <ExpenseModal
          initial={expenseModal === 'new' ? null : expenseModal}
          filters={filters}
          companies={companies}
          divisions={divisions}
          branches={branches}
          categories={categories}
          onClose={() => setExpenseModal(null)}
          onSaved={refreshAfterModal}
        />
      )}
      {categoryModal && (
        <CategoryModal
          initial={categoryModal === 'new' ? null : categoryModal}
          filters={filters}
          companies={companies}
          onClose={() => setCategoryModal(null)}
          onSaved={refreshAfterModal}
        />
      )}
    </div>
  );
}
