'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, SkeletonCardGrid, StatCard, showToast } from '@/components/ui';

type ReadinessStatus = 'READY' | 'WARNING' | 'CRITICAL';

interface CRMSummary {
  totalCustomers: number;
  totalSuppliers: number;
  openCommunications: number;
  followUpsDue: number;
  highRiskCreditProfiles: number;
  supplierRiskProfiles: number;
  customerOutstanding: number;
  supplierOutstanding: number;
}

interface ReadinessCheck {
  key: string;
  title: string;
  status: ReadinessStatus;
  score: number;
  message: string;
  details: Record<string, number | string>;
}

interface CrmReadiness {
  score: number;
  target: number;
  status: ReadinessStatus;
  maturity: string;
  updatedAt: string;
  indicators: Record<string, number>;
  checks: ReadinessCheck[];
}

const statusClasses: Record<ReadinessStatus, string> = {
  READY: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  WARNING: 'border-amber-200 bg-amber-50 text-amber-700',
  CRITICAL: 'border-red-200 bg-red-50 text-red-700',
};

function StatusPill({ status }: { status: ReadinessStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase leading-none ${statusClasses[status]}`}
    >
      {status === 'READY' ? 'Production ready' : status === 'WARNING' ? 'Needs review' : 'Blocked'}
    </span>
  );
}

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function detailPreview(details: ReadinessCheck['details']) {
  return Object.entries(details)
    .slice(0, 4)
    .map(([key, value]) => `${humanize(key)}: ${value}`);
}

function formatMoney(value: number | string | null | undefined) {
  const num = Number(value ?? 0);
  return `TZS ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0)}`;
}

function formatDateTime(value?: string) {
  if (!value) return 'Not loaded';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function CRMDashboardPage() {
  const [stats, setStats] = useState<CRMSummary>({
    totalCustomers: 0,
    totalSuppliers: 0,
    openCommunications: 0,
    followUpsDue: 0,
    highRiskCreditProfiles: 0,
    supplierRiskProfiles: 0,
    customerOutstanding: 0,
    supplierOutstanding: 0,
  });
  const [readiness, setReadiness] = useState<CrmReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadDashboard = useCallback(async () => {
    setError('');
    setRefreshing(true);
    try {
      const [summaryResponse, readinessResponse] = await Promise.all([
        fetch('/api/backend/crm/summary'),
        fetch('/api/backend/crm/readiness'),
      ]);
      if (!summaryResponse.ok) throw new Error(`CRM summary failed (${summaryResponse.status})`);
      if (!readinessResponse.ok)
        throw new Error(`CRM readiness failed (${readinessResponse.status})`);
      const [summaryResult, readinessResult] = await Promise.all([
        summaryResponse.json(),
        readinessResponse.json(),
      ]);
      const data = summaryResult.data ?? summaryResult;
      setStats({
        totalCustomers: data.totalCustomers ?? 0,
        totalSuppliers: data.totalSuppliers ?? 0,
        openCommunications: data.openCommunications ?? 0,
        followUpsDue: data.relationshipOps?.followUpsDue ?? 0,
        highRiskCreditProfiles: data.relationshipOps?.highRiskCreditProfiles ?? 0,
        supplierRiskProfiles: data.relationshipOps?.supplierRiskProfiles ?? 0,
        customerOutstanding: data.customers?.outstandingBalance ?? 0,
        supplierOutstanding: data.suppliers?.outstandingBalance ?? 0,
      });
      setReadiness(readinessResult.data ?? readinessResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load CRM/SRM dashboard';
      setError(message);
      showToast('error', 'CRM/SRM dashboard unavailable', message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  if (loading)
    return (
      <div className="space-y-6 p-6">
        <PageHeader
          title="CRM / SRM"
          subtitle="Customer and supplier relationship command center, risk controls, statements, and follow-ups"
        />
        <SkeletonCardGrid count={4} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" />
        <Card className="p-5">
          <div className="aurora-skeleton h-36 rounded-lg" aria-hidden />
        </Card>
      </div>
    );

  const indicators = readiness?.indicators ?? {};
  const score = readiness?.score ?? 0;
  const status = readiness?.status ?? 'WARNING';

  const quickLinks = [
    {
      label: 'Contact Persons',
      href: '/crm/contact-persons',
      desc: 'Manage customer and supplier contacts',
    },
    {
      label: 'Communication Logs',
      href: '/crm/communication-logs',
      desc: 'Track relationship activity and follow-ups',
    },
    { label: 'Credit Profiles', href: '/crm/credit-profiles', desc: 'Customer credit risk review' },
    {
      label: 'Supplier Performance',
      href: '/crm/supplier-performance',
      desc: 'Supplier risk, quality, and performance',
    },
    {
      label: 'Customer Segments',
      href: '/crm/customer-segments',
      desc: 'Govern relationship segmentation',
    },
    {
      label: 'Customer Statements',
      href: '/crm/customer-statements',
      desc: 'AR statement generation and evidence',
    },
    {
      label: 'Supplier Statements',
      href: '/crm/supplier-statements',
      desc: 'AP statement generation and evidence',
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="CRM / SRM"
        subtitle="Customer and supplier relationship command center, risk controls, statements, and follow-ups"
        actions={
          <button
            type="button"
            onClick={() => void loadDashboard()}
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

      <div className="aurora-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Readiness Score"
          value={`${score}%`}
          variant={score >= 90 ? 'green' : 'amber'}
        />
        <StatCard label="Customers" value={stats.totalCustomers} variant="blue" />
        <StatCard label="Suppliers" value={stats.totalSuppliers} variant="green" />
        <StatCard label="Follow-Ups Due" value={stats.followUpsDue} variant="amber" />
      </div>

      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--aurora-text)' }}>
                CRM/SRM Readiness
              </h2>
              <StatusPill status={status} />
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
                {score}%
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
                  score >= 90
                    ? 'h-full bg-emerald-500'
                    : score >= 70
                      ? 'h-full bg-amber-500'
                      : 'h-full bg-red-500'
                }
                style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
              />
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <Card className="p-0 overflow-hidden">
          <div className="border-b px-5 py-4" style={{ borderColor: 'var(--aurora-border)' }}>
            <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
              Relationship Readiness Checks
            </h2>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--aurora-border)' }}>
            {(readiness?.checks ?? []).map((check) => (
              <div key={check.key} className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_92px]">
                <div>
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
              Relationship Exposure
            </h2>
            <div className="mt-4 space-y-3 text-sm">
              <div>
                <div className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                  Customer outstanding
                </div>
                <div className="text-xl font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  {formatMoney(stats.customerOutstanding)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                  Supplier outstanding
                </div>
                <div className="text-xl font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  {formatMoney(stats.supplierOutstanding)}
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
              Control Indicators
            </h2>
            <div className="aurora-stagger mt-4 grid grid-cols-2 gap-3 text-sm">
              {[
                ['Open Comms', stats.openCommunications],
                ['Overdue Follow-Ups', indicators.overdueFollowUps ?? 0],
                ['High Credit Risk', stats.highRiskCreditProfiles],
                ['Supplier Risk', stats.supplierRiskProfiles],
                ['Missing Customer Contact', indicators.customersMissingContact ?? 0],
                ['Missing Supplier Contact', indicators.suppliersMissingContact ?? 0],
                ['Customer Statements', indicators.recentCustomerStatementRuns ?? 0],
                ['Supplier Statements', indicators.recentSupplierStatementRuns ?? 0],
              ].map(([label, value]) => (
                <div
                  key={String(label)}
                  className="rounded-lg border p-3"
                  style={{ borderColor: 'var(--aurora-border)' }}
                >
                  <div
                    className="text-[11px] uppercase"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    {label}
                  </div>
                  <div
                    className="mt-1 text-lg font-semibold"
                    style={{ color: 'var(--aurora-text)' }}
                  >
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
          CRM/SRM Workflow Links
        </h2>
        <div className="aurora-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
