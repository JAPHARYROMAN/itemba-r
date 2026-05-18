'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';

const BOQ_STATUSES = ['ACTIVE', 'REVISED', 'CANCELLED'];

function fmtCurrency(n: number | string | null | undefined) { const value = Number(n ?? 0); return `TZS ${new Intl.NumberFormat('en-US').format(Number.isFinite(value) ? value : 0)}`; }

interface Company { id: string; name: string; }
interface Project { id: string; projectName: string; projectCode: string; }
const initForm = { itemCode: '', projectId: '', description: '', unit: '', quantity: '', unitRate: '', currency: 'TZS', status: 'ACTIVE', notes: '' };

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function BOQPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectFilter, setProjectFilter] = useState('');
  const [data, setData] = useState<{ data: any[]; total: number }>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<Record<string, string>>(initForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j =>
      setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [])
    );
  }, []);

  useEffect(() => {
    if (!companyId) { setProjects([]); return; }
    fetch(`/api/backend/construction/projects?companyId=${companyId}&limit=100`).then(r => r.json()).then(j =>
      setProjects(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [])
    );
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ companyId, page: '1', limit: '50' });
      if (projectFilter) params.set('projectId', projectFilter);
      const res = await fetch(`/api/backend/construction/boq-items?${params}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setData(Array.isArray(json.data?.data) ? json.data : { data: Array.isArray(json.data) ? json.data : [], total: 0 });
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId, projectFilter]);

  useEffect(() => { load(); }, [load]);

  function openNew() { setEditing(null); setForm({ ...initForm }); setShowModal(true); }
  function openEdit(item: any) {
    setEditing(item);
    setForm({
      itemCode: item.itemCode ?? '', projectId: item.projectId ?? '', description: item.description ?? '',
      unit: item.unit ?? '', quantity: item.quantity != null ? String(item.quantity) : '',
      unitRate: item.unitRate != null ? String(item.unitRate) : '',
      currency: item.currency ?? 'TZS', status: item.status ?? 'ACTIVE', notes: item.notes ?? '',
    });
    setShowModal(true);
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const body: Record<string, any> = { ...form, companyId };
      if (body.quantity) body.quantity = parseFloat(body.quantity);
      if (body.unitRate) body.unitRate = parseFloat(body.unitRate);
      const url = editing ? `/api/backend/construction/boq-items/${editing.id}` : '/api/backend/construction/boq-items';
      const res = await fetch(url, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try { await fetch(`/api/backend/construction/boq-items/${deleteTarget}`, { method: 'DELETE' }); load(); }
    catch (err: unknown) { setError(err instanceof Error ? err.message : 'Delete failed'); }
    finally { setDeleteTarget(null); }
  }

  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));
  const projName = (id: string) => { const p = projects.find(p => p.id === id); return p ? `${p.projectCode}` : id; };
  const grandTotal = data.data.reduce((s, b) => s + ((b.quantity ?? 0) * (b.unitRate ?? 0)), 0);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="BOQ / Budget Items" subtitle="Bill of quantities and cost line items" />
        <div className="flex gap-2 flex-wrap">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {companyId && (
            <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
              <option value="">All Projects</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
            </select>
          )}
          {companyId && <Btn variant="primary" onClick={openNew}>+ New BOQ Item</Btn>}
        </div>
      </div>
      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{data.total} BOQ items</span>
            <span className="text-xs font-semibold" style={{ color: 'var(--aurora-text)' }}>Grand Total: {fmtCurrency(grandTotal)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Code</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Project</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Description</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Unit</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Qty</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Unit Rate</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Total Value</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Currency</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No BOQ items found.</td></tr>
                ) : data.data.map((b: any) => (
                  <tr key={b.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{b.itemCode}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{b.projectId ? projName(b.projectId) : '—'}</td>
                    <td className={`${tdCls} max-w-xs truncate`} style={{ color: 'var(--aurora-text)' }}>{b.description ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{b.unit ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{b.quantity ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{b.unitRate != null ? fmtCurrency(b.unitRate) : '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{(b.quantity != null && b.unitRate != null) ? fmtCurrency(b.quantity * b.unitRate) : '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{b.currency ?? 'TZS'}</td>
                    <td className={tdCls}><StatusBadge status={b.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-1">
                        <Btn size="sm" variant="secondary" onClick={() => openEdit(b)}>Edit</Btn>
                        <Btn size="sm" variant="danger" onClick={() => setDeleteTarget(b.id)}>Del</Btn>
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
        title={editing ? 'Edit BOQ Item' : 'New BOQ Item'}
        size="lg"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" loading={saving} onClick={handleSave}>Save BOQ Item</Btn>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <FormInput label="Item Code *" value={form.itemCode} onChange={sf('itemCode')} />
          <FormSelect label="Status" value={form.status} onChange={sf('status')}>
            {BOQ_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </FormSelect>
          <div className="col-span-2">
            <FormSelect label="Project *" value={form.projectId} onChange={sf('projectId')}>
              <option value="">— Select Project —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
            </FormSelect>
          </div>
          <div className="col-span-2">
            <FormInput label="Description *" value={form.description} onChange={sf('description')} />
          </div>
          <FormInput label="Unit *" value={form.unit} onChange={sf('unit')} placeholder="e.g. m2, kg, pcs" />
          <FormInput label="Currency" value={form.currency} onChange={sf('currency')} />
          <FormInput label="Quantity *" type="number" value={form.quantity} onChange={sf('quantity')} />
          <FormInput label="Unit Rate *" type="number" value={form.unitRate} onChange={sf('unitRate')} />
          {form.quantity && form.unitRate && (
            <div className="col-span-2 px-3 py-2 bg-slate-50 rounded text-sm" style={{ color: 'var(--aurora-text)' }}>
              Total: <strong>{fmtCurrency(parseFloat(form.quantity) * parseFloat(form.unitRate))}</strong>
            </div>
          )}
          <div className="col-span-2">
            <FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={2} />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete BOQ Item"
        message="Delete this BOQ item? This cannot be undone."
        variant="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
