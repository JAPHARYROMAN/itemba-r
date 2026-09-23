'use client';

import { useEffect, useState } from 'react';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { usePayrollDraftEditor, usePayrollStateKey } from '@/features/payroll/payroll-drafts';

import { Plus, RefreshCw } from 'lucide-react';
import {
  Btn,
  ConfirmDialog,
  FormSelect,
  PageHeader,
  PageToolbar,
  PermissionDeniedState,
} from '@/components/ui';
import { RecordBrowser } from '@/components/workspace/record-browser';
import { useWorkspaceRouter as useGuardedRouter } from '@/components/workspace/workspace-navigation';
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useAuth } from '@/hooks/use-auth';
import { backendPut } from '@/lib/api-client';
import '@/components/workspace/workspace.css';

import type { PayrollPeriod } from '@/features/payroll/payroll-period-workflow';
const statuses = ['OPEN', 'PROCESSING', 'APPROVED', 'PAID', 'CLOSED', 'CANCELLED'];
const date = (value?: string) => (value ? new Date(value).toLocaleDateString('en-GB') : 'Not set');
const companyName = (r: PayrollPeriod) =>
  typeof r.company === 'string' ? r.company : r.company?.name || '—';
type StatusAction = { record: PayrollPeriod; status: 'APPROVED' | 'CLOSED' };

export default function PayrollPeriodsPage() {
  const router = useGuardedRouter();
  const { hasPermission } = useAuth();
  const canRead = hasPermission('payroll.view'),
    canManage = hasPermission('payroll.manage');
  const stateKey = usePayrollStateKey('payroll-periods');
  const [page, setPage] = useWorkspaceState(stateKey + '.page', 1),
    [search, setSearch] = useWorkspaceState(stateKey + '.search', ''),
    [query, setQuery] = useState(search.trim());
  const [company, setCompany] = useWorkspaceState(stateKey + '.company', ''),
    [status, setStatus] = useWorkspaceState(stateKey + '.status', '');
  const result = useWorkspaceRecords<PayrollPeriod>(
    '/hr/payroll-periods',
    { page, limit: 20, search: query, companyId: company, status },
    canRead,
  );
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, query, setPage]);
  const scope = useOrgScope(undefined, {
    skipBranches: true,
    skipDivisions: true,
    skipEmployees: true,
  });
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState<StatusAction | null>(null),
    [actionBusy, setActionBusy] = useState(false),
    [actionError, setActionError] = useState('');
  const entry = usePayrollDraftEditor('payroll-period', (message) => {
    setNotice(message);
    void result.reload();
  });
  const changeStatus = async () => {
    if (!action || actionBusy || !canManage) return;
    setActionBusy(true);
    setActionError('');
    try {
      await backendPut('/hr/payroll-periods/' + action.record.id, { status: action.status });
      setNotice(action.record.name + (action.status === 'APPROVED' ? ' approved.' : ' closed.'));
      setAction(null);
      void result.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update the period.');
    } finally {
      setActionBusy(false);
    }
  };
  const beginAction = (record: PayrollPeriod, next: StatusAction['status']) => {
    setActionError('');
    setAction({ record, status: next });
  };
  useEffect(() => {
    if (!result.loading && !result.error && page > 1 && !result.rows.length)
      setPage(Math.max(1, Math.ceil(result.total / 20)));
  }, [result.loading, result.error, result.rows.length, result.total, page, setPage]);
  if (!canRead)
    return <PermissionDeniedState description="Your role cannot view payroll periods." />;
  return (
    <div className="business-workspace record-workspace">
      <PageHeader
        title="Payroll periods"
        subtitle="A clear schedule for every pay cycle."
        breadcrumbs={[{ label: 'Payroll', href: '/payroll' }, { label: 'Payroll periods' }]}
        actions={
          canManage && (
            <Btn
              icon={<Plus size={16} />}
              onClick={() => entry.open({ kind: 'payroll-period', companyId: company })}
            >
              New period
            </Btn>
          )
        }
      />
      <div className="workspace-summary">
        <div>
          <span>Matching periods</span>
          <strong>{result.total}</strong>
        </div>
        <div>
          <span>Open on this page</span>
          <strong>
            {result.rows.filter((r) => ['OPEN', 'PROCESSING'].includes(r.status)).length}
          </strong>
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
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search periods by name or code…"
        collapsibleFilters
        activeFilterCount={Number(Boolean(company)) + Number(Boolean(status))}
        filters={
          <>
            <FormSelect
              label="Company filter"
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                setPage(1);
              }}
              options={scope.companyOptions}
              placeholder="All companies"
            />
            <FormSelect
              label="Status filter"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              options={statuses.map((value) => ({
                value,
                label: value.charAt(0) + value.slice(1).toLowerCase(),
              }))}
              placeholder="All statuses"
            />
          </>
        }
        actions={
          <Btn
            variant="secondary"
            icon={<RefreshCw size={15} />}
            disabled={result.loading}
            onClick={result.reload}
          >
            Reload
          </Btn>
        }
      />
      {entry.drafts}
      <RecordBrowser
        stateKey={stateKey + '.record'}
        selectionScope={JSON.stringify([company, status, query])}
        title="Payroll periods"
        records={result.rows}
        name={(r) => r.name}
        reference={(r) => r.payrollPeriodCode}
        status={(r) => r.status}
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        page={page}
        pageSize={20}
        total={result.total}
        onPage={setPage}
        fields={[
          { label: 'Period', value: (r) => date(r.startDate) + ' – ' + date(r.endDate) },
          { label: 'Payment date', value: (r) => date(r.paymentDate) },
        ]}
        details={[{ label: 'Company', value: companyName }]}
        actions={(r) => (
          <>
            <Btn
              variant="secondary"
              onClick={() =>
                router.push('/hr/payroll-runs?payrollPeriodId=' + encodeURIComponent(r.id))
              }
            >
              View runs
            </Btn>
            {canManage && ['OPEN', 'PROCESSING'].includes(r.status) && (
              <Btn variant="ghost" onClick={() => beginAction(r, 'APPROVED')}>
                Approve period
              </Btn>
            )}
            {canManage && ['APPROVED', 'PAID'].includes(r.status) && (
              <Btn variant="secondary" onClick={() => beginAction(r, 'CLOSED')}>
                Close period
              </Btn>
            )}
          </>
        )}
      />
      <ConfirmDialog
        open={!!action}
        title={
          (action?.status === 'APPROVED' ? 'Approve ' : 'Close ') +
          (action?.record.name || 'payroll period') +
          '?'
        }
        message={
          (actionError ? actionError + '\n\n' : '') +
          (action
            ? companyName(action.record) +
              ' · ' +
              date(action.record.startDate) +
              ' – ' +
              date(action.record.endDate) +
              '\n\n'
            : '') +
          (action?.status === 'APPROVED'
            ? 'Mark this payroll period as approved. This does not approve its individual runs or make a salary payment.'
            : 'Mark this payroll period as closed. This does not make a salary payment.')
        }
        confirmLabel={action?.status === 'APPROVED' ? 'Approve period' : 'Close period'}
        loading={actionBusy}
        onConfirm={changeStatus}
        onCancel={() => {
          if (!actionBusy) setAction(null);
        }}
      />
    </div>
  );
}
