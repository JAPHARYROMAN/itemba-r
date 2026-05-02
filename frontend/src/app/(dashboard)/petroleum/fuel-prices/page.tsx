'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';
import { CompanyBranchPicker } from '@/components/petroleum/CompanyBranchPicker';

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
  location?: string | null;
}
interface Product {
  id: string;
  name: string;
  productCode: string;
}

interface FuelPrice {
  id: string;
  companyId: string;
  productId: string;
  branchId?: string | null;
  product?: { id: string; name: string; productCode?: string } | null;
  branch?: { id: string; name: string; code: string; location?: string | null } | null;
  pricePerLitre: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fieldCls =
  'w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const STATUS_CLR: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  EXPIRED: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  INACTIVE: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  DRAFT: 'bg-amber-50 text-amber-700 border-amber-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return (
    <span
      className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {status}
    </span>
  );
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function fmtNum(n: number) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(n);
}

/**
 * EWURA fuel-price cycle helper.
 *
 * Tanzania's EWURA publishes new fuel ceiling prices on the **first Wednesday
 * of every month**. A price that becomes effective on (or after) one cycle's
 * first Wednesday remains valid until the **day before** the *next* cycle's
 * first Wednesday — i.e. the Tuesday immediately preceding next month's first
 * Wednesday.
 *
 * Given an `effectiveFrom` ISO date string (YYYY-MM-DD), return the implied
 * `effectiveTo` (also YYYY-MM-DD) according to this cycle.
 *
 * Worked example: effectiveFrom = 2026-04-01 (Wed) → next month is May 2026,
 * first Wednesday of May 2026 is May 6 → effectiveTo = 2026-05-05 (Tue).
 */
function ewuraEffectiveTo(effectiveFromIso: string): string {
  if (!effectiveFromIso) return '';
  const from = new Date(effectiveFromIso + 'T00:00:00Z');
  if (Number.isNaN(from.getTime())) return '';
  // First day of next month (UTC).
  const nextMonth = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  // 0 = Sun, 1 = Mon, …, 3 = Wed, …, 6 = Sat.
  const dayOfWeek = nextMonth.getUTCDay();
  const offsetToFirstWed = (3 - dayOfWeek + 7) % 7;
  const firstWedOfNextMonth = new Date(nextMonth);
  firstWedOfNextMonth.setUTCDate(nextMonth.getUTCDate() + offsetToFirstWed);
  // The day before is the Tuesday EWURA expiry.
  const expiry = new Date(firstWedOfNextMonth);
  expiry.setUTCDate(firstWedOfNextMonth.getUTCDate() - 1);
  return expiry.toISOString().slice(0, 10);
}

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">{children}</div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">{footer}</div>
      </div>
    </div>
  );
}

// ─── Create / Edit Modal ──────────────────────────────────────────────────────

function PriceModal({
  mode,
  initial,
  companies,
  defaultCompanyId,
  defaultBranchId,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: FuelPrice;
  companies: Company[];
  defaultCompanyId?: string;
  defaultBranchId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [companyId, setCompanyId] = useState(initial?.companyId ?? defaultCompanyId ?? '');
  const [branchId, setBranchId] = useState(initial?.branchId ?? defaultBranchId ?? '');
  const [productId, setProductId] = useState(initial?.productId ?? '');
  const [pricePerLitre, setPricePerLitre] = useState<number | ''>(initial?.pricePerLitre ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState(initial?.effectiveFrom?.slice(0, 10) ?? '');
  const [effectiveTo, setEffectiveTo] = useState(initial?.effectiveTo?.slice(0, 10) ?? '');
  const [autoExpiry, setAutoExpiry] = useState(true);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // When auto-expiry is on, recompute effectiveTo whenever effectiveFrom moves.
  useEffect(() => {
    if (autoExpiry && effectiveFrom) {
      setEffectiveTo(ewuraEffectiveTo(effectiveFrom));
    }
  }, [effectiveFrom, autoExpiry]);

  useEffect(() => {
    if (!companyId) {
      setBranches([]);
      setProducts([]);
      return;
    }
    fetch(`/api/backend/branches?companyId=${companyId}&activeOnly=true`)
      .then((r) => r.json())
      .then((j) => {
        const list: Branch[] = Array.isArray(j.data?.data)
          ? j.data.data
          : Array.isArray(j.data)
            ? j.data
            : [];
        setBranches(list);
        if (branchId && !list.some((b) => b.id === branchId)) setBranchId('');
      })
      .catch(() => setBranches([]));
    fetch(`/api/backend/products?companyId=${companyId}&limit=200`)
      .then((r) => r.json())
      .then((j) =>
        setProducts(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      );
  }, [branchId, companyId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId) {
      setError('Company is required');
      return;
    }
    if (!branchId) {
      setError(
        'Branch / location is required — fuel prices in Tanzania are EWURA-regulated per region',
      );
      return;
    }
    if (!productId) {
      setError('Product is required');
      return;
    }
    if (!pricePerLitre) {
      setError('Price per litre is required');
      return;
    }
    if (!effectiveFrom) {
      setError('Effective-from date is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        companyId,
        branchId,
        productId,
        pricePerLitre: Number(pricePerLitre),
        effectiveFrom,
      };
      if (effectiveTo) body.effectiveTo = effectiveTo;
      const url =
        mode === 'create'
          ? '/api/backend/petroleum/fuel-prices'
          : `/api/backend/petroleum/fuel-prices/${initial!.id}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Save failed');
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error saving');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={mode === 'create' ? 'Set New Fuel Price' : 'Edit Fuel Price'}
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="text-sm text-slate-600 px-4 py-2 rounded-md border border-slate-200 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}
            disabled={saving}
            className="text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-md font-medium"
          >
            {saving ? 'Saving…' : mode === 'create' ? 'Set Price' : 'Save Changes'}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          {mode === 'create'
            ? 'Setting a new price will automatically expire the current active price for the same branch / product. EWURA caps fuel prices per region — pick the branch that matches the regulated location.'
            : 'Editing changes the record in place. To replace a price (and keep history), expire it via Deactivate and create a new one instead.'}
        </p>
        <div>
          <label className={labelCls}>Company *</label>
          <select
            required
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              setBranchId('');
              setProductId('');
            }}
            className={fieldCls}
            disabled={mode === 'edit'}
          >
            <option value="">Select…</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Branch / Location *</label>
          <select
            required
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className={fieldCls}
            disabled={!companyId}
          >
            <option value="">Select branch…</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.code ? ` (${b.code})` : ''}
                {b.location ? ` — ${b.location}` : ''}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-500">
            Each station has its own EWURA-regulated price. Pick the branch this price applies to.
          </p>
        </div>
        <div>
          <label className={labelCls}>Product *</label>
          <select
            required
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className={fieldCls}
            disabled={!companyId}
          >
            <option value="">Select product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.productCode} – {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Price per Litre (TZS) *</label>
            <input
              required
              type="number"
              step="0.0001"
              min="0"
              value={pricePerLitre}
              onChange={(e) =>
                setPricePerLitre(e.target.value === '' ? '' : Number(e.target.value))
              }
              className={fieldCls}
              placeholder="0.0000"
            />
          </div>
          <div>
            <label className={labelCls}>Effective From *</label>
            <input
              required
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className={fieldCls}
            />
          </div>
          <div className="col-span-2">
            <div className="flex items-center justify-between mb-1">
              <label className={labelCls + ' mb-0'}>Effective To</label>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoExpiry}
                  onChange={(e) => {
                    setAutoExpiry(e.target.checked);
                    if (e.target.checked && effectiveFrom)
                      setEffectiveTo(ewuraEffectiveTo(effectiveFrom));
                  }}
                  className="rounded"
                />
                Auto-set to EWURA cycle expiry
              </label>
            </div>
            <input
              type="date"
              value={effectiveTo}
              onChange={(e) => {
                setAutoExpiry(false);
                setEffectiveTo(e.target.value);
              }}
              className={fieldCls}
              placeholder="Optional"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              {autoExpiry
                ? 'Auto-set: Tanzanian fuel prices follow the EWURA monthly cycle — they expire the Tuesday before next month’s first Wednesday. Edit to override.'
                : 'Manual override. Leave blank if you want the system to expire this row only when a newer price is entered.'}
            </p>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Deactivate Confirm ───────────────────────────────────────────────────────

function DeactivateConfirm({
  price,
  onClose,
  onConfirmed,
}: {
  price: FuelPrice;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const handle = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/backend/petroleum/fuel-prices/${price.id}/deactivate`, {
        method: 'PATCH',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Deactivate failed');
      }
      onConfirmed();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };
  return (
    <ModalShell
      title="Deactivate fuel price?"
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="text-sm text-slate-600 px-4 py-2 rounded-md border border-slate-200 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handle}
            disabled={saving}
            className="text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-5 py-2 rounded-md font-medium"
          >
            {saving ? 'Deactivating…' : 'Deactivate'}
          </button>
        </>
      }
    >
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <p className="text-sm text-slate-700">
        Mark this price record as <strong>INACTIVE</strong>? The history is retained for audit but
        the row will no longer be used as the active price.
      </p>
      <p className="text-xs text-slate-500 mt-2">
        {price.product?.name ?? 'Product'} · {price.branch?.name ?? 'Company-wide'} · TZS{' '}
        {fmtNum(price.pricePerLitre)} from {fmtDate(price.effectiveFrom)}
      </p>
    </ModalShell>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FuelPricesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [allBranches, setAllBranches] = useState<Branch[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [prices, setPrices] = useState<FuelPrice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<FuelPrice | null>(null);
  const [deactivating, setDeactivating] = useState<FuelPrice | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) =>
        setCompanies(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      );
  }, []);

  // Page-level lookup tables — used as a fallback when the backend response
  // doesn't embed the product/branch relations (e.g. when the dev server is
  // running stale code without the include clause).
  useEffect(() => {
    if (!companyId) {
      setAllProducts([]);
      setAllBranches([]);
      return;
    }
    fetch(`/api/backend/products?companyId=${companyId}&limit=500`)
      .then((r) => r.json())
      .then((j) =>
        setAllProducts(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      )
      .catch(() => setAllProducts([]));
    fetch(`/api/backend/branches?companyId=${companyId}&activeOnly=false`)
      .then((r) => r.json())
      .then((j) =>
        setAllBranches(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      )
      .catch(() => setAllBranches([]));
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('companyId', companyId);
      if (branchId) params.set('branchId', branchId);
      const res = await fetch(`/api/backend/petroleum/fuel-prices?${params.toString()}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(`HTTP ${res.status}: ${errJson?.message ?? 'Failed to load prices'}`);
      }
      const json = await res.json();
      const list = Array.isArray(json.data?.data)
        ? json.data.data
        : Array.isArray(json.data)
          ? json.data
          : [];
      setPrices(list);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading prices');
    } finally {
      setLoading(false);
    }
  }, [companyId, branchId]);

  useEffect(() => {
    load();
  }, [load]);

  // Resolve product/branch from the embedded relation OR fall back to the
  // page-level lookup table when the relation is missing on the response.
  const resolveProduct = (p: FuelPrice) =>
    p.product ?? allProducts.find((x) => x.id === p.productId) ?? null;
  const resolveBranch = (p: FuelPrice) =>
    p.branch ?? (p.branchId ? (allBranches.find((x) => x.id === p.branchId) ?? null) : null);

  const hasLegacyCompanyWide = prices.some((p) => !p.branchId);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="Fuel Prices"
          subtitle="Branch-scoped price register — each station carries its own EWURA-regulated price per product."
        />
        <button
          onClick={() => setCreating(true)}
          className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium"
        >
          + Set New Price
        </button>
      </div>

      <Card className="p-4">
        <CompanyBranchPicker
          companyId={companyId}
          branchId={branchId}
          onCompanyChange={setCompanyId}
          onBranchChange={setBranchId}
          allBranchesLabel="All branches"
        />
      </Card>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {hasLegacyCompanyWide && !loading && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          <strong>Legacy company-wide prices detected.</strong> Some rows below have no branch
          assigned. Click <em>Edit</em> on each to attach the correct branch (Tanzanian fuel pricing
          is regulated per location, so every price record should be branch-scoped).
        </div>
      )}

      {loading && <Spinner />}

      {!loading && companyId && (
        <Card className="overflow-hidden">
          {prices.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No prices found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>Product</th>
                    <th className={thCls}>Branch / Location</th>
                    <th className={`${thCls} text-right`}>Price / Litre</th>
                    <th className={thCls}>Effective From</th>
                    <th className={thCls}>Effective To</th>
                    <th className={thCls}>Status</th>
                    <th className={`${thCls} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {prices.map((p) => {
                    const product = resolveProduct(p);
                    const branch = resolveBranch(p);
                    return (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className={`${tdCls} font-medium`}>
                          {product ? (
                            <>
                              {product.name}
                              {product.productCode && (
                                <span className="ml-2 text-xs font-mono text-slate-500">
                                  {product.productCode}
                                </span>
                              )}
                            </>
                          ) : p.productId ? (
                            <span className="font-mono text-xs text-slate-500">
                              {p.productId.slice(0, 8)}…
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className={tdCls}>
                          {branch ? (
                            <span>
                              <span className="font-medium">{branch.name}</span>
                              {branch.location && (
                                <span className="ml-1 text-xs text-slate-500">
                                  — {branch.location}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-[11px] font-medium text-amber-800">
                              ⚠ No branch — needs fix
                            </span>
                          )}
                        </td>
                        <td className={`${tdCls} text-right font-mono`}>
                          {fmtNum(p.pricePerLitre)}
                        </td>
                        <td className={tdCls}>{fmtDate(p.effectiveFrom)}</td>
                        <td className={tdCls}>{fmtDate(p.effectiveTo)}</td>
                        <td className={tdCls}>
                          <Badge status={p.status} />
                        </td>
                        <td className={`${tdCls} text-right whitespace-nowrap`}>
                          <button
                            onClick={() => setEditing(p)}
                            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2"
                          >
                            Edit
                          </button>
                          {p.status === 'ACTIVE' && (
                            <button
                              onClick={() => setDeactivating(p)}
                              className="text-xs text-red-600 hover:text-red-800 font-medium px-2"
                            >
                              Deactivate
                            </button>
                          )}
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

      {!companyId && !loading && (
        <div className="text-center py-10 text-sm text-slate-400">
          Select a company to view fuel prices.
        </div>
      )}

      {creating && (
        <PriceModal
          mode="create"
          companies={companies}
          defaultCompanyId={companyId}
          defaultBranchId={branchId}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {editing && (
        <PriceModal
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
      {deactivating && (
        <DeactivateConfirm
          price={deactivating}
          onClose={() => setDeactivating(null)}
          onConfirmed={() => {
            setDeactivating(null);
            load();
          }}
        />
      )}
    </div>
  );
}
