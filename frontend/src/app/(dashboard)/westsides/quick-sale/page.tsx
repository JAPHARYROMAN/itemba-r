'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Btn, Card, FormInput, FormSelect, Modal, PageHeader, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendList } from '@/lib/api-client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company {
  id: string;
  name: string;
  code: string;
}
interface Branch {
  id: string;
  name: string;
  code: string;
  divisionId: string;
}
interface Division {
  id: string;
  name: string;
  code: string;
}
interface CashAccount {
  id: string;
  accountName: string;
  accountType: string;
  currency?: string | null;
  divisionId?: string | null;
  branchId?: string | null;
  isActive?: boolean;
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
  baseUnit?: { name?: string | null; symbol?: string | null } | null;
  defaultUnitId?: string | null;
  defaultPurchasePrice?: number | string | null;
  defaultSellingPrice?: number | string | null;
  retailPrice?: number | string | null;
  wholesalePrice?: number | string | null;
  sellingPrice?: number | string | null;
  effectiveSellingPrice?: number | string | null;
  effectiveRetailPrice?: number | string | null;
  effectiveWholesalePrice?: number | string | null;
  priceSource?: string | null;
  productType?: string | null;
  trackInventory?: boolean | null;
  availableStock?: number | string | null;
  availableQuantity?: number | string | null;
  quantityAvailable?: number | string | null;
  inventoryBalance?: {
    quantityOnHand?: number | string | null;
    quantityReserved?: number | string | null;
    averageCost?: number | string | null;
    availableQuantity?: number | string | null;
    quantityAvailable?: number | string | null;
  } | null;
}
interface Customer {
  id: string;
  name: string;
  customerCode?: string | null;
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
  effectiveCost?: number | null;
}

interface ConfirmedOrder {
  id: string;
  salesOrderNumber: string;
  orderDate: string;
  totalAmount: number | string;
  subtotal: number | string;
  taxAmount: number | string;
  discountAmount: number | string;
  paymentMethod: string;
  paymentReference?: string | null;
  customerName?: string | null;
  customer?: { name: string } | null;
  company?: { name: string; code?: string } | null;
  cashAccount?: { accountName: string } | null;
  lines: Array<{
    description?: string | null;
    quantity: number | string;
    unitPrice: number | string;
    lineTotal: number | string;
    product?: { name: string } | null;
    unit?: { symbol: string } | null;
  }>;
}

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'MOBILE_MONEY', label: 'Mobile Money' },
  { value: 'BANK_CARD', label: 'Bank Card' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
];

function accountTypesForPaymentMethod(method: string) {
  switch (method) {
    case 'CASH':
      return ['CASH_ON_HAND', 'PETTY_CASH'];
    case 'BANK_CARD':
    case 'BANK_TRANSFER':
      return ['BANK'];
    case 'MOBILE_MONEY':
      return ['MOBILE_MONEY'];
    default:
      return [];
  }
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  CASH_ON_HAND: 'Cash on hand',
  PETTY_CASH: 'Petty cash',
  BANK: 'Bank',
  MOBILE_MONEY: 'Mobile money',
  OTHER: 'Other',
};

function accountSelectLabel(method: string) {
  switch (method) {
    case 'CASH':
      return 'Cash account';
    case 'BANK_CARD':
    case 'BANK_TRANSFER':
      return 'Bank account';
    case 'MOBILE_MONEY':
      return 'Mobile money account';
    default:
      return 'Receipt account';
  }
}

function emptyAccountHint(method: string) {
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

const SETTINGS_KEY = 'itemba.quickSale.settings.v1';

interface Settings {
  companyId: string;
  branchId: string;
  divisionId: string;
  cashAccountId: string;
  paymentMethod: string;
}

const blankSettings: Settings = {
  companyId: '',
  branchId: '',
  divisionId: '',
  cashAccountId: '',
  paymentMethod: 'CASH',
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function fmt(n: number | string | undefined | null): string {
  return new Intl.NumberFormat('en-TZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(Number(n ?? 0)) ? Number(n ?? 0) : 0);
}

function fmtQty(n: number | string | undefined | null): string {
  const value = Number(n ?? 0);
  return new Intl.NumberFormat('en-TZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(Number.isFinite(value) ? value : 0);
}

function productCode(product: Product) {
  return product.productCode ?? product.sku ?? product.barcode ?? '';
}

function productPrice(product: Product) {
  return Number(
    product.effectiveSellingPrice ??
      product.sellingPrice ??
      product.defaultSellingPrice ??
      product.effectiveRetailPrice ??
      product.retailPrice ??
      product.effectiveWholesalePrice ??
      product.wholesalePrice ??
      0,
  );
}

function productUnitId(product: Product) {
  return product.defaultUnitId ?? product.baseUnitId ?? '';
}

function productAvailableStock(product: Product | null | undefined) {
  if (!product) return null;
  const value =
    product.availableStock ??
    product.availableQuantity ??
    product.quantityAvailable ??
    product.inventoryBalance?.availableQuantity ??
    product.inventoryBalance?.quantityAvailable;
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function productEffectiveCost(product: Product | null | undefined) {
  if (!product || !itemTracksInventory(product)) return null;
  const averageCost = Number(product.inventoryBalance?.averageCost ?? 0);
  if (Number.isFinite(averageCost) && averageCost > 0) return averageCost;
  const defaultCost = Number(product.defaultPurchasePrice ?? 0);
  return Number.isFinite(defaultCost) && defaultCost > 0 ? defaultCost : null;
}

function itemTracksInventory(item: Product | CartLine | null | undefined) {
  if (!item) return false;
  if (item.trackInventory === false) return false;
  return !['SERVICE', 'NON_STOCK_ITEM'].includes(String(item.productType ?? '').toUpperCase());
}

function getSettingsKey(userId: string): string {
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

function saveSettings(userId: string, s: Settings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getSettingsKey(userId), JSON.stringify(s));
    // eslint-disable-next-line no-restricted-syntax -- persisting the settings cache is best-effort; full/blocked storage must not break the sale flow
  } catch {
    /* storage full / blocked — silently ignore */
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function QuickSalePage() {
  const { user, loading: authLoading } = useAuth();
  const [settings, setSettings] = useState<Settings>(blankSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [cashAccountsLoading, setCashAccountsLoading] = useState(false);
  const [cashAccountsError, setCashAccountsError] = useState('');
  const [units, setUnits] = useState<Unit[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<Product[]>([]);
  const [productSearching, setProductSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [pendingQty, setPendingQty] = useState(1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [walkInName, setWalkInName] = useState('');
  const [paymentReference, setPaymentReference] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState<ConfirmedOrder | null>(null);

  // Hydrate settings from localStorage on mount.
  useEffect(() => {
    if (authLoading) return;
    setSettings(user?.id ? loadSettings(user.id) : blankSettings);
    setHydrated(true);
  }, [authLoading, user?.id]);

  // Save settings whenever they change post-hydration.
  useEffect(() => {
    if (hydrated && user?.id) saveSettings(user.id, settings);
  }, [settings, hydrated, user?.id]);

  // Open the settings drawer if anything's missing on first render.
  useEffect(() => {
    if (!hydrated) return;
    if (!settings.companyId || !settings.branchId || !settings.cashAccountId) {
      setSettingsOpen(true);
    }
  }, [hydrated, settings.companyId, settings.branchId, settings.cashAccountId]);

  // Load companies + units once.
  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) =>
        setCompanies(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      )
      .catch(() => setCompanies([]));
    fetch('/api/backend/units?limit=200')
      .then((r) => r.json())
      .then((j) =>
        setUnits(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []),
      )
      .catch(() => setUnits([]));
  }, []);

  // Reload branch / division / location / cashAccount / customer lists when company changes.
  useEffect(() => {
    if (!settings.companyId) {
      setBranches([]);
      setDivisions([]);
      setCashAccounts([]);
      setCashAccountsError('');
      setCustomers([]);
      return;
    }
    const cid = settings.companyId;
    fetch(`/api/backend/branches?companyId=${cid}&limit=200`)
      .then((r) => r.json())
      .then((j) =>
        setBranches(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      )
      .catch(() => setBranches([]));
    fetch(`/api/backend/divisions?companyId=${cid}&limit=200`)
      .then((r) => r.json())
      .then((j) =>
        setDivisions(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      )
      .catch(() => setDivisions([]));
    fetch(`/api/backend/customers?companyId=${cid}&limit=500`)
      .then((r) => r.json())
      .then((j) =>
        setCustomers(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      )
      .catch(() => setCustomers([]));
  }, [settings.companyId]);

  // Receipt account lookup is intentionally scoped to sales.create, not the
  // finance cash-account permission, so counter users can select a valid
  // receipt account without full Finance > Cash Accounts access.
  useEffect(() => {
    if (!settings.companyId || !settings.divisionId || !settings.branchId) {
      setCashAccounts([]);
      setCashAccountsError('');
      setCashAccountsLoading(false);
      return;
    }

    let cancelled = false;
    setCashAccountsLoading(true);
    setCashAccountsError('');
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
        if (!cancelled) setCashAccounts(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setCashAccounts([]);
          setCashAccountsError(
            err instanceof Error ? err.message : 'Could not load receipt accounts',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setCashAccountsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [settings.branchId, settings.companyId, settings.divisionId, settings.paymentMethod]);

  // Debounced product search — scoped to the selected division (if any).
  // Backend returns SKUs tagged to the division PLUS company-wide SKUs.
  useEffect(() => {
    if (selectedProduct && productQuery.trim() === selectedProduct.name) {
      setProductResults([]);
      setShowResults(false);
      return;
    }
    if (!settings.companyId || !settings.branchId || !productQuery.trim()) {
      setProductResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setProductSearching(true);
      try {
        const params = new URLSearchParams({
          companyId: settings.companyId,
          branchId: settings.branchId,
          search: productQuery.trim(),
          limit: '10',
        });
        if (settings.divisionId) params.set('divisionId', settings.divisionId);
        const res = await fetch(`/api/backend/products?${params}`, { signal: ctrl.signal });
        const j = await res.json();
        const list: Product[] = Array.isArray(j.data?.data)
          ? j.data.data
          : Array.isArray(j.data)
            ? j.data
            : [];
        setProductResults(list);
        setShowResults(true);
      } catch {
        setProductResults([]);
      } finally {
        setProductSearching(false);
      }
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [productQuery, selectedProduct, settings.branchId, settings.companyId, settings.divisionId]);

  // ─── Cart actions ───────────────────────────────────────────────────────────

  const cartAllocatedByProduct = useMemo(() => {
    const allocated = new Map<string, number>();
    for (const line of cart) {
      allocated.set(line.productId, (allocated.get(line.productId) ?? 0) + (Number(line.qty) || 0));
    }
    return allocated;
  }, [cart]);

  const selectedAvailableBeforeAdd =
    selectedProduct && productAvailableStock(selectedProduct) != null
      ? (productAvailableStock(selectedProduct) ?? 0) -
        (cartAllocatedByProduct.get(selectedProduct.id) ?? 0)
      : null;
  const selectedRemainingAfterAdd =
    selectedAvailableBeforeAdd == null
      ? null
      : selectedAvailableBeforeAdd - (Number(pendingQty) || 0);
  const selectedProductStockBlocked = Boolean(
    selectedProduct &&
    itemTracksInventory(selectedProduct) &&
    selectedAvailableBeforeAdd != null &&
    Number(pendingQty || 0) > selectedAvailableBeforeAdd,
  );

  const cartStockIssues = useMemo(() => {
    const issues: string[] = [];
    const seen = new Set<string>();
    for (const line of cart) {
      if (seen.has(line.productId) || !itemTracksInventory(line)) continue;
      seen.add(line.productId);
      if (line.availableStock == null) continue;
      const allocated = cartAllocatedByProduct.get(line.productId) ?? 0;
      if (allocated > line.availableStock) {
        issues.push(
          `${line.productName} only has ${fmtQty(line.availableStock)} available; cart uses ${fmtQty(allocated)}.`,
        );
      }
    }
    return issues;
  }, [cart, cartAllocatedByProduct]);
  const cartProfitIssues = useMemo(() => {
    const issues: string[] = [];
    for (const line of cart) {
      if (!itemTracksInventory(line)) continue;
      const cost = line.effectiveCost ?? null;
      if (cost == null || cost <= 0) {
        issues.push(`${line.productName} is missing purchase/average cost and cannot be sold.`);
        continue;
      }
      if (line.unitPrice <= cost) {
        issues.push(
          `${line.productName} price TZS ${fmt(line.unitPrice)} must be greater than cost TZS ${fmt(cost)}.`,
        );
      }
    }
    return issues;
  }, [cart]);

  const addProduct = (p: Product, quantity = pendingQty) => {
    if (!settings.branchId) {
      setError('Pick a branch/location in Settings before adding items');
      setSettingsOpen(true);
      return;
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Enter a quantity greater than zero before adding the item');
      return;
    }
    const available = productAvailableStock(p);
    const alreadyAllocated = cartAllocatedByProduct.get(p.id) ?? 0;
    const availableForThisAdd = available == null ? null : available - alreadyAllocated;
    if (itemTracksInventory(p) && availableForThisAdd != null && qty > availableForThisAdd) {
      setError(
        `${p.name} only has ${fmtQty(Math.max(0, availableForThisAdd))} available for this branch.`,
      );
      return;
    }
    const effectiveCost = productEffectiveCost(p);
    const unitPrice = productPrice(p);
    if (itemTracksInventory(p) && (effectiveCost == null || effectiveCost <= 0)) {
      setError(`${p.name} is missing purchase/average cost and cannot be sold.`);
      return;
    }
    if (itemTracksInventory(p) && effectiveCost != null && unitPrice <= effectiveCost) {
      setError(
        `${p.name} price TZS ${fmt(unitPrice)} must be greater than cost TZS ${fmt(effectiveCost)}.`,
      );
      return;
    }
    setError('');
    const unitId = productUnitId(p);
    const unit = units.find((u) => u.id === unitId);
    setCart((prev) => {
      const existing = prev.find((c) => c.productId === p.id);
      if (existing) {
        return prev.map((c) =>
          c.productId === p.id
            ? {
                ...c,
                qty: c.qty + qty,
                trackInventory: p.trackInventory,
                productType: p.productType,
                availableStock: available,
                effectiveCost,
              }
            : c,
        );
      }
      return [
        ...prev,
        {
          productId: p.id,
          productName: p.name,
          sku: productCode(p) || undefined,
          qty,
          unitId: unitId || units[0]?.id || '',
          unitSymbol: p.baseUnit?.symbol ?? unit?.symbol ?? units[0]?.symbol ?? 'ea',
          unitPrice,
          trackInventory: p.trackInventory,
          productType: p.productType,
          availableStock: available,
          effectiveCost,
        },
      ];
    });
    setSelectedProduct(null);
    setPendingQty(1);
    setProductQuery('');
    setProductResults([]);
    setShowResults(false);
    searchInputRef.current?.focus();
  };

  const updateLine = (i: number, patch: Partial<CartLine>) =>
    setCart((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const removeLine = (i: number) => setCart((prev) => prev.filter((_, idx) => idx !== i));

  const totals = useMemo(() => {
    const subtotal = cart.reduce(
      (s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0),
      0,
    );
    return { subtotal, total: subtotal };
  }, [cart]);

  const branchOptions = useMemo(
    () =>
      settings.divisionId
        ? branches.filter((branch) => branch.divisionId === settings.divisionId)
        : [],
    [branches, settings.divisionId],
  );
  const selectedBranch = useMemo(
    () => branches.find((branch) => branch.id === settings.branchId) ?? null,
    [branches, settings.branchId],
  );
  const allowedAccountTypes = useMemo(
    () => accountTypesForPaymentMethod(settings.paymentMethod),
    [settings.paymentMethod],
  );
  const selectableCashAccounts = useMemo(
    () =>
      sortReceiptAccounts(
        cashAccounts.filter(
          (account) =>
            account.isActive !== false && allowedAccountTypes.includes(account.accountType),
        ),
        selectedBranch,
      ),
    [allowedAccountTypes, cashAccounts, selectedBranch],
  );

  useEffect(() => {
    if (
      settings.cashAccountId &&
      !selectableCashAccounts.some((account) => account.id === settings.cashAccountId)
    ) {
      setSettings((current) => ({ ...current, cashAccountId: '' }));
      return;
    }
    if (!settings.cashAccountId && selectableCashAccounts.length > 0) {
      setSettings((current) => ({
        ...current,
        cashAccountId: selectableCashAccounts[0]!.id,
      }));
    }
  }, [selectableCashAccounts, settings.cashAccountId]);

  // ─── Submit ────────────────────────────────────────────────────────────────

  const canSubmit =
    !!settings.companyId &&
    !!settings.divisionId &&
    !!settings.branchId &&
    !!settings.cashAccountId &&
    cart.length > 0 &&
    cart.every((l) => l.productId && l.qty > 0 && l.unitId) &&
    cartStockIssues.length === 0 &&
    cartProfitIssues.length === 0;

  const charge = async () => {
    if (submitting) return;
    if (cartStockIssues.length) {
      setError(cartStockIssues[0]);
      return;
    }
    if (cartProfitIssues.length) {
      setError(cartProfitIssues[0]);
      return;
    }
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const body = {
        companyId: settings.companyId,
        divisionId: settings.divisionId,
        branchId: settings.branchId,
        salesType: 'CASH_SALE',
        orderDate: new Date().toISOString(),
        currency: 'TZS',
        paymentMethod: settings.paymentMethod,
        cashAccountId: settings.cashAccountId,
        ...(paymentReference ? { paymentReference } : {}),
        ...(customerId ? { customerId } : { customerName: walkInName.trim() || 'Walk-in' }),
        lines: cart.map((l) => ({
          productId: l.productId,
          quantity: l.qty,
          unitId: l.unitId,
          unitPrice: l.unitPrice,
          discountAmount: 0,
          taxAmount: 0,
        })),
      };
      const res = await fetch('/api/backend/sales-orders/quick-sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? `HTTP ${res.status}`),
        );
      }
      const j = await res.json();
      setConfirmed(j.data ?? j);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Charge failed');
    } finally {
      setSubmitting(false);
    }
  };

  const startNew = () => {
    setConfirmed(null);
    setCart([]);
    setCustomerId('');
    setWalkInName('');
    setPaymentReference('');
    setError('');
    searchInputRef.current?.focus();
  };

  // Settings labels for the sticky header.
  const branchName = branches.find((b) => b.id === settings.branchId)?.name;
  const divisionName = divisions.find((d) => d.id === settings.divisionId)?.name;
  const cashAccountName = cashAccounts.find((a) => a.id === settings.cashAccountId)?.accountName;
  const companyName = companies.find((c) => c.id === settings.companyId)?.name;
  const settingsReady = !!(
    settings.companyId &&
    settings.divisionId &&
    settings.branchId &&
    settings.cashAccountId
  );

  // ─── Keyboard helpers ──────────────────────────────────────────────────────

  const handleSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && selectedProduct) {
      e.preventDefault();
      addProduct(selectedProduct);
    } else if (e.key === 'Enter' && productResults.length > 0) {
      e.preventDefault();
      addProduct(productResults[0]);
    } else if (e.key === 'Escape') {
      setShowResults(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!hydrated) return <PageSpinner />;

  return (
    <div className="p-6 quick-sale-page">
      <PageHeader title="Quick Sale" subtitle="Counter-sale flow — scan, charge, print receipt." />

      {/* Sticky settings strip */}
      <Card className="p-3 mb-4 flex flex-wrap items-center gap-3 text-sm">
        <div className="flex-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          <SettingChip label="Company" value={companyName} />
          <SettingChip label="Branch" value={branchName} />
          <SettingChip label="Division" value={divisionName ?? 'All'} />
          <SettingChip label="Stock from" value={branchName} />
          <SettingChip label="Pay to" value={cashAccountName} />
          <SettingChip label="Method" value={settings.paymentMethod} />
        </div>
        <Btn variant="secondary" size="xs" onClick={() => setSettingsOpen(true)}>
          Settings
        </Btn>
      </Card>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* LEFT: search + cart */}
        <div className="lg:col-span-3 space-y-4">
          <Card className="p-4">
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">
              Add product (name, SKU, or scan barcode)
            </label>
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_7rem_8rem]">
              <div className="relative">
                <input
                  ref={searchInputRef}
                  type="text"
                  autoFocus
                  value={productQuery}
                  onChange={(e) => {
                    setProductQuery(e.target.value);
                    setSelectedProduct(null);
                  }}
                  onKeyDown={handleSearchKey}
                  onFocus={() => productResults.length > 0 && setShowResults(true)}
                  disabled={!settingsReady}
                  placeholder={settingsReady ? 'Start typing…' : 'Pick settings first'}
                  className="w-full text-base border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  style={{
                    borderColor: 'var(--aurora-border)',
                    background: 'var(--aurora-card)',
                    color: 'var(--aurora-text)',
                  }}
                />
                {showResults && productResults.length > 0 && (
                  <ul
                    className="absolute z-10 left-0 right-0 mt-1 max-h-72 overflow-y-auto rounded-lg border shadow-lg"
                    style={{
                      borderColor: 'var(--aurora-border)',
                      background: 'var(--aurora-card)',
                    }}
                  >
                    {productResults.map((p, idx) => {
                      const available = productAvailableStock(p);
                      const locallyAvailable =
                        available == null
                          ? null
                          : available - (cartAllocatedByProduct.get(p.id) ?? 0);
                      const unit = p.baseUnit?.symbol ?? p.baseUnit?.name;
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              setSelectedProduct(p);
                              setProductQuery(p.name);
                              setProductResults([]);
                              setShowResults(false);
                              searchInputRef.current?.focus();
                            }}
                            className={`w-full px-3 py-2 text-left hover:bg-white/10 ${idx === 0 ? 'bg-white/5' : ''}`}
                          >
                            <div className="font-medium text-sm">{p.name}</div>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                              {productCode(p) && (
                                <span className="font-mono">{productCode(p)}</span>
                              )}
                              {unit && <span>Unit: {unit}</span>}
                              <span>TZS {fmt(productPrice(p))}</span>
                              {itemTracksInventory(p) && locallyAvailable != null && (
                                <span
                                  className={
                                    locallyAvailable <= 0 ? 'text-red-500' : 'text-emerald-500'
                                  }
                                >
                                  Available: {fmtQty(Math.max(0, locallyAvailable))}
                                </span>
                              )}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {productSearching && (
                  <div className="absolute right-3 top-3 text-xs text-slate-400">…</div>
                )}
              </div>
              <input
                type="number"
                min="0.001"
                step="any"
                value={pendingQty}
                onChange={(event) => setPendingQty(Number(event.target.value) || 0)}
                disabled={!settingsReady}
                className="w-full text-base border rounded-lg px-3 py-2.5 text-right focus:outline-none focus:ring-2 focus:ring-brand-500"
                style={{
                  borderColor: 'var(--aurora-border)',
                  background: 'var(--aurora-card)',
                  color: 'var(--aurora-text)',
                }}
                aria-label="Quantity to add"
              />
              <Btn
                variant="primary"
                onClick={() => selectedProduct && addProduct(selectedProduct)}
                disabled={
                  !settingsReady ||
                  !selectedProduct ||
                  pendingQty <= 0 ||
                  selectedProductStockBlocked
                }
                className="h-[46px]"
              >
                Add Item
              </Btn>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              Select a product, set quantity, then add it. Repeat for every item in the sale. Press{' '}
              <kbd className="px-1 bg-slate-100 rounded">Enter</kbd> to add the selected or first
              match.
            </p>
            {selectedProduct && (
              <div
                className="mt-3 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <span className="text-slate-500">Selected: </span>
                <span className="font-semibold">{selectedProduct.name}</span>
                {productCode(selectedProduct) && (
                  <span className="ml-2 font-mono text-xs text-slate-500">
                    {productCode(selectedProduct)}
                  </span>
                )}
                <span className="ml-2 text-slate-500">
                  Price TZS {fmt(productPrice(selectedProduct))}
                </span>
                {itemTracksInventory(selectedProduct) && (
                  <span
                    className={`ml-2 ${selectedProductStockBlocked ? 'text-red-600' : 'text-emerald-600'}`}
                  >
                    Available {fmtQty(Math.max(0, selectedAvailableBeforeAdd ?? 0))}; remaining{' '}
                    {fmtQty(selectedRemainingAfterAdd ?? 0)}
                  </span>
                )}
              </div>
            )}
            {selectedProductStockBlocked && selectedProduct && (
              <p className="mt-2 text-xs text-red-600">
                {selectedProduct.name} only has{' '}
                {fmtQty(Math.max(0, selectedAvailableBeforeAdd ?? 0))} available for this branch.
              </p>
            )}
          </Card>

          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Item
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">
                    Qty
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">
                    Price
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">
                    Total
                  </th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {cart.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-sm text-slate-400 italic">
                      No items yet — search above to add
                    </td>
                  </tr>
                )}
                {cart.map((l, i) => {
                  const allocated = cartAllocatedByProduct.get(l.productId) ?? 0;
                  const remaining = l.availableStock == null ? null : l.availableStock - allocated;
                  const hasStockIssue =
                    itemTracksInventory(l) &&
                    l.availableStock != null &&
                    allocated > l.availableStock;
                  const hasProfitIssue =
                    itemTracksInventory(l) &&
                    (l.effectiveCost == null ||
                      l.effectiveCost <= 0 ||
                      l.unitPrice <= l.effectiveCost);
                  const canIncrease =
                    !itemTracksInventory(l) ||
                    l.availableStock == null ||
                    remaining == null ||
                    remaining >= 1;
                  return (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="px-3 py-2">
                        <div className="font-medium">{l.productName}</div>
                        {l.sku && (
                          <div className="text-[11px] font-mono text-slate-400">{l.sku}</div>
                        )}
                        {itemTracksInventory(l) && (
                          <div
                            className={`text-[11px] ${hasStockIssue ? 'text-red-600' : 'text-slate-500'}`}
                          >
                            Available {fmtQty(l.availableStock)} | Remaining{' '}
                            {fmtQty(remaining ?? 0)}
                          </div>
                        )}
                        {itemTracksInventory(l) && (
                          <div
                            className={`text-[11px] ${hasProfitIssue ? 'text-red-600' : 'text-slate-500'}`}
                          >
                            Cost{' '}
                            {l.effectiveCost != null && l.effectiveCost > 0
                              ? `TZS ${fmt(l.effectiveCost)}`
                              : 'missing'}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => updateLine(i, { qty: Math.max(0.001, l.qty - 1) })}
                            className="w-7 h-7 rounded border text-slate-600 hover:bg-slate-100"
                            style={{ borderColor: 'var(--aurora-border)' }}
                          >
                            −
                          </button>
                          <input
                            type="number"
                            value={l.qty}
                            step="any"
                            min="0.001"
                            onChange={(e) => updateLine(i, { qty: Number(e.target.value) || 0 })}
                            className={`w-16 rounded border px-1 py-1 text-center ${
                              hasStockIssue ? 'border-red-400 text-red-600' : ''
                            }`}
                            style={{
                              borderColor: hasStockIssue ? undefined : 'var(--aurora-border)',
                            }}
                          />
                          <span className="text-xs text-slate-500 ml-1">{l.unitSymbol}</span>
                          <button
                            onClick={() => canIncrease && updateLine(i, { qty: l.qty + 1 })}
                            disabled={!canIncrease}
                            className="w-7 h-7 rounded border text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 ml-1"
                            style={{ borderColor: 'var(--aurora-border)' }}
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          value={l.unitPrice}
                          step="any"
                          min="0"
                          onChange={(e) =>
                            updateLine(i, { unitPrice: Number(e.target.value) || 0 })
                          }
                          className="w-24 text-right border rounded px-2 py-1 tabular-nums"
                          style={{ borderColor: 'var(--aurora-border)' }}
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">
                        {fmt(l.qty * l.unitPrice)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => removeLine(i)}
                          className="text-slate-400 hover:text-red-600 text-lg leading-none"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>

        {/* RIGHT: customer + payment + charge */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-4 space-y-3">
            <div>
              <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">
                Customer
              </label>
              <FormSelect
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                placeholder="Walk-in"
                options={customers.map((c) => ({
                  value: c.id,
                  label: c.customerCode ? `${c.name} — ${c.customerCode}` : c.name,
                }))}
              />
            </div>
            {!customerId && (
              <FormInput
                label="Walk-in name (optional)"
                value={walkInName}
                onChange={(e) => setWalkInName(e.target.value)}
                placeholder="—"
              />
            )}
            {settings.paymentMethod !== 'CASH' && (
              <FormInput
                label="Payment reference"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                placeholder="M-Pesa code, slip #"
              />
            )}
          </Card>

          <Card className="p-4 space-y-2 text-sm">
            <Row label="Subtotal" value={`TZS ${fmt(totals.subtotal)}`} />
            <Row label="Tax" value="TZS 0.00" muted />
            <Row label="Discount" value="TZS 0.00" muted />
            <div className="border-t pt-2 mt-2 border-slate-200" />
            <Row label="Total" value={`TZS ${fmt(totals.total)}`} highlight />
          </Card>

          {cartStockIssues.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {cartStockIssues[0]}
            </div>
          )}
          {cartProfitIssues.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {cartProfitIssues[0]}
            </div>
          )}

          <Btn
            variant="success"
            onClick={charge}
            disabled={!canSubmit || submitting}
            loading={submitting}
            className="w-full text-lg py-4"
          >
            {cartStockIssues.length
              ? 'Resolve stock before charging'
              : cartProfitIssues.length
                ? 'Resolve profit before charging'
              : canSubmit
                ? `Charge TZS ${fmt(totals.total)}`
                : 'Add items to charge'}
          </Btn>
        </div>
      </div>

      {/* Settings drawer */}
      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Quick Sale settings"
        footer={
          <Btn variant="primary" onClick={() => setSettingsOpen(false)} disabled={!settingsReady}>
            {settingsReady ? 'Done' : 'Fill all fields'}
          </Btn>
        }
      >
        <div className="space-y-3">
          <FormSelect
            label="Company"
            required
            value={settings.companyId}
            onChange={(e) => {
              setSettings((s) => ({
                ...s,
                companyId: e.target.value,
                branchId: '',
                divisionId: '',
                cashAccountId: '',
              }));
              setCart([]);
              setSelectedProduct(null);
              setProductQuery('');
              setProductResults([]);
              setShowResults(false);
            }}
            options={companies.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))}
            placeholder="Select company"
          />
          <FormSelect
            label="Division"
            required
            value={settings.divisionId}
            onChange={(e) => {
              setSettings((s) => ({
                ...s,
                divisionId: e.target.value,
                branchId: '',
                cashAccountId: '',
              }));
              setCart([]);
              setSelectedProduct(null);
              setProductQuery('');
              setProductResults([]);
              setShowResults(false);
            }}
            options={divisions.map((d) => ({
              value: d.id,
              label: `${d.code ? d.code + ' - ' : ''}${d.name}`,
            }))}
            placeholder={settings.companyId ? 'Select division' : 'Pick company first'}
            hint="This scopes product search, stock, and branch cash handling."
          />
          <FormSelect
            label="Branch"
            required
            value={settings.branchId}
            onChange={(e) => {
              const branch = branches.find((b) => b.id === e.target.value);
              setSettings((s) => ({
                ...s,
                branchId: e.target.value,
                divisionId: branch?.divisionId ?? s.divisionId,
                cashAccountId: '',
              }));
              setCart([]);
              setSelectedProduct(null);
              setProductQuery('');
              setProductResults([]);
              setShowResults(false);
            }}
            options={branchOptions.map((b) => ({
              value: b.id,
              label: `${b.code ? b.code + ' - ' : ''}${b.name}`,
            }))}
            placeholder={settings.divisionId ? 'Select branch' : 'Pick division first'}
            disabled={!settings.divisionId}
          />
          <FormSelect
            label="Default payment method"
            value={settings.paymentMethod}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                paymentMethod: e.target.value,
                cashAccountId: '',
              }))
            }
            options={PAYMENT_METHODS}
          />
          <FormSelect
            label={accountSelectLabel(settings.paymentMethod)}
            required
            value={settings.cashAccountId}
            onChange={(e) => setSettings((s) => ({ ...s, cashAccountId: e.target.value }))}
            options={selectableCashAccounts.map((a) => ({
              value: a.id,
              label: accountOptionLabel(a),
            }))}
            placeholder={
              !settings.companyId
                ? 'Pick company first'
                : !settings.divisionId
                  ? 'Pick division first'
                  : !settings.branchId
                    ? 'Pick branch first'
                    : cashAccountsLoading
                      ? 'Loading accounts...'
                      : `Select ${accountSelectLabel(settings.paymentMethod).toLowerCase()}`
            }
            disabled={
              !settings.branchId || cashAccountsLoading || selectableCashAccounts.length === 0
            }
            hint={
              cashAccountsError
                ? cashAccountsError
                : cashAccountsLoading
                  ? 'Loading receipt accounts for the selected branch and payment method.'
                  : settings.branchId && selectableCashAccounts.length === 0
                    ? `${emptyAccountHint(settings.paymentMethod)} ${
                        ['BANK_CARD', 'BANK_TRANSFER'].includes(settings.paymentMethod)
                          ? 'Create or activate a bank receipt account, or choose Cash/Mobile Money.'
                          : 'Create or activate it under Finance > Cash Accounts, or change the payment method if this sale should go to bank/mobile money.'
                      }`
                    : undefined
            }
          />
          <p className="text-xs text-slate-500">
            These settings are saved on this device. Change them anytime.
          </p>
        </div>
      </Modal>

      {/* Receipt */}
      {confirmed && (
        <Modal
          open
          onClose={startNew}
          title="Sale completed"
          size="md"
          footer={
            <>
              <Btn variant="secondary" onClick={startNew}>
                New Sale
              </Btn>
              <Btn variant="primary" onClick={() => window.print()}>
                Print Receipt
              </Btn>
            </>
          }
        >
          <Receipt order={confirmed} cashier={user?.fullName ?? user?.email} />
        </Modal>
      )}

      {/* Print-only CSS: hide everything outside the receipt; isolate the
          receipt body so printers render a clean page. */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          .quick-sale-receipt,
          .quick-sale-receipt * {
            visibility: visible !important;
          }
          .quick-sale-receipt {
            position: absolute !important;
            left: 0;
            top: 0;
            width: 100%;
            padding: 24px;
            background: white;
            color: black;
            font-family: 'Courier New', monospace;
          }
        }
      `}</style>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function Row({
  label,
  value,
  highlight,
  muted,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between ${highlight ? 'text-lg font-bold' : muted ? 'text-slate-500' : ''}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function SettingChip({ label, value }: { label: string; value?: string }) {
  return (
    <div className="text-xs">
      <span className="text-slate-500">{label}: </span>
      <span className={`font-medium ${value ? '' : 'text-amber-600 italic'}`}>
        {value ?? '— set me —'}
      </span>
    </div>
  );
}

function Receipt({ order, cashier }: { order: ConfirmedOrder; cashier?: string }) {
  return (
    <div className="quick-sale-receipt text-sm">
      <div className="text-center mb-3">
        <div className="text-base font-bold uppercase">{order.company?.name ?? 'Westsides'}</div>
        <div className="text-xs text-slate-500">
          {new Date(order.orderDate).toLocaleString('en-GB')}
        </div>
      </div>
      <div className="border-t border-b border-slate-300 py-2 my-2 text-xs">
        <div className="flex justify-between">
          <span>Sale #</span>
          <span className="font-mono">{order.salesOrderNumber}</span>
        </div>
        <div className="flex justify-between">
          <span>Customer</span>
          <span>{order.customer?.name ?? order.customerName ?? 'Walk-in'}</span>
        </div>
        {cashier && (
          <div className="flex justify-between">
            <span>Cashier</span>
            <span>{cashier}</span>
          </div>
        )}
      </div>
      <table className="w-full text-xs my-2">
        <thead>
          <tr className="border-b border-slate-300">
            <th className="text-left pb-1">Item</th>
            <th className="text-right pb-1">Qty</th>
            <th className="text-right pb-1">Price</th>
            <th className="text-right pb-1">Total</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l, i) => (
            <tr key={i}>
              <td className="py-0.5">{l.product?.name ?? l.description ?? '—'}</td>
              <td className="text-right py-0.5">
                {Number(l.quantity)} {l.unit?.symbol ?? ''}
              </td>
              <td className="text-right py-0.5 tabular-nums">{fmt(l.unitPrice)}</td>
              <td className="text-right py-0.5 tabular-nums">{fmt(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-slate-300 pt-2 mt-2 space-y-1 text-xs">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span className="tabular-nums">TZS {fmt(order.subtotal)}</span>
        </div>
        {Number(order.taxAmount) > 0 && (
          <div className="flex justify-between">
            <span>Tax</span>
            <span className="tabular-nums">TZS {fmt(order.taxAmount)}</span>
          </div>
        )}
        {Number(order.discountAmount) > 0 && (
          <div className="flex justify-between">
            <span>Discount</span>
            <span className="tabular-nums">−TZS {fmt(order.discountAmount)}</span>
          </div>
        )}
        <div className="flex justify-between text-base font-bold pt-1">
          <span>TOTAL</span>
          <span className="tabular-nums">TZS {fmt(order.totalAmount)}</span>
        </div>
      </div>
      <div className="text-center text-xs mt-4 text-slate-500">
        Paid by {order.paymentMethod}
        {order.paymentReference ? ` (${order.paymentReference})` : ''} —{' '}
        {order.cashAccount?.accountName ?? ''}
      </div>
      <div className="text-center text-xs mt-3 italic">Thank you for your business.</div>
    </div>
  );
}
