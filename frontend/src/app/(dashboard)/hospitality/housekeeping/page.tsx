'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

const TASK_TYPES = ['CLEANING', 'LAUNDRY', 'INSPECTION', 'MAINTENANCE', 'OTHER'];
const TASK_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const fmtDate = (s: string) => s ? new Date(s).toLocaleDateString('en-GB') : '—';

interface Company { id: string; name: string; }
interface Facility { id: string; facilityName: string; }
interface Room { id: string; roomNumber: string; }

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function HousekeepingPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityFilter, setFacilityFilter] = useState('');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ taskNumber: '', hospitalityFacilityId: '', roomId: '', taskType: 'CLEANING', status: 'PENDING', scheduledAt: '', notes: '' });
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

  useEffect(() => {
    const facilityId = form.hospitalityFacilityId || facilityFilter;
    if (!companyId || !facilityId) { setRooms([]); return; }
    fetch(`/api/backend/rooms?companyId=${companyId}&hospitalityFacilityId=${facilityId}&limit=100`).then(r => r.json()).then(j =>
      setRooms(Array.isArray(j.data?.data) ? j.data.data : []));
  }, [companyId, facilityFilter, form.hospitalityFacilityId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ companyId, limit: '100' });
      if (facilityFilter) qs.set('hospitalityFacilityId', facilityFilter);
      const res = await fetch(`/api/backend/housekeeping?${qs}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      const list = Array.isArray(json.data?.data) ? json.data.data : [];
      setRows(list); setTotal(json.data?.total ?? list.length);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId, facilityFilter]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm({ taskNumber: '', hospitalityFacilityId: '', roomId: '', taskType: 'CLEANING', status: 'PENDING', scheduledAt: '', notes: '' }); setShowModal(true); };
  const openEdit = (row: any) => {
    setEditing(row);
    setForm({ taskNumber: row.taskNumber ?? '', hospitalityFacilityId: row.hospitalityFacilityId ?? '', roomId: row.roomId ?? '', taskType: row.taskType ?? 'CLEANING', status: row.status ?? 'PENDING', scheduledAt: row.scheduledAt ? row.scheduledAt.split('T')[0] : '', notes: row.notes ?? '' });
    setShowModal(true);
  };

  const save = async () => {
    if (!user?.id) return;
    setSaving(true); setError('');
    try {
      const body: any = { ...form, companyId, createdById: user.id };
      if (!body.scheduledAt) delete body.scheduledAt;
      const url = editing ? `/api/backend/housekeeping/${editing.id}` : '/api/backend/housekeeping';
      const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(Array.isArray(j.message) ? j.message.join(', ') : j.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      const res = await fetch(`/api/backend/housekeeping/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      if (!res.ok) throw new Error('Failed');
      load();
    } catch { setError('Status update failed'); }
  };

  const doDelete = async () => {
    if (!deleteId) return;
    await fetch(`/api/backend/housekeeping/${deleteId}`, { method: 'DELETE' });
    setDeleteId(null); load();
  };

  const sf = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <PageHeader title="Housekeeping" subtitle="Cleaning, laundry and maintenance tasks" />
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
          {companyId && <Btn variant="primary" onClick={openCreate}>+ New Task</Btn>}
        </div>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}

      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{total} tasks</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Task #</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Room</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Type</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Scheduled</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Notes</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No tasks found.</td></tr>
                ) : rows.map(row => (
                  <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-mono font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.taskNumber}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.room?.roomNumber ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.taskType?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className={tdCls}><StatusBadge status={row.status} /></td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(row.scheduledAt)}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.notes ? <span className="truncate max-w-[120px] block">{row.notes}</span> : '—'}</td>
                    <td className={tdCls}>
                      <div className="flex gap-1 flex-wrap">
                        {row.status === 'PENDING' && <Btn size="sm" variant="primary" onClick={() => updateStatus(row.id, 'IN_PROGRESS')}>Start</Btn>}
                        {row.status === 'IN_PROGRESS' && <Btn size="sm" variant="success" onClick={() => updateStatus(row.id, 'COMPLETED')}>Complete</Btn>}
                        <Btn size="sm" variant="secondary" onClick={() => openEdit(row)}>Edit</Btn>
                        <Btn size="sm" variant="danger" onClick={() => setDeleteId(row.id)}>Del</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Task' : 'New Housekeeping Task'} size="lg"
        footer={<><Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn><Btn variant="primary" loading={saving} onClick={save}>{editing ? 'Update' : 'Create'}</Btn></>}
      >
        <div className="space-y-4">
          <FormInput label="Task Number *" value={form.taskNumber} onChange={sf('taskNumber')} placeholder="e.g. HK-001" />
          <FormSelect label="Facility *" value={form.hospitalityFacilityId} onChange={e => setForm(f => ({ ...f, hospitalityFacilityId: e.target.value, roomId: '' }))}>
            <option value="">— Select Facility —</option>
            {facilities.map(f => <option key={f.id} value={f.id}>{f.facilityName}</option>)}
          </FormSelect>
          <FormSelect label="Room *" value={form.roomId} onChange={sf('roomId')}>
            <option value="">— Select Room —</option>
            {rooms.map(r => <option key={r.id} value={r.id}>{r.roomNumber}</option>)}
          </FormSelect>
          <div className="grid grid-cols-2 gap-4">
            <FormSelect label="Task Type *" value={form.taskType} onChange={sf('taskType')}>
              {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </FormSelect>
            <FormSelect label="Status" value={form.status} onChange={sf('status')}>
              {TASK_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </FormSelect>
          </div>
          <FormInput label="Scheduled Date" type="date" value={form.scheduledAt} onChange={sf('scheduledAt')} />
          <FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={2} />
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Task?" message="This action cannot be undone." variant="danger" onConfirm={doDelete} />
    </div>
  );
}
