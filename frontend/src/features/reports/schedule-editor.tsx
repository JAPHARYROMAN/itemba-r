'use client';

import { useRef, useState } from 'react';
import { Btn, Modal, showToast } from '@/components/ui';
import {
  FormShell,
  FormSection,
  FormInput,
  FormSelect,
  FormTextarea,
  FormActions,
} from '@/components/aurora';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { CatalogueChoiceError } from '@/components/workspace/catalogue-editors';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useAuth } from '@/hooks/use-auth';
import { backendPatch, backendPost } from '@/lib/api-client';
import {
  EMPTY_FORM,
  FREQUENCY_OPTIONS,
  FORMAT_OPTIONS,
  recipientEmails,
  parseRecipients,
  errorMessage,
  type ScheduleForm,
  type ScheduledReport,
  type ScheduleOptions,
  type SavedScheduleView,
  type ScheduleFrequency,
  type ReportExportFormat,
} from './schedule-types';

export function ScheduleEditor({
  record,
  source,
  onClose,
  onSaved,
}: {
  record?: ScheduledReport;
  source?: WorkspaceDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { hasPermission, user } = useAuth();
  const allowed = hasPermission('scheduled_reports.manage');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Partial<Record<keyof ScheduleForm, string>>>({});
  const draft = useWorkspaceDraftForm<ScheduleForm>(
    () =>
      record
        ? {
            scheduleCode: record.scheduleCode,
            name: record.name,
            description: record.description || '',
            reportDefinitionId: record.reportDefinitionId,
            savedReportViewId: record.savedReportViewId || '',
            companyId: record.companyId || '',
            frequency: record.frequency,
            exportFormat: record.exportFormat,
            recipients: recipientEmails(record.recipients).join(', '),
          }
        : { ...EMPTY_FORM, companyId: user?.companyId || '' },
    {
      appId: 'reports',
      title: record ? 'Edit report schedule' : 'New report schedule',
      describe: (values) => values.name || values.scheduleCode,
      context: { kind: 'schedule', recordId: record?.id || '', version: record?.updatedAt || '' },
      draftId: source?.id,
      needsReview: !!record && !!source && source.context.version !== record.updatedAt,
      reviewKey: record?.updatedAt,
      busy,
      onClose,
    },
  );
  const { form, setForm, guard } = draft;
  const companyId = record ? record.companyId || '' : form.companyId;
  const reportDefinitionId = record ? record.reportDefinitionId : form.reportDefinitionId;
  const options = useWorkspaceResource<ScheduleOptions>(
    '/bi/scheduled-reports/options',
    {},
    allowed,
  );
  const views = useWorkspaceChoices<SavedScheduleView>(
    '/bi/saved-report-views',
    { companyId: companyId || undefined, reportDefinitionId },
    allowed && !!reportDefinitionId && !!options.data?.canUseSavedViews,
  );
  const eligibleViews = views.rows.filter(
    (view) =>
      (view.companyId || '') === companyId && view.reportDefinitionId === reportDefinitionId,
  );
  const close = () => {
    if (!pending.current) guard.requestClose(onClose);
  };
  const report = options.data?.reports.find((row) => row.id === reportDefinitionId);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || !allowed) return;
    pending.current = true;
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = 'Enter a schedule name.';
    if (!record && !form.scheduleCode.trim()) next.scheduleCode = 'Enter a unique short code.';
    const emails = recipientEmails(parseRecipients(form.recipients));
    if (!emails.length || emails.some((email) => !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)))
      next.recipients = 'Enter valid email addresses, separated by commas or new lines.';
    if (!reportDefinitionId || !report || (!record && !report.snapshotSupported))
      next.reportDefinitionId = 'Choose a report that supports scheduled snapshots.';
    if (
      companyId
        ? !options.data?.companies.some((row) => row.id === companyId)
        : !options.data?.canUseGroupScope
    )
      next.companyId = 'Choose an available company.';
    setErrors(next);
    if (Object.keys(next).length) {
      pending.current = false;
      return;
    }
    setError('');
    try {
      draft.validateReview();
      await draft.saveNow();
      if (options.loading || options.error || !options.data)
        throw new Error('Load the available schedule choices before saving.');
      const viewChanged = form.savedReportViewId !== (record?.savedReportViewId || '');
      if (
        form.savedReportViewId &&
        (viewChanged || options.data.canUseSavedViews) &&
        (views.loading ||
          views.error ||
          !eligibleViews.some((row) => row.id === form.savedReportViewId))
      )
        throw new Error('Choose an available saved view for this report and company.');
            setBusy(true);
      const values = {
        name: form.name.trim(),
        description: form.description.trim(),
        frequency: form.frequency,
        exportFormat: form.exportFormat,
        recipients: parseRecipients(form.recipients),
      };
      if (record) {
        await backendPatch(`/bi/scheduled-reports/${encodeURIComponent(record.id)}`, {
          ...values,
          ...(viewChanged ? { savedReportViewId: form.savedReportViewId || null } : {}),
        });
      } else {
        await backendPost('/bi/scheduled-reports', {
          ...values,
          scheduleCode: form.scheduleCode.trim(),
          reportDefinitionId,
          ...(companyId ? { companyId } : {}),
          ...(form.savedReportViewId ? { savedReportViewId: form.savedReportViewId } : {}),
        });
      }
      draft.markSaved();
      showToast('success', record ? 'Schedule updated' : 'Schedule created', form.name.trim());
      onSaved();
    } catch (cause) {
      setError(
        errorMessage(cause, 'The schedule could not be saved. Your entered values are still here.'),
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const companyOptions =
    options.data?.companies.map((row) => ({ value: row.id, label: row.name })) || [];
  if (companyId && !companyOptions.some((row) => row.value === companyId))
    companyOptions.push({ value: companyId, label: 'Current company — checking access…' });
  const reportOptions =
    options.data?.reports.map((row) => ({
      value: row.id,
      label: row.snapshotSupported ? row.name : `${row.name} · manual export only`,
      disabled: !record && !row.snapshotSupported,
    })) || [];
  if (reportDefinitionId && !reportOptions.some((row) => row.value === reportDefinitionId))
    reportOptions.push({
      value: reportDefinitionId,
      label: 'Current report — unavailable in the choices',
      disabled: true,
    });
  const viewOptions = [
    { value: '', label: 'No linked saved view' },
    ...eligibleViews.map((row) => ({ value: row.id, label: row.name })),
  ];
  if (form.savedReportViewId && !viewOptions.some((row) => row.value === form.savedReportViewId))
    viewOptions.push({
      value: form.savedReportViewId,
      label: 'Previously selected view — check availability',
    });
  return (
    <Modal
      open
      title={record ? 'Edit schedule' : 'New schedule'}
      subtitle="Choose the report, organisation and delivery details."
      onClose={close}
      size="lg"
      {...guard.capture}
    >
      <FormShell onSubmit={submit}>
        <DraftFormNotice draft={draft} />
        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
        {!allowed && <p role="alert">Your role cannot manage report schedules.</p>}
        {options.error && (
          <div role="alert" className="workspace-notice">
            Schedule choices are unavailable. {options.error}{' '}
            <Btn type="button" variant="ghost" onClick={options.reload}>
              Retry schedule choices
            </Btn>
          </div>
        )}
        {options.loading && <p role="status">Loading reports and companies…</p>}
        {!record && options.data && !options.data.reports.some((row) => row.snapshotSupported) && (
          <p className="workspace-notice">
            Scheduled snapshots are not available for your permitted reports yet. You can still use
            manual exports in Reports.
          </p>
        )}
        <fieldset
          className="min-w-0 space-y-6 border-0 p-0"
          disabled={busy || !allowed || !!draft.availabilityError}
        >
          <FormSection title="Schedule" columns={2}>
            <FormInput
              label="Name"
              required
              value={form.name}
              error={errors.name}
              placeholder="e.g. Weekly supplier balances"
              onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
            />
            <FormInput
              label="Schedule code"
              required
              disabled={!!record}
              value={record?.scheduleCode || form.scheduleCode}
              error={errors.scheduleCode}
              placeholder="e.g. SUPPLIERS-WEEKLY"
              onChange={(event) =>
                setForm((value) => ({ ...value, scheduleCode: event.target.value }))
              }
            />
            <div className="sm:col-span-2">
              <FormTextarea
                label="Description"
                value={form.description}
                onChange={(event) =>
                  setForm((value) => ({ ...value, description: event.target.value }))
                }
              />
            </div>
          </FormSection>
          <FormSection title="Report and organisation" columns={2}>
            <FormSelect
              label="Company"
              value={companyId}
              options={[
                {
                  value: '',
                  label: options.data?.canUseGroupScope ? 'Entire group' : 'Select a company',
                },
                ...companyOptions,
              ]}
              disabled={!!record || options.loading || !!options.error}
              error={errors.companyId}
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  companyId: event.target.value,
                  savedReportViewId: '',
                }))
              }
            />
            <FormSelect
              label="Report"
              value={reportDefinitionId}
              options={[{ value: '', label: 'Select a report' }, ...reportOptions]}
              required
              disabled={!!record || options.loading || !!options.error}
              error={errors.reportDefinitionId}
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  reportDefinitionId: event.target.value,
                  savedReportViewId: '',
                }))
              }
            />
            <div className="sm:col-span-2">
              <FormSelect
                label="Linked saved view"
                value={form.savedReportViewId}
                options={viewOptions}
                disabled={
                  !reportDefinitionId ||
                  !options.data?.canUseSavedViews ||
                  views.loading ||
                  !!views.error
                }
                help="Links a saved view for reference. Scheduled snapshots currently use company scope and include up to 500 records."
                onChange={(event) =>
                  setForm((value) => ({ ...value, savedReportViewId: event.target.value }))
                }
              />
            </div>
            <CatalogueChoiceError label="Saved view" source={views} />
          </FormSection>
          {report && !report.snapshotSupported && (
            <p className="workspace-notice">
              This report currently supports manual export only. Its scheduled snapshots contain a
              notice rather than report data.
            </p>
          )}
          <FormSection title="Delivery" columns={2}>
            <FormSelect
              label="Frequency"
              value={form.frequency}
              options={FREQUENCY_OPTIONS.filter(
                (option) => option.value !== 'CUSTOM' || record?.frequency === 'CUSTOM',
              )}
              help={
                form.frequency === 'CUSTOM'
                  ? 'Existing custom schedules currently repeat monthly.'
                  : 'The next run is calculated from when the schedule is created or its frequency changes.'
              }
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  frequency: event.target.value as ScheduleFrequency,
                }))
              }
            />
            <FormSelect
              label="Export format"
              value={form.exportFormat}
              options={FORMAT_OPTIONS.filter(
                (option) =>
                  option.value !== 'DASHBOARD_ONLY' || record?.exportFormat === 'DASHBOARD_ONLY',
              )}
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  exportFormat: event.target.value as ReportExportFormat,
                }))
              }
            />
            <div className="sm:col-span-2">
              <FormTextarea
                label="Recipients"
                required
                value={form.recipients}
                error={errors.recipients}
                placeholder="finance@example.com, manager@example.com"
                help="Automatic delivery emails these recipients when enabled for your organisation. Run now creates a download without sending email."
                onChange={(event) =>
                  setForm((value) => ({ ...value, recipients: event.target.value }))
                }
              />
            </div>
          </FormSection>
          <FormActions
            className="flex-wrap"
            primaryLabel={record ? 'Save changes' : 'Create schedule'}
            onSecondary={close}
            loading={busy}
          >
            {draft.canRetain && (
              <Btn type="button" variant="secondary" disabled={busy} onClick={draft.keep}>
                Keep draft
              </Btn>
            )}
          </FormActions>
        </fieldset>
      </FormShell>
    </Modal>
  );
}
