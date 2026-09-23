'use client';
import { useEffect, useState } from 'react';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { usePayrollDraftEditor, usePayrollStateKey } from '@/features/payroll/payroll-drafts';

import {
  Btn,
  FormSelect,
  Modal,
  PageHeader,
  PageToolbar,
  PermissionDeniedState,
} from '@/components/ui';
import { RecordBrowser } from './record-browser';
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useAuth } from '@/hooks/use-auth';
import { backendDelete } from '@/lib/api-client';
import './workspace.css';

import {
  type Kind,
  type Company,
  type PayrollType,
  label,
  money,
} from '@/features/payroll/payroll-type-workflow';
export function PayrollTypeWorkspace({ kind }: { kind: Kind }) {
  const { hasPermission } = useAuth();
  const canRead = hasPermission(kind + 's.view'),
    canManage = hasPermission(kind + 's.manage');
  const path = '/hr/' + kind + '-types',
    title = label(kind) + ' types';
  const stateKey = usePayrollStateKey(kind + '-types');
  const [search, setSearch] = useWorkspaceState(stateKey + '.search', ''),
    [query, setQuery] = useState(search.trim()),
    [company, setCompany] = useWorkspaceState(stateKey + '.company', ''),
    [page, setPage] = useWorkspaceState(stateKey + '.page', 1);
  const [removing, setRemoving] = useState<PayrollType | null>(null),
    [notice, setNotice] = useState('');
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, query, setPage]);
  const result = useWorkspaceRecords<PayrollType>(
    path,
    { page, limit: 20, search: query, companyId: company },
    canRead,
  );
  const companies = useWorkspaceChoices<Company>('/companies', {}, canRead);
  const saved = (message: string) => {
    setRemoving(null);
    setNotice(message);
    void result.reload();
  };
  const entry = usePayrollDraftEditor(
    kind === 'allowance' ? 'allowance-type' : 'deduction-type',
    saved,
    undefined,
    kind,
  );
  useEffect(() => {
    if (!result.loading && !result.error && page > 1 && !result.rows.length)
      setPage(Math.max(1, Math.ceil(result.total / 20)));
  }, [result.loading, result.error, result.rows.length, result.total, page, setPage]);
  if (!canRead)
    return <PermissionDeniedState description={'Your role cannot view ' + kind + ' types.'} />;
  return (
    <div className="business-workspace record-workspace">
      <PageHeader
        title={title}
        subtitle={
          kind === 'allowance'
            ? 'Categories and defaults for employee allowances.'
            : 'Categories and defaults for payroll deductions.'
        }
        breadcrumbs={[{ label: 'Payroll', href: '/payroll' }, { label: title }]}
        actions={
          canManage && (
            <Btn
              variant="primary"
              onClick={() =>
                entry.open({ kind: kind === 'allowance' ? 'allowance-type' : 'deduction-type' })
              }
            >
              New {kind} type
            </Btn>
          )
        }
      />
      <div className="workspace-summary">
        <div>
          <span>Matching types</span>
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
          {companies.error}{' '}
          <Btn variant="ghost" onClick={companies.retry}>
            Retry companies
          </Btn>
        </div>
      )}
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder={'Search ' + kind + ' types by name…'}
        collapsibleFilters
        activeFilterCount={Number(!!company)}
        filters={
          <FormSelect
            label="Company filter"
            value={company}
            onChange={(e) => {
              setCompany(e.target.value);
              setPage(1);
            }}
            options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="All companies"
          />
        }
        actions={
          <Btn variant="secondary" disabled={result.loading} onClick={result.reload}>
            Reload
          </Btn>
        }
      />
      {entry.drafts}
      <RecordBrowser
        stateKey={stateKey + '.record'}
        selectionScope={JSON.stringify([kind, company, query])}
        title={title}
        records={result.rows}
        name={(r) => r.name}
        reference={(r) => r.code}
        status={(r) => (r.isActive ? 'ACTIVE' : 'INACTIVE')}
        fields={[
          { label: 'Company', value: (r) => r.company?.name || '—' },
          { label: 'Default amount', value: (r) => money(r.defaultAmount) },
        ]}
        details={[
          {
            label: kind === 'allowance' ? 'Taxable' : 'Statutory',
            value: (r) => ((kind === 'allowance' ? r.taxable : r.statutory) ? 'Yes' : 'No'),
          },
          { label: 'Recurring', value: (r) => (r.recurring ? 'Yes' : 'No') },
          ...(kind === 'deduction'
            ? [
                {
                  label: 'Default percentage',
                  value: (r: PayrollType) =>
                    r.defaultPercentage == null ? 'Not set' : Number(r.defaultPercentage) + '%',
                },
              ]
            : []),
        ]}
        actions={(r) =>
          canManage && (
            <>
              <Btn
                variant="primary"
                onClick={() =>
                  entry.open({
                    kind: kind === 'allowance' ? 'allowance-type' : 'deduction-type',
                    record: r,
                  })
                }
              >
                Edit type
              </Btn>
              <Btn variant="ghost" onClick={() => setRemoving(r)}>
                Delete type
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
        <RemoveType
          kind={kind}
          record={removing}
          onClose={() => setRemoving(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}

function RemoveType({
  kind,
  record,
  onClose,
  onSaved,
}: {
  kind: Kind;
  record: PayrollType;
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
      await backendDelete('/hr/' + kind + '-types/' + record.id);
      onSaved(label(kind) + ' type deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete this type.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={'Delete ' + kind + ' type'}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Btn variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="danger" onClick={remove} loading={busy}>
            Delete type
          </Btn>
        </>
      }
    >
      <div className="workspace-notice">
        <strong>
          {record.name} · {record.code}
        </strong>
        <p>{record.company?.name || 'Company unavailable'}</p>
      </div>
      <p className="mt-4">
        Remove this type from the available {kind} categories? Existing payroll records are
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
