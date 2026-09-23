'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, PageHeader } from '@/components/ui';
import {
  useUnsavedWork,
  useUnsavedWorkScopeId,
} from '@/components/workspace/unsaved-work-provider';
import { WorkspaceDraftShelf, type WorkspaceDraft } from '@/components/workspace/workspace-drafts';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { ScheduleEditor } from '@/features/reports/schedule-editor';
import {
  PAGE_LIMIT,
  FREQUENCY_OPTIONS,
  formatDate,
  formatBytes,
  recipientEmails,
  errorMessage,
  type ScheduledReport,
  type ScheduledRun,
} from '@/features/reports/schedule-types';
import {
  ResponsiveDataTable,
  type ResponsiveColumn,
  StatusBadge,
  AuroraButton,
} from '@/components/aurora';
import { showToast } from '@/components/aurora/feedback';
import { PermissionGate } from '@/components/ui/permission-gate';
import { useAuth } from '@/hooks/use-auth';
import {
  backendPage,
  backendPost,
  backendPatch,
  backendDelete,
  backendGet,
} from '@/lib/api-client';
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

export default function ScheduledReportsPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const canView = hasPermission('scheduled_reports.view');
  const canManage = hasPermission('scheduled_reports.manage');
  const canRun = hasPermission('scheduled_reports.run');

  const [rows, setRows] = useState<ScheduledReport[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useWorkspaceState('reports.schedules.page', 1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editor, setEditor] = useState<{
    key: string;
    record?: ScheduledReport;
    source?: WorkspaceDraft;
  } | null>(null);
  const { request } = useUnsavedWork();
  const workScope = useUnsavedWorkScopeId();
  const resumeController = useRef<AbortController | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const runsController = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      resumeController.current?.abort();
      loadController.current?.abort();
      runsController.current?.abort();
    },
    [],
  );
  const openCreate = () => {
    resumeController.current?.abort();
    if (canManage)
      request(() => setEditor({ key: crypto.randomUUID() }), undefined, 'close', {
        scope: workScope,
      });
  };
  const openEdit = (record: ScheduledReport) => {
    resumeController.current?.abort();
    if (canManage)
      request(() => setEditor({ key: crypto.randomUUID(), record }), undefined, 'close', {
        scope: workScope,
      });
  };
  const resumeDraft = async (source: WorkspaceDraft) => {
    if (!canManage || source.context.kind !== 'schedule')
      throw new Error('Your role cannot open this report draft.');
    resumeController.current?.abort();
    const controller = new AbortController();
    resumeController.current = controller;
    const record = source.context.recordId
      ? await backendGet<ScheduledReport>(
          `/bi/scheduled-reports/${encodeURIComponent(source.context.recordId)}`,
          { signal: controller.signal },
        )
      : undefined;
    if (!controller.signal.aborted)
      request(() => setEditor({ key: source.id, source, record }), undefined, 'close', {
        scope: workScope,
      });
  };

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
    if (authLoading || !canView) return;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setError(null);
    setRows([]);
    try {
      const result = await backendPage<ScheduledReport>('/bi/scheduled-reports', {
        query: { page, limit: PAGE_LIMIT },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const lastPage = Math.max(1, Math.ceil(result.total / PAGE_LIMIT));
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }
      setRows(result.data);
      setTotal(result.total);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(errorMessage(err, 'Failed to load scheduled reports'));
      setRows([]);
      setTotal(0);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [page, authLoading, canView, setPage]);

  useEffect(() => {
    void load();
    return () => loadController.current?.abort();
  }, [load]);

  const loadRuns = useCallback(async (scheduleId: string) => {
    runsController.current?.abort();
    const controller = new AbortController();
    runsController.current = controller;
    setRuns([]);
    setRunsLoading(true);
    setRunsError(null);
    try {
      const result = await backendPage<ScheduledRun>(`/bi/scheduled-reports/${scheduleId}/runs`, {
        query: { page: 1, limit: 20 },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setRuns(result.data);
    } catch (err) {
      if (controller.signal.aborted) return;
      setRunsError(errorMessage(err, 'Failed to load run history'));
      setRuns([]);
    } finally {
      if (!controller.signal.aborted) setRunsLoading(false);
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
      showToast(
        'success',
        schedule.isActive ? 'Schedule deactivated' : 'Schedule activated',
        schedule.name,
      );
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

  const columns: ResponsiveColumn<ScheduledReport>[] = [
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
          <span
            className="text-xs"
            style={{ color: 'var(--aurora-text-secondary)' }}
            title={emails.join(', ')}
          >
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
              <AuroraButton
                size="sm"
                variant="ghost"
                loading={busy}
                onClick={() => toggleActive(row)}
              >
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
  ];

  if (authLoading || !canView) {
    return (
      <div className="p-6">
        <PageHeader
          title="Scheduled Reports"
          subtitle={authLoading ? 'Loading' : 'Access Restricted'}
          breadcrumbs={[{ label: 'Reports', href: '/reports' }, { label: 'Scheduled' }]}
        />
      </div>
    );
  }

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
      <div className="business-workspace space-y-4">
        <PageHeader
          title="Scheduled Reports"
          subtitle="Configure report snapshots with a frequency, export format and recipient list."
          breadcrumbs={[{ label: 'Reports', href: '/reports' }, { label: 'Scheduled' }]}
          actions={
            canManage ? (
              <AuroraButton variant="primary" onClick={openCreate}>
                New schedule
              </AuroraButton>
            ) : undefined
          }
        />

        <WorkspaceDraftShelf
          appId="reports"
          filter={(draft) => draft.context.kind === 'schedule'}
          onResume={resumeDraft}
          activeDraftId={editor?.source?.id}
        />
        <p className="workspace-notice" role="note">
          Automatic delivery emails recipients when enabled for your organisation. Run now creates a
          snapshot without sending email; open Runs to download it.
        </p>

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

      {editor && (
        <ScheduleEditor
          key={editor.key}
          record={editor.record}
          source={editor.source}
          onClose={() => setEditor(null)}
          onSaved={() => {
            const created = !editor.record;
            setEditor(null);
            if (created && page !== 1) setPage(1);
            else void load();
          }}
        />
      )}

      <Modal
        open={!!runsTarget}
        onClose={() => {
          runsController.current?.abort();
          setRunsTarget(null);
        }}
        title={runsTarget ? `Runs — ${runsTarget.name}` : 'Runs'}
        subtitle="Generation history for this schedule. Download the stored export file of any completed run."
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
                <AuroraButton
                  size="sm"
                  variant="ghost"
                  onClick={() => void loadRuns(runsTarget.id)}
                >
                  Retry
                </AuroraButton>
              )}
            </div>
          )}
          {!runsLoading && !runsError && runs.length === 0 && (
            <div className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              No runs recorded yet. Use &ldquo;Run now&rdquo; or wait for the automated dispatcher
              to fire.
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

      <Modal
        open={!!deleteTarget}
        onClose={() => !deleting && setDeleteTarget(null)}
        title="Delete scheduled report"
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <AuroraButton variant="ghost" disabled={deleting} onClick={() => setDeleteTarget(null)}>
              Cancel
            </AuroraButton>
            <AuroraButton variant="danger" loading={deleting} onClick={confirmDelete}>
              Delete
            </AuroraButton>
          </div>
        }
      >
        <p>
          {deleteTarget ? `"${deleteTarget.name}" will be removed. This cannot be undone.` : ''}
        </p>
      </Modal>
    </PermissionGate>
  );
}
