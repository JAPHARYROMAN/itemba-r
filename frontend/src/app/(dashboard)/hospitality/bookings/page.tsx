'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

const BOOKING_SOURCES = ['WALK_IN', 'PHONE', 'ONLINE', 'COMPANY', 'AGENT', 'OTHER'];
const fmtCurrency = (n: number | string | null | undefined) => { const value = Number(n ?? 0); return `TZS ${new Intl.NumberFormat('en-US').format(Number.isFinite(value) ? value : 0)}`; };
const fmtDate = (s: string) => s ? new Date(s).toLocaleDateString('en-GB') : '—';
const fmtDateTime = (s: string) => s ? new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

interface Company { id: string; name: string; }
interface Facility { id: string; facilityName: string; }
interface Room { id: string; roomNumber: string; roomType: string; defaultRate: number; currency: string; status: string; }
interface Guest { id: string; fullName: string; guestCode: string; }

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function BookingsPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityFilter, setFacilityFilter] = useState('');
  const [checkedIn, setCheckedIn] = useState<any[]>([]);
  const [reserved, setReserved] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ bookingNumber: '', hospitalityFacilityId: '', roomId: '', guestId: '', bookingDate: new Date().toISOString().split('T')[0], expectedCheckIn: '', expectedCheckOut: '', ratePerNight: '', currency: 'TZS', bookingSource: 'WALK_IN', notes: '' });
  const [modalRooms, setModalRooms] = useState<Room[]>([]);
  const [modalGuests, setModalGuests] = useState<Guest[]>([]);
  const [saving, setSaving] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [viewBooking, setViewBooking] = useState<any | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j =>
      setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (!companyId) { setFacilities([]); return; }
    fetch(`/api/backend/hospitality-facilities?companyId=${companyId}&limit=100`).then(r => r.json()).then(j =>
      setFacilities(Array.isArray(j.data?.data) ? j.data.data : []));
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ companyId, limit: '200' });
      if (facilityFilter) qs.set('hospitalityFacilityId', facilityFilter);
      const res = await fetch(`/api/backend/room-bookings?${qs}`);
      if (!res.ok) throw new Error('Failed to load bookings');
      const json = await res.json();
      const all: any[] = Array.isArray(json.data?.data) ? json.data.data : [];
      setCheckedIn(all.filter(b => b.status === 'CHECKED_IN'));
      setReserved(all.filter(b => b.status === 'RESERVED'));
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId, facilityFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!companyId || !form.hospitalityFacilityId) { setModalRooms([]); return; }
    fetch(`/api/backend/rooms?companyId=${companyId}&hospitalityFacilityId=${form.hospitalityFacilityId}&limit=100`).then(r => r.json()).then(j =>
      setModalRooms(Array.isArray(j.data?.data) ? j.data.data : []));
  }, [companyId, form.hospitalityFacilityId]);

  useEffect(() => {
    if (!companyId) { setModalGuests([]); return; }
    fetch(`/api/backend/guests?companyId=${companyId}&limit=200`).then(r => r.json()).then(j =>
      setModalGuests(Array.isArray(j.data?.data) ? j.data.data : []));
  }, [companyId]);

  const handleRoomChange = (roomId: string) => {
    const room = modalRooms.find(r => r.id === roomId);
    setForm(f => ({ ...f, roomId, ratePerNight: room?.defaultRate?.toString() ?? f.ratePerNight, currency: room?.currency ?? f.currency }));
  };

  const nights = form.expectedCheckIn && form.expectedCheckOut
    ? Math.max(0, Math.ceil((new Date(form.expectedCheckOut).getTime() - new Date(form.expectedCheckIn).getTime()) / 86400000))
    : 0;
  const totalAmount = nights * (parseFloat(form.ratePerNight) || 0);

  const save = async () => {
    if (!user?.id) return;
    setSaving(true); setError('');
    try {
      const body: any = { ...form, companyId, createdById: user.id, ratePerNight: parseFloat(form.ratePerNight) || 0, nights, totalAmount, subtotal: totalAmount };
      if (!body.bookingSource) delete body.bookingSource;
      const res = await fetch('/api/backend/room-bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(Array.isArray(j.message) ? j.message.join(', ') : j.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setSaving(false); }
  };

  const checkIn = async (id: string) => {
    setActionError('');
    try {
      const res = await fetch(`/api/backend/room-bookings/${id}/check-in`, { method: 'PATCH' });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message ?? 'Check-in failed'); }
      load();
    } catch (err: unknown) { setActionError(err instanceof Error ? err.message : 'Error'); }
  };

  const checkOut = async (id: string) => {
    setActionError('');
    try {
      const res = await fetch(`/api/backend/room-bookings/${id}/check-out`, { method: 'PATCH' });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message ?? 'Check-out failed'); }
      load();
    } catch (err: unknown) { setActionError(err instanceof Error ? err.message : 'Error'); }
  };

  const doCancel = async () => {
    if (!cancelTarget) return;
    setActionError('');
    try {
      const res = await fetch(`/api/backend/room-bookings/${cancelTarget}/cancel`, { method: 'PATCH' });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message ?? 'Cancel failed'); }
      setCancelTarget(null); load();
    } catch (err: unknown) { setActionError(err instanceof Error ? err.message : 'Error'); }
  };

  const sf = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <PageHeader title="Front Desk — Room Bookings" subtitle="Check in, check out and manage reservations" />
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
          {companyId && <Btn variant="primary" onClick={() => { setForm({ bookingNumber: '', hospitalityFacilityId: '', roomId: '', guestId: '', bookingDate: new Date().toISOString().split('T')[0], expectedCheckIn: '', expectedCheckOut: '', ratePerNight: '', currency: 'TZS', bookingSource: 'WALK_IN', notes: '' }); setShowModal(true); }}>+ New Booking</Btn>}
        </div>
      </div>

      {!companyId && <div className="text-center py-12 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to begin.</div>}
      {(error || actionError) && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error || actionError}</div>}
      {companyId && loading && <PageSpinner />}

      {companyId && !loading && (
        <>
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <span className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>Currently Checked In</span>
              <span className="ml-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">{checkedIn.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Booking #</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Guest</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Room</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Check-In</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Expected Out</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Nights</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Rate/Night</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Total</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Payment</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {checkedIn.length === 0 ? (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No guests currently checked in.</td></tr>
                  ) : checkedIn.map(b => (
                    <tr key={b.id} className="border-b border-slate-50 hover:bg-blue-50/30">
                      <td className={`${tdCls} font-mono font-semibold`} style={{ color: 'var(--aurora-text)' }}>{b.bookingNumber}</td>
                      <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{b.guest?.fullName ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{b.room?.roomNumber ?? '—'} <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>({b.room?.roomType ?? ''})</span></td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDateTime(b.actualCheckIn ?? b.expectedCheckIn)}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(b.expectedCheckOut)}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{b.nights ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{b.ratePerNight ? fmtCurrency(b.ratePerNight) : '—'}</td>
                      <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{b.totalAmount ? fmtCurrency(b.totalAmount) : '—'}</td>
                      <td className={tdCls}><StatusBadge status={b.paymentStatus ?? 'UNPAID'} /></td>
                      <td className={tdCls}>
                        <div className="flex gap-1">
                          <Link href={`/hospitality/folio/${b.id}`}>
                            <Btn size="sm" variant="primary">Folio</Btn>
                          </Link>
                          <Btn size="sm" variant="danger" onClick={() => checkOut(b.id)}>Check Out</Btn>
                          <Btn size="sm" variant="secondary" onClick={() => setViewBooking(b)}>Details</Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-purple-500" />
              <span className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>Upcoming Reservations</span>
              <span className="ml-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-xs font-semibold">{reserved.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Booking #</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Guest</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Room</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Expected Check-In</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Expected Check-Out</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Nights</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Rate/Night</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Source</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {reserved.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No upcoming reservations.</td></tr>
                  ) : reserved.map(b => (
                    <tr key={b.id} className="border-b border-slate-50 hover:bg-purple-50/30">
                      <td className={`${tdCls} font-mono font-semibold`} style={{ color: 'var(--aurora-text)' }}>{b.bookingNumber}</td>
                      <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{b.guest?.fullName ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{b.room?.roomNumber ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(b.expectedCheckIn)}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(b.expectedCheckOut)}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{b.nights ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{b.ratePerNight ? fmtCurrency(b.ratePerNight) : '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{b.bookingSource?.replace(/_/g, ' ') ?? '—'}</td>
                      <td className={tdCls}>
                        <div className="flex gap-1">
                          <Btn size="sm" variant="success" onClick={() => checkIn(b.id)}>Check In</Btn>
                          <Btn size="sm" variant="danger" onClick={() => setCancelTarget(b.id)}>Cancel</Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Room Booking" size="xl"
        footer={<><Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn><Btn variant="primary" loading={saving} onClick={save}>Create Booking</Btn></>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormInput label="Booking Number *" value={form.bookingNumber} onChange={sf('bookingNumber')} placeholder="e.g. BK-001" />
            <FormInput label="Booking Date *" type="date" value={form.bookingDate} onChange={sf('bookingDate')} />
          </div>
          <FormSelect label="Facility *" value={form.hospitalityFacilityId} onChange={e => setForm(f => ({ ...f, hospitalityFacilityId: e.target.value, roomId: '', ratePerNight: '' }))}>
            <option value="">— Select Facility —</option>
            {facilities.map(f => <option key={f.id} value={f.id}>{f.facilityName}</option>)}
          </FormSelect>
          <FormSelect label="Room *" value={form.roomId} onChange={e => handleRoomChange(e.target.value)}>
            <option value="">— Select Room —</option>
            {modalRooms.map(r => <option key={r.id} value={r.id}>{r.roomNumber} — {r.roomType} ({r.status})</option>)}
          </FormSelect>
          <FormSelect label="Guest *" value={form.guestId} onChange={sf('guestId')}>
            <option value="">— Select Guest —</option>
            {modalGuests.map(g => <option key={g.id} value={g.id}>{g.fullName} ({g.guestCode})</option>)}
          </FormSelect>
          <div className="grid grid-cols-2 gap-4">
            <FormInput label="Expected Check-In *" type="date" value={form.expectedCheckIn} onChange={sf('expectedCheckIn')} />
            <FormInput label="Expected Check-Out *" type="date" value={form.expectedCheckOut} onChange={sf('expectedCheckOut')} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <FormInput label="Rate per Night *" type="number" value={form.ratePerNight} onChange={sf('ratePerNight')} placeholder="0" />
            <FormInput label="Currency" value={form.currency} onChange={sf('currency')} />
            <FormSelect label="Booking Source" value={form.bookingSource} onChange={sf('bookingSource')}>
              {BOOKING_SOURCES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </FormSelect>
          </div>
          {(nights > 0 || totalAmount > 0) && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 flex gap-6">
              <div><div className="text-xs text-indigo-500 font-medium">Nights</div><div className="text-lg font-bold text-indigo-800">{nights}</div></div>
              <div><div className="text-xs text-indigo-500 font-medium">Total Amount</div><div className="text-lg font-bold text-indigo-800">{fmtCurrency(totalAmount)}</div></div>
            </div>
          )}
          <FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={2} />
        </div>
      </Modal>

      <Modal open={!!viewBooking} onClose={() => setViewBooking(null)} title={`Booking Details — ${viewBooking?.bookingNumber ?? ''}`} size="lg"
        footer={<Btn variant="secondary" onClick={() => setViewBooking(null)}>Close</Btn>}
      >
        {viewBooking && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span style={{ color: 'var(--aurora-text-muted)' }}>Guest:</span> <span className="font-medium" style={{ color: 'var(--aurora-text)' }}>{viewBooking.guest?.fullName ?? '—'}</span></div>
            <div><span style={{ color: 'var(--aurora-text-muted)' }}>Room:</span> <span className="font-medium" style={{ color: 'var(--aurora-text)' }}>{viewBooking.room?.roomNumber ?? '—'}</span></div>
            <div><span style={{ color: 'var(--aurora-text-muted)' }}>Check-In:</span> <span className="font-medium" style={{ color: 'var(--aurora-text)' }}>{fmtDate(viewBooking.expectedCheckIn)}</span></div>
            <div><span style={{ color: 'var(--aurora-text-muted)' }}>Check-Out:</span> <span className="font-medium" style={{ color: 'var(--aurora-text)' }}>{fmtDate(viewBooking.expectedCheckOut)}</span></div>
            <div><span style={{ color: 'var(--aurora-text-muted)' }}>Nights:</span> <span className="font-medium" style={{ color: 'var(--aurora-text)' }}>{viewBooking.nights ?? '—'}</span></div>
            <div><span style={{ color: 'var(--aurora-text-muted)' }}>Rate/Night:</span> <span className="font-medium" style={{ color: 'var(--aurora-text)' }}>{viewBooking.ratePerNight ? fmtCurrency(viewBooking.ratePerNight) : '—'}</span></div>
            <div><span style={{ color: 'var(--aurora-text-muted)' }}>Total:</span> <span className="font-bold" style={{ color: 'var(--aurora-text)' }}>{viewBooking.totalAmount ? fmtCurrency(viewBooking.totalAmount) : '—'}</span></div>
            <div><span style={{ color: 'var(--aurora-text-muted)' }}>Paid:</span> <span className="font-medium text-emerald-700">{viewBooking.paidAmount ? fmtCurrency(viewBooking.paidAmount) : '—'}</span></div>
            <div><span style={{ color: 'var(--aurora-text-muted)' }}>Outstanding:</span> <span className="font-medium text-red-600">{viewBooking.outstandingAmount ? fmtCurrency(viewBooking.outstandingAmount) : '—'}</span></div>
            <div><span style={{ color: 'var(--aurora-text-muted)' }}>Payment:</span> <StatusBadge status={viewBooking.paymentStatus ?? 'UNPAID'} /></div>
            <div><span style={{ color: 'var(--aurora-text-muted)' }}>Status:</span> <StatusBadge status={viewBooking.status} /></div>
            <div><span style={{ color: 'var(--aurora-text-muted)' }}>Source:</span> <span style={{ color: 'var(--aurora-text)' }}>{viewBooking.bookingSource?.replace(/_/g, ' ') ?? '—'}</span></div>
            {viewBooking.notes && <div className="col-span-2"><span style={{ color: 'var(--aurora-text-muted)' }}>Notes:</span> <span style={{ color: 'var(--aurora-text)' }}>{viewBooking.notes}</span></div>}
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!cancelTarget} onClose={() => setCancelTarget(null)} title="Cancel Booking?" message="Cancel this booking? This cannot be undone." variant="danger" onConfirm={doCancel} />
    </div>
  );
}
