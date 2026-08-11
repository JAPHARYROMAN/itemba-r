'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DocumentPreviewLink } from '@/components/documents';
import { Btn, Card, Modal, PageHeader, StatusBadge, showToast } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeliveryNote {
  id: string;
  dnNumber?: string;
  deliveryNoteNumber?: string;
  dnDate?: string;
  deliveryDate?: string;
  customerName?: string;
  salesOrderNumber?: string;
  driverName?: string;
  vehicleNumber?: string;
  status: string;
}

/** Minimal shape of a confirmed sales order shown in the picker. */
interface SalesOrderOption {
  id: string;
  companyId?: string | null;
  salesOrderNumber?: string;
  orderNumber?: string;
  orderDate?: string;
  status: string;
  customerId?: string | null;
  customerName?: string | null;
  customer?: { id?: string; name?: string | null; customerCode?: string | null } | null;
}

/** A single line as returned by GET /sales-orders/:id. */
interface SalesOrderLine {
  id?: string;
  productId?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  qty?: number | string | null;
  unitId?: string | null;
  unit?: { name?: string | null; symbol?: string | null } | null;
  product?: { name?: string | null; productCode?: string | null; sku?: string | null } | null;
}

/** Full sales order detail (only the fields this screen prefills from). */
interface SalesOrderDetail extends SalesOrderOption {
  lines?: SalesOrderLine[];
}

/** A delivery-note line prefilled from a sales order, ready to POST. */
interface DeliveryNoteLine {
  productId: string;
  description: string;
  orderedQuantity: number;
  deliveredQuantity: number;
  unitId: string;
  salesOrderLineId?: string;
  // Display-only helpers (not sent to the backend).
  productLabel: string;
  unitLabel: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fieldCls = 'w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const STATUS_CLR: Record<string, string> = {
  DRAFT: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  DISPATCHED: 'bg-blue-50 text-blue-700 border-blue-200',
  IN_TRANSIT: 'bg-amber-50 text-amber-700 border-amber-200',
  DELIVERED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CANCELLED: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  PARTIAL: 'bg-amber-50 text-amber-700 border-amber-200',
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

function fmtQty(v: number | string | null | undefined) {
  const n = Number(v ?? 0);
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 4 }).format(Number.isFinite(n) ? n : 0);
}

function soLabel(so: SalesOrderOption) {
  const ref = so.salesOrderNumber ?? so.orderNumber ?? so.id.slice(0, 8);
  const customer = so.customer?.name ?? so.customerName;
  const when = so.orderDate ? fmtDate(so.orderDate) : '';
  return [ref, customer, when].filter(Boolean).join(' · ');
}

/** Map a sales-order line to the delivery-note line contract (delivered defaults to ordered). */
function soLineToDnLine(line: SalesOrderLine): DeliveryNoteLine {
  const ordered = Number(line.quantity ?? line.qty ?? 0) || 0;
  const productLabel = [line.product?.productCode, line.product?.name]
    .filter(Boolean)
    .join(' — ') || line.description || 'Item';
  return {
    productId: line.productId ?? '',
    description: line.description ?? line.product?.name ?? '',
    orderedQuantity: ordered,
    deliveredQuantity: ordered,
    unitId: line.unitId ?? '',
    salesOrderLineId: line.id,
    productLabel,
    unitLabel: line.unit?.symbol ?? line.unit?.name ?? '',
  };
}

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps { item: DeliveryNote | null; onClose: () => void; onSaved: () => void }

function DeliveryNoteModal({ item, onClose, onSaved }: ModalProps) {
  const [customerId, setCustomerId] = useState('');
  const [salesOrderId, setSalesOrderId] = useState('');
  // driverName / vehicleNumber are plain text on the backend (no driver or
  // vehicle entities exist), so these are honest free-text fields.
  const [driverName, setDriverName] = useState(item?.driverName ?? '');
  const [vehicleNumber, setVehicleNumber] = useState(item?.vehicleNumber ?? '');
  const [deliveryDate, setDeliveryDate] = useState(
    (item?.deliveryDate ?? item?.dnDate)?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // ── Confirmed sales-order picker + line prefill ──────────────────────────────
  const [salesOrders, setSalesOrders] = useState<SalesOrderOption[]>([]);
  const [soLoading, setSoLoading] = useState(false);
  const [soError, setSoError] = useState('');
  const [soSearch, setSoSearch] = useState('');
  const [selectedSo, setSelectedSo] = useState<SalesOrderDetail | null>(null);
  const [linesLoading, setLinesLoading] = useState(false);
  const [lines, setLines] = useState<DeliveryNoteLine[]>([]);

  // Load confirmed sales orders once when the modal opens — these are the only
  // orders eligible to be turned into a delivery note.
  useEffect(() => {
    let cancelled = false;
    setSoLoading(true);
    setSoError('');
    fetch('/api/backend/sales-orders?status=CONFIRMED&limit=100')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load sales orders');
        const json = await res.json();
        const rows: SalesOrderOption[] = json.data?.data ?? json.data ?? [];
        if (!cancelled) setSalesOrders(Array.isArray(rows) ? rows : []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSoError(err instanceof Error ? err.message : 'Could not load sales orders');
      })
      .finally(() => {
        if (!cancelled) setSoLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const filteredSalesOrders = useMemo(() => {
    const q = soSearch.trim().toLowerCase();
    if (!q) return salesOrders;
    return salesOrders.filter((so) => soLabel(so).toLowerCase().includes(q));
  }, [salesOrders, soSearch]);

  // When a sales order is chosen, pull its detail (with lines) and prefill the
  // delivery-note lines so the user does not re-enter each item by hand.
  const handleSelectSalesOrder = useCallback(async (id: string) => {
    setSalesOrderId(id);
    setSelectedSo(null);
    setLines([]);
    if (!id) return;
    setLinesLoading(true);
    setSoError('');
    try {
      const res = await fetch(`/api/backend/sales-orders/${id}`);
      if (!res.ok) throw new Error('Failed to load sales order lines');
      const json = await res.json();
      const detail: SalesOrderDetail = json.data ?? json;
      setSelectedSo(detail);
      setLines((detail.lines ?? []).map(soLineToDnLine));
      // Inherit the customer from the sales order so the note stays linked.
      const soCustomerId = detail.customerId ?? detail.customer?.id ?? '';
      if (soCustomerId) setCustomerId(soCustomerId);
    } catch (err: unknown) {
      setSoError(err instanceof Error ? err.message : 'Could not load sales order lines');
    } finally {
      setLinesLoading(false);
    }
  }, []);

  const setDeliveredQty = (index: number, value: string) => {
    const qty = Number(value);
    setLines((prev) =>
      prev.map((line, i) =>
        i === index ? { ...line, deliveredQuantity: Number.isFinite(qty) && qty >= 0 ? qty : 0 } : line,
      ),
    );
  };

  const handleSubmit = async () => {
    // Creating a delivery note requires a source sales order (with lines) so the
    // note carries real fulfillment data instead of an empty shell.
    if (!item && !salesOrderId) {
      setError('Select a confirmed sales order to build this delivery note.');
      return;
    }
    if (!deliveryDate) {
      setError('Delivery date is required.');
      return;
    }
    if (!item) {
      const companyId = selectedSo?.companyId;
      if (!companyId) {
        setError('The selected sales order is missing its company — reload and try again.');
        return;
      }
      if (!lines.length) {
        setError('The selected sales order has no lines to deliver.');
        return;
      }
      if (lines.some((line) => !line.productId || !line.unitId)) {
        setError('Every delivery line needs a product and unit — the sales order has incomplete lines.');
        return;
      }
    }
    setSaving(true); setError('');
    try {
      const body = item
        ? {
            deliveryDate,
            driverName: driverName || undefined,
            vehicleNumber: vehicleNumber || undefined,
            notes: notes || undefined,
          }
        : {
            companyId: selectedSo!.companyId,
            salesOrderId,
            customerId: customerId || undefined,
            deliveryDate,
            driverName: driverName || undefined,
            vehicleNumber: vehicleNumber || undefined,
            notes: notes || undefined,
            lines: lines.map((line) => ({
              productId: line.productId,
              description: line.description || undefined,
              quantity: line.deliveredQuantity,
              unitId: line.unitId,
              salesOrderLineId: line.salesOrderLineId || undefined,
            })),
          };
      const url = item ? `/api/backend/westsides/delivery-notes/${item.id}` : '/api/backend/westsides/delivery-notes';
      const method = item ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      showToast('success', item ? 'Delivery note updated' : 'Delivery note created');
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error saving';
      setError(message);
      showToast('error', 'Save failed', message);
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={item ? 'Edit Delivery Note' : 'New Delivery Note'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={handleSubmit} loading={saving}>{item ? 'Update' : 'Create'}</Btn></>}>
      <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}

          {/* Sales-order lookup — replaces the raw SO id field and drives line prefill. */}
          {!item && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <label className={labelCls} htmlFor="dn-so-picker">
                  Sales Order <span className="text-red-500">*</span>
                </label>
                {selectedSo && <StatusBadge value={selectedSo.status} />}
              </div>
              <input
                value={soSearch}
                onChange={(e) => setSoSearch(e.target.value)}
                className={fieldCls}
                placeholder="Search confirmed orders by number or customer…"
              />
              <select
                id="dn-so-picker"
                value={salesOrderId}
                onChange={(e) => handleSelectSalesOrder(e.target.value)}
                disabled={soLoading}
                className={fieldCls}
              >
                <option value="">
                  {soLoading ? 'Loading confirmed sales orders…' : 'Select a confirmed sales order'}
                </option>
                {filteredSalesOrders.map((so) => (
                  <option key={so.id} value={so.id}>{soLabel(so)}</option>
                ))}
              </select>
              {soError && <p className="text-xs text-red-600">{soError}</p>}
              {!soLoading && !soError && salesOrders.length === 0 && (
                <p className="text-xs text-slate-500">No confirmed sales orders are available to deliver.</p>
              )}

              {/* Prefilled lines pulled from the chosen sales order. */}
              {linesLoading ? (
                <p className="text-xs text-slate-500">Loading order lines…</p>
              ) : selectedSo ? (
                lines.length ? (
                  <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className={thCls}>Item</th>
                          <th className={`${thCls} text-right`}>Ordered</th>
                          <th className={`${thCls} text-right`}>Delivered</th>
                          <th className={thCls}>Unit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {lines.map((line, i) => (
                          <tr key={`${line.productId}-${i}`}>
                            <td className={tdCls}>{line.productLabel}</td>
                            <td className={`${tdCls} text-right tabular-nums`}>{fmtQty(line.orderedQuantity)}</td>
                            <td className="px-4 py-2 text-right">
                              <input
                                type="number"
                                min={0}
                                step="any"
                                value={line.deliveredQuantity}
                                onChange={(e) => setDeliveredQty(i, e.target.value)}
                                aria-label={`Delivered quantity for ${line.productLabel}`}
                                className="w-24 text-sm border border-slate-200 rounded-md px-2 py-1 text-right bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                              />
                            </td>
                            <td className={tdCls}>{line.unitLabel || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">This sales order has no lines to deliver.</p>
                )
              ) : (
                <p className="text-xs text-slate-500">
                  Pick a sales order to pre-fill delivery lines — no need to re-enter items.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Customer</label>
              <input
                value={item ? (item.customerName ?? '—') : (selectedSo?.customer?.name ?? selectedSo?.customerName ?? '')}
                disabled
                className={`${fieldCls} disabled:bg-slate-50 disabled:text-slate-500`}
                placeholder="Inherited from the sales order"
              />
            </div>
            <div>
              <label className={labelCls}>Delivery Date *</label>
              <input type="date" required value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>Driver name</label>
              <input value={driverName} onChange={(e) => setDriverName(e.target.value)} className={fieldCls} placeholder="e.g. Juma Hassan (optional)" />
            </div>
            <div>
              <label className={labelCls}>Vehicle</label>
              <input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} className={fieldCls} placeholder="e.g. T 123 ABC (optional)" />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={fieldCls} placeholder="Delivery notes…" />
            </div>
          </div>
      </form>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type DNAction = 'dispatch' | 'deliver' | 'cancel';

const STATUS_ACTIONS: Record<string, { action: DNAction; label: string; cls: string }[]> = {
  DRAFT: [
    { action: 'dispatch', label: 'Dispatch', cls: 'text-blue-600 hover:text-blue-800' },
    { action: 'cancel', label: 'Cancel', cls: 'text-red-500 hover:text-red-700' },
  ],
  DISPATCHED: [
    { action: 'deliver', label: 'Mark Delivered', cls: 'text-emerald-600 hover:text-emerald-800' },
    { action: 'cancel', label: 'Cancel', cls: 'text-red-500 hover:text-red-700' },
  ],
  IN_TRANSIT: [
    { action: 'deliver', label: 'Mark Delivered', cls: 'text-emerald-600 hover:text-emerald-800' },
  ],
};

const ACTION_ENDPOINT: Record<DNAction, string> = {
  dispatch: 'dispatch',
  deliver: 'deliver',
  cancel: 'cancel',
};

const ACTION_DONE: Record<DNAction, string> = {
  dispatch: 'Delivery note dispatched',
  deliver: 'Delivery note marked delivered',
  cancel: 'Delivery note cancelled',
};

export default function DeliveryNotesPage() {
  const [items, setItems] = useState<DeliveryNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DeliveryNote | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/backend/westsides/delivery-notes?limit=100');
      if (!res.ok) throw new Error('Failed to load delivery notes');
      const json = await res.json();
      setItems(json.data?.data ?? json.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading data');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (id: string, action: DNAction) => {
    setActioning(`${id}-${action}`);
    try {
      const res = await fetch(`/api/backend/westsides/delivery-notes/${id}/${ACTION_ENDPOINT[action]}`, { method: 'PATCH' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Action failed');
      }
      showToast('success', ACTION_DONE[action]);
      load();
    } catch (err: unknown) {
      showToast('error', 'Action failed', err instanceof Error ? err.message : undefined);
    } finally { setActioning(null); }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Delivery Notes" subtitle="Track and confirm deliveries to customers" />
        <button onClick={() => { setEditing(null); setModalOpen(true); }} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium">
          + New Delivery Note
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? <Spinner /> : (
        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No delivery notes found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>DN #</th>
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Customer</th>
                    <th className={thCls}>Sales Order</th>
                    <th className={thCls}>Driver</th>
                    <th className={thCls}>Vehicle</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((dn) => {
                    const actions = STATUS_ACTIONS[dn.status] ?? [];
                    return (
                      <tr key={dn.id} className="hover:bg-slate-50">
                        <td className={`${tdCls} font-medium`}>{dn.deliveryNoteNumber ?? dn.dnNumber ?? dn.id.slice(0, 8)}</td>
                        <td className={tdCls}>{fmtDate(dn.deliveryDate ?? dn.dnDate ?? new Date().toISOString())}</td>
                        <td className={tdCls}>{dn.customerName ?? '—'}</td>
                        <td className={tdCls}>{dn.salesOrderNumber ?? '—'}</td>
                        <td className={tdCls}>{dn.driverName ?? '—'}</td>
                        <td className={tdCls}>{dn.vehicleNumber ?? '—'}</td>
                        <td className={tdCls}><Badge status={dn.status} /></td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <DocumentPreviewLink href={`/westsides/delivery-notes/${dn.id}/print`} />
                            <button onClick={() => { setEditing(dn); setModalOpen(true); }} className="text-xs text-indigo-600 hover:text-indigo-800">Edit</button>
                            {actions.map((a) => (
                              <button
                                key={a.action}
                                onClick={() => handleAction(dn.id, a.action)}
                                disabled={actioning === `${dn.id}-${a.action}`}
                                className={`text-xs font-medium disabled:opacity-50 ${a.cls}`}
                              >
                                {actioning === `${dn.id}-${a.action}` ? '…' : a.label}
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
        <DeliveryNoteModal
          item={editing}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSaved={() => { setModalOpen(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
