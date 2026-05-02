'use client';

import { useCallback, useEffect, useState } from 'react';
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
interface DisputeOption {
  id: string;
  disputeNumber: string;
  type: string;
  status: string;
  employeeId: string;
}

interface ActionRow {
  id: string;
  actionNumber: string;
  companyId: string;
  employeeId: string;
  disputeId: string | null;
  type: string;
  status: string;
  issuedAt: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  reason: string;
  evidence: string | null;
  employeeResponse: string | null;
  notes: string | null;
  employee?: {
    fullName: string | null;
    firstName: string;
    lastName: string;
    employeeCode: string;
  } | null;
  issuedBy?: { fullName: string } | null;
  dispute?: { disputeNumber: string; status: string } | null;
}

const TYPE_OPTIONS = [
  { value: 'VERBAL_WARNING', label: 'Verbal warning' },
  { value: 'WRITTEN_WARNING', label: 'Written warning' },
  { value: 'FINAL_WARNING', label: 'Final warning' },
  { value: 'SUSPENSION_WITH_PAY', label: 'Suspension (with pay)' },
  { value: 'SUSPENSION_WITHOUT_PAY', label: 'Suspension (without pay)' },
  { value: 'DEMOTION', label: 'Demotion' },
  { value: 'TERMINATION', label: 'Termination' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'OVERTURNED', label: 'Overturned' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
];

const blank = {
  companyId: '',
  employeeId: '',
  disputeId: '',
  type: 'VERBAL_WARNING',
  issuedAt: new Date().toISOString().slice(0, 10),
  effectiveFrom: '',
  effectiveTo: '',
  reason: '',
  evidence: '',
  employeeResponse: '',
  notes: '',
};

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function DisciplinaryActionsPage() {
  const [rows, setRows] = useState<ActionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [disputes, setDisputes] = useState<DisputeOption[]>([]);
  const [filterCompany, setFilterCompany] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ActionRow | null>(null);
  const [form, setForm] = useState(blank);
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
    fetch(`/api/backend/hr/employees?companyId=${form.companyId}&limit=500`)
      .then((r) => r.json())
      .then((j) =>
        setEmployees(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      )
      .catch(() => setEmployees([]));
  }, [form.companyId]);

  useEffect(() => {
    if (!form.employeeId) {
      setDisputes([]);
      return;
    }
    fetch(`/api/backend/hr/employment-disputes?employeeId=${form.employeeId}&limit=200`)
      .then((r) => r.json())
      .then((j) =>
        setDisputes(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      )
      .catch(() => setDisputes([]));
  }, [form.employeeId]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterCompany) params.set('companyId', filterCompany);
    if (filterStatus) params.set('status', filterStatus);
    const r = await fetch(`/api/backend/hr/disciplinary-actions?${params}`);
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  }, [filterCompany, filterStatus]);
  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(blank);
    setError('');
    setShowModal(true);
  };
  const openEdit = (row: ActionRow) => {
    setEditing(row);
    setForm({
      companyId: row.companyId,
      employeeId: row.employeeId,
      disputeId: row.disputeId ?? '',
      type: row.type,
      issuedAt: row.issuedAt.slice(0, 10),
      effectiveFrom: row.effectiveFrom?.slice(0, 10) ?? '',
      effectiveTo: row.effectiveTo?.slice(0, 10) ?? '',
      reason: row.reason,
      evidence: row.evidence ?? '',
      employeeResponse: row.employeeResponse ?? '',
      notes: row.notes ?? '',
    });
    setError('');
    setShowModal(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.companyId || !form.employeeId || !form.reason.trim()) {
      setError('Company, employee, and reason are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        companyId: form.companyId,
        employeeId: form.employeeId,
        type: form.type,
        issuedAt: form.issuedAt,
        reason: form.reason.trim(),
      };
      if (form.disputeId) body.disputeId = form.disputeId;
      if (form.effectiveFrom) body.effectiveFrom = form.effectiveFrom;
      if (form.effectiveTo) body.effectiveTo = form.effectiveTo;
      if (form.evidence) body.evidence = form.evidence;
      if (form.employeeResponse) body.employeeResponse = form.employeeResponse;
      if (form.notes) body.notes = form.notes;

      const url = editing
        ? `/api/backend/hr/disciplinary-actions/${editing.id}`
        : '/api/backend/hr/disciplinary-actions';
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
    await fetch(`/api/backend/hr/disciplinary-actions/${deleteId}`, { method: 'DELETE' });
    setDeleteId(null);
    load();
  };

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Disciplinary Actions"
        subtitle="Verbal/written warnings, suspensions, demotions, terminations — full HR audit trail."
        breadcrumbs={[{ label: 'HR', href: '/hr' }, { label: 'Disciplinary actions' }]}
      />

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
            <FormSelect
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              options={[{ value: '', label: 'All statuses' }, ...STATUS_OPTIONS]}
            />
          </>
        }
        actions={
          <Btn variant="primary" onClick={openCreate}>
            + New action
          </Btn>
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">
            No disciplinary actions on file.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead
                className="bg-slate-50 border-b border-slate-100"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Action #
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Employee
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Type
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Issued
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Effective
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Linked dispute
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Status
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-xs">{r.actionNumber}</td>
                    <td className="px-4 py-2">
                      <div className="font-medium">
                        {r.employee?.fullName ?? `${r.employee?.firstName} ${r.employee?.lastName}`}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                        {r.employee?.employeeCode}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs">{r.type.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2 text-xs">{fmtDate(r.issuedAt)}</td>
                    <td className="px-4 py-2 text-xs">
                      {r.effectiveFrom ? fmtDate(r.effectiveFrom) : '—'}
                      {r.effectiveTo && <> → {fmtDate(r.effectiveTo)}</>}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {r.dispute?.disputeNumber ?? '—'}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={r.status} />
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit disciplinary action' : 'New disciplinary action'}
        size="lg"
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setShowModal(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" type="submit" form="action-form" loading={saving}>
              Save
            </Btn>
          </>
        }
      >
        <form id="action-form" onSubmit={submit} className="space-y-3">
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
                setForm((p) => ({ ...p, companyId: e.target.value, employeeId: '', disputeId: '' }))
              }
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Select"
              disabled={!!editing}
            />
            <FormSelect
              label="Employee *"
              value={form.employeeId}
              onChange={(e) =>
                setForm((p) => ({ ...p, employeeId: e.target.value, disputeId: '' }))
              }
              options={employees.map((e) => ({
                value: e.id,
                label: `${e.employeeCode} — ${e.fullName ?? `${e.firstName} ${e.lastName}`}`,
              }))}
              placeholder={form.companyId ? 'Select' : 'Pick company first'}
              disabled={!form.companyId || !!editing}
            />
            <FormSelect
              label="Type"
              value={form.type}
              onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}
              options={TYPE_OPTIONS}
            />
            <FormSelect
              label="Linked dispute (optional)"
              value={form.disputeId}
              onChange={(e) => setForm((p) => ({ ...p, disputeId: e.target.value }))}
              options={[
                { value: '', label: 'None' },
                ...disputes.map((d) => ({
                  value: d.id,
                  label: `${d.disputeNumber} — ${d.type.replace(/_/g, ' ')}`,
                })),
              ]}
              placeholder={form.employeeId ? 'None' : 'Pick employee first'}
              disabled={!form.employeeId}
            />
            <FormInput
              label="Issued on *"
              type="date"
              value={form.issuedAt}
              onChange={(e) => setForm((p) => ({ ...p, issuedAt: e.target.value }))}
              required
            />
            <FormInput
              label="Effective from"
              type="date"
              value={form.effectiveFrom}
              onChange={(e) => setForm((p) => ({ ...p, effectiveFrom: e.target.value }))}
            />
            <FormInput
              label="Effective to"
              type="date"
              value={form.effectiveTo}
              onChange={(e) => setForm((p) => ({ ...p, effectiveTo: e.target.value }))}
              hint="For suspensions / final warnings"
            />
          </div>
          <FormInput
            label="Reason *"
            value={form.reason}
            onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
            required
          />
          <FormInput
            label="Evidence (optional)"
            value={form.evidence}
            onChange={(e) => setForm((p) => ({ ...p, evidence: e.target.value }))}
            hint="Witnesses, documents, references"
          />
          <FormInput
            label="Employee response (optional)"
            value={form.employeeResponse}
            onChange={(e) => setForm((p) => ({ ...p, employeeResponse: e.target.value }))}
          />
          <FormInput
            label="Notes"
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete disciplinary action"
        message="Soft-delete this action? Audit trail is retained but the row will no longer appear in lists."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
