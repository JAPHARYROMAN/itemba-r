'use client';

import { useEffect, useState } from 'react';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { usePayrollDraftEditor, usePayrollStateKey } from '@/features/payroll/payroll-drafts';

import {
  Btn,
  ConfirmDialog,
  FormSelect,
  PageHeader,
  PageToolbar,
  PermissionDeniedState,
} from '@/components/ui';
import { RecordBrowser } from '@/components/workspace/record-browser';
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useAuth } from '@/hooks/use-auth';
import { backendDelete, backendPatch } from '@/lib/api-client';
import { Plus, RefreshCw } from 'lucide-react';
import '@/components/workspace/workspace.css';

import {
  type Assignment,
  employeeName,
  companyName,
  label,
  date,
} from '@/features/payroll/assignment-workflow';
export default function EmployeeAssignmentsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('employees.assignments.manage');
  const canApprove = hasPermission('employees.transfer.approve.hr');
  const stateKey = usePayrollStateKey('assignments');
  const [page, setPage] = useWorkspaceState(stateKey + '.page', 1);
  const [search, setSearch] = useWorkspaceState(stateKey + '.search', '');
  const [query, setQuery] = useState(search.trim());
  const [company, setCompany] = useWorkspaceState(stateKey + '.company', '');
  const result = useWorkspaceRecords<Assignment>(
    '/hr/employee-assignments',
    { page, limit: 20, search: query, companyId: company },
    canManage,
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
    skipEmployees: true,
    skipDivisions: true,
    skipBranches: true,
  });
  const entry = usePayrollDraftEditor('assignment', (message) => {
    setNotice(message);
    void result.reload();
  });
  const [action, setAction] = useState<{ record: Assignment; kind: 'delete' | 'approve' } | null>(
    null,
  );
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const openAction = (record: Assignment, kind: 'delete' | 'approve') => {
    setAction({ record, kind });
    setActionError('');
  };
  const performAction = async () => {
    if (!action || actionBusy || !canManage || (action.kind === 'approve' && !canApprove)) return;
    setActionBusy(true);
    setActionError('');
    try {
      if (action.kind === 'delete')
        await backendDelete(`/hr/employee-assignments/${action.record.id}`);
      else await backendPatch(`/hr/employee-assignments/${action.record.id}/approve-transfer`);
      setNotice(
        action.kind === 'delete'
          ? 'Assignment deleted.'
          : 'Transfer approved. The assignment is active and the employee placement has been updated.',
      );
      setAction(null);
      await result.reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to update the assignment.');
    } finally {
      setActionBusy(false);
    }
  };
  if (!canManage)
    return <PermissionDeniedState description="Your role cannot manage employee assignments." />;
  return (
    <div className="business-workspace record-workspace">
      <PageHeader
        title="Employee assignments"
        subtitle="Where your people work, and the moves that come next."
        breadcrumbs={[{ label: 'Payroll', href: '/payroll' }, { label: 'Assignments' }]}
        actions={
          <Btn icon={<Plus size={16} />} onClick={() => entry.open({ kind: 'assignment' })}>
            New assignment
          </Btn>
        }
      />
      <div className="workspace-summary">
        <div>
          <span>Matching assignments</span>
          <strong>{result.total}</strong>
        </div>
        <div>
          <span>Pending on this page</span>
          <strong>
            {result.rows.filter((r) => r.approvalStatus?.startsWith('PENDING')).length}
          </strong>
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
        searchPlaceholder="Search assignments by employee or role…"
        collapsibleFilters
        activeFilterCount={Number(Boolean(company))}
        filters={
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
        selectionScope={JSON.stringify([company, query])}
        records={result.rows}
        title="Assignments"
        name={employeeName}
        reference={(r) => (r.assignmentContextType ? label(r.assignmentContextType) : 'Assignment')}
        status={(r) => (r.approvalStatus?.startsWith('PENDING') ? 'TRANSFER_PENDING' : r.status)}
        fields={[
          { label: 'Company', value: companyName },
          { label: 'Starts', value: (r) => date(r.startDate) },
        ]}
        details={[
          { label: 'Ends', value: (r) => date(r.endDate) },
          { label: 'Department', value: (r) => r.department?.name || '—' },
          { label: 'Position', value: (r) => r.position?.title || '—' },
          { label: 'Assignment', value: (r) => (r.isPrimary ? 'Primary' : 'Additional') },
          { label: 'Approval', value: (r) => (r.approvalStatus ? label(r.approvalStatus) : '—') },
          { label: 'Notes', value: (r) => r.notes || '—' },
        ]}
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        page={page}
        total={result.total}
        onPage={setPage}
        actions={(r) => (
          <>
            {canApprove && r.approvalStatus?.startsWith('PENDING') && (
              <Btn onClick={() => openAction(r, 'approve')}>Approve transfer</Btn>
            )}
            <Btn
              variant={r.approvalStatus?.startsWith('PENDING') ? 'secondary' : 'primary'}
              onClick={() => entry.open({ kind: 'assignment', record: r })}
            >
              Edit assignment
            </Btn>
            <Btn variant="ghost" onClick={() => openAction(r, 'delete')}>
              Delete assignment
            </Btn>
          </>
        )}
      />
      <ConfirmDialog
        open={!!action}
        title={`${action?.kind === 'approve' ? 'Approve transfer' : 'Delete assignment'}${action ? ` for ${employeeName(action.record)}?` : ''}`}
        message={`${actionError ? actionError + '\n\n' : ''}${action?.kind === 'approve' ? `Move this employee to ${action ? companyName(action.record) : 'the destination'} and make this their active primary assignment? The requester cannot approve their own transfer.` : 'Delete this assignment record? Review the employee and destination before continuing.'}`}
        confirmLabel={action?.kind === 'approve' ? 'Approve transfer' : 'Delete assignment'}
        variant={action?.kind === 'delete' ? 'danger' : 'default'}
        loading={actionBusy}
        onConfirm={performAction}
        onCancel={() => {
          if (!actionBusy) setAction(null);
        }}
      />
    </div>
  );
}
