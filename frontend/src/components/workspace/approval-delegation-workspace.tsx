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
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { backendDelete, backendPatch } from '@/lib/api-client';
import { RecordBrowser } from './record-browser';
import { ApprovalDelegationEditor } from './approval-delegation-editor';
import {
  delegationPath,
  delegationName,
  delegationDate,
  delegationStatuses,
  type ApprovalDelegation,
  type DelegationCompany,
} from './approval-delegation-types';
import './workspace.css';

export function ApprovalDelegationWorkspace() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('approval_delegations.view'),
    canManage = hasPermission('approval_delegations.manage'),
    canChoose = hasPermission('companies.read');
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ companyId: '', status: '' });
  const [editor, setEditor] = useState<{ record?: ApprovalDelegation } | null>(null),
    [action, setAction] = useState<{
      record: ApprovalDelegation;
      kind: 'cancel' | 'delete';
    } | null>(null),
    [notice, setNotice] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const params = { page, limit: 20, search: query, ...filters };
  const result = useWorkspaceResource<{ data: ApprovalDelegation[]; total: number }>(
    delegationPath,
    params,
    canRead,
  );
  const companies = useWorkspaceChoices<DelegationCompany>('/companies', {}, canRead && canChoose);
  useEffect(() => {
    if (result.data && page > 1 && !result.data.data.length) setPage((p) => p - 1);
  }, [result.data, page]);
  const change = (key: keyof typeof filters, value: string) => {
    setFilters((p) => ({ ...p, [key]: value }));
    setPage(1);
  };
  const saved = (message: string) => {
    setEditor(null);
    setAction(null);
    setNotice(message);
    result.reload();
  };
  if (!canRead)
    return <PermissionDeniedState description="Your role cannot view approval delegations." />;
  return (
    <div className="business-workspace record-workspace">
      <PageHeader
        title="Approval delegations"
        subtitle="Temporary cover for designated approvers, with clear scope and dates."
        breadcrumbs={[{ label: 'Approvals', href: '/approvals' }, { label: 'Delegations' }]}
        actions={canManage && <Btn onClick={() => setEditor({})}>New delegation</Btn>}
      />
      <div className="workspace-summary">
        <div>
          <span>Matching delegations</span>
          <strong>
            {result.loading ? '…' : result.error ? 'Unavailable' : (result.data?.total ?? '—')}
          </strong>
        </div>
      </div>
      {notice && (
        <p role="status" className="workspace-notice">
          {notice}
        </p>
      )}
      {companies.error && (
        <div role="alert" className="workspace-notice">
          Company choices unavailable. {companies.error}
          <Btn variant="ghost" onClick={companies.retry}>
            Retry companies
          </Btn>
        </div>
      )}
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search people, entity type or reason…"
        collapsibleFilters
        activeFilterCount={Object.values(filters).filter(Boolean).length}
        filters={
          <>
            {canChoose && (
              <FormSelect
                label="Company filter"
                value={filters.companyId}
                onChange={(e) => change('companyId', e.target.value)}
                placeholder="All accessible delegations"
                options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
                disabled={companies.loading || !!companies.error}
              />
            )}
            <FormSelect
              label="Status filter"
              value={filters.status}
              onChange={(e) => change('status', e.target.value)}
              placeholder="All statuses"
              options={delegationStatuses.map((value) => ({
                value,
                label: value.charAt(0) + value.slice(1).toLowerCase(),
              }))}
            />
          </>
        }
        actions={
          <Btn variant="secondary" onClick={result.reload} disabled={result.loading}>
            Refresh
          </Btn>
        }
      />
      <RecordBrowser
        key={JSON.stringify(params)}
        title="Delegations"
        records={result.data?.data || []}
        name={delegationName}
        reference={(r) => r.entityType || 'All entity types'}
        status={(r) => r.status}
        fields={[
          { label: 'Company', value: (r) => r.company?.name || r.companyId || 'All companies' },
          { label: 'Ends', value: (r) => delegationDate(r.endDate) },
        ]}
        details={[
          { label: 'Starts', value: (r) => delegationDate(r.startDate) },
          { label: 'Time zone', value: () => Intl.DateTimeFormat().resolvedOptions().timeZone },
          { label: 'Entity type', value: (r) => r.entityType || 'All entity types' },
          { label: 'Reason', value: (r) => r.reason || 'No reason recorded.' },
          {
            label: 'Availability',
            value: () =>
              'Requires Active status and a matching company, entity type and date window.',
          },
        ]}
        actions={(r) =>
          canManage && (
            <>
              {['ACTIVE', 'INACTIVE'].includes(r.status) && (
                <Btn onClick={() => setEditor({ record: r })}>Edit delegation</Btn>
              )}
              {r.status === 'ACTIVE' && (
                <Btn variant="secondary" onClick={() => setAction({ record: r, kind: 'cancel' })}>
                  Cancel delegation
                </Btn>
              )}
              <Btn variant="ghost" onClick={() => setAction({ record: r, kind: 'delete' })}>
                Delete delegation
              </Btn>
            </>
          )
        }
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        empty="No delegations match this view."
        page={page}
        pageSize={20}
        total={result.data?.total ?? 0}
        onPage={setPage}
      />
      {editor && (
        <ApprovalDelegationEditor
          record={editor.record}
          companyId={filters.companyId}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      )}
      {action && <DelegationAction {...action} onClose={() => setAction(null)} onSaved={saved} />}
    </div>
  );
}
function DelegationAction({
  record,
  kind,
  onClose,
  onSaved,
}: {
  record: ApprovalDelegation;
  kind: 'cancel' | 'delete';
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const label = kind === 'cancel' ? 'Cancel delegation' : 'Delete delegation';
  const submit = async () => {
    if (busy || !hasPermission('approval_delegations.manage')) return;
    setBusy(true);
    setError('');
    try {
      if (kind === 'cancel') await backendPatch(`${delegationPath}/${record.id}/cancel`);
      else await backendDelete(`${delegationPath}/${record.id}`);
      onSaved(kind === 'cancel' ? 'Delegation cancelled.' : 'Delegation deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update this delegation.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={label}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={onClose}>
            Keep delegation
          </Btn>
          <Btn variant={kind === 'delete' ? 'danger' : 'primary'} loading={busy} onClick={submit}>
            {label}
          </Btn>
        </>
      }
    >
      <div className="workspace-notice">
        <strong>{delegationName(record)}</strong>
        <p>
          {record.company?.name || record.companyId || 'All companies'} ·{' '}
          {record.entityType || 'All entity types'}
        </p>
        <p>
          {delegationDate(record.startDate)} — {delegationDate(record.endDate)}
        </p>
      </div>
      <p className="mt-4">
        {kind === 'cancel'
          ? 'Stop this delegation from applying immediately?'
          : 'Remove this delegation? It will no longer provide approval cover.'}
      </p>
      {error && (
        <p role="alert" className="workspace-notice mt-4">
          {error}
        </p>
      )}
    </Modal>
  );
}
