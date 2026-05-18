'use client';

import { useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, FormInput, FormSelect, ConfirmDialog, Modal, Btn, PageSpinner } from '@/components/ui';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface AllowanceType {
  id: string;
  name: string;
  code: string;
  isTaxable: boolean;
  defaultAmount?: number;
  isActive: boolean;
}

interface FormState {
  name: string;
  code: string;
  isTaxable: string;
  defaultAmount: string;
  isActive: string;
}

const empty: FormState = { name: '', code: '', isTaxable: 'false', defaultAmount: '', isActive: 'true' };

export default function AllowanceTypesPage() {
  const [rows, setRows] = useState<AllowanceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<AllowanceType | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/backend/hr/allowance-types');
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setShowModal(true); };
  const openEdit = (a: AllowanceType) => {
    setEditing(a);
    setForm({ name: a.name, code: a.code, isTaxable: String(a.isTaxable), defaultAmount: String(a.defaultAmount ?? ''), isActive: String(a.isActive) });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const url = editing ? `/api/backend/hr/allowance-types/${editing.id}` : '/api/backend/hr/allowance-types';
    await fetch(url, {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, isTaxable: form.isTaxable === 'true', isActive: form.isActive === 'true', defaultAmount: form.defaultAmount ? Number(form.defaultAmount) : undefined }),
    });
    setSaving(false);
    setShowModal(false);
    load();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await fetch(`/api/backend/hr/allowance-types/${deleteId}`, { method: 'DELETE' });
    setDeleteId(null);
    load();
  };

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const bool = (v: boolean) => v ? <span className="text-green-600 text-xs font-medium">Yes</span> : <span className="text-slate-400 text-xs">No</span>;

  return (
    <div className="p-6">
      <PageHeader
        title="Allowance Types"
        subtitle="Configure employee allowance categories"
      />
      <PageToolbar actions={<Btn variant="primary" onClick={openCreate}>+ Add Allowance Type</Btn>} />
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
                  <th className={thCls}>Taxable</th>
                  <th className={thCls}>Default Amount</th>
                  <th className={thCls}>Active</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map(a => (
                  <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`}>{a.name}</td>
                    <td className={`${tdCls} font-mono`}>{a.code}</td>
                    <td className={tdCls}>{bool(a.isTaxable)}</td>
                    <td className={tdCls}>{a.defaultAmount != null ? `TZS ${(Number.isFinite(Number(a.defaultAmount)) ? Number(a.defaultAmount).toLocaleString('en-TZ') : '0')}` : '—'}</td>
                    <td className={tdCls}>{bool(a.isActive)}</td>
                    <td className={tdCls}>
                      <div className="flex gap-2">
                        <Btn variant="ghost" size="xs" onClick={() => openEdit(a)}>Edit</Btn>
                        <Btn variant="danger" size="xs" onClick={() => setDeleteId(a.id)}>Delete</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No allowance types found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Allowance Type' : 'New Allowance Type'}
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" type="submit" form="allowance-type-form" loading={saving}>Save</Btn>
          </>
        }
      >
        <form id="allowance-type-form" onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Name" value={form.name} onChange={f('name')} required />
            <FormInput label="Code" value={form.code} onChange={f('code')} required />
          </div>
          <FormInput label="Default Amount (TZS)" type="number" value={form.defaultAmount} onChange={f('defaultAmount')} />
          <div className="grid grid-cols-2 gap-3">
            <FormSelect label="Taxable?" value={form.isTaxable} onChange={f('isTaxable')}
              options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
            <FormSelect label="Active?" value={form.isActive} onChange={f('isActive')}
              options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={!!deleteId} title="Delete Allowance Type" message="Delete this allowance type?" onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />
    </div>
  );
}
