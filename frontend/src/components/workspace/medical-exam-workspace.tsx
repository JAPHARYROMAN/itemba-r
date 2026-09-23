'use client';
import { useEffect, useState } from 'react';
import {
  Btn,
  FormDateField,
  FormInput,
  FormSelect,
  Modal,
  PageHeader,
  PageToolbar,
  PermissionDeniedState,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { backendDelete, backendPatch, backendPost } from '@/lib/api-client';
import { RecordBrowser } from './record-browser';
import { useFormGuard } from './unsaved-work-provider';
import { payrollLabel } from './payroll-types';
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
  department?: { name: string };
  position?: { title: string };
}
interface Exam {
  id: string;
  companyId: string;
  company?: Company;
  employeeId: string;
  employee?: Employee;
  examType: string;
  examDate: string;
  expiresAt: string;
  fitnessStatus: string;
  hazardSector: boolean;
  doctorName?: string | null;
  facilityName?: string | null;
  restrictions?: string | null;
  notes?: string | null;
}
const path = '/hr/medical-exam-records';
const name = (e?: Employee) =>
  e?.fullName ||
  [e?.firstName, e?.lastName].filter(Boolean).join(' ') ||
  e?.employeeCode ||
  'Employee';
const date = (value: string) =>
  new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const types = [
  'PRE_EMPLOYMENT',
  'ANNUAL',
  'POST_INCIDENT',
  'RETURN_TO_WORK',
  'FITNESS_FOR_DUTY',
  'HAZARD_SECTOR',
  'OTHER',
].map((value) => ({ value, label: payrollLabel(value) }));
const fitness = ['FIT', 'FIT_WITH_RESTRICTIONS', 'TEMPORARILY_UNFIT', 'UNFIT'].map((value) => ({
  value,
  label: payrollLabel(value),
}));
const toForm = (r?: Exam) => ({
  companyId: r?.companyId || '',
  employeeId: r?.employeeId || '',
  examType: r?.examType || 'ANNUAL',
  fitnessStatus: r?.fitnessStatus || 'FIT',
  examDate: r?.examDate.slice(0, 10) || '',
  expiresAt: r?.expiresAt.slice(0, 10) || '',
  hazardSector: r?.hazardSector || false,
  doctorName: r?.doctorName || '',
  facilityName: r?.facilityName || '',
  restrictions: r?.restrictions || '',
  notes: r?.notes || '',
});

export function MedicalExamWorkspace() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('employees.view'),
    canManage = hasPermission('employees.update');
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [company, setCompany] = useState(''),
    [status, setStatus] = useState(''),
    [hazard, setHazard] = useState(false),
    [expiry, setExpiry] = useState(''),
    [page, setPage] = useState(1);
  const [editor, setEditor] = useState<{ record?: Exam } | null>(null),
    [removing, setRemoving] = useState<Exam | null>(null),
    [notice, setNotice] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const result = useWorkspaceRecords<Exam>(
    path,
    {
      page,
      limit: 20,
      companyId: company,
      search: query,
      fitnessStatus: status,
      hazardOnly: hazard ? 'true' : '',
      expiringDays: expiry,
    },
    canRead,
  );
  const companies = useWorkspaceChoices<Company>('/companies', {}, canRead);
  const saved = (message: string) => {
    setEditor(null);
    setRemoving(null);
    setNotice(message);
    void result.reload();
  };
  if (!canRead)
    return <PermissionDeniedState description="Your role cannot view medical examinations." />;
  return (
    <div className="business-workspace record-workspace">
      <PageHeader
        title="Medical examinations"
        subtitle="Review recorded examinations, fitness assessments and renewal dates."
        breadcrumbs={[{ label: 'People', href: '/hr' }, { label: 'Medical examinations' }]}
        actions={
          canManage && (
            <Btn variant="primary" onClick={() => setEditor({})}>
              New examination
            </Btn>
          )
        }
      />
      <div className="workspace-summary">
        <div>
          <span>Matching examinations</span>
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
          {companies.error}{' '}
          <Btn variant="ghost" onClick={companies.retry}>
            Retry companies
          </Btn>
        </div>
      )}
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search employee, doctor or facility…"
        collapsibleFilters
        activeFilterCount={Number(!!company) + Number(!!status) + Number(hazard) + Number(!!expiry)}
        filters={
          <>
            <FormSelect
              label="Company filter"
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                setPage(1);
              }}
              options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="All companies"
            />
            <FormSelect
              label="Fitness filter"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              options={fitness}
              placeholder="All assessments"
            />
            <FormSelect
              label="Renewal filter"
              value={expiry}
              onChange={(e) => {
                setExpiry(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '30', label: 'Expired or due within 30 days' },
                { value: '90', label: 'Expired or due within 90 days' },
              ]}
              placeholder="All renewal dates"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hazard}
                onChange={(e) => {
                  setHazard(e.target.checked);
                  setPage(1);
                }}
              />
              Hazard-sector only
            </label>
          </>
        }
        actions={
          <Btn variant="secondary" disabled={result.loading} onClick={result.reload}>
            Reload
          </Btn>
        }
      />
      <RecordBrowser
        title="Medical examinations"
        records={result.rows}
        name={(r) => name(r.employee)}
        reference={(r) => payrollLabel(r.examType)}
        status={(r) => r.fitnessStatus}
        fields={[
          { label: 'Exam date', value: (r) => date(r.examDate) },
          { label: 'Expires', value: (r) => date(r.expiresAt) },
        ]}
        details={[
          { label: 'Company', value: (r) => r.company?.name || '—' },
          { label: 'Employee code', value: (r) => r.employee?.employeeCode || '—' },
          { label: 'Department', value: (r) => r.employee?.department?.name || '—' },
          { label: 'Position', value: (r) => r.employee?.position?.title || '—' },
          { label: 'Hazard sector', value: (r) => (r.hazardSector ? 'Yes' : 'No') },
          { label: 'Doctor', value: (r) => r.doctorName || 'Not recorded' },
          { label: 'Facility', value: (r) => r.facilityName || 'Not recorded' },
          { label: 'Restrictions', value: (r) => r.restrictions || 'None recorded' },
          { label: 'Notes', value: (r) => r.notes || 'None recorded' },
        ]}
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        page={page}
        pageSize={20}
        total={result.total}
        onPage={setPage}
        actions={(r) =>
          canManage && (
            <>
              <Btn variant="primary" onClick={() => setEditor({ record: r })}>
                Edit examination
              </Btn>
              <Btn variant="ghost" onClick={() => setRemoving(r)}>
                Delete record
              </Btn>
            </>
          )
        }
      />
      {editor && (
        <ExamEditor record={editor.record} onClose={() => setEditor(null)} onSaved={saved} />
      )}
      {removing && (
        <DeleteExam record={removing} onClose={() => setRemoving(null)} onSaved={saved} />
      )}
    </div>
  );
}

function ExamEditor({
  record,
  onClose,
  onSaved,
}: {
  record?: Exam;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const [form, setForm] = useState(() => toForm(record)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const baseline = toForm(record),
    draft = useFormGuard(form, setForm);
  const companies = useWorkspaceChoices<Company>('/companies', {}, !record);
  const employees = useWorkspaceChoices<Employee>(
    '/hr/employees',
    { companyId: form.companyId, employmentStatus: 'ACTIVE' },
    !record && !!form.companyId,
  );
  const blocked = [companies, employees].some((c) => c.loading || !!c.error);
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
    if (busy || blocked || !hasPermission('employees.update')) return;
    if (
      !record &&
      (!companies.rows.some((c) => c.id === form.companyId) ||
        !employees.rows.some((p) => p.id === form.employeeId))
    ) {
      setError('Choose a company and employee.');
      return;
    }
    if (!form.examDate || !form.expiresAt || form.expiresAt < form.examDate) {
      setError('Choose an exam date and an expiry on or after it.');
      return;
    }
    const values: Record<string, string | boolean | null> = {
      examType: form.examType,
      fitnessStatus: form.fitnessStatus,
      examDate: form.examDate,
      expiresAt: form.expiresAt,
      hazardSector: form.hazardSector,
    };
    if (!record) {
      values.companyId = form.companyId;
      values.employeeId = form.employeeId;
    }
    for (const key of ['doctorName', 'facilityName', 'restrictions', 'notes'] as const)
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
      onSaved('Examination saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save the examination.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      size="lg"
      title={record ? 'Edit examination' : 'New examination'}
      subtitle={
        record
          ? name(record.employee) + ' · ' + (record.company?.name || 'Medical examination')
          : 'Record the assessment and dates supplied by the examination provider.'
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
            form="medical-exam-form"
            loading={busy}
            disabled={blocked}
          >
            Save examination
          </Btn>
        </>
      }
    >
      <form id="medical-exam-form" onSubmit={submit} {...draft.capture} className="space-y-5">
        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
        {[companies, employees].map(
          (c, i) =>
            c.error && (
              <div role="alert" className="workspace-notice" key={i}>
                {c.error}{' '}
                <Btn variant="ghost" onClick={c.retry}>
                  Retry {i === 0 ? 'companies' : 'employees'}
                </Btn>
              </div>
            ),
        )}
        <section className="space-y-3">
          <h3 className="font-semibold">Employee and examination</h3>
          {record ? (
            <p className="workspace-notice">
              {name(record.employee)} · {record.employee?.employeeCode} · {record.company?.name}
              <br />
              The employee and company remain linked to this examination.
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
                options={employees.rows.map((e) => ({
                  value: e.id,
                  label: name(e) + ' · ' + e.employeeCode,
                }))}
                placeholder={employees.loading ? 'Loading employees…' : 'Choose employee'}
                onChange={f('employeeId')}
              />
            </div>
          )}
          <div className="workspace-form-grid">
            <FormSelect
              label="Exam type"
              value={form.examType}
              options={types}
              onChange={f('examType')}
            />
            <FormSelect
              label="Fitness assessment"
              value={form.fitnessStatus}
              options={fitness}
              onChange={f('fitnessStatus')}
            />
            <FormDateField
              label="Exam date"
              required
              value={form.examDate}
              onChange={setValue('examDate')}
            />
            <FormDateField
              label="Expiry date"
              required
              value={form.expiresAt}
              onChange={setValue('expiresAt')}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.hazardSector}
              onChange={(e) => setForm((p) => ({ ...p, hazardSector: e.target.checked }))}
            />
            Hazard-sector employee
          </label>
        </section>
        <section className="space-y-3">
          <h3 className="font-semibold">Provider and assessment notes</h3>
          <div className="workspace-form-grid">
            <FormInput label="Doctor name" value={form.doctorName} onChange={f('doctorName')} />
            <FormInput label="Facility" value={form.facilityName} onChange={f('facilityName')} />
          </div>
          <FormInput label="Restrictions" value={form.restrictions} onChange={f('restrictions')} />
          <FormInput label="Notes" value={form.notes} onChange={f('notes')} />
        </section>
      </form>
    </Modal>
  );
}

function DeleteExam({
  record,
  onClose,
  onSaved,
}: {
  record: Exam;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const remove = async () => {
    if (busy || !hasPermission('employees.update')) return;
    setBusy(true);
    setError('');
    try {
      await backendDelete(path + '/' + record.id);
      onSaved('Examination deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete this record.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="Delete examination?"
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="danger" loading={busy} onClick={remove}>
            Delete examination
          </Btn>
        </>
      }
    >
      <div className="space-y-3">
        <p>
          <strong>{name(record.employee)}</strong> · {record.company?.name}
          <br />
          {payrollLabel(record.examType)} · {date(record.examDate)}
        </p>
        <p>This removes the examination from active lists. Its audit history is retained.</p>
        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
