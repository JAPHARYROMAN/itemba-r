'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PackageMovement {
  id: string;
  movementNumber: string;
  movementDate: string;
  packageName?: string;
  partyName?: string;
  movementType: string;
  quantity: number;
  depositAmount: number;
  reference?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fieldCls = 'w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const MOVEMENT_CLR: Record<string, string> = {
  ISSUE: 'bg-amber-50 text-amber-700 border-amber-200',
  RETURN: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ADJUSTMENT: 'bg-blue-50 text-blue-700 border-blue-200',
  WRITEOFF: 'bg-red-50 text-red-700 border-red-200',
};

function Badge({ type }: { type: string }) {
  const cls = MOVEMENT_CLR[type] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return (
    <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {type.replace(/_/g, ' ')}
    </span>
  );
}

function fmtCurrency(n: number) { return `TZS ${new Intl.NumberFormat('en-US').format(n)}`; }
function fmtNum(n: number) { return new Intl.NumberFormat('en-US').format(n); }
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

interface ModalProps { onClose: () => void; onSaved: () => void }

function MovementModal({ onClose, onSaved }: ModalProps) {
  const [packageId, setPackageId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [movementType, setMovementType] = useState('ISSUE');
  const [quantity, setQuantity] = useState<number | ''>(0);
  const [depositAmount, setDepositAmount] = useState<number | ''>(0);
  const [reference, setReference] = useState('');
  const [movementDate, setMovementDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!packageId || !quantity) { setError('Package and quantity are required'); return; }
    setSaving(true); setError('');
    try {
      const body = {
        packageId,
        customerId: customerId || undefined,
        movementType,
        quantity: Number(quantity),
        depositAmount: Number(depositAmount) || 0,
        reference: reference || undefined,
        movementDate: movementDate || undefined,
      };
      const res = await fetch('/api/backend/westsides/package-movements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
          <h2 className="text-base font-semibold text-slate-900">Record Package Movement</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><CloseIcon /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Package ID *</label>
              <input required value={packageId} onChange={(e) => setPackageId(e.target.value)} className={fieldCls} placeholder="Package ID" />
            </div>
            <div>
              <label className={labelCls}>Customer/Supplier ID</label>
              <input value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={fieldCls} placeholder="Customer or Supplier ID" />
            </div>
            <div>
              <label className={labelCls}>Movement Type</label>
              <select value={movementType} onChange={(e) => setMovementType(e.target.value)} className={fieldCls}>
                <option value="ISSUE">Issue</option>
                <option value="RETURN">Return</option>
                <option value="ADJUSTMENT">Adjustment</option>
                <option value="WRITEOFF">Write-off</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Movement Date</label>
              <input type="date" value={movementDate} onChange={(e) => setMovementDate(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>Quantity *</label>
              <input required type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))} className={fieldCls} placeholder="0" />
            </div>
            <div>
              <label className={labelCls}>Deposit Amount (TZS)</label>
              <input type="number" min={0} value={depositAmount} onChange={(e) => setDepositAmount(e.target.value === '' ? '' : Number(e.target.value))} className={fieldCls} placeholder="0" />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Reference</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} className={fieldCls} placeholder="e.g. Delivery Note #, Sales Order #" />
            </div>
          </div>
        </form>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="text-sm text-slate-600 px-4 py-2 rounded-md border border-slate-200 hover:bg-slate-50">Cancel</button>
          <button onClick={(e) => handleSubmit(e as unknown as React.FormEvent)} disabled={saving} className="text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-md font-medium">
            {saving ? 'Saving…' : 'Record Movement'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PackageMovementsPage() {
  const [items, setItems] = useState<PackageMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [filterCustomerId, setFilterCustomerId] = useState('');
  const [filterMovementType, setFilterMovementType] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (filterCustomerId) params.set('customerId', filterCustomerId);
      if (filterMovementType) params.set('movementType', filterMovementType);
      const res = await fetch(`/api/backend/westsides/package-movements?${params}`);
      if (!res.ok) throw new Error('Failed to load package movements');
      const json = await res.json();
      setItems(json.data?.data ?? json.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading data');
    } finally { setLoading(false); }
  }, [filterCustomerId, filterMovementType]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Package Movements" subtitle="Track crate and bottle issue and return movements" />
        <button onClick={() => setModalOpen(true)} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium">
          + Record Movement
        </button>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Customer ID</label>
            <input
              value={filterCustomerId}
              onChange={(e) => setFilterCustomerId(e.target.value)}
              className={fieldCls}
              placeholder="Filter by customer ID…"
            />
          </div>
          <div>
            <label className={labelCls}>Movement Type</label>
            <select value={filterMovementType} onChange={(e) => setFilterMovementType(e.target.value)} className={fieldCls}>
              <option value="">All Types</option>
              <option value="ISSUE">Issue</option>
              <option value="RETURN">Return</option>
              <option value="ADJUSTMENT">Adjustment</option>
              <option value="WRITEOFF">Write-off</option>
            </select>
          </div>
        </div>
      </Card>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? <Spinner /> : (
        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No movements found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>Movement #</th>
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Package</th>
                    <th className={thCls}>Customer/Supplier</th>
                    <th className={thCls}>Type</th>
                    <th className={`${thCls} text-right`}>Quantity</th>
                    <th className={`${thCls} text-right`}>Deposit Amount</th>
                    <th className={thCls}>Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`}>{m.movementNumber}</td>
                      <td className={tdCls}>{fmtDate(m.movementDate)}</td>
                      <td className={tdCls}>{m.packageName ?? '—'}</td>
                      <td className={tdCls}>{m.partyName ?? '—'}</td>
                      <td className={tdCls}><Badge type={m.movementType} /></td>
                      <td className={`${tdCls} text-right`}>{fmtNum(m.quantity)}</td>
                      <td className={`${tdCls} text-right`}>{fmtCurrency(m.depositAmount)}</td>
                      <td className={tdCls}>{m.reference ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {modalOpen && (
        <MovementModal
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); load(); }}
        />
      )}
    </div>
  );
}
