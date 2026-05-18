'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CustomerPriceAgreement {
  id: string;
  customerName?: string;
  priceListName?: string;
  productName?: string;
  agreedPrice: number;
  discountPercent: number;
  startDate: string;
  endDate?: string;
  status: string;
}

interface PriceList { id: string; name: string }
interface Product { id: string; name: string; productCode: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fieldCls = 'w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const STATUS_CLR: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
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

function fmtCurrency(n: number | string | null | undefined) { const value = Number(n ?? 0); return `TZS ${new Intl.NumberFormat('en-US').format(Number.isFinite(value) ? value : 0)}`; }
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

interface ModalProps { item: CustomerPriceAgreement | null; onClose: () => void; onSaved: () => void }

function AgreementModal({ item, onClose, onSaved }: ModalProps) {
  const [customerId, setCustomerId] = useState('');
  const [priceListId, setPriceListId] = useState('');
  const [productId, setProductId] = useState('');
  const [agreedPrice, setAgreedPrice] = useState<number | ''>(item?.agreedPrice ?? '');
  const [discountPercent, setDiscountPercent] = useState<number | ''>(item?.discountPercent ?? 0);
  const [startDate, setStartDate] = useState(item?.startDate?.slice(0, 10) ?? '');
  const [endDate, setEndDate] = useState(item?.endDate?.slice(0, 10) ?? '');
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/backend/westsides/price-lists?limit=100').then(r => r.json()).then(j => setPriceLists(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    fetch('/api/backend/products?limit=200').then(r => r.json()).then(j => setProducts(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate) { setError('Start date is required'); return; }
    setSaving(true); setError('');
    try {
      const body = {
        customerId: customerId || undefined,
        priceListId: priceListId || undefined,
        productId: productId || undefined,
        agreedPrice: Number(agreedPrice) || 0,
        discountPercent: Number(discountPercent) || 0,
        startDate,
        endDate: endDate || undefined,
      };
      const url = item ? `/api/backend/westsides/customer-price-agreements/${item.id}` : '/api/backend/westsides/customer-price-agreements';
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
          <h2 className="text-base font-semibold text-slate-900">{item ? 'Edit Agreement' : 'New Agreement'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><CloseIcon /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Customer ID</label>
              <input value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={fieldCls} placeholder="Customer ID" />
            </div>
            <div>
              <label className={labelCls}>Price List</label>
              <select value={priceListId} onChange={(e) => setPriceListId(e.target.value)} className={fieldCls}>
                <option value="">Select…</option>
                {priceLists.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Product</label>
              <select value={productId} onChange={(e) => setProductId(e.target.value)} className={fieldCls}>
                <option value="">Select…</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.productCode} – {p.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Agreed Price</label>
              <input type="number" min={0} step="0.01" value={agreedPrice} onChange={(e) => setAgreedPrice(e.target.value === '' ? '' : Number(e.target.value))} className={fieldCls} placeholder="0.00" />
            </div>
            <div>
              <label className={labelCls}>Discount %</label>
              <input type="number" min={0} max={100} step="0.01" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value === '' ? '' : Number(e.target.value))} className={fieldCls} placeholder="0" />
            </div>
            <div>
              <label className={labelCls}>Start Date *</label>
              <input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>End Date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={fieldCls} />
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

export default function CustomerPriceAgreementsPage() {
  const [items, setItems] = useState<CustomerPriceAgreement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerPriceAgreement | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/backend/westsides/customer-price-agreements?limit=100');
      if (!res.ok) throw new Error('Failed to load agreements');
      const json = await res.json();
      setItems(json.data?.data ?? json.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading data');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Customer Price Agreements" subtitle="Manage customer-specific pricing agreements" />
        <button onClick={() => { setEditing(null); setModalOpen(true); }} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium">
          + New Agreement
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? <Spinner /> : (
        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No agreements found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>Customer</th>
                    <th className={thCls}>Price List</th>
                    <th className={thCls}>Product</th>
                    <th className={`${thCls} text-right`}>Agreed Price</th>
                    <th className={`${thCls} text-right`}>Discount %</th>
                    <th className={thCls}>Start Date</th>
                    <th className={thCls}>End Date</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((ag) => (
                    <tr key={ag.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`}>{ag.customerName ?? '—'}</td>
                      <td className={tdCls}>{ag.priceListName ?? '—'}</td>
                      <td className={tdCls}>{ag.productName ?? '—'}</td>
                      <td className={`${tdCls} text-right`}>{fmtCurrency(ag.agreedPrice)}</td>
                      <td className={`${tdCls} text-right`}>{ag.discountPercent}%</td>
                      <td className={tdCls}>{ag.startDate ? fmtDate(ag.startDate) : '—'}</td>
                      <td className={tdCls}>{ag.endDate ? fmtDate(ag.endDate) : '—'}</td>
                      <td className={tdCls}><Badge status={ag.status} /></td>
                      <td className="px-4 py-2">
                        <button onClick={() => { setEditing(ag); setModalOpen(true); }} className="text-xs text-indigo-600 hover:text-indigo-800">Edit</button>
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
        <AgreementModal
          item={editing}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSaved={() => { setModalOpen(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
