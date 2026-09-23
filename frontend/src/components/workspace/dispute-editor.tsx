'use client';
import { useState } from 'react';
import { Btn, FormDateField, FormSelect, Modal } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { backendPatch, backendPost } from '@/lib/api-client';
import { useFormGuard } from './unsaved-work-provider';
import {
  disputeClosed,
  disputeEmployeeName,
  disputePath,
  disputeTypes,
  type DisputeEmployee,
  type DisputeRecord,
} from './dispute-types';
const toForm = (r?: DisputeRecord) => ({
  companyId: r?.companyId || '',
  employeeId: r?.employeeId || '',
  type: r?.type || 'GRIEVANCE',
  raisedAt: r?.raisedAt.slice(0, 10) || new Date().toISOString().slice(0, 10),
  summary: r?.summary || '',
  initialPosition: r?.initialPosition || '',
  notes: r?.notes || '',
});
export function DisputeEditor({
  record,
  onClose,
  onSaved,
}: {
  record?: DisputeRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { hasPermission } = useAuth();
  const [form, setForm] = useState(() => toForm(record)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const baseline = toForm(record),
    draft = useFormGuard(form, setForm);
  const companies = useWorkspaceChoices<{ id: string; name: string }>('/companies', {}, !record),
    employees = useWorkspaceChoices<DisputeEmployee>(
      '/hr/employees',
      { companyId: form.companyId },
      !record && !!form.companyId,
    );
  const blocked = [companies, employees].some((c) => c.loading || !!c.error),
    close = () => {
      if (!busy) draft.requestClose(onClose);
    };
  const setValue = (key: keyof typeof form) => (value: string) =>
    setForm((p) => ({ ...p, [key]: value }));
  const f =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setValue(key)(e.target.value);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || blocked || !hasPermission('employees.update') || (record && disputeClosed(record)))
      return;
    if (
      !record &&
      (!companies.rows.some((c) => c.id === form.companyId) ||
        !employees.rows.some((p) => p.id === form.employeeId))
    ) {
      setError('Choose a company and employee.');
      return;
    }
    if (!form.summary.trim() || !form.raisedAt) {
      setError('A raised date and summary are required.');
      return;
    }
    const values: Record<string, string | null> = {
      type: form.type,
      raisedAt: form.raisedAt,
      summary: form.summary.trim(),
    };
    if (!record) {
      values.companyId = form.companyId;
      values.employeeId = form.employeeId;
    }
    for (const key of ['initialPosition', 'notes'] as const)
      if (record || form[key].trim()) values[key] = form[key].trim() || null;
    const payload = record
      ? Object.fromEntries(
          Object.entries(values).filter(
            ([key]) => form[key as keyof typeof form] !== baseline[key as keyof typeof form],
          ),
        )
      : values;
    if (record && !Object.keys(payload).length) {
      draft.markSaved();
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (record) await backendPatch(disputePath + '/' + record.id, payload);
      else await backendPost(disputePath, payload);
      draft.markSaved();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this dispute.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      size="lg"
      title={record ? 'Edit dispute' : 'New dispute'}
      subtitle={
        record
          ? record.disputeNumber + ' · ' + disputeEmployeeName(record.employee)
          : 'Record the employee, issue and initial position.'
      }
      onClose={close}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Btn>
          <Btn
            variant="primary"
            type="submit"
            form="dispute-editor"
            disabled={blocked}
            loading={busy}
          >
            Save dispute
          </Btn>
        </>
      }
    >
      <form id="dispute-editor" onSubmit={submit} {...draft.capture} className="space-y-5">
        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
        {[companies, employees].map(
          (c, i) =>
            c.error && (
              <div role="alert" className="workspace-notice" key={i}>
                {c.error}
                <Btn variant="ghost" onClick={c.retry}>
                  Retry {i === 0 ? 'companies' : 'employees'}
                </Btn>
              </div>
            ),
        )}
        <section className="space-y-3">
          <h3 className="font-semibold">Employee and dispute</h3>
          {record ? (
            <p className="workspace-notice">
              {disputeEmployeeName(record.employee)} · {record.employee?.employeeCode} ·{' '}
              {record.company?.name}
            </p>
          ) : (
            <div className="workspace-form-grid">
              <FormSelect
                label="Company"
                required
                value={form.companyId}
                options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="Choose company"
                onChange={(e) =>
                  setForm((p) => ({ ...p, companyId: e.target.value, employeeId: '' }))
                }
              />
              <FormSelect
                label="Employee"
                required
                value={form.employeeId}
                disabled={!form.companyId || employees.loading}
                options={employees.rows.map((p) => ({
                  value: p.id,
                  label: disputeEmployeeName(p) + ' · ' + p.employeeCode,
                }))}
                placeholder={employees.loading ? 'Loading employees…' : 'Choose employee'}
                onChange={f('employeeId')}
              />
            </div>
          )}
          <div className="workspace-form-grid">
            <FormSelect
              label="Dispute type"
              value={form.type}
              options={disputeTypes}
              onChange={f('type')}
            />
            <FormDateField
              label="Raised on"
              required
              value={form.raisedAt}
              onChange={setValue('raisedAt')}
            />
          </div>
        </section>
        <section className="space-y-3">
          <h3 className="font-semibold">Issue and supporting notes</h3>
          {(['summary', 'initialPosition', 'notes'] as const).map((key) => (
            <label className="block text-sm space-y-2" key={key}>
              <span>
                {{ summary: 'Summary', initialPosition: 'Initial position', notes: 'Notes' }[key]}
                {key === 'summary' ? ' *' : ''}
              </span>
              <textarea
                className="workspace-textarea"
                rows={3}
                required={key === 'summary'}
                value={form[key]}
                onChange={f(key)}
              />
            </label>
          ))}
        </section>
      </form>
    </Modal>
  );
}
