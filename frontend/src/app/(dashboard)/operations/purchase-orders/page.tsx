'use client';

import { useCallback, useEffect, useState } from 'react';
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
} from '@/components/ui';
import {
  backendDelete,
  backendList,
  backendPage,
  backendPatch,
  backendPost,
} from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { OrderLineEditor } from '../_components/order-line-editor';

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
  category?: { name?: string | null } | null;
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

interface PurchaseOrderLine {
  id?: string;
  productId: string;
  description: string;
  qty: number;
  unitId: string;
  unitPrice: number;
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
  'CLOSED',
];
const PAYMENT_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID'];
const CURRENCIES = ['TZS', 'USD', 'EUR'];

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
  const [units, setUnits] = useState<Unit[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
      setProducts([]);
      return;
    }
    let cancelled = false;
    Promise.allSettled([
      backendList<Supplier>('/suppliers', {
        query: {
          companyId: form.companyId,
          divisionId: form.divisionId,
          limit: 200,
        },
      }),
      backendList<Product>('/products', {
        query: {
          companyId: form.companyId,
          divisionId: form.divisionId,
          limit: 200,
        },
      }),
    ]).then(([supplierResult, productResult]) => {
      if (cancelled) return;
      setSuppliers(supplierResult.status === 'fulfilled' ? supplierResult.value : []);
      setProducts(productResult.status === 'fulfilled' ? productResult.value : []);
    });
    return () => {
      cancelled = true;
    };
  }, [form.companyId, form.divisionId, form.branchId]);

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
        companyId: form.companyId,
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
      if (form.notes) body.notes = form.notes;
      if (mode === 'create') {
        await backendPost('/purchase-orders', body);
      } else {
        await backendPatch(`/purchase-orders/${initial!.id}`, body);
      }
      onSaved();
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
          <div className="col-span-2">
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
          units={units}
          currency={form.currency}
          onAddLine={addLine}
          onRemoveLine={removeLine}
          onLineChange={setLine}
        />
      </div>
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
      onReceived();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to receive order');
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
  const [loading, setLoading] = useState(true);
  const [filterSearch, setFilterSearch] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPayment, setFilterPayment] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);
  const [deleting, setDeleting] = useState<PurchaseOrder | null>(null);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [loadError, setLoadError] = useState('');

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
      if (filterDateFrom) query.dateFrom = filterDateFrom;
      if (filterDateTo) query.dateTo = filterDateTo;
      setData(await backendPage<PurchaseOrder>('/purchase-orders', { query }));
    } catch (err: unknown) {
      setData(emptyPaginated<PurchaseOrder>());
      setLoadError(err instanceof Error ? err.message : 'Failed to load purchase orders');
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
    filterDateFrom,
    filterDateTo,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const doAction = async (id: string, action: 'confirm' | 'cancel') => {
    setActionLoading(`${id}:${action}`);
    setActionError('');
    try {
      await backendPatch(`/purchase-orders/${id}/${action}`);
      await load();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setActionLoading(null);
    }
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

      <PageHeader
        title="Purchase Orders"
        subtitle="Supplier orders, receiving, and procurement spend"
      />

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Total Orders" value={data?.total ?? 0} />
        <StatCard label="Confirmed (page)" value={stats.confirmed} />
        <StatCard label="Received (page)" value={stats.received} />
        <StatCard label="Total Cost (page)" value={fmtMoney(stats.cost)} />
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
        search={filterSearch}
        onSearch={(v) => {
          setFilterSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Order # or supplier…"
        filters={
          <>
            <select
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
            <input
              type="date"
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
          canCreate ? (
            <Btn variant="primary" onClick={() => setCreating(true)}>
              + New Order
            </Btn>
          ) : null
        }
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr
                className="text-left text-xs uppercase bg-gray-50"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Outstanding</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9}>
                    <PageSpinner />
                  </td>
                </tr>
              ) : !data?.data.length ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-10 text-center text-sm"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    No orders
                  </td>
                </tr>
              ) : (
                data.data.map((o) => (
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
                      {o.status === 'DRAFT' && canCreate && (
                        <Btn variant="ghost" size="xs" onClick={() => setEditing(o)}>
                          Edit
                        </Btn>
                      )}
                      {o.status === 'DRAFT' && canConfirm && (
                        <Btn
                          variant="primary"
                          size="xs"
                          loading={actionLoading === `${o.id}:confirm`}
                          onClick={() => doAction(o.id, 'confirm')}
                        >
                          Confirm
                        </Btn>
                      )}
                      {(o.status === 'CONFIRMED' || o.status === 'PARTIALLY_RECEIVED') &&
                        canReceive && (
                          <Btn variant="success" size="xs" onClick={() => setReceiving(o)}>
                            Receive
                          </Btn>
                        )}
                      {(o.status === 'CONFIRMED' || o.status === 'RECEIVED') && canCancel && (
                        <Btn
                          variant="danger"
                          size="xs"
                          loading={actionLoading === `${o.id}:cancel`}
                          onClick={() => doAction(o.id, 'cancel')}
                        >
                          Cancel
                        </Btn>
                      )}
                      {o.status === 'DRAFT' && canCreate && (
                        <Btn variant="ghost" size="xs" onClick={() => setDeleting(o)}>
                          Delete
                        </Btn>
                      )}
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
