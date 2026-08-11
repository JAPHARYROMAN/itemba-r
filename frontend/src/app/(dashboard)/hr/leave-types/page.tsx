'use client';

import { useEffect, useState } from 'react';
import { Card, PageHeader, FormInput, FormSelect, ConfirmDialog, Modal, Btn, PageSpinner, PageToolbar, showToast } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface LeaveType {
  id: string;
  name: string;
  code: string;
  companyId?: string;
  paid: boolean;
  annualAllowanceDays?: number;
  carryForwardAllowed: boolean;
  isActive: boolean;
}

interface FormState {
  companyId: string;
  name: string;
  code: string;
  isPaid: string;
  annualDays: string;
  carryForward: string;
  isActive: string;
}

const empty: FormState = { companyId: '', name: '', code: '', isPaid: 'true', annualDays: '', carryForward: 'false', isActive: 'true' };

export default function LeaveTypesPage() {
  const [rows, setRows] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);
  const { companyOptions } = useOrgScope(form.companyId, { skipBranches: true, skipDivisions: true, skipEmployees: true });

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/backend/hr/leave-types');
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setShowModal(true); };
  const openEdit = (lt: LeaveType) => {
    setEditing(lt);
    setForm({ companyId: lt.companyId ?? '', name: lt.name, code: lt.code, isPaid: String(lt.paid), annualDays: String(lt.annualAllowanceDays ?? ''), carryForward: String(lt.carryForwardAllowed), isActive: String(lt.isActive) });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const url = editing ? `/api/backend/hr/leave-types/${editing.id}` : '/api/backend/hr/leave-types';
    try {
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: form.companyId,
          name: form.name,
          code: form.code,
          paid: form.isPaid === 'true',
          carryForwardAllowed: form.carryForward === 'true',
          isActive: form.isActive === 'true',
          annualAllowanceDays: form.annualDays ? Number(form.annualDays) : undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showToast('error', 'Save failed', Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? 'Could not save the leave type.'));
        return;
      }
      setShowModal(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const doToggle = async (lt: LeaveType) => {
    const res = await fetch(`/api/backend/hr/leave-types/${lt.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !lt.isActive }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast('error', 'Update failed', Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? 'Could not update the leave type.'));
    }
    load();
  };

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const bool = (v: boolean) => v ? <span className="text-green-600 font-medium text-xs">Yes</span> : <span className="text-slate-400 text-xs">No</span>;

  return (
    <div className="p-6">
      <PageHeader
        title="Leave Types"
        subtitle="Configure types of employee leave"
      />
      <PageToolbar actions={<Btn variant="primary" onClick={openCreate}>+ Add Leave Type</Btn>} />
      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100" style={{ color: 'var(--aurora-text-muted)' }}>
                <tr>
                  <th className={thCls}>Name</th>
                  <th className={thCls}>Code</th>
                  <th className={thCls}>Paid</th>
                  <th className={thCls}>Annual Days</th>
                  <th className={thCls}>Carry Forward</th>
                  <th className={thCls}>Active</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map(lt => (
                  <tr key={lt.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`}>{lt.name}</td>
                    <td className={`${tdCls} font-mono`}>{lt.code}</td>
                    <td className={tdCls}>{bool(lt.paid)}</td>
                    <td className={tdCls}>{lt.annualAllowanceDays != null ? Number(lt.annualAllowanceDays) : '—'}</td>
                    <td className={tdCls}>{bool(lt.carryForwardAllowed)}</td>
                    <td className={tdCls}>{bool(lt.isActive)}</td>
                    <td className={tdCls}>
                      <div className="flex gap-2">
                        <Btn variant="ghost" size="xs" onClick={() => openEdit(lt)}>Edit</Btn>
                        <Btn variant={lt.isActive ? 'warning' : 'success'} size="xs" onClick={() => doToggle(lt)}>{lt.isActive ? 'Deactivate' : 'Activate'}</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No leave types found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Leave Type' : 'New Leave Type'} footer={<><Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn><Btn variant="primary" type="submit" form="leave-type-form" loading={saving}>Save</Btn></>}>
        <form id="leave-type-form" onSubmit={handleSubmit} className="space-y-3">
          <FormSelect label="Company" required value={form.companyId}
            onChange={(e) => setForm(p => ({ ...p, companyId: e.target.value }))}
            options={companyOptions} placeholder="Select company" />
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Name" value={form.name} onChange={f('name')} required />
            <FormInput label="Code" value={form.code} onChange={f('code')} required />
          </div>
          <FormInput label="Annual Days" type="number" value={form.annualDays} onChange={f('annualDays')} />
          <div className="grid grid-cols-3 gap-3">
            <FormSelect label="Paid?" value={form.isPaid} onChange={f('isPaid')}
              options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
            <FormSelect label="Carry Forward?" value={form.carryForward} onChange={f('carryForward')}
              options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
            <FormSelect label="Active?" value={form.isActive} onChange={f('isActive')}
              options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
          </div>
        </form>
      </Modal>
    </div>
  );
}
