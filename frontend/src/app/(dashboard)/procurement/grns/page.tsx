'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Btn,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  PageToolbar,
  SkeletonTable,
  StatCard,
  StatusBadge,
  showToast,
} from '@/components/ui';
import { Stepper } from '@/components/aurora/overlays/Stepper';
import { DocumentArtifactButton } from '@/components/documents';
import { useAuth } from '@/hooks/use-auth';
import { ApiError, backendGet, backendList, backendPage, backendPost, backendPut } from '@/lib/api-client';
import { downloadTablePdf } from '@/lib/export-download';
import { downloadTextFile, rowsToCsv } from '@/lib/report-export';

interface Company {
  id: string;
  name: string;
  code?: string | null;
}

interface NamedRef {
  id: string;
  name: string;
  code?: string | null;
}

interface Grn {
  id: string;
  grnNumber: string;
  companyId: string;
  supplierId?: string | null;
  branchId?: string | null;
  receivedDate?: string | null;
  status: string;
  postedAt?: string | null;
  branch?: NamedRef | null;
  division?: NamedRef | null;
  company?: { name?: string | null; code?: string | null } | null;
  supplier?: { name?: string | null; supplierCode?: string | null } | null;
}

/** GRN line as returned by GET /goods-received-notes/:id (raw ids, Decimal strings). */
interface GrnLine {
  id: string;
  productId: string;
  unitId: string;
  orderedQuantity?: number | string | null;
  receivedQuantity?: number | string | null;
  acceptedQuantity?: number | string | null;
  rejectedQuantity?: number | string | null;
  unitCost?: number | string | null;
  condition?: string | null;
  notes?: string | null;
}

interface GrnDetail extends Grn {
  purchaseOrderId?: string | null;
  notes?: string | null;
  lines: GrnLine[];
}

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

/** Purchase order summary as returned by the PO list endpoint. */
interface PoSummary {
  id: string;
  purchaseOrderNumber: string;
  companyId: string;
  status: string;
  orderDate?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  supplier?: { id: string; name?: string | null } | null;
  company?: { name?: string | null; code?: string | null } | null;
}

/** A single line on a fetched purchase order detail. */
interface PoLine {
  id: string;
  productId: string;
  unitId: string;
  description?: string | null;
  quantity: number | string;
  unitCost?: number | string | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
  product?: { id: string; name?: string | null; sku?: string | null; productCode?: string | null } | null;
  unit?: { id: string; name?: string | null; symbol?: string | null } | null;
}

/** Full purchase order detail (subset of fields this flow needs). */
interface PoDetail extends PoSummary {
  lines: PoLine[];
}

/** Per-line receiving capture state in the wizard. */
interface ReceiveLine {
  key: string;
  productId: string;
  unitId: string;
  productLabel: string;
  unitLabel: string;
  orderedQuantity: number;
  poUnitCost?: number;
  batchNumber?: string | null;
  expiryDate?: string | null;
  /** Raw input strings so partial/empty entry doesn't fight the number parser. */
  received: string;
  rejected: string;
  unitCost: string;
  condition: string;
  notes: string;
}

/** GRN line payload matching CreateGoodsReceivedNoteLineDto. */
interface GrnLinePayload {
  productId: string;
  unitId: string;
  orderedQuantity?: number;
  receivedQuantity?: number;
  acceptedQuantity?: number;
  rejectedQuantity?: number;
  unitCost?: number;
  condition?: string;
  notes?: string;
}

/** Purchase orders in these states can still receive stock (see PO service). */
const RECEIVABLE_PO_STATUSES = ['CONFIRMED', 'PARTIALLY_RECEIVED'];

// Only states the backend can actually reach (draft → receive → approve → post).
const STATUSES = ['DRAFT', 'RECEIVED', 'APPROVED', 'POSTED'];

function toNum(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function poLineLabel(line: PoLine): string {
  const code = line.product?.productCode || line.product?.sku;
  const name = line.product?.name ?? line.description ?? 'Unknown product';
  return code ? `${code} — ${name}` : name;
}

function emptyPage<T>(page = 1): Paginated<T> {
  return { data: [], total: 0, page, totalPages: 1 };
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

const inputCls =
  'w-full text-sm border rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50';
const inputStyle = {
  borderColor: 'var(--aurora-border)',
  background: 'var(--aurora-card)',
  color: 'var(--aurora-text)',
} as const;

/* ─── Receive Goods wizard ───────────────────────────────────────────────────── */

interface ReceiveGoodsWizardProps {
  open: boolean;
  onClose: () => void;
  companies: Company[];
  /** Company filter currently applied on the list, used as the default scope. */
  defaultCompanyId?: string;
  onCreated: () => void;
}

function ReceiveGoodsWizard({
  open,
  onClose,
  companies,
  defaultCompanyId,
  onCreated,
}: ReceiveGoodsWizardProps) {
  const [step, setStep] = useState(0);
  const [companyId, setCompanyId] = useState(defaultCompanyId ?? '');
  const [poSearch, setPoSearch] = useState('');
  const [poQuery, setPoQuery] = useState('');
  const [pos, setPos] = useState<PoSummary[]>([]);
  const [posLoading, setPosLoading] = useState(false);
  const [posError, setPosError] = useState<string | null>(null);
  const [selectedPo, setSelectedPo] = useState<PoDetail | null>(null);
  const [poLoading, setPoLoading] = useState(false);
  const [lines, setLines] = useState<ReceiveLine[]>([]);
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Reset everything whenever the wizard is (re)opened.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setCompanyId(defaultCompanyId ?? '');
    setPoSearch('');
    setPoQuery('');
    setSelectedPo(null);
    setLines([]);
    setReceivedDate(new Date().toISOString().slice(0, 10));
    setNotes('');
    setFormError(null);
    setPosError(null);
  }, [open, defaultCompanyId]);

  // Debounce the PO search box.
  useEffect(() => {
    const handle = setTimeout(() => setPoQuery(poSearch), 300);
    return () => clearTimeout(handle);
  }, [poSearch]);

  // Load receivable purchase orders for the Select-PO step.
  useEffect(() => {
    if (!open || step !== 0) return;
    let cancelled = false;
    setPosLoading(true);
    setPosError(null);
    backendPage<PoSummary>('/purchase-orders', {
      query: {
        limit: 25,
        companyId: companyId || undefined,
        search: poQuery.trim() || undefined,
        // Backend accepts a single status; PARTIALLY_RECEIVED POs are fetched
        // separately below and merged so both receivable states are offered.
        status: 'CONFIRMED',
      },
    })
      .then(async (confirmed) => {
        const partial = await backendPage<PoSummary>('/purchase-orders', {
          query: {
            limit: 25,
            companyId: companyId || undefined,
            search: poQuery.trim() || undefined,
            status: 'PARTIALLY_RECEIVED',
          },
        }).catch(() => ({ data: [] as PoSummary[] }));
        if (cancelled) return;
        const merged = [...confirmed.data, ...partial.data].filter((po) =>
          RECEIVABLE_PO_STATUSES.includes(po.status),
        );
        setPos(merged);
      })
      .catch((err) => {
        if (cancelled) return;
        setPos([]);
        setPosError(err instanceof Error ? err.message : 'Failed to load purchase orders');
      })
      .finally(() => {
        if (!cancelled) setPosLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, step, companyId, poQuery]);

  const selectPo = useCallback(async (po: PoSummary) => {
    setPoLoading(true);
    setFormError(null);
    try {
      const detail = await backendGet<PoDetail>(`/purchase-orders/${po.id}`);
      setSelectedPo(detail);
      setLines(
        (detail.lines ?? []).map((line) => {
          const ordered = toNum(line.quantity);
          return {
            key: line.id,
            productId: line.productId,
            unitId: line.unitId,
            productLabel: poLineLabel(line),
            unitLabel: line.unit?.symbol || line.unit?.name || '',
            orderedQuantity: ordered,
            poUnitCost: line.unitCost != null ? toNum(line.unitCost) : undefined,
            batchNumber: line.batchNumber ?? null,
            expiryDate: line.expiryDate ?? null,
            // Default to receiving the full ordered quantity, accepted in full.
            received: ordered ? String(ordered) : '',
            rejected: '',
            unitCost: line.unitCost != null ? String(toNum(line.unitCost)) : '',
            condition: '',
            notes: '',
          } satisfies ReceiveLine;
        }),
      );
      setStep(1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to load purchase order lines');
    } finally {
      setPoLoading(false);
    }
  }, []);

  const updateLine = useCallback((key: string, patch: Partial<ReceiveLine>) => {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }, []);

  const acceptedFor = useCallback(
    (line: ReceiveLine) => Math.max(0, toNum(line.received) - toNum(line.rejected)),
    [],
  );

  const linesToSubmit = useMemo(
    () => lines.filter((line) => toNum(line.received) > 0),
    [lines],
  );

  const hasQtyError = useMemo(
    () =>
      lines.some((line) => {
        const received = toNum(line.received);
        const rejected = toNum(line.rejected);
        return received < 0 || rejected < 0 || rejected > received || toNum(line.unitCost) < 0;
      }),
    [lines],
  );

  const buildPayload = useCallback(() => {
    const payloadLines: GrnLinePayload[] = linesToSubmit.map((line) => {
      const received = toNum(line.received);
      const rejected = Math.min(received, Math.max(0, toNum(line.rejected)));
      const accepted = Math.max(0, received - rejected);
      const cost = line.unitCost.trim() === '' ? undefined : toNum(line.unitCost);
      return {
        productId: line.productId,
        unitId: line.unitId,
        orderedQuantity: line.orderedQuantity || undefined,
        receivedQuantity: received,
        acceptedQuantity: accepted,
        rejectedQuantity: rejected || undefined,
        unitCost: cost,
        condition: line.condition.trim() || undefined,
        notes: line.notes.trim() || undefined,
      };
    });
    return {
      companyId: selectedPo?.companyId || companyId || undefined,
      purchaseOrderId: selectedPo?.id,
      supplierId: selectedPo?.supplierId ?? selectedPo?.supplier?.id ?? undefined,
      receivedDate: receivedDate ? new Date(receivedDate).toISOString() : undefined,
      notes: notes.trim() || undefined,
      lines: payloadLines,
    };
  }, [companyId, linesToSubmit, notes, receivedDate, selectedPo]);

  const submit = useCallback(async () => {
    if (!selectedPo) {
      setFormError('Select a purchase order first');
      return;
    }
    if (linesToSubmit.length === 0) {
      setFormError('Enter a received quantity on at least one line');
      return;
    }
    if (hasQtyError) {
      setFormError('Check the quantities — rejected cannot exceed received and values must be positive');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const created = await backendPost<{ grnNumber?: string }>(
        '/goods-received-notes',
        buildPayload(),
      );
      showToast(
        'success',
        'Goods received note created',
        created?.grnNumber
          ? `Draft ${created.grnNumber} created — approve then post to receive into inventory.`
          : 'Draft created — approve then post to receive into inventory.',
      );
      onCreated();
      onClose();
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to create goods received note';
      setFormError(message);
      showToast('error', 'Could not create GRN', message);
    } finally {
      setSubmitting(false);
    }
  }, [buildPayload, hasQtyError, linesToSubmit.length, onClose, onCreated, selectedPo]);

  const steps = useMemo(
    () => [
      { key: 'po', title: 'Select PO', description: 'Choose an order to receive against' },
      { key: 'qty', title: 'Received quantities', description: 'Capture what arrived' },
      { key: 'review', title: 'Review & submit', description: 'Confirm and create the GRN' },
    ],
    [],
  );

  const companyName = (id?: string | null) =>
    companies.find((company) => company.id === id)?.name ?? id ?? '—';

  return (
    <Modal open={open} onClose={onClose} title="Receive Goods" size="3xl">
      <Stepper
        steps={steps}
        current={step}
        allowStepNavigation
        hideFooter
        onStepChange={setStep}
      >
        {(ctx) => (
          <div className="space-y-5">
            {formError && <ErrorState message={formError} />}

            {/* ── Step 1: Select PO ── */}
            {ctx.index === 0 && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span
                      className="mb-1 block text-xs font-medium"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      Company
                    </span>
                    <select
                      value={companyId}
                      onChange={(event) => setCompanyId(event.target.value)}
                      className={inputCls}
                      style={inputStyle}
                    >
                      <option value="">All companies</option>
                      {companies.map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span
                      className="mb-1 block text-xs font-medium"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      Search
                    </span>
                    <input
                      type="text"
                      value={poSearch}
                      onChange={(event) => setPoSearch(event.target.value)}
                      placeholder="PO number or supplier…"
                      className={inputCls}
                      style={inputStyle}
                    />
                  </label>
                </div>

                <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                  Showing confirmed and partially-received purchase orders that can still receive
                  stock.
                </p>

                <div
                  className="overflow-hidden rounded-lg border"
                  style={{ borderColor: 'var(--aurora-border)' }}
                >
                  <div className="max-h-72 overflow-y-auto">
                    {posError ? (
                      <div className="p-4">
                        <ErrorState message={posError} />
                      </div>
                    ) : posLoading ? (
                      <SkeletonTable rows={4} cols={4} />
                    ) : pos.length === 0 ? (
                      <EmptyState
                        title="No receivable purchase orders"
                        description="Confirm a purchase order before receiving goods against it."
                      />
                    ) : (
                      <table className="w-full text-sm">
                        <caption className="sr-only">Receivable purchase orders</caption>
                        <thead>
                          <tr
                            className="text-left text-xs uppercase"
                            style={{ color: 'var(--aurora-text-muted)' }}
                          >
                            <th scope="col" className="px-3 py-2">
                              PO #
                            </th>
                            <th scope="col" className="px-3 py-2">
                              Supplier
                            </th>
                            <th scope="col" className="px-3 py-2">
                              Status
                            </th>
                            <th scope="col" className="px-3 py-2 text-right">
                              Action
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {pos.map((po) => (
                            <tr key={po.id} className="hover:bg-slate-50">
                              <td className="px-3 py-2 font-mono text-xs">
                                {po.purchaseOrderNumber}
                              </td>
                              <td className="px-3 py-2">
                                {po.supplier?.name ?? po.supplierName ?? '—'}
                              </td>
                              <td className="px-3 py-2">
                                <StatusBadge status={po.status} />
                              </td>
                              <td className="px-3 py-2 text-right">
                                <Btn
                                  variant={selectedPo?.id === po.id ? 'primary' : 'secondary'}
                                  size="xs"
                                  loading={poLoading && selectedPo?.id !== po.id}
                                  onClick={() => void selectPo(po)}
                                >
                                  {selectedPo?.id === po.id ? 'Selected' : 'Select'}
                                </Btn>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 2: Received quantities ── */}
            {ctx.index === 1 && selectedPo && (
              <div className="space-y-4">
                <div
                  className="rounded-lg border px-4 py-3 text-sm"
                  style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}
                >
                  <span className="font-medium">{selectedPo.purchaseOrderNumber}</span>
                  <span style={{ color: 'var(--aurora-text-muted)' }}>
                    {' '}
                    · {selectedPo.supplier?.name ?? selectedPo.supplierName ?? 'No supplier'} ·{' '}
                    {companyName(selectedPo.companyId)}
                  </span>
                </div>

                {lines.length === 0 ? (
                  <EmptyState
                    title="This purchase order has no lines"
                    description="Nothing to receive against this order."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px] text-sm">
                      <caption className="sr-only">Receiving lines</caption>
                      <thead>
                        <tr
                          className="text-left text-xs uppercase"
                          style={{ color: 'var(--aurora-text-muted)' }}
                        >
                          <th scope="col" className="px-2 py-2">
                            Product
                          </th>
                          <th scope="col" className="px-2 py-2 text-right">
                            Ordered
                          </th>
                          <th scope="col" className="px-2 py-2 text-right">
                            Received
                          </th>
                          <th scope="col" className="px-2 py-2 text-right">
                            Rejected
                          </th>
                          <th scope="col" className="px-2 py-2 text-right">
                            Accepted
                          </th>
                          <th scope="col" className="px-2 py-2 text-right">
                            Unit cost (TZS)
                          </th>
                          <th scope="col" className="px-2 py-2">
                            Condition
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {lines.map((line) => {
                          const received = toNum(line.received);
                          const rejected = toNum(line.rejected);
                          const rejectInvalid = rejected > received || rejected < 0;
                          return (
                            <tr key={line.key}>
                              <td className="px-2 py-2">
                                <div className="font-medium">{line.productLabel}</div>
                                {line.unitLabel && (
                                  <div
                                    className="text-xs"
                                    style={{ color: 'var(--aurora-text-muted)' }}
                                  >
                                    Unit: {line.unitLabel}
                                    {line.batchNumber ? ` · Batch ${line.batchNumber}` : ''}
                                    {line.expiryDate ? ` · Exp ${formatDate(line.expiryDate)}` : ''}
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums">
                                {line.orderedQuantity}
                              </td>
                              <td className="px-2 py-2">
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  inputMode="decimal"
                                  aria-label={`Received quantity for ${line.productLabel}`}
                                  value={line.received}
                                  onChange={(event) =>
                                    updateLine(line.key, { received: event.target.value })
                                  }
                                  className={`${inputCls} text-right`}
                                  style={inputStyle}
                                />
                              </td>
                              <td className="px-2 py-2">
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  inputMode="decimal"
                                  aria-label={`Rejected quantity for ${line.productLabel}`}
                                  value={line.rejected}
                                  onChange={(event) =>
                                    updateLine(line.key, { rejected: event.target.value })
                                  }
                                  className={`${inputCls} text-right`}
                                  style={{
                                    ...inputStyle,
                                    borderColor: rejectInvalid
                                      ? 'var(--aurora-danger, #dc2626)'
                                      : 'var(--aurora-border)',
                                  }}
                                />
                              </td>
                              <td className="px-2 py-2 text-right font-medium tabular-nums">
                                {acceptedFor(line)}
                              </td>
                              <td className="px-2 py-2">
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  inputMode="decimal"
                                  aria-label={`Unit cost for ${line.productLabel}`}
                                  value={line.unitCost}
                                  onChange={(event) =>
                                    updateLine(line.key, { unitCost: event.target.value })
                                  }
                                  className={`${inputCls} text-right`}
                                  style={inputStyle}
                                />
                              </td>
                              <td className="px-2 py-2">
                                <input
                                  type="text"
                                  aria-label={`Condition for ${line.productLabel}`}
                                  value={line.condition}
                                  placeholder="Good"
                                  onChange={(event) =>
                                    updateLine(line.key, { condition: event.target.value })
                                  }
                                  className={inputCls}
                                  style={inputStyle}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                  Accepted is received minus rejected. Unit cost defaults to the PO cost; override to
                  capture the landed cost. Lines with a received quantity of 0 are skipped.
                </p>
              </div>
            )}

            {/* ── Step 3: Review & submit ── */}
            {ctx.index === 2 && selectedPo && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span
                      className="mb-1 block text-xs font-medium"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      Received date
                    </span>
                    <input
                      type="date"
                      value={receivedDate}
                      onChange={(event) => setReceivedDate(event.target.value)}
                      className={inputCls}
                      style={inputStyle}
                    />
                  </label>
                  <div className="block">
                    <span
                      className="mb-1 block text-xs font-medium"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      Purchase order
                    </span>
                    <div className="text-sm">
                      <span className="font-mono">{selectedPo.purchaseOrderNumber}</span>{' '}
                      <span style={{ color: 'var(--aurora-text-muted)' }}>
                        · {selectedPo.supplier?.name ?? selectedPo.supplierName ?? 'No supplier'}
                      </span>
                    </div>
                  </div>
                </div>

                <label className="block">
                  <span
                    className="mb-1 block text-xs font-medium"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    Notes (optional)
                  </span>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={2}
                    placeholder="Delivery reference, inspector remarks…"
                    className={inputCls}
                    style={inputStyle}
                  />
                </label>

                {linesToSubmit.length === 0 ? (
                  <EmptyState
                    title="No quantities entered"
                    description="Go back and enter a received quantity on at least one line."
                  />
                ) : (
                  <div
                    className="overflow-hidden rounded-lg border"
                    style={{ borderColor: 'var(--aurora-border)' }}
                  >
                    <table className="w-full text-sm">
                      <caption className="sr-only">Lines to receive</caption>
                      <thead>
                        <tr
                          className="text-left text-xs uppercase"
                          style={{ color: 'var(--aurora-text-muted)' }}
                        >
                          <th scope="col" className="px-3 py-2">
                            Product
                          </th>
                          <th scope="col" className="px-3 py-2 text-right">
                            Received
                          </th>
                          <th scope="col" className="px-3 py-2 text-right">
                            Accepted
                          </th>
                          <th scope="col" className="px-3 py-2 text-right">
                            Rejected
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {linesToSubmit.map((line) => (
                          <tr key={line.key}>
                            <td className="px-3 py-2">{line.productLabel}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {toNum(line.received)} {line.unitLabel}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {acceptedFor(line)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {toNum(line.rejected)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                  This creates a DRAFT goods received note. Approve then post it to move accepted
                  quantities into inventory.
                </p>
              </div>
            )}

            {/* ── Footer navigation (custom to drive submit) ── */}
            <div
              className="mt-6 flex items-center justify-between gap-3 border-t pt-4"
              style={{ borderColor: 'var(--aurora-border)' }}
            >
              <Btn
                variant="ghost"
                onClick={ctx.isFirst ? onClose : ctx.back}
                disabled={submitting}
              >
                {ctx.isFirst ? 'Cancel' : 'Back'}
              </Btn>
              {ctx.index === 0 ? (
                <Btn
                  variant="primary"
                  onClick={ctx.next}
                  disabled={!selectedPo || poLoading}
                >
                  Next
                </Btn>
              ) : ctx.index === 1 ? (
                <Btn
                  variant="primary"
                  onClick={ctx.next}
                  disabled={linesToSubmit.length === 0 || hasQtyError}
                >
                  Review
                </Btn>
              ) : (
                <Btn
                  variant="primary"
                  onClick={() => void submit()}
                  loading={submitting}
                  disabled={linesToSubmit.length === 0 || hasQtyError}
                >
                  Create GRN
                </Btn>
              )}
            </div>
          </div>
        )}
      </Stepper>
    </Modal>
  );
}

/* ─── GRN detail & edit modals ──────────────────────────────────────────────── */

interface GrnLineLabels {
  byProduct: Record<string, string>;
  byUnit: Record<string, string>;
}

/**
 * Loads a GRN with its lines. Line rows only carry product/unit ids, so the
 * linked purchase order (when present) supplies human-readable labels — the
 * same source the receive wizard uses.
 */
function useGrnDetail(grnId: string | null) {
  const [detail, setDetail] = useState<GrnDetail | null>(null);
  const [labels, setLabels] = useState<GrnLineLabels>({ byProduct: {}, byUnit: {} });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!grnId) {
      setDetail(null);
      setLabels({ byProduct: {}, byUnit: {} });
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    backendGet<GrnDetail>(`/goods-received-notes/${grnId}`)
      .then(async (item) => {
        const byProduct: Record<string, string> = {};
        const byUnit: Record<string, string> = {};
        if (item.purchaseOrderId) {
          try {
            const po = await backendGet<PoDetail>(`/purchase-orders/${item.purchaseOrderId}`);
            for (const line of po.lines ?? []) {
              byProduct[line.productId] = poLineLabel(line);
              const unitLabel = line.unit?.symbol || line.unit?.name;
              if (unitLabel) byUnit[line.unitId] = unitLabel;
            }
          } catch {
            // Labels are cosmetic — fall back to raw ids if the PO is unreadable.
          }
        }
        if (cancelled) return;
        setDetail(item);
        setLabels({ byProduct, byUnit });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load goods received note');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [grnId]);

  return { detail, labels, loading, error };
}

interface GrnDetailModalProps {
  grn: Grn | null;
  onClose: () => void;
  companyLabel: (grn: Grn) => string;
  /** grn.view — mirrors the backend permission on POST /generated-documents/pdf sources. */
  canGeneratePdf: boolean;
}

function GrnDetailModal({ grn, onClose, companyLabel, canGeneratePdf }: GrnDetailModalProps) {
  const { detail, labels, loading, error } = useGrnDetail(grn?.id ?? null);
  const lines = detail?.lines ?? [];

  const field = (label: string, value: ReactNode) => (
    <div>
      <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--aurora-text-muted)' }}>
        {label}
      </span>
      <div className="text-sm">{value}</div>
    </div>
  );

  return (
    <Modal
      open={grn !== null}
      onClose={onClose}
      title={grn ? `GRN ${grn.grnNumber}` : 'Goods Received Note'}
      size="2xl"
      footer={
        <>
          {grn && canGeneratePdf && (
            <div className="mr-auto">
              <DocumentArtifactButton entityType="GOODS_RECEIVED_NOTE" entityId={grn.id} />
            </div>
          )}
          <Btn variant="secondary" onClick={onClose}>
            Close
          </Btn>
        </>
      }
    >
      {error ? (
        <ErrorState message={error} />
      ) : loading || !grn || !detail ? (
        <SkeletonTable rows={4} cols={4} />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            {field('Status', <StatusBadge status={detail.status} />)}
            {field('Company', companyLabel(grn))}
            {field('Supplier', grn.supplier?.name ?? grn.supplierId ?? '—')}
            {field('Branch / Location', detail.branch?.name ?? '—')}
            {field('Received date', formatDate(detail.receivedDate))}
            {field('Posted at', formatDate(detail.postedAt))}
          </div>

          {detail.notes && (
            <div>
              <span
                className="mb-1 block text-xs font-medium"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                Notes
              </span>
              <p className="whitespace-pre-wrap text-sm">{detail.notes}</p>
            </div>
          )}

          {lines.length === 0 ? (
            <EmptyState
              title="No line items"
              description="This goods received note has no lines."
            />
          ) : (
            <div
              className="overflow-hidden rounded-lg border"
              style={{ borderColor: 'var(--aurora-border)' }}
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <caption className="sr-only">Goods received note lines</caption>
                  <thead>
                    <tr
                      className="text-left text-xs uppercase"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      <th scope="col" className="px-3 py-2">
                        Product
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Ordered
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Received
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Accepted
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Rejected
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Unit cost (TZS)
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Condition
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((line) => (
                      <tr key={line.id}>
                        <td className="px-3 py-2">
                          <div className="font-medium">
                            {labels.byProduct[line.productId] ?? line.productId}
                          </div>
                          {labels.byUnit[line.unitId] && (
                            <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                              Unit: {labels.byUnit[line.unitId]}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {line.orderedQuantity != null ? toNum(line.orderedQuantity) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {toNum(line.receivedQuantity)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {toNum(line.acceptedQuantity)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {toNum(line.rejectedQuantity)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {line.unitCost != null ? toNum(line.unitCost).toLocaleString() : '—'}
                        </td>
                        <td className="px-3 py-2">{line.condition ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Editable per-line state for the DRAFT edit modal (raw input strings, like the wizard). */
interface EditLineState {
  key: string;
  productId: string;
  unitId: string;
  orderedQuantity?: number;
  productLabel: string;
  unitLabel: string;
  received: string;
  rejected: string;
  unitCost: string;
  condition: string;
  notes: string | null;
}

interface GrnEditModalProps {
  grn: Grn | null;
  onClose: () => void;
  onSaved: () => void;
}

function GrnEditModal({ grn, onClose, onSaved }: GrnEditModalProps) {
  const { detail, labels, loading, error } = useGrnDetail(grn?.id ?? null);
  const [receivedDate, setReceivedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<EditLineState[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Seed the form whenever a (re)loaded GRN arrives.
  useEffect(() => {
    setFormError(null);
    setReceivedDate(detail?.receivedDate ? detail.receivedDate.slice(0, 10) : '');
    setNotes(detail?.notes ?? '');
    setLines(
      (detail?.lines ?? []).map((line) => ({
        key: line.id,
        productId: line.productId,
        unitId: line.unitId,
        orderedQuantity: line.orderedQuantity != null ? toNum(line.orderedQuantity) : undefined,
        productLabel: labels.byProduct[line.productId] ?? line.productId,
        unitLabel: labels.byUnit[line.unitId] ?? '',
        received: String(toNum(line.receivedQuantity)),
        rejected: toNum(line.rejectedQuantity) ? String(toNum(line.rejectedQuantity)) : '',
        unitCost: line.unitCost != null ? String(toNum(line.unitCost)) : '',
        condition: line.condition ?? '',
        notes: line.notes ?? null,
      })),
    );
  }, [detail, labels]);

  const updateLine = useCallback((key: string, patch: Partial<EditLineState>) => {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }, []);

  const hasQtyError = useMemo(
    () =>
      lines.some((line) => {
        const received = toNum(line.received);
        const rejected = toNum(line.rejected);
        return received < 0 || rejected < 0 || rejected > received || toNum(line.unitCost) < 0;
      }),
    [lines],
  );

  // Mirrors the service guard: only DRAFT GRNs can be edited.
  const editable = detail?.status === 'DRAFT';

  const submit = useCallback(async () => {
    if (!grn || !detail) return;
    if (hasQtyError) {
      setFormError(
        'Check the quantities — rejected cannot exceed received and values must be positive',
      );
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await backendPut(`/goods-received-notes/${grn.id}`, {
        receivedDate: receivedDate ? new Date(receivedDate).toISOString() : undefined,
        notes: notes.trim() ? notes.trim() : null,
        // The backend replaces lines wholesale, so every line is sent back with
        // its product/unit unchanged (products come from the linked PO).
        lines: lines.map((line) => {
          const received = toNum(line.received);
          const rejected = Math.min(received, Math.max(0, toNum(line.rejected)));
          return {
            productId: line.productId,
            unitId: line.unitId,
            orderedQuantity: line.orderedQuantity,
            receivedQuantity: received,
            acceptedQuantity: Math.max(0, received - rejected),
            rejectedQuantity: rejected,
            unitCost: line.unitCost.trim() === '' ? undefined : toNum(line.unitCost),
            condition: line.condition.trim() || undefined,
            notes: line.notes ?? undefined,
          };
        }),
      });
      showToast('success', 'Goods received note updated', `Draft ${grn.grnNumber} saved.`);
      onSaved();
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to update goods received note';
      setFormError(message);
    } finally {
      setSaving(false);
    }
  }, [detail, grn, hasQtyError, lines, notes, onSaved, receivedDate]);

  return (
    <Modal
      open={grn !== null}
      onClose={onClose}
      title={grn ? `Edit GRN ${grn.grnNumber}` : 'Edit Goods Received Note'}
      size="3xl"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Btn>
          <Btn
            variant="primary"
            onClick={() => void submit()}
            loading={saving}
            disabled={loading || !detail || !editable || hasQtyError}
          >
            Save Changes
          </Btn>
        </>
      }
    >
      {error ? (
        <ErrorState message={error} />
      ) : loading || !detail ? (
        <SkeletonTable rows={4} cols={4} />
      ) : (
        <div className="space-y-4">
          {formError && <ErrorState message={formError} />}
          {!editable && <ErrorState message="Only DRAFT goods received notes can be edited." />}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span
                className="mb-1 block text-xs font-medium"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                Received date
              </span>
              <input
                type="date"
                value={receivedDate}
                onChange={(event) => setReceivedDate(event.target.value)}
                className={inputCls}
                style={inputStyle}
                disabled={!editable}
              />
            </label>
            <label className="block">
              <span
                className="mb-1 block text-xs font-medium"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                Notes (optional)
              </span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                placeholder="Delivery reference, inspector remarks…"
                className={inputCls}
                style={inputStyle}
                disabled={!editable}
              />
            </label>
          </div>

          {lines.length === 0 ? (
            <EmptyState
              title="No line items"
              description="This goods received note has no lines."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <caption className="sr-only">Goods received note lines</caption>
                <thead>
                  <tr
                    className="text-left text-xs uppercase"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    <th scope="col" className="px-2 py-2">
                      Product
                    </th>
                    <th scope="col" className="px-2 py-2 text-right">
                      Ordered
                    </th>
                    <th scope="col" className="px-2 py-2 text-right">
                      Received
                    </th>
                    <th scope="col" className="px-2 py-2 text-right">
                      Rejected
                    </th>
                    <th scope="col" className="px-2 py-2 text-right">
                      Accepted
                    </th>
                    <th scope="col" className="px-2 py-2 text-right">
                      Unit cost (TZS)
                    </th>
                    <th scope="col" className="px-2 py-2">
                      Condition
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((line) => {
                    const received = toNum(line.received);
                    const rejected = toNum(line.rejected);
                    const rejectInvalid = rejected > received || rejected < 0;
                    return (
                      <tr key={line.key}>
                        <td className="px-2 py-2">
                          <div className="font-medium">{line.productLabel}</div>
                          {line.unitLabel && (
                            <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                              Unit: {line.unitLabel}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {line.orderedQuantity ?? '—'}
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            aria-label={`Received quantity for ${line.productLabel}`}
                            value={line.received}
                            onChange={(event) =>
                              updateLine(line.key, { received: event.target.value })
                            }
                            className={`${inputCls} text-right`}
                            style={inputStyle}
                            disabled={!editable}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            aria-label={`Rejected quantity for ${line.productLabel}`}
                            value={line.rejected}
                            onChange={(event) =>
                              updateLine(line.key, { rejected: event.target.value })
                            }
                            className={`${inputCls} text-right`}
                            style={{
                              ...inputStyle,
                              borderColor: rejectInvalid
                                ? 'var(--aurora-danger, #dc2626)'
                                : 'var(--aurora-border)',
                            }}
                            disabled={!editable}
                          />
                        </td>
                        <td className="px-2 py-2 text-right font-medium tabular-nums">
                          {Math.max(0, received - rejected)}
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            aria-label={`Unit cost for ${line.productLabel}`}
                            value={line.unitCost}
                            onChange={(event) =>
                              updateLine(line.key, { unitCost: event.target.value })
                            }
                            className={`${inputCls} text-right`}
                            style={inputStyle}
                            disabled={!editable}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            aria-label={`Condition for ${line.productLabel}`}
                            value={line.condition}
                            placeholder="Good"
                            onChange={(event) =>
                              updateLine(line.key, { condition: event.target.value })
                            }
                            className={inputCls}
                            style={inputStyle}
                            disabled={!editable}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            Accepted is received minus rejected. Line products come from the linked purchase order
            and cannot be changed here.
          </p>
        </div>
      )}
    </Modal>
  );
}

export default function GRNsPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission('grn.list');
  // Permission codes mirror goods-received-notes.controller.ts (grn.view / grn.update).
  const canViewDetail = hasPermission('grn.view');
  const canUpdate = hasPermission('grn.update');
  const canApprove = hasPermission('grn.approve');
  const canPost = hasPermission('grn.post');
  const canCreate = hasPermission('grn.create');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<Grn> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ grn: Grn; action: 'approve' | 'post' } | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [detailGrn, setDetailGrn] = useState<Grn | null>(null);
  const [editGrn, setEditGrn] = useState<Grn | null>(null);

  const companyNameById = useMemo(() => {
    const map = new Map<string, string>();
    companies.forEach((company) => map.set(company.id, company.name));
    return map;
  }, [companies]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    backendList<Company>('/companies', { query: { limit: 100 } })
      .then((items) => {
        if (!cancelled) setCompanies(items);
      })
      .catch(() => {
        if (!cancelled) setCompanies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canView]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await backendPage<Grn>('/goods-received-notes', {
        query: {
          page,
          limit: 20,
          companyId: companyId || undefined,
          status: status || undefined,
          search: search.trim() || undefined,
        },
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load goods received notes');
      setData(emptyPage<Grn>(page));
    } finally {
      setLoading(false);
    }
  }, [canView, companyId, page, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    async (grn: Grn, action: 'approve' | 'post') => {
      setBusyId(grn.id);
      setError(null);
      try {
        await backendPost(`/goods-received-notes/${grn.id}/${action}`);
        setPending(null);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action failed');
        await load();
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Goods Received Notes" subtitle="Record and track goods received from suppliers" />
        <Card className="mt-6">
          <div className="px-6 py-12 text-center">
            <p className="text-[15px] font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
              Access Restricted
            </p>
            <p className="mt-1 text-[13px]" style={{ color: 'var(--aurora-text-muted)' }}>
              You do not have permission to view goods received notes.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  const grns = data?.data ?? [];
  const draftCount = grns.filter((grn) => grn.status === 'DRAFT').length;
  const approvedCount = grns.filter((grn) => grn.status === 'APPROVED').length;
  const postedCount = grns.filter((grn) => grn.status === 'POSTED').length;

  const buildExportRows = () =>
    grns.map((grn) => ({
      'GRN #': grn.grnNumber,
      Company: grn.company?.name ?? companyNameById.get(grn.companyId) ?? grn.companyId,
      Supplier: grn.supplier?.name ?? grn.supplierId ?? '',
      'Branch / Location': grn.branch?.name ?? '',
      'Received Date': formatDate(grn.receivedDate),
      Status: grn.status,
      'Posted At': formatDate(grn.postedAt),
    }));

  const exportCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(
      `goods-received-notes-${stamp}.csv`,
      'text/csv;charset=utf-8',
      rowsToCsv(buildExportRows()),
    );
  };

  const exportPdf = async () => {
    setExportingPdf(true);
    try {
      const rows = buildExportRows();
      const filters = [
        companyId ? companyNameById.get(companyId) ?? companyId : 'All companies',
        status ? status.replace(/_/g, ' ') : 'All statuses',
        search.trim() ? `Search: ${search.trim()}` : null,
      ].filter(Boolean);
      await downloadTablePdf({
        title: 'Goods Received Notes',
        subtitle: filters.join(' · '),
        companyId: companyId || undefined,
        columns: Object.keys(rows[0] ?? {}),
        rows: rows.map((row) => Object.values(row)),
        baseName: 'goods-received-notes',
      });
    } catch (err) {
      showToast(
        'error',
        'PDF export failed',
        err instanceof Error ? err.message : 'PDF export failed',
      );
    } finally {
      setExportingPdf(false);
    }
  };

  const filterSelectCls =
    'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = {
    borderColor: 'var(--aurora-border)',
    background: 'var(--aurora-card)',
    color: 'var(--aurora-text)',
  } as const;

  const companyLabel = (grn: Grn) =>
    grn.company?.name ?? companyNameById.get(grn.companyId) ?? grn.companyId;
  const supplierLabel = (grn: Grn) => grn.supplier?.name ?? grn.supplierId ?? '—';
  const branchLabel = (grn: Grn) => grn.branch?.name ?? '—';

  return (
    <div className="p-6 space-y-6">
      {canCreate && (
        <ReceiveGoodsWizard
          open={receiveOpen}
          onClose={() => setReceiveOpen(false)}
          companies={companies}
          defaultCompanyId={companyId || undefined}
          onCreated={() => void load()}
        />
      )}

      <GrnDetailModal
        grn={detailGrn}
        onClose={() => setDetailGrn(null)}
        companyLabel={companyLabel}
        canGeneratePdf={canViewDetail}
      />

      {canUpdate && (
        <GrnEditModal
          grn={editGrn}
          onClose={() => setEditGrn(null)}
          onSaved={() => {
            setEditGrn(null);
            void load();
          }}
        />
      )}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.action === 'post' ? 'Post goods received note' : 'Approve goods received note'}
        message={
          pending?.action === 'post'
            ? `Post GRN ${pending?.grn.grnNumber}? This receives the accepted quantities into inventory and cannot be undone.`
            : `Approve GRN ${pending?.grn.grnNumber}? Only DRAFT notes can be approved.`
        }
        confirmLabel={pending?.action === 'post' ? 'Post' : 'Approve'}
        variant={pending?.action === 'post' ? 'warning' : 'default'}
        loading={pending ? busyId === pending.grn.id : false}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) void runAction(pending.grn, pending.action);
        }}
      />

      <PageHeader
        title="Goods Received Notes"
        subtitle="Record and track goods received from suppliers"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Notes" value={data?.total ?? 0} />
        <StatCard label="Draft" value={draftCount} />
        <StatCard label="Approved" value={approvedCount} />
        <StatCard label="Posted" value={postedCount} />
      </div>

      <PageToolbar
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search GRN number or supplier..."
        filters={
          <>
            <select
              aria-label="Filter by company"
              value={companyId}
              onChange={(event) => {
                setCompanyId(event.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Companies</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Statuses</option>
              {STATUSES.map((item) => (
                <option key={item} value={item}>
                  {item.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </>
        }
        actions={
          <>
            <Btn variant="secondary" onClick={exportCsv} disabled={!grns.length}>
              Export CSV
            </Btn>
            <Btn
              variant="secondary"
              onClick={() => void exportPdf()}
              disabled={!grns.length}
              loading={exportingPdf}
            >
              Export PDF
            </Btn>
            {canCreate && (
              <Btn variant="primary" onClick={() => setReceiveOpen(true)}>
                Receive Goods
              </Btn>
            )}
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <caption className="sr-only">Goods received notes</caption>
            <thead>
              <tr
                className="text-left text-xs uppercase"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th scope="col" className="px-4 py-3">
                  GRN #
                </th>
                <th scope="col" className="px-4 py-3">
                  Company
                </th>
                <th scope="col" className="px-4 py-3">
                  Supplier
                </th>
                <th scope="col" className="px-4 py-3">
                  Branch / Location
                </th>
                <th scope="col" className="px-4 py-3">
                  Received Date
                </th>
                <th scope="col" className="px-4 py-3">
                  Status
                </th>
                <th scope="col" className="px-4 py-3">
                  Posted At
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <SkeletonTable rows={6} cols={8} />
                  </td>
                </tr>
              ) : !grns.length ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title="No goods received notes"
                      description="Records will appear here once goods are received from suppliers."
                    />
                  </td>
                </tr>
              ) : (
                grns.map((grn) => (
                  <tr key={grn.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">{grn.grnNumber}</td>
                    <td className="px-4 py-3">{companyLabel(grn)}</td>
                    <td className="px-4 py-3">{supplierLabel(grn)}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--aurora-text-muted)' }}>
                      {branchLabel(grn)}
                    </td>
                    <td className="px-4 py-3">{formatDate(grn.receivedDate)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={grn.status} />
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--aurora-text-muted)' }}>
                      {formatDate(grn.postedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {canViewDetail && (
                          <Btn variant="ghost" size="xs" onClick={() => setDetailGrn(grn)}>
                            View
                          </Btn>
                        )}
                        {canUpdate && grn.status === 'DRAFT' && (
                          <Btn variant="secondary" size="xs" onClick={() => setEditGrn(grn)}>
                            Edit
                          </Btn>
                        )}
                        {canApprove && grn.status === 'DRAFT' && (
                          <Btn
                            variant="secondary"
                            size="xs"
                            loading={busyId === grn.id}
                            onClick={() => setPending({ grn, action: 'approve' })}
                          >
                            Approve
                          </Btn>
                        )}
                        {canPost && grn.status === 'APPROVED' && (
                          <Btn
                            variant="primary"
                            size="xs"
                            loading={busyId === grn.id}
                            onClick={() => setPending({ grn, action: 'post' })}
                          >
                            Post
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
            className="flex items-center justify-between border-t px-5 py-3"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Page {data.page} of {data.totalPages} - {data.total} total
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
