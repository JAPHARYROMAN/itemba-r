'use client';

import { useEffect, useState } from 'react';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { usePayrollDraftEditor, usePayrollStateKey } from '@/features/payroll/payroll-drafts';

import { Plus, RefreshCw } from 'lucide-react';
import {
  PageHeader,
  PageToolbar,
  FormSelect,
  Modal,
  Btn,
  PermissionDeniedState,
} from '@/components/ui';
import { RecordBrowser } from '@/components/workspace/record-browser';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import { backendDelete } from '@/lib/api-client';
import '@/components/workspace/workspace.css';

import type { Department } from '@/features/payroll/department-workflow';
export default function DepartmentsPage() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('departments.view');
  const canManage = hasPermission('departments.manage');
  const stateKey = usePayrollStateKey('departments');
  const [page, setPage] = useWorkspaceState(stateKey + '.page', 1);
  const [search, setSearch] = useWorkspaceState(stateKey + '.search', '');
  const [query, setQuery] = useState(search.trim());
  const [status, setStatus] = useWorkspaceState(stateKey + '.status', '');
  const [companyFilter, setCompanyFilter] = useWorkspaceState(stateKey + '.companyFilter', '');
  const [deleting, setDeleting] = useState<Department | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [info, setInfo] = useState('');
  const { companyOptions } = useOrgScope(undefined, {
    skipEmployees: true,
    skipDivisions: true,
    skipBranches: true,
  });
  const {
    rows,
    total,
    loading,
    error: loadError,
    reload: load,
  } = useWorkspaceRecords<Department>(
    '/hr/departments',
    { page, limit: 20, search: query, status, companyId: companyFilter },
    canRead,
  );
  const entry = usePayrollDraftEditor('department', (message) => {
    setInfo(message);
    void load();
  });
  useEffect(() => {
    if (!loading && !loadError && page > 1 && !rows.length)
      setPage(Math.max(1, Math.ceil(total / 20)));
  }, [loading, loadError, rows.length, total, page, setPage]);
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, query, setPage]);

  async function remove() {
    if (!deleting || !canManage || deletingBusy) return;
    setDeletingBusy(true);
    setDeleteError('');
    setInfo('');
    try {
      await backendDelete(`/hr/departments/${deleting.id}`);
      setDeleting(null);
      setInfo('Department deleted.');
      void load();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to delete department.');
    } finally {
      setDeletingBusy(false);
    }
  }
  if (!canRead) return <PermissionDeniedState />;
  return (
    <div className="business-workspace record-workspace space-y-5">
      <PageHeader
        title="Departments"
        subtitle="Give every team a clear place in your organisation."
        breadcrumbs={[{ label: 'Payroll', href: '/payroll' }, { label: 'Departments' }]}
        actions={
          canManage && (
            <Btn
              icon={<Plus size={16} />}
              onClick={() => entry.open({ kind: 'department', companyId: companyFilter })}
            >
              New department
            </Btn>
          )
        }
      />
      <div className="workspace-summary">
        <div>
          <span>Matching departments</span>
          <strong>{loading || loadError ? '—' : total}</strong>
        </div>
        <div>
          <span>Active on this page</span>
          <strong>
            {loading || loadError ? '—' : rows.filter((row) => row.status === 'ACTIVE').length}
          </strong>
        </div>
      </div>
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search departments by name…"
        collapsibleFilters
        activeFilterCount={Number(Boolean(companyFilter)) + Number(Boolean(status))}
        filters={
          <>
            <FormSelect
              label="Company filter"
              value={companyFilter}
              options={companyOptions}
              placeholder="All companies"
              onChange={(e) => {
                setCompanyFilter(e.target.value);
                setPage(1);
              }}
            />
            <FormSelect
              label="Status filter"
              value={status}
              options={[
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Inactive' },
              ]}
              placeholder="All statuses"
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            />
          </>
        }
        actions={
          <Btn variant="secondary" icon={<RefreshCw size={15} />} disabled={loading} onClick={load}>
            Reload
          </Btn>
        }
      />
      {info && (
        <p role="status" className="workspace-notice">
          {info}
        </p>
      )}
      {entry.drafts}
      <RecordBrowser
        stateKey={stateKey + '.record'}
        selectionScope={JSON.stringify([companyFilter, status, query])}
        records={rows}
        title="Departments"
        name={(row) => row.name}
        reference={(row) => row.departmentCode}
        status={(row) => row.status}
        fields={[
          {
            label: 'Company',
            value: (row) =>
              typeof row.company === 'object' ? row.company.name : row.company || '—',
          },
          { label: 'Division', value: (row) => row.division?.name || '—' },
        ]}
        details={[
          { label: 'Branch / Location', value: (row) => row.branch?.name || 'Company-wide' },
        ]}
        actions={
          canManage
            ? (row) => (
                <>
                  <Btn onClick={() => entry.open({ kind: 'department', record: row })}>
                    Edit department
                  </Btn>
                  <Btn
                    variant="ghost"
                    style={{ color: 'var(--aurora-danger)' }}
                    onClick={() => {
                      setDeleting(row);
                      setDeleteError('');
                    }}
                  >
                    Delete department
                  </Btn>
                </>
              )
            : undefined
        }
        loading={loading}
        error={loadError}
        onRetry={load}
        empty="No departments match your search or filters."
        page={page}
        pageSize={20}
        total={total}
        onPage={setPage}
      />
      <Modal
        open={Boolean(deleting)}
        onClose={() => {
          if (!deletingBusy) setDeleting(null);
        }}
        title="Delete department"
        footer={
          <>
            <Btn variant="secondary" disabled={deletingBusy} onClick={() => setDeleting(null)}>
              Cancel
            </Btn>
            <Btn variant="danger" loading={deletingBusy} onClick={remove}>
              Delete department
            </Btn>
          </>
        }
      >
        <p>
          Delete <strong>{deleting?.name}</strong> ({deleting?.departmentCode})? It will be removed
          from the department list.
        </p>
        {deleteError && (
          <p role="alert" className="workspace-error mt-4">
            {deleteError}
          </p>
        )}
      </Modal>
    </div>
  );
}
