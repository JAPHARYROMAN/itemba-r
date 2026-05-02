'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

const PAYMENT_METHODS = ['CASH','MOBILE_MONEY','BANK_TRANSFER','BANK_CARD','CHEQUE','OTHER'];
const CURRENCIES = ['TZS','USD','EUR','KES','UGX'];

interface Company { id: string; name: string; code: string; }
interface RentInvoice { id: string; rentInvoiceNumber: string; tenantId: string; }
interface Tenant { id: string; name: string; tenantCode: string; }
interface RentPayment {
  id: string; rentPaymentNumber: string; companyId: string; rentInvoiceId: string;
  tenantId: string; paymentDate: string; amount: number; currency: string;
  paymentMethod: string; reference?: string; notes?: string;
  tenant?: { name: string }; rentInvoice?: { rentInvoiceNumber: string };
}

function fmtCurrency(n: number) { return `TZS ${new Intl.NumberFormat('en-US').format(n)}`; }
function fmtDate(d?: string) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function RentPaymentsPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [rows, setRows] = useState<RentPayment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<RentPayment | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ rentPaymentNumber: '', rentInvoiceId: '', tenantId: '', paymentDate: '', amount: '', currency: 'TZS', paymentMethod: 'CASH', reference: '', notes: '' });
  const [modalCompanyId, setModalCompanyId] = useState('');
  const [invoices, setInvoices] = useState<RentInvoice[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RentPayment | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j =>
      setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (!modalCompanyId) return;
    Promise.all([
      fetch(`/api/backend/rent-invoices?companyId=${modalCompanyId}&limit=100`).then(r => r.json()),
      fetch(`/api/backend/tenants?companyId=${modalCompanyId}&limit=100`).then(r => r.json()),
    ]).then(([ij, tj]) => {
      setInvoices(Array.isArray(ij.data?.data) ? ij.data.data : []);
      setTenants(Array.isArray(tj.data?.data) ? tj.data.data : []);
    });
  }, [modalCompanyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/rent-payments?companyId=${companyId}&page=1&limit=100`);
      if (!res.ok) throw new Error('Failed to load');
      const j = await res.json();
      const list = j.data?.data ?? j.data ?? [];
      setRows(Array.isArray(list) ? list : []);
      setTotal(j.data?.total ?? list.length);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null); setModalCompanyId(companyId);
    setForm({ rentPaymentNumber: '', rentInvoiceId: '', tenantId: '', paymentDate: '', amount: '', currency: 'TZS', paymentMethod: 'CASH', reference: '', notes: '' });
    setShowModal(true);
  }
  function openEdit(row: RentPayment) {
    setEditing(row); setModalCompanyId(companyId);
    setForm({ rentPaymentNumber: row.rentPaymentNumber, rentInvoiceId: row.rentInvoiceId, tenantId: row.tenantId, paymentDate: row.paymentDate?.split('T')[0] ?? '', amount: String(row.amount), currency: row.currency, paymentMethod: row.paymentMethod, reference: row.reference ?? '', notes: row.notes ?? '' });
    setShowModal(true);
  }

  function handleInvoiceChange(invoiceId: string) {
    const inv = invoices.find(i => i.id === invoiceId);
    if (inv) {
      setForm(f => ({ ...f, rentInvoiceId: invoiceId, tenantId: inv.tenantId }));
    } else {
      setForm(f => ({ ...f, rentInvoiceId: invoiceId }));
    }
  }

  async function handleSave() {
    if (!form.rentPaymentNumber.trim()) { setError('Payment number required'); return; }
    if (!form.rentInvoiceId) { setError('Invoice required'); return; }
    if (!form.paymentDate) { setError('Payment date required'); return; }
    if (!form.amount || Number(form.amount) <= 0) { setError('Amount required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, any> = { ...form, companyId: modalCompanyId, receivedById: user?.id, amount: Number(form.amount), reference: form.reference || undefined, notes: form.notes || undefined, tenantId: form.tenantId || undefined };
      const url = editing ? `/api/backend/rent-payments/${editing.id}` : '/api/backend/rent-payments';
      const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await fetch(`/api/backend/rent-payments/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null); load();
  }

  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Rent Payments" subtitle="Tenant payment records" />
        <div className="flex items-center gap-3">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {companyId && <Btn variant="primary" onClick={openNew}>+ Record Payment</Btn>}
        </div>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load payments.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{total} {total === 1 ? 'payment' : 'payments'}</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Payment #</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Invoice</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Tenant</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Date</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Amount</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Method</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Reference</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No payments found.</td></tr>
                ) : rows.map(row => (
                  <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.rentPaymentNumber}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.rentInvoice?.rentInvoiceNumber ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.tenant?.name ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(row.paymentDate)}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtCurrency(row.amount)}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.paymentMethod.replace(/_/g, ' ')}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.reference ?? '—'}</td>
                    <td className={tdCls}>
                      <div className="flex gap-1">
                        <Btn size="sm" variant="secondary" onClick={() => openEdit(row)}>Edit</Btn>
                        <Btn size="sm" variant="danger" onClick={() => setDeleteTarget(row)}>Delete</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Payment' : 'Record Payment'}
        size="lg"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" loading={saving} onClick={handleSave}>{editing ? 'Save Changes' : 'Record Payment'}</Btn>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <FormSelect label="Company *" value={modalCompanyId} onChange={e => setModalCompanyId(e.target.value)}>
            <option value="">Select…</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FormSelect>
          <FormInput label="Payment Number *" value={form.rentPaymentNumber} onChange={sf('rentPaymentNumber')} placeholder="e.g. PAY-2024-001" />
          <div className="col-span-2">
            <FormSelect label="Invoice *" value={form.rentInvoiceId} onChange={e => handleInvoiceChange(e.target.value)}>
              <option value="">Select invoice…</option>
              {invoices.map(i => <option key={i.id} value={i.id}>{i.rentInvoiceNumber}</option>)}
            </FormSelect>
          </div>
          <div className="col-span-2">
            <FormSelect label="Tenant" value={form.tenantId} onChange={sf('tenantId')}>
              <option value="">Select tenant…</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.tenantCode})</option>)}
            </FormSelect>
          </div>
          <FormInput label="Payment Date *" type="date" value={form.paymentDate} onChange={sf('paymentDate')} />
          <FormSelect label="Payment Method *" value={form.paymentMethod} onChange={sf('paymentMethod')}>
            {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
          </FormSelect>
          <FormInput label="Amount *" type="number" min="0" step="0.01" value={form.amount} onChange={sf('amount')} placeholder="0.00" />
          <FormSelect label="Currency" value={form.currency} onChange={sf('currency')}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </FormSelect>
          <div className="col-span-2">
            <FormInput label="Reference" value={form.reference} onChange={sf('reference')} placeholder="e.g. bank transfer ref #" />
          </div>
          <div className="col-span-2">
            <FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={2} />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Payment"
        message={`Delete payment "${deleteTarget?.rentPaymentNumber}"? This cannot be undone.`}
        variant="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
