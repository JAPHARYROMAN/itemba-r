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
import { type FormState, empty, types, options } from './contract-workflow';

export function ContractEditor({
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
  const canCreate =
    hasPermission('employment_contracts.create') && hasPermission('employment_contracts.view');
  const draft = useWorkspaceDraftForm<FormState>(() => ({ ...empty }), {
    appId: 'payroll',
    title: 'New employment contract',
    describe: (values) => values.terms || values.code || 'Employment agreement',
    context: { kind: 'contract' },
    draftId: source?.id,
    busy: saving,
    onClose,
  });
  const { form, setForm } = draft;
  const scope = useOrgScope(form.companyId, { skipBranches: true, skipDivisions: true });
  const blocked = !canCreate || scope.loading || !!scope.error || !!draft.availabilityError;
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const setValue = (key: keyof FormState) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const f =
    (key: keyof FormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setValue(key)(event.target.value);
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
      !scope.companyOptions.some((o) => o.value === form.companyId) ||
      !scope.employeeOptions.some((o) => o.value === form.employeeId)
    ) {
      setError('Choose an available company and employee.');
      pending.current = false;
      return;
    }
    if (form.endDate && form.endDate < form.startDate) {
      setError('End date must be on or after the start date.');
      pending.current = false;
      return;
    }
    if (
      form.probationEndDate &&
      (form.probationEndDate < form.startDate ||
        (form.endDate && form.probationEndDate > form.endDate))
    ) {
      setError('Probation must end within the contract dates.');
      pending.current = false;
      return;
    }
    if (
      !form.baseSalary.trim() ||
      !Number.isFinite(Number(form.baseSalary)) ||
      Number(form.baseSalary) < 0
    ) {
      setError('Enter a valid salary of zero or more.');
      pending.current = false;
      return;
    }
        setSaving(true);
    setError('');
    try {
      await backendPost('/hr/employment-contracts', {
        ...(form.code.trim() ? { contractCode: form.code.trim() } : {}),
        employeeId: form.employeeId,
        companyId: form.companyId,
        contractType: form.contractType,
        startDate: form.startDate,
        ...(form.endDate ? { endDate: form.endDate } : {}),
        ...(form.probationEndDate ? { probationEndDate: form.probationEndDate } : {}),
        salaryAmount: Number(form.baseSalary),
        currency: form.currency.toUpperCase(),
        paymentFrequency: form.paymentFrequency,
        ...(form.terms.trim() ? { terms: form.terms.trim() } : {}),
        createdById: user?.id,
      });
      draft.markSaved();
      onSaved('Contract created as a draft.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to create the contract.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      title="New employment contract"
      subtitle="Choose the employee, then define the agreement and pay."
      size="lg"
      onClose={close}
      footer={
        <>
          <Btn variant="secondary" onClick={close} disabled={saving}>
            Cancel
          </Btn>
          {draft.canRetain && (
            <Btn type="button" variant="secondary" disabled={saving} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn type="submit" form={formId} loading={saving} disabled={blocked}>
            Create draft
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
        {scope.error && (
          <div role="alert" className="workspace-notice">
            {scope.error}{' '}
            <Btn type="button" variant="ghost" onClick={scope.retry}>
              Retry choices
            </Btn>
          </div>
        )}
        {scope.loading && <p role="status">Loading organisation choices…</p>}
        <fieldset disabled={saving || blocked} className="space-y-5">
          <h3 className="text-base font-semibold">Employee and agreement</h3>
          <div className="workspace-form-grid">
            <FormSelect
              label="Company"
              required
              value={form.companyId}
              onChange={(e) =>
                setForm((p) => ({ ...p, companyId: e.target.value, employeeId: '' }))
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
            <FormInput
              label="Contract code"
              value={form.code}
              onChange={f('code')}
              placeholder="Assigned when saved"
              hint="Leave blank to use automatic numbering."
            />
            <FormSelect
              label="Contract type"
              value={form.contractType}
              onChange={f('contractType')}
              options={options(types)}
            />
          </div>
          <h3 className="text-base font-semibold">Dates</h3>
          <div className="workspace-form-grid">
            <FormDateField
              label="Start date"
              required
              value={form.startDate}
              onChange={setValue('startDate')}
            />
            <FormDateField
              label="End date"
              min={form.startDate}
              value={form.endDate}
              onChange={setValue('endDate')}
            />
            <FormDateField
              label="Probation end date"
              min={form.startDate}
              max={form.endDate || undefined}
              value={form.probationEndDate}
              onChange={setValue('probationEndDate')}
            />
          </div>
          <h3 className="text-base font-semibold">Pay and terms</h3>
          <div className="workspace-form-grid">
            <FormInput
              label="Salary amount"
              type="number"
              min="0"
              step="0.01"
              required
              value={form.baseSalary}
              onChange={f('baseSalary')}
            />
            <FormInput
              label="Currency"
              required
              maxLength={3}
              pattern="[A-Za-z]{3}"
              value={form.currency}
              onChange={f('currency')}
            />
            <FormSelect
              label="Payment frequency"
              value={form.paymentFrequency}
              onChange={f('paymentFrequency')}
              options={options(['MONTHLY', 'BIWEEKLY', 'WEEKLY', 'DAILY'])}
            />
          </div>
          <label className="block text-sm">
            Additional terms
            <textarea
              className="workspace-textarea"
              value={form.terms}
              onChange={f('terms')}
              rows={3}
            />
          </label>
        </fieldset>
      </form>
    </Modal>
  );
}
