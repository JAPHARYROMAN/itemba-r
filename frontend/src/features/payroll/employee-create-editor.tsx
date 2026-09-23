'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Btn, FormDateField, FormInput, FormSelect, Modal, showToast } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useOrgScope } from '@/hooks/use-org-scope';
import { backendAllPages } from '@/lib/backend-all-pages';
import { backendGet, backendPost } from '@/lib/api-client';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';

interface Department {
  id: string;
  name: string;
  code: string;
  companyId?: string;
}
interface Position {
  id: string;
  title: string;
  companyId?: string;
  departmentId?: string;
}
interface LinkableUser {
  id: string;
  fullName: string;
  email: string;
}

interface FormState {
  // Org
  companyId: string;
  branchId: string;
  departmentId: string;
  positionId: string;
  userId: string;
  // Person
  employeeCode: string;
  firstName: string;
  middleName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  nationality: string;
  // Contact
  email: string;
  phone: string;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  // Identity (TZ)
  nidaNumber: string;
  passportNumber: string;
  passportCountry: string;
  votersIdNumber: string;
  // Tax & statutory
  tin: string;
  nssfNumber: string;
  nhifNumber: string;
  pssfNumber: string;
  wcfRegistrationNumber: string;
  heslbNumber: string;
  heslbBorrower: boolean;
  taxResidencyStatus: string;
  disabilityStatus: string;
  disabilityCertificateNo: string;
  dependents: string;
  payrollRegion: string;
  // Payment
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  mobileMoneyNumber: string;
  // Employment
  employmentType: string;
  employmentStatus: string;
  hireDate: string;
  baseSalary: string;
  paymentFrequency: string;
}

const blank: FormState = {
  companyId: '',
  branchId: '',
  departmentId: '',
  positionId: '',
  userId: '',
  employeeCode: '',
  firstName: '',
  middleName: '',
  lastName: '',
  gender: 'NOT_SPECIFIED',
  dateOfBirth: '',
  nationality: 'Tanzanian',
  email: '',
  phone: '',
  address: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  nidaNumber: '',
  passportNumber: '',
  passportCountry: '',
  votersIdNumber: '',
  tin: '',
  nssfNumber: '',
  nhifNumber: '',
  pssfNumber: '',
  wcfRegistrationNumber: '',
  heslbNumber: '',
  heslbBorrower: false,
  taxResidencyStatus: 'RESIDENT',
  disabilityStatus: 'NONE',
  disabilityCertificateNo: '',
  dependents: '0',
  payrollRegion: 'MAINLAND',
  bankName: '',
  bankAccountName: '',
  bankAccountNumber: '',
  mobileMoneyNumber: '',
  employmentType: 'FULL_TIME',
  employmentStatus: 'ACTIVE',
  hireDate: '',
  baseSalary: '',
  paymentFrequency: 'MONTHLY',
};

export function EmployeeCreateEditor({
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
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('employees.create');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [nextCodePreview, setNextCodePreview] = useState('');
  const formId = useId();
  const draft = useWorkspaceDraftForm(() => ({ ...blank, companyId }), {
    appId: 'payroll',
    title: 'New employee',
    describe: (values) => [values.firstName, values.lastName].filter(Boolean).join(' '),
    context: (values) => ({ kind: 'employee', companyId: values.companyId }),
    draftId: source?.id,
    busy: saving,
    onClose,
  });
  const { form, setForm } = draft;
  const {
    companies,
    branches,
    loading: orgLoading,
    error: orgError,
    companiesError,
    retry: retryOrg,
  } = useOrgScope(form.companyId, { skipEmployees: true, skipDivisions: true });
  const closeCreate = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const [choicesLoading, setChoicesLoading] = useState(false);
  const [choicesError, setChoicesError] = useState('');
  const [failedChoices, setFailedChoices] = useState<string[]>([]);
  const [choicesRevision, setChoicesRevision] = useState(0);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [linkableUsers, setLinkableUsers] = useState<LinkableUser[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    setDepartments([]);
    setPositions([]);
    setLinkableUsers([]);
    setChoicesError('');
    setFailedChoices([]);
    setNextCodePreview('');
    if (!form.companyId || !canCreate) {
      setChoicesLoading(false);
      return () => controller.abort();
    }
    setChoicesLoading(true);
    const companyId = form.companyId;
    void Promise.allSettled([
      backendAllPages<Department>('/hr/departments', { companyId }, controller.signal),
      backendAllPages<Position>('/hr/positions', { companyId }, controller.signal),
      backendGet<LinkableUser[]>('/hr/employees/linkable-users', {
        query: { companyId },
        signal: controller.signal,
      }),
    ]).then(([departments, positions, users]) => {
      if (controller.signal.aborted) return;
      setDepartments(departments.status === 'fulfilled' ? departments.value : []);
      setPositions(positions.status === 'fulfilled' ? positions.value : []);
      setLinkableUsers(users.status === 'fulfilled' ? users.value : []);
      const failures = [
        ['Departments', departments],
        ['Positions', positions],
        ['User accounts', users],
      ] as const;
      setFailedChoices(
        failures.filter(([, result]) => result.status === 'rejected').map(([label]) => label),
      );
      setChoicesError(
        failures
          .flatMap(([label, result]) =>
            result.status === 'rejected'
              ? [
                  `${label}: ${result.reason instanceof Error ? result.reason.message : 'Could not load choices.'}`,
                ]
              : [],
          )
          .join(' '),
      );
      setChoicesLoading(false);
    });
    backendGet<{ employeeCode: string }>('/hr/employees/next-code', {
      query: { companyId },
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setNextCodePreview(result.employeeCode);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [form.companyId, canCreate, choicesRevision]);

  const filteredPositions = useMemo(
    () =>
      form.departmentId ? positions.filter((p) => p.departmentId === form.departmentId) : positions,
    [positions, form.departmentId],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate || pending.current || choicesLoading || orgLoading) return;
    setError('');
    if (!form.companyId) {
      setError('Pick a company');
      return;
    }
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError('First name and last name are required');
      return;
    }
    pending.current = true;
    try {
      draft.validateReview();
      await draft.saveNow();
      if (companiesError || !companies.some((row) => row.id === form.companyId))
        throw new Error('Choose an available company after the organisation choices load.');
      const selections = [
        [form.branchId, branches, 'branch'],
        [form.departmentId, departments, 'department'],
        [form.positionId, filteredPositions, 'position'],
        [form.userId, linkableUsers, 'user account'],
      ] as const;
      for (const [selected, available, label] of selections)
        if (selected && !available.some((row) => row.id === selected))
          throw new Error(
            `The selected ${label} is no longer available. Choose it again before saving.`,
          );
      setSaving(true);
      const body: Record<string, unknown> = {
        // Omit employeeCode entirely when blank — server auto-generates.
        ...(form.employeeCode.trim() ? { employeeCode: form.employeeCode.trim() } : {}),
        companyId: form.companyId,
        ...(form.userId ? { userId: form.userId } : {}),
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim() || undefined,
        lastName: form.lastName.trim(),
        fullName: [form.firstName, form.middleName, form.lastName].filter(Boolean).join(' '),
        gender: form.gender,
        nationality: form.nationality || undefined,
        taxResidencyStatus: form.taxResidencyStatus,
        disabilityStatus: form.disabilityStatus,
        payrollRegion: form.payrollRegion,
        employmentType: form.employmentType,
        employmentStatus: form.employmentStatus,
        paymentFrequency: form.paymentFrequency,
        heslbBorrower: form.heslbBorrower,
        dependents: Number(form.dependents) || 0,
      };
      const optional: Array<keyof FormState> = [
        'branchId',
        'departmentId',
        'positionId',
        'dateOfBirth',
        'email',
        'phone',
        'address',
        'emergencyContactName',
        'emergencyContactPhone',
        'nidaNumber',
        'passportNumber',
        'passportCountry',
        'votersIdNumber',
        'tin',
        'nssfNumber',
        'nhifNumber',
        'pssfNumber',
        'wcfRegistrationNumber',
        'heslbNumber',
        'disabilityCertificateNo',
        'bankName',
        'bankAccountName',
        'bankAccountNumber',
        'mobileMoneyNumber',
        'hireDate',
      ];
      for (const k of optional) {
        const v = form[k];
        if (typeof v === 'string' && v.trim()) body[k] = v.trim();
      }
      if (form.baseSalary) body.baseSalary = Number(form.baseSalary);

      await backendPost('/hr/employees', body);
      draft.markSaved();
      showToast('success', 'Employee created');
      onSaved('Employee created.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));
  const setValue =
    <K extends keyof FormState>(k: K) =>
    (value: string) =>
      set(k, value as FormState[K]);
  const sf =
    <K extends keyof FormState>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValue(k)(e.target.value);

  return (
    <Modal
      open
      onClose={closeCreate}
      title="New employee"
      subtitle="Start with their identity and company, then add employment and payroll details."
      size="2xl"
      footer={
        <>
          <Btn variant="secondary" type="button" disabled={saving} onClick={closeCreate}>
            Cancel
          </Btn>
          {draft.canRetain && (
            <Btn type="button" variant="secondary" disabled={saving} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn
            variant="primary"
            type="submit"
            form={formId}
            loading={saving}
            disabled={choicesLoading || orgLoading || !canCreate || !!draft.availabilityError}
          >
            Save
          </Btn>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={handleSubmit}
        onInvalidCapture={(event) => {
          const section = (event.target as HTMLElement).closest('details');
          if (section) section.open = true;
        }}
        {...draft.guard.capture}
        className="space-y-5"
      >
        <DraftFormNotice draft={draft} />
        {error && (
          <div role="alert" className="workspace-error">
            {error}
          </div>
        )}

        {(choicesError || orgError) && (
          <div role="alert" className="workspace-error">
            {choicesError || orgError}{' '}
            <Btn
              variant="secondary"
              type="button"
              onClick={() => {
                retryOrg();
                setChoicesRevision((value) => value + 1);
              }}
            >
              Retry choices
            </Btn>
          </div>
        )}
        {(choicesLoading || orgLoading) && <p role="status">Loading organisation choices…</p>}
        <fieldset
          disabled={saving || !canCreate || !!draft.availabilityError}
          className="space-y-6"
        >
          <Section title="Organisation">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormSelect
                label="Company"
                required
                value={form.companyId}
                disabled={orgLoading || choicesLoading}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    companyId: e.target.value,
                    branchId: '',
                    departmentId: '',
                    positionId: '',
                    userId: '',
                  }))
                }
                options={companies.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))}
                placeholder="Select company"
              />
              <FormSelect
                label="Branch"
                disabled={!form.companyId || orgLoading || Boolean(orgError)}
                value={form.branchId}
                onChange={sf('branchId')}
                options={branches.map((b) => ({
                  value: b.id,
                  label: `${b.code ? b.code + ' — ' : ''}${b.name}`,
                }))}
                placeholder={form.companyId ? 'Select branch (optional)' : 'Select company first'}
              />
              <FormSelect
                label="User account"
                value={form.userId}
                disabled={
                  !form.companyId || choicesLoading || failedChoices.includes('User accounts')
                }
                onChange={sf('userId')}
                options={linkableUsers.map((user) => ({
                  value: user.id,
                  label: `${user.fullName} (${user.email})`,
                }))}
                placeholder={
                  form.companyId
                    ? 'Link an account for Mobile POS (optional)'
                    : 'Select company first'
                }
                hint="Required when this employee will use a Mobile POS terminal"
              />
              <FormSelect
                label="Department"
                disabled={
                  !form.companyId || choicesLoading || failedChoices.includes('Departments')
                }
                value={form.departmentId}
                onChange={(e) => {
                  sf('departmentId')(e);
                  set('positionId', '');
                }}
                options={departments.map((d) => ({ value: d.id, label: d.name }))}
                placeholder={
                  form.companyId ? 'Select department (optional)' : 'Select company first'
                }
              />
              <FormSelect
                label="Position"
                disabled={!form.companyId || choicesLoading || failedChoices.includes('Positions')}
                value={form.positionId}
                onChange={sf('positionId')}
                options={filteredPositions.map((p) => ({ value: p.id, label: p.title }))}
                placeholder="Select position (optional)"
              />
            </div>
          </Section>

          <Section title="Personal">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormInput
                label="Employee Code"
                value={form.employeeCode}
                onChange={sf('employeeCode')}
                placeholder={
                  nextCodePreview ? `Auto: ${nextCodePreview}` : 'Auto-generated when blank'
                }
                hint={
                  nextCodePreview && !form.employeeCode
                    ? `Will be assigned ${nextCodePreview}`
                    : 'Leave blank to auto-generate'
                }
              />
              <FormSelect
                label="Gender"
                value={form.gender}
                onChange={sf('gender')}
                options={[
                  { value: 'NOT_SPECIFIED', label: 'Not specified' },
                  { value: 'MALE', label: 'Male' },
                  { value: 'FEMALE', label: 'Female' },
                ]}
              />
              <FormInput
                label="First name"
                required
                value={form.firstName}
                onChange={sf('firstName')}
              />
              <FormInput label="Middle Name" value={form.middleName} onChange={sf('middleName')} />
              <FormInput
                label="Last name"
                required
                value={form.lastName}
                onChange={sf('lastName')}
              />
              <FormDateField
                label="Date of Birth"
                value={form.dateOfBirth}
                onChange={setValue('dateOfBirth')}
              />
              <FormInput
                label="Nationality"
                value={form.nationality}
                onChange={sf('nationality')}
              />
              <FormInput label="Email" type="email" value={form.email} onChange={sf('email')} />
              <FormInput
                label="Phone"
                value={form.phone}
                onChange={sf('phone')}
                placeholder="+255..."
              />
              <div className="sm:col-span-2">
                <FormInput label="Address" value={form.address} onChange={sf('address')} />
              </div>
              <FormInput
                label="Emergency contact name"
                value={form.emergencyContactName}
                onChange={sf('emergencyContactName')}
              />
              <FormInput
                label="Emergency contact phone"
                value={form.emergencyContactPhone}
                onChange={sf('emergencyContactPhone')}
              />
            </div>
          </Section>

          <Section title="Identity (Tanzania)" optional>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormInput
                label="NIDA number"
                value={form.nidaNumber}
                onChange={sf('nidaNumber')}
                placeholder="20 digits — e.g. 19850101-12345-12345-12"
                hint="National Identification Authority — 20 digits, citizens only."
              />
              <FormInput
                label="Voter's ID"
                value={form.votersIdNumber}
                onChange={sf('votersIdNumber')}
              />
              <FormInput
                label="Passport number"
                value={form.passportNumber}
                onChange={sf('passportNumber')}
              />
              <FormInput
                label="Passport country"
                value={form.passportCountry}
                onChange={sf('passportCountry')}
                placeholder="e.g. TZ, KE, IN…"
              />
            </div>
          </Section>

          <Section title="Tax & statutory" optional>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormInput
                label="TIN"
                value={form.tin}
                onChange={sf('tin')}
                hint="Taxpayer Identification Number (TRA)."
              />
              <FormSelect
                label="Tax residency"
                value={form.taxResidencyStatus}
                onChange={sf('taxResidencyStatus')}
                options={[
                  { value: 'RESIDENT', label: 'Resident — tiered PAYE bands' },
                  { value: 'NON_RESIDENT', label: 'Non-resident — flat 15% PAYE' },
                ]}
              />
              <FormSelect
                label="Payroll region"
                value={form.payrollRegion}
                onChange={sf('payrollRegion')}
                options={[
                  { value: 'MAINLAND', label: 'Mainland Tanzania' },
                  { value: 'ZANZIBAR', label: 'Zanzibar' },
                ]}
                hint="Determines which PAYE band table applies."
              />
              <FormInput
                label="Dependents"
                type="number"
                value={form.dependents}
                onChange={sf('dependents')}
              />
              <FormInput
                label="NSSF number"
                value={form.nssfNumber}
                onChange={sf('nssfNumber')}
                hint="Private-sector pension."
              />
              <FormInput
                label="PSSSF number"
                value={form.pssfNumber}
                onChange={sf('pssfNumber')}
                hint="Public-sector pension. Used instead of NSSF for public-service employees."
              />
              <FormInput label="NHIF number" value={form.nhifNumber} onChange={sf('nhifNumber')} />
              <FormInput
                label="WCF registration #"
                value={form.wcfRegistrationNumber}
                onChange={sf('wcfRegistrationNumber')}
              />
              <FormInput
                label="HESLB number"
                value={form.heslbNumber}
                onChange={sf('heslbNumber')}
                hint="Higher Education Students Loans Board."
              />
              <div className="flex items-center gap-2 pt-7">
                <input
                  aria-label="Active HESLB borrower (15% deduction)"
                  id="heslbBorrower"
                  type="checkbox"
                  checked={form.heslbBorrower}
                  onChange={(e) => set('heslbBorrower', e.target.checked)}
                  className="rounded"
                />
                <label
                  htmlFor="heslbBorrower"
                  className="text-sm"
                  style={{ color: 'var(--aurora-text)' }}
                >
                  Active HESLB borrower (15% deduction)
                </label>
              </div>
              <FormSelect
                label="Disability status"
                value={form.disabilityStatus}
                onChange={sf('disabilityStatus')}
                options={[
                  { value: 'NONE', label: 'None' },
                  { value: 'REGISTERED', label: 'Registered' },
                  {
                    value: 'REGISTERED_PWD_CERTIFIED',
                    label: 'PWD-certified (TZS 15,000/month relief)',
                  },
                ]}
              />
              <FormInput
                label="PWD certificate #"
                value={form.disabilityCertificateNo}
                onChange={sf('disabilityCertificateNo')}
              />
            </div>
          </Section>

          <Section title="Employment">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormSelect
                label="Employment type"
                value={form.employmentType}
                onChange={sf('employmentType')}
                options={[
                  { value: 'FULL_TIME', label: 'Full Time' },
                  { value: 'PART_TIME', label: 'Part Time' },
                  { value: 'CONTRACT', label: 'Contract' },
                  { value: 'CASUAL', label: 'Casual' },
                  { value: 'INTERN', label: 'Intern' },
                ]}
              />
              <FormSelect
                label="Status"
                value={form.employmentStatus}
                onChange={sf('employmentStatus')}
                options={[
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'ON_LEAVE', label: 'On Leave' },
                  { value: 'SUSPENDED', label: 'Suspended' },
                  { value: 'TERMINATED', label: 'Terminated' },
                  { value: 'RESIGNED', label: 'Resigned' },
                  { value: 'INACTIVE', label: 'Inactive' },
                ]}
              />
              <FormDateField
                label="Hire date"
                value={form.hireDate}
                onChange={setValue('hireDate')}
              />
              <FormSelect
                label="Payment frequency"
                value={form.paymentFrequency}
                onChange={sf('paymentFrequency')}
                options={[
                  { value: 'MONTHLY', label: 'Monthly' },
                  { value: 'BIWEEKLY', label: 'Biweekly' },
                  { value: 'WEEKLY', label: 'Weekly' },
                  { value: 'DAILY', label: 'Daily' },
                ]}
              />
              <FormInput
                label="Base salary (TZS)"
                type="number"
                step="0.01"
                value={form.baseSalary}
                onChange={sf('baseSalary')}
              />
            </div>
          </Section>

          <Section title="Payment details" optional>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormInput
                label="Bank name"
                value={form.bankName}
                onChange={sf('bankName')}
                placeholder="CRDB / NMB / NBC…"
              />
              <FormInput
                label="Bank account name"
                value={form.bankAccountName}
                onChange={sf('bankAccountName')}
              />
              <FormInput
                label="Bank account number"
                value={form.bankAccountNumber}
                onChange={sf('bankAccountNumber')}
              />
              <FormInput
                label="Mobile money number"
                value={form.mobileMoneyNumber}
                onChange={sf('mobileMoneyNumber')}
                placeholder="+255..."
                hint="You can add additional provider accounts from the employee profile."
              />
            </div>
          </Section>
        </fieldset>
      </form>
    </Modal>
  );
}

function Section({
  title,
  children,
  optional = false,
}: {
  title: string;
  children: React.ReactNode;
  optional?: boolean;
}) {
  if (optional)
    return (
      <details className="border-t pt-4" style={{ borderColor: 'var(--aurora-border)' }}>
        <summary className="cursor-pointer text-base font-semibold">
          {title}
          <span className="ml-2 text-xs font-normal" style={{ color: 'var(--aurora-text-muted)' }}>
            Optional details
          </span>
        </summary>
        <div className="pt-4">{children}</div>
      </details>
    );
  return (
    <div>
      <h3
        className="text-base font-semibold mb-4"
        style={{ color: 'var(--aurora-text-secondary)' }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}
