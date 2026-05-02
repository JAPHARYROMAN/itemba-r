'use client';

import { useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatusBadge, FormInput, FormSelect, ConfirmDialog, Modal, Btn, PageSpinner } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface Assignment {
  id: string;
  employee?: string;
  employeeId?: string;
  contextType: string;
  company?: string;
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
    setForm({ employeeId: a.employeeId ?? '', contextType: a.contextType, companyId: a.company ?? '', branchId: '', divisionId: '', startDate: a.startDate ?? '', endDate: a.endDate ?? '', status: a.status });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const url = editing ? `/api/backend/hr/employee-assignments/${editing.id}` : '/api/backend/hr/employee-assignments';
    await fetch(url, {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify((() => {
        const { companyId, ...rest } = form;
        return { ...rest, company: companyId };
      })()),
    });
    setSaving(false);
    setShowModal(false);
    load();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await fetch(`/api/backend/hr/employee-assignments/${deleteId}`, { method: 'DELETE' });
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
                    <td className={`${tdCls} font-medium`}>{a.employee ?? a.employeeId ?? '—'}</td>
                    <td className={tdCls}>{a.contextType}</td>
                    <td className={tdCls}>{a.company ?? '—'}</td>
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
              { value: 'DEPARTMENT', label: 'Department' },
              { value: 'PROJECT', label: 'Project' },
              { value: 'SITE', label: 'Site' },
            ]} />
          <FormSelect label="Branch" value={form.branchId} onChange={f('branchId')}
            options={branchOptions} placeholder={form.companyId ? 'Select branch' : 'Select company first'} />
          <FormSelect label="Division" value={form.divisionId} onChange={f('divisionId')}
            options={divisionOptions} placeholder={form.companyId ? 'Select division' : 'Select company first'} />
          <FormInput label="Start Date" type="date" value={form.startDate} onChange={f('startDate')} />
          <FormInput label="End Date" type="date" value={form.endDate} onChange={f('endDate')} />
          <FormSelect label="Status" value={form.status} onChange={f('status')}
            options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} />
        </form>
      </Modal>

      <ConfirmDialog open={!!deleteId} title="Delete Assignment" message="Delete this assignment?" onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />
    </div>
  );
}
