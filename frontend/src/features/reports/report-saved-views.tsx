'use client';
import { useEffect, useRef, useState } from 'react';
import { Btn, Card } from '@/components/ui';
import { FormInput, FormSection } from '@/components/aurora';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { backendDelete, backendPatch, backendPost } from '@/lib/api-client';
import type { WorkspaceDraft } from '@/components/workspace/workspace-drafts';
import { useAccountingEditor, useAccountingRefresh } from './accounting-drafts';
import {
  AccountingAcknowledgement,
  AccountingReviewShell,
  useAccountingReview,
} from './accounting-review-form';
import type {
  CatalogEntry,
  ReportCatalog,
  ReportFilters,
  ReportPresentation,
  SavedReportView,
  SavedViewTarget,
} from './report-viewer-types';
import { reportRequest } from './report-viewer-utils';

export function ReportSavedViews({
  entry,
  filters,
  presentation,
  onApply,
  mayApplyDefault,
}: {
  entry: CatalogEntry;
  filters: ReportFilters;
  presentation: ReportPresentation;
  onApply: (view: SavedReportView) => void;
  mayApplyDefault: boolean;
}) {
  const { hasPermission } = useAuth(),
    open = useAccountingEditor();
  const canView = hasPermission('saved_report_views.view'),
    canManage = hasPermission('saved_report_views.manage');
  const views = useWorkspaceChoices<SavedReportView>(
    '/bi/saved-report-views',
    { reportDefinitionId: entry.id, companyId: filters.companyId || undefined },
    canView,
  );
  useAccountingRefresh(views.retry);
  const applied = useRef(false);
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(views.rows.length / 10)),
    current = Math.min(page, pages);
  useEffect(() => {
    if (applied.current || views.loading || views.error || !canView) return;
    applied.current = true;
    const value = views.rows.find((view) => view.isDefault);
    if (mayApplyDefault && value) onApply(value);
  }, [views.loading, views.error, views.rows, mayApplyDefault, onApply, canView]);
  if (!canView && !canManage) return null;
  return (
    <Card className="report-viewer-section report-no-print">
      <header>
        <h3>Saved views</h3>
        <div className="report-actions">
          {canManage && (
            <Btn
              variant="secondary"
              onClick={() =>
                open({
                  kind: 'saved-view-create',
                  reportId: entry.id,
                  permission: entry.permission,
                  name: entry.name,
                  filters,
                  chartConfig: presentation,
                })
              }
            >
              Save this view
            </Btn>
          )}
          {canView && (
            <Btn variant="ghost" onClick={views.retry}>
              Refresh saved views
            </Btn>
          )}
        </div>
      </header>
      {views.loading ? (
        <p role="status">Loading saved views…</p>
      ) : views.error ? (
        <p role="alert" className="workspace-notice">
          {views.error}
        </p>
      ) : (
        canView && (
          <>
            <ul className="report-saved-views">
              {views.rows.slice((current - 1) * 10, current * 10).map((view) => (
                <li key={view.id}>
                  <div>
                    <strong>{view.name}</strong>
                    <p>
                      {view.isDefault ? 'Default view' : 'Saved filters'}
                      {view.isShared ? ' · Shared' : ''}
                    </p>
                  </div>
                  <div className="report-actions">
                    <Btn
                      variant="secondary"
                      aria-label={`Apply ${view.name}`}
                      onClick={() => onApply(view)}
                    >
                      Apply
                    </Btn>
                    {canManage && (
                      <>
                        {!view.isDefault && (
                          <Btn
                            variant="ghost"
                            aria-label={`Make ${view.name} default`}
                            onClick={() =>
                              open({ kind: 'saved-view-action', id: view.id, action: 'default' })
                            }
                          >
                            Set default
                          </Btn>
                        )}
                        <Btn
                          variant="ghost"
                          aria-label={`Delete ${view.name}`}
                          onClick={() =>
                            open({ kind: 'saved-view-action', id: view.id, action: 'delete' })
                          }
                        >
                          Delete
                        </Btn>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {!views.rows.length && <p>No saved views were returned for this report and company.</p>}
            {pages > 1 && (
              <nav className="report-pagination" aria-label="Saved view pages">
                <Btn
                  variant="secondary"
                  disabled={current === 1}
                  onClick={() => setPage(current - 1)}
                >
                  Previous views
                </Btn>
                <span>
                  Page {current} of {pages}
                </span>
                <Btn
                  variant="secondary"
                  disabled={current === pages}
                  onClick={() => setPage(current + 1)}
                >
                  Next views
                </Btn>
              </nav>
            )}
          </>
        )
      )}
    </Card>
  );
}
type Props = {
  target: SavedViewTarget;
  source?: WorkspaceDraft;
  close: () => void;
  done: (message: string) => void;
};
export function SavedViewEditor(props: Props) {
  return props.target.kind === 'saved-view-create' ? (
    <SavedViewCreate {...props} target={props.target} />
  ) : (
    <SavedViewAction {...props} target={props.target} />
  );
}
function SavedViewCreate({
  target,
  source,
  close,
  done,
}: Props & { target: Extract<SavedViewTarget, { kind: 'saved-view-create' }> }) {
  const { hasPermission, user } = useAuth();
  const form = useAccountingReview<
    ReportCatalog,
    { name: string; filters: ReportFilters; chartConfig: ReportPresentation }
  >({
    path: '/reports/catalog',
    readAllowed: true,
    writeAllowed: hasPermission('saved_report_views.manage') && hasPermission(target.permission),
    initial: { name: target.name, filters: target.filters, chartConfig: target.chartConfig },
    title: 'Save report view',
    summary: () => target.name,
    describe: (values) => values.name || target.name,
    context: {
      kind: target.kind,
      reportId: target.reportId,
      permission: target.permission,
      reportName: target.name,
    },
    version: (data) =>
      JSON.stringify(data.entries.find((row) => row.id === target.reportId) || null),
    source,
    close,
    done,
  });
  const values = form.draft.form;
  const companies = useWorkspaceChoices<{ id: string; name: string }>(
    '/companies',
    {},
    hasPermission('companies.view'),
  );
  const divisions = useWorkspaceChoices<{ id: string; name: string; companyId: string }>(
    '/divisions',
    { companyId: values.filters.companyId },
    !!values.filters.companyId && hasPermission('divisions.view'),
  );
  const companyName =
    companies.rows.find((row) => row.id === values.filters.companyId)?.name ||
    (values.filters.companyId === user?.companyId
      ? 'Assigned company'
      : values.filters.companyId
        ? 'Selected company'
        : 'Permitted group scope');
  return (
    <AccountingReviewShell
      form={form}
      title="Save report view"
      subtitle="Keep a reusable set of filters and chart choices"
      action="Save view"
      onSubmit={() =>
        void form.submit(
          (data) => {
            const entry = data.entries.find((row) => row.id === target.reportId);
            if (!entry || !hasPermission(entry.permission))
              throw new Error('This report is no longer available to your role.');
            if (!values.name.trim()) throw new Error('Enter a view name.');
            reportRequest(entry, values.filters);
          },
          async () => {
            await backendPost('/bi/saved-report-views', {
              reportDefinitionId: target.reportId,
              companyId: values.filters.companyId || undefined,
              name: values.name.trim(),
              filters: values.filters,
              chartConfig: values.chartConfig,
              isDefault: false,
            });
            return 'Report view saved. You can make it the default from Saved views.';
          },
        )
      }
    >
      <FormSection title="View details">
        <FormInput
          label="View name"
          value={values.name}
          disabled={form.busy}
          onChange={(event) =>
            form.draft.setForm((value) => ({ ...value, name: event.target.value }))
          }
        />
        <p>
          {target.name} · {companyName}
          {values.filters.divisionId
            ? ` · ${divisions.rows.find((row) => row.id === values.filters.divisionId)?.name || 'Selected division'}`
            : ''}
        </p>
        <p>
          {values.filters.dateFrom || 'Any start date'} – {values.filters.dateTo || 'Any end date'}
          {values.filters.asOf ? ` · As of ${values.filters.asOf}` : ''}
        </p>
        <p>
          Presentation: {values.chartConfig.viewMode}. Applying this view restores these choices; it
          does not run or send a report.
        </p>
      </FormSection>
      <AccountingAcknowledgement
        label="I reviewed the report and filters to save."
        checked={form.ack}
        disabled={form.busy}
        onChange={form.setAck}
      />
      {!form.writeAllowed && (
        <p role="alert">Your role cannot save this view. Your draft can be kept for later.</p>
      )}
    </AccountingReviewShell>
  );
}
function SavedViewAction({
  target,
  source,
  close,
  done,
}: Props & { target: Extract<SavedViewTarget, { kind: 'saved-view-action' }> }) {
  const { hasPermission } = useAuth();
  const title = target.action === 'delete' ? 'Delete saved view' : 'Set default report view';
  const form = useAccountingReview<SavedReportView, Record<string, never>>({
    path: `/bi/saved-report-views/${encodeURIComponent(target.id)}`,
    readAllowed: hasPermission('saved_report_views.view'),
    writeAllowed: hasPermission('saved_report_views.manage'),
    initial: {},
    title,
    summary: (row) => row?.name || '',
    context: { kind: target.kind, recordId: target.id, action: target.action },
    version: (row) => JSON.stringify(row),
    source,
    close,
    done,
  });
  return (
    <AccountingReviewShell
      form={form}
      title={title}
      action={target.action === 'delete' ? 'Delete view' : 'Set default'}
      disabled={target.action === 'default' && form.data?.isDefault}
      onSubmit={() =>
        void form.submit(
          (row) => {
            if (row.id !== target.id || (target.action === 'default' && row.isDefault))
              throw new Error('This view is already the default or is no longer available.');
          },
          async () => {
            if (target.action === 'delete')
              await backendDelete(`/bi/saved-report-views/${encodeURIComponent(target.id)}`);
            else
              await backendPatch(
                `/bi/saved-report-views/${encodeURIComponent(target.id)}/set-default`,
              );
            return target.action === 'delete'
              ? 'Saved view deleted.'
              : 'Default report view updated.';
          },
        )
      }
    >
      <FormSection title="Current saved view">
        <p>{form.data?.name}</p>
        <p>
          {target.action === 'delete'
            ? 'Remove these saved filter and presentation choices. The report and its business records remain available.'
            : 'Use these choices by default when this report opens without supplied or retained filters.'}
        </p>
        {form.data?.isDefault && <p>This is currently the default view.</p>}
      </FormSection>
      <AccountingAcknowledgement
        label="I reviewed this saved view and the requested change."
        checked={form.ack}
        disabled={form.busy}
        onChange={form.setAck}
      />
      {!form.writeAllowed && <p role="alert">Your role cannot change this saved view.</p>}
    </AccountingReviewShell>
  );
}
