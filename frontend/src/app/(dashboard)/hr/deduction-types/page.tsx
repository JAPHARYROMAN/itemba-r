'use client';

import { useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, FormInput, FormSelect, ConfirmDialog, Modal, Btn, PageSpinner, showToast } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface DeductionType {
  id: string;
  name: string;
  code: string;
  companyId?: string;
  statutory: boolean;
  defaultAmount?: number;
  defaultPercentage?: number;
  isActive: boolean;
}

interface FormState {
  companyId: string;
  name: string;
  code: string;
  isStatutory: string;
  defaultAmount: string;
  defaultPercentage: string;
  isActive: string;
}

const empty: FormState = { companyId: '', name: '', code: '', isStatutory: 'false', defaultAmount: '', defaultPercentage: '', isActive: 'true' };

export default function DeductionTypesPage() {
  const [rows, setRows] = useState<DeductionType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<DeductionType | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { companyOptions } = useOrgScope(form.companyId, { skipBranches: true, skipDivisions: true, skipEmployees: true });

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/backend/hr/deduction-types');
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setShowModal(true); };
  const openEdit = (d: DeductionType) => {
    setEditing(d);
    setForm({ companyId: d.companyId ?? '', name: d.name, code: d.code, isStatutory: String(d.statutory), defaultAmount: String(d.defaultAmount ?? ''), defaultPercentage: String(d.defaultPercentage ?? ''), isActive: String(d.isActive) });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const url = editing ? `/api/backend/hr/deduction-types/${editing.id}` : '/api/backend/hr/deduction-types';
    try {
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: form.companyId,
          name: form.name,
          code: form.code,
          statutory: form.isStatutory === 'true',
          isActive: form.isActive === 'true',
          defaultAmount: form.defaultAmount ? Number(form.defaultAmount) : undefined,
          defaultPercentage: form.defaultPercentage ? Number(form.defaultPercentage) : undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showToast('error', 'Save failed', Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? 'Could not save the deduction type.'));
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
    const res = await fetch(`/api/backend/hr/deduction-types/${deleteId}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast('error', 'Delete failed', Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? 'Could not delete the deduction type.'));
    }
    setDeleteId(null);
    load();
  };

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const bool = (v: boolean) => v ? <span className="text-green-600 text-xs font-medium">Yes</span> : <span className="text-slate-400 text-xs">No</span>;

  return (
    <div className="p-6">
      <PageHeader
        title="Deduction Types"
        subtitle="Configure payroll deduction categories"
      />
      <PageToolbar actions={<Btn variant="primary" onClick={openCreate}>+ Add Deduction Type</Btn>} />
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
                  <th className={thCls}>Statutory</th>
                  <th className={thCls}>Default Amount</th>
                  <th className={thCls}>Default %</th>
                  <th className={thCls}>Active</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map(d => (
                  <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`}>{d.name}</td>
                    <td className={`${tdCls} font-mono`}>{d.code}</td>
                    <td className={tdCls}>{bool(d.statutory)}</td>
                    <td className={tdCls}>{d.defaultAmount != null ? `TZS ${(Number.isFinite(Number(d.defaultAmount)) ? Number(d.defaultAmount).toLocaleString('en-TZ') : '0')}` : '—'}</td>
                    <td className={tdCls}>{d.defaultPercentage != null ? `${d.defaultPercentage}%` : '—'}</td>
                    <td className={tdCls}>{bool(d.isActive)}</td>
                    <td className={tdCls}>
                      <div className="flex gap-2">
                        <Btn variant="ghost" size="xs" onClick={() => openEdit(d)}>Edit</Btn>
                        <Btn variant="danger" size="xs" onClick={() => setDeleteId(d.id)}>Delete</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No deduction types found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Deduction Type' : 'New Deduction Type'}
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" type="submit" form="deduction-type-form" loading={saving}>Save</Btn>
          </>
        }
      >
        <form id="deduction-type-form" onSubmit={handleSubmit} className="space-y-3">
          <FormSelect label="Company" required value={form.companyId}
            onChange={(e) => setForm(p => ({ ...p, companyId: e.target.value }))}
            options={companyOptions} placeholder="Select company" />
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Name" value={form.name} onChange={f('name')} required />
            <FormInput label="Code" value={form.code} onChange={f('code')} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Default Amount (TZS)" type="number" value={form.defaultAmount} onChange={f('defaultAmount')} />
            <FormInput label="Default %" type="number" value={form.defaultPercentage} onChange={f('defaultPercentage')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormSelect label="Statutory?" value={form.isStatutory} onChange={f('isStatutory')}
              options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
            <FormSelect label="Active?" value={form.isActive} onChange={f('isActive')}
              options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={!!deleteId} title="Delete Deduction Type" message="Delete this deduction type?" onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />
    </div>
  );
}
