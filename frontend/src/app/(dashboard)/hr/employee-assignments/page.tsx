'use client';

import { useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatusBadge, FormInput, FormSelect, ConfirmDialog, Modal, Btn, PageSpinner, showToast } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useAuth } from '@/hooks/use-auth';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface Assignment {
  id: string;
  employee?: string | { fullName?: string; employeeCode?: string };
  employeeId?: string;
  assignmentContextType?: string;
  company?: string | { id?: string; name?: string };
  companyId?: string;
  divisionId?: string | null;
  branchId?: string | null;
  startDate?: string;
  endDate?: string;
  status: string;
}

interface FormState {
  employeeId: string;
  contextType: string;
  companyId: string;
  branchId: string;
  divisionId: string;
  startDate: string;
  endDate: string;
  status: string;
}

const empty: FormState = { employeeId: '', contextType: 'COMPANY', companyId: '', branchId: '', divisionId: '', startDate: '', endDate: '', status: 'ACTIVE' };

export default function EmployeeAssignmentsPage() {
  const [rows, setRows] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Assignment | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { companyOptions, branchOptions, divisionOptions, employeeOptions } = useOrgScope(form.companyId);
  const { user } = useAuth();

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/backend/hr/employee-assignments');
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setShowModal(true); };
  const openEdit = (a: Assignment) => {
    setEditing(a);
    setForm({
      employeeId: a.employeeId ?? '',
      contextType: a.assignmentContextType ?? 'COMPANY',
      companyId: (typeof a.company === 'object' ? a.company?.id : undefined) ?? a.companyId ?? '',
      branchId: a.branchId ?? '',
      divisionId: a.divisionId ?? '',
      startDate: a.startDate ? a.startDate.slice(0, 10) : '',
      endDate: a.endDate ? a.endDate.slice(0, 10) : '',
      status: a.status,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload: Record<string, unknown> = {
      employeeId: form.employeeId,
      companyId: form.companyId,
      assignmentContextType: form.contextType,
      divisionId: form.divisionId || undefined,
      branchId: form.branchId || undefined,
      startDate: form.startDate,
      endDate: form.endDate || undefined,
      status: form.status,
    };
    if (!editing) payload.createdById = user?.id;
    const url = editing ? `/api/backend/hr/employee-assignments/${editing.id}` : '/api/backend/hr/employee-assignments';
    try {
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showToast('error', 'Save failed', Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? 'Could not save the assignment.'));
        return;
      }
      setShowModal(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const res = await fetch(`/api/backend/hr/employee-assignments/${deleteId}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast('error', 'Delete failed', Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? 'Could not delete the assignment.'));
    }
    setDeleteId(null);
    load();
  };

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="p-6">
      <PageHeader
        title="Employee Assignments"
        subtitle="Manage employee context and company assignments"
      />
      <PageToolbar actions={<Btn variant="primary" onClick={openCreate}>+ Add Assignment</Btn>} />
      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100" style={{ color: 'var(--aurora-text-muted)' }}>
                <tr>
                  <th className={thCls}>Employee</th>
                  <th className={thCls}>Context Type</th>
                  <th className={thCls}>Company</th>
                  <th className={thCls}>Start Date</th>
                  <th className={thCls}>End Date</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map(a => (
                  <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`}>
                      {typeof a.employee === 'string'
                        ? a.employee
                        : (a.employee?.fullName ?? a.employee?.employeeCode ?? a.employeeId ?? '—')}
                    </td>
                    <td className={tdCls}>{a.assignmentContextType ?? '—'}</td>
                    <td className={tdCls}>{typeof a.company === 'string' ? a.company : (a.company?.name ?? '—')}</td>
                    <td className={tdCls}>{a.startDate ? new Date(a.startDate).toLocaleDateString('en-GB') : '—'}</td>
                    <td className={tdCls}>{a.endDate ? new Date(a.endDate).toLocaleDateString('en-GB') : '—'}</td>
                    <td className={tdCls}><StatusBadge status={a.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-2">
                        <Btn variant="ghost" size="xs" onClick={() => openEdit(a)}>Edit</Btn>
                        <Btn variant="danger" size="xs" onClick={() => setDeleteId(a.id)}>Delete</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No assignments found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Assignment' : 'New Assignment'}
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" type="submit" form="assignment-form" loading={saving}>Save</Btn>
          </>
        }
      >
        <form id="assignment-form" onSubmit={handleSubmit} className="space-y-3">
          <FormSelect label="Company" required value={form.companyId}
            onChange={(e) => setForm(p => ({ ...p, companyId: e.target.value, employeeId: '', branchId: '', divisionId: '' }))}
            options={companyOptions} placeholder="Select company" />
          <FormSelect label="Employee" required value={form.employeeId} onChange={f('employeeId')}
            options={employeeOptions} placeholder={form.companyId ? 'Select employee' : 'Select company first'} />
          <FormSelect label="Context Type" value={form.contextType} onChange={f('contextType')}
            options={[
              { value: 'COMPANY', label: 'Company' },
              { value: 'DIVISION', label: 'Division' },
              { value: 'BRANCH', label: 'Branch' },
              { value: 'OTHER', label: 'Other' },
            ]} />
          <FormSelect label="Branch" value={form.branchId} onChange={f('branchId')}
            options={branchOptions} placeholder={form.companyId ? 'Select branch' : 'Select company first'} />
          <FormSelect label="Division" value={form.divisionId} onChange={f('divisionId')}
            options={divisionOptions} placeholder={form.companyId ? 'Select division' : 'Select company first'} />
          <FormInput label="Start Date" type="date" value={form.startDate} onChange={f('startDate')} required />
          <FormInput label="End Date" type="date" value={form.endDate} onChange={f('endDate')} />
          <FormSelect label="Status" value={form.status} onChange={f('status')}
            options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} />
        </form>
      </Modal>

      <ConfirmDialog open={!!deleteId} title="Delete Assignment" message="Delete this assignment?" onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />
    </div>
  );
}
