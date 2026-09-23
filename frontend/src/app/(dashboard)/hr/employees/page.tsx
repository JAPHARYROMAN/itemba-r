'use client';

import { Suspense, useEffect, useState } from 'react';
import { useWorkspaceSearchParams as useSearchParams } from '@/components/workspace/workspace-navigation';
import { usePayrollDraftEditor, usePayrollStateKey } from '@/features/payroll/payroll-drafts';
import { useWorkspaceRouter as useGuardedRouter } from '@/components/workspace/workspace-navigation';
import {
  Btn,
  ConfirmDialog,
  FormSelect,
  PageHeader,
  PageToolbar,
  showToast,
  PermissionDeniedState,
} from '@/components/ui';
import { RecordBrowser } from '@/components/workspace/record-browser';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import { useOrgScope } from '@/hooks/use-org-scope';
import { backendAllPages } from '@/lib/backend-all-pages';
import '@/components/workspace/workspace.css';
import { ApiError, backendDelete } from '@/lib/api-client';
import { downloadTablePdf } from '@/lib/export-download';
import { useAuth } from '@/hooks/use-auth';
import { Plus, RefreshCw, FileDown } from 'lucide-react';

interface EmployeeRow extends Record<string, unknown> {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  fullName?: string;
  email?: string;
  company?: { name: string; code?: string } | string | null;
  department?: { name: string } | string | null;
  position?: { title: string } | string | null;
  employmentType?: string;
  employmentStatus?: string;
  status?: string;
  payrollRegion?: string;
}

function EmployeesContent() {
  const router = useGuardedRouter();
  const params = useSearchParams();
  const urlCompany = params.get('companyId') ?? '';
  const urlStatus = params.get('employmentStatus') === 'ACTIVE' ? 'ACTIVE' : '';
  const { hasPermission } = useAuth();
  const canDelete = hasPermission('employees.delete');
  const canRead = hasPermission('employees.view');
  const canCreate = hasPermission('employees.create');
  const [deleting, setDeleting] = useState<EmployeeRow | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const stateKey = usePayrollStateKey('employees');
  const [search, setSearch] = useWorkspaceState(stateKey + '.search', '');
  const [query, setQuery] = useState(search.trim());
  const [page, setPage] = useWorkspaceState(stateKey + '.page', 1);
  const [filterStatus, setFilterStatus] = useWorkspaceState(stateKey + '.status', urlStatus);
  const [filterCompanyId, setFilterCompanyId] = useWorkspaceState(
    stateKey + '.company',
    urlCompany,
  );
  const [urlScope, setUrlScope] = useWorkspaceState(stateKey + '.url', {
    company: urlCompany,
    status: urlStatus,
  });
  useEffect(() => {
    if (urlScope.company === urlCompany && urlScope.status === urlStatus) return;
    setUrlScope({ company: urlCompany, status: urlStatus });
    setFilterCompanyId(urlCompany);
    setFilterStatus(urlStatus);
    setPage(1);
  }, [urlCompany, urlStatus, urlScope, setUrlScope, setFilterCompanyId, setFilterStatus, setPage]);
  const [exportingPdf, setExportingPdf] = useState(false);

  const { companies } = useOrgScope(undefined, {
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
  } = useWorkspaceRecords<EmployeeRow>(
    '/hr/employees',
    { page, limit: 20, search: query, employmentStatus: filterStatus, companyId: filterCompanyId },
    canRead,
  );
  const entry = usePayrollDraftEditor('employee', () => {
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
  const fullName = (e: EmployeeRow) => e.fullName ?? `${e.firstName} ${e.lastName}`;
  const companyName = (e: EmployeeRow) =>
    typeof e.company === 'object' ? (e.company?.name ?? '—') : (e.company ?? '—');
  const departmentName = (e: EmployeeRow) =>
    typeof e.department === 'object' ? (e.department?.name ?? '—') : (e.department ?? '—');
  const positionName = (e: EmployeeRow) =>
    typeof e.position === 'object' ? (e.position?.title ?? '—') : (e.position ?? '—');

  const handleExportPdf = async () => {
    if (!canRead || exportingPdf || loading) return;
    if (total === 0) {
      showToast('error', 'No employees to export');
      return;
    }

    const selectedCompany = companies.find((company) => company.id === filterCompanyId);
    const filters = [
      selectedCompany ? selectedCompany.name : 'All companies',
      filterStatus ? `Status: ${filterStatus.replace('_', ' ')}` : 'All statuses',
      query ? `Search: ${query}` : '',
    ];

    setExportingPdf(true);
    try {
      const exported = await backendAllPages<EmployeeRow>('/hr/employees', {
        search: query,
        employmentStatus: filterStatus,
        companyId: filterCompanyId,
      });
      await downloadTablePdf({
        title: 'Employee Register',
        subtitle: filters.join(' · '),
        companyId: filterCompanyId || undefined,
        columns: [
          'Code',
          'Full Name',
          'Company',
          'Department',
          'Position',
          'Type',
          'Region',
          'Status',
        ],
        rows: exported.map((employee) => [
          employee.employeeCode || '—',
          fullName(employee),
          companyName(employee),
          departmentName(employee),
          positionName(employee),
          employee.employmentType ?? '—',
          employee.payrollRegion ?? '—',
          employee.employmentStatus ?? employee.status ?? '—',
        ]),
        orientation: 'landscape',
        sectionTitle: 'Employees',
        summary: [{ label: 'Employees exported', value: String(exported.length) }],
        note: 'This register reflects the filters selected when the PDF was generated.',
        baseName: 'employee-register',
      });
      showToast('success', 'Employee register exported as PDF');
    } catch (err) {
      showToast('error', 'PDF export failed', err instanceof Error ? err.message : undefined);
    } finally {
      setExportingPdf(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting || !canDelete) return;
    setDeleteError('');
    try {
      await backendDelete(`/hr/employees/${deleting.id}`);
      showToast('success', 'Employee deleted');
      setDeleting(null);
      load();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Failed to delete employee');
    }
  };

  if (!canRead) return <PermissionDeniedState />;
  return (
    <div className="business-workspace record-workspace space-y-5">
      <PageHeader
        title="Employees"
        subtitle="Your people, their roles and the details that matter."
        breadcrumbs={[{ label: 'Payroll', href: '/payroll' }, { label: 'Employees' }]}
        actions={
          canCreate && (
            <Btn
              icon={<Plus size={16} />}
              onClick={() => entry.open({ kind: 'employee', companyId: filterCompanyId })}
            >
              New employee
            </Btn>
          )
        }
      />
      <div className="workspace-summary">
        <div>
          <span>Matching employees</span>
          <strong>{loading || loadError ? '—' : total}</strong>
        </div>
        <div>
          <span>Active on this page</span>
          <strong>
            {loading || loadError
              ? '—'
              : rows.filter((row) => (row.employmentStatus ?? row.status) === 'ACTIVE').length}
          </strong>
        </div>
      </div>
      {entry.drafts}
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search employees by name, code or email…"
        collapsibleFilters
        activeFilterCount={Number(Boolean(filterCompanyId)) + Number(Boolean(filterStatus))}
        filters={
          <>
            <FormSelect
              label="Company filter"
              value={filterCompanyId}
              options={companies.map((company) => ({ value: company.id, label: company.name }))}
              placeholder="All companies"
              onChange={(e) => {
                setFilterCompanyId(e.target.value);
                setPage(1);
              }}
            />
            <FormSelect
              label="Status filter"
              value={filterStatus}
              options={[
                'ACTIVE',
                'ON_LEAVE',
                'SUSPENDED',
                'TERMINATED',
                'RESIGNED',
                'INACTIVE',
              ].map((value) => ({ value, label: value.toLowerCase().replaceAll('_', ' ') }))}
              placeholder="All statuses"
              onChange={(e) => {
                setFilterStatus(e.target.value);
                setPage(1);
              }}
            />
          </>
        }
        actions={
          <>
            <Btn
              variant="secondary"
              icon={<RefreshCw size={15} />}
              disabled={loading}
              onClick={load}
            >
              Reload
            </Btn>
            <Btn
              variant="secondary"
              icon={<FileDown size={16} />}
              loading={exportingPdf}
              disabled={!total || loading || Boolean(loadError)}
              onClick={handleExportPdf}
            >
              Export register
            </Btn>
          </>
        }
      />
      <RecordBrowser
        stateKey={stateKey + '.selection'}
        selectionScope={JSON.stringify([filterCompanyId, filterStatus, search, page])}
        records={rows}
        title="Employees"
        name={fullName}
        reference={(row) => row.employeeCode}
        status={(row) => row.employmentStatus ?? row.status ?? '—'}
        fields={[
          { label: 'Company', value: companyName },
          { label: 'Department', value: departmentName },
        ]}
        details={[
          { label: 'Position', value: positionName },
          { label: 'Employment type', value: (row) => row.employmentType?.replaceAll('_', ' ') },
          { label: 'Payroll region', value: (row) => row.payrollRegion },
          { label: 'Email', value: (row) => row.email },
        ]}
        actions={(row) => (
          <>
            <Btn onClick={() => router.push(`/hr/employees/${row.id}`)}>Open employee</Btn>
            {canDelete && (
              <Btn
                variant="ghost"
                style={{ color: 'var(--aurora-danger)' }}
                onClick={() => {
                  setDeleting(row);
                  setDeleteError('');
                }}
              >
                Delete employee
              </Btn>
            )}
          </>
        )}
        loading={loading}
        error={loadError}
        onRetry={load}
        empty="No employees match your search or filters."
        page={page}
        pageSize={20}
        total={total}
        onPage={setPage}
      />

      <ConfirmDialog
        open={!!deleting}
        title="Delete Employee"
        variant="danger"
        confirmLabel="Delete"
        message={
          deleteError ||
          `Permanently delete ${deleting ? fullName(deleting) : 'this employee'} (${deleting?.employeeCode ?? ''})? Deletion is only for records created in error — to end a real employee's employment, use the termination workflow instead. Deletion is blocked while active allowances, deductions, open leave requests, unsettled salary advances, or payroll entries exist.`
        }
        onConfirm={handleDelete}
        onCancel={() => {
          setDeleting(null);
          setDeleteError('');
        }}
      />
    </div>
  );
}

export default function EmployeesPage() {
  return (
    <Suspense fallback={<p role="status">Loading employees…</p>}>
      <EmployeesContent />
    </Suspense>
  );
}
