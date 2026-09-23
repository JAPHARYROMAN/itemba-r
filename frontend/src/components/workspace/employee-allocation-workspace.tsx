'use client';
import { useEffect, useState } from 'react';
import {
  Btn,
  FormSelect,
  Modal,
  PageHeader,
  PageToolbar,
  PermissionDeniedState,
} from '@/components/ui';
import { RecordBrowser } from './record-browser';
import { payrollMoney } from './payroll-types';
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useAuth } from '@/hooks/use-auth';
import { backendDelete } from '@/lib/api-client';
import './workspace.css';
import { useWorkspaceState } from './workspace-session';
import {
  type Kind,
  type Company,
  type Allocation,
  type AllocationType,
  employeeName,
  typeOf,
  dateLabel,
  statuses,
} from '@/features/payroll/allocation-types';
import { usePayrollDraftEditor, usePayrollStateKey } from '@/features/payroll/payroll-drafts';

export function EmployeeAllocationWorkspace({ kind }: { kind: Kind }) {
  const { hasPermission } = useAuth();
  const canRead = hasPermission(kind + 's.view'),
    canManage = hasPermission(kind + 's.manage');
  const path = '/hr/employee-' + kind + 's',
    title = 'Employee ' + kind + 's';
  const stateKey = usePayrollStateKey(kind + 's');
  const [search, setSearch] = useWorkspaceState(stateKey + '.search', '');
  const [query, setQuery] = useState(search.trim());
  const [company, setCompany] = useWorkspaceState(stateKey + '.company', '');
  const [type, setType] = useWorkspaceState(stateKey + '.type', '');
  const [status, setStatus] = useWorkspaceState(stateKey + '.status', '');
  const [page, setPage] = useWorkspaceState(stateKey + '.page', 1);
  const [removing, setRemoving] = useState<Allocation | null>(null),
    [notice, setNotice] = useState('');
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, query, setPage]);
  const result = useWorkspaceRecords<Allocation>(
    path,
    { page, limit: 20, search: query, companyId: company, [kind + 'TypeId']: type, status },
    canRead,
  );
  useEffect(() => {
    if (!result.loading && !result.error && page > 1 && !result.rows.length)
      setPage(Math.max(1, Math.ceil(result.total / 20)));
  }, [result.loading, result.error, result.rows.length, result.total, page, setPage]);
  const companies = useWorkspaceChoices<Company>('/companies', {}, canRead);
  const types = useWorkspaceChoices<AllocationType>(
    '/hr/' + kind + '-types',
    { companyId: company },
    canRead,
  );
  const saved = (message: string) => {
    setRemoving(null);
    setNotice(message);
    void result.reload();
  };
  const entry = usePayrollDraftEditor(kind, saved);
  if (!canRead)
    return <PermissionDeniedState description={'Your role cannot view employee ' + kind + 's.'} />;
  return (
    <div className="business-workspace record-workspace">
      <PageHeader
        title={title}
        subtitle="Review employee allocations, amounts and effective dates."
        breadcrumbs={[{ label: 'Payroll', href: '/payroll' }, { label: title }]}
        actions={
          canManage && (
            <Btn variant="primary" onClick={() => entry.open({ kind })}>
              New {kind}
            </Btn>
          )
        }
      />
      <div className="workspace-summary">
        <div>
          <span>Matching allocations</span>
          <strong>{result.total}</strong>
        </div>
      </div>
      {notice && (
        <p role="status" className="workspace-notice">
          {notice}
        </p>
      )}
      {[companies, types].map(
        (choices, i) =>
          choices.error && (
            <div role="alert" className="workspace-notice" key={i}>
              {choices.error}{' '}
              <Btn variant="ghost" onClick={choices.retry}>
                Retry {i === 0 ? 'companies' : 'types'}
              </Btn>
            </div>
          ),
      )}
      {entry.drafts}
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search employee or type…"
        collapsibleFilters
        activeFilterCount={Number(!!company) + Number(!!type) + Number(!!status)}
        filters={
          <>
            <FormSelect
              label="Company filter"
              value={company}
              options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="All companies"
              onChange={(e) => {
                setCompany(e.target.value);
                setType('');
                setPage(1);
              }}
            />
            <FormSelect
              label="Type filter"
              value={type}
              options={types.rows.map((t) => ({ value: t.id, label: t.name + ' · ' + t.code }))}
              placeholder="All types"
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
            />
            <FormSelect
              label="Status filter"
              value={status}
              options={statuses}
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
        stateKey={stateKey + '.selection'}
        selectionScope={JSON.stringify([company, type, status, search, page])}
        title={title}
        records={result.rows}
        name={employeeName}
        reference={(r) => typeOf(r, kind)?.name || 'Type unavailable'}
        status={(r) => r.status}
        fields={[
          {
            label: 'Amount',
            value: (r) => (r.amount == null ? 'Not set' : payrollMoney(r.amount)),
          },
          { label: 'Effective from', value: (r) => dateLabel(r.effectiveFrom) },
        ]}
        details={[
          { label: 'Company', value: (r) => r.company?.name || '—' },
          { label: 'Employee code', value: (r) => r.employee?.employeeCode || '—' },
          { label: 'Type code', value: (r) => typeOf(r, kind)?.code || '—' },
          ...(kind === 'deduction'
            ? [
                {
                  label: 'Percentage',
                  value: (r: Allocation) =>
                    r.percentage == null ? 'Not set' : Number(r.percentage) + '%',
                },
              ]
            : []),
          { label: 'Effective to', value: (r) => dateLabel(r.effectiveTo) },
          { label: 'Notes', value: (r) => r.notes || '—' },
        ]}
        actions={(r) =>
          canManage && (
            <>
              <Btn variant="primary" onClick={() => entry.open({ kind, record: r })}>
                Edit allocation
              </Btn>
              <Btn variant="ghost" onClick={() => setRemoving(r)}>
                Delete allocation
              </Btn>
            </>
          )
        }
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        page={page}
        pageSize={20}
        total={result.total}
        onPage={setPage}
      />
      {removing && (
        <AllocationRemoval
          kind={kind}
          record={removing}
          onClose={() => setRemoving(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}

function AllocationRemoval({
  kind,
  record,
  onClose,
  onSaved,
}: {
  kind: Kind;
  record: Allocation;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const remove = async () => {
    if (busy || !hasPermission(kind + 's.manage')) return;
    setBusy(true);
    setError('');
    try {
      await backendDelete('/hr/employee-' + kind + 's/' + record.id);
      onSaved('Employee ' + kind + ' deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete this allocation.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={'Delete employee ' + kind}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="danger" loading={busy} onClick={remove}>
            Delete allocation
          </Btn>
        </>
      }
    >
      <div className="workspace-notice">
        <strong>{employeeName(record)}</strong>
        <p>
          {typeOf(record, kind)?.name} · {record.company?.name}
        </p>
        <p>{record.amount == null ? 'Amount not set' : payrollMoney(record.amount)}</p>
      </div>
      <p className="mt-4">
        Remove this allocation from future payroll calculations? Existing payroll entries are
        retained.
      </p>
      {error && (
        <p role="alert" className="workspace-notice mt-4">
          {error}
        </p>
      )}
    </Modal>
  );
}
