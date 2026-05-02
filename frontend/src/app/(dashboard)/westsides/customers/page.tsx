'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Btn, Card, FormInput, FormSelect, FormTextarea, Modal, PageHeader, PageSpinner, PageToolbar } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

interface Customer {
  id: string;
  customerCode: string;
  name: string;
  customerType: string;
  phone?: string | null;
  email?: string | null;
  status: string;
  creditLimit?: number | string;
  currentBalance?: number | string;
}

interface FormState {
  customerCode: string;
  name: string;
  customerType: string;
  legalName: string;
  tin: string;
  vrn: string;
  phone: string;
  email: string;
  address: string;
  contactPerson: string;
  creditLimit: string;
  paymentTerms: string;
  notes: string;
}

const blankForm = (): FormState => ({
  customerCode: '', name: '', customerType: 'INDIVIDUAL',
  legalName: '', tin: '', vrn: '', phone: '', email: '', address: '',
  contactPerson: '', creditLimit: '0', paymentTerms: '', notes: '',
});

const CUSTOMER_TYPES = [
  { value: 'INDIVIDUAL', label: 'Individual' },
  { value: 'COMPANY', label: 'Company' },
  { value: 'GOVERNMENT', label: 'Government' },
  { value: 'NGO', label: 'NGO' },
  { value: 'OTHER', label: 'Other' },
];

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

export default function WestsidesCustomersPage() {
  const [companyId, setCompanyId] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { companyOptions } = useOrgScope(companyId, { skipBranches: true, skipDivisions: true, skipEmployees: true });

  const load = () => {
    if (!companyId) { setRows([]); return; }
    setLoading(true);
    const params = new URLSearchParams({ companyId, limit: '200' });
    if (search) params.set('search', search);
    fetch(`/api/backend/customers?${params}`)
      .then(r => r.json())
      .then(j => setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!companyId) { setRows([]); return; }
    setLoading(true);
    const params = new URLSearchParams({ companyId, limit: '200' });
    if (search) params.set('search', search);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/backend/customers?${params}`, { signal: ctrl.signal })
        .then(r => r.json())
        .then(j => setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []))
        .catch(() => setRows([]))
        .finally(() => setLoading(false));
    }, 200);
    return () => { ctrl.abort(); clearTimeout(t); };
  }, [companyId, search]);

  const fmt = (n: number | string | undefined | null) =>
    new Intl.NumberFormat('en-TZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n ?? 0));

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const openCreate = () => {
    if (!companyId) { setError('Pick a company first'); return; }
    setForm(blankForm());
    setError('');
    setShowCreate(true);
  };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId) { setError('Company is required'); return; }
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        companyId,
        name: form.name.trim(),
        customerType: form.customerType,
      };
      if (form.customerCode.trim()) body.customerCode = form.customerCode.trim();
      if (form.legalName.trim()) body.legalName = form.legalName.trim();
      if (form.tin.trim()) body.tin = form.tin.trim();
      if (form.vrn.trim()) body.vrn = form.vrn.trim();
      if (form.phone.trim()) body.phone = form.phone.trim();
      if (form.email.trim()) body.email = form.email.trim();
      if (form.address.trim()) body.address = form.address.trim();
      if (form.contactPerson.trim()) body.contactPerson = form.contactPerson.trim();
      if (form.creditLimit && Number(form.creditLimit) >= 0) body.creditLimit = Number(form.creditLimit);
      if (form.paymentTerms.trim()) body.paymentTerms = form.paymentTerms.trim();
      if (form.notes.trim()) body.notes = form.notes.trim();

      const res = await fetch('/api/backend/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? `HTTP ${res.status}`));
      }
      setShowCreate(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6">
      <PageHeader title="Customers" subtitle="Click a customer to open their 360° profile." />
      <PageToolbar
        filters={
          <>
            <div className="w-64">
              <FormSelect value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={companyOptions} placeholder="Pick company" />
            </div>
            <input
              type="text"
              placeholder="Search name / code / phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={!companyId}
              className="text-sm border rounded-lg px-3 py-1.5 w-64 focus:outline-none focus:ring-2 focus:ring-brand-500"
              style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}
            />
          </>
        }
        actions={<Btn variant="primary" onClick={openCreate} disabled={!companyId}>+ New Customer</Btn>}
      />
      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100" style={{ color: 'var(--aurora-text-muted)' }}>
                <tr>
                  <th className={thCls}>Code</th>
                  <th className={thCls}>Name</th>
                  <th className={thCls}>Type</th>
                  <th className={thCls}>Phone</th>
                  <th className={thCls + ' text-right'}>Credit Limit</th>
                  <th className={thCls + ' text-right'}>Current Balance</th>
                  <th className={thCls}></th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map(c => (
                  <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-mono`}>{c.customerCode}</td>
                    <td className={`${tdCls} font-medium`}>{c.name}</td>
                    <td className={tdCls}>{c.customerType}</td>
                    <td className={tdCls}>{c.phone ?? '—'}</td>
                    <td className={`${tdCls} text-right tabular-nums`}>TZS {fmt(c.creditLimit)}</td>
                    <td className={`${tdCls} text-right tabular-nums`}>TZS {fmt(c.currentBalance)}</td>
                    <td className={tdCls}>
                      <Link href={`/westsides/customers/${c.id}`} className="text-brand-600 hover:underline text-sm font-medium">Open 360° →</Link>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && !loading && (
                  <tr><td colSpan={7} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                    {companyId ? 'No customers match the search.' : 'Pick a company to load customers.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New Customer"
        size="lg"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Btn>
            <Btn variant="primary" type="submit" form="customer-form" loading={saving}>Save Customer</Btn>
          </>
        }
      >
        <form id="customer-form" onSubmit={submitCreate} className="space-y-3">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <FormInput
              label="Name"
              required
              value={form.name}
              onChange={f('name')}
              placeholder="Full name or company name"
            />
            <FormSelect label="Type" value={form.customerType} onChange={f('customerType')} options={CUSTOMER_TYPES} />
            <FormInput
              label="Customer Code"
              value={form.customerCode}
              onChange={f('customerCode')}
              placeholder="Auto-generated when blank"
              hint="Leave blank for an auto-generated code"
            />
            <FormInput label="Legal Name" value={form.legalName} onChange={f('legalName')} placeholder="If different from name" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Phone" value={form.phone} onChange={f('phone')} placeholder="+255 …" />
            <FormInput label="Email" type="email" value={form.email} onChange={f('email')} />
            <FormInput label="Contact Person" value={form.contactPerson} onChange={f('contactPerson')} />
            <FormInput label="Address" value={form.address} onChange={f('address')} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <FormInput label="TIN" value={form.tin} onChange={f('tin')} placeholder="Tax ID" />
            <FormInput label="VRN" value={form.vrn} onChange={f('vrn')} placeholder="VAT registration" />
            <FormInput label="Payment Terms" value={form.paymentTerms} onChange={f('paymentTerms')} placeholder="Net 30, COD, etc." />
          </div>

          <FormInput
            label="Credit Limit (TZS)"
            type="number"
            value={form.creditLimit}
            onChange={f('creditLimit')}
            hint="Set above 0 to allow credit sales (CREDIT payment method on Sales Orders / Folio settle)."
          />

          <FormTextarea label="Notes" rows={2} value={form.notes} onChange={f('notes')} />
        </form>
      </Modal>
    </div>
  );
}
