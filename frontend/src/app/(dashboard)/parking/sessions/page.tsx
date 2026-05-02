'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'BANK_CARD', 'CREDIT', 'OTHER'];

function fmtCurrency(n: number) { return `TZS ${new Intl.NumberFormat('en-US').format(n)}`; }
function fmtDateTime(d: string) { return d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
function fmtDuration(entryTime: string) {
  const mins = Math.round((Date.now() - new Date(entryTime).getTime()) / 60000);
  if (mins < 0) return '—';
  const h = Math.floor(mins / 60); const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function nowDatetimeLocal() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function genSessionNumber() { const d = new Date(); return `PS-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(Math.floor(Math.random() * 9000) + 1000)}`; }
function genPaymentNumber() { const d = new Date(); return `PP-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(Math.floor(Math.random() * 9000) + 1000)}`; }

interface Facility { id: string; facilityName: string; facilityCode: string; }
interface Zone { id: string; zoneName: string; zoneCode: string; }
interface Rate { id: string; rateName: string; rateCode: string; amount: number; currency: string; }

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function ParkingSessionsPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState('');
  const [zones, setZones] = useState<Zone[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [completedSessions, setCompletedSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [entryOpen, setEntryOpen] = useState(false);
  const [entryForm, setEntryForm] = useState({ sessionNumber: genSessionNumber(), truckNumber: '', trailerNumber: '', driverName: '', driverPhone: '', companyName: '', zoneId: '', rateId: '', currency: 'TZS', entryTime: nowDatetimeLocal(), notes: '' });

  const [closeTarget, setCloseTarget] = useState<any>(null);
  const [closingSessions, setClosingSessions] = useState<Set<string>>(new Set());

  const [paySession, setPaySession] = useState<any>(null);
  const [payForm, setPayForm] = useState({ paymentNumber: genPaymentNumber(), paymentDate: todayStr(), amount: '', currency: 'TZS', paymentMethod: 'CASH', notes: '' });

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => {
      const list = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
      setCompanies(list);
      if (list.length > 0) setCompanyId(list[0].id);
    });
  }, []);

  useEffect(() => {
    if (!companyId) return;
    setFacilityId('');
    fetch(`/api/backend/parking-facilities?companyId=${companyId}&limit=100`).then(r => r.json()).then(j =>
      setFacilities(Array.isArray(j.data?.data) ? j.data.data : []));
  }, [companyId]);

  useEffect(() => {
    if (!facilityId) { setZones([]); setRates([]); return; }
    Promise.all([
      fetch(`/api/backend/parking-zones?facilityId=${facilityId}&limit=100`).then(r => r.json()),
      fetch(`/api/backend/parking-rates?facilityId=${facilityId}&status=ACTIVE&limit=100`).then(r => r.json()),
    ]).then(([zj, rj]) => {
      setZones(Array.isArray(zj.data?.data) ? zj.data.data : []);
      setRates(Array.isArray(rj.data?.data) ? rj.data.data : []);
    });
  }, [facilityId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const fq = facilityId ? `&facilityId=${facilityId}` : '';
      const [actRes, compRes] = await Promise.all([
        fetch(`/api/backend/parking-sessions?companyId=${companyId}${fq}&status=ACTIVE&page=1&limit=50`),
        fetch(`/api/backend/parking-sessions?companyId=${companyId}${fq}&status=COMPLETED&page=1&limit=20`),
      ]);
      const [actJson, compJson] = await Promise.all([actRes.json(), compRes.json()]);
      setActiveSessions(actJson.data?.data ?? []);
      setCompletedSessions(compJson.data?.data ?? []);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId, facilityId]);

  useEffect(() => { load(); }, [load]);

  function openEntry() { setEntryForm({ sessionNumber: genSessionNumber(), truckNumber: '', trailerNumber: '', driverName: '', driverPhone: '', companyName: '', zoneId: '', rateId: '', currency: 'TZS', entryTime: nowDatetimeLocal(), notes: '' }); setEntryOpen(true); setError(''); }

  async function handleCreateSession() {
    if (!entryForm.truckNumber) { setError('Truck number is required.'); return; }
    if (!facilityId) { setError('Select a facility first.'); return; }
    setSaving(true); setError('');
    try {
      const body: any = { sessionNumber: entryForm.sessionNumber, companyId, facilityId, truckNumber: entryForm.truckNumber, currency: entryForm.currency, createdById: user?.id, trailerNumber: entryForm.trailerNumber || undefined, driverName: entryForm.driverName || undefined, driverPhone: entryForm.driverPhone || undefined, companyName: entryForm.companyName || undefined, zoneId: entryForm.zoneId || undefined, rateId: entryForm.rateId || undefined, entryTime: entryForm.entryTime ? new Date(entryForm.entryTime).toISOString() : undefined, notes: entryForm.notes || undefined };
      const res = await fetch('/api/backend/parking-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(Array.isArray(j.message) ? j.message.join(', ') : j.message ?? 'Create failed'); }
      setEntryOpen(false); load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Create failed'); }
    finally { setSaving(false); }
  }

  async function handleCloseSession() {
    if (!closeTarget) return;
    setClosingSessions(prev => new Set(prev).add(closeTarget.id));
    try {
      const res = await fetch(`/api/backend/parking-sessions/${closeTarget.id}/close`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message ?? 'Close failed'); }
      setCloseTarget(null); load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Close failed'); }
    finally { setClosingSessions(prev => { const next = new Set(prev); next.delete(closeTarget?.id); return next; }); }
  }

  function openPayment(session: any) { setPaySession(session); setPayForm({ paymentNumber: genPaymentNumber(), paymentDate: todayStr(), amount: '', currency: session.currency ?? 'TZS', paymentMethod: 'CASH', notes: '' }); setError(''); }

  async function handleRecordPayment() {
    if (!payForm.amount) { setError('Amount is required.'); return; }
    setSaving(true); setError('');
    try {
      const body: any = { paymentNumber: payForm.paymentNumber, companyId, parkingSessionId: paySession.id, paymentDate: payForm.paymentDate, amount: Number(payForm.amount), currency: payForm.currency, paymentMethod: payForm.paymentMethod, receivedById: user?.id, notes: payForm.notes || undefined };
      const res = await fetch('/api/backend/parking-payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(Array.isArray(j.message) ? j.message.join(', ') : j.message ?? 'Payment failed'); }
      setPaySession(null); load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Payment failed'); }
    finally { setSaving(false); }
  }

  const sef = (k: keyof typeof entryForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setEntryForm(f => ({ ...f, [k]: e.target.value }));
  const spf = (k: keyof typeof payForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setPayForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Parking Gate Operations" subtitle="Live vehicle entry & exit management" />
        <div className="flex items-center gap-3 flex-wrap">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {companyId && (
            <select value={facilityId} onChange={e => setFacilityId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white" style={{ color: 'var(--aurora-text)' }}>
              <option value="">All Facilities</option>
              {facilities.map(f => <option key={f.id} value={f.id}>{f.facilityName}</option>)}
            </select>
          )}
          {companyId && <Btn variant="success" onClick={openEntry}>🚛 New Session (Truck Entry)</Btn>}
        </div>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to begin.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}

      {companyId && !loading && (
        <>
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>Active Sessions</span>
              <span className="ml-1 inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-xs font-semibold">{activeSessions.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Session #</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Truck #</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Trailer #</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Driver</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Company</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Zone</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Entry Time</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Duration</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Rate</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Payment</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {activeSessions.length === 0 ? (
                    <tr><td colSpan={11} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No active sessions. All vehicles have exited.</td></tr>
                  ) : activeSessions.map((row: any) => (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.sessionNumber}</td>
                      <td className={`${tdCls} font-semibold`} style={{ color: 'var(--aurora-text)' }}>{row.truckNumber}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.trailerNumber ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.driverName ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.companyName ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.parkingZone?.zoneName ?? row.zone?.zoneName ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDateTime(row.entryTime)}</td>
                      <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.entryTime ? fmtDuration(row.entryTime) : '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.parkingRate?.rateName ?? row.rate?.rateName ?? '—'}</td>
                      <td className={tdCls}><StatusBadge status={row.paymentStatus ?? 'UNPAID'} /></td>
                      <td className={tdCls}>
                        <div className="flex gap-1 flex-wrap">
                          <Btn size="sm" variant="danger" loading={closingSessions.has(row.id)} onClick={() => setCloseTarget(row)}>🚪 Exit</Btn>
                          <Btn size="sm" variant="success" onClick={() => openPayment(row)}>💳 Pay</Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <span className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>Recent Completed Sessions</span>
              <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>(last 20)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Session #</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Truck #</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Driver</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Zone</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Entry</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Exit</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                    <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {completedSessions.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No completed sessions yet.</td></tr>
                  ) : completedSessions.map((row: any) => (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.sessionNumber}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.truckNumber}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.driverName ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.parkingZone?.zoneName ?? row.zone?.zoneName ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDateTime(row.entryTime)}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDateTime(row.exitTime)}</td>
                      <td className={tdCls}><StatusBadge status={row.status} /></td>
                      <td className={tdCls}><StatusBadge status={row.paymentStatus ?? 'UNPAID'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* Entry Modal */}
      <Modal open={entryOpen} onClose={() => setEntryOpen(false)} title="🚛 New Session — Truck Entry" size="lg"
        footer={<><Btn variant="secondary" onClick={() => setEntryOpen(false)}>Cancel</Btn><Btn variant="success" loading={saving} onClick={handleCreateSession}>🚛 Record Entry</Btn></>}
      >
        <div className="grid grid-cols-2 gap-4">
          <FormInput label="Session Number *" value={entryForm.sessionNumber} onChange={sef('sessionNumber')} />
          <FormInput label="Currency" value={entryForm.currency} onChange={sef('currency')} placeholder="TZS" />
          <FormInput label="Truck Number *" value={entryForm.truckNumber} onChange={e => setEntryForm(f => ({ ...f, truckNumber: e.target.value.toUpperCase() }))} placeholder="e.g. T123 ABC" />
          <FormInput label="Trailer Number" value={entryForm.trailerNumber} onChange={sef('trailerNumber')} placeholder="optional" />
          <FormInput label="Driver Name" value={entryForm.driverName} onChange={sef('driverName')} placeholder="optional" />
          <FormInput label="Driver Phone" value={entryForm.driverPhone} onChange={sef('driverPhone')} placeholder="optional" />
          <div className="col-span-2"><FormInput label="Client Company Name" value={entryForm.companyName} onChange={sef('companyName')} placeholder="optional" /></div>
          <div className="col-span-2">
            <FormSelect label="Facility *" value={facilityId} onChange={e => setFacilityId(e.target.value)}>
              <option value="">— Select Facility —</option>
              {facilities.map(f => <option key={f.id} value={f.id}>{f.facilityName}</option>)}
            </FormSelect>
          </div>
          <FormSelect label="Zone" value={entryForm.zoneId} onChange={sef('zoneId')}>
            <option value="">— Select Zone —</option>
            {zones.map(z => <option key={z.id} value={z.id}>{z.zoneCode} — {z.zoneName}</option>)}
          </FormSelect>
          <FormSelect label="Rate" value={entryForm.rateId} onChange={sef('rateId')}>
            <option value="">— Select Rate —</option>
            {rates.map(r => <option key={r.id} value={r.id}>{r.rateCode} — {r.rateName} ({fmtCurrency(r.amount)})</option>)}
          </FormSelect>
          <div className="col-span-2"><FormInput label="Entry Time" type="datetime-local" value={entryForm.entryTime} onChange={sef('entryTime')} /></div>
          <div className="col-span-2"><FormTextarea label="Notes" value={entryForm.notes} onChange={sef('notes')} rows={2} /></div>
        </div>
      </Modal>

      {/* Payment Modal */}
      <Modal open={!!paySession} onClose={() => setPaySession(null)} title="💳 Record Payment" size="md"
        subtitle={paySession ? `Session: ${paySession.sessionNumber} | Truck: ${paySession.truckNumber}` : undefined}
        footer={<><Btn variant="secondary" onClick={() => setPaySession(null)}>Cancel</Btn><Btn variant="success" loading={saving} onClick={handleRecordPayment}>✓ Record Payment</Btn></>}
      >
        <div className="grid grid-cols-2 gap-4">
          <FormInput label="Payment Number" value={payForm.paymentNumber} onChange={spf('paymentNumber')} />
          <FormInput label="Payment Date" type="date" value={payForm.paymentDate} onChange={spf('paymentDate')} />
          <FormInput label="Amount *" type="number" value={payForm.amount} onChange={spf('amount')} placeholder="e.g. 50000" />
          <FormInput label="Currency" value={payForm.currency} onChange={spf('currency')} />
          <div className="col-span-2">
            <FormSelect label="Payment Method *" value={payForm.paymentMethod} onChange={spf('paymentMethod')}>
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
            </FormSelect>
          </div>
          <div className="col-span-2"><FormTextarea label="Notes" value={payForm.notes} onChange={spf('notes')} rows={2} /></div>
        </div>
      </Modal>

      <ConfirmDialog open={!!closeTarget} onClose={() => setCloseTarget(null)} title="Confirm Truck Exit" message={`Close session ${closeTarget?.sessionNumber} for truck ${closeTarget?.truckNumber}? This marks the vehicle as exited.`} variant="danger" onConfirm={handleCloseSession} />
    </div>
  );
}
