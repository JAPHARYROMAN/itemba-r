'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Btn, Card, FormSelect, FormInput, PageHeader, PageSpinner, PageToolbar } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Item {
  id: string;
  productId: string;
  product: { id: string; name: string; sku?: string | null };
  location: { id: string; name: string; locationCode: string; branchId: string | null };
  quantityOnHand: number;
  quantityReserved: number;
  quantityAvailable: number;
  averageCost: number;
  totalValue: number;
  lastMovementAt?: string | null;
  status: 'OUT' | 'LOW' | 'OK';
}

interface LocationGroup {
  locationId: string;
  locationName: string;
  locationCode: string;
  branchId: string | null;
  itemCount: number;
  out: number;
  low: number;
  ok: number;
  totalValue: number;
  items: Item[];
}

interface LiveResp {
  lowThreshold: number;
  totals: { totalSkus: number; out: number; low: number; ok: number; totalValue: number };
  locations: LocationGroup[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-TZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const fmtUnits = (n: number) =>
  new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 2 }).format(n);

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LiveInventoryPage() {
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [search, setSearch] = useState('');
  const [lowThreshold, setLowThreshold] = useState('10');
  const [data, setData] = useState<LiveResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { companyOptions, branchOptions } = useOrgScope(companyId, { skipDivisions: true, skipEmployees: true });

  const load = useCallback(async () => {
    if (!companyId) { setData(null); return; }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ companyId });
      if (branchId) params.set('branchId', branchId);
      if (lowThreshold) params.set('lowThreshold', lowThreshold);
      if (search) params.set('search', search);
      const res = await fetch(`/api/backend/inventory-balances/live?${params}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      setData(j.data ?? j);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [companyId, branchId, lowThreshold, search]);

  // Debounced reload on filter changes.
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  // Optional 30s auto-refresh.
  useEffect(() => {
    if (!autoRefresh || !companyId) return;
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [autoRefresh, companyId, load]);

  const toggleLocation = (lid: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(lid)) next.delete(lid);
      else next.add(lid);
      return next;
    });

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Live Inventory"
        subtitle="Real-time per-location stock heatmap. Color = stock health."
        breadcrumbs={[{ label: 'Westsides', href: '/westsides' }, { label: 'Live Inventory' }]}
      />

      <PageToolbar
        filters={
          <>
            <div className="w-56">
              <FormSelect value={companyId} onChange={(e) => { setCompanyId(e.target.value); setBranchId(''); }} options={companyOptions} placeholder="Pick company" />
            </div>
            <div className="w-44">
              <FormSelect value={branchId} onChange={(e) => setBranchId(e.target.value)} options={branchOptions} placeholder={companyId ? 'All branches' : 'Pick company'} />
            </div>
            <input
              type="text"
              placeholder="Search SKU / name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={!companyId}
              className="text-sm border rounded-lg px-3 py-1.5 w-44 focus:outline-none focus:ring-2 focus:ring-brand-500"
              style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}
            />
            <div className="w-32">
              <FormInput value={lowThreshold} onChange={(e) => setLowThreshold(e.target.value)} placeholder="Low ≤" type="number" />
            </div>
            <label className="text-xs text-slate-500 flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              Auto-refresh 30s
            </label>
          </>
        }
        actions={<Btn variant="primary" size="sm" onClick={load} disabled={!companyId} loading={loading}>Refresh</Btn>}
      />

      {error && (
        <Card className="p-3 bg-red-50 border-red-200 text-red-700 text-sm">{error}</Card>
      )}

      {data && (
        <>
          {/* Top-line tiles */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Tile label="SKUs tracked" value={String(data.totals.totalSkus)} />
            <Tile label="Out of stock" value={String(data.totals.out)} tone="danger" />
            <Tile label="Low" value={String(data.totals.low)} tone="warn" />
            <Tile label="OK" value={String(data.totals.ok)} tone="good" />
            <Tile label="Inventory value" value={`TZS ${fmt(data.totals.totalValue)}`} highlight />
          </div>

          {/* Per-location accordion */}
          <div className="space-y-3">
            {data.locations.length === 0 && (
              <Card className="p-8 text-center text-sm text-slate-400 italic">
                No inventory balances match the filters.
              </Card>
            )}
            {data.locations.map(loc => {
              const isOpen = expanded.has(loc.locationId);
              const hotness = loc.out + loc.low;
              return (
                <Card key={loc.locationId} className="overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleLocation(loc.locationId)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left"
                  >
                    <span className={`w-2 h-2 rounded-full ${hotness > 0 ? 'bg-red-500' : 'bg-emerald-500'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{loc.locationName}</div>
                      <div className="text-[11px] font-mono text-slate-400">{loc.locationCode}</div>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Pill tone="danger">{loc.out} OUT</Pill>
                      <Pill tone="warn">{loc.low} LOW</Pill>
                      <Pill tone="good">{loc.ok} OK</Pill>
                    </div>
                    <div className="text-right ml-4">
                      <div className="text-sm font-semibold tabular-nums">TZS {fmt(loc.totalValue)}</div>
                      <div className="text-[11px] text-slate-500">{loc.itemCount} SKUs</div>
                    </div>
                    <span className="ml-2 text-slate-400">{isOpen ? '▴' : '▾'}</span>
                  </button>

                  {isOpen && (
                    <div className="overflow-x-auto border-t border-slate-100">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-100">
                          <tr style={{ color: 'var(--aurora-text-muted)' }}>
                            <th className="px-4 py-2 text-left text-xs font-semibold uppercase">Product</th>
                            <th className="px-4 py-2 text-right text-xs font-semibold uppercase">On hand</th>
                            <th className="px-4 py-2 text-right text-xs font-semibold uppercase">Reserved</th>
                            <th className="px-4 py-2 text-right text-xs font-semibold uppercase">Available</th>
                            <th className="px-4 py-2 text-right text-xs font-semibold uppercase">Avg cost</th>
                            <th className="px-4 py-2 text-right text-xs font-semibold uppercase">Value</th>
                            <th className="px-4 py-2 text-left text-xs font-semibold uppercase">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {loc.items.map(it => (
                            <tr key={it.id} className="border-b border-slate-50">
                              <td className="px-4 py-2">
                                <div className="font-medium">{it.product.name}</div>
                                {it.product.sku && <div className="text-[11px] font-mono text-slate-400">{it.product.sku}</div>}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums">{fmtUnits(it.quantityOnHand)}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-500">{fmtUnits(it.quantityReserved)}</td>
                              <td className="px-4 py-2 text-right tabular-nums font-medium">{fmtUnits(it.quantityAvailable)}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-xs text-slate-500">{fmt(it.averageCost)}</td>
                              <td className="px-4 py-2 text-right tabular-nums">{fmt(it.totalValue)}</td>
                              <td className="px-4 py-2"><StatusCell status={it.status} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          <p className="text-[11px] text-slate-500">
            Threshold currently {data.lowThreshold}. Items at or below this count flag as LOW; zero stock flags OUT.
          </p>
        </>
      )}

      {!data && !loading && !error && (
        <Card className="p-8 text-center text-sm text-slate-400">Pick a company to load live stock.</Card>
      )}
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function Tile({ label, value, tone, highlight }: { label: string; value: string; tone?: 'good' | 'warn' | 'danger'; highlight?: boolean }) {
  const cls =
    tone === 'danger' ? 'bg-red-50 border-red-200' :
    tone === 'warn' ? 'bg-amber-50 border-amber-200' :
    tone === 'good' ? 'bg-emerald-50 border-emerald-200' :
    highlight ? 'bg-slate-900 text-white' : '';
  return (
    <Card className={`p-3 ${cls}`}>
      <div className={`text-[11px] uppercase tracking-wide ${highlight ? 'text-slate-300' : 'text-slate-500'}`}>{label}</div>
      <div className={`text-xl font-bold mt-1 ${highlight ? 'text-white' : ''}`}>{value}</div>
    </Card>
  );
}

function Pill({ tone, children }: { tone: 'good' | 'warn' | 'danger'; children: React.ReactNode }) {
  const cls =
    tone === 'danger' ? 'bg-red-100 text-red-700 border-red-200' :
    tone === 'warn' ? 'bg-amber-100 text-amber-700 border-amber-200' :
    'bg-emerald-100 text-emerald-700 border-emerald-200';
  return <span className={`px-2 py-0.5 rounded border text-[11px] font-medium ${cls}`}>{children}</span>;
}

function StatusCell({ status }: { status: 'OUT' | 'LOW' | 'OK' }) {
  const cls =
    status === 'OUT' ? 'bg-red-100 text-red-700' :
    status === 'LOW' ? 'bg-amber-100 text-amber-700' :
    'bg-emerald-100 text-emerald-700';
  return <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${cls}`}>{status}</span>;
}
