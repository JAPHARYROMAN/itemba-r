'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, PageHeader, StatusBadge, FormInput, FormSelect, Modal, Btn, PageSpinner, PageToolbar, showToast } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useAuth } from '@/hooks/use-auth';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface PayrollPeriod {
  id: string;
  payrollPeriodCode: string;
  company?: string | { name?: string };
  name: string;
  startDate?: string;
  endDate?: string;
  paymentDate?: string;
  status: string;
}

interface FormState {
  code: string;
  companyId: string;
  name: string;
  startDate: string;
  endDate: string;
  paymentDate: string;
}

const empty: FormState = { code: '', companyId: '', name: '', startDate: '', endDate: '', paymentDate: '' };

export default function PayrollPeriodsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<PayrollPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const { companyOptions } = useOrgScope(form.companyId, { skipBranches: true, skipDivisions: true, skipEmployees: true });
  const { user } = useAuth();

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/backend/hr/payroll-periods');
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/backend/hr/payroll-periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payrollPeriodCode: form.code || undefined,
          companyId: form.companyId,
          name: form.name,
          startDate: form.startDate,
          endDate: form.endDate,
          paymentDate: form.paymentDate || undefined,
          createdById: user?.id,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showToast('error', 'Save failed', Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? 'Could not create the payroll period.'));
        return;
      }
      setShowModal(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  // The backend has no dedicated approve/close endpoints; status changes go
  // through PUT with the whitelisted `status` field.
  const doAction = async (id: string, status: 'APPROVED' | 'CLOSED') => {
    setActionLoading(`${id}-${status}`);
    try {
      const res = await fetch(`/api/backend/hr/payroll-periods/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showToast('error', 'Action failed', Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? 'Could not update the period status.'));
      }
    } finally {
      setActionLoading('');
      load();
    }
  };

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="p-6">
      <PageHeader
        title="Payroll Periods"
        subtitle="Manage payroll pay periods"
      />
      <PageToolbar actions={<Btn variant="primary" onClick={() => { setForm(empty); setShowModal(true); }}>+ New Period</Btn>} />
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
                  <th className={thCls}>Company</th>
                  <th className={thCls}>Start</th>
                  <th className={thCls}>End</th>
                  <th className={thCls}>Payment Date</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map(p => (
                  <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-mono`}>{p.payrollPeriodCode}</td>
                    <td className={`${tdCls} font-medium`}>{p.name}</td>
                    <td className={tdCls}>{typeof p.company === 'string' ? p.company : (p.company?.name ?? '—')}</td>
                    <td className={tdCls}>{p.startDate ? new Date(p.startDate).toLocaleDateString('en-GB') : '—'}</td>
                    <td className={tdCls}>{p.endDate ? new Date(p.endDate).toLocaleDateString('en-GB') : '—'}</td>
                    <td className={tdCls}>{p.paymentDate ? new Date(p.paymentDate).toLocaleDateString('en-GB') : '—'}</td>
                    <td className={tdCls}><StatusBadge status={p.status} /></td>
                    <td className={tdCls}>
                      <div className="flex flex-wrap gap-1">
                        <Btn variant="secondary" size="xs" onClick={() => router.push(`/hr/payroll-runs?payrollPeriodId=${p.id}`)}>Runs</Btn>
                        {['OPEN', 'PROCESSING'].includes(p.status) && (
                          <Btn variant="success" size="xs" onClick={() => doAction(p.id, 'APPROVED')} disabled={actionLoading === `${p.id}-APPROVED`}>
                            {actionLoading === `${p.id}-APPROVED` ? '…' : 'Approve'}
                          </Btn>
                        )}
                        {['APPROVED', 'PAID'].includes(p.status) && (
                          <Btn variant="secondary" size="xs" onClick={() => doAction(p.id, 'CLOSED')} disabled={actionLoading === `${p.id}-CLOSED`}>
                            {actionLoading === `${p.id}-CLOSED` ? '…' : 'Close'}
                          </Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No payroll periods found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Payroll Period" footer={<><Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn><Btn variant="primary" type="submit" form="payroll-period-form" loading={saving}>Save</Btn></>}>
        <form id="payroll-period-form" onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Code" value={form.code} onChange={f('code')} placeholder="Auto-generated if blank" />
            <FormSelect label="Company" required value={form.companyId}
              onChange={(e) => setForm(p => ({ ...p, companyId: e.target.value }))}
              options={companyOptions} placeholder="Select company" />
          </div>
          <FormInput label="Name" value={form.name} onChange={f('name')} required />
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Start Date" type="date" value={form.startDate} onChange={f('startDate')} required />
            <FormInput label="End Date" type="date" value={form.endDate} onChange={f('endDate')} required />
          </div>
          <FormInput label="Payment Date" type="date" value={form.paymentDate} onChange={f('paymentDate')} />
        </form>
      </Modal>
    </div>
  );
}
