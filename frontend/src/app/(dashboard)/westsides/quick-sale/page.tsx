'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Btn, Card, FormInput, FormSelect, Modal, PageHeader, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

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
  divisionId?: string | null;
  branchId?: string | null;
  isActive?: boolean;
}
interface Unit {
  id: string;
  name: string;
  symbol: string;
}
interface Product {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  defaultUnitId?: string | null;
  sellingPrice?: number | string | null;
  trackInventory?: boolean;
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
  }).format(Number(n ?? 0));
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
  const [units, setUnits] = useState<Unit[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<Product[]>([]);
  const [productSearching, setProductSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
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
    fetch(`/api/backend/cash-accounts?companyId=${cid}&isActive=true&limit=500`)
      .then((r) => r.json())
      .then((j) =>
        setCashAccounts(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      )
      .catch(() => setCashAccounts([]));
    fetch(`/api/backend/customers?companyId=${cid}&limit=500`)
      .then((r) => r.json())
      .then((j) =>
        setCustomers(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      )
      .catch(() => setCustomers([]));
  }, [settings.companyId]);

  // Debounced product search — scoped to the selected division (if any).
  // Backend returns SKUs tagged to the division PLUS company-wide SKUs.
  useEffect(() => {
    if (!settings.companyId || !productQuery.trim()) {
      setProductResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setProductSearching(true);
      try {
        const params = new URLSearchParams({
          companyId: settings.companyId,
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
  }, [productQuery, settings.companyId, settings.divisionId]);

  // ─── Cart actions ───────────────────────────────────────────────────────────

  const addProduct = (p: Product) => {
    if (!settings.branchId) {
      setError('Pick a branch/location in Settings before adding items');
      setSettingsOpen(true);
      return;
    }
    setError('');
    const unit = units.find((u) => u.id === p.defaultUnitId);
    setCart((prev) => {
      const existing = prev.find((c) => c.productId === p.id);
      if (existing) {
        return prev.map((c) => (c.productId === p.id ? { ...c, qty: c.qty + 1 } : c));
      }
      return [
        ...prev,
        {
          productId: p.id,
          productName: p.name,
          sku: p.sku ?? undefined,
          qty: 1,
          unitId: p.defaultUnitId ?? units[0]?.id ?? '',
          unitSymbol: unit?.symbol ?? units[0]?.symbol ?? 'ea',
          unitPrice: Number(p.sellingPrice ?? 0),
        },
      ];
    });
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
  const allowedAccountTypes = useMemo(
    () => accountTypesForPaymentMethod(settings.paymentMethod),
    [settings.paymentMethod],
  );
  const selectableCashAccounts = useMemo(
    () =>
      cashAccounts.filter(
        (account) =>
          account.isActive !== false &&
          allowedAccountTypes.includes(account.accountType) &&
          (account.accountType === 'BANK'
            ? (!account.divisionId || account.divisionId === settings.divisionId) &&
              (!account.branchId || account.branchId === settings.branchId)
            : account.divisionId === settings.divisionId && account.branchId === settings.branchId),
      ),
    [allowedAccountTypes, cashAccounts, settings.branchId, settings.divisionId],
  );

  useEffect(() => {
    if (
      settings.cashAccountId &&
      !selectableCashAccounts.some((account) => account.id === settings.cashAccountId)
    ) {
      setSettings((current) => ({ ...current, cashAccountId: '' }));
    }
  }, [selectableCashAccounts, settings.cashAccountId]);

  // ─── Submit ────────────────────────────────────────────────────────────────

  const canSubmit =
    !!settings.companyId &&
    !!settings.divisionId &&
    !!settings.branchId &&
    !!settings.cashAccountId &&
    cart.length > 0 &&
    cart.every((l) => l.productId && l.qty > 0 && l.unitId);

  const charge = async () => {
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
    if (e.key === 'Enter' && productResults.length > 0) {
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
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                autoFocus
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
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
                  className="absolute z-10 left-0 right-0 mt-1 max-h-72 overflow-y-auto rounded-lg border bg-white shadow-lg"
                  style={{ borderColor: 'var(--aurora-border)' }}
                >
                  {productResults.map((p, idx) => (
                    <li
                      key={p.id}
                      onClick={() => addProduct(p)}
                      className={`px-3 py-2 cursor-pointer hover:bg-slate-100 ${idx === 0 ? 'bg-slate-50' : ''}`}
                    >
                      <div className="font-medium text-sm">{p.name}</div>
                      <div className="text-xs text-slate-500 flex gap-3">
                        {p.sku && <span className="font-mono">{p.sku}</span>}
                        {p.sellingPrice != null && <span>TZS {fmt(p.sellingPrice)}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {productSearching && (
                <div className="absolute right-3 top-3 text-xs text-slate-400">…</div>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              Press <kbd className="px-1 bg-slate-100 rounded">Enter</kbd> to add the first match,{' '}
              <kbd className="px-1 bg-slate-100 rounded">Esc</kbd> to dismiss.
            </p>
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
                {cart.map((l, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="px-3 py-2">
                      <div className="font-medium">{l.productName}</div>
                      {l.sku && <div className="text-[11px] font-mono text-slate-400">{l.sku}</div>}
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
                          className="w-16 text-center border rounded px-1 py-1"
                          style={{ borderColor: 'var(--aurora-border)' }}
                        />
                        <span className="text-xs text-slate-500 ml-1">{l.unitSymbol}</span>
                        <button
                          onClick={() => updateLine(i, { qty: l.qty + 1 })}
                          className="w-7 h-7 rounded border text-slate-600 hover:bg-slate-100 ml-1"
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
                        onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) || 0 })}
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
                ))}
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

          <Btn
            variant="success"
            onClick={charge}
            disabled={!canSubmit || submitting}
            loading={submitting}
            className="w-full text-lg py-4"
          >
            {canSubmit ? `Charge TZS ${fmt(totals.total)}` : 'Add items to charge'}
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
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                companyId: e.target.value,
                branchId: '',
                divisionId: '',
                cashAccountId: '',
              }))
            }
            options={companies.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))}
            placeholder="Select company"
          />
          <FormSelect
            label="Division"
            required
            value={settings.divisionId}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                divisionId: e.target.value,
                branchId: '',
                cashAccountId: '',
              }))
            }
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
            }}
            options={branchOptions.map((b) => ({
              value: b.id,
              label: `${b.code ? b.code + ' - ' : ''}${b.name}`,
            }))}
            placeholder={settings.divisionId ? 'Select branch' : 'Pick division first'}
            disabled={!settings.divisionId}
          />
          <FormSelect
            label="Cash / bank account"
            required
            value={settings.cashAccountId}
            onChange={(e) => setSettings((s) => ({ ...s, cashAccountId: e.target.value }))}
            options={selectableCashAccounts.map((a) => ({
              value: a.id,
              label: `${a.accountName} (${a.accountType})`,
            }))}
            placeholder={
              settings.branchId ? 'Select account' : 'Pick company, division, and branch first'
            }
            disabled={!settings.branchId || selectableCashAccounts.length === 0}
            hint={
              settings.branchId && selectableCashAccounts.length === 0
                ? 'Create an active cash account for this branch under Finance > Cash Accounts.'
                : undefined
            }
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
