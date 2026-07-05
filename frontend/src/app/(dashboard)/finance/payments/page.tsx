'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Btn,
  PageHeader,
  PageToolbar,
  StatCard,
  StatusBadge,
  PermissionDeniedState,
  showToast,
} from '@/components/ui';
import { Modal, ConfirmDialog } from '@/components/aurora/overlays';
import {
  ResponsiveDataTable,
  type ResponsiveColumn,
} from '@/components/aurora/data-display/ResponsiveDataTable';
import { FormShell, FormSection, FormInput, FormSelect, FormTextarea, FormActions } from '@/components/aurora/forms';
import { DocumentArtifactButton } from '@/components/documents';
import { useAuth } from '@/hooks/use-auth';
import { backendGet, backendList, backendPage, backendPatch, backendPost } from '@/lib/api-client';

// ─── Types (shapes mirror the customer-payments controller / service includes) ─
//
// Routes consumed (all under the /api/backend proxy):
//   GET   /customer-payments            → { data, total, page, limit, totalPages }
//   GET   /customer-payments/:id        → payment (with allocations[])
//   POST  /customer-payments            → creates payment + allocations + JE
//   PATCH /customer-payments/:id/reverse→ reverses a COMPLETED payment
//   GET   /receivables?customerId=…     → open receivables for allocation targets
//   GET   /cash-accounts/company/:id    → cash/bank accounts (array)
//   GET   /companies, /customers        → filters + pickers

interface Company {
  id: string;
  name: string;
  code?: string | null;
}

interface CustomerOption {
  id: string;
  name: string;
  customerCode?: string | null;
  currentBalance?: number | string | null;
}

interface CashAccount {
  id: string;
  accountName: string;
  accountType?: string | null;
  currency?: string | null;
  isActive?: boolean | null;
}

interface ScopeRef {
  id: string;
  name: string;
  code?: string | null;
}

// A customer's open receivable — the allocation target. Shape mirrors the
// receivables list includeListScope (receivableNumber, amount, paidAmount,
// outstandingAmount, status, dueDate, currency).
interface OpenReceivable {
  id: string;
  receivableNumber?: string | null;
  amount: number | string;
  paidAmount?: number | string | null;
  outstandingAmount: number | string;
  status: string;
  issueDate?: string | null;
  dueDate?: string | null;
  currency?: string | null;
}

interface PaymentAllocation {
  id: string;
  receivableId: string;
  amount: number | string;
  receivable?: {
    id: string;
    receivableNumber?: string | null;
    amount?: number | string | null;
    paidAmount?: number | string | null;
    outstandingAmount?: number | string | null;
    status?: string | null;
  } | null;
}

interface JournalLine {
  id: string;
  description?: string | null;
  debit: number | string;
  credit: number | string;
  account?: { accountCode: string; accountName: string; accountType?: string | null } | null;
}

interface JournalEntry {
  id: string;
  journalNumber: string;
  transactionDate?: string | null;
  description?: string | null;
  status: string;
  totalDebit?: number | string;
  totalCredit?: number | string;
  postedAt?: string | null;
  lines?: JournalLine[];
}

interface CustomerPayment extends Record<string, unknown> {
  id: string;
  paymentNumber: string;
  companyId: string;
  divisionId?: string | null;
  branchId?: string | null;
  customerId: string;
  amount: number | string;
  appliedAmount: number | string;
  unappliedAmount: number | string;
  method?: string | null;
  reference?: string | null;
  paymentDate: string;
  currency: string;
  status: 'COMPLETED' | 'REVERSED';
  cashAccountId?: string | null;
  notes?: string | null;
  reversedAt?: string | null;
  journalEntryId?: string | null;
  reversalJournalEntryId?: string | null;
  createdAt: string;
  updatedAt?: string;
  company?: ScopeRef | null;
  division?: ScopeRef | null;
  branch?: ScopeRef | null;
  customer?: CustomerOption | null;
  cashAccount?: { id: string; accountName: string; accountType?: string | null } | null;
  allocations?: PaymentAllocation[];
  journalEntry?: JournalEntry | null;
}

const CURRENCIES = ['TZS', 'USD', 'EUR', 'GBP', 'KES', 'UGX'];
const STATUSES: Array<CustomerPayment['status']> = ['COMPLETED', 'REVERSED'];

// Mirrors the Prisma PaymentMethodGeneral enum (create DTO `method`).
const PAYMENT_METHODS: Array<{ value: string; label: string }> = [
  { value: 'CASH', label: 'Cash' },
  { value: 'MOBILE_MONEY', label: 'Mobile Money' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'BANK_CARD', label: 'Bank Card' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'OTHER', label: 'Other' },
];

// Statuses a receivable can carry while still being an allocation target
// (matches the backend OPEN_RECEIVABLE_STATUSES).
const OPEN_STATUSES = new Set(['OPEN', 'PARTIALLY_PAID', 'OVERDUE']);

const PAGE_SIZE = 20;

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// Round to 2dp the same way the backend does (Prisma.Decimal.toDecimalPlaces(2)),
// so previewed remaining/unapplied match the persisted values.
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function money(value: number | string | null | undefined, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num(value))}`;
}

function fmtDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB');
}

function methodLabel(method?: string | null) {
  if (!method) return '—';
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
}

function scopeLabel(scope?: ScopeRef | null) {
  if (!scope) return '—';
  return scope.code ? `${scope.code} - ${scope.name}` : scope.name;
}

// ─── Receive & allocate modal ─────────────────────────────────────────────────
//
// The user picks a customer, enters the total received, then distributes it
// across the customer's OPEN receivables. Any remainder becomes an unapplied
// advance/credit-on-account. Client-side math mirrors the backend contract:
//   - each allocation must be > 0 and ≤ that receivable's outstanding
//   - sum(allocations) ≤ amount
//   - unapplied = amount − sum(allocations)

interface AllocationRow {
  receivableId: string;
  amount: number | '';
}

function ReceivePaymentModal({
  companies,
  onClose,
  onSaved,
}: {
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [companyId, setCompanyId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [method, setMethod] = useState('');
  const [cashAccountId, setCashAccountId] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState('TZS');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [openReceivables, setOpenReceivables] = useState<OpenReceivable[]>([]);
  const [loadingReceivables, setLoadingReceivables] = useState(false);
  // receivableId → entered allocation amount
  const [allocations, setAllocations] = useState<Record<string, number | ''>>({});

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Load customers + cash accounts scoped to the selected company.
  useEffect(() => {
    if (!companyId) {
      setCustomers([]);
      setCashAccounts([]);
      return;
    }
    let cancelled = false;
    setCustomerId('');
    setCashAccountId('');
    backendList<CustomerOption>('/customers', { query: { companyId, limit: 500 } })
      .then((rows) => {
        if (!cancelled) setCustomers(rows);
      })
      .catch(() => {
        if (!cancelled) setCustomers([]);
      });
    backendGet<CashAccount[]>(`/cash-accounts/company/${companyId}`)
      .then((rows) => {
        if (!cancelled) setCashAccounts(Array.isArray(rows) ? rows.filter((a) => a.isActive !== false) : []);
      })
      .catch(() => {
        if (!cancelled) setCashAccounts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  // Load the chosen customer's OPEN receivables (allocation targets).
  useEffect(() => {
    if (!companyId || !customerId) {
      setOpenReceivables([]);
      setAllocations({});
      return;
    }
    let cancelled = false;
    setLoadingReceivables(true);
    setAllocations({});
    backendPage<OpenReceivable>('/receivables', {
      query: { companyId, customerId, limit: 500 },
    })
      .then((page) => {
        if (cancelled) return;
        const open = (page.data ?? []).filter((r) => OPEN_STATUSES.has(r.status));
        // Oldest due first — the natural order to settle debts.
        open.sort((a, b) => {
          const da = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
          const db = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
          return da - db;
        });
        setOpenReceivables(open);
      })
      .catch(() => {
        if (!cancelled) setOpenReceivables([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingReceivables(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, customerId]);

  const activeAllocations: AllocationRow[] = useMemo(
    () =>
      Object.entries(allocations)
        .filter(([, v]) => v !== '' && num(v) > 0)
        .map(([receivableId, v]) => ({ receivableId, amount: v })),
    [allocations],
  );

  const allocatedTotal = useMemo(
    () => round2(activeAllocations.reduce((sum, a) => sum + num(a.amount), 0)),
    [activeAllocations],
  );

  const amountNum = round2(num(amount));
  const remaining = round2(amountNum - allocatedTotal);
  const overAllocated = allocatedTotal > amountNum + 1e-9;
  const unapplied = remaining > 0 ? remaining : 0;

  const setAllocation = (receivableId: string, value: number | '') =>
    setAllocations((prev) => ({ ...prev, [receivableId]: value }));

  // Greedily fill allocations from the total amount, oldest receivable first.
  const autoAllocate = () => {
    if (amountNum <= 0) {
      setError('Enter the total amount received before auto-allocating.');
      return;
    }
    let left = amountNum;
    const next: Record<string, number | ''> = {};
    for (const r of openReceivables) {
      if (left <= 0) break;
      const outstanding = round2(num(r.outstandingAmount));
      if (outstanding <= 0) continue;
      const take = round2(Math.min(left, outstanding));
      next[r.id] = take;
      left = round2(left - take);
    }
    setAllocations(next);
    setError('');
  };

  const clearAllocations = () => setAllocations({});

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!companyId) return setError('Company is required');
    if (!customerId) return setError('Customer is required');
    if (amountNum <= 0) return setError('Enter a payment amount greater than zero');
    if (!cashAccountId) return setError('Select the cash / bank account the money landed in');
    if (!paymentDate) return setError('Payment date is required');
    if (!activeAllocations.length)
      return setError('Allocate the payment to at least one open receivable');

    // Per-allocation guard: must not exceed that receivable's outstanding.
    for (const a of activeAllocations) {
      const rec = openReceivables.find((r) => r.id === a.receivableId);
      const outstanding = round2(num(rec?.outstandingAmount));
      if (num(a.amount) > outstanding + 1e-9) {
        return setError(
          `Allocation for ${rec?.receivableNumber ?? a.receivableId.slice(0, 8)} exceeds its outstanding ${money(
            outstanding,
            currency,
          )}`,
        );
      }
    }
    if (overAllocated) {
      return setError(
        `Allocated total (${money(allocatedTotal, currency)}) exceeds the payment amount (${money(
          amountNum,
          currency,
        )})`,
      );
    }

    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        companyId,
        customerId,
        amount: amountNum,
        paymentDate,
        cashAccountId,
        currency,
        allocations: activeAllocations.map((a) => ({
          receivableId: a.receivableId,
          amount: round2(num(a.amount)),
        })),
      };
      if (method) body.method = method;
      if (reference.trim()) body.reference = reference.trim();
      if (notes.trim()) body.notes = notes.trim();

      await backendPost('/customer-payments', body);
      showToast(
        'success',
        'Payment recorded',
        unapplied > 0
          ? `Applied ${money(allocatedTotal, currency)}; ${money(
              unapplied,
              currency,
            )} held as unapplied credit.`
          : `Applied ${money(allocatedTotal, currency)} across ${activeAllocations.length} receivable(s).`,
      );
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to record payment';
      setError(message);
      showToast('error', 'Could not record payment', message);
    } finally {
      setSaving(false);
    }
  };

  const fieldClass =
    'aurora-input w-full rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <Modal open onClose={onClose} title="Receive Payment" size="xl">
      <div className="max-h-[78vh] overflow-y-auto p-5">
        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}
        <FormShell onSubmit={handleSubmit}>
          <FormSection columns={2}>
            <FormSelect
              label="Company"
              required
              placeholder="Select company"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              options={companies.map((c) => ({
                value: c.id,
                label: c.code ? `${c.name} (${c.code})` : c.name,
              }))}
            />
            <FormSelect
              label="Customer"
              required
              placeholder={companyId ? 'Select customer' : 'Select company first'}
              disabled={!companyId}
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              options={customers.map((c) => ({
                value: c.id,
                label: c.customerCode ? `${c.name} (${c.customerCode})` : c.name,
              }))}
            />
            <FormInput
              label="Amount Received"
              required
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="0.00"
            />
            <FormSelect
              label="Currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
            <FormSelect
              label="Method"
              placeholder="Select method (optional)"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              options={PAYMENT_METHODS}
            />
            <FormSelect
              label="Cash / Bank Account"
              required
              placeholder={companyId ? 'Select account' : 'Select company first'}
              disabled={!companyId}
              value={cashAccountId}
              onChange={(e) => setCashAccountId(e.target.value)}
              options={cashAccounts.map((a) => ({
                value: a.id,
                label: `${a.accountName}${a.accountType ? ` · ${a.accountType}` : ''}`,
              }))}
            />
            <FormInput
              label="Payment Date"
              required
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
            <FormInput
              label="Reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Cheque no., M-Pesa ref, etc."
            />
          </FormSection>

          {/* Allocation editor */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Allocate to Open Receivables
              </h4>
              <div className="flex items-center gap-2">
                <Btn
                  variant="secondary"
                  size="xs"
                  type="button"
                  onClick={autoAllocate}
                  disabled={!openReceivables.length || amountNum <= 0}
                >
                  Auto-allocate
                </Btn>
                <Btn
                  variant="ghost"
                  size="xs"
                  type="button"
                  onClick={clearAllocations}
                  disabled={!activeAllocations.length}
                >
                  Clear
                </Btn>
              </div>
            </div>

            {!customerId ? (
              <p className="text-[13px]" style={{ color: 'var(--aurora-text-muted)' }}>
                Select a customer to load their open receivables.
              </p>
            ) : loadingReceivables ? (
              <p className="text-[13px]" style={{ color: 'var(--aurora-text-muted)' }}>
                Loading open receivables…
              </p>
            ) : !openReceivables.length ? (
              <p className="text-[13px]" style={{ color: 'var(--aurora-text-muted)' }}>
                This customer has no open receivables. The full amount will be recorded as an
                unapplied credit — add at least one allocation, or record against a receivable once
                one exists.
              </p>
            ) : (
              <div
                className="overflow-x-auto rounded-lg border"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr
                      className="text-left text-[11px] uppercase"
                      style={{
                        color: 'var(--aurora-text-muted)',
                        background: 'var(--aurora-bg-subtle)',
                      }}
                    >
                      <th className="px-3 py-2">Receivable</th>
                      <th className="px-3 py-2">Due</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Outstanding</th>
                      <th className="px-3 py-2 text-right">Allocate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openReceivables.map((r) => {
                      const outstanding = round2(num(r.outstandingAmount));
                      const value = allocations[r.id] ?? '';
                      const invalid = num(value) > outstanding + 1e-9;
                      return (
                        <tr key={r.id}>
                          <td className="px-3 py-2">
                            <div className="font-mono text-[11px]">
                              {r.receivableNumber ?? r.id.slice(0, 8)}
                            </div>
                            <div className="text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
                              {money(r.amount, r.currency ?? currency)}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-[12px]">{fmtDate(r.dueDate)}</td>
                          <td className="px-3 py-2">
                            <StatusBadge status={r.status} />
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {money(outstanding, r.currency ?? currency)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <input
                                type="number"
                                min="0"
                                max={outstanding}
                                step="0.01"
                                value={value}
                                onChange={(e) =>
                                  setAllocation(r.id, e.target.value === '' ? '' : Number(e.target.value))
                                }
                                aria-label={`Allocate to ${r.receivableNumber ?? r.id.slice(0, 8)}`}
                                className={`${fieldClass} w-32 text-right`}
                                style={invalid ? { borderColor: 'var(--aurora-danger)' } : {}}
                              />
                              <button
                                type="button"
                                onClick={() => setAllocation(r.id, outstanding)}
                                className="text-[11px] font-medium text-brand-600 hover:underline"
                                aria-label={`Fill outstanding for ${r.receivableNumber ?? r.id.slice(0, 8)}`}
                              >
                                Max
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Running totals */}
            <div
              className="rounded-lg border p-3"
              style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)' }}
            >
              <div className="flex items-center justify-between text-[13px]">
                <span style={{ color: 'var(--aurora-text-muted)' }}>Amount received</span>
                <span className="font-medium tabular-nums" style={{ color: 'var(--aurora-text)' }}>
                  {money(amountNum, currency)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[13px]">
                <span style={{ color: 'var(--aurora-text-muted)' }}>Allocated</span>
                <span
                  className="font-medium tabular-nums"
                  style={{ color: overAllocated ? 'var(--aurora-danger)' : 'var(--aurora-text)' }}
                >
                  {money(allocatedTotal, currency)}
                </span>
              </div>
              <div
                className="mt-2 flex items-center justify-between border-t pt-2 text-[14px] font-semibold"
                style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
              >
                <span>{overAllocated ? 'Over-allocated by' : 'Unapplied credit (advance)'}</span>
                <span
                  className="tabular-nums"
                  style={{ color: overAllocated ? 'var(--aurora-danger)' : 'var(--aurora-text)' }}
                >
                  {money(overAllocated ? allocatedTotal - amountNum : unapplied, currency)}
                </span>
              </div>
              {overAllocated && (
                <p className="mt-1 text-[12px]" style={{ color: 'var(--aurora-danger)' }}>
                  Allocations must sum to at most the amount received.
                </p>
              )}
            </div>
          </div>

          <FormTextarea
            label="Notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes…"
          />

          <FormActions
            primaryLabel="Record Payment"
            primaryType="submit"
            loading={saving}
            onSecondary={onClose}
          />
        </FormShell>
      </div>
    </Modal>
  );
}

// ─── Detail modal ─────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
        {label}
      </div>
      <div className="text-sm" style={{ color: 'var(--aurora-text)' }}>
        {value ?? '—'}
      </div>
    </div>
  );
}

function DetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { hasPermission } = useAuth();
  const [detail, setDetail] = useState<CustomerPayment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    backendGet<CustomerPayment>(`/customer-payments/${id}`)
      .then((next) => {
        if (!cancelled) setDetail(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load payment');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const currency = detail?.currency || 'TZS';

  return (
    <Modal
      open
      onClose={onClose}
      title={detail ? `Payment ${detail.paymentNumber}` : 'Customer Payment'}
      description={detail ? `${detail.customer?.name ?? detail.customerId} · ${detail.status}` : undefined}
      size="xl"
    >
      <div className="max-h-[75vh] overflow-y-auto p-5">
        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}
        {loading && !detail ? (
          <div className="py-10 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
            Loading payment…
          </div>
        ) : detail ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <DetailRow label="Amount" value={money(detail.amount, currency)} />
              <DetailRow label="Applied" value={money(detail.appliedAmount, currency)} />
              <DetailRow label="Unapplied credit" value={money(detail.unappliedAmount, currency)} />
              <DetailRow label="Status" value={<StatusBadge status={detail.status} />} />
              <DetailRow label="Method" value={methodLabel(detail.method)} />
              <DetailRow label="Payment Date" value={fmtDate(detail.paymentDate)} />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <DetailRow label="Customer" value={detail.customer?.name ?? detail.customerId} />
              <DetailRow label="Company" value={detail.company?.name} />
              <DetailRow label="Cash / Bank Account" value={detail.cashAccount?.accountName} />
              <DetailRow label="Division" value={scopeLabel(detail.division)} />
              <DetailRow label="Branch" value={scopeLabel(detail.branch)} />
              <DetailRow label="Reference" value={detail.reference ?? '—'} />
              <DetailRow label="Created" value={fmtDateTime(detail.createdAt)} />
              {detail.status === 'REVERSED' && (
                <DetailRow label="Reversed At" value={fmtDateTime(detail.reversedAt)} />
              )}
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Allocations
              </h4>
              <div
                className="overflow-x-auto rounded-lg border"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr
                      className="text-left text-[11px] uppercase"
                      style={{
                        color: 'var(--aurora-text-muted)',
                        background: 'var(--aurora-bg-subtle)',
                      }}
                    >
                      <th className="px-3 py-2">Receivable</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Applied</th>
                      <th className="px-3 py-2 text-right">Outstanding (now)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.allocations ?? []).map((a) => (
                      <tr key={a.id}>
                        <td className="px-3 py-2 font-mono text-[11px]">
                          {a.receivable?.receivableNumber ?? a.receivableId.slice(0, 8)}
                        </td>
                        <td className="px-3 py-2">
                          {a.receivable?.status ? <StatusBadge status={a.receivable.status} /> : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {money(a.amount, currency)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {money(a.receivable?.outstandingAmount, currency)}
                        </td>
                      </tr>
                    ))}
                    {!detail.allocations?.length && (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-3 py-4 text-center text-sm"
                          style={{ color: 'var(--aurora-text-muted)' }}
                        >
                          No allocations — full amount held as unapplied credit.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Ledger Posting
              </h4>
              {detail.journalEntry ? (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <DetailRow label="Journal #" value={detail.journalEntry.journalNumber} />
                    <DetailRow
                      label="Status"
                      value={<StatusBadge status={detail.journalEntry.status} />}
                    />
                    <DetailRow label="Posted At" value={fmtDateTime(detail.journalEntry.postedAt)} />
                  </div>
                  <div
                    className="overflow-x-auto rounded-lg border"
                    style={{ borderColor: 'var(--aurora-border)' }}
                  >
                    <table className="w-full text-sm">
                      <thead>
                        <tr
                          className="text-left text-[11px] uppercase"
                          style={{
                            color: 'var(--aurora-text-muted)',
                            background: 'var(--aurora-bg-subtle)',
                          }}
                        >
                          <th className="px-3 py-2">Account</th>
                          <th className="px-3 py-2">Description</th>
                          <th className="px-3 py-2 text-right">Debit</th>
                          <th className="px-3 py-2 text-right">Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.journalEntry.lines ?? []).map((line) => (
                          <tr key={line.id}>
                            <td className="px-3 py-2">
                              <div className="font-mono text-[11px]">
                                {line.account?.accountCode}
                              </div>
                              <div>{line.account?.accountName}</div>
                            </td>
                            <td className="px-3 py-2">{line.description ?? '—'}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {money(line.debit, currency)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {money(line.credit, currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                  No journal entry linked to this payment.
                </p>
              )}
            </div>

            {detail.notes && (
              <div>
                <h4 className="mb-1 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  Notes
                </h4>
                <p className="whitespace-pre-wrap text-sm" style={{ color: 'var(--aurora-text)' }}>
                  {detail.notes}
                </p>
              </div>
            )}
          </div>
        ) : null}
      </div>
      <div
        className="flex items-center justify-between gap-2 border-t px-5 py-3"
        style={{ borderColor: 'var(--aurora-border)' }}
      >
        {/* Payment receipt PDF (server-generated artifact) */}
        {detail && hasPermission('customer-payments.view') ? (
          <DocumentArtifactButton entityType="CUSTOMER_PAYMENT_RECEIPT" entityId={detail.id} />
        ) : (
          <span />
        )}
        <Btn variant="secondary" onClick={onClose}>
          Close
        </Btn>
      </div>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CustomerPaymentsPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission('customer-payments.view');
  const canManage = hasPermission('customer-payments.manage');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<{
    items: CustomerPayment[];
    total: number;
    page: number;
    totalPages: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const [receiving, setReceiving] = useState(false);
  const [viewing, setViewing] = useState<CustomerPayment | null>(null);
  const [reversing, setReversing] = useState<CustomerPayment | null>(null);
  const [reverseBusy, setReverseBusy] = useState(false);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    backendList<Company>('/companies', { query: { limit: 200 } })
      .then((rows) => {
        if (!cancelled) setCompanies(rows);
      })
      .catch(() => {
        if (!cancelled) setCompanies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canView]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const result = await backendPage<CustomerPayment>('/customer-payments', {
        query: {
          page,
          limit: PAGE_SIZE,
          companyId: companyId || undefined,
          status: status || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        },
      });
      setData({
        items: result.data,
        total: result.total,
        page: result.page || page,
        totalPages: result.totalPages || 1,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payments');
      setData({ items: [], total: 0, page, totalPages: 1 });
    } finally {
      setLoading(false);
    }
  }, [canView, page, companyId, status, dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => data?.items ?? [], [data]);

  const stats = useMemo(() => {
    const completed = rows.filter((r) => r.status === 'COMPLETED');
    const receivedValue = completed.reduce((sum, r) => sum + num(r.amount), 0);
    const unappliedValue = completed.reduce((sum, r) => sum + num(r.unappliedAmount), 0);
    return { completed: completed.length, receivedValue, unappliedValue };
  }, [rows]);

  const runReverse = async () => {
    if (!reversing) return;
    setReverseBusy(true);
    try {
      await backendPatch(`/customer-payments/${reversing.id}/reverse`, {
        reason: 'Reversed from finance payments screen',
      });
      showToast(
        'info',
        'Payment reversed',
        'A mirror journal entry was posted and the allocated receivables were restored.',
      );
      setReversing(null);
      await load();
    } catch (err: unknown) {
      showToast(
        'error',
        'Could not reverse payment',
        err instanceof Error ? err.message : 'Please try again.',
      );
    } finally {
      setReverseBusy(false);
    }
  };

  const columns: ResponsiveColumn<CustomerPayment>[] = [
    {
      key: 'paymentNumber',
      header: 'Payment #',
      priority: 1,
      accessor: (r) => <span className="font-mono text-xs">{r.paymentNumber}</span>,
    },
    {
      key: 'customer',
      header: 'Customer',
      priority: 1,
      accessor: (r) => <span className="font-medium">{r.customer?.name ?? r.customerId}</span>,
    },
    {
      key: 'company',
      header: 'Company',
      priority: 3,
      accessor: (r) => <span className="text-sm">{r.company?.name ?? '—'}</span>,
    },
    {
      key: 'paymentDate',
      header: 'Date',
      priority: 2,
      accessor: (r) => <span className="text-sm">{fmtDate(r.paymentDate)}</span>,
    },
    {
      key: 'method',
      header: 'Method',
      priority: 3,
      accessor: (r) => <span className="text-sm">{methodLabel(r.method)}</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      priority: 1,
      align: 'right',
      accessor: (r) => (
        <span className="font-medium tabular-nums">{money(r.amount, r.currency)}</span>
      ),
    },
    {
      key: 'appliedAmount',
      header: 'Applied',
      priority: 2,
      align: 'right',
      accessor: (r) => <span className="tabular-nums">{money(r.appliedAmount, r.currency)}</span>,
    },
    {
      key: 'unappliedAmount',
      header: 'Unapplied',
      priority: 3,
      align: 'right',
      accessor: (r) => <span className="tabular-nums">{money(r.unappliedAmount, r.currency)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      priority: 1,
      accessor: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      priority: 1,
      align: 'right',
      exportExclude: true,
      accessor: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          <Btn variant="secondary" size="xs" onClick={() => setViewing(r)}>
            View
          </Btn>
          {canManage && r.status === 'COMPLETED' && (
            <Btn variant="danger" size="xs" onClick={() => setReversing(r)}>
              Reverse
            </Btn>
          )}
        </div>
      ),
    },
  ];

  if (!canView) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader title="Customer Payments" subtitle="Receive & allocate customer payments (AR)" />
        <PermissionDeniedState />
      </div>
    );
  }

  const totalPages = data?.totalPages ?? 1;
  const filterSelectCls =
    'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = {
    borderColor: 'var(--aurora-border)',
    background: 'var(--aurora-card)',
    color: 'var(--aurora-text)',
  } as const;

  return (
    <div className="p-6 space-y-6">
      {receiving && (
        <ReceivePaymentModal
          companies={companies}
          onClose={() => setReceiving(false)}
          onSaved={() => {
            setReceiving(false);
            setPage(1);
            void load();
          }}
        />
      )}
      {viewing && <DetailModal id={viewing.id} onClose={() => setViewing(null)} />}
      {reversing && (
        <ConfirmDialog
          open
          title={`Reverse ${reversing.paymentNumber}?`}
          description={`This posts a mirror journal entry that unwinds the original posting and restores the allocated receivables' outstanding balances (${money(
            reversing.amount,
            reversing.currency,
          )}). This cannot be undone.`}
          confirmLabel="Reverse Payment"
          cancelLabel="Cancel"
          variant="danger"
          loading={reverseBusy}
          onConfirm={runReverse}
          onClose={() => setReversing(null)}
        />
      )}

      <PageHeader title="Customer Payments" subtitle="Receive & allocate customer payments (AR)" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total" value={data?.total ?? 0} />
        <StatCard label="Completed (page)" value={stats.completed} variant="green" />
        <StatCard label="Received (page)" value={money(stats.receivedValue)} />
        <StatCard label="Unapplied (page)" value={money(stats.unappliedValue)} />
      </div>

      <PageToolbar
        filters={
          <>
            <select
              aria-label="Filter by company"
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Status</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              type="date"
              aria-label="Filter from date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            />
            <input
              type="date"
              aria-label="Filter to date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            />
          </>
        }
        actions={
          canManage ? (
            <Btn variant="primary" onClick={() => setReceiving(true)}>
              + Receive Payment
            </Btn>
          ) : undefined
        }
      />

      <ResponsiveDataTable<CustomerPayment>
        columns={columns}
        data={rows}
        keyField="id"
        loading={loading}
        error={error}
        onRetry={() => void load()}
        errorTitle="Could not load payments"
        emptyTitle="No payments found"
        emptyDescription={
          canManage
            ? 'Adjust your filters or receive a new payment.'
            : 'Adjust your filters or ask an administrator to record a payment.'
        }
        exportable
        exportFileName="customer-payments"
        exportPdf={{ title: 'Customer Payments', companyId: companyId || undefined }}
        pagination={{
          page,
          limit: PAGE_SIZE,
          total: data?.total ?? 0,
          onPageChange: (next) => {
            if (next >= 1 && next <= totalPages) setPage(next);
          },
        }}
      />
    </div>
  );
}
