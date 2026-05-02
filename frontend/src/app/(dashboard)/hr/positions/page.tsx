'use client';

import { useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, FormInput, FormSelect, ConfirmDialog, Modal, Btn, PageSpinner } from '@/components/ui';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface Position {
  id: string;
  code: string;
  title: string;
  type?: string;
  defaultSalary?: number;
  status: string;
}

interface FormState {
  code: string;
  title: string;
  type: string;
  defaultSalary: string;
  status: string;
}

const empty: FormState = { code: '', title: '', type: 'FULL_TIME', defaultSalary: '', status: 'ACTIVE' };

export default function PositionsPage() {
  const [rows, setRows] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Position | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/backend/hr/positions');
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setShowModal(true); };
  const openEdit = (p: Position) => {
    setEditing(p);
    setForm({ code: p.code, title: p.title, type: p.type ?? 'FULL_TIME', defaultSalary: String(p.defaultSalary ?? ''), status: p.status });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const url = editing ? `/api/backend/hr/positions/${editing.id}` : '/api/backend/hr/positions';
    await fetch(url, {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, defaultSalary: form.defaultSalary ? Number(form.defaultSalary) : undefined }),
    });
    setSaving(false);
    setShowModal(false);
    load();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await fetch(`/api/backend/hr/positions/${deleteId}`, { method: 'DELETE' });
    setDeleteId(null);
    load();
  };

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="p-6">
      <PageHeader
        title="Positions"
        subtitle="Job positions and employment types"
        actions={<Btn variant="primary" onClick={openCreate}>+ Add Position</Btn>}
      />
      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead style={{ color: 'var(--aurora-text-muted)' }} className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls}>Code</th>
                  <th className={thCls}>Title</th>
                  <th className={thCls}>Type</th>
                  <th className={thCls}>Default Salary</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map(p => (
                  <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-mono`}>{p.code}</td>
                    <td className={`${tdCls} font-medium`}>{p.title}</td>
                    <td className={tdCls}>{p.type ?? '—'}</td>
                    <td className={tdCls}>{p.defaultSalary != null ? `TZS ${Number(p.defaultSalary).toLocaleString('en-TZ')}` : '—'}</td>
                    <td className={tdCls}><StatusBadge status={p.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-2">
                        <Btn variant="ghost" size="xs" onClick={() => openEdit(p)}>Edit</Btn>
                        <Btn variant="danger" size="xs" onClick={() => setDeleteId(p.id)}>Delete</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No positions found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Position' : 'New Position'}
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" type="submit" form="position-form" loading={saving}>Save</Btn>
          </>
        }
      >
        <form id="position-form" onSubmit={handleSubmit} className="space-y-3">
          <FormInput label="Code" value={form.code} onChange={f('code')} required />
          <FormInput label="Title" value={form.title} onChange={f('title')} required />
          <FormSelect label="Type" value={form.type} onChange={f('type')}
            options={[
              { value: 'FULL_TIME', label: 'Full Time' },
              { value: 'PART_TIME', label: 'Part Time' },
              { value: 'CONTRACT', label: 'Contract' },
              { value: 'CASUAL', label: 'Casual' },
            ]} />
          <FormInput label="Default Salary (TZS)" type="number" value={form.defaultSalary} onChange={f('defaultSalary')} />
          <FormSelect label="Status" value={form.status} onChange={f('status')}
            options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Position"
        message="Are you sure you want to delete this position?"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
