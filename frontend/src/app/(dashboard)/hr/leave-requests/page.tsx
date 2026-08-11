'use client';

import { useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, FormInput, FormSelect, Modal, Btn, PageSpinner, FormTextarea, PageToolbar, showToast } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface LeaveRequest {
  id: string;
  employee?: string;
  employeeId?: string;
  leaveType?: string;
  leaveTypeId?: string;
  startDate?: string;
  endDate?: string;
  numberOfDays?: number;
  reason?: string;
  status: string;
}

interface FormState {
  companyId: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  reason: string;
}

const empty: FormState = { companyId: '', employeeId: '', leaveTypeId: '', startDate: '', endDate: '', reason: '' };

export default function LeaveRequestsPage() {
  const [rows, setRows] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const { companyOptions, employeeOptions } = useOrgScope(form.companyId, { skipBranches: true, skipDivisions: true });

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/backend/hr/leave-requests');
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await fetch('/api/backend/hr/leave-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify((() => { const { companyId: _c, ...rest } = form; void _c; return rest; })()),
    });
    setSaving(false);
    setShowModal(false);
    load();
  };

  const doAction = async (id: string, action: 'submit' | 'approve' | 'reject' | 'cancel') => {
    setActionLoading(`${id}-${action}`);
    try {
      const res = await fetch(`/api/backend/hr/leave-requests/${id}/${action}`, { method: 'PATCH' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showToast('error', 'Action failed', Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? `Could not ${action} this request.`));
      }
    } finally {
      setActionLoading('');
      load();
    }
  };

  const relationLabel = (value: unknown, fallback?: string | null) => {
    if (typeof value === 'string' && value) return value;
    if (value && typeof value === 'object') {
      const rel = value as { fullName?: string; name?: string; employeeCode?: string };
      return rel.fullName ?? rel.name ?? rel.employeeCode ?? fallback ?? '—';
    }
    return fallback ?? '—';
  };

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="p-6">
      <PageHeader
        title="Leave Requests"
        subtitle="Employee leave applications and approvals"
      />
      <PageToolbar actions={<Btn variant="primary" onClick={() => { setForm(empty); setShowModal(true); }}>+ New Request</Btn>} />
      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100" style={{ color: 'var(--aurora-text-muted)' }}>
                <tr>
                  <th className={thCls}>Employee</th>
                  <th className={thCls}>Leave Type</th>
                  <th className={thCls}>From</th>
                  <th className={thCls}>To</th>
                  <th className={thCls}>Days</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map(lr => (
                  <tr key={lr.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`}>{relationLabel(lr.employee, lr.employeeId)}</td>
                    <td className={tdCls}>{relationLabel(lr.leaveType, lr.leaveTypeId)}</td>
                    <td className={tdCls}>{lr.startDate ? new Date(lr.startDate).toLocaleDateString('en-GB') : '—'}</td>
                    <td className={tdCls}>{lr.endDate ? new Date(lr.endDate).toLocaleDateString('en-GB') : '—'}</td>
                    <td className={tdCls}>{lr.numberOfDays ?? '—'}</td>
                    <td className={tdCls}><StatusBadge status={lr.status} /></td>
                    <td className={tdCls}>
                      {lr.status === 'DRAFT' && (
                        <div className="flex gap-1">
                          <Btn variant="primary" size="xs" onClick={() => doAction(lr.id, 'submit')} disabled={actionLoading === `${lr.id}-submit`}>
                            {actionLoading === `${lr.id}-submit` ? '…' : 'Submit'}
                          </Btn>
                          <Btn variant="secondary" size="xs" onClick={() => doAction(lr.id, 'cancel')} disabled={actionLoading === `${lr.id}-cancel`}>
                            {actionLoading === `${lr.id}-cancel` ? '…' : 'Cancel'}
                          </Btn>
                        </div>
                      )}
                      {lr.status === 'SUBMITTED' && (
                        <div className="flex gap-1">
                          <Btn variant="success" size="xs" onClick={() => doAction(lr.id, 'approve')} disabled={actionLoading === `${lr.id}-approve`}>
                            {actionLoading === `${lr.id}-approve` ? '…' : 'Approve'}
                          </Btn>
                          <Btn variant="danger" size="xs" onClick={() => doAction(lr.id, 'reject')} disabled={actionLoading === `${lr.id}-reject`}>
                            {actionLoading === `${lr.id}-reject` ? '…' : 'Reject'}
                          </Btn>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No leave requests found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Leave Request" footer={<><Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn><Btn variant="primary" type="submit" form="leave-request-form" loading={saving}>Submit</Btn></>}>
        <form id="leave-request-form" onSubmit={handleSubmit} className="space-y-3">
          <FormSelect label="Company" required value={form.companyId}
            onChange={(e) => setForm(p => ({ ...p, companyId: e.target.value, employeeId: '' }))}
            options={companyOptions} placeholder="Select company" />
          <FormSelect label="Employee" required value={form.employeeId} onChange={f('employeeId')}
            options={employeeOptions} placeholder={form.companyId ? 'Select employee' : 'Select company first'} />
          <FormInput label="Leave Type ID" value={form.leaveTypeId} onChange={f('leaveTypeId')} required />
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Start Date" type="date" value={form.startDate} onChange={f('startDate')} required />
            <FormInput label="End Date" type="date" value={form.endDate} onChange={f('endDate')} required />
          </div>
          <FormTextarea label="Reason" value={form.reason} onChange={f('reason')} rows={3} />
        </form>
      </Modal>
    </div>
  );
}
