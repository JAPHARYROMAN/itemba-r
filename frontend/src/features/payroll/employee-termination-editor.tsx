'use client';
import { useId, useRef, useState } from 'react';
import { Btn, FormDateField, FormInput, Modal } from '@/components/ui';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { useAuth } from '@/hooks/use-auth';
import { backendPatch } from '@/lib/api-client';
import type { Employee } from './employee-types';
import '@/components/workspace/workspace.css';

export function EmployeeTerminationEditor({
  employee,
  source,
  onClose,
  onSaved,
}: {
  employee: Employee;
  source?: WorkspaceDraft;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const allowed = hasPermission('employees.view') && hasPermission('employees.termination.request');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef(false),
    formId = useId();
  const draft = useWorkspaceDraftForm(
    { reason: '', terminationDate: '' },
    {
      appId: 'payroll',
      title: 'Request Termination',
      describe: () => `${employee.fullName || employee.employeeCode} · ${employee.employeeCode}`,
      context: { kind: 'termination', employeeId: employee.id, version: employee.updatedAt || '' },
      draftId: source?.id,
      busy,
      onClose,
      needsReview:
        !!source && (!employee.updatedAt || source.context.version !== employee.updatedAt),
      reviewKey: employee.updatedAt,
    },
  );
  const { form, setForm } = draft;
  const stateError =
    employee.employmentStatus === 'TERMINATED'
      ? 'This employee is already terminated.'
      : employee.terminationRequestedAt
        ? 'A termination request is already awaiting approval. This draft cannot replace it.'
        : '';
  const blocked = !allowed || !!draft.availabilityError || !!stateError;
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || blocked) return;
    pending.current = true;
    setError('');
    try {
      draft.validateReview();
      await draft.saveNow();
      if (!form.reason.trim()) throw new Error('Enter the termination reason.');
      setBusy(true);
      await backendPatch(`/hr/employees/${encodeURIComponent(employee.id)}/request-termination`, {
        reason: form.reason.trim(),
        ...(form.terminationDate ? { terminationDate: form.terminationDate } : {}),
      });
      draft.markSaved();
      onSaved('Termination requested. Another authorised person must approve it.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to request termination.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      size="md"
      title="Request Termination"
      subtitle={employee.fullName || employee.employeeCode}
      onClose={close}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Btn>
          {draft.canRetain && (
            <Btn variant="secondary" disabled={busy} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn variant="danger" type="submit" form={formId} loading={busy} disabled={blocked}>
            Request Termination
          </Btn>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4" {...draft.guard.capture}>
        <DraftFormNotice draft={draft}>
          <p>
            Current employee: {employee.fullName || employee.employeeCode} ·{' '}
            {employee.company?.name || 'Company unavailable'} ·{' '}
            {employee.employmentStatus?.replaceAll('_', ' ') || 'Status unavailable'}
          </p>
          {employee.terminationRequestedAt && (
            <p>
              Pending request: {employee.terminationReason || 'Reason unavailable'}
              {employee.pendingTerminationDate
                ? ` · ${employee.pendingTerminationDate.slice(0, 10)}`
                : ''}
            </p>
          )}
        </DraftFormNotice>
        {(stateError || !allowed || error) && (
          <p role="alert" className="workspace-notice">
            {stateError || (!allowed ? 'Your current role cannot request termination.' : error)}
          </p>
        )}
        <p className="text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
          The request must be approved by someone else before this employee is terminated. The
          requester cannot approve their own request.
        </p>
        <fieldset disabled={busy || blocked} className="space-y-4">
          <FormInput
            label="Termination reason"
            value={form.reason}
            onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
            placeholder="e.g. End of contract, resignation, misconduct case #…"
          />
          <FormDateField
            label="Termination date (optional — defaults to today)"
            value={form.terminationDate}
            onChange={(value) => setForm((p) => ({ ...p, terminationDate: value }))}
          />
        </fieldset>
      </form>
    </Modal>
  );
}
