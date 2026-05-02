'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company { id: string; name: string; code: string }
interface Branch { id: string; name: string; branchCode: string }
interface EmployeeOption { id: string; fullName: string; employeeCode: string; email?: string | null; branchId?: string | null }
interface PumpOption { id: string; pumpCode: string; pumpName: string }

type AttendantSource = 'employee' | 'manual';

interface AttendantAssignment {
  tempId: string;
  source: AttendantSource;
  employeeId?: string;
  attendantName?: string;
  assignedPumpId?: string;
}

interface FuelShift {
  id: string;
  shiftNumber: string;
  shiftDate: string;
  shiftType: string;
  openedBy?: { name?: string; email?: string } | null;
  status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fieldCls = 'w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const STATUS_CLR: Record<string, string> = {
  OPEN: 'bg-amber-50 text-amber-700 border-amber-200',
  SUBMITTED: 'bg-sky-50 text-sky-700 border-sky-200',
  SUPERVISOR_APPROVED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  MANAGER_APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
  CLOSED: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  VOIDED: 'bg-red-50 text-red-700 border-red-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status.replace(/_/g, ' ')}</span>;
}

function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }

function Spinner() {
  return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;
}

const SHIFT_TYPES = ['DAY', 'NIGHT', 'CUSTOM'] as const;
const SHIFT_STATUSES = ['OPEN', 'SUBMITTED', 'SUPERVISOR_APPROVED', 'MANAGER_APPROVED', 'REJECTED', 'CLOSED', 'VOIDED'] as const;

/** Returns a "YYYY-MM-DDTHH:mm" string suitable for <input type="datetime-local"> defaulting to "now". */
function nowForDatetimeLocal(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function OpenShiftModal({ companies, onClose, onSaved }: { companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [shiftDate, setShiftDate] = useState(new Date().toISOString().split('T')[0]);
  const [shiftType, setShiftType] = useState<typeof SHIFT_TYPES[number]>('DAY');
  const [startTime, setStartTime] = useState(nowForDatetimeLocal());
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [pumps, setPumps] = useState<PumpOption[]>([]);
  const [attendantRows, setAttendantRows] = useState<AttendantAssignment[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (companyId) fetch(`/api/backend/branches?companyId=${companyId}&limit=200`).then(r => r.json()).then(j => setBranches(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    else { setBranches([]); setBranchId(''); }
  }, [companyId]);

  // Load payroll employees scoped to the picked branch — only ACTIVE staff.
  useEffect(() => {
    if (!companyId || !branchId) { setEmployees([]); return; }
    fetch(`/api/backend/hr/employees?companyId=${companyId}&branchId=${branchId}&employmentStatus=ACTIVE&limit=500`)
      .then(r => r.json())
      .then(j => setEmployees(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []))
      .catch(() => setEmployees([]));
  }, [companyId, branchId]);

  // Load pumps for the chosen branch — needed to pin attendants to specific pumps.
  useEffect(() => {
    if (!branchId) { setPumps([]); return; }
    fetch(`/api/backend/petroleum/fuel-pumps?branchId=${branchId}&limit=200`)
      .then(r => r.json())
      .then(j => setPumps(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []))
      .catch(() => setPumps([]));
  }, [branchId]);

  const addAttendantRow = (source: AttendantSource) => {
    setAttendantRows(rows => [...rows, {
      tempId: Math.random().toString(36).slice(2),
      source,
      employeeId: '',
      attendantName: '',
      assignedPumpId: '',
    }]);
  };
  const updateAttendantRow = (tempId: string, patch: Partial<AttendantAssignment>) => {
    setAttendantRows(rows => rows.map(r => r.tempId === tempId ? { ...r, ...patch } : r));
  };
  const removeAttendantRow = (tempId: string) => {
    setAttendantRows(rows => rows.filter(r => r.tempId !== tempId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !branchId) { setError('Company and branch required'); return; }
    if (!startTime) { setError('Start time is required'); return; }
    // Validate attendant rows: each row must have a value matching its source,
    // no duplicate employees.
    const filled = attendantRows.filter(r =>
      (r.source === 'employee' && r.employeeId) ||
      (r.source === 'manual' && r.attendantName?.trim()),
    );
    const empIds = filled.filter(r => r.source === 'employee').map(r => r.employeeId);
    if (new Set(empIds).size !== empIds.length) {
      setError('The same employee is assigned twice. Remove the duplicate.');
      return;
    }
    setSaving(true); setError('');
    try {
      // Convert "YYYY-MM-DDTHH:mm" (local) to a full ISO 8601 string the
      // backend's @IsDateString() will accept.
      const startTimeIso = new Date(startTime).toISOString();
      const body: Record<string, unknown> = { companyId, branchId, shiftDate, shiftType, startTime: startTimeIso };
      if (filled.length > 0) {
        body.attendants = filled.map(r => ({
          ...(r.source === 'employee' ? { employeeId: r.employeeId } : { attendantName: r.attendantName!.trim() }),
          ...(r.assignedPumpId ? { assignedPumpId: r.assignedPumpId } : {}),
        }));
      }
      const res = await fetch('/api/backend/petroleum/fuel-shifts/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const msg = Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? 'Failed to open shift');
        throw new Error(msg);
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error opening shift');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-slate-900">Open New Shift</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Company *</label>
              <select required value={companyId} onChange={e => setCompanyId(e.target.value)} className={fieldCls}>
                <option value="">Select…</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Branch *</label>
              <select required value={branchId} onChange={e => setBranchId(e.target.value)} className={fieldCls} disabled={!companyId}>
                <option value="">Select…</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.branchCode} – {b.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Shift Date *</label>
              <input required type="date" value={shiftDate} onChange={e => setShiftDate(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>Shift Type *</label>
              <select required value={shiftType} onChange={e => setShiftType(e.target.value as typeof SHIFT_TYPES[number])} className={fieldCls}>
                {SHIFT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Start Time *</label>
              <input required type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} className={fieldCls} />
              <p className="mt-1 text-[11px] text-slate-500">When the attendant clocks in. Defaults to now; adjust if the shift actually started earlier.</p>
            </div>
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-2">
                <label className={labelCls + ' mb-0'}>Pump Attendants</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => addAttendantRow('employee')}
                    disabled={!branchId}
                    title={branchId ? 'Pick a payroll employee from this branch' : 'Pick a branch first'}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:text-slate-300 disabled:cursor-not-allowed"
                  >
                    + From payroll
                  </button>
                  <span className="text-slate-300">·</span>
                  <button
                    type="button"
                    onClick={() => addAttendantRow('manual')}
                    disabled={!companyId}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:text-slate-300 disabled:cursor-not-allowed"
                  >
                    + Manual entry
                  </button>
                </div>
              </div>
              {attendantRows.length === 0 ? (
                <p className="text-[11px] text-slate-500 italic border border-dashed border-slate-200 rounded-md px-3 py-2">
                  None assigned yet — pick from the branch&apos;s payroll list, or type a name manually for casual / temporary workers.
                </p>
              ) : (
                <div className="space-y-2">
                  {attendantRows.map((row, idx) => (
                    <div key={row.tempId} className="flex items-start gap-2">
                      <span className="text-[11px] text-slate-400 w-12 mt-2 flex-shrink-0">
                        #{idx + 1}<br />
                        <span className="text-[10px] text-slate-400">{row.source === 'employee' ? 'payroll' : 'manual'}</span>
                      </span>
                      {row.source === 'employee' ? (
                        <select
                          value={row.employeeId ?? ''}
                          onChange={e => updateAttendantRow(row.tempId, { employeeId: e.target.value })}
                          className={fieldCls + ' flex-1'}
                          disabled={!branchId}
                        >
                          <option value="">{employees.length === 0 ? 'No active employees on this branch' : 'Select employee…'}</option>
                          {employees.map(emp => (
                            <option key={emp.id} value={emp.id}>
                              {emp.employeeCode} — {emp.fullName}{emp.email ? ` · ${emp.email}` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={row.attendantName ?? ''}
                          onChange={e => updateAttendantRow(row.tempId, { attendantName: e.target.value })}
                          className={fieldCls + ' flex-1'}
                          placeholder="Attendant name (manual)"
                        />
                      )}
                      <select
                        value={row.assignedPumpId ?? ''}
                        onChange={e => updateAttendantRow(row.tempId, { assignedPumpId: e.target.value })}
                        disabled={!branchId}
                        className={fieldCls + ' flex-1'}
                        title="Optional pump assignment"
                      >
                        <option value="">Any pump (no pin)</option>
                        {pumps.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.pumpCode} — {p.pumpName}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeAttendantRow(row.tempId)}
                        className="text-xs text-red-600 hover:text-red-800 px-2 py-1.5 rounded hover:bg-red-50 flex-shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <p className="text-[11px] text-slate-500">
                    Payroll picks come from this branch&apos;s active employees. Manual entries are useful for casual workers not yet on the register. Pin to a pump to scope efficiency tracking to that pump&apos;s nozzles.
                  </p>
                </div>
              )}
            </div>
          </div>
        </form>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className="text-sm text-slate-600 px-4 py-2 rounded-md border border-slate-200 hover:bg-slate-50">Cancel</button>
          <button onClick={(e) => handleSubmit(e as unknown as React.FormEvent)} disabled={saving} className="text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-md font-medium">
            {saving ? 'Opening…' : 'Open Shift'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FuelShiftsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [shifts, setShifts] = useState<FuelShift[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (companyId) fetch(`/api/backend/branches?companyId=${companyId}&limit=200`).then(r => r.json()).then(j => setBranches(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    else { setBranches([]); setBranchId(''); }
  }, [companyId]);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ branchId });
      if (statusFilter) params.set('status', statusFilter);
      if (dateFilter) params.set('shiftDate', dateFilter);
      const res = await fetch(`/api/backend/petroleum/fuel-shifts?${params}`);
      if (!res.ok) throw new Error('Failed to load shifts');
      const json = await res.json();
      setShifts(json.data?.data ?? json.data ?? json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading shifts');
    } finally { setLoading(false); }
  }, [branchId, statusFilter, dateFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Fuel Shifts" subtitle="Manage daily dispensing shifts" />
        <button onClick={() => setModalOpen(true)} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium">
          + Open New Shift
        </button>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className={labelCls}>Company</label>
            <select value={companyId} onChange={e => setCompanyId(e.target.value)} className={fieldCls}>
              <option value="">— Select Company —</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Branch</label>
            <select value={branchId} onChange={e => setBranchId(e.target.value)} className={fieldCls} disabled={!companyId}>
              <option value="">— Select Branch —</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.branchCode} – {b.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={fieldCls}>
              <option value="">— All —</option>
              {SHIFT_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Date</label>
            <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} className={fieldCls} />
          </div>
        </div>
      </Card>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <Spinner />}

      {!loading && branchId && (
        <Card className="overflow-hidden">
          {shifts.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No shifts found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>Shift #</th>
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Type</th>
                    <th className={thCls}>Opened By</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shifts.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`}>{s.shiftNumber}</td>
                      <td className={tdCls}>{fmtDate(s.shiftDate)}</td>
                      <td className={tdCls}>{s.shiftType.replace(/_/g, ' ')}</td>
                      <td className={tdCls}>{s.openedBy?.name ?? s.openedBy?.email ?? '—'}</td>
                      <td className={tdCls}><Badge status={s.status} /></td>
                      <td className="px-4 py-2 text-right">
                        <Link href={`/petroleum/fuel-shifts/${s.id}`} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                          View {s.status === 'OPEN' ? '/ Close' : ''}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {!branchId && !loading && <div className="text-center py-10 text-sm text-slate-400">Select a company and branch to view shifts.</div>}

      {modalOpen && (
        <OpenShiftModal
          companies={companies}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); load(); }}
        />
      )}
    </div>
  );
}
