'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

const LEASE_STATUSES = ['DRAFT','ACTIVE','EXPIRED','TERMINATED','CANCELLED'];
const BILLING_FREQUENCIES = ['DAILY','WEEKLY','MONTHLY','QUARTERLY','YEARLY','CUSTOM'];
const CURRENCIES = ['TZS','USD','EUR','KES','UGX'];

interface Company { id: string; name: string; code: string; }
interface RentalProperty { id: string; propertyName: string; }
interface RentalUnit { id: string; unitNumber: string; propertyId: string; }
interface Tenant { id: string; name: string; tenantCode: string; }
interface Lease {
  id: string; leaseCode: string; companyId: string; propertyId: string;
  rentalUnitId: string; tenantId: string; startDate: string; endDate?: string;
  rentAmount: number; currency: string; billingFrequency: string; status: string;
  securityDepositAmount?: number; securityDepositPaid?: number;
  paymentTerms?: string; notes?: string;
  tenant?: { name: string }; rentalUnit?: { unitNumber: string };
  property?: { propertyName: string };
}

function fmtCurrency(n: number) { return `TZS ${new Intl.NumberFormat('en-US').format(n)}`; }
function fmtDate(d?: string) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function LeaseAgreementsPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [rows, setRows] = useState<Lease[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Lease | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ leaseCode: '', propertyId: '', rentalUnitId: '', tenantId: '', startDate: '', endDate: '', rentAmount: '', currency: 'TZS', billingFrequency: 'MONTHLY', status: 'DRAFT', securityDepositAmount: '', securityDepositPaid: '', paymentTerms: '', notes: '' });
  const [modalCompanyId, setModalCompanyId] = useState('');
  const [properties, setProperties] = useState<RentalProperty[]>([]);
  const [units, setUnits] = useState<RentalUnit[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Lease | null>(null);
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
    ]).then(([pj, tj]) => {
      setProperties(Array.isArray(pj.data?.data) ? pj.data.data : []);
      setTenants(Array.isArray(tj.data?.data) ? tj.data.data : []);
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
      const res = await fetch(`/api/backend/lease-agreements?companyId=${companyId}&page=1&limit=100`);
      if (!res.ok) throw new Error('Failed to load');
      const j = await res.json();
      const list = j.data?.data ?? j.data ?? [];
      setRows(Array.isArray(list) ? list : []);
      setTotal(j.data?.total ?? list.length);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (id: string, action: string) => {
    setActionLoading(id + action);
    try {
      const res = await fetch(`/api/backend/lease-agreements/${id}/${action}`, { method: 'POST' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Action failed'); }
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setActionLoading(null); }
  };

  function openNew() {
    setEditing(null); setModalCompanyId(companyId);
    setForm({ leaseCode: '', propertyId: '', rentalUnitId: '', tenantId: '', startDate: '', endDate: '', rentAmount: '', currency: 'TZS', billingFrequency: 'MONTHLY', status: 'DRAFT', securityDepositAmount: '', securityDepositPaid: '', paymentTerms: '', notes: '' });
    setShowModal(true);
  }
  function openEdit(row: Lease) {
    setEditing(row); setModalCompanyId(companyId);
    setForm({ leaseCode: row.leaseCode, propertyId: row.propertyId, rentalUnitId: row.rentalUnitId, tenantId: row.tenantId, startDate: row.startDate?.split('T')[0] ?? '', endDate: row.endDate?.split('T')[0] ?? '', rentAmount: String(row.rentAmount), currency: row.currency, billingFrequency: row.billingFrequency, status: row.status, securityDepositAmount: row.securityDepositAmount != null ? String(row.securityDepositAmount) : '', securityDepositPaid: row.securityDepositPaid != null ? String(row.securityDepositPaid) : '', paymentTerms: row.paymentTerms ?? '', notes: row.notes ?? '' });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.leaseCode.trim()) { setError('Lease code required'); return; }
    if (!form.propertyId) { setError('Property required'); return; }
    if (!form.rentalUnitId) { setError('Unit required'); return; }
    if (!form.tenantId) { setError('Tenant required'); return; }
    if (!form.startDate) { setError('Start date required'); return; }
    if (!form.rentAmount || Number(form.rentAmount) <= 0) { setError('Rent amount required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, any> = { ...form, companyId: modalCompanyId, createdById: user?.id, rentAmount: Number(form.rentAmount), endDate: form.endDate || undefined, securityDepositAmount: form.securityDepositAmount !== '' ? Number(form.securityDepositAmount) : undefined, securityDepositPaid: form.securityDepositPaid !== '' ? Number(form.securityDepositPaid) : undefined, paymentTerms: form.paymentTerms || undefined, notes: form.notes || undefined };
      const url = editing ? `/api/backend/lease-agreements/${editing.id}` : '/api/backend/lease-agreements';
      const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await fetch(`/api/backend/lease-agreements/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null); load();
  }

  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Lease Agreements" subtitle="Tenant lease contract management" />
        <div className="flex items-center gap-3">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {companyId && <Btn variant="primary" onClick={openNew}>+ New Lease</Btn>}
        </div>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load leases.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{total} lease {total === 1 ? 'agreement' : 'agreements'}</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Code</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Tenant</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Unit</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Property</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Start</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>End</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Rent</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Freq</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No lease agreements found.</td></tr>
                ) : rows.map(row => (
                  <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.leaseCode}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.tenant?.name ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.rentalUnit?.unitNumber ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.property?.propertyName ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(row.startDate)}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(row.endDate)}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtCurrency(row.rentAmount)}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.billingFrequency}</td>
                    <td className={tdCls}><StatusBadge status={row.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-1 flex-wrap">
                        <Btn size="sm" variant="secondary" onClick={() => openEdit(row)}>Edit</Btn>
                        {row.status === 'DRAFT' && (
                          <Btn size="sm" variant="secondary" loading={actionLoading === row.id + 'approve'} onClick={() => handleAction(row.id, 'approve')}>Approve</Btn>
                        )}
                        {row.status === 'ACTIVE' && (
                          <Btn size="sm" variant="danger" loading={actionLoading === row.id + 'terminate'} onClick={() => handleAction(row.id, 'terminate')}>Terminate</Btn>
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
        title={editing ? 'Edit Lease' : 'New Lease Agreement'}
        size="2xl"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" loading={saving} onClick={handleSave}>{editing ? 'Save Changes' : 'Create Lease'}</Btn>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <FormSelect label="Company *" value={modalCompanyId} onChange={e => setModalCompanyId(e.target.value)}>
            <option value="">Select…</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FormSelect>
          <FormInput label="Lease Code *" value={form.leaseCode} onChange={sf('leaseCode')} placeholder="e.g. LEASE-001" />
          <FormSelect label="Property *" value={form.propertyId} onChange={e => { sf('propertyId')(e); setForm(f => ({ ...f, propertyId: e.target.value, rentalUnitId: '' })); }}>
            <option value="">Select property…</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.propertyName}</option>)}
          </FormSelect>
          <FormSelect label="Unit *" value={form.rentalUnitId} onChange={sf('rentalUnitId')}>
            <option value="">Select unit…</option>
            {units.map(u => <option key={u.id} value={u.id}>{u.unitNumber}</option>)}
          </FormSelect>
          <div className="col-span-2">
            <FormSelect label="Tenant *" value={form.tenantId} onChange={sf('tenantId')}>
              <option value="">Select tenant…</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.tenantCode})</option>)}
            </FormSelect>
          </div>
          <FormInput label="Start Date *" type="date" value={form.startDate} onChange={sf('startDate')} />
          <FormInput label="End Date" type="date" value={form.endDate} onChange={sf('endDate')} />
          <FormInput label="Rent Amount *" type="number" min="0" step="0.01" value={form.rentAmount} onChange={sf('rentAmount')} />
          <FormSelect label="Currency" value={form.currency} onChange={sf('currency')}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </FormSelect>
          <FormSelect label="Billing Frequency *" value={form.billingFrequency} onChange={sf('billingFrequency')}>
            {BILLING_FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
          </FormSelect>
          <FormSelect label="Status" value={form.status} onChange={sf('status')}>
            {LEASE_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </FormSelect>
          <FormInput label="Security Deposit" type="number" min="0" step="0.01" value={form.securityDepositAmount} onChange={sf('securityDepositAmount')} placeholder="0.00" />
          <FormInput label="Deposit Paid" type="number" min="0" step="0.01" value={form.securityDepositPaid} onChange={sf('securityDepositPaid')} placeholder="0.00" />
          <div className="col-span-2">
            <FormInput label="Payment Terms" value={form.paymentTerms} onChange={sf('paymentTerms')} placeholder="e.g. Due on 1st of each month" />
          </div>
          <div className="col-span-2">
            <FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={2} />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Lease"
        message={`Delete lease "${deleteTarget?.leaseCode}"? This cannot be undone.`}
        variant="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
