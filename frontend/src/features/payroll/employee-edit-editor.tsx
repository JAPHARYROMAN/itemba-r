'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Btn, FormDateField, FormInput, FormSelect, Modal } from '@/components/ui';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { useAuth } from '@/hooks/use-auth';
import { useRequestGuard } from '@/hooks/use-request-guard';
import { backendGet, backendPut } from '@/lib/api-client';
import type { Employee } from './employee-types';
import {
  employeeEditableFields,
  employeeEditBaseline,
  employeeEditPayload,
  employeeFieldLabels,
  employeeSensitiveFields,
  type EmployeeEditValues,
  type EmployeeField,
  type EmployeeSection,
} from './employee-edit-values';
import '@/components/workspace/workspace.css';
import '@/app/(dashboard)/hr/employees/[id]/employee-profile.css';

interface LinkableUser {
  id: string;
  fullName: string;
  email: string;
}
export const employeeEditTitles: Record<EmployeeSection, string> = {
  profile: 'Edit profile',
  statutory: 'Edit tax & statutory',
  banking: 'Edit bank details',
};

export function EmployeeEditEditor({
  record,
  section,
  source,
  onClose,
  onSaved,
}: {
  record: Employee;
  section: EmployeeSection;
  source?: WorkspaceDraft;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('employees.view') && hasPermission('employees.update');
  const canSensitive =
    hasPermission('employees.sensitive.view') || hasPermission('payroll.sensitive.view');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef(false);
  const formId = useId();
  const baseline = employeeEditBaseline(record, section, canSensitive);
  const title = employeeEditTitles[section];
  const draft = useWorkspaceDraftForm<EmployeeEditValues>(
    {},
    {
      appId: 'payroll',
      title,
      describe: () =>
        `${record.fullName || [record.firstName, record.lastName].join(' ')} · ${record.employeeCode}`,
      context: {
        kind: 'employee-edit',
        section,
        recordId: record.id,
        version: record.updatedAt || '',
      },
      draftId: source?.id,
      needsReview: !!source && (!record.updatedAt || source.context.version !== record.updatedAt),
      reviewKey: record.updatedAt,
      busy,
      onClose,
    },
  );
  const fields = employeeEditableFields(section, canSensitive);
  const edits = Object.fromEntries(
    fields
      .filter((field) => draft.form[field] !== undefined)
      .map((field) => [field, draft.form[field]]),
  ) as EmployeeEditValues;
  const form = { ...baseline, ...edits };
  const restricted =
    !canSensitive && employeeSensitiveFields.some((field) => draft.form[field] !== undefined);
  const [linkableUsers, setLinkableUsers] = useState<LinkableUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false),
    [usersError, setUsersError] = useState('');
  const beginUsersRequest = useRequestGuard();
  const companyId = record.company?.id;
  const loadUsers = useCallback(async () => {
    const request = beginUsersRequest();
    if (section !== 'profile' || !canEdit || !companyId) return;
    setUsersLoading(true);
    setUsersError('');
    try {
      const users = await backendGet<LinkableUser[]>('/hr/employees/linkable-users', {
        query: { companyId, employeeId: record.id },
        signal: request.signal,
      });
      if (request.current()) setLinkableUsers(users);
    } catch (cause) {
      if (request.current())
        setUsersError(cause instanceof Error ? cause.message : 'Unable to load user accounts.');
    } finally {
      if (request.current()) setUsersLoading(false);
    }
  }, [beginUsersRequest, section, canEdit, companyId, record.id]);
  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);
  const changedAccount = section === 'profile' && !!form.userId && form.userId !== baseline.userId;
  const blocked =
    !canEdit ||
    restricted ||
    !!draft.availabilityError ||
    (changedAccount && (usersLoading || !!usersError));
  function change<K extends EmployeeField>(field: K, value: EmployeeEditValues[K]) {
    if (!fields.includes(field)) return;
    draft.guard.touch();
    draft.setForm((previous) => {
      const next = { ...previous, [field]: value };
      if (value === baseline[field]) delete next[field];
      return next;
    });
  }
  const setValue = (field: Exclude<EmployeeField, 'heslbBorrower'>) => (value: string) =>
    change(field, value);
  const ff =
    (field: Exclude<EmployeeField, 'heslbBorrower'>) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValue(field)(event.target.value);
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || blocked) return;
    pending.current = true;
    setError('');
    try {
      draft.validateReview();
      await draft.saveNow();
      if (changedAccount && !linkableUsers.some((user) => user.id === form.userId))
        throw new Error(
          'The selected user account is no longer available. Choose an eligible account or remove the link.',
        );
      const payload = employeeEditPayload(record, section, edits, canSensitive);
      if (!Object.keys(payload).length) {
        draft.markSaved();
        onClose();
        return;
      }
            setBusy(true);
      await backendPut(`/hr/employees/${encodeURIComponent(record.id)}`, payload);
      draft.markSaved();
      onSaved('Employee details updated.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save these employee details.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      size="lg"
      title={title}
      subtitle={`${record.fullName || record.employeeCode} · ${record.company?.name || 'Employee details'}`}
      onClose={close}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Btn>
          {draft.canRetain && canEdit && !restricted && (
            <Btn variant="secondary" disabled={busy} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn variant="primary" type="submit" form={formId} loading={busy} disabled={blocked}>
            {section === 'banking' ? 'Save bank details' : 'Save'}
          </Btn>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-5" {...draft.guard.capture}>
        <DraftFormNotice draft={draft}>
          <p>Latest employee: {record.fullName || record.employeeCode}</p>
          <dl className="grid gap-3 sm:grid-cols-2 mt-3">
            {fields
              .filter((field) => edits[field] !== undefined)
              .map((field) => (
                <div key={field}>
                  <dt className="text-xs">Current {employeeFieldLabels[field].toLowerCase()}</dt>
                  <dd className="whitespace-pre-wrap break-words">
                    {field === 'userId'
                      ? linkableUsers.find((user) => user.id === baseline.userId)?.fullName ||
                        (baseline.userId ? 'Linked account' : 'No linked account')
                      : field === 'heslbBorrower'
                        ? baseline[field]
                          ? 'Yes'
                          : 'No'
                        : baseline[field] || 'Not set'}
                  </dd>
                </div>
              ))}
          </dl>
        </DraftFormNotice>
        {(!canEdit || restricted) && (
          <p role="alert" className="workspace-notice">
            Your current role cannot edit these employee details.
          </p>
        )}
        {usersError && (
          <div role="alert" className="workspace-notice">
            {usersError} You can still save other profile changes without changing the linked
            account.
            <Btn type="button" variant="ghost" onClick={() => void loadUsers()}>
              Retry user accounts
            </Btn>
          </div>
        )}
        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
        <fieldset
          disabled={busy || !canEdit || restricted || !!draft.availabilityError}
          className="space-y-5"
        >
          {section === 'profile' && (
            <div className="workspace-form-grid">
              <h3 className="employee-form-wide text-base font-semibold">Personal details</h3>
              <FormInput
                label="First Name"
                value={form.firstName ?? ''}
                onChange={ff('firstName')}
                required
              />
              <FormInput
                label="Middle Name"
                value={form.middleName ?? ''}
                onChange={ff('middleName')}
              />
              <FormInput
                label="Last Name"
                value={form.lastName ?? ''}
                onChange={ff('lastName')}
                required
              />
              <FormSelect
                label="Gender"
                value={form.gender ?? 'NOT_SPECIFIED'}
                onChange={ff('gender')}
                options={[
                  { value: 'NOT_SPECIFIED', label: 'Not specified' },
                  { value: 'MALE', label: 'Male' },
                  { value: 'FEMALE', label: 'Female' },
                ]}
              />
              <FormDateField
                label="Date of Birth"
                value={form.dateOfBirth?.slice(0, 10) ?? ''}
                onChange={setValue('dateOfBirth')}
              />
              <FormInput
                label="Nationality"
                value={form.nationality ?? ''}
                onChange={ff('nationality')}
              />
              <h3 className="employee-form-wide text-base font-semibold">Contact</h3>
              <FormInput
                label="Email"
                type="email"
                value={form.email ?? ''}
                onChange={ff('email')}
              />
              <FormInput label="Phone" value={form.phone ?? ''} onChange={ff('phone')} />
              <div className="employee-form-wide">
                <FormInput label="Address" value={form.address ?? ''} onChange={ff('address')} />
              </div>
              <FormInput
                label="Emergency contact name"
                value={form.emergencyContactName ?? ''}
                onChange={ff('emergencyContactName')}
              />
              <FormInput
                label="Emergency contact phone"
                value={form.emergencyContactPhone ?? ''}
                onChange={ff('emergencyContactPhone')}
              />
              <h3 className="employee-form-wide text-base font-semibold">Account access</h3>
              <FormSelect
                label="User account"
                disabled={usersLoading}
                value={form.userId ?? ''}
                onChange={(event) => change('userId', event.target.value)}
                options={[
                  ...(form.userId &&
                  form.userId === record.userId &&
                  !linkableUsers.some((user) => user.id === form.userId)
                    ? [{ value: form.userId, label: 'Current linked account' }]
                    : []),
                  ...(form.userId &&
                  form.userId !== record.userId &&
                  !linkableUsers.some((user) => user.id === form.userId)
                    ? [{ value: form.userId, label: 'Previously selected account — choose again' }]
                    : []),
                  ...linkableUsers.map((user) => ({
                    value: user.id,
                    label: `${user.fullName} (${user.email})`,
                  })),
                ]}
                placeholder="No linked user account"
                hint="Link an active account to make this employee eligible for Mobile POS"
              />
              <h3 className="employee-form-wide text-base font-semibold">Employment</h3>
              <FormSelect
                label="Status"
                value={form.employmentStatus ?? 'ACTIVE'}
                onChange={ff('employmentStatus')}
                options={[
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'ON_LEAVE', label: 'On Leave' },
                  { value: 'SUSPENDED', label: 'Suspended' },
                  ...(record.employmentStatus === 'TERMINATED'
                    ? [{ value: 'TERMINATED', label: 'Terminated' }]
                    : []),
                  { value: 'RESIGNED', label: 'Resigned' },
                  { value: 'INACTIVE', label: 'Inactive' },
                ]}
              />
              <FormDateField
                label="Termination date"
                value={form.terminationDate?.slice(0, 10) ?? ''}
                onChange={setValue('terminationDate')}
              />
              <FormInput
                label={`Base salary (${record.salaryCurrency || 'TZS'})`}
                required
                disabled={!canSensitive}
                min="0"
                type="number"
                step="0.01"
                value={form.baseSalary != null ? String(form.baseSalary) : ''}
                onChange={ff('baseSalary')}
              />
              <FormSelect
                label="Payment frequency"
                value={form.paymentFrequency ?? 'MONTHLY'}
                onChange={ff('paymentFrequency')}
                options={[
                  { value: 'MONTHLY', label: 'Monthly' },
                  { value: 'BIWEEKLY', label: 'Biweekly' },
                  { value: 'WEEKLY', label: 'Weekly' },
                  { value: 'DAILY', label: 'Daily' },
                ]}
              />
            </div>
          )}

          {section === 'statutory' && (
            <div className="workspace-form-grid">
              <h3 className="employee-form-wide text-base font-semibold">Identity</h3>
              <FormInput
                label="NIDA #"
                value={form.nidaNumber ?? ''}
                onChange={ff('nidaNumber')}
                hint="20 digits"
              />
              <FormInput
                label="Voter ID"
                value={form.votersIdNumber ?? ''}
                onChange={ff('votersIdNumber')}
              />
              <FormInput
                label="Passport"
                value={form.passportNumber ?? ''}
                onChange={ff('passportNumber')}
              />
              <FormInput
                label="Passport country"
                value={form.passportCountry ?? ''}
                onChange={ff('passportCountry')}
              />
              <FormInput
                label="TIN"
                disabled={!canSensitive}
                value={form.tin ?? ''}
                onChange={ff('tin')}
              />
              <FormSelect
                label="Tax residency"
                value={form.taxResidencyStatus ?? 'RESIDENT'}
                onChange={ff('taxResidencyStatus')}
                options={[
                  { value: 'RESIDENT', label: 'Resident' },
                  { value: 'NON_RESIDENT', label: 'Non-resident (flat 15%)' },
                ]}
              />
              <FormSelect
                label="Payroll region"
                value={form.payrollRegion ?? 'MAINLAND'}
                onChange={ff('payrollRegion')}
                options={[
                  { value: 'MAINLAND', label: 'Mainland' },
                  { value: 'ZANZIBAR', label: 'Zanzibar' },
                ]}
              />
              <FormInput
                label="Dependents"
                required
                min="0"
                step="1"
                type="number"
                value={form.dependents != null ? String(form.dependents) : '0'}
                onChange={ff('dependents')}
              />
              <FormSelect
                label="Disability status"
                value={form.disabilityStatus ?? 'NONE'}
                onChange={ff('disabilityStatus')}
                options={[
                  { value: 'NONE', label: 'None' },
                  { value: 'REGISTERED', label: 'Registered' },
                  { value: 'REGISTERED_PWD_CERTIFIED', label: 'PWD-certified (relief)' },
                ]}
              />
              <FormInput
                label="PWD certificate #"
                value={form.disabilityCertificateNo ?? ''}
                onChange={ff('disabilityCertificateNo')}
              />
              <FormInput
                label="NSSF #"
                disabled={!canSensitive}
                value={form.nssfNumber ?? ''}
                onChange={ff('nssfNumber')}
              />
              <FormInput
                label="PSSSF #"
                value={form.pssfNumber ?? ''}
                onChange={ff('pssfNumber')}
              />
              <FormInput
                label="NHIF #"
                disabled={!canSensitive}
                value={form.nhifNumber ?? ''}
                onChange={ff('nhifNumber')}
              />
              <FormInput
                label="WCF #"
                value={form.wcfRegistrationNumber ?? ''}
                onChange={ff('wcfRegistrationNumber')}
              />
              <FormInput
                label="HESLB #"
                value={form.heslbNumber ?? ''}
                onChange={ff('heslbNumber')}
              />
              <div className="flex items-center gap-2 pt-7">
                <input
                  aria-label="Active HESLB borrower (15% deduction)"
                  id={`${formId}-heslb`}
                  type="checkbox"
                  checked={!!form.heslbBorrower}
                  onChange={(e) => change('heslbBorrower', e.target.checked)}
                  className="rounded"
                />
                <label
                  htmlFor={`${formId}-heslb`}
                  className="text-sm"
                  style={{ color: 'var(--aurora-text)' }}
                >
                  Active HESLB borrower (15% deduction)
                </label>
              </div>
            </div>
          )}

          {section === 'banking' && (
            <div className="workspace-form-grid">
              <FormInput
                label="Bank name"
                disabled={!canSensitive}
                value={form.bankName ?? ''}
                onChange={ff('bankName')}
              />
              <FormInput
                label="Account name"
                value={form.bankAccountName ?? ''}
                onChange={ff('bankAccountName')}
              />
              <FormInput
                label="Account number"
                disabled={!canSensitive}
                value={form.bankAccountNumber ?? ''}
                onChange={ff('bankAccountNumber')}
              />
              <FormInput
                label="Mobile money number"
                value={form.mobileMoneyNumber ?? ''}
                onChange={ff('mobileMoneyNumber')}
              />
            </div>
          )}

          {section === 'profile' && (
            <p className="text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
              Use Request Termination on the employee profile when ending employment through the
              approval workflow.
            </p>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
