'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

const INVOICE_STATUSES = ['DRAFT','ISSUED','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED','WRITTEN_OFF'];
const CURRENCIES = ['TZS','USD','EUR','KES','UGX'];

interface Company { id: string; name: string; code: string; }
interface RentalProperty { id: string; propertyName: string; }
interface RentalUnit { id: string; unitNumber: string; }
interface Tenant { id: string; name: string; tenantCode: string; }
interface LeaseAgreement { id: string; leaseCode: string; tenantId: string; rentalUnitId: string; propertyId: string; }
interface RentInvoice {
  id: string; rentInvoiceNumber: string; companyId: string; propertyId: string;
  rentalUnitId: string; tenantId: string; leaseAgreementId: string;
  invoiceDate: string; billingPeriodStart: string; billingPeriodEnd: string;
  rentAmount: number; currency: string; totalAmount: number; outstandingAmount: number;
  dueDate?: string; status: string; paidAmount?: number; notes?: string;
  tenant?: { name: string }; rentalUnit?: { unitNumber: string };
}

function fmtCurrency(n: number | string | null | undefined) { const value = Number(n ?? 0); return `TZS ${new Intl.NumberFormat('en-US').format(Number.isFinite(value) ? value : 0)}`; }
function fmtDate(d?: string) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function RentInvoicesPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [rows, setRows] = useState<RentInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<RentInvoice | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ rentInvoiceNumber: '', propertyId: '', rentalUnitId: '', tenantId: '', leaseAgreementId: '', invoiceDate: '', billingPeriodStart: '', billingPeriodEnd: '', rentAmount: '', currency: 'TZS', totalAmount: '', outstandingAmount: '', dueDate: '', status: 'DRAFT', notes: '' });
  const [modalCompanyId, setModalCompanyId] = useState('');
  const [properties, setProperties] = useState<RentalProperty[]>([]);
  const [units, setUnits] = useState<RentalUnit[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [leases, setLeases] = useState<LeaseAgreement[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RentInvoice | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j =>
      setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (!modalCompanyId) return;
    Promise.all([
      fetch(`/api/backend/rental-properties?companyId=${modalCompanyId}&limit=100`).then(r => r.json()),
      fetch(`/api/backend/tenants?companyId=${modalCompanyId}&limit=100`).then(r => r.json()),
      fetch(`/api/backend/lease-agreements?companyId=${modalCompanyId}&limit=100`).then(r => r.json()),
    ]).then(([pj, tj, lj]) => {
      setProperties(Array.isArray(pj.data?.data) ? pj.data.data : []);
      setTenants(Array.isArray(tj.data?.data) ? tj.data.data : []);
      setLeases(Array.isArray(lj.data?.data) ? lj.data.data : []);
    });
  }, [modalCompanyId]);

  useEffect(() => {
    if (!form.propertyId) return;
    fetch(`/api/backend/rental-units?propertyId=${form.propertyId}&limit=100`).then(r => r.json()).then(j =>
      setUnits(Array.isArray(j.data?.data) ? j.data.data : []));
  }, [form.propertyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/rent-invoices?companyId=${companyId}&page=1&limit=100`);
      if (!res.ok) throw new Error('Failed to load');
      const j = await res.json();
      const list = j.data?.data ?? j.data ?? [];
      setRows(Array.isArray(list) ? list : []);
      setTotal(j.data?.total ?? list.length);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const handleIssue = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/backend/rent-invoices/${id}/issue`, { method: 'POST' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Action failed'); }
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setActionLoading(null); }
  };

  function openNew() {
    setEditing(null); setModalCompanyId(companyId);
    setForm({ rentInvoiceNumber: '', propertyId: '', rentalUnitId: '', tenantId: '', leaseAgreementId: '', invoiceDate: '', billingPeriodStart: '', billingPeriodEnd: '', rentAmount: '', currency: 'TZS', totalAmount: '', outstandingAmount: '', dueDate: '', status: 'DRAFT', notes: '' });
    setShowModal(true);
  }
  function openEdit(row: RentInvoice) {
    setEditing(row); setModalCompanyId(companyId);
    setForm({ rentInvoiceNumber: row.rentInvoiceNumber, propertyId: row.propertyId, rentalUnitId: row.rentalUnitId, tenantId: row.tenantId, leaseAgreementId: row.leaseAgreementId, invoiceDate: row.invoiceDate?.split('T')[0] ?? '', billingPeriodStart: row.billingPeriodStart?.split('T')[0] ?? '', billingPeriodEnd: row.billingPeriodEnd?.split('T')[0] ?? '', rentAmount: String(row.rentAmount), currency: row.currency, totalAmount: String(row.totalAmount), outstandingAmount: String(row.outstandingAmount), dueDate: row.dueDate?.split('T')[0] ?? '', status: row.status, notes: row.notes ?? '' });
    setShowModal(true);
  }

  function handleLeaseChange(leaseId: string) {
    const lease = leases.find(l => l.id === leaseId);
    if (lease) {
      setForm(f => ({ ...f, leaseAgreementId: leaseId, propertyId: lease.propertyId, rentalUnitId: lease.rentalUnitId, tenantId: lease.tenantId }));
    } else {
      setForm(f => ({ ...f, leaseAgreementId: leaseId }));
    }
  }

  function handleRentChange(val: string) {
    const n = val === '' ? '' : val;
    setForm(f => ({ ...f, rentAmount: n, totalAmount: n, outstandingAmount: n }));
  }

  async function handleSave() {
    if (!form.rentInvoiceNumber.trim()) { setError('Invoice number required'); return; }
    if (!form.leaseAgreementId) { setError('Lease required'); return; }
    if (!form.invoiceDate) { setError('Invoice date required'); return; }
    if (!form.billingPeriodStart || !form.billingPeriodEnd) { setError('Billing period required'); return; }
    if (!form.rentAmount || Number(form.rentAmount) <= 0) { setError('Rent amount required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, any> = { ...form, companyId: modalCompanyId, createdById: user?.id, rentAmount: Number(form.rentAmount), totalAmount: form.totalAmount !== '' ? Number(form.totalAmount) : Number(form.rentAmount), outstandingAmount: form.outstandingAmount !== '' ? Number(form.outstandingAmount) : Number(form.rentAmount), dueDate: form.dueDate || undefined, notes: form.notes || undefined };
      const url = editing ? `/api/backend/rent-invoices/${editing.id}` : '/api/backend/rent-invoices';
      const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await fetch(`/api/backend/rent-invoices/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null); load();
  }

  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Rent Invoices" subtitle="Monthly rent billing and invoicing" />
        <div className="flex items-center gap-3">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {companyId && <Btn variant="primary" onClick={openNew}>+ New Invoice</Btn>}
        </div>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load invoices.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{total} {total === 1 ? 'invoice' : 'invoices'}</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Invoice #</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Tenant</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Unit</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Period</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Amount</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Outstanding</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Due Date</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No invoices found.</td></tr>
                ) : rows.map(row => (
                  <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.rentInvoiceNumber}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.tenant?.name ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.rentalUnit?.unitNumber ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(row.billingPeriodStart)} – {fmtDate(row.billingPeriodEnd)}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtCurrency(row.totalAmount)}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtCurrency(row.outstandingAmount)}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(row.dueDate)}</td>
                    <td className={tdCls}><StatusBadge status={row.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-1">
                        <Btn size="sm" variant="secondary" onClick={() => openEdit(row)}>Edit</Btn>
                        {row.status === 'DRAFT' && (
                          <Btn size="sm" variant="secondary" loading={actionLoading === row.id} onClick={() => handleIssue(row.id)}>Issue</Btn>
                        )}
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
        title={editing ? 'Edit Invoice' : 'New Rent Invoice'}
        size="2xl"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" loading={saving} onClick={handleSave}>{editing ? 'Save Changes' : 'Create Invoice'}</Btn>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <FormSelect label="Company *" value={modalCompanyId} onChange={e => setModalCompanyId(e.target.value)}>
            <option value="">Select…</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FormSelect>
          <FormInput label="Invoice Number *" value={form.rentInvoiceNumber} onChange={sf('rentInvoiceNumber')} placeholder="e.g. INV-2024-001" />
          <div className="col-span-2">
            <FormSelect label="Lease Agreement *" value={form.leaseAgreementId} onChange={e => handleLeaseChange(e.target.value)}>
              <option value="">Select lease…</option>
              {leases.map(l => <option key={l.id} value={l.id}>{l.leaseCode}</option>)}
            </FormSelect>
          </div>
          <FormSelect label="Property" value={form.propertyId} onChange={e => { setForm(f => ({ ...f, propertyId: e.target.value, rentalUnitId: '' })); }}>
            <option value="">Select property…</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.propertyName}</option>)}
          </FormSelect>
          <FormSelect label="Unit" value={form.rentalUnitId} onChange={sf('rentalUnitId')}>
            <option value="">Select unit…</option>
            {units.map(u => <option key={u.id} value={u.id}>{u.unitNumber}</option>)}
          </FormSelect>
          <div className="col-span-2">
            <FormSelect label="Tenant" value={form.tenantId} onChange={sf('tenantId')}>
              <option value="">Select tenant…</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.tenantCode})</option>)}
            </FormSelect>
          </div>
          <FormInput label="Invoice Date *" type="date" value={form.invoiceDate} onChange={sf('invoiceDate')} />
          <FormInput label="Due Date" type="date" value={form.dueDate} onChange={sf('dueDate')} />
          <FormInput label="Period Start *" type="date" value={form.billingPeriodStart} onChange={sf('billingPeriodStart')} />
          <FormInput label="Period End *" type="date" value={form.billingPeriodEnd} onChange={sf('billingPeriodEnd')} />
          <FormInput label="Rent Amount *" type="number" min="0" step="0.01" value={form.rentAmount} onChange={e => handleRentChange(e.target.value)} />
          <FormSelect label="Currency" value={form.currency} onChange={sf('currency')}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </FormSelect>
          <FormInput label="Total Amount" type="number" min="0" step="0.01" value={form.totalAmount} onChange={sf('totalAmount')} />
          <FormInput label="Outstanding" type="number" min="0" step="0.01" value={form.outstandingAmount} onChange={sf('outstandingAmount')} />
          <FormSelect label="Status" value={form.status} onChange={sf('status')}>
            {INVOICE_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </FormSelect>
          <div />
          <div className="col-span-2">
            <FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={2} />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Invoice"
        message={`Delete invoice "${deleteTarget?.rentInvoiceNumber}"? This cannot be undone.`}
        variant="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
