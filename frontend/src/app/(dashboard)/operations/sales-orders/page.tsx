'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DocumentPreviewLink } from '@/components/documents';
import {
  Card,
  PageHeader,
  PageToolbar,
  StatCard,
  StatusBadge,
  Modal,
  Btn,
  SkeletonTable,
  FormInput,
  FormSelect,
  FormTextarea,
  showToast,
} from '@/components/ui';
import {
  backendDelete,
  backendList,
  backendPage,
  backendPatch,
  backendPost,
} from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import {
  SALES_TYPES,
  CURRENCIES,
  PAYMENT_METHODS,
  ACCOUNT_TYPE_LABELS,
  defaultPaymentMethodForSalesType,
} from '@/lib/sales-order-constants';
import {
  OrderLineEditor,
  mergeOrderProductOptions,
  type OrderLineValidationState,
} from '../_components/order-line-editor';

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
  divisionId?: string | null;
  branchId?: string | null;
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
  productType?: string | null;
  trackInventory?: boolean | null;
  sellingPrice?: number | string | null;
  availableStock?: number | string | null;
  availableQuantity?: number | string | null;
  quantityAvailable?: number | string | null;
  inventoryBalance?: {
    quantityOnHand?: number | string | null;
    quantityReserved?: number | string | null;
    availableQuantity?: number | string | null;
    quantityAvailable?: number | string | null;
  } | null;
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
  divisionId?: string | null;
  branchId?: string | null;
  currency?: string | null;
  isActive?: boolean;
  linkedBank?: {
    id?: string;
    bankName?: string | null;
    accountName?: string | null;
    accountNumber?: string | null;
  } | null;
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
  batchId: string;
}

interface SalesOrder {
  id: string;
  salesOrderNumber?: string;
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
  divisionId?: string | null;
  branchId?: string | null;
  company?: { name: string } | null;
  customer?: { name: string } | null;
  lines?: SalesOrderLine[];
}

interface SalesOrderForm {
  companyId: string;
  divisionId: string;
  branchId: string;
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

interface Branch {
  id: string;
  name: string;
  code?: string | null;
  divisionId: string;
}

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

const emptyPaginated = <T,>(): Paginated<T> => ({ data: [], total: 0, page: 1, totalPages: 1 });

const SALES_STATUSES = ['DRAFT', 'CONFIRMED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'CLOSED'];
const PAYMENT_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID'];

function accountSelectLabel(method: string) {
  switch (method) {
    case 'CASH':
      return 'Cash Account';
    case 'BANK_CARD':
    case 'BANK_TRANSFER':
      return 'Bank Account';
    case 'MOBILE_MONEY':
      return 'Mobile Money Account';
    default:
      return 'Receipt Account';
  }
}

function emptyAccountHint(method: string) {
  switch (method) {
    case 'CASH':
      return 'No active cash-on-hand or petty-cash account is available for this company.';
    case 'BANK_CARD':
    case 'BANK_TRANSFER':
      return 'No active bank receipt account is available for this company.';
    case 'MOBILE_MONEY':
      return 'No active mobile-money account is available for this company.';
    default:
      return 'No active receipt account is available for this company.';
  }
}

function accountOptionLabel(account: CashAccount) {
  const typeLabel = ACCOUNT_TYPE_LABELS[account.accountType] ?? account.accountType;
  const bankName =
    account.accountType === 'BANK' &&
    account.linkedBank?.bankName &&
    !account.accountName.toLowerCase().includes(account.linkedBank.bankName.toLowerCase())
      ? ` - ${account.linkedBank.bankName}`
      : '';
  const currency = account.currency ? ` - ${account.currency}` : '';
  return `${account.accountName}${bankName} (${typeLabel}${currency})`;
}

function normalizeMatchText(value: string | null | undefined) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function receiptAccountScore(account: CashAccount, branch?: Branch | null) {
  let score = 0;
  const accountText = normalizeMatchText(account.accountName);
  const branchName = normalizeMatchText(branch?.name);
  const branchCode = normalizeMatchText(branch?.code);

  if (account.accountType === 'CASH_ON_HAND') score -= 30;
  if (account.accountType === 'PETTY_CASH') score -= 20;
  if (accountText.includes('cash')) score -= 10;
  if (branchName && accountText.includes(branchName)) score -= 40;
  if (branchCode && accountText.includes(branchCode)) score -= 25;
  if (branchName.includes('kisimani') && accountText.includes('kisimani')) score -= 60;
  if (accountText.includes('default')) score -= 5;

  return score;
}

function sortReceiptAccounts(accounts: CashAccount[], branch?: Branch | null) {
  return [...accounts].sort((left, right) => {
    const scoreDiff = receiptAccountScore(left, branch) - receiptAccountScore(right, branch);
    if (scoreDiff !== 0) return scoreDiff;
    return accountOptionLabel(left).localeCompare(accountOptionLabel(right));
  });
}

const BLANK_LINE = (): SalesOrderLine => ({
  productId: '',
  description: '',
  qty: 1,
  unitId: '',
  unitPrice: 0,
  discount: 0,
  tax: 0,
  batchId: '',
});
const blankForm = (): SalesOrderForm => ({
  companyId: '',
  divisionId: '',
  branchId: '',
  customerId: '',
  customerName: '',
  salesType: 'CASH_SALE',
  orderDate: new Date().toISOString().slice(0, 10),
  dueDate: '',
  currency: 'TZS',
  notes: '',
  salespersonId: '',
  paymentMethod: defaultPaymentMethodForSalesType('CASH_SALE'),
  cashAccountId: '',
  paymentReference: '',
  lines: [BLANK_LINE()],
});

function fmtMoney(n: number | string | null | undefined, ccy = 'TZS') {
  const value = Number(n ?? 0);
  return `${ccy} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0)}`;
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
          divisionId: initial.divisionId ?? '',
          branchId: initial.branchId ?? '',
          customerId: initial.customerId ?? '',
          customerName: initial.customerName ?? '',
          salesType: initial.salesType,
          orderDate: initial.orderDate.slice(0, 10),
          dueDate: initial.dueDate?.slice(0, 10) ?? '',
          currency: initial.currency,
          notes: initial.notes ?? '',
          salespersonId: initial.salespersonId ?? '',
          paymentMethod:
            initial.paymentMethod ?? defaultPaymentMethodForSalesType(initial.salesType),
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
                batchId: line.batchId ?? '',
              }))
            : [BLANK_LINE()],
        }
      : blankForm(),
  );
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productSearchCategoryId, setProductSearchCategoryId] = useState('');
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const [units, setUnits] = useState<Unit[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [lineValidation, setLineValidation] = useState<OrderLineValidationState>({
    hasBlockingErrors: false,
    stockWarnings: [],
  });
  const selectedProductIdKey = form.lines
    .map((line) => line.productId)
    .filter(Boolean)
    .join('|');
  const handleProductSearch = useCallback(
    (query: string, filters?: { categoryId?: string }) => {
      setProductSearchQuery(query);
      setProductSearchCategoryId(filters?.categoryId ?? '');
    },
    [],
  );

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
      setEmployees([]);
      setCashAccounts([]);
      setDivisions([]);
      setBranches([]);
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
    if (!form.companyId || !form.divisionId || !form.branchId || form.paymentMethod === 'CREDIT') {
      setCashAccounts([]);
      return;
    }

    let cancelled = false;
    setCashAccounts([]);
    backendList<CashAccount>('/sales-orders/receipt-accounts', {
      query: {
        companyId: form.companyId,
        divisionId: form.divisionId,
        branchId: form.branchId,
        paymentMethod: form.paymentMethod,
        limit: 500,
      },
    })
      .then((rows) => {
        if (!cancelled) setCashAccounts(rows);
      })
      .catch(() => {
        if (!cancelled) setCashAccounts([]);
      });

    return () => {
      cancelled = true;
    };
  }, [form.companyId, form.divisionId, form.branchId, form.paymentMethod]);

  useEffect(() => {
    if (!form.companyId || !form.branchId) {
      setCustomers([]);
      setEmployees([]);
      return;
    }
    let cancelled = false;
    Promise.allSettled([
      backendList<Customer>('/customers', {
        query: { companyId: form.companyId, branchId: form.branchId, limit: 200 },
      }),
      backendList<Employee>('/hr/employees', {
        query: { companyId: form.companyId, branchId: form.branchId, limit: 500 },
      }),
    ]).then(([customerResult, employeeResult]) => {
      if (cancelled) return;
      setCustomers(customerResult.status === 'fulfilled' ? customerResult.value : []);
      setEmployees(employeeResult.status === 'fulfilled' ? employeeResult.value : []);
    });
    return () => {
      cancelled = true;
    };
  }, [form.companyId, form.divisionId, form.branchId]);

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

  // Reload products when company, division, or branch changes; the backend
  // filters to the chosen division and adds stock for the sale branch.
  useEffect(() => {
    if (!form.companyId || !form.divisionId || !form.branchId) {
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
            divisionId: form.divisionId || undefined,
            branchId: form.branchId,
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
    form.branchId,
    form.companyId,
    form.divisionId,
    productSearchCategoryId,
    productSearchQuery,
    selectedProductIdKey,
  ]);

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
  const branchOptions = form.divisionId
    ? branches.filter((branch) => branch.divisionId === form.divisionId)
    : [];
  const selectedBranch = useMemo(
    () => branches.find((branch) => branch.id === form.branchId) ?? null,
    [branches, form.branchId],
  );
  const receiptAccounts = useMemo(
    () =>
      form.paymentMethod === 'CREDIT'
        ? []
        : sortReceiptAccounts(
            cashAccounts.filter((account) => account.isActive !== false),
            selectedBranch,
          ),
    [cashAccounts, form.paymentMethod, selectedBranch],
  );

  useEffect(() => {
    setForm((current) => {
      if (current.paymentMethod === 'CREDIT') {
        return current.cashAccountId ? { ...current, cashAccountId: '' } : current;
      }
      if (!current.cashAccountId) {
        return receiptAccounts[0] ? { ...current, cashAccountId: receiptAccounts[0].id } : current;
      }

      const selected = cashAccounts.find((account) => account.id === current.cashAccountId);
      if (!selected) {
        return { ...current, cashAccountId: '' };
      }
      return current;
    });
  }, [cashAccounts, form.paymentMethod, receiptAccounts]);

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
    if (!form.customerId && !form.customerName.trim()) {
      setError('Customer or walk-in name required');
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
    if (lineValidation.hasBlockingErrors) {
      setError(
        lineValidation.stockWarnings[0] ??
          lineValidation.profitWarnings?.[0] ??
          'Resolve stock/profit validation before saving',
      );
      return;
    }
    if (form.paymentMethod !== 'CREDIT' && !form.cashAccountId) {
      setError(`Pick a ${accountSelectLabel(form.paymentMethod).toLowerCase()}`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        divisionId: form.divisionId,
        branchId: form.branchId,
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
        await backendPost('/sales-orders', { ...body, companyId: form.companyId });
        showToast('success', 'Sales order created', 'Saved as draft — confirm it to post.');
      } else {
        await backendPatch(`/sales-orders/${initial!.id}`, body);
        showToast('success', 'Sales order updated');
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
      size="3xl"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn
            variant="primary"
            onClick={handleSubmit}
            loading={saving}
            disabled={lineValidation.hasBlockingErrors}
          >
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
                customerId: '',
                salespersonId: '',
                cashAccountId: '',
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
            label="Sales Type"
            required
            value={form.salesType}
            onChange={(e) => {
              const salesType = e.target.value;
              setForm((current) => {
                const paymentMethod = defaultPaymentMethodForSalesType(
                  salesType,
                  current.paymentMethod,
                );
                return {
                  ...current,
                  salesType,
                  paymentMethod,
                  cashAccountId:
                    paymentMethod === current.paymentMethod ? current.cashAccountId : '',
                };
              });
            }}
          >
            {SALES_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
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
                customerId: '',
                salespersonId: '',
                cashAccountId: '',
                lines: f.lines.map((line) => ({
                  ...line,
                  productId: '',
                })),
              }));
            }}
            placeholder={form.companyId ? 'Select division' : 'Select company first'}
          >
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code ? `${d.code} — ${d.name}` : d.name}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Branch / Location"
            required
            value={form.branchId}
            onChange={(e) => {
              const branchId = e.target.value;
              setProductSearchQuery('');
              setProductSearchCategoryId('');
              setForm((f) => ({
                ...f,
                branchId,
                customerId: '',
                salespersonId: '',
                cashAccountId: '',
                lines: f.lines.map((line) => ({
                  ...line,
                  productId: '',
                })),
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
            placeholder={form.branchId ? 'Walk-in (use name)' : 'Select branch first'}
            disabled={!form.branchId}
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
            placeholder={form.branchId ? 'None (no commission)' : 'Select branch first'}
            disabled={!form.branchId}
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
              const paymentMethod = e.target.value;
              setForm((current) => ({
                ...current,
                paymentMethod,
                cashAccountId: '',
              }));
            }}
            options={PAYMENT_METHODS}
          />
          {form.paymentMethod !== 'CREDIT' && (
            <>
              <FormSelect
                label={accountSelectLabel(form.paymentMethod)}
                required
                value={form.cashAccountId}
                onChange={(e) => setField('cashAccountId', e.target.value)}
                placeholder={
                  !form.companyId
                    ? 'Pick company first'
                    : !form.branchId
                      ? 'Pick branch/location first'
                      : `Select ${accountSelectLabel(form.paymentMethod).toLowerCase()}`
                }
                disabled={!form.companyId || !form.branchId || receiptAccounts.length === 0}
                hint={
                  form.companyId && !form.branchId
                    ? 'Select the sale branch/location first so the form can load the correct receipt accounts.'
                    : form.companyId && receiptAccounts.length === 0
                      ? `${emptyAccountHint(form.paymentMethod)} Create it under ${
                          ['BANK_CARD', 'BANK_TRANSFER'].includes(form.paymentMethod)
                            ? 'Group Control > Bank Accounts.'
                            : 'Finance > Cash Accounts for this branch/location.'
                        }`
                      : undefined
                }
              >
                {receiptAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {accountOptionLabel(a)}
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

        <OrderLineEditor
          variant="sales"
          lines={form.lines}
          products={products}
          categories={categories}
          units={units}
          currency={form.currency}
          productSearchLoading={productSearchLoading}
          enforceStockAvailability
          onAddLine={addLine}
          onRemoveLine={removeLine}
          onLineChange={setLine}
          onProductSearch={handleProductSearch}
          onValidationChange={setLineValidation}
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
      showToast(
        action === 'confirm' ? 'success' : 'info',
        action === 'confirm' ? 'Order confirmed' : 'Order cancelled',
        action === 'confirm' ? 'Inventory issued and posted to the ledger.' : undefined,
      );
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed';
      setActionError(message);
      showToast('error', `Could not ${action} order`, message);
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

      <div className="grid grid-cols-4 gap-3 aurora-stagger">
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
                    <SkeletonTable rows={6} cols={9} />
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
                      {o.salesOrderNumber ?? o.orderNumber ?? o.id.slice(0, 8)}
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
                      <DocumentPreviewLink href={`/operations/sales-orders/${o.id}/print`} />
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
