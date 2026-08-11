'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui';
import {
  ResponsiveDataTable,
  type ResponsiveColumn,
  FormShell,
  FormSection,
  FormInput,
  FormSelect,
  FormTextarea,
  FormSwitch,
  FormActions,
  ConfirmDialog,
  Modal,
  StatusBadge,
  AuroraButton,
} from '@/components/aurora';
import { showToast } from '@/components/aurora/feedback';
import { PermissionGate } from '@/components/ui/permission-gate';
import { useAuth } from '@/hooks/use-auth';
import { backendPage, backendPost, backendPatch, backendDelete, ApiError } from '@/lib/api-client';
import { downloadBinaryGet } from '@/lib/export-download';

// ── Backend contract: bi/scheduled-reports (backend/src/modules/scheduled-reports) ──
// GET    /bi/scheduled-reports                     list (paginated)   — permission scheduled_reports.view
// POST   /bi/scheduled-reports                     create             — permission scheduled_reports.manage
// PATCH  /bi/scheduled-reports/:id                 edit               — permission scheduled_reports.manage
// POST   /bi/scheduled-reports/:id/run             run now            — permission scheduled_reports.run
// GET    /bi/scheduled-reports/:id/runs            run history        — permission scheduled_reports.view
// GET    /bi/scheduled-reports/runs/:id/download   stored export file — permission scheduled_reports.view
// PATCH  /bi/scheduled-reports/:id/activate                           — permission scheduled_reports.manage
// PATCH  /bi/scheduled-reports/:id/deactivate                         — permission scheduled_reports.manage
// DELETE /bi/scheduled-reports/:id                 soft delete        — permission scheduled_reports.manage
//
// Dispatch: the backend job worker (backend/src/modules/job-worker) polls for due
// schedules. When the server runs with JOB_WORKER_ENABLED=true AND
// AUTOMATION_DISPATCH_ENABLED=true, due schedules run automatically and the
// generated export is emailed to the configured recipients (file attached).
// "Run now" generates a snapshot immediately WITHOUT emailing; every generated
// file can be downloaded from the schedule's Runs list.

type ScheduleFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'CUSTOM';
type ReportExportFormat = 'PDF' | 'EXCEL' | 'CSV' | 'JSON' | 'DASHBOARD_ONLY';

const FREQUENCY_OPTIONS: { value: ScheduleFrequency; label: string }[] = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'ANNUAL', label: 'Annual' },
  { value: 'CUSTOM', label: 'Custom' },
];

const FORMAT_OPTIONS: { value: ReportExportFormat; label: string }[] = [
  { value: 'EXCEL', label: 'Excel (.xls)' },
  { value: 'PDF', label: 'PDF' },
  { value: 'CSV', label: 'CSV' },
  { value: 'JSON', label: 'JSON' },
  { value: 'DASHBOARD_ONLY', label: 'Dashboard only' },
];

interface ScheduledReport extends Record<string, unknown> {
  id: string;
  scheduleCode: string;
  reportDefinitionId: string;
  savedReportViewId: string | null;
  companyId: string | null;
  name: string;
  description: string | null;
  frequency: ScheduleFrequency;
  scheduleConfig: Record<string, unknown> | null;
  recipients: Record<string, unknown> | null;
  exportFormat: ReportExportFormat;
  isActive: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ScheduledRun {
  id: string;
  reportRunNumber: string;
  status: string;
  rowCount: number | null;
  createdAt: string;
  completedAt: string | null;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  dataset: string | null;
  downloadable: boolean;
}

interface ScheduleForm {
  scheduleCode: string;
  name: string;
  description: string;
  reportDefinitionId: string;
  savedReportViewId: string;
  companyId: string;
  frequency: ScheduleFrequency;
  exportFormat: ReportExportFormat;
  recipients: string; // comma / newline separated emails
}

const EMPTY_FORM: ScheduleForm = {
  scheduleCode: '',
  name: '',
  description: '',
  reportDefinitionId: '',
  savedReportViewId: '',
  companyId: '',
  frequency: 'MONTHLY',
  exportFormat: 'EXCEL',
  recipients: '',
};

const PAGE_LIMIT = 20;

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

/** Pull a readable list of recipient emails out of the stored JSON blob. */
function recipientEmails(recipients: ScheduledReport['recipients']): string[] {
  if (!recipients) return [];
  const raw = recipients as Record<string, unknown>;
  const candidate = raw.emails ?? raw.to ?? raw.recipients ?? raw.addresses;
  if (Array.isArray(candidate)) return candidate.map((v) => String(v)).filter(Boolean);
  if (typeof candidate === 'string') return candidate.split(/[,\n;]/).map((s) => s.trim()).filter(Boolean);
  return [];
}

/** Parse the recipients textarea into the JSON shape the backend stores. */
function parseRecipients(input: string): Record<string, unknown> {
  const emails = input
    .split(/[,\n;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { emails };
}

export default function ScheduledReportsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('scheduled_reports.manage');
  const canRun = hasPermission('scheduled_reports.run');

  const [rows, setRows] = useState<ScheduledReport[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledReport | null>(null);
  const [form, setForm] = useState<ScheduleForm>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof ScheduleForm, string>>>({});
  const [saving, setSaving] = useState(false);

  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<ScheduledReport | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Run history modal + per-run file download.
  const [runsTarget, setRunsTarget] = useState<ScheduledReport | null>(null);
  const [runs, setRuns] = useState<ScheduledRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [downloadingRunId, setDownloadingRunId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await backendPage<ScheduledReport>('/bi/scheduled-reports', {
        query: { page, limit: PAGE_LIMIT },
      });
      setRows(result.data);
      setTotal(result.total);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load scheduled reports'));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setFormOpen(true);
  };

  const openEdit = (schedule: ScheduledReport) => {
    setEditing(schedule);
    setForm({
      scheduleCode: schedule.scheduleCode,
      name: schedule.name,
      description: schedule.description ?? '',
      reportDefinitionId: schedule.reportDefinitionId,
      savedReportViewId: schedule.savedReportViewId ?? '',
      companyId: schedule.companyId ?? '',
      frequency: schedule.frequency,
      exportFormat: schedule.exportFormat,
      recipients: recipientEmails(schedule.recipients).join(', '),
    });
    setFormErrors({});
    setFormOpen(true);
  };

  const validate = (): boolean => {
    const errs: Partial<Record<keyof ScheduleForm, string>> = {};
    if (!form.name.trim()) errs.name = 'Name is required';
    if (!editing && !form.scheduleCode.trim()) errs.scheduleCode = 'Schedule code is required';
    if (!editing && !form.reportDefinitionId.trim()) {
      errs.reportDefinitionId = 'Report definition ID is required';
    }
    if (!form.recipients.trim()) errs.recipients = 'At least one recipient is required';
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      if (editing) {
        // Partial update — schedule code + report definition are immutable in the UI.
        await backendPatch(`/bi/scheduled-reports/${editing.id}`, {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          savedReportViewId: form.savedReportViewId.trim() || undefined,
          frequency: form.frequency,
          exportFormat: form.exportFormat,
          recipients: parseRecipients(form.recipients),
        });
        showToast('success', 'Schedule updated', form.name.trim());
      } else {
        await backendPost('/bi/scheduled-reports', {
          scheduleCode: form.scheduleCode.trim(),
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          reportDefinitionId: form.reportDefinitionId.trim(),
          ...(form.savedReportViewId.trim() ? { savedReportViewId: form.savedReportViewId.trim() } : {}),
          ...(form.companyId.trim() ? { companyId: form.companyId.trim() } : {}),
          frequency: form.frequency,
          exportFormat: form.exportFormat,
          recipients: parseRecipients(form.recipients),
        });
        showToast('success', 'Schedule created', form.name.trim());
      }
      setFormOpen(false);
      if (!editing && page !== 1) setPage(1);
      else await load();
    } catch (err) {
      showToast('error', editing ? 'Update failed' : 'Create failed', errorMessage(err, 'Please try again'));
    } finally {
      setSaving(false);
    }
  };

  const loadRuns = useCallback(async (scheduleId: string) => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const result = await backendPage<ScheduledRun>(`/bi/scheduled-reports/${scheduleId}/runs`, {
        query: { page: 1, limit: 20 },
      });
      setRuns(result.data);
    } catch (err) {
      setRunsError(errorMessage(err, 'Failed to load run history'));
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, []);

  const runNow = async (schedule: ScheduledReport) => {
    setPendingAction(schedule.id);
    try {
      const result = await backendPost<{ export?: { filename?: string } }>(
        `/bi/scheduled-reports/${schedule.id}/run`,
        {},
      );
      showToast(
        'success',
        'Report generated',
        result?.export?.filename
          ? `Snapshot ready: ${result.export.filename} — download it from the Runs list.`
          : 'A snapshot export was generated — download it from the Runs list. Manual runs are not emailed.',
      );
      await load();
      // Keep an open runs modal in sync with the run that was just produced.
      if (runsTarget?.id === schedule.id) void loadRuns(schedule.id);
    } catch (err) {
      showToast('error', 'Run failed', errorMessage(err, 'Please try again'));
    } finally {
      setPendingAction(null);
    }
  };

  const openRuns = (schedule: ScheduledReport) => {
    setRunsTarget(schedule);
    setRuns([]);
    void loadRuns(schedule.id);
  };

  const downloadRun = async (run: ScheduledRun) => {
    setDownloadingRunId(run.id);
    try {
      await downloadBinaryGet(
        `/bi/scheduled-reports/runs/${run.id}/download`,
        run.filename ?? `${run.reportRunNumber}.bin`,
      );
    } catch (err) {
      showToast('error', 'Download failed', errorMessage(err, 'Please try again'));
    } finally {
      setDownloadingRunId(null);
    }
  };

  const toggleActive = async (schedule: ScheduledReport) => {
    setPendingAction(schedule.id);
    const action = schedule.isActive ? 'deactivate' : 'activate';
    try {
      await backendPatch(`/bi/scheduled-reports/${schedule.id}/${action}`, {});
      showToast('success', schedule.isActive ? 'Schedule deactivated' : 'Schedule activated', schedule.name);
      await load();
    } catch (err) {
      showToast('error', 'Could not update status', errorMessage(err, 'Please try again'));
    } finally {
      setPendingAction(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await backendDelete(`/bi/scheduled-reports/${deleteTarget.id}`);
      showToast('success', 'Schedule deleted', deleteTarget.name);
      setDeleteTarget(null);
      if (rows.length === 1 && page > 1) setPage((p) => p - 1);
      else await load();
    } catch (err) {
      showToast('error', 'Delete failed', errorMessage(err, 'Please try again'));
    } finally {
      setDeleting(false);
    }
  };

  const columns = useMemo<ResponsiveColumn<ScheduledReport>[]>(
    () => [
      {
        key: 'name',
        header: 'Schedule',
        priority: 1,
        accessor: (row) => (
          <div className="flex flex-col">
            <span className="font-medium" style={{ color: 'var(--aurora-text)' }}>
              {row.name}
            </span>
            <span className="text-[11px] font-mono" style={{ color: 'var(--aurora-text-muted)' }}>
              {row.scheduleCode}
            </span>
          </div>
        ),
      },
      {
        key: 'frequency',
        header: 'Frequency',
        priority: 2,
        accessor: (row) => (
          <span className="text-xs font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
            {FREQUENCY_OPTIONS.find((f) => f.value === row.frequency)?.label ?? row.frequency}
          </span>
        ),
      },
      {
        key: 'exportFormat',
        header: 'Format',
        priority: 3,
        accessor: (row) => (
          <span className="text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
            {row.exportFormat.replace(/_/g, ' ')}
          </span>
        ),
      },
      {
        key: 'recipients',
        header: 'Recipients',
        priority: 3,
        accessor: (row) => {
          const emails = recipientEmails(row.recipients);
          if (!emails.length) {
            return <span style={{ color: 'var(--aurora-text-muted)' }}>—</span>;
          }
          return (
            <span className="text-xs" style={{ color: 'var(--aurora-text-secondary)' }} title={emails.join(', ')}>
              {emails.length === 1 ? emails[0] : `${emails[0]} +${emails.length - 1}`}
            </span>
          );
        },
      },
      {
        key: 'isActive',
        header: 'Status',
        priority: 1,
        accessor: (row) =>
          row.isActive ? (
            <StatusBadge status="Active" variant="success" />
          ) : (
            <StatusBadge status="Paused" variant="muted" />
          ),
      },
      {
        key: 'lastRunAt',
        header: 'Last run',
        priority: 2,
        accessor: (row) => (
          <span className="text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
            {formatDate(row.lastRunAt)}
          </span>
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        priority: 1,
        exportExclude: true,
        accessor: (row) => {
          const busy = pendingAction === row.id;
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              {canRun && (
                <AuroraButton size="sm" variant="primary" loading={busy} onClick={() => runNow(row)}>
                  Run now
                </AuroraButton>
              )}
              <AuroraButton size="sm" variant="ghost" onClick={() => openRuns(row)}>
                Runs
              </AuroraButton>
              {canManage && (
                <AuroraButton size="sm" variant="ghost" onClick={() => openEdit(row)}>
                  Edit
                </AuroraButton>
              )}
              {canManage && (
                <AuroraButton size="sm" variant="ghost" loading={busy} onClick={() => toggleActive(row)}>
                  {row.isActive ? 'Deactivate' : 'Activate'}
                </AuroraButton>
              )}
              {canManage && (
                <AuroraButton size="sm" variant="danger" onClick={() => setDeleteTarget(row)}>
                  Delete
                </AuroraButton>
              )}
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canManage, canRun, pendingAction, runsTarget],
  );

  return (
    <PermissionGate
      permission="scheduled_reports.view"
      fallback={
        <div className="p-6">
          <div
            className="rounded-lg border p-6 text-sm"
            style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-muted)' }}
          >
            You do not have permission to view scheduled reports.
          </div>
        </div>
      }
    >
      <div className="p-6 space-y-4">
        <PageHeader
          title="Scheduled Reports"
          subtitle="Configure report snapshots with a frequency, export format and recipient list."
          breadcrumbs={[
            { label: 'Reports', href: '/reports' },
            { label: 'Scheduled' },
          ]}
          actions={
            canManage ? (
              <AuroraButton variant="primary" onClick={openCreate}>
                New schedule
              </AuroraButton>
            ) : undefined
          }
        />

        {/* How dispatch actually works: the background job worker runs due schedules. */}
        <div
          className="rounded-lg border px-4 py-3 flex items-start gap-3"
          style={{
            borderColor: 'var(--aurora-border)',
            background: 'var(--aurora-bg-subtle)',
            color: 'var(--aurora-text-secondary)',
          }}
          role="note"
        >
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <div className="text-sm leading-5">
            <span className="font-semibold">Active schedules are dispatched by the background worker.</span>{' '}
            When the server runs with the job worker and automation dispatch enabled
            (<code className="text-[11px]">JOB_WORKER_ENABLED</code> and{' '}
            <code className="text-[11px]">AUTOMATION_DISPATCH_ENABLED</code>), due schedules run automatically
            and the generated export is emailed to the recipients with the file attached.{' '}
            <span className="font-semibold">&ldquo;Run now&rdquo;</span> generates a snapshot immediately without
            emailing — every generated file can be downloaded from the schedule&rsquo;s{' '}
            <span className="font-semibold">Runs</span> list.
          </div>
        </div>

        <ResponsiveDataTable<ScheduledReport>
          columns={columns}
          data={rows}
          keyField="id"
          loading={loading}
          error={error}
          onRetry={load}
          errorTitle="Could not load scheduled reports"
          emptyTitle="No scheduled reports yet"
          emptyDescription={
            canManage
              ? 'Create a schedule to define a report snapshot and its recipients.'
              : 'No scheduled reports are available to you yet.'
          }
          pagination={{
            page,
            limit: PAGE_LIMIT,
            total,
            onPageChange: setPage,
          }}
        />
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit schedule' : 'New schedule'}
        description={
          editing
            ? 'Update the frequency, format and recipients for this schedule.'
            : 'Define a report snapshot, its export format and recipient list.'
        }
        size="lg"
      >
        <div className="px-5 pb-5 pt-4 max-h-[70vh] overflow-y-auto">
          <FormShell onSubmit={submitForm}>
            <FormSection title="Basics" columns={2}>
              <FormInput
                label="Name"
                required
                value={form.name}
                error={formErrors.name}
                placeholder="e.g. Monthly board pack"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              <FormInput
                label="Schedule code"
                required={!editing}
                disabled={!!editing}
                value={form.scheduleCode}
                error={formErrors.scheduleCode}
                placeholder="e.g. BOARD-PACK-M"
                help={editing ? 'Schedule code cannot be changed.' : 'Unique short code for this schedule.'}
                onChange={(e) => setForm((f) => ({ ...f, scheduleCode: e.target.value }))}
              />
              <div className="sm:col-span-2">
                <FormTextarea
                  label="Description"
                  value={form.description}
                  placeholder="Optional notes about what this schedule produces."
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
            </FormSection>

            <FormSection title="Source" columns={2}>
              <FormInput
                label="Report definition ID"
                required={!editing}
                disabled={!!editing}
                value={form.reportDefinitionId}
                error={formErrors.reportDefinitionId}
                placeholder="UUID of the report definition"
                help={editing ? 'Report definition cannot be changed.' : 'The report definition UUID to snapshot.'}
                onChange={(e) => setForm((f) => ({ ...f, reportDefinitionId: e.target.value }))}
              />
              <FormInput
                label="Saved view ID (optional)"
                value={form.savedReportViewId}
                placeholder="UUID of a saved report view"
                help="Optional. Applies a saved view's filters to the snapshot."
                onChange={(e) => setForm((f) => ({ ...f, savedReportViewId: e.target.value }))}
              />
              {!editing && (
                <FormInput
                  label="Company ID (optional)"
                  value={form.companyId}
                  placeholder="Leave blank for group scope"
                  help="Optional. Defaults to your active company; blank for group scope."
                  onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
                />
              )}
            </FormSection>

            <FormSection title="Delivery" columns={2}>
              <FormSelect
                label="Frequency"
                required
                value={form.frequency}
                options={FREQUENCY_OPTIONS}
                onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as ScheduleFrequency }))}
              />
              <FormSelect
                label="Export format"
                required
                value={form.exportFormat}
                options={FORMAT_OPTIONS}
                onChange={(e) => setForm((f) => ({ ...f, exportFormat: e.target.value as ReportExportFormat }))}
              />
              <div className="sm:col-span-2">
                <FormTextarea
                  label="Recipients"
                  required
                  value={form.recipients}
                  error={formErrors.recipients}
                  placeholder="finance@itemba.co.tz, board@itemba.co.tz"
                  help="Comma or newline separated email addresses. The background worker emails the generated export to these addresses when the schedule fires (requires server automation dispatch to be enabled)."
                  onChange={(e) => setForm((f) => ({ ...f, recipients: e.target.value }))}
                />
              </div>
            </FormSection>

            <FormActions
              primaryLabel={editing ? 'Save changes' : 'Create schedule'}
              onSecondary={() => setFormOpen(false)}
              loading={saving}
            />
          </FormShell>
        </div>
      </Modal>

      <Modal
        open={!!runsTarget}
        onClose={() => setRunsTarget(null)}
        title={runsTarget ? `Runs — ${runsTarget.name}` : 'Runs'}
        description="Generation history for this schedule. Download the stored export file of any completed run."
        size="lg"
      >
        <div className="px-5 pb-5 pt-4 max-h-[70vh] overflow-y-auto">
          {runsLoading && (
            <div className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              Loading run history…
            </div>
          )}
          {runsError && !runsLoading && (
            <div className="flex items-center gap-3">
              <span className="text-sm" style={{ color: 'var(--aurora-danger)' }}>
                {runsError}
              </span>
              {runsTarget && (
                <AuroraButton size="sm" variant="ghost" onClick={() => void loadRuns(runsTarget.id)}>
                  Retry
                </AuroraButton>
              )}
            </div>
          )}
          {!runsLoading && !runsError && runs.length === 0 && (
            <div className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              No runs recorded yet. Use &ldquo;Run now&rdquo; or wait for the automated dispatcher to fire.
            </div>
          )}
          <div className="space-y-2">
            {runs.map((run) => (
              <div
                key={run.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium" style={{ color: 'var(--aurora-text)' }}>
                    {run.filename ?? run.reportRunNumber}
                  </span>
                  <span className="text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
                    {formatDate(run.completedAt ?? run.createdAt)}
                    {typeof run.rowCount === 'number' ? ` · ${run.rowCount} rows` : ''}
                    {typeof run.sizeBytes === 'number' ? ` · ${formatBytes(run.sizeBytes)}` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge
                    status={run.status}
                    variant={run.status === 'COMPLETED' ? 'success' : 'muted'}
                  />
                  <AuroraButton
                    size="sm"
                    variant="primary"
                    disabled={!run.downloadable}
                    loading={downloadingRunId === run.id}
                    onClick={() => void downloadRun(run)}
                  >
                    Download
                  </AuroraButton>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete scheduled report"
        description={
          deleteTarget
            ? `"${deleteTarget.name}" will be removed. This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
      />
    </PermissionGate>
  );
}
