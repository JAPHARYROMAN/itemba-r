'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, StatCard, StatusBadge, PageSpinner } from '@/components/ui';

const fmtCurrency = (n: number) => `TZS ${new Intl.NumberFormat('en-US').format(n)}`;
const fmtDate = (s: string) => s ? new Date(s).toLocaleDateString('en-GB') : '—';

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

interface Company { id: string; name: string; code: string; }

const quickLinks = [
  { href: '/hospitality/facilities', label: '🏨 Facilities', desc: 'Hotels, restaurants & venues' },
  { href: '/hospitality/rooms', label: '🛏 Rooms', desc: 'Room inventory & status' },
  { href: '/hospitality/guests', label: '👤 Guests', desc: 'Guest profiles & records' },
  { href: '/hospitality/bookings', label: '📋 Bookings', desc: 'Front desk management' },
  { href: '/hospitality/tables', label: '🍽 Tables', desc: 'Restaurant table management' },
  { href: '/hospitality/orders', label: '🧾 Orders', desc: 'Restaurant & bar orders' },
  { href: '/hospitality/menu-categories', label: '📂 Menu Categories', desc: 'Food & drink categories' },
  { href: '/hospitality/menu-items', label: '🍕 Menu Items', desc: 'Menu items & pricing' },
  { href: '/hospitality/housekeeping', label: '🧹 Housekeeping', desc: 'Cleaning & maintenance tasks' },
  { href: '/hospitality/payments', label: '💳 Payments', desc: 'All hospitality payments' },
  { href: '/hospitality/reports', label: '📊 Reports', desc: 'Analytics & reporting' },
];

export default function HospitalityDashboardPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [rooms, setRooms] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [guests, setGuests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j =>
      setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const [roomsRes, bkRes, guestsRes] = await Promise.all([
        fetch(`/api/backend/rooms?companyId=${companyId}&limit=200`),
        fetch(`/api/backend/room-bookings?companyId=${companyId}&limit=100`),
        fetch(`/api/backend/guests?companyId=${companyId}&limit=200`),
      ]);
      const [roomsJson, bkJson, guestsJson] = await Promise.all([roomsRes.json(), bkRes.json(), guestsRes.json()]);
      setRooms(Array.isArray(roomsJson.data?.data) ? roomsJson.data.data : []);
      setBookings(Array.isArray(bkJson.data?.data) ? bkJson.data.data : []);
      setGuests(Array.isArray(guestsJson.data?.data) ? guestsJson.data.data : []);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error loading data'); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const totalRooms = rooms.length;
  const availableRooms = rooms.filter(r => r.status === 'AVAILABLE').length;
  const occupiedRooms = rooms.filter(r => r.status === 'OCCUPIED').length;
  const activeBookings = bookings.filter(b => b.status === 'CHECKED_IN');
  const todayRevenue = activeBookings.reduce((sum, b) => sum + (b.ratePerNight ?? 0), 0);
  const totalGuests = guests.length;

  const roomsByType = rooms.reduce<Record<string, { total: number; available: number }>>((acc, r) => {
    const t = r.roomType ?? 'OTHER';
    if (!acc[t]) acc[t] = { total: 0, available: 0 };
    acc[t].total++;
    if (r.status === 'AVAILABLE') acc[t].available++;
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Hospitality Dashboard" subtitle="Hotel, Restaurant & Bar Operations" />
        <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
          <option value="">— Select Company —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <PageSpinner />}

      {companyId && !loading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard label="Total Rooms" value={totalRooms} variant="default" />
            <StatCard label="Available" value={availableRooms} variant="green" />
            <StatCard label="Occupied" value={occupiedRooms} variant="blue" />
            <StatCard label="Active Bookings" value={activeBookings.length} variant="default" />
            <StatCard label="Today's Revenue" value={fmtCurrency(todayRevenue)} variant="green" />
            <StatCard label="Total Guests" value={totalGuests} variant="default" />
          </div>

          {activeBookings.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <span className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>Currently Checked In</span>
                <Link href="/hospitality/bookings" className="text-xs text-indigo-600 hover:underline">Manage bookings →</Link>
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
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Rate/Night</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeBookings.slice(0, 10).map((b: any) => (
                      <tr key={b.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{b.bookingNumber}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{b.guest?.fullName ?? '—'}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{b.room?.roomNumber ?? '—'}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(b.expectedCheckIn)}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(b.expectedCheckOut)}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{b.ratePerNight ? fmtCurrency(b.ratePerNight) : '—'}</td>
                        <td className={tdCls}><StatusBadge status={b.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {Object.keys(roomsByType).length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>Room Availability by Type</div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Room Type</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Total</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Available</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Occupied/Other</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(roomsByType).map(([type, counts]) => (
                      <tr key={type} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{type.replace(/_/g, ' ')}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{counts.total}</td>
                        <td className={tdCls}><span className="text-emerald-600 font-semibold">{counts.available}</span></td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{counts.total - counts.available}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      <div>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--aurora-text)' }}>Quick Navigation</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {quickLinks.map(l => (
            <Link key={l.href} href={l.href}>
              <Card className="p-4 hover:shadow-md transition-all cursor-pointer">
                <div className="font-semibold text-sm" style={{ color: 'var(--aurora-text)' }}>{l.label}</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>{l.desc}</div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
