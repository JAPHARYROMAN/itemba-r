'use client';

import { useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, FormInput, FormSelect, Modal, Btn, PageSpinner } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface Contract {
  id: string;
  code: string;
  employee?: string;
  employeeId?: string;
  company?: string;
  contractType: string;
  startDate?: string;
  endDate?: string;
  baseSalary?: number;
  status: string;
}

interface FormState {
  code: string;
  employeeId: string;
  companyId: string;
  contractType: string;
  startDate: string;
  endDate: string;
  baseSalary: string;
  currency: string;
}

const empty: FormState = { code: '', employeeId: '', companyId: '', contractType: 'PERMANENT', startDate: '', endDate: '', baseSalary: '', currency: 'TZS' };

export default function EmploymentContractsPage() {
  const [rows, setRows] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const { companyOptions, employeeOptions } = useOrgScope(form.companyId, { skipBranches: true, skipDivisions: true });

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/backend/hr/employment-contracts');
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await fetch('/api/backend/hr/employment-contracts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify((() => {
        const { companyId, ...rest } = form;
        return { ...rest, company: companyId, baseSalary: form.baseSalary ? Number(form.baseSalary) : undefined };
      })()),
    });
    setSaving(false);
    setShowModal(false);
    load();
  };

  const doAction = async (id: string, action: string) => {
    setActionLoading(`${id}-${action}`);
    await fetch(`/api/backend/hr/employment-contracts/${id}/${action}`, { method: 'PATCH' });
    setActionLoading('');
    load();
  };

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="p-6">
      <PageHeader
        title="Employment Contracts"
        subtitle="Employee contracts and agreements"
        actions={<Btn variant="primary" onClick={() => { setForm(empty); setShowModal(true); }}>+ New Contract</Btn>}
      />
      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100" style={{ color: 'var(--aurora-text-muted)' }}>
                <tr>
                  <th className={thCls}>Code</th>
                  <th className={thCls}>Employee</th>
                  <th className={thCls}>Company</th>
                  <th className={thCls}>Type</th>
                  <th className={thCls}>Start</th>
                  <th className={thCls}>End</th>
                  <th className={thCls}>Salary</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map(c => (
                  <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-mono`}>{c.code}</td>
                    <td className={`${tdCls} font-medium`}>{c.employee ?? c.employeeId ?? '—'}</td>
                    <td className={tdCls}>{c.company ?? '—'}</td>
                    <td className={tdCls}>{c.contractType}</td>
                    <td className={tdCls}>{c.startDate ? new Date(c.startDate).toLocaleDateString('en-GB') : '—'}</td>
                    <td className={tdCls}>{c.endDate ? new Date(c.endDate).toLocaleDateString('en-GB') : '—'}</td>
                    <td className={tdCls}>{c.baseSalary != null ? `TZS ${(Number.isFinite(Number(c.baseSalary)) ? Number(c.baseSalary).toLocaleString('en-TZ') : '0')}` : '—'}</td>
                    <td className={tdCls}><StatusBadge status={c.status} /></td>
                    <td className={tdCls}>
                      <div className="flex flex-wrap gap-1">
                        {c.status === 'DRAFT' && (
                          <Btn variant="success" size="xs" onClick={() => doAction(c.id, 'approve')} disabled={actionLoading === `${c.id}-approve`}>
                            {actionLoading === `${c.id}-approve` ? '…' : 'Approve'}
                          </Btn>
                        )}
                        {['ACTIVE', 'APPROVED'].includes(c.status) && (
                          <Btn variant="danger" size="xs" onClick={() => doAction(c.id, 'terminate')} disabled={actionLoading === `${c.id}-terminate`}>
                            {actionLoading === `${c.id}-terminate` ? '…' : 'Terminate'}
                          </Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={9} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No contracts found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Employment Contract" footer={<><Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn><Btn variant="primary" type="submit" form="contract-form" loading={saving}>Save</Btn></>}>
        <form id="contract-form" onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Code" value={form.code} onChange={f('code')} required />
            <FormSelect label="Contract Type" value={form.contractType} onChange={f('contractType')}
              options={[
                { value: 'PERMANENT', label: 'Permanent' },
                { value: 'FIXED_TERM', label: 'Fixed Term' },
                { value: 'CONTRACT', label: 'Contract' },
                { value: 'CASUAL', label: 'Casual' },
              ]} />
          </div>
          <FormSelect label="Company" required value={form.companyId}
            onChange={(e) => setForm(p => ({ ...p, companyId: e.target.value, employeeId: '' }))}
            options={companyOptions} placeholder="Select company" />
          <FormSelect label="Employee" required value={form.employeeId} onChange={f('employeeId')}
            options={employeeOptions} placeholder={form.companyId ? 'Select employee' : 'Select company first'} />
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Start Date" type="date" value={form.startDate} onChange={f('startDate')} required />
            <FormInput label="End Date" type="date" value={form.endDate} onChange={f('endDate')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Base Salary" type="number" value={form.baseSalary} onChange={f('baseSalary')} />
            <FormSelect label="Currency" value={form.currency} onChange={f('currency')}
              options={[{ value: 'TZS', label: 'TZS' }, { value: 'USD', label: 'USD' }]} />
          </div>
        </form>
      </Modal>
    </div>
  );
}
