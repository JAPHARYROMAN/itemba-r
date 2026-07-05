'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PageHeader,
  PageToolbar,
  StatCard,
  PermissionDeniedState,
  showToast,
  Modal,
  Btn,
  ConfirmDialog,
  FormInput,
  FormSelect,
  FormTextarea,
} from '@/components/ui';
import {
  ResponsiveDataTable,
  type ResponsiveColumn,
} from '@/components/aurora/data-display/ResponsiveDataTable';
import { StatusBadge } from '@/components/aurora/data-display/StatusBadge';
import { AuroraButton } from '@/components/aurora/actions';
import { useAuth } from '@/hooks/use-auth';
import {
  ApiError,
  backendDelete,
  backendGet,
  backendList,
  backendPost,
  backendPut,
} from '@/lib/api-client';
import type { StatusVariant } from '@/lib/design-system/status';

// ─── Backend contract: automation-rules (backend/src/modules/automation-rules) ──
// GET    /automation-rules              list { items, total, page, limit } — permission automation_rules.list
//        query: companyId?, status?, page?, limit?
// GET    /automation-rules/:id          view                               — permission automation_rules.view
// POST   /automation-rules              create (status forced INACTIVE,    — permission automation_rules.create
//        automationRuleCode required — the service does NOT auto-generate it)
// PUT    /automation-rules/:id          update (dto passed straight to     — permission automation_rules.update
//        prisma.update, so only send model fields)
// DELETE /automation-rules/:id          soft delete                        — permission automation_rules.delete
// POST   /automation-rules/:id/activate set status ACTIVE                  — permission automation_rules.activate
// POST   /automation-rules/:id/pause    set status PAUSED                  — permission automation_rules.activate
//
// NOTE: The list endpoint returns { items, total, page, limit } (uses `items`,
// not `data`), so we read that shape directly rather than via backendPage /
// normalizePaginated (which expect `data`).
//
// NOTE: Whether ACTIVE rules actually fire automatically is gated server-side by
// the AUTOMATION_DISPATCH_ENABLED env flag (default OFF) inside the job-worker
// (backend/src/modules/job-worker/job-worker.service.ts). That flag is NOT
// exposed by any API, so this page surfaces it as a static operator note rather
// than a live indicator.

type AutomationRuleStatus = 'ACTIVE' | 'INACTIVE' | 'PAUSED' | 'ERROR';
type AutomationTriggerType = 'SCHEDULE' | 'EVENT' | 'THRESHOLD' | 'MANUAL';

interface Company {
  id: string;
  name: string;
  code?: string | null;
}

interface AutomationRule extends Record<string, unknown> {
  id: string;
  automationRuleCode: string;
  companyId: string | null;
  name: string;
  description: string | null;
  automationType: string;
  triggerType: AutomationTriggerType | string;
  triggerConfig: Record<string, unknown> | null;
  actionConfig: Record<string, unknown> | null;
  status: AutomationRuleStatus | string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RulePage {
  items: AutomationRule[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_SIZE = 20;

const STATUS_OPTIONS: AutomationRuleStatus[] = ['ACTIVE', 'INACTIVE', 'PAUSED', 'ERROR'];

// Prisma enums AutomationType / AutomationTriggerType (database/prisma/schema.prisma).
const AUTOMATION_TYPES = [
  'RECURRING_INVOICE',
  'RECURRING_EXPENSE',
  'RENT_INVOICE_GENERATION',
  'LOAN_REPAYMENT_REMINDER',
  'DEPRECIATION_POSTING',
  'STOCK_REORDER_SUGGESTION',
  'COMPLIANCE_REMINDER',
  'REPORT_DELIVERY',
  'PAYROLL_REMINDER',
  'CUSTOM',
] as const;

const TRIGGER_TYPES: AutomationTriggerType[] = ['SCHEDULE', 'EVENT', 'THRESHOLD', 'MANUAL'];

const STATUS_VARIANT: Record<string, StatusVariant> = {
  ACTIVE: 'success',
  INACTIVE: 'muted',
  PAUSED: 'warning',
  ERROR: 'danger',
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

/** Best-effort extraction of a human-readable schedule/trigger summary. */
function triggerSummary(rule: AutomationRule): string {
  const cfg = rule.triggerConfig ?? {};
  const raw = cfg as Record<string, unknown>;
  const candidate =
    raw.cron ?? raw.schedule ?? raw.frequency ?? raw.interval ?? raw.expression;
  if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  return humanize(String(rule.triggerType ?? ''));
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

interface RuleForm {
  automationRuleCode: string;
  companyId: string;
  name: string;
  description: string;
  automationType: string;
  triggerType: string;
  triggerConfig: string;
  actionConfig: string;
}

const BLANK_FORM: RuleForm = {
  automationRuleCode: '',
  companyId: '',
  name: '',
  description: '',
  automationType: 'CUSTOM',
  triggerType: 'SCHEDULE',
  triggerConfig: '{}',
  actionConfig: '{}',
};

function RuleModal({
  mode,
  initial,
  companies,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: AutomationRule;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<RuleForm>(() =>
    initial
      ? {
          automationRuleCode: initial.automationRuleCode,
          companyId: initial.companyId ?? '',
          name: initial.name,
          description: initial.description ?? '',
          automationType: String(initial.automationType),
          triggerType: String(initial.triggerType),
          triggerConfig: JSON.stringify(initial.triggerConfig ?? {}, null, 2),
          actionConfig: JSON.stringify(initial.actionConfig ?? {}, null, 2),
        }
      : { ...BLANK_FORM },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof RuleForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim() || (mode === 'create' && !form.automationRuleCode.trim())) {
      setError('Code and name are required');
      return;
    }
    let triggerConfig: unknown;
    let actionConfig: unknown;
    try {
      triggerConfig = form.triggerConfig.trim() ? JSON.parse(form.triggerConfig) : {};
    } catch {
      setError('Trigger config must be valid JSON');
      return;
    }
    try {
      actionConfig = form.actionConfig.trim() ? JSON.parse(form.actionConfig) : {};
    } catch {
      setError('Action config must be valid JSON');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        automationType: form.automationType,
        triggerType: form.triggerType,
        triggerConfig,
        actionConfig,
      };
      if (mode === 'create') {
        await backendPost('/automation-rules', {
          ...body,
          automationRuleCode: form.automationRuleCode.trim(),
          companyId: form.companyId || undefined,
        });
      } else {
        await backendPut(`/automation-rules/${initial!.id}`, body);
      }
      showToast('success', mode === 'create' ? 'Rule created' : 'Rule updated', form.name.trim());
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'New Automation Rule' : 'Edit Automation Rule'}
      size="lg"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={submit} loading={saving}>Save</Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormInput
          label="Code"
          required={mode === 'create'}
          value={form.automationRuleCode}
          onChange={(e) => set('automationRuleCode', e.target.value)}
          disabled={mode === 'edit'}
          hint={mode === 'create' ? 'Unique rule code, e.g. AUTO-RENT-001' : undefined}
        />
        <FormInput
          label="Name"
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
        />
        <FormSelect
          label="Automation Type"
          required
          value={form.automationType}
          onChange={(e) => set('automationType', e.target.value)}
        >
          {AUTOMATION_TYPES.map((t) => (
            <option key={t} value={t}>{humanize(t)}</option>
          ))}
        </FormSelect>
        <FormSelect
          label="Trigger Type"
          required
          value={form.triggerType}
          onChange={(e) => set('triggerType', e.target.value)}
        >
          {TRIGGER_TYPES.map((t) => (
            <option key={t} value={t}>{humanize(t)}</option>
          ))}
        </FormSelect>
        <FormSelect
          label="Company"
          value={form.companyId}
          onChange={(e) => set('companyId', e.target.value)}
          disabled={mode === 'edit'}
          placeholder="All companies"
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code ? `${c.code} — ${c.name}` : c.name}
            </option>
          ))}
        </FormSelect>
        <div className="col-span-2">
          <FormTextarea
            label="Description"
            rows={2}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <FormTextarea
            label="Trigger Config (JSON)"
            rows={4}
            className="font-mono"
            value={form.triggerConfig}
            onChange={(e) => set('triggerConfig', e.target.value)}
            hint='e.g. {"cron": "0 6 1 * *"} for a SCHEDULE trigger'
          />
        </div>
        <div className="col-span-2">
          <FormTextarea
            label="Action Config (JSON)"
            rows={4}
            className="font-mono"
            value={form.actionConfig}
            onChange={(e) => set('actionConfig', e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

export default function AutomationRulesPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission('automation_rules.list');
  // The backend guards both activate + pause with automation_rules.activate.
  const canToggle = hasPermission('automation_rules.activate');
  const canCreate = hasPermission('automation_rules.create');
  const canUpdate = hasPermission('automation_rules.update');
  const canDelete = hasPermission('automation_rules.delete');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<RulePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [deleting, setDeleting] = useState<AutomationRule | null>(null);

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
      const result = await backendGet<RulePage>('/automation-rules', {
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
      setError(err instanceof Error ? err.message : 'Failed to load automation rules');
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
    const active = rows.filter((r) => r.status === 'ACTIVE').length;
    const paused = rows.filter((r) => r.status === 'PAUSED').length;
    const errored = rows.filter((r) => r.status === 'ERROR').length;
    return { active, paused, errored };
  }, [rows]);

  const toggle = async (rule: AutomationRule) => {
    if (!canToggle) return;
    const activate = rule.status !== 'ACTIVE';
    const path = activate
      ? `/automation-rules/${rule.id}/activate`
      : `/automation-rules/${rule.id}/pause`;
    setPendingAction(rule.id);
    try {
      await backendPost(path, {});
      showToast(
        'success',
        activate ? 'Rule activated' : 'Rule paused',
        rule.name,
      );
      await load();
    } catch (err) {
      showToast(
        'error',
        'Could not update rule',
        err instanceof Error ? err.message : 'Please try again.',
      );
    } finally {
      setPendingAction(null);
    }
  };

  const onSaved = () => {
    setCreating(false);
    setEditing(null);
    void load();
  };

  const doDelete = async () => {
    if (!deleting) return;
    try {
      await backendDelete(`/automation-rules/${deleting.id}`);
      showToast('success', 'Rule deleted', deleting.name);
      setDeleting(null);
      await load();
    } catch (err) {
      showToast(
        'error',
        'Could not delete rule',
        err instanceof ApiError ? err.message : 'Please try again.',
      );
    }
  };

  const columns = useMemo<ResponsiveColumn<AutomationRule>[]>(
    () => [
      {
        key: 'name',
        header: 'Rule',
        priority: 1,
        accessor: (row) => (
          <div className="flex flex-col">
            <span className="font-medium" style={{ color: 'var(--aurora-text)' }}>
              {row.name}
            </span>
            <span
              className="text-[11px] font-mono"
              style={{ color: 'var(--aurora-text-muted)' }}
            >
              {row.automationRuleCode}
            </span>
          </div>
        ),
      },
      {
        key: 'automationType',
        header: 'Type',
        priority: 2,
        accessor: (row) => (
          <span className="text-xs font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
            {humanize(row.automationType)}
          </span>
        ),
      },
      {
        key: 'triggerType',
        header: 'Trigger / schedule',
        priority: 2,
        accessor: (row) => (
          <div className="flex flex-col">
            <span className="text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
              {humanize(String(row.triggerType))}
            </span>
            <span className="text-[11px] font-mono" style={{ color: 'var(--aurora-text-muted)' }}>
              {triggerSummary(row)}
            </span>
          </div>
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
        key: 'lastRunAt',
        header: 'Last run',
        priority: 2,
        accessor: (row) => (
          <span className="text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
            {fmtDateTime(row.lastRunAt)}
          </span>
        ),
      },
      {
        key: 'nextRunAt',
        header: 'Next run',
        priority: 3,
        accessor: (row) => (
          <span className="text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
            {fmtDateTime(row.nextRunAt)}
          </span>
        ),
      },
      ...(canToggle || canUpdate || canDelete
        ? [
            {
              key: 'actions',
              header: 'Actions',
              priority: 1,
              exportExclude: true,
              accessor: (row: AutomationRule) => {
                const busy = pendingAction === row.id;
                const activate = row.status !== 'ACTIVE';
                return (
                  <div className="flex items-center gap-1.5">
                    {canToggle && (
                      <AuroraButton
                        size="sm"
                        variant={activate ? 'primary' : 'secondary'}
                        loading={busy}
                        onClick={() => toggle(row)}
                      >
                        {activate ? 'Enable' : 'Pause'}
                      </AuroraButton>
                    )}
                    {canUpdate && (
                      <AuroraButton size="sm" variant="ghost" onClick={() => setEditing(row)}>
                        Edit
                      </AuroraButton>
                    )}
                    {canDelete && (
                      <AuroraButton size="sm" variant="ghost" onClick={() => setDeleting(row)}>
                        Delete
                      </AuroraButton>
                    )}
                  </div>
                );
              },
            } as ResponsiveColumn<AutomationRule>,
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canToggle, canUpdate, canDelete, pendingAction],
  );

  if (!canView) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader
          title="Automation Rules"
          subtitle="Configure business automation rules and triggers"
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
        title="Automation Rules"
        subtitle="Configure business automation rules, triggers and schedules"
      />

      {/* Operator note: automatic dispatch is server-flag gated. */}
      <div
        className="rounded-lg border px-4 py-3 flex items-start gap-3"
        style={{
          borderColor: 'var(--aurora-warning)',
          background: 'var(--aurora-warning-bg)',
          color: 'var(--aurora-warning-text)',
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
            d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
          />
        </svg>
        <div className="text-sm leading-5">
          <span className="font-semibold">Automatic dispatch is server-controlled.</span>{' '}
          Enabling a rule marks it ACTIVE, but rules only fire automatically when an operator
          sets the <span className="font-mono font-semibold">AUTOMATION_DISPATCH_ENABLED</span>{' '}
          server flag (default off) and the background job worker is running. This flag is not
          exposed to the app — check the deployment configuration to confirm it is on.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Rules" value={total} />
        <StatCard label="Active (page)" value={stats.active} variant="green" />
        <StatCard label="Paused (page)" value={stats.paused} variant="amber" />
        <StatCard label="Errored (page)" value={stats.errored} variant="red" />
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
        actions={
          canCreate ? (
            <AuroraButton variant="primary" size="sm" onClick={() => setCreating(true)}>
              + New Rule
            </AuroraButton>
          ) : null
        }
      />

      <ResponsiveDataTable<AutomationRule>
        columns={columns}
        data={rows}
        keyField="id"
        loading={loading}
        error={error}
        onRetry={load}
        errorTitle="Could not load automation rules"
        emptyTitle="No automation rules yet"
        emptyDescription="Automation rules define recurring or event-driven business actions such as recurring invoices, reminders and report delivery."
        pagination={{
          page,
          limit: PAGE_SIZE,
          total,
          onPageChange: (p) => setPage(Math.min(Math.max(1, p), totalPages)),
        }}
      />

      {creating && (
        <RuleModal
          mode="create"
          companies={companies}
          onClose={() => setCreating(false)}
          onSaved={onSaved}
        />
      )}
      {editing && (
        <RuleModal
          mode="edit"
          initial={editing}
          companies={companies}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete automation rule"
        message={`Delete "${deleting?.name ?? ''}"? The rule will stop appearing here and will no longer be runnable.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
