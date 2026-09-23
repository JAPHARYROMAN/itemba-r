'use client';
import { Suspense, useEffect, useState } from 'react';
import { useWorkspaceSearchParams as useSearchParams } from '@/components/workspace/workspace-navigation';
import { Plus, RefreshCw } from 'lucide-react';
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
import { PayrollFilesDialog } from '@/components/workspace/payroll-run-dialogs';
import {
  PayrollPeriodChoice,
  PayrollRunRecord,
  payrollActionLabels,
  payrollActions,
  payrollLabel,
  payrollMoney,
  periodName,
  runName,
} from '@/components/workspace/payroll-types';
import { useAuth } from '@/hooks/use-auth';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import '@/components/workspace/workspace.css';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { usePayrollDraftEditor, usePayrollStateKey } from '@/features/payroll/payroll-drafts';
const statuses = ['DRAFT', 'CALCULATED', 'SUBMITTED', 'APPROVED', 'PAID', 'CANCELLED'];
function PayrollRunsContent() {
  const searchParams = useSearchParams(),
    router = useGuardedRouter();
  const urlPeriod = searchParams.get('payrollPeriodId') ?? searchParams.get('periodId') ?? '';
  const urlCompany = searchParams.get('companyId') ?? '';
  const urlStatus = statuses.includes(searchParams.get('status') ?? '')
    ? searchParams.get('status')!
    : '';
  const { hasPermission } = useAuth();
  const canRead = hasPermission('payroll.view'),
    canCreate = hasPermission('payroll.manage');
  const stateKey = usePayrollStateKey('payroll-runs');
  const urlKey = JSON.stringify([urlCompany, urlPeriod, urlStatus]);
  const [querySource, setQuerySource] = useWorkspaceState(stateKey + '.querySource', urlKey);
  const [period, setPeriod] = useWorkspaceState(stateKey + '.period', urlPeriod),
    [company, setCompany] = useWorkspaceState(stateKey + '.company', urlCompany),
    [status, setStatus] = useWorkspaceState(stateKey + '.status', urlStatus),
    [page, setPage] = useWorkspaceState(stateKey + '.page', 1),
    [search, setSearch] = useWorkspaceState(stateKey + '.search', ''),
    [query, setQuery] = useState(search.trim());
  useEffect(() => {
    if (querySource !== urlKey) {
      setPeriod(urlPeriod);
      setCompany(urlCompany);
      setStatus(urlStatus);
      setPage(1);
    }
    setQuerySource(urlKey);
  }, [
    querySource,
    urlKey,
    urlPeriod,
    urlCompany,
    urlStatus,
    setPeriod,
    setCompany,
    setStatus,
    setPage,
    setQuerySource,
  ]);
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, query, setPage]);
  const result = useWorkspaceRecords<PayrollRunRecord>(
    '/hr/payroll-runs',
    { page, limit: 20, payrollPeriodId: period, companyId: company, status, search: query },
    canRead,
  );
  const scope = useOrgScope(undefined, {
    skipBranches: true,
    skipDivisions: true,
    skipEmployees: true,
  });
  const periods = useWorkspaceChoices<PayrollPeriodChoice>(
    '/hr/payroll-periods',
    { companyId: company },
    canRead,
  );
  const periodOptions = periods.rows.map((p) => ({
    value: p.id,
    label: [p.payrollPeriodCode, p.name, p.company?.name].filter(Boolean).join(' · '),
  }));
  if (period && !periodOptions.some((p) => p.value === period))
    periodOptions.unshift({ value: period, label: 'Selected period' });
  const [notice, setNotice] = useState(''),
    [filesRun, setFilesRun] = useState<PayrollRunRecord | null>(null);
  const entry = usePayrollDraftEditor(['payroll-run', 'payroll-action'], (message) => {
    setNotice(message);
    void result.reload();
  });
  useEffect(() => {
    if (!result.loading && !result.error && page > 1 && !result.rows.length)
      setPage(Math.max(1, Math.ceil(result.total / 20)));
  }, [result.loading, result.error, result.rows.length, result.total, page, setPage]);
  if (!canRead) return <PermissionDeniedState description="Your role cannot view payroll runs." />;
  return (
    <div className="business-workspace record-workspace">
      <PageHeader
        title="Payroll runs"
        subtitle="Review, calculate and sign off each pay cycle."
        breadcrumbs={[{ label: 'Payroll', href: '/payroll' }, { label: 'Payroll runs' }]}
        actions={
          canCreate && (
            <Btn
              icon={<Plus size={16} />}
              onClick={() =>
                entry.open({ kind: 'payroll-run', companyId: company, periodId: period })
              }
            >
              New run
            </Btn>
          )
        }
      />
      <div className="workspace-summary">
        <div>
          <span>Matching runs</span>
          <strong>{result.total}</strong>
        </div>
        <div>
          <span>Awaiting sign-off on this page</span>
          <strong>{result.rows.filter((r) => r.status === 'SUBMITTED').length}</strong>
        </div>
      </div>
      {notice && (
        <div role="status" className="workspace-notice">
          {notice}
        </div>
      )}
      {scope.error && (
        <div role="alert" className="workspace-notice">
          {scope.error}{' '}
          <Btn variant="ghost" onClick={scope.retry}>
            Retry companies
          </Btn>
        </div>
      )}
      {periods.error && (
        <div role="alert" className="workspace-notice">
          {periods.error}{' '}
          <Btn variant="ghost" onClick={periods.retry}>
            Retry periods
          </Btn>
        </div>
      )}
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search by run number or period…"
        collapsibleFilters
        activeFilterCount={Number(!!company) + Number(!!period) + Number(!!status)}
        filters={
          <>
            <FormSelect
              label="Company filter"
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                setPeriod('');
                setPage(1);
              }}
              options={scope.companyOptions}
              placeholder="All companies"
            />
            <FormSelect
              label="Period filter"
              value={period}
              disabled={periods.loading}
              onChange={(e) => {
                setPeriod(e.target.value);
                setPage(1);
              }}
              options={periodOptions}
              placeholder={periods.loading ? 'Loading periods…' : 'All periods'}
            />
            <FormSelect
              label="Status filter"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              options={statuses.map((value) => ({ value, label: payrollLabel(value) }))}
              placeholder="All statuses"
            />
          </>
        }
        actions={
          <Btn
            variant="secondary"
            icon={<RefreshCw size={15} />}
            onClick={result.reload}
            disabled={result.loading}
          >
            Reload
          </Btn>
        }
      />
      {entry.drafts}
      <RecordBrowser
        stateKey={stateKey + '.selection'}
        selectionScope={JSON.stringify([period, company, status, query])}
        title="Payroll runs"
        records={result.rows}
        name={runName}
        reference={periodName}
        status={(r) => r.status}
        page={page}
        pageSize={20}
        total={result.total}
        onPage={setPage}
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        fields={[
          { label: 'Gross pay', value: (r) => payrollMoney(r.totalGrossPay ?? r.totalGross) },
          { label: 'Net pay', value: (r) => payrollMoney(r.totalNetPay ?? r.totalNet) },
        ]}
        details={[
          { label: 'Company', value: (r) => r.company?.name || '—' },
          {
            label: 'Run type',
            value: (r) => payrollLabel(r.payrollType || r.runType || 'REGULAR'),
          },
          { label: 'HR sign-off', value: (r) => (r.hrApprovedById ? 'Recorded' : 'Not recorded') },
          {
            label: 'Finance sign-off',
            value: (r) => (r.financeApprovedById ? 'Recorded' : 'Not recorded'),
          },
          {
            label: 'Run date',
            value: (r) => (r.runDate ? new Date(r.runDate).toLocaleDateString('en-GB') : '—'),
          },
          { label: 'Notes', value: (r) => r.notes || '—' },
        ]}
        actions={(r) => (
          <>
            <Btn
              variant="secondary"
              onClick={() =>
                router.push('/hr/payroll-entries?payrollRunId=' + encodeURIComponent(r.id))
              }
            >
              View entries
            </Btn>
            {payrollActions(r, hasPermission).map((a) => (
              <Btn
                key={a}
                variant="ghost"
                onClick={() => entry.open({ kind: 'payroll-action', record: r, action: a })}
              >
                {a === 'calculate' && r.status === 'CALCULATED'
                  ? 'Recalculate run'
                  : payrollActionLabels[a]}
              </Btn>
            ))}
            {['CALCULATED', 'SUBMITTED', 'APPROVED', 'PAID'].includes(r.status) && (
              <Btn
                variant="ghost"
                onClick={() =>
                  router.push('/hr/payroll-runs/' + encodeURIComponent(r.id) + '/payslips')
                }
              >
                Payslips
              </Btn>
            )}
            {hasPermission('payroll.pay') &&
              ['CALCULATED', 'APPROVED', 'PAID'].includes(r.status) && (
                <Btn variant="ghost" onClick={() => setFilesRun(r)}>
                  Disbursement files
                </Btn>
              )}
          </>
        )}
      />
      {filesRun && <PayrollFilesDialog run={filesRun} onClose={() => setFilesRun(null)} />}
    </div>
  );
}
export default function PayrollRunsPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <PayrollRunsContent />
    </Suspense>
  );
}
