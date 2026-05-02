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

interface Company {
  id: string;
  name: string;
  code: string;
}
interface Customer {
  id: string;
  name: string;
  customerCode?: string | null;
  customerType: string;
}
interface Product {
  id: string;
  name: string;
  productCode?: string | null;
}
interface InventoryLocation {
  id: string;
  name: string;
  locationCode: string;
}
interface Unit {
  id: string;
  name: string;
  symbol: string;
}
interface Employee {
  id: string;
  fullName?: string | null;
  employeeCode?: string | null;
  defaultCommissionRate?: number | string | null;
}
interface CashAccount {
  id: string;
  accountName: string;
  accountType: string;
}

interface SalesOrderLine {
  id?: string;
  productId: string;
  description: string;
  qty: number;
  unitId: string;
  unitPrice: number;
  discount: number;
  tax: number;
  inventoryLocationId: string;
  batchId: string;
}

interface SalesOrder {
  id: string;
  orderNumber?: string;
  orderDate: string;
  dueDate?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  salesType: string;
  totalAmount: number;
  outstandingAmount: number;
  status: string;
  paymentStatus: string;
  currency: string;
  notes?: string | null;
  salespersonId?: string | null;
  paymentMethod?: string | null;
  cashAccountId?: string | null;
  paymentReference?: string | null;
  companyId: string;
  company?: { name: string } | null;
  customer?: { name: string } | null;
  lines?: SalesOrderLine[];
}

interface SalesOrderForm {
  companyId: string;
  divisionId: string;
  customerId: string;
  customerName: string;
  salesType: string;
  orderDate: string;
  dueDate: string;
  currency: string;
  notes: string;
  salespersonId: string;
  paymentMethod: string;
  cashAccountId: string;
  paymentReference: string;
  lines: SalesOrderLine[];
}

interface Division {
  id: string;
  name: string;
  code: string;
}

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

const emptyPaginated = <T,>(): Paginated<T> => ({ data: [], total: 0, page: 1, totalPages: 1 });

const SALES_TYPES = [
  'CASH_SALE',
  'CREDIT_SALE',
  'WHOLESALE',
  'RETAIL',
  'SERVICE',
  'INTERNAL_COMPANY',
  'OTHER',
];
const SALES_STATUSES = ['DRAFT', 'CONFIRMED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'CLOSED'];
const PAYMENT_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID'];
const CURRENCIES = ['TZS', 'USD', 'EUR'];
const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'MOBILE_MONEY', label: 'Mobile Money' },
  { value: 'BANK_CARD', label: 'Bank Card' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CREDIT', label: 'Credit (invoice)' },
  { value: 'MIXED', label: 'Mixed' },
  { value: 'OTHER', label: 'Other' },
];

const BLANK_LINE = (): SalesOrderLine => ({
  productId: '',
  description: '',
  qty: 1,
  unitId: '',
  unitPrice: 0,
  discount: 0,
  tax: 0,
  inventoryLocationId: '',
  batchId: '',
});
const blankForm = (): SalesOrderForm => ({
  companyId: '',
  divisionId: '',
  customerId: '',
  customerName: '',
  salesType: 'CASH_SALE',
  orderDate: new Date().toISOString().slice(0, 10),
  dueDate: '',
  currency: 'TZS',
  notes: '',
  salespersonId: '',
  paymentMethod: 'CREDIT',
  cashAccountId: '',
  paymentReference: '',
  lines: [BLANK_LINE()],
});

function fmtMoney(n: number, ccy = 'TZS') {
  return `${ccy} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}

function lineTotal(l: SalesOrderLine) {
  const sub = (Number(l.qty) || 0) * (Number(l.unitPrice) || 0);
  return sub - (Number(l.discount) || 0) + (Number(l.tax) || 0);
}

function SalesOrderModal({
  mode,
  initial,
  companies,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: SalesOrder;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<SalesOrderForm>(() =>
    initial
      ? {
          companyId: initial.companyId,
          divisionId: '',
          customerId: initial.customerId ?? '',
          customerName: initial.customerName ?? '',
          salesType: initial.salesType,
          orderDate: initial.orderDate.slice(0, 10),
          dueDate: initial.dueDate?.slice(0, 10) ?? '',
          currency: initial.currency,
          notes: initial.notes ?? '',
          salespersonId: initial.salespersonId ?? '',
          paymentMethod: initial.paymentMethod ?? 'CREDIT',
          cashAccountId: initial.cashAccountId ?? '',
          paymentReference: initial.paymentReference ?? '',
          lines: initial.lines?.length
            ? initial.lines.map((line: any) => ({
                id: line.id,
                productId: line.productId ?? '',
                description: line.description ?? '',
                qty: Number(line.qty ?? line.quantity ?? 1),
                unitId: line.unitId ?? '',
                unitPrice: Number(line.unitPrice ?? 0),
                discount: Number(line.discount ?? line.discountAmount ?? 0),
                tax: Number(line.tax ?? line.taxAmount ?? 0),
                inventoryLocationId: line.inventoryLocationId ?? '',
                batchId: line.batchId ?? '',
              }))
            : [BLANK_LINE()],
        }
      : blankForm(),
  );
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
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
      setCustomers([]);
      setProducts([]);
      setLocations([]);
      setEmployees([]);
      setCashAccounts([]);
      setDivisions([]);
      return;
    }
    let cancelled = false;
    Promise.allSettled([
      backendList<Customer>('/customers', { query: { companyId: form.companyId, limit: 200 } }),
      backendList<InventoryLocation>('/inventory-locations', {
        query: { companyId: form.companyId, limit: 200 },
      }),
      backendList<Employee>('/hr/employees', { query: { companyId: form.companyId, limit: 500 } }),
      backendList<Division>('/divisions', { query: { companyId: form.companyId, limit: 200 } }),
      backendList<CashAccount>('/cash-accounts', {
        query: { companyId: form.companyId, limit: 200 },
      }),
    ]).then(
      ([customerResult, locationResult, employeeResult, divisionResult, cashAccountResult]) => {
        if (cancelled) return;
        setCustomers(customerResult.status === 'fulfilled' ? customerResult.value : []);
        setLocations(locationResult.status === 'fulfilled' ? locationResult.value : []);
        setEmployees(employeeResult.status === 'fulfilled' ? employeeResult.value : []);
        setDivisions(divisionResult.status === 'fulfilled' ? divisionResult.value : []);
        setCashAccounts(cashAccountResult.status === 'fulfilled' ? cashAccountResult.value : []);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [form.companyId]);

  // Reload products when company OR division changes; the backend filters
  // to the chosen division (plus company-wide SKUs).
  useEffect(() => {
    if (!form.companyId) {
      setProducts([]);
      return;
    }
    let cancelled = false;
    backendList<Product>('/products', {
      query: { companyId: form.companyId, divisionId: form.divisionId || undefined, limit: 200 },
    })
      .then((rows) => {
        if (!cancelled) setProducts(rows);
      })
      .catch(() => {
        if (!cancelled) setProducts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [form.companyId, form.divisionId]);

  const setField = <K extends keyof SalesOrderForm>(k: K, v: SalesOrderForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const setLine = (i: number, patch: Partial<SalesOrderLine>) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    }));
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, BLANK_LINE()] }));
  const removeLine = (i: number) =>
    setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

  const totals = form.lines.reduce(
    (acc, l) => {
      const sub = (Number(l.qty) || 0) * (Number(l.unitPrice) || 0);
      return {
        sub: acc.sub + sub,
        disc: acc.disc + (Number(l.discount) || 0),
        tax: acc.tax + (Number(l.tax) || 0),
      };
    },
    { sub: 0, disc: 0, tax: 0 },
  );
  const total = totals.sub - totals.disc + totals.tax;

  const handleSubmit = async () => {
    if (!form.companyId) {
      setError('Company is required');
      return;
    }
    if (!form.customerId && !form.customerName.trim()) {
      setError('Customer or walk-in name required');
      return;
    }
    if (!form.lines.length) {
      setError('Add at least one line');
      return;
    }
    if (form.lines.some((l) => !l.productId || !l.unitId || !l.inventoryLocationId)) {
      setError('Each line needs product, unit, and location');
      return;
    }
    if (form.paymentMethod !== 'CREDIT' && !form.cashAccountId) {
      setError('Pick a cash/bank account for non-credit payments');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        companyId: form.companyId,
        salesType: form.salesType,
        orderDate: form.orderDate,
        currency: form.currency,
        paymentMethod: form.paymentMethod,
        lines: form.lines.map((l) => ({
          productId: l.productId,
          description: l.description,
          quantity: Number(l.qty) || 0,
          unitId: l.unitId,
          unitPrice: Number(l.unitPrice) || 0,
          discountAmount: Number(l.discount) || 0,
          taxAmount: Number(l.tax) || 0,
          inventoryLocationId: l.inventoryLocationId,
          ...(l.batchId ? { batchId: l.batchId } : {}),
        })),
      };
      if (form.customerId) body.customerId = form.customerId;
      if (form.customerName) body.customerName = form.customerName;
      if (form.dueDate) body.dueDate = form.dueDate;
      if (form.notes) body.notes = form.notes;
      if (form.salespersonId) body.salespersonId = form.salespersonId;
      if (form.cashAccountId) body.cashAccountId = form.cashAccountId;
      if (form.paymentReference) body.paymentReference = form.paymentReference;
      if (mode === 'create') {
        await backendPost('/sales-orders', body);
      } else {
        await backendPatch(`/sales-orders/${initial!.id}`, body);
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
      title={mode === 'create' ? 'Create Sales Order' : 'Edit Sales Order'}
      size="2xl"
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
              setField('companyId', e.target.value);
              setField('customerId', '');
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
            label="Sales Type"
            required
            value={form.salesType}
            onChange={(e) => setField('salesType', e.target.value)}
          >
            {SALES_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Division (filters product list)"
            value={form.divisionId}
            onChange={(e) => setField('divisionId', e.target.value)}
            placeholder="All divisions"
          >
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code ? `${d.code} — ${d.name}` : d.name}
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
            label="Customer"
            value={form.customerId}
            onChange={(e) => setField('customerId', e.target.value)}
            placeholder="Walk-in (use name)"
          >
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.customerCode ? ` (${c.customerCode})` : ''}
              </option>
            ))}
          </FormSelect>
          <FormInput
            label="Walk-in Name"
            value={form.customerName}
            onChange={(e) => setField('customerName', e.target.value)}
            placeholder="If no customer selected"
          />
          <FormInput
            label="Order Date"
            required
            type="date"
            value={form.orderDate}
            onChange={(e) => setField('orderDate', e.target.value)}
          />
          <FormInput
            label="Due Date"
            type="date"
            value={form.dueDate}
            onChange={(e) => setField('dueDate', e.target.value)}
          />
          <FormSelect
            label="Salesperson"
            value={form.salespersonId}
            onChange={(e) => setField('salespersonId', e.target.value)}
            placeholder="None (no commission)"
          >
            {employees.map((e) => {
              const ratePct =
                e.defaultCommissionRate != null
                  ? ` — ${(Number(e.defaultCommissionRate) * 100).toFixed(2)}%`
                  : '';
              const label = `${e.fullName ?? e.employeeCode ?? e.id}${ratePct}`;
              return (
                <option key={e.id} value={e.id}>
                  {label}
                </option>
              );
            })}
          </FormSelect>
          <FormSelect
            label="Payment Method"
            required
            value={form.paymentMethod}
            onChange={(e) => {
              setField('paymentMethod', e.target.value);
              if (e.target.value === 'CREDIT') setField('cashAccountId', '');
            }}
            options={PAYMENT_METHODS}
          />
          {form.paymentMethod !== 'CREDIT' && (
            <>
              <FormSelect
                label="Cash / Bank Account"
                required
                value={form.cashAccountId}
                onChange={(e) => setField('cashAccountId', e.target.value)}
                placeholder={form.companyId ? 'Select account' : 'Pick company first'}
              >
                {cashAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.accountName} ({a.accountType})
                  </option>
                ))}
              </FormSelect>
              <FormInput
                label="Payment Reference"
                value={form.paymentReference}
                onChange={(e) => setField('paymentReference', e.target.value)}
                placeholder="M-Pesa code, slip #, etc."
              />
            </>
          )}
          <div className="col-span-2">
            <FormTextarea
              label="Notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
              Line Items
            </h4>
            <Btn variant="secondary" size="xs" onClick={addLine}>
              + Add Line
            </Btn>
          </div>
          <div
            className="overflow-x-auto rounded-lg border"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <table className="w-full text-xs">
              <thead>
                <tr
                  className="text-left uppercase bg-gray-50"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  <th className="px-2 py-2">Product</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2">Qty</th>
                  <th className="px-2 py-2">Unit</th>
                  <th className="px-2 py-2">Price</th>
                  <th className="px-2 py-2">Discount</th>
                  <th className="px-2 py-2">Tax</th>
                  <th className="px-2 py-2">Location</th>
                  <th className="px-2 py-2 text-right">Total</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {form.lines.map((line, i) => (
                  <tr key={i}>
                    <td className="px-1 py-1">
                      <select
                        value={line.productId}
                        onChange={(e) => setLine(i, { productId: e.target.value })}
                        className="w-32 text-xs border rounded px-1 py-1"
                        style={{
                          borderColor: 'var(--aurora-border)',
                          background: 'var(--aurora-card)',
                          color: 'var(--aurora-text)',
                        }}
                      >
                        <option value="">Select…</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="text"
                        value={line.description}
                        onChange={(e) => setLine(i, { description: e.target.value })}
                        className="w-32 text-xs border rounded px-1 py-1"
                        style={{
                          borderColor: 'var(--aurora-border)',
                          background: 'var(--aurora-card)',
                          color: 'var(--aurora-text)',
                        }}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        value={line.qty}
                        onChange={(e) => setLine(i, { qty: Number(e.target.value) })}
                        className="w-16 text-xs border rounded px-1 py-1"
                        style={{
                          borderColor: 'var(--aurora-border)',
                          background: 'var(--aurora-card)',
                          color: 'var(--aurora-text)',
                        }}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <select
                        value={line.unitId}
                        onChange={(e) => setLine(i, { unitId: e.target.value })}
                        className="w-16 text-xs border rounded px-1 py-1"
                        style={{
                          borderColor: 'var(--aurora-border)',
                          background: 'var(--aurora-card)',
                          color: 'var(--aurora-text)',
                        }}
                      >
                        <option value="">…</option>
                        {units.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.symbol}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        value={line.unitPrice}
                        onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })}
                        className="w-20 text-xs border rounded px-1 py-1"
                        style={{
                          borderColor: 'var(--aurora-border)',
                          background: 'var(--aurora-card)',
                          color: 'var(--aurora-text)',
                        }}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        value={line.discount}
                        onChange={(e) => setLine(i, { discount: Number(e.target.value) })}
                        className="w-16 text-xs border rounded px-1 py-1"
                        style={{
                          borderColor: 'var(--aurora-border)',
                          background: 'var(--aurora-card)',
                          color: 'var(--aurora-text)',
                        }}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        value={line.tax}
                        onChange={(e) => setLine(i, { tax: Number(e.target.value) })}
                        className="w-16 text-xs border rounded px-1 py-1"
                        style={{
                          borderColor: 'var(--aurora-border)',
                          background: 'var(--aurora-card)',
                          color: 'var(--aurora-text)',
                        }}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <select
                        value={line.inventoryLocationId}
                        onChange={(e) => setLine(i, { inventoryLocationId: e.target.value })}
                        className="w-24 text-xs border rounded px-1 py-1"
                        style={{
                          borderColor: 'var(--aurora-border)',
                          background: 'var(--aurora-card)',
                          color: 'var(--aurora-text)',
                        }}
                      >
                        <option value="">…</option>
                        {locations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums font-medium">
                      {lineTotal(line).toFixed(2)}
                    </td>
                    <td className="px-1 py-1 text-right">
                      {form.lines.length > 1 && (
                        <Btn variant="ghost" size="xs" onClick={() => removeLine(i)}>
                          ×
                        </Btn>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={8} className="px-2 py-1 text-right font-medium">
                    Subtotal
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{totals.sub.toFixed(2)}</td>
                  <td></td>
                </tr>
                <tr>
                  <td colSpan={8} className="px-2 py-1 text-right font-medium">
                    Discount
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-red-600">
                    -{totals.disc.toFixed(2)}
                  </td>
                  <td></td>
                </tr>
                <tr>
                  <td colSpan={8} className="px-2 py-1 text-right font-medium">
                    Tax
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">+{totals.tax.toFixed(2)}</td>
                  <td></td>
                </tr>
                <tr
                  className="font-semibold border-t"
                  style={{ borderColor: 'var(--aurora-border)' }}
                >
                  <td colSpan={8} className="px-2 py-2 text-right">
                    Total ({form.currency})
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{total.toFixed(2)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function DeleteConfirm({
  order,
  onClose,
  onConfirmed,
}: {
  order: SalesOrder;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const handleDelete = async () => {
    setSaving(true);
    setError('');
    try {
      await backendDelete(`/sales-orders/${order.id}`);
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
        Delete order <strong>{order.orderNumber ?? order.id}</strong>?
      </p>
    </Modal>
  );
}

export default function SalesOrdersPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<SalesOrder> | null>(null);
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
  const [editing, setEditing] = useState<SalesOrder | null>(null);
  const [deleting, setDeleting] = useState<SalesOrder | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [loadError, setLoadError] = useState('');

  const canView = hasPermission('sales.view');
  const canCreate = hasPermission('sales.create');
  const canConfirm = hasPermission('sales.confirm');
  const canCancel = hasPermission('sales.cancel');

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
      if (filterType) query.salesType = filterType;
      if (filterStatus) query.status = filterStatus;
      if (filterPayment) query.paymentStatus = filterPayment;
      if (filterDateFrom) query.dateFrom = filterDateFrom;
      if (filterDateTo) query.dateTo = filterDateTo;
      setData(await backendPage<SalesOrder>('/sales-orders', { query }));
    } catch (err: unknown) {
      setData(emptyPaginated<SalesOrder>());
      setLoadError(err instanceof Error ? err.message : 'Failed to load sales orders');
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
      await backendPatch(`/sales-orders/${id}/${action}`);
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
        <PageHeader title="Sales Orders" subtitle="Customer orders" />
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
    unpaid: data?.data.filter((o) => o.paymentStatus === 'UNPAID').length ?? 0,
    revenue: data?.data.reduce((acc, o) => acc + Number(o.totalAmount || 0), 0) ?? 0,
  };

  return (
    <div className="p-6 space-y-6">
      {creating && (
        <SalesOrderModal
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
        <SalesOrderModal
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

      <PageHeader title="Sales Orders" subtitle="Customer orders, fulfillment, and revenue" />

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Total Orders" value={data?.total ?? 0} />
        <StatCard label="Confirmed (page)" value={stats.confirmed} />
        <StatCard label="Unpaid (page)" value={stats.unpaid} />
        <StatCard label="Revenue (page)" value={fmtMoney(stats.revenue)} />
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
        searchPlaceholder="Order # or customer…"
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
              {SALES_TYPES.map((t) => (
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
              {SALES_STATUSES.map((s) => (
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
                <th className="px-4 py-3">Customer</th>
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
                      {o.orderNumber ?? o.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {new Date(o.orderDate).toLocaleDateString('en-GB')}
                    </td>
                    <td className="px-4 py-3">
                      {o.customer?.name ?? o.customerName ?? (
                        <span className="italic" style={{ color: 'var(--aurora-text-muted)' }}>
                          Walk-in
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">{o.salesType.replace(/_/g, ' ')}</td>
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
                      {(o.status === 'CONFIRMED' ||
                        o.status === 'PARTIALLY_PAID' ||
                        o.status === 'PAID') &&
                        canCancel && (
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
