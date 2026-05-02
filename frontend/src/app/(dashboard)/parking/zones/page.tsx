'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';

const VEHICLE_TYPES = ['LARGE_TRUCK', 'TRAILER', 'BUS', 'SMALL_TRUCK', 'CAR', 'OTHER'];
const ZONE_STATUSES = ['ACTIVE', 'INACTIVE', 'FULL', 'CLOSED'];

interface Company { id: string; name: string; }
interface Facility { id: string; facilityName: string; facilityCode: string; }

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function ParkingZonesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [form, setForm] = useState({ zoneCode: '', zoneName: '', vehicleType: 'LARGE_TRUCK', status: 'ACTIVE', capacity: '', notes: '' });
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

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const q = facilityId ? `&facilityId=${facilityId}` : '';
      const res = await fetch(`/api/backend/parking-zones?companyId=${companyId}${q}&page=1&limit=100`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      const list = json.data?.data ?? [];
      setRows(list); setTotal(json.data?.total ?? list.length);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId, facilityId]);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditRow(null); setForm({ zoneCode: '', zoneName: '', vehicleType: 'LARGE_TRUCK', status: 'ACTIVE', capacity: '', notes: '' }); setShowModal(true); }
  function openEdit(row: any) {
    setEditRow(row);
    setForm({ zoneCode: row.zoneCode ?? '', zoneName: row.zoneName ?? '', vehicleType: row.vehicleType ?? 'LARGE_TRUCK', status: row.status ?? 'ACTIVE', capacity: row.capacity ?? '', notes: row.notes ?? '' });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.zoneCode || !form.zoneName) { setError('Zone Code and Name are required.'); return; }
    setSaving(true); setError('');
    try {
      const body: any = { zoneCode: form.zoneCode, zoneName: form.zoneName, vehicleType: form.vehicleType, companyId, facilityId: facilityId || undefined, status: form.status || undefined, capacity: form.capacity ? Number(form.capacity) : undefined, notes: form.notes || undefined };
      const url = editRow ? `/api/backend/parking-zones/${editRow.id}` : '/api/backend/parking-zones';
      const res = await fetch(url, { method: editRow ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await fetch(`/api/backend/parking-zones/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null); load();
  }

  const sf = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Parking Zones" subtitle="Zone configuration within parking facilities" />
        <div className="flex items-center gap-3 flex-wrap">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {companyId && facilities.length > 0 && (
            <select value={facilityId} onChange={e => setFacilityId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white" style={{ color: 'var(--aurora-text)' }}>
              <option value="">All Facilities</option>
              {facilities.map(f => <option key={f.id} value={f.id}>{f.facilityName}</option>)}
            </select>
          )}
          {companyId && <Btn variant="primary" onClick={openCreate}>+ New Zone</Btn>}
        </div>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}

      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{total} zones</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Zone Code</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Name</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Facility</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Vehicle Type</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Capacity</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No zones found.</td></tr>
                ) : rows.map((row: any) => (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.zoneCode}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.zoneName}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.parkingFacility?.facilityName ?? row.facility?.facilityName ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.vehicleType?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.capacity ?? '—'}</td>
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

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editRow ? 'Edit Zone' : 'New Parking Zone'} size="lg"
        footer={<><Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn><Btn variant="primary" loading={saving} onClick={handleSave}>{editRow ? 'Save Changes' : 'Create Zone'}</Btn></>}
      >
        <div className="grid grid-cols-2 gap-4">
          <FormInput label="Zone Code *" value={form.zoneCode} onChange={sf('zoneCode')} placeholder="e.g. Z-A1" />
          <FormSelect label="Status" value={form.status} onChange={sf('status')}>
            {ZONE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </FormSelect>
          <div className="col-span-2"><FormInput label="Zone Name *" value={form.zoneName} onChange={sf('zoneName')} placeholder="e.g. Section A — Heavy Trucks" /></div>
          <div className="col-span-2">
            <FormSelect label="Facility" value={facilityId} onChange={e => setFacilityId(e.target.value)}>
              <option value="">— Select Facility —</option>
              {facilities.map(f => <option key={f.id} value={f.id}>{f.facilityName}</option>)}
            </FormSelect>
          </div>
          <FormSelect label="Vehicle Type *" value={form.vehicleType} onChange={sf('vehicleType')}>
            {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </FormSelect>
          <FormInput label="Capacity" type="number" value={form.capacity} onChange={sf('capacity')} placeholder="e.g. 20" />
          <div className="col-span-2"><FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={2} /></div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Zone" message={`Delete zone "${deleteTarget?.zoneName}"? This cannot be undone.`} variant="danger" onConfirm={handleDelete} />
    </div>
  );
}
