'use client';

import { useEffect, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { Btn, ConfirmDialog, FormDateField, FormSelect, PageHeader, PageToolbar, PermissionDeniedState } from '@/components/ui';
import { RecordBrowser } from '@/components/workspace/record-browser';
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useAuth } from '@/hooks/use-auth';
import { backendPatch } from '@/lib/api-client';
import '@/components/workspace/workspace.css';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { usePayrollDraftEditor, usePayrollStateKey } from '@/features/payroll/payroll-drafts';
import {
  type Attendance,
  employeeName,
  companyName,
  date,
  timestamp,
  label,
  statuses,
} from '@/features/payroll/attendance-workflow';

export default function AttendancePage() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('attendance.view');
  const canCreate = hasPermission('attendance.create');
  const canEdit = hasPermission('attendance.update');
  const canApprove = hasPermission('attendance.approve');
  const stateKey = usePayrollStateKey('attendance');
  const [page, setPage] = useWorkspaceState(stateKey + '.page', 1);
  const [search, setSearch] = useWorkspaceState(stateKey + '.search', '');
  const [query, setQuery] = useState(search.trim());
  const [company, setCompany] = useWorkspaceState(stateKey + '.company', '');
  const [status, setStatus] = useWorkspaceState(stateKey + '.status', '');
  const [dateFrom, setDateFrom] = useWorkspaceState(stateKey + '.dateFrom', '');
  const [dateTo, setDateTo] = useWorkspaceState(stateKey + '.dateTo', '');
  const invalidRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const result = useWorkspaceRecords<Attendance>(
    '/hr/attendance',
    {
      page,
      limit: 20,
      search: query,
      companyId: company,
      attendanceStatus: status,
      dateFrom,
      dateTo,
    },
    canRead && !invalidRange,
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
  const [approval, setApproval] = useState<Attendance | null>(null);
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  const entry = usePayrollDraftEditor('attendance', (message) => {
    setNotice(message);
    void result.reload();
  });
  const open = (record?: Attendance) => entry.open({ kind: 'attendance', record });
  const approve = async () => {
    if (!approval || approving || !canApprove) return;
    setApproving(true);
    setApprovalError('');
    try {
      await backendPatch('/hr/attendance/' + approval.id + '/approve', {});
      setApproval(null);
      setNotice('Attendance approved.');
      void result.reload();
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : 'Unable to approve attendance.');
    } finally {
      setApproving(false);
    }
  };
  if (!canRead) return <PermissionDeniedState description="Your role cannot view attendance." />;
  return (
    <div className="business-workspace record-workspace">
      <PageHeader
        title="Attendance"
        subtitle="Time at work, with the details in view."
        breadcrumbs={[{ label: 'Payroll', href: '/payroll' }, { label: 'Attendance' }]}
        actions={
          canCreate && (
            <Btn icon={<Plus size={16} />} onClick={() => open()}>
              Log attendance
            </Btn>
          )
        }
      />
      <div className="workspace-summary">
        <div>
          <span>Matching records</span>
          <strong>{result.total}</strong>
        </div>
        <div>
          <span>Awaiting approval on this page</span>
          <strong>{result.rows.filter((r) => !r.approvedById).length}</strong>
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
        searchPlaceholder="Search attendance by employee or reference…"
        collapsibleFilters
        activeFilterCount={[company, status, dateFrom, dateTo].filter(Boolean).length}
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
              options={statuses.map((value) => ({ value, label: label(value) }))}
              placeholder="All statuses"
            />
            <FormDateField
              label="From date"
              value={dateFrom}
              onChange={(value) => {
                setDateFrom(value);
                setPage(1);
              }}
            />
            <FormDateField
              label="To date"
              min={dateFrom}
              value={dateTo}
              onChange={(value) => {
                setDateTo(value);
                setPage(1);
              }}
            />
          </>
        }
        actions={
          <Btn
            variant="secondary"
            icon={<RefreshCw size={15} />}
            disabled={result.loading || invalidRange}
            onClick={result.reload}
          >
            Reload
          </Btn>
        }
      />
      {entry.drafts}
      <RecordBrowser
        stateKey={stateKey + '.selection'}
        selectionScope={JSON.stringify([company, status, dateFrom, dateTo, query])}
        title="Attendance"
        records={result.rows}
        name={employeeName}
        reference={(r) => r.attendanceNumber || companyName(r)}
        status={(r) => r.attendanceStatus || 'UNKNOWN'}
        loading={result.loading}
        error={
          invalidRange ? 'The end of the date range must be on or after its start.' : result.error
        }
        onRetry={invalidRange ? undefined : result.reload}
        page={page}
        total={result.total}
        pageSize={20}
        onPage={setPage}
        fields={[
          { label: 'Date', value: (r) => date(r.attendanceDate) },
          {
            label: 'Hours',
            value: (r) => (r.totalHours != null ? Number(r.totalHours) + ' h' : '—'),
          },
        ]}
        details={[
          { label: 'Company', value: companyName },
          { label: 'Clock-in (local time)', value: (r) => timestamp(r.clockInTime) },
          { label: 'Clock-out (local time)', value: (r) => timestamp(r.clockOutTime) },
          { label: 'Overtime', value: (r) => Number(r.overtimeHours || 0) + ' h' },
          {
            label: 'Late / early leave',
            value: (r) => (r.lateMinutes || 0) + ' / ' + (r.earlyLeaveMinutes || 0) + ' min',
          },
          {
            label: 'Approval',
            value: (r) =>
              r.approvedById
                ? 'Approved' + (r.approvedAt ? ' · ' + timestamp(r.approvedAt) : '')
                : 'Awaiting approval',
          },
          { label: 'Source', value: (r) => (r.source ? label(r.source) : '—') },
          { label: 'Notes', value: (r) => r.notes || '—' },
        ]}
        actions={(r) => (
          <>
            {canEdit && (
              <Btn variant="secondary" onClick={() => open(r)}>
                Edit attendance
              </Btn>
            )}
            {canApprove && !r.approvedById && (
              <Btn
                onClick={() => {
                  setApproval(r);
                  setApprovalError('');
                }}
              >
                Approve attendance
              </Btn>
            )}
          </>
        )}
      />
      <ConfirmDialog
        open={!!approval}
        title={'Approve attendance' + (approval ? ' for ' + employeeName(approval) : '') + '?'}
        message={
          (approvalError ? approvalError + '\n\n' : '') +
          'Confirm the attendance for ' +
          (approval ? date(approval.attendanceDate) : 'this day') +
          '. Review the recorded times and status before approving.'
        }
        confirmLabel="Approve attendance"
        loading={approving}
        onConfirm={approve}
        onCancel={() => {
          if (!approving) setApproval(null);
        }}
      />
    </div>
  );
}
