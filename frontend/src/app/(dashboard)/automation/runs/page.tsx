'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PageHeader,
  PageToolbar,
  StatCard,
  PermissionDeniedState,
} from '@/components/ui';
import {
  ResponsiveDataTable,
  type ResponsiveColumn,
} from '@/components/aurora/data-display/ResponsiveDataTable';
import { StatusBadge } from '@/components/aurora/data-display/StatusBadge';
import { useAuth } from '@/hooks/use-auth';
import { backendGet, backendList } from '@/lib/api-client';
import type { StatusVariant } from '@/lib/design-system/status';

// ─── Backend contract: automation-runs (backend/src/modules/automation-runs) ───
// GET    /automation-runs              list { items, total, page, limit } — permission automation_runs.list
//        query: companyId?, ruleId?, status?, page?, limit?
// GET    /automation-runs/:id          view                              — permission automation_runs.view
// GET    /automation-runs/:id/items    per-run item outcomes             — permission automation_runs.view
// POST   /automation-runs/trigger      { ruleId, companyId? } manual run — permission automation_runs.trigger
//
// NOTE: The list endpoint returns { items, total, page, limit } (uses `items`,
// not `data`), so we read that shape directly rather than via backendPage.
//
// NOTE: Runs with runType SCHEDULED / EVENT_TRIGGERED are only produced by the
// background job worker, which only dispatches automatically when the server
// flag AUTOMATION_DISPATCH_ENABLED is on (default off). Until then, the only
// runs you will see are MANUAL ones triggered on demand.

type AutomationRunStatus =
  | 'REQUESTED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

interface Company {
  id: string;
  name: string;
  code?: string | null;
}

interface AutomationRun extends Record<string, unknown> {
  id: string;
  automationRunNumber: string;
  automationRuleId: string | null;
  companyId: string | null;
  runType: 'SCHEDULED' | 'MANUAL' | 'EVENT_TRIGGERED' | string;
  status: AutomationRunStatus | string;
  startedAt: string | null;
  completedAt: string | null;
  recordsProcessed: number;
  recordsCreated: number;
  recordsFailed: number;
  resultSummary: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RunPage {
  items: AutomationRun[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_SIZE = 20;

const STATUS_OPTIONS: AutomationRunStatus[] = [
  'REQUESTED',
  'RUNNING',
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'FAILED',
  'CANCELLED',
];

const STATUS_VARIANT: Record<string, StatusVariant> = {
  REQUESTED: 'warning',
  RUNNING: 'primary',
  COMPLETED: 'success',
  PARTIALLY_COMPLETED: 'warning',
  FAILED: 'danger',
  CANCELLED: 'muted',
};

function fmtDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function humanize(value?: string | null): string {
  if (!value) return '—';
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export default function AutomationRunsPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission('automation_runs.list');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<RunPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    backendList<Company>('/companies', { query: { limit: 200 } })
      .then((rows) => {
        if (!cancelled) setCompanies(rows);
      })
      .catch(() => {
        if (!cancelled) setCompanies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canView]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const result = await backendGet<RunPage>('/automation-runs', {
        query: {
          page,
          limit: PAGE_SIZE,
          companyId: companyId || undefined,
          status: status || undefined,
        },
      });
      setData({
        items: Array.isArray(result?.items) ? result.items : [],
        total: num(result?.total),
        page: num(result?.page) || page,
        limit: num(result?.limit) || PAGE_SIZE,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load automation runs');
      setData({ items: [], total: 0, page, limit: PAGE_SIZE });
    } finally {
      setLoading(false);
    }
  }, [canView, page, companyId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => data?.items ?? [], [data]);

  const stats = useMemo(() => {
    const completed = rows.filter((r) => r.status === 'COMPLETED').length;
    const failed = rows.filter(
      (r) => r.status === 'FAILED' || r.status === 'PARTIALLY_COMPLETED',
    ).length;
    const running = rows.filter(
      (r) => r.status === 'RUNNING' || r.status === 'REQUESTED',
    ).length;
    return { completed, failed, running };
  }, [rows]);

  const columns = useMemo<ResponsiveColumn<AutomationRun>[]>(
    () => [
      {
        key: 'automationRunNumber',
        header: 'Run #',
        priority: 1,
        accessor: (row) => (
          <span className="font-mono text-xs" style={{ color: 'var(--aurora-text)' }}>
            {row.automationRunNumber}
          </span>
        ),
      },
      {
        key: 'runType',
        header: 'Type',
        priority: 2,
        accessor: (row) => (
          <span className="text-xs font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
            {humanize(String(row.runType))}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        priority: 1,
        accessor: (row) => (
          <StatusBadge status={row.status} variant={STATUS_VARIANT[String(row.status)]} />
        ),
      },
      {
        key: 'outcome',
        header: 'Outcome',
        priority: 2,
        exportExclude: true,
        accessor: (row) => {
          if (row.errorMessage) {
            return (
              <span
                className="text-xs"
                style={{ color: 'var(--aurora-danger-text)' }}
                title={row.errorMessage}
              >
                {row.errorMessage.length > 48
                  ? `${row.errorMessage.slice(0, 48)}…`
                  : row.errorMessage}
              </span>
            );
          }
          const processed = num(row.recordsProcessed);
          const created = num(row.recordsCreated);
          const failed = num(row.recordsFailed);
          return (
            <span className="text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
              {processed} processed
              {created ? `, ${created} created` : ''}
              {failed ? `, ${failed} failed` : ''}
            </span>
          );
        },
      },
      {
        key: 'recordsProcessed',
        header: 'Processed',
        priority: 3,
        accessor: (row) => (
          <span className="text-xs tabular-nums" style={{ color: 'var(--aurora-text-secondary)' }}>
            {num(row.recordsProcessed)}
          </span>
        ),
      },
      {
        key: 'recordsCreated',
        header: 'Created',
        priority: 3,
        accessor: (row) => (
          <span className="text-xs tabular-nums" style={{ color: 'var(--aurora-success-text)' }}>
            {num(row.recordsCreated)}
          </span>
        ),
      },
      {
        key: 'recordsFailed',
        header: 'Failed',
        priority: 3,
        accessor: (row) => {
          const failed = num(row.recordsFailed);
          return (
            <span
              className="text-xs tabular-nums font-medium"
              style={{ color: failed ? 'var(--aurora-danger-text)' : 'var(--aurora-text-muted)' }}
            >
              {failed}
            </span>
          );
        },
      },
      {
        key: 'startedAt',
        header: 'Started',
        priority: 2,
        accessor: (row) => (
          <span className="text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
            {fmtDateTime(row.startedAt)}
          </span>
        ),
      },
      {
        key: 'completedAt',
        header: 'Completed',
        priority: 3,
        accessor: (row) => (
          <span className="text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
            {fmtDateTime(row.completedAt)}
          </span>
        ),
      },
    ],
    [],
  );

  if (!canView) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader
          title="Automation Runs"
          subtitle="Monitor automation execution history and results"
        />
        <PermissionDeniedState />
      </div>
    );
  }

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filterSelectCls =
    'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = {
    borderColor: 'var(--aurora-border)',
    background: 'var(--aurora-card)',
    color: 'var(--aurora-text)',
  } as const;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Automation Runs"
        subtitle="Monitor automation execution history, status and per-run outcomes"
      />

      {/* Operator note: automatic (scheduled/event) runs depend on the server flag. */}
      <div
        className="rounded-lg border px-4 py-3 flex items-start gap-3"
        style={{
          borderColor: 'var(--aurora-border)',
          background: 'var(--aurora-bg-subtle)',
          color: 'var(--aurora-text-secondary)',
        }}
        role="note"
      >
        <svg
          className="w-5 h-5 flex-shrink-0 mt-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
          />
        </svg>
        <div className="text-sm leading-5">
          <span className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Scheduled and event-triggered runs are server-gated.
          </span>{' '}
          They are only produced when the background job worker runs with the{' '}
          <span className="font-mono font-semibold">AUTOMATION_DISPATCH_ENABLED</span> server flag
          on (default off). Manual runs appear here as soon as they are triggered.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Runs" value={total} />
        <StatCard label="Completed (page)" value={stats.completed} variant="green" />
        <StatCard label="Failed / Partial (page)" value={stats.failed} variant="red" />
        <StatCard label="In Progress (page)" value={stats.running} variant="blue" />
      </div>

      <PageToolbar
        filters={
          <>
            <select
              aria-label="Filter by company"
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code ? `${c.code} — ${c.name}` : c.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
          </>
        }
      />

      <ResponsiveDataTable<AutomationRun>
        columns={columns}
        data={rows}
        keyField="id"
        loading={loading}
        error={error}
        onRetry={load}
        errorTitle="Could not load automation runs"
        emptyTitle="No automation runs yet"
        emptyDescription="Runs appear here once automation rules execute — either triggered manually or dispatched automatically by the background worker."
        pagination={{
          page,
          limit: PAGE_SIZE,
          total,
          onPageChange: (p) => setPage(Math.min(Math.max(1, p), totalPages)),
        }}
      />
    </div>
  );
}
