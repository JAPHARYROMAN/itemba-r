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
import { payrollMoney } from '@/components/workspace/payroll-types';
import { type SalaryPayment, dateLabel, employeeName } from './salary-payment-types';
export function ReverseDialog({
  payment,
  source,
  onClose,
  onSaved,
}: {
  payment: SalaryPayment;
  source?: WorkspaceDraft;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const stateKey = JSON.stringify([
    payment.updatedAt,
    payment.companyId,
    payment.status,
    payment.amount,
    payment.cashMovementId,
  ]);
  const draft = useWorkspaceDraftForm(
    { reason: '' },
    {
      appId: 'payroll',
      title: 'Reverse salary payment',
      describe: () => payment.salaryPaymentNumber,
      context: {
        kind: 'salary-payment-reversal',
        recordId: payment.id,
        version: payment.updatedAt || '',
        stateKey,
      },
      draftId: source?.id,
      busy,
      onClose,
      needsReview: !!source && (!payment.updatedAt || source.context.stateKey !== stateKey),
      reviewKey: stateKey,
    },
  );
  const { form, setForm } = draft;
  const unavailable = payment.status !== 'PAID' || !!payment.cashMovementId;
  const blocked =
    unavailable ||
    !hasPermission('salary_payments.view') ||
    !hasPermission('salary_payments.reverse') ||
    !!draft.availabilityError;
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const reverse = async () => {
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
        setBusy(true);
    setError('');
    try {
      await backendPatch('/hr/salary-payments/' + payment.id + '/reverse', {
        reason: form.reason.trim() || undefined,
      });
      draft.markSaved();
      onSaved('Salary payment record reversed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reverse this record.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={'Reverse payment · ' + payment.salaryPaymentNumber}
      onClose={close}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={close}>
            Back
          </Btn>
          {draft.canRetain && (
            <Btn type="button" variant="secondary" disabled={busy} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn variant="danger" loading={busy} disabled={blocked} onClick={reverse}>
            Reverse record
          </Btn>
        </>
      }
    >
      <div className="space-y-5" {...draft.guard.capture}>
        <DraftFormNotice draft={draft} />
        {unavailable && (
          <p role="alert" className="workspace-notice">
            This payment can no longer be reversed here. Connected cash payments must be reviewed in
            Payroll runs.
          </p>
        )}
        <div className="workspace-notice">
          <p>Current status: {payment.status.toLowerCase()}</p>
          <strong>{employeeName(payment)}</strong>
          <p>
            {payment.company?.name} · {payrollMoney(payment.amount)} ·{' '}
            {dateLabel(payment.paymentDate)}
          </p>
        </div>
        <p>
          Mark this payment record as Reversed. This updates the record and audit history; it does
          not recover money or reverse the payroll run’s accounting journal.
        </p>
        <label className="block text-sm">
          Reason (optional)
          <textarea
            rows={3}
            className="workspace-textarea"
            value={form.reason}
            disabled={busy || blocked}
            onChange={(e) => setForm({ reason: e.target.value })}
          />
        </label>
        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
