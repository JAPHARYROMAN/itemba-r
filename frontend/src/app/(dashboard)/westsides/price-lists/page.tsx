'use client';

import { useCallback, useEffect, useState } from 'react';
import { Btn, Card, ConfirmDialog, FormInput, FormSelect, Modal, PageHeader, ProductPicker, showToast } from '@/components/ui';
import type { ProductPickerOption } from '@/components/ui';
import { ApiError, backendDelete, backendPatch, backendPost } from '@/lib/api-client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PriceList {
  id: string;
  companyId: string;
  name: string;
  priceListType: string;
  currency: string;
  effectiveFrom: string;
  status: string;
  approvedAt?: string | null;
  createdBy?: string;
}

interface Company { id: string; name: string }
interface Unit { id: string; name: string; symbol?: string | null }

interface PriceListItem {
  id: string;
  priceListId: string;
  productId: string;
  unitId: string;
  price: number | string;
  minimumQuantity?: number | string | null;
  maximumQuantity?: number | string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fieldCls = 'w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const PRICE_LIST_TYPES = [
  { value: 'RETAIL', label: 'Retail' },
  { value: 'WHOLESALE', label: 'Wholesale' },
  { value: 'CUSTOMER_SPECIFIC', label: 'Customer Specific' },
  { value: 'PROMOTIONAL', label: 'Promotional' },
  { value: 'CONTRACTOR', label: 'Contractor' },
  { value: 'INTERNAL_COMPANY', label: 'Internal Company' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_CLR: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  DRAFT: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
  EXPIRED: 'bg-red-50 text-red-700 border-red-200',
  INACTIVE: 'bg-zinc-100 text-zinc-500 border-zinc-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return (
    <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }

function fmtPrice(n: number | string | null | undefined, currency: string) {
  const value = Number(n ?? 0);
  return `${currency} ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0)}`;
}

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function listFromJson<T>(j: unknown): T[] {
  const json = j as { data?: { data?: T[] } | T[] };
  const inner = json?.data;
  if (Array.isArray(inner)) return inner;
  if (inner && Array.isArray((inner as { data?: T[] }).data)) return (inner as { data: T[] }).data;
  return [];
}

// ─── Header modal (create / edit price list) ─────────────────────────────────

interface ModalProps { item: PriceList | null; companies: Company[]; onClose: () => void; onSaved: () => void }

function PriceListModal({ item, companies, onClose, onSaved }: ModalProps) {
  const [companyId, setCompanyId] = useState(item?.companyId ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [priceListType, setPriceListType] = useState(item?.priceListType ?? 'RETAIL');
  const [currency, setCurrency] = useState(item?.currency ?? 'TZS');
  const [effectiveFrom, setEffectiveFrom] = useState(item?.effectiveFrom?.slice(0, 10) ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!item && !companyId) { setError('Company is required'); return; }
    if (!name || !effectiveFrom) { setError('Name and Effective From are required'); return; }
    setSaving(true); setError('');
    try {
      const body = { name, priceListType, currency, effectiveFrom };
      if (item) {
        await backendPatch(`/westsides/price-lists/${item.id}`, body);
      } else {
        await backendPost('/westsides/price-lists', { ...body, companyId });
      }
      showToast('success', item ? 'Price list updated' : 'Price list created', name);
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Error saving');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={item ? 'Edit Price List' : 'New Price List'}
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>{item ? 'Update' : 'Create'}</Btn></>}>
      {error && <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}
      <div className="grid grid-cols-2 gap-4">
        {!item && (
          <FormSelect label="Company" required value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder="Select…" className="col-span-2">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FormSelect>
        )}
        <FormInput label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Retail Price List 2025" className="col-span-2" />
        <FormSelect label="Type" required value={priceListType} onChange={(e) => setPriceListType(e.target.value)} options={PRICE_LIST_TYPES} />
        <FormSelect label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="TZS">TZS</option>
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
        </FormSelect>
        <FormInput label="Effective From" type="date" required value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="col-span-2" />
      </div>
    </Modal>
  );
}

// ─── Items modal (manage products on a price list) ───────────────────────────

interface ItemsModalProps { priceList: PriceList; onClose: () => void }

function PriceListItemsModal({ priceList, onClose }: ItemsModalProps) {
  const [items, setItems] = useState<PriceListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [units, setUnits] = useState<Unit[]>([]);
  // productId → "CODE — Name" labels resolved for rows the raw item list only
  // identifies by UUID.
  const [productLabels, setProductLabels] = useState<Record<string, string>>({});

  // Add-item form
  const [newProductId, setNewProductId] = useState('');
  const [newUnitId, setNewUnitId] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newMinQty, setNewMinQty] = useState('');
  const [adding, setAdding] = useState(false);

  // Inline price edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [deleting, setDeleting] = useState<PriceListItem | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/westsides/price-lists/${priceList.id}/items`);
      if (!res.ok) throw new Error('Failed to load price list items');
      const json = await res.json();
      const rows: PriceListItem[] = listFromJson<PriceListItem>(json);
      setItems(rows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading items');
    } finally { setLoading(false); }
  }, [priceList.id]);

  useEffect(() => { loadItems(); }, [loadItems]);

  useEffect(() => {
    fetch('/api/backend/units?limit=500')
      .then((r) => r.json())
      .then((j) => setUnits(listFromJson<Unit>(j)))
      .catch(() => setUnits([]));
  }, []);

  // Resolve product names for item rows (the backend returns raw rows with
  // productId only). Small lists, fetched once per unknown id.
  useEffect(() => {
    const unresolved = Array.from(new Set(items.map((i) => i.productId))).filter((id) => id && !productLabels[id]);
    if (unresolved.length === 0) return;
    let cancelled = false;
    Promise.all(
      unresolved.map(async (id) => {
        try {
          const res = await fetch(`/api/backend/products/${id}`);
          if (!res.ok) return [id, id] as const;
          const json = await res.json();
          const p = (json.data ?? json) as { name?: string; productCode?: string | null; sku?: string | null };
          const code = p.productCode || p.sku;
          return [id, p.name ? (code ? `${code} — ${p.name}` : p.name) : id] as const;
        } catch {
          return [id, id] as const;
        }
      }),
    ).then((pairs) => {
      if (cancelled) return;
      setProductLabels((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    });
    return () => { cancelled = true; };
  }, [items, productLabels]);

  const unitName = (id: string) => {
    const u = units.find((x) => x.id === id);
    return u ? (u.symbol || u.name) : '—';
  };

  const onPickProduct = (productId: string, product?: ProductPickerOption) => {
    setNewProductId(productId);
    if (product?.defaultUnitId) setNewUnitId(product.defaultUnitId);
  };

  const addItem = async () => {
    if (!newProductId) { showToast('error', 'Select a product'); return; }
    if (!newUnitId) { showToast('error', 'Select a unit'); return; }
    if (newPrice === '' || !Number.isFinite(Number(newPrice))) { showToast('error', 'Enter a unit price'); return; }
    setAdding(true);
    try {
      await backendPost(`/westsides/price-lists/${priceList.id}/items`, {
        productId: newProductId,
        unitId: newUnitId,
        price: Number(newPrice),
        ...(newMinQty !== '' ? { minimumQuantity: Number(newMinQty) } : {}),
      });
      showToast('success', 'Item added to price list');
      setNewProductId(''); setNewUnitId(''); setNewPrice(''); setNewMinQty('');
      loadItems();
    } catch (err: unknown) {
      showToast('error', 'Add item failed', err instanceof ApiError ? err.message : err instanceof Error ? err.message : undefined);
    } finally { setAdding(false); }
  };

  const startEdit = (item: PriceListItem) => {
    setEditingId(item.id);
    setEditPrice(String(item.price ?? ''));
  };

  const saveEdit = async (item: PriceListItem) => {
    if (editPrice === '' || !Number.isFinite(Number(editPrice))) { showToast('error', 'Enter a valid price'); return; }
    setSavingEdit(true);
    try {
      await backendPatch(`/westsides/price-lists/price-list-items/${item.id}`, { price: Number(editPrice) });
      showToast('success', 'Price updated');
      setEditingId(null);
      loadItems();
    } catch (err: unknown) {
      showToast('error', 'Update failed', err instanceof ApiError ? err.message : err instanceof Error ? err.message : undefined);
    } finally { setSavingEdit(false); }
  };

  const doDelete = async () => {
    if (!deleting) return;
    try {
      await backendDelete(`/westsides/price-lists/price-list-items/${deleting.id}`);
      showToast('success', 'Item removed');
      setDeleting(null);
      loadItems();
    } catch (err: unknown) {
      setDeleting(null);
      showToast('error', 'Remove failed', err instanceof ApiError ? err.message : err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <>
      <Modal open onClose={onClose} title={`Items — ${priceList.name}`} subtitle={`${priceList.currency} · effective ${priceList.effectiveFrom ? fmtDate(priceList.effectiveFrom) : '—'}`} size="xl"
        footer={<Btn variant="secondary" onClick={onClose}>Close</Btn>}>
        {error && <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}

        {/* Add item */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 mb-4">
          <div className="grid grid-cols-12 gap-3 items-end">
            <div className="col-span-5">
              <label className={labelCls}>Product</label>
              <ProductPicker value={newProductId} onChange={onPickProduct} companyId={priceList.companyId} placeholder="Search products…" />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Unit</label>
              <select value={newUnitId} onChange={(e) => setNewUnitId(e.target.value)} className={fieldCls}>
                <option value="">Select…</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.symbol ? `${u.name} (${u.symbol})` : u.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Unit Price ({priceList.currency})</label>
              <input type="number" min={0} step="0.01" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} className={fieldCls} placeholder="0.00" />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Min Qty</label>
              <input type="number" min={0} value={newMinQty} onChange={(e) => setNewMinQty(e.target.value)} className={fieldCls} placeholder="0" />
            </div>
            <div className="col-span-1">
              <Btn variant="primary" onClick={addItem} loading={adding}>Add</Btn>
            </div>
          </div>
        </div>

        {/* Item list */}
        {loading ? <Spinner /> : items.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">No items on this price list yet. Add one above.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className={thCls}>Product</th>
                  <th className={thCls}>Unit</th>
                  <th className={`${thCls} text-right`}>Price</th>
                  <th className={`${thCls} text-right`}>Min Qty</th>
                  <th className={`${thCls} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`}>{productLabels[it.productId] ?? '…'}</td>
                    <td className={tdCls}>{unitName(it.unitId)}</td>
                    <td className={`${tdCls} text-right`}>
                      {editingId === it.id ? (
                        <input
                          type="number" min={0} step="0.01" value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          aria-label={`New price for ${productLabels[it.productId] ?? 'item'}`}
                          className="w-28 text-sm border border-slate-200 rounded-md px-2 py-1 text-right bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                      ) : fmtPrice(it.price, priceList.currency)}
                    </td>
                    <td className={`${tdCls} text-right`}>{Number(it.minimumQuantity ?? 0)}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {editingId === it.id ? (
                        <>
                          <Btn variant="ghost" size="xs" loading={savingEdit} onClick={() => saveEdit(it)}>Save</Btn>
                          <Btn variant="ghost" size="xs" onClick={() => setEditingId(null)}>Cancel</Btn>
                        </>
                      ) : (
                        <>
                          <Btn variant="ghost" size="xs" onClick={() => startEdit(it)}>Edit Price</Btn>
                          <Btn variant="ghost" size="xs" onClick={() => setDeleting(it)}>Remove</Btn>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {/* Wrapper lifts the dialog (z-50) above the open Modal overlay (z-[1200]). */}
      <div className="relative z-[1300]">
        <ConfirmDialog
          open={!!deleting}
          title="Remove Item"
          message={deleting ? `Remove ${productLabels[deleting.productId] ?? 'this product'} from ${priceList.name}? This cannot be undone.` : ''}
          confirmLabel="Remove"
          variant="danger"
          onConfirm={doDelete}
          onCancel={() => setDeleting(null)}
        />
      </div>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PriceListsPage() {
  const [items, setItems] = useState<PriceList[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PriceList | null>(null);
  const [managingItems, setManagingItems] = useState<PriceList | null>(null);
  const [approving, setApproving] = useState<PriceList | null>(null);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [actioning, setActioning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (filterType) params.set('priceListType', filterType);
      if (filterStatus) params.set('status', filterStatus);
      const res = await fetch(`/api/backend/westsides/price-lists?${params}`);
      if (!res.ok) throw new Error('Failed to load price lists');
      const json = await res.json();
      setItems(json.data?.data ?? json.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading data');
    } finally { setLoading(false); }
  }, [filterType, filterStatus]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []))
      .catch(() => setCompanies([]));
  }, []);

  const doApprove = async () => {
    if (!approving) return;
    const pl = approving;
    setActioning(pl.id);
    setApproving(null);
    try {
      await backendPatch(`/westsides/price-lists/${pl.id}/approve`);
      showToast('success', 'Price list approved', pl.name);
      load();
    } catch (err: unknown) {
      showToast('error', 'Approve failed', err instanceof ApiError ? err.message : err instanceof Error ? err.message : undefined);
    } finally { setActioning(null); }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Price Lists" subtitle="Retail, wholesale, and customer-specific pricing" />
        <button onClick={() => { setEditing(null); setModalOpen(true); }} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium">
          + New Price List
        </button>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Type</label>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className={fieldCls}>
              <option value="">All Types</option>
              {PRICE_LIST_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={fieldCls}>
              <option value="">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="EXPIRED">Expired</option>
            </select>
          </div>
        </div>
      </Card>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? <Spinner /> : (
        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No price lists found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>Name</th>
                    <th className={thCls}>Type</th>
                    <th className={thCls}>Currency</th>
                    <th className={thCls}>Effective From</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Approved</th>
                    <th className={thCls}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((pl) => (
                    <tr key={pl.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`}>{pl.name}</td>
                      <td className={tdCls}>{pl.priceListType?.replace(/_/g, ' ')}</td>
                      <td className={tdCls}>{pl.currency}</td>
                      <td className={tdCls}>{pl.effectiveFrom ? fmtDate(pl.effectiveFrom) : '—'}</td>
                      <td className={tdCls}><Badge status={pl.status} /></td>
                      <td className={tdCls}>{pl.approvedAt ? fmtDate(pl.approvedAt) : '—'}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <button onClick={() => setManagingItems(pl)} className="text-xs text-indigo-600 hover:text-indigo-800 mr-2">Items</button>
                        <button onClick={() => { setEditing(pl); setModalOpen(true); }} className="text-xs text-indigo-600 hover:text-indigo-800 mr-2">Edit</button>
                        {!pl.approvedAt && (
                          <button
                            onClick={() => setApproving(pl)}
                            disabled={actioning === pl.id}
                            className="text-xs text-emerald-600 hover:text-emerald-800 disabled:opacity-50"
                          >
                            Approve
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {modalOpen && (
        <PriceListModal
          item={editing}
          companies={companies}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSaved={() => { setModalOpen(false); setEditing(null); load(); }}
        />
      )}

      {managingItems && (
        <PriceListItemsModal priceList={managingItems} onClose={() => setManagingItems(null)} />
      )}

      <ConfirmDialog
        open={!!approving}
        title="Approve Price List"
        message={approving ? `Approve ${approving.name}? Approved price lists become the pricing source for sales.` : ''}
        confirmLabel="Approve"
        onConfirm={doApprove}
        onCancel={() => setApproving(null)}
      />
    </div>
  );
}
