'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui';
import {
  ResponsiveDataTable,
  type ResponsiveColumn,
  FormShell,
  FormSection,
  FormInput,
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

// ── Backend contract: bi/saved-report-views (backend/src/modules/saved-report-views) ──
// GET    /bi/saved-report-views            list (paginated) — permission saved_report_views.view
// POST   /bi/saved-report-views            create           — permission saved_report_views.manage
// PATCH  /bi/saved-report-views/:id        rename/update    — permission saved_report_views.manage
// PATCH  /bi/saved-report-views/:id/share  mark shared      — permission saved_report_views.share
// PATCH  /bi/saved-report-views/:id/set-default             — permission saved_report_views.manage
// DELETE /bi/saved-report-views/:id        soft delete      — permission saved_report_views.manage

interface SavedReportView extends Record<string, unknown> {
  id: string;
  reportDefinitionId: string;
  userId: string;
  companyId: string | null;
  name: string;
  filters: Record<string, unknown> | null;
  columns: Record<string, unknown> | null;
  sortConfig: Record<string, unknown> | null;
  chartConfig: Record<string, unknown> | null;
  isDefault: boolean;
  isShared: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CreateForm {
  name: string;
  reportDefinitionId: string;
  companyId: string;
  isShared: boolean;
  isDefault: boolean;
}

const EMPTY_FORM: CreateForm = {
  name: '',
  reportDefinitionId: '',
  companyId: '',
  isShared: false,
  isDefault: false,
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

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

export default function SavedViewsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('saved_report_views.manage');
  const canShare = hasPermission('saved_report_views.share');

  const [rows, setRows] = useState<SavedReportView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create / rename modal state.
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SavedReportView | null>(null);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof CreateForm, string>>>({});
  const [saving, setSaving] = useState(false);

  // Row-level pending action (share / set-default) keyed by id.
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  // Delete confirmation state.
  const [deleteTarget, setDeleteTarget] = useState<SavedReportView | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await backendPage<SavedReportView>('/bi/saved-report-views', {
        query: { page, limit: PAGE_LIMIT },
      });
      setRows(result.data);
      setTotal(result.total);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load saved report views'));
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

  const openRename = (view: SavedReportView) => {
    setEditing(view);
    setForm({
      name: view.name,
      reportDefinitionId: view.reportDefinitionId,
      companyId: view.companyId ?? '',
      isShared: view.isShared,
      isDefault: view.isDefault,
    });
    setFormErrors({});
    setFormOpen(true);
  };

  const validate = (): boolean => {
    const errs: Partial<Record<keyof CreateForm, string>> = {};
    if (!form.name.trim()) errs.name = 'Name is required';
    if (!editing && !form.reportDefinitionId.trim()) {
      errs.reportDefinitionId = 'Report definition ID is required';
    }
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      if (editing) {
        // Update path: only name / isShared / isDefault are editable here.
        // companyId cannot change (backend rejects it); reportDefinitionId is fixed.
        await backendPatch(`/bi/saved-report-views/${editing.id}`, {
          name: form.name.trim(),
          isShared: form.isShared,
          isDefault: form.isDefault,
        });
        showToast('success', 'Saved view updated', form.name.trim());
      } else {
        await backendPost('/bi/saved-report-views', {
          name: form.name.trim(),
          reportDefinitionId: form.reportDefinitionId.trim(),
          ...(form.companyId.trim() ? { companyId: form.companyId.trim() } : {}),
          isShared: form.isShared,
          isDefault: form.isDefault,
        });
        showToast('success', 'Saved view created', form.name.trim());
      }
      setFormOpen(false);
      // A freshly-created view lands on page 1 (orderBy createdAt desc).
      if (!editing && page !== 1) setPage(1);
      else await load();
    } catch (err) {
      showToast('error', editing ? 'Update failed' : 'Create failed', errorMessage(err, 'Please try again'));
    } finally {
      setSaving(false);
    }
  };

  const toggleShare = async (view: SavedReportView) => {
    if (view.isShared) {
      // The backend only exposes a one-way "share" toggle. Un-sharing flips the
      // isShared flag back via the generic update endpoint.
      setPendingAction(view.id);
      try {
        await backendPatch(`/bi/saved-report-views/${view.id}`, { isShared: false });
        showToast('success', 'View unshared', view.name);
        await load();
      } catch (err) {
        showToast('error', 'Could not unshare', errorMessage(err, 'Please try again'));
      } finally {
        setPendingAction(null);
      }
      return;
    }
    setPendingAction(view.id);
    try {
      await backendPatch(`/bi/saved-report-views/${view.id}/share`, {});
      showToast('success', 'View shared', `${view.name} is now visible to your company`);
      await load();
    } catch (err) {
      showToast('error', 'Could not share', errorMessage(err, 'Please try again'));
    } finally {
      setPendingAction(null);
    }
  };

  const setDefault = async (view: SavedReportView) => {
    if (view.isDefault) return;
    setPendingAction(view.id);
    try {
      await backendPatch(`/bi/saved-report-views/${view.id}/set-default`, {});
      showToast('success', 'Default view set', view.name);
      await load();
    } catch (err) {
      showToast('error', 'Could not set default', errorMessage(err, 'Please try again'));
    } finally {
      setPendingAction(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await backendDelete(`/bi/saved-report-views/${deleteTarget.id}`);
      showToast('success', 'Saved view deleted', deleteTarget.name);
      setDeleteTarget(null);
      // If we just deleted the last row on a page beyond the first, step back.
      if (rows.length === 1 && page > 1) setPage((p) => p - 1);
      else await load();
    } catch (err) {
      showToast('error', 'Delete failed', errorMessage(err, 'Please try again'));
    } finally {
      setDeleting(false);
    }
  };

  const columns = useMemo<ResponsiveColumn<SavedReportView>[]>(
    () => [
      {
        key: 'name',
        header: 'View name',
        priority: 1,
        accessor: (row) => (
          <div className="flex flex-col">
            <span className="font-medium" style={{ color: 'var(--aurora-text)' }}>
              {row.name}
            </span>
            <span className="text-[11px] font-mono" style={{ color: 'var(--aurora-text-muted)' }}>
              {row.reportDefinitionId}
            </span>
          </div>
        ),
      },
      {
        key: 'visibility',
        header: 'Visibility',
        priority: 2,
        accessor: (row) =>
          row.isShared ? (
            <StatusBadge status="Shared" variant="info" />
          ) : (
            <StatusBadge status="Private" variant="muted" />
          ),
      },
      {
        key: 'isDefault',
        header: 'Default',
        priority: 2,
        accessor: (row) =>
          row.isDefault ? <StatusBadge status="Default" variant="success" /> : <span style={{ color: 'var(--aurora-text-muted)' }}>—</span>,
      },
      {
        key: 'companyId',
        header: 'Scope',
        priority: 3,
        accessor: (row) => (
          <span className="text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
            {row.companyId ? 'Company' : 'Group'}
          </span>
        ),
      },
      {
        key: 'createdAt',
        header: 'Created',
        priority: 3,
        accessor: (row) => (
          <span className="text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
            {formatDate(row.createdAt)}
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
              {canManage && (
                <AuroraButton size="sm" variant="ghost" onClick={() => openRename(row)}>
                  Rename
                </AuroraButton>
              )}
              {canShare && (
                <AuroraButton size="sm" variant="ghost" loading={busy} onClick={() => toggleShare(row)}>
                  {row.isShared ? 'Unshare' : 'Share'}
                </AuroraButton>
              )}
              {canManage && !row.isDefault && (
                <AuroraButton size="sm" variant="ghost" loading={busy} onClick={() => setDefault(row)}>
                  Set default
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
    [canManage, canShare, pendingAction],
  );

  return (
    <PermissionGate
      permission="saved_report_views.view"
      fallback={
        <div className="p-6">
          <div
            className="rounded-lg border p-6 text-sm"
            style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-muted)' }}
          >
            You do not have permission to view saved report views.
          </div>
        </div>
      }
    >
      <div className="p-6 space-y-4">
        <PageHeader
          title="Saved Report Views"
          subtitle="Reusable filter, column and chart presets for any report definition. Share them with your company or pin a personal default."
          breadcrumbs={[
            { label: 'Reports', href: '/reports' },
            { label: 'Saved Views' },
          ]}
          actions={
            canManage ? (
              <AuroraButton variant="primary" onClick={openCreate}>
                New saved view
              </AuroraButton>
            ) : undefined
          }
        />

        <ResponsiveDataTable<SavedReportView>
          columns={columns}
          data={rows}
          keyField="id"
          loading={loading}
          error={error}
          onRetry={load}
          errorTitle="Could not load saved views"
          emptyTitle="No saved views yet"
          emptyDescription={
            canManage
              ? 'Create a saved view to reuse filters and columns for a report.'
              : 'No saved report views are available to you yet.'
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
        title={editing ? 'Rename saved view' : 'New saved view'}
        description={
          editing
            ? 'Update the name, sharing and default flags for this view.'
            : 'Create a reusable view for an existing report definition.'
        }
        size="md"
      >
        <div className="px-5 pb-5 pt-4">
          <FormShell onSubmit={submitForm}>
            <FormSection columns={1}>
              <FormInput
                label="View name"
                required
                value={form.name}
                error={formErrors.name}
                placeholder="e.g. Q4 Finance summary"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              {!editing && (
                <>
                  <FormInput
                    label="Report definition ID"
                    required
                    value={form.reportDefinitionId}
                    error={formErrors.reportDefinitionId}
                    placeholder="UUID of the report definition"
                    help="Paste the report definition UUID this view belongs to."
                    onChange={(e) => setForm((f) => ({ ...f, reportDefinitionId: e.target.value }))}
                  />
                  <FormInput
                    label="Company ID (optional)"
                    value={form.companyId}
                    placeholder="Leave blank for group-wide scope"
                    help="Optional. Defaults to your active company; leave blank for a group-scoped view."
                    onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
                  />
                </>
              )}
              {editing && (
                <div
                  className="rounded-lg border px-3 py-2 text-xs"
                  style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-muted)' }}
                >
                  Report definition: <span className="font-mono">{editing.reportDefinitionId}</span>
                  <br />
                  Report definition and company scope cannot be changed after creation.
                </div>
              )}
            </FormSection>

            <FormSection columns={1} className="space-y-3">
              <FormSwitch
                label="Shared with company"
                help="Shared views are visible to everyone in the company scope."
                checked={form.isShared}
                onChange={(checked) => setForm((f) => ({ ...f, isShared: checked }))}
              />
              <FormSwitch
                label="Set as my default"
                help="Your default view for this report definition (per company scope)."
                checked={form.isDefault}
                onChange={(checked) => setForm((f) => ({ ...f, isDefault: checked }))}
              />
            </FormSection>

            <FormActions
              primaryLabel={editing ? 'Save changes' : 'Create view'}
              onSecondary={() => setFormOpen(false)}
              loading={saving}
            />
          </FormShell>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete saved view"
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
