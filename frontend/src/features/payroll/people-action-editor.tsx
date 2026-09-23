'use client';

import { useRef, useState } from 'react';
import { Btn, Modal } from '@/components/ui';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { useAuth } from '@/hooks/use-auth';
import { backendPatch } from '@/lib/api-client';
import {
  contractActionPermissions,
  type Contract,
  employeeName as contractEmployee,
  companyName,
  date as contractDate,
} from './contract-workflow';
import {
  leaveActionPermissions,
  type LeaveRequest,
  type Action,
  actionNames,
  employeeName as leaveEmployee,
  typeName,
  date,
} from './leave-request-workflow';

export type PeopleAction =
  | { kind: 'contract-action'; record: Contract; action: keyof typeof contractActionPermissions }
  | { kind: 'leave-action'; record: LeaveRequest; action: Action };

function available(entry: PeopleAction) {
  if (entry.kind === 'contract-action')
    return entry.action === 'approve'
      ? entry.record.status === 'DRAFT'
      : ['ACTIVE', 'APPROVED'].includes(entry.record.status);
  const r = entry.record;
  switch (entry.action) {
    case 'submit':
      return r.status === 'DRAFT';
    case 'approve':
      return r.status === 'SUBMITTED' && !r.lineApprovedById;
    case 'approve-hr':
      return r.status === 'SUBMITTED' && Number(r.totalDays) > 5 && !r.groupHrApprovedById;
    case 'reject':
      return r.status === 'SUBMITTED';
    case 'cancel':
      return ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(r.status);
  }
}

export function PeopleActionEditor({
  entry,
  source,
  onClose,
  onSaved,
}: {
  entry: PeopleAction;
  source?: WorkspaceDraft;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const contract = entry.kind === 'contract-action';
  const title = contract
    ? `${entry.action === 'approve' ? 'Approve' : 'Terminate'} ${entry.record.contractCode}?`
    : `${actionNames[entry.action]} for ${leaveEmployee(entry.record)}?`;
  const actionLabel = contract
    ? `${entry.action === 'approve' ? 'Approve' : 'Terminate'} contract`
    : actionNames[entry.action];
  const permission = contract
    ? contractActionPermissions[entry.action]
    : leaveActionPermissions[entry.action];
  const allowed =
    hasPermission(permission) &&
    hasPermission(contract ? 'employment_contracts.view' : 'leave_requests.view');
  const stateKey = JSON.stringify([
    entry.record.updatedAt,
    entry.record.status,
    ...(!contract
      ? [entry.record.lineApprovedById, entry.record.groupHrApprovedById, entry.record.totalDays]
      : []),
  ]);
  const draft = useWorkspaceDraftForm(
    { text: '' },
    {
      appId: 'payroll',
      title: actionLabel,
      describe: () => (contract ? contractEmployee(entry.record) : leaveEmployee(entry.record)),
      context: {
        kind: entry.kind,
        recordId: entry.record.id,
        action: entry.action,
        version: entry.record.updatedAt || '',
        stateKey,
      },
      draftId: source?.id,
      busy,
      onClose,
      needsReview: !!source && (!entry.record.updatedAt || source.context.stateKey !== stateKey),
      reviewKey: stateKey,
    },
  );
  const unavailable = !available(entry);
  const blocked = !allowed || unavailable || !!draft.availabilityError;
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const performAction = async () => {
    if (pending.current || blocked) return;
    pending.current = true;
    setError('');
    try {
      draft.validateReview();
      await draft.saveNow();
            setBusy(true);
      const text = draft.form.text.trim();
      if (contract) {
        await backendPatch(
          `/hr/employment-contracts/${encodeURIComponent(entry.record.id)}/${entry.action}`,
          entry.action === 'terminate' ? { ...(text ? { reason: text } : {}) } : undefined,
        );
        draft.markSaved();
        onSaved(
          entry.action === 'approve' ? 'Contract approved and active.' : 'Contract terminated.',
        );
      } else {
        const payload =
          entry.action === 'submit'
            ? {}
            : ['approve', 'approve-hr'].includes(entry.action)
              ? { notes: text || undefined }
              : { reason: text || undefined };
        const updated = await backendPatch<LeaveRequest>(
          `/hr/leave-requests/${encodeURIComponent(entry.record.id)}/${entry.action}`,
          payload,
        );
        draft.markSaved();
        onSaved(
          updated?.status === 'SUBMITTED' && ['approve', 'approve-hr'].includes(entry.action)
            ? 'Approval recorded. This request still needs the other approval.'
            : 'Leave request updated.',
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update this record.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const hasText = contract ? entry.action === 'terminate' : entry.action !== 'submit';
  return (
    <Modal
      open
      title={title}
      onClose={close}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={close}>
            {contract ? 'Cancel' : 'Back'}
          </Btn>
          {hasText && draft.canRetain && (
            <Btn type="button" variant="secondary" disabled={busy} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn
            variant={
              ['terminate', 'reject', 'cancel'].includes(entry.action) ? 'danger' : 'primary'
            }
            loading={busy}
            disabled={blocked}
            onClick={performAction}
          >
            {actionLabel}
          </Btn>
        </>
      }
    >
      <div className="space-y-4" {...draft.guard.capture}>
        <DraftFormNotice draft={draft} />
        <p>Current status: {entry.record.status.toLowerCase().replaceAll('_', ' ')}</p>
        {contract ? (
          <>
            <p>
              {contractEmployee(entry.record)} · {companyName(entry.record)}
            </p>
            <p>
              {contractDate(entry.record.startDate)} – {contractDate(entry.record.endDate)}
            </p>
            <p className="whitespace-pre-wrap break-words">
              Current terms: {entry.record.terms || 'No additional terms'}
            </p>
            <p>
              {entry.action === 'terminate'
                ? 'This changes the agreement to Terminated. It does not terminate the employee record.'
                : 'This makes the draft agreement active.'}
            </p>
          </>
        ) : (
          <>
            <p>
              {typeName(entry.record)} · {date(entry.record.startDate)} –{' '}
              {date(entry.record.endDate)} · {Number(entry.record.totalDays || 0)} days
            </p>
            <p className="whitespace-pre-wrap break-words">
              Current reason: {entry.record.reason || 'No reason'}
            </p>
            <p>
              Line approval: {entry.record.lineApprovedById ? 'Recorded' : 'Not recorded'} · Group
              HR approval: {entry.record.groupHrApprovedById ? 'Recorded' : 'Not recorded'}
            </p>
            <p className="whitespace-pre-wrap break-words">
              Current approval notes: {entry.record.approvalNotes || 'No notes'}
            </p>
            {entry.action === 'cancel' && entry.record.status === 'APPROVED' && (
              <p className="workspace-notice">
                Cancelling approved leave returns any days charged to the leave balance.
              </p>
            )}
            {['approve', 'approve-hr'].includes(entry.action) &&
              Number(entry.record.totalDays) > 5 && (
                <p className="workspace-notice">
                  Leave over five days requires line and Group HR approvals from different people.
                </p>
              )}
          </>
        )}
        {unavailable && (
          <p role="alert" className="workspace-notice">
            This action is no longer available for the current record. Your entered notes can still
            be kept.
          </p>
        )}
        {!allowed && (
          <p role="alert" className="workspace-notice">
            Your current role cannot perform this action.
          </p>
        )}
        {hasText && (
          <label className="block text-sm">
            {!contract && ['approve', 'approve-hr'].includes(entry.action)
              ? 'Approval notes (optional)'
              : 'Reason (optional)'}
            <textarea
              rows={3}
              className="workspace-textarea"
              disabled={busy || !!draft.availabilityError}
              value={draft.form.text}
              onChange={(event) => draft.setForm({ text: event.target.value })}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
