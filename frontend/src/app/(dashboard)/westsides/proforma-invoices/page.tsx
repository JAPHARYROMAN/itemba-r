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

interface ProformaLine {
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

interface ProformaInvoice {
  id: string;
  proformaNumber: string;
  proformaDate: string;
  validUntil?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  customer?: { name?: string | null; customerCode?: string | null } | null;
  companyId: string;
  divisionId?: string | null;
  branchId?: string | null;
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

const CURRENCIES = ['TZS', 'USD', 'EUR'];

function blankLine(): ProformaLine {
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
    proformaDate: new Date().toISOString().slice(0, 10),
    validUntil: addDays(14),
    currency: 'TZS',
    notes:
      'Prices are valid within the stated period, subject to stock availability and confirmation.',
    lines: [blankLine()],
  };
}

function formFromRecord(record: ProformaInvoice) {
  return {
    companyId: record.companyId,
    divisionId: record.divisionId ?? '',
    branchId: record.branchId ?? '',
    customerId: record.customerId ?? '',
    proformaDate: record.proformaDate.slice(0, 10),
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
          discount: Number(line.discountAmount ?? 0),
          tax: Number(line.taxAmount ?? 0),
          batchId: '',
        }))
      : [blankLine()],
  };
}

function fmtMoney(value: number | string | null | undefined, currency = 'TZS') {
  const amount = Number(value ?? 0);
  return `${currency} ${new Intl.NumberFormat('en-TZ', {
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

function customerLabel(proforma: ProformaInvoice) {
  const name = proforma.customer?.name ?? proforma.customerName;
  if (!name) return 'N/A';
  return proforma.customer?.customerCode ? `${name} (${proforma.customer.customerCode})` : name;
}

function ProformaModal({
  mode,
  initial,
  companies,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: ProformaInvoice;
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

  useEffect(() => {
    if (!form.companyId || !form.branchId) {
      setCustomers([]);
      return;
    }
    let cancelled = false;
    backendList<Customer>('/customers', {
      query: { companyId: form.companyId, branchId: form.branchId, limit: 500 },
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
  }, [form.companyId, form.divisionId, productSearchQuery, selectedProductIdKey]);

  const branchOptions = form.divisionId
    ? branches.filter((branch) => branch.divisionId === form.divisionId)
    : [];

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setLine(index: number, patch: Partial<ProformaLine>) {
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
    if (!form.customerId) return setError('Customer is required');
    if (!form.proformaDate) return setError('Proforma date is required');
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
      const body = {
        companyId: form.companyId,
        divisionId: form.divisionId,
        branchId: form.branchId,
        customerId: form.customerId,
        customerName: selectedCustomer?.name,
        proformaDate: form.proformaDate,
        validUntil: form.validUntil || undefined,
        currency: form.currency,
        notes: form.notes || undefined,
        lines: form.lines.map((line) => ({
          productId: line.productId,
          description: line.description || undefined,
          quantity: Number(line.qty) || 0,
          unitId: line.unitId,
          unitPrice: Number(line.unitPrice) || 0,
          discountAmount: Number(line.discount) || 0,
          taxAmount: Number(line.tax) || 0,
        })),
      };

      if (mode === 'create') {
        await backendPost('/westsides/proforma-invoices', body);
      } else if (initial) {
        const { companyId: _companyId, ...updateBody } = body;
        await backendPatch(`/westsides/proforma-invoices/${initial.id}`, updateBody);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save proforma invoice');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'New Proforma Invoice' : 'Edit Proforma Invoice'}
      subtitle="Build a customer-ready proforma with itemized products, validity, totals, and notes."
      size="3xl"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={save} loading={saving}>
            {mode === 'create' ? 'Create Proforma' : 'Save Changes'}
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
            required
            value={form.customerId}
            onChange={(event) => setField('customerId', event.target.value)}
            placeholder={form.branchId ? 'Select customer' : 'Select branch first'}
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
            label="Proforma Date"
            required
            type="date"
            value={form.proformaDate}
            onChange={(event) => setField('proformaDate', event.target.value)}
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
          <div className="md:col-span-2 xl:col-span-1">
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

type ProformaAction = 'send' | 'convert';

export default function ProformaInvoicesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [items, setItems] = useState<Paginated<ProformaInvoice> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProformaInvoice | null>(null);
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
      setItems(await backendPage<ProformaInvoice>('/westsides/proforma-invoices', {
        query: { limit: 100 },
      }));
    } catch (err) {
      setItems({ data: [], total: 0, page: 1, totalPages: 1 });
      setError(err instanceof Error ? err.message : 'Failed to load proforma invoices');
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
      setEditing(await backendGet<ProformaInvoice>(`/westsides/proforma-invoices/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open proforma invoice');
    } finally {
      setEditLoadingId(null);
    }
  }

  async function handleAction(id: string, action: ProformaAction) {
    setActioning(`${id}-${action}`);
    setError('');
    try {
      const endpoint = action === 'convert' ? 'convert-to-sales-order' : 'send';
      await backendPatch(`/westsides/proforma-invoices/${id}/${endpoint}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActioning(null);
    }
  }

  const rows = items?.data ?? [];

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Proforma Invoices"
          subtitle="Customer-ready proformas with itemized products, validity, letterhead print/PDF, and conversion support."
        />
        <Btn variant="primary" onClick={() => setCreating(true)}>
          + New Proforma
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
              No proforma invoices found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">
                      Proforma #
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">
                      Customer
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-400">
                      Amount
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
                  {rows.map((proforma) => (
                    <tr key={proforma.id}>
                      <td className="px-4 py-3 font-mono text-xs text-slate-100">
                        {proforma.proformaNumber}
                      </td>
                      <td className="px-4 py-3 text-slate-200">{fmtDate(proforma.proformaDate)}</td>
                      <td className="px-4 py-3 text-slate-100">{customerLabel(proforma)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-100">
                        {fmtMoney(proforma.totalAmount, proforma.currency)}
                      </td>
                      <td className="px-4 py-3 text-slate-200">{fmtDate(proforma.validUntil)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={proforma.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <DocumentPreviewLink
                            href={`/westsides/proforma-invoices/${proforma.id}/print`}
                          />
                          {proforma.status === 'DRAFT' && (
                            <>
                              <Btn
                                variant="ghost"
                                size="xs"
                                onClick={() => void openEdit(proforma.id)}
                                loading={editLoadingId === proforma.id}
                              >
                                Edit
                              </Btn>
                              <Btn
                                variant="primary"
                                size="xs"
                                onClick={() => void handleAction(proforma.id, 'send')}
                                loading={actioning === `${proforma.id}-send`}
                              >
                                Mark Sent
                              </Btn>
                            </>
                          )}
                          {proforma.status === 'ACCEPTED' && (
                            <Btn
                              variant="secondary"
                              size="xs"
                              onClick={() => void handleAction(proforma.id, 'convert')}
                              loading={actioning === `${proforma.id}-convert`}
                            >
                              Convert
                            </Btn>
                          )}
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

      {creating && (
        <ProformaModal
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
        <ProformaModal
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
