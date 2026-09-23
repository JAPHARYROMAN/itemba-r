'use client';
import { useEffect, useState } from 'react';
import {
  Btn,
  FormInput,
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
import { ApprovalWorkflowEditor } from './approval-workflow-editor';
import {
  workflowLabel,
  workflowPath,
  type ApprovalWorkflow,
  type WorkflowCompany,
} from './approval-workflow-types';
import './workspace.css';

export function ApprovalWorkflowWorkspace() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('approval_workflows.view'),
    canManage = hasPermission('approval_workflows.manage'),
    canChoose = hasPermission('companies.read');
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ companyId: '', entityType: '', isActive: '' }),
    [page, setPage] = useState(1);
  const [editor, setEditor] = useState<{ record?: ApprovalWorkflow } | null>(null),
    [action, setAction] = useState<{
      record: ApprovalWorkflow;
      kind: 'activate' | 'deactivate' | 'delete';
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
  const result = useWorkspaceResource<{ data: ApprovalWorkflow[]; total: number }>(
    workflowPath,
    params,
    canRead,
  );
  const companies = useWorkspaceChoices<WorkflowCompany>('/companies', {}, canRead && canChoose);
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
  useEffect(() => {
    if (result.data && page > 1 && !result.data.data.length) setPage((p) => p - 1);
  }, [result.data, page]);
  if (!canRead)
    return <PermissionDeniedState description="Your role cannot view approval workflows." />;
  const rows = result.data?.data || [];
  return (
    <div className="business-workspace record-workspace">
      <PageHeader
        title="Approval workflows"
        subtitle="Rules, triggers and availability for approval routing."
        breadcrumbs={[{ label: 'Approvals', href: '/approvals' }, { label: 'Workflows' }]}
        actions={canManage && <Btn onClick={() => setEditor({})}>New workflow</Btn>}
      />
      <div className="workspace-summary">
        <div>
          <span>Matching workflows</span>
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
        searchPlaceholder="Search workflows by name or code…"
        collapsibleFilters
        activeFilterCount={Object.values(filters).filter(Boolean).length}
        filters={
          <>
            {canChoose && (
              <FormSelect
                label="Company filter"
                value={filters.companyId}
                onChange={(e) => change('companyId', e.target.value)}
                placeholder="All accessible workflows"
                options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
                disabled={companies.loading || !!companies.error}
              />
            )}
            <FormInput
              label="Entity type filter"
              placeholder="Exact entity type"
              value={filters.entityType}
              onChange={(e) => change('entityType', e.target.value)}
            />
            <FormSelect
              label="Status filter"
              value={filters.isActive}
              onChange={(e) => change('isActive', e.target.value)}
              placeholder="All statuses"
              options={[
                { value: 'true', label: 'Active' },
                { value: 'false', label: 'Inactive' },
              ]}
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
        title="Approval workflows"
        records={rows}
        name={(r) => r.name}
        reference={(r) => r.workflowCode}
        status={(r) => (r.isActive ? 'ACTIVE' : 'INACTIVE')}
        fields={[
          { label: 'Entity type', value: (r) => r.entityType },
          { label: 'Company', value: (r) => r.company?.name || r.companyId || 'Group-level' },
        ]}
        details={[
          { label: 'Scope', value: (r) => workflowLabel(r.workflowScope) },
          { label: 'Trigger action', value: (r) => workflowLabel(r.triggerAction) },
          { label: 'Priority', value: (r) => r.priority },
          { label: 'Description', value: (r) => r.description || 'No description.' },
          { label: 'Configured steps', value: (r) => r.steps?.length ?? 'Unavailable' },
        ]}
        actions={(r) =>
          canManage && (
            <>
              <Btn onClick={() => setEditor({ record: r })}>Edit workflow</Btn>
              <Btn
                variant="secondary"
                onClick={() =>
                  setAction({ record: r, kind: r.isActive ? 'deactivate' : 'activate' })
                }
              >
                {r.isActive ? 'Deactivate' : 'Activate'}
              </Btn>
              <Btn variant="ghost" onClick={() => setAction({ record: r, kind: 'delete' })}>
                Delete workflow
              </Btn>
            </>
          )
        }
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        empty="No workflows match this view."
        page={page}
        pageSize={20}
        total={result.data?.total ?? 0}
        onPage={setPage}
      />
      {editor && (
        <ApprovalWorkflowEditor
          record={editor.record}
          companyId={filters.companyId}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      )}
      {action && <WorkflowAction {...action} onClose={() => setAction(null)} onSaved={saved} />}
    </div>
  );
}
function WorkflowAction({
  record,
  kind,
  onClose,
  onSaved,
}: {
  record: ApprovalWorkflow;
  kind: 'activate' | 'deactivate' | 'delete';
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const label = workflowLabel(kind);
  const submit = async () => {
    if (busy || !hasPermission('approval_workflows.manage')) return;
    setBusy(true);
    setError('');
    try {
      if (kind === 'delete') await backendDelete(`${workflowPath}/${record.id}`);
      else await backendPatch(`${workflowPath}/${record.id}/${kind}`);
      onSaved(
        kind === 'delete'
          ? 'Workflow deleted.'
          : kind === 'activate'
            ? 'Workflow activated.'
            : 'Workflow deactivated.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update this workflow.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={`${label} workflow`}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant={kind === 'delete' ? 'danger' : 'primary'} loading={busy} onClick={submit}>
            {label} workflow
          </Btn>
        </>
      }
    >
      <div className="workspace-notice">
        <strong>
          {record.name} · {record.workflowCode}
        </strong>
        <p>{record.company?.name || record.companyId || 'Group-level workflow'}</p>
      </div>
      <p className="mt-4">
        {kind === 'delete'
          ? 'Remove this workflow from the available configurations? Existing requests remain recorded.'
          : kind === 'activate'
            ? 'Make this workflow available for approval routing?'
            : 'Make this workflow inactive for approval routing?'}
      </p>
      {error && (
        <p role="alert" className="workspace-notice mt-4">
          {error}
        </p>
      )}
    </Modal>
  );
}
