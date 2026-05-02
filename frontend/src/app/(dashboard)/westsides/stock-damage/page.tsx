'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StockDamage {
  id: string;
  damageNumber: string;
  productName?: string;
  locationName?: string;
  quantity: number;
  damageType: string;
  estimatedValue: number;
  status: string;
  reportedBy?: string;
  notes?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fieldCls = 'w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const STATUS_CLR: Record<string, string> = {
  DRAFT: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  SUBMITTED: 'bg-amber-50 text-amber-700 border-amber-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
  POSTED: 'bg-blue-50 text-blue-700 border-blue-200',
  CANCELLED: 'bg-zinc-100 text-zinc-500 border-zinc-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return (
    <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function fmtCurrency(n: number) { return `TZS ${new Intl.NumberFormat('en-US').format(n)}`; }
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

function DamageModal({ onClose, onSaved }: ModalProps) {
  const [productId, setProductId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [quantity, setQuantity] = useState<number | ''>(0);
  const [damageType, setDamageType] = useState('BREAKAGE');
  const [estimatedValue, setEstimatedValue] = useState<number | ''>(0);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId) { setError('Product is required'); return; }
    setSaving(true); setError('');
    try {
      const body = { productId, locationId: locationId || undefined, quantity: Number(quantity) || 0, damageType, estimatedValue: Number(estimatedValue) || 0, notes: notes || undefined };
      const res = await fetch('/api/backend/westsides/stock-damage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
          <h2 className="text-base font-semibold text-slate-900">Report Stock Damage</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><CloseIcon /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Product ID *</label>
              <input required value={productId} onChange={(e) => setProductId(e.target.value)} className={fieldCls} placeholder="Product ID" />
            </div>
            <div>
              <label className={labelCls}>Location ID</label>
              <input value={locationId} onChange={(e) => setLocationId(e.target.value)} className={fieldCls} placeholder="Location ID" />
            </div>
            <div>
              <label className={labelCls}>Quantity *</label>
              <input required type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))} className={fieldCls} placeholder="0" />
            </div>
            <div>
              <label className={labelCls}>Damage Type</label>
              <select value={damageType} onChange={(e) => setDamageType(e.target.value)} className={fieldCls}>
                <option value="BREAKAGE">Breakage</option>
                <option value="EXPIRY">Expiry</option>
                <option value="THEFT">Theft</option>
                <option value="SPOILAGE">Spoilage</option>
                <option value="SPILLAGE">Spillage</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Estimated Value (TZS)</label>
              <input type="number" min={0} value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value === '' ? '' : Number(e.target.value))} className={fieldCls} placeholder="0" />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={fieldCls} placeholder="Describe the damage…" />
            </div>
          </div>
        </form>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="text-sm text-slate-600 px-4 py-2 rounded-md border border-slate-200 hover:bg-slate-50">Cancel</button>
          <button onClick={(e) => handleSubmit(e as unknown as React.FormEvent)} disabled={saving} className="text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-5 py-2 rounded-md font-medium">
            {saving ? 'Saving…' : 'Report Damage'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type DamageAction = 'submit' | 'approve' | 'reject' | 'post';

const STATUS_ACTIONS: Record<string, { action: DamageAction; label: string; cls: string }[]> = {
  DRAFT: [{ action: 'submit', label: 'Submit', cls: 'text-amber-600 hover:text-amber-800' }],
  SUBMITTED: [
    { action: 'approve', label: 'Approve', cls: 'text-emerald-600 hover:text-emerald-800' },
    { action: 'reject', label: 'Reject', cls: 'text-red-500 hover:text-red-700' },
  ],
  APPROVED: [{ action: 'post', label: 'Post', cls: 'text-blue-600 hover:text-blue-800' }],
};

export default function StockDamagePage() {
  const [items, setItems] = useState<StockDamage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/backend/westsides/stock-damage?limit=100');
      if (!res.ok) throw new Error('Failed to load stock damage records');
      const json = await res.json();
      setItems(json.data?.data ?? json.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading data');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (id: string, action: DamageAction) => {
    setActioning(`${id}-${action}`);
    try {
      const res = await fetch(`/api/backend/westsides/stock-damage/${id}/${action}`, { method: 'PATCH' });
      if (!res.ok) throw new Error('Action failed');
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Action failed');
    } finally { setActioning(null); }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Stock Damage & Breakage" subtitle="Report and manage stock damage, breakage, and expiry" />
        <button onClick={() => setModalOpen(true)} className="text-sm bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md font-medium">
          + Report Damage
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? <Spinner /> : (
        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No damage records found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>Damage #</th>
                    <th className={thCls}>Product</th>
                    <th className={thCls}>Location</th>
                    <th className={`${thCls} text-right`}>Qty</th>
                    <th className={thCls}>Type</th>
                    <th className={`${thCls} text-right`}>Est. Value</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Reported By</th>
                    <th className={thCls}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((d) => {
                    const actions = STATUS_ACTIONS[d.status] ?? [];
                    return (
                      <tr key={d.id} className="hover:bg-slate-50">
                        <td className={`${tdCls} font-medium`}>{d.damageNumber}</td>
                        <td className={tdCls}>{d.productName ?? '—'}</td>
                        <td className={tdCls}>{d.locationName ?? '—'}</td>
                        <td className={`${tdCls} text-right`}>{fmtNum(d.quantity)}</td>
                        <td className={tdCls}>{d.damageType?.replace(/_/g, ' ')}</td>
                        <td className={`${tdCls} text-right`}>{fmtCurrency(d.estimatedValue)}</td>
                        <td className={tdCls}><Badge status={d.status} /></td>
                        <td className={tdCls}>{d.reportedBy ?? '—'}</td>
                        <td className="px-4 py-2 flex items-center gap-2">
                          {actions.map((a) => (
                            <button
                              key={a.action}
                              onClick={() => handleAction(d.id, a.action)}
                              disabled={actioning === `${d.id}-${a.action}`}
                              className={`text-xs font-medium disabled:opacity-50 ${a.cls}`}
                            >
                              {actioning === `${d.id}-${a.action}` ? '…' : a.label}
                            </button>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {modalOpen && (
        <DamageModal
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); load(); }}
        />
      )}
    </div>
  );
}
