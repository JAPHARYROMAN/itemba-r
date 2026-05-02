'use client';

import { useEffect, useMemo, useState } from 'react';
import { Btn, Card, FormInput, FormSelect, PageHeader, PageSpinner } from '@/components/ui';

interface Company { id: string; name: string; code: string }
interface Branch { id: string; name: string; code: string; companyId: string }
interface Product { id: string; name: string; productCode: string }

interface PreviewProduct {
  productId: string;
  productName: string;
  litres: number;
  rate: number;
  amount: number;
}

interface PreviewRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  branchId: string | null;
  branchName: string | null;
  byProduct: PreviewProduct[];
  totalLitres: number;
  totalAmount: number;
}

interface PreviewResult {
  filter: { companyId: string; branchId?: string; periodStart: string; periodEnd: string };
  totals: { attendants: number; totalLitres: number; totalAmount: number; unattributedLitres: number; unattributedAmount: number };
  rows: PreviewRow[];
  committed?: { created: number; updated: number; skipped: number; totalAmount: number };
}

function fmt(n: number, dp = 2): string {
  return new Intl.NumberFormat('en-TZ', { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n);
}

export default function PetroleumCommissionsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [fuelProducts, setFuelProducts] = useState<Product[]>([]);

  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [periodStart, setPeriodStart] = useState(monthStart);
  const [periodEnd, setPeriodEnd] = useState(monthEnd);
  const [rates, setRates] = useState<Record<string, string>>({});

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Load companies
  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json())
      .then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []))
      .catch(() => setCompanies([]));
  }, []);

  // Load branches + fuel products when company changes
  useEffect(() => {
    if (!companyId) { setBranches([]); setFuelProducts([]); return; }
    fetch(`/api/backend/branches?companyId=${companyId}&limit=200`).then(r => r.json())
      .then(j => setBranches(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []))
      .catch(() => setBranches([]));
    // Load only fuel-products (assumes operators tag fuel products with one of these category names)
    fetch(`/api/backend/products?companyId=${companyId}&limit=200`).then(r => r.json())
      .then(j => {
        const all: Product[] = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
        // Filter heuristically by name — operators can adjust per-product rate manually anyway.
        const fuel = all.filter(p => /diesel|petrol|kerosene|fuel|jet/i.test(p.name));
        setFuelProducts(fuel.length > 0 ? fuel : all);
      })
      .catch(() => setFuelProducts([]));
  }, [companyId]);

  const ratesByProductId = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [pid, val] of Object.entries(rates)) {
      const v = Number(val);
      if (Number.isFinite(v) && v > 0) out[pid] = v;
    }
    return out;
  }, [rates]);

  const handlePreview = async () => {
    setError(''); setSuccess(''); setPreview(null);
    if (!companyId) { setError('Pick a company'); return; }
    if (Object.keys(ratesByProductId).length === 0) { setError('Set at least one product rate'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/backend/hr/petroleum-commissions/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          ...(branchId ? { branchId } : {}),
          periodStart,
          periodEnd,
          ratesByProductId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? 'Preview failed'));
      }
      const j = await res.json();
      setPreview(j.data ?? j);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!preview) return;
    if (!confirm(`Create / update ${preview.totals.attendants} commission allowances for the period? Total: TZS ${fmt(preview.totals.totalAmount)}`)) return;
    setError(''); setSuccess(''); setCommitting(true);
    try {
      const res = await fetch('/api/backend/hr/petroleum-commissions/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          ...(branchId ? { branchId } : {}),
          periodStart,
          periodEnd,
          ratesByProductId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? 'Commit failed'));
      }
      const j = await res.json();
      const result: PreviewResult = j.data ?? j;
      setPreview(result);
      const c = result.committed!;
      setSuccess(`Committed: ${c.created} new, ${c.updated} updated, ${c.skipped} skipped (TZS ${fmt(c.totalAmount)}). Allowances are now picked up by the next payroll calculation.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Petroleum Commissions"
        subtitle="Pump-attendant performance commission — converts litres dispensed into payroll allowances by per-product rate."
        breadcrumbs={[{ label: 'HR', href: '/hr' }, { label: 'Petroleum Commissions' }]}
      />

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <FormSelect label="Company" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setBranchId(''); }}
            options={companies.map(c => ({ value: c.id, label: `${c.name} (${c.code})` }))}
            placeholder="Select company"
          />
          <FormSelect label="Branch (optional)" value={branchId} onChange={(e) => setBranchId(e.target.value)}
            options={branches.map(b => ({ value: b.id, label: `${b.code} — ${b.name}` }))}
            placeholder="All branches"
          />
          <FormInput label="Period start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          <FormInput label="Period end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-semibold mb-2">Per-product commission rates (TZS / litre)</div>
        {!companyId ? (
          <p className="text-xs text-slate-500 italic">Pick a company to load fuel products.</p>
        ) : fuelProducts.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No products found for this company.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {fuelProducts.map(p => (
              <FormInput
                key={p.id}
                label={`${p.name}${p.productCode ? ` · ${p.productCode}` : ''}`}
                type="number"
                step="0.0001"
                placeholder="0.00"
                value={rates[p.id] ?? ''}
                onChange={(e) => setRates(r => ({ ...r, [p.id]: e.target.value }))}
              />
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Btn variant="primary" onClick={handlePreview} loading={loading} disabled={!companyId}>Preview commissions</Btn>
          {preview && preview.rows.length > 0 && (
            <Btn variant="success" onClick={handleCommit} loading={committing}>Commit {preview.rows.length} allowances</Btn>
          )}
        </div>
      </Card>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800">{success}</div>}

      {loading && <PageSpinner />}

      {!loading && preview && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Attendants" value={String(preview.totals.attendants)} />
            <Tile label="Litres dispensed" value={fmt(preview.totals.totalLitres, 3)} />
            <Tile label="Total commission (TZS)" value={fmt(preview.totals.totalAmount)} />
            <Tile
              label="Unattributed (TZS)"
              value={fmt(preview.totals.unattributedAmount)}
              muted={preview.totals.unattributedAmount === 0}
              warn={preview.totals.unattributedAmount > 0}
            />
          </div>

          {preview.totals.unattributedAmount > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
              <strong>{fmt(preview.totals.unattributedLitres, 3)} L</strong> dispensed couldn&apos;t be attributed to any pump attendant
              (TZS {fmt(preview.totals.unattributedAmount)} commission lost). Check that fuel-shifts have <em>Pump Attendants</em>
              assigned, ideally with a pinned pump.
            </div>
          )}

          {preview.rows.length === 0 ? (
            <Card className="p-10 text-center text-sm text-slate-400">
              No attendant commissions for this period. Either no shifts were closed in the window, or no attendants were
              assigned to the pumps that dispensed fuel.
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100" style={{ color: 'var(--aurora-text-muted)' }}>
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">Employee</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">Branch</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">Breakdown</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide">Litres</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide">Commission (TZS)</th>
                    </tr>
                  </thead>
                  <tbody style={{ color: 'var(--aurora-text)' }}>
                    {preview.rows.map(row => (
                      <tr key={row.employeeId} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-2">
                          <div className="font-medium">{row.fullName}</div>
                          <div className="text-xs font-mono text-slate-500">{row.employeeCode}</div>
                        </td>
                        <td className="px-4 py-2 text-xs">{row.branchName ?? '—'}</td>
                        <td className="px-4 py-2 text-xs">
                          {row.byProduct.map(p => (
                            <div key={p.productId}>
                              <span className="font-medium">{p.productName}:</span>{' '}
                              {fmt(p.litres, 3)} L × TZS {fmt(p.rate, 4)} = TZS {fmt(p.amount)}
                            </div>
                          ))}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmt(row.totalLitres, 3)}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-emerald-700">
                          {fmt(row.totalAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-100 border-t border-slate-200">
                    <tr>
                      <td colSpan={3} className="px-4 py-2 text-xs font-semibold">Totals</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold">{fmt(preview.totals.totalLitres, 3)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold">{fmt(preview.totals.totalAmount)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, muted, warn }: { label: string; value: string; muted?: boolean; warn?: boolean }) {
  const cls = warn
    ? 'bg-amber-50 border-amber-200 text-amber-800'
    : muted
      ? 'bg-slate-50 border-slate-200 text-slate-500'
      : 'bg-white border-slate-200';
  return (
    <Card className={`p-3 border ${cls}`}>
      <div className="text-[11px] uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </Card>
  );
}
