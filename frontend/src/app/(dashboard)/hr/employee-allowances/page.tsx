'use client';

import { useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatusBadge, FormInput, FormSelect, ConfirmDialog, Modal, Btn, PageSpinner, showToast } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface EmployeeAllowance {
  id: string;
  employee?: string | { fullName?: string; employeeCode?: string };
  employeeId?: string;
  companyId?: string;
  allowanceType?: string | { name?: string; code?: string };
  allowanceTypeId?: string;
  amount: number;
  effectiveFrom?: string;
  effectiveTo?: string;
  status: string;
}

interface FormState {
  companyId: string;
  employeeId: string;
  allowanceTypeId: string;
  amount: string;
  effectiveFrom: string;
  effectiveTo: string;
  status: string;
}

const empty: FormState = { companyId: '', employeeId: '', allowanceTypeId: '', amount: '', effectiveFrom: '', effectiveTo: '', status: 'ACTIVE' };

export default function EmployeeAllowancesPage() {
  const [rows, setRows] = useState<EmployeeAllowance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<EmployeeAllowance | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { companyOptions, employeeOptions } = useOrgScope(form.companyId, { skipBranches: true, skipDivisions: true });
  const [typeOptions, setTypeOptions] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    if (!form.companyId) { setTypeOptions([]); return; }
    let cancelled = false;
    fetch(`/api/backend/hr/allowance-types?companyId=${form.companyId}&limit=200`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        const list = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
        setTypeOptions(list.map((t: { id: string; name?: string; code?: string }) => ({ value: t.id, label: t.name ?? t.code ?? t.id })));
      })
      .catch(() => { if (!cancelled) setTypeOptions([]); });
    return () => { cancelled = true; };
  }, [form.companyId]);

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/backend/hr/employee-allowances');
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setShowModal(true); };
  const openEdit = (a: EmployeeAllowance) => {
    setEditing(a);
    setForm({
      companyId: a.companyId ?? '',
      employeeId: a.employeeId ?? '',
      allowanceTypeId: a.allowanceTypeId ?? '',
      amount: String(a.amount),
      effectiveFrom: a.effectiveFrom ? a.effectiveFrom.slice(0, 10) : '',
      effectiveTo: a.effectiveTo ? a.effectiveTo.slice(0, 10) : '',
      status: a.status,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const url = editing ? `/api/backend/hr/employee-allowances/${editing.id}` : '/api/backend/hr/employee-allowances';
    try {
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: form.companyId,
          employeeId: form.employeeId,
          allowanceTypeId: form.allowanceTypeId,
          amount: Number(form.amount),
          effectiveFrom: form.effectiveFrom,
          effectiveTo: form.effectiveTo || undefined,
          status: form.status,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showToast('error', 'Save failed', Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? 'Could not save the allowance.'));
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
    const res = await fetch(`/api/backend/hr/employee-allowances/${deleteId}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast('error', 'Delete failed', Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? 'Could not delete the allowance.'));
    }
    setDeleteId(null);
    load();
  };

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="p-6">
      <PageHeader
        title="Employee Allowances"
        subtitle="Manage per-employee allowances"
      />
      <PageToolbar actions={<Btn variant="primary" onClick={openCreate}>+ Add Allowance</Btn>} />
      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100" style={{ color: 'var(--aurora-text-muted)' }}>
                <tr>
                  <th className={thCls}>Employee</th>
                  <th className={thCls}>Allowance Type</th>
                  <th className={thCls}>Amount</th>
                  <th className={thCls}>Effective From</th>
                  <th className={thCls}>Effective To</th>
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
                    <td className={tdCls}>
                      {typeof a.allowanceType === 'string'
                        ? a.allowanceType
                        : (a.allowanceType?.name ?? a.allowanceType?.code ?? a.allowanceTypeId ?? '—')}
                    </td>
                    <td className={tdCls}>TZS {(Number.isFinite(Number(a.amount)) ? Number(a.amount).toLocaleString('en-TZ') : '0')}</td>
                    <td className={tdCls}>{a.effectiveFrom ? new Date(a.effectiveFrom).toLocaleDateString('en-GB') : '—'}</td>
                    <td className={tdCls}>{a.effectiveTo ? new Date(a.effectiveTo).toLocaleDateString('en-GB') : '—'}</td>
                    <td className={tdCls}><StatusBadge status={a.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-2">
                        <Btn variant="ghost" size="xs" onClick={() => openEdit(a)}>Edit</Btn>
                        <Btn variant="danger" size="xs" onClick={() => setDeleteId(a.id)}>Delete</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No allowances found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Allowance' : 'Add Allowance'}
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" type="submit" form="employee-allowance-form" loading={saving}>Save</Btn>
          </>
        }
      >
        <form id="employee-allowance-form" onSubmit={handleSubmit} className="space-y-3">
          <FormSelect label="Company" required value={form.companyId}
            onChange={(e) => setForm(p => ({ ...p, companyId: e.target.value, employeeId: '' }))}
            options={companyOptions} placeholder="Select company" />
          <FormSelect label="Employee" required value={form.employeeId} onChange={f('employeeId')}
            options={employeeOptions} placeholder={form.companyId ? 'Select employee' : 'Select company first'} />
          <FormSelect label="Allowance Type" required value={form.allowanceTypeId} onChange={f('allowanceTypeId')}
            options={typeOptions} placeholder={form.companyId ? 'Select allowance type' : 'Select company first'} />
          <FormInput label="Amount (TZS)" type="number" value={form.amount} onChange={f('amount')} required />
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Effective From" type="date" value={form.effectiveFrom} onChange={f('effectiveFrom')} required />
            <FormInput label="Effective To" type="date" value={form.effectiveTo} onChange={f('effectiveTo')} />
          </div>
          <FormSelect label="Status" value={form.status} onChange={f('status')}
            options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} />
        </form>
      </Modal>

      <ConfirmDialog open={!!deleteId} title="Delete Allowance" message="Delete this employee allowance?" onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />
    </div>
  );
}
