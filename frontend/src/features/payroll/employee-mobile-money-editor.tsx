'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Btn, FormInput, FormSelect, Modal } from '@/components/ui';
import {
  DraftFormNotice,
  useWorkspaceDraftForm,
  type WorkspaceDraft,
} from '@/components/workspace/workspace-drafts';
import { useAuth } from '@/hooks/use-auth';
import { useRequestGuard } from '@/hooks/use-request-guard';
import { backendGet, backendPatch, backendPost } from '@/lib/api-client';
import type { Employee } from './employee-types';
import {
  PROVIDER_LABELS,
  mobileMoneyValues,
  mobileMoneyVersion,
  type MobileMoney,
  type MobileMoneyValues,
} from './mobile-money-types';
import '@/components/workspace/workspace.css';

export function EmployeeMobileMoneyEditor({
  employee,
  record,
  accounts: initialAccounts,
  source,
  onClose,
  onSaved,
}: {
  employee: Employee;
  record?: MobileMoney;
  accounts?: MobileMoney[];
  source?: WorkspaceDraft;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const allowed = hasPermission('employees.view') && hasPermission('employees.update');
  const [accounts, setAccounts] = useState(initialAccounts ?? []);
  const [loading, setLoading] = useState(!initialAccounts),
    [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const beginRequest = useRequestGuard();
  const pending = useRef(false),
    formId = useId();
  const employeeId = employee.id;
  const load = useCallback(async () => {
    const request = beginRequest();
    if (!allowed) return;
    setLoading(true);
    setLoadError('');
    try {
      const rows = await backendGet<MobileMoney[]>('/hr/mobile-money-accounts', {
        query: { employeeId },
        signal: request.signal,
      });
      if (request.current()) setAccounts(rows);
    } catch (cause) {
      if (request.current())
        setLoadError(cause instanceof Error ? cause.message : 'Unable to load current accounts.');
    } finally {
      if (request.current()) setLoading(false);
    }
  }, [beginRequest, employeeId, allowed]);
  useEffect(() => {
    if (!initialAccounts) void load();
  }, [initialAccounts, load]);
  const current = record ? accounts.find((row) => row.id === record.id) : undefined;
  const missing = !!record && !loading && !loadError && !current;
  const baseline = mobileMoneyValues(current || record);
  const accountsVersion = mobileMoneyVersion(accounts);
  const title = record ? 'Edit mobile money account' : 'Add mobile money account';
  const draft = useWorkspaceDraftForm<Partial<MobileMoneyValues>>(
    () => (record ? {} : mobileMoneyValues()),
    {
      appId: 'payroll',
      title,
      describe: () => `${employee.fullName || employee.employeeCode} · ${employee.employeeCode}`,
      context: {
        kind: 'mobile-money',
        employeeId,
        recordId: record?.id || '',
        version: current?.updatedAt || '',
        employeeVersion: employee.updatedAt || '',
        accountsVersion,
      },
      draftId: source?.id,
      busy,
      onClose,
      needsReview:
        !loading &&
        !loadError &&
        ((!!source &&
          (!employee.updatedAt ||
            source.context.employeeVersion !== employee.updatedAt ||
            accounts.some((row) => !row.updatedAt) ||
            source.context.accountsVersion !== accountsVersion)) ||
          (!!current &&
            (!current.updatedAt ||
              (source?.context.version ?? record?.updatedAt) !== current.updatedAt))),
      reviewKey: `${employee.updatedAt || ''}:${accountsVersion}`,
    },
  );
  const form = { ...baseline, ...draft.form };
  const blocked = !allowed || loading || !!loadError || missing || !!draft.availabilityError;
  const change = <K extends keyof MobileMoneyValues>(key: K, value: MobileMoneyValues[K]) => {
    draft.guard.touch();
    draft.setForm((previous) => {
      const next = { ...previous, [key]: value };
      if (record && value === baseline[key]) delete next[key];
      return next;
    });
  };
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || blocked) return;
    pending.current = true;
    setError('');
    try {
      draft.validateReview();
      await draft.saveNow();
      if (!Object.hasOwn(PROVIDER_LABELS, form.provider))
        throw new Error('Choose a mobile money provider.');
      if (!/^(\+?255|0)\d{9}$/.test(form.msisdn.trim()))
        throw new Error('Enter a Tanzanian mobile number, such as +255712345678 or 0712345678.');
      if (!record && accounts.some((account) => account.provider === form.provider))
        throw new Error(`This employee already has a ${PROVIDER_LABELS[form.provider]} account.`);
      const payload: Record<string, string | boolean | null> = {};
      for (const key of Object.keys(baseline) as (keyof MobileMoneyValues)[]) {
        if (record && (draft.form[key] === undefined || form[key] === baseline[key])) continue;
        const value = form[key];
        payload[key] = typeof value === 'string' ? value.trim() || null : value;
      }
      if (record && !Object.keys(payload).length) {
        draft.markSaved();
        onClose();
        return;
      }
      setBusy(true);
      if (record)
        await backendPatch(`/hr/mobile-money-accounts/${encodeURIComponent(record.id)}`, payload);
      else await backendPost('/hr/mobile-money-accounts', { ...payload, employeeId });
      draft.markSaved();
      onSaved('Mobile money account saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save this account.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={title}
      subtitle={employee.fullName || employee.employeeCode}
      onClose={close}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Btn>
          {draft.canRetain && (
            <Btn variant="secondary" disabled={busy} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn variant="primary" type="submit" form={formId} loading={busy} disabled={blocked}>
            {record ? 'Save' : 'Add'}
          </Btn>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4" {...draft.guard.capture}>
        <DraftFormNotice draft={draft}>
          <p>
            Current employee: {employee.fullName || employee.employeeCode} ·{' '}
            {employee.company?.name || 'Company unavailable'}
          </p>
          {current && (
            <p>
              Current account: {PROVIDER_LABELS[current.provider] || current.provider} ·{' '}
              {current.msisdn} · {current.accountName || 'No account name'} · {current.status}
            </p>
          )}
          <p>
            Current primary account:{' '}
            {accounts
              .filter((row) => row.isPrimary)
              .map((row) => `${PROVIDER_LABELS[row.provider] || row.provider} · ${row.msisdn}`)
              .join(', ') || 'None'}
          </p>
          {current && <p>Current notes: {current.notes || 'No notes'}</p>}
        </DraftFormNotice>
        {loading && <p role="status">Loading current accounts…</p>}
        {loadError && (
          <p role="alert" className="workspace-notice">
            {loadError}{' '}
            <Btn variant="ghost" onClick={() => void load()}>
              Retry accounts
            </Btn>
          </p>
        )}
        {missing && (
          <p role="alert" className="workspace-notice">
            This account is no longer available. You can keep your entered changes as a draft.
          </p>
        )}
        {!allowed && (
          <p role="alert" className="workspace-notice">
            Your current role cannot edit employee accounts.
          </p>
        )}
        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
        <fieldset disabled={busy || blocked} className="space-y-3">
          <FormSelect
            label="Provider"
            value={form.provider}
            onChange={(e) => change('provider', e.target.value)}
            options={Object.entries(PROVIDER_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <FormInput
            label="Mobile number"
            required
            value={form.msisdn}
            onChange={(e) => change('msisdn', e.target.value)}
            placeholder="+255712345678 or 0712345678"
            hint="Tanzanian mobile number — E.164 or 0-prefixed"
          />
          <FormInput
            label="Account name (optional)"
            value={form.accountName}
            onChange={(e) => change('accountName', e.target.value)}
          />
          <FormSelect
            label="Status"
            value={form.status}
            onChange={(e) => change('status', e.target.value)}
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'SUSPENDED', label: 'Suspended' },
              { value: 'CLOSED', label: 'Closed' },
            ]}
          />
          <FormInput
            label="Notes (optional)"
            value={form.notes}
            onChange={(e) => change('notes', e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm" htmlFor={`${formId}-primary`}>
            <input
              type="checkbox"
              id={`${formId}-primary`}
              checked={form.isPrimary}
              onChange={(e) => change('isPrimary', e.target.checked)}
            />
            Set as primary disbursement account
          </label>
        </fieldset>
      </form>
    </Modal>
  );
}
