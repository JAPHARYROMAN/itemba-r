'use client';
import { useState } from 'react';
import { Btn, FormDateField, FormInput, FormSelect, FormTextarea, Modal } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { backendPost, backendPatch } from '@/lib/api-client';
import { useFormGuard } from './unsaved-work-provider';
import {
  delegationForm,
  delegationName,
  delegationPath,
  delegationUserLabel,
  type ApprovalDelegation,
  type DelegationCompany,
  type DelegationUser,
} from './approval-delegation-types';

export function ApprovalDelegationEditor({
  record,
  companyId = '',
  onClose,
  onSaved,
}: {
  record?: ApprovalDelegation;
  companyId?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { user, hasPermission } = useAuth();
  const canChoose = hasPermission('companies.read'),
    canChooseUsers = hasPermission('users.read');
  const [form, setForm] = useState(() =>
    delegationForm(record, canChoose ? companyId : user?.companyId || ''),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const draft = useFormGuard(form, setForm);
  const companies = useWorkspaceChoices<DelegationCompany>('/companies', {}, canChoose);
  // The user directory returns the complete scoped array and accepts no page/limit parameters.
  const userResult = useWorkspaceResource<DelegationUser[]>(
    '/users',
    form.companyId ? { companyId: form.companyId } : {},
    canChooseUsers,
  );
  const users = {
    rows: userResult.data || [],
    loading: userResult.loading,
    error: userResult.error,
    retry: userResult.reload,
  };
  const blocked =
    companies.loading ||
    !!companies.error ||
    users.loading ||
    !!users.error ||
    (!record && !canChooseUsers);
  const baseline = delegationForm(record);
  const f =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [key]: e.target.value }));
  const close = () => {
    if (!busy) draft.requestClose(onClose);
  };
  const userOptions = (id: string, reference?: DelegationUser | null) => {
    const rows = users.rows.map((u) => ({ value: u.id, label: delegationUserLabel(u, u.id) }));
    if (id && !rows.some((u) => u.value === id))
      rows.unshift({ value: id, label: delegationUserLabel(reference, id) });
    return rows;
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || blocked || !hasPermission('approval_delegations.manage')) return;
    if (
      !form.delegatorUserId ||
      !form.delegateUserId ||
      form.delegatorUserId === form.delegateUserId
    ) {
      setError('Choose two different people for the delegation.');
      return;
    }
    if (
      !form.startDate ||
      !form.endDate ||
      !Number.isFinite(new Date(form.startDate).getTime()) ||
      !Number.isFinite(new Date(form.endDate).getTime())
    ) {
      setError('Enter valid start and end times.');
      return;
    }
    // Untouched timestamps retain seconds, offsets and the original instant.
    const start =
      record && form.startDate === baseline.startDate
        ? record.startDate
        : new Date(form.startDate).toISOString();
    const end =
      record && form.endDate === baseline.endDate
        ? record.endDate
        : new Date(form.endDate).toISOString();
    if (new Date(end) < new Date(start)) {
      setError('The end must be on or after the start.');
      return;
    }
    const values = {
      delegatorUserId: form.delegatorUserId,
      delegateUserId: form.delegateUserId,
      companyId: form.companyId || null,
      entityType: form.entityType.trim() || null,
      startDate: start,
      endDate: end,
      reason: form.reason.trim() || null,
    };
    const payload = record
      ? Object.fromEntries(
          Object.entries(values).filter(
            ([key]) => form[key as keyof typeof form] !== baseline[key as keyof typeof baseline],
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
      if (record) await backendPatch(`${delegationPath}/${record.id}`, payload);
      else await backendPost(delegationPath, payload);
      draft.markSaved();
      onSaved('Delegation saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save delegation.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={record ? 'Edit delegation' : 'New delegation'}
      subtitle={
        record
          ? delegationName(record)
          : 'Choose who provides cover, where it applies and for how long.'
      }
      onClose={close}
      size="lg"
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Btn>
          <Btn type="submit" form="approval-delegation-form" loading={busy} disabled={blocked}>
            Save delegation
          </Btn>
        </>
      }
    >
      <form
        id="approval-delegation-form"
        className="space-y-5"
        onSubmit={submit}
        {...draft.capture}
      >
        {(companies.loading || users.loading) && <p role="status">Loading choices…</p>}
        {companies.error && (
          <div role="alert" className="workspace-notice">
            {companies.error}
            <Btn variant="ghost" onClick={companies.retry}>
              Retry companies
            </Btn>
          </div>
        )}
        {users.error && (
          <div role="alert" className="workspace-notice">
            {users.error}
            <Btn variant="ghost" onClick={users.retry}>
              Retry people
            </Btn>
          </div>
        )}
        {!canChooseUsers && !record && (
          <p role="alert" className="workspace-notice">
            User directory access is required to choose the delegator and delegate.
          </p>
        )}
        <fieldset disabled={busy} className="space-y-5">
          <h3 className="font-semibold">People and scope</h3>
          {canChoose ? (
            <FormSelect
              label="Company"
              value={form.companyId}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  companyId: e.target.value,
                  delegatorUserId: '',
                  delegateUserId: '',
                }))
              }
              placeholder="All companies (group access required)"
              options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
              disabled={!canChooseUsers || companies.loading || !!companies.error}
            />
          ) : (
            <p className="workspace-notice">
              {form.companyId
                ? 'Using the assigned company.'
                : 'All companies; group access required.'}
            </p>
          )}
          <div className="workspace-form-grid">
            <FormSelect
              label="Delegator"
              required
              value={form.delegatorUserId}
              onChange={f('delegatorUserId')}
              placeholder="Choose delegator"
              options={userOptions(form.delegatorUserId, record?.delegator)}
              disabled={!canChooseUsers || users.loading || !!users.error}
            />
            <FormSelect
              label="Delegate"
              required
              value={form.delegateUserId}
              onChange={f('delegateUserId')}
              placeholder="Choose delegate"
              options={userOptions(form.delegateUserId, record?.delegate)}
              disabled={!canChooseUsers || users.loading || !!users.error}
            />
          </div>
          <FormInput
            label="Entity type"
            value={form.entityType}
            onChange={f('entityType')}
            hint="Exact entity type, for example PurchaseOrder. Leave blank for all entity types."
          />
          <h3 className="font-semibold">Dates and context</h3>
          <p className="text-sm">
            Times use {Intl.DateTimeFormat().resolvedOptions().timeZone}. Cover ends at the exact
            time selected.
          </p>
          <div className="workspace-form-grid">
            <FormDateField
              label="Starts"
              required
              granularity="minute"
              value={form.startDate}
              onChange={(value) => setForm((p) => ({ ...p, startDate: value }))}
            />
            <FormDateField
              label="Ends"
              required
              granularity="minute"
              value={form.endDate}
              onChange={(value) => setForm((p) => ({ ...p, endDate: value }))}
            />
          </div>
          <FormTextarea label="Reason" value={form.reason} onChange={f('reason')} rows={3} />
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
