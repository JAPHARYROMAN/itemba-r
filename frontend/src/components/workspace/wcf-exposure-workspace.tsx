'use client';
import { useState } from 'react';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { Btn, FormInput, FormSelect, PageHeader, PermissionDeniedState } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { RecordBrowser } from './record-browser';
import { payrollMoney } from './payroll-types';
import { wcfMonthName, wcfMonths, type WcfBranch, type WcfExposure } from './wcf-exposure-types';
import './workspace.css';
import './hr-reports.css';
import './wcf-exposure.css';

function BranchMonths({ branch, months }: { branch: WcfBranch; months: number[] }) {
  return (
    <ol className="wcf-months">
      {months.map((month) => {
        const row = branch.monthlyExposure.find((m) => m.month === month);
        return (
          <li key={month}>
            <strong>{wcfMonthName(month)}</strong>
            {row ? (
              <dl>
                <div>
                  <dt>Gross pay</dt>
                  <dd>{payrollMoney(row.gross)}</dd>
                </div>
                <div>
                  <dt>WCF</dt>
                  <dd>{payrollMoney(row.wcfAmount)}</dd>
                </div>
                <div>
                  <dt>Employees</dt>
                  <dd>{row.employees.toLocaleString()}</dd>
                </div>
              </dl>
            ) : (
              <p>No recorded lines.</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
export function WcfExposureWorkspace() {
  const { user, hasPermission } = useAuth();
  const canRead = hasPermission('payroll.view');
  const canChooseCompany = hasPermission('companies.read');
  const [filters, setFilters] = useState(() => ({
    companyId: '',
    year: String(new Date().getFullYear()),
    fromMonth: '1',
    toMonth: String(new Date().getMonth() + 1),
  }));
  const companyId = canChooseCompany ? filters.companyId : user?.companyId || '';
  const query = { ...filters, companyId };
  const key = JSON.stringify(query);
  const [generated, setGenerated] = useState('');
  const [validation, setValidation] = useState('');
  const [page, setPage] = useState(1);
  const result = useWorkspaceResource<WcfExposure>(
    '/hr/wcf-audit/exposure',
    query,
    canRead && generated === key,
  );
  const companies = useWorkspaceChoices<{ id: string; name: string; code?: string }>(
    '/companies',
    {},
    canRead && canChooseCompany,
  );
  function change(field: keyof typeof filters, value: string) {
    setFilters((f) => ({ ...f, [field]: value }));
    setGenerated('');
    setValidation('');
    setPage(1);
  }
  function generate() {
    if (!companyId) {
      setValidation('Select a company to generate the report.');
      return;
    }
    const year = Number(filters.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      setValidation('Enter a year from 2000 to 2100.');
      return;
    }
    if (Number(filters.fromMonth) > Number(filters.toMonth)) {
      setValidation('From month must be on or before To month.');
      return;
    }
    setValidation('');
    setGenerated(key);
    setPage(1);
    if (generated === key) result.reload();
  }
  if (!canRead) return <PermissionDeniedState description="Your role cannot view WCF exposure." />;
  const data = result.data;
  const months = data
    ? Array.from(
        { length: data.header.toMonth - data.header.fromMonth + 1 },
        (_, i) => data.header.fromMonth + i,
      )
    : [];
  const branches = (data?.branches || []).map((b) => ({ ...b, id: b.branchId || 'unassigned' }));
  return (
    <div className="business-workspace hr-report-workspace wcf-exposure-workspace">
      <PageHeader
        title="WCF exposure"
        subtitle="Review recorded gross pay and WCF contributions by branch and month."
        breadcrumbs={[
          { label: 'People', href: '/hr' },
          { label: 'Reports', href: '/hr/reports' },
          { label: 'WCF exposure' },
        ]}
        actions={
          <Link className="workspace-secondary-link" href="/hr/reports/statutory">
            Statutory returns
          </Link>
        }
      />
      <form
        className="hr-report-filters"
        onSubmit={(e) => {
          e.preventDefault();
          generate();
        }}
      >
        {canChooseCompany ? (
          <FormSelect
            label="Company"
            value={companyId}
            onChange={(e) => change('companyId', e.target.value)}
            options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
            placeholder={companies.loading ? 'Loading companies…' : 'Select company'}
            disabled={companies.loading || !!companies.error}
          />
        ) : (
          <p className="hr-report-description">
            {companyId
              ? 'Using your assigned company.'
              : 'A company is required. Your account needs an assigned company or permission to choose one.'}
          </p>
        )}
        <FormInput
          label="Year"
          type="number"
          min={2000}
          max={2100}
          step={1}
          required
          value={filters.year}
          onChange={(e) => change('year', e.target.value)}
        />
        <FormSelect
          label="From month"
          options={wcfMonths}
          value={filters.fromMonth}
          onChange={(e) => change('fromMonth', e.target.value)}
        />
        <FormSelect
          label="To month"
          options={wcfMonths}
          value={filters.toMonth}
          onChange={(e) => change('toMonth', e.target.value)}
        />
        <Btn type="submit" disabled={!companyId || result.loading} loading={result.loading}>
          Generate report
        </Btn>
      </form>
      {companies.error && (
        <div role="alert" className="workspace-notice">
          Company choices unavailable. {companies.error}
          <Btn variant="ghost" onClick={companies.retry}>
            Retry companies
          </Btn>
        </div>
      )}
      {validation && (
        <p role="alert" className="workspace-notice">
          {validation}
        </p>
      )}
      {generated !== key ? (
        <div className="hr-report-prompt">
          <h2>Choose a company and period</h2>
          <p>Select a year and month range to review branch exposure.</p>
        </div>
      ) : (
        <>
          {data && !result.loading && !result.error && (
            <>
              <section className="statutory-return-heading" aria-label="Generated exposure report">
                <div>
                  <h2>{data.header.companyName}</h2>
                  <p>
                    {data.header.periodLabel}
                    {data.header.companyTin ? ` · TIN ${data.header.companyTin}` : ''}
                  </p>
                </div>
              </section>
              <section className="hr-report-totals" aria-label="Complete exposure totals">
                <p>All branches · complete selected period</p>
                <dl>
                  <div>
                    <dt>Branches with records</dt>
                    <dd>{data.summary.branchCount}</dd>
                  </div>
                  <div>
                    <dt>Gross pay</dt>
                    <dd>{payrollMoney(data.summary.totalGross)}</dd>
                  </div>
                  <div>
                    <dt>WCF contributions</dt>
                    <dd>{payrollMoney(data.summary.totalWcf)}</dd>
                  </div>
                  <div>
                    <dt>Effective recorded rate</dt>
                    <dd>{(data.summary.effectiveRate * 100).toFixed(2)}%</dd>
                  </div>
                </dl>
              </section>
              {data.branches.length > 0 && (
                <details className="wcf-company-months">
                  <summary>Monthly totals across all branches</summary>
                  <ol className="wcf-months wcf-month-grid">
                    {months.map((month) => {
                      const lines = data.branches.flatMap((b) =>
                        b.monthlyExposure.filter((m) => m.month === month),
                      );
                      return (
                        <li key={month}>
                          <strong>
                            {wcfMonthName(month)} {data.header.year}
                          </strong>
                          <dl>
                            <div>
                              <dt>Gross pay</dt>
                              <dd>{payrollMoney(lines.reduce((sum, m) => sum + m.gross, 0))}</dd>
                            </div>
                            <div>
                              <dt>WCF</dt>
                              <dd>
                                {payrollMoney(lines.reduce((sum, m) => sum + m.wcfAmount, 0))}
                              </dd>
                            </div>
                          </dl>
                        </li>
                      );
                    })}
                  </ol>
                </details>
              )}
            </>
          )}
          <RecordBrowser
            key={key}
            title="Branch exposure"
            records={branches.slice((page - 1) * 20, page * 20)}
            total={branches.length}
            page={page}
            pageSize={20}
            onPage={setPage}
            name={(b) => b.branchName}
            reference={(b) => b.branchCode || 'No branch code'}
            fields={[
              { label: 'Gross pay', value: (b) => payrollMoney(b.totalGross) },
              { label: 'WCF', value: (b) => payrollMoney(b.totalWcf) },
            ]}
            details={[
              { label: 'Location', value: (b) => b.region || 'Not recorded' },
              {
                label: 'Distinct employees in period',
                value: (b) => b.totalEmployees.toLocaleString(),
              },
              {
                label: 'Monthly exposure',
                value: (b) => <BranchMonths branch={b} months={months} />,
              },
            ]}
            loading={result.loading}
            error={result.error}
            onRetry={result.reload}
            empty="No WCF contributions recorded in this period."
          />
        </>
      )}
    </div>
  );
}
