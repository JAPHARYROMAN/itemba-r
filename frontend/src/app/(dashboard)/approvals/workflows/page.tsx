'use client';
import { useCallback, useEffect, useState } from 'react';
import { PageSpinner, Modal, ConfirmDialog, Btn, FormInput, FormSelect, FormTextarea, showToast } from '@/components/ui';
import { backendPost, backendPatch, backendDelete, ApiError } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string }

interface Workflow {
  id: string;
  workflowCode: string;
  name: string;
  entityType: string;
  description?: string | null;
  workflowScope?: string | null;
  triggerAction?: string | null;
  companyId?: string | null;
  priority: number;
  isActive: boolean;
}

const SCOPES = ['GROUP', 'COMPANY', 'DIVISION', 'BRANCH', 'BUSINESS_UNIT', 'GLOBAL'];
const TRIGGER_ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'SUBMIT', 'POST', 'PAY', 'EXPORT', 'APPROVE', 'STATUS_CHANGE', 'OTHER'];

interface WorkflowForm {
  workflowCode: string; name: string; entityType: string; description: string;
  workflowScope: string; triggerAction: string; companyId: string; priority: string; isActive: string;
}
const BLANK: WorkflowForm = { workflowCode: '', name: '', entityType: '', description: '', workflowScope: '', triggerAction: '', companyId: '', priority: '0', isActive: 'true' };

function WorkflowModal({ mode, initial, companies, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: Workflow; companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<WorkflowForm>(() => initial ? {
    workflowCode: initial.workflowCode,
    name: initial.name,
    entityType: initial.entityType,
    description: initial.description ?? '',
    workflowScope: initial.workflowScope ?? '',
    triggerAction: initial.triggerAction ?? '',
    companyId: initial.companyId ?? '',
    priority: String(initial.priority ?? 0),
    isActive: initial.isActive ? 'true' : 'false',
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof WorkflowForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name || !form.entityType) { setError('Name and entity type are required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        entityType: form.entityType,
        description: form.description || undefined,
        workflowScope: form.workflowScope || undefined,
        triggerAction: form.triggerAction || undefined,
        priority: Number(form.priority) || 0,
        isActive: form.isActive === 'true',
      };
      if (mode === 'create') {
        await backendPost('/approvals/workflows', {
          ...body,
          workflowCode: form.workflowCode || undefined,
          companyId: form.companyId || undefined,
        });
      } else {
        await backendPatch(`/approvals/workflows/${initial!.id}`, body);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Workflow' : 'Edit Workflow'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        {mode === 'create' && (
          <FormInput label="Workflow Code" value={form.workflowCode} onChange={(e) => set('workflowCode', e.target.value)} hint="Leave blank to auto-generate" />
        )}
        <FormInput label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} />
        <FormInput label="Entity Type" required value={form.entityType} onChange={(e) => set('entityType', e.target.value)} hint="e.g. PurchaseOrder" />
        <FormSelect label="Scope" value={form.workflowScope} onChange={(e) => set('workflowScope', e.target.value)} placeholder="Select…">
          {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
        </FormSelect>
        <FormSelect label="Trigger Action" value={form.triggerAction} onChange={(e) => set('triggerAction', e.target.value)} placeholder="Select…">
          {TRIGGER_ACTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
        </FormSelect>
        {mode === 'create' && (
          <FormSelect label="Company" value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="Select…">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FormSelect>
        )}
        <FormInput label="Priority" type="number" value={form.priority} onChange={(e) => set('priority', e.target.value)} />
        <FormSelect label="Status" value={form.isActive} onChange={(e) => set('isActive', e.target.value)}>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </FormSelect>
        <div className="col-span-2"><FormTextarea label="Description" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function ApprovalWorkflowsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('approval_workflows.manage');

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEntityType, setFilterEntityType] = useState('');
  const [filterActive, setFilterActive] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [deleting, setDeleting] = useState<Workflow | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(() => {
    const params: Record<string, string> = {};
    if (filterEntityType) params.entityType = filterEntityType;
    if (filterActive !== '') params.isActive = filterActive;
    const qs = new URLSearchParams(params).toString();
    setLoadError('');
    fetch(`/api/backend/approvals/workflows${qs ? '?' + qs : ''}`)
      .then(r => r.json())
      .then((res: any) => setWorkflows(res.data?.data ?? []))
      .catch(() => {
        setWorkflows([]);
        setLoadError('Failed to load approval workflows. Check your connection and try again.');
      })
      .finally(() => setLoading(false));
  }, [filterEntityType, filterActive]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!canManage) return;
    // Company dropdown options for the create modal only; failure just leaves the select empty.
    fetch('/api/backend/companies?limit=100')
      .then(r => r.json())
      .then((j: any) => setCompanies(j.data?.data ?? j.data ?? []))
      .catch(() => undefined);
  }, [canManage]);

  const onSaved = () => { setCreating(false); setEditing(null); load(); };

  const doToggle = async (wf: Workflow) => {
    setActionLoading(wf.id);
    try {
      await backendPatch(`/approvals/workflows/${wf.id}/${wf.isActive ? 'deactivate' : 'activate'}`);
      showToast('success', wf.isActive ? 'Workflow deactivated' : 'Workflow activated');
      load();
    } catch (err) {
      showToast('error', 'Action failed', err instanceof ApiError ? err.message : 'Unexpected error');
    } finally { setActionLoading(null); }
  };

  const doDelete = async () => {
    if (!deleting) return;
    try {
      await backendDelete(`/approvals/workflows/${deleting.id}`);
      showToast('success', 'Workflow deleted');
      load();
    } catch (err) {
      showToast('error', 'Delete failed', err instanceof ApiError ? err.message : 'Unexpected error');
    } finally { setDeleting(null); }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Approval Workflows</h1>
          <p className="text-gray-500 mt-1">Define and manage approval workflow rules</p>
        </div>
        {canManage && (
          <button onClick={() => setCreating(true)} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors">
            + New Workflow
          </button>
        )}
      </div>

      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Filter by entity type..."
          value={filterEntityType}
          onChange={e => setFilterEntityType(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <select
          value={filterActive}
          onChange={e => setFilterActive(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All statuses</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      {loadError && (
        <div className="mb-4 flex items-center justify-between text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <span>{loadError}</span>
          <button onClick={load} className="text-red-700 font-medium hover:underline ml-3">Retry</button>
        </div>
      )}

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Code', 'Name', 'Entity Type', 'Scope', 'Trigger', 'Priority', 'Active', 'Actions'].map(h => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {workflows.map(wf => (
                <tr key={wf.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-mono text-gray-700">{wf.workflowCode}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{wf.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{wf.entityType}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{wf.workflowScope}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{wf.triggerAction}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{wf.priority}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${wf.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {wf.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm space-x-2">
                    {canManage ? (
                      <>
                        <button onClick={() => setEditing(wf)} className="text-blue-600 hover:underline">Edit</button>
                        <button onClick={() => doToggle(wf)} disabled={actionLoading === wf.id} className="text-gray-500 hover:underline disabled:opacity-50">
                          {actionLoading === wf.id ? '…' : wf.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button onClick={() => setDeleting(wf)} className="text-red-500 hover:underline">Delete</button>
                      </>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {workflows.length === 0 && (
                <tr><td colSpan={8} className="px-6 py-10 text-center text-gray-400">No workflows found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {creating && <WorkflowModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <WorkflowModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={onSaved} />}
      <ConfirmDialog
        open={!!deleting}
        title="Delete Workflow"
        message={`Delete workflow "${deleting?.name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
