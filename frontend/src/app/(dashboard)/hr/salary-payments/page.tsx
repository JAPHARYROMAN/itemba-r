'use client';

import { useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, FormInput, FormSelect, Modal, Btn, PageSpinner, PageToolbar, showToast } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';
import { useAuth } from '@/hooks/use-auth';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface SalaryPayment {
  id: string;
  salaryPaymentNumber: string;
  employee?: string | { fullName?: string; employeeCode?: string };
  employeeId?: string;
  amount: number;
  paymentMethod: string;
  paymentDate?: string;
  status: string;
}

interface PayrollRunOption {
  id: string;
  payrollRunNumber?: string;
  status?: string;
}

interface PayrollEntryOption {
  id: string;
  netPay?: number | string;
  payrollRun?: { payrollRunNumber?: string };
}

interface FormState {
  companyId: string;
  employeeId: string;
  payrollRunId: string;
  payrollEntryId: string;
  amount: string;
  paymentMethod: string;
  paymentDate: string;
  reference: string;
}

const empty: FormState = { companyId: '', employeeId: '', payrollRunId: '', payrollEntryId: '', amount: '', paymentMethod: 'BANK_TRANSFER', paymentDate: '', reference: '' };

export default function SalaryPaymentsPage() {
  const [rows, setRows] = useState<SalaryPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const { companyOptions, employeeOptions } = useOrgScope(form.companyId, { skipBranches: true, skipDivisions: true });
  const { user } = useAuth();
  const [runOptions, setRunOptions] = useState<PayrollRunOption[]>([]);
  const [entryOptions, setEntryOptions] = useState<PayrollEntryOption[]>([]);

  // Payroll runs for the selected company (payrollRunId is required by the API).
  useEffect(() => {
    if (!form.companyId) { setRunOptions([]); return; }
    let cancelled = false;
    fetch(`/api/backend/hr/payroll-runs?companyId=${form.companyId}&limit=100`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        const list = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
        setRunOptions(list);
      })
      .catch(() => { if (!cancelled) setRunOptions([]); });
    return () => { cancelled = true; };
  }, [form.companyId]);

  // Payroll entries for the selected run + employee (payrollEntryId is required by the API).
  useEffect(() => {
    if (!form.payrollRunId) { setEntryOptions([]); return; }
    let cancelled = false;
    const params = new URLSearchParams({ payrollRunId: form.payrollRunId, limit: '200' });
    if (form.employeeId) params.set('employeeId', form.employeeId);
    fetch(`/api/backend/hr/payroll-entries?${params}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        const list = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
        setEntryOptions(list);
      })
      .catch(() => { if (!cancelled) setEntryOptions([]); });
    return () => { cancelled = true; };
  }, [form.payrollRunId, form.employeeId]);

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/backend/hr/salary-payments');
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/backend/hr/salary-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: form.companyId,
          employeeId: form.employeeId,
          payrollRunId: form.payrollRunId,
          payrollEntryId: form.payrollEntryId,
          amount: Number(form.amount),
          paymentMethod: form.paymentMethod,
          paymentDate: form.paymentDate,
          reference: form.reference || undefined,
          status: 'PAID',
          paidById: user?.id,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showToast('error', 'Save failed', Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? 'Could not record the payment.'));
        return;
      }
      setShowModal(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const doReverse = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/backend/hr/salary-payments/${id}/reverse`, { method: 'PATCH' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showToast('error', 'Reverse failed', Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? 'Could not reverse this payment.'));
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
        title="Salary Payments"
        subtitle="Record and track salary disbursements"
      />
      <PageToolbar actions={<Btn variant="primary" onClick={() => { setForm(empty); setShowModal(true); }}>+ New Payment</Btn>} />
      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100" style={{ color: 'var(--aurora-text-muted)' }}>
                <tr>
                  <th className={thCls}>Payment #</th>
                  <th className={thCls}>Employee</th>
                  <th className={thCls}>Amount</th>
                  <th className={thCls}>Method</th>
                  <th className={thCls}>Date</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map(p => (
                  <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-mono font-medium`}>{p.salaryPaymentNumber}</td>
                    <td className={`${tdCls} font-medium`}>
                      {typeof p.employee === 'string'
                        ? p.employee
                        : (p.employee?.fullName ?? p.employee?.employeeCode ?? p.employeeId ?? '—')}
                    </td>
                    <td className={`${tdCls} font-semibold text-green-700`}>TZS {(Number.isFinite(Number(p.amount)) ? Number(p.amount).toLocaleString('en-TZ') : '0')}</td>
                    <td className={tdCls}>{p.paymentMethod}</td>
                    <td className={tdCls}>{p.paymentDate ? new Date(p.paymentDate).toLocaleDateString('en-GB') : '—'}</td>
                    <td className={tdCls}><StatusBadge status={p.status} /></td>
                    <td className={tdCls}>
                      {p.status === 'PAID' && (
                        <Btn variant="danger" size="xs" onClick={() => doReverse(p.id)} disabled={actionLoading === p.id}>
                          {actionLoading === p.id ? '…' : 'Reverse'}
                        </Btn>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No salary payments found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Salary Payment" footer={<><Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn><Btn variant="primary" type="submit" form="salary-payment-form" loading={saving}>Save</Btn></>}>
        <form id="salary-payment-form" onSubmit={handleSubmit} className="space-y-3">
          <FormSelect label="Company" required value={form.companyId}
            onChange={(e) => setForm(p => ({ ...p, companyId: e.target.value, employeeId: '', payrollRunId: '', payrollEntryId: '' }))}
            options={companyOptions} placeholder="Select company" />
          <FormSelect label="Employee" required value={form.employeeId}
            onChange={(e) => setForm(p => ({ ...p, employeeId: e.target.value, payrollEntryId: '' }))}
            options={employeeOptions} placeholder={form.companyId ? 'Select employee' : 'Select company first'} />
          <FormSelect label="Payroll Run" required value={form.payrollRunId}
            onChange={(e) => setForm(p => ({ ...p, payrollRunId: e.target.value, payrollEntryId: '' }))}
            options={runOptions.map(r => ({ value: r.id, label: `${r.payrollRunNumber ?? r.id}${r.status ? ` (${r.status})` : ''}` }))}
            placeholder={form.companyId ? 'Select payroll run' : 'Select company first'} />
          <FormSelect label="Payroll Entry" required value={form.payrollEntryId}
            onChange={(e) => {
              const entry = entryOptions.find(en => en.id === e.target.value);
              setForm(p => ({
                ...p,
                payrollEntryId: e.target.value,
                amount: p.amount || (entry?.netPay != null ? String(entry.netPay) : p.amount),
              }));
            }}
            options={entryOptions.map(en => ({
              value: en.id,
              label: `Net TZS ${Number.isFinite(Number(en.netPay)) ? Number(en.netPay).toLocaleString('en-TZ') : '0'}${en.payrollRun?.payrollRunNumber ? ` — ${en.payrollRun.payrollRunNumber}` : ''}`,
            }))}
            placeholder={form.payrollRunId ? 'Select payroll entry' : 'Select payroll run first'} />
          <FormInput label="Amount (TZS)" type="number" value={form.amount} onChange={f('amount')} required />
          <FormSelect label="Payment Method" value={form.paymentMethod} onChange={f('paymentMethod')}
            options={[
              { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
              { value: 'CASH', label: 'Cash' },
              { value: 'MOBILE_MONEY', label: 'Mobile Money' },
              { value: 'CHEQUE', label: 'Cheque' },
            ]} />
          <FormInput label="Payment Date" type="date" value={form.paymentDate} onChange={f('paymentDate')} required />
          <FormInput label="Reference" value={form.reference} onChange={f('reference')} />
        </form>
      </Modal>
    </div>
  );
}
