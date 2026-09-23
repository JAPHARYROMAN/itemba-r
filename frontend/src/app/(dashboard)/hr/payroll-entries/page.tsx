'use client';
import { Suspense, useEffect, useState } from 'react';
import { useWorkspaceSearchParams as useSearchParams } from '@/components/workspace/workspace-navigation';
import { RefreshCw } from 'lucide-react';
import {
  Btn,
  FormSelect,
  PageHeader,
  PageSpinner,
  PageToolbar,
  PermissionDeniedState,
} from '@/components/ui';
import { RecordBrowser } from '@/components/workspace/record-browser';
import { useWorkspaceRouter as useGuardedRouter } from '@/components/workspace/workspace-navigation';
import {
  PayrollRunRecord,
  payrollMoney,
  runName,
  periodName,
} from '@/components/workspace/payroll-types';
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useAuth } from '@/hooks/use-auth';
import '@/components/workspace/workspace.css';
interface PayrollEntry {
  id: string;
  employee?: { fullName?: string; employeeCode?: string };
  employeeId?: string;
  company?: { name?: string };
  payrollRunId?: string;
  payrollRun?: { id: string; payrollRunNumber?: string };
  basePay?: number | string;
  attendancePay?: number | string;
  overtimePay?: number | string;
  totalAllowances?: number | string;
  grossPay?: number | string;
  totalDeductions?: number | string;
  netPay?: number | string;
  daysWorked?: number | string;
  hoursWorked?: number | string;
  overtimeHours?: number | string;
  status: string;
  notes?: string;
  allowances?: { id: string; amount: number | string; allowanceType?: { name?: string } }[];
  deductions?: { id: string; amount: number | string; deductionType?: { name?: string } }[];
}
const employeeName = (e: PayrollEntry) =>
  e.employee?.fullName || e.employee?.employeeCode || 'Employee';
function PayrollEntriesContent() {
  const params = useSearchParams(),
    router = useGuardedRouter(),
    { hasPermission } = useAuth();
  const urlRun = params.get('payrollRunId') ?? params.get('runId') ?? '';
  const canRead = hasPermission('payroll.view');
  const [run, setRun] = useState(urlRun),
    [company, setCompany] = useState(''),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState('');
  useEffect(() => {
    setRun(urlRun);
    setPage(1);
  }, [urlRun]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const result = useWorkspaceRecords<PayrollEntry>(
    '/hr/payroll-entries',
    { page, limit: 20, payrollRunId: run, companyId: company, search: query },
    canRead,
  );
  const runs = useWorkspaceChoices<PayrollRunRecord>(
    '/hr/payroll-runs',
    { companyId: company },
    canRead,
  );
  const scope = useOrgScope(undefined, {
    skipBranches: true,
    skipDivisions: true,
    skipEmployees: true,
  });
  const runOptions = runs.rows.map((r) => ({
    value: r.id,
    label: runName(r) + ' · ' + periodName(r),
  }));
  if (run && !runOptions.some((r) => r.value === run))
    runOptions.unshift({ value: run, label: 'Selected payroll run' });
  if (!canRead)
    return <PermissionDeniedState description="Your role cannot view payroll entries." />;
  return (
    <div className="business-workspace record-workspace">
      <PageHeader
        title="Payroll entries"
        subtitle="Understand each employee’s pay, before moving ahead."
        breadcrumbs={[
          { label: 'Payroll', href: '/payroll' },
          { label: 'Payroll runs', href: '/hr/payroll-runs' },
          { label: 'Entries' },
        ]}
      />
      <div className="workspace-summary">
        <div>
          <span>Matching entries</span>
          <strong>{result.total}</strong>
        </div>
      </div>
      {scope.error && (
        <div role="alert" className="workspace-notice">
          {scope.error}{' '}
          <Btn variant="ghost" onClick={scope.retry}>
            Retry companies
          </Btn>
        </div>
      )}
      {runs.error && (
        <div role="alert" className="workspace-notice">
          {runs.error}{' '}
          <Btn variant="ghost" onClick={runs.retry}>
            Retry runs
          </Btn>
        </div>
      )}
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search employee or run number…"
        collapsibleFilters
        activeFilterCount={Number(!!run) + Number(!!company)}
        filters={
          <>
            <FormSelect
              label="Company filter"
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                setRun('');
                setPage(1);
              }}
              options={scope.companyOptions}
              placeholder="All companies"
            />
            <FormSelect
              label="Payroll run filter"
              value={run}
              disabled={runs.loading}
              onChange={(e) => {
                setRun(e.target.value);
                setPage(1);
              }}
              options={runOptions}
              placeholder={runs.loading ? 'Loading runs…' : 'All runs'}
            />
          </>
        }
        actions={
          <Btn
            variant="secondary"
            onClick={result.reload}
            icon={<RefreshCw size={15} />}
            disabled={result.loading}
          >
            Reload
          </Btn>
        }
      />
      <RecordBrowser
        title="Payroll entries"
        records={result.rows}
        name={employeeName}
        reference={(r) =>
          [r.employee?.employeeCode, r.payrollRun?.payrollRunNumber].filter(Boolean).join(' · ')
        }
        status={(r) => r.status}
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        page={page}
        total={result.total}
        pageSize={20}
        onPage={setPage}
        fields={[
          { label: 'Gross pay', value: (r) => payrollMoney(r.grossPay) },
          { label: 'Net pay', value: (r) => payrollMoney(r.netPay) },
        ]}
        details={[
          { label: 'Company', value: (r) => r.company?.name || '—' },
          { label: 'Base pay', value: (r) => payrollMoney(r.basePay) },
          { label: 'Attendance pay', value: (r) => payrollMoney(r.attendancePay) },
          { label: 'Overtime pay', value: (r) => payrollMoney(r.overtimePay) },
          { label: 'Allowances', value: (r) => payrollMoney(r.totalAllowances) },
          { label: 'Total deductions', value: (r) => payrollMoney(r.totalDeductions) },
          {
            label: 'Days / hours worked',
            value: (r) => (r.daysWorked ?? '—') + ' days · ' + (r.hoursWorked ?? '—') + ' hours',
          },
          { label: 'Overtime hours', value: (r) => r.overtimeHours ?? '—' },
          {
            label: 'Allowance breakdown',
            value: (r) =>
              r.allowances?.length ? (
                <ul>
                  {r.allowances.map((a) => (
                    <li key={a.id}>
                      {a.allowanceType?.name || 'Allowance'} · {payrollMoney(a.amount)}
                    </li>
                  ))}
                </ul>
              ) : (
                'No allowance lines'
              ),
          },
          {
            label: 'Manual deduction breakdown',
            value: (r) =>
              r.deductions?.length ? (
                <ul>
                  {r.deductions.map((d) => (
                    <li key={d.id}>
                      {d.deductionType?.name || 'Deduction'} · {payrollMoney(d.amount)}
                    </li>
                  ))}
                </ul>
              ) : (
                'No manual deduction lines'
              ),
          },
          { label: 'Notes', value: (r) => r.notes || '—' },
        ]}
        actions={(r) => (
          <>
            <Btn
              variant="secondary"
              onClick={() => router.push('/hr/payslips/' + encodeURIComponent(r.id))}
            >
              View payslip
            </Btn>
            {(r.payrollRunId || r.payrollRun?.id) && (
              <Btn
                variant="ghost"
                onClick={() =>
                  router.push(
                    '/hr/payroll-runs/' +
                      encodeURIComponent(r.payrollRunId || r.payrollRun!.id) +
                      '/payslips',
                  )
                }
              >
                All payslips in this run
              </Btn>
            )}
          </>
        )}
      />
    </div>
  );
}
export default function PayrollEntriesPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <PayrollEntriesContent />
    </Suspense>
  );
}
