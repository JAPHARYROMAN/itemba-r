'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import {
  AppIcon,
  Btn,
  Card,
  FormSelect,
  PageHeader,
  PageSpinner,
  SkeletonCardGrid,
  showToast,
} from '@/components/ui';
import type { AppIconName } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useAuth } from '@/hooks/use-auth';

type NumericValue = number | string | null | undefined;
type Tone = 'neutral' | 'good' | 'warn' | 'danger' | 'info' | 'brand';

interface Cockpit {
  asOf?: string;
  kpis?: {
    todaySales?: NumericValue;
    todayCount?: NumericValue;
    avgTicket?: NumericValue;
    cashCollected?: NumericValue;
    outstandingAR?: NumericValue;
    openFoliosCount?: NumericValue;
    openFoliosTotal?: NumericValue;
    dailyCloseScore?: NumericValue;
    actionsCritical?: NumericValue;
  };
  yesterday?: { sales?: NumericValue; count?: NumericValue; deltaPct?: NumericValue };
  byDivision?: Array<{
    divisionId?: string | null;
    name?: string | null;
    code?: string | null;
    count?: NumericValue;
    revenue?: NumericValue;
  }>;
  stock?: {
    outOfStock?: NumericValue;
    lowStock?: NumericValue;
    criticalSkus?: CriticalSku[];
  };
  rooms?: {
    total?: NumericValue;
    occupied?: NumericValue;
    available?: NumericValue;
    dirty?: NumericValue;
    outOfOrder?: NumericValue;
    occupancyRate?: NumericValue;
    inHouseGuests?: NumericValue;
  };
  arAging?: {
    current?: NumericValue;
    days1to30?: NumericValue;
    days31to60?: NumericValue;
    days61to90?: NumericValue;
    days90plus?: NumericValue;
    overdueCount?: NumericValue;
    overdueAmount?: NumericValue;
  };
  topSalespersons?: Array<{
    id?: string | null;
    name?: string | null;
    count?: NumericValue;
    revenue?: NumericValue;
  }>;
  topProducts?: Array<{
    productId?: string;
    name?: string;
    sku?: string | null;
    quantity?: NumericValue;
    revenue?: NumericValue;
  }>;
  activity?: {
    recentSales?: ActivityItem[];
    recentCharges?: ActivityItem[];
  };

  // Deeper command-center sections returned by the Westsides cockpit API.
  management?: {
    exceptions?: ManagementException[];
    actions?: ManagementAction[];
  };
  exceptions?: ManagementException[];
  actions?: ManagementAction[];
  salesHealth?: OptionalHealth & {
    today?: {
      orders?: NumericValue;
      netSales?: NumericValue;
      paidAmount?: NumericValue;
      outstandingAmount?: NumericValue;
      grossMargin?: NumericValue;
      grossMarginPct?: NumericValue;
    };
    monthToDate?: {
      orders?: NumericValue;
      netSales?: NumericValue;
      paidAmount?: NumericValue;
      outstandingAmount?: NumericValue;
      grossMargin?: NumericValue;
      grossMarginPct?: NumericValue;
    };
    cash?: {
      collectedToday?: NumericValue;
      activeCashAccounts?: NumericValue;
      totalCashAccountBalance?: NumericValue;
    };
    credit?: {
      creditSalesToday?: NumericValue;
      creditOrdersToday?: NumericValue;
      creditOutstandingToday?: NumericValue;
      overdueAR?: NumericValue;
      overdueCount?: NumericValue;
      overduePct?: NumericValue;
    };
  };
  cashHealth?: OptionalHealth;
  creditHealth?: OptionalHealth;
  stockRisk?: OptionalHealth & {
    outOfStock?: NumericValue;
    outOfStockCount?: NumericValue;
    lowStock?: NumericValue;
    lowStockCount?: NumericValue;
    negativeStockCount?: NumericValue;
    expiringBatches?: NumericValue;
    pendingDamage?: NumericValue;
    valueAtRisk?: NumericValue;
    reorderRequired?: NumericValue;
    variances?: NumericValue;
    inventoryValue?: NumericValue;
    expiry?: {
      expiringSoonCount?: NumericValue;
      expiredActiveCount?: NumericValue;
    };
    damage?: {
      pendingCount?: NumericValue;
      pendingEstimatedValue?: NumericValue;
    };
    reorder?: {
      exposureCount?: NumericValue;
      exposureValue?: NumericValue;
    };
  };
  deliveryHealth?: OptionalHealth & {
    pending?: NumericValue;
    overdue?: NumericValue;
    dispatched?: NumericValue;
    onTimeRate?: NumericValue;
  };
  fulfillment?: {
    ordersAwaitingDelivery?: NumericValue;
    status?: string;
    deliveries?: {
      draft?: NumericValue;
      dispatched?: NumericValue;
      delivered?: NumericValue;
      partiallyDelivered?: NumericValue;
      overdue?: NumericValue;
      dueToday?: NumericValue;
      deliveredToday?: NumericValue;
    };
  };
  pricingHealth?: OptionalHealth & {
    activePriceLists?: NumericValue;
    activeAgreements?: NumericValue;
    expiringAgreements?: NumericValue;
    exceptions?: NumericValue;
    marginAlerts?: NumericValue;
  };
  pricing?: {
    status?: string;
    priceLists?: {
      active?: NumericValue;
      activeButPastEffectiveTo?: NumericValue;
      expiringSoon?: NumericValue;
      productsMissingPrice?: NumericValue;
      productCoveragePct?: NumericValue;
    };
    customerAgreements?: {
      active?: NumericValue;
      expiringSoon?: NumericValue;
      unapprovedActive?: NumericValue;
    };
    discounts?: {
      discountedOrdersToday?: NumericValue;
      discountAmountToday?: NumericValue;
      discountRateToday?: NumericValue;
    };
  };
  dailyClose?: OptionalHealth & {
    date?: string;
    status?: string;
    score?: NumericValue;
    blockers?: NumericValue;
    warnings?: NumericValue;
    lastClosedAt?: string;
    openItems?: NumericValue;
    variance?: NumericValue;
    expected?: {
      salesCount?: NumericValue;
      totalSales?: NumericValue;
      paidAmount?: NumericValue;
      outstandingAmount?: NumericValue;
    };
    exceptions?: Record<string, NumericValue | string | boolean | null | undefined>;
    checks?: ReadinessCheck[];
    actions?: ManagementAction[];
    sourceLinks?: ReadinessSourceLink[];
    sources?: ReadinessSourceLink[];
  };
  readiness?: {
    status?: string;
    score?: NumericValue;
    blockers?: NumericValue;
    warnings?: NumericValue;
    summary?: string;
    checks?: ReadinessCheck[];
    checklist?: ReadinessCheck[];
    actions?: ManagementAction[];
    sourceLinks?: ReadinessSourceLink[];
    sources?: ReadinessSourceLink[];
  };
  customerRisk?: OptionalHealth & {
    overdueCustomers?: NumericValue;
    customersOnHold?: NumericValue;
    inactiveCustomers?: NumericValue;
    highExposure?: NumericValue;
  };
  customerCreditRisk?: {
    status?: string;
    outstandingAmount?: NumericValue;
    openReceivables?: NumericValue;
    overdueAmount?: NumericValue;
    overdueCount?: NumericValue;
    overduePct?: NumericValue;
    blockedCustomers?: NumericValue;
    highRiskProfiles?: NumericValue;
    reviewProfiles?: NumericValue;
    customersOverLimit?: NumericValue;
    overLimitAmount?: NumericValue;
  };
  pipeline?: {
    activeQuotations?: NumericValue;
    activeQuotationValue?: NumericValue;
    expiringQuotationsNext7Days?: NumericValue;
    activeProformas?: NumericValue;
  };
  pendingDeliveries?: NumericValue;
  activeQuotations?: NumericValue;
  expiringBatches?: NumericValue;
  pendingStockDamage?: NumericValue;
  creditReceivables?: NumericValue;
}

interface OptionalHealth {
  status?: string;
  statusLabel?: string;
  label?: string;
  note?: string;
  href?: string;
  count?: NumericValue;
  amount?: NumericValue;
  value?: NumericValue;
  target?: NumericValue;
  variance?: NumericValue;
  exceptions?: NumericValue;
  openItems?: NumericValue;
  overdue?: NumericValue;
  trendPct?: NumericValue;
  cashSales?: NumericValue;
  creditSales?: NumericValue;
  openOrders?: NumericValue;
  expected?: NumericValue;
  collected?: NumericValue;
  bankingPending?: NumericValue;
  drawersOpen?: NumericValue;
  creditLimitBreaches?: NumericValue;
  customersOnHold?: NumericValue;
}

interface CriticalSku {
  productId?: string;
  productName?: string;
  sku?: string | null;
  locationName?: string;
  quantityOnHand?: NumericValue;
}

interface ActivityItem {
  id: string;
  kind: 'SALE' | 'FOLIO_CHARGE' | string;
  when: string;
  headline: string;
  subline: string;
  amount: NumericValue;
}

interface ManagementException {
  id?: string;
  title?: string;
  label?: string;
  description?: string;
  message?: string;
  severity?: string;
  tone?: Tone;
  href?: string;
  owner?: string;
  dueAt?: string;
  value?: NumericValue;
}

interface ManagementAction {
  id?: string;
  label?: string;
  title?: string;
  message?: string;
  description?: string;
  suggestedAction?: string;
  href?: string;
  tone?: Tone;
  priority?: string;
  severity?: string;
  category?: string;
  count?: NumericValue;
  amount?: NumericValue;
}

interface ReadinessCheck {
  key?: string;
  id?: string;
  title?: string;
  label?: string;
  status?: string;
  score?: NumericValue;
  message?: string;
  description?: string;
  details?: Record<string, NumericValue | string | boolean | null | undefined>;
  href?: string;
  sourceHref?: string;
  sourceLabel?: string;
}

interface ReadinessSourceLink {
  label?: string;
  title?: string;
  href?: string;
  description?: string;
  count?: NumericValue;
  tone?: Tone;
}

interface MiniMetric {
  label: string;
  value: string;
  tone?: Tone;
}

interface HealthBlockData {
  title: string;
  status: string;
  tone: Tone;
  value: string;
  summary: string;
  href?: string;
  metrics: MiniMetric[];
}

interface RiskLaneData {
  title: string;
  status: string;
  tone: Tone;
  href: string;
  value: string;
  label: string;
  note: string;
  metrics: MiniMetric[];
}

interface ReadinessChecklistItem {
  id: string;
  title: string;
  status: string;
  score: number;
  tone: Tone;
  message: string;
  href: string;
  details: MiniMetric[];
}

interface ReadinessActionItem {
  id: string;
  title: string;
  description: string;
  href: string;
  tone: Tone;
  count?: NumericValue;
}

interface ReadinessModel {
  status: string;
  score: number;
  tone: Tone;
  blockers: number;
  warnings: number;
  summary: string;
  lastClosedLabel: string;
  sourceCoverage: string;
  checklist: ReadinessChecklistItem[];
  actions: ReadinessActionItem[];
  sources: Array<
    Required<Pick<ReadinessSourceLink, 'href'>> & {
      label: string;
      description: string;
      tone: Tone;
      count?: NumericValue;
    }
  >;
  metrics: MiniMetric[];
}

const QUICK_LINKS = [
  { label: 'Quick Sale', href: '/westsides/quick-sale', tone: 'good', group: 'Sell', icon: 'pos' },
  { label: 'Sales Orders', href: '/operations/sales-orders', tone: 'neutral', group: 'Sell', icon: 'order' },
  { label: 'Customers', href: '/westsides/customers', tone: 'brand', group: 'Sell', icon: 'customers' },
  { label: 'Quotations', href: '/westsides/quotations', tone: 'neutral', group: 'Pipeline & pricing', icon: 'quotation' },
  { label: 'Price Lists', href: '/westsides/price-lists', tone: 'info', group: 'Pipeline & pricing', icon: 'calculator' },
  { label: 'Live Inventory', href: '/westsides/inventory/live', tone: 'info', group: 'Stock & fulfilment', icon: 'inventory' },
  { label: 'Product Batches', href: '/westsides/product-batches', tone: 'warn', group: 'Stock & fulfilment', icon: 'product' },
  { label: 'Delivery Notes', href: '/westsides/delivery-notes', tone: 'neutral', group: 'Stock & fulfilment', icon: 'delivery' },
  { label: 'Daily Close', href: '/westsides/daily-close', tone: 'warn', group: 'Control & insight', icon: 'done' },
  { label: 'Stock Damage', href: '/westsides/stock-damage', tone: 'danger', group: 'Control & insight', icon: 'alert' },
  { label: 'Reports', href: '/westsides/reports', tone: 'brand', group: 'Control & insight', icon: 'report' },
] as const satisfies readonly {
  label: string;
  href: string;
  tone: Tone;
  group: string;
  icon: AppIconName;
}[];

/** Quick links grouped for rendering, preserving declaration order. */
const QUICK_LINK_GROUPS = [...new Set(QUICK_LINKS.map((link) => link.group))].map(
  (group) => [group, QUICK_LINKS.filter((link) => link.group === group)] as const,
);

const SETTINGS_KEY = 'itemba.cockpit.settings.v1';

const TEXT: CSSProperties = { color: 'var(--aurora-text)' };
const TEXT_SECONDARY: CSSProperties = { color: 'var(--aurora-text-secondary)' };
const TEXT_MUTED: CSSProperties = { color: 'var(--aurora-text-muted)' };
const BORDER: CSSProperties = { borderColor: 'var(--aurora-border)' };
const SURFACE: CSSProperties = {
  background: 'var(--aurora-bg-subtle)',
  borderColor: 'var(--aurora-border)',
};
const ELEVATED_SURFACE: CSSProperties = {
  background: 'var(--aurora-card-elevated)',
  borderColor: 'var(--aurora-border)',
};

const TONE_STYLES: Record<
  Tone,
  { color: string; background: string; border: string; solid: string }
> = {
  neutral: {
    color: 'var(--aurora-text-secondary)',
    background: 'var(--aurora-bg-subtle)',
    border: 'var(--aurora-border)',
    solid: 'var(--aurora-text-muted)',
  },
  good: {
    color: 'var(--aurora-success-text)',
    background: 'var(--aurora-success-bg)',
    border: 'var(--aurora-success)',
    solid: 'var(--aurora-success)',
  },
  warn: {
    color: 'var(--aurora-warning-text)',
    background: 'var(--aurora-warning-bg)',
    border: 'var(--aurora-warning)',
    solid: 'var(--aurora-warning)',
  },
  danger: {
    color: 'var(--aurora-danger-text)',
    background: 'var(--aurora-danger-bg)',
    border: 'var(--aurora-danger)',
    solid: 'var(--aurora-danger)',
  },
  info: {
    color: 'var(--aurora-info-text)',
    background: 'var(--aurora-info-bg)',
    border: 'var(--aurora-info)',
    solid: 'var(--aurora-info)',
  },
  brand: {
    color: 'var(--aurora-primary-text)',
    background: 'var(--aurora-primary-subtle)',
    border: 'var(--aurora-primary)',
    solid: 'var(--aurora-primary)',
  },
};

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

  useEffect(() => {
    if (authLoading) return;
    try {
      const raw = user?.id ? localStorage.getItem(`${SETTINGS_KEY}.${user.id}`) : null;
      if (raw) {
        const settings = JSON.parse(raw) as { companyId?: string; branchId?: string };
        if (settings.companyId) setCompanyId(settings.companyId);
        if (settings.branchId) setBranchId(settings.branchId);
      }
      // eslint-disable-next-line no-restricted-syntax -- local settings cache is convenience-only; a corrupt/blocked cache must not break the cockpit and the defaults already apply
    } catch {
      // Local settings are convenience-only.
    }
    setHydrated(true);
  }, [authLoading, user?.id]);

  useEffect(() => {
    if (!hydrated || !user?.id) return;
    try {
      localStorage.setItem(`${SETTINGS_KEY}.${user.id}`, JSON.stringify({ companyId, branchId }));
      // eslint-disable-next-line no-restricted-syntax -- persisting the settings cache is best-effort; blocked/full storage must not break the cockpit
    } catch {
      // Local settings are convenience-only.
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
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      const body = await res.json();
      setData((body.data ?? body) || null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Load failed';
      setError(message);
      showToast('error', 'Westsides cockpit unavailable', message);
    } finally {
      setLoading(false);
    }
  }, [companyId, branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!hydrated || !autoRefresh || !companyId) return;
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [autoRefresh, companyId, hydrated, load]);

  const model = useMemo(() => (data ? buildCockpitModel(data) : null), [data]);

  if (!hydrated) return <PageSpinner />;

  return (
    <div className="p-4 sm:p-6 space-y-4 min-w-0">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="Westsides Command Center"
          subtitle="Commercial, stock, credit, and fulfilment control."
        />
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-full sm:w-52">
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
          <div className="w-full sm:w-44">
            <FormSelect
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              options={branchOptions}
              placeholder={companyId ? 'All branches' : 'Pick company'}
            />
          </div>
          <label
            className="text-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            style={TEXT_SECONDARY}
          >
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto 30s
          </label>
          <Btn variant="primary" size="sm" onClick={load} disabled={!companyId} loading={loading}>
            Refresh
          </Btn>
        </div>
      </div>

      {error && (
        <StatusPanel tone="danger">
          <span className="font-semibold">Cockpit load failed.</span> {error}
        </StatusPanel>
      )}

      {!companyId && !loading && (
        <Card padding="none" className="p-8 text-center">
          <div className="text-sm" style={TEXT_SECONDARY}>
            Pick a company to load the Westsides operating picture.
          </div>
        </Card>
      )}

      {companyId && loading && !model && (
        <SkeletonCardGrid
          count={8}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8"
        />
      )}

      {model && (
        <>
          <section className="aurora-stagger grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
            <KpiTile
              label="Revenue today"
              value={formatMoney(model.todaySales, true)}
              hint={`${formatCount(model.todayCount)} sale${model.todayCount === 1 ? '' : 's'} | ${formatMoney(model.todaySales)} exact`}
              tone="brand"
            />
            <KpiTile
              label="Day movement"
              value={formatDelta(model.deltaPct)}
              hint={`Yesterday ${formatMoney(model.yesterdaySales, true)}`}
              tone={model.deltaTone}
            />
            <KpiTile
              label="Average ticket"
              value={formatMoney(model.avgTicket, true)}
              hint={`${formatCount(model.yesterdayCount)} sale${model.yesterdayCount === 1 ? '' : 's'} yesterday`}
              tone="neutral"
            />
            <KpiTile
              label="Cash collected"
              value={formatMoney(model.cashCollected, true)}
              hint={`${formatPercent(model.cashCollectionRate)} of today's revenue`}
              tone={model.cashCollectionRate >= 75 || model.todaySales === 0 ? 'good' : 'warn'}
            />
            <KpiTile
              label="Credit exposure"
              value={formatMoney(model.outstandingAR, true)}
              hint={`${formatMoney(model.overdueAmount, true)} overdue`}
              tone={model.overdueAmount > 0 ? 'warn' : 'good'}
            />
            <KpiTile
              label="Stock alerts"
              value={formatCount(model.stockAlertCount)}
              hint={`${formatCount(model.outOfStock)} out | ${formatCount(model.lowStock)} low`}
              tone={model.outOfStock > 0 ? 'danger' : model.lowStock > 0 ? 'warn' : 'good'}
            />
          </section>

          <ReadinessCommandPanel readiness={model.readiness} />

          <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Card padding="none" className="xl:col-span-2 overflow-hidden">
              <SectionHeader
                eyebrow="Management"
                title="Exceptions and action queue"
                subtitle={`${formatCount(model.exceptions.length)} exception${model.exceptions.length === 1 ? '' : 's'} surfaced for today's operating review`}
              />
              <div className="grid grid-cols-1 lg:grid-cols-2">
                <div
                  className="p-4 space-y-3"
                  style={{ borderRight: '1px solid var(--aurora-border)' }}
                >
                  <Subheading title="Exceptions" />
                  {model.exceptions.length === 0 ? (
                    <EmptyLine text="No active cockpit exceptions." tone="good" />
                  ) : (
                    <div className="space-y-2">
                      {model.exceptions.map((item) => (
                        <ExceptionRow key={item.id} item={item} />
                      ))}
                    </div>
                  )}
                </div>
                <div className="p-4 space-y-3">
                  <Subheading title="Management actions" />
                  <div className="space-y-2">
                    {model.actions.map((action) => (
                      <ActionLink key={action.id} action={action} />
                    ))}
                  </div>
                </div>
              </div>
            </Card>

            <Card padding="none" className="overflow-hidden">
              <SectionHeader
                eyebrow="Close control"
                title="Cash, credit, and close posture"
                subtitle={model.closeNarrative}
              />
              <div className="p-4 space-y-3">
                <ControlLine
                  label="Cash collection rate"
                  value={formatPercent(model.cashCollectionRate)}
                  tone={model.cashCollectionRate >= 75 || model.todaySales === 0 ? 'good' : 'warn'}
                />
                <ControlLine
                  label="Overdue AR"
                  value={formatMoney(model.overdueAmount, true)}
                  tone={model.overdueAmount > 0 ? 'warn' : 'good'}
                />
                <ControlLine
                  label="90+ day exposure"
                  value={formatMoney(model.ar.days90plus, true)}
                  tone={model.ar.days90plus > 0 ? 'danger' : 'good'}
                />
                <ControlLine
                  label="Daily close open items"
                  value={formatCount(model.dailyCloseOpenItems)}
                  tone={model.dailyCloseOpenItems > 0 ? 'warn' : 'neutral'}
                />
              </div>
            </Card>
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Card padding="none" className="xl:col-span-2 overflow-hidden">
              <SectionHeader
                eyebrow="Commercial health"
                title="Sales, cash, and credit"
                subtitle="Real-time trading posture using confirmed orders, collections, and receivables."
              />
              <div className="grid grid-cols-1 lg:grid-cols-3">
                {model.healthBlocks.map((block) => (
                  <HealthBlock key={block.title} block={block} />
                ))}
              </div>
            </Card>

            <Card padding="none" className="overflow-hidden">
              <SectionHeader
                eyebrow="AR aging"
                title="Credit aging"
                subtitle={`${formatCount(model.overdueCount)} overdue invoice${model.overdueCount === 1 ? '' : 's'}`}
              />
              <div className="p-4 space-y-3">
                {model.arBuckets.map((bucket) => (
                  <AgingBucket
                    key={bucket.label}
                    label={bucket.label}
                    amount={bucket.amount}
                    total={model.outstandingAR}
                    tone={bucket.tone}
                  />
                ))}
              </div>
            </Card>
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Card padding="none" className="overflow-hidden">
              <SectionHeader
                eyebrow="Stock risk"
                title="Availability and shrinkage"
                subtitle={`${formatCount(model.criticalSkus.length)} critical SKU${model.criticalSkus.length === 1 ? '' : 's'} in the watchlist`}
                action={<TextLink href="/westsides/inventory/live">Live inventory</TextLink>}
              />
              <div className="grid grid-cols-2 sm:grid-cols-4" style={BORDER}>
                <InlineStat label="Out" value={formatCount(model.outOfStock)} tone="danger" />
                <InlineStat label="Low" value={formatCount(model.lowStock)} tone="warn" />
                <InlineStat
                  label="Expiring"
                  value={formatCount(model.expiringBatches)}
                  tone={model.expiringBatches > 0 ? 'warn' : 'neutral'}
                />
                <InlineStat
                  label="Damage"
                  value={formatCount(model.pendingStockDamage)}
                  tone={model.pendingStockDamage > 0 ? 'danger' : 'neutral'}
                />
              </div>
              <div className="p-4">
                {model.criticalSkus.length === 0 ? (
                  <EmptyLine text="No critical SKUs returned by the cockpit." tone="good" />
                ) : (
                  <div className="space-y-2">
                    {model.criticalSkus.slice(0, 6).map((sku, index) => (
                      <CriticalSkuRow
                        key={`${sku.productId ?? sku.sku ?? index}-${index}`}
                        sku={sku}
                      />
                    ))}
                  </div>
                )}
              </div>
            </Card>

            <Card padding="none" className="xl:col-span-2 overflow-hidden">
              <SectionHeader
                eyebrow="Risk board"
                title="Delivery, pricing, daily close, and customer risk"
                subtitle="Operational lanes stay visible even when the backend has not yet added deeper detail."
              />
              <div className="grid grid-cols-1 md:grid-cols-2">
                {model.riskLanes.map((lane) => (
                  <RiskLane key={lane.title} lane={lane} />
                ))}
              </div>
            </Card>
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-5 gap-4">
            <Card padding="none" className="xl:col-span-2 overflow-hidden">
              <SectionHeader
                eyebrow="Revenue mix"
                title="Division performance"
                subtitle={`${formatCount(model.byDivision.length)} division${model.byDivision.length === 1 ? '' : 's'} contributing today`}
              />
              <div className="p-4 space-y-3">
                {model.byDivision.length === 0 ? (
                  <EmptyLine text="No division revenue yet today." tone="neutral" />
                ) : (
                  model.byDivision.map((division) => (
                    <DivisionRow
                      key={division.divisionId ?? division.name ?? 'unassigned'}
                      division={division}
                      total={model.todaySales}
                    />
                  ))
                )}
              </div>
            </Card>

            <Card padding="none" className="overflow-hidden">
              <SectionHeader
                eyebrow="People"
                title="Top salespersons"
                subtitle="Ranked by today's revenue."
              />
              <RankingList
                emptyText="No salespersons ranked yet."
                items={model.topSalespersons.map((person) => ({
                  id: person.id ?? person.name ?? 'unassigned',
                  title: person.name ?? 'Unattributed',
                  meta: `${formatCount(person.count)} sale${toNumber(person.count) === 1 ? '' : 's'}`,
                  value: formatMoney(person.revenue, true),
                }))}
              />
            </Card>

            <Card padding="none" className="overflow-hidden">
              <SectionHeader
                eyebrow="Products"
                title="Top products"
                subtitle="Fastest revenue movement today."
              />
              <RankingList
                emptyText="No products sold yet."
                items={model.topProducts.map((product) => ({
                  id: product.productId ?? product.name ?? 'unknown',
                  title: product.name ?? 'Unknown product',
                  meta: `${product.sku ?? 'No SKU'} | ${formatCount(product.quantity)} units`,
                  value: formatMoney(product.revenue, true),
                }))}
              />
            </Card>

          </section>

          <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Card padding="none" className="xl:col-span-2 overflow-hidden">
              <SectionHeader
                eyebrow="Activity"
                title="Live commercial activity"
                subtitle={`${formatCount(model.activityFeed.length)} recent event${model.activityFeed.length === 1 ? '' : 's'} from sales and folio charges`}
              />
              <ActivityFeed items={model.activityFeed} />
            </Card>

            <Card padding="none" className="overflow-hidden">
              <SectionHeader
                eyebrow="Actions"
                title="Quick actions"
                subtitle="Primary Westsides workflows."
              />
              <div className="p-4 space-y-4">
                {QUICK_LINK_GROUPS.map(([group, links]) => (
                  <div key={group}>
                    <div
                      className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide"
                      style={TEXT_MUTED}
                    >
                      {group}
                    </div>
                    <div className="aurora-stagger grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
                      {links.map((link) => (
                        <QuickAction key={link.href} link={link} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </section>

          <p className="text-[11px] text-right" style={TEXT_MUTED}>
            As of {model.asOfLabel}
            {autoRefresh ? ' | refreshing every 30s' : ''}.
          </p>
        </>
      )}
    </div>
  );
}

function buildCockpitModel(data: Cockpit) {
  const todaySales = toNumber(data.kpis?.todaySales);
  const todayCount = toNumber(data.kpis?.todayCount);
  const avgTicket = toNumber(data.kpis?.avgTicket);
  const cashCollected = toNumber(data.kpis?.cashCollected);
  const outstandingAR = firstNumber(data.kpis?.outstandingAR, data.creditReceivables);
  const openFoliosCount = toNumber(data.kpis?.openFoliosCount);
  const openFoliosTotal = toNumber(data.kpis?.openFoliosTotal);
  const yesterdaySales = toNumber(data.yesterday?.sales);
  const yesterdayCount = toNumber(data.yesterday?.count);
  const deltaPct = toNumber(data.yesterday?.deltaPct);
  const deltaTone: Tone =
    deltaPct >= 5 ? 'good' : deltaPct < -10 ? 'danger' : deltaPct < 0 ? 'warn' : 'neutral';

  const outOfStock = firstNumber(
    data.stock?.outOfStock,
    data.stockRisk?.outOfStock,
    data.stockRisk?.outOfStockCount,
  );
  const lowStock = firstNumber(
    data.stock?.lowStock,
    data.stockRisk?.lowStock,
    data.stockRisk?.lowStockCount,
  );
  const stockAlertCount = outOfStock + lowStock;
  const criticalSkus = asArray<CriticalSku>(data.stock?.criticalSkus);
  const expiringBatches = firstNumber(
    data.stockRisk?.expiringBatches,
    data.stockRisk?.expiry?.expiringSoonCount,
    data.expiringBatches,
  );
  const pendingStockDamage = firstNumber(
    data.stockRisk?.pendingDamage,
    data.stockRisk?.damage?.pendingCount,
    data.pendingStockDamage,
  );

  const rooms = {
    total: toNumber(data.rooms?.total),
    occupied: toNumber(data.rooms?.occupied),
    available: toNumber(data.rooms?.available),
    dirty: toNumber(data.rooms?.dirty),
    outOfOrder: toNumber(data.rooms?.outOfOrder),
    occupancyRate: toNumber(data.rooms?.occupancyRate),
    inHouseGuests: toNumber(data.rooms?.inHouseGuests),
  };

  const ar = {
    current: toNumber(data.arAging?.current),
    days1to30: toNumber(data.arAging?.days1to30),
    days31to60: toNumber(data.arAging?.days31to60),
    days61to90: toNumber(data.arAging?.days61to90),
    days90plus: toNumber(data.arAging?.days90plus),
  };
  const overdueCount = toNumber(data.arAging?.overdueCount);
  const overdueAmount = toNumber(data.arAging?.overdueAmount);
  const cashCollectionRate = percentage(cashCollected, todaySales);
  const closeItems =
    data.dailyClose !== undefined
      ? toNumber(data.dailyClose.blockers) + toNumber(data.dailyClose.warnings)
      : undefined;
  const dailyCloseOpenItems = firstNumber(data.dailyClose?.openItems, closeItems, openFoliosCount);
  const closeNarrative = data.dailyClose?.status
    ? `Daily close status: ${data.dailyClose.status}`
    : openFoliosTotal > 0
      ? `${formatMoney(openFoliosTotal, true)} remains unsettled in open folios.`
      : 'No close blockers returned by the cockpit.';

  const byDivision = asArray<NonNullable<Cockpit['byDivision']>[number]>(data.byDivision)
    .map((division) => ({
      ...division,
      count: toNumber(division.count),
      revenue: toNumber(division.revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const topSalespersons = asArray<NonNullable<Cockpit['topSalespersons']>[number]>(
    data.topSalespersons,
  ).map((person) => ({
    ...person,
    count: toNumber(person.count),
    revenue: toNumber(person.revenue),
  }));

  const topProducts = asArray<NonNullable<Cockpit['topProducts']>[number]>(data.topProducts).map(
    (product) => ({
      ...product,
      quantity: toNumber(product.quantity),
      revenue: toNumber(product.revenue),
    }),
  );

  const activityFeed = [
    ...asArray<ActivityItem>(data.activity?.recentSales),
    ...asArray<ActivityItem>(data.activity?.recentCharges),
  ]
    .sort((a, b) => safeDateMs(b.when) - safeDateMs(a.when))
    .slice(0, 14);

  const healthBlocks: HealthBlockData[] = [
    {
      title: 'Sales health',
      status: deltaPct >= 0 ? 'Trading stable' : deltaPct < -10 ? 'Revenue pressure' : 'Softening',
      tone: deltaTone,
      value: formatMoney(todaySales, true),
      summary: `${formatDelta(deltaPct)} vs yesterday across ${formatCount(todayCount)} sale${todayCount === 1 ? '' : 's'}.`,
      href: '/westsides/reports',
      metrics: compact([
        metric('Avg ticket', formatMoney(avgTicket, true)),
        metric('Yesterday', formatMoney(yesterdaySales, true)),
        optionalMetric('MTD sales', data.salesHealth?.monthToDate?.netSales, 'money'),
        optionalMetric('Margin', data.salesHealth?.today?.grossMarginPct, 'percent'),
        optionalMetric('Credit sales', data.salesHealth?.credit?.creditSalesToday, 'money'),
      ]),
    },
    {
      title: 'Cash health',
      status:
        cashCollectionRate >= 75 || todaySales === 0 ? 'Collection on track' : 'Collection gap',
      tone: cashCollectionRate >= 75 || todaySales === 0 ? 'good' : 'warn',
      value: formatMoney(cashCollected, true),
      summary: `${formatPercent(cashCollectionRate)} collected against today's revenue.`,
      href: '/westsides/daily-close',
      metrics: compact([
        optionalMetric('Expected', data.cashHealth?.expected, 'money'),
        optionalMetric(
          'Variance',
          data.cashHealth?.variance,
          'money',
          valueTone(data.cashHealth?.variance),
        ),
        optionalMetric('Banking pending', data.cashHealth?.bankingPending, 'money'),
        optionalMetric('Drawers open', data.cashHealth?.drawersOpen, 'count'),
        optionalMetric('Active accounts', data.salesHealth?.cash?.activeCashAccounts, 'count'),
        metric(
          'Open folios',
          formatMoney(openFoliosTotal, true),
          openFoliosTotal > 0 ? 'warn' : 'neutral',
        ),
      ]),
    },
    {
      title: 'Credit health',
      status: overdueAmount > 0 ? 'Collections required' : 'No overdue exposure',
      tone: overdueAmount > 0 ? 'warn' : 'good',
      value: formatMoney(outstandingAR, true),
      summary: `${formatMoney(overdueAmount, true)} overdue across ${formatCount(overdueCount)} invoice${overdueCount === 1 ? '' : 's'}.`,
      href: '/westsides/reports',
      metrics: compact([
        metric('Current', formatMoney(ar.current, true), 'good'),
        metric(
          '90+ days',
          formatMoney(ar.days90plus, true),
          ar.days90plus > 0 ? 'danger' : 'neutral',
        ),
        optionalMetric('Limit breaches', data.creditHealth?.creditLimitBreaches, 'count', 'danger'),
        optionalMetric(
          'Over limit',
          data.customerCreditRisk?.customersOverLimit,
          'count',
          'danger',
        ),
        optionalMetric('High exposure', data.customerCreditRisk?.overLimitAmount, 'money', 'warn'),
      ]),
    },
  ];

  const exceptions = buildExceptions(data, {
    outOfStock,
    lowStock,
    overdueAmount,
    overdueCount,
    deltaPct,
    openFoliosTotal,
    roomsDirty: rooms.dirty,
    roomsOutOfOrder: rooms.outOfOrder,
    pendingStockDamage,
    expiringBatches,
  });

  const actions = buildActions(data, {
    outOfStock,
    lowStock,
    overdueAmount,
    openFoliosTotal,
    pendingStockDamage,
    expiringBatches,
  });

  const readiness = buildReadinessModel(data, {
    todaySales,
    cashCollected,
    cashCollectionRate,
    outstandingAR,
    overdueAmount,
    overdueCount,
    outOfStock,
    lowStock,
    pendingStockDamage,
    expiringBatches,
    dailyCloseOpenItems,
    openFoliosTotal,
    actions,
    exceptions,
  });

  const riskLanes: RiskLaneData[] = [
    buildDeliveryLane(data),
    buildPricingLane(data),
    buildDailyCloseLane(data, { openFoliosCount, openFoliosTotal, dailyCloseOpenItems }),
    buildCustomerRiskLane(data, { overdueCount, overdueAmount, outstandingAR }),
  ];

  const arBuckets = [
    { label: 'Current', amount: ar.current, tone: 'good' as Tone },
    { label: '1-30 days', amount: ar.days1to30, tone: 'info' as Tone },
    { label: '31-60 days', amount: ar.days31to60, tone: 'warn' as Tone },
    { label: '61-90 days', amount: ar.days61to90, tone: 'warn' as Tone },
    { label: '90+ days', amount: ar.days90plus, tone: 'danger' as Tone },
  ];

  return {
    asOfLabel: formatAsOf(data.asOf),
    todaySales,
    todayCount,
    avgTicket,
    cashCollected,
    outstandingAR,
    openFoliosCount,
    openFoliosTotal,
    yesterdaySales,
    yesterdayCount,
    deltaPct,
    deltaTone,
    cashCollectionRate,
    overdueCount,
    overdueAmount,
    ar,
    arBuckets,
    outOfStock,
    lowStock,
    stockAlertCount,
    criticalSkus,
    expiringBatches,
    pendingStockDamage,
    rooms,
    dailyCloseOpenItems,
    closeNarrative,
    byDivision,
    topSalespersons,
    topProducts,
    activityFeed,
    healthBlocks,
    exceptions,
    actions,
    readiness,
    riskLanes,
  };
}

function buildReadinessModel(
  data: Cockpit,
  derived: {
    todaySales: number;
    cashCollected: number;
    cashCollectionRate: number;
    outstandingAR: number;
    overdueAmount: number;
    overdueCount: number;
    outOfStock: number;
    lowStock: number;
    pendingStockDamage: number;
    expiringBatches: number;
    dailyCloseOpenItems: number;
    openFoliosTotal: number;
    actions: Array<{
      id: string;
      label?: string;
      title?: string;
      description?: string;
      href: string;
      tone: Tone;
      count?: NumericValue;
    }>;
    exceptions: Array<{ tone: Tone }>;
  },
): ReadinessModel {
  const fallbackBlockers =
    (derived.outOfStock > 0 ? 1 : 0) +
    (derived.pendingStockDamage > 0 ? 1 : 0) +
    (derived.exceptions.some((item) => item.tone === 'danger') ? 1 : 0);
  const fallbackWarnings =
    (derived.lowStock > 0 ? 1 : 0) +
    (derived.expiringBatches > 0 ? 1 : 0) +
    (derived.overdueAmount > 0 ? 1 : 0) +
    (derived.openFoliosTotal > 0 ? 1 : 0);
  const blockers = firstNumber(
    data.readiness?.blockers,
    data.dailyClose?.blockers,
    fallbackBlockers,
  );
  const warnings = firstNumber(
    data.readiness?.warnings,
    data.dailyClose?.warnings,
    fallbackWarnings,
  );
  const fallbackScore = 100 - blockers * 18 - warnings * 4;
  const score = clampPercent(
    firstNumber(
      data.readiness?.score,
      data.dailyClose?.score,
      data.kpis?.dailyCloseScore,
      fallbackScore,
    ),
  );
  const status = formatReadinessStatus(
    data.readiness?.status ??
      data.dailyClose?.status ??
      (blockers > 0 ? 'BLOCKED' : warnings > 0 ? 'WARN' : score >= 90 ? 'READY' : 'WATCH'),
  );
  const tone = toneForReadiness(status, score, blockers, warnings);
  const backendChecks = [
    ...asArray<ReadinessCheck>(data.readiness?.checks),
    ...asArray<ReadinessCheck>(data.readiness?.checklist),
    ...asArray<ReadinessCheck>(data.dailyClose?.checks),
  ];
  const checklist =
    backendChecks.length > 0
      ? dedupeBy(
          backendChecks.map((check, index) => normalizeReadinessCheck(check, index)),
          (check) => check.id,
        ).slice(0, 6)
      : buildFallbackReadinessChecklist(derived);

  const backendActions = [
    ...asArray<ManagementAction>(data.readiness?.actions),
    ...asArray<ManagementAction>(data.dailyClose?.actions),
  ].map((action, index) => normalizeReadinessAction(action, index));
  const generatedActions = derived.actions.map((action) => ({
    id: action.id,
    title: action.label ?? action.title ?? 'Open action',
    description: action.description ?? '',
    href: action.href,
    tone: action.tone,
    count: action.count,
  }));
  const actions = dedupeBy([...backendActions, ...generatedActions], (action) => action.id).slice(
    0,
    5,
  );

  const backendSources = [
    ...asArray<ReadinessSourceLink>(data.readiness?.sourceLinks),
    ...asArray<ReadinessSourceLink>(data.readiness?.sources),
    ...asArray<ReadinessSourceLink>(data.dailyClose?.sourceLinks),
    ...asArray<ReadinessSourceLink>(data.dailyClose?.sources),
  ].map((source, index) => normalizeReadinessSource(source, index));
  const generatedSources: ReadinessModel['sources'] = [
    {
      label: 'Daily close',
      href: '/westsides/daily-close',
      description: 'Payment evidence, posting checks, and cash reconciliation.',
      tone,
      count: blockers + warnings,
    },
    {
      label: 'Live inventory',
      href: '/westsides/inventory/live',
      description: 'Stockouts, low stock, reservation pressure, and value at risk.',
      tone: derived.outOfStock > 0 ? 'danger' : derived.lowStock > 0 ? 'warn' : 'good',
      count: derived.outOfStock + derived.lowStock,
    },
    {
      label: 'Credit reports',
      href: '/westsides/reports',
      description: 'Receivables, overdue balances, customer risk, and sales evidence.',
      tone: derived.overdueAmount > 0 ? 'warn' : 'good',
      count: derived.overdueCount,
    },
    {
      label: 'Delivery notes',
      href: '/westsides/delivery-notes',
      description: 'Dispatch status and fulfilment follow-through.',
      tone: 'neutral',
    },
  ];
  const sources = dedupeBy([...backendSources, ...generatedSources], (source) => source.href).slice(
    0,
    6,
  );

  return {
    status,
    score,
    tone,
    blockers,
    warnings,
    summary:
      data.readiness?.summary ??
      (blockers > 0
        ? 'Production readiness is blocked until high-severity controls are cleared.'
        : warnings > 0
          ? 'Production readiness is above operating threshold, with warnings to clear before close.'
          : 'Production readiness is clear based on the current cockpit evidence.'),
    lastClosedLabel: data.dailyClose?.lastClosedAt
      ? formatShortDate(data.dailyClose.lastClosedAt)
      : 'Not closed today',
    sourceCoverage: `${formatCount(sources.length)} source link${sources.length === 1 ? '' : 's'} connected`,
    checklist,
    actions,
    sources,
    metrics: compact([
      metric('Blockers', formatCount(blockers), blockers > 0 ? 'danger' : 'good'),
      metric('Warnings', formatCount(warnings), warnings > 0 ? 'warn' : 'good'),
      metric(
        'Cash collected',
        formatMoney(derived.cashCollected, true),
        derived.cashCollectionRate >= 75 || derived.todaySales === 0 ? 'good' : 'warn',
      ),
      metric(
        'Credit exposure',
        formatMoney(derived.outstandingAR, true),
        derived.overdueAmount > 0 ? 'warn' : 'good',
      ),
      optionalMetric('Expected sales', data.dailyClose?.expected?.totalSales, 'money'),
      optionalMetric('Paid today', data.dailyClose?.expected?.paidAmount, 'money'),
    ]),
  };
}

function normalizeReadinessCheck(check: ReadinessCheck, index: number): ReadinessChecklistItem {
  const title =
    check.title ?? check.label ?? humanizeKey(check.key ?? check.id ?? `Check ${index + 1}`);
  const status = formatReadinessStatus(
    check.status ?? (toNumber(check.score) >= 90 ? 'READY' : 'WARN'),
  );
  const score = clampPercent(firstNumber(check.score, status === 'READY' ? 100 : 70));
  return {
    id: check.key ?? check.id ?? title.toLowerCase().replace(/\s+/g, '-'),
    title,
    status,
    score,
    tone: toneForReadiness(status, score, status === 'BLOCKED' ? 1 : 0, status === 'WARN' ? 1 : 0),
    message: check.message ?? check.description ?? 'Readiness check returned without detail.',
    href: check.href ?? check.sourceHref ?? hrefForReadinessCheck(check.key ?? check.id ?? title),
    details: detailsToMetrics(check.details),
  };
}

function buildFallbackReadinessChecklist(derived: {
  todaySales: number;
  cashCollectionRate: number;
  overdueAmount: number;
  overdueCount: number;
  outOfStock: number;
  lowStock: number;
  pendingStockDamage: number;
  expiringBatches: number;
  dailyCloseOpenItems: number;
  openFoliosTotal: number;
}): ReadinessChecklistItem[] {
  const stockScore = clampPercent(100 - derived.outOfStock * 25 - derived.lowStock * 5);
  const cashScore = derived.todaySales === 0 ? 100 : clampPercent(derived.cashCollectionRate);
  const creditScore = clampPercent(100 - derived.overdueCount * 8);
  const closeScore = clampPercent(
    100 -
      derived.dailyCloseOpenItems * 8 -
      (derived.openFoliosTotal > 0 ? 12 : 0) -
      derived.pendingStockDamage * 5,
  );

  return [
    {
      id: 'cash-evidence',
      title: 'Cash evidence',
      status: cashScore >= 90 || derived.todaySales === 0 ? 'READY' : 'WARN',
      score: cashScore,
      tone: cashScore >= 90 || derived.todaySales === 0 ? 'good' : 'warn',
      message:
        derived.todaySales === 0
          ? 'No trading volume yet, so cash evidence is clear by fallback.'
          : `${formatPercent(cashScore)} of today's revenue has been collected.`,
      href: '/westsides/daily-close',
      details: [metric('Collection', formatPercent(cashScore), cashScore >= 90 ? 'good' : 'warn')],
    },
    {
      id: 'stock-control',
      title: 'Stock control',
      status: stockScore >= 90 ? 'READY' : derived.outOfStock > 0 ? 'BLOCKED' : 'WARN',
      score: stockScore,
      tone: stockScore >= 90 ? 'good' : derived.outOfStock > 0 ? 'danger' : 'warn',
      message: `${formatCount(derived.outOfStock)} out-of-stock and ${formatCount(derived.lowStock)} low-stock items.`,
      href: '/westsides/inventory/live',
      details: [
        metric('Out', formatCount(derived.outOfStock), derived.outOfStock > 0 ? 'danger' : 'good'),
        metric('Low', formatCount(derived.lowStock), derived.lowStock > 0 ? 'warn' : 'good'),
      ],
    },
    {
      id: 'credit-control',
      title: 'Credit control',
      status: creditScore >= 90 ? 'READY' : 'WARN',
      score: creditScore,
      tone: creditScore >= 90 ? 'good' : 'warn',
      message: `${formatMoney(derived.overdueAmount, true)} overdue across ${formatCount(derived.overdueCount)} invoice${derived.overdueCount === 1 ? '' : 's'}.`,
      href: '/westsides/reports',
      details: [
        metric(
          'Overdue',
          formatMoney(derived.overdueAmount, true),
          derived.overdueAmount > 0 ? 'warn' : 'good',
        ),
      ],
    },
    {
      id: 'close-control',
      title: 'Close control',
      status: closeScore >= 90 ? 'READY' : 'WARN',
      score: closeScore,
      tone: closeScore >= 90 ? 'good' : 'warn',
      message: `${formatCount(derived.dailyCloseOpenItems)} close item${derived.dailyCloseOpenItems === 1 ? '' : 's'} and ${formatMoney(derived.openFoliosTotal, true)} folio exposure.`,
      href: '/westsides/daily-close',
      details: [
        metric(
          'Open items',
          formatCount(derived.dailyCloseOpenItems),
          derived.dailyCloseOpenItems > 0 ? 'warn' : 'good',
        ),
        metric(
          'Damage',
          formatCount(derived.pendingStockDamage),
          derived.pendingStockDamage > 0 ? 'danger' : 'good',
        ),
        metric(
          'Expiry',
          formatCount(derived.expiringBatches),
          derived.expiringBatches > 0 ? 'warn' : 'good',
        ),
      ],
    },
  ];
}

function normalizeReadinessAction(action: ManagementAction, index: number): ReadinessActionItem {
  return {
    id: action.id ?? `readiness-action-${index}`,
    title: action.label ?? action.title ?? 'Open action',
    description: action.description ?? action.message ?? action.suggestedAction ?? '',
    href: action.href ?? hrefForActionCategory(action.category),
    tone: action.tone ?? toneFromSeverity(action.severity ?? action.priority),
    count: action.count ?? action.amount,
  };
}

function normalizeReadinessSource(
  source: ReadinessSourceLink,
  index: number,
): ReadinessModel['sources'][number] {
  return {
    label: source.label ?? source.title ?? `Source ${index + 1}`,
    href: source.href ?? '/westsides',
    description: source.description ?? 'Open source evidence.',
    tone: source.tone ?? 'neutral',
    count: source.count,
  };
}

function buildExceptions(
  data: Cockpit,
  derived: {
    outOfStock: number;
    lowStock: number;
    overdueAmount: number;
    overdueCount: number;
    deltaPct: number;
    openFoliosTotal: number;
    roomsDirty: number;
    roomsOutOfOrder: number;
    pendingStockDamage: number;
    expiringBatches: number;
  },
) {
  const backend = [
    ...asArray<ManagementException>(data.management?.exceptions),
    ...asArray<ManagementException>(data.exceptions),
  ].map((item, index) => ({
    id: item.id ?? `backend-exception-${index}`,
    title: item.title ?? item.label ?? 'Management exception',
    description: item.description ?? item.message ?? '',
    href: item.href,
    owner: item.owner,
    dueAt: item.dueAt,
    value: item.value,
    tone: item.tone ?? toneFromSeverity(item.severity),
  }));

  const generated = compact<ReturnType<typeof normalizeException>>([
    derived.outOfStock > 0
      ? normalizeException({
          id: 'stock-out',
          title: 'Stockouts require allocation',
          description: `${formatCount(derived.outOfStock)} SKU${derived.outOfStock === 1 ? '' : 's'} out of stock.`,
          href: '/westsides/inventory/live',
          tone: 'danger',
        })
      : null,
    derived.lowStock > 0
      ? normalizeException({
          id: 'low-stock',
          title: 'Low-stock replenishment queue',
          description: `${formatCount(derived.lowStock)} SKU${derived.lowStock === 1 ? '' : 's'} below threshold.`,
          href: '/westsides/product-batches',
          tone: derived.outOfStock > 0 ? 'danger' : 'warn',
        })
      : null,
    derived.overdueAmount > 0
      ? normalizeException({
          id: 'overdue-credit',
          title: 'Overdue credit exposure',
          description: `${formatMoney(derived.overdueAmount, true)} overdue across ${formatCount(derived.overdueCount)} invoice${derived.overdueCount === 1 ? '' : 's'}.`,
          href: '/westsides/reports',
          tone: 'warn',
        })
      : null,
    derived.deltaPct < -10
      ? normalizeException({
          id: 'sales-drop',
          title: 'Revenue dropped sharply',
          description: `${formatDelta(derived.deltaPct)} versus yesterday. Review division mix and salesperson activity.`,
          href: '/westsides/reports',
          tone: 'danger',
        })
      : null,
    derived.openFoliosTotal > 0
      ? normalizeException({
          id: 'open-folios',
          title: 'Open folio balances',
          description: `${formatMoney(derived.openFoliosTotal, true)} remains unsettled before close.`,
          href: '/westsides/daily-close',
          tone: 'warn',
        })
      : null,
    derived.pendingStockDamage > 0
      ? normalizeException({
          id: 'stock-damage',
          title: 'Stock damage approvals pending',
          description: `${formatCount(derived.pendingStockDamage)} damage item${derived.pendingStockDamage === 1 ? '' : 's'} need control review.`,
          href: '/westsides/stock-damage',
          tone: 'danger',
        })
      : null,
    derived.expiringBatches > 0
      ? normalizeException({
          id: 'expiring-batches',
          title: 'Expiring batches need sell-through',
          description: `${formatCount(derived.expiringBatches)} batch${derived.expiringBatches === 1 ? '' : 'es'} approaching expiry.`,
          href: '/westsides/product-batches',
          tone: 'warn',
        })
      : null,
  ]);

  return [...backend, ...generated].slice(0, 8);
}

function normalizeException(item: {
  id: string;
  title: string;
  description: string;
  href?: string;
  owner?: string;
  dueAt?: string;
  value?: NumericValue;
  tone: Tone;
}) {
  return item;
}

function buildActions(
  data: Cockpit,
  derived: {
    outOfStock: number;
    lowStock: number;
    overdueAmount: number;
    openFoliosTotal: number;
    pendingStockDamage: number;
    expiringBatches: number;
  },
) {
  const backend = [
    ...asArray<ManagementAction>(data.management?.actions),
    ...asArray<ManagementAction>(data.actions),
  ].map((action, index) => ({
    id: action.id ?? `backend-action-${index}`,
    label: action.label ?? action.title ?? 'Open action',
    description: action.description ?? action.message ?? action.suggestedAction ?? '',
    href: action.href ?? hrefForActionCategory(action.category),
    tone: action.tone ?? toneFromSeverity(action.severity ?? action.priority),
    count: action.count,
  }));

  const generated = compact([
    derived.outOfStock + derived.lowStock > 0
      ? {
          id: 'action-stock',
          label: 'Resolve stock alerts',
          description: `${formatCount(derived.outOfStock + derived.lowStock)} availability alert${derived.outOfStock + derived.lowStock === 1 ? '' : 's'} in the queue.`,
          href: '/westsides/inventory/live',
          tone: derived.outOfStock > 0 ? ('danger' as Tone) : ('warn' as Tone),
        }
      : null,
    derived.overdueAmount > 0
      ? {
          id: 'action-credit',
          label: 'Review credit exposure',
          description: `${formatMoney(derived.overdueAmount, true)} overdue needs collection follow-up.`,
          href: '/westsides/reports',
          tone: 'warn' as Tone,
        }
      : null,
    derived.openFoliosTotal > 0
      ? {
          id: 'action-close',
          label: 'Prepare daily close',
          description: `${formatMoney(derived.openFoliosTotal, true)} in open folios before close.`,
          href: '/westsides/daily-close',
          tone: 'warn' as Tone,
        }
      : null,
    derived.pendingStockDamage > 0
      ? {
          id: 'action-damage',
          label: 'Approve stock damage',
          description: `${formatCount(derived.pendingStockDamage)} pending damage record${derived.pendingStockDamage === 1 ? '' : 's'}.`,
          href: '/westsides/stock-damage',
          tone: 'danger' as Tone,
        }
      : null,
    derived.expiringBatches > 0
      ? {
          id: 'action-expiry',
          label: 'Move expiring batches',
          description: `${formatCount(derived.expiringBatches)} expiring batch${derived.expiringBatches === 1 ? '' : 'es'} to review.`,
          href: '/westsides/product-batches',
          tone: 'warn' as Tone,
        }
      : null,
    {
      id: 'action-sale',
      label: 'Start quick sale',
      description: 'Open the point-of-sale workflow.',
      href: '/westsides/quick-sale',
      tone: 'good' as Tone,
    },
    {
      id: 'action-report',
      label: 'Open Westsides reports',
      description: 'Review daily sales, delivery, stock, and credit reports.',
      href: '/westsides/reports',
      tone: 'brand' as Tone,
    },
  ]);

  return [...backend, ...generated].slice(0, 8);
}

function buildDeliveryLane(data: Cockpit): RiskLaneData {
  const pending = firstNumber(
    data.deliveryHealth?.pending,
    data.fulfillment?.ordersAwaitingDelivery,
    data.pendingDeliveries,
  );
  const overdue = firstNumber(data.deliveryHealth?.overdue, data.fulfillment?.deliveries?.overdue);
  const onTimeRate = toNumber(data.deliveryHealth?.onTimeRate);
  const dispatched = firstNumber(
    data.deliveryHealth?.dispatched,
    data.fulfillment?.deliveries?.dispatched,
  );
  const tone: Tone = overdue > 0 ? 'danger' : pending > 0 ? 'warn' : 'good';
  return {
    title: 'Delivery',
    status:
      data.deliveryHealth?.statusLabel ??
      data.deliveryHealth?.status ??
      data.fulfillment?.status ??
      (pending > 0 ? 'Dispatch watch' : 'No blockers'),
    tone,
    href: data.deliveryHealth?.href ?? '/westsides/delivery-notes',
    value: formatCount(pending),
    label: 'pending',
    note:
      data.deliveryHealth?.note ??
      (overdue > 0
        ? `${formatCount(overdue)} overdue delivery note${overdue === 1 ? '' : 's'}.`
        : 'Pending deliveries and overdue dispatches.'),
    metrics: compact([
      metric('Overdue', formatCount(overdue), overdue > 0 ? 'danger' : 'neutral'),
      metric('Dispatched', formatCount(dispatched), dispatched > 0 ? 'brand' : 'neutral'),
      optionalMetric('Due today', data.fulfillment?.deliveries?.dueToday, 'count', 'warn'),
      onTimeRate > 0
        ? metric('On time', formatPercent(onTimeRate), onTimeRate >= 90 ? 'good' : 'warn')
        : null,
    ]),
  };
}

function buildPricingLane(data: Cockpit): RiskLaneData {
  const priceListGaps =
    toNumber(data.pricing?.priceLists?.productsMissingPrice) +
    toNumber(data.pricing?.priceLists?.activeButPastEffectiveTo) +
    toNumber(data.pricing?.customerAgreements?.unapprovedActive);
  const exceptions = firstNumber(
    data.pricingHealth?.exceptions,
    data.pricingHealth?.marginAlerts,
    priceListGaps,
  );
  const activeQuotations = firstNumber(data.pipeline?.activeQuotations, data.activeQuotations);
  const expiringAgreements = firstNumber(
    data.pricingHealth?.expiringAgreements,
    data.pricing?.customerAgreements?.expiringSoon,
  );
  const expiringPriceLists = toNumber(data.pricing?.priceLists?.expiringSoon);
  const tone: Tone = exceptions > 0 ? 'danger' : expiringAgreements > 0 ? 'warn' : 'neutral';
  return {
    title: 'Pricing',
    status:
      data.pricingHealth?.statusLabel ??
      data.pricingHealth?.status ??
      data.pricing?.status ??
      (exceptions > 0 ? 'Price exceptions' : 'Controlled'),
    tone,
    href: data.pricingHealth?.href ?? '/westsides/price-lists',
    value: formatCount(exceptions),
    label: 'exceptions',
    note:
      data.pricingHealth?.note ??
      'Price lists, customer agreements, quotes, and margin exceptions.',
    metrics: compact([
      optionalMetric(
        'Price lists',
        firstDefined(data.pricingHealth?.activePriceLists, data.pricing?.priceLists?.active),
        'count',
      ),
      optionalMetric(
        'Agreements',
        firstDefined(
          data.pricingHealth?.activeAgreements,
          data.pricing?.customerAgreements?.active,
        ),
        'count',
      ),
      metric(
        'Active quotes',
        formatCount(activeQuotations),
        activeQuotations > 0 ? 'brand' : 'neutral',
      ),
      metric(
        'Expiring',
        formatCount(expiringAgreements + expiringPriceLists),
        expiringAgreements + expiringPriceLists > 0 ? 'warn' : 'neutral',
      ),
      optionalMetric('Coverage', data.pricing?.priceLists?.productCoveragePct, 'percent'),
    ]),
  };
}

function buildDailyCloseLane(
  data: Cockpit,
  derived: { openFoliosCount: number; openFoliosTotal: number; dailyCloseOpenItems: number },
): RiskLaneData {
  const variance = toNumber(data.dailyClose?.variance);
  const blockers = toNumber(data.dailyClose?.blockers);
  const warnings = toNumber(data.dailyClose?.warnings);
  const tone: Tone =
    blockers > 0
      ? 'danger'
      : variance !== 0
        ? valueTone(variance)
        : derived.dailyCloseOpenItems > 0
          ? 'warn'
          : 'neutral';
  return {
    title: 'Daily close',
    status:
      data.dailyClose?.statusLabel ??
      data.dailyClose?.status ??
      (derived.dailyCloseOpenItems > 0 ? 'Open items' : 'Awaiting close'),
    tone,
    href: data.dailyClose?.href ?? '/westsides/daily-close',
    value: formatCount(derived.dailyCloseOpenItems),
    label: 'open items',
    note:
      data.dailyClose?.note ??
      `${formatMoney(derived.openFoliosTotal, true)} unsettled folio balance.`,
    metrics: compact([
      optionalMetric('Score', data.dailyClose?.score, 'percent'),
      metric('Blockers', formatCount(blockers), blockers > 0 ? 'danger' : 'neutral'),
      metric('Warnings', formatCount(warnings), warnings > 0 ? 'warn' : 'neutral'),
      metric(
        'Open folios',
        formatCount(derived.openFoliosCount),
        derived.openFoliosCount > 0 ? 'warn' : 'neutral',
      ),
      metric(
        'Folio total',
        formatMoney(derived.openFoliosTotal, true),
        derived.openFoliosTotal > 0 ? 'warn' : 'neutral',
      ),
      optionalMetric(
        'Variance',
        data.dailyClose?.variance,
        'money',
        valueTone(data.dailyClose?.variance),
      ),
      data.dailyClose?.lastClosedAt
        ? metric('Last closed', formatShortDate(data.dailyClose.lastClosedAt), 'neutral')
        : null,
    ]),
  };
}

function buildCustomerRiskLane(
  data: Cockpit,
  derived: { overdueCount: number; overdueAmount: number; outstandingAR: number },
): RiskLaneData {
  const overdueCustomers = firstNumber(
    data.customerRisk?.overdueCustomers,
    data.customerCreditRisk?.overdueCount,
    derived.overdueCount,
  );
  const customersOnHold = firstNumber(
    data.customerRisk?.customersOnHold,
    data.creditHealth?.customersOnHold,
    data.customerCreditRisk?.blockedCustomers,
  );
  const highExposure = firstNumber(
    data.customerRisk?.highExposure,
    data.customerCreditRisk?.overLimitAmount,
    data.customerCreditRisk?.overdueAmount,
    derived.overdueAmount,
  );
  const tone: Tone = highExposure > 0 ? 'warn' : customersOnHold > 0 ? 'warn' : 'good';
  return {
    title: 'Customer risk',
    status:
      data.customerRisk?.statusLabel ??
      data.customerRisk?.status ??
      data.customerCreditRisk?.status ??
      (highExposure > 0 ? 'Credit watch' : 'Stable'),
    tone,
    href: data.customerRisk?.href ?? '/westsides/customers',
    value: formatCount(overdueCustomers),
    label: 'overdue',
    note:
      data.customerRisk?.note ??
      `${formatMoney(derived.outstandingAR, true)} total receivables exposure.`,
    metrics: compact([
      metric('On hold', formatCount(customersOnHold), customersOnHold > 0 ? 'warn' : 'neutral'),
      metric(
        'High exposure',
        formatMoney(highExposure, true),
        highExposure > 0 ? 'warn' : 'neutral',
      ),
      optionalMetric('Over limit', data.customerCreditRisk?.customersOverLimit, 'count', 'danger'),
      optionalMetric('Inactive', data.customerRisk?.inactiveCustomers, 'count'),
    ]),
  };
}

function ReadinessCommandPanel({ readiness }: { readiness: ReadinessModel }) {
  const colors = TONE_STYLES[readiness.tone];
  return (
    <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
      <Card padding="none" className="xl:col-span-4 overflow-hidden">
        <div className="p-5" style={ELEVATED_SURFACE}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase font-semibold tracking-wide" style={TEXT_MUTED}>
                Production readiness
              </div>
              <h2 className="text-lg font-bold mt-1" style={TEXT}>
                Westsides operating clearance
              </h2>
              <p className="text-xs leading-5 mt-1" style={TEXT_SECONDARY}>
                {readiness.summary}
              </p>
            </div>
            <StatusPill tone={readiness.tone}>{readiness.status}</StatusPill>
          </div>

          <div className="flex items-end justify-between gap-4 mt-5">
            <div>
              <div className="text-5xl font-bold tabular-nums" style={{ color: colors.color }}>
                {formatCount(readiness.score)}
              </div>
              <div className="text-xs uppercase tracking-wide mt-1" style={TEXT_MUTED}>
                readiness score
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold" style={TEXT}>
                {readiness.sourceCoverage}
              </div>
              <div className="text-xs mt-1" style={TEXT_MUTED}>
                Last close: {readiness.lastClosedLabel}
              </div>
            </div>
          </div>

          <div
            className="h-3 rounded-full mt-4 overflow-hidden"
            style={{ background: 'var(--aurora-bg-muted)' }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${readiness.score}%`, background: colors.solid }}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4">
            {readiness.metrics.slice(0, 6).map((item) => (
              <MiniMetricView key={item.label} item={item} />
            ))}
          </div>
        </div>
      </Card>

      <Card padding="none" className="xl:col-span-4 overflow-hidden">
        <SectionHeader
          eyebrow="Checklist"
          title="Close and control readiness"
          subtitle={`${formatCount(readiness.blockers)} blocker${readiness.blockers === 1 ? '' : 's'} and ${formatCount(readiness.warnings)} warning${readiness.warnings === 1 ? '' : 's'} before production close.`}
        />
        <div className="divide-y" style={BORDER}>
          {readiness.checklist.map((check) => (
            <ReadinessCheckRow key={check.id} check={check} />
          ))}
        </div>
      </Card>

      <Card padding="none" className="xl:col-span-4 overflow-hidden">
        <SectionHeader
          eyebrow="Execution"
          title="Recommended next actions"
          subtitle="Actionable links keep the cockpit tied to source workflows."
        />
        <div className="p-4 space-y-3">
          {readiness.actions.length === 0 ? (
            <EmptyLine text="No readiness actions returned." tone="good" />
          ) : (
            readiness.actions.map((action) => (
              <ReadinessActionRow key={action.id} action={action} />
            ))
          )}
        </div>
        <div className="px-4 pb-4">
          <Subheading title="Source and drill-through" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            {readiness.sources.map((source) => (
              <ReadinessSourceLink key={source.href} source={source} />
            ))}
          </div>
        </div>
      </Card>
    </section>
  );
}

function ReadinessCheckRow({ check }: { check: ReadinessChecklistItem }) {
  const colors = TONE_STYLES[check.tone];
  return (
    <Link href={check.href} className="block p-4 transition-colors">
      <div className="flex items-start gap-3">
        <StatusGlyph tone={check.tone} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold" style={TEXT}>
                {check.title}
              </div>
              <p className="text-xs leading-5 mt-0.5" style={TEXT_SECONDARY}>
                {check.message}
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-sm font-bold tabular-nums" style={{ color: colors.color }}>
                {formatCount(check.score)}
              </div>
              <div className="text-[11px] uppercase" style={TEXT_MUTED}>
                score
              </div>
            </div>
          </div>
          <div
            className="h-2 rounded-full mt-3 overflow-hidden"
            style={{ background: 'var(--aurora-bg-muted)' }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${check.score}%`, background: colors.solid }}
            />
          </div>
          {check.details.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mt-3">
              {check.details.map((item) => (
                <MiniMetricView key={item.label} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

function ReadinessActionRow({ action }: { action: ReadinessActionItem }) {
  const colors = TONE_STYLES[action.tone];
  return (
    <Link
      href={action.href}
      className="block rounded-lg border p-3"
      style={{ ...SURFACE, borderLeft: `3px solid ${colors.solid}` }}
    >
      <div className="flex items-start gap-3">
        <StatusGlyph tone={action.tone} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm font-semibold leading-5" style={TEXT}>
              {action.title}
            </div>
            {action.count !== undefined && (
              <span
                className="text-xs font-bold tabular-nums flex-shrink-0"
                style={{ color: colors.color }}
              >
                {formatMaybeNumber(action.count)}
              </span>
            )}
          </div>
          {action.description && (
            <p className="text-xs leading-5 mt-0.5" style={TEXT_SECONDARY}>
              {action.description}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

function ReadinessSourceLink({ source }: { source: ReadinessModel['sources'][number] }) {
  const colors = TONE_STYLES[source.tone];
  return (
    <Link href={source.href} className="rounded-lg border p-3 block min-w-0" style={SURFACE}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate" style={TEXT}>
            {source.label}
          </div>
          <div className="text-[11px] leading-4 mt-0.5 line-clamp-2" style={TEXT_SECONDARY}>
            {source.description}
          </div>
        </div>
        <span
          className="rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase flex-shrink-0"
          style={{ background: colors.background, borderColor: colors.border, color: colors.color }}
        >
          {source.count !== undefined ? formatCount(source.count) : 'Open'}
        </span>
      </div>
    </Link>
  );
}

function StatusGlyph({ tone }: { tone: Tone }) {
  const colors = TONE_STYLES[tone];
  const label = tone === 'danger' ? '!' : tone === 'warn' ? '?' : tone === 'good' ? 'OK' : 'i';
  return (
    <span
      className="w-8 h-8 rounded-lg border flex items-center justify-center text-[11px] font-bold flex-shrink-0"
      style={{ background: colors.background, borderColor: colors.border, color: colors.color }}
      aria-hidden="true"
    >
      {label}
    </span>
  );
}

function SectionHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="px-4 py-3 flex items-start justify-between gap-3"
      style={{ borderBottom: '1px solid var(--aurora-border)' }}
    >
      <div className="min-w-0">
        <div className="text-[11px] uppercase font-semibold tracking-wide" style={TEXT_MUTED}>
          {eyebrow}
        </div>
        <h2 className="text-sm font-semibold truncate" style={TEXT}>
          {title}
        </h2>
        {subtitle && (
          <p className="text-xs mt-0.5 leading-5" style={TEXT_SECONDARY}>
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

function KpiTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: Tone;
}) {
  const toneStyle = TONE_STYLES[tone];
  return (
    <Card padding="none" className="p-4 min-w-0 overflow-hidden">
      <div className="flex items-start justify-between gap-2">
        <div
          className="text-[11px] uppercase font-semibold tracking-wide truncate"
          style={TEXT_MUTED}
        >
          {label}
        </div>
        <span
          className="w-2 h-2 rounded-full mt-1 flex-shrink-0"
          style={{ background: toneStyle.solid }}
        />
      </div>
      <div
        className="text-xl font-bold mt-2 tabular-nums truncate"
        style={{ color: toneStyle.color }}
      >
        {value}
      </div>
      {hint && (
        <div className="text-[11px] mt-1 leading-4 line-clamp-2" style={TEXT_SECONDARY}>
          {hint}
        </div>
      )}
    </Card>
  );
}

function StatusPanel({ tone, children }: { tone: Tone; children: ReactNode }) {
  const colors = TONE_STYLES[tone];
  return (
    <div
      className="rounded-lg border px-3 py-2 text-sm"
      style={{ background: colors.background, borderColor: colors.border, color: colors.color }}
    >
      {children}
    </div>
  );
}

function Subheading({ title }: { title: string }) {
  return (
    <div className="text-xs uppercase font-semibold tracking-wide" style={TEXT_MUTED}>
      {title}
    </div>
  );
}

function EmptyLine({ text, tone = 'neutral' }: { text: string; tone?: Tone }) {
  const colors = TONE_STYLES[tone];
  return (
    <div
      className="rounded-lg border px-3 py-3 text-sm"
      style={{ background: colors.background, borderColor: colors.border, color: colors.color }}
    >
      {text}
    </div>
  );
}

function ExceptionRow({ item }: { item: ReturnType<typeof normalizeException> }) {
  const colors = TONE_STYLES[item.tone];
  return (
    <LinkOrDiv href={item.href}>
      <div
        className="rounded-lg border p-3"
        style={{ ...SURFACE, borderLeft: `3px solid ${colors.solid}` }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-5" style={TEXT}>
              {item.title}
            </div>
            {item.description && (
              <div className="text-xs leading-5 mt-0.5" style={TEXT_SECONDARY}>
                {item.description}
              </div>
            )}
          </div>
          <span
            className="rounded-md border px-2 py-0.5 text-[11px] uppercase font-semibold whitespace-nowrap"
            style={{
              background: colors.background,
              borderColor: colors.border,
              color: colors.color,
            }}
          >
            {item.tone}
          </span>
        </div>
        {(item.owner || item.dueAt || item.value !== undefined) && (
          <div className="flex items-center gap-2 flex-wrap mt-2 text-[11px]" style={TEXT_MUTED}>
            {item.owner && <span>{item.owner}</span>}
            {item.dueAt && <span>{formatShortDate(item.dueAt)}</span>}
            {item.value !== undefined && <span>{formatMaybeNumber(item.value)}</span>}
          </div>
        )}
      </div>
    </LinkOrDiv>
  );
}

function ActionLink({
  action,
}: {
  action: ManagementAction & { id: string; href: string; tone: Tone };
}) {
  const colors = TONE_STYLES[action.tone];
  return (
    <Link
      href={action.href}
      className="block rounded-lg border p-3 transition-colors"
      style={{ ...SURFACE, borderLeft: `3px solid ${colors.solid}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-5" style={TEXT}>
            {action.label ?? action.title}
          </div>
          {action.description && (
            <div className="text-xs leading-5 mt-0.5" style={TEXT_SECONDARY}>
              {action.description}
            </div>
          )}
        </div>
        {action.count !== undefined && (
          <span className="text-xs font-semibold tabular-nums" style={{ color: colors.color }}>
            {formatCount(action.count)}
          </span>
        )}
      </div>
    </Link>
  );
}

function HealthBlock({ block }: { block: HealthBlockData }) {
  const colors = TONE_STYLES[block.tone];
  return (
    <div
      className="p-4 min-w-0"
      style={{ borderRight: '1px solid var(--aurora-border)', minHeight: '100%' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide" style={TEXT_MUTED}>
            {block.title}
          </div>
          <div
            className="text-xl font-bold mt-1 tabular-nums truncate"
            style={{ color: colors.color }}
          >
            {block.value}
          </div>
        </div>
        <StatusPill tone={block.tone}>{block.status}</StatusPill>
      </div>
      <p className="text-xs leading-5 mt-2" style={TEXT_SECONDARY}>
        {block.summary}
      </p>
      <div className="grid grid-cols-2 gap-2 mt-3">
        {block.metrics.map((metricItem) => (
          <MiniMetricView key={metricItem.label} item={metricItem} />
        ))}
      </div>
      {block.href && (
        <div className="mt-3">
          <TextLink href={block.href}>Open detail</TextLink>
        </div>
      )}
    </div>
  );
}

function ControlLine({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const colors = TONE_STYLES[tone];
  return (
    <div className="rounded-lg border px-3 py-2" style={SURFACE}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm truncate" style={TEXT_SECONDARY}>
          {label}
        </span>
        <span
          className="text-sm font-semibold tabular-nums whitespace-nowrap"
          style={{ color: colors.color }}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function AgingBucket({
  label,
  amount,
  total,
  tone,
}: {
  label: string;
  amount: number;
  total: number;
  tone: Tone;
}) {
  const pct = percentage(amount, total);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span style={TEXT_SECONDARY}>{label}</span>
        <span className="font-semibold tabular-nums" style={{ color: TONE_STYLES[tone].color }}>
          {formatMoney(amount, true)}
        </span>
      </div>
      <div
        className="h-2 rounded-full mt-1 overflow-hidden"
        style={{ background: 'var(--aurora-bg-muted)' }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, pct)}%`, background: TONE_STYLES[tone].solid }}
        />
      </div>
      <div className="text-[11px] mt-1 tabular-nums" style={TEXT_MUTED}>
        {formatPercent(pct)}
      </div>
    </div>
  );
}

function InlineStat({
  label,
  value,
  tone,
  compact = false,
}: {
  label: string;
  value: string;
  tone: Tone;
  compact?: boolean;
}) {
  const colors = TONE_STYLES[tone];
  return (
    <div
      className={`${compact ? 'rounded-lg border p-3' : 'p-3 text-center min-w-0'}`}
      style={compact ? SURFACE : { borderRight: '1px solid var(--aurora-border)' }}
    >
      <div
        className={`${compact ? 'text-lg' : 'text-xl'} font-bold tabular-nums truncate`}
        style={{ color: colors.color }}
      >
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wide mt-1 truncate" style={TEXT_MUTED}>
        {label}
      </div>
    </div>
  );
}

function CriticalSkuRow({ sku }: { sku: CriticalSku }) {
  const quantity = toNumber(sku.quantityOnHand);
  const tone: Tone = quantity <= 0 ? 'danger' : 'warn';
  return (
    <Link
      href="/westsides/inventory/live"
      className="block rounded-lg border p-3"
      style={{ ...SURFACE, borderLeft: `3px solid ${TONE_STYLES[tone].solid}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate" style={TEXT}>
            {sku.productName ?? 'Unknown product'}
          </div>
          <div className="text-[11px] mt-0.5 truncate" style={TEXT_MUTED}>
            {sku.sku ?? 'No SKU'} | {sku.locationName ?? 'Unassigned branch/location'}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div
            className="text-sm font-bold tabular-nums"
            style={{ color: TONE_STYLES[tone].color }}
          >
            {formatAmount(quantity)}
          </div>
          <div className="text-[11px]" style={TEXT_MUTED}>
            on hand
          </div>
        </div>
      </div>
    </Link>
  );
}

function RiskLane({ lane }: { lane: RiskLaneData }) {
  const colors = TONE_STYLES[lane.tone];
  return (
    <Link
      href={lane.href}
      className="block p-4 min-w-0"
      style={{
        borderRight: '1px solid var(--aurora-border)',
        borderBottom: '1px solid var(--aurora-border)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold" style={TEXT}>
            {lane.title}
          </div>
          <div className="text-xs mt-0.5" style={TEXT_SECONDARY}>
            {lane.status}
          </div>
        </div>
        <span
          className="rounded-md border px-2 py-0.5 text-[11px] uppercase font-semibold"
          style={{ background: colors.background, borderColor: colors.border, color: colors.color }}
        >
          {lane.label}
        </span>
      </div>
      <div className="text-2xl font-bold mt-3 tabular-nums" style={{ color: colors.color }}>
        {lane.value}
      </div>
      <p className="text-xs leading-5 mt-1" style={TEXT_SECONDARY}>
        {lane.note}
      </p>
      {lane.metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mt-3">
          {lane.metrics.map((item) => (
            <MiniMetricView key={item.label} item={item} />
          ))}
        </div>
      )}
    </Link>
  );
}

function DivisionRow({
  division,
  total,
}: {
  division: NonNullable<Cockpit['byDivision']>[number] & { revenue: number; count: number };
  total: number;
}) {
  const pct = percentage(division.revenue, total);
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="min-w-0">
          <div className="font-semibold truncate" style={TEXT}>
            {division.name ?? 'Unassigned'}
          </div>
          <div className="text-[11px] truncate" style={TEXT_MUTED}>
            {division.code ?? 'No code'} | {formatCount(division.count)} sale
            {division.count === 1 ? '' : 's'}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="font-semibold tabular-nums" style={TEXT}>
            {formatMoney(division.revenue, true)}
          </div>
          <div className="text-[11px] tabular-nums" style={TEXT_MUTED}>
            {formatPercent(pct)}
          </div>
        </div>
      </div>
      <div
        className="h-2 rounded-full mt-2 overflow-hidden"
        style={{ background: 'var(--aurora-bg-muted)' }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, pct)}%`, background: 'var(--aurora-primary)' }}
        />
      </div>
    </div>
  );
}

function RankingList({
  items,
  emptyText,
}: {
  items: Array<{ id: string; title: string; meta: string; value: string }>;
  emptyText: string;
}) {
  if (items.length === 0) {
    return (
      <div className="p-4">
        <EmptyLine text={emptyText} tone="neutral" />
      </div>
    );
  }

  return (
    <div>
      {items.slice(0, 7).map((item, index) => (
        <div
          key={`${item.id}-${index}`}
          className="px-4 py-3 flex items-start gap-3"
          style={{ borderBottom: '1px solid var(--aurora-border)' }}
        >
          <span
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={ELEVATED_SURFACE}
          >
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate" style={TEXT}>
              {item.title}
            </div>
            <div className="text-[11px] truncate mt-0.5" style={TEXT_MUTED}>
              {item.meta}
            </div>
          </div>
          <div className="text-sm font-semibold tabular-nums flex-shrink-0" style={TEXT}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProgressSummary({
  label,
  value,
  pct,
  tone,
}: {
  label: string;
  value: string;
  pct: number;
  tone: Tone;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span style={TEXT_SECONDARY}>{label}</span>
        <span className="font-semibold tabular-nums" style={{ color: TONE_STYLES[tone].color }}>
          {value}
        </span>
      </div>
      <div
        className="h-2 rounded-full mt-2 overflow-hidden"
        style={{ background: 'var(--aurora-bg-muted)' }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, pct)}%`, background: TONE_STYLES[tone].solid }}
        />
      </div>
    </div>
  );
}

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <div className="p-4">
        <EmptyLine text="No sales or folio activity returned yet." tone="neutral" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2">
      {items.map((item) => {
        const tone: Tone = item.kind === 'SALE' ? 'good' : 'brand';
        return (
          <div
            key={`${item.kind}-${item.id}`}
            className="p-4 min-w-0"
            style={{
              borderRight: '1px solid var(--aurora-border)',
              borderBottom: '1px solid var(--aurora-border)',
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <span
                  className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                  style={{ background: TONE_STYLES[tone].solid }}
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate" style={TEXT}>
                    {item.headline}
                  </div>
                  <div className="text-xs truncate mt-0.5" style={TEXT_SECONDARY}>
                    {item.subline}
                  </div>
                </div>
              </div>
              <div className="text-[11px] tabular-nums flex-shrink-0" style={TEXT_MUTED}>
                {timeAgo(item.when)}
              </div>
            </div>
            <div
              className="text-sm font-semibold tabular-nums mt-2"
              style={{ color: TONE_STYLES[tone].color }}
            >
              {formatMoney(item.amount, true)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function QuickAction({ link }: { link: (typeof QUICK_LINKS)[number] }) {
  const colors = TONE_STYLES[link.tone];
  return (
    <Link
      href={link.href}
      className="rounded-lg border px-3 py-2 min-w-0 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-sm"
      style={{ background: colors.background, borderColor: colors.border, color: colors.color }}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex-shrink-0 opacity-80" aria-hidden="true">
          <AppIcon name={link.icon} size={15} />
        </span>
        <span className="text-sm font-semibold truncate">{link.label}</span>
      </div>
    </Link>
  );
}

function MiniMetricView({ item }: { item: MiniMetric }) {
  const tone = item.tone ?? 'neutral';
  return (
    <div className="rounded-lg border px-2.5 py-2 min-w-0" style={SURFACE}>
      <div className="text-[11px] uppercase tracking-wide truncate" style={TEXT_MUTED}>
        {item.label}
      </div>
      <div
        className="text-xs font-semibold tabular-nums mt-0.5 truncate"
        style={{ color: TONE_STYLES[tone].color }}
      >
        {item.value}
      </div>
    </div>
  );
}

function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const colors = TONE_STYLES[tone];
  return (
    <span
      className="rounded-md border px-2 py-0.5 text-[11px] uppercase font-semibold whitespace-nowrap"
      style={{ background: colors.background, borderColor: colors.border, color: colors.color }}
    >
      {children}
    </span>
  );
}

function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="text-xs font-semibold"
      style={{ color: 'var(--aurora-primary-text)' }}
    >
      {children}
    </Link>
  );
}

function LinkOrDiv({ href, children }: { href?: string; children: ReactNode }) {
  return href ? <Link href={href}>{children}</Link> : <>{children}</>;
}

function metric(label: string, value: string, tone?: Tone): MiniMetric {
  return { label, value, tone };
}

function optionalMetric(
  label: string,
  raw: NumericValue,
  kind: 'money' | 'count' | 'percent',
  tone?: Tone,
): MiniMetric | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const value =
    kind === 'money'
      ? formatMoney(raw, true)
      : kind === 'percent'
        ? formatPercent(toNumber(raw))
        : formatCount(raw);
  return metric(label, value, tone);
}

function detailsToMetrics(
  details?: Record<string, NumericValue | string | boolean | null | undefined>,
): MiniMetric[] {
  if (!details) return [];
  return Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 4)
    .map(([key, value]) =>
      metric(humanizeKey(key), formatReadinessDetail(value), detailTone(value)),
    );
}

function formatReadinessDetail(value: NumericValue | string | boolean) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number')
    return Number.isInteger(value) ? formatCount(value) : formatAmount(value);
  if (typeof value === 'string') {
    const n = Number(value);
    if (value.trim() !== '' && Number.isFinite(n)) {
      return Number.isInteger(n) ? formatCount(n) : formatAmount(n);
    }
    return value;
  }
  return '0';
}

function detailTone(value: NumericValue | string | boolean): Tone {
  if (typeof value === 'boolean') return value ? 'good' : 'warn';
  const n = Number(value ?? 0);
  if (Number.isFinite(n) && n > 0) return 'warn';
  return 'neutral';
}

function formatReadinessStatus(status?: string | null) {
  const value = String(status ?? 'WATCH')
    .replace(/_/g, ' ')
    .trim();
  return value ? value.toUpperCase() : 'WATCH';
}

function toneForReadiness(status: string, score: number, blockers: number, warnings: number): Tone {
  const value = status.toLowerCase();
  if (blockers > 0 || value.includes('block') || value.includes('critical')) return 'danger';
  if (warnings > 0 || score < 90 || value.includes('warn') || value.includes('watch'))
    return 'warn';
  if (value.includes('ready') || value.includes('clear') || score >= 90) return 'good';
  return 'neutral';
}

function hrefForReadinessCheck(key: string) {
  const value = key.toLowerCase();
  if (value.includes('payment') || value.includes('cash') || value.includes('close'))
    return '/westsides/daily-close';
  if (value.includes('posting') || value.includes('finance') || value.includes('account'))
    return '/reports/financial';
  if (value.includes('stock') || value.includes('inventory') || value.includes('operation'))
    return '/westsides/inventory/live';
  if (value.includes('delivery') || value.includes('fulfillment'))
    return '/westsides/delivery-notes';
  if (value.includes('credit') || value.includes('customer')) return '/westsides/customers';
  return '/westsides/reports';
}

function humanizeKey(key: string) {
  return key
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function dedupeBy<T>(items: T[], keyFn: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toneFromSeverity(severity?: string | null): Tone {
  const value = String(severity ?? '').toLowerCase();
  if (value.includes('critical') || value.includes('danger') || value.includes('high'))
    return 'danger';
  if (value.includes('warn') || value.includes('medium') || value.includes('due')) return 'warn';
  if (value.includes('success') || value.includes('good') || value.includes('low')) return 'good';
  if (value.includes('info')) return 'info';
  if (value.includes('brand') || value.includes('primary')) return 'brand';
  return 'neutral';
}

function hrefForActionCategory(category?: string | null) {
  switch (String(category ?? '').toUpperCase()) {
    case 'STOCK':
      return '/westsides/inventory/live';
    case 'PRICING':
      return '/westsides/price-lists';
    case 'FULFILLMENT':
      return '/westsides/delivery-notes';
    case 'CLOSE':
    case 'CASH':
      return '/westsides/daily-close';
    case 'CREDIT':
      return '/westsides/customers';
    case 'SALES':
      return '/westsides/reports';
    default:
      return '/westsides';
  }
}

function valueTone(value: NumericValue): Tone {
  const n = toNumber(value);
  if (n > 0) return 'danger';
  if (n < 0) return 'good';
  return 'neutral';
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function compact<T>(items: Array<T | null | undefined | false>): T[] {
  return items.filter(Boolean) as T[];
}

function toNumber(value: NumericValue): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function clampPercent(value: NumericValue): number {
  return Math.max(0, Math.min(100, Math.round(toNumber(value))));
}

function firstNumber(...values: NumericValue[]): number {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return toNumber(value);
  }
  return 0;
}

function firstDefined(...values: NumericValue[]): NumericValue {
  return values.find((value) => value !== null && value !== undefined && value !== '');
}

function percentage(value: NumericValue, total: NumericValue): number {
  const denominator = toNumber(total);
  if (denominator <= 0) return 0;
  return (toNumber(value) / denominator) * 100;
}

function formatAmount(value: NumericValue) {
  return new Intl.NumberFormat('en-TZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

function formatCount(value: NumericValue) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(toNumber(value));
}

function formatMoney(value: NumericValue, compactValue = false) {
  return `TZS ${new Intl.NumberFormat('en-TZ', {
    notation: compactValue ? 'compact' : 'standard',
    minimumFractionDigits: compactValue ? 0 : 2,
    maximumFractionDigits: compactValue ? 1 : 2,
  }).format(toNumber(value))}`;
}

function formatMaybeNumber(value: NumericValue) {
  const n = toNumber(value);
  return Number.isInteger(n) ? formatCount(n) : formatAmount(n);
}

function formatPercent(value: NumericValue) {
  return `${toNumber(value).toFixed(1)}%`;
}

function formatDelta(value: NumericValue) {
  const n = toNumber(value);
  if (n === 0) return '0.0%';
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function safeDateMs(value?: string) {
  const ms = value ? new Date(value).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function timeAgo(iso: string) {
  const eventMs = safeDateMs(iso);
  if (!eventMs) return 'unknown';
  const ms = Date.now() - eventMs;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(eventMs).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function formatAsOf(iso?: string) {
  const ms = safeDateMs(iso);
  if (!ms) return 'unknown time';
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatShortDate(iso: string) {
  const ms = safeDateMs(iso);
  if (!ms) return 'unknown';
  return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
