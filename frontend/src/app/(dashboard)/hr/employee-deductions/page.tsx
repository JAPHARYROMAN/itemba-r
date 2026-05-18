'use client';

import { useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatusBadge, FormInput, FormSelect, ConfirmDialog, Modal, Btn, PageSpinner } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface EmployeeDeduction {
  id: string;
  employee?: string;
  employeeId?: string;
  deductionType?: string;
  deductionTypeId?: string;
  amount?: number;
  percentage?: number;
  effectiveFrom?: string;
  effectiveTo?: string;
  status: string;
}

interface FormState {
  companyId: string;
  employeeId: string;
  deductionTypeId: string;
  amount: string;
  percentage: string;
  effectiveFrom: string;
  effectiveTo: string;
  status: string;
}

const empty: FormState = { companyId: '', employeeId: '', deductionTypeId: '', amount: '', percentage: '', effectiveFrom: '', effectiveTo: '', status: 'ACTIVE' };

export default function EmployeeDeductionsPage() {
  const [rows, setRows] = useState<EmployeeDeduction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<EmployeeDeduction | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { companyOptions, employeeOptions } = useOrgScope(form.companyId, { skipBranches: true, skipDivisions: true });

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/backend/hr/employee-deductions');
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setShowModal(true); };
  const openEdit = (d: EmployeeDeduction) => {
    setEditing(d);
    setForm({ companyId: '', employeeId: d.employeeId ?? '', deductionTypeId: d.deductionTypeId ?? '', amount: String(d.amount ?? ''), percentage: String(d.percentage ?? ''), effectiveFrom: d.effectiveFrom ?? '', effectiveTo: d.effectiveTo ?? '', status: d.status });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const url = editing ? `/api/backend/hr/employee-deductions/${editing.id}` : '/api/backend/hr/employee-deductions';
    await fetch(url, {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(() => { const { companyId: _c, ...rest } = form; void _c; return rest; })(), amount: form.amount ? Number(form.amount) : undefined, percentage: form.percentage ? Number(form.percentage) : undefined }),
    });
    setSaving(false);
    setShowModal(false);
    load();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await fetch(`/api/backend/hr/employee-deductions/${deleteId}`, { method: 'DELETE' });
    setDeleteId(null);
    load();
  };

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="p-6">
      <PageHeader
        title="Employee Deductions"
        subtitle="Manage per-employee payroll deductions"
      />
      <PageToolbar actions={<Btn variant="primary" onClick={openCreate}>+ Add Deduction</Btn>} />
      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100" style={{ color: 'var(--aurora-text-muted)' }}>
                <tr>
                  <th className={thCls}>Employee</th>
                  <th className={thCls}>Deduction Type</th>
                  <th className={thCls}>Amount</th>
                  <th className={thCls}>%</th>
                  <th className={thCls}>Effective From</th>
                  <th className={thCls}>Effective To</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map(d => (
                  <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`}>{d.employee ?? d.employeeId ?? '—'}</td>
                    <td className={tdCls}>{d.deductionType ?? d.deductionTypeId ?? '—'}</td>
                    <td className={tdCls}>{d.amount != null ? `TZS ${(Number.isFinite(Number(d.amount)) ? Number(d.amount).toLocaleString('en-TZ') : '0')}` : '—'}</td>
                    <td className={tdCls}>{d.percentage != null ? `${d.percentage}%` : '—'}</td>
                    <td className={tdCls}>{d.effectiveFrom ? new Date(d.effectiveFrom).toLocaleDateString('en-GB') : '—'}</td>
                    <td className={tdCls}>{d.effectiveTo ? new Date(d.effectiveTo).toLocaleDateString('en-GB') : '—'}</td>
                    <td className={tdCls}><StatusBadge status={d.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-2">
                        <Btn variant="ghost" size="xs" onClick={() => openEdit(d)}>Edit</Btn>
                        <Btn variant="danger" size="xs" onClick={() => setDeleteId(d.id)}>Delete</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No deductions found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Deduction' : 'Add Deduction'}
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" type="submit" form="employee-deduction-form" loading={saving}>Save</Btn>
          </>
        }
      >
        <form id="employee-deduction-form" onSubmit={handleSubmit} className="space-y-3">
          <FormSelect label="Company" required value={form.companyId}
            onChange={(e) => setForm(p => ({ ...p, companyId: e.target.value, employeeId: '' }))}
            options={companyOptions} placeholder="Select company" />
          <FormSelect label="Employee" required value={form.employeeId} onChange={f('employeeId')}
            options={employeeOptions} placeholder={form.companyId ? 'Select employee' : 'Select company first'} />
          <FormInput label="Deduction Type ID" value={form.deductionTypeId} onChange={f('deductionTypeId')} required />
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Amount (TZS)" type="number" value={form.amount} onChange={f('amount')} />
            <FormInput label="Percentage (%)" type="number" value={form.percentage} onChange={f('percentage')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Effective From" type="date" value={form.effectiveFrom} onChange={f('effectiveFrom')} />
            <FormInput label="Effective To" type="date" value={form.effectiveTo} onChange={f('effectiveTo')} />
          </div>
          <FormSelect label="Status" value={form.status} onChange={f('status')}
            options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} />
        </form>
      </Modal>

      <ConfirmDialog open={!!deleteId} title="Delete Deduction" message="Delete this employee deduction?" onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />
    </div>
  );
}
