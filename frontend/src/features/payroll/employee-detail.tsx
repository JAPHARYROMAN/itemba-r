'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useWorkspaceRouter as useGuardedRouter } from '@/components/workspace/workspace-navigation';
import { useRequestGuard } from '@/hooks/use-request-guard';
import { RecordBrowser } from '@/components/workspace/record-browser';
import '@/components/workspace/workspace.css';
import '@/app/(dashboard)/hr/employees/[id]/employee-profile.css';
import {
  EmployeeRelatedRecords,
  type EmployeeRelatedSection,
} from '@/components/workspace/employee-related-records';
import {
  Btn,
  Card,
  ConfirmDialog,
  PageHeader,
  PageSpinner,
  ErrorState,
  PermissionDeniedState,
  StatusBadge,
  showToast,
} from '@/components/ui';
import { backendDelete, backendGet, backendPatch } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

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

import type { Employee } from './employee-types';
import { PROVIDER_LABELS, type MobileMoney } from './mobile-money-types';
import type { EmployeeSection } from './employee-edit-values';
import { usePayrollDraftEditor, usePayrollStateKey } from './payroll-drafts';
import { useWorkspaceState } from '@/components/workspace/workspace-session';

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

export function EmployeeDetail({ employeeId: id }: { employeeId: string }) {
  const router = useGuardedRouter();
  const { hasPermission } = useAuth();
  const canRead = hasPermission('employees.view');
  const canEdit = hasPermission('employees.update');
  const canSensitive =
    hasPermission('employees.sensitive.view') || hasPermission('payroll.sensitive.view');
  const canDelete = hasPermission('employees.delete');
  const canRequestTermination = hasPermission('employees.termination.request');
  const canApproveTermination = hasPermission('employees.termination.approve.hr');

  const [emp, setEmp] = useState<Employee | null>(null);
  const [mobileMoney, setMobileMoney] = useState<MobileMoney[]>([]);
  const [loading, setLoading] = useState(true);
  const stateKey = usePayrollStateKey('employee.' + id);
  const [tab, setTab] = useWorkspaceState<Tab>(stateKey + '.tab', 'profile');
  const tabPrefix = useId();
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  // Mobile money modal state
  const [deletingMm, setDeletingMm] = useState<MobileMoney | null>(null);
  const [mmError, setMmError] = useState('');
  const [mmLoading, setMmLoading] = useState(false);
  const [mmDeleteError, setMmDeleteError] = useState('');

  // Delete confirmation state
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deletingEmployee, setDeletingEmployee] = useState(false);
  const [removingAccount, setRemovingAccount] = useState(false);

  // Termination workflow state (single-approver: request -> approve)
  const [confirmingTermination, setConfirmingTermination] = useState(false);
  const [approvingTermination, setApprovingTermination] = useState(false);
  const [terminationError, setTerminationError] = useState('');
  const beginRequest = useRequestGuard();
  const beginMoneyRequest = useRequestGuard();

  const load = useCallback(async () => {
    const request = beginRequest();
    if (!canRead || !id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const data = await backendGet<Employee>(`/hr/employees/${id}`, { signal: request.signal });
      if (request.current()) setEmp(data);
    } catch (error) {
      if (request.current())
        setLoadError(error instanceof Error ? error.message : 'Unable to load this employee.');
    } finally {
      if (request.current()) setLoading(false);
    }
  }, [id, canRead, beginRequest]);

  const loadMobileMoney = useCallback(async () => {
    const request = beginMoneyRequest();
    if (!canRead || !id) return;
    setMmLoading(true);
    setMmError('');
    try {
      const data = await backendGet<MobileMoney[]>('/hr/mobile-money-accounts', {
        query: { employeeId: id },
        signal: request.signal,
      });
      if (request.current()) setMobileMoney(data);
    } catch (error) {
      if (request.current())
        setMmError(error instanceof Error ? error.message : 'Unable to load accounts.');
    } finally {
      if (request.current()) setMmLoading(false);
    }
  }, [id, canRead, beginMoneyRequest]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (tab === 'banking') void loadMobileMoney();
  }, [tab, loadMobileMoney]);
  const editor = usePayrollDraftEditor(
    ['employee-edit', 'termination', 'mobile-money'],
    (message) => {
      setNotice(message);
      void load();
      if (tab === 'banking') void loadMobileMoney();
    },
    (draft) =>
      (draft.context.kind === 'employee-edit'
        ? draft.context.recordId
        : draft.context.employeeId) === id,
    id,
  );
  const openEditor = (section: EmployeeSection) => {
    if (canEdit && emp) editor.open({ kind: 'employee-edit', record: emp, section });
  };

  const handleDelete = async () => {
    if (!canDelete || deletingEmployee) return;
    setDeletingEmployee(true);
    setDeleteError('');
    try {
      await backendDelete(`/hr/employees/${id}`);
      showToast('success', 'Employee deleted');
      router.push('/hr/employees');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete employee');
    } finally {
      setDeletingEmployee(false);
    }
  };

  const deleteMobileMoney = async () => {
    if (!deletingMm || !canEdit || removingAccount) return;
    setRemovingAccount(true);
    setMmDeleteError('');
    try {
      await backendDelete(`/hr/mobile-money-accounts/${deletingMm.id}`);
      setDeletingMm(null);
      await loadMobileMoney();
      setNotice('Mobile money account removed.');
    } catch (error) {
      setMmDeleteError(error instanceof Error ? error.message : 'Unable to remove this account.');
    } finally {
      setRemovingAccount(false);
    }
  };

  if (!canRead)
    return <PermissionDeniedState description="Your role cannot view employee records." />;
  if (loading) return <PageSpinner />;
  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!emp) return <ErrorState message="Employee not found." onRetry={load} />;

  const fullName = emp.fullName ?? `${emp.firstName} ${emp.lastName}`;
  const isTerminated = emp.employmentStatus === 'TERMINATED';
  const terminationPending = !isTerminated && Boolean(emp.terminationRequestedAt);

  const approveTermination = async () => {
    if (!canApproveTermination || approvingTermination) return;
    setApprovingTermination(true);
    setTerminationError('');
    try {
      await backendPatch(`/hr/employees/${id}/approve-termination`);
      setConfirmingTermination(false);
      setNotice('Termination approved.');
      await load();
    } catch (error) {
      setTerminationError(
        error instanceof Error ? error.message : 'Unable to approve termination.',
      );
    } finally {
      setApprovingTermination(false);
    }
  };

  return (
    <div className="business-workspace employee-profile space-y-5">
      <PageHeader
        title={fullName}
        subtitle={`${emp.employeeCode} · ${emp.position?.title ?? 'No Position'} · ${emp.company?.name ?? ''}`}
        breadcrumbs={[
          { label: 'Payroll', href: '/payroll' },
          { label: 'Employees', href: '/hr/employees' },
          { label: fullName },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            {tab === 'profile' && canEdit && (
              <Btn variant="primary" onClick={() => openEditor('profile')}>
                Edit profile
              </Btn>
            )}
            {tab === 'statutory' && canEdit && (
              <Btn variant="primary" onClick={() => openEditor('statutory')}>
                Edit tax & statutory
              </Btn>
            )}
            {tab === 'banking' && canEdit && (
              <Btn variant="primary" onClick={() => openEditor('banking')}>
                Edit bank details
              </Btn>
            )}
            {canRequestTermination && !isTerminated && !terminationPending && (
              <Btn
                variant="ghost"
                onClick={() => {
                  editor.open({ kind: 'termination', employee: emp });
                }}
              >
                Request Termination
              </Btn>
            )}
            {canApproveTermination && terminationPending && (
              <Btn
                variant="ghost"
                onClick={() => {
                  setTerminationError('');
                  setConfirmingTermination(true);
                }}
              >
                Approve Termination
              </Btn>
            )}
            {canDelete && (
              <Btn
                variant="ghost"
                onClick={() => {
                  setDeleteError('');
                  setConfirmingDelete(true);
                }}
              >
                Delete
              </Btn>
            )}
            <Btn variant="secondary" onClick={() => router.push('/hr/employees')}>
              All employees
            </Btn>
          </div>
        }
      />

      {editor.drafts}
      {notice && (
        <div role="status" className="workspace-notice">
          {notice}
        </div>
      )}
      <div className="employee-summary flex items-center gap-3 flex-wrap">
        <StatusBadge status={emp.employmentStatus ?? 'ACTIVE'} />
        {terminationPending && (
          <span className="text-xs px-2 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
            Termination pending approval
            {emp.terminationReason ? ` — ${emp.terminationReason}` : ''}
          </span>
        )}
        {emp.employmentType && (
          <span
            className="text-xs px-2 py-1 rounded-full"
            style={{ background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-secondary)' }}
          >
            {emp.employmentType.replaceAll('_', ' ')}
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

      <div className="employee-tabs" role="tablist" aria-label="Employee sections">
        {TABS.map((t, index) => (
          <button
            key={t.key}
            id={`${tabPrefix}-tab-${t.key}`}
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={`${tabPrefix}-panel`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
              else if (event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = TABS.length - 1;
              else return;
              event.preventDefault();
              setTab(TABS[next].key);
              document.getElementById(`${tabPrefix}-tab-${TABS[next].key}`)?.focus();
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <section
        id={`${tabPrefix}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabPrefix}-tab-${tab}`}
        tabIndex={0}
      >
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
                  ['Type', emp.employmentType?.replaceAll('_', ' ')],
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
                      ? `${emp.salaryCurrency ?? 'TZS'} ${Number.isFinite(Number(emp.baseSalary)) ? Number(emp.baseSalary).toLocaleString('en-TZ') : '0'}`
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
                    emp.disabilityStatus && emp.disabilityStatus !== 'NONE'
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

            <div className="flex justify-between items-center gap-3">
              <h2>Mobile money accounts</h2>
              {canEdit && (
                <Btn
                  variant="secondary"
                  onClick={() => {
                    editor.open({ kind: 'mobile-money', employee: emp });
                  }}
                >
                  Add account
                </Btn>
              )}
            </div>
            <RecordBrowser
              stateKey={stateKey + '.mobile-money.selection'}
              selectionScope={id}
              records={mobileMoney}
              title="Mobile money accounts"
              name={(account) => PROVIDER_LABELS[account.provider] ?? account.provider}
              reference={(account) => account.msisdn}
              status={(account) => account.status}
              loading={mmLoading}
              error={mmError}
              onRetry={loadMobileMoney}
              empty="No mobile money accounts have been registered for this employee."
              fields={[
                { label: 'Account name', value: (account) => account.accountName || '—' },
                {
                  label: 'Disbursement',
                  value: (account) =>
                    account.isPrimary ? 'Primary account' : 'Additional account',
                },
              ]}
              details={[{ label: 'Notes', value: (account) => account.notes || '—' }]}
              actions={
                canEdit
                  ? (account) => (
                      <>
                        <Btn
                          onClick={() => {
                            editor.open({ kind: 'mobile-money', employee: emp, record: account });
                          }}
                        >
                          Edit account
                        </Btn>
                        {!account.isPrimary && (
                          <Btn
                            variant="ghost"
                            onClick={() => {
                              setMmDeleteError('');
                              setDeletingMm(account);
                            }}
                          >
                            Remove account
                          </Btn>
                        )}
                      </>
                    )
                  : undefined
              }
            />
          </div>
        )}

        {(
          ['assignments', 'contracts', 'attendance', 'leave', 'payroll', 'documents'] as string[]
        ).includes(tab) && (
          <EmployeeRelatedRecords
            key={`${id}-${tab}`}
            employeeId={id}
            section={tab as EmployeeRelatedSection}
          />
        )}
      </section>
      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete ${fullName}?`}
        loading={deletingEmployee}
        variant="danger"
        confirmLabel="Delete"
        message={
          deleteError ||
          `Permanently delete ${fullName} (${emp.employeeCode})? Deletion is only for records created in error — to end a real employee's employment, use the termination workflow instead. Deletion is blocked while active allowances, deductions, open leave requests, unsettled salary advances, or payroll entries exist.`
        }
        onConfirm={handleDelete}
        onCancel={() => {
          if (deletingEmployee) return;
          setConfirmingDelete(false);
          setDeleteError('');
        }}
      />

      <ConfirmDialog
        open={!!deletingMm}
        title={`Remove account for ${fullName}?`}
        loading={removingAccount}
        variant="danger"
        confirmLabel="Remove"
        message={
          mmDeleteError ||
          `Remove ${deletingMm ? (PROVIDER_LABELS[deletingMm.provider] ?? deletingMm.provider) : ''} account?`
        }
        onConfirm={deleteMobileMoney}
        onCancel={() => {
          if (!removingAccount) setDeletingMm(null);
        }}
      />

      <ConfirmDialog
        open={confirmingTermination}
        title="Approve Termination"
        loading={approvingTermination}
        variant="danger"
        confirmLabel={approvingTermination ? 'Approving…' : 'Approve Termination'}
        message={
          terminationError ||
          `Terminate ${fullName} (${emp.employeeCode})${emp.pendingTerminationDate ? ` effective ${new Date(emp.pendingTerminationDate).toLocaleDateString('en-GB')}` : ''}? Reason: ${emp.terminationReason ?? '—'}. This ends their employment and cannot be undone from this screen.`
        }
        onConfirm={approveTermination}
        onCancel={() => {
          if (!approvingTermination) setConfirmingTermination(false);
        }}
      />
    </div>
  );
}

function KvList({ rows }: { rows: Array<[string, unknown]> }) {
  const visible = rows.filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (visible.length === 0)
    return <p className="text-xs italic text-slate-400">No data captured.</p>;
  return (
    <dl className="employee-facts">
      {visible.map(([label, value]) => (
        <div key={label}>
          <dt className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
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
