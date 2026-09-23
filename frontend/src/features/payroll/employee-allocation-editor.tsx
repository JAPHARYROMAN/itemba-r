'use client';
import { useId, useRef, useState } from 'react';
import { Btn, FormDateField, FormInput, FormSelect, Modal } from '@/components/ui';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { payrollLabel, payrollMoney } from '@/components/workspace/payroll-types';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useAuth } from '@/hooks/use-auth';
import { backendPost, backendPut } from '@/lib/api-client';
import {
  type Kind,
  type Company,
  type Employee,
  type Allocation,
  type AllocationType,
  toForm,
  employeeName,
  typeOf,
  typeId,
  dateLabel,
  statuses,
} from './allocation-types';

export function AllocationEditor({
  kind,
  record,
  source,
  onClose,
  onSaved,
}: {
  kind: Kind;
  record?: Allocation;
  source?: WorkspaceDraft;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef(false);
  const formId = useId();
  const baseline = toForm(kind, record);
  const draft = useWorkspaceDraftForm(() => toForm(kind, record), {
    appId: 'payroll',
    title: (record ? 'Edit ' : 'New ') + kind,
    describe: (values) => (record ? employeeName(record) : values.notes || 'Employee allocation'),
    context: { kind, recordId: record?.id || '', version: record?.updatedAt || '' },
    draftId: source?.id,
    needsReview:
      !!source && !!record && (!record.updatedAt || source.context.version !== record.updatedAt),
    reviewKey: record?.updatedAt,
    busy,
    onClose,
  });
  const { form, setForm } = draft;
  const canChooseEmployee = hasPermission('employees.view');
  const companies = useWorkspaceChoices<Company>('/companies', {});
  const employees = useWorkspaceChoices<Employee>(
    '/hr/employees',
    { companyId: form.companyId },
    canChooseEmployee && !!form.companyId,
  );
  const types = useWorkspaceChoices<AllocationType>(
    '/hr/' + kind + '-types',
    { companyId: form.companyId },
    !!form.companyId,
  );
  const sameEmployee =
    !!record && form.companyId === record.companyId && form.employeeId === record.employeeId;
  const sameType =
    !!record && form.companyId === record.companyId && form.typeId === typeId(record, kind);
  const blocked =
    !hasPermission(kind + 's.manage') ||
    !!draft.availabilityError ||
    [companies, employees, types].some((c) => c.loading || !!c.error) ||
    (!canChooseEmployee && !sameEmployee);
  const employeeOptions = employees.rows.map((e) => ({
    value: e.id,
    label: e.fullName + ' · ' + e.employeeCode,
  }));
  if (sameEmployee && !employeeOptions.some((e) => e.value === record.employeeId))
    employeeOptions.push({ value: record.employeeId, label: employeeName(record) + ' · current' });
  const typeOptions = types.rows.map((t) => ({
    value: t.id,
    label: t.name + ' · ' + t.code + (t.isActive === false ? ' (inactive)' : ''),
  }));
  if (sameType && !typeOptions.some((t) => t.value === form.typeId))
    typeOptions.push({
      value: form.typeId,
      label: (typeOf(record, kind)?.name || 'Existing type') + ' · current',
    });
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const setValue = (key: keyof typeof form) => (value: string) =>
    setForm((p) => ({ ...p, [key]: value }));
  const f =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setValue(key)(e.target.value);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending.current || blocked || !hasPermission(kind + 's.manage')) return;
    pending.current = true;
    try {
      draft.validateReview();
      await draft.saveNow();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review this draft before saving.');
      pending.current = false;
      return;
    }
    if (
      !companies.rows.some((company) => company.id === form.companyId) ||
      !(sameEmployee || employees.rows.some((r) => r.id === form.employeeId)) ||
      !(sameType || types.rows.some((r) => r.id === form.typeId))
    ) {
      setError('Choose a company, employee and allocation type.');
      pending.current = false;
      return;
    }
    if (!form.effectiveFrom || (form.effectiveTo && form.effectiveTo < form.effectiveFrom)) {
      setError('Choose a start date and an end date on or after it.');
      pending.current = false;
      return;
    }
    if (
      (kind === 'allowance' && form.amount === '') ||
      [form.amount, ...(kind === 'deduction' ? [form.percentage] : [])].some(
        (v) => v !== '' && !Number.isFinite(Number(v)),
      )
    ) {
      setError('Enter a valid amount and percentage where applicable.');
      pending.current = false;
      return;
    }
    const values: Record<string, string | number | null> = {
      companyId: form.companyId,
      employeeId: form.employeeId,
      [kind + 'TypeId']: form.typeId,
      effectiveFrom: form.effectiveFrom,
      status: form.status,
    };
    const numericKeys: ('amount' | 'percentage')[] =
      kind === 'allowance' ? ['amount'] : ['amount', 'percentage'];
    for (const key of numericKeys)
      if (record || form[key] !== '') values[key] = form[key] === '' ? null : Number(form[key]);
    if (record || form.effectiveTo) values.effectiveTo = form.effectiveTo || null;
    if (record || form.notes.trim()) values.notes = form.notes.trim() || null;
    const payload = record
      ? Object.fromEntries(
          Object.entries(values).filter(([key]) => {
            const field = key === kind + 'TypeId' ? 'typeId' : (key as keyof typeof form);
            return form[field] !== baseline[field];
          }),
        )
      : values;
    if (record && !Object.keys(payload).length) {
      draft.markSaved();
      onClose();
      pending.current = false;
      return;
    }
    setBusy(true);
    setError('');
    try {
      const path = '/hr/employee-' + kind + 's';
      if (record) await backendPut(path + '/' + record.id, payload);
      else await backendPost(path, payload);
      draft.markSaved();
      onSaved('Employee ' + kind + ' saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this allocation.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      size="lg"
      title={(record ? 'Edit ' : 'New ') + kind}
      subtitle={
        record
          ? employeeName(record) + ' · ' + (typeOf(record, kind)?.name || 'Allocation')
          : 'Choose an employee and configure their allocation.'
      }
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
          <Btn variant="primary" type="submit" form={formId} loading={busy} disabled={blocked}>
            Save allocation
          </Btn>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-5" {...draft.guard.capture}>
        <DraftFormNotice draft={draft}>
          {record && (
            <div>
              <p>
                Current allocation: {employeeName(record)} ·{' '}
                {typeOf(record, kind)?.name || 'Type unavailable'} ·{' '}
                {record.amount == null ? 'Amount not set' : payrollMoney(record.amount)} ·{' '}
                {payrollLabel(record.status)} · {dateLabel(record.effectiveFrom)} to{' '}
                {dateLabel(record.effectiveTo)}
              </p>
              <dl className="grid gap-3 sm:grid-cols-2 mt-3">
                <div>
                  <dt className="text-xs">Current company</dt>
                  <dd>{record.company?.name || 'Company unavailable'}</dd>
                </div>
                {kind === 'deduction' && (
                  <div>
                    <dt className="text-xs">Current percentage</dt>
                    <dd>{record.percentage == null ? 'Not set' : `${record.percentage}%`}</dd>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <dt className="text-xs">Current notes</dt>
                  <dd className="whitespace-pre-wrap break-words">{record.notes || 'No notes'}</dd>
                </div>
              </dl>
            </div>
          )}
        </DraftFormNotice>
        {!canChooseEmployee && (
          <p role={sameEmployee ? 'status' : 'alert'} className="workspace-notice">
            Employee selection requires employee viewing permission.
            {sameEmployee ? ' You can still edit this existing allocation.' : ''}
          </p>
        )}
        {[companies, employees, types].map(
          (choices, i) =>
            choices.error && (
              <div role="alert" className="workspace-notice" key={i}>
                {choices.error}{' '}
                <Btn type="button" variant="ghost" onClick={choices.retry}>
                  Retry {['companies', 'employees', 'types'][i]}
                </Btn>
              </div>
            ),
        )}
        {[companies, employees, types].some((c) => c.loading) && (
          <p role="status">Loading allocation choices…</p>
        )}
        <fieldset
          disabled={busy || !hasPermission(kind + 's.manage') || !!draft.availabilityError}
          className="space-y-5"
        >
          <h3 className="font-semibold">Employee and category</h3>
          <FormSelect
            label="Company"
            required
            value={form.companyId}
            disabled={companies.loading || !canChooseEmployee}
            onChange={(e) =>
              setForm((p) => ({ ...p, companyId: e.target.value, employeeId: '', typeId: '' }))
            }
            options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Select company"
          />
          <div className="workspace-form-grid">
            <FormSelect
              label="Employee"
              required
              value={form.employeeId}
              onChange={f('employeeId')}
              disabled={!form.companyId || employees.loading || !canChooseEmployee}
              options={employeeOptions}
              placeholder="Select employee"
            />
            <FormSelect
              label={kind === 'allowance' ? 'Allowance type' : 'Deduction type'}
              required
              value={form.typeId}
              onChange={f('typeId')}
              disabled={!form.companyId || types.loading}
              options={typeOptions}
              placeholder="Select type"
            />
          </div>
          <h3 className="font-semibold">Amount and dates</h3>
          <div className="workspace-form-grid">
            <FormInput
              label="Amount (TZS)"
              required={kind === 'allowance'}
              type="number"
              step="0.01"
              value={form.amount}
              onChange={f('amount')}
            />
            {kind === 'deduction' && (
              <FormInput
                label="Percentage (%)"
                type="number"
                step="0.01"
                value={form.percentage}
                onChange={f('percentage')}
              />
            )}
            <FormDateField
              label="Effective from"
              required
              value={form.effectiveFrom}
              onChange={setValue('effectiveFrom')}
            />
            <FormDateField
              label="Effective to (optional)"
              value={form.effectiveTo}
              onChange={setValue('effectiveTo')}
            />
          </div>
          {kind === 'deduction' && (
            <p className="workspace-notice">
              The current payroll calculation uses the fixed amount for manual deductions. A
              percentage alone does not produce a calculated deduction; statutory deductions use the
              statutory calculator.
            </p>
          )}
          <FormSelect
            label="Status"
            value={form.status}
            onChange={f('status')}
            options={statuses}
          />
          <p className="workspace-notice">
            Payroll currently selects Active allocations without applying the recorded date range.
            Set the status to Inactive or Expired to exclude this allocation from new calculations.
            Saving does not recalculate an existing run.
          </p>
          <label className="block text-sm">
            Notes (optional)
            <textarea
              rows={3}
              className="workspace-textarea"
              value={form.notes}
              onChange={f('notes')}
            />
          </label>
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
