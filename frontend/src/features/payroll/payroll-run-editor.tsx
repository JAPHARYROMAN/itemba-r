'use client';
import { useId, useRef, useState } from 'react';
import { Btn, FormSelect, Modal } from '@/components/ui';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { PayrollPeriodChoice, payrollLabel } from '@/components/workspace/payroll-types';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { backendPost } from '@/lib/api-client';
const types = ['REGULAR', 'BONUS', 'ADVANCE', 'FINAL_SETTLEMENT', 'ADJUSTMENT'];
export function PayrollRunEditor({
  companyId = '',
  periodId = '',
  source,
  onClose,
  onSaved,
}: {
  companyId?: string;
  periodId?: string;
  source?: WorkspaceDraft;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { user, hasPermission } = useAuth();
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const pending = useRef(false),
    formId = useId();
  const canCreate = hasPermission('payroll.view') && hasPermission('payroll.manage');
  const draft = useWorkspaceDraftForm(
    { periodId, runType: 'REGULAR' },
    {
      appId: 'payroll',
      title: 'New payroll run',
      describe: (values) => payrollLabel(values.runType) + ' payroll',
      context: { kind: 'payroll-run', companyId },
      draftId: source?.id,
      busy: saving,
      onClose,
    },
  );
  const { form, setForm } = draft;
  const periods = useWorkspaceChoices<PayrollPeriodChoice>(
    '/hr/payroll-periods',
    { companyId },
    canCreate,
  );
  const periodOptions = periods.rows.map((p) => ({
    value: p.id,
    label: [p.payrollPeriodCode, p.name, p.company?.name].filter(Boolean).join(' · '),
  }));
  const blocked = !canCreate || periods.loading || !!periods.error || !!draft.availabilityError;
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const create = async (e: React.FormEvent) => {
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
    const choice = periods.rows.find((p) => p.id === form.periodId);
    if (!choice?.companyId || !user?.id) {
      setError('Choose an available payroll period before creating the run.');
      pending.current = false;
      return;
    }
        setSaving(true);
    setError('');
    try {
      await backendPost('/hr/payroll-runs', {
        payrollPeriodId: choice.id,
        companyId: choice.companyId,
        payrollType: form.runType,
        createdById: user.id,
      });
      draft.markSaved();
      onSaved('Payroll run created. Calculate it to prepare employee entries.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create the payroll run.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      onClose={close}
      title="New payroll run"
      subtitle="Choose a pay cycle and the kind of payroll to prepare."
      size="lg"
      footer={
        <>
          <Btn variant="secondary" onClick={close} disabled={saving}>
            Cancel
          </Btn>
          {draft.canRetain && (
            <Btn type="button" variant="secondary" disabled={saving} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn type="submit" form={formId} loading={saving} disabled={blocked}>
            Create run
          </Btn>
        </>
      }
    >
      <form id={formId} onSubmit={create} {...draft.guard.capture} className="space-y-5">
        <DraftFormNotice draft={draft} />
        {error && (
          <div role="alert" className="workspace-notice">
            {error}
          </div>
        )}
        {periods.error && (
          <div role="alert" className="workspace-notice">
            {periods.error}{' '}
            <Btn type="button" variant="ghost" onClick={periods.retry}>
              Retry choices
            </Btn>
          </div>
        )}
        {periods.loading && <p role="status">Loading payroll periods…</p>}
        <fieldset disabled={saving || blocked} className="space-y-5">
          <h3 className="text-base font-semibold">Pay cycle</h3>
          <FormSelect
            label="Payroll period"
            required
            value={form.periodId}
            onChange={(e) => setForm((p) => ({ ...p, periodId: e.target.value }))}
            options={periodOptions}
            placeholder="Select a payroll period"
          />
          {form.periodId && (
            <p className="text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
              Company:{' '}
              {periods.rows.find((p) => p.id === form.periodId)?.company?.name || 'Not available'}
            </p>
          )}
          <FormSelect
            label="Run type"
            value={form.runType}
            onChange={(e) => setForm((p) => ({ ...p, runType: e.target.value }))}
            options={types.map((value) => ({ value, label: payrollLabel(value) }))}
          />
          <p className="workspace-notice">
            The selected period determines the company. A new run starts as a draft; calculate and
            review its entries before submitting.
          </p>
        </fieldset>
      </form>
    </Modal>
  );
}
