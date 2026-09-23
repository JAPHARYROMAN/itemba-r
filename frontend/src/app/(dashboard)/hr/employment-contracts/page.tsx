'use client';

import { useEffect, useState } from 'react';
import { Btn, FormSelect, PageHeader, PageToolbar, PermissionDeniedState } from '@/components/ui';
import { RecordBrowser } from '@/components/workspace/record-browser';
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useAuth } from '@/hooks/use-auth';
import { Plus, RefreshCw } from 'lucide-react';
import '@/components/workspace/workspace.css';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { usePayrollDraftEditor, usePayrollStateKey } from '@/features/payroll/payroll-drafts';
import {
  type Contract,
  employeeName,
  companyName,
  date,
  label,
  options,
  statuses,
} from '@/features/payroll/contract-workflow';

export default function EmploymentContractsPage() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('employment_contracts.view');
  const canCreate = hasPermission('employment_contracts.create');
  const canApprove = hasPermission('employment_contracts.approve');
  const canTerminate = hasPermission('employment_contracts.terminate');
  const stateKey = usePayrollStateKey('employment-contracts');
  const [page, setPage] = useWorkspaceState(stateKey + '.page', 1);
  const [search, setSearch] = useWorkspaceState(stateKey + '.search', '');
  const [query, setQuery] = useState(search.trim());
  const [company, setCompany] = useWorkspaceState(stateKey + '.company', '');
  const [status, setStatus] = useWorkspaceState(stateKey + '.status', '');
  const result = useWorkspaceRecords<Contract>(
    '/hr/employment-contracts',
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
  useEffect(() => {
    if (!result.loading && !result.error && page > 1 && !result.rows.length)
      setPage(Math.max(1, Math.ceil(result.total / 20)));
  }, [result.loading, result.error, result.rows.length, result.total, page, setPage]);
  const [notice, setNotice] = useState('');
  const scope = useOrgScope(undefined, {
    skipBranches: true,
    skipDivisions: true,
    skipEmployees: true,
  });
  const entry = usePayrollDraftEditor(['contract', 'contract-action'], (message) => {
    setNotice(message);
    void result.reload();
  });
  const openAction = (record: Contract, action: 'approve' | 'terminate') =>
    entry.open({ kind: 'contract-action', record, action });
  if (!canRead)
    return <PermissionDeniedState description="Your role cannot view employment contracts." />;
  return (
    <div className="business-workspace record-workspace">
      <PageHeader
        title="Employment contracts"
        subtitle="Agreements, dates and terms for your people."
        breadcrumbs={[{ label: 'Payroll', href: '/payroll' }, { label: 'Contracts' }]}
        actions={
          canCreate && (
            <Btn icon={<Plus size={16} />} onClick={() => entry.open({ kind: 'contract' })}>
              New contract
            </Btn>
          )
        }
      />
      <div className="workspace-summary">
        <div>
          <span>Matching contracts</span>
          <strong>{result.total}</strong>
        </div>
        <div>
          <span>Active on this page</span>
          <strong>{result.rows.filter((r) => r.status === 'ACTIVE').length}</strong>
        </div>
      </div>
      {notice && (
        <div role="status" className="workspace-notice">
          {notice}
        </div>
      )}
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search contracts by code or employee…"
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
              options={options(statuses)}
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
        stateKey={stateKey + '.selection'}
        selectionScope={JSON.stringify([company, status, query])}
        title="Contracts"
        records={result.rows}
        name={(r) => r.contractCode}
        reference={employeeName}
        status={(r) => r.status}
        fields={[
          { label: 'Employee', value: employeeName },
          { label: 'Company', value: companyName },
        ]}
        details={[
          { label: 'Contract type', value: (r) => label(r.contractType) },
          { label: 'Start date', value: (r) => date(r.startDate) },
          { label: 'End date', value: (r) => date(r.endDate) },
          { label: 'Probation ends', value: (r) => date(r.probationEndDate) },
          {
            label: 'Salary',
            value: (r) =>
              r.salaryAmount == null
                ? '—'
                : `${r.currency || 'TZS'} ${Number(r.salaryAmount).toLocaleString('en-TZ')}`,
          },
          {
            label: 'Payment frequency',
            value: (r) => (r.paymentFrequency ? label(r.paymentFrequency) : '—'),
          },
          { label: 'Terms', value: (r) => r.terms || '—' },
        ]}
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        page={page}
        total={result.total}
        onPage={setPage}
        actions={(r) => (
          <>
            {canApprove && r.status === 'DRAFT' && (
              <Btn onClick={() => openAction(r, 'approve')}>Approve contract</Btn>
            )}
            {canTerminate && ['ACTIVE', 'APPROVED'].includes(r.status) && (
              <Btn variant="ghost" onClick={() => openAction(r, 'terminate')}>
                Terminate contract
              </Btn>
            )}
          </>
        )}
      />
    </div>
  );
}
