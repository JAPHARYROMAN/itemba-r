'use client';
import { useState } from 'react';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { Btn, FormDateField, FormInput, FormSelect, PageHeader, PermissionDeniedState } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { RecordBrowser } from './record-browser';
import { disputeLabel } from './dispute-types';
import type { HrReportResult, ReportKind } from './hr-report-types';
import {
  reports,
  reportStatuses,
  reportFields,
  ReportSummary,
  reportEmployeeName,
} from './hr-report-content';
import './workspace.css';
import './hr-reports.css';

export function HrReportWorkspace() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('hr.reports.view');
  const canChooseCompany = hasPermission('companies.read');
  const [kind, setKind] = useState<ReportKind>('employees');
  const [filters, setFilters] = useState({
    companyId: '',
    search: '',
    status: '',
    dateFrom: '',
    dateTo: '',
    payrollPeriodId: '',
  });
  const [page, setPage] = useState(1);
  const [generated, setGenerated] = useState('');
  const [validation, setValidation] = useState('');
  const companyId = filters.companyId;
  const key = JSON.stringify([kind, filters]);
  const query: Record<string, string | number> = { companyId, page, limit: 20 };
  if (kind === 'employees') {
    query.search = filters.search.trim();
    query.status = filters.status;
  }
  if (kind === 'payroll') {
    query.payrollPeriodId = filters.payrollPeriodId;
    query.status = filters.status;
  }
  if (kind === 'attendance' || kind === 'leave') {
    query.dateFrom = filters.dateFrom;
    query.dateTo = filters.dateTo ? `${filters.dateTo}T23:59:59.999Z` : '';
  }
  if (kind === 'leave') query.status = filters.status;
  const result = useWorkspaceResource<HrReportResult>(
    `/hr/reports/${kind}`,
    query,
    canRead && generated === key,
  );
  const companies = useWorkspaceChoices<{ id: string; name: string }>(
    '/companies',
    {},
    canRead && canChooseCompany,
  );
  const periods = useWorkspaceChoices<{ id: string; name: string; company?: { name: string } }>(
    '/hr/payroll-periods',
    { companyId },
    canRead && kind === 'payroll' && hasPermission('payroll.view'),
  );
  function change(field: keyof typeof filters, value: string) {
    setFilters((f) => ({
      ...f,
      [field]: value,
      ...(field === 'companyId' ? { payrollPeriodId: '' } : {}),
    }));
    setGenerated('');
    setValidation('');
    setPage(1);
  }
  function run() {
    if (
      (kind === 'attendance' || kind === 'leave') &&
      filters.dateFrom &&
      filters.dateTo &&
      filters.dateFrom > filters.dateTo
    ) {
      setValidation('From date must be on or before To date.');
      return;
    }
    setValidation('');
    setPage(1);
    setGenerated(key);
    if (generated === key) result.reload();
  }
  if (!canRead) return <PermissionDeniedState description="Your role cannot view HR reports." />;
  const meta = reports.find((r) => r.key === kind)!;
  const data = result.data;
  return (
    <div className="business-workspace record-workspace hr-report-workspace">
      <PageHeader
        title="People reports"
        subtitle="Review workforce records, attendance, payroll and leave."
        breadcrumbs={[{ label: 'People', href: '/hr' }, { label: 'Reports' }]}
        actions={
          hasPermission('payroll.view') && (
            <>
              <Link className="workspace-secondary-link" href="/hr/reports/statutory">
                Statutory returns
              </Link>
              <Link className="workspace-secondary-link" href="/hr/reports/wcf-exposure">
                WCF exposure
              </Link>
            </>
          )
        }
      />
      <div role="group" aria-label="Report type" className="hr-report-options">
        {reports.map((r) => (
          <button
            key={r.key}
            aria-pressed={kind === r.key}
            onClick={() => {
              setKind(r.key);
              setGenerated('');
              setValidation('');
              setPage(1);
              setFilters((f) => ({ ...f, status: '', payrollPeriodId: '' }));
            }}
          >
            {r.label}
          </button>
        ))}
      </div>
      <p className="hr-report-description">{meta.description}</p>
      <form
        className="hr-report-filters"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        {canChooseCompany && (
          <FormSelect
            label="Company"
            value={companyId}
            onChange={(e) => change('companyId', e.target.value)}
            options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
            placeholder={companies.loading ? 'Loading companies…' : 'All accessible companies'}
            disabled={companies.loading || !!companies.error}
          />
        )}
        {kind === 'employees' && (
          <FormInput
            label="Employee name or code"
            value={filters.search}
            onChange={(e) => change('search', e.target.value)}
          />
        )}
        {kind !== 'attendance' && (
          <FormSelect
            label="Status"
            value={filters.status}
            onChange={(e) => change('status', e.target.value)}
            options={reportStatuses[kind].map((value) => ({ value, label: disputeLabel(value) }))}
            placeholder="All statuses"
          />
        )}
        {(kind === 'attendance' || kind === 'leave') && (
          <>
            <FormDateField
              label="From date"
              value={filters.dateFrom}
              onChange={(value) => change('dateFrom', value)}
            />
            <FormDateField
              label="To date"
              value={filters.dateTo}
              onChange={(value) => change('dateTo', value)}
            />
          </>
        )}
        {kind === 'payroll' && hasPermission('payroll.view') && (
          <FormSelect
            label="Pay period"
            value={filters.payrollPeriodId}
            onChange={(e) => change('payrollPeriodId', e.target.value)}
            options={periods.rows.map((p) => ({
              value: p.id,
              label: `${p.name}${p.company ? ' · ' + p.company.name : ''}`,
            }))}
            placeholder={periods.loading ? 'Loading periods…' : 'All pay periods'}
            disabled={periods.loading || !!periods.error}
          />
        )}
        <Btn type="submit" loading={result.loading} disabled={result.loading}>
          Generate report
        </Btn>
      </form>
      {validation && (
        <p role="alert" className="workspace-notice">
          {validation}
        </p>
      )}
      {companies.error && (
        <div role="alert" className="workspace-notice">
          Company choices unavailable. {companies.error}
          <Btn variant="ghost" onClick={companies.retry}>
            Retry companies
          </Btn>
        </div>
      )}
      {kind === 'payroll' && periods.error && (
        <div role="alert" className="workspace-notice">
          {periods.error}
          <Btn variant="ghost" onClick={periods.retry}>
            Retry periods
          </Btn>
        </div>
      )}
      {generated !== key ? (
        <div className="hr-report-prompt">
          <h2>Choose your report</h2>
          <p>
            Set any filters, then generate the report. Results cover the companies you can access.
          </p>
        </div>
      ) : (
        <>
          {data && !result.loading && !result.error && <ReportSummary data={data} kind={kind} />}
          <RecordBrowser
            key={kind}
            title={`${meta.label} report`}
            records={data?.data || []}
            total={data?.total || 0}
            page={page}
            pageSize={20}
            onPage={setPage}
            name={(r) =>
              kind === 'payroll'
                ? r.payrollPeriod?.name || r.payrollRunNumber || 'Payroll run'
                : reportEmployeeName(r)
            }
            reference={(r) =>
              kind === 'employees'
                ? r.employeeCode || ''
                : kind === 'attendance'
                  ? r.attendanceNumber || ''
                  : kind === 'payroll'
                    ? r.payrollRunNumber || ''
                    : r.leaveRequestNumber || ''
            }
            status={(r) =>
              kind === 'employees'
                ? r.employmentStatus || 'UNKNOWN'
                : kind === 'attendance'
                  ? r.attendanceStatus || 'UNKNOWN'
                  : r.status || 'UNKNOWN'
            }
            fields={reportFields[kind].fields}
            details={reportFields[kind].details}
            loading={result.loading}
            error={result.error}
            onRetry={result.reload}
            actions={(r) =>
              kind === 'employees' && hasPermission('employees.view') ? (
                <Link className="workspace-primary-link" href={`/hr/employees/${r.id}`}>
                  Open employee
                </Link>
              ) : kind === 'payroll' && hasPermission('payroll.view') ? (
                <Link
                  className="workspace-primary-link"
                  href={`/hr/payroll-entries?payrollRunId=${r.id}`}
                >
                  View payroll entries
                </Link>
              ) : null
            }
          />
        </>
      )}
    </div>
  );
}
