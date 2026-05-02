'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, Btn, Modal, PageToolbar, FormInput, FormSelect, FormTextarea, DateInput, PageSpinner, StatusBadge, ConfirmDialog } from '@/components/ui';

const ACTIVITY_TYPES = ['LAND_PREPARATION', 'PLANTING', 'WEEDING', 'IRRIGATION', 'SPRAYING', 'FERTILIZER_APPLICATION', 'HARVESTING', 'TRANSPORT', 'STORAGE', 'OTHER'];
const ACTIVITY_STATUSES = ['PLANNED', 'COMPLETED', 'CANCELLED'];

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';
function fmtCurrency(n: number) { return `TZS ${new Intl.NumberFormat('en-US').format(n)}`; }
function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }

const EMPTY_FORM = { farmId: '', cropSeasonId: '', activityType: 'LAND_PREPARATION', activityDate: '', description: '', costAmount: '', currency: 'TZS', status: 'PLANNED' };

interface Company { id: string; name: string; }
interface Division { id: string; name: string; }
interface Farm { id: string; name: string; }
interface Season { id: string; seasonName: string; }

export default function ActivitiesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [divisionId, setDivisionId] = useState('');
  const [farms, setFarms] = useState<Farm[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [data, setData] = useState<{ data: any[]; total: number }>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (!companyId) { setDivisions([]); setDivisionId(''); setFarms([]); setSeasons([]); return; }
    fetch(`/api/backend/divisions?companyId=${companyId}&limit=100`).then(r => r.json()).then(j => {
      const divs = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
      setDivisions(divs);
      if (divs.length > 0) setDivisionId(divs[0].id);
    });
    fetch(`/api/backend/agriculture/farms?companyId=${companyId}&page=1&limit=100`).then(r => r.json()).then(j => {
      setFarms(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    });
    fetch(`/api/backend/agriculture/crop-seasons?companyId=${companyId}&page=1&limit=100`).then(r => r.json()).then(j => {
      setSeasons(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    });
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/agriculture/activities?companyId=${companyId}&page=1&limit=50`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setData(Array.isArray(json.data?.data) ? json.data : { data: Array.isArray(json.data) ? json.data : [], total: 0 });
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditing(null); setForm({ ...EMPTY_FORM }); setShowModal(true); }
  function openEdit(a: any) {
    setEditing(a);
    setForm({
      farmId: a.farmId ?? '',
      cropSeasonId: a.cropSeasonId ?? '',
      activityType: a.activityType ?? 'LAND_PREPARATION',
      activityDate: a.activityDate ? a.activityDate.split('T')[0] : '',
      description: a.description ?? '',
      costAmount: a.costAmount?.toString() ?? '',
      currency: a.currency ?? 'TZS',
      status: a.status ?? 'PLANNED',
    });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.activityType) { setError('Activity type is required'); return; }
    setSaving(true); setError('');
    try {
      const body = {
        ...form,
        costAmount: form.costAmount ? parseFloat(form.costAmount) : undefined,
        activityDate: form.activityDate ? new Date(form.activityDate).toISOString().split('T')[0] : undefined,
        cropSeasonId: form.cropSeasonId || undefined,
        companyId,
        divisionId,
      };
      const url = editing ? `/api/backend/agriculture/activities/${editing.id}` : '/api/backend/agriculture/activities';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message ?? 'Save failed'); }
      setShowModal(false); await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/backend/agriculture/activities/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setDeleteId(null); await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Delete failed'); }
  }

  const farmName = (id: string) => farms.find(f => f.id === id)?.name ?? '—';
  const seasonName = (id: string) => seasons.find(s => s.id === id)?.seasonName ?? '—';

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Agriculture Activities" subtitle="Farm activity logs — planting, weeding, spraying, etc." />
      <PageToolbar
        filters={
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        }
        actions={companyId ? <Btn onClick={openCreate}>+ New Activity</Btn> : undefined}
      />
      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{data.total} activities</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>#</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Type</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Farm</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Season</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Date</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Description</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Cost</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No activities found.</td></tr>
                ) : data.data.map((a: any) => (
                  <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium text-indigo-600`}>{a.activityNumber}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{a.activityType?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{farmName(a.farmId)}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{a.cropSeasonId ? seasonName(a.cropSeasonId) : '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{a.activityDate ? fmtDate(a.activityDate) : '—'}</td>
                    <td className={`${tdCls} max-w-xs truncate`} style={{ color: 'var(--aurora-text)' }}>{a.description ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{a.costAmount != null ? fmtCurrency(a.costAmount) : '—'}</td>
                    <td className={tdCls}><StatusBadge status={a.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-2">
                        <Btn variant="ghost" size="xs" onClick={() => openEdit(a)}>Edit</Btn>
                        <Btn variant="danger" size="xs" onClick={() => setDeleteId(a.id)}>Delete</Btn>
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
        title={editing ? 'Edit Activity' : 'New Activity'}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn loading={saving} onClick={handleSave}>Save Activity</Btn>
          </>
        }
      >
        <div className="space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-red-600">{error}</div>}
          {divisions.length > 1 && (
            <FormSelect label="Division" value={divisionId} onChange={e => setDivisionId(e.target.value)}>
              {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </FormSelect>
          )}
          <div className="grid grid-cols-2 gap-4">
            <FormSelect label="Farm" value={form.farmId} onChange={e => setForm(p => ({ ...p, farmId: e.target.value }))}>
              <option value="">— Select Farm —</option>
              {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </FormSelect>
            <FormSelect label="Season (optional)" value={form.cropSeasonId} onChange={e => setForm(p => ({ ...p, cropSeasonId: e.target.value }))}>
              <option value="">— Select Season —</option>
              {seasons.map(s => <option key={s.id} value={s.id}>{s.seasonName}</option>)}
            </FormSelect>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormSelect label="Activity Type" value={form.activityType} onChange={e => setForm(p => ({ ...p, activityType: e.target.value }))}>
              {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </FormSelect>
            <DateInput label="Activity Date" value={form.activityDate} onChange={e => setForm(p => ({ ...p, activityDate: e.target.value }))} />
          </div>
          <FormTextarea label="Description" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={3} />
          <div className="grid grid-cols-2 gap-4">
            <FormInput label="Cost Amount" type="number" value={form.costAmount} onChange={e => setForm(p => ({ ...p, costAmount: e.target.value }))} placeholder="50000" />
            <FormInput label="Currency" value={form.currency} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))} placeholder="TZS" />
          </div>
          <FormSelect label="Status" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
            {ACTIVITY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </FormSelect>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Activity"
        message="Delete this activity? This action cannot be undone."
        variant="danger"
        confirmLabel="Delete"
        onConfirm={() => handleDelete(deleteId!)}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
