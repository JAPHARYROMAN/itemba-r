'use client';
import { useId, useRef, useState } from 'react';
import { Btn, FormDateField, FormSelect, Modal } from '@/components/ui';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useAuth } from '@/hooks/use-auth';
import { backendPost, backendPut } from '@/lib/api-client';
import {
  type Assignment,
  type EmployeeChoice,
  type FormState,
  empty,
  employeeName,
  companyName,
  label,
  toForm,
} from './assignment-workflow';
export function AssignmentEditor({
  record: editing,
  source,
  onClose,
  onSaved,
}: {
  record?: Assignment;
  source?: WorkspaceDraft;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const formId = useId(),
    pending = useRef(false);
  const baseline = editing ? toForm(editing) : empty;
  const stateKey = JSON.stringify([
    editing?.updatedAt,
    baseline,
    editing?.approvalStatus,
    editing?.isPrimary,
  ]);
  const draft = useWorkspaceDraftForm<Partial<FormState>>(() => (editing ? {} : { ...empty }), {
    appId: 'payroll',
    title: editing ? 'Edit assignment' : 'New assignment',
    describe: (values) => (editing ? employeeName(editing) : values.notes || 'Employee placement'),
    context: { kind: 'assignment', recordId: editing?.id || '', stateKey },
    draftId: source?.id,
    busy: saving,
    onClose,
    needsReview:
      !!source && !!editing && (!editing.updatedAt || source.context.stateKey !== stateKey),
    reviewKey: stateKey,
  });
  const form: FormState = { ...baseline, ...draft.form };
  const setForm = (change: (previous: FormState) => FormState) => {
    const next = change(form);
    draft.setForm(
      editing
        ? Object.fromEntries(
            Object.entries(next).filter(
              ([key, value]) => value !== baseline[key as keyof FormState],
            ),
          )
        : next,
    );
  };
  const scope = useOrgScope(form.companyId, { skipEmployees: true });
  const canChooseEmployees = hasPermission('employees.view');
  const employees = useWorkspaceChoices<EmployeeChoice>(
    '/hr/employees',
    {},
    !editing && canChooseEmployees && hasPermission('employees.assignments.manage'),
  );
  const employeesError = employees.error;
  const busyChoices = scope.loading || employees.loading;
  const choicesError = [scope.error, employees.error].filter(Boolean).join(' ');
  const retryChoices = () => {
    scope.retry();
    employees.retry();
  };
  const employeeOptions = employees.rows.map((e) => ({
    value: e.id,
    label: [e.fullName || e.employeeCode || e.id, e.company?.name].filter(Boolean).join(' · '),
  }));
  if (editing?.employeeId)
    employeeOptions.push({ value: editing.employeeId, label: employeeName(editing) });
  const branchOptions = scope.branches
    .filter((b) => !form.divisionId || b.divisionId === form.divisionId)
    .map((b) => ({ value: b.id, label: b.name }));
  const permission = hasPermission('employees.assignments.manage');
  const blocked =
    !permission ||
    (!editing && !canChooseEmployees) ||
    busyChoices ||
    !!choicesError ||
    !!draft.availabilityError;
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
    setError('');
    try {
      draft.validateReview();
      await draft.saveNow();
      if (
        !editing &&
        (!employees.rows.some((e) => e.id === form.employeeId) ||
          !scope.companyOptions.some((o) => o.value === form.companyId) ||
          (form.divisionId && !scope.divisionOptions.some((o) => o.value === form.divisionId)))
      )
        throw new Error('Choose an available employee, company and division.');
      if (
        form.branchId &&
        form.branchId !== editing?.branchId &&
        !branchOptions.some((o) => o.value === form.branchId)
      )
        throw new Error('Choose an available branch for this destination.');
      if (!form.startDate || (form.endDate && form.endDate < form.startDate))
        throw new Error('End date must be on or after the start date.');
      if (editing?.approvalStatus?.startsWith('PENDING') && form.status !== baseline.status)
        throw new Error('Use the current status while this transfer awaits approval.');
      const body = {
        assignmentContextType: form.contextType,
        branchId: form.branchId || (editing ? null : undefined),
        startDate: form.startDate,
        endDate: form.endDate || (editing ? null : undefined),
        status: form.status,
        notes: form.notes.trim(),
      };
            setSaving(true);
      if (editing) {
        const changes: Record<string, unknown> = {};
        const mapping = {
          contextType: 'assignmentContextType',
          branchId: 'branchId',
          startDate: 'startDate',
          endDate: 'endDate',
          status: 'status',
          notes: 'notes',
        } as const;
        for (const [field, target] of Object.entries(mapping))
          if (Object.hasOwn(draft.form, field)) changes[target] = body[target];
        if (Object.keys(changes).length)
          await backendPut('/hr/employee-assignments/' + editing.id, changes);
      } else
        await backendPost('/hr/employee-assignments', {
          ...body,
          employeeId: form.employeeId,
          companyId: form.companyId,
          divisionId: form.divisionId || undefined,
        });
      draft.markSaved();
      onSaved(
        editing
          ? 'Assignment updated.'
          : 'Assignment created. Transfers remain pending until approved.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save the assignment.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      title={editing ? 'Edit assignment' : 'New assignment'}
      subtitle="Choose the person and their destination. Company or division transfers require approval."
      size="lg"
      onClose={close}
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
            Save assignment
          </Btn>
        </>
      }
    >
      <form id={formId} onSubmit={submit} {...draft.guard.capture} className="space-y-5">
        <DraftFormNotice draft={draft} />
        {!permission && (
          <p role="alert" className="workspace-notice">
            Your current role cannot save employee assignments. Your draft can still be kept.
          </p>
        )}
        {!editing && !canChooseEmployees && (
          <p role="alert" className="workspace-notice">
            Employee viewing permission is required to choose a person.
          </p>
        )}
        {editing && (
          <div className="workspace-notice">
            Current: {employeeName(editing)} · {companyName(editing)} · {label(editing.status)} ·{' '}
            {label(editing.approvalStatus || 'Approval not recorded')}
          </div>
        )}
        {editing?.approvalStatus?.startsWith('PENDING') && form.status !== baseline.status && (
          <p role="alert" className="workspace-notice">
            This transfer is awaiting approval.{' '}
            <Btn
              type="button"
              variant="ghost"
              onClick={() => setForm((p) => ({ ...p, status: baseline.status }))}
            >
              Use current status
            </Btn>
          </p>
        )}
        {error && (
          <div role="alert" className="workspace-notice">
            {error}
          </div>
        )}
        {choicesError && (
          <div role="alert" className="workspace-notice">
            {choicesError}{' '}
            <Btn type="button" variant="ghost" onClick={retryChoices}>
              Retry choices
            </Btn>
          </div>
        )}
        {busyChoices && <p role="status">Loading organisation choices…</p>}
        {editing && (
          <div className="workspace-notice">
            The employee, company and division stay with this assignment. Create a new assignment to
            record a transfer.
          </div>
        )}
        <fieldset disabled={saving || blocked} className="space-y-5">
          <h3 className="text-base font-semibold">Person and destination</h3>
          <FormSelect
            label="Employee"
            required
            disabled={!!editing || Boolean(employeesError)}
            value={form.employeeId}
            onChange={f('employeeId')}
            options={employeeOptions}
            placeholder="Select employee"
            hint="Choose from employees you can access, including people in other companies."
          />
          <div className="workspace-form-grid">
            <FormSelect
              label="Destination company"
              required
              disabled={!!editing}
              value={form.companyId}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  companyId: e.target.value,
                  divisionId: '',
                  branchId: '',
                }))
              }
              options={scope.companyOptions}
              placeholder="Select company"
            />
            <FormSelect
              label="Division"
              disabled={!!editing || !form.companyId}
              value={form.divisionId}
              onChange={(e) => setForm((p) => ({ ...p, divisionId: e.target.value, branchId: '' }))}
              options={scope.divisionOptions}
              placeholder="No division"
            />
            <FormSelect
              label="Branch"
              disabled={!form.companyId}
              value={form.branchId}
              onChange={f('branchId')}
              options={branchOptions}
              placeholder="No branch"
            />
            <FormSelect
              label="Assignment context"
              value={form.contextType}
              onChange={f('contextType')}
              options={Array.from(
                new Set(['COMPANY', 'DIVISION', 'BRANCH', 'OTHER', form.contextType]),
              ).map((value) => ({ value, label: label(value) }))}
            />
          </div>
          <h3 className="text-base font-semibold">Dates and status</h3>
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
            <FormSelect
              label="Status"
              disabled={Boolean(editing?.approvalStatus?.startsWith('PENDING'))}
              value={form.status}
              onChange={f('status')}
              options={['ACTIVE', 'INACTIVE', 'ENDED'].map((value) => ({
                value,
                label: label(value),
              }))}
              hint={
                editing?.approvalStatus?.startsWith('PENDING')
                  ? 'A pending transfer becomes active through approval.'
                  : undefined
              }
            />
          </div>
          <label className="block text-sm">
            Notes
            <textarea
              className="workspace-textarea"
              rows={3}
              value={form.notes}
              onChange={f('notes')}
            />
          </label>
        </fieldset>
      </form>
    </Modal>
  );
}
