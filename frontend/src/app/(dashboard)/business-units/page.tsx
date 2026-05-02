'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';

const BU_TYPES = [
  'TRUCK_PARKING', 'HOSPITALITY', 'GUEST_HOUSE', 'HOTEL', 'RESTAURANT',
  'BAR', 'REAL_ESTATE_RENTAL', 'SHOPS_RENTAL', 'HOUSES_RENTAL', 'PETROLEUM', 'OTHER',
] as const;
const BU_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'CLOSED'] as const;

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

interface Company  { id: string; name: string; }
interface Division { id: string; name: string; }
interface BUnit {
  id: string; businessUnitCode: string; name: string; tradingName?: string;
  businessUnitType: string; location?: string; licenseRequired?: boolean;
  status: string; divisionId?: string; branchId?: string; notes?: string;
  startDate?: string; endDate?: string;
}

const EMPTY: Omit<BUnit, 'id'> = {
  businessUnitCode: '', name: '', tradingName: '', businessUnitType: 'OTHER',
  location: '', licenseRequired: false, status: 'ACTIVE',
  divisionId: '', branchId: '', notes: '', startDate: '', endDate: '',
};

function KpiCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-xl border p-4 ${color}`}>
      <p className="text-xs font-medium opacity-70 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

export default function BusinessUnitsPage() {
  const [companies,  setCompanies]  = useState<Company[]>([]);
  const [companyId,  setCompanyId]  = useState('');
  const [divisions,  setDivisions]  = useState<Division[]>([]);
  const [divisionId, setDivisionId] = useState('');
  const [rows,       setRows]       = useState<BUnit[]>([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [showModal,  setShowModal]  = useState(false);
  const [editing,    setEditing]    = useState<BUnit | null>(null);
  const [form,       setForm]       = useState<Omit<BUnit, 'id'>>({ ...EMPTY });
  const [saving,     setSaving]     = useState(false);
  const [deleteId,   setDeleteId]   = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j =>
      setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (!companyId) { setDivisions([]); setDivisionId(''); return; }
    fetch(`/api/backend/divisions?companyId=${companyId}&limit=100`).then(r => r.json()).then(j => {
      const divs = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
      setDivisions(divs);
      if (divs.length > 0 && !divisionId) setDivisionId(divs[0].id);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/licensed-business-units?companyId=${companyId}&page=1&limit=100`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      const items: BUnit[] = Array.isArray(json.data?.data) ? json.data.data : Array.isArray(json.data) ? json.data : [];
      setRows(items); setTotal(json.data?.total ?? items.length);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const active    = rows.filter(r => r.status === 'ACTIVE').length;
  const inactive  = rows.filter(r => r.status === 'INACTIVE').length;
  const suspended = rows.filter(r => r.status === 'SUSPENDED').length;

  function openCreate() { setEditing(null); setForm({ ...EMPTY, divisionId: divisionId ?? '' }); setShowModal(true); }
  function openEdit(u: BUnit) {
    setEditing(u);
    setForm({ businessUnitCode: u.businessUnitCode, name: u.name, tradingName: u.tradingName ?? '', businessUnitType: u.businessUnitType, location: u.location ?? '', licenseRequired: u.licenseRequired ?? false, status: u.status, divisionId: u.divisionId ?? '', branchId: u.branchId ?? '', notes: u.notes ?? '', startDate: u.startDate ?? '', endDate: u.endDate ?? '' });
    setShowModal(true);
  }
  const sf = (k: keyof Omit<BUnit, 'id'>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  async function handleSave() {
    if (!form.businessUnitCode.trim() || !form.name.trim()) { setError('Code and Name are required'); return; }
    setSaving(true); setError('');
    try {
      const body = { ...form, companyId, divisionId: form.divisionId || undefined, branchId: form.branchId || undefined, startDate: form.startDate || undefined, endDate: form.endDate || undefined };
      const url = editing ? `/api/backend/licensed-business-units/${editing.id}` : '/api/backend/licensed-business-units';
      const res = await fetch(url, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message ?? 'Save failed'); }
      setShowModal(false); await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function doDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/backend/licensed-business-units/${deleteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setDeleteId(null); await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Delete failed'); }
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Business Units" subtitle="Licensed business units registry" />
        <div className="flex items-center gap-3 flex-wrap">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {companyId && <Btn variant="primary" onClick={openCreate}>+ New Business Unit</Btn>}
        </div>
      </div>

      <div className="flex gap-3">
        <Link href="/business-units" className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-md font-medium">Business Units</Link>
        <Link href="/business-units/licenses" className="px-3 py-1.5 border border-slate-200 text-xs rounded-md hover:bg-slate-50 font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>Licenses →</Link>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}

      {companyId && !loading && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCard label="Total Units"  value={total}     color="bg-white border-zinc-200 text-zinc-700" />
            <KpiCard label="Active"       value={active}    color="bg-emerald-50 border-emerald-200 text-emerald-800" />
            <KpiCard label="Inactive"     value={inactive}  color="bg-zinc-50 border-zinc-200 text-zinc-700" />
            <KpiCard label="Suspended"    value={suspended} color="bg-orange-50 border-orange-200 text-orange-800" />
          </div>

          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{total} business units</div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Code</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Name</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Trading Name</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Type</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Location</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Lic. Req.</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No business units found.</td></tr>
                  ) : rows.map(u => (
                    <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className={`${tdCls} font-mono font-medium text-indigo-600`}>{u.businessUnitCode}</td>
                      <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{u.name}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{u.tradingName || '—'}</td>
                      <td className={tdCls}><StatusBadge status={u.businessUnitType} /></td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{u.location || '—'}</td>
                      <td className={tdCls}>{u.licenseRequired ? <span className="text-amber-600 font-medium">Yes</span> : <span style={{ color: 'var(--aurora-text-muted)' }}>No</span>}</td>
                      <td className={tdCls}><StatusBadge status={u.status} /></td>
                      <td className={tdCls}>
                        <div className="flex gap-1">
                          <Btn size="sm" variant="secondary" onClick={() => openEdit(u)}>Edit</Btn>
                          <Btn size="sm" variant="danger" onClick={() => setDeleteId(u.id)}>Delete</Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Business Unit' : 'New Business Unit'} size="lg"
        footer={<><Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn><Btn variant="primary" loading={saving} onClick={handleSave}>{editing ? 'Update' : 'Create'}</Btn></>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormInput label="Unit Code *" value={form.businessUnitCode} onChange={sf('businessUnitCode')} placeholder="BU-001" />
            <FormSelect label="Status" value={form.status} onChange={sf('status')}>
              {BU_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </FormSelect>
          </div>
          <FormInput label="Name *" value={form.name} onChange={sf('name')} placeholder="Kilimani Hotel" />
          <FormInput label="Trading Name" value={form.tradingName ?? ''} onChange={sf('tradingName')} placeholder="Optional trading name" />
          <div className="grid grid-cols-2 gap-4">
            <FormSelect label="Business Unit Type *" value={form.businessUnitType} onChange={sf('businessUnitType')}>
              {BU_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </FormSelect>
            <FormSelect label="License Required" value={form.licenseRequired ? 'true' : 'false'} onChange={e => setForm(p => ({ ...p, licenseRequired: e.target.value === 'true' }))}>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </FormSelect>
          </div>
          <FormInput label="Location" value={form.location ?? ''} onChange={sf('location')} placeholder="Moshi, Kilimanjaro" />
          {divisions.length > 0 && (
            <FormSelect label="Division" value={form.divisionId ?? ''} onChange={sf('divisionId')}>
              <option value="">— None —</option>
              {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </FormSelect>
          )}
          <div className="grid grid-cols-2 gap-4">
            <FormInput label="Start Date" type="date" value={form.startDate ?? ''} onChange={sf('startDate')} />
            <FormInput label="End Date" type="date" value={form.endDate ?? ''} onChange={sf('endDate')} />
          </div>
          <FormTextarea label="Notes" value={form.notes ?? ''} onChange={sf('notes')} rows={3} />
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Business Unit?" message="Delete this business unit? This cannot be undone." variant="danger" onConfirm={doDelete} />
    </div>
  );
}
