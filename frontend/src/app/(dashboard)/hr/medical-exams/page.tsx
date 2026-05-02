'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Btn,
  Card,
  ConfirmDialog,
  FormInput,
  FormSelect,
  Modal,
  PageHeader,
  PageSpinner,
  PageToolbar,
  StatusBadge,
} from '@/components/ui';

interface Company {
  id: string;
  name: string;
  code: string;
}
interface EmployeeOption {
  id: string;
  employeeCode: string;
  fullName: string;
  firstName: string;
  lastName: string;
}

interface MedicalRow {
  id: string;
  companyId: string;
  employeeId: string;
  examType: string;
  examDate: string;
  expiresAt: string;
  fitnessStatus: string;
  doctorName: string | null;
  facilityName: string | null;
  hazardSector: boolean;
  restrictions: string | null;
  notes: string | null;
  employee?: {
    employeeCode: string;
    fullName: string | null;
    firstName: string;
    lastName: string;
    department?: { name: string } | null;
    position?: { title: string } | null;
  } | null;
}

interface FormState {
  companyId: string;
  employeeId: string;
  examType: string;
  examDate: string;
  expiresAt: string;
  fitnessStatus: string;
  doctorName: string;
  facilityName: string;
  hazardSector: boolean;
  restrictions: string;
  notes: string;
}

const blank: FormState = {
  companyId: '',
  employeeId: '',
  examType: 'ANNUAL',
  examDate: '',
  expiresAt: '',
  fitnessStatus: 'FIT',
  doctorName: '',
  facilityName: '',
  hazardSector: false,
  restrictions: '',
  notes: '',
};

const TYPE_OPTIONS = [
  { value: 'PRE_EMPLOYMENT', label: 'Pre-employment' },
  { value: 'ANNUAL', label: 'Annual checkup' },
  { value: 'POST_INCIDENT', label: 'Post-incident' },
  { value: 'RETURN_TO_WORK', label: 'Return-to-work' },
  { value: 'FITNESS_FOR_DUTY', label: 'Fitness-for-duty' },
  { value: 'HAZARD_SECTOR', label: 'Hazard sector (petroleum/mining)' },
  { value: 'OTHER', label: 'Other' },
];

const FITNESS_OPTIONS = [
  { value: 'FIT', label: 'Fit' },
  { value: 'FIT_WITH_RESTRICTIONS', label: 'Fit with restrictions' },
  { value: 'TEMPORARILY_UNFIT', label: 'Temporarily unfit' },
  { value: 'UNFIT', label: 'Unfit' },
];

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
function daysUntil(d: string): number {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000);
}

export default function MedicalExamsPage() {
  const [rows, setRows] = useState<MedicalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [filterCompany, setFilterCompany] = useState('');
  const [filterHazardOnly, setFilterHazardOnly] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<MedicalRow | null>(null);
  const [form, setForm] = useState<FormState>(blank);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) =>
        setCompanies(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      )
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    if (!form.companyId) {
      setEmployees([]);
      return;
    }
    fetch(`/api/backend/hr/employees?companyId=${form.companyId}&employmentStatus=ACTIVE&limit=500`)
      .then((r) => r.json())
      .then((j) =>
        setEmployees(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      )
      .catch(() => setEmployees([]));
  }, [form.companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterCompany) params.set('companyId', filterCompany);
    if (filterHazardOnly) params.set('hazardOnly', 'true');
    const r = await fetch(`/api/backend/hr/medical-exam-records?${params}`);
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  }, [filterCompany, filterHazardOnly]);
  useEffect(() => {
    load();
  }, [load]);

  const expiringSoon = useMemo(
    () =>
      rows.filter((r) => {
        const days = daysUntil(r.expiresAt);
        return days <= 30 && days >= 0;
      }),
    [rows],
  );
  const expired = useMemo(() => rows.filter((r) => daysUntil(r.expiresAt) < 0), [rows]);
  const unfit = useMemo(
    () =>
      rows.filter((r) => r.fitnessStatus === 'UNFIT' || r.fitnessStatus === 'TEMPORARILY_UNFIT'),
    [rows],
  );

  const openCreate = () => {
    setEditing(null);
    setForm(blank);
    setError('');
    setShowModal(true);
  };
  const openEdit = (row: MedicalRow) => {
    setEditing(row);
    setForm({
      companyId: row.companyId,
      employeeId: row.employeeId,
      examType: row.examType,
      examDate: row.examDate.slice(0, 10),
      expiresAt: row.expiresAt.slice(0, 10),
      fitnessStatus: row.fitnessStatus,
      doctorName: row.doctorName ?? '',
      facilityName: row.facilityName ?? '',
      hazardSector: row.hazardSector,
      restrictions: row.restrictions ?? '',
      notes: row.notes ?? '',
    });
    setError('');
    setShowModal(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.companyId || !form.employeeId || !form.examDate || !form.expiresAt) {
      setError('Company, employee, exam date and expiry are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        companyId: form.companyId,
        employeeId: form.employeeId,
        examType: form.examType,
        examDate: form.examDate,
        expiresAt: form.expiresAt,
        fitnessStatus: form.fitnessStatus,
        hazardSector: form.hazardSector,
      };
      if (form.doctorName) body.doctorName = form.doctorName;
      if (form.facilityName) body.facilityName = form.facilityName;
      if (form.restrictions) body.restrictions = form.restrictions;
      if (form.notes) body.notes = form.notes;
      const url = editing
        ? `/api/backend/hr/medical-exam-records/${editing.id}`
        : '/api/backend/hr/medical-exam-records';
      const method = editing ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? 'Save failed'),
        );
      }
      setShowModal(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await fetch(`/api/backend/hr/medical-exam-records/${deleteId}`, { method: 'DELETE' });
    setDeleteId(null);
    load();
  };

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Medical Exam Records"
        subtitle="Periodic occupational health examinations — required annually for hazard-sector employees (petroleum, mining, food handling, drivers)."
        breadcrumbs={[{ label: 'HR', href: '/hr' }, { label: 'Medical exams' }]}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {expired.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
            <strong>⚠ {expired.length} expired</strong> — schedule renewal exams immediately.
          </div>
        )}
        {expiringSoon.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
            <strong>{expiringSoon.length} expiring within 30 days</strong> — book renewal
            appointments.
          </div>
        )}
        {unfit.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800">
            <strong>{unfit.length} unfit</strong> — review work assignments and accommodations.
          </div>
        )}
      </div>

      <PageToolbar
        filters={
          <>
            <FormSelect
              value={filterCompany}
              onChange={(e) => setFilterCompany(e.target.value)}
              options={[
                { value: '', label: 'All companies' },
                ...companies.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <label
              className="flex items-center gap-2 text-sm"
              style={{ color: 'var(--aurora-text)' }}
            >
              <input
                type="checkbox"
                checked={filterHazardOnly}
                onChange={(e) => setFilterHazardOnly(e.target.checked)}
                className="rounded"
              />
              Hazard-sector only
            </label>
          </>
        }
        actions={
          <Btn variant="primary" onClick={openCreate}>
            + New medical exam
          </Btn>
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">
            No medical exam records found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead
                className="bg-slate-50 border-b border-slate-100"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Employee
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Type
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Exam date
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Expires
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Fitness
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Doctor
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map((r) => {
                  const days = daysUntil(r.expiresAt);
                  const expClass =
                    days < 0
                      ? 'text-red-700 font-semibold'
                      : days <= 30
                        ? 'text-amber-700 font-semibold'
                        : '';
                  return (
                    <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-2">
                        <div className="font-medium">
                          {r.employee?.fullName ??
                            `${r.employee?.firstName} ${r.employee?.lastName}`}
                        </div>
                        <div className="text-xs font-mono text-slate-500">
                          {r.employee?.employeeCode}
                          {r.hazardSector && (
                            <span className="ml-1 text-red-600">· hazard sector</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-xs">{r.examType.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-2 text-sm">{fmtDate(r.examDate)}</td>
                      <td className={`px-4 py-2 text-sm ${expClass}`}>
                        {fmtDate(r.expiresAt)}
                        {days >= 0 && days <= 30 && <span className="ml-1 text-xs">({days}d)</span>}
                        {days < 0 && <span className="ml-1 text-xs">({-days}d ago)</span>}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={r.fitnessStatus} />
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {r.doctorName ?? '—'}
                        {r.facilityName && <div className="text-slate-400">{r.facilityName}</div>}
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <Btn variant="ghost" size="xs" onClick={() => openEdit(r)}>
                          Edit
                        </Btn>
                        <Btn variant="ghost" size="xs" onClick={() => setDeleteId(r.id)}>
                          Delete
                        </Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit medical exam' : 'New medical exam'}
        size="lg"
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setShowModal(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" type="submit" form="medical-form" loading={saving}>
              Save
            </Btn>
          </>
        }
      >
        <form id="medical-form" onSubmit={submit} className="space-y-3">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <FormSelect
              label="Company *"
              value={form.companyId}
              onChange={(e) =>
                setForm((p) => ({ ...p, companyId: e.target.value, employeeId: '' }))
              }
              options={companies.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))}
              placeholder="Select"
              disabled={!!editing}
            />
            <FormSelect
              label="Employee *"
              value={form.employeeId}
              onChange={(e) => setForm((p) => ({ ...p, employeeId: e.target.value }))}
              options={employees.map((e) => ({
                value: e.id,
                label: `${e.employeeCode} — ${e.fullName ?? `${e.firstName} ${e.lastName}`}`,
              }))}
              placeholder={form.companyId ? 'Select' : 'Pick company first'}
              disabled={!form.companyId || !!editing}
            />
            <FormSelect
              label="Exam type"
              value={form.examType}
              onChange={(e) => setForm((p) => ({ ...p, examType: e.target.value }))}
              options={TYPE_OPTIONS}
            />
            <FormSelect
              label="Fitness status"
              value={form.fitnessStatus}
              onChange={(e) => setForm((p) => ({ ...p, fitnessStatus: e.target.value }))}
              options={FITNESS_OPTIONS}
            />
            <FormInput
              label="Exam date *"
              type="date"
              value={form.examDate}
              onChange={(e) => setForm((p) => ({ ...p, examDate: e.target.value }))}
              required
            />
            <FormInput
              label="Expires *"
              type="date"
              value={form.expiresAt}
              onChange={(e) => setForm((p) => ({ ...p, expiresAt: e.target.value }))}
              required
            />
            <FormInput
              label="Doctor name"
              value={form.doctorName}
              onChange={(e) => setForm((p) => ({ ...p, doctorName: e.target.value }))}
            />
            <FormInput
              label="Facility / hospital"
              value={form.facilityName}
              onChange={(e) => setForm((p) => ({ ...p, facilityName: e.target.value }))}
            />
            <div className="col-span-2 flex items-center gap-2 pt-2">
              <input
                id="hazard-sector"
                type="checkbox"
                checked={form.hazardSector}
                onChange={(e) => setForm((p) => ({ ...p, hazardSector: e.target.checked }))}
                className="rounded"
              />
              <label
                htmlFor="hazard-sector"
                className="text-sm"
                style={{ color: 'var(--aurora-text)' }}
              >
                Hazard-sector employee (petroleum / mining / driver / chemical exposure)
              </label>
            </div>
            <div className="col-span-2">
              <FormInput
                label="Restrictions"
                value={form.restrictions}
                onChange={(e) => setForm((p) => ({ ...p, restrictions: e.target.value }))}
                hint="e.g. no heavy lifting, no night work"
              />
            </div>
            <div className="col-span-2">
              <FormInput
                label="Notes"
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete medical exam record"
        message="Soft-delete this record? Audit trail is retained but the row will no longer appear in lists."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
