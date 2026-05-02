'use client';

import { useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatusBadge, FormInput, FormSelect, ConfirmDialog, Modal, Btn, PageSpinner } from '@/components/ui';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface WorkShift {
  id: string;
  code: string;
  name: string;
  type: string;
  startTime?: string;
  endTime?: string;
  breakMinutes?: number;
  hoursPerDay?: number;
  status: string;
}

interface FormState {
  code: string;
  name: string;
  type: string;
  startTime: string;
  endTime: string;
  breakMinutes: string;
  hoursPerDay: string;
  status: string;
}

const empty: FormState = { code: '', name: '', type: 'REGULAR', startTime: '08:00', endTime: '17:00', breakMinutes: '60', hoursPerDay: '8', status: 'ACTIVE' };

export default function WorkShiftsPage() {
  const [rows, setRows] = useState<WorkShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<WorkShift | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/backend/hr/work-shifts');
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setShowModal(true); };
  const openEdit = (s: WorkShift) => {
    setEditing(s);
    setForm({ code: s.code, name: s.name, type: s.type, startTime: s.startTime ?? '08:00', endTime: s.endTime ?? '17:00', breakMinutes: String(s.breakMinutes ?? 60), hoursPerDay: String(s.hoursPerDay ?? 8), status: s.status });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const url = editing ? `/api/backend/hr/work-shifts/${editing.id}` : '/api/backend/hr/work-shifts';
    await fetch(url, {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, breakMinutes: Number(form.breakMinutes), hoursPerDay: Number(form.hoursPerDay) }),
    });
    setSaving(false);
    setShowModal(false);
    load();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await fetch(`/api/backend/hr/work-shifts/${deleteId}`, { method: 'DELETE' });
    setDeleteId(null);
    load();
  };

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="p-6">
      <PageHeader
        title="Work Shifts"
        subtitle="Define work shifts and schedules"
      />
      <PageToolbar actions={<Btn variant="primary" onClick={openCreate}>+ Add Shift</Btn>} />
      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100" style={{ color: 'var(--aurora-text-muted)' }}>
                <tr>
                  <th className={thCls}>Code</th>
                  <th className={thCls}>Name</th>
                  <th className={thCls}>Type</th>
                  <th className={thCls}>Start Time</th>
                  <th className={thCls}>End Time</th>
                  <th className={thCls}>Break (min)</th>
                  <th className={thCls}>Hours/Day</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map(s => (
                  <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-mono`}>{s.code}</td>
                    <td className={`${tdCls} font-medium`}>{s.name}</td>
                    <td className={tdCls}>{s.type}</td>
                    <td className={tdCls}>{s.startTime ?? '—'}</td>
                    <td className={tdCls}>{s.endTime ?? '—'}</td>
                    <td className={tdCls}>{s.breakMinutes ?? '—'}</td>
                    <td className={tdCls}>{s.hoursPerDay ?? '—'}</td>
                    <td className={tdCls}><StatusBadge status={s.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-2">
                        <Btn variant="ghost" size="xs" onClick={() => openEdit(s)}>Edit</Btn>
                        <Btn variant="danger" size="xs" onClick={() => setDeleteId(s.id)}>Delete</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={9} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No shifts found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Shift' : 'New Shift'}
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" type="submit" form="work-shift-form" loading={saving}>Save</Btn>
          </>
        }
      >
        <form id="work-shift-form" onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Code" value={form.code} onChange={f('code')} required />
            <FormSelect label="Type" value={form.type} onChange={f('type')}
              options={[{ value: 'REGULAR', label: 'Regular' }, { value: 'NIGHT', label: 'Night' }, { value: 'ROTATING', label: 'Rotating' }, { value: 'SPLIT', label: 'Split' }]} />
          </div>
          <FormInput label="Name" value={form.name} onChange={f('name')} required />
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Start Time" type="time" value={form.startTime} onChange={f('startTime')} />
            <FormInput label="End Time" type="time" value={form.endTime} onChange={f('endTime')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Break (minutes)" type="number" value={form.breakMinutes} onChange={f('breakMinutes')} />
            <FormInput label="Hours / Day" type="number" value={form.hoursPerDay} onChange={f('hoursPerDay')} />
          </div>
          <FormSelect label="Status" value={form.status} onChange={f('status')}
            options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} />
        </form>
      </Modal>

      <ConfirmDialog open={!!deleteId} title="Delete Shift" message="Delete this work shift?" onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />
    </div>
  );
}
