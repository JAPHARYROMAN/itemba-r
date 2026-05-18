'use client';

import { useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatusBadge, FormInput, FormSelect, Modal, Btn, PageSpinner, FormTextarea } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface SalaryAdvance {
  id: string;
  advanceNumber: string;
  employee?: string;
  employeeId?: string;
  amount: number;
  status: string;
  requestDate?: string;
}

interface FormState {
  companyId: string;
  employeeId: string;
  amount: string;
  reason: string;
  requestDate: string;
}

const empty: FormState = { companyId: '', employeeId: '', amount: '', reason: '', requestDate: '' };

export default function SalaryAdvancesPage() {
  const [rows, setRows] = useState<SalaryAdvance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const { companyOptions, employeeOptions } = useOrgScope(form.companyId, { skipBranches: true, skipDivisions: true });

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/backend/hr/salary-advances');
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await fetch('/api/backend/hr/salary-advances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(() => { const { companyId: _c, ...rest } = form; void _c; return rest; })(), amount: Number(form.amount) }),
    });
    setSaving(false);
    setShowModal(false);
    load();
  };

  const doAction = async (id: string, action: 'approve' | 'pay') => {
    setActionLoading(`${id}-${action}`);
    await fetch(`/api/backend/hr/salary-advances/${id}/${action}`, { method: 'POST' });
    setActionLoading('');
    load();
  };

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="p-6">
      <PageHeader
        title="Salary Advances"
        subtitle="Manage employee salary advance requests"
      />
      <PageToolbar actions={<Btn variant="primary" onClick={() => { setForm(empty); setShowModal(true); }}>+ Request Advance</Btn>} />
      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100" style={{ color: 'var(--aurora-text-muted)' }}>
                <tr>
                  <th className={thCls}>Advance #</th>
                  <th className={thCls}>Employee</th>
                  <th className={thCls}>Amount</th>
                  <th className={thCls}>Request Date</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map(a => (
                  <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-mono font-medium`}>{a.advanceNumber}</td>
                    <td className={`${tdCls} font-medium`}>{a.employee ?? a.employeeId ?? '—'}</td>
                    <td className={tdCls}>TZS {(Number.isFinite(Number(a.amount)) ? Number(a.amount).toLocaleString('en-TZ') : '0')}</td>
                    <td className={tdCls}>{a.requestDate ? new Date(a.requestDate).toLocaleDateString('en-GB') : '—'}</td>
                    <td className={tdCls}><StatusBadge status={a.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-1">
                        {a.status === 'PENDING' && (
                          <Btn variant="success" size="xs" onClick={() => doAction(a.id, 'approve')} disabled={actionLoading === `${a.id}-approve`}>
                            {actionLoading === `${a.id}-approve` ? '…' : 'Approve'}
                          </Btn>
                        )}
                        {a.status === 'APPROVED' && (
                          <Btn variant="primary" size="xs" onClick={() => doAction(a.id, 'pay')} disabled={actionLoading === `${a.id}-pay`}>
                            {actionLoading === `${a.id}-pay` ? '…' : 'Pay'}
                          </Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No salary advances found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Request Salary Advance"
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" type="submit" form="salary-advance-form" loading={saving}>Submit</Btn>
          </>
        }
      >
        <form id="salary-advance-form" onSubmit={handleSubmit} className="space-y-3">
          <FormSelect label="Company" required value={form.companyId}
            onChange={(e) => setForm(p => ({ ...p, companyId: e.target.value, employeeId: '' }))}
            options={companyOptions} placeholder="Select company" />
          <FormSelect label="Employee" required value={form.employeeId} onChange={f('employeeId')}
            options={employeeOptions} placeholder={form.companyId ? 'Select employee' : 'Select company first'} />
          <FormInput label="Amount (TZS)" type="number" value={form.amount} onChange={f('amount')} required />
          <FormInput label="Request Date" type="date" value={form.requestDate} onChange={f('requestDate')} />
          <FormTextarea label="Reason" value={form.reason} onChange={f('reason')} rows={3} />
        </form>
      </Modal>
    </div>
  );
}
