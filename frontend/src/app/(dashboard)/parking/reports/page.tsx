'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatCard, PageSpinner } from '@/components/ui';

function fmtCurrency(n: number) { return `TZS ${new Intl.NumberFormat('en-US').format(n)}`; }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
function toDateStr(d: Date) { return d.toISOString().slice(0, 10); }
const subDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() - n); return r; };

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function ParkingReportsPage() {
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [dateFrom, setDateFrom] = useState(toDateStr(subDays(new Date(), 30)));
  const [dateTo, setDateTo] = useState(toDateStr(new Date()));
  const [sessions, setSessions] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => {
      const list = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
      setCompanies(list);
      if (list.length > 0) setCompanyId(list[0].id);
    });
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const [sesRes, payRes] = await Promise.all([
        fetch(`/api/backend/parking-sessions?companyId=${companyId}&page=1&limit=200`),
        fetch(`/api/backend/parking-payments?companyId=${companyId}&page=1&limit=200`),
      ]);
      const [sesJson, payJson] = await Promise.all([sesRes.json(), payRes.json()]);
      setSessions(sesJson.data?.data ?? []);
      setPayments(payJson.data?.data ?? []);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const from = new Date(dateFrom + 'T00:00:00');
  const to = new Date(dateTo + 'T23:59:59');

  const filteredSessions = sessions.filter(s => {
    const d = s.entryTime ? new Date(s.entryTime) : null;
    return d && d >= from && d <= to;
  });
  const filteredPayments = payments.filter(p => {
    const d = p.paymentDate ? new Date(p.paymentDate) : null;
    return d && d >= from && d <= to;
  });

  const totalRevenue = filteredPayments.reduce((acc, p) => acc + (p.amount ?? 0), 0);
  const activeSessions = filteredSessions.filter(s => s.status === 'ACTIVE').length;
  const completedSessions = filteredSessions.filter(s => s.status === 'COMPLETED').length;

  const byDate: Record<string, { sessions: number; revenue: number }> = {};
  filteredSessions.forEach(s => {
    const key = s.entryTime ? s.entryTime.slice(0, 10) : 'unknown';
    if (!byDate[key]) byDate[key] = { sessions: 0, revenue: 0 };
    byDate[key].sessions++;
  });
  filteredPayments.forEach(p => {
    const key = p.paymentDate ? p.paymentDate.slice(0, 10) : 'unknown';
    if (!byDate[key]) byDate[key] = { sessions: 0, revenue: 0 };
    byDate[key].revenue += p.amount ?? 0;
  });
  const dateRows = Object.entries(byDate).sort(([a], [b]) => b.localeCompare(a)).slice(0, 30);

  const byFacility: Record<string, { name: string; sessions: number; revenue: number }> = {};
  filteredSessions.forEach(s => {
    const key = s.facilityId ?? 'unknown';
    const name = s.parkingFacility?.facilityName ?? s.facility?.facilityName ?? s.facilityId ?? 'Unknown';
    if (!byFacility[key]) byFacility[key] = { name, sessions: 0, revenue: 0 };
    byFacility[key].sessions++;
  });
  filteredPayments.forEach(p => {
    const s = sessions.find(ss => ss.id === (p.parkingSessionId ?? p.sessionId));
    const key = s?.facilityId ?? 'unknown';
    if (byFacility[key]) byFacility[key].revenue += p.amount ?? 0;
  });
  const facilityRows = Object.values(byFacility).sort((a, b) => b.revenue - a.revenue);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Parking Reports" subtitle="Session analytics and revenue summaries" />
        <div className="flex items-center gap-3 flex-wrap">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>From</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>To</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
        </div>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to view reports.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}

      {companyId && !loading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Sessions" value={filteredSessions.length} variant="blue" />
            <StatCard label="Active Sessions" value={activeSessions} variant="green" />
            <StatCard label="Completed Sessions" value={completedSessions} variant="default" />
            <StatCard label="Total Revenue" value={fmtCurrency(totalRevenue)} variant="purple" />
          </div>

          {facilityRows.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>Revenue by Facility</div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Facility</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Sessions</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facilityRows.map((row, i) => (
                      <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.name}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.sessions}</td>
                        <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{fmtCurrency(row.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>Daily Breakdown</div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Date</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Sessions</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {dateRows.length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No data in selected range.</td></tr>
                  ) : dateRows.map(([date, row]) => (
                    <tr key={date} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{fmtDate(date)}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.sessions}</td>
                      <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{fmtCurrency(row.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {filteredPayments.length > 0 && (() => {
            const byMethod: Record<string, number> = {};
            filteredPayments.forEach(p => { byMethod[p.paymentMethod ?? 'OTHER'] = (byMethod[p.paymentMethod ?? 'OTHER'] ?? 0) + (p.amount ?? 0); });
            return (
              <Card className="overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>Revenue by Payment Method</div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Method</th>
                        <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(byMethod).sort(([, a], [, b]) => b - a).map(([method, revenue]) => (
                        <tr key={method} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{method.replace(/_/g, ' ')}</td>
                          <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{fmtCurrency(revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })()}
        </>
      )}
    </div>
  );
}
