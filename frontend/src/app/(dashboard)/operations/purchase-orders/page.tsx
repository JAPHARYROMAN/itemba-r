'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { DocumentPreviewLink } from '@/components/documents';
import {
  Card,
  PageHeader,
  PageToolbar,
  StatCard,
  StatusBadge,
  Modal,
  ConfirmDialog,
  Btn,
  SkeletonTable,
  EmptyState,
  FormInput,
  FormSelect,
  FormTextarea,
  showToast,
} from '@/components/ui';
import {
  backendDelete,
  backendGet,
  backendList,
  backendPage,
  backendPatch,
  backendPost,
} from '@/lib/api-client';
import { cellToString, downloadTextFile, formatDateOnly, rowsToCsv } from '@/lib/report-export';
import { downloadTablePdf } from '@/lib/export-download';
import { useAuth } from '@/hooks/use-auth';
import { OrderLineEditor, mergeOrderProductOptions } from '../_components/order-line-editor';
import { PurchaseOrderTabs } from './_components/PurchaseOrderTabs';

interface Company {
  id: string;
  name: string;
  code: string;
}
interface Division {
  id: string;
  name: string;
  code: string;
}
interface Branch {
  id: string;
  name: string;
  code?: string | null;
  divisionId: string;
}
interface Supplier {
  id: string;
  name: string;
  supplierCode?: string | null;
  supplierType: string;
  divisionId?: string | null;
}
interface Product {
  id: string;
  name: string;
  productCode?: string | null;
  sku?: string | null;
  barcode?: string | null;
  baseUnitId?: string | null;
  baseUnit?: { name?: string | null; symbol?: string | null } | null;
  category?: { id?: string | null; name?: string | null; categoryType?: string | null } | null;
  defaultPurchasePrice?: number | string | null;
  defaultSellingPrice?: number | string | null;
  wholesalePrice?: number | string | null;
  retailPrice?: number | string | null;
}
interface ProductCategory {
  id: string;
  name: string;
  categoryType?: string | null;
  parentCategory?: { name?: string | null } | null;
}
interface Unit {
  id: string;
  name: string;
  symbol: string;
}

interface PurchaseOrderLine {
  id?: string;
  productId: string;
  product?: Product | null;
  description: string;
  qty: number;
  quantity?: number | string;
  unitId: string;
  unitPrice: number;
  unitCost?: number | string;
  lineTotal?: number | string;
  discount: number;
  tax: number;
  batchNumber: string;
  expiryDate: string;
}

interface PurchaseOrder {
  id: string;
  purchaseOrderNumber?: string;
  orderDate: string;
  expectedDate?: string | null;
  supplierInvoiceNumber?: string | null;
  supplierInvoiceDate?: string | null;
  displayInvoiceNumber?: string | null;
  displayInvoiceDate?: string | null;
  invoiceSource?: 'PROCUREMENT_INVOICE' | 'PURCHASE_ORDER_REFERENCE' | 'MISSING';
  invoiceReferences?: Array<{
    id?: string | null;
    number: string;
    date?: string | null;
    status?: string | null;
    source: string;
  }>;
  supplierId?: string | null;
  supplierName?: string | null;
  purchaseType: string;
  totalAmount: number;
  outstandingAmount: number;
  status: string;
  paymentStatus: string;
  currency: string;
  notes?: string | null;
  companyId: string;
  divisionId?: string | null;
  branchId?: string | null;
  company?: { name: string } | null;
  supplier?: { name: string } | null;
  lines?: PurchaseOrderLine[];
}

interface PurchaseOrderForm {
  companyId: string;
  divisionId: string;
  branchId: string;
  supplierId: string;
  supplierName: string;
  purchaseType: string;
  orderDate: string;
  expectedDate: string;
  supplierInvoiceNumber: string;
  supplierInvoiceDate: string;
  currency: string;
  notes: string;
  lines: PurchaseOrderLine[];
}

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

const emptyPaginated = <T,>(): Paginated<T> => ({ data: [], total: 0, page: 1, totalPages: 1 });

const PURCHASE_TYPES = [
  'CASH_PURCHASE',
  'CREDIT_PURCHASE',
  'STOCK_PURCHASE',
  'SERVICE_PURCHASE',
  'ASSET_PURCHASE',
  'INTERNAL_COMPANY',
  'OTHER',
];
const PURCHASE_STATUSES = [
  'DRAFT',
  'CONFIRMED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
  'VOIDED',
];
const PAYMENT_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID'];
const CURRENCIES = ['TZS', 'USD', 'EUR'];
const EXPORT_COLUMNS = [
  'PO #',
  'Invoice #',
  'Invoice Date',
  'Date',
  'Expected',
  'Supplier',
  'Type',
  'Status',
  'Payment',
  'Currency',
  'Total',
  'Outstanding',
];

interface PurchaseSummary {
  totals?: { count?: number; totalAmount?: number; outstandingAmount?: number };
  invoices?: {
    missingInvoiceCount?: number;
    recordedInvoiceCount?: number;
    linkedInvoiceCount?: number;
  };
}

const BLANK_LINE = (): PurchaseOrderLine => ({
  productId: '',
  description: '',
  qty: 1,
  unitId: '',
  unitPrice: 0,
  discount: 0,
  tax: 0,
  batchNumber: '',
  expiryDate: '',
});
const blankForm = (): PurchaseOrderForm => ({
  companyId: '',
  divisionId: '',
  branchId: '',
  supplierId: '',
  supplierName: '',
  purchaseType: 'CASH_PURCHASE',
  orderDate: new Date().toISOString().slice(0, 10),
  expectedDate: '',
  supplierInvoiceNumber: '',
  supplierInvoiceDate: '',
  currency: 'TZS',
  notes: '',
  lines: [BLANK_LINE()],
});

function fmtMoney(n: number | string | null | undefined, ccy = 'TZS') {
  const value = Number(n ?? 0);
  return `${ccy} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0)}`;
}

function PurchaseOrderModal({
  mode,
  initial,
  companies,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: PurchaseOrder;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<PurchaseOrderForm>(() =>
    initial
      ? {
          companyId: initial.companyId,
          divisionId: initial.divisionId ?? '',
          branchId: initial.branchId ?? '',
          supplierId: initial.supplierId ?? '',
          supplierName: initial.supplierName ?? '',
          purchaseType: initial.purchaseType,
          orderDate: initial.orderDate.slice(0, 10),
          expectedDate: initial.expectedDate?.slice(0, 10) ?? '',
          supplierInvoiceNumber: initial.supplierInvoiceNumber ?? '',
          supplierInvoiceDate: initial.supplierInvoiceDate?.slice(0, 10) ?? '',
          currency: initial.currency,
          notes: initial.notes ?? '',
          lines: initial.lines?.length
            ? initial.lines.map((line: any) => ({
                id: line.id,
                productId: line.productId ?? '',
                description: line.description ?? '',
                qty: Number(line.qty ?? line.quantity ?? 1),
                unitId: line.unitId ?? '',
                unitPrice: Number(line.unitPrice ?? line.unitCost ?? 0),
                discount: Number(line.discount ?? line.discountAmount ?? 0),
                tax: Number(line.tax ?? line.taxAmount ?? 0),
                batchNumber: line.batchNumber ?? '',
                expiryDate: line.expiryDate?.slice(0, 10) ?? '',
              }))
            : [BLANK_LINE()],
        }
      : blankForm(),
  );
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productSearchCategoryId, setProductSearchCategoryId] = useState('');
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const [units, setUnits] = useState<Unit[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selectedProductIdKey = form.lines
    .map((line) => line.productId)
    .filter(Boolean)
    .join('|');
  const handleProductSearch = useCallback((query: string, filters?: { categoryId?: string }) => {
    setProductSearchQuery(query);
    setProductSearchCategoryId(filters?.categoryId ?? '');
  }, []);

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
      setSuppliers([]);
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

  useEffect(() => {
    if (!form.companyId || !form.divisionId) {
      setSuppliers([]);
      return;
    }
    let cancelled = false;
    backendList<Supplier>('/suppliers', {
      query: {
        companyId: form.companyId,
        divisionId: form.divisionId,
        status: 'ACTIVE',
        limit: 200,
      },
    })
      .then((rows) => {
        if (!cancelled) setSuppliers(rows);
      })
      .catch(() => {
        if (!cancelled) setSuppliers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [form.companyId, form.divisionId]);

  useEffect(() => {
    if (!form.companyId) {
      setCategories([]);
      return;
    }
    let cancelled = false;
    backendList<ProductCategory>('/product-categories', {
      query: {
        companyId: form.companyId,
        limit: 5000,
      },
    })
      .then((rows) => {
        if (!cancelled) setCategories(rows);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [form.companyId]);

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
            supplierId: form.supplierId || undefined,
            categoryId: productSearchCategoryId || undefined,
            limit: search ? 50 : 200,
            ...(search && { search }),
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
  }, [
    form.companyId,
    form.divisionId,
    form.supplierId,
    productSearchCategoryId,
    productSearchQuery,
    selectedProductIdKey,
  ]);

  const setField = <K extends keyof PurchaseOrderForm>(k: K, v: PurchaseOrderForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const setLine = (i: number, patch: Partial<PurchaseOrderLine>) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    }));
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, BLANK_LINE()] }));
  const removeLine = (i: number) =>
    setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));
  const branchOptions = form.divisionId
    ? branches.filter((branch) => branch.divisionId === form.divisionId)
    : [];

  const handleSubmit = async () => {
    if (!form.companyId) {
      setError('Company is required');
      return;
    }
    if (!form.divisionId) {
      setError('Division is required');
      return;
    }
    if (!form.branchId) {
      setError('Branch/location is required');
      return;
    }
    if (!form.supplierId && !form.supplierName.trim()) {
      setError('Supplier or name required');
      return;
    }
    if (!form.lines.length) {
      setError('Add at least one line');
      return;
    }
    if (form.lines.some((l) => !l.productId || !l.unitId)) {
      setError('Each line needs product and unit');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        divisionId: form.divisionId,
        branchId: form.branchId,
        purchaseType: form.purchaseType,
        orderDate: form.orderDate,
        currency: form.currency,
        lines: form.lines.map((l) => {
          const out: Record<string, unknown> = {
            productId: l.productId,
            description: l.description,
            quantity: Number(l.qty) || 0,
            unitId: l.unitId,
            unitCost: Number(l.unitPrice) || 0,
            discountAmount: Number(l.discount) || 0,
            taxAmount: Number(l.tax) || 0,
          };
          if (l.batchNumber) out.batchNumber = l.batchNumber;
          if (l.expiryDate) out.expiryDate = l.expiryDate;
          return out;
        }),
      };
      if (form.supplierId) body.supplierId = form.supplierId;
      if (form.supplierName) body.supplierName = form.supplierName;
      if (form.expectedDate) body.expectedDate = form.expectedDate;
      if (form.supplierInvoiceNumber.trim()) {
        body.supplierInvoiceNumber = form.supplierInvoiceNumber.trim();
      }
      if (form.supplierInvoiceDate) body.supplierInvoiceDate = form.supplierInvoiceDate;
      if (form.notes) body.notes = form.notes;
      if (mode === 'create') {
        await backendPost('/purchase-orders', { ...body, companyId: form.companyId });
      } else {
        await backendPatch(`/purchase-orders/${initial!.id}`, body);
      }
      showToast(
        'success',
        mode === 'create' ? 'Purchase order created' : 'Purchase order updated',
        'Saved successfully.',
      );
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed';
      setError(message);
      showToast('error', 'Could not save purchase order', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'Create Purchase Order' : 'Edit Purchase Order'}
      size="3xl"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={saving}>
            {mode === 'create' ? 'Create Draft' : 'Save Changes'}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <FormSelect
            label="Company"
            required
            value={form.companyId}
            onChange={(e) => {
              setProductSearchQuery('');
              setProductSearchCategoryId('');
              setForm((f) => ({
                ...f,
                companyId: e.target.value,
                divisionId: '',
                branchId: '',
                supplierId: '',
                lines: f.lines.map((line) => ({
                  ...line,
                  productId: '',
                })),
              }));
            }}
            placeholder="Select company"
            disabled={mode === 'edit'}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Division"
            required
            value={form.divisionId}
            onChange={(e) => {
              const divisionId = e.target.value;
              setProductSearchQuery('');
              setProductSearchCategoryId('');
              setForm((f) => ({
                ...f,
                divisionId,
                branchId: '',
                supplierId: '',
                lines: f.lines.map((line) => ({
                  ...line,
                  productId: '',
                })),
              }));
            }}
            placeholder={form.companyId ? 'Select division' : 'Select company first'}
          >
            {divisions.map((division) => (
              <option key={division.id} value={division.id}>
                {division.code ? `${division.code} — ${division.name}` : division.name}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Branch"
            required
            value={form.branchId}
            onChange={(e) => {
              const branchId = e.target.value;
              setForm((f) => ({
                ...f,
                branchId,
                lines: f.lines,
              }));
            }}
            placeholder={form.divisionId ? 'Select branch' : 'Select division first'}
            disabled={!form.divisionId}
          >
            {branchOptions.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code ? `${branch.code} — ${branch.name}` : branch.name}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Purchase Type"
            required
            value={form.purchaseType}
            onChange={(e) => setField('purchaseType', e.target.value)}
          >
            {PURCHASE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Currency"
            required
            value={form.currency}
            onChange={(e) => setField('currency', e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Supplier"
            value={form.supplierId}
            onChange={(e) => setField('supplierId', e.target.value)}
            placeholder={form.divisionId ? 'Use name below' : 'Select division first'}
            disabled={!form.divisionId}
          >
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.supplierCode ? ` (${s.supplierCode})` : ''}
              </option>
            ))}
          </FormSelect>
          <FormInput
            label="Supplier Name"
            value={form.supplierName}
            onChange={(e) => setField('supplierName', e.target.value)}
            placeholder="If no supplier selected"
          />
          <FormInput
            label="Order Date"
            required
            type="date"
            value={form.orderDate}
            onChange={(e) => setField('orderDate', e.target.value)}
          />
          <FormInput
            label="Expected Date"
            type="date"
            value={form.expectedDate}
            onChange={(e) => setField('expectedDate', e.target.value)}
          />
          <FormInput
            label="Supplier Invoice #"
            value={form.supplierInvoiceNumber}
            onChange={(e) => setField('supplierInvoiceNumber', e.target.value)}
            placeholder="Supplier-issued invoice number"
          />
          <FormInput
            label="Invoice Date"
            type="date"
            value={form.supplierInvoiceDate}
            onChange={(e) => setField('supplierInvoiceDate', e.target.value)}
          />
          <div className="col-span-3">
            <FormTextarea
              label="Notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
            />
          </div>
        </div>

        <OrderLineEditor
          variant="purchase"
          lines={form.lines}
          products={products}
          categories={categories}
          units={units}
          currency={form.currency}
          productSearchLoading={productSearchLoading}
          onAddLine={addLine}
          onRemoveLine={removeLine}
          onLineChange={setLine}
          onProductSearch={handleProductSearch}
        />
      </div>
    </Modal>
  );
}

function InvoiceReferenceModal({
  order,
  onClose,
  onSaved,
}: {
  order: PurchaseOrder;
  onClose: () => void;
  onSaved: () => void;
}) {
  const linked = order.invoiceSource === 'PROCUREMENT_INVOICE';
  const [number, setNumber] = useState(order.supplierInvoiceNumber ?? '');
  const [invoiceDate, setInvoiceDate] = useState(order.supplierInvoiceDate?.slice(0, 10) ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await backendPatch(`/purchase-orders/${order.id}/invoice-reference`, {
        supplierInvoiceNumber: number.trim() || null,
        supplierInvoiceDate: invoiceDate || null,
      });
      showToast('success', 'Supplier invoice reference updated');
      onSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not update invoice reference';
      setError(message);
      showToast('error', 'Invoice reference was not saved', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={linked ? 'Linked Supplier Invoice' : 'Supplier Invoice Reference'}
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            {linked ? 'Close' : 'Cancel'}
          </Btn>
          {!linked && (
            <Btn variant="primary" onClick={save} loading={saving}>
              Save Invoice
            </Btn>
          )}
        </>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {linked ? (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
            This reference is controlled by Procurement Supplier Invoices and cannot be changed from
            the purchase order.
          </p>
          {(order.invoiceReferences ?? []).map((invoice) => (
            <div
              key={invoice.id ?? invoice.number}
              className="rounded-lg border p-3"
              style={{ borderColor: 'var(--aurora-border)' }}
            >
              <p className="font-mono text-sm font-semibold">{invoice.number}</p>
              <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                {invoice.date ? formatDateOnly(invoice.date) : 'No invoice date'}
                {invoice.status ? ` · ${invoice.status.replace(/_/g, ' ')}` : ''}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormInput
            label="Supplier Invoice #"
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            placeholder="e.g. INV-1042"
          />
          <FormInput
            label="Invoice Date"
            type="date"
            value={invoiceDate}
            onChange={(event) => setInvoiceDate(event.target.value)}
          />
          <p className="sm:col-span-2 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            This changes invoice metadata only. It does not alter stock, totals, payables, or
            accounting entries.
          </p>
        </div>
      )}
    </Modal>
  );
}

function DeleteConfirm({
  order,
  onClose,
  onConfirmed,
}: {
  order: PurchaseOrder;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const handleDelete = async () => {
    setSaving(true);
    setError('');
    try {
      await backendDelete(`/purchase-orders/${order.id}`);
      showToast('success', 'Purchase order deleted', order.purchaseOrderNumber ?? order.id);
      onConfirmed();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed';
      setError(message);
      showToast('error', 'Could not delete purchase order', message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Delete Order"
      size="md"
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
        <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>
        Delete order <strong>{order.purchaseOrderNumber ?? order.id}</strong>?
      </p>
    </Modal>
  );
}

function ReceiveOrderModal({
  order,
  onClose,
  onReceived,
}: {
  order: PurchaseOrder;
  onClose: () => void;
  onReceived: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleReceive = async () => {
    setSaving(true);
    setError('');
    try {
      await backendPatch(`/purchase-orders/${order.id}/receive`, {});
      showToast('success', 'Purchase order received', order.purchaseOrderNumber ?? order.id);
      onReceived();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to receive order';
      setError(message);
      showToast('error', 'Could not receive purchase order', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Receive Purchase Order"
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="success" onClick={handleReceive} loading={saving}>
            Receive
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
        <div className="text-sm" style={{ color: 'var(--aurora-text)' }}>
          <div>
            Order: <span className="font-mono">{order.purchaseOrderNumber ?? order.id}</span>
          </div>
          <div>
            Supplier:{' '}
            <span className="font-medium">{order.supplier?.name ?? order.supplierName ?? '-'}</span>
          </div>
          <div>Inventory will be received into this order&apos;s branch/location.</div>
        </div>
      </div>
    </Modal>
  );
}

export default function PurchaseOrdersPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<PurchaseOrder> | null>(null);
  const [summary, setSummary] = useState<PurchaseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPayment, setFilterPayment] = useState('');
  const [filterInvoiceStatus, setFilterInvoiceStatus] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);
  const [deleting, setDeleting] = useState<PurchaseOrder | null>(null);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<PurchaseOrder | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const canView = hasPermission('purchases.view');
  const canCreate = hasPermission('purchases.create');
  const canConfirm = hasPermission('purchases.confirm');
  const canReceive = hasPermission('purchases.receive');
  const canCancel = hasPermission('purchases.cancel');

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
    if (!canView) return;
    setLoading(true);
    setLoadError('');
    try {
      const query: Record<string, string | number> = { page, limit: 20 };
      if (filterSearch.trim()) query.search = filterSearch.trim();
      if (filterCompany) query.companyId = filterCompany;
      if (filterType) query.purchaseType = filterType;
      if (filterStatus) query.status = filterStatus;
      if (filterPayment) query.paymentStatus = filterPayment;
      if (filterInvoiceStatus) query.invoiceStatus = filterInvoiceStatus;
      if (filterDateFrom) query.dateFrom = filterDateFrom;
      if (filterDateTo) query.dateTo = filterDateTo;
      const summaryQuery = { ...query };
      delete summaryQuery.page;
      delete summaryQuery.limit;
      const [pageResult, summaryResult] = await Promise.all([
        backendPage<PurchaseOrder>('/purchase-orders', { query }),
        backendGet<PurchaseSummary>('/purchase-orders/summary', { query: summaryQuery }),
      ]);
      setData(pageResult);
      setSummary(summaryResult);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load purchase orders';
      setData(emptyPaginated<PurchaseOrder>());
      setLoadError(message);
      showToast('error', 'Could not load purchase orders', message);
    } finally {
      setLoading(false);
    }
  }, [
    canView,
    page,
    filterSearch,
    filterCompany,
    filterType,
    filterStatus,
    filterPayment,
    filterInvoiceStatus,
    filterDateFrom,
    filterDateTo,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  // Debounce the search field (~300ms) so typing doesn't fire a fetch per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilterSearch((current) => {
        if (current === searchInput) return current;
        setPage(1);
        return searchInput;
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Fetch the FULL filtered register (not just the visible page) as export rows.
  const fetchExportRows = useCallback(async () => {
    const query: Record<string, string | number> = {};
    if (filterSearch.trim()) query.search = filterSearch.trim();
    if (filterCompany) query.companyId = filterCompany;
    if (filterType) query.purchaseType = filterType;
    if (filterStatus) query.status = filterStatus;
    if (filterPayment) query.paymentStatus = filterPayment;
    if (filterInvoiceStatus) query.invoiceStatus = filterInvoiceStatus;
    if (filterDateFrom) query.dateFrom = filterDateFrom;
    if (filterDateTo) query.dateTo = filterDateTo;

    const CAP = 5000;
    const result = await backendPage<PurchaseOrder>('/purchase-orders', {
      query: { ...query, page: 1, limit: CAP },
    });
    const orders = (result.data ?? []).slice(0, CAP);
    if (!orders.length) {
      showToast('info', 'Nothing to export', 'No purchase orders match the current filters.');
      return null;
    }

    const rows = orders.map((o) => ({
      'PO #': o.purchaseOrderNumber ?? o.id,
      'Invoice #': o.displayInvoiceNumber ?? '',
      'Invoice Date': formatDateOnly(o.displayInvoiceDate),
      Date: formatDateOnly(o.orderDate),
      Expected: formatDateOnly(o.expectedDate),
      Supplier: o.supplier?.name ?? o.supplierName ?? 'Supplier',
      Type: o.purchaseType,
      Status: o.status,
      Payment: o.paymentStatus,
      Currency: o.currency,
      Total: o.totalAmount,
      Outstanding: o.outstandingAmount,
    }));
    if (result.total > orders.length) {
      showToast(
        'warning',
        'Export truncated',
        `Exported the first ${orders.length} of ${result.total} matching orders.`,
      );
    }
    return rows;
  }, [
    filterSearch,
    filterCompany,
    filterType,
    filterStatus,
    filterPayment,
    filterInvoiceStatus,
    filterDateFrom,
    filterDateTo,
  ]);

  const exportCsv = useCallback(async () => {
    if (!canView) return;
    setExporting(true);
    try {
      const rows = await fetchExportRows();
      if (rows) {
        downloadTextFile(
          `purchase-orders-${new Date().toISOString().slice(0, 10)}.csv`,
          'text/csv;charset=utf-8',
          rowsToCsv(rows, EXPORT_COLUMNS),
        );
      }
    } catch (err) {
      showToast(
        'error',
        'Export failed',
        err instanceof Error ? err.message : 'Could not export purchase orders.',
      );
    } finally {
      setExporting(false);
    }
  }, [canView, fetchExportRows]);

  const exportPdf = useCallback(async () => {
    if (!canView) return;
    setExportingPdf(true);
    try {
      const rows = await fetchExportRows();
      if (rows) {
        const filters = [
          filterCompany ? companies.find((c) => c.id === filterCompany)?.name : '',
          filterType,
          filterStatus,
          filterPayment,
          filterInvoiceStatus,
          filterDateFrom || filterDateTo
            ? `${filterDateFrom || '...'} to ${filterDateTo || '...'}`
            : '',
          filterSearch.trim() ? `search: ${filterSearch.trim()}` : '',
        ].filter(Boolean);
        await downloadTablePdf({
          title: 'Purchase Orders',
          subtitle: filters.length ? filters.join(' | ') : undefined,
          companyId: filterCompany || undefined,
          columns: EXPORT_COLUMNS,
          rows: rows.map((r) =>
            EXPORT_COLUMNS.map((c) => cellToString((r as Record<string, unknown>)[c])),
          ),
          numericColumns: [10, 11],
          baseName: 'purchase-orders',
        });
      }
    } catch (err) {
      showToast(
        'error',
        'Export failed',
        err instanceof Error ? err.message : 'Could not export purchase orders.',
      );
    } finally {
      setExportingPdf(false);
    }
  }, [
    canView,
    fetchExportRows,
    companies,
    filterSearch,
    filterCompany,
    filterType,
    filterStatus,
    filterPayment,
    filterInvoiceStatus,
    filterDateFrom,
    filterDateTo,
  ]);

  useEffect(() => {
    // Seed filters from drill-through URLs (operations dashboard links here with
    // ?status=DRAFT / ?status=RECEIVED / ?paymentStatus=UNPAID).
    const params = new URLSearchParams(window.location.search);
    const status = params.get('status');
    if (status && PURCHASE_STATUSES.includes(status)) setFilterStatus(status);
    const paymentStatus = params.get('paymentStatus');
    if (paymentStatus && PAYMENT_STATUSES.includes(paymentStatus)) setFilterPayment(paymentStatus);
    const purchaseType = params.get('purchaseType');
    if (purchaseType) setFilterType(purchaseType);
  }, []);

  const [pendingAction, setPendingAction] = useState<{
    id: string;
    action: 'confirm' | 'cancel';
  } | null>(null);

  const doAction = async (id: string, action: 'confirm' | 'cancel') => {
    setActionLoading(`${id}:${action}`);
    setActionError('');
    try {
      await backendPatch(`/purchase-orders/${id}/${action}`);
      await load();
      showToast(
        'success',
        action === 'confirm' ? 'Purchase order confirmed' : 'Purchase order cancelled',
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed';
      setActionError(message);
      showToast('error', `Could not ${action} purchase order`, message);
    } finally {
      setActionLoading(null);
    }
  };

  const runPendingAction = async () => {
    if (!pendingAction) return;
    await doAction(pendingAction.id, pendingAction.action);
    setPendingAction(null);
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Purchase Orders" subtitle="Supplier orders" />
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

  const stats = {
    confirmed: data?.data.filter((o) => o.status === 'CONFIRMED').length ?? 0,
    received:
      data?.data.filter((o) => o.status === 'RECEIVED' || o.status === 'PARTIALLY_RECEIVED')
        .length ?? 0,
    cost: data?.data.reduce((acc, o) => acc + Number(o.totalAmount || 0), 0) ?? 0,
  };

  return (
    <div className="p-6 space-y-6">
      {creating && (
        <PurchaseOrderModal
          mode="create"
          companies={companies}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {editing && (
        <PurchaseOrderModal
          mode="edit"
          initial={editing}
          companies={companies}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {deleting && (
        <DeleteConfirm
          order={deleting}
          onClose={() => setDeleting(null)}
          onConfirmed={() => {
            setDeleting(null);
            load();
          }}
        />
      )}
      {receiving && (
        <ReceiveOrderModal
          order={receiving}
          onClose={() => setReceiving(null)}
          onReceived={() => {
            setReceiving(null);
            load();
          }}
        />
      )}
      {editingInvoice && (
        <InvoiceReferenceModal
          order={editingInvoice}
          onClose={() => setEditingInvoice(null)}
          onSaved={() => {
            setEditingInvoice(null);
            void load();
          }}
        />
      )}
      {pendingAction && (
        <ConfirmDialog
          open
          variant={pendingAction.action === 'cancel' ? 'danger' : 'default'}
          title={
            pendingAction.action === 'confirm' ? 'Confirm purchase order' : 'Cancel purchase order'
          }
          message={
            pendingAction.action === 'confirm'
              ? 'This applies tax and confirms the purchase order.'
              : 'This cancels the purchase order and reverses any linked payable. This cannot be undone.'
          }
          confirmLabel={pendingAction.action === 'confirm' ? 'Confirm order' : 'Cancel order'}
          cancelLabel="Back"
          loading={actionLoading === `${pendingAction.id}:${pendingAction.action}`}
          onConfirm={runPendingAction}
          onClose={() => setPendingAction(null)}
        />
      )}

      <PageHeader
        title="Purchase Orders"
        subtitle="Supplier orders, receiving, and procurement spend"
      />
      <PurchaseOrderTabs />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 aurora-stagger">
        <StatCard label="Total Orders" value={summary?.totals?.count ?? data?.total ?? 0} />
        <StatCard label="Confirmed (page)" value={stats.confirmed} />
        <StatCard label="Received (page)" value={stats.received} />
        <StatCard label="Total Cost" value={fmtMoney(summary?.totals?.totalAmount ?? stats.cost)} />
        <StatCard
          label="Missing Invoice"
          value={summary?.invoices?.missingInvoiceCount ?? 0}
          variant={(summary?.invoices?.missingInvoiceCount ?? 0) > 0 ? 'amber' : 'green'}
        />
      </div>

      {loadError && (
        <div
          role="alert"
          className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2"
        >
          {loadError}
        </div>
      )}
      {actionError && (
        <div
          role="alert"
          className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2"
        >
          {actionError}
        </div>
      )}

      <PageToolbar
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Order #, invoice #, or supplier…"
        filters={
          <>
            <select
              aria-label="Filter by company"
              value={filterCompany}
              onChange={(e) => {
                setFilterCompany(e.target.value);
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
              aria-label="Filter by purchase type"
              value={filterType}
              onChange={(e) => {
                setFilterType(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Types</option>
              {PURCHASE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by status"
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Status</option>
              {PURCHASE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by payment status"
              value={filterPayment}
              onChange={(e) => {
                setFilterPayment(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Payments</option>
              {PAYMENT_STATUSES.map((p) => (
                <option key={p} value={p}>
                  {p.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by invoice status"
              value={filterInvoiceStatus}
              onChange={(e) => {
                setFilterInvoiceStatus(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Invoice Status</option>
              <option value="MISSING">Missing Invoice</option>
              <option value="RECORDED">Recorded on Purchase</option>
              <option value="LINKED">Linked Procurement Invoice</option>
            </select>
            <input
              type="date"
              aria-label="Filter from date"
              value={filterDateFrom}
              onChange={(e) => {
                setFilterDateFrom(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            />
            <input
              type="date"
              aria-label="Filter to date"
              value={filterDateTo}
              onChange={(e) => {
                setFilterDateTo(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            />
          </>
        }
        actions={
          <>
            <Btn variant="secondary" onClick={exportCsv} loading={exporting}>
              Export CSV
            </Btn>
            <Btn variant="secondary" onClick={exportPdf} loading={exportingPdf}>
              Export PDF
            </Btn>
            {canCreate ? (
              <Btn variant="primary" onClick={() => setCreating(true)}>
                + New Order
              </Btn>
            ) : null}
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1240px]" aria-label="Purchase orders">
            <caption className="sr-only">Purchase orders with status, totals, and actions</caption>
            <thead>
              <tr
                className="text-left text-xs uppercase bg-gray-50"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th scope="col" className="px-4 py-3">
                  Number
                </th>
                <th scope="col" className="px-4 py-3">
                  Date
                </th>
                <th scope="col" className="px-4 py-3">
                  Supplier
                </th>
                <th scope="col" className="px-4 py-3">
                  Invoice
                </th>
                <th scope="col" className="px-4 py-3">
                  Type
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
                  Payment
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10}>
                    <SkeletonTable rows={6} cols={10} />
                  </td>
                </tr>
              ) : !data?.data.length ? (
                <tr>
                  <td colSpan={10}>
                    <EmptyState
                      title="No purchase orders"
                      description="No orders match the current filters."
                    />
                  </td>
                </tr>
              ) : (
                data.data.map((o) => {
                  const orderLabel = o.purchaseOrderNumber ?? o.id.slice(0, 8);
                  return (
                    <tr key={o.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs">
                        {o.purchaseOrderNumber ?? o.id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {new Date(o.orderDate).toLocaleDateString('en-GB')}
                      </td>
                      <td className="px-4 py-3">
                        {o.supplier?.name ?? o.supplierName ?? (
                          <span className="italic" style={{ color: 'var(--aurora-text-muted)' }}>
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {o.displayInvoiceNumber ? (
                          <div>
                            <p className="font-mono text-xs">{o.displayInvoiceNumber}</p>
                            <p
                              className="mt-0.5 text-[10px] uppercase"
                              style={{ color: 'var(--aurora-text-muted)' }}
                            >
                              {o.invoiceSource === 'PROCUREMENT_INVOICE' ? 'Linked' : 'Recorded'}
                            </p>
                          </div>
                        ) : (
                          <span className="text-xs font-medium text-amber-600">Missing</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">{o.purchaseType.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {fmtMoney(o.totalAmount, o.currency)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {fmtMoney(o.outstandingAmount, o.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge value={o.status} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge value={o.paymentStatus} />
                      </td>
                      <td className="px-4 py-3 text-right space-x-1">
                        <Link
                          href={`/operations/purchase-orders/${o.id}`}
                          aria-label={`View order ${orderLabel}`}
                          className="inline-flex items-center justify-center px-2.5 py-1 text-[11px] rounded-md font-medium bg-transparent text-zinc-600 hover:bg-zinc-100 border border-transparent transition"
                        >
                          View
                        </Link>
                        <DocumentPreviewLink href={`/operations/purchase-orders/${o.id}/print`} />
                        {canCreate && !['CANCELLED', 'VOIDED'].includes(o.status) && (
                          <Btn
                            variant="ghost"
                            size="xs"
                            aria-label={`${o.displayInvoiceNumber ? 'View or edit' : 'Add'} invoice for ${orderLabel}`}
                            onClick={() => setEditingInvoice(o)}
                          >
                            {o.displayInvoiceNumber ? 'Invoice' : 'Add Invoice'}
                          </Btn>
                        )}
                        {o.status === 'DRAFT' && canCreate && (
                          <Btn
                            variant="ghost"
                            size="xs"
                            aria-label={`Edit order ${orderLabel}`}
                            onClick={() => setEditing(o)}
                          >
                            Edit
                          </Btn>
                        )}
                        {o.status === 'DRAFT' && canConfirm && (
                          <Btn
                            variant="primary"
                            size="xs"
                            aria-label={`Confirm order ${orderLabel}`}
                            loading={actionLoading === `${o.id}:confirm`}
                            onClick={() => setPendingAction({ id: o.id, action: 'confirm' })}
                          >
                            Confirm
                          </Btn>
                        )}
                        {(o.status === 'CONFIRMED' || o.status === 'PARTIALLY_RECEIVED') &&
                          canReceive && (
                            <Btn
                              variant="success"
                              size="xs"
                              aria-label={`Receive order ${orderLabel}`}
                              onClick={() => setReceiving(o)}
                            >
                              Receive
                            </Btn>
                          )}
                        {o.status === 'CONFIRMED' && canCancel && (
                          <Btn
                            variant="danger"
                            size="xs"
                            aria-label={`Cancel order ${orderLabel}`}
                            loading={actionLoading === `${o.id}:cancel`}
                            onClick={() => setPendingAction({ id: o.id, action: 'cancel' })}
                          >
                            Cancel
                          </Btn>
                        )}
                        {o.status === 'DRAFT' && canCreate && (
                          <Btn
                            variant="ghost"
                            size="xs"
                            aria-label={`Delete order ${orderLabel}`}
                            onClick={() => setDeleting(o)}
                          >
                            Delete
                          </Btn>
                        )}
                      </td>
                    </tr>
                  );
                })
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
