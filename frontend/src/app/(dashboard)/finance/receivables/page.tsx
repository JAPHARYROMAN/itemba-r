'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string; code: string }

interface Receivable {
  id: string;
  receivableNumber?: string;
  customerName: string;
  amount: number;
  amountPaid: number;
  outstandingAmount: number;
  currency: string;
  issueDate: string;
  dueDate: string;
  status: 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'WRITTEN_OFF';
  notes?: string | null;
  companyId: string;
  company?: { name: string } | null;
  createdAt: string;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

interface ReceivableForm {
  companyId: string;
  customerName: string;
  amount: number | '';
  currency: string;
  issueDate: string;
  dueDate: string;
  notes: string;
}

const BLANK_FORM: ReceivableForm = {
  companyId: '', customerName: '', amount: '', currency: 'TZS',
  issueDate: '', dueDate: '', notes: '',
};

const CURRENCIES = ['TZS', 'USD', 'EUR', 'KES', 'UGX', 'GBP'];

function fmtTZS(n: number) {
  return 'TZS ' + new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function agingBucket(dueDate: string): string {
  const days = Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
  if (days <= 0) return 'Current';
  if (days <= 30) return '1-30 days';
  if (days <= 60) return '31-60 days';
  if (days <= 90) return '61-90 days';
  return '90+ days';
}

// ─── Record Payment Modal ─────────────────────────────────────────────────────

function RecordPaymentModal({ receivable, onClose, onDone }: { receivable: Receivable; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { setError('Valid amount is required'); return; }
    if (amt > receivable.outstandingAmount) { setError(`Amount cannot exceed outstanding balance ${fmtTZS(receivable.outstandingAmount)}`); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/backend/receivables/${receivable.id}/record-payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, paymentDate: paymentDate || undefined, notes: notes || undefined }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Payment failed'); }
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Record Payment"
      subtitle={`Outstanding: ${fmtTZS(receivable.outstandingAmount)}`}
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn variant="success" onClick={handleSubmit} loading={saving}>Record Payment</Btn>
        </>
      }
    >
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="space-y-3">
        <FormInput label="Amount" required type="number" min="0.01" step="0.01" max={receivable.outstandingAmount} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        <FormInput label="Payment Date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
        <FormTextarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes…" />
      </div>
    </Modal>
  );
}

// ─── Write-Off Dialog ─────────────────────────────────────────────────────────

function WriteOffDialog({ receivable, onClose, onDone }: { receivable: Receivable; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!reason.trim()) { setError('Reason is required'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/backend/receivables/${receivable.id}/write-off`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Write-off failed'); }
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Write Off Receivable"
      subtitle={`Write off ${receivable.receivableNumber ?? receivable.id.slice(0, 8)}`}
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn variant="danger" onClick={handleSubmit} loading={saving}>Write Off</Btn>
        </>
      }
    >
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <FormTextarea label="Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for write-off…" />
    </Modal>
  );
}

// ─── Create / Edit Modal ──────────────────────────────────────────────────────

function ReceivableModal({
  mode, initial, companies, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Receivable;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ReceivableForm>(() =>
    initial ? {
      companyId: initial.companyId,
      customerName: initial.customerName,
      amount: initial.amount,
      currency: initial.currency,
      issueDate: initial.issueDate.split('T')[0],
      dueDate: initial.dueDate.split('T')[0],
      notes: initial.notes ?? '',
    } : { ...BLANK_FORM }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof ReceivableForm, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.companyId) { setError('Company is required'); return; }
    if (!form.customerName.trim()) { setError('Customer name is required'); return; }
    if (!form.amount || Number(form.amount) <= 0) { setError('Valid amount is required'); return; }
    if (!form.issueDate || !form.dueDate) { setError('Dates are required'); return; }
    setSaving(true); setError('');
    try {
      const body = { ...form, amount: Number(form.amount), notes: form.notes || undefined };
      const res = await fetch(
        mode === 'create' ? '/api/backend/receivables' : `/api/backend/receivables/${initial!.id}`,
        { method: mode === 'create' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'Create Receivable' : 'Edit Receivable'}
      size="lg"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={saving}>{mode === 'create' ? 'Create' : 'Save Changes'}</Btn>
        </>
      }
    >
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="space-y-3">
        <FormSelect label="Company" required disabled={mode === 'edit'} value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="Select company…">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
        </FormSelect>
        <FormInput label="Customer Name" required value={form.customerName} onChange={(e) => set('customerName', e.target.value)} placeholder="Customer name" />
        <div className="grid grid-cols-2 gap-3">
          <FormInput label="Amount" required type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value === '' ? '' : Number(e.target.value))} placeholder="0.00" />
          <FormSelect label="Currency" value={form.currency} onChange={(e) => set('currency', e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </FormSelect>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormInput label="Issue Date" required type="date" value={form.issueDate} onChange={(e) => set('issueDate', e.target.value)} />
          <FormInput label="Due Date" required type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </div>
        <FormTextarea label="Notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional notes…" />
      </div>
    </Modal>
  );
}

// ─── Delete Confirm ───────────────────────────────────────────────────────────

function DeleteConfirm({ receivable, onClose, onDeleted }: { receivable: Receivable; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const confirm = async () => {
    setDeleting(true);
    await fetch(`/api/backend/receivables/${receivable.id}`, { method: 'DELETE' });
    onDeleted();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Delete Receivable"
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn variant="danger" onClick={confirm} loading={deleting}>Delete</Btn>
        </>
      }
    >
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>Delete receivable <span className="font-medium">{receivable.receivableNumber ?? receivable.id.slice(0, 8)}</span>?</p>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReceivablesPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<Receivable> | null>(null);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Receivable | null>(null);
  const [deleting, setDeleting] = useState<Receivable | null>(null);
  const [recordingPayment, setRecordingPayment] = useState<Receivable | null>(null);
  const [writingOff, setWritingOff] = useState<Receivable | null>(null);

  const canView = hasPermission('receivables.view');
  const canManage = hasPermission('receivables.manage');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (companyId) params.set('companyId', companyId);
      if (status) params.set('status', status);
      const res = await fetch(`/api/backend/receivables?${params}`);
      const json = await res.json();
      setData(json.data ?? null);
    } finally { setLoading(false); }
  }, [canView, page, companyId, status]);

  useEffect(() => { load(); }, [load]);

  const reset = (setter: (v: string) => void) => (v: string) => { setter(v); setPage(1); };

  const totalOutstanding = data?.data.reduce((s, r) => s + r.outstandingAmount, 0) ?? 0;
  const totalOverdue = data?.data.filter((r) => r.status === 'OVERDUE').reduce((s, r) => s + r.outstandingAmount, 0) ?? 0;

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Receivables" subtitle="Manage accounts receivable" />
        <div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div>
      </div>
    );
  }

  const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' } as const;

  return (
    <div className="p-6 space-y-6">
      {creating && <ReceivableModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {editing && <ReceivableModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {deleting && <DeleteConfirm receivable={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); load(); }} />}
      {recordingPayment && <RecordPaymentModal receivable={recordingPayment} onClose={() => setRecordingPayment(null)} onDone={() => { setRecordingPayment(null); load(); }} />}
      {writingOff && <WriteOffDialog receivable={writingOff} onClose={() => setWritingOff(null)} onDone={() => { setWritingOff(null); load(); }} />}

      <PageHeader title="Receivables" subtitle="Accounts receivable management (AR)" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total" value={data?.total ?? 0} />
        <StatCard label="Open" value={data?.data.filter((r) => r.status === 'OPEN').length ?? 0} />
        <StatCard label="Outstanding" value={fmtTZS(totalOutstanding)} />
        <StatCard label="Overdue" value={fmtTZS(totalOverdue)} hint="Past due date" />
      </div>

      <PageToolbar
        filters={
          <>
            <select value={companyId} onChange={(e) => reset(setCompanyId)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              <option value="OPEN">Open</option>
              <option value="PARTIALLY_PAID">Partially Paid</option>
              <option value="PAID">Paid</option>
              <option value="OVERDUE">Overdue</option>
              <option value="WRITTEN_OFF">Written Off</option>
            </select>
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New AR</Btn> : null}
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">AR #</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Outstanding</th>
                <th className="px-4 py-3">Issue Date</th>
                <th className="px-4 py-3">Due Date</th>
                <th className="px-4 py-3">Aging</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={10}><PageSpinner /></td></tr>
              ) : !data?.data.length ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No receivables found</td></tr>
              ) : data.data.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{r.receivableNumber ?? r.id.slice(0, 8)}</td>
                  <td className="px-4 py-3 font-medium">{r.customerName}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtTZS(r.amount)}</td>
                  <td className="px-4 py-3 text-right font-mono text-green-700">{fmtTZS(r.amountPaid)}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">{fmtTZS(r.outstandingAmount)}</td>
                  <td className="px-4 py-3">{fmtDate(r.issueDate)}</td>
                  <td className="px-4 py-3">{fmtDate(r.dueDate)}</td>
                  <td className="px-4 py-3"><span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{agingBucket(r.dueDate)}</span></td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {(r.status === 'OPEN' || r.status === 'PARTIALLY_PAID' || r.status === 'OVERDUE') && (
                          <Btn variant="success" size="xs" onClick={() => setRecordingPayment(r)}>Pay</Btn>
                        )}
                        {(r.status === 'OPEN' || r.status === 'OVERDUE') && (
                          <Btn variant="warning" size="xs" onClick={() => setWritingOff(r)}>Write Off</Btn>
                        )}
                        {r.status === 'OPEN' && (
                          <Btn variant="ghost" size="xs" onClick={() => setEditing(r)}>Edit</Btn>
                        )}
                        {r.status === 'OPEN' && (
                          <Btn variant="danger" size="xs" onClick={() => setDeleting(r)}>Delete</Btn>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && data.totalPages > 1 && (
          <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--aurora-border)' }}>
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>Page {data.page} of {data.totalPages} · {data.total} total</span>
            <div className="flex gap-2">
              <Btn variant="secondary" size="xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Btn>
              <Btn variant="secondary" size="xs" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
