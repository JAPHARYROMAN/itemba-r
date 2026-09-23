'use client';
import { useEffect, useState } from 'react';
import { Btn, FormSelect, PageHeader, PageToolbar, PermissionDeniedState } from '@/components/ui';
import { RecordBrowser } from '@/components/workspace/record-browser';
import { payrollLabel } from '@/components/workspace/payroll-types';
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useAuth } from '@/hooks/use-auth';
import '@/components/workspace/workspace.css';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { usePayrollStateKey, usePayrollDraftEditor } from '@/features/payroll/payroll-drafts';
import {
  type Company,
  type SalaryAdvance,
  statuses,
  dateLabel,
  name,
  money,
} from '@/features/payroll/salary-advance-types';

export default function SalaryAdvancesPage() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('salary_advances.view');
  const stateKey = usePayrollStateKey('salary-advances');
  const [search, setSearch] = useWorkspaceState(stateKey + '.search', ''),
    [query, setQuery] = useState(search.trim()),
    [company, setCompany] = useWorkspaceState(stateKey + '.company', ''),
    [status, setStatus] = useWorkspaceState(stateKey + '.status', ''),
    [page, setPage] = useWorkspaceState(stateKey + '.page', 1);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, query, setPage]);
  const result = useWorkspaceRecords<SalaryAdvance>(
    '/hr/salary-advances',
    { page, limit: 20, search: query, companyId: company, status },
    canRead,
  );
  useEffect(() => {
    if (!result.loading && !result.error && page > 1 && !result.rows.length)
      setPage(Math.max(1, Math.ceil(result.total / 20)));
  }, [result.loading, result.error, result.rows.length, result.total, page, setPage]);
  const companies = useWorkspaceChoices<Company>('/companies', {}, canRead);
  const saved = (message: string) => {
    setNotice(message);
    void result.reload();
  };
  const entry = usePayrollDraftEditor(['salary-advance', 'advance-action'], saved);
  if (!canRead)
    return <PermissionDeniedState description="Your role cannot view salary advances." />;
  return (
    <div className="business-workspace record-workspace">
      <PageHeader
        title="Salary advances"
        subtitle="Review requests, approvals and payroll recovery."
        breadcrumbs={[{ label: 'Payroll', href: '/payroll' }, { label: 'Salary advances' }]}
        actions={
          hasPermission('salary_advances.create') && (
            <Btn variant="primary" onClick={() => entry.open({ kind: 'salary-advance' })}>
              Request advance
            </Btn>
          )
        }
      />
      <div className="workspace-summary">
        <div>
          <span>Matching advances</span>
          <strong>{result.total}</strong>
        </div>
      </div>
      {notice && (
        <p role="status" className="workspace-notice">
          {notice}
        </p>
      )}
      {companies.error && (
        <div role="alert" className="workspace-notice">
          {companies.error}{' '}
          <Btn variant="ghost" onClick={companies.retry}>
            Retry companies
          </Btn>
        </div>
      )}
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search advance or employee…"
        collapsibleFilters
        activeFilterCount={Number(!!company) + Number(!!status)}
        filters={
          <>
            <FormSelect
              label="Company filter"
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                setPage(1);
              }}
              options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="All companies"
            />
            <FormSelect
              label="Status filter"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              options={statuses.map((s) => ({ value: s, label: payrollLabel(s) }))}
              placeholder="All statuses"
            />
          </>
        }
        actions={
          <Btn variant="secondary" onClick={result.reload} disabled={result.loading}>
            Reload
          </Btn>
        }
      />
      {entry.drafts}
      <RecordBrowser
        stateKey={stateKey + '.selection'}
        selectionScope={JSON.stringify([company, status, query])}
        title="Salary advances"
        records={result.rows}
        name={name}
        reference={(r) => r.advanceNumber}
        status={(r) => r.status}
        fields={[
          { label: 'Amount', value: (r) => money(r.amount, r.currency) },
          { label: 'Requested', value: (r) => dateLabel(r.requestDate) },
        ]}
        details={[
          { label: 'Company', value: (r) => r.company?.name || '—' },
          { label: 'Employee code', value: (r) => r.employee?.employeeCode || '—' },
          { label: 'Reason', value: (r) => r.reason || '—' },
          {
            label: 'Repayment method',
            value: (r) => (r.repaymentMethod ? payrollLabel(r.repaymentMethod) : '—'),
          },
          {
            label: 'Installment amount',
            value: (r) =>
              r.repaymentMethod === 'INSTALLMENTS' ? money(r.installmentAmount, r.currency) : '—',
          },
          { label: 'Recovered', value: (r) => money(r.recoveredAmount, r.currency) },
          {
            label: 'Remaining recovery',
            value: (r) =>
              ['PAID', 'DEDUCTING', 'SETTLED'].includes(r.status) && r.recoveredAmount != null
                ? money(Math.max(0, Number(r.amount) - Number(r.recoveredAmount)), r.currency)
                : '—',
          },
          { label: 'Approved', value: (r) => dateLabel(r.approvedAt) },
          { label: 'Payment recorded', value: (r) => dateLabel(r.paidAt) },
          { label: 'Notes', value: (r) => r.notes || '—' },
        ]}
        actions={(r) => (
          <>
            {r.status === 'REQUESTED' && hasPermission('salary_advances.approve') && (
              <Btn
                variant="primary"
                onClick={() => entry.open({ kind: 'advance-action', record: r, action: 'approve' })}
              >
                Review approval
              </Btn>
            )}
            {r.status === 'APPROVED' && hasPermission('salary_advances.pay') && (
              <Btn
                variant="primary"
                onClick={() => entry.open({ kind: 'advance-action', record: r, action: 'pay' })}
              >
                Record payment
              </Btn>
            )}
          </>
        )}
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        page={page}
        total={result.total}
        pageSize={20}
        onPage={setPage}
      />
    </div>
  );
}
