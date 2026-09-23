'use client';
import { useState } from 'react';
import { Btn, FormDateField, FormInput, FormSelect, Modal } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendDelete, backendPatch } from '@/lib/api-client';
import { useFormGuard } from './unsaved-work-provider';
import {
  disputeEmployeeName,
  disputeOperationAllowed,
  disputePath,
  disputeResolutions,
  type DisputeOperation,
  type DisputeRecord,
} from './dispute-types';
const titles = {
  mediate: 'Start internal mediation',
  'refer-cma': 'Record CMA referral',
  resolve: 'Record resolution',
  withdraw: 'Withdraw dispute?',
  delete: 'Delete dispute?',
};
const buttons = {
  mediate: 'Start mediation',
  'refer-cma': 'Record referral',
  resolve: 'Mark resolved',
  withdraw: 'Withdraw dispute',
  delete: 'Delete dispute',
};
const descriptions = {
  mediate: 'Record that internal mediation has started, with any initial outcome or notes.',
  'refer-cma':
    'Record the referral details. This updates the dispute and makes the referral form available; it does not submit a filing to CMA.',
  resolve:
    'Record the agreed outcome and close the dispute. A recorded amount does not initiate a payment.',
  withdraw: 'This closes the dispute as withdrawn and records you as the operator.',
  delete:
    'This removes the dispute from active lists while retaining its audit history. Linked disciplinary actions remain unchanged.',
};
export function DisputeOperationDialog({
  record,
  operation,
  onClose,
  onSaved,
}: {
  record: DisputeRecord;
  operation: DisputeOperation;
  onClose: () => void;
  onSaved: (operation: DisputeOperation) => void;
}) {
  const { hasPermission } = useAuth();
  const [form, setForm] = useState({
      mediationOutcome: '',
      cmaReferenceNumber: '',
      cmaHearingDate: '',
      cmaArbitrator: '',
      resolutionType: 'SETTLED_INTERNALLY',
      resolutionAmount: '',
      resolutionNotes: '',
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const draft = useFormGuard(form, setForm),
    close = () => {
      if (!busy) draft.requestClose(onClose);
    };
  const setValue = (key: keyof typeof form) => (value: string) =>
    setForm((p) => ({ ...p, [key]: value }));
  const f =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setValue(key)(e.target.value);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      busy ||
      !hasPermission(operation === 'delete' ? 'employees.delete' : 'employees.update') ||
      !disputeOperationAllowed(record, operation)
    )
      return;
    const payload: Record<string, string | number> = {};
    if (operation === 'mediate' && form.mediationOutcome.trim())
      payload.mediationOutcome = form.mediationOutcome.trim();
    if (operation === 'refer-cma')
      for (const key of ['cmaReferenceNumber', 'cmaHearingDate', 'cmaArbitrator'] as const)
        if (form[key].trim()) payload[key] = form[key].trim();
    if (operation === 'resolve') {
      payload.resolutionType = form.resolutionType;
      if (form.resolutionAmount !== '') {
        if (!Number.isFinite(Number(form.resolutionAmount))) {
          setError('Enter a valid resolution amount.');
          return;
        }
        payload.resolutionAmount = Number(form.resolutionAmount);
      }
      if (form.resolutionNotes.trim()) payload.resolutionNotes = form.resolutionNotes.trim();
    }
    setBusy(true);
    setError('');
    try {
      if (operation === 'delete') await backendDelete(disputePath + '/' + record.id);
      else await backendPatch(disputePath + '/' + record.id + '/' + operation, payload);
      draft.markSaved();
      onSaved(operation);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update this dispute.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={titles[operation]}
      subtitle={record.disputeNumber + ' · ' + disputeEmployeeName(record.employee)}
      onClose={close}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Btn>
          <Btn
            variant={operation === 'delete' ? 'danger' : 'primary'}
            type="submit"
            form="dispute-operation"
            loading={busy}
          >
            {buttons[operation]}
          </Btn>
        </>
      }
    >
      <form id="dispute-operation" onSubmit={submit} {...draft.capture} className="space-y-4">
        <p>{record.company?.name}</p>
        <p className="whitespace-pre-wrap break-words">{record.summary}</p>
        <p className="workspace-notice">{descriptions[operation]}</p>
        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
        {operation === 'mediate' && (
          <label className="block text-sm space-y-2">
            <span>Initial outcome or notes</span>
            <textarea
              className="workspace-textarea"
              rows={4}
              value={form.mediationOutcome}
              onChange={f('mediationOutcome')}
            />
          </label>
        )}
        {operation === 'refer-cma' && (
          <>
            <FormInput
              label="CMA reference"
              value={form.cmaReferenceNumber}
              onChange={f('cmaReferenceNumber')}
            />
            <FormDateField
              label="Hearing date"
              value={form.cmaHearingDate}
              onChange={setValue('cmaHearingDate')}
            />
            <FormInput
              label="Arbitrator"
              value={form.cmaArbitrator}
              onChange={f('cmaArbitrator')}
            />
          </>
        )}
        {operation === 'resolve' && (
          <>
            <FormSelect
              label="Resolution type"
              value={form.resolutionType}
              options={disputeResolutions}
              onChange={f('resolutionType')}
            />
            <FormInput
              label="Resolution amount (TZS, optional)"
              type="number"
              step="0.01"
              value={form.resolutionAmount}
              onChange={f('resolutionAmount')}
            />
            <label className="block text-sm space-y-2">
              <span>Resolution notes</span>
              <textarea
                className="workspace-textarea"
                rows={4}
                value={form.resolutionNotes}
                onChange={f('resolutionNotes')}
              />
            </label>
          </>
        )}
      </form>
    </Modal>
  );
}
