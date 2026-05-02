'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Btn,
  Card,
  FormInput,
  FormSelect,
  Modal,
  PageHeader,
  PageSpinner,
  StatusBadge,
} from '@/components/ui';

type Tab =
  | 'profile'
  | 'statutory'
  | 'banking'
  | 'assignments'
  | 'contracts'
  | 'attendance'
  | 'leave'
  | 'payroll'
  | 'documents';

interface Employee {
  id: string;
  employeeCode: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  fullName?: string;
  gender?: string;
  dateOfBirth?: string;
  nationality?: string;
  email?: string;
  phone?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;

  // Identity
  identificationType?: string;
  identificationNumber?: string;
  nidaNumber?: string;
  passportNumber?: string;
  passportCountry?: string;
  votersIdNumber?: string;

  // Tax & statutory
  tin?: string;
  nssfNumber?: string;
  nhifNumber?: string;
  pssfNumber?: string;
  wcfRegistrationNumber?: string;
  heslbNumber?: string;
  heslbBorrower?: boolean;
  taxResidencyStatus?: string;
  disabilityStatus?: string;
  disabilityCertificateNo?: string;
  dependents?: number;
  payrollRegion?: string;

  // Payment
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  mobileMoneyNumber?: string;

  // Org
  company?: { id: string; name: string } | null;
  department?: { id: string; name: string } | null;
  position?: { id: string; title: string } | null;

  // Employment
  employmentType?: string;
  employmentStatus?: string;
  hireDate?: string;
  terminationDate?: string;
  baseSalary?: number | string;
  salaryCurrency?: string;
  paymentFrequency?: string;

  // Audit
  notes?: string;
}

interface MobileMoney {
  id: string;
  provider: string;
  msisdn: string;
  accountName?: string;
  isPrimary: boolean;
  status: string;
  notes?: string;
}

const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const TABS: { key: Tab; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'statutory', label: 'Tax & Statutory' },
  { key: 'banking', label: 'Banking & Mobile Money' },
  { key: 'contracts', label: 'Contracts' },
  { key: 'assignments', label: 'Assignments' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'leave', label: 'Leave' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'documents', label: 'Documents' },
];

const PROVIDER_LABELS: Record<string, string> = {
  M_PESA: 'M-Pesa (Vodacom)',
  TIGO_PESA: 'Tigo Pesa / Mixx by Yas',
  AIRTEL_MONEY: 'Airtel Money',
  HALOPESA: 'HaloPesa (Halotel)',
  EZYPESA: 'EzyPesa (Zantel)',
  T_PESA: 'T-Pesa (TTCL)',
  OTHER: 'Other',
};

export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [emp, setEmp] = useState<Employee | null>(null);
  const [mobileMoney, setMobileMoney] = useState<MobileMoney[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('profile');
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [showStatutoryEdit, setShowStatutoryEdit] = useState(false);
  const [form, setForm] = useState<Partial<Employee>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Mobile money modal state
  const [showMmModal, setShowMmModal] = useState(false);
  const [editingMm, setEditingMm] = useState<MobileMoney | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/backend/hr/employees/${id}`);
    const j = await r.json();
    const data = j.data ?? j;
    setEmp(data);
    setForm(data);
    setLoading(false);
  }, [id]);

  const loadMobileMoney = useCallback(async () => {
    const r = await fetch(`/api/backend/hr/mobile-money-accounts?employeeId=${id}`);
    const j = await r.json();
    setMobileMoney(Array.isArray(j.data) ? j.data : []);
  }, [id]);

  useEffect(() => {
    if (id) {
      load();
      loadMobileMoney();
    }
  }, [id, load, loadMobileMoney]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      // Strip non-scalar fields the backend won't accept
      const { company, department, position, ...rest } = form as Record<string, unknown>;
      void company;
      void department;
      void position;
      const res = await fetch(`/api/backend/hr/employees/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rest),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? 'Save failed'),
        );
      }
      setShowProfileEdit(false);
      setShowStatutoryEdit(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const ff =
    <K extends keyof Employee>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));

  if (loading) return <PageSpinner />;
  if (!emp) return <div className="p-6 text-sm text-slate-500">Employee not found.</div>;

  const fullName = emp.fullName ?? `${emp.firstName} ${emp.lastName}`;

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title={fullName}
        subtitle={`${emp.employeeCode} · ${emp.position?.title ?? 'No Position'} · ${emp.company?.name ?? ''}`}
        breadcrumbs={[
          { label: 'HR', href: '/hr' },
          { label: 'Employees', href: '/hr/employees' },
          { label: fullName },
        ]}
        actions={
          <div className="flex gap-2">
            {tab === 'profile' && (
              <Btn variant="primary" onClick={() => setShowProfileEdit(true)}>
                Edit Profile
              </Btn>
            )}
            {tab === 'statutory' && (
              <Btn variant="primary" onClick={() => setShowStatutoryEdit(true)}>
                Edit Tax & Statutory
              </Btn>
            )}
            <Btn variant="secondary" onClick={() => router.back()}>
              ← Back
            </Btn>
          </div>
        }
      />

      <div className="flex items-center gap-3 flex-wrap">
        <StatusBadge status={emp.employmentStatus ?? 'ACTIVE'} />
        {emp.employmentType && (
          <span
            className="text-xs px-2 py-1 rounded-full"
            style={{ background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-secondary)' }}
          >
            {emp.employmentType}
          </span>
        )}
        {emp.payrollRegion && (
          <span className="text-xs px-2 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
            {emp.payrollRegion}
          </span>
        )}
        {emp.taxResidencyStatus && emp.taxResidencyStatus !== 'RESIDENT' && (
          <span className="text-xs px-2 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-800">
            {emp.taxResidencyStatus.replace('_', ' ')}
          </span>
        )}
        {emp.heslbBorrower && (
          <span className="text-xs px-2 py-1 rounded-full border border-purple-200 bg-purple-50 text-purple-800">
            HESLB borrower
          </span>
        )}
        {emp.disabilityStatus === 'REGISTERED_PWD_CERTIFIED' && (
          <span className="text-xs px-2 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-800">
            PWD certified
          </span>
        )}
        {emp.hireDate && (
          <span className="text-xs text-slate-400">
            Hired: {new Date(emp.hireDate).toLocaleDateString('en-GB')}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b" style={{ borderColor: 'var(--aurora-border)' }}>
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${tab === t.key ? 'border-brand-600' : 'border-transparent'}`}
              style={{ color: tab === t.key ? 'var(--aurora-text)' : 'var(--aurora-text-muted)' }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Profile tab */}
      {tab === 'profile' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--aurora-text)' }}>
              Personal
            </h3>
            <KvList
              rows={[
                ['Full Name', fullName],
                ['Gender', emp.gender],
                [
                  'Date of Birth',
                  emp.dateOfBirth
                    ? new Date(emp.dateOfBirth).toLocaleDateString('en-GB')
                    : undefined,
                ],
                ['Nationality', emp.nationality],
                ['Email', emp.email],
                ['Phone', emp.phone],
                ['Address', emp.address],
                [
                  'Emergency Contact',
                  emp.emergencyContactName
                    ? `${emp.emergencyContactName}${emp.emergencyContactPhone ? ` · ${emp.emergencyContactPhone}` : ''}`
                    : undefined,
                ],
              ]}
            />
          </Card>
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--aurora-text)' }}>
              Employment
            </h3>
            <KvList
              rows={[
                ['Employee Code', emp.employeeCode],
                ['Company', emp.company?.name],
                ['Department', emp.department?.name],
                ['Position', emp.position?.title],
                ['Type', emp.employmentType],
                [
                  'Hire Date',
                  emp.hireDate ? new Date(emp.hireDate).toLocaleDateString('en-GB') : undefined,
                ],
                [
                  'Termination Date',
                  emp.terminationDate
                    ? new Date(emp.terminationDate).toLocaleDateString('en-GB')
                    : undefined,
                ],
                [
                  'Base Salary',
                  emp.baseSalary != null
                    ? `${emp.salaryCurrency ?? 'TZS'} ${Number(emp.baseSalary).toLocaleString('en-TZ')}`
                    : undefined,
                ],
                ['Payment Frequency', emp.paymentFrequency],
              ]}
            />
          </Card>
        </div>
      )}

      {/* Statutory tab */}
      {tab === 'statutory' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--aurora-text)' }}>
              Identity (Tanzania)
            </h3>
            <KvList
              rows={[
                ['NIDA #', emp.nidaNumber],
                [
                  'Passport',
                  emp.passportNumber
                    ? `${emp.passportNumber}${emp.passportCountry ? ` (${emp.passportCountry})` : ''}`
                    : undefined,
                ],
                ['Voter ID', emp.votersIdNumber],
                [
                  'Other ID',
                  emp.identificationNumber
                    ? `${emp.identificationType ?? 'ID'} · ${emp.identificationNumber}`
                    : undefined,
                ],
              ]}
            />
          </Card>
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--aurora-text)' }}>
              PAYE & relief
            </h3>
            <KvList
              rows={[
                ['TIN', emp.tin],
                ['Tax Residency', emp.taxResidencyStatus],
                ['Payroll Region', emp.payrollRegion],
                [
                  'Disability',
                  emp.disabilityStatus !== 'NONE'
                    ? `${emp.disabilityStatus}${emp.disabilityCertificateNo ? ` · ${emp.disabilityCertificateNo}` : ''}`
                    : undefined,
                ],
                ['Dependents', emp.dependents != null ? String(emp.dependents) : undefined],
              ]}
            />
          </Card>
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--aurora-text)' }}>
              Pension & insurance
            </h3>
            <KvList
              rows={[
                ['NSSF #', emp.nssfNumber],
                ['PSSSF #', emp.pssfNumber],
                ['NHIF #', emp.nhifNumber],
                ['WCF #', emp.wcfRegistrationNumber],
              ]}
            />
          </Card>
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--aurora-text)' }}>
              HESLB
            </h3>
            <KvList
              rows={[
                ['HESLB #', emp.heslbNumber],
                ['Active borrower', emp.heslbBorrower ? 'Yes — 15% deduction applied' : 'No'],
              ]}
            />
          </Card>
        </div>
      )}

      {/* Banking & Mobile Money tab */}
      {tab === 'banking' && (
        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--aurora-text)' }}>
              Bank account
            </h3>
            <KvList
              rows={[
                ['Bank', emp.bankName],
                ['Account name', emp.bankAccountName],
                ['Account #', emp.bankAccountNumber],
              ]}
            />
          </Card>

          <Card className="overflow-hidden">
            <div
              className="px-4 py-3 border-b flex items-center justify-between"
              style={{ borderColor: 'var(--aurora-border)' }}
            >
              <div className="text-xs font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Mobile money accounts
              </div>
              <Btn
                variant="primary"
                size="xs"
                onClick={() => {
                  setEditingMm(null);
                  setShowMmModal(true);
                }}
              >
                + Add account
              </Btn>
            </div>
            {mobileMoney.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-400">
                No mobile money accounts. Click <em>+ Add account</em> to register one.
                {emp.mobileMoneyNumber && (
                  <div className="mt-2 text-xs">
                    Legacy field: <code className="font-mono">{emp.mobileMoneyNumber}</code>
                  </div>
                )}
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr style={{ color: 'var(--aurora-text-muted)' }}>
                    <th className={thCls}>Provider</th>
                    <th className={thCls}>MSISDN</th>
                    <th className={thCls}>Account name</th>
                    <th className={thCls}>Primary</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls + ' text-right'}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {mobileMoney.map((mm) => (
                    <tr key={mm.id} className="border-b border-slate-50">
                      <td className={tdCls}>{PROVIDER_LABELS[mm.provider] ?? mm.provider}</td>
                      <td className={`${tdCls} font-mono`}>{mm.msisdn}</td>
                      <td className={tdCls}>{mm.accountName ?? '—'}</td>
                      <td className={tdCls}>
                        {mm.isPrimary ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Primary
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={tdCls}>
                        <StatusBadge status={mm.status} />
                      </td>
                      <td className={tdCls + ' text-right whitespace-nowrap'}>
                        <Btn
                          variant="ghost"
                          size="xs"
                          onClick={() => {
                            setEditingMm(mm);
                            setShowMmModal(true);
                          }}
                        >
                          Edit
                        </Btn>
                        {!mm.isPrimary && (
                          <Btn
                            variant="ghost"
                            size="xs"
                            onClick={async () => {
                              if (
                                !confirm(
                                  `Remove ${PROVIDER_LABELS[mm.provider] ?? mm.provider} account?`,
                                )
                              )
                                return;
                              const res = await fetch(
                                `/api/backend/hr/mobile-money-accounts/${mm.id}`,
                                { method: 'DELETE' },
                              );
                              if (!res.ok) {
                                const j = await res.json().catch(() => ({}));
                                alert(j?.message ?? 'Delete failed');
                                return;
                              }
                              loadMobileMoney();
                            }}
                          >
                            Delete
                          </Btn>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}

      {tab === 'assignments' && (
        <PlaceholderCard
          text="Employee assignments will appear here."
          linkLabel="View Assignments →"
          linkHref="/hr/employee-assignments"
        />
      )}
      {tab === 'contracts' && (
        <PlaceholderCard
          text="Employment contracts will appear here."
          linkLabel="View Contracts →"
          linkHref="/hr/employment-contracts"
        />
      )}
      {tab === 'attendance' && (
        <PlaceholderCard
          text="Attendance records will appear here."
          linkLabel="View Attendance →"
          linkHref="/hr/attendance"
        />
      )}
      {tab === 'leave' && (
        <PlaceholderCard
          text="Leave records will appear here."
          linkLabel="View Leave Requests →"
          linkHref="/hr/leave-requests"
        />
      )}
      {tab === 'payroll' && (
        <PlaceholderCard
          text="Payroll history will appear here."
          linkLabel="View Payroll Entries →"
          linkHref="/hr/payroll-entries"
        />
      )}
      {tab === 'documents' && (
        <PlaceholderCard
          text="Documents will appear here."
          linkLabel="View HR Documents →"
          linkHref="/hr/hr-documents"
        />
      )}

      {/* Profile edit modal */}
      <Modal
        open={showProfileEdit}
        onClose={() => setShowProfileEdit(false)}
        title="Edit profile"
        size="lg"
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setShowProfileEdit(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" type="submit" form="profile-edit-form" loading={saving}>
              Save
            </Btn>
          </>
        }
      >
        <form id="profile-edit-form" onSubmit={handleSave} className="space-y-3">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
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
            <FormInput
              label="Date of Birth"
              type="date"
              value={form.dateOfBirth?.slice(0, 10) ?? ''}
              onChange={ff('dateOfBirth')}
            />
            <FormInput
              label="Nationality"
              value={form.nationality ?? ''}
              onChange={ff('nationality')}
            />
            <FormInput label="Email" type="email" value={form.email ?? ''} onChange={ff('email')} />
            <FormInput label="Phone" value={form.phone ?? ''} onChange={ff('phone')} />
            <div className="col-span-2">
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
            <FormSelect
              label="Status"
              value={form.employmentStatus ?? 'ACTIVE'}
              onChange={ff('employmentStatus')}
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
              label="Termination date"
              type="date"
              value={form.terminationDate?.slice(0, 10) ?? ''}
              onChange={ff('terminationDate')}
            />
            <FormInput
              label="Base Salary (TZS)"
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
        </form>
      </Modal>

      {/* Statutory edit modal */}
      <Modal
        open={showStatutoryEdit}
        onClose={() => setShowStatutoryEdit(false)}
        title="Edit tax & statutory"
        size="lg"
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setShowStatutoryEdit(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" type="submit" form="statutory-edit-form" loading={saving}>
              Save
            </Btn>
          </>
        }
      >
        <form id="statutory-edit-form" onSubmit={handleSave} className="space-y-3">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
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
            <FormInput label="TIN" value={form.tin ?? ''} onChange={ff('tin')} />
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
            <FormInput label="NSSF #" value={form.nssfNumber ?? ''} onChange={ff('nssfNumber')} />
            <FormInput label="PSSSF #" value={form.pssfNumber ?? ''} onChange={ff('pssfNumber')} />
            <FormInput label="NHIF #" value={form.nhifNumber ?? ''} onChange={ff('nhifNumber')} />
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
                id="heslb-borrower-edit"
                type="checkbox"
                checked={!!form.heslbBorrower}
                onChange={(e) => setForm((p) => ({ ...p, heslbBorrower: e.target.checked }))}
                className="rounded"
              />
              <label
                htmlFor="heslb-borrower-edit"
                className="text-sm"
                style={{ color: 'var(--aurora-text)' }}
              >
                Active HESLB borrower (15% deduction)
              </label>
            </div>
            <FormInput label="Bank name" value={form.bankName ?? ''} onChange={ff('bankName')} />
            <FormInput
              label="Account name"
              value={form.bankAccountName ?? ''}
              onChange={ff('bankAccountName')}
            />
            <FormInput
              label="Account #"
              value={form.bankAccountNumber ?? ''}
              onChange={ff('bankAccountNumber')}
            />
            <FormInput
              label="Mobile money (legacy)"
              value={form.mobileMoneyNumber ?? ''}
              onChange={ff('mobileMoneyNumber')}
            />
          </div>
        </form>
      </Modal>

      {showMmModal && (
        <MobileMoneyModal
          employeeId={id}
          initial={editingMm ?? undefined}
          existingProviders={mobileMoney
            .filter((m) => !editingMm || m.id !== editingMm.id)
            .map((m) => m.provider)}
          onClose={() => setShowMmModal(false)}
          onSaved={() => {
            setShowMmModal(false);
            loadMobileMoney();
          }}
        />
      )}
    </div>
  );
}

function KvList({ rows }: { rows: Array<[string, unknown]> }) {
  const visible = rows.filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (visible.length === 0)
    return <p className="text-xs italic text-slate-400">No data captured.</p>;
  return (
    <dl className="space-y-2">
      {visible.map(([label, value]) => (
        <div key={label} className="flex gap-2">
          <dt className="text-xs w-32 flex-shrink-0" style={{ color: 'var(--aurora-text-muted)' }}>
            {label}
          </dt>
          <dd className="text-sm" style={{ color: 'var(--aurora-text)' }}>
            {String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PlaceholderCard({
  text,
  linkLabel,
  linkHref,
}: {
  text: string;
  linkLabel: string;
  linkHref: string;
}) {
  return (
    <Card className="p-8 text-center">
      <div className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
        {text}
        <div className="mt-2">
          <a
            href={linkHref}
            className="text-xs hover:underline"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            {linkLabel}
          </a>
        </div>
      </div>
    </Card>
  );
}

function MobileMoneyModal({
  employeeId,
  initial,
  existingProviders,
  onClose,
  onSaved,
}: {
  employeeId: string;
  initial?: MobileMoney;
  existingProviders: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial;
  const [provider, setProvider] = useState(initial?.provider ?? 'M_PESA');
  const [msisdn, setMsisdn] = useState(initial?.msisdn ?? '');
  const [accountName, setAccountName] = useState(initial?.accountName ?? '');
  const [isPrimary, setIsPrimary] = useState(initial?.isPrimary ?? false);
  const [status, setStatus] = useState(initial?.status ?? 'ACTIVE');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!msisdn.trim()) {
      setError('Enter the mobile number');
      return;
    }
    if (!isEdit && existingProviders.includes(provider)) {
      setError(`This employee already has a ${PROVIDER_LABELS[provider] ?? provider} account.`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const url = isEdit
        ? `/api/backend/hr/mobile-money-accounts/${initial!.id}`
        : `/api/backend/hr/mobile-money-accounts`;
      const method = isEdit ? 'PATCH' : 'POST';
      const body: Record<string, unknown> = isEdit
        ? {
            provider,
            msisdn: msisdn.trim(),
            accountName: accountName || undefined,
            isPrimary,
            status,
            notes: notes || undefined,
          }
        : {
            employeeId,
            provider,
            msisdn: msisdn.trim(),
            accountName: accountName || undefined,
            isPrimary,
            status,
            notes: notes || undefined,
          };
      const res = await fetch(url, {
        method,
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
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Edit mobile money account' : 'Add mobile money account'}
      footer={
        <>
          <Btn variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" type="submit" form="mm-form" loading={saving}>
            {isEdit ? 'Save' : 'Add'}
          </Btn>
        </>
      }
    >
      <form id="mm-form" onSubmit={submit} className="space-y-3">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <FormSelect
          label="Provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          options={Object.entries(PROVIDER_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <FormInput
          label="Mobile number"
          value={msisdn}
          onChange={(e) => setMsisdn(e.target.value)}
          placeholder="+255712345678 or 0712345678"
          hint="Tanzanian mobile number — E.164 or 0-prefixed"
          required
        />
        <FormInput
          label="Account name (optional)"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          placeholder="Name as registered with the provider"
        />
        <FormSelect
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: 'ACTIVE', label: 'Active' },
            { value: 'SUSPENDED', label: 'Suspended' },
            { value: 'CLOSED', label: 'Closed' },
          ]}
        />
        <FormInput
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="flex items-center gap-2 pt-1">
          <input
            id="mm-is-primary"
            type="checkbox"
            checked={isPrimary}
            onChange={(e) => setIsPrimary(e.target.checked)}
            className="rounded"
          />
          <label
            htmlFor="mm-is-primary"
            className="text-sm"
            style={{ color: 'var(--aurora-text)' }}
          >
            Set as primary disbursement account
          </label>
        </div>
      </form>
    </Modal>
  );
}
