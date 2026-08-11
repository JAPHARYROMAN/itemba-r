'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Card,
  PageHeader,
  PageToolbar,
  StatCard,
  StatusBadge,
  Modal,
  Btn,
  PageSpinner,
  FormInput,
  FormSelect,
  FormTextarea,
  showToast,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

// ── Types ──────────────────────────────────────────────────────────────────

interface Company {
  id: string;
  name: string;
  code: string;
}

interface CashAccount {
  id: string;
  accountName: string;
  accountType?: string | null;
  currency?: string | null;
}

interface CreditNoteOption {
  id: string;
  creditNoteNumber: string;
  customerId?: string | null;
  customerName?: string | null;
  totalAmount: number | string;
  appliedAmount?: number | string | null;
  currency?: string | null;
  status: string;
}

// Matches RefundRow returned by the backend refunds controller.
interface Refund {
  id: string;
  refundNumber: string;
  companyId: string;
  divisionId?: string | null;
  branchId?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  creditNoteId?: string | null;
  receivableId?: string | null;
  cashAccountId: string;
  amount: number | string;
  currency: string;
  refundDate: string;
  status: 'DRAFT' | 'PAID' | 'VOID';
  reason?: string | null;
  notes?: string | null;
  journalEntryId?: string | null;
  reversalJournalEntryId?: string | null;
  postedAt?: string | null;
  voidedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
}

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface RefundForm {
  companyId: string;
  creditNoteId: string;
  cashAccountId: string;
  amount: number | '';
  currency: string;
  refundDate: string;
  reason: string;
  notes: string;
}

const BLANK_FORM: RefundForm = {
  companyId: '',
  creditNoteId: '',
  cashAccountId: '',
  amount: '',
  currency: 'TZS',
  refundDate: '',
  reason: '',
  notes: '',
};

const CURRENCIES = ['TZS', 'USD', 'EUR', 'KES', 'UGX', 'GBP'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function moneyNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(n: number | string | null | undefined, currency = 'TZS') {
  const value = moneyNumber(n);
  return (
    `${currency} ` +
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  );
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function creditNoteRefundable(note: CreditNoteOption) {
  const total = moneyNumber(note.totalAmount);
  const applied = moneyNumber(note.appliedAmount);
  return Math.max(0, Number((total - applied).toFixed(2)));
}

async function parseError(res: Response, fallback: string) {
  const json = await res.json().catch(() => ({}));
  const message = json?.message ?? json?.error;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' && message ? message : fallback;
}

function parseList<T>(json: unknown): T[] {
  // Accepts every envelope the backend produces: bare arrays, { data: [...] },
  // { data: { data: [...] } }, and the credit-notes list's { data: { items: [...] } }.
  const seen = new Set<unknown>();
  let current: unknown = json;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (Array.isArray(current)) return current as T[];
    const record = current as { data?: unknown; items?: unknown };
    current = record.items ?? record.data;
  }
  return Array.isArray(current) ? (current as T[]) : [];
}

// ── Create modal ──────────────────────────────────────────────────────────────

function RefundCreateModal({
  companies,
  onClose,
  onSaved,
}: {
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<RefundForm>(() => ({
    ...BLANK_FORM,
    refundDate: new Date().toISOString().split('T')[0],
  }));
  const [creditNotes, setCreditNotes] = useState<CreditNoteOption[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof RefundForm, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  const selectedNote = useMemo(
    () => creditNotes.find((n) => n.id === form.creditNoteId),
    [creditNotes, form.creditNoteId],
  );

  // Load ISSUED credit notes + active cash accounts scoped to the chosen company.
  useEffect(() => {
    let cancelled = false;
    if (!form.companyId) {
      setCreditNotes([]);
      setCashAccounts([]);
      return;
    }
    setLoadingNotes(true);
    Promise.all([
      fetch(
        `/api/backend/credit-notes?companyId=${encodeURIComponent(form.companyId)}&status=ISSUED&limit=500`,
      )
        .then((r) => r.json())
        .then((j) => parseList<CreditNoteOption>(j))
        .catch(() => [] as CreditNoteOption[]),
      fetch(
        `/api/backend/cash-accounts?companyId=${encodeURIComponent(form.companyId)}&isActive=true&limit=500`,
      )
        .then((r) => r.json())
        .then((j) => parseList<CashAccount>(j))
        .catch(() => [] as CashAccount[]),
    ])
      .then(([notes, accounts]) => {
        if (cancelled) return;
        setCreditNotes(notes);
        setCashAccounts(accounts);
      })
      .finally(() => {
        if (!cancelled) setLoadingNotes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form.companyId]);

  const handleSubmit = async () => {
    if (!form.companyId) {
      setError('Company is required');
      return;
    }
    if (!form.creditNoteId) {
      setError('An ISSUED credit note is required');
      return;
    }
    if (!form.cashAccountId) {
      setError('A cash / bank account is required');
      return;
    }
    const amt = Number(form.amount);
    if (!amt || amt <= 0) {
      setError('Refund amount must be greater than zero');
      return;
    }
    if (selectedNote) {
      const refundable = creditNoteRefundable(selectedNote);
      if (amt > refundable) {
        setError(`Amount cannot exceed the credit note's refundable value ${fmtMoney(refundable, form.currency)}`);
        return;
      }
    }
    if (!form.refundDate) {
      setError('Refund date is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        companyId: form.companyId,
        creditNoteId: form.creditNoteId,
        customerId: selectedNote?.customerId || undefined,
        cashAccountId: form.cashAccountId,
        amount: amt,
        currency: form.currency,
        refundDate: form.refundDate,
        reason: form.reason || undefined,
        notes: form.notes || undefined,
      };
      const res = await fetch('/api/backend/refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await parseError(res, 'Failed to create refund'));
      showToast('success', 'Refund created', 'A DRAFT refund was created. Pay it to post the GL entry.');
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
      showToast('error', 'Could not create refund', message);
    } finally {
      setSaving(false);
    }
  };

  const currency = selectedNote?.currency || form.currency;

  return (
    <Modal
      open
      onClose={onClose}
      title="New Refund"
      subtitle="Refund an ISSUED credit note in cash / bank"
      size="lg"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={saving}>
            Create Refund
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div className="space-y-3">
        <FormSelect
          label="Company"
          required
          value={form.companyId}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              companyId: e.target.value,
              creditNoteId: '',
              cashAccountId: '',
            }))
          }
          placeholder="Select company…"
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </FormSelect>

        <FormSelect
          label="Credit Note (ISSUED)"
          required
          disabled={!form.companyId || loadingNotes}
          value={form.creditNoteId}
          onChange={(e) => {
            const note = creditNotes.find((n) => n.id === e.target.value);
            setForm((f) => ({
              ...f,
              creditNoteId: e.target.value,
              currency: note?.currency || f.currency,
              amount: note ? creditNoteRefundable(note) : f.amount,
            }));
          }}
          placeholder={
            loadingNotes
              ? 'Loading credit notes…'
              : form.companyId
                ? creditNotes.length
                  ? 'Select an ISSUED credit note…'
                  : 'No ISSUED credit notes for this company'
                : 'Select a company first'
          }
        >
          {creditNotes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.creditNoteNumber} · {n.customerName ?? 'Customer'} ·{' '}
              {fmtMoney(creditNoteRefundable(n), n.currency ?? 'TZS')} refundable
            </option>
          ))}
        </FormSelect>

        {selectedNote && (
          <div
            className="rounded-lg border px-3 py-2 text-xs"
            style={{
              borderColor: 'var(--aurora-border)',
              background: 'var(--aurora-card)',
              color: 'var(--aurora-text-muted)',
            }}
          >
            <div className="flex justify-between">
              <span>Credit note total</span>
              <span className="font-mono">{fmtMoney(selectedNote.totalAmount, currency)}</span>
            </div>
            <div className="flex justify-between">
              <span>Already applied</span>
              <span className="font-mono">{fmtMoney(selectedNote.appliedAmount, currency)}</span>
            </div>
            <div className="flex justify-between font-semibold" style={{ color: 'var(--aurora-text)' }}>
              <span>Refundable in cash</span>
              <span className="font-mono">
                {fmtMoney(creditNoteRefundable(selectedNote), currency)}
              </span>
            </div>
          </div>
        )}

        <FormSelect
          label="Cash / Bank Account"
          required
          disabled={!form.companyId}
          value={form.cashAccountId}
          onChange={(e) => set('cashAccountId', e.target.value)}
          placeholder={
            form.companyId
              ? cashAccounts.length
                ? 'Select the account money leaves from…'
                : 'No active cash accounts for this company'
              : 'Select a company first'
          }
        >
          {cashAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.accountName}
              {a.accountType ? ` (${a.accountType})` : ''}
            </option>
          ))}
        </FormSelect>

        <div className="grid grid-cols-2 gap-3">
          <FormInput
            label="Amount"
            required
            type="number"
            min="0.01"
            step="0.01"
            max={selectedNote ? creditNoteRefundable(selectedNote) : undefined}
            value={form.amount}
            onChange={(e) => set('amount', e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="0.00"
          />
          <FormSelect
            label="Currency"
            value={form.currency}
            onChange={(e) => set('currency', e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </FormSelect>
        </div>

        <FormInput
          label="Refund Date"
          required
          type="date"
          value={form.refundDate}
          onChange={(e) => set('refundDate', e.target.value)}
        />

        <FormInput
          label="Reason"
          value={form.reason}
          onChange={(e) => set('reason', e.target.value)}
          placeholder="Reason for refund…"
        />

        <FormTextarea
          label="Notes"
          rows={2}
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Optional notes…"
        />
      </div>
    </Modal>
  );
}

// ── Pay modal ──────────────────────────────────────────────────────────────

function PayRefundModal({
  refund,
  onClose,
  onDone,
}: {
  refund: Refund;
  onClose: () => void;
  onDone: () => void;
}) {
  const [paymentDate, setPaymentDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/backend/refunds/${refund.id}/pay`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentDate: paymentDate || undefined,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) throw new Error(await parseError(res, 'Payment failed'));
      showToast('success', 'Refund paid', `${refund.refundNumber} posted to the general ledger.`);
      onDone();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
      showToast('error', 'Could not pay refund', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Pay Refund"
      subtitle={`${refund.refundNumber} · ${fmtMoney(refund.amount, refund.currency)}`}
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="success" onClick={handleSubmit} loading={saving}>
            Pay & Post
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <p className="mb-3 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
        Paying posts a balanced journal entry (DR Accounts Receivable / CR Cash or Bank) and moves
        this refund to PAID. This action releases the customer credit in cash.
      </p>
      <div className="space-y-3">
        <FormInput
          label="Payment Date"
          type="date"
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
        />
        <FormTextarea
          label="Notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional payment notes…"
        />
      </div>
    </Modal>
  );
}

// ── Void modal ──────────────────────────────────────────────────────────────

function VoidRefundModal({
  refund,
  onClose,
  onDone,
}: {
  refund: Refund;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!reason.trim()) {
      setError('Reason is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/backend/refunds/${refund.id}/void`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) throw new Error(await parseError(res, 'Void failed'));
      showToast('success', 'Refund voided', `${refund.refundNumber} was reversed in the ledger.`);
      onDone();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
      showToast('error', 'Could not void refund', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Void Refund"
      subtitle={`${refund.refundNumber} · ${fmtMoney(refund.amount, refund.currency)}`}
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="danger" onClick={handleSubmit} loading={saving}>
            Void & Reverse
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <p className="mb-3 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
        Voiding a PAID refund posts a reversing journal entry that unwinds the original posting and
        releases the credit the refund consumed. A reason is required for the audit trail.
      </p>
      <FormTextarea
        label="Reason"
        required
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for voiding this refund…"
      />
    </Modal>
  );
}

// ── Detail modal ──────────────────────────────────────────────────────────────

function RefundDetailModal({ refund, onClose }: { refund: Refund; onClose: () => void }) {
  const [detail, setDetail] = useState<Refund>(refund);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setDetail(refund);
    setLoading(true);
    fetch(`/api/backend/refunds/${refund.id}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error('Unable to load refund');
        return (json.data ?? json) as Refund;
      })
      .then((next) => {
        if (!cancelled) setDetail(next);
      })
      // Detail fetch only enriches the row-level snapshot already on screen — keep it on failure.
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refund]);

  const currency = detail.currency || 'TZS';
  const rows: Array<[string, ReactNode]> = [
    ['Refund #', detail.refundNumber],
    ['Status', <StatusBadge key="s" status={detail.status} />],
    ['Amount', fmtMoney(detail.amount, currency)],
    ['Currency', currency],
    ['Customer', detail.customerName ?? detail.customerId ?? '—'],
    ['Credit Note ID', detail.creditNoteId ?? '—'],
    ['Receivable ID', detail.receivableId ?? '—'],
    ['Cash Account ID', detail.cashAccountId],
    ['Refund Date', fmtDate(detail.refundDate)],
    ['Posted At', detail.postedAt ? fmtDate(detail.postedAt) : '—'],
    ['Voided At', detail.voidedAt ? fmtDate(detail.voidedAt) : '—'],
    ['Journal Entry', detail.journalEntryId ?? '—'],
    ['Reversal JE', detail.reversalJournalEntryId ?? '—'],
    ['Reason', detail.reason ?? '—'],
    ['Notes', detail.notes ?? '—'],
    ['Created', fmtDate(detail.createdAt)],
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title={`Refund ${detail.refundNumber}`}
      subtitle={`${detail.customerName ?? 'Customer'} · ${detail.status}`}
      size="lg"
      footer={
        <Btn variant="secondary" onClick={onClose}>
          Close
        </Btn>
      }
    >
      {loading && (
        <div className="mb-3 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
          Loading refund details…
        </div>
      )}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={String(label)} className="flex flex-col">
            <dt className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              {label}
            </dt>
            <dd
              className="text-sm break-words font-mono"
              style={{ color: 'var(--aurora-text)' }}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function RefundsPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<Refund> | null>(null);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Refund | null>(null);
  const [paying, setPaying] = useState<Refund | null>(null);
  const [voiding, setVoiding] = useState<Refund | null>(null);

  const canView = hasPermission('refunds.view');
  const canManage = hasPermission('refunds.manage');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => setCompanies(parseList<Company>(j)))
      .catch(() => setCompanies([]));
  }, []);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (companyId) params.set('companyId', companyId);
      if (status) params.set('status', status);
      const res = await fetch(`/api/backend/refunds?${params}`);
      const json = await res.json();
      setData((json.data ?? json) as Paginated<Refund>);
    } catch {
      showToast('error', 'Could not load refunds', 'Please try again.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [canView, page, companyId, status]);

  useEffect(() => {
    load();
  }, [load]);

  const resetTo = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
  };

  const totalRefunded = useMemo(
    () =>
      data?.data
        .filter((r) => r.status === 'PAID')
        .reduce((s, r) => s + moneyNumber(r.amount), 0) ?? 0,
    [data],
  );
  const draftCount = data?.data.filter((r) => r.status === 'DRAFT').length ?? 0;
  const paidCount = data?.data.filter((r) => r.status === 'PAID').length ?? 0;

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Refunds" subtitle="Customer refunds against credit notes" />
        <div className="mt-8 text-center">
          <p className="text-sm text-slate-500">Access Restricted</p>
        </div>
      </div>
    );
  }

  const filterSelectCls =
    'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = {
    borderColor: 'var(--aurora-border)',
    background: 'var(--aurora-card)',
    color: 'var(--aurora-text)',
  } as const;

  return (
    <div className="p-6 space-y-6">
      {creating && (
        <RefundCreateModal
          companies={companies}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {viewing && <RefundDetailModal refund={viewing} onClose={() => setViewing(null)} />}
      {paying && (
        <PayRefundModal
          refund={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            load();
          }}
        />
      )}
      {voiding && (
        <VoidRefundModal
          refund={voiding}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null);
            load();
          }}
        />
      )}

      <PageHeader title="Refunds" subtitle="Customer refunds against ISSUED credit notes" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total" value={data?.total ?? 0} />
        <StatCard label="Draft" value={draftCount} hint="Awaiting payment" />
        <StatCard label="Paid" value={paidCount} />
        <StatCard label="Refunded (page)" value={fmtMoney(totalRefunded)} />
      </div>

      <PageToolbar
        filters={
          <>
            <select
              value={companyId}
              onChange={(e) => resetTo(setCompanyId)(e.target.value)}
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
              value={status}
              onChange={(e) => resetTo(setStatus)(e.target.value)}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Status</option>
              <option value="DRAFT">Draft</option>
              <option value="PAID">Paid</option>
              <option value="VOID">Void</option>
            </select>
          </>
        }
        actions={
          canManage ? (
            <Btn variant="primary" onClick={() => setCreating(true)}>
              + New Refund
            </Btn>
          ) : null
        }
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr
                className="text-left text-xs uppercase bg-gray-50"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th className="px-4 py-3">Refund #</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Refund Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6}>
                    <PageSpinner />
                  </td>
                </tr>
              ) : !data?.data.length ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-sm"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    No refunds found
                  </td>
                </tr>
              ) : (
                data.data.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">
                      <div className="space-y-1">
                        <div>{r.refundNumber}</div>
                        <button
                          type="button"
                          onClick={() => setViewing(r)}
                          className="font-sans text-[11px] font-semibold hover:underline"
                          style={{ color: 'var(--aurora-primary-text)' }}
                        >
                          View details
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {r.customerName ?? r.customerId ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold">
                      {fmtMoney(r.amount, r.currency)}
                    </td>
                    <td className="px-4 py-3">{fmtDate(r.refundDate)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Btn variant="secondary" size="xs" onClick={() => setViewing(r)}>
                          View
                        </Btn>
                        {canManage && r.status === 'DRAFT' && (
                          <Btn variant="success" size="xs" onClick={() => setPaying(r)}>
                            Pay
                          </Btn>
                        )}
                        {canManage && r.status === 'PAID' && (
                          <Btn variant="danger" size="xs" onClick={() => setVoiding(r)}>
                            Void
                          </Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {data && data.totalPages > 1 && (
          <div
            className="px-5 py-3 border-t flex items-center justify-between"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Page {data.page} of {data.totalPages} · {data.total} total
            </span>
            <div className="flex gap-2">
              <Btn
                variant="secondary"
                size="xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Btn>
              <Btn
                variant="secondary"
                size="xs"
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
