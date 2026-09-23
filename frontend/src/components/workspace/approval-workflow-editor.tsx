'use client';
import { useState } from 'react';
import { Btn, FormInput, FormSelect, FormTextarea, Modal } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { backendPatch, backendPost } from '@/lib/api-client';
import { useFormGuard } from './unsaved-work-provider';
import {
  workflowForm,
  workflowScopes,
  workflowTriggers,
  workflowLabel,
  workflowPath,
  type ApprovalWorkflow,
  type WorkflowCompany,
} from './approval-workflow-types';

export function ApprovalWorkflowEditor({
  record,
  companyId = '',
  onClose,
  onSaved,
}: {
  record?: ApprovalWorkflow;
  companyId?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { user, hasPermission } = useAuth();
  const canChoose = hasPermission('companies.read');
  const [form, setForm] = useState(() =>
    workflowForm(record, canChoose ? companyId : user?.companyId || ''),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const draft = useFormGuard(form, setForm);
  const companies = useWorkspaceChoices<WorkflowCompany>('/companies', {}, !record && canChoose);
  const baseline = workflowForm(record);
  const f =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [key]: e.target.value }));
  const close = () => {
    if (!busy) draft.requestClose(onClose);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !hasPermission('approval_workflows.manage') || companies.loading || companies.error)
      return;
    if (!form.name.trim() || !form.entityType.trim()) {
      setError('Name and entity type are required.');
      return;
    }
    const priority = Number(form.priority);
    if (
      !form.priority.trim() ||
      !Number.isInteger(priority) ||
      priority < -2147483648 ||
      priority > 2147483647
    ) {
      setError('Enter a whole-number priority from -2147483648 to 2147483647.');
      return;
    }
    const values: Record<string, string | number | boolean | null> = {
      name: form.name.trim(),
      entityType: form.entityType.trim(),
      description: form.description.trim() || null,
      workflowScope: form.workflowScope,
      triggerAction: form.triggerAction,
      priority,
      isActive: form.isActive === 'true',
    };
    const payload = record
      ? Object.fromEntries(
          Object.entries(values).filter(
            ([key]) => form[key as keyof typeof form] !== baseline[key as keyof typeof baseline],
          ),
        )
      : {
          ...values,
          description: form.description.trim() || undefined,
          companyId: form.companyId || undefined,
          workflowCode: form.workflowCode.trim() || undefined,
        };
    if (record && !Object.keys(payload).length) {
      draft.markSaved();
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (record) await backendPatch(`${workflowPath}/${record.id}`, payload);
      else await backendPost(workflowPath, payload);
      draft.markSaved();
      onSaved('Workflow saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this workflow.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={record ? 'Edit workflow' : 'New workflow'}
      subtitle={
        record
          ? `${record.name} · ${record.workflowCode}`
          : 'Define when this approval workflow applies.'
      }
      onClose={close}
      size="lg"
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Btn>
          <Btn
            type="submit"
            form="approval-workflow-form"
            loading={busy}
            disabled={companies.loading || !!companies.error}
          >
            Save workflow
          </Btn>
        </>
      }
    >
      <form id="approval-workflow-form" className="space-y-5" onSubmit={submit} {...draft.capture}>
        {companies.loading && <p role="status">Loading companies…</p>}
        {companies.error && (
          <div role="alert" className="workspace-notice">
            {companies.error}
            <Btn variant="ghost" onClick={companies.retry}>
              Retry companies
            </Btn>
          </div>
        )}
        <fieldset disabled={busy} className="space-y-5">
          <h3 className="font-semibold">Identity</h3>
          {record ? (
            <p className="workspace-notice">
              Company: {record.company?.name || record.companyId || 'Group-level workflow'}
            </p>
          ) : canChoose ? (
            <FormSelect
              label="Company"
              value={form.companyId}
              onChange={f('companyId')}
              placeholder="No company (group access required)"
              options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
              disabled={companies.loading || !!companies.error}
            />
          ) : (
            <p className="workspace-notice">
              {form.companyId
                ? 'Using your assigned company.'
                : 'Creating without a company requires group-level access.'}
            </p>
          )}
          <div className="workspace-form-grid">
            {!record && (
              <FormInput
                label="Workflow code"
                value={form.workflowCode}
                onChange={f('workflowCode')}
                hint="Leave blank to generate a code."
              />
            )}
            <FormInput label="Name" required value={form.name} onChange={f('name')} />
            <FormInput
              label="Entity type"
              required
              value={form.entityType}
              onChange={f('entityType')}
              hint="Use the exact entity type, for example PurchaseOrder."
            />
          </div>
          <h3 className="font-semibold">Matching and availability</h3>
          <div className="workspace-form-grid">
            <FormSelect
              label="Scope"
              value={form.workflowScope}
              onChange={f('workflowScope')}
              options={workflowScopes.map((value) => ({ value, label: workflowLabel(value) }))}
            />
            <FormSelect
              label="Trigger action"
              value={form.triggerAction}
              onChange={f('triggerAction')}
              options={workflowTriggers.map((value) => ({ value, label: workflowLabel(value) }))}
            />
            <FormInput
              label="Priority"
              required
              type="number"
              step={1}
              min={-2147483648}
              max={2147483647}
              value={form.priority}
              onChange={f('priority')}
            />
            <FormSelect
              label="Status"
              value={form.isActive}
              onChange={f('isActive')}
              options={[
                { value: 'true', label: 'Active' },
                { value: 'false', label: 'Inactive' },
              ]}
            />
          </div>
          <FormTextarea
            label="Description"
            rows={3}
            value={form.description}
            onChange={f('description')}
          />
        </fieldset>
        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
