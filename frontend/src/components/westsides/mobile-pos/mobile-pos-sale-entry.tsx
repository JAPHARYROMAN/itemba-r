'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Btn,
  Card,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
  PageHeader,
  PageSpinner,
  PermissionDeniedState,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendGet, backendList, backendPost } from '@/lib/api-client';

interface Company {
  id: string;
  name: string;
  code?: string | null;
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

interface CashAccount {
  id: string;
  accountName: string;
  accountType: string;
  divisionId?: string | null;
  branchId?: string | null;
  currency?: string | null;
  isActive?: boolean | null;
  division?: { name?: string | null; code?: string | null } | null;
  branch?: { name?: string | null; code?: string | null } | null;
  linkedBank?: { bankName?: string | null } | null;
}

interface Unit {
  id: string;
  name: string;
  symbol: string;
}

interface Product {
  id: string;
  name: string;
  productCode?: string | null;
  sku?: string | null;
  barcode?: string | null;
  baseUnitId?: string | null;
  defaultUnitId?: string | null;
  baseUnit?: { name?: string | null; symbol?: string | null } | null;
  defaultSellingPrice?: number | string | null;
  retailPrice?: number | string | null;
  wholesalePrice?: number | string | null;
  sellingPrice?: number | string | null;
  productType?: string | null;
  trackInventory?: boolean | null;
  availableStock?: number | string | null;
  availableQuantity?: number | string | null;
  quantityAvailable?: number | string | null;
  inventoryBalance?: {
    availableQuantity?: number | string | null;
    quantityAvailable?: number | string | null;
  } | null;
}

interface Customer {
  id: string;
  name: string;
  customerCode?: string | null;
  divisionId?: string | null;
  branchId?: string | null;
}

interface Employee {
  id: string;
  fullName?: string | null;
  employeeCode?: string | null;
  defaultCommissionRate?: number | string | null;
}

interface CartLine {
  productId: string;
  productName: string;
  sku?: string;
  qty: number;
  unitId: string;
  unitSymbol: string;
  unitPrice: number;
  trackInventory?: boolean | null;
  productType?: string | null;
  availableStock?: number | null;
}

interface Settings {
  companyId: string;
  divisionId: string;
  branchId: string;
  salesType: string;
  orderDate: string;
  dueDate: string;
  currency: string;
  salespersonId: string;
  cashAccountId: string;
  paymentMethod: string;
  notes: string;
}

interface ConfirmedOrder {
  id?: string;
  salesOrderNumber?: string;
  orderNumber?: string;
  orderDate?: string | null;
  customerName?: string | null;
  salesType?: string | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  currency?: string | null;
  subtotal?: number | string | null;
  discountAmount?: number | string | null;
  taxAmount?: number | string | null;
  totalAmount?: number | string | null;
  paidAmount?: number | string | null;
  outstandingAmount?: number | string | null;
  company?: {
    name?: string | null;
    code?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
  } | null;
  branch?: {
    name?: string | null;
    code?: string | null;
    address?: string | null;
    phone?: string | null;
  } | null;
  customer?: { name?: string | null } | null;
  cashAccount?: { accountName?: string | null; accountType?: string | null } | null;
  createdBy?: { fullName?: string | null } | null;
  confirmedBy?: { fullName?: string | null } | null;
  lines?: ConfirmedOrderLine[];
}

interface ConfirmedOrderLine {
  id?: string;
  description?: string | null;
  quantity?: number | string | null;
  qty?: number | string | null;
  unitPrice?: number | string | null;
  discountAmount?: number | string | null;
  taxAmount?: number | string | null;
  lineTotal?: number | string | null;
  product?: {
    name?: string | null;
    sku?: string | null;
    productCode?: string | null;
  } | null;
  unit?: { name?: string | null; symbol?: string | null } | null;
}

interface MobilePosBootstrap {
  company: Company;
  divisions: Division[];
  branches: Branch[];
  customers: Customer[];
  defaults?: {
    currency?: string;
    salesType?: string;
    paymentMethod?: string;
  };
}

const SETTINGS_KEY = 'itemba.mobilePos.settings.v1';

const SALES_TYPES = [
  { value: 'CASH_SALE', label: 'Cash Sale' },
  { value: 'RETAIL', label: 'Retail Sale' },
];

const CURRENCIES = ['TZS', 'USD', 'EUR'];

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'MOBILE_MONEY', label: 'Mobile money' },
  { value: 'BANK_CARD', label: 'Bank card' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'OTHER', label: 'Other' },
];

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  CASH_ON_HAND: 'Cash on hand',
  PETTY_CASH: 'Petty cash',
  BANK: 'Bank',
  MOBILE_MONEY: 'Mobile money',
  OTHER: 'Other',
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

const blankSettings: Settings = {
  companyId: '',
  divisionId: '',
  branchId: '',
  salesType: 'CASH_SALE',
  orderDate: todayIsoDate(),
  dueDate: '',
  currency: 'TZS',
  salespersonId: '',
  cashAccountId: '',
  paymentMethod: 'CASH',
  notes: '',
};

function formatMoney(value: number | string | null | undefined) {
  return new Intl.NumberFormat('en-TZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(normalizeNumber(value));
}

function formatQty(value: number | string | null | undefined) {
  return new Intl.NumberFormat('en-TZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(normalizeNumber(value));
}

function formatDateTime(value: string | null | undefined) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return value ?? '-';
  return new Intl.DateTimeFormat('en-TZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function normalizeNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function productCode(product: Product) {
  return product.productCode ?? product.sku ?? product.barcode ?? '';
}

function productPrice(product: Product) {
  return normalizeNumber(
    product.sellingPrice ??
      product.defaultSellingPrice ??
      product.retailPrice ??
      product.wholesalePrice ??
      0,
  );
}

function productUnitId(product: Product) {
  return product.defaultUnitId ?? product.baseUnitId ?? '';
}

function productAvailableStock(product: Product | null | undefined) {
  if (!product) return null;
  const raw =
    product.availableStock ??
    product.availableQuantity ??
    product.quantityAvailable ??
    product.inventoryBalance?.availableQuantity ??
    product.inventoryBalance?.quantityAvailable;
  if (raw == null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function tracksInventory(item: Product | CartLine | null | undefined) {
  if (!item) return false;
  if (item.trackInventory === false) return false;
  return !['SERVICE', 'NON_STOCK_ITEM'].includes(String(item.productType ?? '').toUpperCase());
}

function accountOptionLabel(account: CashAccount) {
  const type = ACCOUNT_TYPE_LABELS[account.accountType] ?? account.accountType;
  const bank =
    account.accountType === 'BANK' &&
    account.linkedBank?.bankName &&
    !account.accountName.toLowerCase().includes(account.linkedBank.bankName.toLowerCase())
      ? ` - ${account.linkedBank.bankName}`
      : '';
  const currency = account.currency ? ` - ${account.currency}` : '';
  return `${account.accountName}${bank} (${type}${currency})`;
}

function paymentMethodForAccount(account?: CashAccount | null) {
  switch (account?.accountType) {
    case 'BANK':
      return 'BANK_TRANSFER';
    case 'MOBILE_MONEY':
      return 'MOBILE_MONEY';
    case 'CASH_ON_HAND':
    case 'PETTY_CASH':
      return 'CASH';
    default:
      return account ? 'OTHER' : undefined;
  }
}

function accountMatchesPaymentMethod(account: CashAccount, paymentMethod: string) {
  switch (paymentMethod) {
    case 'CASH':
      return ['CASH_ON_HAND', 'PETTY_CASH'].includes(account.accountType);
    case 'BANK_CARD':
    case 'BANK_TRANSFER':
      return account.accountType === 'BANK';
    case 'MOBILE_MONEY':
      return account.accountType === 'MOBILE_MONEY';
    case 'MIXED':
    case 'OTHER':
      return true;
    default:
      return false;
  }
}

function emptyReceiptAccountHint(method: string) {
  switch (method) {
    case 'CASH':
      return 'No active cash-on-hand or petty-cash account is available for this branch.';
    case 'BANK_CARD':
    case 'BANK_TRANSFER':
      return 'No active bank receipt account is available for this company, division, or branch.';
    case 'MOBILE_MONEY':
      return 'No active mobile-money account is available for this branch.';
    default:
      return 'No active receipt account is available for this branch.';
  }
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
  const branchName = normalizeMatchText(branch?.name ?? account.branch?.name);
  const branchCode = normalizeMatchText(branch?.code ?? account.branch?.code);

  if (account.accountType === 'CASH_ON_HAND') score -= 30;
  if (account.accountType === 'PETTY_CASH') score -= 20;
  if (accountText.includes('cash')) score -= 10;
  if (branchName && accountText.includes(branchName)) score -= 40;
  if (branchCode && accountText.includes(branchCode)) score -= 25;
  if (branchName.includes('kisimani') && accountText.includes('kisimani')) score -= 60;
  if (accountText.includes('default')) score -= 5;

  return score;
}

function selectableReceiptAccounts(
  accounts: CashAccount[],
  paymentMethod: string,
  branch?: Branch | null,
) {
  return accounts
    .filter(
      (account) =>
        account.isActive !== false && accountMatchesPaymentMethod(account, paymentMethod),
    )
    .sort((left, right) => {
      const scoreDiff = receiptAccountScore(left, branch) - receiptAccountScore(right, branch);
      if (scoreDiff !== 0) return scoreDiff;
      return accountOptionLabel(left).localeCompare(accountOptionLabel(right));
    });
}

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

function formatEnumLabel(value: string) {
  return value.replaceAll('_', ' ');
}

function employeeOptionLabel(employee: Employee) {
  const ratePct =
    employee.defaultCommissionRate != null
      ? ` - ${(Number(employee.defaultCommissionRate) * 100).toFixed(2)}%`
      : '';
  return `${employee.fullName ?? employee.employeeCode ?? employee.id}${ratePct}`;
}

function receiptNumber(order: ConfirmedOrder) {
  return order.salesOrderNumber ?? order.orderNumber ?? order.id ?? 'Receipt';
}

function receiptCustomerName(order: ConfirmedOrder) {
  return order.customer?.name ?? order.customerName ?? 'Walk-in customer';
}

function receiptCurrency(order: ConfirmedOrder, fallback = 'TZS') {
  return order.currency ?? fallback;
}

function receiptLines(order: ConfirmedOrder, fallbackCart: CartLine[]): ConfirmedOrderLine[] {
  if (order.lines?.length) return order.lines;
  return fallbackCart.map((line) => ({
    id: line.productId,
    description: line.productName,
    quantity: line.qty,
    unitPrice: line.unitPrice,
    lineTotal: line.qty * line.unitPrice,
    product: { name: line.productName, sku: line.sku },
    unit: { symbol: line.unitSymbol },
  }));
}

function receiptLineName(line: ConfirmedOrderLine) {
  return line.description || line.product?.name || 'Item';
}

function receiptLineCode(line: ConfirmedOrderLine) {
  return line.product?.sku ?? line.product?.productCode ?? '';
}

function receiptLineQty(line: ConfirmedOrderLine) {
  return line.quantity ?? line.qty ?? 0;
}

function receiptLineTotal(line: ConfirmedOrderLine) {
  const recorded = line.lineTotal;
  if (recorded != null) return recorded;
  return normalizeNumber(receiptLineQty(line)) * normalizeNumber(line.unitPrice);
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function receiptPlainText(
  order: ConfirmedOrder,
  lines: ConfirmedOrderLine[],
  fallbackCurrency = 'TZS',
) {
  const currency = receiptCurrency(order, fallbackCurrency);
  const number = receiptNumber(order);
  const company = order.company?.name ?? 'WESTSIDES COMPANY LTD';
  const branch = order.branch?.name ? ` - ${order.branch.name}` : '';
  const itemLines = lines
    .map((line) => {
      const qty = formatQty(receiptLineQty(line));
      const unit = line.unit?.symbol ?? line.unit?.name ?? '';
      const total = `${currency} ${formatMoney(receiptLineTotal(line))}`;
      return `${receiptLineName(line)}${receiptLineCode(line) ? ` (${receiptLineCode(line)})` : ''} x ${qty}${unit ? ` ${unit}` : ''} - ${total}`;
    })
    .join('\n');

  return [
    `${company}${branch}`,
    `Receipt: ${number}`,
    `Customer: ${receiptCustomerName(order)}`,
    `Date: ${formatDateTime(order.orderDate)}`,
    '',
    itemLines,
    '',
    `Subtotal: ${currency} ${formatMoney(order.subtotal ?? order.totalAmount)}`,
    `Discount: ${currency} ${formatMoney(order.discountAmount)}`,
    `Tax: ${currency} ${formatMoney(order.taxAmount)}`,
    `Total: ${currency} ${formatMoney(order.totalAmount)}`,
    `Paid: ${currency} ${formatMoney(order.paidAmount ?? order.totalAmount)}`,
    `Payment: ${formatEnumLabel(order.paymentMethod ?? 'CASH')}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function receiptHtml(order: ConfirmedOrder, lines: ConfirmedOrderLine[], fallbackCurrency = 'TZS') {
  const currency = receiptCurrency(order, fallbackCurrency);
  const number = receiptNumber(order);
  const company = order.company?.name ?? 'WESTSIDES COMPANY LTD';
  const branch = order.branch?.name ?? '';
  const generatedAt = formatDateTime(order.orderDate);
  const rows = lines
    .map((line) => {
      const name = receiptLineName(line);
      const code = receiptLineCode(line);
      const qty = formatQty(receiptLineQty(line));
      const unit = line.unit?.symbol ?? line.unit?.name ?? '';
      const unitPrice = `${currency} ${formatMoney(line.unitPrice)}`;
      const total = `${currency} ${formatMoney(receiptLineTotal(line))}`;
      return `
        <tr>
          <td>
            <strong>${escapeHtml(name)}</strong>
            ${code ? `<div class="muted">${escapeHtml(code)}</div>` : ''}
          </td>
          <td class="num">${escapeHtml(qty)}${unit ? ` ${escapeHtml(unit)}` : ''}</td>
          <td class="num">${escapeHtml(unitPrice)}</td>
          <td class="num">${escapeHtml(total)}</td>
        </tr>`;
    })
    .join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(number)} Receipt</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f3f4f6; color: #111827; font-family: Arial, sans-serif; }
    .receipt { width: min(420px, 100%); margin: 0 auto; background: #fff; padding: 18px; }
    .head { text-align: center; border-bottom: 2px solid #111827; padding-bottom: 12px; }
    .brand { font-size: 18px; font-weight: 800; letter-spacing: .02em; }
    .muted { color: #6b7280; font-size: 11px; margin-top: 2px; }
    .meta { margin: 12px 0; display: grid; gap: 5px; font-size: 12px; }
    .row { display: flex; justify-content: space-between; gap: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; border-bottom: 1px solid #d1d5db; padding: 7px 0; color: #374151; }
    td { border-bottom: 1px solid #e5e7eb; padding: 8px 0; vertical-align: top; }
    .num { text-align: right; white-space: nowrap; }
    .totals { margin-top: 12px; border-top: 2px solid #111827; padding-top: 8px; font-size: 13px; }
    .total { font-size: 16px; font-weight: 800; }
    .foot { margin-top: 16px; text-align: center; font-size: 11px; color: #6b7280; }
    @page { margin: 8mm; }
    @media print { body { background: #fff; } .receipt { width: 100%; padding: 0; } }
  </style>
</head>
<body>
  <main class="receipt">
    <section class="head">
      <div class="brand">${escapeHtml(company)}</div>
      ${branch ? `<div class="muted">${escapeHtml(branch)}</div>` : ''}
      ${order.branch?.phone ? `<div class="muted">${escapeHtml(order.branch.phone)}</div>` : ''}
      ${order.company?.phone ? `<div class="muted">${escapeHtml(order.company.phone)}</div>` : ''}
    </section>
    <section class="meta">
      <div class="row"><span>Receipt</span><strong>${escapeHtml(number)}</strong></div>
      <div class="row"><span>Date</span><strong>${escapeHtml(generatedAt)}</strong></div>
      <div class="row"><span>Customer</span><strong>${escapeHtml(receiptCustomerName(order))}</strong></div>
      <div class="row"><span>Payment</span><strong>${escapeHtml(formatEnumLabel(order.paymentMethod ?? 'CASH'))}</strong></div>
      ${order.cashAccount?.accountName ? `<div class="row"><span>Account</span><strong>${escapeHtml(order.cashAccount.accountName)}</strong></div>` : ''}
    </section>
    <table>
      <thead>
        <tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="4">No items</td></tr>'}</tbody>
    </table>
    <section class="totals">
      <div class="row"><span>Subtotal</span><strong>${escapeHtml(currency)} ${escapeHtml(formatMoney(order.subtotal ?? order.totalAmount))}</strong></div>
      <div class="row"><span>Discount</span><strong>${escapeHtml(currency)} ${escapeHtml(formatMoney(order.discountAmount))}</strong></div>
      <div class="row"><span>Tax</span><strong>${escapeHtml(currency)} ${escapeHtml(formatMoney(order.taxAmount))}</strong></div>
      <div class="row total"><span>Total</span><strong>${escapeHtml(currency)} ${escapeHtml(formatMoney(order.totalAmount))}</strong></div>
      <div class="row"><span>Paid</span><strong>${escapeHtml(currency)} ${escapeHtml(formatMoney(order.paidAmount ?? order.totalAmount))}</strong></div>
    </section>
    <section class="foot">
      Thank you for your business.<br />
      Generated by ITEMBA-R Operations Mobile POS
    </section>
  </main>
</body>
</html>`;
}

function getSettingsKey(userId: string) {
  return `${SETTINGS_KEY}.${userId}`;
}

function loadSettings(userId: string): Settings {
  if (typeof window === 'undefined') return blankSettings;
  try {
    const raw = localStorage.getItem(getSettingsKey(userId));
    if (!raw) return blankSettings;
    return { ...blankSettings, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return blankSettings;
  }
}

function saveSettings(userId: string, settings: Settings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getSettingsKey(userId), JSON.stringify(settings));
  } catch {
    // Storage can be unavailable on locked-down mobile browsers.
  }
}

async function createQuickSale(body: Record<string, unknown>) {
  return backendPost<ConfirmedOrder>('/sales-orders/mobile-pos/quick-sale', body);
}

export function MobilePosSaleEntry() {
  const { user, loading: authLoading, hasPermission } = useAuth();
  const userId = user?.id ?? '';
  const [hydrated, setHydrated] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(blankSettings);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [cashAccountsLoading, setCashAccountsLoading] = useState(false);

  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<Product[]>([]);
  const [productSearching, setProductSearching] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [pendingQty, setPendingQty] = useState(1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [walkInName, setWalkInName] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<ConfirmedOrder | null>(null);
  const [receiptMessage, setReceiptMessage] = useState('');

  useEffect(() => {
    if (authLoading) return;
    setSettings(userId ? loadSettings(userId) : blankSettings);
    setHydrated(true);
  }, [authLoading, userId]);

  useEffect(() => {
    if (hydrated && userId) saveSettings(userId, settings);
  }, [hydrated, settings, userId]);

  useEffect(() => {
    if (authLoading || !hydrated || !userId) return;
    let cancelled = false;
    setBootstrapLoading(true);
    Promise.allSettled([
      backendGet<MobilePosBootstrap>('/sales-orders/mobile-pos/bootstrap'),
      backendList<Unit>('/units', { query: { limit: 200 } }),
    ]).then(([bootstrapResult, unitResult]) => {
      if (cancelled) return;
      setUnits(unitResult.status === 'fulfilled' ? unitResult.value : []);
      if (bootstrapResult.status === 'fulfilled') {
        const bootstrap = bootstrapResult.value;
        setCompanies([bootstrap.company]);
        setDivisions(bootstrap.divisions);
        setBranches(bootstrap.branches);
        setCustomers(bootstrap.customers);
        setSettings((current) => {
          const divisionId = bootstrap.divisions.some(
            (division) => division.id === current.divisionId,
          )
            ? current.divisionId
            : (bootstrap.divisions[0]?.id ?? '');
          const scopedBranches = divisionId
            ? bootstrap.branches.filter((branch) => branch.divisionId === divisionId)
            : bootstrap.branches;
          const branchId = scopedBranches.some((branch) => branch.id === current.branchId)
            ? current.branchId
            : (scopedBranches[0]?.id ?? '');
          return {
            ...current,
            companyId: bootstrap.company.id,
            divisionId,
            branchId,
            salesType: current.salesType || bootstrap.defaults?.salesType || 'CASH_SALE',
            currency: current.currency || bootstrap.defaults?.currency || 'TZS',
            orderDate: current.orderDate || todayIsoDate(),
            paymentMethod: current.paymentMethod || bootstrap.defaults?.paymentMethod || 'CASH',
          };
        });
      } else {
        setError(
          bootstrapResult.reason instanceof Error
            ? bootstrapResult.reason.message
            : 'Could not load Westsides Mobile POS settings.',
        );
      }
      setBootstrapLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [authLoading, hydrated, userId]);

  useEffect(() => {
    if (!settings.companyId || !settings.divisionId || !settings.branchId) {
      setCashAccounts([]);
      setCashAccountsLoading(false);
      return;
    }
    let cancelled = false;
    setCashAccountsLoading(true);
    setCashAccounts([]);
    backendList<CashAccount>('/sales-orders/receipt-accounts', {
      query: {
        companyId: settings.companyId,
        divisionId: settings.divisionId,
        branchId: settings.branchId,
        paymentMethod: settings.paymentMethod,
        limit: 500,
      },
    })
      .then((rows) => {
        if (!cancelled) setCashAccounts(rows.filter((account) => account.isActive !== false));
      })
      .catch(() => {
        if (!cancelled) setCashAccounts([]);
      })
      .finally(() => {
        if (!cancelled) setCashAccountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.branchId, settings.companyId, settings.divisionId, settings.paymentMethod]);

  useEffect(() => {
    if (!settings.companyId || !settings.branchId) {
      setEmployees([]);
      return;
    }

    let cancelled = false;
    backendList<Employee>('/hr/employees', {
      query: {
        companyId: settings.companyId,
        branchId: settings.branchId,
        employmentStatus: 'ACTIVE',
        limit: 500,
      },
    })
      .then((rows) => {
        if (!cancelled) setEmployees(rows);
      })
      .catch(() => {
        if (!cancelled) setEmployees([]);
      });

    return () => {
      cancelled = true;
    };
  }, [settings.branchId, settings.companyId]);

  const selectedCompany = companies.find((company) => company.id === settings.companyId);
  const selectedDivision = divisions.find((division) => division.id === settings.divisionId);
  const selectedBranch = branches.find((branch) => branch.id === settings.branchId);
  const selectableCashAccounts = useMemo(
    () => selectableReceiptAccounts(cashAccounts, settings.paymentMethod, selectedBranch),
    [cashAccounts, selectedBranch, settings.paymentMethod],
  );
  const selectedAccount = selectableCashAccounts.find(
    (account) => account.id === settings.cashAccountId,
  );
  const selectedEmployee = employees.find((employee) => employee.id === settings.salespersonId);
  const receiptAccountReady = Boolean(settings.cashAccountId && selectedAccount);
  const settingsReady = Boolean(
    settings.companyId &&
    settings.divisionId &&
    settings.branchId &&
    settings.salesType &&
    settings.currency &&
    settings.orderDate &&
    receiptAccountReady,
  );

  useEffect(() => {
    if (hydrated && !settingsReady) setSettingsOpen(true);
  }, [hydrated, settingsReady]);

  useEffect(() => {
    if (!settings.companyId || !settings.divisionId || !settings.branchId || !productQuery.trim()) {
      setProductResults([]);
      setProductSearching(false);
      return;
    }
    if (selectedProduct && productQuery.trim() === selectedProduct.name) {
      setProductResults([]);
      return;
    }

    let cancelled = false;
    setProductSearching(true);
    const timer = setTimeout(() => {
      backendList<Product>('/products', {
        query: {
          companyId: settings.companyId,
          divisionId: settings.divisionId,
          branchId: settings.branchId,
          search: productQuery.trim(),
          status: 'ACTIVE',
          limit: 12,
        },
      })
        .then((rows) => {
          if (!cancelled) setProductResults(rows);
        })
        .catch(() => {
          if (!cancelled) setProductResults([]);
        })
        .finally(() => {
          if (!cancelled) setProductSearching(false);
        });
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [productQuery, selectedProduct, settings.branchId, settings.companyId, settings.divisionId]);

  useEffect(() => {
    if (cashAccountsLoading) return;
    if (
      settings.cashAccountId &&
      !selectableCashAccounts.some((account) => account.id === settings.cashAccountId)
    ) {
      setSettings((current) => ({ ...current, cashAccountId: '' }));
      return;
    }
    if (!settings.cashAccountId && selectableCashAccounts.length > 0) {
      const defaultAccount = selectableCashAccounts[0]!;
      setSettings((current) => ({
        ...current,
        cashAccountId: defaultAccount.id,
      }));
    }
  }, [cashAccountsLoading, selectableCashAccounts, settings.cashAccountId]);

  const branchOptions = useMemo(
    () =>
      settings.divisionId
        ? branches.filter((branch) => branch.divisionId === settings.divisionId)
        : [],
    [branches, settings.divisionId],
  );

  const allocatedByProduct = useMemo(() => {
    const allocated = new Map<string, number>();
    for (const line of cart) {
      allocated.set(line.productId, (allocated.get(line.productId) ?? 0) + line.qty);
    }
    return allocated;
  }, [cart]);

  const selectedAvailable = selectedProduct
    ? (productAvailableStock(selectedProduct) ?? null)
    : null;
  const selectedAvailableForAdd =
    selectedProduct && selectedAvailable != null
      ? selectedAvailable - (allocatedByProduct.get(selectedProduct.id) ?? 0)
      : null;
  const selectedStockBlocked = Boolean(
    selectedProduct &&
    tracksInventory(selectedProduct) &&
    selectedAvailableForAdd != null &&
    pendingQty > selectedAvailableForAdd,
  );

  const stockIssues = useMemo(() => {
    const issues: string[] = [];
    const checked = new Set<string>();
    for (const line of cart) {
      if (checked.has(line.productId) || !tracksInventory(line) || line.availableStock == null) {
        continue;
      }
      checked.add(line.productId);
      const allocated = allocatedByProduct.get(line.productId) ?? 0;
      if (allocated > line.availableStock) {
        issues.push(
          `${line.productName} has ${formatQty(line.availableStock)} available; cart uses ${formatQty(allocated)}.`,
        );
      }
    }
    return issues;
  }, [allocatedByProduct, cart]);

  const totals = useMemo(() => {
    const subtotal = cart.reduce((sum, line) => sum + line.qty * line.unitPrice, 0);
    return { subtotal, total: subtotal };
  }, [cart]);
  const confirmedReceiptLines = useMemo(
    () => (confirmed ? receiptLines(confirmed, cart) : []),
    [cart, confirmed],
  );

  const canUseMobilePos = hasPermission('sales.create') || hasPermission('pos.create');
  const customerOptions = customers.filter((customer) => {
    if (customer.branchId && settings.branchId && customer.branchId !== settings.branchId)
      return false;
    if (customer.divisionId && settings.divisionId && customer.divisionId !== settings.divisionId) {
      return false;
    }
    return true;
  });

  const canCheckout =
    settingsReady &&
    cart.length > 0 &&
    totals.total > 0 &&
    stockIssues.length === 0 &&
    cart.every((line) => line.productId && line.unitId && line.qty > 0 && line.unitPrice >= 0);

  const resetSaleFields = () => {
    setCart([]);
    setCustomerId('');
    setWalkInName('');
    setPaymentReference('');
    setSelectedProduct(null);
    setProductQuery('');
    setProductResults([]);
    setPendingQty(1);
    setError('');
    setConfirmed(null);
    setReceiptMessage('');
    setSettings((current) => ({
      ...current,
      orderDate: todayIsoDate(),
      dueDate: '',
      notes: '',
    }));
  };

  const resetForScopeChange = () => {
    resetSaleFields();
    searchInputRef.current?.focus();
  };

  const addProduct = (product: Product, quantity = pendingQty) => {
    if (!settings.branchId) {
      setSettingsOpen(true);
      setError('Pick a branch before adding items.');
      return;
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Enter a quantity greater than zero.');
      return;
    }
    const available = productAvailableStock(product);
    const alreadyAllocated = allocatedByProduct.get(product.id) ?? 0;
    const availableForAdd = available == null ? null : available - alreadyAllocated;
    if (tracksInventory(product) && availableForAdd != null && qty > availableForAdd) {
      setError(`${product.name} has ${formatQty(Math.max(0, availableForAdd))} available.`);
      return;
    }

    const unitId = productUnitId(product);
    const unit = units.find((candidate) => candidate.id === unitId);
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        return current.map((line) =>
          line.productId === product.id
            ? {
                ...line,
                qty: line.qty + qty,
                unitPrice: productPrice(product),
                trackInventory: product.trackInventory,
                productType: product.productType,
                availableStock: available,
              }
            : line,
        );
      }
      return [
        ...current,
        {
          productId: product.id,
          productName: product.name,
          sku: productCode(product) || undefined,
          qty,
          unitId: unitId || units[0]?.id || '',
          unitSymbol: product.baseUnit?.symbol ?? unit?.symbol ?? units[0]?.symbol ?? 'ea',
          unitPrice: productPrice(product),
          trackInventory: product.trackInventory,
          productType: product.productType,
          availableStock: available,
        },
      ];
    });
    setError('');
    setSelectedProduct(null);
    setProductQuery('');
    setProductResults([]);
    setPendingQty(1);
    searchInputRef.current?.focus();
  };

  const updateLine = (index: number, patch: Partial<CartLine>) => {
    setCart((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
    );
  };

  const removeLine = (index: number) => {
    setCart((current) => current.filter((_, lineIndex) => lineIndex !== index));
  };

  const handleSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (selectedProduct) {
      addProduct(selectedProduct);
    } else if (productResults[0]) {
      addProduct(productResults[0]);
    }
  };

  const checkout = async () => {
    if (submitting || !canCheckout) return;
    if (stockIssues[0]) {
      setError(stockIssues[0]);
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        companyId: settings.companyId,
        divisionId: settings.divisionId,
        branchId: settings.branchId,
        salesType: settings.salesType || 'CASH_SALE',
        orderDate: settings.orderDate || todayIsoDate(),
        currency: settings.currency || 'TZS',
        paymentMethod: paymentMethodForAccount(selectedAccount) ?? settings.paymentMethod,
        cashAccountId: settings.cashAccountId,
        lines: cart.map((line) => ({
          productId: line.productId,
          quantity: line.qty,
          unitId: line.unitId,
          unitPrice: line.unitPrice,
          discountAmount: 0,
          taxAmount: 0,
        })),
      };
      if (customerId) {
        body.customerId = customerId;
      } else {
        body.customerName = walkInName.trim() || 'Walk-in';
      }
      if (paymentReference.trim()) {
        body.paymentReference = paymentReference.trim();
      }
      if (settings.dueDate) {
        body.dueDate = settings.dueDate;
      }
      if (settings.salespersonId) {
        body.salespersonId = settings.salespersonId;
      }
      if (settings.notes.trim()) {
        body.notes = settings.notes.trim();
      }

      const order = await createQuickSale(body);
      setConfirmed(order);
      setReceiptMessage('Receipt ready.');
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'Checkout failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const printReceipt = () => {
    if (!confirmed) return;
    setReceiptMessage('');
    const html = receiptHtml(confirmed, confirmedReceiptLines, settings.currency);
    const popup = window.open('', '_blank', 'noopener,noreferrer,width=420,height=720');
    if (!popup) {
      setReceiptMessage('Allow pop-ups to print this receipt.');
      return;
    }
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    window.setTimeout(() => popup.print(), 250);
  };

  const downloadReceipt = () => {
    if (!confirmed) return;
    setReceiptMessage('');
    const number = receiptNumber(confirmed).replace(/[^\w.-]+/g, '-');
    const html = receiptHtml(confirmed, confirmedReceiptLines, settings.currency);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${number}-receipt.html`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setReceiptMessage('Receipt downloaded.');
  };

  const shareReceipt = async () => {
    if (!confirmed) return;
    setReceiptMessage('');
    const text = receiptPlainText(confirmed, confirmedReceiptLines, settings.currency);
    const url = confirmed.id
      ? `${window.location.origin}/operations/sales-orders/${confirmed.id}/print`
      : undefined;
    try {
      if (navigator.share) {
        const sharePayload: ShareData = {
          title: `${receiptNumber(confirmed)} receipt`,
          text,
        };
        if (url) sharePayload.url = url;
        await navigator.share({
          ...sharePayload,
        });
        setReceiptMessage('Receipt shared.');
        return;
      }
      await navigator.clipboard.writeText(url ? `${text}\n\n${url}` : text);
      setReceiptMessage('Receipt copied to clipboard.');
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
      setReceiptMessage('Could not share receipt. Try download or print.');
    }
  };

  if (authLoading || !hydrated || bootstrapLoading) return <PageSpinner />;

  if (!canUseMobilePos) {
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="Operations Mobile POS" subtitle="Westsides sale entry" />
        <PermissionDeniedState description="You need sales.create or pos.create to enter POS sales." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md p-3 pb-6 sm:max-w-5xl sm:p-6">
      <PageHeader
        title="Operations Mobile POS"
        subtitle="Westsides counter sales through Operations Sales Orders"
        actions={
          <>
            <Link
              href="/operations/sales-orders"
              className="hidden min-h-9 items-center rounded-lg border px-3 text-[12px] font-semibold sm:inline-flex"
              style={{
                borderColor: 'var(--aurora-border)',
                color: 'var(--aurora-text-secondary)',
              }}
            >
              Sales Orders
            </Link>
            <Btn variant="secondary" size="sm" onClick={() => setSettingsOpen(true)}>
              Settings
            </Btn>
          </>
        }
      />

      <OperationsSalesOrderOnboarding
        settingsReady={settingsReady}
        customerReady={settingsReady || Boolean(customerId || walkInName.trim())}
        receiptReady={receiptAccountReady}
        linesReady={cart.length > 0}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          <SettingsSummary
            company={selectedCompany?.name}
            division={selectedDivision?.name}
            branch={selectedBranch?.name}
            salesType={settings.salesType}
            currency={settings.currency}
            orderDate={settings.orderDate}
            salesperson={selectedEmployee ? employeeOptionLabel(selectedEmployee) : undefined}
            account={selectedAccount?.accountName}
            paymentMethod={settings.paymentMethod}
            ready={settingsReady}
            onOpen={() => setSettingsOpen(true)}
          />

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
              {error}
            </div>
          )}

          {confirmed && (
            <MobileReceiptCard
              order={confirmed}
              lines={confirmedReceiptLines}
              fallbackCurrency={settings.currency}
              message={receiptMessage}
              onPrint={printReceipt}
              onShare={shareReceipt}
              onDownload={downloadReceipt}
              onNewSale={resetSaleFields}
            />
          )}

          <Card padding="sm" className="space-y-3">
            <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
              <div className="relative">
                <label
                  className="mb-1 block text-[12px] font-medium"
                  style={{ color: 'var(--aurora-text-secondary)' }}
                >
                  Find Product
                </label>
                <input
                  ref={searchInputRef}
                  className="aurora-input w-full rounded-lg px-3 py-2 text-[13px] transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed"
                  value={productQuery}
                  onChange={(event) => {
                    setProductQuery(event.target.value);
                    setSelectedProduct(null);
                  }}
                  onKeyDown={handleSearchKey}
                  disabled={!settingsReady || Boolean(confirmed)}
                  placeholder={settingsReady ? 'Search name, code, SKU, barcode' : 'Pick settings'}
                  autoComplete="off"
                />
                {(productResults.length > 0 || productSearching) && (
                  <div
                    className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border shadow-lg"
                    style={{
                      background: 'var(--aurora-card)',
                      borderColor: 'var(--aurora-border)',
                    }}
                  >
                    {productSearching && productResults.length === 0 ? (
                      <div className="px-3 py-2 text-[12px] text-slate-500">Searching</div>
                    ) : (
                      productResults.map((product) => (
                        <ProductResultButton
                          key={product.id}
                          product={product}
                          allocated={allocatedByProduct.get(product.id) ?? 0}
                          onPick={() => {
                            setSelectedProduct(product);
                            setProductQuery(product.name);
                            setProductResults([]);
                            searchInputRef.current?.focus();
                          }}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
              <FormInput
                label="Qty"
                type="number"
                min="0.001"
                step="any"
                value={pendingQty}
                onChange={(event) => setPendingQty(Number(event.target.value) || 0)}
                disabled={!settingsReady || Boolean(confirmed)}
                className="[&>input]:text-right"
              />
            </div>
            {selectedProduct && (
              <div
                className="rounded-lg border px-3 py-2 text-[12px]"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <div className="font-medium">{selectedProduct.name}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-slate-500">
                  <span>TZS {formatMoney(productPrice(selectedProduct))}</span>
                  {productCode(selectedProduct) && (
                    <span className="font-mono">{productCode(selectedProduct)}</span>
                  )}
                  {tracksInventory(selectedProduct) && selectedAvailableForAdd != null && (
                    <span className={selectedStockBlocked ? 'text-red-600' : 'text-emerald-600'}>
                      Available {formatQty(Math.max(0, selectedAvailableForAdd))}
                    </span>
                  )}
                </div>
              </div>
            )}
            <Btn
              className="h-11 w-full"
              variant="primary"
              onClick={() => selectedProduct && addProduct(selectedProduct)}
              disabled={
                !settingsReady ||
                Boolean(confirmed) ||
                !selectedProduct ||
                pendingQty <= 0 ||
                selectedStockBlocked
              }
            >
              Add Item
            </Btn>
          </Card>

          <CartPanel
            lines={cart}
            allocatedByProduct={allocatedByProduct}
            onUpdate={updateLine}
            onRemove={removeLine}
            disabled={Boolean(confirmed)}
          />
        </div>

        <div className="space-y-3">
          <Card padding="sm" className="space-y-3">
            <FormSelect
              label="Customer"
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
              placeholder="Walk-in"
              disabled={Boolean(confirmed)}
              options={customerOptions.map((customer) => ({
                value: customer.id,
                label: customer.customerCode
                  ? `${customer.name} - ${customer.customerCode}`
                  : customer.name,
              }))}
            />
            {!customerId && (
              <FormInput
                label="Walk-in name"
                value={walkInName}
                onChange={(event) => setWalkInName(event.target.value)}
                disabled={Boolean(confirmed)}
                placeholder="Walk-in"
              />
            )}
            <FormSelect
              label="Payment method"
              value={settings.paymentMethod}
              onChange={(event) => {
                const nextMethod = event.target.value;
                const currentAccount = cashAccounts.find(
                  (account) => account.id === settings.cashAccountId,
                );
                const nextAccount =
                  currentAccount && accountMatchesPaymentMethod(currentAccount, nextMethod)
                    ? currentAccount
                    : selectableReceiptAccounts(cashAccounts, nextMethod, selectedBranch)[0];
                setSettings((current) => ({
                  ...current,
                  paymentMethod: nextMethod,
                  cashAccountId: nextAccount?.id ?? '',
                }));
              }}
              disabled={Boolean(confirmed)}
              options={PAYMENT_METHODS}
            />
            <FormSelect
              label={accountSelectLabel(settings.paymentMethod)}
              value={settings.cashAccountId}
              onChange={(event) => {
                const account = cashAccounts.find(
                  (candidate) => candidate.id === event.target.value,
                );
                setSettings((current) => ({
                  ...current,
                  cashAccountId: event.target.value,
                  paymentMethod: paymentMethodForAccount(account) ?? current.paymentMethod,
                }));
              }}
              disabled={!settings.branchId || cashAccountsLoading || Boolean(confirmed)}
              placeholder={cashAccountsLoading ? 'Loading accounts' : 'Select account'}
              options={selectableCashAccounts.map((account) => ({
                value: account.id,
                label: accountOptionLabel(account),
              }))}
              hint={
                settings.branchId && !cashAccountsLoading && selectableCashAccounts.length === 0
                  ? `${emptyReceiptAccountHint(settings.paymentMethod)} Create or activate it under Finance > Cash Accounts, then re-open settings.`
                  : undefined
              }
            />
            {settings.paymentMethod !== 'CASH' && (
              <FormInput
                label="Payment reference"
                value={paymentReference}
                onChange={(event) => setPaymentReference(event.target.value)}
                disabled={Boolean(confirmed)}
                placeholder="Reference"
              />
            )}
          </Card>

          <div className="sticky bottom-3 z-20 sm:static">
            <Card padding="sm" className="space-y-3">
              <div className="space-y-2 text-[13px]">
                <SummaryRow label="Subtotal" value={`TZS ${formatMoney(totals.subtotal)}`} />
                <SummaryRow label="Tax" value="TZS 0.00" muted />
                <SummaryRow label="Discount" value="TZS 0.00" muted />
                <div className="border-t" style={{ borderColor: 'var(--aurora-border)' }} />
                <SummaryRow label="Total" value={`TZS ${formatMoney(totals.total)}`} strong />
              </div>
              {stockIssues[0] && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">
                  {stockIssues[0]}
                </div>
              )}
              <Btn
                className="h-12 w-full text-[15px]"
                variant="success"
                loading={submitting}
                disabled={!canCheckout || Boolean(confirmed)}
                onClick={checkout}
              >
                {canCheckout ? `Checkout TZS ${formatMoney(totals.total)}` : 'Checkout'}
              </Btn>
            </Card>
          </div>
        </div>
      </div>

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        settingsReady={settingsReady}
        companies={companies}
        divisions={divisions}
        branchOptions={branchOptions}
        employees={employees}
        cashAccounts={cashAccounts}
        cashAccountsLoading={cashAccountsLoading}
        onClose={() => setSettingsOpen(false)}
        onChange={(patch) => {
          const scopeChanged =
            ('companyId' in patch && patch.companyId !== settings.companyId) ||
            ('divisionId' in patch && patch.divisionId !== settings.divisionId) ||
            ('branchId' in patch && patch.branchId !== settings.branchId);
          setSettings((current) => ({ ...current, ...patch }));
          if (scopeChanged) resetForScopeChange();
        }}
      />
    </div>
  );
}

function MobileReceiptCard({
  order,
  lines,
  fallbackCurrency,
  message,
  onPrint,
  onShare,
  onDownload,
  onNewSale,
}: {
  order: ConfirmedOrder;
  lines: ConfirmedOrderLine[];
  fallbackCurrency: string;
  message: string;
  onPrint: () => void;
  onShare: () => void;
  onDownload: () => void;
  onNewSale: () => void;
}) {
  const currency = receiptCurrency(order, fallbackCurrency);
  const number = receiptNumber(order);
  const customerName = receiptCustomerName(order);
  const total =
    order.totalAmount ??
    lines.reduce((sum, line) => sum + normalizeNumber(receiptLineTotal(line)), 0);
  const paid = order.paidAmount ?? total;

  return (
    <Card padding="sm" className="border-emerald-200 bg-emerald-50">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-wide text-emerald-700">
            Receipt ready
          </div>
          <div className="mt-0.5 text-[12px] text-emerald-800">
            Print, share, or download before starting the next sale.
          </div>
        </div>
        <div className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700">
          Posted
        </div>
      </div>
      <div className="rounded-xl bg-white p-3 shadow-sm">
        <div className="border-b border-slate-900 pb-3 text-center">
          <div className="text-[16px] font-extrabold tracking-wide">
            {order.company?.name ?? 'WESTSIDES COMPANY LTD'}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {[order.branch?.name, order.branch?.phone ?? order.company?.phone]
              .filter(Boolean)
              .join(' - ')}
          </div>
        </div>

        <div className="mt-3 space-y-1 text-[12px]">
          <ReceiptMetaRow label="Receipt" value={number} strong />
          <ReceiptMetaRow label="Date" value={formatDateTime(order.orderDate)} />
          <ReceiptMetaRow label="Customer" value={customerName} />
          <ReceiptMetaRow label="Payment" value={formatEnumLabel(order.paymentMethod ?? 'CASH')} />
          {order.cashAccount?.accountName && (
            <ReceiptMetaRow label="Account" value={order.cashAccount.accountName} />
          )}
        </div>

        <div className="mt-3 border-y border-slate-200">
          {lines.length === 0 ? (
            <div className="py-4 text-center text-[12px] text-slate-500">No items attached.</div>
          ) : (
            lines.map((line, index) => {
              const code = receiptLineCode(line);
              const unit = line.unit?.symbol ?? line.unit?.name ?? '';
              return (
                <div
                  key={line.id ?? `${receiptLineName(line)}-${index}`}
                  className="border-b border-slate-100 py-2 last:border-b-0"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-slate-950">
                        {receiptLineName(line)}
                      </div>
                      {code && <div className="font-mono text-[10px] text-slate-500">{code}</div>}
                    </div>
                    <div className="whitespace-nowrap text-right text-[13px] font-semibold text-slate-950">
                      {currency} {formatMoney(receiptLineTotal(line))}
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                    <span>
                      {formatQty(receiptLineQty(line))}
                      {unit ? ` ${unit}` : ''} x {currency} {formatMoney(line.unitPrice)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="mt-3 space-y-1 text-[12px]">
          <ReceiptMetaRow
            label="Subtotal"
            value={`${currency} ${formatMoney(order.subtotal ?? total)}`}
          />
          <ReceiptMetaRow
            label="Discount"
            value={`${currency} ${formatMoney(order.discountAmount)}`}
          />
          <ReceiptMetaRow label="Tax" value={`${currency} ${formatMoney(order.taxAmount)}`} />
          <ReceiptMetaRow label="Total" value={`${currency} ${formatMoney(total)}`} strong />
          <ReceiptMetaRow label="Paid" value={`${currency} ${formatMoney(paid)}`} />
        </div>

        <div className="mt-4 text-center text-[11px] text-slate-500">
          Thank you for your business.
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Btn variant="secondary" size="sm" onClick={onPrint}>
          Print
        </Btn>
        <Btn variant="secondary" size="sm" onClick={onShare}>
          Share
        </Btn>
        <Btn variant="secondary" size="sm" onClick={onDownload}>
          Download
        </Btn>
      </div>
      {order.id && (
        <Link
          href={`/operations/sales-orders/${order.id}/print`}
          className="mt-2 flex min-h-10 items-center justify-center rounded-lg border px-3 text-[12px] font-semibold"
          style={{
            borderColor: 'var(--aurora-border)',
            color: 'var(--aurora-text-secondary)',
          }}
        >
          Open full receipt
        </Link>
      )}
      {message && (
        <div className="mt-2 rounded-lg bg-white px-3 py-2 text-center text-[12px] text-emerald-700">
          {message}
        </div>
      )}
      <Btn className="mt-3 w-full" variant="success" onClick={onNewSale}>
        New Sale
      </Btn>
    </Card>
  );
}

function ReceiptMetaRow({
  label,
  value,
  strong,
}: {
  label: string;
  value?: string | null;
  strong?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 ${strong ? 'font-bold' : ''}`}>
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-950">{value || '-'}</span>
    </div>
  );
}

function SettingsSummary({
  company,
  division,
  branch,
  salesType,
  currency,
  orderDate,
  salesperson,
  account,
  paymentMethod,
  ready,
  onOpen,
}: {
  company?: string;
  division?: string;
  branch?: string;
  salesType: string;
  currency: string;
  orderDate: string;
  salesperson?: string;
  account?: string;
  paymentMethod: string;
  ready: boolean;
  onOpen: () => void;
}) {
  return (
    <Card padding="sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Settings
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3">
            <SettingValue label="Company" value={company} />
            <SettingValue label="Division" value={division} />
            <SettingValue label="Branch" value={branch} />
            <SettingValue label="Sales Type" value={formatEnumLabel(salesType)} />
            <SettingValue label="Currency" value={currency} />
            <SettingValue label="Order Date" value={orderDate} />
            <SettingValue label="Salesperson" value={salesperson} />
            <SettingValue label="Pay to" value={account} />
            <SettingValue label="Method" value={formatEnumLabel(paymentMethod)} />
            <SettingValue label="Status" value={ready ? 'Ready' : 'Missing'} />
          </div>
        </div>
        <Btn variant="secondary" size="xs" onClick={onOpen}>
          Edit
        </Btn>
      </div>
    </Card>
  );
}

function SettingValue({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="truncate font-medium" style={{ color: 'var(--aurora-text)' }}>
        {value || '-'}
      </div>
    </div>
  );
}

function OperationsSalesOrderOnboarding({
  settingsReady,
  customerReady,
  receiptReady,
  linesReady,
  onOpenSettings,
}: {
  settingsReady: boolean;
  customerReady: boolean;
  receiptReady: boolean;
  linesReady: boolean;
  onOpenSettings: () => void;
}) {
  const steps = [
    {
      label: 'Scope',
      detail: 'Company, sales type, division, and branch',
      done: settingsReady,
    },
    {
      label: 'Customer & receipt',
      detail: 'Walk-in/customer and receipt account',
      done: customerReady && receiptReady,
    },
    {
      label: 'Products & stock',
      detail: 'Search products, verify available stock',
      done: linesReady,
    },
  ];

  return (
    <Card padding="sm" className="mb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Operations sales order flow
          </div>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--aurora-text-secondary)' }}>
            This POS follows the same setup path as Operations &gt; Sales Orders, then posts a paid
            cash sale.
          </p>
        </div>
        <Btn variant="ghost" size="xs" onClick={onOpenSettings}>
          Scope
        </Btn>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {steps.map((step, index) => (
          <div
            key={step.label}
            className="rounded-lg border px-3 py-2"
            style={{
              borderColor: step.done ? 'rgba(16, 185, 129, 0.35)' : 'var(--aurora-border)',
              background: step.done ? 'rgba(16, 185, 129, 0.08)' : 'var(--aurora-bg-subtle)',
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold">
                {index + 1}. {step.label}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  step.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {step.done ? 'Ready' : 'Open'}
              </span>
            </div>
            <div className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
              {step.detail}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ProductResultButton({
  product,
  allocated,
  onPick,
}: {
  product: Product;
  allocated: number;
  onPick: () => void;
}) {
  const available = productAvailableStock(product);
  const availableAfterCart = available == null ? null : available - allocated;

  return (
    <button
      type="button"
      className="block w-full px-3 py-2 text-left transition-colors hover:bg-zinc-50"
      onMouseDown={(event) => {
        event.preventDefault();
        onPick();
      }}
    >
      <div className="text-[13px] font-medium">{product.name}</div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
        {productCode(product) && <span className="font-mono">{productCode(product)}</span>}
        <span>TZS {formatMoney(productPrice(product))}</span>
        {tracksInventory(product) && availableAfterCart != null && (
          <span className={availableAfterCart <= 0 ? 'text-red-600' : 'text-emerald-600'}>
            Stock {formatQty(Math.max(0, availableAfterCart))}
          </span>
        )}
      </div>
    </button>
  );
}

function CartPanel({
  lines,
  allocatedByProduct,
  onUpdate,
  onRemove,
  disabled,
}: {
  lines: CartLine[];
  allocatedByProduct: Map<string, number>;
  onUpdate: (index: number, patch: Partial<CartLine>) => void;
  onRemove: (index: number) => void;
  disabled: boolean;
}) {
  return (
    <Card padding="sm" className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-semibold">Cart</div>
        <div className="text-[12px] text-slate-500">{lines.length} items</div>
      </div>
      {lines.length === 0 ? (
        <div
          className="rounded-lg border border-dashed px-3 py-7 text-center text-[13px] text-slate-500"
          style={{ borderColor: 'var(--aurora-border)' }}
        >
          No items
        </div>
      ) : (
        lines.map((line, index) => (
          <CartLineCard
            key={line.productId}
            line={line}
            index={index}
            allocated={allocatedByProduct.get(line.productId) ?? line.qty}
            onUpdate={onUpdate}
            onRemove={onRemove}
            disabled={disabled}
          />
        ))
      )}
    </Card>
  );
}

function CartLineCard({
  line,
  index,
  allocated,
  onUpdate,
  onRemove,
  disabled,
}: {
  line: CartLine;
  index: number;
  allocated: number;
  onUpdate: (index: number, patch: Partial<CartLine>) => void;
  onRemove: (index: number) => void;
  disabled: boolean;
}) {
  const hasStockIssue =
    tracksInventory(line) && line.availableStock != null && allocated > line.availableStock;
  const remaining = line.availableStock == null ? null : line.availableStock - allocated;
  const canIncrease =
    !tracksInventory(line) || line.availableStock == null || remaining == null || remaining >= 1;

  return (
    <div
      className="rounded-lg border p-3"
      style={{
        borderColor: hasStockIssue ? 'var(--aurora-danger)' : 'var(--aurora-border)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold">{line.productName}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-slate-500">
            {line.sku && <span className="font-mono">{line.sku}</span>}
            {tracksInventory(line) && line.availableStock != null && (
              <span className={hasStockIssue ? 'text-red-600' : ''}>
                Available {formatQty(line.availableStock)}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          className="h-7 w-7 rounded-lg text-[18px] leading-none text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
          onClick={() => onRemove(index)}
          disabled={disabled}
          aria-label={`Remove ${line.productName}`}
        >
          x
        </button>
      </div>

      <div className="mt-3 grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">Qty</div>
          <div className="grid grid-cols-[2rem_minmax(0,1fr)_2rem]">
            <button
              type="button"
              className="rounded-l-lg border px-2 text-[16px] disabled:opacity-40"
              style={{ borderColor: 'var(--aurora-border)' }}
              onClick={() => onUpdate(index, { qty: Math.max(0.001, line.qty - 1) })}
              disabled={disabled}
              aria-label={`Decrease ${line.productName}`}
            >
              -
            </button>
            <input
              type="number"
              min="0.001"
              step="any"
              value={line.qty}
              onChange={(event) => onUpdate(index, { qty: Number(event.target.value) || 0 })}
              disabled={disabled}
              className="aurora-input min-w-0 border-y px-1 py-2 text-center text-[13px]"
              style={{ borderColor: 'var(--aurora-border)' }}
            />
            <button
              type="button"
              className="rounded-r-lg border px-2 text-[16px] disabled:opacity-40"
              style={{ borderColor: 'var(--aurora-border)' }}
              onClick={() => canIncrease && onUpdate(index, { qty: line.qty + 1 })}
              disabled={disabled || !canIncrease}
              aria-label={`Increase ${line.productName}`}
            >
              +
            </button>
          </div>
        </div>
        <FormInput
          label="Price"
          type="number"
          min="0"
          step="any"
          value={line.unitPrice}
          onChange={(event) => onUpdate(index, { unitPrice: Number(event.target.value) || 0 })}
          disabled={disabled}
          className="[&>input]:text-right"
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-[12px]">
        <span className="text-slate-500">{line.unitSymbol}</span>
        <span className="font-semibold">TZS {formatMoney(line.qty * line.unitPrice)}</span>
      </div>
      {hasStockIssue && (
        <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">
          Cart uses {formatQty(allocated)}.
        </div>
      )}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between ${strong ? 'text-[16px] font-semibold' : ''}`}
    >
      <span className={muted ? 'text-slate-400' : 'text-slate-500'}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function SettingsModal({
  open,
  settings,
  settingsReady,
  companies,
  divisions,
  branchOptions,
  employees,
  cashAccounts,
  cashAccountsLoading,
  onClose,
  onChange,
}: {
  open: boolean;
  settings: Settings;
  settingsReady: boolean;
  companies: Company[];
  divisions: Division[];
  branchOptions: Branch[];
  employees: Employee[];
  cashAccounts: CashAccount[];
  cashAccountsLoading: boolean;
  onClose: () => void;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const selectedBranch = branchOptions.find((branch) => branch.id === settings.branchId);
  const selectableCashAccounts = useMemo(
    () => selectableReceiptAccounts(cashAccounts, settings.paymentMethod, selectedBranch),
    [cashAccounts, selectedBranch, settings.paymentMethod],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Operations sales order setup"
      size="2xl"
      footer={
        <Btn variant="primary" onClick={onClose} disabled={!settingsReady}>
          Done
        </Btn>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Scope
          </div>
          <div className="mt-2 grid gap-3 md:grid-cols-3">
            <FormSelect
              label="Company"
              required
              value={settings.companyId}
              onChange={(event) =>
                onChange({
                  companyId: event.target.value,
                  divisionId: '',
                  branchId: '',
                  salespersonId: '',
                  cashAccountId: '',
                })
              }
              placeholder="Select company"
              options={companies.map((company) => ({
                value: company.id,
                label: company.code ? `${company.name} (${company.code})` : company.name,
              }))}
            />
            <FormSelect
              label="Sales Type"
              required
              value={settings.salesType}
              onChange={(event) =>
                onChange({
                  salesType: event.target.value,
                  paymentMethod:
                    event.target.value === 'CASH_SALE' || event.target.value === 'RETAIL'
                      ? settings.paymentMethod === 'CREDIT'
                        ? 'CASH'
                        : settings.paymentMethod
                      : settings.paymentMethod,
                })
              }
              options={SALES_TYPES}
            />
            <FormSelect
              label="Division"
              required
              value={settings.divisionId}
              onChange={(event) =>
                onChange({
                  divisionId: event.target.value,
                  branchId: '',
                  salespersonId: '',
                  cashAccountId: '',
                })
              }
              placeholder={settings.companyId ? 'Select division' : 'Pick company first'}
              disabled={!settings.companyId}
              options={divisions.map((division) => ({
                value: division.id,
                label: division.code ? `${division.code} - ${division.name}` : division.name,
              }))}
            />
            <FormSelect
              label="Branch / Location"
              required
              value={settings.branchId}
              onChange={(event) =>
                onChange({
                  branchId: event.target.value,
                  salespersonId: '',
                  cashAccountId: '',
                })
              }
              placeholder={settings.divisionId ? 'Select branch' : 'Pick division first'}
              disabled={!settings.divisionId}
              options={branchOptions.map((branch) => ({
                value: branch.id,
                label: branch.code ? `${branch.code} - ${branch.name}` : branch.name,
              }))}
            />
            <FormSelect
              label="Currency"
              required
              value={settings.currency}
              onChange={(event) => onChange({ currency: event.target.value })}
              options={CURRENCIES.map((currency) => ({ value: currency, label: currency }))}
            />
            <FormSelect
              label="Salesperson"
              value={settings.salespersonId}
              onChange={(event) => onChange({ salespersonId: event.target.value })}
              placeholder={settings.branchId ? 'None (no commission)' : 'Pick branch first'}
              disabled={!settings.branchId}
              options={employees.map((employee) => ({
                value: employee.id,
                label: employeeOptionLabel(employee),
              }))}
            />
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Dates and payment
          </div>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <FormInput
              label="Order Date"
              required
              type="date"
              value={settings.orderDate}
              onChange={(event) => onChange({ orderDate: event.target.value })}
            />
            <FormInput
              label="Due Date"
              type="date"
              value={settings.dueDate}
              onChange={(event) => onChange({ dueDate: event.target.value })}
            />
            <FormSelect
              label="Payment Method"
              required
              value={settings.paymentMethod}
              onChange={(event) => {
                const nextMethod = event.target.value;
                const currentAccount = cashAccounts.find(
                  (account) => account.id === settings.cashAccountId,
                );
                const nextAccount =
                  currentAccount && accountMatchesPaymentMethod(currentAccount, nextMethod)
                    ? currentAccount
                    : selectableReceiptAccounts(cashAccounts, nextMethod, selectedBranch)[0];
                onChange({
                  paymentMethod: nextMethod,
                  cashAccountId: nextAccount?.id ?? '',
                });
              }}
              options={PAYMENT_METHODS}
            />
            <FormSelect
              label={accountSelectLabel(settings.paymentMethod)}
              required
              value={settings.cashAccountId}
              onChange={(event) => {
                const account = cashAccounts.find(
                  (candidate) => candidate.id === event.target.value,
                );
                onChange({
                  cashAccountId: event.target.value,
                  paymentMethod: paymentMethodForAccount(account) ?? settings.paymentMethod,
                });
              }}
              placeholder={cashAccountsLoading ? 'Loading accounts' : 'Select account'}
              disabled={!settings.branchId || cashAccountsLoading}
              options={selectableCashAccounts.map((account) => ({
                value: account.id,
                label: accountOptionLabel(account),
              }))}
              hint={
                settings.branchId && !cashAccountsLoading && selectableCashAccounts.length === 0
                  ? `${emptyReceiptAccountHint(settings.paymentMethod)} Create or activate it under Finance > Cash Accounts, then re-open this setup.`
                  : undefined
              }
            />
          </div>
        </div>

        <FormTextarea
          label="Notes"
          rows={2}
          value={settings.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
          placeholder="Optional sale notes"
        />
      </div>
    </Modal>
  );
}
