'use client';

import { useEffect, useState } from 'react';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { usePayrollDraftEditor, usePayrollStateKey } from '@/features/payroll/payroll-drafts';

import {
  PageHeader,
  PageToolbar,
  FormSelect,
  Modal,
  Btn,
  PermissionDeniedState,
} from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

import { RecordBrowser } from '@/components/workspace/record-browser';
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import { useAuth } from '@/hooks/use-auth';
import { backendDelete } from '@/lib/api-client';
import { Plus, RefreshCw } from 'lucide-react';
import '@/components/workspace/workspace.css';

import {
  type Position,
  labelForPositionType,
  hierarchyLabel,
} from '@/features/payroll/position-workflow';
export default function PositionsPage() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('positions.view');
  const canManage = hasPermission('positions.manage');
  const stateKey = usePayrollStateKey('positions');
  const [page, setPage] = useWorkspaceState(stateKey + '.page', 1);
  const [search, setSearch] = useWorkspaceState(stateKey + '.search', '');
  const [query, setQuery] = useState(search.trim());
  const [companyFilter, setCompanyFilter] = useWorkspaceState(stateKey + '.companyFilter', '');
  const [statusFilter, setStatusFilter] = useWorkspaceState(stateKey + '.statusFilter', '');
  const {
    rows,
    total,
    loading,
    error: loadError,
    reload: load,
  } = useWorkspaceRecords<Position>(
    '/hr/positions',
    { page, limit: 20, search: query, companyId: companyFilter, status: statusFilter },
    canRead,
  );
  const [info, setInfo] = useState('');
  const [deleting, setDeleting] = useState<Position | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deletingBusy, setDeletingBusy] = useState(false);
  const { companyOptions } = useOrgScope(undefined, {
    skipEmployees: true,
    skipDivisions: true,
    skipBranches: true,
  });
  const entry = usePayrollDraftEditor('position', (message) => {
    setInfo(message);
    void load();
  });
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, query, setPage]);
  useEffect(() => {
    if (!loading && !loadError && page > 1 && !rows.length)
      setPage(Math.max(1, Math.ceil(total / 20)));
  }, [loading, loadError, page, rows.length, total, setPage]);
  const handleDelete = async () => {
    if (!deleting || !canManage || deletingBusy) return;
    setDeletingBusy(true);
    setDeleteError('');
    try {
      await backendDelete(`/hr/positions/${deleting.id}`);
      setDeleting(null);
      setInfo('Position deleted.');
      void load();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to delete position.');
    } finally {
      setDeletingBusy(false);
    }
  };

  if (!canRead) return <PermissionDeniedState />;
  return (
    <div className="business-workspace record-workspace space-y-5">
      <PageHeader
        title="Positions"
        subtitle="Roles, departments and the structure behind your team."
        breadcrumbs={[{ label: 'Payroll', href: '/payroll' }, { label: 'Positions' }]}
        actions={
          canManage && (
            <Btn
              icon={<Plus size={16} />}
              onClick={() => entry.open({ kind: 'position', companyId: companyFilter })}
            >
              New position
            </Btn>
          )
        }
      />
      <div className="workspace-summary">
        <div>
          <span>Matching positions</span>
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
        searchPlaceholder="Search positions by title, code or department…"
        collapsibleFilters
        activeFilterCount={Number(Boolean(companyFilter)) + Number(Boolean(statusFilter))}
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
              value={statusFilter}
              options={[
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Inactive' },
              ]}
              placeholder="All statuses"
              onChange={(e) => {
                setStatusFilter(e.target.value);
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
        selectionScope={JSON.stringify([companyFilter, statusFilter, query])}
        records={rows}
        title="Positions"
        name={(row) => row.title}
        reference={(row) => row.positionCode}
        status={(row) => row.status}
        fields={[
          { label: 'Company', value: (row) => row.company?.name || '—' },
          { label: 'Department', value: (row) => row.department?.name || '—' },
        ]}
        details={[
          { label: 'Division / Branch', value: (row) => hierarchyLabel(row.department) },
          { label: 'Role type', value: (row) => labelForPositionType(row.positionType) },
          {
            label: 'Default salary',
            value: (row) =>
              row.defaultSalary == null
                ? 'Not set'
                : `${row.currency || 'TZS'} ${Number(row.defaultSalary).toLocaleString()}`,
          },
        ]}
        actions={
          canManage
            ? (row) => (
                <>
                  <Btn onClick={() => entry.open({ kind: 'position', record: row })}>
                    Edit position
                  </Btn>
                  <Btn
                    variant="ghost"
                    style={{ color: 'var(--aurora-danger)' }}
                    onClick={() => {
                      setDeleting(row);
                      setDeleteError('');
                    }}
                  >
                    Delete position
                  </Btn>
                </>
              )
            : undefined
        }
        loading={loading}
        error={loadError}
        onRetry={load}
        empty="No positions match your search or filters."
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
        title="Delete position"
        footer={
          <>
            <Btn variant="secondary" disabled={deletingBusy} onClick={() => setDeleting(null)}>
              Cancel
            </Btn>
            <Btn variant="danger" loading={deletingBusy} onClick={handleDelete}>
              Delete position
            </Btn>
          </>
        }
      >
        <p>
          Delete <strong>{deleting?.title}</strong> ({deleting?.positionCode})? It will be removed
          from the position list.
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
