'use client';
import { useEffect, useState } from 'react';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { usePayrollDraftEditor, usePayrollStateKey } from '@/features/payroll/payroll-drafts';

import { Plus, RefreshCw } from 'lucide-react';
import { Btn, FormSelect, PageHeader, PageToolbar, PermissionDeniedState } from '@/components/ui';
import { RecordBrowser } from '@/components/workspace/record-browser';
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import { useAuth } from '@/hooks/use-auth';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useLeaveTypes } from '@/hooks/use-leave-types';
import type { LeaveBalanceRecord } from '@/features/payroll/leave-balance-editor';
import '@/components/workspace/workspace.css';
const num = (v: number | string | null | undefined) => Number(v || 0);
const days = (v: number) => v.toLocaleString('en-GB', { maximumFractionDigits: 2 });
const remaining = (r: LeaveBalanceRecord) =>
  num(r.allocatedDays) + num(r.carriedForwardDays) - num(r.usedDays);
const employeeName = (r: LeaveBalanceRecord) =>
  r.employee?.fullName || r.employee?.employeeCode || 'Employee';
export default function LeaveBalancesPage() {
  const { hasPermission } = useAuth(),
    canManage = hasPermission('leave_balances.manage'),
    canRead = hasPermission('leave_balances.view');
  const stateKey = usePayrollStateKey('leave-balances');
  const [page, setPage] = useWorkspaceState(stateKey + '.page', 1),
    [search, setSearch] = useWorkspaceState(stateKey + '.search', ''),
    [query, setQuery] = useState(search.trim()),
    [company, setCompany] = useWorkspaceState(stateKey + '.company', ''),
    [employee, setEmployee] = useWorkspaceState(stateKey + '.employee', ''),
    [type, setType] = useWorkspaceState(stateKey + '.type', ''),
    [year, setYear] = useWorkspaceState(stateKey + '.year', '');
  const result = useWorkspaceRecords<LeaveBalanceRecord>(
    '/hr/leave-balances',
    {
      page,
      limit: 20,
      search: query,
      companyId: company,
      employeeId: employee,
      leaveTypeId: type,
      year,
    },
    canRead,
  );
  const scope = useOrgScope(company, { skipBranches: true, skipDivisions: true }),
    types = useLeaveTypes(company);
  const [notice, setNotice] = useState('');
  const entry = usePayrollDraftEditor('leave-balance', (message) => {
    setNotice(message);
    void result.reload();
  });
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, query, setPage]);
  const years = Array.from({ length: 7 }, (_, i) => new Date().getFullYear() + 1 - i);
  useEffect(() => {
    if (!result.loading && !result.error && page > 1 && !result.rows.length)
      setPage(Math.max(1, Math.ceil(result.total / 20)));
  }, [result.loading, result.error, result.rows.length, result.total, page, setPage]);
  if (!canRead)
    return <PermissionDeniedState description="Your role cannot view leave balances." />;
  return (
    <div className="business-workspace record-workspace">
      <PageHeader
        title="Leave balances"
        subtitle="Allocated, used and remaining time, together."
        breadcrumbs={[{ label: 'Payroll', href: '/payroll' }, { label: 'Leave balances' }]}
        actions={
          canManage && (
            <Btn
              icon={<Plus size={16} />}
              disabled={scope.loading || Boolean(scope.error)}
              onClick={() => entry.open({ kind: 'leave-balance' })}
            >
              Allocate leave
            </Btn>
          )
        }
      />
      <div className="workspace-summary">
        <div>
          <span>Matching balances</span>
          <strong>{result.total}</strong>
        </div>
        <div>
          <span>Allocated on this page</span>
          <strong>
            {days(
              result.rows.reduce((s, r) => s + num(r.allocatedDays) + num(r.carriedForwardDays), 0),
            )}
          </strong>
        </div>
        <div>
          <span>Used on this page</span>
          <strong>{days(result.rows.reduce((s, r) => s + num(r.usedDays), 0))}</strong>
        </div>
        <div>
          <span>Remaining on this page</span>
          <strong>{days(result.rows.reduce((s, r) => s + remaining(r), 0))}</strong>
        </div>
      </div>
      {notice && (
        <div role="status" className="workspace-notice">
          {notice}
        </div>
      )}
      {(scope.error || types.error) && (
        <div role="alert" className="workspace-notice">
          {scope.error || types.error}{' '}
          <Btn
            variant="ghost"
            onClick={() => {
              scope.retry();
              types.retry();
            }}
          >
            Retry choices
          </Btn>
        </div>
      )}
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search balances by employee or leave type…"
        collapsibleFilters
        activeFilterCount={[company, employee, type, year].filter(Boolean).length}
        filters={
          <>
            <FormSelect
              label="Company filter"
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                setEmployee('');
                setType('');
                setPage(1);
              }}
              options={scope.companyOptions}
              placeholder="All companies"
            />
            <FormSelect
              label="Employee filter"
              disabled={!company || scope.loading || Boolean(scope.error)}
              value={employee}
              onChange={(e) => {
                setEmployee(e.target.value);
                setPage(1);
              }}
              options={scope.employeeOptions}
              placeholder={company ? 'All employees' : 'Select company first'}
            />
            <FormSelect
              label="Leave type filter"
              disabled={!company || types.loading || Boolean(types.error)}
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
              options={types.rows.map((t) => ({ value: t.id, label: t.name }))}
              placeholder={company ? 'All leave types' : 'Select company first'}
            />
            <FormSelect
              label="Year filter"
              value={year}
              onChange={(e) => {
                setYear(e.target.value);
                setPage(1);
              }}
              options={years.map((y) => ({ value: String(y), label: String(y) }))}
              placeholder="All years"
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
        selectionScope={JSON.stringify([company, employee, type, year, query])}
        title="Leave balances"
        records={result.rows}
        name={employeeName}
        reference={(r) => (r.leaveType?.name || 'Leave') + ' · ' + r.year}
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        page={page}
        total={result.total}
        pageSize={20}
        onPage={setPage}
        fields={[
          { label: 'Used', value: (r) => days(num(r.usedDays)) + ' days' },
          { label: 'Remaining', value: (r) => days(remaining(r)) + ' days' },
        ]}
        details={[
          { label: 'Company', value: (r) => r.company?.name || '—' },
          { label: 'Allocated', value: (r) => days(num(r.allocatedDays)) + ' days' },
          { label: 'Carried forward', value: (r) => days(num(r.carriedForwardDays)) + ' days' },
          { label: 'Notes', value: (r) => r.notes || '—' },
        ]}
        actions={(r) =>
          canManage && (
            <Btn onClick={() => entry.open({ kind: 'leave-balance', record: r })}>
              Adjust allocation
            </Btn>
          )
        }
      />
    </div>
  );
}
