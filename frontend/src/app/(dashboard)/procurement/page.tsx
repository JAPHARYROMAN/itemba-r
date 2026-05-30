'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, PageSpinner, StatCard } from '@/components/ui';

type ReadinessStatus = 'READY' | 'WARNING' | 'CRITICAL';

interface ReadinessCheck {
  key: string;
  title: string;
  status: ReadinessStatus;
  score: number;
  message: string;
  details: Record<string, number | string>;
}

interface ProcurementReadiness {
  score: number;
  target: number;
  status: ReadinessStatus;
  maturity: string;
  updatedAt: string;
  indicators: Record<string, number>;
  checks: ReadinessCheck[];
}

interface ProcurementSummary {
  openRequisitions: number;
  pendingRfqs: number;
  pendingGrns: number;
  pendingInvoices: number;
  overdueRequisitions: number;
  overduePurchaseOrders: number;
  committedAmount: number;
  invoiceOutstandingAmount: number;
  threeWayMatchVariances: number;
  activeProcurementPlans: number;
  readiness?: ProcurementReadiness;
}

const statusClasses: Record<ReadinessStatus, string> = {
  READY: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  WARNING: 'border-amber-200 bg-amber-50 text-amber-700',
  CRITICAL: 'border-red-200 bg-red-50 text-red-700',
};

const statusCopy: Record<ReadinessStatus, string> = {
  READY: 'Production ready',
  WARNING: 'Needs review',
  CRITICAL: 'Blocked',
};

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDateTime(value?: string) {
  if (!value) return 'Not loaded';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatMoney(value: number | string | null | undefined) {
  const num = Number(value ?? 0);
  return `TZS ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0)}`;
}

function StatusPill({ status }: { status: ReadinessStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase leading-none ${statusClasses[status]}`}
    >
      {statusCopy[status]}
    </span>
  );
}

function detailPreview(details: ReadinessCheck['details']) {
  return Object.entries(details)
    .slice(0, 4)
    .map(([key, value]) => `${humanize(key)}: ${value}`);
}

export default function ProcurementDashboardPage() {
  const [stats, setStats] = useState<ProcurementSummary>({
    openRequisitions: 0,
    pendingRfqs: 0,
    pendingGrns: 0,
    pendingInvoices: 0,
    overdueRequisitions: 0,
    overduePurchaseOrders: 0,
    committedAmount: 0,
    invoiceOutstandingAmount: 0,
    threeWayMatchVariances: 0,
    activeProcurementPlans: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadSummary = useCallback(async () => {
    setError('');
    setRefreshing(true);
    try {
      const response = await fetch('/api/backend/procurement/summary');
      if (!response.ok) throw new Error(`Procurement summary failed (${response.status})`);
      const result = await response.json();
      const data = result.data ?? result;
      setStats({
        openRequisitions: data.openRequisitions ?? 0,
        pendingRfqs: data.pendingRfqs ?? 0,
        pendingGrns: data.pendingGrns ?? 0,
        pendingInvoices: data.pendingInvoices ?? 0,
        overdueRequisitions: data.requisitions?.overdue ?? 0,
        overduePurchaseOrders: data.purchaseOrders?.overdue ?? 0,
        committedAmount: data.purchaseOrders?.committedAmount ?? 0,
        invoiceOutstandingAmount: data.invoices?.outstandingAmount ?? 0,
        threeWayMatchVariances: data.receiving?.threeWayMatchVariances ?? 0,
        activeProcurementPlans: data.activeProcurementPlans ?? 0,
        readiness: data.readiness,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load procurement summary');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const readiness = stats.readiness;
  const readinessStatus = readiness?.status ?? 'WARNING';
  const readinessScore = readiness?.score ?? 0;

  const quickLinks = [
    {
      label: 'Purchase Requisitions',
      href: '/procurement/requisitions',
      desc: 'Request, approve, and convert demand',
    },
    {
      label: 'Requests for Quotation',
      href: '/procurement/rfqs',
      desc: 'Competitive sourcing and supplier invitations',
    },
    {
      label: 'Supplier Quotations',
      href: '/procurement/supplier-quotations',
      desc: 'Supplier offers, validity, and pricing',
    },
    {
      label: 'Bid Comparisons',
      href: '/procurement/bid-comparisons',
      desc: 'Compare suppliers and approve awards',
    },
    {
      label: 'Purchase Orders',
      href: '/operations/purchase-orders',
      desc: 'Committed spend and supplier orders',
    },
    {
      label: 'Goods Received Notes',
      href: '/procurement/grns',
      desc: 'Receiving, inspection, and posting queues',
    },
    {
      label: 'Supplier Invoices',
      href: '/procurement/supplier-invoices',
      desc: 'Invoice capture, approval, and AP handoff',
    },
    {
      label: 'Three-Way Matching',
      href: '/procurement/three-way-matching',
      desc: 'PO, GRN, and invoice variance control',
    },
    {
      label: 'Procurement Plans',
      href: '/procurement/plans',
      desc: 'Budgeted annual and periodic procurement plans',
    },
    {
      label: 'Suppliers',
      href: '/operations/suppliers',
      desc: 'Supplier master data and active vendor base',
    },
  ];

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Procurement"
        subtitle="Procure-to-pay command center, readiness controls, sourcing, receiving, and AP handoff"
        actions={
          <button
            type="button"
            onClick={() => void loadSummary()}
            disabled={refreshing}
            className="rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-60"
            style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open Requisitions" value={stats.openRequisitions} variant="blue" />
        <StatCard label="Pending RFQs" value={stats.pendingRfqs} variant="amber" />
        <StatCard label="Pending GRNs" value={stats.pendingGrns} variant="purple" />
        <StatCard label="Pending Invoices" value={stats.pendingInvoices} variant="red" />
      </div>

      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Procurement Readiness
              </h2>
              <StatusPill status={readinessStatus} />
            </div>
            <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
              {readiness?.maturity ?? 'Readiness diagnostics have not loaded.'}
            </p>
            <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Last checked {formatDateTime(readiness?.updatedAt)}
            </p>
          </div>
          <div className="w-full lg:w-72">
            <div className="flex items-end justify-between">
              <div className="text-4xl font-bold" style={{ color: 'var(--aurora-text)' }}>
                {readinessScore}%
              </div>
              <div className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                Target {readiness?.target ?? 90}%
              </div>
            </div>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full"
              style={{ background: 'var(--aurora-bg-subtle)' }}
            >
              <div
                className={
                  readinessScore >= 90
                    ? 'h-full bg-emerald-500'
                    : readinessScore >= 70
                      ? 'h-full bg-amber-500'
                      : 'h-full bg-red-500'
                }
                style={{ width: `${Math.max(0, Math.min(100, readinessScore))}%` }}
              />
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.45fr_0.9fr]">
        <Card className="p-0 overflow-hidden">
          <div className="border-b px-5 py-4" style={{ borderColor: 'var(--aurora-border)' }}>
            <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
              Procure-to-Pay Checks
            </h2>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--aurora-border)' }}>
            {(readiness?.checks ?? []).map((check) => (
              <div key={check.key} className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_92px]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                      {check.title}
                    </h3>
                    <StatusPill status={check.status} />
                  </div>
                  <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                    {check.message}
                  </p>
                  <div
                    className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    {detailPreview(check.details).map((detail) => (
                      <span key={detail}>{detail}</span>
                    ))}
                  </div>
                </div>
                <div className="text-left lg:text-right">
                  <div className="text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>
                    {check.score}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
              Control Indicators
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div
                className="rounded-lg border p-3"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <div
                  className="text-[11px] uppercase"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  Overdue Reqs
                </div>
                <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  {stats.overdueRequisitions}
                </div>
              </div>
              <div
                className="rounded-lg border p-3"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <div
                  className="text-[11px] uppercase"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  Overdue POs
                </div>
                <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  {stats.overduePurchaseOrders}
                </div>
              </div>
              <div
                className="rounded-lg border p-3"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <div
                  className="text-[11px] uppercase"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  3-Way Variances
                </div>
                <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  {stats.threeWayMatchVariances}
                </div>
              </div>
              <div
                className="rounded-lg border p-3"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <div
                  className="text-[11px] uppercase"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  Active Plans
                </div>
                <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  {stats.activeProcurementPlans}
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
              Spend Exposure
            </h2>
            <div className="mt-4 space-y-3 text-sm">
              <div>
                <div className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                  Committed spend
                </div>
                <div className="text-xl font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  {formatMoney(stats.committedAmount)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                  Invoice outstanding
                </div>
                <div className="text-xl font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  {formatMoney(stats.invoiceOutstandingAmount)}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
          Procurement Workflow Links
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {quickLinks.map((link) => (
            <Link key={link.href} href={link.href}>
              <Card className="h-full p-4 transition-shadow hover:shadow-md">
                <div className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  {link.label}
                </div>
                <div className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                  {link.desc}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
