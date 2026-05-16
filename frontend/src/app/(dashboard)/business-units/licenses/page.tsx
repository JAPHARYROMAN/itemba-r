'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';

const LIC_TYPES = [
  'TRUCK_PARKING_LICENSE', 'HOTEL_LICENSE', 'GUEST_HOUSE_LICENSE', 'RESTAURANT_LICENSE',
  'BAR_LICENSE', 'LIQUOR_LICENSE', 'BUSINESS_LICENSE', 'REAL_ESTATE_LICENSE',
  'RENTAL_BUSINESS_LICENSE', 'FOOD_SERVICE_LICENSE', 'HEALTH_PERMIT',
  'FIRE_SAFETY_CERTIFICATE', 'TOURISM_LICENSE', 'OTHER',
] as const;
const LIC_STATUSES = ['ACTIVE', 'EXPIRED', 'PENDING_RENEWAL', 'SUSPENDED', 'CANCELLED'] as const;

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';
const fmtDate = (s: string) => s ? new Date(s).toLocaleDateString('en-GB') : '—';
const daysUntil = (s: string): number | null => {
  if (!s) return null;
  return Math.ceil((new Date(s).getTime() - Date.now()) / 86400000);
};

function DaysCell({ expiryDate }: { expiryDate?: string }) {
  if (!expiryDate) return <span style={{ color: 'var(--aurora-text-muted)' }}>—</span>;
  const d = daysUntil(expiryDate);
  if (d === null) return <span style={{ color: 'var(--aurora-text-muted)' }}>—</span>;
  if (d < 0)  return <span className="font-semibold text-red-600">EXPIRED</span>;
  if (d < 30) return <span className="font-semibold text-orange-600">{d} days</span>;
  if (d < 60) return <span className="font-semibold text-yellow-600">{d} days</span>;
  return <span className="text-emerald-600">{d} days</span>;
}

function rowBg(expiryDate?: string): string {
  if (!expiryDate) return '';
  const d = daysUntil(expiryDate);
  if (d === null) return '';
  if (d < 0)  return 'bg-red-50';
  if (d < 30) return 'bg-orange-50';
  if (d < 60) return 'bg-yellow-50';
  return '';
}

function KpiCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-xl border p-4 ${color}`}>
      <p className="text-xs font-medium opacity-70 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

interface Company  { id: string; name: string; }
interface Division { id: string; name: string; }
interface Branch { id: string; name: string; code?: string | null; divisionId: string; }
interface BUnit {
  id: string;
  businessUnitCode: string;
  name: string;
  divisionId?: string | null;
  branchId?: string | null;
}
interface License {
  id: string; licenseCode: string; licenseNumber: string; licenseType: string;
  issuingAuthority?: string; issueDate?: string; expiryDate?: string;
  renewalDate?: string; status: string; licensedBusinessUnitId?: string;
  divisionId?: string; branchId?: string; notes?: string; documentId?: string; responsibleUserId?: string;
  division?: { id: string; name: string; code?: string | null } | null;
  branch?: { id: string; name: string; code?: string | null } | null;
  licensedBusinessUnit?: { id: string; businessUnitCode: string; name: string } | null;
}

const EMPTY_LIC: Omit<License, 'id'> = {
  licenseCode: '', licenseNumber: '', licenseType: 'BUSINESS_LICENSE',
  issuingAuthority: '', issueDate: '', expiryDate: '', renewalDate: '',
  status: 'ACTIVE', licensedBusinessUnitId: '', divisionId: '', branchId: '',
  notes: '', documentId: '', responsibleUserId: '',
};

export default function BusinessLicensesPage() {
  const [companies,     setCompanies]     = useState<Company[]>([]);
  const [companyId,     setCompanyId]     = useState('');
  const [divisions,     setDivisions]     = useState<Division[]>([]);
  const [branches,      setBranches]      = useState<Branch[]>([]);
  const [businessUnits, setBusinessUnits] = useState<BUnit[]>([]);
  const [filterBuId,    setFilterBuId]    = useState('');
  const [filterBranchId,setFilterBranchId]= useState('');
  const [rows,          setRows]          = useState<License[]>([]);
  const [total,         setTotal]         = useState(0);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState('');
  const [showModal,     setShowModal]     = useState(false);
  const [editing,       setEditing]       = useState<License | null>(null);
  const [form,          setForm]          = useState<Omit<License, 'id'>>({ ...EMPTY_LIC });
  const [saving,        setSaving]        = useState(false);
  const [deleteId,      setDeleteId]      = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j =>
      setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (!companyId) {
      setDivisions([]);
      setBranches([]);
      setBusinessUnits([]);
      setFilterBuId('');
      setFilterBranchId('');
      return;
    }
    fetch(`/api/backend/divisions?companyId=${companyId}&limit=100`).then(r => r.json()).then(j =>
      setDivisions(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    fetch(`/api/backend/branches?companyId=${companyId}&activeOnly=true&limit=500`).then(r => r.json()).then(j =>
      setBranches(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    fetch(`/api/backend/licensed-business-units?companyId=${companyId}&limit=100`).then(r => r.json()).then(j =>
      setBusinessUnits(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ companyId, page: '1', limit: '200' });
      if (filterBuId) params.set('licensedBusinessUnitId', filterBuId);
      if (filterBranchId) params.set('branchId', filterBranchId);
      const res  = await fetch(`/api/backend/business-licenses?${params}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      const items: License[] = Array.isArray(json.data?.data) ? json.data.data : Array.isArray(json.data) ? json.data : [];
      items.sort((a, b) => {
        const da = a.expiryDate ? new Date(a.expiryDate).getTime() : Infinity;
        const db = b.expiryDate ? new Date(b.expiryDate).getTime() : Infinity;
        return da - db;
      });
      setRows(items); setTotal(json.data?.total ?? items.length);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId, filterBuId, filterBranchId]);

  useEffect(() => { load(); }, [load]);

  const active     = rows.filter(r => r.status === 'ACTIVE').length;
  const expired    = rows.filter(r => r.status === 'EXPIRED' || (r.expiryDate && (daysUntil(r.expiryDate) ?? 0) < 0)).length;
  const expiring30 = rows.filter(r => { const d = r.expiryDate ? daysUntil(r.expiryDate) : null; return d !== null && d >= 0 && d < 30; }).length;
  const expiring60 = rows.filter(r => { const d = r.expiryDate ? daysUntil(r.expiryDate) : null; return d !== null && d >= 30 && d < 60; }).length;
  const alertLicenses = rows.filter(r => { const d = r.expiryDate ? daysUntil(r.expiryDate) : null; return d !== null && d < 60; });
  const branchOptions = form.divisionId
    ? branches.filter((branch) => branch.divisionId === form.divisionId)
    : branches;

  function openCreate() { setEditing(null); setForm({ ...EMPTY_LIC }); setShowModal(true); }
  function openEdit(lic: License) {
    setEditing(lic);
    setForm({ licenseCode: lic.licenseCode, licenseNumber: lic.licenseNumber, licenseType: lic.licenseType, issuingAuthority: lic.issuingAuthority ?? '', issueDate: lic.issueDate?.slice(0, 10) ?? '', expiryDate: lic.expiryDate?.slice(0, 10) ?? '', renewalDate: lic.renewalDate?.slice(0, 10) ?? '', status: lic.status, licensedBusinessUnitId: lic.licensedBusinessUnitId ?? '', divisionId: lic.divisionId ?? '', branchId: lic.branchId ?? '', notes: lic.notes ?? '', documentId: lic.documentId ?? '', responsibleUserId: lic.responsibleUserId ?? '' });
    setShowModal(true);
  }
  const sf = (k: keyof Omit<License, 'id'>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  function setLicensedBusinessUnit(id: string) {
    const unit = businessUnits.find((bu) => bu.id === id);
    setForm((p) => ({
      ...p,
      licensedBusinessUnitId: id,
      divisionId: unit?.divisionId ?? p.divisionId,
      branchId: unit?.branchId ?? p.branchId,
    }));
  }

  function setDivision(id: string) {
    setForm((p) => ({
      ...p,
      divisionId: id,
      branchId: branches.some((branch) => branch.id === p.branchId && branch.divisionId === id)
        ? p.branchId
        : '',
    }));
  }

  function setBranch(id: string) {
    const branch = branches.find((item) => item.id === id);
    setForm((p) => ({
      ...p,
      branchId: id,
      divisionId: branch?.divisionId ?? p.divisionId,
    }));
  }

  async function markRenewal(lic: License) {
    try {
      const res = await fetch(`/api/backend/business-licenses/${lic.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, divisionId: lic.divisionId, branchId: lic.branchId, licensedBusinessUnitId: lic.licensedBusinessUnitId, status: 'PENDING_RENEWAL' }) });
      if (!res.ok) throw new Error('Update failed');
      await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Update failed'); }
  }

  async function handleSave() {
    if (!form.licenseCode.trim() || !form.licenseNumber.trim()) { setError('License Code and Number are required'); return; }
    if (!form.branchId) { setError('Branch/location is required for a business license'); return; }
    setSaving(true); setError('');
    try {
      const body = { ...form, companyId, licensedBusinessUnitId: form.licensedBusinessUnitId || undefined, divisionId: form.divisionId || undefined, branchId: form.branchId || undefined, issueDate: form.issueDate || undefined, expiryDate: form.expiryDate || undefined, renewalDate: form.renewalDate || undefined, documentId: form.documentId || undefined, responsibleUserId: form.responsibleUserId || undefined };
      const url = editing ? `/api/backend/business-licenses/${editing.id}` : '/api/backend/business-licenses';
      const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message ?? 'Save failed'); }
      setShowModal(false); await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function doDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/backend/business-licenses/${deleteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setDeleteId(null); await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Delete failed'); }
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Business Licenses" subtitle="License registry and renewal tracking" />
        <div className="flex items-center gap-3 flex-wrap">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {companyId && (
            <>
              <select value={filterBuId} onChange={e => setFilterBuId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
                <option value="">All Business Units</option>
                {businessUnits.map(bu => <option key={bu.id} value={bu.id}>{bu.businessUnitCode} — {bu.name}</option>)}
              </select>
              <select value={filterBranchId} onChange={e => setFilterBranchId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
                <option value="">All Branches</option>
                {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code ? `${branch.code} — ` : ''}{branch.name}</option>)}
              </select>
              <Btn variant="primary" onClick={openCreate}>+ New License</Btn>
            </>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <Link href="/business-units" className="px-3 py-1.5 border border-slate-200 text-xs rounded-md hover:bg-slate-50 font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>← Business Units</Link>
        <Link href="/business-units/licenses" className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-md font-medium">Licenses</Link>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}

      {companyId && !loading && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <KpiCard label="Total Licenses" value={total}      color="bg-white border-zinc-200 text-zinc-700" />
            <KpiCard label="Active"          value={active}     color="bg-emerald-50 border-emerald-200 text-emerald-800" />
            <KpiCard label="Expired"         value={expired}    color="bg-red-50 border-red-200 text-red-800" />
            <KpiCard label="Expiring < 30d"  value={expiring30} color="bg-orange-50 border-orange-200 text-orange-800" />
            <KpiCard label="Expiring < 60d"  value={expiring60} color="bg-yellow-50 border-yellow-200 text-yellow-800" />
          </div>

          {alertLicenses.length > 0 && (
            <div className="border border-red-300 bg-red-50 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">🚨</span>
                <span className="font-semibold text-red-700 text-sm">Compliance Alert — {alertLicenses.length} license{alertLicenses.length > 1 ? 's' : ''} expiring within 60 days</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-red-600 border-b border-red-200">
                      <th className="py-1 px-2 text-left font-semibold">Code</th>
                      <th className="py-1 px-2 text-left font-semibold">License #</th>
                      <th className="py-1 px-2 text-left font-semibold">Type</th>
                      <th className="py-1 px-2 text-left font-semibold">Expiry</th>
                      <th className="py-1 px-2 text-left font-semibold">Days Left</th>
                      <th className="py-1 px-2 text-left font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alertLicenses.map(lic => {
                      const d = lic.expiryDate ? daysUntil(lic.expiryDate) : null;
                      const rowCls = d !== null && d < 0 ? 'bg-red-100' : d !== null && d < 30 ? 'bg-orange-50' : 'bg-yellow-50';
                      return (
                        <tr key={lic.id} className={`border-b border-red-100 ${rowCls}`}>
                          <td className="py-1 px-2 font-mono font-medium">{lic.licenseCode}</td>
                          <td className="py-1 px-2">{lic.licenseNumber}</td>
                          <td className="py-1 px-2">{lic.licenseType.replace(/_/g, ' ')}</td>
                          <td className="py-1 px-2">{fmtDate(lic.expiryDate ?? '')}</td>
                          <td className="py-1 px-2"><DaysCell expiryDate={lic.expiryDate} /></td>
                          <td className="py-1 px-2"><StatusBadge status={lic.status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{total} licenses — sorted by expiry date (most urgent first)</div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Code</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>License #</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Type</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Branch</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Business Unit</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Issuing Authority</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Issue Date</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Expiry Date</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Days Left</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={11} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No licenses found.</td></tr>
                  ) : rows.map(lic => {
                    const d = lic.expiryDate ? daysUntil(lic.expiryDate) : null;
                    const canRenew = lic.status === 'ACTIVE' && d !== null && d < 60;
                    return (
                      <tr key={lic.id} className={`border-b border-slate-50 hover:brightness-95 transition-colors ${rowBg(lic.expiryDate)}`}>
                        <td className={`${tdCls} font-mono font-medium text-indigo-600`}>{lic.licenseCode}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{lic.licenseNumber}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}><span className="text-xs">{lic.licenseType.replace(/_/g, ' ')}</span></td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{lic.branch ? `${lic.branch.code ? `${lic.branch.code} — ` : ''}${lic.branch.name}` : '—'}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{lic.licensedBusinessUnit ? `${lic.licensedBusinessUnit.businessUnitCode} — ${lic.licensedBusinessUnit.name}` : '—'}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{lic.issuingAuthority || '—'}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(lic.issueDate ?? '')}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(lic.expiryDate ?? '')}</td>
                        <td className={tdCls}><DaysCell expiryDate={lic.expiryDate} /></td>
                        <td className={tdCls}><StatusBadge status={lic.status} /></td>
                        <td className={tdCls}>
                          <div className="flex gap-1 flex-wrap">
                            <Btn size="sm" variant="secondary" onClick={() => openEdit(lic)}>Edit</Btn>
                            {canRenew && <Btn size="sm" variant="warning" onClick={() => markRenewal(lic)}>Renew</Btn>}
                            <Btn size="sm" variant="danger" onClick={() => setDeleteId(lic.id)}>Delete</Btn>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit License' : 'New License'} size="lg"
        footer={<><Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn><Btn variant="primary" loading={saving} onClick={handleSave}>{editing ? 'Update' : 'Create'}</Btn></>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormInput label="License Code *" value={form.licenseCode} onChange={sf('licenseCode')} placeholder="LIC-001" />
            <FormInput label="License Number *" value={form.licenseNumber} onChange={sf('licenseNumber')} placeholder="TZ/2024/001" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormSelect label="License Type *" value={form.licenseType} onChange={sf('licenseType')}>
              {LIC_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </FormSelect>
            <FormSelect label="Status" value={form.status} onChange={sf('status')}>
              {LIC_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </FormSelect>
          </div>
          <FormInput label="Issuing Authority" value={form.issuingAuthority ?? ''} onChange={sf('issuingAuthority')} placeholder="Tanzania Revenue Authority" />
          {businessUnits.length > 0 && (
            <FormSelect label="Business Unit" value={form.licensedBusinessUnitId ?? ''} onChange={e => setLicensedBusinessUnit(e.target.value)}>
              <option value="">— None —</option>
              {businessUnits.map(bu => <option key={bu.id} value={bu.id}>{bu.businessUnitCode} — {bu.name}</option>)}
            </FormSelect>
          )}
          {divisions.length > 0 && (
            <FormSelect label="Division" value={form.divisionId ?? ''} onChange={e => setDivision(e.target.value)}>
              <option value="">— None —</option>
              {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </FormSelect>
          )}
          <FormSelect label="Branch / Location *" value={form.branchId ?? ''} onChange={e => setBranch(e.target.value)}>
            <option value="">— Select branch —</option>
            {branchOptions.map(branch => <option key={branch.id} value={branch.id}>{branch.code ? `${branch.code} — ` : ''}{branch.name}</option>)}
          </FormSelect>
          <div className="grid grid-cols-3 gap-4">
            <FormInput label="Issue Date" type="date" value={form.issueDate ?? ''} onChange={sf('issueDate')} />
            <FormInput label="Expiry Date" type="date" value={form.expiryDate ?? ''} onChange={sf('expiryDate')} />
            <FormInput label="Renewal Date" type="date" value={form.renewalDate ?? ''} onChange={sf('renewalDate')} />
          </div>
          <FormTextarea label="Notes" value={form.notes ?? ''} onChange={sf('notes')} rows={3} />
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete License?" message="Delete this license? This cannot be undone." variant="danger" onConfirm={doDelete} />
    </div>
  );
}
