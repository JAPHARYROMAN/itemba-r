'use client';
import { useId, useRef, useState } from 'react';
import { Btn, FormInput, FormSelect, Modal } from '@/components/ui';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useAuth } from '@/hooks/use-auth';
import { backendPost, backendPut } from '@/lib/api-client';
import {
  type LeaveType,
  type FormState,
  empty,
  booleanOptions,
  toForm,
} from './leave-type-workflow';
export function LeaveTypeEditor({
  record: editing,
  source,
  onClose,
  onSaved,
}: {
  record?: LeaveType;
  source?: WorkspaceDraft;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const formId = useId(),
    pending = useRef(false);
  const baseline = editing ? toForm(editing) : empty;
  const stateKey = JSON.stringify([editing?.updatedAt, baseline]);
  const draft = useWorkspaceDraftForm<Partial<FormState>>(() => (editing ? {} : { ...empty }), {
    appId: 'payroll',
    title: editing ? 'Edit leave type' : 'New leave type',
    describe: (values) => values.name || editing?.name || 'Leave category',
    context: { kind: 'leave-type', recordId: editing?.id || '', stateKey },
    draftId: source?.id,
    busy: saving,
    onClose,
    needsReview:
      !!source && !!editing && (!editing.updatedAt || source.context.stateKey !== stateKey),
    reviewKey: stateKey,
  });
  const form: FormState = { ...baseline, ...draft.form };
  const setForm = (change: (previous: FormState) => FormState) => {
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
  const scope = useOrgScope(undefined, {
    skipBranches: true,
    skipDivisions: true,
    skipEmployees: true,
  });
  const permission = hasPermission('leave_types.view') && hasPermission('leave_types.manage');
  const blocked = !permission || scope.loading || !!scope.error || !!draft.availabilityError;
  const companyOptions = [...scope.companyOptions];
  if (editing && !companyOptions.some((option) => option.value === editing.companyId))
    companyOptions.push({
      value: editing.companyId,
      label: editing.company?.name || editing.companyId,
    });
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const f =
    (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
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
      !(
        editing?.companyId === form.companyId ||
        scope.companyOptions.some((option) => option.value === form.companyId)
      )
    ) {
      setError('Choose an available company.');
      pending.current = false;
      return;
    }
    if (!form.name.trim() || !form.code.trim()) {
      setError('Name and code are required.');
      pending.current = false;
      return;
    }
    if (
      form.annualDays &&
      (!Number.isFinite(Number(form.annualDays)) || Number(form.annualDays) < 0)
    ) {
      setError('Annual allowance must be zero or more.');
      pending.current = false;
      return;
    }
        setSaving(true);
    setError('');
    try {
      const values = {
        companyId: form.companyId,
        name: form.name.trim(),
        code: form.code.trim(),
        paid: form.paid === 'true',
        carryForwardAllowed: form.carryForward === 'true',
        isActive: form.active === 'true',
        annualAllowanceDays:
          form.annualDays === '' ? (editing ? null : undefined) : Number(form.annualDays),
      };
      if (editing) {
        const changes: Record<string, unknown> = {};
        const mapping = {
          companyId: 'companyId',
          name: 'name',
          code: 'code',
          paid: 'paid',
          carryForward: 'carryForwardAllowed',
          active: 'isActive',
          annualDays: 'annualAllowanceDays',
        } as const;
        for (const [field, target] of Object.entries(mapping)) {
          if (Object.hasOwn(draft.form, field)) changes[target] = values[target];
        }
        if (Object.keys(changes).length) await backendPut('/hr/leave-types/' + editing.id, changes);
      } else await backendPost('/hr/leave-types', values);
      draft.markSaved();
      onSaved('Leave type saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save leave type.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      onClose={close}
      title={editing ? 'Edit leave type' : 'New leave type'}
      subtitle="Set the name, allowance and availability for this company."
      size="lg"
      footer={
        <>
          <Btn variant="secondary" disabled={saving} onClick={close}>
            Cancel
          </Btn>
          {draft.canRetain && (
            <Btn type="button" variant="secondary" disabled={saving} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn type="submit" form={formId} loading={saving} disabled={blocked}>
            Save leave type
          </Btn>
        </>
      }
    >
      <form id={formId} onSubmit={submit} {...draft.guard.capture} className="space-y-5">
        <DraftFormNotice draft={draft} />
        {!permission && (
          <p role="alert" className="workspace-notice">
            Your current role cannot save leave types. Your draft can still be kept.
          </p>
        )}
        {editing && (
          <div className="workspace-notice">
            Current: {editing.name} · {editing.company?.name || editing.companyId} ·{' '}
            {editing.isActive ? 'Active' : 'Inactive'} ·{' '}
            {editing.annualAllowanceDays ?? 'No annual allowance'} days
          </div>
        )}
        {error && (
          <div role="alert" className="workspace-notice">
            {error}
          </div>
        )}
        {scope.error && (
          <div role="alert" className="workspace-notice">
            {scope.error}{' '}
            <Btn type="button" variant="ghost" onClick={scope.retry}>
              Retry choices
            </Btn>
          </div>
        )}
        {scope.loading && <p role="status">Loading companies…</p>}
        <fieldset disabled={saving || blocked} className="space-y-5">
          <h3 className="text-base font-semibold">Identity</h3>
          <FormSelect
            label="Company"
            required
            value={form.companyId}
            onChange={f('companyId')}
            options={companyOptions}
            placeholder="Select company"
          />
          <div className="workspace-form-grid">
            <FormInput label="Name" required value={form.name} onChange={f('name')} />
            <FormInput label="Code" required value={form.code} onChange={f('code')} />
          </div>
          <h3 className="text-base font-semibold">Allowance and availability</h3>
          <div className="workspace-form-grid">
            <FormInput
              label="Annual allowance days"
              type="number"
              min={0}
              step="0.01"
              value={form.annualDays}
              onChange={f('annualDays')}
              hint="Leave blank when no annual allowance is set."
            />
            <FormSelect
              label="Paid leave"
              value={form.paid}
              onChange={f('paid')}
              options={booleanOptions}
            />
            <FormSelect
              label="Allow carry forward"
              value={form.carryForward}
              onChange={f('carryForward')}
              options={booleanOptions}
            />
            <FormSelect
              label="Active"
              value={form.active}
              onChange={f('active')}
              options={booleanOptions}
            />
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
