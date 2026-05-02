'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

const TABLE_STATUSES = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'OUT_OF_SERVICE'];

interface Company { id: string; name: string; }
interface Facility { id: string; facilityName: string; }

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function RestaurantTablesPage() {
  const { user } = useAuth();
  void user;
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityFilter, setFacilityFilter] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ tableCode: '', tableNumber: '', capacity: '', floor: '', status: 'AVAILABLE', hospitalityFacilityId: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j =>
      setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (!companyId) { setFacilities([]); return; }
    fetch(`/api/backend/hospitality-facilities?companyId=${companyId}&limit=100`).then(r => r.json()).then(j =>
      setFacilities(Array.isArray(j.data?.data) ? j.data.data : []));
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ companyId, limit: '200' });
      if (facilityFilter) qs.set('hospitalityFacilityId', facilityFilter);
      const res = await fetch(`/api/backend/restaurant-tables?${qs}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      const list = Array.isArray(json.data?.data) ? json.data.data : [];
      setRows(list); setTotal(json.data?.total ?? list.length);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId, facilityFilter]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm({ tableCode: '', tableNumber: '', capacity: '', floor: '', status: 'AVAILABLE', hospitalityFacilityId: '', notes: '' }); setShowModal(true); };
  const openEdit = (row: any) => {
    setEditing(row);
    setForm({ tableCode: row.tableCode ?? '', tableNumber: row.tableNumber ?? '', capacity: row.capacity?.toString() ?? '', floor: row.floor?.toString() ?? '', status: row.status ?? 'AVAILABLE', hospitalityFacilityId: row.hospitalityFacilityId ?? '', notes: row.notes ?? '' });
    setShowModal(true);
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      const body: any = { ...form, companyId, capacity: parseInt(form.capacity) || 0 };
      if (form.floor) body.floor = parseInt(form.floor);
      const url = editing ? `/api/backend/restaurant-tables/${editing.id}` : '/api/backend/restaurant-tables';
      const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  };

  const doDelete = async () => {
    if (!deleteId) return;
    await fetch(`/api/backend/restaurant-tables/${deleteId}`, { method: 'DELETE' });
    setDeleteId(null); load();
  };

  const sf = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <PageHeader title="Restaurant Tables" subtitle="Table management and status" />
        <div className="flex items-center gap-3 flex-wrap">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {facilities.length > 0 && (
            <select value={facilityFilter} onChange={e => setFacilityFilter(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white" style={{ color: 'var(--aurora-text)' }}>
              <option value="">All Facilities</option>
              {facilities.map(f => <option key={f.id} value={f.id}>{f.facilityName}</option>)}
            </select>
          )}
          {companyId && <Btn variant="primary" onClick={openCreate}>+ New Table</Btn>}
        </div>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}

      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{total} tables</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Code</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Table #</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Facility</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Capacity</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Floor</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No tables found.</td></tr>
                ) : rows.map(row => (
                  <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-mono font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.tableCode}</td>
                    <td className={`${tdCls} font-semibold`} style={{ color: 'var(--aurora-text)' }}>{row.tableNumber}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.hospitalityFacility?.facilityName ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.capacity ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.floor ?? '—'}</td>
                    <td className={tdCls}><StatusBadge status={row.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-1">
                        <Btn size="sm" variant="secondary" onClick={() => openEdit(row)}>Edit</Btn>
                        <Btn size="sm" variant="danger" onClick={() => setDeleteId(row.id)}>Delete</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Table' : 'New Table'} size="lg"
        footer={<><Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn><Btn variant="primary" loading={saving} onClick={save}>{editing ? 'Update' : 'Create'}</Btn></>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormInput label="Table Code *" value={form.tableCode} onChange={sf('tableCode')} placeholder="e.g. TBL-01" />
            <FormInput label="Table Number *" value={form.tableNumber} onChange={sf('tableNumber')} placeholder="e.g. 1" />
          </div>
          <FormSelect label="Facility *" value={form.hospitalityFacilityId} onChange={sf('hospitalityFacilityId')}>
            <option value="">— Select Facility —</option>
            {facilities.map(f => <option key={f.id} value={f.id}>{f.facilityName}</option>)}
          </FormSelect>
          <div className="grid grid-cols-3 gap-4">
            <FormInput label="Capacity *" type="number" value={form.capacity} onChange={sf('capacity')} placeholder="e.g. 4" />
            <FormInput label="Floor" type="number" value={form.floor} onChange={sf('floor')} placeholder="e.g. 1" />
            <FormSelect label="Status" value={form.status} onChange={sf('status')}>
              {TABLE_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </FormSelect>
          </div>
          <FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={2} />
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Table?" message="This action cannot be undone." variant="danger" onConfirm={doDelete} />
    </div>
  );
}
