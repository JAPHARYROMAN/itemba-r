'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PriceList {
  id: string;
  name: string;
  priceListType: string;
  currency: string;
  effectiveFrom: string;
  status: string;
  createdBy?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fieldCls = 'w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

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

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function CloseIcon() {
  return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps { item: PriceList | null; onClose: () => void; onSaved: () => void }

function PriceListModal({ item, onClose, onSaved }: ModalProps) {
  const [name, setName] = useState(item?.name ?? '');
  const [priceListType, setPriceListType] = useState(item?.priceListType ?? 'RETAIL');
  const [currency, setCurrency] = useState(item?.currency ?? 'TZS');
  const [effectiveFrom, setEffectiveFrom] = useState(item?.effectiveFrom?.slice(0, 10) ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !effectiveFrom) { setError('Name and Effective From are required'); return; }
    setSaving(true); setError('');
    try {
      const body = { name, priceListType, currency, effectiveFrom };
      const url = item ? `/api/backend/westsides/price-lists/${item.id}` : '/api/backend/westsides/price-lists';
      const method = item ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error saving');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">{item ? 'Edit Price List' : 'New Price List'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><CloseIcon /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}
          <div>
            <label className={labelCls}>Name *</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} className={fieldCls} placeholder="e.g. Retail Price List 2025" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Type *</label>
              <select value={priceListType} onChange={(e) => setPriceListType(e.target.value)} className={fieldCls}>
                <option value="RETAIL">Retail</option>
                <option value="WHOLESALE">Wholesale</option>
                <option value="CUSTOMER_SPECIFIC">Customer Specific</option>
                <option value="PROMOTIONAL">Promotional</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Currency</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={fieldCls}>
                <option value="TZS">TZS</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Effective From *</label>
              <input type="date" required value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className={fieldCls} />
            </div>
          </div>
        </form>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="text-sm text-slate-600 px-4 py-2 rounded-md border border-slate-200 hover:bg-slate-50">Cancel</button>
          <button onClick={(e) => handleSubmit(e as unknown as React.FormEvent)} disabled={saving} className="text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-md font-medium">
            {saving ? 'Saving…' : item ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PriceListsPage() {
  const [items, setItems] = useState<PriceList[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PriceList | null>(null);
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

  const handleAction = async (id: string, action: 'approve') => {
    setActioning(id);
    try {
      await fetch(`/api/backend/westsides/price-lists/${id}/${action}`, { method: 'PATCH' });
      load();
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
              <option value="RETAIL">Retail</option>
              <option value="WHOLESALE">Wholesale</option>
              <option value="CUSTOMER_SPECIFIC">Customer Specific</option>
              <option value="PROMOTIONAL">Promotional</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={fieldCls}>
              <option value="">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="PENDING">Pending</option>
              <option value="ACTIVE">Active</option>
              <option value="APPROVED">Approved</option>
              <option value="EXPIRED">Expired</option>
              <option value="INACTIVE">Inactive</option>
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
                    <th className={thCls}>Created By</th>
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
                      <td className={tdCls}>{pl.createdBy ?? '—'}</td>
                      <td className="px-4 py-2 flex items-center gap-2">
                        <button onClick={() => { setEditing(pl); setModalOpen(true); }} className="text-xs text-indigo-600 hover:text-indigo-800">Edit</button>
                        {(pl.status === 'PENDING' || pl.status === 'DRAFT') && (
                          <button
                            onClick={() => handleAction(pl.id, 'approve')}
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
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSaved={() => { setModalOpen(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
