'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Btn,
  Card,
  ConfirmDialog,
  EmptyState,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
  PageHeader,
  PageToolbar,
  SkeletonTable,
  StatCard,
  StatusBadge,
  showToast,
} from '@/components/ui';
import { DocumentArtifactButton } from '@/components/documents';
import { useAuth } from '@/hooks/use-auth';
import {
  backendGet,
  backendList,
  backendPage,
  backendPatch,
  backendPost,
  backendPut,
} from '@/lib/api-client';
import { downloadTextFile, rowsToCsv } from '@/lib/report-export';
import { downloadTablePdf } from '@/lib/export-download';

interface Company {
  id: string;
  name: string;
  code: string;
}

interface Supplier {
  id: string;
  name: string;
  supplierCode?: string | null;
}

interface Unit {
  id: string;
  name: string;
  symbol: string;
}

interface PurchaseOrderLine {
  id: string;
  productId?: string | null;
  description?: string | null;
  quantity: number | string;
  unitId?: string | null;
  unitCost: number | string;
  discountAmount?: number | string | null;
  taxAmount?: number | string | null;
  lineTotal?: number | string | null;
  product?: { name?: string | null } | null;
  unit?: Unit | null;
}

interface PurchaseOrder {
  id: string;
  purchaseOrderNumber: string;
  companyId: string;
  supplierId?: string | null;
  status: string;
  currency: string;
  totalAmount: number | string;
  lines?: PurchaseOrderLine[];
}

interface GrnLine {
  id: string;
  productId?: string | null;
  acceptedQuantity: number | string;
  receivedQuantity: number | string;
  unitId?: string | null;
}

interface GoodsReceivedNote {
  id: string;
  grnNumber: string;
  companyId: string;
  supplierId: string;
  purchaseOrderId?: string | null;
  status: string;
  lines?: GrnLine[];
}

interface SupplierInvoiceLine {
  id?: string;
  productId?: string | null;
  description: string;
  quantity: number | string;
  unitId?: string | null;
  unitPrice: number | string;
  taxAmount: number | string;
  discountAmount: number | string;
  lineTotal: number | string;
}

export interface SupplierInvoice {
  id: string;
  supplierInvoiceNumber: string;
  companyId: string;
  supplierId: string;
  purchaseOrderId?: string | null;
  goodsReceivedNoteId?: string | null;
  invoiceDate: string;
  dueDate?: string | null;
  invoiceReference?: string | null;
  subtotal: number | string;
  taxAmount: number | string;
  discountAmount: number | string;
  totalAmount: number | string;
  paidAmount: number | string;
  outstandingAmount: number | string;
  currency: string;
  status: string;
  notes?: string | null;
  lines?: SupplierInvoiceLine[];
  company?: { name: string; code?: string | null } | null;
  supplier?: { name: string; supplierCode?: string | null } | null;
  purchaseOrder?: { id: string; purchaseOrderNumber: string; status: string } | null;
  goodsReceivedNote?: { id: string; grnNumber: string; status: string } | null;
  payable?: {
    id: string;
    payableNumber: string;
    status: string;
    outstandingAmount: number | string;
  } | null;
  latestMatch?: {
    id: string;
    matchNumber: string;
    matchStatus: string;
    quantityVariance: number | string;
    amountVariance: number | string;
  } | null;
}

interface InvoiceLineForm {
  productId: string;
  description: string;
  quantity: string;
  unitId: string;
  unitPrice: string;
  discountAmount: string;
  taxAmount: string;
}

interface InvoiceForm {
  companyId: string;
  supplierId: string;
  supplierInvoiceNumber: string;
  purchaseOrderId: string;
  goodsReceivedNoteId: string;
  invoiceDate: string;
  dueDate: string;
  invoiceReference: string;
  currency: string;
  notes: string;
  lines: InvoiceLineForm[];
}

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

const CURRENCIES = ['TZS', 'USD', 'EUR', 'GBP', 'KES', 'UGX'];
const STATUSES = [
  'DRAFT',
  'RECEIVED',
  'MATCHED',
  'APPROVED',
  'PARTIALLY_PAID',
  'PAID',
  'DISPUTED',
  'CANCELLED',
];
// Statuses the backend accepts for approval — mirrors supplier-invoices.service.ts
// approve(), which rejects any other status.
const APPROVABLE_STATUSES = ['DRAFT', 'RECEIVED', 'MATCHED', 'DISPUTED'];

function emptyPage<T>(page = 1): Paginated<T> {
  return { data: [], total: 0, page, totalPages: 1 };
}

function blankLine(): InvoiceLineForm {
  return {
    productId: '',
    description: '',
    quantity: '1',
    unitId: '',
    unitPrice: '0',
    discountAmount: '0',
    taxAmount: '0',
  };
}

function blankForm(): InvoiceForm {
  return {
    companyId: '',
    supplierId: '',
    supplierInvoiceNumber: '',
    purchaseOrderId: '',
    goodsReceivedNoteId: '',
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    invoiceReference: '',
    currency: 'TZS',
    notes: '',
    lines: [blankLine()],
  };
}

function asNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number | string, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(asNumber(value))}`;
}

function listFromPayload<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const obj = payload as { data?: unknown; items?: unknown };
    if (Array.isArray(obj.data)) return obj.data as T[];
    if (Array.isArray(obj.items)) return obj.items as T[];
  }
  return [];
}

function lineTotal(line: InvoiceLineForm) {
  return (
    asNumber(line.quantity) * asNumber(line.unitPrice) -
    asNumber(line.discountAmount) +
    asNumber(line.taxAmount)
  );
}

function InvoiceModal({
  mode,
  initial,
  companies,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: SupplierInvoice;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { hasPermission } = useAuth();
  const [form, setForm] = useState<InvoiceForm>(() =>
    initial
      ? {
          companyId: initial.companyId,
          supplierId: initial.supplierId,
          supplierInvoiceNumber: initial.supplierInvoiceNumber,
          purchaseOrderId: initial.purchaseOrderId ?? '',
          goodsReceivedNoteId: initial.goodsReceivedNoteId ?? '',
          invoiceDate: initial.invoiceDate.slice(0, 10),
          dueDate: initial.dueDate?.slice(0, 10) ?? '',
          invoiceReference: initial.invoiceReference ?? '',
          currency: initial.currency,
          notes: initial.notes ?? '',
          lines: initial.lines?.length
            ? initial.lines.map((line) => ({
                productId: line.productId ?? '',
                description: line.description,
                quantity: String(line.quantity ?? 1),
                unitId: line.unitId ?? '',
                unitPrice: String(line.unitPrice ?? 0),
                discountAmount: String(line.discountAmount ?? 0),
                taxAmount: String(line.taxAmount ?? 0),
              }))
            : [blankLine()],
        }
      : blankForm(),
  );
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [grns, setGrns] = useState<GoodsReceivedNote[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedPo = purchaseOrders.find((po) => po.id === form.purchaseOrderId);
  const selectedGrn = grns.find((grn) => grn.id === form.goodsReceivedNoteId);

  const totals = useMemo(
    () =>
      form.lines.reduce(
        (acc, line) => {
          const gross = asNumber(line.quantity) * asNumber(line.unitPrice);
          const discount = asNumber(line.discountAmount);
          const tax = asNumber(line.taxAmount);
          acc.subtotal += gross;
          acc.discount += discount;
          acc.tax += tax;
          acc.total += gross - discount + tax;
          return acc;
        },
        { subtotal: 0, discount: 0, tax: 0, total: 0 },
      ),
    [form.lines],
  );

  const set = <K extends keyof InvoiceForm>(key: K, value: InvoiceForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const updateLine = <K extends keyof InvoiceLineForm>(
    index: number,
    key: K,
    value: InvoiceLineForm[K],
  ) =>
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) =>
        lineIndex === index ? { ...line, [key]: value } : line,
      ),
    }));

  useEffect(() => {
    if (!form.companyId) {
      setSuppliers([]);
      setPurchaseOrders([]);
      setGrns([]);
      setUnits([]);
      return;
    }
    let cancelled = false;

    async function loadCompanyRefs() {
      const [supplierResult, unitResult] = await Promise.allSettled([
        backendList<Supplier>('/suppliers', {
          query: { companyId: form.companyId, status: 'ACTIVE', limit: 500 },
        }),
        backendList<Unit>('/units', { query: { companyId: form.companyId, limit: 500 } }),
      ]);
      if (cancelled) return;
      setSuppliers(supplierResult.status === 'fulfilled' ? supplierResult.value : []);
      setUnits(unitResult.status === 'fulfilled' ? unitResult.value : []);
    }

    void loadCompanyRefs();

    return () => {
      cancelled = true;
    };
  }, [form.companyId]);

  useEffect(() => {
    if (!form.companyId || !form.supplierId) {
      setPurchaseOrders([]);
      setGrns([]);
      return;
    }
    let cancelled = false;

    async function loadProcurementRefs() {
      const [poResult, grnResult] = await Promise.allSettled([
        backendList<PurchaseOrder>('/purchase-orders', {
          query: { companyId: form.companyId, supplierId: form.supplierId, limit: 200 },
        }),
        backendGet<unknown>('/goods-received-notes', {
          query: { companyId: form.companyId, supplierId: form.supplierId, limit: 200 },
        }),
      ]);
      if (cancelled) return;
      setPurchaseOrders(poResult.status === 'fulfilled' ? poResult.value : []);
      setGrns(
        grnResult.status === 'fulfilled' ? listFromPayload<GoodsReceivedNote>(grnResult.value) : [],
      );
    }

    void loadProcurementRefs();

    return () => {
      cancelled = true;
    };
  }, [form.companyId, form.supplierId]);

  const copyPoLines = useCallback(() => {
    if (!selectedPo?.lines?.length) return;
    setForm((current) => ({
      ...current,
      currency: selectedPo.currency || current.currency,
      lines: selectedPo.lines!.map((line) => ({
        productId: line.productId ?? '',
        description: line.description || line.product?.name || 'Purchase item',
        quantity: String(line.quantity ?? 1),
        unitId: line.unitId ?? '',
        unitPrice: String(line.unitCost ?? 0),
        discountAmount: String(line.discountAmount ?? 0),
        taxAmount: String(line.taxAmount ?? 0),
      })),
    }));
  }, [selectedPo]);

  const copyGrnLines = useCallback(() => {
    if (!selectedGrn?.lines?.length) return;
    const poLines = selectedPo?.lines ?? [];
    setForm((current) => ({
      ...current,
      lines: selectedGrn.lines!.map((line) => {
        const poLine = poLines.find((candidate) => candidate.productId === line.productId);
        return {
          productId: line.productId ?? '',
          description:
            poLine?.description || poLine?.product?.name || line.productId || 'Received item',
          quantity: String(line.acceptedQuantity ?? line.receivedQuantity ?? 1),
          unitId: line.unitId ?? poLine?.unitId ?? '',
          unitPrice: String(poLine?.unitCost ?? 0),
          discountAmount: '0',
          taxAmount: '0',
        };
      }),
    }));
  }, [selectedGrn, selectedPo]);

  const handleSubmit = async () => {
    if (!form.companyId) return setError('Company is required');
    if (!form.supplierId) return setError('Supplier is required');
    if (!form.supplierInvoiceNumber.trim())
      return setError('Supplier tax invoice number is required');
    if (!form.invoiceDate) return setError('Invoice date is required');
    if (!form.lines.length) return setError('At least one invoice line is required');
    const invalidLine = form.lines.findIndex(
      (line) =>
        !line.description.trim() || asNumber(line.quantity) <= 0 || asNumber(line.unitPrice) < 0,
    );
    if (invalidLine >= 0) return setError(`Line ${invalidLine + 1} is incomplete`);

    setSaving(true);
    setError('');
    try {
      const body = {
        companyId: form.companyId,
        supplierId: form.supplierId,
        supplierInvoiceNumber: form.supplierInvoiceNumber.trim(),
        purchaseOrderId: form.purchaseOrderId || undefined,
        goodsReceivedNoteId: form.goodsReceivedNoteId || undefined,
        invoiceDate: form.invoiceDate,
        dueDate: form.dueDate || undefined,
        invoiceReference: form.invoiceReference || undefined,
        currency: form.currency,
        totalAmount: Number(totals.total.toFixed(2)),
        notes: form.notes || undefined,
        lines: form.lines.map((line) => ({
          productId: line.productId || undefined,
          description: line.description.trim(),
          quantity: asNumber(line.quantity),
          unitId: line.unitId || undefined,
          unitPrice: asNumber(line.unitPrice),
          discountAmount: asNumber(line.discountAmount),
          taxAmount: asNumber(line.taxAmount),
          lineTotal: Number(lineTotal(line).toFixed(2)),
        })),
      };
      if (mode === 'create') {
        await backendPost('/supplier-invoices', body);
      } else {
        await backendPut(`/supplier-invoices/${initial!.id}`, body);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save supplier invoice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'Create Supplier Tax Invoice' : 'Edit Supplier Tax Invoice'}
      size="xl"
      footer={
        <>
          {mode === 'edit' && initial && hasPermission('supplier_invoices.view') && (
            <div className="mr-auto">
              <DocumentArtifactButton entityType="SUPPLIER_INVOICE" entityId={initial.id} />
            </div>
          )}
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={saving}>
            {mode === 'create' ? 'Create Invoice' : 'Save Changes'}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <FormSelect
          label="Company"
          required
          value={form.companyId}
          onChange={(e) =>
            setForm((current) => ({
              ...current,
              companyId: e.target.value,
              supplierId: '',
              purchaseOrderId: '',
              goodsReceivedNoteId: '',
              lines: [blankLine()],
            }))
          }
          placeholder="Select company"
          disabled={mode === 'edit'}
        >
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name} ({company.code})
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Supplier"
          required
          value={form.supplierId}
          onChange={(e) =>
            setForm((current) => ({
              ...current,
              supplierId: e.target.value,
              purchaseOrderId: '',
              goodsReceivedNoteId: '',
              lines: [blankLine()],
            }))
          }
          placeholder={form.companyId ? 'Select supplier' : 'Select company first'}
        >
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
              {supplier.supplierCode ? ` (${supplier.supplierCode})` : ''}
            </option>
          ))}
        </FormSelect>
        <FormInput
          label="Supplier Tax Invoice #"
          required
          value={form.supplierInvoiceNumber}
          onChange={(e) => set('supplierInvoiceNumber', e.target.value)}
        />
        <FormInput
          label="Invoice Reference"
          value={form.invoiceReference}
          onChange={(e) => set('invoiceReference', e.target.value)}
          placeholder="Delivery note or supplier reference"
        />
        <FormInput
          label="Invoice Date"
          required
          type="date"
          value={form.invoiceDate}
          onChange={(e) => set('invoiceDate', e.target.value)}
        />
        <FormInput
          label="Due Date"
          type="date"
          value={form.dueDate}
          onChange={(e) => set('dueDate', e.target.value)}
        />
        <FormSelect
          label="Currency"
          value={form.currency}
          onChange={(e) => set('currency', e.target.value)}
        >
          {CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Purchase Order"
          value={form.purchaseOrderId}
          onChange={(e) => {
            const nextId = e.target.value;
            const po = purchaseOrders.find((item) => item.id === nextId);
            setForm((current) => ({
              ...current,
              purchaseOrderId: nextId,
              goodsReceivedNoteId: '',
              currency: po?.currency || current.currency,
            }));
          }}
          placeholder={form.supplierId ? 'Select PO' : 'Select supplier first'}
        >
          {purchaseOrders.map((po) => (
            <option key={po.id} value={po.id}>
              {po.purchaseOrderNumber} - {money(po.totalAmount, po.currency)}
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Goods Received Note"
          value={form.goodsReceivedNoteId}
          onChange={(e) => set('goodsReceivedNoteId', e.target.value)}
          placeholder={form.supplierId ? 'Select GRN' : 'Select supplier first'}
        >
          {grns
            .filter(
              (grn) =>
                !form.purchaseOrderId ||
                !grn.purchaseOrderId ||
                grn.purchaseOrderId === form.purchaseOrderId,
            )
            .map((grn) => (
              <option key={grn.id} value={grn.id}>
                {grn.grnNumber} - {grn.status}
              </option>
            ))}
        </FormSelect>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Btn
          variant="secondary"
          size="xs"
          onClick={copyPoLines}
          disabled={!selectedPo?.lines?.length}
        >
          Copy PO Lines
        </Btn>
        <Btn
          variant="secondary"
          size="xs"
          onClick={copyGrnLines}
          disabled={!selectedGrn?.lines?.length}
        >
          Copy GRN Lines
        </Btn>
      </div>

      <div
        className="mt-4 overflow-x-auto rounded-lg border"
        style={{ borderColor: 'var(--aurora-border)' }}
      >
        <table className="w-full min-w-[900px] text-sm">
          <caption className="sr-only">Invoice line items</caption>
          <thead>
            <tr
              className="text-left text-xs uppercase"
              style={{ color: 'var(--aurora-text-muted)' }}
            >
              <th scope="col" className="px-3 py-2">
                Description
              </th>
              <th scope="col" className="px-3 py-2">
                Qty
              </th>
              <th scope="col" className="px-3 py-2">
                Unit
              </th>
              <th scope="col" className="px-3 py-2">
                Unit Price
              </th>
              <th scope="col" className="px-3 py-2">
                Discount
              </th>
              <th scope="col" className="px-3 py-2">
                Tax
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Total
              </th>
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {form.lines.map((line, index) => (
              <tr key={index} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                <td className="px-3 py-2">
                  <input
                    className="aurora-input w-full rounded-lg px-2 py-1.5 text-sm"
                    aria-label={`Line ${index + 1} description`}
                    value={line.description}
                    onChange={(e) => updateLine(index, 'description', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    className="aurora-input w-24 rounded-lg px-2 py-1.5 text-sm"
                    aria-label={`Line ${index + 1} quantity`}
                    type="number"
                    min="0"
                    value={line.quantity}
                    onChange={(e) => updateLine(index, 'quantity', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    className="aurora-input w-32 rounded-lg px-2 py-1.5 text-sm"
                    aria-label={`Line ${index + 1} unit`}
                    value={line.unitId}
                    onChange={(e) => updateLine(index, 'unitId', e.target.value)}
                  >
                    <option value="">Unit</option>
                    {units.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.symbol || unit.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    className="aurora-input w-28 rounded-lg px-2 py-1.5 text-sm"
                    aria-label={`Line ${index + 1} unit price`}
                    type="number"
                    min="0"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(index, 'unitPrice', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    className="aurora-input w-24 rounded-lg px-2 py-1.5 text-sm"
                    aria-label={`Line ${index + 1} discount`}
                    type="number"
                    min="0"
                    value={line.discountAmount}
                    onChange={(e) => updateLine(index, 'discountAmount', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    className="aurora-input w-24 rounded-lg px-2 py-1.5 text-sm"
                    aria-label={`Line ${index + 1} tax`}
                    type="number"
                    min="0"
                    value={line.taxAmount}
                    onChange={(e) => updateLine(index, 'taxAmount', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2 text-right font-medium">
                  {money(lineTotal(line), form.currency)}
                </td>
                <td className="px-3 py-2 text-right">
                  <Btn
                    variant="ghost"
                    size="xs"
                    aria-label={`Remove line ${index + 1}`}
                    disabled={form.lines.length === 1}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        lines: current.lines.filter((_, lineIndex) => lineIndex !== index),
                      }))
                    }
                  >
                    Remove
                  </Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-start justify-between gap-4">
        <Btn
          variant="secondary"
          size="xs"
          onClick={() =>
            setForm((current) => ({ ...current, lines: [...current.lines, blankLine()] }))
          }
        >
          + Add Line
        </Btn>
        <div className="min-w-[260px] space-y-1 text-sm">
          <div className="flex justify-between gap-8">
            <span style={{ color: 'var(--aurora-text-muted)' }}>Subtotal</span>
            <span>{money(totals.subtotal, form.currency)}</span>
          </div>
          <div className="flex justify-between gap-8">
            <span style={{ color: 'var(--aurora-text-muted)' }}>Discount</span>
            <span>{money(totals.discount, form.currency)}</span>
          </div>
          <div className="flex justify-between gap-8">
            <span style={{ color: 'var(--aurora-text-muted)' }}>Tax</span>
            <span>{money(totals.tax, form.currency)}</span>
          </div>
          <div
            className="flex justify-between gap-8 border-t pt-2 font-semibold"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <span>Total</span>
            <span>{money(totals.total, form.currency)}</span>
          </div>
        </div>
      </div>

      <FormTextarea
        className="mt-3"
        label="Notes"
        rows={2}
        value={form.notes}
        onChange={(e) => set('notes', e.target.value)}
      />
    </Modal>
  );
}

// ─── Void modal (danger confirm with an optional reason) ─────────────────────
//
// Voiding is only offered for APPROVED invoices — mirrors the backend void()
// guard, which rejects every other status, is idempotent on CANCELLED, and
// refuses to void once payments were applied or the payable was WRITTEN_OFF.
// Those backend messages are surfaced verbatim in the dialog (which stays open
// on failure), following the credit-notes VoidModal convention.
export function VoidInvoiceModal({
  invoice,
  onClose,
  onDone,
}: {
  invoice: SupplierInvoice;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    setSaving(true);
    setError('');
    try {
      const trimmed = reason.trim();
      await backendPatch(
        `/supplier-invoices/${invoice.id}/void`,
        trimmed ? { reason: trimmed } : {},
      );
      showToast(
        'info',
        'Supplier invoice voided',
        `Invoice ${invoice.supplierInvoiceNumber} was cancelled and its Accounts Payable posting reversed.`,
      );
      onDone();
    } catch (err) {
      // Surface the backend guard message verbatim and keep the dialog open.
      setError(err instanceof Error ? err.message : 'Failed to void supplier invoice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Void invoice ${invoice.supplierInvoiceNumber}`}
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Btn>
          <Btn variant="danger" onClick={handleConfirm} loading={saving}>
            Void Invoice
          </Btn>
        </>
      }
    >
      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600"
        >
          {error}
        </div>
      )}
      <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
        Voiding cancels this approved invoice and unwinds its Accounts Payable posting: the payable
        it created is cancelled and a reversing journal entry is posted. This cannot be undone.
      </p>
      <FormTextarea
        className="mt-3"
        label="Reason (optional)"
        rows={3}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why is this invoice being voided? (recorded on the reversing entry and audit log)"
      />
    </Modal>
  );
}

export default function SupplierInvoicesPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<SupplierInvoice> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SupplierInvoice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Approval posts the invoice to Accounts Payable (payable + journal entries) and
  // cannot be undone, so it is always routed through a ConfirmDialog — mirrors the
  // GRN post confirmation pattern on the sibling GRNs page.
  const [pending, setPending] = useState<{
    invoice: SupplierInvoice;
    action: 'approve' | 'approveVariance';
  } | null>(null);
  const [voiding, setVoiding] = useState<SupplierInvoice | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  const canView =
    hasPermission('supplier_invoices.list') || hasPermission('supplier_invoices.view');
  const canCreate = hasPermission('supplier_invoices.create');
  const canUpdate = hasPermission('supplier_invoices.update');
  const canApprove = hasPermission('supplier_invoices.approve');
  const canVoid = hasPermission('supplier_invoices.void');

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
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const result = await backendPage<SupplierInvoice>('/supplier-invoices', {
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
      setError(err instanceof Error ? err.message : 'Failed to load supplier invoices');
      setData(emptyPage<SupplierInvoice>(page));
    } finally {
      setLoading(false);
    }
  }, [canView, companyId, page, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (
    invoice: SupplierInvoice,
    action: 'match' | 'approve' | 'approveVariance',
  ) => {
    setBusyId(invoice.id);
    setError(null);
    try {
      if (action === 'match') {
        await backendPost(`/supplier-invoices/${invoice.id}/run-match`);
      } else {
        await backendPost(
          `/supplier-invoices/${invoice.id}/approve`,
          action === 'approveVariance' ? { allowVariance: true } : {},
        );
      }
      setPending(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Supplier Invoices" subtitle="Process supplier tax invoices" />
        <div className="mt-8 text-center text-sm text-slate-500">Access Restricted</div>
      </div>
    );
  }

  const invoices = data?.data ?? [];
  const approvedCount = invoices.filter((invoice) => invoice.status === 'APPROVED').length;
  const disputedCount = invoices.filter((invoice) => invoice.status === 'DISPUTED').length;
  const outstanding = invoices.reduce(
    (sum, invoice) => sum + asNumber(invoice.outstandingAmount),
    0,
  );
  const buildExportRows = () =>
    invoices.map((invoice) => ({
      'Tax Invoice #': invoice.supplierInvoiceNumber,
      Supplier: invoice.supplier?.name ?? invoice.supplierId,
      Company: invoice.company?.name ?? invoice.companyId,
      'Purchase Order': invoice.purchaseOrder?.purchaseOrderNumber ?? invoice.purchaseOrderId ?? '',
      GRN: invoice.goodsReceivedNote?.grnNumber ?? invoice.goodsReceivedNoteId ?? '',
      'Invoice Date': invoice.invoiceDate.slice(0, 10),
      Currency: invoice.currency,
      Total: asNumber(invoice.totalAmount).toFixed(2),
      Outstanding: asNumber(invoice.outstandingAmount).toFixed(2),
      Status: invoice.status,
      Match: invoice.latestMatch?.matchStatus ?? '',
      Payable: invoice.payable?.payableNumber ?? '',
    }));
  const exportCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(
      `supplier-invoices-${stamp}.csv`,
      'text/csv;charset=utf-8',
      rowsToCsv(buildExportRows()),
    );
  };
  const exportPdf = async () => {
    const rows = buildExportRows();
    if (!rows.length) return;
    setExportingPdf(true);
    try {
      const filters = [
        companyId ? companies.find((company) => company.id === companyId)?.name : '',
        status ? status.replace(/_/g, ' ') : '',
        search.trim() ? `Search: ${search.trim()}` : '',
      ]
        .filter(Boolean)
        .join(' | ');
      await downloadTablePdf({
        title: 'Supplier Invoices',
        subtitle: filters || undefined,
        companyId: companyId || undefined,
        columns: Object.keys(rows[0]),
        rows: rows.map((row) => Object.values(row)),
        numericColumns: [7, 8],
        baseName: 'supplier-invoices',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export PDF');
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

  return (
    <div className="p-6 space-y-6">
      {creating && (
        <InvoiceModal
          mode="create"
          companies={companies}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void load();
          }}
        />
      )}
      {editing && (
        <InvoiceModal
          mode="edit"
          initial={editing}
          companies={companies}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {voiding && (
        <VoidInvoiceModal
          invoice={voiding}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null);
            void load();
          }}
        />
      )}

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.action === 'approveVariance'
            ? 'Approve invoice with variance'
            : 'Approve supplier invoice'
        }
        message={
          pending?.action === 'approveVariance'
            ? `Approve invoice ${pending?.invoice.supplierInvoiceNumber} despite the PO/GRN variance? This posts it to Accounts Payable and creates the payable journal entries. It cannot be undone.`
            : `Approve invoice ${pending?.invoice.supplierInvoiceNumber}? This posts it to Accounts Payable and creates the payable journal entries. It cannot be undone.`
        }
        confirmLabel="Approve"
        variant="warning"
        loading={pending ? busyId === pending.invoice.id : false}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) void runAction(pending.invoice, pending.action);
        }}
      />

      <PageHeader
        title="Supplier Invoices"
        subtitle="Supplier tax invoices, matching, and AP posting"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Invoices" value={data?.total ?? 0} />
        <StatCard label="Approved" value={approvedCount} />
        <StatCard label="Disputed" value={disputedCount} />
        <StatCard label="Outstanding" value={money(outstanding)} />
      </div>

      <PageToolbar
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search invoice number..."
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
            <Btn variant="secondary" onClick={exportCsv} disabled={!invoices.length}>
              Export CSV
            </Btn>
            <Btn
              variant="secondary"
              onClick={exportPdf}
              disabled={!invoices.length || exportingPdf}
              loading={exportingPdf}
            >
              Export PDF
            </Btn>
            {canCreate ? (
              <Btn variant="primary" onClick={() => setCreating(true)}>
                + New Supplier Invoice
              </Btn>
            ) : null}
          </>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <caption className="sr-only">Supplier invoice register</caption>
            <thead>
              <tr
                className="text-left text-xs uppercase"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th scope="col" className="px-4 py-3">
                  Tax Invoice #
                </th>
                <th scope="col" className="px-4 py-3">
                  Supplier
                </th>
                <th scope="col" className="px-4 py-3">
                  PO / GRN
                </th>
                <th scope="col" className="px-4 py-3">
                  Invoice Date
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Total
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Outstanding
                </th>
                <th scope="col" className="px-4 py-3">
                  Status
                </th>
                <th scope="col" className="px-4 py-3">
                  Match
                </th>
                <th scope="col" className="px-4 py-3">
                  Payable
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="p-0">
                    <SkeletonTable rows={6} cols={10} />
                  </td>
                </tr>
              ) : !invoices.length ? (
                <tr>
                  <td colSpan={10}>
                    <EmptyState
                      title="No supplier invoices found"
                      description="Adjust your filters or create a new supplier tax invoice to get started."
                    />
                  </td>
                </tr>
              ) : (
                invoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">{invoice.supplierInvoiceNumber}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {invoice.supplier?.name ?? invoice.supplierId}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {invoice.company?.name ?? invoice.companyId}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div>
                        {invoice.purchaseOrder?.id || invoice.purchaseOrderId ? (
                          <Link
                            href={`/operations/purchase-orders/${
                              invoice.purchaseOrder?.id ?? invoice.purchaseOrderId
                            }`}
                            className="text-brand-600 hover:underline"
                          >
                            {invoice.purchaseOrder?.purchaseOrderNumber ?? invoice.purchaseOrderId}
                          </Link>
                        ) : (
                          '-'
                        )}
                      </div>
                      <div style={{ color: 'var(--aurora-text-muted)' }}>
                        {invoice.goodsReceivedNote?.grnNumber ?? invoice.goodsReceivedNoteId ?? '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {new Date(invoice.invoiceDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {money(invoice.totalAmount, invoice.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {money(invoice.outstandingAmount, invoice.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={invoice.status} />
                    </td>
                    <td className="px-4 py-3">
                      {invoice.latestMatch ? (
                        <div className="space-y-1">
                          <StatusBadge status={invoice.latestMatch.matchStatus} />
                          <div
                            className="text-[11px]"
                            style={{ color: 'var(--aurora-text-muted)' }}
                          >
                            Qty {asNumber(invoice.latestMatch.quantityVariance).toFixed(4)} / Amt{' '}
                            {asNumber(invoice.latestMatch.amountVariance).toFixed(2)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                          Not run
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {invoice.payable ? (
                        <div>
                          <div className="font-mono">{invoice.payable.payableNumber}</div>
                          <StatusBadge status={invoice.payable.status} />
                        </div>
                      ) : (
                        <span style={{ color: 'var(--aurora-text-muted)' }}>Not posted</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {canUpdate &&
                          ['DRAFT', 'RECEIVED', 'DISPUTED'].includes(invoice.status) && (
                            <Btn
                              variant="ghost"
                              size="xs"
                              aria-label={`Edit invoice ${invoice.supplierInvoiceNumber}`}
                              onClick={() => setEditing(invoice)}
                            >
                              Edit
                            </Btn>
                          )}
                        {canApprove &&
                          invoice.purchaseOrderId &&
                          !['APPROVED', 'PAID'].includes(invoice.status) && (
                            <Btn
                              variant="secondary"
                              size="xs"
                              aria-label={`Run match for invoice ${invoice.supplierInvoiceNumber}`}
                              loading={busyId === invoice.id}
                              onClick={() => runAction(invoice, 'match')}
                            >
                              Match
                            </Btn>
                          )}
                        {canApprove && APPROVABLE_STATUSES.includes(invoice.status) && (
                          <Btn
                            variant="primary"
                            size="xs"
                            aria-label={`Approve invoice ${invoice.supplierInvoiceNumber}`}
                            loading={busyId === invoice.id}
                            onClick={() => setPending({ invoice, action: 'approve' })}
                          >
                            Approve
                          </Btn>
                        )}
                        {canApprove && invoice.status === 'DISPUTED' && (
                          <Btn
                            variant="secondary"
                            size="xs"
                            aria-label={`Approve variance for invoice ${invoice.supplierInvoiceNumber}`}
                            loading={busyId === invoice.id}
                            onClick={() => setPending({ invoice, action: 'approveVariance' })}
                          >
                            Approve Variance
                          </Btn>
                        )}
                        {canVoid && invoice.status === 'APPROVED' && (
                          <Btn
                            variant="danger"
                            size="xs"
                            aria-label={`Void invoice ${invoice.supplierInvoiceNumber}`}
                            onClick={() => setVoiding(invoice)}
                          >
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
