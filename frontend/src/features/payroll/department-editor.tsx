'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Btn, FormInput, FormSelect, Modal } from '@/components/ui';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useAuth } from '@/hooks/use-auth';
import { backendGet, backendPost, backendPut } from '@/lib/api-client';
import { type Department, type FormState, empty, toForm } from './department-workflow';
export function DepartmentEditor({
  record: editing,
  companyId = '',
  source,
  onClose,
  onSaved,
}: {
  record?: Department;
  companyId?: string;
  source?: WorkspaceDraft;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [nextCodePreview, setNextCodePreview] = useState('');
  const formId = useId(),
    pending = useRef(false);
  const baseline = editing ? toForm(editing) : { ...empty, companyId };
  const stateKey = JSON.stringify([editing?.updatedAt, baseline]);
  const draft = useWorkspaceDraftForm<Partial<FormState>>(() => (editing ? {} : baseline), {
    appId: 'payroll',
    title: editing ? 'Edit department' : 'New department',
    describe: (values) => values.name || editing?.name || 'Team definition',
    context: { kind: 'department', recordId: editing?.id || '', stateKey },
    draftId: source?.id,
    busy: saving,
    onClose,
    needsReview:
      !!source && !!editing && (!editing.updatedAt || source.context.stateKey !== stateKey),
    reviewKey: stateKey,
  });
  const form: FormState = { ...baseline, ...draft.form };
  const setForm = (change: (current: FormState) => FormState) => {
    const next = change(form);
    draft.setForm(
      editing
        ? Object.fromEntries(
            Object.entries(next).filter(
              ([key, value]) => value !== baseline[key as keyof FormState],
            ),
          )
        : next,
    );
  };
  const scope = useOrgScope(form.companyId, { skipEmployees: true });
  const { loading: orgLoading, error: orgError, retry: retryOrg } = scope;
  const companyOptions = [...scope.companyOptions],
    divisionOptions = [...scope.divisionOptions];
  const branchOptions = scope.branches
    .filter((b) => !form.divisionId || b.divisionId === form.divisionId)
    .map((b) => ({ value: b.id, label: `${b.code ? b.code + ' - ' : ''}${b.name}` }));
  if (editing && !companyOptions.some((o) => o.value === baseline.companyId))
    companyOptions.push({
      value: baseline.companyId,
      label: typeof editing.company === 'object' ? editing.company.name : baseline.companyId,
    });
  if (editing && form.companyId === baseline.companyId) {
    if (baseline.divisionId && !divisionOptions.some((o) => o.value === baseline.divisionId))
      divisionOptions.push({
        value: baseline.divisionId,
        label: editing.division?.name || 'Current division',
      });
    if (
      form.divisionId === baseline.divisionId &&
      baseline.branchId &&
      !branchOptions.some((o) => o.value === baseline.branchId)
    )
      branchOptions.push({
        value: baseline.branchId,
        label: editing.branch?.name || 'Current branch',
      });
  }
  const permission = hasPermission('departments.view') && hasPermission('departments.manage');
  const blocked = !permission || orgLoading || !!orgError || !!draft.availabilityError;
  useEffect(() => {
    setNextCodePreview('');
    if (!form.companyId || editing || !permission) return;
    const controller = new AbortController();
    backendGet<{ departmentCode: string }>('/hr/departments/next-code', {
      query: { companyId: form.companyId },
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setNextCodePreview(result.departmentCode);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [form.companyId, editing, permission]);
  const closeEditor = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const f =
    (key: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current || blocked) return;
    pending.current = true;
    setError('');
    try {
      draft.validateReview();
      await draft.saveNow();
      if (!form.name.trim() || !form.companyId)
        throw new Error('Choose a company and enter a department name.');
      if (
        !(editing && form.companyId === baseline.companyId) &&
        !scope.companyOptions.some((o) => o.value === form.companyId)
      )
        throw new Error('Choose an available company.');
      if (
        form.divisionId &&
        !(
          editing &&
          form.companyId === baseline.companyId &&
          form.divisionId === baseline.divisionId
        ) &&
        !scope.divisionOptions.some((o) => o.value === form.divisionId)
      )
        throw new Error('Choose an available division for this company.');
      if (
        form.branchId &&
        !(
          editing &&
          form.companyId === baseline.companyId &&
          form.divisionId === baseline.divisionId &&
          form.branchId === baseline.branchId
        ) &&
        !scope.branches.some(
          (b) => b.id === form.branchId && (!form.divisionId || b.divisionId === form.divisionId),
        )
      )
        throw new Error('Choose an available branch for this company and division.');
      if (editing && !form.departmentCode.trim())
        throw new Error('Enter a department code. Codes are generated only for new departments.');
      const values: Record<string, unknown> = {
        name: form.name.trim(),
        companyId: form.companyId,
        status: form.status,
        divisionId: form.divisionId || (editing ? null : undefined),
        branchId: form.branchId || (editing ? null : undefined),
      };
      if (form.departmentCode.trim()) values.departmentCode = form.departmentCode.trim();
      const body = editing
        ? Object.fromEntries(
            Object.entries(values).filter(([key]) => Object.hasOwn(draft.form, key)),
          )
        : values;
            setSaving(true);
      if (editing) {
        if (Object.keys(body).length) await backendPut('/hr/departments/' + editing.id, body);
      } else await backendPost('/hr/departments', body);
      draft.markSaved();
      onSaved(editing ? 'Department updated.' : 'Department created.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save department.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      onClose={closeEditor}
      title={editing ? 'Edit department' : 'New department'}
      subtitle="Company, team identity and location."
      footer={
        <>
          <Btn variant="secondary" disabled={saving} onClick={closeEditor}>
            Cancel
          </Btn>
          {draft.canRetain && (
            <Btn type="button" variant="secondary" disabled={saving} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn type="submit" form={formId} loading={saving} disabled={blocked}>
            Save department
          </Btn>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} {...draft.guard.capture}>
        <DraftFormNotice draft={draft} />
        {!permission && (
          <p role="alert" className="workspace-notice">
            Your current role cannot save departments. Your draft can still be kept.
          </p>
        )}
        {editing && (
          <p className="workspace-notice">
            Current: {editing.name} ·{' '}
            {typeof editing.company === 'object'
              ? editing.company.name
              : editing.company || editing.companyId}{' '}
            · {editing.status.toLowerCase()}
          </p>
        )}
        {error && (
          <p role="alert" className="workspace-error mb-4">
            {error}
          </p>
        )}
        {orgError && (
          <div role="alert" className="workspace-error mb-4">
            {orgError}{' '}
            <Btn variant="secondary" onClick={retryOrg} type="button">
              Retry choices
            </Btn>
          </div>
        )}
        {orgLoading && (
          <p role="status" className="mb-4 text-sm">
            Loading company and location choices…
          </p>
        )}
        <fieldset disabled={saving || blocked} className="workspace-form-grid">
          <FormSelect
            label="Company"
            required
            value={form.companyId}
            options={companyOptions}
            placeholder="Select company"
            onChange={(e) =>
              setForm((current) => ({
                ...current,
                companyId: e.target.value,
                divisionId: '',
                branchId: '',
              }))
            }
          />
          <FormInput
            label="Department code"
            value={form.departmentCode}
            onChange={f('departmentCode')}
            placeholder={editing ? '' : nextCodePreview || 'Generated automatically'}
            hint={
              editing
                ? 'Unique within this company.'
                : 'Leave blank to generate a code when you save.'
            }
          />
          <FormInput label="Name" value={form.name} onChange={f('name')} required />
          <FormSelect
            label="Status"
            value={form.status}
            onChange={f('status')}
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
            ]}
          />
          <FormSelect
            label="Division"
            value={form.divisionId}
            options={divisionOptions}
            disabled={!form.companyId}
            placeholder="No specific division"
            onChange={(e) =>
              setForm((current) => ({ ...current, divisionId: e.target.value, branchId: '' }))
            }
          />
          <FormSelect
            label="Branch / Location"
            value={form.branchId}
            onChange={f('branchId')}
            options={branchOptions}
            disabled={!form.companyId}
            placeholder="No specific branch"
          />
        </fieldset>
      </form>
    </Modal>
  );
}
