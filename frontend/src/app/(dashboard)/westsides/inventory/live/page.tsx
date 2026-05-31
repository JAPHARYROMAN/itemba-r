'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Btn,
  Card,
  FormSelect,
  FormInput,
  PageHeader,
  PageSpinner,
  PageToolbar,
} from '@/components/ui';
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

type Tone = 'danger' | 'warn' | 'good' | 'info' | 'neutral';

interface ReadinessCheck {
  label: string;
  status: string;
  detail: string;
  tone: Tone;
  actionHref?: string;
  actionLabel?: string;
}

interface InventorySummary {
  allItems: Item[];
  totalOnHand: number;
  totalReserved: number;
  totalAvailable: number;
  atRiskSkus: number;
  atRiskValue: number;
  atRiskPct: number;
  reservedPct: number;
  availablePct: number;
  locationsAtRisk: number;
  criticalSkus: Item[];
  staleSkus: number;
  riskLabel: 'Critical' | 'Watch' | 'Stable';
  riskTone: Tone;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DASH = '-';

const fmt = (n: number | string | undefined | null) =>
  new Intl.NumberFormat('en-TZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    toNumber(n),
  );

const fmtUnits = (n: number | string | undefined | null) =>
  new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 2 }).format(toNumber(n));

const fmtInt = (n: number | string | undefined | null) =>
  new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(toNumber(n));

function toNumber(value: number | string | undefined | null) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function pct(part: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (part / total) * 100));
}

function formatMovement(value?: string | null) {
  if (!value) return 'No movement';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return DASH;
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days < 1) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 31) return `${days} days ago`;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(value: Date | null) {
  if (!value) return DASH;
  return value.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAge(value: Date | null) {
  if (!value) return 'Not loaded';
  const seconds = Math.max(0, Math.floor((Date.now() - value.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

function daysSince(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

function buildHref(path: string, params: Record<string, string | null | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function productActionHref(path: string, item: Item) {
  return buildHref(path, {
    productId: item.productId,
    branchId: item.location.branchId,
    search: item.product.sku ?? item.product.name,
  });
}

function buildSummary(data: LiveResp | null): InventorySummary {
  const allItems = data?.locations.flatMap((location) => location.items) ?? [];
  const totalOnHand = allItems.reduce((sum, item) => sum + toNumber(item.quantityOnHand), 0);
  const totalReserved = allItems.reduce((sum, item) => sum + toNumber(item.quantityReserved), 0);
  const totalAvailable = allItems.reduce((sum, item) => sum + toNumber(item.quantityAvailable), 0);
  const atRiskSkus = toNumber(data?.totals.out) + toNumber(data?.totals.low);
  const atRiskValue = allItems
    .filter((item) => item.status !== 'OK')
    .reduce((sum, item) => sum + toNumber(item.totalValue), 0);
  const locationsAtRisk =
    data?.locations.filter((location) => location.out + location.low > 0).length ?? 0;
  const criticalSkus = [...allItems]
    .filter((item) => item.status !== 'OK')
    .sort((a, b) => {
      const statusWeight = (status: Item['status']) =>
        status === 'OUT' ? 0 : status === 'LOW' ? 1 : 2;
      return (
        statusWeight(a.status) - statusWeight(b.status) ||
        toNumber(a.quantityAvailable) - toNumber(b.quantityAvailable) ||
        toNumber(a.quantityOnHand) - toNumber(b.quantityOnHand) ||
        a.product.name.localeCompare(b.product.name)
      );
    })
    .slice(0, 8);
  const staleSkus = allItems.filter((item) => {
    const days = daysSince(item.lastMovementAt);
    return days !== null && days >= 30 && toNumber(item.quantityOnHand) > 0;
  }).length;
  const riskLabel =
    toNumber(data?.totals.out) > 0
      ? 'Critical'
      : toNumber(data?.totals.low) > 0
        ? 'Watch'
        : 'Stable';
  const riskTone: Tone =
    riskLabel === 'Critical' ? 'danger' : riskLabel === 'Watch' ? 'warn' : 'good';

  return {
    allItems,
    totalOnHand,
    totalReserved,
    totalAvailable,
    atRiskSkus,
    atRiskValue,
    atRiskPct: pct(atRiskSkus, toNumber(data?.totals.totalSkus)),
    reservedPct: pct(totalReserved, totalOnHand),
    availablePct: pct(totalAvailable, totalOnHand),
    locationsAtRisk,
    criticalSkus,
    staleSkus,
    riskLabel,
    riskTone,
  };
}

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
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const {
    companyOptions,
    branchOptions,
    loading: orgLoading,
  } = useOrgScope(companyId, { skipDivisions: true, skipEmployees: true });

  const load = useCallback(async () => {
    if (!companyId) {
      setData(null);
      setLastLoadedAt(null);
      return;
    }
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
      setLastLoadedAt(new Date());
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

  useEffect(() => {
    if (!branchId || branchOptions.some((option) => option.value === branchId)) return;
    setBranchId('');
  }, [branchId, branchOptions]);

  const summary = useMemo(() => buildSummary(data), [data]);
  const selectedCompanyLabel =
    companyOptions.find((option) => option.value === companyId)?.label ??
    (companyId ? 'Selected company' : 'Not selected');
  const selectedBranchLabel =
    branchOptions.find((option) => option.value === branchId)?.label ??
    (branchId ? 'Selected branch' : 'All branches');
  const lastLoadAgeMs = lastLoadedAt ? Date.now() - lastLoadedAt.getTime() : null;
  const freshnessTone: Tone = !lastLoadedAt
    ? 'neutral'
    : lastLoadAgeMs !== null && lastLoadAgeMs > 300_000
      ? 'warn'
      : 'good';
  const readinessChecks = useMemo<ReadinessCheck[]>(() => {
    if (!data) return [];
    return [
      {
        label: 'Data freshness',
        status:
          lastLoadedAt && lastLoadAgeMs !== null && lastLoadAgeMs <= 300_000 ? 'Fresh' : 'Review',
        detail: lastLoadedAt
          ? `Loaded ${formatAge(lastLoadedAt)}. Auto-refresh ${autoRefresh ? 'is on' : 'is off'}.`
          : 'No successful inventory load yet.',
        tone: freshnessTone,
      },
      {
        label: 'Scope control',
        status: branchId ? 'Branch' : 'Company',
        detail: branchId
          ? `Showing ${selectedBranchLabel}.`
          : `Showing every branch for ${selectedCompanyLabel}; use a branch filter before acting on a location-specific issue.`,
        tone: branchId ? 'good' : 'info',
      },
      {
        label: 'Stock blockers',
        status: data.totals.out > 0 ? 'Blocked' : data.totals.low > 0 ? 'Warning' : 'Clear',
        detail:
          data.totals.out > 0
            ? `${fmtInt(data.totals.out)} SKU${data.totals.out === 1 ? '' : 's'} are out of stock.`
            : data.totals.low > 0
              ? `${fmtInt(data.totals.low)} SKU${data.totals.low === 1 ? '' : 's'} are below threshold.`
              : 'No low or out-of-stock blockers in the current view.',
        tone: data.totals.out > 0 ? 'danger' : data.totals.low > 0 ? 'warn' : 'good',
        actionHref: '/westsides/reports',
        actionLabel: 'Open stock reports',
      },
      {
        label: 'Reservation pressure',
        status: summary.reservedPct > 60 ? 'High' : summary.reservedPct > 30 ? 'Watch' : 'Normal',
        detail: `${summary.reservedPct.toFixed(1)}% of on-hand quantity is reserved; available stock is ${fmtUnits(summary.totalAvailable)} units.`,
        tone: summary.reservedPct > 60 ? 'warn' : summary.reservedPct > 30 ? 'info' : 'good',
      },
      {
        label: 'Movement hygiene',
        status: summary.staleSkus > 0 ? 'Review' : 'Clean',
        detail:
          summary.staleSkus > 0
            ? `${fmtInt(summary.staleSkus)} stocked SKU${summary.staleSkus === 1 ? '' : 's'} have not moved for 30+ days.`
            : 'No stale movement signal in the loaded stock list.',
        tone: summary.staleSkus > 0 ? 'warn' : 'good',
        actionHref: '/westsides/reports',
        actionLabel: 'Review slow movers',
      },
    ];
  }, [
    autoRefresh,
    branchId,
    data,
    freshnessTone,
    lastLoadAgeMs,
    lastLoadedAt,
    selectedBranchLabel,
    selectedCompanyLabel,
    summary,
  ]);

  const toggleLocation = (lid: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(lid)) next.delete(lid);
      else next.add(lid);
      return next;
    });

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="Live Inventory"
        subtitle="Inventory risk, availability, reservation pressure, and stock value by location."
        breadcrumbs={[{ label: 'Westsides', href: '/westsides' }, { label: 'Live Inventory' }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ActionLink href="/westsides/product-batches">Batches</ActionLink>
            <ActionLink href="/westsides/stock-damage">Damage</ActionLink>
            <ActionLink href="/westsides/reports">Reports</ActionLink>
          </div>
        }
      />

      <Card padding="none" className="overflow-hidden">
        <div
          className="border-b px-4 py-3"
          style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Inventory scope
              </div>
              <div className="mt-0.5 text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
                {companyId ? selectedCompanyLabel : 'Choose a company'} · {selectedBranchLabel}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {data ? (
                <StatusChip tone={summary.riskTone}>{summary.riskLabel}</StatusChip>
              ) : (
                <StatusChip tone="neutral">Not loaded</StatusChip>
              )}
              {autoRefresh && <StatusChip tone="info">Auto 30s</StatusChip>}
              {lastLoadedAt && (
                <StatusChip tone={freshnessTone}>Fresh {formatAge(lastLoadedAt)}</StatusChip>
              )}
              {loading && <StatusChip tone="neutral">Refreshing</StatusChip>}
            </div>
          </div>
        </div>

        <div className="px-4 pt-4">
          <PageToolbar
            filters={
              <>
                <FilterField label="Company" className="w-64">
                  <FormSelect
                    value={companyId}
                    onChange={(e) => {
                      setCompanyId(e.target.value);
                      setBranchId('');
                    }}
                    options={companyOptions}
                    placeholder={orgLoading ? 'Loading companies' : 'Pick company'}
                    disabled={orgLoading}
                  />
                </FilterField>
                <FilterField label="Branch" className="w-56">
                  <FormSelect
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    options={branchOptions}
                    placeholder={companyId ? 'All branches' : 'Pick company first'}
                    disabled={!companyId}
                  />
                </FilterField>
                <FilterField label="SKU / product" className="w-56">
                  <input
                    type="text"
                    placeholder="Search SKU or name"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    disabled={!companyId}
                    className="aurora-input w-full rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed"
                  />
                </FilterField>
                <FilterField label="Low threshold" className="w-36">
                  <FormInput
                    value={lowThreshold}
                    onChange={(e) => setLowThreshold(e.target.value)}
                    placeholder="Low ≤"
                    type="number"
                    min="0"
                  />
                </FilterField>
                <label
                  className="mt-5 flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs"
                  style={{
                    borderColor: 'var(--aurora-border)',
                    color: 'var(--aurora-text-secondary)',
                    background: 'var(--aurora-card)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                  />
                  Auto-refresh 30s
                </label>
              </>
            }
            actions={
              <Btn
                variant="primary"
                size="sm"
                onClick={load}
                disabled={!companyId}
                loading={loading}
              >
                Refresh
              </Btn>
            }
            className="mb-0"
          />
        </div>

        <div
          className="grid gap-3 border-t px-4 py-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
          style={{ borderColor: 'var(--aurora-border)' }}
        >
          <ScopeFact label="Company" value={selectedCompanyLabel} muted={!companyId} />
          <ScopeFact label="Branch filter" value={selectedBranchLabel} />
          <ScopeFact
            label="Locations in view"
            value={data ? fmtInt(data.locations.length) : DASH}
          />
          <ScopeFact
            label="LOW rule"
            value={`≤ ${data?.lowThreshold ?? (lowThreshold || 0)} units`}
          />
          <ScopeFact
            label="Last successful refresh"
            value={formatDateTime(lastLoadedAt)}
            muted={!lastLoadedAt}
          />
        </div>
      </Card>

      {error && (
        <RecoveryState
          title="Live inventory could not load"
          detail={error}
          action={
            <Btn
              variant="secondary"
              size="sm"
              onClick={load}
              disabled={!companyId}
              loading={loading}
            >
              Retry
            </Btn>
          }
        />
      )}

      {data && (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricPanel
              label="Risk posture"
              value={summary.riskLabel}
              tone={summary.riskTone}
              detail={`${fmtInt(summary.atRiskSkus)} SKUs at risk · ${summary.atRiskPct.toFixed(1)}% of stock list`}
              progress={summary.atRiskPct}
            />
            <MetricPanel
              label="Low / out stock"
              value={`${fmtInt(data.totals.out)} out · ${fmtInt(data.totals.low)} low`}
              tone={data.totals.out > 0 ? 'danger' : data.totals.low > 0 ? 'warn' : 'good'}
              detail={`${fmtInt(summary.locationsAtRisk)} location${summary.locationsAtRisk === 1 ? '' : 's'} with active alerts`}
              progress={summary.atRiskPct}
            />
            <MetricPanel
              label="Reserved / available"
              value={`${fmtUnits(summary.totalReserved)} / ${fmtUnits(summary.totalAvailable)}`}
              tone={summary.reservedPct > 60 ? 'warn' : 'info'}
              detail={`${summary.reservedPct.toFixed(1)}% reserved · ${summary.availablePct.toFixed(1)}% available`}
              progress={summary.reservedPct}
            />
            <MetricPanel
              label="Inventory valuation"
              value={`TZS ${fmt(data.totals.totalValue)}`}
              tone={summary.atRiskValue > 0 ? 'warn' : 'good'}
              detail={`TZS ${fmt(summary.atRiskValue)} held in low/out SKUs`}
              progress={pct(summary.atRiskValue, data.totals.totalValue)}
            />
          </div>

          <Card padding="none" className="overflow-hidden">
            <PanelHeader
              title="Inventory readiness"
              subtitle="Freshness, blockers, and operating controls before stock decisions."
              action={<StatusChip tone={summary.riskTone}>{summary.riskLabel}</StatusChip>}
            />
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
              {readinessChecks.map((check) => (
                <ReadinessCard key={check.label} check={check} />
              ))}
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <Card padding="none" className="overflow-hidden">
              <PanelHeader
                title="Critical SKU queue"
                subtitle="Out-of-stock and low-stock items sorted by urgency."
                action={
                  <StatusChip tone={summary.atRiskSkus > 0 ? 'danger' : 'good'}>
                    {fmtInt(summary.atRiskSkus)} flagged
                  </StatusChip>
                }
              />
              {summary.criticalSkus.length === 0 ? (
                <InlineEmptyState
                  title="No critical SKUs"
                  detail="The current scope has no low or out-of-stock items."
                />
              ) : (
                <ul>
                  {summary.criticalSkus.map((item) => (
                    <li
                      key={`${item.id}-critical`}
                      className="grid gap-3 border-b px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto]"
                      style={{ borderColor: 'var(--aurora-border)' }}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusChip tone={item.status === 'OUT' ? 'danger' : 'warn'}>
                            {item.status}
                          </StatusChip>
                          <span
                            className="truncate text-sm font-semibold"
                            style={{ color: 'var(--aurora-text)' }}
                          >
                            {item.product.name}
                          </span>
                        </div>
                        <div
                          className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
                          style={{ color: 'var(--aurora-text-secondary)' }}
                        >
                          <span className="font-mono">{item.product.sku ?? 'No SKU'}</span>
                          <span>{item.location.name}</span>
                          <span>{formatMovement(item.lastMovementAt)}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 md:justify-end">
                        <MiniMeasure label="On hand" value={fmtUnits(item.quantityOnHand)} />
                        <MiniMeasure label="Reserved" value={fmtUnits(item.quantityReserved)} />
                        <MiniMeasure
                          label="Available"
                          value={fmtUnits(item.quantityAvailable)}
                          strong
                        />
                        <div className="flex items-center gap-2">
                          <LinkText href={productActionHref('/westsides/product-batches', item)}>
                            Batches
                          </LinkText>
                          <LinkText href={productActionHref('/westsides/stock-damage', item)}>
                            Damage
                          </LinkText>
                          <LinkText
                            href={buildHref('/westsides/reports', {
                              search: item.product.sku ?? item.product.name,
                            })}
                          >
                            Reports
                          </LinkText>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card padding="none" className="overflow-hidden">
              <PanelHeader
                title="Operator actions"
                subtitle="Routes available for investigation and follow-up."
                action={
                  <StatusChip tone={summary.staleSkus > 0 ? 'warn' : 'good'}>
                    {fmtInt(summary.staleSkus)} stale
                  </StatusChip>
                }
              />
              <div className="grid gap-3 p-4">
                <ActionPanel
                  title="Review batch and expiry exposure"
                  body="Open product batches when a critical item needs expiry, lot, or remaining quantity checks."
                  href="/westsides/product-batches"
                  cta="Open batches"
                  tone="info"
                />
                <ActionPanel
                  title="Record damage, breakage, or spoilage"
                  body="Route suspected shrinkage to the damage workflow before relying on available stock."
                  href="/westsides/stock-damage"
                  cta="Open damage"
                  tone="danger"
                />
                <ActionPanel
                  title="Run inventory and controls reports"
                  body="Use batch status, stock damage, fast/slow moving, and profitability reports for follow-up."
                  href="/westsides/reports"
                  cta="Open reports"
                  tone="good"
                />
              </div>
            </Card>
          </div>

          <Card padding="none" className="overflow-hidden">
            <PanelHeader
              title="Location risk map"
              subtitle="Per-location inventory depth, reservation pressure, and SKU status."
              action={
                <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                  {fmtInt(data.locations.length)} locations
                </span>
              }
            />
            {data.locations.length === 0 ? (
              <InlineEmptyState
                title="No balances found"
                detail="No stock rows match the selected company, branch, threshold, and search filters."
                action={<LinkText href="/westsides/product-batches">Check batches</LinkText>}
              />
            ) : (
              <div>
                {data.locations.map((loc) => {
                  const isOpen = expanded.has(loc.locationId);
                  const hotness = loc.out + loc.low;
                  const locReserved = loc.items.reduce(
                    (sum, item) => sum + toNumber(item.quantityReserved),
                    0,
                  );
                  const locAvailable = loc.items.reduce(
                    (sum, item) => sum + toNumber(item.quantityAvailable),
                    0,
                  );
                  const locOnHand = loc.items.reduce(
                    (sum, item) => sum + toNumber(item.quantityOnHand),
                    0,
                  );
                  return (
                    <div
                      key={loc.locationId}
                      className="border-b last:border-b-0"
                      style={{ borderColor: 'var(--aurora-border)' }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleLocation(loc.locationId)}
                        className="w-full px-4 py-3 text-left transition hover:bg-white/5"
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{
                              background:
                                hotness > 0 ? 'var(--aurora-danger)' : 'var(--aurora-success)',
                            }}
                          />
                          <div className="min-w-[180px] flex-1">
                            <div className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                              {loc.locationName}
                            </div>
                            <div
                              className="text-[11px] font-mono"
                              style={{ color: 'var(--aurora-text-muted)' }}
                            >
                              {loc.locationCode}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusChip tone={loc.out > 0 ? 'danger' : 'neutral'}>
                              {fmtInt(loc.out)} OUT
                            </StatusChip>
                            <StatusChip tone={loc.low > 0 ? 'warn' : 'neutral'}>
                              {fmtInt(loc.low)} LOW
                            </StatusChip>
                            <StatusChip tone="good">{fmtInt(loc.ok)} OK</StatusChip>
                          </div>
                          <div className="ml-auto grid min-w-[280px] grid-cols-4 gap-3 text-right">
                            <MiniMeasure label="On hand" value={fmtUnits(locOnHand)} />
                            <MiniMeasure label="Reserved" value={fmtUnits(locReserved)} />
                            <MiniMeasure label="Available" value={fmtUnits(locAvailable)} strong />
                            <MiniMeasure
                              label="Value"
                              value={`TZS ${fmt(loc.totalValue)}`}
                              strong
                            />
                          </div>
                          <span
                            className="text-lg leading-none"
                            style={{ color: 'var(--aurora-text-muted)' }}
                          >
                            {isOpen ? '▴' : '▾'}
                          </span>
                        </div>
                      </button>

                      {isOpen && (
                        <div
                          className="overflow-x-auto border-t"
                          style={{ borderColor: 'var(--aurora-border)' }}
                        >
                          <table className="w-full min-w-[1060px] text-sm">
                            <thead style={{ background: 'var(--aurora-bg-subtle)' }}>
                              <tr>
                                <HeadCell>Product</HeadCell>
                                <HeadCell align="right">On hand</HeadCell>
                                <HeadCell align="right">Reserved</HeadCell>
                                <HeadCell align="right">Available</HeadCell>
                                <HeadCell align="right">Avg cost</HeadCell>
                                <HeadCell align="right">Value</HeadCell>
                                <HeadCell>Last move</HeadCell>
                                <HeadCell>Status</HeadCell>
                                <HeadCell>Actions</HeadCell>
                              </tr>
                            </thead>
                            <tbody>
                              {loc.items.map((it) => (
                                <tr key={it.id} className="transition hover:bg-white/5">
                                  <BodyCell>
                                    <div
                                      className="font-medium"
                                      style={{ color: 'var(--aurora-text)' }}
                                    >
                                      {it.product.name}
                                    </div>
                                    <div
                                      className="text-[11px] font-mono"
                                      style={{ color: 'var(--aurora-text-muted)' }}
                                    >
                                      {it.product.sku ?? 'No SKU'}
                                    </div>
                                  </BodyCell>
                                  <BodyCell align="right" mono>
                                    {fmtUnits(it.quantityOnHand)}
                                  </BodyCell>
                                  <BodyCell align="right" mono muted>
                                    {fmtUnits(it.quantityReserved)}
                                  </BodyCell>
                                  <BodyCell align="right" mono strong>
                                    {fmtUnits(it.quantityAvailable)}
                                  </BodyCell>
                                  <BodyCell align="right" mono muted>
                                    {fmt(it.averageCost)}
                                  </BodyCell>
                                  <BodyCell align="right" mono>
                                    {fmt(it.totalValue)}
                                  </BodyCell>
                                  <BodyCell muted>{formatMovement(it.lastMovementAt)}</BodyCell>
                                  <BodyCell>
                                    <StatusChip
                                      tone={
                                        it.status === 'OUT'
                                          ? 'danger'
                                          : it.status === 'LOW'
                                            ? 'warn'
                                            : 'good'
                                      }
                                    >
                                      {it.status}
                                    </StatusChip>
                                  </BodyCell>
                                  <BodyCell>
                                    <div className="flex items-center gap-2">
                                      <LinkText
                                        href={productActionHref('/westsides/product-batches', it)}
                                      >
                                        Batches
                                      </LinkText>
                                      <LinkText
                                        href={productActionHref('/westsides/stock-damage', it)}
                                      >
                                        Damage
                                      </LinkText>
                                      <LinkText
                                        href={buildHref('/westsides/reports', {
                                          search: it.product.sku ?? it.product.name,
                                        })}
                                      >
                                        Reports
                                      </LinkText>
                                    </div>
                                  </BodyCell>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <p className="text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
            Threshold currently {data.lowThreshold}. Items at or below this count flag as LOW; zero
            stock flags OUT.
          </p>
        </>
      )}

      {loading && !data && <PageSpinner />}

      {!data && !loading && !error && (
        <EmptyState
          title="Select a company to start"
          detail="Live inventory loads after a company is selected. Add a branch filter for location-specific decisions."
        />
      )}
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function ActionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition hover:border-brand-500"
      style={{
        borderColor: 'var(--aurora-border)',
        background: 'var(--aurora-bg-subtle)',
        color: 'var(--aurora-text)',
      }}
    >
      {children}
    </Link>
  );
}

function FilterField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`block ${className ?? ''}`}>
      <span
        className="mb-1 block text-[11px] font-semibold uppercase"
        style={{ color: 'var(--aurora-text-muted)' }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function ScopeFact({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <div
        className="text-[11px] font-semibold uppercase"
        style={{ color: 'var(--aurora-text-muted)' }}
      >
        {label}
      </div>
      <div
        className="mt-1 truncate text-sm font-medium"
        style={{ color: muted ? 'var(--aurora-text-muted)' : 'var(--aurora-text)' }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function PanelHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3"
      style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}
    >
      <div>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

function MetricPanel({
  label,
  value,
  detail,
  tone,
  progress,
}: {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
  progress: number;
}) {
  const accent =
    tone === 'danger'
      ? 'var(--aurora-danger)'
      : tone === 'warn'
        ? 'var(--aurora-warning)'
        : tone === 'good'
          ? 'var(--aurora-success)'
          : tone === 'info'
            ? 'var(--aurora-info)'
            : 'var(--aurora-text-muted)';
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="h-1.5" style={{ background: accent }} />
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div
            className="text-[11px] font-semibold uppercase"
            style={{ color: 'var(--aurora-text-muted)' }}
          >
            {label}
          </div>
          <StatusChip tone={tone}>{Math.round(progress)}%</StatusChip>
        </div>
        <div
          className="mt-2 text-xl font-bold leading-tight"
          style={{ color: 'var(--aurora-text)' }}
        >
          {value}
        </div>
        <div className="mt-1 text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
          {detail}
        </div>
        <div
          className="mt-3 h-2 overflow-hidden rounded-full"
          style={{ background: 'var(--aurora-bg-subtle)' }}
          aria-hidden="true"
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(100, progress)}%`, background: accent }}
          />
        </div>
      </div>
    </Card>
  );
}

function MiniMeasure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div
        className="text-[10px] font-semibold uppercase"
        style={{ color: 'var(--aurora-text-muted)' }}
      >
        {label}
      </div>
      <div
        className={`mt-0.5 whitespace-nowrap text-xs tabular-nums ${strong ? 'font-semibold' : 'font-medium'}`}
        style={{ color: strong ? 'var(--aurora-text)' : 'var(--aurora-text-secondary)' }}
      >
        {value}
      </div>
    </div>
  );
}

function ActionPanel({
  title,
  body,
  href,
  cta,
  tone,
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
  tone: Tone;
}) {
  const accent =
    tone === 'danger'
      ? 'var(--aurora-danger)'
      : tone === 'warn'
        ? 'var(--aurora-warning)'
        : tone === 'good'
          ? 'var(--aurora-success)'
          : tone === 'info'
            ? 'var(--aurora-info)'
            : 'var(--aurora-text-muted)';
  return (
    <div
      className="border-l-2 py-2 pl-3"
      style={{
        borderLeftColor: accent,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
            {title}
          </div>
          <div
            className="mt-1 text-xs leading-relaxed"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            {body}
          </div>
        </div>
        <StatusChip tone={tone}>Action</StatusChip>
      </div>
      <LinkText href={href} className="mt-3 inline-flex">
        {cta}
      </LinkText>
    </div>
  );
}

function ReadinessCard({ check }: { check: ReadinessCheck }) {
  return (
    <div
      className="rounded-lg border p-3"
      style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold" style={{ color: 'var(--aurora-text)' }}>
            {check.label}
          </div>
          <p
            className="mt-1 text-xs leading-relaxed"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            {check.detail}
          </p>
        </div>
        <StatusChip tone={check.tone}>{check.status}</StatusChip>
      </div>
      {check.actionHref && check.actionLabel && (
        <LinkText href={check.actionHref} className="mt-3 inline-flex">
          {check.actionLabel}
        </LinkText>
      )}
    </div>
  );
}

function RecoveryState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="border-red-500/30 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold" style={{ color: 'var(--aurora-danger-text)' }}>
            {title}
          </div>
          <p
            className="mt-1 max-w-3xl text-xs leading-relaxed"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            {detail}
          </p>
        </div>
        {action}
      </div>
    </Card>
  );
}

function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="p-8 text-center text-sm">
      <div className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
        {title}
      </div>
      <p
        className="mx-auto mt-1 max-w-xl text-xs leading-relaxed"
        style={{ color: 'var(--aurora-text-muted)' }}
      >
        {detail}
      </p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </Card>
  );
}

function InlineEmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-10 text-center text-sm">
      <div className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
        {title}
      </div>
      <p
        className="mx-auto mt-1 max-w-xl text-xs leading-relaxed"
        style={{ color: 'var(--aurora-text-muted)' }}
      >
        {detail}
      </p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

function LinkText({
  href,
  children,
  className = '',
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`text-xs font-semibold transition hover:underline ${className}`}
      style={{ color: 'var(--aurora-primary-text)' }}
    >
      {children}
    </Link>
  );
}

function HeadCell({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className={`border-b px-4 py-2 text-xs font-semibold uppercase tracking-wide ${align === 'right' ? 'text-right' : 'text-left'}`}
      style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-muted)' }}
    >
      {children}
    </th>
  );
}

function BodyCell({
  children,
  align = 'left',
  muted,
  mono,
  strong,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  muted?: boolean;
  mono?: boolean;
  strong?: boolean;
}) {
  return (
    <td
      className={`border-b px-4 py-2 align-middle ${align === 'right' ? 'text-right' : 'text-left'} ${mono ? 'tabular-nums' : ''} ${strong ? 'font-semibold' : ''}`}
      style={{
        borderColor: 'var(--aurora-border)',
        color: muted ? 'var(--aurora-text-secondary)' : 'var(--aurora-text)',
      }}
    >
      {children}
    </td>
  );
}

function StatusChip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const cls =
    tone === 'danger'
      ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100'
        : tone === 'good'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-100'
          : tone === 'info'
            ? 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/40 dark:bg-cyan-500/15 dark:text-cyan-100'
            : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-500/40 dark:bg-slate-500/10 dark:text-slate-200';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}
    >
      {children}
    </span>
  );
}
