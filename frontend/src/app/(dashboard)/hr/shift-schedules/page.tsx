'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Card,
  PageHeader,
  StatusBadge,
  FormInput,
  FormSelect,
  Modal,
  Btn,
  PageToolbar,
  PageSpinner,
} from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface Schedule {
  id: string;
  employee?: string;
  employeeId?: string;
  shift?: string;
  shiftId?: string;
  date?: string;
  status: string;
}

interface FormState {
  companyId: string;
  employeeId: string;
  shiftId: string;
  date: string;
  status: string;
}

const empty: FormState = {
  companyId: '',
  employeeId: '',
  shiftId: '',
  date: '',
  status: 'SCHEDULED',
};

export default function ShiftSchedulesPage() {
  const [rows, setRows] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const { companyOptions, employeeOptions } = useOrgScope(form.companyId, {
    skipBranches: true,
    skipDivisions: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    const r = await fetch(`/api/backend/hr/shift-schedules?${params}`);
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(empty);
    setShowModal(true);
  };
  const openEdit = (s: Schedule) => {
    setEditing(s);
    setForm({
      companyId: '',
      employeeId: s.employeeId ?? '',
      shiftId: s.shiftId ?? '',
      date: s.date ?? '',
      status: s.status,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const url = editing
      ? `/api/backend/hr/shift-schedules/${editing.id}`
      : '/api/backend/hr/shift-schedules';
    await fetch(url, {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        (() => {
          const { companyId: _c, ...rest } = form;
          void _c;
          return rest;
        })(),
      ),
    });
    setSaving(false);
    setShowModal(false);
    load();
  };

  const doCancel = async (id: string) => {
    await fetch(`/api/backend/hr/shift-schedules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'CANCELLED' }),
    });
    load();
  };

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="p-6">
      <PageHeader title="Shift Schedules" subtitle="Employee shift scheduling" />
      <PageToolbar
        filters={
          <>
            <label className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              From
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
              style={{
                borderColor: 'var(--aurora-border)',
                background: 'var(--aurora-card)',
                color: 'var(--aurora-text)',
              }}
            />
            <label className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              To
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
              style={{
                borderColor: 'var(--aurora-border)',
                background: 'var(--aurora-card)',
                color: 'var(--aurora-text)',
              }}
            />
          </>
        }
        actions={
          <Btn variant="primary" onClick={openCreate}>
            + Schedule Shift
          </Btn>
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead
                className="bg-slate-50 border-b border-slate-100"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <tr>
                  <th className={thCls}>Employee</th>
                  <th className={thCls}>Shift</th>
                  <th className={thCls}>Date</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map((s) => (
                  <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`}>{s.employee ?? s.employeeId ?? '—'}</td>
                    <td className={tdCls}>{s.shift ?? s.shiftId ?? '—'}</td>
                    <td className={tdCls}>
                      {s.date ? new Date(s.date).toLocaleDateString('en-GB') : '—'}
                    </td>
                    <td className={tdCls}>
                      <StatusBadge status={s.status} />
                    </td>
                    <td className={tdCls}>
                      <div className="flex gap-2">
                        <Btn variant="ghost" size="xs" onClick={() => openEdit(s)}>
                          Edit
                        </Btn>
                        {s.status !== 'CANCELLED' && (
                          <Btn variant="danger" size="xs" onClick={() => doCancel(s.id)}>
                            Cancel
                          </Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="text-center py-8 text-sm"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      No schedules found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Schedule' : 'New Schedule'}
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setShowModal(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" type="submit" form="shift-schedule-form" loading={saving}>
              Save
            </Btn>
          </>
        }
      >
        <form id="shift-schedule-form" onSubmit={handleSubmit} className="space-y-3">
          <FormSelect
            label="Company"
            required
            value={form.companyId}
            onChange={(e) => setForm((p) => ({ ...p, companyId: e.target.value, employeeId: '' }))}
            options={companyOptions}
            placeholder="Select company"
          />
          <FormSelect
            label="Employee"
            required
            value={form.employeeId}
            onChange={f('employeeId')}
            options={employeeOptions}
            placeholder={form.companyId ? 'Select employee' : 'Select company first'}
          />
          <FormInput label="Shift ID" value={form.shiftId} onChange={f('shiftId')} required />
          <FormInput label="Date" type="date" value={form.date} onChange={f('date')} required />
          <FormSelect
            label="Status"
            value={form.status}
            onChange={f('status')}
            options={[
              { value: 'SCHEDULED', label: 'Scheduled' },
              { value: 'CONFIRMED', label: 'Confirmed' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
          />
        </form>
      </Modal>
    </div>
  );
}
