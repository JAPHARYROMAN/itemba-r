'use client';
import { useId, useRef, useState } from 'react';
import { Btn, FormDateField, FormSelect, Modal } from '@/components/ui';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useAuth } from '@/hooks/use-auth';
import { backendPost, backendPut } from '@/lib/api-client';
import {
  type Attendance,
  type FormState,
  empty,
  formFor,
  statuses,
  label,
  employeeName,
  companyName,
  timestamp,
  date,
} from './attendance-workflow';

export function AttendanceEditor({
  record: editing,
  source,
  onClose,
  onSaved,
}: {
  record?: Attendance;
  source?: WorkspaceDraft;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { user, hasPermission } = useAuth();
  const formId = useId();
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const canEdit = hasPermission('attendance.update');
  const canCreate = hasPermission('attendance.create');
  const baseline = editing ? formFor(editing) : empty;
  const draft = useWorkspaceDraftForm<Partial<FormState>>(() => (editing ? {} : { ...empty }), {
    appId: 'payroll',
    title: editing ? 'Edit attendance' : 'Log attendance',
    describe: (values) =>
      editing ? employeeName(editing) : values.notes || values.date || 'Attendance',
    context: {
      kind: 'attendance',
      recordId: editing?.id || '',
      version: editing?.updatedAt || '',
      approval: editing?.approvedById || '',
    },
    draftId: source?.id,
    busy: saving,
    onClose,
    needsReview:
      !!source &&
      !!editing &&
      (!editing.updatedAt ||
        source.context.version !== editing.updatedAt ||
        source.context.approval !== (editing.approvedById || '')),
    reviewKey: `${editing?.id}:${editing?.updatedAt}:${editing?.approvedById}`,
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
  const scope = useOrgScope(form.companyId, { skipBranches: true, skipDivisions: true });
  const allowed = hasPermission('attendance.view') && (editing ? canEdit : canCreate);
  const blocked = !allowed || scope.loading || !!scope.error || !!draft.availabilityError;
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const setValue = (key: keyof FormState) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const f =
    (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setValue(key)(e.target.value);
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
        scope.companyOptions.some((o) => o.value === form.companyId)
      ) ||
      !(
        (editing?.companyId === form.companyId && editing.employeeId === form.employeeId) ||
        scope.employeeOptions.some((o) => o.value === form.employeeId)
      )
    ) {
      setError('Choose an available company and employee.');
      pending.current = false;
      return;
    }
    if (['PRESENT', 'LATE', 'HALF_DAY'].includes(form.status) && !form.clockIn) {
      setError('This attendance status requires a clock-in time.');
      pending.current = false;
      return;
    }
    if (form.clockOut && (!form.clockIn || new Date(form.clockOut) <= new Date(form.clockIn))) {
      setError(
        'Clock-out must be after clock-in. For an overnight shift, select the following date.',
      );
      pending.current = false;
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {};
      if (editing) {
        const baseline = formFor(editing);
        if (form.companyId !== baseline.companyId) payload.companyId = form.companyId;
        if (form.employeeId !== baseline.employeeId) payload.employeeId = form.employeeId;
        if (form.date !== baseline.date) payload.attendanceDate = form.date;
        if (form.status !== baseline.status) payload.attendanceStatus = form.status;
        if (form.notes !== baseline.notes) payload.notes = form.notes.trim();
        if (form.clockIn !== baseline.clockIn)
          payload.clockInTime = form.clockIn ? new Date(form.clockIn).toISOString() : null;
        if (form.clockOut !== baseline.clockOut)
          payload.clockOutTime = form.clockOut ? new Date(form.clockOut).toISOString() : null;
        if (Object.keys(payload).length) await backendPut('/hr/attendance/' + editing.id, payload);
      } else {
        await backendPost('/hr/attendance', {
          companyId: form.companyId,
          employeeId: form.employeeId,
          attendanceDate: form.date,
          attendanceStatus: form.status,
          clockInTime: form.clockIn ? new Date(form.clockIn).toISOString() : undefined,
          clockOutTime: form.clockOut ? new Date(form.clockOut).toISOString() : undefined,
          notes: form.notes.trim() || undefined,
          createdById: user?.id,
        });
      }
      draft.markSaved();
      onSaved('Attendance saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save attendance.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      onClose={close}
      title={editing ? 'Edit attendance' : 'Log attendance'}
      subtitle="Record the day and the actual arrival and departure times."
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
            Save attendance
          </Btn>
        </>
      }
    >
      <form id={formId} onSubmit={submit} {...draft.guard.capture} className="space-y-5">
        <DraftFormNotice draft={draft}>
          {editing && (
            <div className="space-y-2">
              <p>
                Current attendance: {employeeName(editing)} · {companyName(editing)} ·{' '}
                {date(editing.attendanceDate)}
              </p>
              <p>
                {label(editing.attendanceStatus || 'UNKNOWN')} ·{' '}
                {editing.approvedById ? 'Approved' : 'Awaiting approval'}
              </p>
              <p>
                Current clock-in: {timestamp(editing.clockInTime)} · Clock-out:{' '}
                {timestamp(editing.clockOutTime)}
              </p>
              <p className="whitespace-pre-wrap break-words">
                Current notes: {editing.notes || 'No notes'}
              </p>
            </div>
          )}
        </DraftFormNotice>
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
        {scope.loading && <p role="status">Loading organisation choices…</p>}
        <fieldset disabled={saving || blocked} className="space-y-5">
          <h3 className="text-base font-semibold">Person and day</h3>
          <div className="workspace-form-grid">
            <FormSelect
              label="Company"
              required
              value={form.companyId}
              onChange={(e) =>
                setForm((p) => ({ ...p, companyId: e.target.value, employeeId: '' }))
              }
              options={
                editing?.companyId === form.companyId &&
                !scope.companyOptions.some((o) => o.value === form.companyId)
                  ? [
                      { value: form.companyId, label: companyName(editing) },
                      ...scope.companyOptions,
                    ]
                  : scope.companyOptions
              }
              placeholder="Select company"
            />
            <FormSelect
              label="Employee"
              required
              disabled={!form.companyId || Boolean(scope.error)}
              value={form.employeeId}
              onChange={f('employeeId')}
              options={
                editing?.employeeId === form.employeeId &&
                editing.companyId === form.companyId &&
                !scope.employeeOptions.some((o) => o.value === form.employeeId)
                  ? [
                      { value: form.employeeId, label: employeeName(editing) },
                      ...scope.employeeOptions,
                    ]
                  : scope.employeeOptions
              }
              placeholder={form.companyId ? 'Select employee' : 'Select company first'}
            />
          </div>
          <div className="workspace-form-grid">
            <FormDateField
              label="Attendance date"
              required
              value={form.date}
              onChange={setValue('date')}
            />
            <FormSelect
              label="Attendance status"
              value={form.status}
              onChange={f('status')}
              options={statuses.map((value) => ({ value, label: label(value) }))}
            />
          </div>
          <h3 className="text-base font-semibold">Arrival and departure</h3>
          <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
            Use your local time. For overnight work, set clock-out to the following day. Hours are
            calculated automatically.
          </p>
          <div className="workspace-form-grid">
            <FormDateField
              label="Clock-in"
              granularity="minute"
              value={form.clockIn}
              onChange={setValue('clockIn')}
            />
            <FormDateField
              label="Clock-out"
              granularity="minute"
              value={form.clockOut}
              onChange={setValue('clockOut')}
            />
          </div>
          <label className="block text-sm">
            Notes
            <textarea
              rows={3}
              className="workspace-textarea"
              value={form.notes}
              onChange={f('notes')}
            />
          </label>
        </fieldset>
      </form>
    </Modal>
  );
}
