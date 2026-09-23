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
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useAuth } from '@/hooks/use-auth';
import { backendPut } from '@/lib/api-client';
import '@/components/workspace/workspace.css';

import type { LeaveType } from '@/features/payroll/leave-type-workflow';
export default function LeaveTypesPage() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('leave_types.view'),
    canManage = hasPermission('leave_types.manage');
  const stateKey = usePayrollStateKey('leave-types');
  const [page, setPage] = useWorkspaceState(stateKey + '.page', 1),
    [search, setSearch] = useWorkspaceState(stateKey + '.search', ''),
    [query, setQuery] = useState(search.trim()),
    [company, setCompany] = useWorkspaceState(stateKey + '.company', '');
  const result = useWorkspaceRecords<LeaveType>(
    '/hr/leave-types',
    { page, limit: 20, search: query, companyId: company },
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
  const [notice, setNotice] = useState('');
  const [toggle, setToggle] = useState<LeaveType | null>(null),
    [toggleBusy, setToggleBusy] = useState(false),
    [toggleError, setToggleError] = useState('');
  const scope = useOrgScope(undefined, {
    skipEmployees: true,
    skipDivisions: true,
    skipBranches: true,
  });
  const entry = usePayrollDraftEditor('leave-type', (message) => {
    setNotice(message);
    void result.reload();
  });
  const changeActive = async () => {
    if (!toggle || toggleBusy || !canManage) return;
    setToggleBusy(true);
    setToggleError('');
    try {
      await backendPut('/hr/leave-types/' + toggle.id, { isActive: !toggle.isActive });
      setToggle(null);
      setNotice('Leave type updated.');
      void result.reload();
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : 'Unable to update leave type.');
    } finally {
      setToggleBusy(false);
    }
  };
  useEffect(() => {
    if (!result.loading && !result.error && page > 1 && !result.rows.length)
      setPage(Math.max(1, Math.ceil(result.total / 20)));
  }, [result.loading, result.error, result.rows.length, result.total, page, setPage]);
  if (!canRead) return <PermissionDeniedState description="Your role cannot view leave types." />;
  return (
    <div className="business-workspace record-workspace">
      <PageHeader
        title="Leave types"
        subtitle="Clear policies for time away."
        breadcrumbs={[{ label: 'Payroll', href: '/payroll' }, { label: 'Leave types' }]}
        actions={
          canManage && (
            <Btn icon={<Plus size={16} />} onClick={() => entry.open({ kind: 'leave-type' })}>
              New leave type
            </Btn>
          )
        }
      />
      <div className="workspace-summary">
        <div>
          <span>Matching types</span>
          <strong>{result.total}</strong>
        </div>
        <div>
          <span>Active on this page</span>
          <strong>{result.rows.filter((r) => r.isActive).length}</strong>
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
        searchPlaceholder="Search leave types by name…"
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
        title="Leave types"
        records={result.rows}
        name={(r) => r.name}
        reference={(r) => r.code}
        status={(r) => (r.isActive ? 'ACTIVE' : 'INACTIVE')}
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        page={page}
        total={result.total}
        pageSize={20}
        onPage={setPage}
        fields={[
          { label: 'Paid', value: (r) => (r.paid ? 'Paid leave' : 'Unpaid leave') },
          {
            label: 'Annual days',
            value: (r) =>
              r.annualAllowanceDays == null ? 'Not set' : Number(r.annualAllowanceDays),
          },
        ]}
        details={[
          { label: 'Company', value: (r) => r.company?.name || '—' },
          {
            label: 'Carry forward',
            value: (r) => (r.carryForwardAllowed ? 'Allowed' : 'Not allowed'),
          },
        ]}
        actions={(r) =>
          canManage && (
            <>
              <Btn onClick={() => entry.open({ kind: 'leave-type', record: r })}>
                Edit leave type
              </Btn>
              <Btn
                variant="secondary"
                onClick={() => {
                  setToggle(r);
                  setToggleError('');
                }}
              >
                {r.isActive ? 'Deactivate' : 'Activate'}
              </Btn>
            </>
          )
        }
      />
      <ConfirmDialog
        open={!!toggle}
        title={
          (toggle?.isActive ? 'Deactivate ' : 'Activate ') + (toggle?.name || 'leave type') + '?'
        }
        message={
          (toggleError ? toggleError + '\n\n' : '') +
          (toggle?.isActive
            ? 'This type will no longer be offered for new leave requests. Existing records remain available.'
            : 'This type will be available for new leave requests.')
        }
        confirmLabel={toggle?.isActive ? 'Deactivate' : 'Activate'}
        loading={toggleBusy}
        onConfirm={changeActive}
        onCancel={() => {
          if (!toggleBusy) setToggle(null);
        }}
      />
    </div>
  );
}
