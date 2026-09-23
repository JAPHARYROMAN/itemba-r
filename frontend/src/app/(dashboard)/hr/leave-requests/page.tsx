'use client';
import { useEffect, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { Btn, FormSelect, PageHeader, PageToolbar, PermissionDeniedState } from '@/components/ui';
import { RecordBrowser } from '@/components/workspace/record-browser';
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useAuth } from '@/hooks/use-auth';
import '@/components/workspace/workspace.css';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { usePayrollDraftEditor, usePayrollStateKey } from '@/features/payroll/payroll-drafts';
import {
  type LeaveRequest,
  type Action,
  employeeName,
  typeName,
  date,
  label,
} from '@/features/payroll/leave-request-workflow';

export default function LeaveRequestsPage() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('leave_requests.view'),
    canCreate = hasPermission('leave_requests.create'),
    canApprove = hasPermission('leave_requests.approve'),
    canApproveHr = hasPermission('leave_requests.approve.hr'),
    canReject = hasPermission('leave_requests.reject');
  const stateKey = usePayrollStateKey('leave-requests');
  const [page, setPage] = useWorkspaceState(stateKey + '.page', 1),
    [search, setSearch] = useWorkspaceState(stateKey + '.search', ''),
    [query, setQuery] = useState(search.trim()),
    [company, setCompany] = useWorkspaceState(stateKey + '.company', ''),
    [status, setStatus] = useWorkspaceState(stateKey + '.status', '');
  const result = useWorkspaceRecords<LeaveRequest>(
    '/hr/leave-requests',
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
  const entry = usePayrollDraftEditor(['leave-request', 'leave-action'], (message) => {
    setNotice(message);
    void result.reload();
  });
  const openAction = (record: LeaveRequest, action: Action) =>
    entry.open({ kind: 'leave-action', record, action });
  if (!canRead)
    return <PermissionDeniedState description="Your role cannot view leave requests." />;
  return (
    <div className="business-workspace record-workspace">
      <PageHeader
        title="Leave requests"
        subtitle="Plan time away. Keep every approval in view."
        breadcrumbs={[{ label: 'Payroll', href: '/payroll' }, { label: 'Leave requests' }]}
        actions={
          canCreate && (
            <Btn icon={<Plus size={16} />} onClick={() => entry.open({ kind: 'leave-request' })}>
              New request
            </Btn>
          )
        }
      />
      <div className="workspace-summary">
        <div>
          <span>Matching requests</span>
          <strong>{result.total}</strong>
        </div>
        <div>
          <span>Awaiting approval on this page</span>
          <strong>{result.rows.filter((r) => r.status === 'SUBMITTED').length}</strong>
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
        searchPlaceholder="Search requests by employee or reference…"
        collapsibleFilters
        activeFilterCount={[company, status].filter(Boolean).length}
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
              options={['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'].map((value) => ({
                value,
                label: label(value),
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
        stateKey={stateKey + '.selection'}
        selectionScope={JSON.stringify([company, status, query])}
        title="Leave requests"
        records={result.rows}
        name={employeeName}
        reference={(r) => r.leaveRequestNumber || typeName(r)}
        status={(r) => r.status}
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        page={page}
        total={result.total}
        pageSize={20}
        onPage={setPage}
        fields={[
          { label: 'From', value: (r) => date(r.startDate) },
          { label: 'Days', value: (r) => (r.totalDays == null ? '—' : Number(r.totalDays)) },
        ]}
        details={[
          { label: 'Leave type', value: typeName },
          { label: 'Company', value: (r) => r.company?.name || '—' },
          { label: 'To', value: (r) => date(r.endDate) },
          { label: 'Reason', value: (r) => r.reason || '—' },
          {
            label: 'Line approval',
            value: (r) => (r.lineApprovedById ? 'Recorded' : 'Not recorded'),
          },
          {
            label: 'Group HR approval',
            value: (r) =>
              Number(r.totalDays) > 5
                ? r.groupHrApprovedById
                  ? 'Recorded'
                  : 'Required for leave over 5 days'
                : 'Not required',
          },
          { label: 'Approval notes', value: (r) => r.approvalNotes || '—' },
          { label: 'Rejection / cancellation reason', value: (r) => r.rejectionReason || '—' },
        ]}
        actions={(r) => (
          <>
            {r.status === 'DRAFT' && canCreate && (
              <Btn onClick={() => openAction(r, 'submit')}>Submit request</Btn>
            )}
            {r.status === 'SUBMITTED' && canApprove && !r.lineApprovedById && (
              <Btn onClick={() => openAction(r, 'approve')}>Line approval</Btn>
            )}
            {r.status === 'SUBMITTED' &&
              Number(r.totalDays) > 5 &&
              canApproveHr &&
              !r.groupHrApprovedById && (
                <Btn onClick={() => openAction(r, 'approve-hr')}>Group HR approval</Btn>
              )}
            {r.status === 'SUBMITTED' && canReject && (
              <Btn variant="secondary" onClick={() => openAction(r, 'reject')}>
                Reject request
              </Btn>
            )}
            {['DRAFT', 'SUBMITTED', 'APPROVED'].includes(r.status) && canCreate && (
              <Btn variant="ghost" onClick={() => openAction(r, 'cancel')}>
                Cancel request
              </Btn>
            )}
          </>
        )}
      />
    </div>
  );
}
