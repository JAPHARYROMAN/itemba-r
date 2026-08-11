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
  showToast,
} from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useAuth } from '@/hooks/use-auth';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface Attendance {
  id: string;
  employee?: string | { fullName?: string; employeeCode?: string };
  employeeId?: string;
  companyId?: string;
  attendanceDate?: string;
  clockInTime?: string;
  clockOutTime?: string;
  totalHours?: number;
  attendanceStatus?: string;
  approvedById?: string | null;
}

interface FormState {
  companyId: string;
  employeeId: string;
  date: string;
  clockIn: string;
  clockOut: string;
  status: string;
}

const empty: FormState = {
  companyId: '',
  employeeId: '',
  date: '',
  clockIn: '',
  clockOut: '',
  status: 'PRESENT',
};

export default function AttendancePage() {
  const [rows, setRows] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Attendance | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [empFilter, setEmpFilter] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const { companyOptions, employeeOptions } = useOrgScope(form.companyId, {
    skipBranches: true,
    skipDivisions: true,
  });
  const { user } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (empFilter) params.set('employeeId', empFilter);
    const r = await fetch(`/api/backend/hr/attendance?${params}`);
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  }, [dateFrom, dateTo, empFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(empty);
    setShowModal(true);
  };
  const toTime = (iso?: string) => (iso ? new Date(iso).toTimeString().slice(0, 5) : '');

  const openEdit = (a: Attendance) => {
    setEditing(a);
    setForm({
      companyId: a.companyId ?? '',
      employeeId: a.employeeId ?? '',
      date: a.attendanceDate ? a.attendanceDate.slice(0, 10) : '',
      clockIn: toTime(a.clockInTime),
      clockOut: toTime(a.clockOutTime),
      status: a.attendanceStatus ?? 'PRESENT',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload: Record<string, unknown> = {
      companyId: form.companyId,
      employeeId: form.employeeId,
      attendanceDate: form.date,
      clockInTime: form.clockIn ? `${form.date}T${form.clockIn}:00` : undefined,
      clockOutTime: form.clockOut ? `${form.date}T${form.clockOut}:00` : undefined,
      attendanceStatus: form.status,
    };
    if (!editing) payload.createdById = user?.id;
    const url = editing ? `/api/backend/hr/attendance/${editing.id}` : '/api/backend/hr/attendance';
    try {
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showToast('error', 'Save failed', Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? 'Could not save the attendance record.'));
        return;
      }
      setShowModal(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const doApprove = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/backend/hr/attendance/${id}/approve`, { method: 'PATCH' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showToast('error', 'Approve failed', Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? 'Could not approve this record.'));
      }
    } finally {
      setActionLoading('');
      load();
    }
  };

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="p-6">
      <PageHeader title="Attendance" subtitle="Employee clock-in / clock-out records" />

      <PageToolbar
        filters={
          <>
            <input
              type="text"
              placeholder="Employee ID…"
              value={empFilter}
              onChange={(e) => setEmpFilter(e.target.value)}
              className="text-sm border rounded-lg px-3 py-1.5 w-44 focus:outline-none focus:ring-2 focus:ring-brand-500"
              style={{
                borderColor: 'var(--aurora-border)',
                background: 'var(--aurora-card)',
                color: 'var(--aurora-text)',
              }}
            />
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
            + Log Attendance
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
                  <th className={thCls}>Date</th>
                  <th className={thCls}>Clock In</th>
                  <th className={thCls}>Clock Out</th>
                  <th className={thCls}>Hours</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map((a) => (
                  <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`}>
                      {typeof a.employee === 'string'
                        ? a.employee
                        : (a.employee?.fullName ?? a.employee?.employeeCode ?? a.employeeId ?? '—')}
                    </td>
                    <td className={tdCls}>
                      {a.attendanceDate ? new Date(a.attendanceDate).toLocaleDateString('en-GB') : '—'}
                    </td>
                    <td className={tdCls}>{a.clockInTime ? new Date(a.clockInTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td className={tdCls}>{a.clockOutTime ? new Date(a.clockOutTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td className={tdCls}>{a.totalHours != null ? `${Number(a.totalHours)}h` : '—'}</td>
                    <td className={tdCls}>
                      <StatusBadge status={a.attendanceStatus ?? 'UNKNOWN'} />
                    </td>
                    <td className={tdCls}>
                      <div className="flex gap-2">
                        <Btn variant="ghost" size="xs" onClick={() => openEdit(a)}>
                          Edit
                        </Btn>
                        {!a.approvedById && (
                          <Btn
                            variant="success"
                            size="xs"
                            onClick={() => doApprove(a.id)}
                            disabled={actionLoading === a.id}
                          >
                            {actionLoading === a.id ? '…' : 'Approve'}
                          </Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="text-center py-8 text-sm"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      No attendance records found
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
        title={editing ? 'Edit Attendance' : 'New Attendance Record'}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" type="submit" form="attendance-form" loading={saving}>
              Save
            </Btn>
          </>
        }
      >
        <form id="attendance-form" onSubmit={handleSubmit} className="space-y-3">
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
          <FormInput label="Date" type="date" value={form.date} onChange={f('date')} required />
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Clock In" type="time" value={form.clockIn} onChange={f('clockIn')} />
            <FormInput
              label="Clock Out"
              type="time"
              value={form.clockOut}
              onChange={f('clockOut')}
            />
          </div>
          <FormSelect
            label="Status"
            value={form.status}
            onChange={f('status')}
            options={[
              { value: 'PRESENT', label: 'Present' },
              { value: 'ABSENT', label: 'Absent' },
              { value: 'LATE', label: 'Late' },
              { value: 'HALF_DAY', label: 'Half Day' },
              { value: 'ON_LEAVE', label: 'On Leave' },
              { value: 'HOLIDAY', label: 'Holiday' },
              { value: 'SICK', label: 'Sick' },
              { value: 'UNPAID_ABSENT', label: 'Unpaid Absent' },
            ]}
          />
        </form>
      </Modal>
    </div>
  );
}
