'use client';

import { useCallback, useEffect, useState } from 'react';
import { DocumentPreviewLink } from '@/components/documents';
import { Card, PageHeader } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Quotation {
  id: string;
  quotationNumber: string;
  quotationDate: string;
  customerName?: string;
  quotationType: string;
  totalAmount: number;
  validUntil?: string;
  status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fieldCls = 'w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const STATUS_CLR: Record<string, string> = {
  DRAFT: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  SENT: 'bg-blue-50 text-blue-700 border-blue-200',
  ACCEPTED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
  EXPIRED: 'bg-red-50 text-red-700 border-red-200',
  CONVERTED: 'bg-purple-50 text-purple-700 border-purple-200',
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

interface ModalProps { item: Quotation | null; onClose: () => void; onSaved: () => void }

function QuotationModal({ item, onClose, onSaved }: ModalProps) {
  const [customerId, setCustomerId] = useState('');
  const [quotationType, setQuotationType] = useState(item?.quotationType ?? 'WHOLESALE');
  const [validUntil, setValidUntil] = useState(item?.validUntil?.slice(0, 10) ?? '');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const body = { customerId: customerId || undefined, quotationType, validUntil: validUntil || undefined, notes: notes || undefined };
      const url = item ? `/api/backend/westsides/quotations/${item.id}` : '/api/backend/westsides/quotations';
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
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">{item ? 'Edit Quotation' : 'New Quotation'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><CloseIcon /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelCls}>Customer ID</label>
              <input value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={fieldCls} placeholder="Customer ID" />
            </div>
            <div>
              <label className={labelCls}>Quotation Type</label>
              <select value={quotationType} onChange={(e) => setQuotationType(e.target.value)} className={fieldCls}>
                <option value="WHOLESALE">Wholesale</option>
                <option value="RETAIL">Retail</option>
                <option value="HARDWARE">Hardware</option>
                <option value="EXPORT">Export</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Valid Until</label>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={fieldCls} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={fieldCls} placeholder="Quotation notes…" />
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

type QuotationAction = 'send' | 'accept' | 'reject' | 'convert';

const STATUS_ACTIONS: Record<string, { action: QuotationAction; label: string; cls: string }[]> = {
  DRAFT: [{ action: 'send', label: 'Send', cls: 'text-blue-600 hover:text-blue-800' }],
  SENT: [
    { action: 'accept', label: 'Accept', cls: 'text-emerald-600 hover:text-emerald-800' },
    { action: 'reject', label: 'Reject', cls: 'text-red-500 hover:text-red-700' },
  ],
  ACCEPTED: [{ action: 'convert', label: 'Convert to Order', cls: 'text-purple-600 hover:text-purple-800' }],
};

export default function QuotationsPage() {
  const [items, setItems] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Quotation | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/backend/westsides/quotations?limit=100');
      if (!res.ok) throw new Error('Failed to load quotations');
      const json = await res.json();
      setItems(json.data?.data ?? json.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading data');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (id: string, action: QuotationAction) => {
    setActioning(`${id}-${action}`);
    try {
      const endpoint = action === 'convert' ? 'convert-to-sales-order' : action;
      const res = await fetch(`/api/backend/westsides/quotations/${id}/${endpoint}`, { method: 'PATCH' });
      if (!res.ok) throw new Error('Action failed');
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Action failed');
    } finally { setActioning(null); }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Quotations" subtitle="Sales quotations for wholesale and hardware customers" />
        <button onClick={() => { setEditing(null); setModalOpen(true); }} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium">
          + New Quotation
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? <Spinner /> : (
        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No quotations found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>Quotation #</th>
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Customer</th>
                    <th className={thCls}>Type</th>
                    <th className={`${thCls} text-right`}>Total Amount</th>
                    <th className={thCls}>Valid Until</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((q) => {
                    const actions = STATUS_ACTIONS[q.status] ?? [];
                    return (
                      <tr key={q.id} className="hover:bg-slate-50">
                        <td className={`${tdCls} font-medium`}>{q.quotationNumber}</td>
                        <td className={tdCls}>{fmtDate(q.quotationDate)}</td>
                        <td className={tdCls}>{q.customerName ?? '—'}</td>
                        <td className={tdCls}>{q.quotationType?.replace(/_/g, ' ')}</td>
                        <td className={`${tdCls} text-right`}>{fmtCurrency(q.totalAmount)}</td>
                        <td className={tdCls}>{q.validUntil ? fmtDate(q.validUntil) : '—'}</td>
                        <td className={tdCls}><Badge status={q.status} /></td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <DocumentPreviewLink href={`/westsides/quotations/${q.id}/print`} />
                            <button onClick={() => { setEditing(q); setModalOpen(true); }} className="text-xs text-indigo-600 hover:text-indigo-800">Edit</button>
                            {actions.map((a) => (
                              <button
                                key={a.action}
                                onClick={() => handleAction(q.id, a.action)}
                                disabled={actioning === `${q.id}-${a.action}`}
                                className={`text-xs font-medium disabled:opacity-50 ${a.cls}`}
                              >
                                {actioning === `${q.id}-${a.action}` ? '…' : a.label}
                              </button>
                            ))}
                          </div>
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
        <QuotationModal
          item={editing}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSaved={() => { setModalOpen(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
