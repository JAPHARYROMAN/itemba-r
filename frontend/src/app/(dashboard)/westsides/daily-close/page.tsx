'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Btn,
  Card,
  FormInput,
  FormSelect,
  FormTextarea,
  PageHeader,
  PageSpinner,
  PageToolbar,
} from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

// Types

interface MethodLine {
  paymentMethod: string;
  cashAccountId: string | null;
  cashAccountName: string | null;
  cashAccountType: string | null;
  count: number;
  expected: number;
  paid: number;
}
interface SalespersonLine {
  salespersonId: string | null;
  name: string | null;
  count: number;
  total: number;
}
interface SalesTypeLine {
  salesType: string;
  count: number;
  total: number;
}
interface ProductLine {
  productId: string;
  productName: string;
  sku: string | null;
  quantity: number;
  total: number;
}
interface OrderLine {
  id: string;
  salesOrderNumber: string;
  orderDate: string;
  customerName: string;
  salesperson: string | null;
  totalAmount: number;
  paymentMethod: string;
  paymentReference?: string | null;
}
interface MmRef {
  id: string;
  salesOrderNumber: string;
  reference: string | null;
  amount: number;
  cashAccountId: string | null;
  cashAccountName: string | null;
}
interface DailyClose {
  date: string;
  companyId: string;
  branchId: string | null;
  totals: {
    salesCount: number;
    totalSales: number;
    paidAmount: number;
    outstandingAmount: number;
    taxAmount: number;
    discountAmount: number;
    averageOrder: number;
  };
  yesterday: { salesCount: number; totalSales: number };
  byMethod: MethodLine[];
  bySalesType: SalesTypeLine[];
  bySalesperson: SalespersonLine[];
  topProducts: ProductLine[];
  orders: OrderLine[];
  mobileMoneyReferences: MmRef[];
}

type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'muted';

interface VarianceStatus {
  label: string;
  tone: StatusTone;
  level: 'pending' | 'matched' | 'review' | 'material';
}

interface MethodReconciliationLine extends MethodLine {
  key: string;
  countedValue: string;
  countedAmount: number | null;
  invalidCount: boolean;
  hasCount: boolean;
  variance: number | null;
  varianceStatus: VarianceStatus;
  accountMissing: boolean;
  paidGap: number;
  issue: string;
}

interface CloseIssue {
  title: string;
  detail: string;
  tone: StatusTone;
  blocking: boolean;
}

interface ReadinessItem {
  label: string;
  detail: string;
  status: string;
  tone: StatusTone;
}

const VARIANCE_TOLERANCE = 0.005;
const MATERIAL_VARIANCE_FLOOR = 5000;

const textMutedStyle = { color: 'var(--aurora-text-muted)' };
const textSecondaryStyle = { color: 'var(--aurora-text-secondary)' };
const borderStyle = { borderColor: 'var(--aurora-border)' };
const tableHeadStyle = {
  background: 'var(--aurora-bg-subtle)',
  borderColor: 'var(--aurora-border)',
};
const subtlePanelStyle = {
  background: 'var(--aurora-bg-subtle)',
  borderColor: 'var(--aurora-border)',
};
const inputStyle = {
  background: 'var(--aurora-bg-subtle)',
  borderColor: 'var(--aurora-border)',
  color: 'var(--aurora-text)',
};

const fmt = (n: number | null | undefined) =>
  new Intl.NumberFormat('en-TZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number(n ?? 0),
  );
const fmtSigned = (n: number) => `${n >= 0 ? '+' : ''}${fmt(n)}`;
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function formatDateTime(value: Date | null) {
  if (!value) return 'Not loaded';
  return value.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAge(value: Date | null) {
  if (!value) return 'not loaded';
  const seconds = Math.max(0, Math.floor((Date.now() - value.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function buildHref(path: string, params: Record<string, string | null | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

const methodKey = (m: MethodLine) => `${m.paymentMethod}|${m.cashAccountId ?? ''}`;
const displayMethod = (method: string) => method.replace(/_/g, ' ');
const isBalanced = (n: number) => Math.abs(n) < VARIANCE_TOLERANCE;

function parseCountedAmount(value: string | undefined): number | null {
  if (value == null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function materialVarianceLimit(expected: number) {
  return Math.max(MATERIAL_VARIANCE_FLOOR, Math.abs(expected) * 0.005);
}

function classifyVariance(variance: number | null, expected: number): VarianceStatus {
  if (variance == null) return { label: 'Pending count', tone: 'muted', level: 'pending' };
  if (isBalanced(variance)) return { label: 'Matched', tone: 'success', level: 'matched' };
  if (Math.abs(variance) >= materialVarianceLimit(expected)) {
    return { label: 'Material exception', tone: 'danger', level: 'material' };
  }
  return { label: 'Review variance', tone: 'warning', level: 'review' };
}

function isMobileMoneyMethod(method: string) {
  return /mobile|m-?pesa|mpesa|tigo|airtel|halo|pesa/i.test(method);
}

function normalizeReference(reference: string | null) {
  return reference?.trim().toUpperCase() ?? '';
}

// Page

export default function DailyClosePage() {
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState<DailyClose | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const { companyOptions, branchOptions } = useOrgScope(companyId, {
    skipDivisions: true,
    skipEmployees: true,
  });

  const load = useCallback(async () => {
    if (!companyId) {
      setData(null);
      setLastLoadedAt(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ companyId, date });
      if (branchId) params.set('branchId', branchId);
      const res = await fetch(`/api/backend/westsides/reports/daily-close?${params}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      setData(j.data ?? j);
      setCounted({});
      setLastLoadedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [companyId, branchId, date]);

  useEffect(() => {
    void load();
  }, [load]);

  const dayDelta = useMemo(() => {
    if (!data) return null;
    const today = data.totals.totalSales;
    const yest = data.yesterday.totalSales;
    if (yest === 0)
      return today > 0
        ? { pct: 100, sign: '+' as '+' | '-' | '' }
        : { pct: 0, sign: '' as '+' | '-' | '' };
    const pct = ((today - yest) / yest) * 100;
    return { pct: Math.abs(pct), sign: (pct >= 0 ? '+' : '-') as '+' | '-' | '' };
  }, [data]);

  const methodRows = useMemo<MethodReconciliationLine[]>(() => {
    if (!data) return [];
    return data.byMethod.map((m) => {
      const key = methodKey(m);
      const countedValue = counted[key] ?? '';
      const countedAmount = parseCountedAmount(countedValue);
      const invalidCount = countedValue.trim() !== '' && countedAmount == null;
      const hasCount = countedAmount != null;
      const variance = countedAmount != null ? countedAmount - m.expected : null;
      const accountMissing = !m.cashAccountId && !m.cashAccountName;
      const paidGap = m.paid - m.expected;
      const varianceStatus = invalidCount
        ? { label: 'Invalid count', tone: 'danger' as StatusTone, level: 'material' as const }
        : classifyVariance(variance, m.expected);
      const issue = invalidCount
        ? 'Counted amount is not a valid number.'
        : !hasCount
          ? 'Awaiting physical count.'
          : accountMissing
            ? 'No cash account mapped.'
            : !isBalanced(paidGap)
              ? 'Paid and expected values differ.'
              : varianceStatus.level === 'material'
                ? 'Supervisor approval required.'
                : varianceStatus.level === 'review'
                  ? 'Explain variance before approval.'
                  : 'Ready.';

      return {
        ...m,
        key,
        countedValue,
        countedAmount,
        invalidCount,
        hasCount,
        variance,
        varianceStatus,
        accountMissing,
        paidGap,
        issue,
      };
    });
  }, [counted, data]);

  const methodExpectedTotal = useMemo(
    () => methodRows.reduce((s, m) => s + m.expected, 0),
    [methodRows],
  );
  const methodPaidTotal = useMemo(() => methodRows.reduce((s, m) => s + m.paid, 0), [methodRows]);
  const totalCounted = useMemo(
    () => methodRows.reduce((s, m) => s + (m.countedAmount ?? 0), 0),
    [methodRows],
  );
  const totalVariance = useMemo(
    () => methodRows.reduce((s, m) => s + (m.variance ?? 0), 0),
    [methodRows],
  );
  const countedMethodCount = useMemo(
    () => methodRows.filter((m) => m.hasCount).length,
    [methodRows],
  );
  const pendingMethodCount = useMemo(
    () => methodRows.filter((m) => !m.hasCount && !m.invalidCount).length,
    [methodRows],
  );
  const invalidCountedCount = useMemo(
    () => methodRows.filter((m) => m.invalidCount).length,
    [methodRows],
  );
  const unassignedMethodCount = useMemo(
    () => methodRows.filter((m) => m.accountMissing).length,
    [methodRows],
  );
  const matchedMethodCount = useMemo(
    () => methodRows.filter((m) => m.varianceStatus.level === 'matched').length,
    [methodRows],
  );
  const reviewVarianceCount = useMemo(
    () => methodRows.filter((m) => m.varianceStatus.level === 'review').length,
    [methodRows],
  );
  const materialVarianceCount = useMemo(
    () => methodRows.filter((m) => m.varianceStatus.level === 'material').length,
    [methodRows],
  );
  const mobileMethodExpected = useMemo(
    () =>
      methodRows
        .filter((m) => isMobileMoneyMethod(m.paymentMethod))
        .reduce((s, m) => s + m.expected, 0),
    [methodRows],
  );
  const allMethodsCounted =
    methodRows.length === 0 || (pendingMethodCount === 0 && invalidCountedCount === 0);
  const finalVariance = allMethodsCounted ? totalCounted - methodExpectedTotal : totalVariance;
  const expectedPaidGap = methodExpectedTotal - (data?.totals.paidAmount ?? 0);

  const mobileMoneyStats = useMemo(() => {
    const refs = data?.mobileMoneyReferences ?? [];
    const groups = new Map<string, MmRef[]>();
    refs.forEach((ref) => {
      const normalized = normalizeReference(ref.reference);
      if (!normalized) return;
      groups.set(normalized, [...(groups.get(normalized) ?? []), ref]);
    });
    const duplicateReferences = Array.from(groups.entries()).filter(([, rows]) => rows.length > 1);
    const duplicateSet = new Set(duplicateReferences.map(([reference]) => reference));
    const accountTotals = new Map<string, { count: number; amount: number }>();
    refs.forEach((ref) => {
      const account = ref.cashAccountName ?? 'Unassigned account';
      const existing = accountTotals.get(account) ?? { count: 0, amount: 0 };
      accountTotals.set(account, {
        count: existing.count + 1,
        amount: existing.amount + ref.amount,
      });
    });

    return {
      refs,
      totalAmount: refs.reduce((s, r) => s + r.amount, 0),
      missingReferences: refs.filter((r) => !normalizeReference(r.reference)),
      unassignedReferences: refs.filter((r) => !r.cashAccountId && !r.cashAccountName),
      duplicateReferences,
      duplicateSet,
      accountTotals: Array.from(accountTotals.entries()),
    };
  }, [data]);

  const closeStatus = useMemo(() => {
    if (!data) return null;
    if (invalidCountedCount > 0) {
      return {
        label: 'Input error',
        tone: 'danger' as StatusTone,
        detail: 'Fix invalid counted values before approval.',
      };
    }
    if (pendingMethodCount > 0) {
      return {
        label: 'Count pending',
        tone: 'warning' as StatusTone,
        detail: `${pendingMethodCount} method${pendingMethodCount === 1 ? '' : 's'} still need a count.`,
      };
    }
    if (isBalanced(finalVariance)) {
      return {
        label: 'Balanced',
        tone: 'success' as StatusTone,
        detail: 'Counted funds match expected payments.',
      };
    }
    if (Math.abs(finalVariance) >= materialVarianceLimit(methodExpectedTotal)) {
      return {
        label: 'Material variance',
        tone: 'danger' as StatusTone,
        detail: `Variance is TZS ${fmtSigned(finalVariance)}.`,
      };
    }
    return {
      label: 'Variance review',
      tone: 'warning' as StatusTone,
      detail: `Variance is TZS ${fmtSigned(finalVariance)}.`,
    };
  }, [data, finalVariance, invalidCountedCount, methodExpectedTotal, pendingMethodCount]);

  const closeIssues = useMemo<CloseIssue[]>(() => {
    if (!data) return [];
    const issues: CloseIssue[] = [];

    if (data.byMethod.length === 0 && data.totals.paidAmount > VARIANCE_TOLERANCE) {
      issues.push({
        title: 'No payment method breakdown returned',
        detail: `Paid amount is TZS ${fmt(data.totals.paidAmount)}, but no method rows were returned.`,
        tone: 'danger',
        blocking: true,
      });
    }
    if (pendingMethodCount > 0) {
      issues.push({
        title: 'Physical count incomplete',
        detail: `${pendingMethodCount} expected method${pendingMethodCount === 1 ? '' : 's'} still need counted amounts.`,
        tone: 'warning',
        blocking: true,
      });
    }
    if (invalidCountedCount > 0) {
      issues.push({
        title: 'Invalid counted amount',
        detail: `${invalidCountedCount} counted field${invalidCountedCount === 1 ? '' : 's'} contain invalid values.`,
        tone: 'danger',
        blocking: true,
      });
    }
    if (materialVarianceCount > 0) {
      issues.push({
        title: 'Material variance detected',
        detail: `${materialVarianceCount} method${materialVarianceCount === 1 ? '' : 's'} exceed the materiality threshold.`,
        tone: 'danger',
        blocking: true,
      });
    } else if (reviewVarianceCount > 0) {
      issues.push({
        title: 'Variance needs explanation',
        detail: `${reviewVarianceCount} method${reviewVarianceCount === 1 ? '' : 's'} have non-zero variances.`,
        tone: 'warning',
        blocking: true,
      });
    }
    if (unassignedMethodCount > 0) {
      issues.push({
        title: 'Cash account mapping missing',
        detail: `${unassignedMethodCount} payment method${unassignedMethodCount === 1 ? '' : 's'} are not assigned to a cash account.`,
        tone: 'warning',
        blocking: true,
      });
    }
    if (!isBalanced(expectedPaidGap)) {
      issues.push({
        title: 'Expected total differs from paid summary',
        detail: `Method expected total differs from paid amount by TZS ${fmtSigned(expectedPaidGap)}.`,
        tone: 'danger',
        blocking: true,
      });
    }
    if (mobileMethodExpected > VARIANCE_TOLERANCE && mobileMoneyStats.refs.length === 0) {
      issues.push({
        title: 'Mobile-money references missing',
        detail: `Mobile-money expected amount is TZS ${fmt(mobileMethodExpected)}, but no reference rows were returned.`,
        tone: 'warning',
        blocking: true,
      });
    }
    if (mobileMoneyStats.missingReferences.length > 0) {
      issues.push({
        title: 'Mobile-money reference gaps',
        detail: `${mobileMoneyStats.missingReferences.length} receipt${mobileMoneyStats.missingReferences.length === 1 ? '' : 's'} have no reference.`,
        tone: 'warning',
        blocking: true,
      });
    }
    if (mobileMoneyStats.duplicateReferences.length > 0) {
      issues.push({
        title: 'Duplicate mobile-money references',
        detail: `${mobileMoneyStats.duplicateReferences.length} reference${mobileMoneyStats.duplicateReferences.length === 1 ? '' : 's'} appear on multiple orders.`,
        tone: 'danger',
        blocking: true,
      });
    }
    if (mobileMoneyStats.unassignedReferences.length > 0) {
      issues.push({
        title: 'Mobile-money account mapping missing',
        detail: `${mobileMoneyStats.unassignedReferences.length} mobile-money receipt${mobileMoneyStats.unassignedReferences.length === 1 ? '' : 's'} are not tied to a cash account.`,
        tone: 'warning',
        blocking: true,
      });
    }
    if (data.totals.outstandingAmount > VARIANCE_TOLERANCE) {
      issues.push({
        title: 'Credit balance remains open',
        detail: `TZS ${fmt(data.totals.outstandingAmount)} should be handed to AR follow-up after close.`,
        tone: 'info',
        blocking: false,
      });
    }
    if (issues.some((issue) => issue.blocking) && !notes.trim()) {
      issues.push({
        title: 'Exception note not entered',
        detail: 'Add operator notes for supervisor approval and printed close support.',
        tone: 'warning',
        blocking: false,
      });
    }

    return issues;
  }, [
    data,
    expectedPaidGap,
    invalidCountedCount,
    materialVarianceCount,
    mobileMethodExpected,
    mobileMoneyStats,
    notes,
    pendingMethodCount,
    reviewVarianceCount,
    unassignedMethodCount,
  ]);

  const blockingIssueCount = closeIssues.filter((issue) => issue.blocking).length;
  const approvalReady = Boolean(data) && allMethodsCounted && blockingIssueCount === 0;
  const selectedCompanyLabel =
    companyOptions.find((option) => option.value === companyId)?.label ??
    (companyId ? 'Selected company' : 'Not selected');
  const selectedBranchLabel =
    branchOptions.find((option) => option.value === branchId)?.label ??
    (branchId ? 'Selected branch' : 'All branches');
  const loadAgeMs = lastLoadedAt ? Date.now() - lastLoadedAt.getTime() : null;
  const freshnessTone: StatusTone = !lastLoadedAt
    ? 'muted'
    : loadAgeMs !== null && loadAgeMs > 300_000
      ? 'warning'
      : 'success';

  const readinessItems = useMemo<ReadinessItem[]>(() => {
    if (!data) return [];
    return [
      {
        label: 'Data freshness',
        detail: lastLoadedAt
          ? `Loaded ${formatAge(lastLoadedAt)} from the daily-close endpoint. Refresh before final approval if the cashier is still selling.`
          : 'No successful load timestamp is available.',
        status: freshnessTone === 'success' ? 'Fresh' : 'Review',
        tone: freshnessTone,
      },
      {
        label: 'Scope loaded',
        detail: data.branchId ? 'Branch-specific close loaded.' : 'Company-wide close loaded.',
        status: 'Loaded',
        tone: 'success',
      },
      {
        label: 'Expected methods counted',
        detail: `${countedMethodCount}/${methodRows.length} payment method${methodRows.length === 1 ? '' : 's'} counted.`,
        status: allMethodsCounted ? 'Done' : 'Pending',
        tone: allMethodsCounted ? 'success' : 'warning',
      },
      {
        label: 'Variance position',
        detail: closeStatus?.detail ?? 'No close status available.',
        status: closeStatus?.label ?? 'Unknown',
        tone: closeStatus?.tone ?? 'muted',
      },
      {
        label: 'Cash account mapping',
        detail:
          unassignedMethodCount === 0
            ? 'All method rows have account context.'
            : `${unassignedMethodCount} method row${unassignedMethodCount === 1 ? '' : 's'} need mapping.`,
        status: unassignedMethodCount === 0 ? 'Mapped' : 'Review',
        tone: unassignedMethodCount === 0 ? 'success' : 'warning',
      },
      {
        label: 'Mobile-money references',
        detail:
          mobileMoneyStats.refs.length === 0
            ? 'No mobile-money reference rows returned.'
            : `${mobileMoneyStats.refs.length} reference row${mobileMoneyStats.refs.length === 1 ? '' : 's'} checked.`,
        status:
          mobileMoneyStats.missingReferences.length || mobileMoneyStats.duplicateReferences.length
            ? 'Review'
            : 'Checked',
        tone:
          mobileMoneyStats.missingReferences.length || mobileMoneyStats.duplicateReferences.length
            ? 'warning'
            : 'success',
      },
      {
        label: 'Approval packet',
        detail: approvalReady
          ? 'Supervisor can approve and print the Z-report.'
          : `${blockingIssueCount} blocking issue${blockingIssueCount === 1 ? '' : 's'} before clean approval.`,
        status: approvalReady ? 'Ready' : 'Hold',
        tone: approvalReady ? 'success' : 'danger',
      },
    ];
  }, [
    allMethodsCounted,
    approvalReady,
    blockingIssueCount,
    closeStatus,
    countedMethodCount,
    data,
    freshnessTone,
    lastLoadedAt,
    methodRows.length,
    mobileMoneyStats,
    unassignedMethodCount,
  ]);

  return (
    <div className="p-6 space-y-4 daily-close-page">
      <PageHeader
        title="Daily Close"
        subtitle="Branch cash governance, receipt controls, variance review, and Z-report readiness."
        breadcrumbs={[{ label: 'Westsides', href: '/westsides' }, { label: 'Daily Close' }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ActionLink href="/westsides/reports">Reports</ActionLink>
            <ActionLink href="/westsides/customers">Customers</ActionLink>
            <ActionLink href="/westsides/quick-sale">Quick Sale</ActionLink>
          </div>
        }
      />

      <PageToolbar
        filters={
          <>
            <div className="w-56">
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
            <div className="w-44">
              <FormSelect
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                options={branchOptions}
                placeholder={companyId ? 'All branches' : 'Pick company'}
              />
            </div>
            <div className="w-44">
              <FormInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </>
        }
        actions={
          <>
            <Btn
              variant="secondary"
              size="sm"
              onClick={() => void load()}
              loading={loading}
              disabled={!companyId}
            >
              Refresh
            </Btn>
            {data && (
              <Btn
                variant={approvalReady ? 'primary' : 'warning'}
                size="sm"
                onClick={() => window.print()}
              >
                Print Z-Report
              </Btn>
            )}
          </>
        }
      />

      {error && (
        <RecoveryState
          title="Daily close could not load"
          detail={error}
          action={
            <Btn
              variant="secondary"
              size="sm"
              onClick={() => void load()}
              loading={loading}
              disabled={!companyId}
            >
              Retry
            </Btn>
          }
        />
      )}
      {loading && !data && <PageSpinner />}
      {!data && !loading && !error && (
        <EmptyPanel
          title="Select a company to load daily close"
          detail="Choose a company, optional branch, and close date. The page will calculate payment readiness, blockers, mobile-money reference checks, and print status."
        />
      )}

      {data && (
        <>
          <Card className="overflow-hidden p-0">
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
              <ControlFact
                label="Scope"
                value={`${selectedCompanyLabel} · ${selectedBranchLabel}`}
              />
              <ControlFact
                label="Close date"
                value={new Date(data.date).toLocaleDateString('en-GB')}
              />
              <ControlFact
                label="Data freshness"
                value={formatDateTime(lastLoadedAt)}
                tone={freshnessTone}
              />
              <ControlFact
                label="Blocking issues"
                value={String(blockingIssueCount)}
                tone={blockingIssueCount > 0 ? 'danger' : 'success'}
              />
              <ControlFact
                label="Approval readiness"
                value={approvalReady ? 'Ready' : 'Hold'}
                tone={approvalReady ? 'success' : 'warning'}
              />
            </div>
            <div
              className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3"
              style={borderStyle}
            >
              <p className="text-xs leading-relaxed" style={textSecondaryStyle}>
                Last refreshed {formatAge(lastLoadedAt)}. Resolve blocking exceptions or record
                notes before supervisor approval.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <ActionLink href={buildHref('/westsides/reports', { date })}>
                  Open close reports
                </ActionLink>
                <ActionLink href={buildHref('/westsides/customers', { date })}>
                  Customer follow-up
                </ActionLink>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Tile
              label="Sales today"
              value={String(data.totals.salesCount)}
              hint={`avg TZS ${fmt(data.totals.averageOrder)}`}
            />
            <Tile label="Total revenue" value={`TZS ${fmt(data.totals.totalSales)}`} highlight />
            <Tile
              label="vs yesterday"
              value={
                dayDelta && dayDelta.pct !== 0 ? `${dayDelta.sign}${dayDelta.pct.toFixed(1)}%` : '-'
              }
              hint={`yest. TZS ${fmt(data.yesterday.totalSales)}`}
              tone={
                dayDelta && dayDelta.sign === '+'
                  ? 'success'
                  : dayDelta && dayDelta.sign === '-'
                    ? 'warning'
                    : 'muted'
              }
            />
            <Tile
              label="Paid collected"
              value={`TZS ${fmt(data.totals.paidAmount)}`}
              hint="non-credit"
              tone="success"
            />
            <Tile
              label="Outstanding"
              value={`TZS ${fmt(data.totals.outstandingAmount)}`}
              hint="credit invoices"
              tone={data.totals.outstandingAmount > 0 ? 'warning' : 'muted'}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="p-4 xl:col-span-2">
              <SectionHeader
                title="Close readiness"
                subtitle="Operator checklist before supervisor sign-off."
                badge={
                  <StatusBadge
                    label={approvalReady ? 'Ready for approval' : 'Review required'}
                    tone={approvalReady ? 'success' : 'danger'}
                  />
                }
              />
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {readinessItems.map((item) => (
                  <ReadinessPanel key={item.label} item={item} />
                ))}
              </div>
            </Card>

            <Card className="p-4">
              <SectionHeader
                title="Counted vs expected"
                subtitle="Live drawer position from counted inputs."
                badge={
                  closeStatus ? (
                    <StatusBadge label={closeStatus.label} tone={closeStatus.tone} />
                  ) : undefined
                }
              />
              <div className="space-y-2">
                <SummaryRow label="Expected payments" value={`TZS ${fmt(methodExpectedTotal)}`} />
                <SummaryRow label="Counted so far" value={`TZS ${fmt(totalCounted)}`} />
                <SummaryRow
                  label="Uncounted expected"
                  value={`TZS ${fmt(Math.max(methodExpectedTotal - totalCounted, 0))}`}
                  muted
                />
                <SummaryRow
                  label="Variance"
                  value={`TZS ${fmtSigned(finalVariance)}`}
                  strong
                  tone={
                    isBalanced(finalVariance) ? 'success' : finalVariance < 0 ? 'danger' : 'warning'
                  }
                />
              </div>
              <div className="mt-3 rounded-lg border px-3 py-2 text-xs" style={subtlePanelStyle}>
                <div className="flex items-center justify-between gap-3">
                  <span style={textSecondaryStyle}>Approval cue</span>
                  <span
                    className="font-semibold"
                    style={{
                      color: approvalReady
                        ? 'var(--aurora-success-text)'
                        : 'var(--aurora-warning-text)',
                    }}
                  >
                    {approvalReady ? 'Clean approval path' : 'Supervisor review needed'}
                  </span>
                </div>
                <p className="mt-1 leading-relaxed" style={textMutedStyle}>
                  Print remains available, but a clean close requires all blocking exceptions to be
                  resolved or documented.
                </p>
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="p-4 xl:col-span-2">
              <SectionHeader
                title="Exceptions and approval notes"
                subtitle="Clear blockers, warnings, and handoff messages."
                badge={
                  <StatusBadge
                    label={`${blockingIssueCount} blocking`}
                    tone={blockingIssueCount > 0 ? 'danger' : 'success'}
                  />
                }
              />
              {closeIssues.length === 0 ? (
                <Notice
                  tone="success"
                  title="No close exceptions detected"
                  detail="The counted position, references, and account mapping are ready for approval."
                  compact
                />
              ) : (
                <div className="space-y-2">
                  {closeIssues.map((issue, index) => (
                    <IssueRow key={`${issue.title}-${index}`} issue={issue} />
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-4">
              <SectionHeader title="Variance severity" subtitle="Method-level exception mix." />
              <div className="grid grid-cols-2 gap-2">
                <SeverityCounter label="Matched" value={matchedMethodCount} tone="success" />
                <SeverityCounter label="Pending" value={pendingMethodCount} tone="muted" />
                <SeverityCounter label="Review" value={reviewVarianceCount} tone="warning" />
                <SeverityCounter label="Material" value={materialVarianceCount} tone="danger" />
              </div>
              <p className="mt-3 text-xs leading-relaxed" style={textMutedStyle}>
                Material threshold: TZS {fmt(MATERIAL_VARIANCE_FLOOR)} or 0.5% of expected method
                value, whichever is higher.
              </p>
            </Card>
          </div>

          <Card className="overflow-hidden p-0">
            <div
              className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3"
              style={borderStyle}
            >
              <div>
                <h3 className="text-sm font-semibold">Method reconciliation</h3>
                <p className="mt-0.5 text-xs" style={textMutedStyle}>
                  Count each drawer, bank, and mobile-money bucket against expected paid value.
                </p>
              </div>
              <StatusBadge
                label={`${countedMethodCount}/${methodRows.length} counted`}
                tone={allMethodsCounted ? 'success' : 'warning'}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr style={tableHeadStyle}>
                    <Th>Method</Th>
                    <Th>Account</Th>
                    <Th align="right">Txns</Th>
                    <Th align="right">Expected</Th>
                    <Th align="right">Paid</Th>
                    <Th align="right">Counted</Th>
                    <Th align="right">Variance</Th>
                    <Th>Severity</Th>
                  </tr>
                </thead>
                <tbody>
                  {methodRows.length === 0 && <EmptyRow colSpan={8} message="No payments today." />}
                  {methodRows.map((m) => (
                    <tr
                      key={m.key}
                      className="transition hover:bg-white/5"
                      style={{ borderBottom: '1px solid var(--aurora-border)' }}
                    >
                      <Td>
                        <div className="font-medium">{displayMethod(m.paymentMethod)}</div>
                        <div className="text-[11px]" style={textMutedStyle}>
                          {m.issue}
                        </div>
                      </Td>
                      <Td>
                        {m.cashAccountName ? (
                          <>
                            <div className="font-medium">{m.cashAccountName}</div>
                            <div className="text-[11px]" style={textMutedStyle}>
                              {m.cashAccountType ?? 'Cash account'}
                            </div>
                          </>
                        ) : (
                          <span className="italic" style={{ color: 'var(--aurora-warning-text)' }}>
                            unassigned
                          </span>
                        )}
                      </Td>
                      <Td align="right" mono>
                        {m.count}
                      </Td>
                      <Td align="right" mono>
                        {fmt(m.expected)}
                      </Td>
                      <Td align="right" mono>
                        <div>{fmt(m.paid)}</div>
                        {!isBalanced(m.paidGap) && (
                          <div
                            className="text-[11px]"
                            style={{ color: 'var(--aurora-warning-text)' }}
                          >
                            {fmtSigned(m.paidGap)}
                          </div>
                        )}
                      </Td>
                      <Td align="right">
                        <input
                          type="number"
                          step="any"
                          value={m.countedValue}
                          onChange={(e) => setCounted((p) => ({ ...p, [m.key]: e.target.value }))}
                          placeholder="0.00"
                          className="w-full rounded-lg border px-2 py-1 text-right tabular-nums outline-none focus:ring-2 focus:ring-brand-500/40"
                          style={inputStyle}
                        />
                      </Td>
                      <Td
                        align="right"
                        mono
                        strong
                        tone={
                          m.variance == null
                            ? 'muted'
                            : isBalanced(m.variance)
                              ? 'success'
                              : m.variance < 0
                                ? 'danger'
                                : 'warning'
                        }
                      >
                        {m.variance == null ? '-' : fmtSigned(m.variance)}
                      </Td>
                      <Td>
                        <StatusBadge label={m.varianceStatus.label} tone={m.varianceStatus.tone} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
                {methodRows.length > 0 && (
                  <tfoot>
                    <tr style={tableHeadStyle}>
                      <Td strong colSpan={3}>
                        Totals
                      </Td>
                      <Td align="right" mono strong>
                        {fmt(methodExpectedTotal)}
                      </Td>
                      <Td align="right" mono strong>
                        {fmt(methodPaidTotal)}
                      </Td>
                      <Td align="right" mono strong>
                        {fmt(totalCounted)}
                      </Td>
                      <Td
                        align="right"
                        mono
                        strong
                        tone={
                          isBalanced(finalVariance)
                            ? 'success'
                            : finalVariance < 0
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {fmtSigned(finalVariance)}
                      </Td>
                      <Td>
                        <StatusBadge
                          label={approvalReady ? 'Clean' : 'Review'}
                          tone={approvalReady ? 'success' : 'warning'}
                        />
                      </Td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <div
              className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3"
              style={borderStyle}
            >
              <div>
                <h3 className="text-sm font-semibold">Mobile-money reference checks</h3>
                <p className="mt-0.5 text-xs" style={textMutedStyle}>
                  Validate references before matching against M-Pesa, Tigo Pesa, or bank statement
                  lines.
                </p>
              </div>
              <StatusBadge
                label={
                  mobileMoneyStats.missingReferences.length ||
                  mobileMoneyStats.duplicateReferences.length
                    ? 'Reference review'
                    : 'References checked'
                }
                tone={
                  mobileMoneyStats.missingReferences.length ||
                  mobileMoneyStats.duplicateReferences.length
                    ? 'warning'
                    : 'success'
                }
              />
            </div>
            <div className="grid gap-2 border-b p-4 md:grid-cols-5" style={borderStyle}>
              <SeverityCounter label="Receipts" value={mobileMoneyStats.refs.length} tone="info" />
              <SeverityCounter
                label="Missing ref"
                value={mobileMoneyStats.missingReferences.length}
                tone={mobileMoneyStats.missingReferences.length ? 'warning' : 'success'}
              />
              <SeverityCounter
                label="Duplicates"
                value={mobileMoneyStats.duplicateReferences.length}
                tone={mobileMoneyStats.duplicateReferences.length ? 'danger' : 'success'}
              />
              <SeverityCounter
                label="Unassigned"
                value={mobileMoneyStats.unassignedReferences.length}
                tone={mobileMoneyStats.unassignedReferences.length ? 'warning' : 'success'}
              />
              <div className="rounded-lg border px-3 py-2" style={subtlePanelStyle}>
                <div className="text-[11px] uppercase tracking-wide" style={textMutedStyle}>
                  Total value
                </div>
                <div className="mt-1 text-sm font-bold tabular-nums">
                  TZS {fmt(mobileMoneyStats.totalAmount)}
                </div>
              </div>
            </div>
            {mobileMoneyStats.refs.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm italic" style={textMutedStyle}>
                No mobile-money receipts returned for this close.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr style={tableHeadStyle}>
                      <Th>Order</Th>
                      <Th>Account</Th>
                      <Th>Reference</Th>
                      <Th align="right">Amount</Th>
                      <Th>Status</Th>
                      <Th>Action</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {mobileMoneyStats.refs.map((r) => {
                      const normalized = normalizeReference(r.reference);
                      const duplicate = normalized
                        ? mobileMoneyStats.duplicateSet.has(normalized)
                        : false;
                      const missing = !normalized;
                      const unassigned = !r.cashAccountId && !r.cashAccountName;
                      const tone: StatusTone =
                        missing || duplicate ? 'danger' : unassigned ? 'warning' : 'success';
                      const label = missing
                        ? 'Missing ref'
                        : duplicate
                          ? 'Duplicate'
                          : unassigned
                            ? 'Account review'
                            : 'Ready';

                      return (
                        <tr
                          key={r.id}
                          className="transition hover:bg-white/5"
                          style={{ borderBottom: '1px solid var(--aurora-border)' }}
                        >
                          <Td mono>{r.salesOrderNumber}</Td>
                          <Td>
                            {r.cashAccountName ?? (
                              <span
                                className="italic"
                                style={{ color: 'var(--aurora-warning-text)' }}
                              >
                                unassigned
                              </span>
                            )}
                          </Td>
                          <Td mono>
                            {r.reference ?? (
                              <span
                                className="italic"
                                style={{ color: 'var(--aurora-danger-text)' }}
                              >
                                missing
                              </span>
                            )}
                          </Td>
                          <Td align="right" mono>
                            {fmt(r.amount)}
                          </Td>
                          <Td>
                            <StatusBadge label={label} tone={tone} />
                          </Td>
                          <Td>
                            <InlineLink
                              href={buildHref('/westsides/reports', { search: r.salesOrderNumber })}
                            >
                              Trace
                            </InlineLink>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {mobileMoneyStats.accountTotals.length > 0 && (
              <div className="border-t px-4 py-3" style={borderStyle}>
                <div
                  className="text-[11px] font-semibold uppercase tracking-wide"
                  style={textMutedStyle}
                >
                  Reference totals by account
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {mobileMoneyStats.accountTotals.map(([account, total]) => (
                    <span
                      key={account}
                      className="rounded-full border px-2.5 py-1 text-xs"
                      style={{ ...subtlePanelStyle, color: 'var(--aurora-text-secondary)' }}
                    >
                      {account}: {total.count} / TZS {fmt(total.amount)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DataTableCard
              title="By salesperson"
              empty="No salesperson data."
              columns={['Name', 'Sales', 'Total']}
            >
              {data.bySalesperson.map((s, i) => (
                <tr
                  key={i}
                  className="transition hover:bg-white/5"
                  style={{ borderBottom: '1px solid var(--aurora-border)' }}
                >
                  <Td>
                    {s.name ?? (
                      <span className="italic" style={textMutedStyle}>
                        unattributed
                      </span>
                    )}
                  </Td>
                  <Td align="right" mono>
                    {s.count}
                  </Td>
                  <Td align="right" mono strong>
                    {fmt(s.total)}
                  </Td>
                </tr>
              ))}
            </DataTableCard>

            <DataTableCard
              title="By channel"
              empty="No channel data."
              columns={['Channel', 'Sales', 'Total']}
            >
              {data.bySalesType.map((s, i) => (
                <tr
                  key={i}
                  className="transition hover:bg-white/5"
                  style={{ borderBottom: '1px solid var(--aurora-border)' }}
                >
                  <Td>{displayMethod(s.salesType)}</Td>
                  <Td align="right" mono>
                    {s.count}
                  </Td>
                  <Td align="right" mono strong>
                    {fmt(s.total)}
                  </Td>
                </tr>
              ))}
            </DataTableCard>
          </div>

          <Card className="overflow-hidden p-0">
            <div className="border-b px-4 py-3" style={borderStyle}>
              <h3 className="text-sm font-semibold">Top SKUs today</h3>
              <p className="mt-0.5 text-xs" style={textMutedStyle}>
                Products contributing most to the close.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr style={tableHeadStyle}>
                    <Th>#</Th>
                    <Th>Product</Th>
                    <Th align="right">Qty</Th>
                    <Th align="right">Revenue</Th>
                    <Th>Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.topProducts.map((p, i) => (
                    <tr
                      key={p.productId}
                      className="transition hover:bg-white/5"
                      style={{ borderBottom: '1px solid var(--aurora-border)' }}
                    >
                      <Td mono>{i + 1}</Td>
                      <Td>
                        <div className="font-medium">{p.productName}</div>
                        {p.sku && (
                          <div className="text-[11px] font-mono" style={textMutedStyle}>
                            {p.sku}
                          </div>
                        )}
                      </Td>
                      <Td align="right" mono>
                        {p.quantity.toFixed(0)}
                      </Td>
                      <Td align="right" mono strong>
                        {fmt(p.total)}
                      </Td>
                      <Td>
                        <InlineLink
                          href={buildHref('/westsides/inventory/live', {
                            search: p.sku ?? p.productName,
                          })}
                        >
                          Stock
                        </InlineLink>
                      </Td>
                    </tr>
                  ))}
                  {data.topProducts.length === 0 && (
                    <EmptyRow colSpan={5} message="No items sold today." />
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="border-b px-4 py-3" style={borderStyle}>
              <h3 className="text-sm font-semibold">Orders included in close</h3>
              <p className="mt-0.5 text-xs" style={textMutedStyle}>
                Transaction sample for receipt checks and customer follow-up.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr style={tableHeadStyle}>
                    <Th>Time</Th>
                    <Th>Order</Th>
                    <Th>Customer</Th>
                    <Th>Salesperson</Th>
                    <Th>Method</Th>
                    <Th>Reference</Th>
                    <Th align="right">Amount</Th>
                    <Th>Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.slice(0, 20).map((order) => (
                    <tr
                      key={order.id}
                      className="transition hover:bg-white/5"
                      style={{ borderBottom: '1px solid var(--aurora-border)' }}
                    >
                      <Td mono>{fmtTime(order.orderDate)}</Td>
                      <Td mono>{order.salesOrderNumber}</Td>
                      <Td>{order.customerName}</Td>
                      <Td>
                        {order.salesperson ?? (
                          <span className="italic" style={textMutedStyle}>
                            unattributed
                          </span>
                        )}
                      </Td>
                      <Td>{displayMethod(order.paymentMethod)}</Td>
                      <Td mono>
                        {order.paymentReference || (
                          <span className="italic" style={textMutedStyle}>
                            none
                          </span>
                        )}
                      </Td>
                      <Td align="right" mono strong>
                        {fmt(order.totalAmount)}
                      </Td>
                      <Td>
                        <InlineLink
                          href={buildHref('/westsides/reports', { search: order.salesOrderNumber })}
                        >
                          Trace
                        </InlineLink>
                      </Td>
                    </tr>
                  ))}
                  {data.orders.length === 0 && (
                    <EmptyRow colSpan={8} message="No orders returned for this close." />
                  )}
                </tbody>
              </table>
            </div>
            {data.orders.length > 20 && (
              <div
                className="border-t px-4 py-2 text-xs"
                style={{ ...borderStyle, ...textMutedStyle }}
              >
                Showing first 20 of {data.orders.length} orders.
              </div>
            )}
          </Card>

          <Card className="p-4">
            <FormTextarea
              label="Operator notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Document count differences, late mobile-money confirmations, offline terminals, or supervisor instructions."
              hint="Printed on the Z-report and used as exception support."
            />
          </Card>

          <ZReport
            data={data}
            methodRows={methodRows}
            methodExpectedTotal={methodExpectedTotal}
            totalCounted={totalCounted}
            totalVariance={finalVariance}
            notes={notes}
            approvalReady={approvalReady}
            closeIssues={closeIssues}
          />

          <style jsx global>{`
            .z-report {
              position: fixed;
              left: -10000px;
              top: 0;
              width: 780px;
              opacity: 0;
              pointer-events: none;
            }

            @media print {
              body * {
                visibility: hidden !important;
              }
              .z-report,
              .z-report * {
                visibility: visible !important;
              }
              .z-report {
                position: absolute !important;
                left: 0;
                top: 0;
                width: 100%;
                padding: 24px;
                background: white;
                color: black;
                font-family: 'Courier New', monospace;
                font-size: 12px;
                opacity: 1;
                pointer-events: auto;
              }
            }
          `}</style>
        </>
      )}
    </div>
  );
}

// Subcomponents

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

function InlineLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-xs font-semibold transition hover:underline"
      style={{ color: 'var(--aurora-primary-text)' }}
    >
      {children}
    </Link>
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
          <p className="mt-1 max-w-3xl text-xs leading-relaxed" style={textSecondaryStyle}>
            {detail}
          </p>
        </div>
        {action}
      </div>
    </Card>
  );
}

function EmptyPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <Card className="p-8 text-center text-sm">
      <div className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
        {title}
      </div>
      <p className="mx-auto mt-1 max-w-xl text-xs leading-relaxed" style={textMutedStyle}>
        {detail}
      </p>
    </Card>
  );
}

function ControlFact({
  label,
  value,
  tone = 'muted',
}: {
  label: string;
  value: string;
  tone?: StatusTone;
}) {
  const color =
    tone === 'success'
      ? 'var(--aurora-success-text)'
      : tone === 'warning'
        ? 'var(--aurora-warning-text)'
        : tone === 'danger'
          ? 'var(--aurora-danger-text)'
          : tone === 'info'
            ? 'var(--aurora-info-text)'
            : 'var(--aurora-text)';
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide" style={textMutedStyle}>
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold" style={{ color }} title={value}>
        {value}
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  badge,
}: {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && (
          <p className="mt-0.5 text-xs" style={textMutedStyle}>
            {subtitle}
          </p>
        )}
      </div>
      {badge}
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone = 'muted',
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: StatusTone;
  highlight?: boolean;
}) {
  const accent =
    tone === 'success'
      ? 'var(--aurora-success-text)'
      : tone === 'warning'
        ? 'var(--aurora-warning-text)'
        : tone === 'danger'
          ? 'var(--aurora-danger-text)'
          : tone === 'info'
            ? 'var(--aurora-info-text)'
            : 'var(--aurora-text-secondary)';
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div
          className="text-[11px] uppercase tracking-wide"
          style={highlight ? { color: 'var(--aurora-primary-text)' } : textMutedStyle}
        >
          {label}
        </div>
        {!highlight && (
          <span className="mt-1 h-2 w-2 rounded-full" style={{ background: accent }} />
        )}
      </div>
      <div
        className="mt-1 text-xl font-bold tabular-nums"
        style={{ color: highlight ? 'var(--aurora-primary-text)' : 'var(--aurora-text)' }}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[11px]" style={textMutedStyle}>
          {hint}
        </div>
      )}
    </Card>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: StatusTone }) {
  const style =
    tone === 'success'
      ? {
          background: 'var(--aurora-success-bg)',
          borderColor: 'var(--aurora-success)',
          color: 'var(--aurora-success-text)',
        }
      : tone === 'warning'
        ? {
            background: 'var(--aurora-warning-bg)',
            borderColor: 'var(--aurora-warning)',
            color: 'var(--aurora-warning-text)',
          }
        : tone === 'danger'
          ? {
              background: 'var(--aurora-danger-bg)',
              borderColor: 'var(--aurora-danger)',
              color: 'var(--aurora-danger-text)',
            }
          : tone === 'info'
            ? {
                background: 'var(--aurora-info-bg)',
                borderColor: 'var(--aurora-info)',
                color: 'var(--aurora-info-text)',
              }
            : {
                background: 'var(--aurora-bg-subtle)',
                borderColor: 'var(--aurora-border)',
                color: 'var(--aurora-text-secondary)',
              };

  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
      style={style}
    >
      {label}
    </span>
  );
}

function ReadinessPanel({ item }: { item: ReadinessItem }) {
  return (
    <div className="rounded-lg border p-3" style={subtlePanelStyle}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold">{item.label}</div>
          <p className="mt-1 text-xs leading-relaxed" style={textMutedStyle}>
            {item.detail}
          </p>
        </div>
        <StatusBadge label={item.status} tone={item.tone} />
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  strong,
  muted,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  tone?: StatusTone;
}) {
  const valueColor =
    tone === 'success'
      ? 'var(--aurora-success-text)'
      : tone === 'warning'
        ? 'var(--aurora-warning-text)'
        : tone === 'danger'
          ? 'var(--aurora-danger-text)'
          : muted
            ? 'var(--aurora-text-muted)'
            : 'var(--aurora-text)';
  return (
    <div
      className="flex items-baseline justify-between gap-3 border-b py-2 last:border-b-0"
      style={borderStyle}
    >
      <span className="text-xs" style={muted ? textMutedStyle : textSecondaryStyle}>
        {label}
      </span>
      <span
        className={`text-sm tabular-nums ${strong ? 'font-bold' : 'font-semibold'}`}
        style={{ color: valueColor }}
      >
        {value}
      </span>
    </div>
  );
}

function Notice({
  tone,
  title,
  detail,
  compact,
}: {
  tone: StatusTone;
  title: string;
  detail: string;
  compact?: boolean;
}) {
  const style =
    tone === 'success'
      ? {
          background: 'var(--aurora-success-bg)',
          borderColor: 'var(--aurora-success)',
          color: 'var(--aurora-success-text)',
        }
      : tone === 'danger'
        ? {
            background: 'var(--aurora-danger-bg)',
            borderColor: 'var(--aurora-danger)',
            color: 'var(--aurora-danger-text)',
          }
        : tone === 'warning'
          ? {
              background: 'var(--aurora-warning-bg)',
              borderColor: 'var(--aurora-warning)',
              color: 'var(--aurora-warning-text)',
            }
          : tone === 'info'
            ? {
                background: 'var(--aurora-info-bg)',
                borderColor: 'var(--aurora-info)',
                color: 'var(--aurora-info-text)',
              }
            : {
                background: 'var(--aurora-bg-subtle)',
                borderColor: 'var(--aurora-border)',
                color: 'var(--aurora-text-secondary)',
              };

  return (
    <div className={`rounded-lg border ${compact ? 'px-3 py-2' : 'px-4 py-3'}`} style={style}>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-0.5 text-xs leading-relaxed">{detail}</div>
    </div>
  );
}

function IssueRow({ issue }: { issue: CloseIssue }) {
  return (
    <div className="rounded-lg border px-3 py-2" style={subtlePanelStyle}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{issue.title}</div>
          <div className="mt-0.5 text-xs leading-relaxed" style={textMutedStyle}>
            {issue.detail}
          </div>
        </div>
        <StatusBadge label={issue.blocking ? 'Blocking' : 'Handoff'} tone={issue.tone} />
      </div>
    </div>
  );
}

function SeverityCounter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: StatusTone;
}) {
  const color =
    tone === 'success'
      ? 'var(--aurora-success-text)'
      : tone === 'warning'
        ? 'var(--aurora-warning-text)'
        : tone === 'danger'
          ? 'var(--aurora-danger-text)'
          : tone === 'info'
            ? 'var(--aurora-info-text)'
            : 'var(--aurora-text-secondary)';
  return (
    <div className="rounded-lg border px-3 py-2" style={subtlePanelStyle}>
      <div className="text-[11px] uppercase tracking-wide" style={textMutedStyle}>
        {label}
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function DataTableCard({
  title,
  empty,
  columns,
  children,
}: {
  title: string;
  empty: string;
  columns: string[];
  children: React.ReactNode;
}) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b px-4 py-3" style={borderStyle}>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr style={tableHeadStyle}>
              {columns.map((column, index) => (
                <Th key={column} align={index === 0 ? 'left' : 'right'}>
                  {column}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hasRows ? children : <EmptyRow colSpan={columns.length} message={empty} />}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`border-b px-4 py-2 text-xs font-semibold uppercase ${align === 'right' ? 'text-right' : 'text-left'}`}
      style={{ ...borderStyle, ...textMutedStyle }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  mono,
  strong,
  tone,
  colSpan,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  mono?: boolean;
  strong?: boolean;
  tone?: StatusTone;
  colSpan?: number;
}) {
  const color =
    tone === 'success'
      ? 'var(--aurora-success-text)'
      : tone === 'warning'
        ? 'var(--aurora-warning-text)'
        : tone === 'danger'
          ? 'var(--aurora-danger-text)'
          : tone === 'muted'
            ? 'var(--aurora-text-muted)'
            : 'var(--aurora-text)';
  return (
    <td
      colSpan={colSpan}
      className={`px-4 py-2 align-middle ${align === 'right' ? 'text-right' : 'text-left'} ${mono ? 'tabular-nums font-mono text-xs' : ''} ${strong ? 'font-semibold' : ''}`}
      style={{ color }}
    >
      {children}
    </td>
  );
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-sm italic" style={textMutedStyle}>
        {message}
      </td>
    </tr>
  );
}

function ZReport({
  data,
  methodRows,
  methodExpectedTotal,
  totalCounted,
  totalVariance,
  notes,
  approvalReady,
  closeIssues,
}: {
  data: DailyClose;
  methodRows: MethodReconciliationLine[];
  methodExpectedTotal: number;
  totalCounted: number;
  totalVariance: number;
  notes: string;
  approvalReady: boolean;
  closeIssues: CloseIssue[];
}) {
  const dateStr = new Date(data.date).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const blockingIssues = closeIssues.filter((issue) => issue.blocking);

  return (
    <div className="z-report" aria-hidden="true">
      <div className="mb-4 text-center">
        <div className="text-base font-bold uppercase">Daily Close - Z-Report</div>
        <div className="text-xs">{dateStr}</div>
        <div className="text-[10px] text-slate-500">
          Generated {new Date().toLocaleString('en-GB')}
        </div>
      </div>

      <Section title="Summary">
        <Row label="Sales count" value={String(data.totals.salesCount)} />
        <Row label="Total revenue" value={`TZS ${fmt(data.totals.totalSales)}`} bold />
        <Row label="Average order" value={`TZS ${fmt(data.totals.averageOrder)}`} />
        <Row label="Tax collected" value={`TZS ${fmt(data.totals.taxAmount)}`} />
        <Row label="Discounts given" value={`TZS ${fmt(data.totals.discountAmount)}`} />
        <Row label="Cash collected (paid)" value={`TZS ${fmt(data.totals.paidAmount)}`} />
        <Row label="On credit (outstanding)" value={`TZS ${fmt(data.totals.outstandingAmount)}`} />
        <Row
          label="Approval status"
          value={approvalReady ? 'Ready for approval' : 'Review required'}
          bold
        />
      </Section>

      <Section title="Reconciliation">
        {methodRows.length === 0 && <div className="text-center italic">- no payments -</div>}
        {methodRows.map((m, i) => (
          <div key={i} className="mb-1">
            <div className="font-bold">
              {displayMethod(m.paymentMethod)} - {m.cashAccountName ?? 'unassigned'}
            </div>
            <Row label="  Expected" value={`TZS ${fmt(m.expected)}`} />
            <Row
              label="  Counted"
              value={m.countedAmount != null ? `TZS ${fmt(m.countedAmount)}` : '-'}
            />
            <Row
              label="  Variance"
              value={
                m.variance != null ? `${m.variance >= 0 ? '+' : ''}TZS ${fmt(m.variance)}` : '-'
              }
            />
            <Row label="  Status" value={m.varianceStatus.label} />
          </div>
        ))}
        {methodRows.length > 0 && (
          <div className="mt-2 border-t border-slate-300 pt-1">
            <Row label="Total expected" value={`TZS ${fmt(methodExpectedTotal)}`} bold />
            <Row label="Total counted" value={`TZS ${fmt(totalCounted)}`} bold />
            <Row
              label="Total variance"
              value={`${totalVariance >= 0 ? '+' : ''}TZS ${fmt(totalVariance)}`}
              bold
            />
          </div>
        )}
      </Section>

      {closeIssues.length > 0 && (
        <Section title="Exceptions">
          {closeIssues.map((issue, i) => (
            <div key={i} className="mb-1">
              <div className="font-bold">
                {issue.blocking ? '[BLOCKING]' : '[HANDOFF]'} {issue.title}
              </div>
              <div>{issue.detail}</div>
            </div>
          ))}
        </Section>
      )}

      <Section title="By salesperson">
        {data.bySalesperson.length === 0 && <div className="text-center italic">- none -</div>}
        {data.bySalesperson.map((s, i) => (
          <Row
            key={i}
            label={`${s.name ?? 'unattributed'} (${s.count})`}
            value={`TZS ${fmt(s.total)}`}
          />
        ))}
      </Section>

      <Section title="Top SKUs">
        {data.topProducts.length === 0 && <div className="text-center italic">- none -</div>}
        {data.topProducts.map((p, i) => (
          <Row
            key={p.productId}
            label={`${i + 1}. ${p.productName} x ${p.quantity.toFixed(0)}`}
            value={`TZS ${fmt(p.total)}`}
          />
        ))}
      </Section>

      {notes.trim() && (
        <Section title="Notes">
          <div className="whitespace-pre-wrap text-xs">{notes}</div>
        </Section>
      )}

      <div className="mt-4 border-t border-slate-300 pt-2 text-center text-[10px]">
        Blocking exceptions: {blockingIssues.length} | Counted by ____________________ | Approved by
        ____________________
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 border-b border-slate-300 pb-0.5 text-xs font-bold uppercase">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
