'use client';
import { useId, useRef, useState } from 'react';
import { Btn, FormInput, FormSelect, Modal } from '@/components/ui';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useAuth } from '@/hooks/use-auth';
import { backendPost, backendPut } from '@/lib/api-client';
import {
  type Kind,
  type Company,
  type PayrollType,
  type FormState,
  toForm,
  label,
  booleanOptions,
} from './payroll-type-workflow';
export function TypeEditor({
  kind,
  record,
  source,
  onClose,
  onSaved,
}: {
  kind: Kind;
  record?: PayrollType;
  source?: WorkspaceDraft;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef(false),
    formId = useId();
  const baseline = toForm(record),
    stateKey = JSON.stringify([record?.updatedAt, baseline]);
  const draft = useWorkspaceDraftForm<Partial<FormState>>(() => (record ? {} : baseline), {
    appId: 'payroll',
    title: (record ? 'Edit ' : 'New ') + kind + ' type',
    describe: (values) => values.name || record?.name || label(kind) + ' category',
    context: { kind: kind + '-type', recordId: record?.id || '', stateKey },
    draftId: source?.id,
    busy,
    onClose,
    needsReview:
      !!source && !!record && (!record.updatedAt || source.context.stateKey !== stateKey),
    reviewKey: stateKey,
  });
  const form: FormState = { ...baseline, ...draft.form };
  const setForm = (change: (previous: FormState) => FormState) => {
    const next = change(form);
    draft.setForm(
      record
        ? Object.fromEntries(
            Object.entries(next).filter(
              ([key, value]) => value !== baseline[key as keyof FormState],
            ),
          )
        : next,
    );
  };
  const permission = hasPermission(kind + 's.view') && hasPermission(kind + 's.manage');
  const companies = useWorkspaceChoices<Company>('/companies', {}, permission);
  const companyOptions = companies.rows.map((c) => ({ value: c.id, label: c.name }));
  if (record && !companyOptions.some((o) => o.value === record.companyId))
    companyOptions.push({
      value: record.companyId,
      label: record.company?.name || record.companyId,
    });
  const blocked =
    !permission || companies.loading || !!companies.error || !!draft.availabilityError;
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const f =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((p) => ({ ...p, [key]: e.target.value }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending.current || blocked) return;
      pending.current = true;
    try {
      draft.validateReview();
      await draft.saveNow();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review this draft.');
      pending.current = false;
      return;
    }
    if (
      !(record?.companyId === form.companyId || companies.rows.some((c) => c.id === form.companyId))
    ) {
      setError('Choose an available company.');
      pending.current = false;
      return;
    }

    if (!form.name.trim() || !form.code.trim() || !form.companyId) {
      setError('Company, name and code are required.');
      pending.current = false;
      return;
    }
    if (
      [form.defaultAmount, ...(kind === 'deduction' ? [form.defaultPercentage] : [])].some(
        (v) => v !== '' && !Number.isFinite(Number(v)),
      )
    ) {
      setError('Enter valid numeric defaults or leave them blank.');
      pending.current = false;
      return;
    }
    const values: Record<string, string | number | boolean | null> = {
      companyId: form.companyId,
      name: form.name.trim(),
      code: form.code.trim(),
      isActive: form.isActive === 'true',
      recurring: form.recurring === 'true',
      [kind === 'allowance' ? 'taxable' : 'statutory']:
        form[kind === 'allowance' ? 'taxable' : 'statutory'] === 'true',
    };
    const numericKeys: ('defaultAmount' | 'defaultPercentage')[] =
      kind === 'deduction' ? ['defaultAmount', 'defaultPercentage'] : ['defaultAmount'];
    for (const key of numericKeys) {
      const value = form[key];
      if (record || value !== '') values[key] = value === '' ? null : Number(value);
    }
    // Do not overwrite unrelated or concurrently changed fields during an edit.
    const payload = record
      ? Object.fromEntries(
          Object.entries(values).filter(
            ([key]) => form[key as keyof typeof form] !== baseline[key as keyof typeof baseline],
          ),
        )
      : values;
    if (record && Object.keys(payload).length === 0) {
      draft.markSaved();
      onClose();
      pending.current = false;
      return;
    }
        setBusy(true);
    setError('');
    try {
      const path = '/hr/' + kind + '-types';
      if (record) await backendPut(path + '/' + record.id, payload);
      else await backendPost(path, payload);
      draft.markSaved();
      onSaved(label(kind) + ' type saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this type.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={(record ? 'Edit ' : 'New ') + kind + ' type'}
      subtitle={
        record ? record.name + ' · ' + record.code : 'Set up a category and its payroll defaults.'
      }
      onClose={close}
      size="lg"
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Btn>
          {draft.canRetain && (
            <Btn type="button" variant="secondary" disabled={busy} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn variant="primary" type="submit" form={formId} loading={busy} disabled={blocked}>
            Save type
          </Btn>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-5" {...draft.guard.capture}>
        <DraftFormNotice draft={draft} />
        {!permission && (
          <p role="alert" className="workspace-notice">
            Your current role cannot save this payroll type. Your draft can still be kept.
          </p>
        )}
        {record && (
          <p className="workspace-notice">
            Current: {record.name} · {record.company?.name || record.companyId} ·{' '}
            {record.isActive ? 'Active' : 'Inactive'}
          </p>
        )}
        {companies.loading && <p role="status">Loading companies…</p>}
        {companies.error && (
          <div role="alert" className="workspace-notice">
            {companies.error}{' '}
            <Btn variant="ghost" onClick={companies.retry}>
              Retry companies
            </Btn>
          </div>
        )}
        <fieldset disabled={busy || blocked} className="space-y-5">
          <h3 className="font-semibold">Identity</h3>
          <FormSelect
            label="Company"
            required
            value={form.companyId}
            onChange={f('companyId')}
            placeholder="Select company"
            options={companyOptions}
            disabled={companies.loading}
          />
          <div className="workspace-form-grid">
            <FormInput label="Name" value={form.name} onChange={f('name')} required />
            <FormInput label="Code" value={form.code} onChange={f('code')} required />
          </div>
          <h3 className="font-semibold">Payroll defaults</h3>
          <div className="workspace-form-grid">
            <FormInput
              label="Default amount (TZS)"
              type="number"
              step="0.01"
              value={form.defaultAmount}
              onChange={f('defaultAmount')}
            />
            {kind === 'deduction' && (
              <FormInput
                label="Default percentage (%)"
                type="number"
                step="0.01"
                value={form.defaultPercentage}
                onChange={f('defaultPercentage')}
              />
            )}
          </div>
          <p className="workspace-notice">
            Defaults are optional. Clearing a saved default removes it. These settings do not create
            an employee allocation or recalculate a payroll run.
          </p>
          <div className="workspace-form-grid">
            {kind === 'allowance' ? (
              <FormSelect
                label="Taxable"
                value={form.taxable}
                onChange={f('taxable')}
                options={booleanOptions}
              />
            ) : (
              <FormSelect
                label="Statutory"
                value={form.statutory}
                onChange={f('statutory')}
                options={booleanOptions}
              />
            )}
            <FormSelect
              label="Recurring"
              value={form.recurring}
              onChange={f('recurring')}
              options={booleanOptions}
            />
            <FormSelect
              label="Active"
              value={form.isActive}
              onChange={f('isActive')}
              options={booleanOptions}
            />
          </div>
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
