'use client';
import { useId, useRef, useState } from 'react';
import { Btn, FormDateField, FormInput, FormSelect, Modal } from '@/components/ui';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useAuth } from '@/hooks/use-auth';
import { backendPost } from '@/lib/api-client';
import { type FormState, empty } from './payroll-period-workflow';
export function PayrollPeriodEditor({
  companyId = '',
  source,
  onClose,
  onSaved,
}: {
  companyId?: string;
  source?: WorkspaceDraft;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { user, hasPermission } = useAuth();
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const formId = useId(),
    pending = useRef(false);
  const draft = useWorkspaceDraftForm(
    { ...empty, companyId },
    {
      appId: 'payroll',
      title: 'New payroll period',
      describe: (values) => values.name || 'Pay cycle',
      context: { kind: 'payroll-period' },
      draftId: source?.id,
      busy: saving,
      onClose,
    },
  );
  const { form, setForm } = draft;
  const scope = useOrgScope(undefined, {
    skipBranches: true,
    skipDivisions: true,
    skipEmployees: true,
  });
  const permission = hasPermission('payroll.view') && hasPermission('payroll.manage');
  const blocked = !permission || scope.loading || !!scope.error || !!draft.availabilityError;
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const setValue = (key: keyof FormState) => (value: string) =>
    setForm((p) => ({ ...p, [key]: value }));
  const f =
    (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValue(key)(e.target.value);
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
    if (!scope.companyOptions.some((option) => option.value === form.companyId)) {
      setError('Choose an available company.');
      pending.current = false;
      return;
    }
    if (!form.companyId || !form.name.trim() || !form.startDate || !form.endDate) {
      setError('Choose a company and enter a name, start date and end date.');
      pending.current = false;
      return;
    }
    if (form.endDate < form.startDate) {
      setError('End date must be on or after start date.');
      pending.current = false;
      return;
    }
    if (!user?.id) {
      setError('Your session is unavailable. Sign in again before saving.');
      pending.current = false;
      return;
    }
    setSaving(true);
    setError('');
    try {
      await backendPost('/hr/payroll-periods', {
        payrollPeriodCode: form.code.trim() || undefined,
        companyId: form.companyId,
        name: form.name.trim(),
        startDate: form.startDate,
        endDate: form.endDate,
        paymentDate: form.paymentDate || undefined,
        createdById: user.id,
      });
      draft.markSaved();
      onSaved('Payroll period created. Select the period to view its runs.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create the payroll period.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      onClose={close}
      title="New payroll period"
      subtitle="Set the dates for this pay cycle."
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
            Create period
          </Btn>
        </>
      }
    >
      <form id={formId} onSubmit={submit} {...draft.guard.capture} className="space-y-5">
        <DraftFormNotice draft={draft} />
        {!permission && (
          <p role="alert" className="workspace-notice">
            Your current role cannot create a payroll period. Your draft can still be kept.
          </p>
        )}
        {error && (
          <div role="alert" className="workspace-notice">
            {error}
          </div>
        )}
        {scope.error && (
          <div role="alert" className="workspace-notice">
            {scope.error}{' '}
            <Btn type="button" variant="ghost" onClick={scope.retry}>
              Retry choices
            </Btn>
          </div>
        )}
        {scope.loading && <p role="status">Loading companies…</p>}
        <fieldset disabled={saving || blocked} className="space-y-5">
          <h3 className="text-base font-semibold">Period identity</h3>
          <FormSelect
            label="Company"
            required
            value={form.companyId}
            onChange={f('companyId')}
            options={scope.companyOptions}
            placeholder="Select company"
          />
          <div className="workspace-form-grid">
            <FormInput
              label="Name"
              required
              value={form.name}
              onChange={f('name')}
              placeholder="September 2026"
            />
            <FormInput
              label="Period code"
              value={form.code}
              onChange={f('code')}
              hint="Leave blank to generate a code when saved."
            />
          </div>
          <h3 className="text-base font-semibold">Pay cycle</h3>
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
              value={form.endDate}
              onChange={setValue('endDate')}
            />
            <FormDateField
              label="Payment date"
              value={form.paymentDate}
              onChange={setValue('paymentDate')}
              hint="Optional planned payment date."
            />
          </div>
          <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
            Create the period first, then open its runs to prepare payroll.
          </p>
        </fieldset>
      </form>
    </Modal>
  );
}
