'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

const UNIT_TYPES = ['SHOP','HOUSE','ROOM','APARTMENT','OFFICE','STORE','WAREHOUSE','OTHER'];
const UNIT_STATUSES = ['VACANT','OCCUPIED','RESERVED','UNDER_MAINTENANCE','CLOSED'];
const BILLING_FREQUENCIES = ['DAILY','WEEKLY','MONTHLY','QUARTERLY','YEARLY','CUSTOM'];
const CURRENCIES = ['TZS','USD','EUR','KES','UGX'];

interface Company { id: string; name: string; code: string; }
interface RentalProperty { id: string; propertyName: string; propertyCode: string; }
interface Unit {
  id: string; unitCode: string; unitNumber: string; unitType: string;
  rentAmount: number; currency: string; billingFrequency: string;
  status: string; floor?: string; sizeDescription?: string; securityDepositAmount?: number;
  notes?: string; propertyId: string; companyId: string;
  property?: { propertyName: string };
}

function fmtCurrency(n: number | string | null | undefined) { const value = Number(n ?? 0); return `TZS ${new Intl.NumberFormat('en-US').format(Number.isFinite(value) ? value : 0)}`; }

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function RentalUnitsPage() {
  const { user } = useAuth();
  void user;
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [filterPropertyId, setFilterPropertyId] = useState('');
  const [properties, setProperties] = useState<RentalProperty[]>([]);
  const [modalProperties, setModalProperties] = useState<RentalProperty[]>([]);
  const [rows, setRows] = useState<Unit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ unitCode: '', propertyId: '', unitType: 'SHOP', unitNumber: '', rentAmount: '', currency: 'TZS', billingFrequency: 'MONTHLY', status: 'VACANT', floor: '', sizeDescription: '', securityDepositAmount: '', notes: '' });
  const [modalCompanyId, setModalCompanyId] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Unit | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j =>
      setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (!companyId) return;
    fetch(`/api/backend/rental-properties?companyId=${companyId}&limit=100`).then(r => r.json()).then(j => {
      const list = j.data?.data ?? j.data ?? [];
      setProperties(Array.isArray(list) ? list : []);
    });
  }, [companyId]);

  useEffect(() => {
    if (!modalCompanyId) { setModalProperties([]); return; }
    fetch(`/api/backend/rental-properties?companyId=${modalCompanyId}&limit=100`).then(r => r.json()).then(j => {
      const list = j.data?.data ?? j.data ?? [];
      setModalProperties(Array.isArray(list) ? list : []);
    });
  }, [modalCompanyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      let url = `/api/backend/rental-units?companyId=${companyId}&page=1&limit=100`;
      if (filterPropertyId) url += `&propertyId=${filterPropertyId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load');
      const j = await res.json();
      const list = j.data?.data ?? j.data ?? [];
      setRows(Array.isArray(list) ? list : []);
      setTotal(j.data?.total ?? list.length);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId, filterPropertyId]);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null); setModalCompanyId(companyId);
    setForm({ unitCode: '', propertyId: '', unitType: 'SHOP', unitNumber: '', rentAmount: '', currency: 'TZS', billingFrequency: 'MONTHLY', status: 'VACANT', floor: '', sizeDescription: '', securityDepositAmount: '', notes: '' });
    setShowModal(true);
  }
  function openEdit(row: Unit) {
    setEditing(row); setModalCompanyId(companyId);
    setForm({
      unitCode: row.unitCode, propertyId: row.propertyId, unitType: row.unitType,
      unitNumber: row.unitNumber, rentAmount: String(row.rentAmount), currency: row.currency,
      billingFrequency: row.billingFrequency, status: row.status,
      floor: row.floor ?? '', sizeDescription: row.sizeDescription ?? '',
      securityDepositAmount: row.securityDepositAmount != null ? String(row.securityDepositAmount) : '',
      notes: row.notes ?? '',
    });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.unitCode.trim()) { setError('Unit code required'); return; }
    if (!form.propertyId) { setError('Property required'); return; }
    if (!form.unitNumber.trim()) { setError('Unit number required'); return; }
    if (!form.rentAmount || Number(form.rentAmount) <= 0) { setError('Rent amount required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, any> = {
        ...form, companyId: modalCompanyId, rentAmount: Number(form.rentAmount),
        securityDepositAmount: form.securityDepositAmount !== '' ? Number(form.securityDepositAmount) : undefined,
        floor: form.floor || undefined, sizeDescription: form.sizeDescription || undefined, notes: form.notes || undefined,
      };
      const url = editing ? `/api/backend/rental-units/${editing.id}` : '/api/backend/rental-units';
      const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await fetch(`/api/backend/rental-units/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null); load();
  }

  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Rental Units" subtitle="Individual units within rental properties" />
        <div className="flex items-center gap-3 flex-wrap">
          <select value={companyId} onChange={e => { setCompanyId(e.target.value); setFilterPropertyId(''); }} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {companyId && (
            <select value={filterPropertyId} onChange={e => setFilterPropertyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white" style={{ color: 'var(--aurora-text)' }}>
              <option value="">All Properties</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.propertyName}</option>)}
            </select>
          )}
          {companyId && <Btn variant="primary" onClick={openNew}>+ New Unit</Btn>}
        </div>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load units.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{total} {total === 1 ? 'unit' : 'units'}</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Code</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Unit #</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Property</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Type</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Floor</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Rent</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Frequency</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No units found.</td></tr>
                ) : rows.map(row => (
                  <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.unitCode}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.unitNumber}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.property?.propertyName ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.unitType}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.floor ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtCurrency(row.rentAmount)}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.billingFrequency}</td>
                    <td className={tdCls}><StatusBadge status={row.status} /></td>
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
        title={editing ? 'Edit Unit' : 'New Rental Unit'}
        size="lg"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" loading={saving} onClick={handleSave}>{editing ? 'Save Changes' : 'Create Unit'}</Btn>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <FormSelect label="Company *" value={modalCompanyId} onChange={e => setModalCompanyId(e.target.value)}>
            <option value="">Select…</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FormSelect>
          <FormSelect label="Property *" value={form.propertyId} onChange={sf('propertyId')}>
            <option value="">Select property…</option>
            {modalProperties.map(p => <option key={p.id} value={p.id}>{p.propertyName}</option>)}
          </FormSelect>
          <FormInput label="Unit Code *" value={form.unitCode} onChange={sf('unitCode')} placeholder="e.g. UNIT-001" />
          <FormInput label="Unit Number *" value={form.unitNumber} onChange={sf('unitNumber')} placeholder="e.g. A-01" />
          <FormSelect label="Unit Type *" value={form.unitType} onChange={sf('unitType')}>
            {UNIT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </FormSelect>
          <FormInput label="Floor" value={form.floor} onChange={sf('floor')} placeholder="e.g. 1, Ground" />
          <FormInput label="Rent Amount *" type="number" min="0" step="0.01" value={form.rentAmount} onChange={sf('rentAmount')} placeholder="0.00" />
          <FormSelect label="Currency" value={form.currency} onChange={sf('currency')}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </FormSelect>
          <FormSelect label="Billing Frequency *" value={form.billingFrequency} onChange={sf('billingFrequency')}>
            {BILLING_FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
          </FormSelect>
          <FormInput label="Security Deposit" type="number" min="0" step="0.01" value={form.securityDepositAmount} onChange={sf('securityDepositAmount')} placeholder="0.00" />
          <FormSelect label="Status" value={form.status} onChange={sf('status')}>
            {UNIT_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </FormSelect>
          <FormInput label="Size Description" value={form.sizeDescription} onChange={sf('sizeDescription')} placeholder="e.g. 50 sqm" />
          <div className="col-span-2">
            <FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={2} />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Unit"
        message={`Delete unit "${deleteTarget?.unitNumber}"? This cannot be undone.`}
        variant="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
