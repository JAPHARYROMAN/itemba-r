'use client';
import { useState } from 'react';
import { Btn, FormTextarea, Modal } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useFormGuard } from '@/components/workspace/unsaved-work-provider';
import { backendPatch } from '@/lib/api-client';
import {
  type ApprovalRequest,
  type RequestAction,
  requestTitle,
  requestAmount,
  requestPath,
} from './approval-request-types';

export function ApprovalRequestAction({
  record,
  kind,
  onClose,
  onSaved,
}: {
  record: ApprovalRequest;
  kind: RequestAction;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const [form, setForm] = useState({ text: '' }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const draft = useFormGuard(form, setForm);
  const label = `${kind[0].toUpperCase() + kind.slice(1)} request`;
  const close = () => {
    if (!busy) draft.requestClose(onClose);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !record.availableActions?.[kind] || !hasPermission(`approval_requests.${kind}`))
      return;
    setBusy(true);
    setError('');
    try {
      const text = form.text.trim();
      await backendPatch(
        `${requestPath}/${encodeURIComponent(record.id)}/${kind}`,
        text ? { [kind === 'approve' ? 'comment' : 'reason']: text } : {},
      );
      draft.markSaved();
      onSaved(
        `Request ${kind === 'approve' ? 'approved' : kind === 'reject' ? 'rejected' : 'cancelled'}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update this request.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={label}
      onClose={close}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={close}>
            Keep request
          </Btn>
          <Btn
            type="submit"
            form="approval-request-action"
            variant={kind === 'approve' ? 'primary' : 'danger'}
            loading={busy}
          >
            {label}
          </Btn>
        </>
      }
    >
      <form id="approval-request-action" onSubmit={submit} {...draft.capture} className="space-y-5">
        <div className="workspace-notice">
          <strong>{requestTitle(record)}</strong>
          <p>
            {record.approvalRequestNumber || record.id} ·{' '}
            {record.company?.name || record.companyId || 'Group-level'}
          </p>
          <p>{requestAmount(record)}</p>
        </div>
        <p>
          {kind === 'approve'
            ? 'Record your approval of this request?'
            : kind === 'reject'
              ? 'Reject this request and record your decision?'
              : 'Cancel this request and stop its approval review?'}
        </p>
        <FormTextarea
          label={kind === 'approve' ? 'Comment' : 'Reason'}
          hint="Optional. Recorded in the request activity."
          value={form.text}
          onChange={(e) => setForm({ text: e.target.value })}
          disabled={busy}
          rows={3}
        />
        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
