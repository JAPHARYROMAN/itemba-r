'use client';

import { WorkspaceTable } from '@/components/ui/workspace-table';
import { useMemo, useState } from 'react';
import { Btn, Card, PageHeader, SkeletonCardGrid, StatusBadge } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useLinkedDeskChanges } from '@/components/workspace/linked-desk-changes';
import { useUnsavedWork } from '@/components/workspace/unsaved-work-provider';
import { useWorkspaceRouter as useGuardedRouter } from '@/components/workspace/workspace-navigation';
import {
  ProfileSections,
  PartnerStatementGenerator,
} from '@/components/workspace/partner-profile-controls';
import { PartnerAction } from '@/components/workspace/trading-partner-workspace';
import '@/components/workspace/workspace.css';
import '@/components/workspace/partner-profile.css';
import { TradingPartnerEditor } from '@/components/workspace/trading-partner-editor';

type Tab =
  | 'Overview'
  | 'Sales'
  | 'Receivables'
  | 'Products'
  | 'Statements'
  | 'Pricing'
  | 'Credit'
  | 'Audit';

interface CustomerDetail {
  id: string;
  customerCode?: string | null;
  name: string;
  legalName?: string | null;
  customerType: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  contactPerson?: string | null;
  tin?: string | null;
  vrn?: string | null;
  creditLimit: number | string;
  currentBalance: number | string;
  paymentTerms?: string | null;
  status: string;
  notes?: string | null;
  companyId: string;
  divisionId?: string | null;
  branchId?: string | null;
  company?: { id: string; name: string; code?: string | null } | null;
  division?: { id: string; name: string; code?: string | null } | null;
  branch?: { id: string; name: string; code?: string | null } | null;
  createdAt?: string;
  updatedAt?: string;
}

interface SalesOrderLine {
  id: string;
  description?: string | null;
  quantity: number | string;
  unitPrice: number | string;
  lineTotal: number | string;
  product?: {
    id: string;
    productCode?: string | null;
    sku?: string | null;
    name: string;
    category?: { name: string } | null;
  } | null;
  unit?: { name: string; symbol?: string | null } | null;
}

interface SalesOrder {
  id: string;
  salesOrderNumber: string;
  orderDate: string;
  status: string;
  paymentStatus: string;
  salesType: string;
  totalAmount: number | string;
  paidAmount: number | string;
  outstandingAmount: number | string;
  currency: string;
  salesperson?: { fullName?: string | null; employeeCode?: string | null } | null;
  lines?: SalesOrderLine[];
}

interface Receivable {
  id: string;
  receivableNumber: string;
  issueDate: string;
  dueDate?: string | null;
  status: string;
  amount: number | string;
  paidAmount: number | string;
  outstandingAmount: number | string;
  currency: string;
  notes?: string | null;
  salesOrders?: Array<{
    id: string;
    salesOrderNumber: string;
    status: string;
    totalAmount: number | string;
  }>;
}

interface StatementRun {
  id: string;
  statementRunNumber: string;
  periodStart: string;
  periodEnd: string;
  totalDebits: number | string;
  totalCredits: number | string;
  closingBalance: number | string;
  status: string;
  generatedAt?: string;
  generatedBy?: { fullName?: string | null; email?: string | null } | null;
}

interface ProductHistory {
  product: {
    id: string;
    productCode?: string | null;
    sku?: string | null;
    name: string;
    category?: { name: string; categoryType?: string | null } | null;
  };
  unit?: { name: string; symbol?: string | null } | null;
  quantity: number;
  totalAmount: number;
  lastPurchasedAt: string;
}

interface PriceAgreement {
  id: string;
  agreedPrice?: number | string | null;
  discountPercent?: number | string | null;
  startDate: string;
  endDate?: string | null;
  status: string;
  notes?: string | null;
  priceList?: { id: string; name: string; priceListType?: string | null; status: string } | null;
}

interface LedgerEvent {
  id: string;
  type: string;
  sourceId: string;
  reference: string;
  date: string;
  dueDate?: string | null;
  status: string;
  paymentStatus?: string;
  debit: number;
  credit: number;
  balanceImpact: number;
  currency: string;
  notes?: string | null;
}

interface CustomerControlCenter {
  customer: CustomerDetail;
  summary: {
    lifetimeSalesTotal: number;
    ytdSalesTotal: number;
    paidSalesTotal: number;
    salesOrderCount: number;
    openReceivableBalance: number;
    overdueReceivableBalance: number;
    paidReceivableTotal: number;
    receivableCount: number;
    creditLimit: number;
    creditAvailable: number;
    creditUtilizationPct: number;
  };
  recentSalesOrders: SalesOrder[];
  openReceivables: Receivable[];
  recentReceivables: Receivable[];
  latestStatements: StatementRun[];
  priceAgreements: PriceAgreement[];
  productHistory: ProductHistory[];
  ledger: LedgerEvent[];
  audit?: {
    createdAt?: string;
    updatedAt?: string;
    createdBy?: { fullName?: string | null; email?: string | null } | null;
    updatedBy?: { fullName?: string | null; email?: string | null } | null;
  };
}

// Server-side per-customer aging (GET /financial-reports/customer-aging-detail/
// :companyId/:customerId). Unbounded + bucketed on the backend, so this is the
// TRUE aging — the source of record for the A/R Aging card below.
type ServerBucket = 'current' | 'days1_30' | 'days31_60' | 'days61_90' | 'over90';

interface CustomerAgingDetail {
  companyId: string;
  customerId: string;
  customerName: string | null;
  asOf: string;
  current: number;
  days1_30: number;
  days31_60: number;
  days61_90: number;
  over90: number;
  total: number;
  oldestDaysOverdue: number;
  receivableCount: number;
  receivables: Array<{
    id: string;
    receivableNumber: string;
    amount: number;
    paidAmount: number;
    outstandingAmount: number;
    currency: string;
    issueDate: string;
    dueDate: string | null;
    status: string;
    journalEntryId: string | null;
    daysOverdue: number;
    bucket: ServerBucket;
  }>;
}

const TABS: Tab[] = [
  'Overview',
  'Sales',
  'Receivables',
  'Products',
  'Statements',
  'Pricing',
  'Credit',
  'Audit',
];

function money(value: number | string | null | undefined, currency = 'TZS') {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
  const numeric = Number(value);
  return `${currency} ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(numeric) ? numeric : 0)}`;
}

function shortDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString();
}

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

// Faithful copy of agingBucket() from finance/receivables/page.tsx so the
// customer control center classifies debtor age with identical math.
type AgingKey = 'Current' | '1-30 days' | '31-60 days' | '61-90 days' | '90+ days';

function agingBucket(dueDate: string): AgingKey {
  const days = Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
  if (days <= 0) return 'Current';
  if (days <= 30) return '1-30 days';
  if (days <= 60) return '31-60 days';
  if (days <= 90) return '61-90 days';
  return '90+ days';
}

const AGING_ORDER: AgingKey[] = ['Current', '1-30 days', '31-60 days', '61-90 days', '90+ days'];

const AGING_TONE: Record<AgingKey, string> = {
  Current: 'partner-tone-success',
  '1-30 days': 'partner-tone-info',
  '31-60 days': 'partner-tone-warning',
  '61-90 days': 'partner-tone-warning',
  '90+ days': 'partner-tone-danger',
};

interface AgingRow {
  key: AgingKey;
  amount: number;
  count: number;
}

// Maps the backend's bucket keys to the display labels used by AGING_ORDER/TONE.
const SERVER_BUCKET_LABEL: Record<ServerBucket, AgingKey> = {
  current: 'Current',
  days1_30: '1-30 days',
  days31_60: '31-60 days',
  days61_90: '61-90 days',
  over90: '90+ days',
};

// Builds the aging rows from the TRUE server-side aging detail. Amounts come
// straight from the backend bucket sums; per-bucket counts are derived from the
// returned receivable list so we can still show "N invoices" per bucket.
function buildServerAging(detail: CustomerAgingDetail): { rows: AgingRow[]; total: number } {
  const amounts: Record<AgingKey, number> = {
    Current: detail.current,
    '1-30 days': detail.days1_30,
    '31-60 days': detail.days31_60,
    '61-90 days': detail.days61_90,
    '90+ days': detail.over90,
  };
  const counts: Record<AgingKey, number> = {
    Current: 0,
    '1-30 days': 0,
    '31-60 days': 0,
    '61-90 days': 0,
    '90+ days': 0,
  };
  for (const receivable of detail.receivables) {
    const outstanding = Number(receivable.outstandingAmount ?? 0);
    if (!Number.isFinite(outstanding) || outstanding <= 0) continue;
    counts[SERVER_BUCKET_LABEL[receivable.bucket]] += 1;
  }
  return {
    rows: AGING_ORDER.map((key) => ({
      key,
      amount: Number(amounts[key] ?? 0),
      count: counts[key],
    })),
    total: Number(detail.total ?? 0),
  };
}

// Builds the current/1-30/31-60/61-90/90+ breakdown from the customer's
// receivables. Receivables without a due date fall into "Current".
function buildAging(receivables: Receivable[]): { rows: AgingRow[]; total: number } {
  const totals: Record<AgingKey, AgingRow> = {
    Current: { key: 'Current', amount: 0, count: 0 },
    '1-30 days': { key: '1-30 days', amount: 0, count: 0 },
    '31-60 days': { key: '31-60 days', amount: 0, count: 0 },
    '61-90 days': { key: '61-90 days', amount: 0, count: 0 },
    '90+ days': { key: '90+ days', amount: 0, count: 0 },
  };
  let total = 0;
  for (const receivable of receivables) {
    const outstanding = Number(receivable.outstandingAmount ?? 0);
    if (!Number.isFinite(outstanding) || outstanding <= 0) continue;
    const bucket = receivable.dueDate ? agingBucket(receivable.dueDate) : 'Current';
    totals[bucket].amount += outstanding;
    totals[bucket].count += 1;
    total += outstanding;
  }
  return { rows: AGING_ORDER.map((key) => totals[key]), total };
}

function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string | number | null;
  mono?: boolean;
}) {
  return (
    <div className="partner-profile-detail">
      <p className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
        {label}
      </p>
      <p
        className={`mt-1 text-sm ${mono ? 'font-mono' : 'font-medium'}`}
        style={{ color: 'var(--aurora-text)' }}
      >
        {value ?? '—'}
      </p>
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div
      className="rounded-lg border px-4 py-8 text-center text-sm"
      style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-muted)' }}
    >
      {text}
    </div>
  );
}

export function CustomerProfile({ customerId }: { customerId: string }) {
  const router = useGuardedRouter();
  const { request } = useUnsavedWork();
  const { hasPermission, loading: authLoading } = useAuth();
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<Tab>('Overview');
  const [editing, setEditing] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const canView = !authLoading && hasPermission('customers.view');
  const canViewReports = hasPermission('operations.reports.view');
  const canViewFinanceReports = hasPermission('finance.reports.view');
  const canGenerateStatements = hasPermission('customer_statements.generate');
  const canManageCustomers = hasPermission('customers.update');
  const canOpenReceivables = hasPermission('receivables.view');
  const canOpenSales = hasPermission('sales.view');

  const result = useWorkspaceResource<CustomerControlCenter>(
    `/customers/${customerId}/control-center`,
    {},
    canView && !!customerId,
  );
  const { data, loading, error, reload: load } = result;
  const agingResult = useWorkspaceResource<CustomerAgingDetail>(
    `/financial-reports/customer-aging-detail/${data?.customer.companyId || ''}/${customerId}`,
    {},
    canView && canViewFinanceReports && !!data?.customer.companyId,
  );
  const agingDetail = agingResult.data;
  useLinkedDeskChanges('sales-desk', editing || confirmBlock, () => {
    load();
    agingResult.reload();
  });
  const creditColor = useMemo(() => {
    const utilization = data?.summary.creditUtilizationPct ?? 0;
    if (utilization >= 90) return 'partner-tone-danger';
    if (utilization >= 70) return 'partner-tone-warning';
    return 'partner-tone-success';
  }, [data?.summary.creditUtilizationPct]);

  // A/R aging is driven by the TRUE server-side aging detail
  // (financial-reports/customer-aging-detail) — unbounded and bucketed on the
  // backend, so the per-bucket breakdown AND total cover every open invoice.
  //
  // Fallback: if that endpoint is unavailable (no finance.reports.view, or a
  // transient failure), fall back to a client-side estimate over the
  // control-center receivables. That slice is capped (take:10), so the fallback
  // is flagged partial via `isServer: false` and the card surfaces the caveat.
  const aging = useMemo(() => {
    if (agingDetail) {
      const built = buildServerAging(agingDetail);
      return {
        ...built,
        isServer: true,
        listedCount: agingDetail.receivableCount,
      };
    }
    if (!data) return { rows: [] as AgingRow[], total: 0, isServer: false, listedCount: 0 };
    const source =
      data.openReceivables && data.openReceivables.length > 0
        ? data.openReceivables
        : data.recentReceivables;
    const built = buildAging(source);
    return { ...built, isServer: false, listedCount: source.length };
  }, [agingDetail, data]);

  if (authLoading)
    return (
      <p role="status" className="workspace-notice">
        Loading profile...
      </p>
    );
  if (!canView) {
    return (
      <div className="business-workspace partner-profile">
        <PageHeader title="Customer" subtitle="Customer control center" />
        <p className="mt-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
          Access restricted.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="business-workspace partner-profile">
        <PageHeader title="Customer" subtitle="Loading customer control center" />
        <SkeletonCardGrid count={6} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="business-workspace partner-profile">
        <PageHeader title="Customer" subtitle="Customer control center" />
        <Card className="p-6">
          <p role="alert" className="workspace-notice">
            {error || 'Customer not found'}
          </p>
          <Btn variant="secondary" onClick={load}>
            Try again
          </Btn>
          <Btn
            className="mt-4"
            variant="secondary"
            onClick={() => router.push('/sales-desk/customers')}
          >
            Back to Customers
          </Btn>
        </Card>
      </div>
    );
  }

  const { customer, summary } = data;

  return (
    <div className="business-workspace partner-profile">
      <div className="partner-profile-heading">
        <PageHeader
          title={customer.name}
          breadcrumbs={[
            { label: 'Sales Desk', href: '/sales-desk' },
            { label: 'Customers', href: '/sales-desk/customers' },
            { label: customer.name },
          ]}
          subtitle={`${customer.customerCode ?? 'No code'} - ${customer.company?.name ?? 'Company'} - ${customer.branch?.name ?? 'No branch'}`}
        />
        <div className="partner-profile-actions">
          {canOpenReceivables && (
            <Btn
              variant="secondary"
              onClick={() =>
                router.push(
                  `/finance/receivables?customerId=${encodeURIComponent(customer.id)}&companyId=${encodeURIComponent(customer.companyId)}`,
                )
              }
            >
              Open receivables
            </Btn>
          )}
          {canOpenSales && (
            <Btn variant="secondary" onClick={() => router.push('/sales-desk/sales')}>
              Open sales
            </Btn>
          )}
          {canGenerateStatements && (
            <Btn variant="secondary" onClick={() => request(() => setTab('Statements'))}>
              Statements
            </Btn>
          )}
          {canManageCustomers && (
            <>
              <Btn variant="primary" onClick={() => setEditing(true)}>
                Edit customer
              </Btn>
              <Btn variant="ghost" onClick={() => setConfirmBlock(true)}>
                {customer.status === 'BLOCKED' ? 'Unblock Credit' : 'Block Credit'}
              </Btn>
            </>
          )}
          <Btn variant="secondary" onClick={() => router.push('/sales-desk/customers')}>
            Back to Customers
          </Btn>
          {canViewReports && (
            <Btn
              variant="secondary"
              onClick={() =>
                router.push(`/operations/reports?search=${encodeURIComponent(customer.name)}`)
              }
            >
              Customer Reports
            </Btn>
          )}
          <Btn variant="secondary" onClick={() => request(load)}>
            Refresh
          </Btn>
          <StatusBadge status={customer.status} />
        </div>
      </div>

      {editing && (
        <TradingPartnerEditor
          kind="customers"
          record={customer}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setNotice('Customer saved.');
            load();
          }}
        />
      )}
      {confirmBlock && (
        <PartnerAction
          partnerKind="customers"
          record={customer}
          kind={customer.status === 'BLOCKED' ? 'unblock' : 'block'}
          onClose={() => setConfirmBlock(false)}
          onSaved={() => {
            setConfirmBlock(false);
            setNotice('Customer status updated.');
            load();
          }}
        />
      )}

      {notice && (
        <p role="status" className="workspace-notice">
          {notice}
        </p>
      )}
      <div className="workspace-summary">
        <div>
          <span>Lifetime Sales</span>
          <strong>{money(summary.lifetimeSalesTotal)}</strong>
        </div>
        <div>
          <span>YTD Sales</span>
          <strong>{money(summary.ytdSalesTotal)}</strong>
        </div>
        <div>
          <span>Open AR</span>
          <strong>{money(summary.openReceivableBalance)}</strong>
        </div>
        <div>
          <span>Overdue AR</span>
          <strong>{money(summary.overdueReceivableBalance)}</strong>
        </div>
      </div>

      <Card padding="none" className="overflow-hidden">
        <ProfileSections
          items={TABS}
          value={tab}
          onChange={(next) => request(() => setTab(next))}
        />

        <section
          id="partner-profile-section"
          aria-label={`${tab} section`}
          className="partner-profile-content"
        >
          {tab === 'Overview' &&
            (() => {
              // When the true server-side aging is available, the bucket total IS the
              // complete outstanding balance (every open invoice). Otherwise we fall
              // back to summary.openReceivableBalance (an unbounded aggregate sum) so
              // the headline still reconciles with the Open AR StatCard even though the
              // client-side buckets only cover the control-center's capped slice.
              const totalOutstanding = aging.isServer ? aging.total : summary.openReceivableBalance;
              // Only meaningful in the fallback path: if the true total exceeds the
              // bucketed sum, older open invoices exist but weren't in the capped
              // control-center slice. Never partial once server aging is in play.
              const unaccounted = Math.max(0, totalOutstanding - aging.total);
              const isPartial = !aging.isServer && unaccounted > 0.005;
              const hasAnyOutstanding = totalOutstanding > 0 || aging.total > 0;
              return (
                <Card className="p-5 mb-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                        A/R Aging
                      </h3>
                      <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        Outstanding receivables by days past due
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className="text-xs uppercase"
                        style={{ color: 'var(--aurora-text-muted)' }}
                      >
                        Total Outstanding
                      </p>
                      <p
                        className="text-base font-semibold"
                        style={{ color: 'var(--aurora-text)' }}
                      >
                        {money(totalOutstanding)}
                      </p>
                    </div>
                  </div>
                  {canViewFinanceReports && agingResult.loading && (
                    <p role="status" className="partner-profile-history-note">
                      Loading complete aging...
                    </p>
                  )}
                  {agingResult.error && (
                    <p role="alert" className="workspace-notice">
                      Complete aging unavailable. The breakdown below uses recent invoices.{' '}
                      <Btn variant="ghost" onClick={agingResult.reload}>
                        Retry aging
                      </Btn>
                    </p>
                  )}
                  {!hasAnyOutstanding ? (
                    <div className="mt-4">
                      <EmptyPanel text="No outstanding receivables to age for this customer." />
                    </div>
                  ) : (
                    <>
                      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
                        <p
                          className="text-xs font-medium uppercase"
                          style={{ color: 'var(--aurora-text-muted)' }}
                        >
                          {aging.isServer
                            ? `Aging (${aging.listedCount} ${aging.listedCount === 1 ? 'invoice' : 'invoices'})`
                            : `Aging (latest ${aging.listedCount} ${aging.listedCount === 1 ? 'invoice' : 'invoices'})`}
                        </p>
                        {isPartial && (
                          <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                            Breakdown covers the most-recent invoices only.
                          </p>
                        )}
                      </div>
                      <div className="mt-3 partner-aging-grid">
                        {aging.rows.map((row) => {
                          const pct = aging.total > 0 ? (row.amount / aging.total) * 100 : 0;
                          return (
                            <div
                              key={row.key}
                              className="rounded-lg border p-4"
                              style={{ borderColor: 'var(--aurora-border)' }}
                            >
                              <p
                                className="text-xs uppercase"
                                style={{ color: 'var(--aurora-text-muted)' }}
                              >
                                {row.key}
                              </p>
                              <p
                                className={`mt-1 partner-aging-value font-semibold ${AGING_TONE[row.key]}`}
                              >
                                {money(row.amount)}
                              </p>
                              <p
                                className="mt-1 text-xs"
                                style={{ color: 'var(--aurora-text-muted)' }}
                              >
                                {row.count} {row.count === 1 ? 'invoice' : 'invoices'} ·{' '}
                                {pct.toFixed(0)}%
                              </p>
                            </div>
                          );
                        })}
                      </div>
                      <div
                        className="mt-4 flex h-2 w-full overflow-hidden rounded-full"
                        style={{ background: 'var(--aurora-border)' }}
                        role="img"
                        aria-label="A/R aging distribution"
                      >
                        {aging.rows.map((row) => {
                          const pct = aging.total > 0 ? (row.amount / aging.total) * 100 : 0;
                          if (pct <= 0) return null;
                          return (
                            <div
                              key={row.key}
                              className={AGING_TONE[row.key]}
                              style={{ width: `${pct}%`, background: 'currentColor' }}
                              title={`${row.key}: ${money(row.amount)}`}
                            />
                          );
                        })}
                      </div>
                      {isPartial && (
                        <p className="mt-3 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                          Buckets total {money(aging.total)} across the listed invoices ·{' '}
                          <span
                            className="font-medium"
                            style={{ color: 'var(--aurora-text-secondary)' }}
                          >
                            + {money(unaccounted)} in older invoices not shown
                          </span>
                        </p>
                      )}
                    </>
                  )}
                </Card>
              );
            })()}
          {tab === 'Overview' && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:col-span-2">
                <DetailItem label="Legal Name" value={customer.legalName} />
                <DetailItem label="Customer Type" value={humanize(customer.customerType)} />
                <DetailItem label="Contact Person" value={customer.contactPerson} />
                <DetailItem label="Phone" value={customer.phone} />
                <DetailItem label="Email" value={customer.email} />
                <DetailItem label="TIN" value={customer.tin} mono />
                <DetailItem label="VRN" value={customer.vrn} mono />
                <DetailItem label="Payment Terms" value={customer.paymentTerms} />
                <DetailItem label="Division" value={customer.division?.name} />
                <DetailItem label="Branch" value={customer.branch?.name} />
                <div className="md:col-span-2">
                  <DetailItem label="Address" value={customer.address} />
                </div>
                <div className="md:col-span-2">
                  <DetailItem label="Notes" value={customer.notes} />
                </div>
              </div>
              <div
                className="rounded-lg border p-4"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <h3 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  Credit Snapshot
                </h3>
                <div className="mt-4 space-y-3">
                  <DetailItem label="Credit Limit" value={money(summary.creditLimit)} />
                  <DetailItem
                    label="Current Exposure"
                    value={money(summary.openReceivableBalance)}
                  />
                  <DetailItem label="Available Credit" value={money(summary.creditAvailable)} />
                  <div>
                    <p className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                      Utilization
                    </p>
                    <p className={`mt-1 text-lg font-semibold ${creditColor}`}>
                      {summary.creditUtilizationPct.toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'Sales' && (
            <div className="space-y-4">
              <p className="partner-profile-history-note">
                Recent records returned by this profile. Summary balances cover all records.
              </p>
              {data.recentSalesOrders.length === 0 ? (
                <EmptyPanel text="No sales orders for this customer yet." />
              ) : (
                data.recentSalesOrders.map((order) => (
                  <div
                    key={order.id}
                    className="rounded-lg border p-4"
                    style={{ borderColor: 'var(--aurora-border)' }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                          {order.salesOrderNumber}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                          {shortDate(order.orderDate)} - {humanize(order.salesType)} -{' '}
                          {money(order.totalAmount, order.currency)}
                        </p>
                      </div>
                      <div className="partner-profile-order-actions">
                        <StatusBadge status={order.status} />
                        <StatusBadge status={order.paymentStatus} />
                        {hasPermission('sales.view') && (
                          <Btn
                            variant="secondary"
                            size="xs"
                            onClick={() => router.push(`/sales-desk/sales/${order.id}/print`)}
                          >
                            View / Print
                          </Btn>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 overflow-x-auto">
                      <WorkspaceTable className="partner-profile-table">
                        <thead style={{ color: 'var(--aurora-text-muted)' }}>
                          <tr className="text-left uppercase">
                            <th className="py-2">Product</th>
                            <th className="py-2 text-right">Qty</th>
                            <th className="py-2 text-right">Unit Price</th>
                            <th className="py-2 text-right">Line Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {order.lines?.map((line) => (
                            <tr
                              key={line.id}
                              className="border-t"
                              style={{ borderColor: 'var(--aurora-border)' }}
                            >
                              <td data-label="Product" className="py-2">
                                {line.product?.name ?? line.description ?? 'Product'}
                              </td>
                              <td data-label="Qty" className="py-2 text-right">
                                {Number(line.quantity).toLocaleString()} {line.unit?.symbol ?? ''}
                              </td>
                              <td data-label="Unit Price" className="py-2 text-right">
                                {money(line.unitPrice, order.currency)}
                              </td>
                              <td data-label="Line Total" className="py-2 text-right">
                                {money(line.lineTotal, order.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </WorkspaceTable>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'Receivables' && (
            <div className="space-y-4">
              <p className="partner-profile-history-note">
                Recent records returned by this profile. Summary balances cover all records.
              </p>
              {data.recentReceivables.length === 0 ? (
                <EmptyPanel text="No receivables recorded for this customer." />
              ) : (
                data.recentReceivables.map((receivable) => (
                  <div
                    key={receivable.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                    style={{ borderColor: 'var(--aurora-border)' }}
                  >
                    <div>
                      <p className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                        {receivable.receivableNumber}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        Issued {shortDate(receivable.issueDate)} - Due{' '}
                        {shortDate(receivable.dueDate)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">
                        {money(receivable.outstandingAmount, receivable.currency)}
                      </p>
                      <div className="mt-1 flex justify-end">
                        <StatusBadge status={receivable.status} />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'Products' && (
            <div className="overflow-x-auto">
              <p className="partner-profile-history-note">
                Product history returned by this profile.
              </p>
              {data.productHistory.length === 0 ? (
                <EmptyPanel text="No product sales history found yet." />
              ) : (
                <WorkspaceTable className="partner-profile-table">
                  <thead
                    className="text-left text-xs uppercase"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    <tr>
                      <th className="py-2">Product</th>
                      <th className="py-2">Category</th>
                      <th className="py-2 text-right">Quantity</th>
                      <th className="py-2 text-right">Amount</th>
                      <th className="py-2">Last Bought</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.productHistory.map((row) => (
                      <tr
                        key={row.product.id}
                        className="border-t"
                        style={{ borderColor: 'var(--aurora-border)' }}
                      >
                        <td data-label="Product" className="py-3">
                          <div className="font-medium">{row.product.name}</div>
                          <div
                            className="font-mono text-xs"
                            style={{ color: 'var(--aurora-text-muted)' }}
                          >
                            {row.product.productCode ?? row.product.sku ?? ''}
                          </div>
                        </td>
                        <td data-label="Category" className="py-3">
                          {row.product.category?.name ?? '-'}
                        </td>
                        <td data-label="Quantity" className="py-3 text-right">
                          {row.quantity.toLocaleString()} {row.unit?.symbol ?? ''}
                        </td>
                        <td data-label="Amount" className="py-3 text-right">
                          {money(row.totalAmount)}
                        </td>
                        <td data-label="Last Bought" className="py-3">
                          {shortDate(row.lastPurchasedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </WorkspaceTable>
              )}
            </div>
          )}

          {tab === 'Statements' && (
            <div className="space-y-5">
              <p className="partner-profile-history-note">
                Recent records returned by this profile. Summary balances cover all records.
              </p>
              <PartnerStatementGenerator
                kind="customers"
                record={customer}
                onGenerated={() => {
                  setNotice('Customer statement generated.');
                  load();
                }}
              />
              {data.latestStatements.length === 0 ? (
                <EmptyPanel text="No customer statements have been generated." />
              ) : (
                data.latestStatements.map((statement) => (
                  <div
                    key={statement.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                    style={{ borderColor: 'var(--aurora-border)' }}
                  >
                    <div>
                      <p className="font-semibold">{statement.statementRunNumber}</p>
                      <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {shortDate(statement.periodStart)} - {shortDate(statement.periodEnd)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{money(statement.closingBalance)}</p>
                      <StatusBadge status={statement.status} />
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'Pricing' && (
            <div className="space-y-3">
              <p className="partner-profile-history-note">
                Recent records returned by this profile. Summary balances cover all records.
              </p>
              {data.priceAgreements.length === 0 ? (
                <EmptyPanel text="No customer-specific price agreements found." />
              ) : (
                data.priceAgreements.map((agreement) => (
                  <div
                    key={agreement.id}
                    className="rounded-lg border p-4"
                    style={{ borderColor: 'var(--aurora-border)' }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold">
                          {agreement.priceList?.name ?? 'Direct price agreement'}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                          {shortDate(agreement.startDate)} - {shortDate(agreement.endDate)}
                        </p>
                      </div>
                      <StatusBadge status={agreement.status} />
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                      <DetailItem
                        label="Agreed Price"
                        value={agreement.agreedPrice != null ? money(agreement.agreedPrice) : '—'}
                      />
                      <DetailItem
                        label="Discount %"
                        value={
                          agreement.discountPercent != null ? `${agreement.discountPercent}%` : '—'
                        }
                      />
                      <DetailItem label="Notes" value={agreement.notes} />
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'Credit' && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <DetailItem label="Credit Limit" value={money(summary.creditLimit)} />
              <DetailItem label="Open Receivables" value={money(summary.openReceivableBalance)} />
              <DetailItem
                label="Overdue Receivables"
                value={money(summary.overdueReceivableBalance)}
              />
              <DetailItem label="Available Credit" value={money(summary.creditAvailable)} />
              <DetailItem
                label="Credit Utilization"
                value={`${summary.creditUtilizationPct.toFixed(1)}%`}
              />
              <DetailItem label="Customer Status" value={humanize(customer.status)} />
            </div>
          )}

          {tab === 'Audit' && (
            <div className="space-y-5">
              <p className="partner-profile-history-note">
                Recent ledger activity returned by this profile.
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <DetailItem
                  label="Created At"
                  value={shortDate(data.audit?.createdAt ?? customer.createdAt)}
                />
                <DetailItem
                  label="Updated At"
                  value={shortDate(data.audit?.updatedAt ?? customer.updatedAt)}
                />
                <DetailItem
                  label="Created By"
                  value={data.audit?.createdBy?.fullName ?? data.audit?.createdBy?.email}
                />
                <DetailItem
                  label="Updated By"
                  value={data.audit?.updatedBy?.fullName ?? data.audit?.updatedBy?.email}
                />
              </div>
              <div>
                <h3 className="mb-3 text-sm font-semibold">Recent Ledger Events</h3>
                {data.ledger.length === 0 ? (
                  <EmptyPanel text="No customer ledger events yet." />
                ) : (
                  <div className="space-y-2">
                    {data.ledger.map((event) => (
                      <div
                        key={event.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                        style={{ borderColor: 'var(--aurora-border)' }}
                      >
                        <div>
                          <p className="font-medium">{event.reference}</p>
                          <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                            {humanize(event.type)} - {shortDate(event.date)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p>{money(event.balanceImpact, event.currency)}</p>
                          <StatusBadge status={event.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </Card>
    </div>
  );
}
