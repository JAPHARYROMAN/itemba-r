'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Btn, FormInput, FormSelect, Modal } from '@/components/ui';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useAuth } from '@/hooks/use-auth';
import { backendGet, backendPost, backendPut } from '@/lib/api-client';
import {
  type Position,
  type Department,
  type FormState,
  empty,
  toForm,
  POSITION_TYPE_OPTIONS,
  hierarchyLabel,
} from './position-workflow';
export function PositionEditor({
  record: editing,
  companyId = '',
  source,
  onClose,
  onSaved,
}: {
  record?: Position;
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
    title: editing ? 'Edit position' : 'New position',
    describe: (values) => values.title || editing?.title || 'Role definition',
    context: { kind: 'position', recordId: editing?.id || '', stateKey },
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
  const permission = hasPermission('positions.view') && hasPermission('positions.manage');
  const canChooseDepartments = hasPermission('departments.view');
  const scope = useOrgScope(form.companyId, { skipEmployees: true });
  const { loading: orgLoading, error: orgError, retry: retryOrg, divisionOptions } = scope;
  const companyOptions = [...scope.companyOptions];
  if (editing && !companyOptions.some((o) => o.value === baseline.companyId))
    companyOptions.push({
      value: baseline.companyId,
      label: editing.company?.name || baseline.companyId,
    });
  const departmentsQuery = useWorkspaceChoices<Department>(
    '/hr/departments',
    { companyId: form.companyId, status: 'ACTIVE' },
    permission && canChooseDepartments && !!form.companyId,
  );
  const departments = departmentsQuery.rows,
    departmentsLoading = departmentsQuery.loading,
    choicesError = departmentsQuery.error;
  const branchOptions = scope.branches
    .filter((b) => !form.divisionId || b.divisionId === form.divisionId)
    .map((b) => ({ value: b.id, label: `${b.code ? b.code + ' - ' : ''}${b.name}` }));
  const availableDepartments = departments
    .filter((d) => !form.divisionId || (d.division?.id ?? d.divisionId) === form.divisionId)
    .filter((d) => !form.branchId || (d.branch?.id ?? d.branchId) === form.branchId);
  const departmentOptions = availableDepartments.map((d) => ({
    value: d.id,
    label: `${d.departmentCode ? d.departmentCode + ' - ' : ''}${d.name}${hierarchyLabel(d) !== '-' ? ` (${hierarchyLabel(d)})` : ''}`,
  }));
  if (
    editing &&
    form.companyId === baseline.companyId &&
    form.divisionId === baseline.divisionId &&
    form.branchId === baseline.branchId &&
    baseline.departmentId &&
    !departmentOptions.some((o) => o.value === baseline.departmentId)
  )
    departmentOptions.push({
      value: baseline.departmentId,
      label: (editing.department?.name || 'Current department') + ' (current)',
    });
  const blocked =
    !permission ||
    (!editing && !canChooseDepartments) ||
    orgLoading ||
    departmentsLoading ||
    !!orgError ||
    !!choicesError ||
    !!draft.availabilityError;
  useEffect(() => {
    setNextCodePreview('');
    if (!form.companyId || editing || !permission) return;
    const controller = new AbortController();
    backendGet<{ positionCode: string }>('/hr/positions/next-code', {
      query: { companyId: form.companyId },
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setNextCodePreview(result.positionCode);
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
  const handleDepartmentChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const departmentId = event.target.value,
      department = departments.find((d) => d.id === departmentId);
    setForm((p) => ({
      ...p,
      departmentId,
      divisionId: department?.division?.id ?? department?.divisionId ?? p.divisionId,
      branchId: department?.branch?.id ?? department?.branchId ?? '',
    }));
  };
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current || blocked) return;
    pending.current = true;
    setError('');
    try {
      draft.validateReview();
      await draft.saveNow();
      if (!form.companyId || !form.departmentId || !form.title.trim())
        throw new Error('Company, department and title are required.');
      if (
        !(editing && form.companyId === baseline.companyId) &&
        !scope.companyOptions.some((o) => o.value === form.companyId)
      )
        throw new Error('Choose an available company.');
      if (
        canChooseDepartments
          ? !availableDepartments.some((d) => d.id === form.departmentId)
          : !editing ||
            form.companyId !== baseline.companyId ||
            form.departmentId !== baseline.departmentId
      )
        throw new Error('Choose an available active department for this company and location.');
      if (
        form.defaultSalary &&
        (!Number.isFinite(Number(form.defaultSalary)) || Number(form.defaultSalary) < 0)
      )
        throw new Error('Enter a valid non-negative salary.');
      if (editing && !form.positionCode.trim())
        throw new Error('Enter a position code. Codes are generated only for new positions.');
      const values: Record<string, unknown> = {
        title: form.title.trim(),
        companyId: form.companyId,
        departmentId: form.departmentId,
        positionType: form.positionType,
        status: form.status,
        currency: form.currency.trim().toUpperCase(),
        defaultSalary: form.defaultSalary ? Number(form.defaultSalary) : editing ? null : undefined,
      };
      if (form.positionCode.trim()) values.positionCode = form.positionCode.trim();
      const body = editing
        ? Object.fromEntries(
            Object.entries(values).filter(([key]) => Object.hasOwn(draft.form, key)),
          )
        : values;
            setSaving(true);
      if (editing) {
        if (Object.keys(body).length) await backendPut('/hr/positions/' + editing.id, body);
      } else await backendPost('/hr/positions', body);
      draft.markSaved();
      onSaved(editing ? 'Position updated.' : 'Position created.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      onClose={closeEditor}
      title={editing ? 'Edit position' : 'New position'}
      subtitle="Define the role and its place in the organisation."
      size="lg"
      footer={
        <>
          <Btn variant="secondary" type="button" disabled={saving} onClick={closeEditor}>
            Cancel
          </Btn>
          {draft.canRetain && (
            <Btn type="button" variant="secondary" disabled={saving} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn variant="primary" type="submit" form={formId} loading={saving} disabled={blocked}>
            Save position
          </Btn>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} {...draft.guard.capture}>
        <DraftFormNotice draft={draft} />
        {!permission && (
          <p role="alert" className="workspace-notice">
            Your current role cannot save positions. Your draft can still be kept.
          </p>
        )}
        {!canChooseDepartments && (
          <p role="note" className="workspace-notice">
            Department viewing permission is required to choose a department.{' '}
            {editing
              ? 'The existing department can stay unchanged.'
              : 'A department is required to create this position.'}
          </p>
        )}
        {editing && (
          <p className="workspace-notice">
            Current: {editing.title} · {editing.company?.name || editing.companyId} ·{' '}
            {editing.department?.name || 'Department unavailable'} ·{' '}
            {hierarchyLabel(editing.department)} · {editing.status.toLowerCase()}
          </p>
        )}
        {error && (
          <p role="alert" className="workspace-error mb-4">
            {error}
          </p>
        )}
        {(orgError || choicesError) && (
          <div role="alert" className="workspace-error mb-4">
            {orgError || choicesError}
            <Btn
              type="button"
              variant="secondary"
              onClick={() => {
                retryOrg();
                departmentsQuery.retry();
              }}
            >
              Retry choices
            </Btn>
          </div>
        )}
        {(orgLoading || departmentsLoading) && (
          <p role="status" className="mb-4">
            Loading organisation choices…
          </p>
        )}
        <fieldset disabled={saving || blocked} className="workspace-form-grid">
          <FormSelect
            label="Company"
            disabled={!canChooseDepartments}
            required
            value={form.companyId}
            onChange={(e) =>
              setForm((p) => ({
                ...p,
                companyId: e.target.value,
                divisionId: '',
                branchId: '',
                departmentId: '',
              }))
            }
            options={companyOptions}
            placeholder="Select company"
          />
          <FormSelect
            label="Division"
            disabled={!canChooseDepartments}
            value={form.divisionId}
            onChange={(e) =>
              setForm((p) => ({
                ...p,
                divisionId: e.target.value,
                branchId: '',
                departmentId: '',
              }))
            }
            options={divisionOptions}
            placeholder={form.companyId ? 'Select division' : 'Select company first'}
          />
          <FormSelect
            label="Branch / Location"
            disabled={!canChooseDepartments}
            value={form.branchId}
            onChange={(e) => setForm((p) => ({ ...p, branchId: e.target.value, departmentId: '' }))}
            options={branchOptions}
            placeholder={
              form.divisionId
                ? 'Select branch/location if position is branch-specific'
                : 'Select division first'
            }
          />
          <FormSelect
            label="Department"
            disabled={!canChooseDepartments}
            required
            value={form.departmentId}
            onChange={handleDepartmentChange}
            options={departmentOptions}
            placeholder={
              departmentsLoading
                ? 'Loading departments...'
                : form.companyId
                  ? 'Select department'
                  : 'Select company first'
            }
          />
          <FormInput
            label="Position Code"
            value={form.positionCode}
            onChange={f('positionCode')}
            placeholder={
              editing
                ? ''
                : nextCodePreview
                  ? `Auto: ${nextCodePreview}`
                  : 'Auto-generated when blank'
            }
            hint={
              editing
                ? ''
                : nextCodePreview && !form.positionCode
                  ? `Suggested code: ${nextCodePreview}. Assigned when saved.`
                  : 'Leave blank to auto-generate'
            }
          />
          <FormInput label="Title" value={form.title} onChange={f('title')} required />
          <FormSelect
            label="Role Type"
            value={form.positionType}
            onChange={f('positionType')}
            options={POSITION_TYPE_OPTIONS}
          />
          <FormInput
            label="Default salary"
            type="number"
            min="0"
            step="0.01"
            value={form.defaultSalary}
            onChange={f('defaultSalary')}
          />
          <FormInput
            label="Currency"
            value={form.currency}
            onChange={f('currency')}
            required
            maxLength={3}
            pattern="[A-Za-z]{3}"
          />
          <FormSelect
            label="Status"
            value={form.status}
            onChange={f('status')}
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
            ]}
          />
        </fieldset>
      </form>
    </Modal>
  );
}
