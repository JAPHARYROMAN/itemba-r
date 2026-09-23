'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Btn, FormSelect, PageHeader, PageToolbar, PermissionDeniedState } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { RecordBrowser } from './record-browser';
import { DisputeEditor } from './dispute-editor';
import {
  disputeDate,
  disputeEmployeeName,
  disputeLabel,
  disputePath,
  disputeStatuses,
  type DisputeRecord,
} from './dispute-types';
import './workspace.css';
export function DisputeWorkspace() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('employees.view'),
    canCreate = hasPermission('employees.update');
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [company, setCompany] = useState(''),
    [status, setStatus] = useState(''),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false),
    [notice, setNotice] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const result = useWorkspaceRecords<DisputeRecord>(
      disputePath,
      { page, limit: 20, companyId: company, status, search: query },
      canRead,
    ),
    companies = useWorkspaceChoices<{ id: string; name: string }>('/companies', {}, canRead);
  if (!canRead)
    return <PermissionDeniedState description="Your role cannot view employment disputes." />;
  return (
    <div className="business-workspace record-workspace">
      <PageHeader
        title="Employment disputes"
        subtitle="Review issues, recorded outcomes and the next step for each case."
        breadcrumbs={[{ label: 'People', href: '/hr' }, { label: 'Disputes' }]}
        actions={
          canCreate && (
            <Btn variant="primary" onClick={() => setCreating(true)}>
              New dispute
            </Btn>
          )
        }
      />
      <div className="workspace-summary">
        <div>
          <span>Matching disputes</span>
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
          {companies.error}
          <Btn variant="ghost" onClick={companies.retry}>
            Retry companies
          </Btn>
        </div>
      )}
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search dispute, employee or summary…"
        collapsibleFilters
        activeFilterCount={Number(!!company) + Number(!!status)}
        filters={
          <>
            <FormSelect
              label="Company filter"
              value={company}
              options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="All companies"
              onChange={(e) => {
                setCompany(e.target.value);
                setPage(1);
              }}
            />
            <FormSelect
              label="Status filter"
              value={status}
              options={disputeStatuses}
              placeholder="All statuses"
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            />
          </>
        }
        actions={
          <Btn variant="secondary" disabled={result.loading} onClick={result.reload}>
            Reload
          </Btn>
        }
      />
      <RecordBrowser
        title="Employment disputes"
        records={result.rows}
        name={(r) => disputeEmployeeName(r.employee)}
        reference={(r) => r.disputeNumber}
        status={(r) => r.status}
        fields={[
          { label: 'Type', value: (r) => disputeLabel(r.type) },
          { label: 'Raised', value: (r) => disputeDate(r.raisedAt) },
        ]}
        details={[
          { label: 'Company', value: (r) => r.company?.name || '—' },
          { label: 'Employee code', value: (r) => r.employee?.employeeCode || '—' },
          { label: 'Summary', value: (r) => r.summary },
          { label: 'Initial position', value: (r) => r.initialPosition || 'Not recorded' },
          { label: 'CMA reference', value: (r) => r.cmaReferenceNumber || 'Not recorded' },
          { label: 'Resolved', value: (r) => disputeDate(r.resolvedAt) },
        ]}
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        page={page}
        pageSize={20}
        total={result.total}
        onPage={setPage}
        actions={(r) => (
          <Link className="workspace-primary-link" href={'/hr/disputes/' + r.id}>
            Open dispute
          </Link>
        )}
      />
      {creating && (
        <DisputeEditor
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            setNotice('Dispute saved.');
            void result.reload();
          }}
        />
      )}
    </div>
  );
}
