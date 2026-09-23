'use client';
import { useId, useRef, useState } from 'react';
import { Modal, Btn, FormInput, FormSelect } from '@/components/ui';
import { backendPost } from '@/lib/api-client';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useAuth } from '@/hooks/use-auth';
import { useLeaveTypes } from '@/hooks/use-leave-types';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import '@/components/workspace/workspace.css';

export interface LeaveBalanceRecord {
  updatedAt?: string;
  id: string;
  companyId: string;
  employeeId: string;
  leaveTypeId: string;
  year: number;
  allocatedDays?: number | string | null;
  carriedForwardDays?: number | string | null;
  usedDays?: number | string | null;
  notes?: string | null;
  company?: { id: string; name: string } | null;
  employee?: { id: string; fullName?: string | null; employeeCode?: string | null } | null;
  leaveType?: { id: string; name: string; code?: string | null } | null;
}
interface EmployeeOption {
  id: string;
  fullName?: string | null;
  employeeCode?: string | null;
}
interface Props {
  initial?: LeaveBalanceRecord;
  source?: WorkspaceDraft;
  onClose: () => void;
  onSaved: (message: string) => void;
}
interface FormState {
  companyId: string;
  employeeId: string;
  leaveTypeId: string;
  year: string;
  allocatedDays: string;
  carriedForwardDays: string;
  notes: string;
}
const formFor = (initial?: LeaveBalanceRecord): FormState =>
  initial
    ? {
        companyId: initial.companyId,
        employeeId: initial.employeeId,
        leaveTypeId: initial.leaveTypeId,
        year: String(initial.year),
        allocatedDays: initial.allocatedDays == null ? '' : String(initial.allocatedDays),
        carriedForwardDays:
          initial.carriedForwardDays == null ? '' : String(initial.carriedForwardDays),
        notes: initial.notes || '',
      }
    : {
        companyId: '',
        employeeId: '',
        leaveTypeId: '',
        year: String(new Date().getFullYear()),
        allocatedDays: '',
        carriedForwardDays: '',
        notes: '',
      };
export function AllocationModal({ initial, source, onClose, onSaved }: Props) {
  const { hasPermission } = useAuth();
  const pending = useRef(false),
    formId = useId();
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const baseline = formFor(initial);
  const stateKey = JSON.stringify([initial?.updatedAt, baseline, initial?.usedDays]);
  const draft = useWorkspaceDraftForm<Partial<FormState>>(() => (initial ? {} : baseline), {
    appId: 'payroll',
    title: initial ? 'Adjust leave allocation' : 'Allocate leave balance',
    describe: (values) => initial?.employee?.fullName || values.notes || 'Leave allocation',
    context: { kind: 'leave-balance', recordId: initial?.id || '', stateKey },
    draftId: source?.id,
    busy: saving,
    onClose,
    needsReview:
      !!source && !!initial && (!initial.updatedAt || source.context.stateKey !== stateKey),
    reviewKey: stateKey,
  });
  const form: FormState = { ...baseline, ...draft.form };
  const setForm = (change: (previous: FormState) => FormState) => {
    const next = change(form);
    draft.setForm(
      initial
        ? Object.fromEntries(
            Object.entries(next).filter(
              ([key, value]) => value !== baseline[key as keyof FormState],
            ),
          )
        : next,
    );
  };
  const permission = hasPermission('leave_balances.view') && hasPermission('leave_balances.manage');
  const canChoose = hasPermission('employees.view') && hasPermission('leave_types.view');
  const scope = useOrgScope(undefined, {
    skipEmployees: true,
    skipDivisions: true,
    skipBranches: true,
  });
  const types = useLeaveTypes(form.companyId, !initial && permission && canChoose);
  const employees = useWorkspaceChoices<EmployeeOption>(
    '/hr/employees',
    { companyId: form.companyId },
    !initial && !!form.companyId && permission && canChoose,
  );
  const choicesLoading = !initial && (scope.loading || employees.loading || types.loading);
  const choicesError = !initial && (scope.error || employees.error || types.error);
  const blocked =
    !permission ||
    (!initial && !canChoose) ||
    !!draft.availabilityError ||
    !!choicesLoading ||
    !!choicesError;
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const set = (key: keyof FormState, value: string) => setForm((f) => ({ ...f, [key]: value }));
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
    if (!form.companyId || !form.employeeId || !form.leaveTypeId || !form.year) {
      setError('Company, employee, leave type and year are required');
      pending.current = false;
      return;
    }
    if (
      !initial &&
      (!scope.companyOptions.some((o) => o.value === form.companyId) ||
        !employees.rows.some((e) => e.id === form.employeeId) ||
        !types.rows.some((t) => t.id === form.leaveTypeId && t.isActive !== false))
    ) {
      setError('Choose an available company, employee and active leave type.');
      pending.current = false;
      return;
    }
    if (
      !Number.isInteger(Number(form.year)) ||
      Number(form.year) < 2000 ||
      Number(form.year) > 2100
    ) {
      setError('Enter a whole year from 2000 to 2100.');
      pending.current = false;
      return;
    }
    if (
      [form.allocatedDays, form.carriedForwardDays].some(
        (v) => v !== '' && (!Number.isFinite(Number(v)) || Number(v) < 0),
      )
    ) {
      setError('Allocation and carry forward must be zero or more.');
      pending.current = false;
      return;
    }
        setSaving(true);
    setError('');
    try {
      await backendPost('/hr/leave-balances', {
        companyId: form.companyId,
        employeeId: form.employeeId,
        leaveTypeId: form.leaveTypeId,
        year: Number(form.year),
        allocatedDays:
          (initial && !Object.hasOwn(draft.form, 'allocatedDays')) || form.allocatedDays === ''
            ? undefined
            : Number(form.allocatedDays),
        carriedForwardDays:
          (initial && !Object.hasOwn(draft.form, 'carriedForwardDays')) ||
          form.carriedForwardDays === ''
            ? undefined
            : Number(form.carriedForwardDays),
        notes:
          initial && !Object.hasOwn(draft.form, 'notes')
            ? undefined
            : form.notes.trim() || (initial ? '' : undefined),
      });
      draft.markSaved();
      onSaved('Leave allocation saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save allocation');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  const prospective =
    Number(form.allocatedDays === '' ? initial?.allocatedDays || 0 : form.allocatedDays) +
    Number(
      form.carriedForwardDays === '' ? initial?.carriedForwardDays || 0 : form.carriedForwardDays,
    ) -
    Number(initial?.usedDays || 0);
  return (
    <Modal
      open
      onClose={close}
      title={initial ? 'Adjust allocation' : 'Allocate leave balance'}
      subtitle="Set the annual allocation without changing recorded usage."
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
          <Btn loading={saving} disabled={blocked} onClick={() => void submit()}>
            Save
          </Btn>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        {...draft.guard.capture}
        className="space-y-5"
      >
        <DraftFormNotice draft={draft} />
        {!permission && (
          <p role="alert" className="workspace-notice">
            Your current role cannot save leave allocations. Your draft can still be kept.
          </p>
        )}
        {!initial && !canChoose && (
          <p role="alert" className="workspace-notice">
            Employee and leave-type viewing permissions are required to allocate leave.
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
            <Btn
              type="button"
              variant="ghost"
              onClick={() => {
                scope.retry();
                employees.retry();
                types.retry();
              }}
            >
              Retry choices
            </Btn>
          </div>
        )}
        {choicesLoading && <p role="status">Loading allocation choices…</p>}
        <fieldset disabled={saving || blocked} className="space-y-5">
          <h3 className="text-base font-semibold">Person and allowance</h3>
          {initial ? (
            <div className="workspace-notice workspace-form-grid">
              <div>
                <span className="block text-xs">Company</span>
                {initial.company?.name || initial.companyId}
              </div>
              <div>
                <span className="block text-xs">Employee</span>
                {initial.employee?.fullName || initial.employee?.employeeCode || initial.employeeId}
              </div>
              <div>
                <span className="block text-xs">Leave type</span>
                {initial.leaveType?.name || initial.leaveTypeId}
              </div>
              <div>
                <span className="block text-xs">Year · used days</span>
                {initial.year} · {Number(initial.usedDays || 0)} used
              </div>
            </div>
          ) : (
            <>
              <FormSelect
                label="Company"
                aria-label="Company"
                required
                value={form.companyId}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    companyId: e.target.value,
                    employeeId: '',
                    leaveTypeId: '',
                  }))
                }
                options={scope.companyOptions}
                placeholder="Select company"
              />
              <div className="workspace-form-grid">
                <FormSelect
                  label="Employee"
                  aria-label="Employee"
                  required
                  disabled={!form.companyId || Boolean(employees.error)}
                  value={form.employeeId}
                  onChange={(e) => set('employeeId', e.target.value)}
                  options={employees.rows.map((e) => ({
                    value: e.id,
                    label: e.fullName || e.employeeCode || e.id,
                  }))}
                  placeholder={form.companyId ? 'Select employee' : 'Select company first'}
                />
                <FormSelect
                  label="Leave type"
                  aria-label="Leave Type"
                  required
                  disabled={!form.companyId || Boolean(types.error)}
                  value={form.leaveTypeId}
                  onChange={(e) => set('leaveTypeId', e.target.value)}
                  options={types.rows
                    .filter((t) => t.isActive !== false)
                    .map((t) => ({
                      value: t.id,
                      label: t.name + (t.isActive === false ? ' (inactive)' : ''),
                    }))}
                  placeholder={form.companyId ? 'Select leave type' : 'Select company first'}
                />
                <FormInput
                  label="Year"
                  aria-label="Year"
                  type="number"
                  min={2000}
                  max={2100}
                  required
                  value={form.year}
                  onChange={(e) => set('year', e.target.value)}
                />
              </div>
            </>
          )}
          <h3 className="text-base font-semibold">Days</h3>
          <div className="workspace-form-grid">
            <FormInput
              label="Allocated days"
              aria-label="Allocated Days"
              type="number"
              min={0}
              step="0.01"
              value={form.allocatedDays}
              onChange={(e) => set('allocatedDays', e.target.value)}
              hint="The total allocation, not additional days."
            />
            <FormInput
              label="Carried forward days"
              aria-label="Carried Forward Days"
              type="number"
              min={0}
              step="0.01"
              value={form.carriedForwardDays}
              onChange={(e) => set('carriedForwardDays', e.target.value)}
            />
          </div>
          <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
            Blank amounts keep an existing value, or use zero for a new balance. Saving updates the
            balance for this employee, leave type and year.
          </p>
          {initial && Number.isFinite(prospective) && (
            <div className="workspace-notice">
              Remaining after this adjustment:{' '}
              {prospective.toLocaleString('en-GB', { maximumFractionDigits: 2 })} days. Used days
              stay unchanged.
            </div>
          )}
          <label className="block text-sm">
            Notes
            <textarea
              aria-label="Notes"
              rows={3}
              className="workspace-textarea"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </label>
        </fieldset>
      </form>
    </Modal>
  );
}
