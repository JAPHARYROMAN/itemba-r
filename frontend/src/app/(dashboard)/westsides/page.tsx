'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Btn, Card, FormSelect, PageHeader, PageSpinner } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useAuth } from '@/hooks/use-auth';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Cockpit {
  asOf: string;
  kpis: {
    todaySales: number;
    todayCount: number;
    avgTicket: number;
    cashCollected: number;
    outstandingAR: number;
    openFoliosCount: number;
    openFoliosTotal: number;
  };
  yesterday: { sales: number; count: number; deltaPct: number };
  byDivision: Array<{
    divisionId: string | null;
    name: string | null;
    code: string | null;
    count: number;
    revenue: number;
  }>;
  stock: {
    outOfStock: number;
    lowStock: number;
    criticalSkus: Array<{
      productId: string;
      productName: string;
      sku: string | null;
      locationName: string;
      quantityOnHand: number;
    }>;
  };
  rooms: {
    total: number;
    occupied: number;
    available: number;
    dirty: number;
    outOfOrder: number;
    occupancyRate: number;
    inHouseGuests: number;
  };
  arAging: {
    current: number;
    days1to30: number;
    days31to60: number;
    days61to90: number;
    days90plus: number;
    overdueCount: number;
    overdueAmount: number;
  };
  topSalespersons: Array<{
    id: string | null;
    name: string | null;
    count: number;
    revenue: number;
  }>;
  topProducts: Array<{
    productId: string;
    name: string;
    sku: string | null;
    quantity: number;
    revenue: number;
  }>;
  activity: {
    recentSales: Array<ActivityItem>;
    recentCharges: Array<ActivityItem>;
  };
}

interface ActivityItem {
  id: string;
  kind: 'SALE' | 'FOLIO_CHARGE';
  when: string;
  headline: string;
  subline: string;
  amount: number;
}

const QUICK_LINKS = [
  {
    label: 'Quick Sale',
    href: '/westsides/quick-sale',
    color: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  },
  {
    label: 'Customers',
    href: '/westsides/customers',
    color: 'bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100',
  },
  {
    label: 'Live Inventory',
    href: '/westsides/inventory/live',
    color: 'bg-cyan-50 text-cyan-700 hover:bg-cyan-100',
  },
  {
    label: 'Daily Close',
    href: '/westsides/daily-close',
    color: 'bg-rose-50 text-rose-700 hover:bg-rose-100',
  },
  {
    label: 'Bookings',
    href: '/hospitality/bookings',
    color: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100',
  },
  {
    label: 'Sales Orders',
    href: '/operations/sales-orders',
    color: 'bg-teal-50 text-teal-700 hover:bg-teal-100',
  },
  {
    label: 'Quotations',
    href: '/westsides/quotations',
    color: 'bg-violet-50 text-violet-700 hover:bg-violet-100',
  },
  {
    label: 'Price Lists',
    href: '/westsides/price-lists',
    color: 'bg-amber-50 text-amber-700 hover:bg-amber-100',
  },
  {
    label: 'Delivery Notes',
    href: '/westsides/delivery-notes',
    color: 'bg-sky-50 text-sky-700 hover:bg-sky-100',
  },
  {
    label: 'Product Batches',
    href: '/westsides/product-batches',
    color: 'bg-orange-50 text-orange-700 hover:bg-orange-100',
  },
  {
    label: 'Stock Damage',
    href: '/westsides/stock-damage',
    color: 'bg-red-50 text-red-700 hover:bg-red-100',
  },
  {
    label: 'Reports',
    href: '/westsides/reports',
    color: 'bg-slate-50 text-slate-700 hover:bg-slate-100',
  },
];

const SETTINGS_KEY = 'itemba.cockpit.settings.v1';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number | string | undefined | null) =>
  new Intl.NumberFormat('en-TZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number(n ?? 0),
  );
const fmtInt = (n: number | string | undefined | null) =>
  new Intl.NumberFormat('en-TZ').format(Number(n ?? 0));
const timeAgo = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WestsidesCockpitPage() {
  const { user, loading: authLoading } = useAuth();
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [data, setData] = useState<Cockpit | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { companyOptions, branchOptions } = useOrgScope(companyId, {
    skipDivisions: true,
    skipEmployees: true,
  });

  // Persist company/branch selection on the device.
  useEffect(() => {
    if (authLoading) return;
    try {
      const raw = user?.id ? localStorage.getItem(`${SETTINGS_KEY}.${user.id}`) : null;
      if (raw) {
        const s = JSON.parse(raw) as { companyId?: string; branchId?: string };
        if (s.companyId) setCompanyId(s.companyId);
        if (s.branchId) setBranchId(s.branchId);
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, [authLoading, user?.id]);

  useEffect(() => {
    if (!hydrated || !user?.id) return;
    try {
      localStorage.setItem(`${SETTINGS_KEY}.${user.id}`, JSON.stringify({ companyId, branchId }));
    } catch {
      /* ignore */
    }
  }, [companyId, branchId, hydrated, user?.id]);

  const load = useCallback(async () => {
    if (!companyId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ companyId });
      if (branchId) params.set('branchId', branchId);
      const res = await fetch(`/api/backend/westsides/dashboard/cockpit?${params}`);
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
  }, [companyId, branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Opt-in 30s auto-refresh.
  useEffect(() => {
    if (!autoRefresh || !companyId) return;
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [autoRefresh, companyId, load]);

  const activityFeed = useMemo<ActivityItem[]>(() => {
    if (!data) return [];
    return [...data.activity.recentSales, ...data.activity.recentCharges]
      .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
      .slice(0, 12);
  }, [data]);

  if (!hydrated) return <PageSpinner />;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Westsides Cockpit" subtitle="Today's commercial command center." />
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-48">
            <FormSelect
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setBranchId('');
              }}
              options={companyOptions}
              placeholder="Pick company"
            />
          </div>
          <div className="w-40">
            <FormSelect
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              options={branchOptions}
              placeholder={companyId ? 'All branches' : 'Pick company'}
            />
          </div>
          <label className="text-xs text-slate-500 flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto 30s
          </label>
          <Btn variant="secondary" size="sm" onClick={load} disabled={!companyId} loading={loading}>
            Refresh
          </Btn>
        </div>
      </div>

      {error && <Card className="p-3 bg-red-50 border-red-200 text-red-700 text-sm">{error}</Card>}
      {!companyId && !loading && (
        <Card className="p-8 text-center text-sm text-slate-400">
          Pick a company to light up the cockpit.
        </Card>
      )}

      {data && (
        <>
          {/* ── Top KPI strip ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Tile
              label="Revenue today"
              value={`TZS ${fmt(data.kpis.todaySales)}`}
              highlight
              hint={`${data.kpis.todayCount} sale${data.kpis.todayCount === 1 ? '' : 's'}`}
            />
            <Tile
              label="vs yesterday"
              value={
                data.yesterday.deltaPct === 0
                  ? '—'
                  : `${data.yesterday.deltaPct >= 0 ? '+' : ''}${data.yesterday.deltaPct.toFixed(1)}%`
              }
              tone={
                data.yesterday.deltaPct > 0
                  ? 'good'
                  : data.yesterday.deltaPct < 0
                    ? 'warn'
                    : undefined
              }
              hint={`yest. TZS ${fmt(data.yesterday.sales)}`}
            />
            <Tile label="Avg ticket" value={`TZS ${fmt(data.kpis.avgTicket)}`} />
            <Tile
              label="Cash collected"
              value={`TZS ${fmt(data.kpis.cashCollected)}`}
              tone="good"
            />
            <Tile
              label="Outstanding AR"
              value={`TZS ${fmt(data.kpis.outstandingAR)}`}
              tone={data.arAging.overdueAmount > 0 ? 'warn' : undefined}
              hint={
                data.arAging.overdueCount > 0 ? `${data.arAging.overdueCount} overdue` : undefined
              }
            />
            <Tile
              label="Open folios"
              value={String(data.kpis.openFoliosCount)}
              hint={`TZS ${fmt(data.kpis.openFoliosTotal)} unsettled`}
            />
          </div>

          {/* ── Per-division revenue ──────────────────────────────────── */}
          {data.byDivision.length > 0 && (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Revenue by division — today</h3>
                <span className="text-xs text-slate-500">
                  total TZS {fmt(data.kpis.todaySales)}
                </span>
              </div>
              <div className="space-y-2">
                {data.byDivision.map((d) => {
                  const pct =
                    data.kpis.todaySales > 0 ? (d.revenue / data.kpis.todaySales) * 100 : 0;
                  return (
                    <div key={d.divisionId ?? 'unassigned'} className="flex items-center gap-3">
                      <div className="w-32 text-sm font-medium truncate">
                        {d.name ?? 'Unassigned'}
                      </div>
                      <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                        <div
                          className="h-full bg-indigo-500"
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                      <div className="w-32 text-right text-sm tabular-nums">
                        TZS {fmt(d.revenue)}
                      </div>
                      <div className="w-20 text-right text-xs text-slate-500 tabular-nums">
                        {pct.toFixed(1)}%
                      </div>
                      <div className="w-16 text-right text-xs text-slate-500">{d.count} sales</div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* ── Stock health ────────────────────────────────────────── */}
            <Card className="overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Stock health</h3>
                <Link
                  href="/westsides/inventory/live"
                  className="text-[11px] text-brand-600 hover:underline"
                >
                  View live →
                </Link>
              </div>
              <div className="grid grid-cols-3 divide-x divide-slate-100">
                <div className="p-4 text-center">
                  <div className="text-2xl font-bold text-red-600">
                    {fmtInt(data.stock.outOfStock)}
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 mt-1">
                    Out of stock
                  </div>
                </div>
                <div className="p-4 text-center">
                  <div className="text-2xl font-bold text-amber-600">
                    {fmtInt(data.stock.lowStock)}
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 mt-1">
                    Low stock
                  </div>
                </div>
                <div className="p-4 text-center">
                  <div className="text-2xl font-bold text-emerald-600">
                    {fmtInt(data.stock.outOfStock + data.stock.lowStock)}
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 mt-1">
                    Total alerts
                  </div>
                </div>
              </div>
              {data.stock.criticalSkus.length > 0 && (
                <div className="border-t border-slate-100">
                  <div className="px-4 py-2 text-[11px] uppercase tracking-wide text-slate-500">
                    Most critical
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {data.stock.criticalSkus.map((s, i) => (
                      <li key={i} className="px-4 py-2 flex items-center gap-3 text-sm">
                        <span
                          className={`w-2 h-2 rounded-full ${s.quantityOnHand <= 0 ? 'bg-red-500' : 'bg-amber-500'}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="truncate font-medium">{s.productName}</div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {s.sku ?? '—'} · {s.locationName}
                          </div>
                        </div>
                        <div
                          className={`text-sm font-bold tabular-nums ${s.quantityOnHand <= 0 ? 'text-red-600' : 'text-amber-600'}`}
                        >
                          {fmt(s.quantityOnHand)}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>

            {/* ── Room occupancy ──────────────────────────────────────── */}
            <Card className="overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Hospitality</h3>
                <Link
                  href="/hospitality/bookings"
                  className="text-[11px] text-brand-600 hover:underline"
                >
                  Bookings →
                </Link>
              </div>
              {data.rooms.total === 0 ? (
                <div className="p-8 text-center text-sm text-slate-400 italic">
                  No rooms configured.
                </div>
              ) : (
                <>
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs uppercase tracking-wide text-slate-500">
                        Occupancy
                      </div>
                      <div className="text-sm font-bold">
                        {data.rooms.occupancyRate.toFixed(0)}%
                      </div>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden flex">
                      <div
                        className="bg-indigo-500"
                        style={{ width: `${(data.rooms.occupied / data.rooms.total) * 100}%` }}
                        title={`${data.rooms.occupied} occupied`}
                      />
                      <div
                        className="bg-amber-300"
                        style={{ width: `${(data.rooms.dirty / data.rooms.total) * 100}%` }}
                        title={`${data.rooms.dirty} dirty`}
                      />
                      <div
                        className="bg-emerald-300"
                        style={{ width: `${(data.rooms.available / data.rooms.total) * 100}%` }}
                        title={`${data.rooms.available} available`}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-4 divide-x divide-slate-100 border-t border-slate-100">
                    <RoomStat label="Occupied" value={data.rooms.occupied} tone="indigo" />
                    <RoomStat label="Dirty" value={data.rooms.dirty} tone="amber" />
                    <RoomStat label="Available" value={data.rooms.available} tone="emerald" />
                    <RoomStat label="OOO" value={data.rooms.outOfOrder} tone="slate" />
                  </div>
                  <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-sm">
                    <span className="text-slate-600">In-house guests</span>
                    <span className="font-semibold tabular-nums">{data.rooms.inHouseGuests}</span>
                  </div>
                </>
              )}
            </Card>
          </div>

          {/* ── AR aging ──────────────────────────────────────────────── */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">AR aging</h3>
              <span className="text-xs text-slate-500">
                total TZS {fmt(data.kpis.outstandingAR)}
              </span>
            </div>
            <div className="grid grid-cols-5 gap-2">
              <ArBucket
                label="Current"
                amount={data.arAging.current}
                total={data.kpis.outstandingAR}
                tone="emerald"
              />
              <ArBucket
                label="1–30 days"
                amount={data.arAging.days1to30}
                total={data.kpis.outstandingAR}
                tone="lime"
              />
              <ArBucket
                label="31–60 days"
                amount={data.arAging.days31to60}
                total={data.kpis.outstandingAR}
                tone="amber"
              />
              <ArBucket
                label="61–90 days"
                amount={data.arAging.days61to90}
                total={data.kpis.outstandingAR}
                tone="orange"
              />
              <ArBucket
                label="90+ days"
                amount={data.arAging.days90plus}
                total={data.kpis.outstandingAR}
                tone="red"
              />
            </div>
            {data.arAging.overdueAmount > 0 && (
              <div className="mt-3 text-xs text-amber-700">
                ⚠ TZS {fmt(data.arAging.overdueAmount)} across {data.arAging.overdueCount} overdue
                invoice{data.arAging.overdueCount === 1 ? '' : 's'}.
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* ── Top salespersons ─────────────────────────────────────── */}
            <Card className="overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-100">
                <h3 className="text-sm font-semibold">Top salespersons today</h3>
              </div>
              {data.topSalespersons.length === 0 ? (
                <div className="p-6 text-sm text-slate-400 italic text-center">
                  No sales yet today.
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.topSalespersons.map((s, i) => (
                    <li key={i} className="px-4 py-2 flex items-center gap-3 text-sm">
                      <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0 truncate">
                        {s.name ?? <em className="text-slate-400">unattributed</em>}
                      </div>
                      <div className="text-xs text-slate-500">{s.count}</div>
                      <div className="font-semibold tabular-nums">TZS {fmt(s.revenue)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* ── Top SKUs ──────────────────────────────────────────────── */}
            <Card className="overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-100">
                <h3 className="text-sm font-semibold">Top SKUs today</h3>
              </div>
              {data.topProducts.length === 0 ? (
                <div className="p-6 text-sm text-slate-400 italic text-center">
                  No items sold yet.
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.topProducts.map((p, i) => (
                    <li key={p.productId} className="px-4 py-2 flex items-start gap-3 text-sm">
                      <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium">{p.name}</div>
                        <div className="text-[11px] font-mono text-slate-400">{p.sku ?? '—'}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold tabular-nums">TZS {fmt(p.revenue)}</div>
                        <div className="text-[11px] text-slate-500">
                          {p.quantity.toFixed(0)} units
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* ── Activity feed ─────────────────────────────────────────── */}
            <Card className="overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-100">
                <h3 className="text-sm font-semibold">Live activity</h3>
              </div>
              {activityFeed.length === 0 ? (
                <div className="p-6 text-sm text-slate-400 italic text-center">Nothing yet.</div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {activityFeed.map((a) => (
                    <li key={`${a.kind}-${a.id}`} className="px-4 py-2.5 text-sm">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span
                            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.kind === 'SALE' ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                          />
                          <div className="truncate font-medium">{a.headline}</div>
                        </div>
                        <div className="text-xs tabular-nums text-slate-500 flex-shrink-0">
                          {timeAgo(a.when)}
                        </div>
                      </div>
                      <div className="flex items-baseline justify-between gap-2 mt-0.5">
                        <div className="text-[11px] text-slate-500 truncate">{a.subline}</div>
                        <div className="text-xs font-semibold tabular-nums flex-shrink-0">
                          TZS {fmt(a.amount)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <p className="text-[11px] text-slate-500 text-right">
            As of {new Date(data.asOf).toLocaleTimeString('en-GB')}
            {autoRefresh ? ' · refreshing every 30s' : ''}.
          </p>
        </>
      )}

      {/* ── Quick links (always visible at the bottom) ─────────────── */}
      <Card className="p-4">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
          Quick access
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium text-center transition-colors ${link.color}`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function Tile({
  label,
  value,
  hint,
  tone,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'good' | 'warn' | 'danger';
  highlight?: boolean;
}) {
  const cls =
    tone === 'danger'
      ? 'bg-red-50 border-red-200'
      : tone === 'warn'
        ? 'bg-amber-50 border-amber-200'
        : tone === 'good'
          ? 'bg-emerald-50 border-emerald-200'
          : highlight
            ? 'bg-slate-900 text-white'
            : '';
  return (
    <Card className={`p-3 ${cls}`}>
      <div
        className={`text-[11px] uppercase tracking-wide ${highlight ? 'text-slate-300' : 'text-slate-500'}`}
      >
        {label}
      </div>
      <div className={`text-xl font-bold mt-1 ${highlight ? 'text-white' : ''}`}>{value}</div>
      {hint && (
        <div className={`text-[11px] mt-0.5 ${highlight ? 'text-slate-300' : 'text-slate-500'}`}>
          {hint}
        </div>
      )}
    </Card>
  );
}

function RoomStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'indigo' | 'amber' | 'emerald' | 'slate';
}) {
  const text =
    tone === 'indigo'
      ? 'text-indigo-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : tone === 'emerald'
          ? 'text-emerald-700'
          : 'text-slate-500';
  return (
    <div className="p-3 text-center">
      <div className={`text-lg font-bold ${text}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

function ArBucket({
  label,
  amount,
  total,
  tone,
}: {
  label: string;
  amount: number;
  total: number;
  tone: 'emerald' | 'lime' | 'amber' | 'orange' | 'red';
}) {
  const pct = total > 0 ? (amount / total) * 100 : 0;
  const bg =
    tone === 'emerald'
      ? 'bg-emerald-500'
      : tone === 'lime'
        ? 'bg-lime-500'
        : tone === 'amber'
          ? 'bg-amber-500'
          : tone === 'orange'
            ? 'bg-orange-500'
            : 'bg-red-500';
  const accent =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'lime'
        ? 'text-lime-700'
        : tone === 'amber'
          ? 'text-amber-700'
          : tone === 'orange'
            ? 'text-orange-700'
            : 'text-red-700';
  return (
    <div className="border border-slate-100 rounded-lg p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-base font-bold mt-1 tabular-nums ${accent}`}>TZS {fmt(amount)}</div>
      <div className="mt-1.5 w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full ${bg}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5 tabular-nums">{pct.toFixed(1)}%</div>
    </div>
  );
}
