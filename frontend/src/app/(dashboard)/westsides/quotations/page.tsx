'use client';

import { useCallback, useEffect, useState } from 'react';
import { DocumentPreviewLink } from '@/components/documents';
import {
  Btn,
  Card,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
  PageHeader,
  PageSpinner,
  StatusBadge,
  showToast,
} from '@/components/ui';
import {
  backendGet,
  backendList,
  backendPage,
  backendPatch,
  backendPost,
} from '@/lib/api-client';
import {
  OrderLineEditor,
  mergeOrderProductOptions,
} from '../../operations/_components/order-line-editor';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company {
  id: string;
  name: string;
  code: string;
}

interface Division {
  id: string;
  name: string;
  code?: string | null;
}

interface Branch {
  id: string;
  name: string;
  code?: string | null;
  divisionId?: string | null;
}

interface Customer {
  id: string;
  name: string;
  customerCode?: string | null;
  phone?: string | null;
  email?: string | null;
}

interface Product {
  id: string;
  name: string;
  productCode?: string | null;
  sku?: string | null;
  barcode?: string | null;
  baseUnitId?: string | null;
  baseUnit?: { name?: string | null; symbol?: string | null } | null;
  category?: { id?: string | null; name?: string | null } | null;
  defaultPurchasePrice?: number | string | null;
  defaultSellingPrice?: number | string | null;
  wholesalePrice?: number | string | null;
  retailPrice?: number | string | null;
}

interface Unit {
  id: string;
  name: string;
  symbol: string;
}

interface QuotationLine {
  id?: string;
  productId: string;
  description: string;
  qty: number;
  unitId: string;
  unitPrice: number;
  discount: number;
  tax: number;
  batchId?: string;
}

interface Quotation {
  id: string;
  quotationNumber: string;
  quotationDate: string;
  validUntil?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  customer?: { name?: string | null; customerCode?: string | null } | null;
  companyId: string;
  divisionId?: string | null;
  branchId?: string | null;
  quotationType: string;
  currency: string;
  subtotal?: number | string | null;
  discountAmount?: number | string | null;
  taxAmount?: number | string | null;
  totalAmount: number | string;
  status: string;
  notes?: string | null;
  lines?: Array<{
    id?: string;
    productId?: string | null;
    description?: string | null;
    quantity?: number | string | null;
    unitId?: string | null;
    unitPrice?: number | string | null;
    discountAmount?: number | string | null;
    taxAmount?: number | string | null;
  }>;
}

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const CURRENCIES = ['TZS', 'USD', 'EUR'];

// Mirrors the Prisma QuotationType enum. The old stub used WHOLESALE/RETAIL/EXPORT
// which the backend @IsEnum(QuotationType) rejects — these are the valid values.
const QUOTATION_TYPES: { value: string; label: string }[] = [
  { value: 'GENERAL', label: 'General' },
  { value: 'BEVERAGE_WHOLESALE', label: 'Beverage Wholesale' },
  { value: 'HARDWARE', label: 'Hardware' },
  { value: 'BUILDING_MATERIALS', label: 'Building Materials' },
  { value: 'CONTRACTOR', label: 'Contractor' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function blankLine(): QuotationLine {
  return {
    productId: '',
    description: '',
    qty: 1,
    unitId: '',
    unitPrice: 0,
    discount: 0,
    tax: 0,
    batchId: '',
  };
}

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function blankForm() {
  return {
    companyId: '',
    divisionId: '',
    branchId: '',
    customerId: '',
    customerName: '',
    quotationType: 'GENERAL',
    quotationDate: new Date().toISOString().slice(0, 10),
    validUntil: addDays(14),
    currency: 'TZS',
    notes:
      'Prices are valid within the stated period, subject to stock availability and confirmation.',
    lines: [blankLine()],
  };
}

function formFromRecord(record: Quotation) {
  return {
    companyId: record.companyId,
    divisionId: record.divisionId ?? '',
    branchId: record.branchId ?? '',
    customerId: record.customerId ?? '',
    customerName: record.customerName ?? '',
    quotationType: record.quotationType || 'GENERAL',
    quotationDate: record.quotationDate.slice(0, 10),
    validUntil: record.validUntil?.slice(0, 10) ?? '',
    currency: record.currency || 'TZS',
    notes: record.notes ?? '',
    lines: record.lines?.length
      ? record.lines.map((line) => ({
          id: line.id,
          productId: line.productId ?? '',
          description: line.description ?? '',
          qty: Number(line.quantity ?? 1),
          unitId: line.unitId ?? '',
          unitPrice: Number(line.unitPrice ?? 0),
          // Quotation lines store discountAmount as a FLAT per-line amount, so it
          // maps directly to the editor's per-line `discount` field.
          discount: Number(line.discountAmount ?? 0),
          tax: Number(line.taxAmount ?? 0),
          batchId: '',
        }))
      : [blankLine()],
  };
}

function fmtMoney(value: number | string | null | undefined, currency = 'TZS') {
  const amount = Number(value ?? 0);
  return `${currency} ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0)}`;
}

function fmtDate(value: string | null | undefined) {
  if (!value) return 'N/A';
  return new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function customerLabel(quotation: Quotation) {
  const name = quotation.customer?.name ?? quotation.customerName;
  if (!name) return 'N/A';
  return quotation.customer?.customerCode ? `${name} (${quotation.customer.customerCode})` : name;
}

function typeLabel(type: string) {
  return QUOTATION_TYPES.find((t) => t.value === type)?.label ?? type.replace(/_/g, ' ');
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function QuotationModal({
  mode,
  initial,
  companies,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Quotation;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => (initial ? formFromRecord(initial) : blankForm()));
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selectedProductIdKey = form.lines
    .map((line) => line.productId)
    .filter(Boolean)
    .join('|');

  useEffect(() => {
    let cancelled = false;
    backendList<Unit>('/units', { query: { limit: 200 } })
      .then((rows) => {
        if (!cancelled) setUnits(rows);
      })
      .catch(() => {
        if (!cancelled) setUnits([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!form.companyId) {
      setDivisions([]);
      setBranches([]);
      setCustomers([]);
      setProducts([]);
      return;
    }
    let cancelled = false;
    Promise.allSettled([
      backendList<Division>('/divisions', { query: { companyId: form.companyId, limit: 200 } }),
      backendList<Branch>('/branches', {
        query: { companyId: form.companyId, activeOnly: true, limit: 500 },
      }),
    ]).then(([divisionResult, branchResult]) => {
      if (cancelled) return;
      setDivisions(divisionResult.status === 'fulfilled' ? divisionResult.value : []);
      setBranches(branchResult.status === 'fulfilled' ? branchResult.value : []);
    });
    return () => {
      cancelled = true;
    };
  }, [form.companyId]);

  // Load customers for the chosen company/branch — matches the sales-orders picker.
  useEffect(() => {
    if (!form.companyId || !form.branchId) {
      setCustomers([]);
      return;
    }
    let cancelled = false;
    backendList<Customer>('/customers', {
      query: { companyId: form.companyId, branchId: form.branchId, status: 'ACTIVE', limit: 500 },
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
  }, [form.branchId, form.companyId]);

  // Product search feeds the OrderLineEditor; debounced when the user is typing.
  useEffect(() => {
    if (!form.companyId || !form.divisionId) {
      setProducts([]);
      setProductSearchLoading(false);
      return;
    }
    let cancelled = false;
    const search = productSearchQuery.trim();
    const selectedProductIds = selectedProductIdKey ? selectedProductIdKey.split('|') : [];
    setProductSearchLoading(true);
    const timer = setTimeout(
      () => {
        backendList<Product>('/products', {
          query: {
            companyId: form.companyId,
            divisionId: form.divisionId,
            ...(form.branchId ? { branchId: form.branchId } : {}),
            limit: search ? 50 : 200,
            ...(search ? { search } : {}),
          },
        })
          .then((rows) => {
            if (!cancelled) {
              setProducts((current) => mergeOrderProductOptions(rows, current, selectedProductIds));
            }
          })
          .catch(() => {
            if (!cancelled) setProducts([]);
          })
          .finally(() => {
            if (!cancelled) setProductSearchLoading(false);
          });
      },
      search ? 250 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.companyId, form.divisionId, form.branchId, productSearchQuery, selectedProductIdKey]);

  const branchOptions = form.divisionId
    ? branches.filter((branch) => branch.divisionId === form.divisionId)
    : [];

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setLine(index: number, patch: Partial<QuotationLine>) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, idx) => (idx === index ? { ...line, ...patch } : line)),
    }));
  }

  function addLine() {
    setForm((current) => ({ ...current, lines: [...current.lines, blankLine()] }));
  }

  function removeLine(index: number) {
    setForm((current) => ({
      ...current,
      lines: current.lines.filter((_, idx) => idx !== index),
    }));
  }

  async function save() {
    if (!form.companyId) return setError('Company is required');
    if (!form.divisionId) return setError('Division is required');
    if (!form.branchId) return setError('Branch/location is required');
    if (!form.customerId && !form.customerName.trim()) {
      return setError('Select a customer or enter a customer name');
    }
    if (!form.quotationDate) return setError('Quotation date is required');
    if (!form.lines.length) return setError('Add at least one line item');
    if (form.lines.some((line) => !line.productId || !line.unitId)) {
      return setError('Each line needs a product and unit');
    }
    if (form.lines.some((line) => Number(line.qty) <= 0)) {
      return setError('Each line quantity must be greater than zero');
    }

    setSaving(true);
    setError('');
    try {
      const selectedCustomer = customers.find((customer) => customer.id === form.customerId);
      const lines = form.lines.map((line) => ({
        productId: line.productId,
        description: line.description || undefined,
        quantity: Number(line.qty) || 0,
        unitId: line.unitId,
        unitPrice: Number(line.unitPrice) || 0,
        // Backend expects a FLAT per-line discountAmount; the editor's per-line
        // `discount` field carries that flat amount for quotations.
        discountAmount: Number(line.discount) || 0,
        taxAmount: Number(line.tax) || 0,
      }));

      if (mode === 'create') {
        const body = {
          companyId: form.companyId,
          divisionId: form.divisionId,
          branchId: form.branchId,
          customerId: form.customerId || undefined,
          customerName: form.customerId ? selectedCustomer?.name : form.customerName || undefined,
          quotationType: form.quotationType,
          quotationDate: form.quotationDate,
          validUntil: form.validUntil || undefined,
          currency: form.currency,
          notes: form.notes || undefined,
          lines,
        };
        await backendPost('/westsides/quotations', body);
        showToast('success', 'Quotation created', 'Saved as draft — send it when ready.');
      } else if (initial) {
        // UpdateQuotationDto omits companyId; send only editable fields + lines.
        const body = {
          divisionId: form.divisionId,
          branchId: form.branchId,
          customerId: form.customerId || undefined,
          customerName: form.customerId ? selectedCustomer?.name : form.customerName || undefined,
          quotationType: form.quotationType,
          quotationDate: form.quotationDate,
          validUntil: form.validUntil || undefined,
          currency: form.currency,
          notes: form.notes || undefined,
          lines,
        };
        await backendPatch(`/westsides/quotations/${initial.id}`, body);
        showToast('success', 'Quotation updated');
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save quotation');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'New Quotation' : 'Edit Quotation'}
      subtitle="Build a customer quotation with itemized products, validity, totals, and notes."
      size="3xl"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={save} loading={saving}>
            {mode === 'create' ? 'Create Quotation' : 'Save Changes'}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FormSelect
            label="Company"
            required
            value={form.companyId}
            onChange={(event) => {
              setProductSearchQuery('');
              setForm((current) => ({
                ...current,
                companyId: event.target.value,
                divisionId: '',
                branchId: '',
                customerId: '',
                lines: current.lines.map((line) => ({ ...line, productId: '', unitId: '' })),
              }));
            }}
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
            label="Division"
            required
            value={form.divisionId}
            onChange={(event) => {
              setProductSearchQuery('');
              setForm((current) => ({
                ...current,
                divisionId: event.target.value,
                branchId: '',
                customerId: '',
                lines: current.lines.map((line) => ({ ...line, productId: '', unitId: '' })),
              }));
            }}
            placeholder={form.companyId ? 'Select division' : 'Select company first'}
          >
            {divisions.map((division) => (
              <option key={division.id} value={division.id}>
                {division.code ? `${division.code} - ${division.name}` : division.name}
              </option>
            ))}
          </FormSelect>

          <FormSelect
            label="Branch"
            required
            value={form.branchId}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                branchId: event.target.value,
                customerId: '',
              }))
            }
            placeholder={form.divisionId ? 'Select branch' : 'Select division first'}
            disabled={!form.divisionId}
          >
            {branchOptions.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code ? `${branch.code} - ${branch.name}` : branch.name}
              </option>
            ))}
          </FormSelect>

          <FormSelect
            label="Customer"
            value={form.customerId}
            onChange={(event) => setField('customerId', event.target.value)}
            placeholder={form.branchId ? 'Select customer (or enter name below)' : 'Select branch first'}
            disabled={!form.branchId}
          >
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
                {customer.customerCode ? ` (${customer.customerCode})` : ''}
              </option>
            ))}
          </FormSelect>

          <FormInput
            label="Customer Name"
            value={form.customerName}
            onChange={(event) => setField('customerName', event.target.value)}
            placeholder="If no customer selected"
            disabled={!!form.customerId}
          />

          <FormSelect
            label="Quotation Type"
            required
            value={form.quotationType}
            onChange={(event) => setField('quotationType', event.target.value)}
          >
            {QUOTATION_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </FormSelect>

          <FormInput
            label="Quotation Date"
            required
            type="date"
            value={form.quotationDate}
            onChange={(event) => setField('quotationDate', event.target.value)}
          />
          <FormInput
            label="Valid Until"
            type="date"
            value={form.validUntil}
            onChange={(event) => setField('validUntil', event.target.value)}
          />
          <FormSelect
            label="Currency"
            required
            value={form.currency}
            onChange={(event) => setField('currency', event.target.value)}
          >
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </FormSelect>
          <div className="md:col-span-2 xl:col-span-3">
            <FormTextarea
              label="Terms / Notes"
              rows={2}
              value={form.notes}
              onChange={(event) => setField('notes', event.target.value)}
            />
          </div>
        </div>

        <OrderLineEditor
          variant="sales"
          lines={form.lines}
          products={products}
          units={units}
          currency={form.currency}
          productSearchLoading={productSearchLoading}
          onAddLine={addLine}
          onRemoveLine={removeLine}
          onLineChange={setLine}
          onProductSearch={setProductSearchQuery}
        />
      </div>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type QuotationAction = 'send' | 'accept' | 'reject' | 'convert';

const STATUS_ACTIONS: Record<
  string,
  { action: QuotationAction; label: string; variant: 'primary' | 'secondary' | 'ghost' | 'danger' }[]
> = {
  DRAFT: [{ action: 'send', label: 'Send', variant: 'primary' }],
  SENT: [
    { action: 'accept', label: 'Accept', variant: 'primary' },
    { action: 'reject', label: 'Reject', variant: 'danger' },
  ],
  ACCEPTED: [{ action: 'convert', label: 'Convert to Order', variant: 'secondary' }],
};

export default function QuotationsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [items, setItems] = useState<Paginated<Quotation> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Quotation | null>(null);
  const [editLoadingId, setEditLoadingId] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);

  useEffect(() => {
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
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(
        await backendPage<Quotation>('/westsides/quotations', {
          query: { limit: 100 },
        }),
      );
    } catch (err) {
      setItems({ data: [], total: 0, page: 1, totalPages: 1 });
      setError(err instanceof Error ? err.message : 'Failed to load quotations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openEdit(id: string) {
    setEditLoadingId(id);
    setError('');
    try {
      setEditing(await backendGet<Quotation>(`/westsides/quotations/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open quotation');
    } finally {
      setEditLoadingId(null);
    }
  }

  async function handleAction(id: string, action: QuotationAction) {
    setActioning(`${id}-${action}`);
    setError('');
    try {
      const endpoint = action === 'convert' ? 'convert-to-sales-order' : action;
      await backendPatch(`/westsides/quotations/${id}/${endpoint}`);
      showToast(
        'success',
        action === 'send'
          ? 'Quotation sent'
          : action === 'accept'
            ? 'Quotation accepted'
            : action === 'reject'
              ? 'Quotation rejected'
              : 'Converted to sales order',
      );
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Action failed';
      setError(message);
      showToast('error', 'Action failed', message);
    } finally {
      setActioning(null);
    }
  }

  const rows = items?.data ?? [];

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Quotations"
          subtitle="Customer quotations with itemized products, validity, letterhead print/PDF, and conversion support."
        />
        <Btn variant="primary" onClick={() => setCreating(true)}>
          + New Quotation
        </Btn>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      )}

      {loading ? (
        <PageSpinner />
      ) : (
        <Card className="overflow-hidden" padding="none">
          {rows.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-slate-400">
              No quotations found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">
                      Quotation #
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">
                      Customer
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">
                      Type
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-400">
                      Total Amount
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">
                      Valid Until
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-400">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {rows.map((quotation) => {
                    const actions = STATUS_ACTIONS[quotation.status] ?? [];
                    return (
                      <tr key={quotation.id}>
                        <td className="px-4 py-3 font-mono text-xs text-slate-100">
                          {quotation.quotationNumber}
                        </td>
                        <td className="px-4 py-3 text-slate-200">
                          {fmtDate(quotation.quotationDate)}
                        </td>
                        <td className="px-4 py-3 text-slate-100">{customerLabel(quotation)}</td>
                        <td className="px-4 py-3 text-slate-200">
                          {typeLabel(quotation.quotationType)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-100">
                          {fmtMoney(quotation.totalAmount, quotation.currency)}
                        </td>
                        <td className="px-4 py-3 text-slate-200">
                          {fmtDate(quotation.validUntil)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={quotation.status} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <DocumentPreviewLink
                              href={`/westsides/quotations/${quotation.id}/print`}
                            />
                            {quotation.status === 'DRAFT' && (
                              <Btn
                                variant="ghost"
                                size="xs"
                                onClick={() => void openEdit(quotation.id)}
                                loading={editLoadingId === quotation.id}
                              >
                                Edit
                              </Btn>
                            )}
                            {actions.map((action) => (
                              <Btn
                                key={action.action}
                                variant={action.variant}
                                size="xs"
                                onClick={() => void handleAction(quotation.id, action.action)}
                                loading={actioning === `${quotation.id}-${action.action}`}
                              >
                                {action.label}
                              </Btn>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {creating && (
        <QuotationModal
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
        <QuotationModal
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
    </div>
  );
}
