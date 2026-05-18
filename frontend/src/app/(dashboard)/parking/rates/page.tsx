'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

const RATE_TYPES = ['HOURLY', 'DAILY', 'OVERNIGHT', 'WEEKLY', 'MONTHLY', 'FLAT', 'CUSTOM'];
const RATE_STATUSES = ['ACTIVE', 'INACTIVE', 'EXPIRED'];

function fmtCurrency(n: number | string | null | undefined) { const value = Number(n ?? 0); return `TZS ${new Intl.NumberFormat('en-US').format(Number.isFinite(value) ? value : 0)}`; }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
function todayStr() { return new Date().toISOString().slice(0, 10); }

interface Company { id: string; name: string; }
interface Facility { id: string; facilityName: string; }
interface Zone { id: string; zoneName: string; zoneCode: string; }

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function ParkingRatesPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState('');
  const [zones, setZones] = useState<Zone[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [form, setForm] = useState({ rateCode: '', rateName: '', rateType: 'DAILY', amount: '', currency: 'TZS', effectiveFrom: todayStr(), effectiveTo: '', status: 'ACTIVE', zoneId: '', notes: '' });
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => {
      const list = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
      setCompanies(list);
      if (list.length > 0) setCompanyId(list[0].id);
    });
  }, []);

  useEffect(() => {
    if (!companyId) return;
    setFacilityId('');
    fetch(`/api/backend/parking-facilities?companyId=${companyId}&limit=100`).then(r => r.json()).then(j =>
      setFacilities(Array.isArray(j.data?.data) ? j.data.data : []));
  }, [companyId]);

  useEffect(() => {
    if (!facilityId) { setZones([]); return; }
    fetch(`/api/backend/parking-zones?facilityId=${facilityId}&limit=100`).then(r => r.json()).then(j =>
      setZones(Array.isArray(j.data?.data) ? j.data.data : []));
  }, [facilityId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const q = facilityId ? `&facilityId=${facilityId}` : '';
      const res = await fetch(`/api/backend/parking-rates?companyId=${companyId}${q}&page=1&limit=100`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      const list = json.data?.data ?? [];
      setRows(list); setTotal(json.data?.total ?? list.length);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId, facilityId]);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditRow(null); setForm({ rateCode: '', rateName: '', rateType: 'DAILY', amount: '', currency: 'TZS', effectiveFrom: todayStr(), effectiveTo: '', status: 'ACTIVE', zoneId: '', notes: '' }); setShowModal(true); }
  function openEdit(row: any) {
    setEditRow(row);
    setForm({ rateCode: row.rateCode ?? '', rateName: row.rateName ?? '', rateType: row.rateType ?? 'DAILY', amount: row.amount ?? '', currency: row.currency ?? 'TZS', effectiveFrom: row.effectiveFrom ? row.effectiveFrom.slice(0, 10) : todayStr(), effectiveTo: row.effectiveTo ? row.effectiveTo.slice(0, 10) : '', status: row.status ?? 'ACTIVE', zoneId: row.zoneId ?? '', notes: row.notes ?? '' });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.rateCode || !form.rateName || !form.amount) { setError('Code, Name and Amount are required.'); return; }
    setSaving(true); setError('');
    try {
      const body: any = { rateCode: form.rateCode, rateName: form.rateName, rateType: form.rateType, amount: Number(form.amount), currency: form.currency, effectiveFrom: form.effectiveFrom, companyId, facilityId: facilityId || undefined, status: form.status || undefined, zoneId: form.zoneId || undefined, effectiveTo: form.effectiveTo || undefined, createdById: user?.id, notes: form.notes || undefined };
      const url = editRow ? `/api/backend/parking-rates/${editRow.id}` : '/api/backend/parking-rates';
      const res = await fetch(url, { method: editRow ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await fetch(`/api/backend/parking-rates/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null); load();
  }

  const sf = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Parking Rates" subtitle="Pricing and tariff configuration" />
        <div className="flex items-center gap-3 flex-wrap">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {companyId && (
            <select value={facilityId} onChange={e => setFacilityId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white" style={{ color: 'var(--aurora-text)' }}>
              <option value="">All Facilities</option>
              {facilities.map(f => <option key={f.id} value={f.id}>{f.facilityName}</option>)}
            </select>
          )}
          {companyId && <Btn variant="primary" onClick={openCreate}>+ New Rate</Btn>}
        </div>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}

      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{total} rates</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Code</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Name</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Facility</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Type</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Amount</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Currency</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Effective From</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>To</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No rates found.</td></tr>
                ) : rows.map((row: any) => (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.rateCode}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.rateName}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.parkingFacility?.facilityName ?? row.facility?.facilityName ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.rateType?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.amount != null ? fmtCurrency(row.amount) : '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.currency ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(row.effectiveFrom)}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.effectiveTo ? fmtDate(row.effectiveTo) : '—'}</td>
                    <td className={tdCls}><StatusBadge status={row.status ?? 'UNKNOWN'} /></td>
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

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editRow ? 'Edit Rate' : 'New Parking Rate'} size="lg"
        footer={<><Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn><Btn variant="primary" loading={saving} onClick={handleSave}>{editRow ? 'Save Changes' : 'Create Rate'}</Btn></>}
      >
        <div className="grid grid-cols-2 gap-4">
          <FormInput label="Rate Code *" value={form.rateCode} onChange={sf('rateCode')} placeholder="e.g. RT-001" />
          <FormSelect label="Rate Type *" value={form.rateType} onChange={sf('rateType')}>
            {RATE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </FormSelect>
          <div className="col-span-2"><FormInput label="Rate Name *" value={form.rateName} onChange={sf('rateName')} placeholder="e.g. Daily Truck Rate" /></div>
          <FormInput label="Amount *" type="number" value={form.amount} onChange={sf('amount')} placeholder="e.g. 50000" />
          <FormInput label="Currency" value={form.currency} onChange={sf('currency')} placeholder="TZS" />
          <div className="col-span-2">
            <FormSelect label="Facility" value={facilityId} onChange={e => setFacilityId(e.target.value)}>
              <option value="">— Select Facility —</option>
              {facilities.map(f => <option key={f.id} value={f.id}>{f.facilityName}</option>)}
            </FormSelect>
          </div>
          {zones.length > 0 && (
            <div className="col-span-2">
              <FormSelect label="Zone (optional)" value={form.zoneId} onChange={sf('zoneId')}>
                <option value="">All Zones</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.zoneCode} — {z.zoneName}</option>)}
              </FormSelect>
            </div>
          )}
          <FormInput label="Effective From *" type="date" value={form.effectiveFrom} onChange={sf('effectiveFrom')} />
          <FormInput label="Effective To (optional)" type="date" value={form.effectiveTo} onChange={sf('effectiveTo')} />
          <FormSelect label="Status" value={form.status} onChange={sf('status')}>
            {RATE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </FormSelect>
          <div />
          <div className="col-span-2"><FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={2} /></div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Rate" message={`Delete rate "${deleteTarget?.rateName}"? This cannot be undone.`} variant="danger" onConfirm={handleDelete} />
    </div>
  );
}
