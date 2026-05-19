'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Btn,
  Card,
  FormInput,
  FormSelect,
  Modal,
  PageHeader,
  PageSpinner,
  PageToolbar,
  StatusBadge,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface Company {
  id: string;
  name: string;
  code: string;
}
interface Branch {
  id: string;
  name: string;
  code: string;
  companyId?: string;
}
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

interface EmployeeRow {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  fullName?: string;
  email?: string;
  company?: { name: string; code?: string } | string | null;
  department?: { name: string } | string | null;
  position?: { title: string } | string | null;
  employmentType?: string;
  employmentStatus?: string;
  status?: string;
  payrollRegion?: string;
}

interface FormState {
  // Org
  companyId: string;
  branchId: string;
  departmentId: string;
  positionId: string;
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

export default function EmployeesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCompanyId, setFilterCompanyId] = useState('');
  const [nextCodePreview, setNextCodePreview] = useState('');

  // Lookup tables
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (filterStatus) params.set('employmentStatus', filterStatus);
    if (filterCompanyId) params.set('companyId', filterCompanyId);
    const r = await fetch(`/api/backend/hr/employees?${params}`);
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  }, [filterCompanyId, filterStatus, search]);

  // Initial lookup load
  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) =>
        setCompanies(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      )
      .catch(() => setCompanies([]));
  }, []);

  // Reload branches/departments/positions + preview the next employee code
  // when company changes in the create modal.
  useEffect(() => {
    if (!form.companyId) {
      setBranches([]);
      setDepartments([]);
      setPositions([]);
      setNextCodePreview('');
      return;
    }
    fetch(`/api/backend/branches?companyId=${form.companyId}&limit=200`)
      .then((r) => r.json())
      .then((j) =>
        setBranches(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      )
      .catch(() => setBranches([]));
    fetch(`/api/backend/hr/departments?companyId=${form.companyId}&limit=200`)
      .then((r) => r.json())
      .then((j) =>
        setDepartments(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      )
      .catch(() => setDepartments([]));
    fetch(`/api/backend/hr/positions?companyId=${form.companyId}&limit=200`)
      .then((r) => r.json())
      .then((j) =>
        setPositions(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      )
      .catch(() => setPositions([]));
    fetch(`/api/backend/hr/employees/next-code?companyId=${form.companyId}`)
      .then((r) => r.json())
      .then((j) => setNextCodePreview(j.data?.employeeCode ?? j.employeeCode ?? ''))
      .catch(() => setNextCodePreview(''));
  }, [form.companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredPositions = useMemo(
    () =>
      form.departmentId
        ? positions.filter((p) => p.departmentId === form.departmentId)
        : positions,
    [positions, form.departmentId],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.companyId) {
      setError('Pick a company');
      return;
    }
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError('First name and last name are required');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        // Omit employeeCode entirely when blank — server auto-generates.
        ...(form.employeeCode.trim() ? { employeeCode: form.employeeCode.trim() } : {}),
        companyId: form.companyId,
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
        createdById: user?.id ?? '',
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

      const res = await fetch('/api/backend/hr/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const msg = Array.isArray(j?.message)
          ? j.message.join(', ')
          : (j?.message ?? 'Save failed');
        throw new Error(msg);
      }
      setShowCreate(false);
      setForm(blank);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));
  const sf =
    <K extends keyof FormState>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      set(k, e.target.value as FormState[K]);

  const fullName = (e: EmployeeRow) => e.fullName ?? `${e.firstName} ${e.lastName}`;

  return (
    <div className="p-6">
      <PageHeader title="Employees" subtitle="All employee profiles across the group" />

      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search name or code…"
        filters={
          <>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
              style={{
                borderColor: 'var(--aurora-border)',
                background: 'var(--aurora-card)',
                color: 'var(--aurora-text)',
              }}
            >
              <option value="">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="ON_LEAVE">On Leave</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="TERMINATED">Terminated</option>
              <option value="RESIGNED">Resigned</option>
              <option value="INACTIVE">Inactive</option>
            </select>
            <select
              value={filterCompanyId}
              onChange={(e) => setFilterCompanyId(e.target.value)}
              className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
              style={{
                borderColor: 'var(--aurora-border)',
                background: 'var(--aurora-card)',
                color: 'var(--aurora-text)',
              }}
            >
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </>
        }
        actions={
          <Btn
            variant="primary"
            onClick={() => {
              setForm(blank);
              setShowCreate(true);
              setError('');
            }}
          >
            + Add Employee
          </Btn>
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead
                style={{ color: 'var(--aurora-text-muted)' }}
                className="bg-slate-50 border-b border-slate-100"
              >
                <tr>
                  <th className={thCls}>Code</th>
                  <th className={thCls}>Full Name</th>
                  <th className={thCls}>Company</th>
                  <th className={thCls}>Department</th>
                  <th className={thCls}>Position</th>
                  <th className={thCls}>Type</th>
                  <th className={thCls}>Region</th>
                  <th className={thCls}>Status</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map((emp) => (
                  <tr
                    key={emp.id}
                    onClick={() => router.push(`/hr/employees/${emp.id}`)}
                    className="border-b border-slate-50 hover:bg-indigo-50 cursor-pointer"
                  >
                    <td className={`${tdCls} font-mono`}>{emp.employeeCode}</td>
                    <td className={`${tdCls} font-medium text-indigo-600`}>{fullName(emp)}</td>
                    <td className={tdCls}>
                      {typeof emp.company === 'object' ? emp.company?.name : (emp.company ?? '—')}
                    </td>
                    <td className={tdCls}>
                      {typeof emp.department === 'object'
                        ? emp.department?.name
                        : (emp.department ?? '—')}
                    </td>
                    <td className={tdCls}>
                      {typeof emp.position === 'object'
                        ? emp.position?.title
                        : (emp.position ?? '—')}
                    </td>
                    <td className={tdCls}>{emp.employmentType ?? '—'}</td>
                    <td className={tdCls}>{emp.payrollRegion ?? '—'}</td>
                    <td className={tdCls}>
                      <StatusBadge status={emp.employmentStatus ?? emp.status ?? '—'} />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-slate-400 text-sm">
                      No employees found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New Employee"
        size="2xl"
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setShowCreate(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" type="submit" form="employee-create-form" loading={saving}>
              Save
            </Btn>
          </>
        }
      >
        <form id="employee-create-form" onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <Section title="Org placement">
            <div className="grid grid-cols-2 gap-3">
              <FormSelect
                label="Company *"
                required
                value={form.companyId}
                onChange={sf('companyId')}
                options={companies.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))}
                placeholder="Select company"
              />
              <FormSelect
                label="Branch"
                value={form.branchId}
                onChange={sf('branchId')}
                options={branches.map((b) => ({
                  value: b.id,
                  label: `${b.code ? b.code + ' — ' : ''}${b.name}`,
                }))}
                placeholder={form.companyId ? 'Select branch (optional)' : 'Select company first'}
              />
              <FormSelect
                label="Department"
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
                value={form.positionId}
                onChange={sf('positionId')}
                options={filteredPositions.map((p) => ({ value: p.id, label: p.title }))}
                placeholder="Select position (optional)"
              />
            </div>
          </Section>

          <Section title="Personal">
            <div className="grid grid-cols-2 gap-3">
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
                label="First Name *"
                required
                value={form.firstName}
                onChange={sf('firstName')}
              />
              <FormInput label="Middle Name" value={form.middleName} onChange={sf('middleName')} />
              <FormInput
                label="Last Name *"
                required
                value={form.lastName}
                onChange={sf('lastName')}
              />
              <FormInput
                label="Date of Birth"
                type="date"
                value={form.dateOfBirth}
                onChange={sf('dateOfBirth')}
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
              <div className="col-span-2">
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

          <Section title="Identity (Tanzania)">
            <div className="grid grid-cols-2 gap-3">
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

          <Section title="Tax & statutory">
            <div className="grid grid-cols-2 gap-3">
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
            <div className="grid grid-cols-2 gap-3">
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
              <FormInput
                label="Hire date"
                type="date"
                value={form.hireDate}
                onChange={sf('hireDate')}
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

          <Section title="Payment details">
            <div className="grid grid-cols-2 gap-3">
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
                label="Bank account #"
                value={form.bankAccountNumber}
                onChange={sf('bankAccountNumber')}
              />
              <FormInput
                label="Mobile money (legacy)"
                value={form.mobileMoneyNumber}
                onChange={sf('mobileMoneyNumber')}
                placeholder="+255..."
                hint="Legacy single-account field. Add multiple providers from the employee detail page."
              />
            </div>
          </Section>
        </form>
      </Modal>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="text-xs font-semibold uppercase tracking-wide mb-2"
        style={{ color: 'var(--aurora-text-secondary)' }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}
