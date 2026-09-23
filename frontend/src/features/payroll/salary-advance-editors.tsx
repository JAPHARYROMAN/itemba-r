'use client';
import { useId, useRef, useState } from 'react';
import { Btn, FormDateField, FormInput, FormSelect, Modal } from '@/components/ui';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useAuth } from '@/hooks/use-auth';
import { backendPatch, backendPost } from '@/lib/api-client';
import {
  type Company,
  type Employee,
  type SalaryAdvance,
  name,
  money,
  today,
} from './salary-advance-types';
export function AdvanceForm({
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
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const draft = useWorkspaceDraftForm(
    () => ({ companyId: '', employeeId: '', amount: '', requestDate: today(), reason: '' }),
    {
      appId: 'payroll',
      title: 'Request salary advance',
      describe: (values) => values.reason || 'Salary advance request',
      context: { kind: 'salary-advance' },
      draftId: source?.id,
      busy,
      onClose,
    },
  );
  const { form, setForm } = draft;
  const canChoose = hasPermission('employees.view');
  const companies = useWorkspaceChoices<Company>('/companies', {});
  const employees = useWorkspaceChoices<Employee>(
    '/hr/employees',
    { companyId: form.companyId },
    canChoose && !!form.companyId,
  );
  const blocked =
    !hasPermission('salary_advances.view') ||
    !hasPermission('salary_advances.create') ||
    !!draft.availabilityError ||
    !canChoose ||
    companies.loading ||
    employees.loading ||
    !!companies.error ||
    !!employees.error;
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
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
      !companies.rows.some((c) => c.id === form.companyId) ||
      !employees.rows.some((e) => e.id === form.employeeId) ||
      !Number.isFinite(Number(form.amount)) ||
      Number(form.amount) <= 0
    ) {
      setError('Choose an employee and enter a positive advance amount.');
      pending.current = false;
      return;
    }
    setBusy(true);
    setError('');
    try {
      await backendPost('/hr/salary-advances', {
        ...form,
        amount: Number(form.amount),
        reason: form.reason.trim() || undefined,
        requestDate: form.requestDate || today(),
        createdById: user?.id,
      });
      draft.markSaved();
      onSaved('Salary advance requested.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to request this advance.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="Request salary advance"
      subtitle="Choose an employee and the amount to request."
      size="lg"
      onClose={close}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Btn>
          {draft.canRetain && (
            <Btn type="button" variant="secondary" disabled={busy} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn
            variant="primary"
            type="submit"
            form={formId}
            loading={busy}
            disabled={blocked || !form.employeeId}
          >
            Request advance
          </Btn>
        </>
      }
    >
      <form id={formId} className="space-y-5" onSubmit={submit} {...draft.guard.capture}>
        <DraftFormNotice draft={draft} />
        {!canChoose && (
          <p role="alert" className="workspace-notice">
            Employee viewing permission is required to choose the person requesting an advance.
          </p>
        )}
        {[companies, employees].map(
          (l, i) =>
            l.error && (
              <div role="alert" className="workspace-notice" key={i}>
                {l.error}{' '}
                <Btn variant="ghost" onClick={l.retry}>
                  Retry {i === 0 ? 'companies' : 'employees'}
                </Btn>
              </div>
            ),
        )}
        {(companies.loading || employees.loading) && (
          <p role="status">Loading company and employee choices…</p>
        )}
        <fieldset disabled={busy || !!draft.availabilityError} className="space-y-5">
          <h3 className="font-semibold">Employee and company</h3>
          <div className="workspace-form-grid">
            <FormSelect
              label="Company"
              required
              value={form.companyId}
              options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Select company"
              disabled={companies.loading}
              onChange={(e) =>
                setForm((p) => ({ ...p, companyId: e.target.value, employeeId: '' }))
              }
            />
            <FormSelect
              label="Employee"
              required
              value={form.employeeId}
              options={employees.rows.map((e) => ({
                value: e.id,
                label: e.fullName + ' · ' + e.employeeCode,
              }))}
              placeholder={form.companyId ? 'Select employee' : 'Select company first'}
              disabled={!form.companyId || employees.loading || !canChoose}
              onChange={(e) => setForm((p) => ({ ...p, employeeId: e.target.value }))}
            />
          </div>
          <h3 className="font-semibold">Request details</h3>
          <div className="workspace-form-grid">
            <FormInput
              label="Amount (TZS)"
              type="number"
              min="0.01"
              step="0.01"
              required
              value={form.amount}
              onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
            />
            <FormDateField
              label="Request date"
              value={form.requestDate}
              onChange={(value) => setForm((p) => ({ ...p, requestDate: value }))}
            />
          </div>
          <label className="block text-sm">
            Reason (optional)
            <textarea
              rows={3}
              className="workspace-textarea"
              value={form.reason}
              onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
            />
          </label>
          <p className="workspace-notice">
            A new request awaits approval. Approved advances can then be recorded as paid and
            recovered through payroll.
          </p>
        </fieldset>
        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
export function AdvanceAction({
  advance,
  kind,
  source,
  onClose,
  onSaved,
}: {
  advance: SalaryAdvance;
  kind: 'approve' | 'pay';
  source?: WorkspaceDraft;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const stateKey = JSON.stringify([
    advance.updatedAt,
    advance.companyId,
    advance.status,
    advance.amount,
    advance.recoveredAmount,
  ]);
  const draft = useWorkspaceDraftForm(
    { amount: String(advance.amount) },
    {
      appId: 'payroll',
      title: kind === 'approve' ? 'Approve salary advance' : 'Pay salary advance',
      describe: () => advance.advanceNumber,
      context: {
        kind: 'advance-action',
        recordId: advance.id,
        action: kind,
        version: advance.updatedAt || '',
        stateKey,
      },
      draftId: source?.id,
      busy,
      onClose,
      needsReview: !!source && (!advance.updatedAt || source.context.stateKey !== stateKey),
      reviewKey: stateKey,
    },
  );
  const { form, setForm } = draft;
  const unavailable = advance.status !== (kind === 'approve' ? 'REQUESTED' : 'APPROVED');
  const blocked =
    unavailable ||
    !hasPermission('salary_advances.view') ||
    !hasPermission('salary_advances.' + kind) ||
    !!draft.availabilityError;
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const submit = async () => {
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
    const approved = Number(form.amount);
    if (
      kind === 'approve' &&
      (!Number.isFinite(approved) || approved <= 0 || approved > Number(advance.amount))
    ) {
      setError('Approve an amount greater than zero and no more than the requested amount.');
      pending.current = false;
      return;
    }
    setBusy(true);
    setError('');
    try {
      await backendPatch(
        '/hr/salary-advances/' + advance.id + '/' + kind,
        kind === 'approve' ? { approvedAmount: approved } : undefined,
      );
      draft.markSaved();
      onSaved(kind === 'approve' ? 'Salary advance approved.' : 'Advance payment recorded.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update this advance.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={
        (kind === 'approve' ? 'Approve advance · ' : 'Record payment · ') + advance.advanceNumber
      }
      onClose={close}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={close}>
            Back
          </Btn>
          {kind === 'approve' && draft.canRetain && (
            <Btn type="button" variant="secondary" disabled={busy} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn variant="primary" loading={busy} disabled={blocked} onClick={submit}>
            {kind === 'approve' ? 'Approve advance' : 'Record payment'}
          </Btn>
        </>
      }
    >
      <div className="space-y-5" {...draft.guard.capture}>
        <DraftFormNotice draft={draft} />
        {unavailable && (
          <p role="alert" className="workspace-notice">
            This action is no longer available for the current advance. Your draft can still be
            kept.
          </p>
        )}
        <div className="workspace-notice">
          <p>Current status: {advance.status.toLowerCase()}</p>
          <strong>{name(advance)}</strong>
          <p>
            {advance.company?.name} · {money(advance.amount, advance.currency)}
          </p>
          <p>{advance.reason || 'No reason supplied.'}</p>
        </div>
        {kind === 'approve' ? (
          <>
            <p>
              Approve the requested amount or a smaller amount. Approval updates the advance amount
              and records your sign-off; it does not record payment.
            </p>
            <FormInput
              label={'Approved amount (' + (advance.currency || 'TZS') + ')'}
              type="number"
              min="0.01"
              max={String(advance.amount)}
              step="0.01"
              value={form.amount}
              disabled={busy || blocked}
              onChange={(e) => setForm({ amount: e.target.value })}
            />
          </>
        ) : (
          <p>
            Mark this approved advance as paid and post its advance-payment journal. This records
            the disbursement in ITEMBA-R; it does not transfer funds through a bank or mobile-money
            provider.
          </p>
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
