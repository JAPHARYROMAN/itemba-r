'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type React from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { AppIcon, type AppIconName, showToast } from '@/components/ui';
import {
  AuroraPage,
  AuroraPageHeader,
  AuroraToolbar,
  AuroraSection,
  AuroraCard,
  AuroraButton,
  StatCard,
  AlertCard,
  SummaryGrid,
  LoadingState,
  ErrorState,
  RestrictedDataState,
  StatusBadge,
  DataTable,
} from '@/components/aurora';
import type { Column } from '@/components/aurora/data-display/DataTable';
import { getStatusVariant } from '@/lib/design-system';
import { useCountUp } from '@/hooks/use-count-up';

function PulseValue({ value }: { value: number }) {
  const counted = useCountUp(value);
  return <>{Math.round(counted).toLocaleString()}</>;
}

interface Division {
  id: string;
  name: string;
  code: string;
}

interface DashCompany {
  id: string;
  name: string;
  code: string;
  status: string;
  industryType: string | null;
  divisions: Division[];
}

interface AlertContract {
  id: string;
  title: string;
  endDate: string | null;
  counterpartyName: string;
  contractType: string;
  daysLeft: number | null;
}

interface AlertLoan {
  id: string;
  lenderName: string;
  maturityDate: string | null;
  outstandingBalance: string | null;
  currency: string;
}

interface AlertDoc {
  id: string;
  title: string;
  category: string;
  expiryDate: string | null;
  daysLeft: number | null;
}

interface AlertLoanHighRisk {
  id: string;
  lenderName: string;
  riskLevel: string;
  outstandingBalance: string | null;
  currency: string;
  maturityDate: string | null;
}

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  severity: string;
  createdAt: string;
  ipAddress: string | null;
  user: { fullName: string; email: string } | null;
  company: { name: string; code: string } | null;
}

interface ExceptionItem {
  id: string;
  type: string;
  severity: 'NORMAL' | 'HIGH' | 'CRITICAL';
  title: string;
  description: string;
  dueDate: string | null;
  href: string;
}

interface RecentSalesOrder {
  id: string;
  salesOrderNumber: string;
  customerName: string | null;
  totalAmount: string | number;
  outstandingAmount: string | number;
  status: string;
  paymentStatus: string;
  orderDate: string;
}

interface RecentPurchaseOrder {
  id: string;
  purchaseOrderNumber: string;
  supplierName: string | null;
  totalAmount: string | number;
  outstandingAmount: string | number;
  status: string;
  paymentStatus: string;
  orderDate: string;
}

interface Summary {
  generatedAt: string;
  overview: {
    companies: number;
    divisions: number;
    branches: number;
    activeUsers: number;
  };
  finance: {
    receivables: {
      open: number;
      outstanding: number;
      overdue: number;
      overdueOutstanding: number;
    };
    payables: {
      open: number;
      outstanding: number;
      overdue: number;
      overdueOutstanding: number;
    };
    cashAccounts: { active: number; balance: number };
    expenses: { pending: number; paidThisMonth: number };
  };
  operations: {
    salesOrders: {
      total: number;
      draft: number;
      confirmed: number;
      unpaid: number;
      todayCount: number;
      todayRevenue: number;
      monthRevenue: number;
    };
    purchaseOrders: {
      total: number;
      draft: number;
      confirmed: number;
      received: number;
      outstanding: number;
      monthSpend: number;
    };
    inventory: {
      activeProducts: number;
      balanceRows: number;
      quantityOnHand: number;
      stockValue: number;
      zeroOrBelow: number;
      negative: number;
    };
    stockAdjustments: {
      draft: number;
      pending: number;
      approvedUnposted: number;
      posted: number;
    };
  };
  procurement: {
    requisitions: { pending: number; approved: number };
    rfqs: { active: number };
    supplierInvoices: { pending: number; disputed: number; outstanding: number };
  };
  workflow: {
    approvals: { pending: number; escalated: number; dueSoon: number };
  };
  people: {
    employees: { active: number; onLeave: number; suspended: number };
  };
  compliance: {
    obligations: { overdue: number; dueSoon: number };
    taxReturns: { pending: number; outstanding: number };
  };
  petroleum: {
    openShifts: number;
    litresSoldToday: number;
    expectedCollectionsToday: number;
    recordedCollectionsToday: number;
    varianceToday: number;
  };
  exceptions: ExceptionItem[];
  recentTransactions: {
    salesOrders: RecentSalesOrder[];
    purchaseOrders: RecentPurchaseOrder[];
  };
  groupControl: {
    bankAccounts: { total: number; active: number };
    loans: { active: number; outstanding: number; overdue: number };
    debts: { outstanding: number; totalAmount: number };
    contracts: {
      active: number;
      expiringIn30: number;
      expiringIn60: number;
      pendingApproval: number;
    };
    fixedAssets: {
      total: number;
      totalValue: number;
      collateral: number;
      uninsured: number;
      disposed: number;
    };
    documents: { total: number; sensitive: number; expiring: number };
    audit: { events24h: number; critical24h: number };
  };
  companies: DashCompany[];
  alerts: {
    expiringContracts: AlertContract[];
    upcomingMaturities: AlertLoan[];
    expiringDocuments: AlertDoc[];
    highRiskLoans: AlertLoanHighRisk[];
  };
  recentActivity: AuditEntry[];
}

function fmt(n: number, currency = false) {
  if (currency) {
    return new Intl.NumberFormat('en-TZ', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  }
  return n.toLocaleString();
}

function money(n: string | number | null | undefined) {
  return `TZS ${fmt(Number(n ?? 0), true)}`;
}

function compactMoney(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `TZS ${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `TZS ${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `TZS ${(n / 1_000).toFixed(1)}K`;
  return money(n);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return 'No date';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function fmtDateTime(d: Date | null) {
  if (!d) return 'Not loaded yet';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toneForSeverity(severity: ExceptionItem['severity']) {
  if (severity === 'CRITICAL') return 'var(--aurora-danger)';
  if (severity === 'HIGH') return 'var(--aurora-warning-text)';
  return 'var(--aurora-primary)';
}

const COMPANY_META: Record<string, { icon: AppIconName; href: string }> = {
  default: { icon: 'company', href: '/companies' },
  mwanjalisi: { icon: 'cash', href: '/operations' },
  itemba: { icon: 'delivery', href: '/group-control' },
  westsides: { icon: 'sale', href: '/westsides' },
};

function companyMeta(name: string) {
  const n = name.toLowerCase();
  if (n.includes('mwanjalisi')) return COMPANY_META.mwanjalisi;
  if (n.includes('itemba')) return COMPANY_META.itemba;
  if (n.includes('west')) return COMPANY_META.westsides;
  return COMPANY_META.default;
}

type AuditRow = AuditEntry & Record<string, unknown>;

const auditColumns: Column<AuditRow>[] = [
  {
    key: 'createdAt',
    header: 'Time',
    accessor: (row) => (
      <span className="font-mono text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
        {new Date(row.createdAt).toLocaleString()}
      </span>
    ),
  },
  {
    key: 'severity',
    header: 'Severity',
    accessor: (row) => (
      <StatusBadge status={row.severity} variant={getStatusVariant(row.severity)} size="sm" />
    ),
  },
  {
    key: 'action',
    header: 'Action',
    accessor: (row) => (
      <span className="text-xs font-medium" style={{ color: 'var(--aurora-text)' }}>
        {row.action.replace(/_/g, ' ')}
      </span>
    ),
  },
  {
    key: 'entityType',
    header: 'Entity',
    accessor: (row) => (
      <span className="text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
        {row.entityType}
      </span>
    ),
  },
  {
    key: 'user',
    header: 'User',
    accessor: (row) => (
      <span className="text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
        {row.user?.fullName ?? 'System'}
      </span>
    ),
  },
];

function SignalCard({
  title,
  value,
  detail,
  href,
  icon,
  status,
  tone = 'var(--aurora-primary)',
}: {
  title: string;
  value: string | number;
  detail: string;
  href: string;
  icon: AppIconName;
  status: string;
  tone?: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-aurora border px-4 py-4 aurora-transition hover:-translate-y-0.5 hover:shadow-sm"
      style={{
        background: 'var(--aurora-card)',
        borderColor: 'var(--aurora-border)',
        borderLeft: `3px solid ${tone}`,
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p
            className="text-xs font-semibold uppercase"
            style={{ color: 'var(--aurora-text-muted)' }}
          >
            {title}
          </p>
          <p className="mt-2 aurora-metric text-2xl" style={{ color: 'var(--aurora-text)' }}>
            {typeof value === 'number' ? <PulseValue value={value} /> : value}
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
            {detail}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span style={{ color: tone }}>
            <AppIcon name={icon} size={20} strokeWidth={1.8} />
          </span>
          <StatusBadge status={status} size="sm" />
        </div>
      </div>
    </Link>
  );
}

function WorkstreamCard({
  title,
  description,
  href,
  icon,
  children,
}: {
  title: string;
  description: string;
  href: string;
  icon: AppIconName;
  children: React.ReactNode;
}) {
  return (
    <AuroraCard className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <AppIcon name={icon} size={20} strokeWidth={1.8} />
            <h3 className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
              {title}
            </h3>
          </div>
          <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            {description}
          </p>
        </div>
        <Link href={href} className="text-xs font-semibold" style={{ color: 'var(--aurora-primary)' }}>
          Open →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </AuroraCard>
  );
}

function MiniMetric({ label, value, danger = false }: { label: string; value: React.ReactNode; danger?: boolean }) {
  return (
    <div
      className="rounded-lg border px-3 py-2"
      style={{ background: 'var(--aurora-bg-subtle)', borderColor: 'var(--aurora-border)' }}
    >
      <p className="text-[11px] font-semibold uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
        {label}
      </p>
      <p
        className="mt-1 text-sm font-bold"
        style={{ color: danger ? 'var(--aurora-danger)' : 'var(--aurora-text)' }}
      >
        {value}
      </p>
    </div>
  );
}

export default function DashboardPage() {
  const { user, loading: authLoading, hasPermission } = useAuth();
  const canViewControl = hasPermission('group-control.view');

  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setForbidden(false);
      const res = await fetch('/api/backend/dashboard/executive-summary');
      if (res.status === 403) {
        setForbidden(true);
        setData(null);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data: Summary };
      setData(json.data);
      setLastUpdated(new Date());
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      showToast('error', 'Dashboard unavailable', message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!user) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    void loadSummary();
  }, [authLoading, user, loadSummary]);

  const now = new Date();
  const greeting =
    now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const dateStr = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const totalAlerts = !data
    ? 0
    : data.alerts.expiringContracts.length +
      data.alerts.upcomingMaturities.length +
      data.alerts.expiringDocuments.length +
      data.alerts.highRiskLoans.length;

  const operatingSignals = useMemo(() => {
    if (!data) return [];
    const blockingIssues =
      data.operations.inventory.negative +
      data.operations.stockAdjustments.approvedUnposted +
      data.workflow.approvals.escalated +
      data.compliance.obligations.overdue;

    return [
      {
        title: 'Today sales',
        value: compactMoney(data.operations.salesOrders.todayRevenue),
        detail: `${data.operations.salesOrders.todayCount} orders captured today`,
        href: '/operations/sales-orders',
        icon: 'sale' as AppIconName,
        status: data.operations.salesOrders.todayCount > 0 ? 'LIVE' : 'QUIET',
        tone: 'var(--aurora-success-text)',
      },
      {
        title: 'Receivable exposure',
        value: compactMoney(data.finance.receivables.outstanding),
        detail: `${data.finance.receivables.overdue} overdue customer balances`,
        href: '/finance/receivables',
        icon: 'cash' as AppIconName,
        status: data.finance.receivables.overdue > 0 ? 'COLLECT' : 'CLEAR',
        tone:
          data.finance.receivables.overdue > 0
            ? 'var(--aurora-warning-text)'
            : 'var(--aurora-primary)',
      },
      {
        title: 'Payable exposure',
        value: compactMoney(data.finance.payables.outstanding),
        detail: `${data.finance.payables.overdue} overdue supplier balances`,
        href: '/finance/payables',
        icon: 'payment' as AppIconName,
        status: data.finance.payables.overdue > 0 ? 'PAY' : 'CLEAR',
        tone:
          data.finance.payables.overdue > 0
            ? 'var(--aurora-warning-text)'
            : 'var(--aurora-primary)',
      },
      {
        title: 'Action queue',
        value: blockingIssues,
        detail: 'overdue compliance, escalations, stock and posting issues',
        href: '#exceptions',
        icon: 'alert' as AppIconName,
        status: blockingIssues > 0 ? 'ACTION' : 'CLEAR',
        tone: blockingIssues > 0 ? 'var(--aurora-danger)' : 'var(--aurora-success-text)',
      },
    ];
  }, [data]);

  return (
    <AuroraPage>
      <AuroraPageHeader
        title={user?.fullName ? `${greeting}, ${user.fullName.split(' ')[0]}` : 'Command Centre'}
        subtitle={`${dateStr} · Live operating dashboard across finance, sales, purchases, inventory, workflow, and compliance`}
        eyebrow="Live"
        live
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/operations/sales-orders"
              className="text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              style={{ background: 'var(--aurora-primary)', color: '#fff' }}
            >
              New sale →
            </Link>
            <Link
              href="/reports"
              className="text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              style={{
                background: 'var(--aurora-bg-subtle)',
                color: 'var(--aurora-text)',
                border: '1px solid var(--aurora-border)',
              }}
            >
              Reports
            </Link>
          </div>
        }
      />

      <AuroraToolbar
        title="Operating pulse"
        description="The dashboard now reads live business signals from transactions, balances, inventory, workflow, and compliance."
        meta={
          <>
            <StatusBadge status={user ? 'ACTIVE' : 'PENDING'} size="sm" />
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              {user ? user.fullName : 'Waiting for session'}
            </span>
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Updated {fmtDateTime(lastUpdated)}
            </span>
          </>
        }
        actions={
          <AuroraButton
            size="sm"
            variant="secondary"
            onClick={loadSummary}
            loading={loading && Boolean(data)}
            disabled={authLoading || !user}
          >
            Refresh
          </AuroraButton>
        }
        className="mt-5"
      >
        {data && (
          <div className="aurora-stagger grid grid-cols-1 gap-3 animate-fade-up md:grid-cols-4">
            {operatingSignals.map((item) => (
              <SignalCard key={item.title} {...item} />
            ))}
          </div>
        )}
      </AuroraToolbar>

      {loading && <LoadingState title="Loading command centre…" />}
      {forbidden && !loading && (
        <RestrictedDataState
          requiredPermission="Any dashboard, finance, operations, procurement, compliance, or group-control permission"
          className="mx-6 mt-6"
        />
      )}
      {error && (
        <ErrorState
          title="Dashboard Unavailable"
          description={`Failed to load: ${error}`}
          className="mx-6 mt-6"
        />
      )}

      {data && (
        <div className="space-y-8">
          <AuroraSection title="Executive Snapshot">
            <div className="p-5">
              <SummaryGrid cols={4} className="aurora-stagger">
                <StatCard title="Companies" value={data.overview.companies} subtitle={`${data.overview.divisions} divisions`} />
                <StatCard title="Branches / Sites" value={data.overview.branches} subtitle="Active operating locations" />
                <StatCard title="Active Users" value={data.overview.activeUsers} subtitle="System users enabled" />
                <StatCard title="Active Employees" value={data.people.employees.active} subtitle={`${data.people.employees.onLeave} on leave`} />
              </SummaryGrid>
            </div>
          </AuroraSection>

          <AuroraSection title="Money Movement">
            <div className="p-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
              <WorkstreamCard
                title="Receivables"
                description="Customer money owed to the group."
                href="/finance/receivables"
                icon="cash"
              >
                <MiniMetric label="Open" value={data.finance.receivables.open} />
                <MiniMetric label="Outstanding" value={compactMoney(data.finance.receivables.outstanding)} />
                <MiniMetric label="Overdue" value={data.finance.receivables.overdue} danger={data.finance.receivables.overdue > 0} />
                <MiniMetric label="Overdue value" value={compactMoney(data.finance.receivables.overdueOutstanding)} danger={data.finance.receivables.overdueOutstanding > 0} />
              </WorkstreamCard>

              <WorkstreamCard
                title="Payables"
                description="Supplier obligations and open purchase liabilities."
                href="/finance/payables"
                icon="payment"
              >
                <MiniMetric label="Open" value={data.finance.payables.open} />
                <MiniMetric label="Outstanding" value={compactMoney(data.finance.payables.outstanding)} />
                <MiniMetric label="Overdue" value={data.finance.payables.overdue} danger={data.finance.payables.overdue > 0} />
                <MiniMetric label="PO exposure" value={compactMoney(data.operations.purchaseOrders.outstanding)} />
              </WorkstreamCard>

              <WorkstreamCard
                title="Cash & Expenses"
                description="Cash accounts, posted expenses, and spend needing action."
                href="/finance"
                icon="bank"
              >
                <MiniMetric label="Cash accounts" value={data.finance.cashAccounts.active} />
                <MiniMetric label="Cash balance" value={compactMoney(data.finance.cashAccounts.balance)} />
                <MiniMetric label="Pending expenses" value={data.finance.expenses.pending} danger={data.finance.expenses.pending > 0} />
                <MiniMetric label="Paid this month" value={compactMoney(data.finance.expenses.paidThisMonth)} />
              </WorkstreamCard>
            </div>
          </AuroraSection>

          <AuroraSection title="Operations And Inventory">
            <div className="p-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
              <WorkstreamCard
                title="Sales Orders"
                description="Order capture, confirmation, and payment posture."
                href="/operations/sales-orders"
                icon="order"
              >
                <MiniMetric label="Total" value={data.operations.salesOrders.total} />
                <MiniMetric label="Draft" value={data.operations.salesOrders.draft} danger={data.operations.salesOrders.draft > 0} />
                <MiniMetric label="Confirmed" value={data.operations.salesOrders.confirmed} />
                <MiniMetric label="Month revenue" value={compactMoney(data.operations.salesOrders.monthRevenue)} />
              </WorkstreamCard>

              <WorkstreamCard
                title="Purchase Orders"
                description="Purchases, receiving, and supplier commitment."
                href="/operations/purchase-orders"
                icon="purchase"
              >
                <MiniMetric label="Total" value={data.operations.purchaseOrders.total} />
                <MiniMetric label="Draft" value={data.operations.purchaseOrders.draft} danger={data.operations.purchaseOrders.draft > 0} />
                <MiniMetric label="Received" value={data.operations.purchaseOrders.received} />
                <MiniMetric label="Month spend" value={compactMoney(data.operations.purchaseOrders.monthSpend)} />
              </WorkstreamCard>

              <WorkstreamCard
                title="Stock Health"
                description="Inventory value and the gaps that can block sales or posting."
                href="/operations/products"
                icon="inventory"
              >
                <MiniMetric label="Products" value={data.operations.inventory.activeProducts} />
                <MiniMetric label="Stock value" value={compactMoney(data.operations.inventory.stockValue)} />
                <MiniMetric label="Zero / below" value={data.operations.inventory.zeroOrBelow} danger={data.operations.inventory.zeroOrBelow > 0} />
                <MiniMetric label="Negative" value={data.operations.inventory.negative} danger={data.operations.inventory.negative > 0} />
              </WorkstreamCard>
            </div>
          </AuroraSection>

          <AuroraSection title="Procurement, Workflow, And Compliance">
            <div className="p-5">
              <SummaryGrid cols={4} className="aurora-stagger">
                <StatCard
                  title="Pending Approvals"
                  value={data.workflow.approvals.pending}
                  subtitle={`${data.workflow.approvals.escalated} escalated`}
                  variant={data.workflow.approvals.escalated > 0 ? 'danger' : data.workflow.approvals.pending > 0 ? 'warning' : 'default'}
                />
                <StatCard
                  title="Requisitions"
                  value={data.procurement.requisitions.pending}
                  subtitle={`${data.procurement.requisitions.approved} approved`}
                  variant={data.procurement.requisitions.pending > 0 ? 'warning' : 'default'}
                />
                <StatCard
                  title="Supplier Invoices"
                  value={compactMoney(data.procurement.supplierInvoices.outstanding)}
                  subtitle={`${data.procurement.supplierInvoices.pending} pending · ${data.procurement.supplierInvoices.disputed} disputed`}
                  variant={data.procurement.supplierInvoices.disputed > 0 ? 'danger' : 'default'}
                />
                <StatCard
                  title="Compliance Due"
                  value={data.compliance.obligations.dueSoon}
                  subtitle={`${data.compliance.obligations.overdue} overdue`}
                  variant={data.compliance.obligations.overdue > 0 ? 'danger' : data.compliance.obligations.dueSoon > 0 ? 'warning' : 'default'}
                />
              </SummaryGrid>
            </div>
          </AuroraSection>

          <AuroraSection title="Petroleum Operations">
            <div className="p-5">
              <SummaryGrid cols={4} className="aurora-stagger">
                <StatCard title="Open Fuel Shifts" value={data.petroleum.openShifts} variant={data.petroleum.openShifts > 0 ? 'warning' : 'default'} />
                <StatCard title="Litres Sold Today" value={Number(data.petroleum.litresSoldToday.toFixed(2))} subtitle="meter-derived" />
                <StatCard title="Expected Collections" value={compactMoney(data.petroleum.expectedCollectionsToday)} />
                <StatCard
                  title="Collection Variance"
                  value={compactMoney(data.petroleum.varianceToday)}
                  variant={data.petroleum.varianceToday < 0 ? 'danger' : data.petroleum.varianceToday > 0 ? 'warning' : 'default'}
                />
              </SummaryGrid>
            </div>
          </AuroraSection>

          <AuroraSection id="exceptions" title={`Action Queue (${data.exceptions.length})`} className="scroll-mt-6">
            {data.exceptions.length === 0 ? (
              <div className="p-5 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                No overdue balances, negative stock, escalated approvals, or approved-unposted adjustments were found.
              </div>
            ) : (
              <div className="p-5 grid grid-cols-1 gap-3 xl:grid-cols-2">
                {data.exceptions.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="rounded-aurora border p-4 aurora-transition hover:-translate-y-0.5"
                    style={{
                      background: 'var(--aurora-card)',
                      borderColor: 'var(--aurora-border)',
                      borderLeft: `3px solid ${toneForSeverity(item.severity)}`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                          {item.type}
                        </p>
                        <h3 className="mt-1 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                          {item.title}
                        </h3>
                        <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
                          {item.description}
                        </p>
                      </div>
                      <div className="text-right">
                        <StatusBadge status={item.severity} size="sm" />
                        <p className="mt-2 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
                          {fmtDate(item.dueDate)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </AuroraSection>

          <AuroraSection title="Recent Trading Activity">
            <div className="p-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
              <AuroraCard>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                    Latest Sales Orders
                  </h3>
                  <Link href="/operations/sales-orders" className="text-xs font-semibold" style={{ color: 'var(--aurora-primary)' }}>
                    View all →
                  </Link>
                </div>
                <div className="space-y-3">
                  {data.recentTransactions.salesOrders.map((order) => (
                    <Link
                      key={order.id}
                      href={`/operations/sales-orders?search=${encodeURIComponent(order.salesOrderNumber)}`}
                      className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                      style={{ borderColor: 'var(--aurora-border)' }}
                    >
                      <div>
                        <p className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                          {order.salesOrderNumber}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                          {order.customerName ?? 'Walk-in customer'} · {fmtDate(order.orderDate)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                          {money(order.totalAmount)}
                        </p>
                        <StatusBadge status={order.paymentStatus} size="sm" />
                      </div>
                    </Link>
                  ))}
                </div>
              </AuroraCard>

              <AuroraCard>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                    Latest Purchase Orders
                  </h3>
                  <Link href="/operations/purchase-orders" className="text-xs font-semibold" style={{ color: 'var(--aurora-primary)' }}>
                    View all →
                  </Link>
                </div>
                <div className="space-y-3">
                  {data.recentTransactions.purchaseOrders.map((order) => (
                    <Link
                      key={order.id}
                      href={`/operations/purchase-orders?search=${encodeURIComponent(order.purchaseOrderNumber)}`}
                      className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                      style={{ borderColor: 'var(--aurora-border)' }}
                    >
                      <div>
                        <p className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                          {order.purchaseOrderNumber}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                          {order.supplierName ?? 'Unknown supplier'} · {fmtDate(order.orderDate)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                          {money(order.totalAmount)}
                        </p>
                        <StatusBadge status={order.status} size="sm" />
                      </div>
                    </Link>
                  ))}
                </div>
              </AuroraCard>
            </div>
          </AuroraSection>

          {totalAlerts > 0 && (
            <AuroraSection title={`Governance Alerts (${totalAlerts})`}>
              <div className="aurora-stagger grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
                {data.alerts.expiringContracts.length > 0 && (
                  <AlertCard
                    title={`Contracts Expiring Soon (${data.alerts.expiringContracts.length})`}
                    items={data.alerts.expiringContracts.map((c) => ({
                      id: c.id,
                      title: c.title,
                      description: `${c.counterpartyName} · expires ${fmtDate(c.endDate)} (${c.daysLeft != null ? `${c.daysLeft}d` : '—'})`,
                      severity: ((c.daysLeft ?? 999) <= 14 ? 'danger' : 'warning') as 'danger' | 'warning',
                    }))}
                  />
                )}
                {data.alerts.upcomingMaturities.length > 0 && (
                  <AlertCard
                    title={`Loan Maturities Approaching (${data.alerts.upcomingMaturities.length})`}
                    items={data.alerts.upcomingMaturities.map((l) => ({
                      id: l.id,
                      title: l.lenderName,
                      description: `Matures ${fmtDate(l.maturityDate)} · Balance ${l.currency} ${fmt(Number(l.outstandingBalance ?? 0), true)}`,
                      severity: 'danger' as const,
                    }))}
                  />
                )}
                {data.alerts.expiringDocuments.length > 0 && (
                  <AlertCard
                    title={`Documents Expiring (${data.alerts.expiringDocuments.length})`}
                    items={data.alerts.expiringDocuments.map((d) => ({
                      id: d.id,
                      title: d.title,
                      description: `${d.category.replace(/_/g, ' ')} · expires ${fmtDate(d.expiryDate)} (${d.daysLeft != null ? `${d.daysLeft}d` : '—'})`,
                      severity: ((d.daysLeft ?? 999) <= 14 ? 'danger' : 'warning') as 'danger' | 'warning',
                    }))}
                  />
                )}
                {data.alerts.highRiskLoans.length > 0 && (
                  <AlertCard
                    title={`High-Risk Obligations (${data.alerts.highRiskLoans.length})`}
                    items={data.alerts.highRiskLoans.map((l) => ({
                      id: l.id,
                      title: l.lenderName,
                      description: `Balance ${l.currency} ${fmt(Number(l.outstandingBalance ?? 0), true)} · Matures ${fmtDate(l.maturityDate)}`,
                      severity: 'danger' as const,
                    }))}
                  />
                )}
              </div>
            </AuroraSection>
          )}

          <AuroraSection title="Company Footprint">
            <div className="aurora-stagger grid grid-cols-1 gap-5 p-5 md:grid-cols-3">
              {data.companies.map((company) => {
                const meta = companyMeta(company.name);
                return (
                  <Link key={company.id} href={meta.href}>
                    <AuroraCard className="h-full">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <AppIcon name={meta.icon} size={24} strokeWidth={1.8} />
                          <h3 className="mt-2 text-sm font-bold" style={{ color: 'var(--aurora-text)' }}>
                            {company.name}
                          </h3>
                          <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                            {company.divisions.length} divisions · {company.industryType ?? 'General operations'}
                          </p>
                        </div>
                        <StatusBadge status={company.status} variant={getStatusVariant(company.status)} size="sm" />
                      </div>
                    </AuroraCard>
                  </Link>
                );
              })}
            </div>
          </AuroraSection>

          {canViewControl && (
            <AuroraSection
              title="Group Control"
              actions={
                <Link href="/group-control" className="text-xs font-medium" style={{ color: 'var(--aurora-primary)' }}>
                  Open Group Control →
                </Link>
              }
            >
              <div className="p-5">
                <SummaryGrid cols={4} className="aurora-stagger">
                  <StatCard title="Active Loans" value={data.groupControl.loans.active} subtitle={compactMoney(data.groupControl.loans.outstanding)} variant={data.groupControl.loans.overdue > 0 ? 'warning' : 'default'} />
                  <StatCard title="Outstanding Debts" value={data.groupControl.debts.outstanding} subtitle={compactMoney(data.groupControl.debts.totalAmount)} />
                  <StatCard title="Expiring Contracts" value={data.groupControl.contracts.expiringIn30} subtitle="inside 30 days" variant={data.groupControl.contracts.expiringIn30 > 0 ? 'danger' : 'default'} />
                  <StatCard title="Uninsured Assets" value={data.groupControl.fixedAssets.uninsured} variant={data.groupControl.fixedAssets.uninsured > 0 ? 'danger' : 'default'} />
                </SummaryGrid>
              </div>
            </AuroraSection>
          )}

          {canViewControl && data.recentActivity.length > 0 && (
            <AuroraSection
              title="Recent Sensitive Activity"
              actions={
                <Link href="/audit-logs?severity=HIGH" className="text-xs font-medium" style={{ color: 'var(--aurora-primary)' }}>
                  Full Audit Trail →
                </Link>
              }
            >
              <DataTable<AuditRow>
                columns={auditColumns}
                data={data.recentActivity as AuditRow[]}
                keyField="id"
                compact
              />
            </AuroraSection>
          )}
        </div>
      )}
    </AuroraPage>
  );
}
