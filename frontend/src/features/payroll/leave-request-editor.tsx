'use client';
import { useId, useRef, useState } from 'react';
import { Btn, FormDateField, FormSelect, Modal } from '@/components/ui';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useAuth } from '@/hooks/use-auth';
import { backendPost } from '@/lib/api-client';
import { type FormState, empty } from './leave-request-workflow';
import { useLeaveTypes } from '@/hooks/use-leave-types';

export function LeaveRequestEditor({
  source,
  onClose,
  onSaved,
}: {
  source?: WorkspaceDraft;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { user, hasPermission } = useAuth();
  const formId = useId();
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const canCreate = hasPermission('leave_requests.create') && hasPermission('leave_requests.view');
  const draft = useWorkspaceDraftForm<FormState>(() => ({ ...empty }), {
    appId: 'payroll',
    title: 'New leave request',
    describe: (values) => values.reason || values.startDate || 'Leave request',
    context: { kind: 'leave-request' },
    draftId: source?.id,
    busy: saving,
    onClose,
  });
  const { form, setForm } = draft;
  const scope = useOrgScope(form.companyId, { skipBranches: true, skipDivisions: true });
  const types = useLeaveTypes(form.companyId);
  const choicesLoading = scope.loading || types.loading,
    choicesError = scope.error || types.error;
  const blocked =
    !canCreate ||
    scope.loading ||
    !!scope.error ||
    !!draft.availabilityError ||
    choicesLoading ||
    !!choicesError;
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const setValue = (key: keyof FormState) => (value: string) =>
    setForm((p) => ({ ...p, [key]: value }));
  const f =
    (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setValue(key)(e.target.value);
  const days =
    form.startDate && form.endDate
      ? (Date.parse(form.endDate) - Date.parse(form.startDate)) / 86_400_000 + 1
      : 0;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending.current || blocked) return;
      pending.current = true;
    try {
      draft.validateReview();
      await draft.saveNow();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review this draft.');
      pending.current = false;
      return;
    }
    if (
      !scope.companyOptions.some((o) => o.value === form.companyId) ||
      !scope.employeeOptions.some((o) => o.value === form.employeeId)
    ) {
      setError('Choose an available company and employee.');
      pending.current = false;
      return;
    }
    if (!Number.isFinite(days) || days < 1) {
      setError('End date must be on or after the start date.');
      pending.current = false;
      return;
    }
    if (!types.rows.some((t) => t.id === form.leaveTypeId && t.isActive !== false)) {
      setError('Choose an active leave type for this company.');
      pending.current = false;
      return;
    }
        setSaving(true);
    setError('');
    try {
      await backendPost('/hr/leave-requests', {
        companyId: form.companyId,
        employeeId: form.employeeId,
        leaveTypeId: form.leaveTypeId,
        startDate: form.startDate,
        endDate: form.endDate,
        totalDays: days,
        reason: form.reason.trim() || undefined,
        createdById: user?.id,
      });
      draft.markSaved();
      onSaved('Leave draft saved. Select it to submit for approval.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save leave request.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      onClose={close}
      title="New leave request"
      subtitle="Save a draft, then submit it when you are ready."
      size="lg"
      footer={
        <>
          <Btn variant="secondary" disabled={saving} onClick={close}>
            Cancel
          </Btn>
          {draft.canRetain && (
            <Btn type="button" variant="secondary" disabled={saving} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn type="submit" form={formId} loading={saving} disabled={blocked}>
            Save draft
          </Btn>
        </>
      }
    >
      <form id={formId} onSubmit={submit} {...draft.guard.capture} className="space-y-5">
        <DraftFormNotice draft={draft} />
        {error && (
          <div role="alert" className="workspace-notice">
            {error}
          </div>
        )}
        {choicesError && (
          <div role="alert" className="workspace-notice">
            {choicesError}{' '}
            <Btn
              type="button"
              variant="ghost"
              onClick={() => {
                scope.retry();
                types.retry();
              }}
            >
              Retry choices
            </Btn>
          </div>
        )}
        {choicesLoading && <p role="status">Loading leave choices…</p>}
        <fieldset disabled={saving || blocked} className="space-y-5">
          <h3 className="text-base font-semibold">Person and leave</h3>
          <div className="workspace-form-grid">
            <FormSelect
              label="Company"
              required
              value={form.companyId}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  companyId: e.target.value,
                  employeeId: '',
                  leaveTypeId: '',
                }))
              }
              options={scope.companyOptions}
              placeholder="Select company"
            />
            <FormSelect
              label="Employee"
              required
              disabled={!form.companyId || Boolean(scope.error)}
              value={form.employeeId}
              onChange={f('employeeId')}
              options={scope.employeeOptions}
              placeholder={form.companyId ? 'Select employee' : 'Select company first'}
            />
          </div>
          <FormSelect
            label="Leave type"
            required
            disabled={!form.companyId || Boolean(types.error)}
            value={form.leaveTypeId}
            onChange={f('leaveTypeId')}
            options={types.rows
              .filter((t) => t.isActive !== false)
              .map((t) => ({ value: t.id, label: t.name }))}
            placeholder={form.companyId ? 'Select leave type' : 'Select company first'}
          />
          <h3 className="text-base font-semibold">Dates and reason</h3>
          <div className="workspace-form-grid">
            <FormDateField
              label="Start date"
              required
              value={form.startDate}
              onChange={setValue('startDate')}
            />
            <FormDateField
              label="End date"
              required
              min={form.startDate}
              value={form.endDate}
              onChange={setValue('endDate')}
            />
          </div>
          {Number.isFinite(days) && days > 0 && (
            <div className="workspace-notice">
              {days} calendar day{days === 1 ? '' : 's'}, including both dates.
              {days > 5 ? ' Line and Group HR approvals are required.' : ''}
            </div>
          )}
          <label className="block text-sm">
            Reason
            <textarea
              rows={3}
              className="workspace-textarea"
              value={form.reason}
              onChange={f('reason')}
            />
          </label>
        </fieldset>
      </form>
    </Modal>
  );
}
