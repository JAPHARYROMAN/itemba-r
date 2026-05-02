'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShiftDetail {
  id: string;
  shiftNumber: string;
  shiftDate: string;
  shiftType: string;
  status: string;
  companyId: string;
  branchId: string;
  branch?: { name: string } | null;
  openedBy?: { name?: string; email?: string } | null;
  nozzleReadings?: NozzleReading[];
  collections?: ShiftCollection[];
  attendants?: ShiftAttendant[];
}

interface ShiftAttendant {
  id: string;
  attendantId?: string | null;
  employeeId?: string | null;
  attendantName?: string | null;
  assignedPumpId?: string | null;
  notes?: string | null;
  attendant?: { id: string; fullName: string; email?: string | null } | null;
  employee?: { id: string; fullName: string; employeeCode: string; email?: string | null; branchId?: string | null } | null;
  assignedPump?: { id: string; pumpCode: string; pumpName: string } | null;
}

interface NozzleReading {
  id: string;
  nozzle?: { nozzleCode: string; nozzleName: string } | null;
  openingMeter: number;
  closingMeter: number;
  litresSold: number;
  expectedAmount: number;
  status: string;
}

interface ShiftCollection {
  id: string;
  collectionType: string;
  amount: number;
  reference?: string | null;
}

interface FuelNozzle { id: string; nozzleCode: string; nozzleName: string }
interface FuelPump { id: string; pumpCode: string; pumpName: string }
interface EmployeeOption { id: string; fullName: string; employeeCode: string; email?: string | null }

interface AttendantEfficiencyRow {
  assignmentId: string;
  attendantId?: string | null;
  employeeId?: string | null;
  attendantName?: string | null;
  displayName: string;
  attendant?: { id: string; fullName: string; email?: string | null } | null;
  employee?: { id: string; fullName: string; employeeCode: string; email?: string | null; branchId?: string | null } | null;
  assignedPump?: { id: string; pumpCode: string; pumpName: string } | null;
  readingCount: number;
  litresSold: number;
  expectedAmount: number;
  litresPerHour: number;
  litresShare: number;
  revenueShare: number;
}

interface EfficiencySnapshot {
  shiftId: string;
  shiftStatus: string;
  hoursElapsed: number;
  totals: { litresSold: number; expectedAmount: number };
  attributed: { litresSold: number; expectedAmount: number };
  unattributed: { litresSold: number; expectedAmount: number };
  attendants: AttendantEfficiencyRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fieldCls = 'w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const STATUS_CLR: Record<string, string> = {
  OPEN: 'bg-amber-50 text-amber-700 border-amber-200',
  CLOSED: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  RECONCILED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  POSTED: 'bg-blue-50 text-blue-700 border-blue-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status}</span>;
}

function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtNum(n: number) { return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

function Spinner() {
  return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;
}

const COLLECTION_TYPES = ['CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'CREDIT', 'CHEQUE'];

// ─── Add Nozzle Reading Modal ─────────────────────────────────────────────────

function AddReadingModal({ shiftId, onClose, onSaved }: { shiftId: string; onClose: () => void; onSaved: () => void }) {
  const [nozzleId, setNozzleId] = useState('');
  const [closingMeter, setClosingMeter] = useState<number | ''>('');
  const [nozzles, setNozzles] = useState<FuelNozzle[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/backend/petroleum/fuel-nozzles?shiftId=${shiftId}`)
      .then(r => r.json())
      .then(j => setNozzles(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []))
      .catch(() => setNozzles([]));
  }, [shiftId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nozzleId || closingMeter === '') { setError('Nozzle and closing meter required'); return; }
    setSaving(true); setError('');
    try {
      const body = { fuelShiftId: shiftId, nozzleId, closingMeter: Number(closingMeter) };
      const res = await fetch('/api/backend/petroleum/nozzle-readings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error saving');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">Add Nozzle Reading</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}
          <div>
            <label className={labelCls}>Nozzle *</label>
            <select required value={nozzleId} onChange={e => setNozzleId(e.target.value)} className={fieldCls}>
              <option value="">Select nozzle…</option>
              {nozzles.map(n => <option key={n.id} value={n.id}>{n.nozzleCode} – {n.nozzleName}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Closing Meter Reading *</label>
            <input required type="number" step="0.01" value={closingMeter} onChange={e => setClosingMeter(e.target.value === '' ? '' : Number(e.target.value))} className={fieldCls} placeholder="0.00" />
          </div>
        </form>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="text-sm text-slate-600 px-4 py-2 rounded-md border border-slate-200 hover:bg-slate-50">Cancel</button>
          <button onClick={(e) => handleSubmit(e as unknown as React.FormEvent)} disabled={saving} className="text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-md font-medium">
            {saving ? 'Saving…' : 'Add Reading'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Collection Modal ─────────────────────────────────────────────────────

function AddCollectionModal({ shiftId, onClose, onSaved }: { shiftId: string; onClose: () => void; onSaved: () => void }) {
  const [collectionType, setCollectionType] = useState('CASH');
  const [amount, setAmount] = useState<number | ''>('');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount) { setError('Amount required'); return; }
    setSaving(true); setError('');
    try {
      const body = { fuelShiftId: shiftId, collectionType, amount: Number(amount), reference: reference.trim() || undefined };
      const res = await fetch('/api/backend/petroleum/shift-collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error saving');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">Add Collection</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}
          <div>
            <label className={labelCls}>Collection Type *</label>
            <select required value={collectionType} onChange={e => setCollectionType(e.target.value)} className={fieldCls}>
              {COLLECTION_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Amount *</label>
            <input required type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value === '' ? '' : Number(e.target.value))} className={fieldCls} placeholder="0.00" />
          </div>
          <div>
            <label className={labelCls}>Reference (optional)</label>
            <input value={reference} onChange={e => setReference(e.target.value)} className={fieldCls} placeholder="Receipt / ref number" />
          </div>
        </form>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="text-sm text-slate-600 px-4 py-2 rounded-md border border-slate-200 hover:bg-slate-50">Cancel</button>
          <button onClick={(e) => handleSubmit(e as unknown as React.FormEvent)} disabled={saving} className="text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-md font-medium">
            {saving ? 'Saving…' : 'Add Collection'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add / Reassign Attendant Modal ───────────────────────────────────────────

type AddSource = 'employee' | 'manual';

function AttendantModal({
  shiftId, companyId, branchId, initial, existingEmployeeIds, onClose, onSaved,
}: {
  shiftId: string;
  companyId: string;
  branchId: string;
  /** Set when editing an existing assignment row. */
  initial?: ShiftAttendant;
  /** Already-assigned employee ids (prevents duplicate adds). */
  existingEmployeeIds: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial;
  const [source, setSource] = useState<AddSource>('employee');
  const [employeeId, setEmployeeId] = useState('');
  const [attendantName, setAttendantName] = useState('');
  const [assignedPumpId, setAssignedPumpId] = useState(initial?.assignedPumpId ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [pumps, setPumps] = useState<FuelPump[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isEdit) {
      fetch(`/api/backend/hr/employees?companyId=${companyId}&branchId=${branchId}&employmentStatus=ACTIVE&limit=500`)
        .then(r => r.json())
        .then(j => setEmployees(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []))
        .catch(() => setEmployees([]));
    }
    fetch(`/api/backend/petroleum/fuel-pumps?branchId=${branchId}&limit=200`).then(r => r.json())
      .then(j => setPumps(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []))
      .catch(() => setPumps([]));
  }, [companyId, branchId, isEdit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEdit) {
      if (source === 'employee' && !employeeId) { setError('Pick an employee from the payroll'); return; }
      if (source === 'manual' && !attendantName.trim()) { setError('Enter the attendant\'s name'); return; }
      if (source === 'employee' && existingEmployeeIds.includes(employeeId)) {
        setError('That employee is already assigned to this shift');
        return;
      }
    }
    setSaving(true); setError('');
    try {
      const url = isEdit
        ? `/api/backend/petroleum/fuel-shifts/${shiftId}/attendants/${initial!.id}`
        : `/api/backend/petroleum/fuel-shifts/${shiftId}/attendants`;
      const method = isEdit ? 'PATCH' : 'POST';
      const body: Record<string, unknown> = isEdit
        ? { assignedPumpId: assignedPumpId || null, notes: notes || null }
        : {
            ...(source === 'employee' ? { employeeId } : { attendantName: attendantName.trim() }),
            ...(assignedPumpId ? { assignedPumpId } : {}),
            ...(notes ? { notes } : {}),
          };
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const msg = Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? 'Save failed');
        throw new Error(msg);
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error saving');
    } finally { setSaving(false); }
  };

  const tabBtn = (active: boolean) =>
    `flex-1 text-xs font-medium px-3 py-2 rounded-md border transition-colors ${
      active
        ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
    }`;

  const initialDisplayName = initial?.employee?.fullName ?? initial?.attendant?.fullName ?? initial?.attendantName ?? '—';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">{isEdit ? 'Reassign Pump' : 'Add Attendant'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}
          {!isEdit && (
            <div>
              <label className={labelCls}>Source</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSource('employee')} className={tabBtn(source === 'employee')}>From payroll</button>
                <button type="button" onClick={() => setSource('manual')} className={tabBtn(source === 'manual')}>Manual entry</button>
              </div>
            </div>
          )}
          <div>
            <label className={labelCls}>Attendant {isEdit ? '' : '*'}</label>
            {isEdit ? (
              <div className={fieldCls + ' bg-slate-50 text-slate-700'}>{initialDisplayName}</div>
            ) : source === 'employee' ? (
              <select required value={employeeId} onChange={e => setEmployeeId(e.target.value)} className={fieldCls}>
                <option value="">{employees.length === 0 ? 'No active employees on this branch' : 'Select employee…'}</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id} disabled={existingEmployeeIds.includes(emp.id)}>
                    {emp.employeeCode} — {emp.fullName}{emp.email ? ` · ${emp.email}` : ''}{existingEmployeeIds.includes(emp.id) ? ' (already assigned)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                required
                value={attendantName}
                onChange={e => setAttendantName(e.target.value)}
                className={fieldCls}
                placeholder="Attendant name"
              />
            )}
            {!isEdit && source === 'manual' && (
              <p className="mt-1 text-[11px] text-slate-500">For casual/temporary workers not yet on the payroll register.</p>
            )}
          </div>
          <div>
            <label className={labelCls}>Assigned Pump (optional)</label>
            <select value={assignedPumpId} onChange={e => setAssignedPumpId(e.target.value)} className={fieldCls}>
              <option value="">Any pump (no pin)</option>
              {pumps.map(p => <option key={p.id} value={p.id}>{p.pumpCode} — {p.pumpName}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">Pinning to a pump scopes efficiency tracking to that pump&apos;s nozzles.</p>
          </div>
          <div>
            <label className={labelCls}>Notes (optional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} className={fieldCls} placeholder="e.g. trainee, late start, …" />
          </div>
        </form>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="text-sm text-slate-600 px-4 py-2 rounded-md border border-slate-200 hover:bg-slate-50">Cancel</button>
          <button onClick={(e) => handleSubmit(e as unknown as React.FormEvent)} disabled={saving} className="text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-md font-medium">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ShiftDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [shift, setShift] = useState<ShiftDetail | null>(null);
  const [efficiency, setEfficiency] = useState<EfficiencySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const [showReadingModal, setShowReadingModal] = useState(false);
  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [addingAttendant, setAddingAttendant] = useState(false);
  const [editingAttendant, setEditingAttendant] = useState<ShiftAttendant | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/petroleum/fuel-shifts/${id}`);
      if (!res.ok) throw new Error('Failed to load shift');
      const json = await res.json();
      setShift(json.data ?? json);
      // Fire efficiency in parallel; tolerate failure (returns null).
      fetch(`/api/backend/petroleum/fuel-shifts/${id}/efficiency`)
        .then(r => r.ok ? r.json() : null)
        .then(j => setEfficiency(j ? (j.data ?? j) : null))
        .catch(() => setEfficiency(null));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading shift');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleRemoveAttendant = async (assignmentId: string, name: string) => {
    if (!confirm(`Remove ${name} from this shift?`)) return;
    try {
      const res = await fetch(`/api/backend/petroleum/fuel-shifts/${id}/attendants/${assignmentId}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message ?? 'Remove failed');
      }
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error removing attendant');
    }
  };

  const handleClose = async () => {
    if (!confirm('Close this shift?')) return;
    setClosing(true);
    try {
      const res = await fetch(`/api/backend/petroleum/fuel-shifts/${id}/close`, { method: 'PATCH' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Close failed'); }
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error closing shift');
    } finally { setClosing(false); }
  };

  if (loading) return <div className="p-6"><Spinner /></div>;
  if (error) return <div className="p-6"><div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div></div>;
  if (!shift) return null;

  const totalSales = (shift.nozzleReadings ?? []).reduce((s, r) => s + r.expectedAmount, 0);
  const totalCollections = (shift.collections ?? []).reduce((s, c) => s + c.amount, 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <button onClick={() => router.back()} className="text-xs text-slate-400 hover:text-slate-600 mb-1 flex items-center gap-1">
            ← Back to Shifts
          </button>
          <PageHeader
            title={`Shift ${shift.shiftNumber}`}
            subtitle={`${shift.shiftType.replace(/_/g, ' ')} · ${fmtDate(shift.shiftDate)} · ${shift.branch?.name ?? ''}`}
          />
        </div>
        <div className="flex items-center gap-3">
          <Badge status={shift.status} />
          {shift.status === 'OPEN' && (
            <button onClick={handleClose} disabled={closing} className="text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-2 rounded-md font-medium">
              {closing ? 'Closing…' : 'Close Shift'}
            </button>
          )}
        </div>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-xs text-slate-500 mb-1">Total Expected Sales</div>
          <div className="text-lg font-bold text-slate-900">{fmtNum(totalSales)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500 mb-1">Total Collections</div>
          <div className="text-lg font-bold text-slate-900">{fmtNum(totalCollections)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500 mb-1">Variance</div>
          <div className={`text-lg font-bold ${totalCollections - totalSales < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            {fmtNum(totalCollections - totalSales)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500 mb-1">Nozzle Readings</div>
          <div className="text-lg font-bold text-slate-900">{(shift.nozzleReadings ?? []).length}</div>
        </Card>
      </div>

      {/* Attendants */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Pump Attendants</div>
          {shift.status === 'OPEN' && (
            <button onClick={() => setAddingAttendant(true)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 py-1 rounded hover:bg-indigo-50">
              + Add Attendant
            </button>
          )}
        </div>
        {(shift.attendants ?? []).length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No attendants assigned to this shift.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className={thCls}>Attendant</th>
                  <th className={thCls}>Source</th>
                  <th className={thCls}>Contact</th>
                  <th className={thCls}>Assigned Pump</th>
                  <th className={thCls}>Notes</th>
                  {shift.status === 'OPEN' && <th className={`${thCls} text-right`}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {(shift.attendants ?? []).map(a => {
                  const displayName = a.employee?.fullName ?? a.attendant?.fullName ?? a.attendantName ?? '—';
                  const sourceLabel = a.employee
                    ? <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-medium">Payroll</span>
                    : a.attendant
                      ? <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-medium">User</span>
                      : <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-medium">Manual</span>;
                  const employeeCode = a.employee?.employeeCode;
                  const email = a.employee?.email ?? a.attendant?.email ?? null;
                  return (
                    <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`}>
                        {displayName}
                        {employeeCode && <span className="ml-2 text-xs font-mono text-slate-500">{employeeCode}</span>}
                      </td>
                      <td className={tdCls}>{sourceLabel}</td>
                      <td className={`${tdCls} text-slate-500 text-xs`}>{email ?? '—'}</td>
                      <td className={tdCls}>
                        {a.assignedPump
                          ? <span><span className="font-medium">{a.assignedPump.pumpCode}</span> <span className="text-slate-500">— {a.assignedPump.pumpName}</span></span>
                          : <span className="text-slate-400 italic text-xs">Any pump</span>}
                      </td>
                      <td className={`${tdCls} text-slate-500 text-xs`}>{a.notes ?? '—'}</td>
                      {shift.status === 'OPEN' && (
                        <td className={`${tdCls} text-right whitespace-nowrap`}>
                          <button onClick={() => setEditingAttendant(a)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2">Reassign</button>
                          <button onClick={() => handleRemoveAttendant(a.id, displayName)} className="text-xs text-red-600 hover:text-red-800 font-medium px-2">Remove</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Efficiency */}
      {efficiency && efficiency.attendants.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Attendant Efficiency</div>
            <span className="text-[11px] text-slate-500">
              {efficiency.hoursElapsed > 0 ? `${efficiency.hoursElapsed.toFixed(1)} h elapsed` : 'Shift not started'}
              {efficiency.unattributed.litresSold > 0 && (
                <span className="ml-2 text-amber-700">· {fmtNum(efficiency.unattributed.litresSold)} L unattributed</span>
              )}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className={thCls}>Attendant</th>
                  <th className={thCls}>Pump</th>
                  <th className={`${thCls} text-right`}>Readings</th>
                  <th className={`${thCls} text-right`}>Litres Sold</th>
                  <th className={`${thCls} text-right`}>Expected (TZS)</th>
                  <th className={`${thCls} text-right`}>L / hr</th>
                  <th className={`${thCls} text-right`}>Volume Share</th>
                </tr>
              </thead>
              <tbody>
                {efficiency.attendants.map(row => (
                  <tr key={row.assignmentId} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`}>
                      {row.displayName}
                      {row.employee?.employeeCode && (
                        <span className="ml-2 text-xs font-mono text-slate-500">{row.employee.employeeCode}</span>
                      )}
                    </td>
                    <td className={tdCls}>
                      {row.assignedPump
                        ? <span className="text-xs">{row.assignedPump.pumpCode}</span>
                        : <span className="text-slate-400 italic text-xs">Any</span>}
                    </td>
                    <td className={`${tdCls} text-right font-mono`}>{row.readingCount}</td>
                    <td className={`${tdCls} text-right font-mono`}>{fmtNum(row.litresSold)}</td>
                    <td className={`${tdCls} text-right font-mono`}>{fmtNum(row.expectedAmount)}</td>
                    <td className={`${tdCls} text-right font-mono`}>{fmtNum(row.litresPerHour)}</td>
                    <td className={`${tdCls} text-right font-mono`}>{(row.litresShare * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td colSpan={3} className={`${tdCls} font-semibold`}>Shift Total</td>
                  <td className={`${tdCls} text-right font-mono font-semibold`}>{fmtNum(efficiency.totals.litresSold)}</td>
                  <td className={`${tdCls} text-right font-mono font-semibold`}>{fmtNum(efficiency.totals.expectedAmount)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            Attribution: a nozzle reading counts toward the attendant set on the reading itself, otherwise toward the attendant pinned to that pump. Readings on pumps with no pinned attendant are shown as &quot;unattributed&quot; above.
          </p>
        </Card>
      )}

      {/* Nozzle Readings */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Nozzle Readings</div>
          {shift.status === 'OPEN' && (
            <button onClick={() => setShowReadingModal(true)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 py-1 rounded hover:bg-indigo-50">
              + Add Reading
            </button>
          )}
        </div>
        {(shift.nozzleReadings ?? []).length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No readings recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className={thCls}>Nozzle</th>
                  <th className={`${thCls} text-right`}>Opening Meter</th>
                  <th className={`${thCls} text-right`}>Closing Meter</th>
                  <th className={`${thCls} text-right`}>Litres Sold</th>
                  <th className={`${thCls} text-right`}>Expected Amount</th>
                  <th className={thCls}>Status</th>
                </tr>
              </thead>
              <tbody>
                {(shift.nozzleReadings ?? []).map(r => (
                  <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`}>{r.nozzle?.nozzleCode} – {r.nozzle?.nozzleName}</td>
                    <td className={`${tdCls} text-right font-mono`}>{fmtNum(r.openingMeter)}</td>
                    <td className={`${tdCls} text-right font-mono`}>{fmtNum(r.closingMeter)}</td>
                    <td className={`${tdCls} text-right font-mono`}>{fmtNum(r.litresSold)}</td>
                    <td className={`${tdCls} text-right font-mono`}>{fmtNum(r.expectedAmount)}</td>
                    <td className={tdCls}><Badge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Collections */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Collections</div>
          {shift.status === 'OPEN' && (
            <button onClick={() => setShowCollectionModal(true)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 py-1 rounded hover:bg-indigo-50">
              + Add Collection
            </button>
          )}
        </div>
        {(shift.collections ?? []).length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No collections recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className={thCls}>Type</th>
                  <th className={`${thCls} text-right`}>Amount</th>
                  <th className={thCls}>Reference</th>
                </tr>
              </thead>
              <tbody>
                {(shift.collections ?? []).map(c => (
                  <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={tdCls}>{c.collectionType.replace(/_/g, ' ')}</td>
                    <td className={`${tdCls} text-right font-mono`}>{fmtNum(c.amount)}</td>
                    <td className={tdCls}>{c.reference ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showReadingModal && (
        <AddReadingModal
          shiftId={id}
          onClose={() => setShowReadingModal(false)}
          onSaved={() => { setShowReadingModal(false); load(); }}
        />
      )}

      {showCollectionModal && (
        <AddCollectionModal
          shiftId={id}
          onClose={() => setShowCollectionModal(false)}
          onSaved={() => { setShowCollectionModal(false); load(); }}
        />
      )}

      {addingAttendant && (
        <AttendantModal
          shiftId={id}
          companyId={shift.companyId}
          branchId={shift.branchId}
          existingEmployeeIds={(shift.attendants ?? []).map(a => a.employeeId).filter((x): x is string => !!x)}
          onClose={() => setAddingAttendant(false)}
          onSaved={() => { setAddingAttendant(false); load(); }}
        />
      )}

      {editingAttendant && (
        <AttendantModal
          shiftId={id}
          companyId={shift.companyId}
          branchId={shift.branchId}
          initial={editingAttendant}
          existingEmployeeIds={(shift.attendants ?? []).filter(a => a.id !== editingAttendant.id).map(a => a.employeeId).filter((x): x is string => !!x)}
          onClose={() => setEditingAttendant(null)}
          onSaved={() => { setEditingAttendant(null); load(); }}
        />
      )}
    </div>
  );
}
