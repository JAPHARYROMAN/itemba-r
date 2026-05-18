'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Btn, Card, FormInput, FormSelect, Modal, PageHeader, PageSpinner, StatusBadge } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

type ChargeType = 'ROOM' | 'RESTAURANT' | 'BAR' | 'LAUNDRY' | 'TELEPHONE' | 'MINIBAR' | 'OTHER';

interface Charge {
  id: string;
  chargeType: ChargeType;
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  amount: number | string;
  taxAmount: number | string;
  postedAt: string;
  notes?: string | null;
}

interface Folio {
  id: string;
  folioNumber: string;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  subtotal: number | string;
  taxAmount: number | string;
  totalAmount: number | string;
  currency: string;
  openedAt: string;
  closedAt?: string | null;
  closedBy?: { fullName?: string } | null;
  settlementSalesOrderId?: string | null;
  companyId: string;
  charges: Charge[];
  guest: { id: string; guestCode: string; fullName: string; phone?: string | null; email?: string | null };
  booking: {
    id: string;
    bookingNumber: string;
    expectedCheckIn: string;
    expectedCheckOut: string;
    actualCheckIn?: string | null;
    actualCheckOut?: string | null;
    nights: number;
    ratePerNight: number | string;
    status: string;
    room: { roomCode: string; roomType: string };
  };
}

interface CashAccount { id: string; accountName: string; accountType: string }

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'MOBILE_MONEY', label: 'Mobile Money' },
  { value: 'BANK_CARD', label: 'Bank Card' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CREDIT', label: 'Credit (invoice)' },
];

const CHARGE_TYPES: { value: ChargeType; label: string }[] = [
  { value: 'RESTAURANT', label: 'Restaurant' },
  { value: 'BAR', label: 'Bar' },
  { value: 'LAUNDRY', label: 'Laundry' },
  { value: 'TELEPHONE', label: 'Telephone' },
  { value: 'MINIBAR', label: 'Minibar' },
  { value: 'OTHER', label: 'Other' },
  { value: 'ROOM', label: 'Room (manual)' },
];

const fmt = (n: number | string | undefined | null) =>
  new Intl.NumberFormat('en-TZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(Number(n ?? 0)) ? Number(n ?? 0) : 0);

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FolioPage() {
  const params = useParams<{ bookingId: string }>();
  const bookingId = params?.bookingId as string;

  const [folio, setFolio] = useState<Folio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [chargeModalOpen, setChargeModalOpen] = useState(false);
  const [chargeForm, setChargeForm] = useState({ chargeType: 'RESTAURANT' as ChargeType, description: '', quantity: '1', unitPrice: '', taxAmount: '0', notes: '' });
  const [chargeSaving, setChargeSaving] = useState(false);
  const [chargeError, setChargeError] = useState('');
  const [opening, setOpening] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [settleModalOpen, setSettleModalOpen] = useState(false);
  const [settleForm, setSettleForm] = useState({ paymentMethod: 'CASH', cashAccountId: '', paymentReference: '' });
  const [settleBusy, setSettleBusy] = useState(false);
  const [settleError, setSettleError] = useState('');
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);

  const load = useCallback(async () => {
    if (!bookingId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/backend/hospitality/folios/booking/${bookingId}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      setFolio(j.data ?? j);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => { void load(); }, [load]);

  // Lazy-load cash accounts the first time the settle modal opens (so we
  // don't fetch them on every folio page hit).
  useEffect(() => {
    if (!settleModalOpen || !folio || cashAccounts.length > 0) return;
    fetch(`/api/backend/cash-accounts?companyId=${folio.companyId}&limit=200`)
      .then(r => r.json())
      .then(j => setCashAccounts(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []))
      .catch(() => setCashAccounts([]));
  }, [settleModalOpen, folio, cashAccounts.length]);

  const openFolio = async () => {
    setOpening(true);
    setError('');
    try {
      const res = await fetch(`/api/backend/hospitality/folios/booking/${bookingId}/open`, { method: 'POST' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Open failed');
    } finally {
      setOpening(false);
    }
  };

  const submitCharge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folio) return;
    setChargeSaving(true);
    setChargeError('');
    try {
      const body = {
        chargeType: chargeForm.chargeType,
        description: chargeForm.description.trim(),
        quantity: Number(chargeForm.quantity) || 0,
        unitPrice: Number(chargeForm.unitPrice) || 0,
        taxAmount: Number(chargeForm.taxAmount) || 0,
        ...(chargeForm.notes ? { notes: chargeForm.notes } : {}),
      };
      if (!body.description || body.unitPrice <= 0 || body.quantity <= 0) {
        throw new Error('Description, quantity > 0, and unit price > 0 are required');
      }
      const res = await fetch(`/api/backend/hospitality/folios/${folio.id}/charges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? `HTTP ${res.status}`));
      }
      setChargeModalOpen(false);
      setChargeForm({ chargeType: 'RESTAURANT', description: '', quantity: '1', unitPrice: '', taxAmount: '0', notes: '' });
      await load();
    } catch (err) {
      setChargeError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setChargeSaving(false);
    }
  };

  const closeWithoutSettling = async () => {
    if (!folio || folio.status !== 'OPEN') return;
    if (!confirm('Close the folio without creating a SalesOrder? No revenue will be booked. Use this only for comped or written-off stays.')) return;
    setCheckoutBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/backend/hospitality/folios/${folio.id}/checkout`, { method: 'PATCH' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Close failed');
    } finally {
      setCheckoutBusy(false);
    }
  };

  const submitSettle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folio) return;
    if (settleForm.paymentMethod !== 'CREDIT' && !settleForm.cashAccountId) {
      setSettleError('Pick a cash / bank account for non-CREDIT payments');
      return;
    }
    setSettleBusy(true);
    setSettleError('');
    try {
      const body: Record<string, unknown> = { paymentMethod: settleForm.paymentMethod };
      if (settleForm.cashAccountId) body.cashAccountId = settleForm.cashAccountId;
      if (settleForm.paymentReference) body.paymentReference = settleForm.paymentReference;
      const res = await fetch(`/api/backend/hospitality/folios/${folio.id}/settle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? `HTTP ${res.status}`));
      }
      setSettleModalOpen(false);
      setSettleForm({ paymentMethod: 'CASH', cashAccountId: '', paymentReference: '' });
      await load();
    } catch (err) {
      setSettleError(err instanceof Error ? err.message : 'Settle failed');
    } finally {
      setSettleBusy(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const chargesByType = useMemo(() => {
    if (!folio) return new Map<ChargeType, Charge[]>();
    const m = new Map<ChargeType, Charge[]>();
    for (const c of folio.charges) {
      const arr = m.get(c.chargeType) ?? [];
      arr.push(c);
      m.set(c.chargeType, arr);
    }
    return m;
  }, [folio]);

  if (loading) return <PageSpinner />;
  if (error && !folio) return <div className="p-6"><Card className="p-3 bg-red-50 border-red-200 text-red-700 text-sm">{error}</Card></div>;

  // No folio yet → offer to open one (rare, since check-in auto-opens)
  if (!folio) {
    return (
      <div className="p-6">
        <PageHeader title="Guest Folio" subtitle="No folio exists for this booking yet." breadcrumbs={[{ label: 'Hospitality', href: '/hospitality' }, { label: 'Bookings', href: '/hospitality/bookings' }, { label: 'Folio' }]} />
        <Card className="p-6 text-center space-y-3">
          <p className="text-sm text-slate-600">A folio is normally opened automatically when the guest is checked in. If the booking is still in RESERVED status, check the guest in first.</p>
          <Btn variant="primary" onClick={openFolio} loading={opening}>Open folio anyway</Btn>
        </Card>
      </div>
    );
  }

  const isClosed = folio.status !== 'OPEN';

  return (
    <div className="p-6 space-y-4 folio-page">
      <PageHeader
        title={`Folio · ${folio.folioNumber}`}
        subtitle={`${folio.guest.fullName} · Room ${folio.booking.room.roomCode} (${folio.booking.room.roomType})`}
        breadcrumbs={[{ label: 'Hospitality', href: '/hospitality' }, { label: 'Bookings', href: '/hospitality/bookings' }, { label: folio.folioNumber }]}
      />

      {error && <Card className="p-3 bg-red-50 border-red-200 text-red-700 text-sm">{error}</Card>}

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Status" value={folio.status} tone={folio.status === 'OPEN' ? 'good' : folio.status === 'CLOSED' ? undefined : 'warn'} />
        <Tile label="Charges" value={String(folio.charges.length)} hint={`opened ${new Date(folio.openedAt).toLocaleDateString('en-GB')}`} />
        <Tile label="Subtotal" value={`${folio.currency} ${fmt(folio.subtotal)}`} />
        <Tile label="Total" value={`${folio.currency} ${fmt(folio.totalAmount)}`} highlight />
      </div>

      {/* Booking strip */}
      <Card className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Detail label="Booking #" value={folio.booking.bookingNumber} />
        <Detail label="Check-in" value={folio.booking.actualCheckIn ? new Date(folio.booking.actualCheckIn).toLocaleString('en-GB') : '—'} />
        <Detail label="Check-out" value={folio.booking.actualCheckOut ? new Date(folio.booking.actualCheckOut).toLocaleString('en-GB') : 'Pending'} />
        <Detail label="Rate/night" value={`${folio.currency} ${fmt(folio.booking.ratePerNight)}`} />
        <Detail label="Guest" value={folio.guest.fullName} />
        <Detail label="Phone" value={folio.guest.phone ?? '—'} />
        <Detail label="Email" value={folio.guest.email ?? '—'} />
        <Detail label="Booking status" value={<StatusBadge status={folio.booking.status} />} />
      </Card>

      {/* Action row */}
      <div className="flex flex-wrap gap-2 items-center">
        {!isClosed && (
          <>
            <Btn variant="primary" onClick={() => { setChargeError(''); setChargeModalOpen(true); }}>+ Post Charge</Btn>
            <Btn variant="success" onClick={() => { setSettleError(''); setSettleModalOpen(true); }} disabled={folio.charges.length === 0}>
              Settle & Close
            </Btn>
            <Btn variant="ghost" size="sm" onClick={closeWithoutSettling} loading={checkoutBusy}>Close without billing</Btn>
          </>
        )}
        {isClosed && (
          <>
            <Btn variant="primary" onClick={() => window.print()}>Print Bill</Btn>
            {folio.settlementSalesOrderId && (
              <span className="text-xs text-slate-500">Settled via Sales Order <span className="font-mono">{folio.settlementSalesOrderId.slice(0, 8)}…</span></span>
            )}
          </>
        )}
      </div>

      {/* Charges grouped by type */}
      <Card className="overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Running tab</h3>
          <span className="text-xs text-slate-500">{folio.charges.length} charge{folio.charges.length === 1 ? '' : 's'}</span>
        </div>
        {folio.charges.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400 italic">No charges posted yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Type</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Description</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Posted</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Qty</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Unit</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Tax</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Amount</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(chargesByType.entries()).map(([type, charges]) => (
                <>
                  {charges.map((c, i) => (
                    <tr key={c.id} className="border-b border-slate-50">
                      {i === 0 && (
                        <td className={`px-3 py-2 align-top font-medium`} rowSpan={charges.length}>
                          <ChargeBadge type={type} />
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <div>{c.description}</div>
                        {c.notes && <div className="text-[11px] text-slate-500 italic">{c.notes}</div>}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{new Date(c.postedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(c.quantity)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(c.unitPrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmt(c.taxAmount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt(c.amount)}</td>
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 border-t border-slate-200">
              <tr>
                <td className="px-3 py-2 text-xs font-semibold" colSpan={5}>Subtotal</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(folio.taxAmount)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold">{fmt(folio.subtotal)}</td>
              </tr>
              <tr>
                <td className="px-3 py-2 text-xs font-bold" colSpan={6}>TOTAL</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold text-base">{folio.currency} {fmt(folio.totalAmount)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </Card>

      {isClosed && (
        <Card className="p-3 bg-emerald-50 border-emerald-200 text-emerald-800 text-sm">
          Closed {folio.closedAt && `at ${new Date(folio.closedAt).toLocaleString('en-GB')}`} {folio.closedBy?.fullName && `by ${folio.closedBy.fullName}`}.
        </Card>
      )}

      {/* Print bill (visible only when printing) */}
      <PrintableBill folio={folio} />

      <Modal
        open={settleModalOpen}
        onClose={() => setSettleModalOpen(false)}
        title="Settle folio"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setSettleModalOpen(false)}>Cancel</Btn>
            <Btn variant="success" type="submit" form="folio-settle-form" loading={settleBusy}>Settle TZS {fmt(folio.totalAmount)}</Btn>
          </>
        }
      >
        <form id="folio-settle-form" onSubmit={submitSettle} className="space-y-3">
          {settleError && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{settleError}</div>}
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm flex items-baseline justify-between">
            <span className="text-slate-600">Total to settle</span>
            <span className="font-bold tabular-nums text-base">{folio.currency} {fmt(folio.totalAmount)}</span>
          </div>
          <FormSelect
            label="Payment method"
            required
            value={settleForm.paymentMethod}
            onChange={(e) => setSettleForm(p => ({ ...p, paymentMethod: e.target.value, cashAccountId: e.target.value === 'CREDIT' ? '' : p.cashAccountId }))}
            options={PAYMENT_METHODS}
          />
          {settleForm.paymentMethod !== 'CREDIT' && (
            <FormSelect
              label="Cash / bank account"
              required
              value={settleForm.cashAccountId}
              onChange={(e) => setSettleForm(p => ({ ...p, cashAccountId: e.target.value }))}
              placeholder="Pick the account to credit"
              options={cashAccounts.map(a => ({ value: a.id, label: `${a.accountName} (${a.accountType})` }))}
            />
          )}
          {settleForm.paymentMethod !== 'CASH' && settleForm.paymentMethod !== 'CREDIT' && (
            <FormInput
              label="Payment reference (optional)"
              value={settleForm.paymentReference}
              onChange={(e) => setSettleForm(p => ({ ...p, paymentReference: e.target.value }))}
              placeholder="M-Pesa code, card slip #, etc."
            />
          )}
          {settleForm.paymentMethod === 'CREDIT' && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Credit will create an OPEN receivable against the guest&apos;s customer record. Walk-in guests need a customer linked to settle on credit.
            </p>
          )}
          <p className="text-[11px] text-slate-500">
            On submit: a SalesOrder is created (one line per folio charge) and confirmed. Non-CREDIT payments instantly credit the chosen cash account; CREDIT creates a Receivable. The folio is then closed.
          </p>
        </form>
      </Modal>

      <Modal
        open={chargeModalOpen}
        onClose={() => setChargeModalOpen(false)}
        title="Post charge to folio"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setChargeModalOpen(false)}>Cancel</Btn>
            <Btn variant="primary" type="submit" form="folio-charge-form" loading={chargeSaving}>Post charge</Btn>
          </>
        }
      >
        <form id="folio-charge-form" onSubmit={submitCharge} className="space-y-3">
          {chargeError && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{chargeError}</div>}
          <FormSelect label="Type" required value={chargeForm.chargeType} onChange={(e) => setChargeForm(p => ({ ...p, chargeType: e.target.value as ChargeType }))} options={CHARGE_TYPES} />
          <FormInput label="Description" required value={chargeForm.description} onChange={(e) => setChargeForm(p => ({ ...p, description: e.target.value }))} placeholder="Dinner, two beers, laundry…" />
          <div className="grid grid-cols-3 gap-2">
            <FormInput label="Qty" required type="number" value={chargeForm.quantity} onChange={(e) => setChargeForm(p => ({ ...p, quantity: e.target.value }))} />
            <FormInput label="Unit price" required type="number" value={chargeForm.unitPrice} onChange={(e) => setChargeForm(p => ({ ...p, unitPrice: e.target.value }))} />
            <FormInput label="Tax" type="number" value={chargeForm.taxAmount} onChange={(e) => setChargeForm(p => ({ ...p, taxAmount: e.target.value }))} />
          </div>
          <FormInput label="Notes (optional)" value={chargeForm.notes} onChange={(e) => setChargeForm(p => ({ ...p, notes: e.target.value }))} />
        </form>
      </Modal>

      <style jsx global>{`
        @media print {
          body * { visibility: hidden !important; }
          .folio-bill, .folio-bill * { visibility: visible !important; }
          .folio-bill {
            position: absolute !important;
            left: 0; top: 0;
            width: 100%;
            padding: 24px;
            background: white;
            color: black;
            font-family: 'Times New Roman', serif;
          }
        }
      `}</style>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function Tile({ label, value, hint, tone, highlight }: { label: string; value: string; hint?: string; tone?: 'good' | 'warn' | 'danger'; highlight?: boolean }) {
  const cls =
    tone === 'danger' ? 'bg-red-50 border-red-200' :
    tone === 'warn' ? 'bg-amber-50 border-amber-200' :
    tone === 'good' ? 'bg-emerald-50 border-emerald-200' :
    highlight ? 'bg-slate-900 text-white' : '';
  return (
    <Card className={`p-3 ${cls}`}>
      <div className={`text-[11px] uppercase tracking-wide ${highlight ? 'text-slate-300' : 'text-slate-500'}`}>{label}</div>
      <div className={`text-xl font-bold mt-1 ${highlight ? 'text-white' : ''}`}>{value}</div>
      {hint && <div className={`text-[11px] mt-0.5 ${highlight ? 'text-slate-300' : 'text-slate-500'}`}>{hint}</div>}
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

const CHARGE_BADGE_COLORS: Record<ChargeType, string> = {
  ROOM: 'bg-indigo-100 text-indigo-700',
  RESTAURANT: 'bg-amber-100 text-amber-700',
  BAR: 'bg-rose-100 text-rose-700',
  LAUNDRY: 'bg-cyan-100 text-cyan-700',
  TELEPHONE: 'bg-sky-100 text-sky-700',
  MINIBAR: 'bg-fuchsia-100 text-fuchsia-700',
  OTHER: 'bg-slate-100 text-slate-700',
};

function ChargeBadge({ type }: { type: ChargeType }) {
  return (
    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${CHARGE_BADGE_COLORS[type]}`}>{type}</span>
  );
}

function PrintableBill({ folio }: { folio: Folio }) {
  return (
    <div className="folio-bill" aria-hidden="true">
      <div className="text-center mb-4">
        <div className="text-lg font-bold uppercase">Folio · {folio.folioNumber}</div>
        <div className="text-xs">{new Date(folio.openedAt).toLocaleDateString('en-GB')} — {folio.closedAt ? new Date(folio.closedAt).toLocaleDateString('en-GB') : 'open'}</div>
      </div>
      <div className="border-t border-b border-slate-300 py-2 my-2 text-xs">
        <div className="flex justify-between"><span>Guest</span><span>{folio.guest.fullName}</span></div>
        <div className="flex justify-between"><span>Room</span><span>{folio.booking.room.roomCode} ({folio.booking.room.roomType})</span></div>
        <div className="flex justify-between"><span>Booking</span><span className="font-mono">{folio.booking.bookingNumber}</span></div>
        {folio.booking.actualCheckIn && <div className="flex justify-between"><span>Checked in</span><span>{new Date(folio.booking.actualCheckIn).toLocaleString('en-GB')}</span></div>}
        {folio.booking.actualCheckOut && <div className="flex justify-between"><span>Checked out</span><span>{new Date(folio.booking.actualCheckOut).toLocaleString('en-GB')}</span></div>}
      </div>
      <table className="w-full text-xs my-3">
        <thead>
          <tr className="border-b border-slate-300">
            <th className="text-left pb-1">Date</th>
            <th className="text-left pb-1">Type</th>
            <th className="text-left pb-1">Description</th>
            <th className="text-right pb-1">Qty</th>
            <th className="text-right pb-1">Unit</th>
            <th className="text-right pb-1">Amount</th>
          </tr>
        </thead>
        <tbody>
          {folio.charges.map(c => (
            <tr key={c.id}>
              <td className="py-0.5">{new Date(c.postedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</td>
              <td className="py-0.5">{c.chargeType}</td>
              <td className="py-0.5">{c.description}</td>
              <td className="py-0.5 text-right">{Number(c.quantity)}</td>
              <td className="py-0.5 text-right">{fmt(c.unitPrice)}</td>
              <td className="py-0.5 text-right tabular-nums">{fmt(c.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-slate-300 pt-2 mt-2 space-y-1 text-xs">
        <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{folio.currency} {fmt(folio.subtotal)}</span></div>
        {Number(folio.taxAmount) > 0 && <div className="flex justify-between"><span>Tax</span><span className="tabular-nums">{folio.currency} {fmt(folio.taxAmount)}</span></div>}
        <div className="flex justify-between text-base font-bold pt-1 border-t border-slate-300"><span>TOTAL DUE</span><span className="tabular-nums">{folio.currency} {fmt(folio.totalAmount)}</span></div>
      </div>
      <div className="text-center text-xs mt-6">Thank you for staying with us.</div>
    </div>
  );
}
