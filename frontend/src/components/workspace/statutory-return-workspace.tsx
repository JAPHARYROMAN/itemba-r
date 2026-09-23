'use client';
import { useState } from 'react';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { Btn, FormInput, FormSelect, PageHeader, PermissionDeniedState } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { RecordBrowser } from './record-browser';
import {
  downloadReturnCsv,
  returnColumns,
  returnSummaryLabel,
  returnSummaryValue,
  returnTypes,
  type ReturnKind,
  type ReturnRow,
  type StatutoryReturn,
} from './statutory-return-types';
import './workspace.css';
import './hr-reports.css';

const months = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: new Date(2000, i, 1).toLocaleDateString('en-GB', { month: 'long' }),
}));
export function StatutoryReturnWorkspace() {
  const { user, hasPermission } = useAuth();
  const canRead = hasPermission('payroll.view');
  const canChooseCompany = hasPermission('companies.read');
  const [kind, setKind] = useState<ReturnKind>('paye');
  const [filters, setFilters] = useState(() => ({
    companyId: '',
    year: String(new Date().getFullYear()),
    month: String(new Date().getMonth() + 1),
  }));
  const companyId = canChooseCompany ? filters.companyId : user?.companyId || '';
  const [generated, setGenerated] = useState('');
  const [validation, setValidation] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [page, setPage] = useState(1);
  const query = { companyId, year: filters.year, month: filters.month };
  const key = JSON.stringify([kind, query]);
  const result = useWorkspaceResource<StatutoryReturn>(
    `/hr/statutory-returns/${kind}`,
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
    setDownloadError('');
    setPage(1);
  }
  function generate() {
    if (!companyId) {
      setValidation('Select a company to generate a return.');
      return;
    }
    const year = Number(filters.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      setValidation('Enter a year from 2000 to 2100.');
      return;
    }
    setValidation('');
    setDownloadError('');
    setPage(1);
    setGenerated(key);
    if (generated === key) result.reload();
  }
  if (!canRead)
    return <PermissionDeniedState description="Your role cannot view statutory returns." />;
  const data = result.data;
  const rows: ReturnRow[] = (data?.rows || []).map((row, i) => ({
    ...row,
    id: `${row.employeeId || 'row'}-${i}`,
  }));
  const columns = returnColumns[kind].map((c) => ({
    label: c.label,
    value: (r: ReturnRow) => c.format(r[c.key]),
  }));
  return (
    <div className="business-workspace hr-report-workspace statutory-return-workspace">
      <PageHeader
        title="Statutory returns"
        subtitle="Review recorded payroll contributions and download a monthly CSV."
        breadcrumbs={[
          { label: 'People', href: '/hr' },
          { label: 'Reports', href: '/hr/reports' },
          { label: 'Statutory returns' },
        ]}
        actions={
          <Link className="workspace-secondary-link" href="/hr/reports/wcf-exposure">
            WCF exposure
          </Link>
        }
      />
      <div role="group" aria-label="Return type" className="hr-report-options">
        {returnTypes.map((t) => (
          <button
            key={t.key}
            aria-pressed={kind === t.key}
            onClick={() => {
              setKind(t.key);
              setGenerated('');
              setValidation('');
              setDownloadError('');
              setPage(1);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="hr-report-description">
        {returnTypes.find((t) => t.key === kind)!.description}
      </p>
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
            options={companies.rows.map((c) => ({
              value: c.id,
              label: `${c.name}${c.code ? ` (${c.code})` : ''}`,
            }))}
            placeholder={companies.loading ? 'Loading companies…' : 'Select company'}
            disabled={companies.loading || !!companies.error}
          />
        ) : (
          <p className="hr-report-description">
            {companyId
              ? 'Company: your assigned company. The generated return shows its name.'
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
          label="Month"
          value={filters.month}
          options={months}
          onChange={(e) => change('month', e.target.value)}
        />
        <Btn
          type="submit"
          variant={data && !result.error ? 'secondary' : 'primary'}
          loading={result.loading}
          disabled={!companyId || result.loading}
        >
          Generate return
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
          <p>Generate a return to review its totals and employee records.</p>
        </div>
      ) : (
        <>
          {data && !result.loading && !result.error && (
            <>
              <section className="statutory-return-heading" aria-label="Generated return">
                <div>
                  <p className="hr-report-description">{data.formCode}</p>
                  <h2>{data.formName}</h2>
                  <p>
                    {data.header.companyName}
                    {data.header.companyTin ? ` · TIN ${data.header.companyTin}` : ''}
                  </p>
                  <p>{data.header.periodLabel}</p>
                </div>
                <Btn
                  onClick={() => {
                    try {
                      downloadReturnCsv(data.file);
                      setDownloadError('');
                    } catch {
                      setDownloadError('The CSV could not be downloaded. Try Download CSV again.');
                    }
                  }}
                >
                  Download CSV ({data.file.rowCount} {data.file.rowCount === 1 ? 'row' : 'rows'})
                </Btn>
                <p className="statutory-return-context">
                  Generated from recorded payroll lines. Downloading does not submit, approve or
                  file the return.
                </p>
              </section>
              {downloadError && (
                <p role="alert" className="workspace-notice">
                  {downloadError}
                </p>
              )}
              <section className="hr-report-totals" aria-label="Complete return totals">
                <p>Complete return · totals across every page</p>
                <dl>
                  {Object.entries(data.summary).map(([k, v]) => (
                    <div key={k}>
                      <dt>{returnSummaryLabel(k)}</dt>
                      <dd>{returnSummaryValue(k, v)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </>
          )}
          <RecordBrowser
            key={key}
            title={`${kind.toUpperCase()} records`}
            records={rows.slice((page - 1) * 20, page * 20)}
            total={rows.length}
            page={page}
            pageSize={20}
            onPage={setPage}
            name={(r) => String(r.fullName || r.employeeCode || 'Employee')}
            reference={(r) => String(r.employeeCode || '')}
            fields={columns.slice(0, 2)}
            details={columns.slice(2)}
            loading={result.loading}
            error={result.error}
            onRetry={result.reload}
            empty={`No ${kind.toUpperCase()} records in this return.`}
          />
        </>
      )}
    </div>
  );
}
