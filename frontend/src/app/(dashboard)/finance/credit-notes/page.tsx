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
import {
  FormShell,
  FormSection,
  FormInput,
  FormSelect,
  FormTextarea,
  FormActions,
} from '@/components/aurora/forms';
import { useAuth } from '@/hooks/use-auth';
import { DocumentArtifactButton } from '@/components/documents';
import { backendGet, backendList, backendPatch, backendPost } from '@/lib/api-client';

// ─── Types (shapes mirror the credit-notes controller / service includes) ─────

interface Company {
  id: string;
  name: string;
  code?: string | null;
}

interface CustomerOption {
  id: string;
  name: string;
  customerCode?: string | null;
}

interface ScopeRef {
  id: string;
  name: string;
  code?: string | null;
}

interface CreditNoteLine {
  id: string;
  description?: string | null;
  quantity: number | string;
  unitPrice: number | string;
  netAmount: number | string;
  taxAmount: number | string;
  lineTotal: number | string;
  product?: { id?: string | null; productCode?: string | null; sku?: string | null; name?: string | null } | null;
  unit?: { id?: string | null; name?: string | null; symbol?: string | null } | null;
}

interface JournalLine {
  id: string;
  description?: string | null;
  debit: number | string;
  credit: number | string;
  account: { accountCode: string; accountName: string; accountType?: string | null };
}

interface JournalEntry {
  id: string;
  journalNumber: string;
  transactionDate: string;
  description?: string | null;
  status: string;
  totalDebit: number | string;
  totalCredit: number | string;
  postedAt?: string | null;
  lines?: JournalLine[];
}

// The credit-notes service returns the row shape below (see credit-note.types.ts
// CreditNoteRow) plus the includeListScope / includeDetailScope relations.
interface CreditNote extends Record<string, unknown> {
  id: string;
  creditNoteNumber: string;
  companyId: string;
  divisionId?: string | null;
  branchId?: string | null;
  customerId?: string | null;
  customerName: string;
  salesOrderId?: string | null;
  receivableId?: string | null;
  reason?: string | null;
  subtotal: number | string;
  taxAmount: number | string;
  totalAmount: number | string;
  appliedAmount: number | string;
  currency: string;
  issueDate: string;
  status: 'DRAFT' | 'ISSUED' | 'VOID';
  notes?: string | null;
  journalEntryId?: string | null;
  createdAt: string;
  updatedAt?: string;
  company?: ScopeRef | null;
  division?: ScopeRef | null;
  branch?: ScopeRef | null;
  customer?: (CustomerOption & { tin?: string | null; vrn?: string | null }) | null;
  salesOrder?: { id: string; salesOrderNumber: string } | null;
  receivable?: {
    id: string;
    receivableNumber?: string | null;
    outstandingAmount?: number | string | null;
    status?: string | null;
  } | null;
  lines?: CreditNoteLine[];
  journalEntry?: JournalEntry | null;
}

// The credit-notes list endpoint returns { items, total, page, limit, totalPages }
// — NOTE it uses `items` (not `data`), so we read that shape directly rather than
// via backendPage/normalizePaginated (which expects `data`).
interface CreditNotePage {
  items: CreditNote[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface CreditNoteFormLine {
  productId: string;
  unitId: string;
  description: string;
  quantity: number | '';
  unitPrice: number | '';
  taxAmount: number | '';
}

interface CreditNoteForm {
  companyId: string;
  customerId: string;
  customerName: string;
  currency: string;
  issueDate: string;
  reason: string;
  notes: string;
  salesOrderId: string;
  receivableId: string;
  lines: CreditNoteFormLine[];
}

const CURRENCIES = ['TZS', 'USD', 'EUR', 'KES', 'UGX', 'GBP'];
const STATUSES: Array<CreditNote['status']> = ['DRAFT', 'ISSUED', 'VOID'];
const PAGE_SIZE = 20;
const VAT_RATE = 0.18; // Tanzania standard VAT (used only as a client-side helper)

const blankLine = (): CreditNoteFormLine => ({
  productId: '',
  unitId: '',
  description: '',
  quantity: 1,
  unitPrice: '',
  taxAmount: '',
});

const blankForm = (): CreditNoteForm => ({
  companyId: '',
  customerId: '',
  customerName: '',
  currency: 'TZS',
  issueDate: new Date().toISOString().slice(0, 10),
  reason: '',
  notes: '',
  salesOrderId: '',
  receivableId: '',
  lines: [blankLine()],
});

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// Round to 2dp the same way the backend does per line, so the previewed totals
// match the persisted (Decimal, 2dp) values.
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function money(value: number | string | null | undefined, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num(value))}`;
}

function qty(value: number | string | null | undefined) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(num(value));
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

// ─── Simple line editor ───────────────────────────────────────────────────────
//
// The credit-note line DTO only needs description + quantity + unitPrice +
// (optional) taxAmount; there is no stock/profit enforcement, discount, or
// mandatory product on a credit note, so the heavy shared OrderLineEditor does
// not fit. A focused editor keeps the create form aligned 1:1 with the backend
// CreateCreditNoteLineDto and computes the same net/tax/gross totals.

function LineEditor({
  lines,
  currency,
  onAdd,
  onRemove,
  onChange,
}: {
  lines: CreditNoteFormLine[];
  currency: string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (index: number, patch: Partial<CreditNoteFormLine>) => void;
}) {
  const totals = lines.reduce(
    (acc, line) => {
      const net = round2(num(line.quantity) * num(line.unitPrice));
      const tax = round2(num(line.taxAmount));
      return { net: round2(acc.net + net), tax: round2(acc.tax + tax) };
    },
    { net: 0, tax: 0 },
  );
  const gross = round2(totals.net + totals.tax);

  const fieldClass =
    'aurora-input w-full rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
          Credit Lines
        </h4>
        <Btn variant="secondary" size="xs" type="button" onClick={onAdd}>
          + Add Line
        </Btn>
      </div>

      <div className="space-y-3">
        {lines.map((line, index) => {
          const net = round2(num(line.quantity) * num(line.unitPrice));
          const lineTotal = round2(net + round2(num(line.taxAmount)));
          return (
            <div
              key={index}
              className="rounded-lg border p-3"
              style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg)' }}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  Line {index + 1}
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className="rounded-lg border px-3 py-1 text-[13px] font-semibold tabular-nums"
                    style={{
                      borderColor: 'var(--aurora-border)',
                      color: 'var(--aurora-text)',
                      background: 'var(--aurora-card)',
                    }}
                  >
                    {money(lineTotal, currency)}
                  </span>
                  {lines.length > 1 && (
                    <Btn
                      variant="ghost"
                      size="xs"
                      type="button"
                      onClick={() => onRemove(index)}
                      aria-label={`Remove line ${index + 1}`}
                    >
                      Remove
                    </Btn>
                  )}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span
                    className="mb-1 block text-[12px] font-medium"
                    style={{ color: 'var(--aurora-text-secondary)' }}
                  >
                    Description *
                  </span>
                  <input
                    value={line.description}
                    onChange={(e) => onChange(index, { description: e.target.value })}
                    className={fieldClass}
                    placeholder="e.g. Returned goods — invoice correction"
                    aria-label={`Line ${index + 1} description`}
                  />
                </label>
                <label className="block">
                  <span
                    className="mb-1 block text-[12px] font-medium"
                    style={{ color: 'var(--aurora-text-secondary)' }}
                  >
                    Quantity *
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={line.quantity}
                    onChange={(e) =>
                      onChange(index, {
                        quantity: e.target.value === '' ? '' : Number(e.target.value),
                      })
                    }
                    className={fieldClass}
                    aria-label={`Line ${index + 1} quantity`}
                  />
                </label>
                <label className="block">
                  <span
                    className="mb-1 block text-[12px] font-medium"
                    style={{ color: 'var(--aurora-text-secondary)' }}
                  >
                    Unit Price *
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.unitPrice}
                    onChange={(e) =>
                      onChange(index, {
                        unitPrice: e.target.value === '' ? '' : Number(e.target.value),
                      })
                    }
                    className={fieldClass}
                    aria-label={`Line ${index + 1} unit price`}
                  />
                </label>
                <label className="block">
                  <span
                    className="mb-1 flex items-center justify-between gap-2 text-[12px] font-medium"
                    style={{ color: 'var(--aurora-text-secondary)' }}
                  >
                    <span>VAT (tax) being reversed</span>
                    <button
                      type="button"
                      onClick={() => onChange(index, { taxAmount: round2(net * VAT_RATE) })}
                      className="text-[11px] font-medium text-brand-600 hover:underline"
                      aria-label={`Auto-fill 18% VAT for line ${index + 1}`}
                    >
                      18%
                    </button>
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.taxAmount}
                    onChange={(e) =>
                      onChange(index, {
                        taxAmount: e.target.value === '' ? '' : Number(e.target.value),
                      })
                    }
                    className={fieldClass}
                    aria-label={`Line ${index + 1} tax amount`}
                  />
                </label>
                <div
                  className="flex items-center text-[12px]"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  Net: {money(net, currency)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="rounded-lg border p-3"
        style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)' }}
      >
        <div className="flex items-center justify-between text-[13px]">
          <span style={{ color: 'var(--aurora-text-muted)' }}>Subtotal (net)</span>
          <span className="font-medium tabular-nums" style={{ color: 'var(--aurora-text)' }}>
            {money(totals.net, currency)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-[13px]">
          <span style={{ color: 'var(--aurora-text-muted)' }}>VAT</span>
          <span className="font-medium tabular-nums" style={{ color: 'var(--aurora-text)' }}>
            +{money(totals.tax, currency)}
          </span>
        </div>
        <div
          className="mt-2 flex items-center justify-between border-t pt-2 text-[15px] font-semibold"
          style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
        >
          <span>Total credit</span>
          <span className="tabular-nums">{money(gross, currency)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Create modal ─────────────────────────────────────────────────────────────

function CreateModal({
  companies,
  onClose,
  onSaved,
}: {
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CreditNoteForm>(() => blankForm());
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof CreditNoteForm>(k: K, v: CreditNoteForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const setLine = (i: number, patch: Partial<CreditNoteFormLine>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }));
  const removeLine = (i: number) =>
    setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

  // Load customers scoped to the selected company.
  useEffect(() => {
    if (!form.companyId) {
      setCustomers([]);
      return;
    }
    let cancelled = false;
    backendList<CustomerOption>('/customers', {
      query: { companyId: form.companyId, limit: 500 },
    })
      .then((rows) => {
        if (!cancelled) setCustomers(rows);
      })
      .catch(() => {
        if (!cancelled) setCustomers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [form.companyId]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!form.companyId) {
      setError('Company is required');
      return;
    }
    if (!form.customerId && !form.customerName.trim()) {
      setError('Select a customer or enter a customer name');
      return;
    }
    if (!form.issueDate) {
      setError('Issue date is required');
      return;
    }
    if (!form.lines.length) {
      setError('Add at least one credit line');
      return;
    }
    if (form.lines.some((l) => !l.description.trim())) {
      setError('Every line needs a description');
      return;
    }
    if (form.lines.some((l) => num(l.quantity) <= 0 || num(l.unitPrice) < 0)) {
      setError('Each line needs a positive quantity and a non-negative unit price');
      return;
    }
    const total = form.lines.reduce(
      (sum, l) => sum + round2(num(l.quantity) * num(l.unitPrice)) + round2(num(l.taxAmount)),
      0,
    );
    if (round2(total) <= 0) {
      setError('The credit note total must be greater than zero');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        companyId: form.companyId,
        currency: form.currency,
        issueDate: form.issueDate,
        lines: form.lines.map((l) => ({
          description: l.description,
          quantity: num(l.quantity),
          unitPrice: num(l.unitPrice),
          taxAmount: num(l.taxAmount),
          ...(l.productId ? { productId: l.productId } : {}),
          ...(l.unitId ? { unitId: l.unitId } : {}),
        })),
      };
      if (form.customerId) body.customerId = form.customerId;
      if (form.customerName.trim()) body.customerName = form.customerName.trim();
      if (form.reason.trim()) body.reason = form.reason.trim();
      if (form.notes.trim()) body.notes = form.notes.trim();
      if (form.salesOrderId.trim()) body.salesOrderId = form.salesOrderId.trim();
      if (form.receivableId.trim()) body.receivableId = form.receivableId.trim();

      await backendPost('/credit-notes', body);
      showToast('success', 'Credit note created', 'Saved as draft — issue it to post to the ledger.');
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create credit note';
      setError(message);
      showToast('error', 'Could not create credit note', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Create Credit Note" size="xl">
      <div className="max-h-[75vh] overflow-y-auto p-5">
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
              value={form.companyId}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  companyId: e.target.value,
                  customerId: '',
                  customerName: '',
                }))
              }
              options={companies.map((c) => ({
                value: c.id,
                label: c.code ? `${c.name} (${c.code})` : c.name,
              }))}
            />
            <FormSelect
              label="Currency"
              value={form.currency}
              onChange={(e) => set('currency', e.target.value)}
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
            <FormSelect
              label="Linked Customer"
              placeholder={form.companyId ? 'Manual / unlinked customer' : 'Select company first'}
              disabled={!form.companyId}
              value={form.customerId}
              onChange={(e) => {
                const customerId = e.target.value;
                const customer = customers.find((c) => c.id === customerId);
                setForm((f) => ({
                  ...f,
                  customerId,
                  customerName: customer?.name ?? '',
                }));
              }}
              options={customers.map((c) => ({
                value: c.id,
                label: c.customerCode ? `${c.name} (${c.customerCode})` : c.name,
              }))}
            />
            <FormInput
              label="Customer Name"
              required
              disabled={Boolean(form.customerId)}
              value={form.customerName}
              onChange={(e) => set('customerName', e.target.value)}
              placeholder="Customer name (if unlinked)"
            />
            <FormInput
              label="Issue Date"
              required
              type="date"
              value={form.issueDate}
              onChange={(e) => set('issueDate', e.target.value)}
            />
            <FormInput
              label="Reason"
              value={form.reason}
              onChange={(e) => set('reason', e.target.value)}
              placeholder="e.g. Return, allowance, billing correction"
            />
            <FormInput
              label="Sales Order ID"
              help="Optional — link to the sales order this credit relates to."
              value={form.salesOrderId}
              onChange={(e) => set('salesOrderId', e.target.value)}
              placeholder="Optional sales order id"
            />
            <FormInput
              label="Receivable ID"
              help="Optional — the AR this credit offsets. Issuing reduces its outstanding."
              value={form.receivableId}
              onChange={(e) => set('receivableId', e.target.value)}
              placeholder="Optional receivable id"
            />
          </FormSection>

          <FormTextarea
            label="Notes"
            rows={2}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Optional notes…"
          />

          <LineEditor
            lines={form.lines}
            currency={form.currency}
            onAdd={addLine}
            onRemove={removeLine}
            onChange={setLine}
          />

          <FormActions
            primaryLabel="Create Draft"
            primaryType="submit"
            loading={saving}
            onSecondary={onClose}
          />
        </FormShell>
      </div>
    </Modal>
  );
}

// ─── Void modal (requires a reason) ───────────────────────────────────────────

function VoidModal({
  note,
  onClose,
  onDone,
}: {
  note: CreditNote;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!reason.trim()) {
      setError('A reason is required to void an issued credit note');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await backendPatch(`/credit-notes/${note.id}/void`, { reason: reason.trim() });
      showToast(
        'info',
        'Credit note voided',
        'A reversing journal entry was posted and any offset receivable restored.',
      );
      onDone();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to void credit note';
      setError(message);
      showToast('error', 'Could not void credit note', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Void ${note.creditNoteNumber}`}
      description="Voiding reverses the credit note's journal entry and restores any receivable it offset. This cannot be undone."
      size="md"
    >
      <div className="p-5">
        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}
        <FormShell onSubmit={handleSubmit}>
          <FormTextarea
            label="Reason"
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for voiding this credit note…"
          />
          <FormActions
            primaryLabel="Void Credit Note"
            primaryType="submit"
            primaryVariant="danger"
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
  const [detail, setDetail] = useState<CreditNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    backendGet<CreditNote>(`/credit-notes/${id}`)
      .then((next) => {
        if (!cancelled) setDetail(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load credit note');
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
      title={detail ? `Credit Note ${detail.creditNoteNumber}` : 'Credit Note'}
      description={detail ? `${detail.customerName} · ${detail.status}` : undefined}
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
            Loading credit note…
          </div>
        ) : detail ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <DetailRow label="Subtotal (net)" value={money(detail.subtotal, currency)} />
              <DetailRow label="VAT" value={money(detail.taxAmount, currency)} />
              <DetailRow label="Total" value={money(detail.totalAmount, currency)} />
              <DetailRow label="Applied to AR" value={money(detail.appliedAmount, currency)} />
              <DetailRow label="Status" value={<StatusBadge status={detail.status} />} />
              <DetailRow label="Issue Date" value={fmtDate(detail.issueDate)} />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <DetailRow label="Customer" value={detail.customer?.name ?? detail.customerName} />
              <DetailRow label="Company" value={detail.company?.name} />
              <DetailRow
                label="Division"
                value={
                  detail.division
                    ? detail.division.code
                      ? `${detail.division.code} - ${detail.division.name}`
                      : detail.division.name
                    : '—'
                }
              />
              <DetailRow
                label="Branch"
                value={
                  detail.branch
                    ? detail.branch.code
                      ? `${detail.branch.code} - ${detail.branch.name}`
                      : detail.branch.name
                    : '—'
                }
              />
              <DetailRow
                label="Sales Order"
                value={detail.salesOrder?.salesOrderNumber ?? '—'}
              />
              <DetailRow
                label="Receivable"
                value={
                  detail.receivable
                    ? detail.receivable.receivableNumber ?? detail.receivable.id.slice(0, 8)
                    : '—'
                }
              />
              <DetailRow label="Reason" value={detail.reason ?? '—'} />
              <DetailRow label="Created" value={fmtDateTime(detail.createdAt)} />
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Lines
              </h4>
              <div
                className="overflow-x-auto rounded-lg border"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr
                      className="text-left text-[11px] uppercase"
                      style={{ color: 'var(--aurora-text-muted)', background: 'var(--aurora-bg-subtle)' }}
                    >
                      <th className="px-3 py-2">Description</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Unit Price</th>
                      <th className="px-3 py-2 text-right">Net</th>
                      <th className="px-3 py-2 text-right">VAT</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.lines ?? []).map((line) => (
                      <tr key={line.id}>
                        <td className="px-3 py-2">
                          <div>{line.description ?? '—'}</div>
                          {line.product?.name && (
                            <div className="text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
                              {line.product.name}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{qty(line.quantity)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {money(line.unitPrice, currency)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {money(line.netAmount, currency)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {money(line.taxAmount, currency)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {money(line.lineTotal, currency)}
                        </td>
                      </tr>
                    ))}
                    {!detail.lines?.length && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-3 py-4 text-center text-sm"
                          style={{ color: 'var(--aurora-text-muted)' }}
                        >
                          No lines
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
                    <DetailRow
                      label="Journal #"
                      value={detail.journalEntry.journalNumber}
                    />
                    <DetailRow
                      label="Status"
                      value={<StatusBadge status={detail.journalEntry.status} />}
                    />
                    <DetailRow
                      label="Posted At"
                      value={fmtDateTime(detail.journalEntry.postedAt)}
                    />
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
                              <div className="font-mono text-[11px]">{line.account.accountCode}</div>
                              <div>{line.account.accountName}</div>
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
                  No journal entry — this credit note has not been issued yet.
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
        className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3"
        style={{ borderColor: 'var(--aurora-border)' }}
      >
        {hasPermission('receivables.view') ? (
          <DocumentArtifactButton entityType="CREDIT_NOTE" entityId={id} />
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

export default function CreditNotesPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission('receivables.view');
  const canManage = hasPermission('receivables.manage');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<CreditNotePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<CreditNote | null>(null);
  const [voiding, setVoiding] = useState<CreditNote | null>(null);
  const [issuing, setIssuing] = useState<CreditNote | null>(null);
  const [issueBusy, setIssueBusy] = useState(false);

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
      // The credit-notes list endpoint returns { items, total, page, limit,
      // totalPages }; read that shape directly rather than via backendPage.
      const result = await backendGet<CreditNotePage>('/credit-notes', {
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
        items: Array.isArray(result?.items) ? result.items : [],
        total: num(result?.total),
        page: num(result?.page) || page,
        limit: num(result?.limit) || PAGE_SIZE,
        totalPages: num(result?.totalPages) || 1,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load credit notes');
      setData({ items: [], total: 0, page, limit: PAGE_SIZE, totalPages: 1 });
    } finally {
      setLoading(false);
    }
  }, [canView, page, companyId, status, dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => data?.items ?? [], [data]);

  const stats = useMemo(() => {
    const draft = rows.filter((r) => r.status === 'DRAFT').length;
    const issued = rows.filter((r) => r.status === 'ISSUED').length;
    const issuedValue = rows
      .filter((r) => r.status === 'ISSUED')
      .reduce((sum, r) => sum + num(r.totalAmount), 0);
    return { draft, issued, issuedValue };
  }, [rows]);

  const runIssue = async () => {
    if (!issuing) return;
    setIssueBusy(true);
    try {
      await backendPatch(`/credit-notes/${issuing.id}/issue`);
      showToast(
        'success',
        'Credit note issued',
        'A balanced reversing journal entry was posted to the ledger.',
      );
      setIssuing(null);
      await load();
    } catch (err: unknown) {
      showToast(
        'error',
        'Could not issue credit note',
        err instanceof Error ? err.message : 'Please try again.',
      );
    } finally {
      setIssueBusy(false);
    }
  };

  const columns: ResponsiveColumn<CreditNote>[] = [
    {
      key: 'creditNoteNumber',
      header: 'CN #',
      priority: 1,
      accessor: (r) => <span className="font-mono text-xs">{r.creditNoteNumber}</span>,
    },
    {
      key: 'customerName',
      header: 'Customer',
      priority: 1,
      accessor: (r) => (
        <span className="font-medium">{r.customer?.name ?? r.customerName ?? '—'}</span>
      ),
    },
    {
      key: 'company',
      header: 'Company',
      priority: 3,
      accessor: (r) => <span className="text-sm">{r.company?.name ?? '—'}</span>,
    },
    {
      key: 'issueDate',
      header: 'Issue Date',
      priority: 2,
      accessor: (r) => <span className="text-sm">{fmtDate(r.issueDate)}</span>,
    },
    {
      key: 'totalAmount',
      header: 'Total',
      priority: 1,
      align: 'right',
      accessor: (r) => (
        <span className="font-medium tabular-nums">{money(r.totalAmount, r.currency)}</span>
      ),
    },
    {
      key: 'appliedAmount',
      header: 'Applied',
      priority: 3,
      align: 'right',
      accessor: (r) => <span className="tabular-nums">{money(r.appliedAmount, r.currency)}</span>,
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
          {canManage && r.status === 'DRAFT' && (
            <Btn variant="primary" size="xs" onClick={() => setIssuing(r)}>
              Issue
            </Btn>
          )}
          {canManage && r.status === 'ISSUED' && (
            <Btn variant="danger" size="xs" onClick={() => setVoiding(r)}>
              Void
            </Btn>
          )}
        </div>
      ),
    },
  ];

  if (!canView) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader title="Credit Notes" subtitle="Customer credit notes (AR reversals)" />
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
      {creating && (
        <CreateModal
          companies={companies}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            setPage(1);
            void load();
          }}
        />
      )}
      {viewing && <DetailModal id={viewing.id} onClose={() => setViewing(null)} />}
      {voiding && (
        <VoidModal
          note={voiding}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null);
            void load();
          }}
        />
      )}
      {issuing && (
        <ConfirmDialog
          open
          title={`Issue ${issuing.creditNoteNumber}?`}
          description={`This posts a balanced reversing journal entry (Dr Sales Returns & VAT, Cr Accounts Receivable) for ${money(
            issuing.totalAmount,
            issuing.currency,
          )}${issuing.receivableId ? ' and reduces the linked receivable.' : '.'}`}
          confirmLabel="Issue & Post"
          cancelLabel="Cancel"
          loading={issueBusy}
          onConfirm={runIssue}
          onClose={() => setIssuing(null)}
        />
      )}

      <PageHeader title="Credit Notes" subtitle="Customer credit notes (AR reversals)" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total" value={data?.total ?? 0} />
        <StatCard label="Draft (page)" value={stats.draft} />
        <StatCard label="Issued (page)" value={stats.issued} variant="green" />
        <StatCard label="Issued Value (page)" value={money(stats.issuedValue)} />
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
            <Btn variant="primary" onClick={() => setCreating(true)}>
              + New Credit Note
            </Btn>
          ) : undefined
        }
      />

      <ResponsiveDataTable<CreditNote>
        columns={columns}
        data={rows}
        keyField="id"
        loading={loading}
        error={error}
        onRetry={() => void load()}
        errorTitle="Could not load credit notes"
        emptyTitle="No credit notes found"
        emptyDescription={
          canManage
            ? 'Adjust your filters or create a new credit note.'
            : 'Adjust your filters or ask an administrator to create a credit note.'
        }
        exportable
        exportFileName="credit-notes"
        exportPdf={{ title: 'Credit Notes', companyId: companyId || undefined }}
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
