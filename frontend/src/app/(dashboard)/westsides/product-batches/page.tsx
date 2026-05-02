'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProductBatch {
  id: string;
  batchNumber: string;
  productName?: string;
  supplierName?: string;
  locationName?: string;
  manufactureDate?: string;
  expiryDate?: string;
  initialQty: number;
  remainingQty: number;
  status: string;
}

type TabKey = 'all' | 'expiring' | 'expired';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fieldCls = 'w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const STATUS_CLR: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  EXPIRING_SOON: 'bg-amber-50 text-amber-700 border-amber-200',
  EXPIRED: 'bg-red-50 text-red-700 border-red-200',
  DEPLETED: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  QUARANTINE: 'bg-red-50 text-red-700 border-red-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return (
    <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function expiryBadge(expiryDate?: string) {
  if (!expiryDate) return null;
  const now = new Date();
  const exp = new Date(expiryDate);
  const daysLeft = Math.floor((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-2" title="Expired" />;
  if (daysLeft < 30) return <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-2" title="Expiring soon" />;
  return <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-2" title="Active" />;
}

function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtNum(n: number) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n); }

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

interface ModalProps { onClose: () => void; onSaved: () => void }

function BatchModal({ onClose, onSaved }: ModalProps) {
  const [batchNumber, setBatchNumber] = useState('');
  const [productId, setProductId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [manufactureDate, setManufactureDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [initialQty, setInitialQty] = useState<number | ''>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchNumber || !productId) { setError('Batch number and product are required'); return; }
    setSaving(true); setError('');
    try {
      const body = { batchNumber, productId, supplierId: supplierId || undefined, locationId: locationId || undefined, manufactureDate: manufactureDate || undefined, expiryDate: expiryDate || undefined, initialQty: Number(initialQty) || 0 };
      const res = await fetch('/api/backend/westsides/product-batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
          <h2 className="text-base font-semibold text-slate-900">New Product Batch</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><CloseIcon /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Batch Number *</label>
              <input required value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} className={fieldCls} placeholder="e.g. BATCH-001" />
            </div>
            <div>
              <label className={labelCls}>Product ID *</label>
              <input required value={productId} onChange={(e) => setProductId(e.target.value)} className={fieldCls} placeholder="Product ID" />
            </div>
            <div>
              <label className={labelCls}>Supplier ID</label>
              <input value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={fieldCls} placeholder="Supplier ID" />
            </div>
            <div>
              <label className={labelCls}>Location ID</label>
              <input value={locationId} onChange={(e) => setLocationId(e.target.value)} className={fieldCls} placeholder="Location ID" />
            </div>
            <div>
              <label className={labelCls}>Manufacture Date</label>
              <input type="date" value={manufactureDate} onChange={(e) => setManufactureDate(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>Expiry Date</label>
              <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={fieldCls} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Initial Quantity</label>
              <input type="number" min={0} value={initialQty} onChange={(e) => setInitialQty(e.target.value === '' ? '' : Number(e.target.value))} className={fieldCls} placeholder="0" />
            </div>
          </div>
        </form>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="text-sm text-slate-600 px-4 py-2 rounded-md border border-slate-200 hover:bg-slate-50">Cancel</button>
          <button onClick={(e) => handleSubmit(e as unknown as React.FormEvent)} disabled={saving} className="text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-md font-medium">
            {saving ? 'Saving…' : 'Create Batch'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'All Batches' },
  { key: 'expiring', label: 'Expiring Soon' },
  { key: 'expired', label: 'Expired' },
];

const TAB_ENDPOINT: Record<TabKey, string> = {
  all: '/api/backend/westsides/product-batches',
  expiring: '/api/backend/westsides/product-batches/expiring',
  expired: '/api/backend/westsides/product-batches/expired',
};

export default function ProductBatchesPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [items, setItems] = useState<ProductBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`${TAB_ENDPOINT[activeTab]}?limit=100`);
      if (!res.ok) throw new Error('Failed to load batches');
      const json = await res.json();
      setItems(json.data?.data ?? json.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading data');
    } finally { setLoading(false); }
  }, [activeTab]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Product Batches" subtitle="Batch and expiry tracking for beverages and perishables" />
        <button onClick={() => setModalOpen(true)} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium">
          + New Batch
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${activeTab === tab.key ? 'bg-white border border-b-white border-slate-200 text-indigo-700 -mb-px' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-400" /> Active</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-amber-400" /> Expiring &lt;30 days</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-red-500" /> Expired</span>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? <Spinner /> : (
        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No batches found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>Batch #</th>
                    <th className={thCls}>Product</th>
                    <th className={thCls}>Supplier</th>
                    <th className={thCls}>Location</th>
                    <th className={thCls}>Mfg Date</th>
                    <th className={thCls}>Expiry Date</th>
                    <th className={`${thCls} text-right`}>Initial Qty</th>
                    <th className={`${thCls} text-right`}>Remaining</th>
                    <th className={thCls}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`}>{b.batchNumber}</td>
                      <td className={tdCls}>{b.productName ?? '—'}</td>
                      <td className={tdCls}>{b.supplierName ?? '—'}</td>
                      <td className={tdCls}>{b.locationName ?? '—'}</td>
                      <td className={tdCls}>{b.manufactureDate ? fmtDate(b.manufactureDate) : '—'}</td>
                      <td className={tdCls}>
                        <span className="flex items-center">
                          {expiryBadge(b.expiryDate)}
                          {b.expiryDate ? fmtDate(b.expiryDate) : '—'}
                        </span>
                      </td>
                      <td className={`${tdCls} text-right`}>{fmtNum(b.initialQty)}</td>
                      <td className={`${tdCls} text-right`}>{fmtNum(b.remainingQty)}</td>
                      <td className={tdCls}><Badge status={b.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {modalOpen && (
        <BatchModal
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); load(); }}
        />
      )}
    </div>
  );
}
