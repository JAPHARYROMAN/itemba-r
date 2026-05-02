'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

const ITEM_TYPES = ['FOOD', 'DRINK', 'BAR_ITEM', 'SERVICE', 'OTHER'];
const fmtCurrency = (n: number, cur: string) => `${cur} ${new Intl.NumberFormat('en-US').format(n)}`;

interface Company { id: string; name: string; }
interface Facility { id: string; facilityName: string; }
interface Category { id: string; categoryName: string; categoryType: string; }

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function MenuItemsPage() {
  const { user } = useAuth();
  void user;
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityFilter, setFacilityFilter] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ itemCode: '', itemName: '', itemType: 'FOOD', unitPrice: '', currency: 'TZS', isAvailable: true, categoryId: '', hospitalityFacilityId: '', notes: '' });
  const [modalCategories, setModalCategories] = useState<Category[]>([]);
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
    if (!companyId || !facilityFilter) { setCategories([]); return; }
    fetch(`/api/backend/menu-categories?companyId=${companyId}&hospitalityFacilityId=${facilityFilter}&limit=100`).then(r => r.json()).then(j =>
      setCategories(Array.isArray(j.data?.data) ? j.data.data : []));
  }, [companyId, facilityFilter]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ companyId, limit: '200' });
      if (facilityFilter) qs.set('hospitalityFacilityId', facilityFilter);
      if (categoryFilter) qs.set('categoryId', categoryFilter);
      const res = await fetch(`/api/backend/menu-items?${qs}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      const list = Array.isArray(json.data?.data) ? json.data.data : [];
      setRows(list); setTotal(json.data?.total ?? list.length);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId, facilityFilter, categoryFilter]);

  useEffect(() => { load(); }, [load]);

  const loadModalCategories = async (facilityId: string) => {
    if (!companyId || !facilityId) { setModalCategories([]); return; }
    const res = await fetch(`/api/backend/menu-categories?companyId=${companyId}&hospitalityFacilityId=${facilityId}&limit=100`);
    const json = await res.json();
    setModalCategories(Array.isArray(json.data?.data) ? json.data.data : []);
  };

  const openCreate = () => { setEditing(null); setForm({ itemCode: '', itemName: '', itemType: 'FOOD', unitPrice: '', currency: 'TZS', isAvailable: true, categoryId: '', hospitalityFacilityId: '', notes: '' }); setModalCategories(categories); setShowModal(true); };
  const openEdit = (row: any) => {
    setEditing(row);
    setForm({ itemCode: row.itemCode ?? '', itemName: row.itemName ?? '', itemType: row.itemType ?? 'FOOD', unitPrice: row.unitPrice?.toString() ?? '', currency: row.currency ?? 'TZS', isAvailable: row.isAvailable !== false, categoryId: row.categoryId ?? '', hospitalityFacilityId: row.hospitalityFacilityId ?? '', notes: row.notes ?? '' });
    loadModalCategories(row.hospitalityFacilityId ?? '');
    setShowModal(true);
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      const body: any = { ...form, companyId, unitPrice: parseFloat(form.unitPrice) || 0 };
      const url = editing ? `/api/backend/menu-items/${editing.id}` : '/api/backend/menu-items';
      const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  };

  const doDelete = async () => {
    if (!deleteId) return;
    await fetch(`/api/backend/menu-items/${deleteId}`, { method: 'DELETE' });
    setDeleteId(null); load();
  };

  const sf = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <PageHeader title="Menu Items" subtitle="Food, drink and service items" />
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
          {categories.length > 0 && (
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white" style={{ color: 'var(--aurora-text)' }}>
              <option value="">All Categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.categoryName}</option>)}
            </select>
          )}
          {companyId && <Btn variant="primary" onClick={openCreate}>+ New Item</Btn>}
        </div>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}

      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{total} items</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Code</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Name</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Category</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Type</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Unit Price</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Available</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No items found.</td></tr>
                ) : rows.map(row => (
                  <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-mono font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.itemCode}</td>
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.itemName}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.menuCategory?.categoryName ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.itemType?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.unitPrice ? fmtCurrency(row.unitPrice, row.currency ?? 'TZS') : '—'}</td>
                    <td className={tdCls}>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${row.isAvailable !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600'}`}>
                        {row.isAvailable !== false ? 'Yes' : 'No'}
                      </span>
                    </td>
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

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Menu Item' : 'New Menu Item'} size="lg"
        footer={<><Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn><Btn variant="primary" loading={saving} onClick={save}>{editing ? 'Update' : 'Create'}</Btn></>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormInput label="Item Code *" value={form.itemCode} onChange={sf('itemCode')} placeholder="e.g. ITM-001" />
            <FormInput label="Item Name *" value={form.itemName} onChange={sf('itemName')} placeholder="e.g. Grilled Chicken" />
          </div>
          <FormSelect label="Facility *" value={form.hospitalityFacilityId} onChange={e => { setForm(f => ({ ...f, hospitalityFacilityId: e.target.value, categoryId: '' })); loadModalCategories(e.target.value); }}>
            <option value="">— Select Facility —</option>
            {facilities.map(f => <option key={f.id} value={f.id}>{f.facilityName}</option>)}
          </FormSelect>
          <FormSelect label="Category *" value={form.categoryId} onChange={sf('categoryId')}>
            <option value="">— Select Category —</option>
            {modalCategories.map(c => <option key={c.id} value={c.id}>{c.categoryName}</option>)}
          </FormSelect>
          <div className="grid grid-cols-2 gap-4">
            <FormSelect label="Item Type *" value={form.itemType} onChange={sf('itemType')}>
              {ITEM_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </FormSelect>
            <FormInput label="Currency" value={form.currency} onChange={sf('currency')} placeholder="TZS" />
          </div>
          <FormInput label="Unit Price *" type="number" value={form.unitPrice} onChange={sf('unitPrice')} placeholder="e.g. 15000" />
          <div className="flex items-center gap-2">
            <input type="checkbox" id="isAvailable" checked={form.isAvailable} onChange={e => setForm(f => ({ ...f, isAvailable: e.target.checked }))} className="rounded" />
            <label htmlFor="isAvailable" className="text-sm" style={{ color: 'var(--aurora-text)' }}>Available for ordering</label>
          </div>
          <FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={2} />
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Item?" message="This action cannot be undone." variant="danger" onConfirm={doDelete} />
    </div>
  );
}
