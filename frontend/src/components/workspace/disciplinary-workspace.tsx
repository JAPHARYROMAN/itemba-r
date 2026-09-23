'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Btn, FormDateField, FormSelect, Modal, PageHeader, PageToolbar, PermissionDeniedState } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { backendDelete, backendPatch, backendPost } from '@/lib/api-client';
import { RecordBrowser } from './record-browser';
import { useFormGuard } from './unsaved-work-provider';
import { payrollLabel, payrollMoney } from './payroll-types';
import './workspace.css';

interface Company {
  id: string;
  name: string;
}
interface Employee {
  id: string;
  fullName?: string | null;
  firstName?: string;
  lastName?: string;
  employeeCode: string;
}
interface Dispute {
  id: string;
  disputeNumber: string;
  type?: string;
  status: string;
}
interface Action {
  id: string;
  actionNumber: string;
  companyId: string;
  company?: Company;
  employeeId: string;
  employee?: Employee;
  disputeId?: string | null;
  dispute?: Dispute | null;
  type: string;
  status: string;
  issuedAt: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  reason: string;
  evidence?: string | null;
  employeeResponse?: string | null;
  notes?: string | null;
  issuedById: string;
  issuedBy?: { fullName: string };
  approvedBy?: { fullName: string };
  approvedAt?: string | null;
  fineAmount?: number | string | null;
  fineDeductionId?: string | null;
}
const path = '/hr/disciplinary-actions';
const name = (r: Action) =>
  r.employee?.fullName ||
  [r.employee?.firstName, r.employee?.lastName].filter(Boolean).join(' ') ||
  r.employee?.employeeCode ||
  'Employee';
const date = (value?: string | null) =>
  value
    ? new Date(value).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : 'Not set';
const types = [
  'VERBAL_WARNING',
  'WRITTEN_WARNING',
  'FINAL_WARNING',
  'SUSPENSION_WITH_PAY',
  'SUSPENSION_WITHOUT_PAY',
  'DEMOTION',
  'TERMINATION',
  'OTHER',
].map((value) => ({ value, label: payrollLabel(value) }));
const statuses = [
  'PENDING_HR_APPROVAL',
  'PENDING_GM_APPROVAL',
  'ACTIVE',
  'EXPIRED',
  'OVERTURNED',
  'WITHDRAWN',
].map((value) => ({ value, label: payrollLabel(value) }));
const pending = (r: Action) => ['PENDING_HR_APPROVAL', 'PENDING_GM_APPROVAL'].includes(r.status);
const toForm = (r?: Action) => ({
  companyId: r?.companyId || '',
  employeeId: r?.employeeId || '',
  disputeId: r?.disputeId || '',
  type: r?.type || 'VERBAL_WARNING',
  issuedAt: r?.issuedAt.slice(0, 10) || new Date().toISOString().slice(0, 10),
  effectiveFrom: r?.effectiveFrom?.slice(0, 10) || '',
  effectiveTo: r?.effectiveTo?.slice(0, 10) || '',
  reason: r?.reason || '',
  evidence: r?.evidence || '',
  employeeResponse: r?.employeeResponse || '',
  notes: r?.notes || '',
});

export function DisciplinaryWorkspace() {
  const { hasPermission, user } = useAuth();
  const canRead = hasPermission('disciplinary_actions.view'),
    canCreate = hasPermission('disciplinary_actions.create'),
    canEdit = hasPermission('disciplinary_actions.update'),
    canDelete = hasPermission('disciplinary_actions.delete'),
    canApprove = hasPermission('disciplinary_actions.approve.hr');
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [company, setCompany] = useState(''),
    [status, setStatus] = useState(''),
    [type, setType] = useState(''),
    [page, setPage] = useState(1);
  const [editor, setEditor] = useState<{ record?: Action } | null>(null),
    [operation, setOperation] = useState<{ record: Action; kind: 'approve' | 'delete' } | null>(
      null,
    ),
    [notice, setNotice] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const result = useWorkspaceRecords<Action>(
    path,
    { page, limit: 20, search: query, companyId: company, status, type },
    canRead,
  );
  const companies = useWorkspaceChoices<Company>('/companies', {}, canRead);
  const saved = (message: string) => {
    setEditor(null);
    setOperation(null);
    setNotice(message);
    void result.reload();
  };
  if (!canRead)
    return <PermissionDeniedState description="Your role cannot view disciplinary actions." />;
  return (
    <div className="business-workspace record-workspace">
      <PageHeader
        title="Disciplinary actions"
        subtitle="Review recorded actions, supporting details and approval status."
        breadcrumbs={[{ label: 'People', href: '/hr' }, { label: 'Disciplinary actions' }]}
        actions={
          canCreate && (
            <Btn variant="primary" onClick={() => setEditor({})}>
              New action
            </Btn>
          )
        }
      />
      <div className="workspace-summary">
        <div>
          <span>Matching actions</span>
          <strong>{result.total}</strong>
        </div>
      </div>
      {notice && (
        <p role="status" className="workspace-notice">
          {notice}
        </p>
      )}
      {companies.error && (
        <div role="alert" className="workspace-notice">
          {companies.error}
          <Btn variant="ghost" onClick={companies.retry}>
            Retry companies
          </Btn>
        </div>
      )}
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search action or employee…"
        collapsibleFilters
        activeFilterCount={Number(!!company) + Number(!!status) + Number(!!type)}
        filters={
          <>
            <FormSelect
              label="Company filter"
              value={company}
              options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="All companies"
              onChange={(e) => {
                setCompany(e.target.value);
                setPage(1);
              }}
            />
            <FormSelect
              label="Status filter"
              value={status}
              options={statuses}
              placeholder="All statuses"
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            />
            <FormSelect
              label="Type filter"
              value={type}
              options={types}
              placeholder="All types"
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
            />
          </>
        }
        actions={
          <Btn variant="secondary" disabled={result.loading} onClick={result.reload}>
            Reload
          </Btn>
        }
      />
      <RecordBrowser
        title="Disciplinary actions"
        records={result.rows}
        name={name}
        reference={(r) => r.actionNumber}
        status={(r) => r.status}
        fields={[
          { label: 'Action', value: (r) => payrollLabel(r.type) },
          { label: 'Issued', value: (r) => date(r.issuedAt) },
        ]}
        details={[
          { label: 'Company', value: (r) => r.company?.name || '—' },
          { label: 'Employee code', value: (r) => r.employee?.employeeCode || '—' },
          { label: 'Effective from', value: (r) => date(r.effectiveFrom) },
          { label: 'Effective to', value: (r) => date(r.effectiveTo) },
          { label: 'Reason', value: (r) => r.reason },
          { label: 'Evidence', value: (r) => r.evidence || 'None recorded' },
          { label: 'Employee response', value: (r) => r.employeeResponse || 'None recorded' },
          {
            label: 'Linked dispute',
            value: (r) =>
              r.disputeId && hasPermission('employees.view') ? (
                <Link className="workspace-link" href={'/hr/disputes/' + r.disputeId}>
                  {r.dispute?.disputeNumber || 'Open dispute'}
                </Link>
              ) : (
                r.dispute?.disputeNumber || 'None'
              ),
          },
          { label: 'Issued by', value: (r) => r.issuedBy?.fullName || '—' },
          { label: 'Approved by', value: (r) => r.approvedBy?.fullName || 'Not approved' },
          { label: 'Approved on', value: (r) => date(r.approvedAt) },
          {
            label: 'Recorded fine',
            value: (r) => (r.fineAmount == null ? 'Not set' : payrollMoney(r.fineAmount)),
          },
          {
            label: 'Fine deduction',
            value: (r) => (r.fineDeductionId ? 'Linked deduction recorded' : 'No linked deduction'),
          },
          { label: 'Notes', value: (r) => r.notes || 'None recorded' },
        ]}
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        page={page}
        pageSize={20}
        total={result.total}
        onPage={setPage}
        actions={(r) => (
          <>
            {canEdit && (
              <Btn variant="primary" onClick={() => setEditor({ record: r })}>
                Edit action
              </Btn>
            )}
            {canApprove && pending(r) && (
              <>
                <Btn
                  variant="secondary"
                  disabled={!user || r.issuedById === user.id}
                  onClick={() => setOperation({ record: r, kind: 'approve' })}
                >
                  Review approval
                </Btn>
                {r.issuedById === user?.id && (
                  <p className="text-sm">
                    Another authorized reviewer must approve an action you issued.
                  </p>
                )}
              </>
            )}
            {canDelete && (
              <Btn variant="ghost" onClick={() => setOperation({ record: r, kind: 'delete' })}>
                Delete record
              </Btn>
            )}
          </>
        )}
      />
      {editor && (
        <ActionEditor record={editor.record} onClose={() => setEditor(null)} onSaved={saved} />
      )}
      {operation && (
        <ActionConfirmation {...operation} onClose={() => setOperation(null)} onSaved={saved} />
      )}
    </div>
  );
}

function ActionEditor({
  record,
  onClose,
  onSaved,
}: {
  record?: Action;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const [form, setForm] = useState(() => toForm(record)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const baseline = toForm(record),
    draft = useFormGuard(form, setForm),
    canChoose = hasPermission('employees.view');
  const companies = useWorkspaceChoices<Company>('/companies', {}, !record && canChoose);
  const employees = useWorkspaceChoices<Employee>(
    '/hr/employees',
    { companyId: form.companyId },
    !record && canChoose && !!form.companyId,
  );
  const disputes = useWorkspaceChoices<Dispute>(
    '/hr/employment-disputes',
    { companyId: form.companyId, employeeId: form.employeeId },
    canChoose && !!form.companyId && !!form.employeeId,
  );
  const blocked =
    [companies, employees, disputes].some((c) => c.loading || !!c.error) || (!record && !canChoose);
  const options = disputes.rows.map((d) => ({
    value: d.id,
    label: d.disputeNumber + ' · ' + payrollLabel(d.status),
  }));
  if (record?.disputeId && !options.some((o) => o.value === record.disputeId))
    options.push({
      value: record.disputeId,
      label: (record.dispute?.disputeNumber || 'Existing dispute') + ' · current',
    });
  const close = () => {
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
    if (
      busy ||
      blocked ||
      !hasPermission(record ? 'disciplinary_actions.update' : 'disciplinary_actions.create')
    )
      return;
    if (
      !record &&
      (!companies.rows.some((c) => c.id === form.companyId) ||
        !employees.rows.some((e) => e.id === form.employeeId))
    ) {
      setError('Choose a company and employee.');
      return;
    }
    if (
      form.disputeId &&
      form.disputeId !== record?.disputeId &&
      !disputes.rows.some((d) => d.id === form.disputeId)
    ) {
      setError('Choose a dispute belonging to this employee.');
      return;
    }
    if (!form.reason.trim() || !form.issuedAt) {
      setError('An issue date and reason are required.');
      return;
    }
    if (form.effectiveFrom && form.effectiveTo && form.effectiveTo < form.effectiveFrom) {
      setError('Effective to must be on or after effective from.');
      return;
    }
    const values: Record<string, string | null> = {
      type: form.type,
      issuedAt: form.issuedAt,
      reason: form.reason.trim(),
    };
    if (!record) {
      values.companyId = form.companyId;
      values.employeeId = form.employeeId;
    }
    for (const key of [
      'disputeId',
      'effectiveFrom',
      'effectiveTo',
      'evidence',
      'employeeResponse',
      'notes',
    ] as const)
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
      if (record) await backendPatch(path + '/' + record.id, payload);
      else await backendPost(path, payload);
      draft.markSaved();
      onSaved('Disciplinary action saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save the action.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      size="lg"
      title={record ? 'Edit disciplinary action' : 'New disciplinary action'}
      subtitle={
        record
          ? record.actionNumber + ' · ' + name(record)
          : 'Record the action and its supporting information.'
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
            form="disciplinary-form"
            loading={busy}
            disabled={blocked}
          >
            Save action
          </Btn>
        </>
      }
    >
      <form id="disciplinary-form" onSubmit={submit} {...draft.capture} className="space-y-5">
        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
        {!canChoose && (
          <p className="workspace-notice">
            Employee viewing permission is required to choose an employee or change the linked
            dispute.{' '}
            {record
              ? 'You can edit the other details of this existing action.'
              : 'Ask an authorized operator to create the record.'}
          </p>
        )}
        {[companies, employees, disputes].map(
          (c, i) =>
            c.error && (
              <div role="alert" className="workspace-notice" key={i}>
                {c.error}
                <Btn variant="ghost" onClick={c.retry}>
                  Retry {['companies', 'employees', 'disputes'][i]}
                </Btn>
              </div>
            ),
        )}
        <section className="space-y-3">
          <h3 className="font-semibold">Employee and action</h3>
          {record ? (
            <p className="workspace-notice">
              {name(record)} · {record.employee?.employeeCode} · {record.company?.name}
              <br />
              The employee and company remain linked to this action.
            </p>
          ) : (
            <div className="workspace-form-grid">
              <FormSelect
                label="Company"
                required
                value={form.companyId}
                disabled={!canChoose}
                options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="Choose company"
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    companyId: e.target.value,
                    employeeId: '',
                    disputeId: '',
                  }))
                }
              />
              <FormSelect
                label="Employee"
                required
                value={form.employeeId}
                disabled={!canChoose || !form.companyId || employees.loading}
                options={employees.rows.map((e) => ({
                  value: e.id,
                  label:
                    (e.fullName ||
                      [e.firstName, e.lastName].filter(Boolean).join(' ') ||
                      e.employeeCode) +
                    ' · ' +
                    e.employeeCode,
                }))}
                placeholder={employees.loading ? 'Loading employees…' : 'Choose employee'}
                onChange={(e) =>
                  setForm((p) => ({ ...p, employeeId: e.target.value, disputeId: '' }))
                }
              />
            </div>
          )}
          <div className="workspace-form-grid">
            <FormSelect
              label="Action type"
              value={form.type}
              options={types}
              onChange={f('type')}
            />
            <FormSelect
              label="Linked dispute"
              value={form.disputeId}
              options={options}
              placeholder={disputes.loading ? 'Loading disputes…' : 'No linked dispute'}
              disabled={!canChoose || !form.employeeId || disputes.loading}
              onChange={f('disputeId')}
            />
          </div>
          {!record && (
            <p className="workspace-notice">
              {form.type === 'VERBAL_WARNING'
                ? 'A verbal warning becomes active when saved.'
                : 'This action will be recorded as pending HR approval. The issuer cannot approve it.'}
            </p>
          )}
        </section>
        <section className="space-y-3">
          <h3 className="font-semibold">Dates</h3>
          <div className="workspace-form-grid">
            <FormDateField
              label="Issued on"
              required
              value={form.issuedAt}
              onChange={setValue('issuedAt')}
            />
            <FormDateField
              label="Effective from"
              value={form.effectiveFrom}
              onChange={setValue('effectiveFrom')}
            />
            <FormDateField
              label="Effective to"
              value={form.effectiveTo}
              onChange={setValue('effectiveTo')}
            />
          </div>
        </section>
        <section className="space-y-3">
          <h3 className="font-semibold">Supporting details</h3>
          {(['reason', 'evidence', 'employeeResponse', 'notes'] as const).map((key) => (
            <label className="block text-sm space-y-2" key={key}>
              <span>
                {
                  {
                    reason: 'Reason',
                    evidence: 'Evidence',
                    employeeResponse: 'Employee response',
                    notes: 'Notes',
                  }[key]
                }
                {key === 'reason' ? ' *' : ''}
              </span>
              <textarea
                className="workspace-textarea"
                rows={3}
                required={key === 'reason'}
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

function ActionConfirmation({
  record,
  kind,
  onClose,
  onSaved,
}: {
  record: Action;
  kind: 'approve' | 'delete';
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { hasPermission, user } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const confirm = async () => {
    if (
      busy ||
      !hasPermission(
        kind === 'approve' ? 'disciplinary_actions.approve.hr' : 'disciplinary_actions.delete',
      ) ||
      (kind === 'approve' && (!user || record.issuedById === user.id || !pending(record)))
    )
      return;
    setBusy(true);
    setError('');
    try {
      if (kind === 'approve') await backendPatch(path + '/' + record.id + '/approve');
      else await backendDelete(path + '/' + record.id);
      onSaved(
        kind === 'approve' ? 'Disciplinary action approved.' : 'Disciplinary action deleted.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete this action.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={kind === 'approve' ? 'Approve disciplinary action?' : 'Delete disciplinary action?'}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant={kind === 'delete' ? 'danger' : 'primary'} loading={busy} onClick={confirm}>
            {kind === 'approve' ? 'Approve action' : 'Delete action'}
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <p>
          <strong>
            {record.actionNumber} · {name(record)}
          </strong>
          <br />
          {record.company?.name} · {payrollLabel(record.type)}
          <br />
          Issued {date(record.issuedAt)}
        </p>
        <p className="whitespace-pre-wrap break-words">{record.reason}</p>
        {kind === 'approve' ? (
          <>
            <p>Approval makes this action active and records you as the approver.</p>
            {Number(record.fineAmount) > 0 && (
              <p className="workspace-notice">
                Recorded fine: {payrollMoney(record.fineAmount)}.{' '}
                {record.fineDeductionId
                  ? 'A deduction is already linked.'
                  : 'Approval also attempts to create the corresponding employee deduction.'}
              </p>
            )}
          </>
        ) : (
          <p>
            This removes the action from active lists and retains its audit history. Any linked
            payroll deduction remains unchanged.
          </p>
        )}
        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
