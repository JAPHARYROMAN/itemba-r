'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui';

const STATUS_CLR: Record<string, string> = {
  PLANNED: 'bg-blue-50 text-blue-700 border-blue-200',
  DISPATCHED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  IN_TRANSIT: 'bg-sky-50 text-sky-700 border-sky-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CLOSED: 'bg-slate-50 text-slate-500 border-slate-200',
  CANCELLED: 'bg-zinc-100 text-zinc-500 border-zinc-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status.replace(/_/g, ' ')}</span>;
}

function Spinner() {
  return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;
}

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';
const inputCls = 'w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';

function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtCurrency(n: number) { return `TZS ${new Intl.NumberFormat('en-US').format(n)}`; }

const EXPENSE_TYPES = ['FUEL','TOLL','ACCOMMODATION','FOOD','LOADING','OFFLOADING','REPAIR','VEHICLE_WASH','PARKING','BORDER_CROSSING','PORT_CHARGES','OTHER'];
const FUEL_SOURCES = ['PETROL_STATION','OWN_PUMP','VOUCHER','EMERGENCY'];

const EMPTY_EXPENSE_FORM = { expenseType: 'FUEL', amount: '', currency: 'TZS', expenseDate: '', description: '' };
const EMPTY_FUEL_FORM = { vehicleId: '', fuelSource: 'PETROL_STATION', litres: '', unitPrice: '', totalCost: '', odometerBefore: '', odometerAfter: '', fuelDate: '', notes: '' };

export default function TripDetailPage() {
  const params = useParams();
  const id = params?.id as string;

  const [trip, setTrip] = useState<any>(null);
  const [profitability, setProfitability] = useState<any>(null);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [fuelUsage, setFuelUsage] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'expenses' | 'fuel'>('expenses');

  const [expenseForm, setExpenseForm] = useState({ ...EMPTY_EXPENSE_FORM });
  const [savingExpense, setSavingExpense] = useState(false);

  const [fuelForm, setFuelForm] = useState({ ...EMPTY_FUEL_FORM });
  const [savingFuel, setSavingFuel] = useState(false);

  const [cancelling, setCancelling] = useState(false);

  const loadAll = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError('');
    try {
      const [tripRes, profRes, expRes, fuelRes] = await Promise.all([
        fetch(`/api/backend/logistics/trips/${id}`),
        fetch(`/api/backend/logistics/trips/${id}/profitability`),
        fetch(`/api/backend/logistics/trip-expenses/by-trip/${id}`),
        fetch(`/api/backend/logistics/trip-fuel-usage/by-trip/${id}`),
      ]);

      if (!tripRes.ok) throw new Error('Failed to load trip');

      const tripJson = await tripRes.json();
      setTrip(tripJson.data ?? tripJson);

      if (profRes.ok) {
        const profJson = await profRes.json();
        setProfitability(profJson.data ?? profJson);
      }

      if (expRes.ok) {
        const expJson = await expRes.json();
        setExpenses(Array.isArray(expJson.data?.data) ? expJson.data.data : Array.isArray(expJson.data) ? expJson.data : []);
      }

      if (fuelRes.ok) {
        const fuelJson = await fuelRes.json();
        setFuelUsage(Array.isArray(fuelJson.data?.data) ? fuelJson.data.data : Array.isArray(fuelJson.data) ? fuelJson.data : []);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading trip');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function handleDeleteExpense(expenseId: string) {
    if (!window.confirm('Delete this record?')) return;
    try {
      const res = await fetch(`/api/backend/logistics/trip-expenses/${expenseId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      await loadAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function handleDeleteFuel(fuelId: string) {
    if (!window.confirm('Delete this record?')) return;
    try {
      const res = await fetch(`/api/backend/logistics/trip-fuel-usage/${fuelId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      await loadAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function handleAddExpense() {
    if (!expenseForm.expenseType || !expenseForm.amount || !expenseForm.expenseDate) {
      alert('Expense Type, Amount and Date are required.');
      return;
    }
    setSavingExpense(true);
    try {
      const body = {
        tripId: id,
        companyId: trip?.companyId,
        expenseType: expenseForm.expenseType,
        amount: Number(expenseForm.amount),
        currency: expenseForm.currency,
        expenseDate: expenseForm.expenseDate,
        description: expenseForm.description,
      };
      const res = await fetch('/api/backend/logistics/trip-expenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message ?? 'Save failed'); }
      setExpenseForm({ ...EMPTY_EXPENSE_FORM });
      await loadAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally { setSavingExpense(false); }
  }

  function updateFuelForm(patch: Partial<typeof EMPTY_FUEL_FORM>) {
    setFuelForm(f => {
      const next = { ...f, ...patch };
      const l = parseFloat(next.litres);
      const u = parseFloat(next.unitPrice);
      if (!isNaN(l) && !isNaN(u) && ('litres' in patch || 'unitPrice' in patch) && !('totalCost' in patch)) {
        next.totalCost = (l * u).toString();
      }
      return next;
    });
  }

  async function handleAddFuel() {
    if (!fuelForm.fuelSource || !fuelForm.litres || !fuelForm.fuelDate) {
      alert('Fuel Source, Litres, and Date are required.');
      return;
    }
    setSavingFuel(true);
    try {
      const body = {
        tripId: id,
        companyId: trip?.companyId,
        vehicleId: fuelForm.vehicleId || undefined,
        fuelSource: fuelForm.fuelSource,
        litres: Number(fuelForm.litres),
        unitPrice: fuelForm.unitPrice !== '' ? Number(fuelForm.unitPrice) : undefined,
        totalCost: fuelForm.totalCost !== '' ? Number(fuelForm.totalCost) : undefined,
        odometerBefore: fuelForm.odometerBefore !== '' ? Number(fuelForm.odometerBefore) : undefined,
        odometerAfter: fuelForm.odometerAfter !== '' ? Number(fuelForm.odometerAfter) : undefined,
        fuelDate: fuelForm.fuelDate,
        notes: fuelForm.notes,
      };
      const res = await fetch('/api/backend/logistics/trip-fuel-usage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message ?? 'Save failed'); }
      setFuelForm({ ...EMPTY_FUEL_FORM });
      await loadAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally { setSavingFuel(false); }
  }

  async function handleCancel() {
    if (!window.confirm('Cancel this trip?')) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/backend/logistics/trips/${id}/cancel`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message ?? 'Cancel failed'); }
      await loadAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally { setCancelling(false); }
  }

  if (loading) return <div className="p-6"><Spinner /></div>;
  if (!trip) return <div className="p-6 text-sm text-slate-500">{error || 'Trip not found.'}</div>;

  const canCancel = trip.status === 'PLANNED' || trip.status === 'DISPATCHED';
  const profit = profitability?.profit ?? 0;

  return (
    <div className="p-6 space-y-6">
      {/* Back + header */}
      <div className="flex items-center gap-4 flex-wrap">
        <Link href="/logistics/trips" className="text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1">
          ← Back to Trips
        </Link>
        {canCancel && (
          <button onClick={handleCancel} disabled={cancelling} className="ml-auto bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
            {cancelling ? 'Cancelling…' : 'Cancel Trip'}
          </button>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* Trip Info Card */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">Trip</p>
            <h1 className="text-2xl font-bold text-slate-800">{trip.tripNumber}</h1>
          </div>
          <Badge status={trip.status} />
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide">Route</p>
            <p className="font-medium text-slate-700" style={{ color: 'var(--aurora-text)' }}>{trip.origin ?? '—'} → {trip.destination ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide">Vehicle</p>
            <p style={{ color: 'var(--aurora-text)' }}>{trip.vehicle?.registrationNumber ?? trip.vehicleId ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide">Driver</p>
            <p style={{ color: 'var(--aurora-text)' }}>{trip.driver?.fullName ?? trip.driverId ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide">Trip Date</p>
            <p style={{ color: 'var(--aurora-text)' }}>{trip.tripDate ? fmtDate(trip.tripDate) : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide">Expected Return</p>
            <p style={{ color: 'var(--aurora-text)' }}>{trip.expectedReturnDate ? fmtDate(trip.expectedReturnDate) : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide">Revenue</p>
            <p style={{ color: 'var(--aurora-text)' }}>{trip.revenueAmount != null ? fmtCurrency(trip.revenueAmount) : '—'}</p>
          </div>
          {trip.customerName && (
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide">Customer</p>
              <p style={{ color: 'var(--aurora-text)' }}>{trip.customerName}</p>
            </div>
          )}
          {trip.cargoDescription && (
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide">Cargo</p>
              <p style={{ color: 'var(--aurora-text)' }}>{trip.cargoDescription}</p>
            </div>
          )}
        </div>
      </Card>

      {/* Profitability Card */}
      {profitability && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4 uppercase tracking-wide">Profitability</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Revenue</p>
              <p className="text-lg font-bold text-slate-800">{fmtCurrency(profitability.revenue ?? 0)}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Total Costs</p>
              <p className="text-lg font-bold text-slate-800">{fmtCurrency((profitability.totalExpenses ?? 0) + (profitability.totalFuelCost ?? 0))}</p>
            </div>
            <div className={`rounded-lg p-3 text-center ${profit >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Net Profit</p>
              <p className={`text-lg font-bold ${profit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtCurrency(profit)}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Margin</p>
              <p className={`text-lg font-bold ${(profitability.marginPercent ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {profitability.marginPercent != null ? `${profitability.marginPercent.toFixed(1)}%` : '—'}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Tabs */}
      <div>
        <div className="flex border-b border-slate-200 mb-4">
          <button
            onClick={() => setTab('expenses')}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === 'expenses' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            Expenses ({expenses.length})
          </button>
          <button
            onClick={() => setTab('fuel')}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === 'fuel' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            Fuel Usage ({fuelUsage.length})
          </button>
        </div>

        {tab === 'expenses' && (
          <div className="space-y-4">
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Type</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Amount</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Currency</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Date</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Description</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">No expenses recorded.</td></tr>
                    ) : expenses.map((e: any) => (
                      <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{e.expenseType?.replace(/_/g, ' ') ?? '—'}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{e.amount != null ? fmtCurrency(e.amount) : '—'}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{e.currency ?? 'TZS'}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{e.expenseDate ? fmtDate(e.expenseDate) : '—'}</td>
                        <td className={`${tdCls} max-w-xs truncate`} style={{ color: 'var(--aurora-text)' }}>{e.description ?? '—'}</td>
                        <td className={tdCls}>
                          <button onClick={() => handleDeleteExpense(e.id)} className="text-red-500 hover:text-red-700 text-xs font-medium">Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Add Expense Form */}
            <Card className="p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Add Expense</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Expense Type <span className="text-red-500">*</span></label>
                  <select className={inputCls} value={expenseForm.expenseType} onChange={e => setExpenseForm(f => ({ ...f, expenseType: e.target.value }))}>
                    {EXPENSE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Amount <span className="text-red-500">*</span></label>
                  <input type="number" className={inputCls} value={expenseForm.amount} onChange={e => setExpenseForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" min="0" />
                </div>
                <div>
                  <label className={labelCls}>Currency</label>
                  <input className={inputCls} value={expenseForm.currency} onChange={e => setExpenseForm(f => ({ ...f, currency: e.target.value }))} placeholder="TZS" />
                </div>
                <div>
                  <label className={labelCls}>Date <span className="text-red-500">*</span></label>
                  <input type="date" className={inputCls} value={expenseForm.expenseDate} onChange={e => setExpenseForm(f => ({ ...f, expenseDate: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Description</label>
                  <input className={inputCls} value={expenseForm.description} onChange={e => setExpenseForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description" />
                </div>
              </div>
              <div className="flex justify-end mt-4">
                <button onClick={handleAddExpense} disabled={savingExpense} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
                  {savingExpense ? 'Adding…' : 'Add Expense'}
                </button>
              </div>
            </Card>
          </div>
        )}

        {tab === 'fuel' && (
          <div className="space-y-4">
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Source</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Litres</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Unit Price</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Total</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Odo Before</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>After</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Date</th>
                      <th className={thCls} style={{ color: 'var(--aurora-text-secondary)' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fuelUsage.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-slate-400">No fuel usage recorded.</td></tr>
                    ) : fuelUsage.map((f: any) => (
                      <tr key={f.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{f.fuelSource?.replace(/_/g, ' ') ?? '—'}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{f.litres ?? '—'}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{f.unitPrice != null ? fmtCurrency(f.unitPrice) : '—'}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{f.totalCost != null ? fmtCurrency(f.totalCost) : '—'}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{f.odometerBefore ?? '—'}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{f.odometerAfter ?? '—'}</td>
                        <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{f.fuelDate ? fmtDate(f.fuelDate) : '—'}</td>
                        <td className={tdCls}>
                          <button onClick={() => handleDeleteFuel(f.id)} className="text-red-500 hover:text-red-700 text-xs font-medium">Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Add Fuel Form */}
            <Card className="p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Add Fuel Record</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Fuel Source <span className="text-red-500">*</span></label>
                  <select className={inputCls} value={fuelForm.fuelSource} onChange={e => updateFuelForm({ fuelSource: e.target.value })}>
                    {FUEL_SOURCES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Litres <span className="text-red-500">*</span></label>
                  <input type="number" className={inputCls} value={fuelForm.litres} onChange={e => updateFuelForm({ litres: e.target.value })} placeholder="0.00" min="0" step="0.01" />
                </div>
                <div>
                  <label className={labelCls}>Unit Price (TZS)</label>
                  <input type="number" className={inputCls} value={fuelForm.unitPrice} onChange={e => updateFuelForm({ unitPrice: e.target.value })} placeholder="0.00" min="0" />
                </div>
                <div>
                  <label className={labelCls}>Total Cost (auto)</label>
                  <input type="number" className={inputCls} value={fuelForm.totalCost} onChange={e => setFuelForm(f => ({ ...f, totalCost: e.target.value }))} placeholder="0.00" min="0" />
                </div>
                <div>
                  <label className={labelCls}>Fuel Date <span className="text-red-500">*</span></label>
                  <input type="date" className={inputCls} value={fuelForm.fuelDate} onChange={e => updateFuelForm({ fuelDate: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>Vehicle ID</label>
                  <input className={inputCls} value={fuelForm.vehicleId} onChange={e => updateFuelForm({ vehicleId: e.target.value })} placeholder="Vehicle ID" />
                </div>
                <div>
                  <label className={labelCls}>Odometer Before</label>
                  <input type="number" className={inputCls} value={fuelForm.odometerBefore} onChange={e => updateFuelForm({ odometerBefore: e.target.value })} placeholder="km" min="0" />
                </div>
                <div>
                  <label className={labelCls}>Odometer After</label>
                  <input type="number" className={inputCls} value={fuelForm.odometerAfter} onChange={e => updateFuelForm({ odometerAfter: e.target.value })} placeholder="km" min="0" />
                </div>
                <div>
                  <label className={labelCls}>Notes</label>
                  <input className={inputCls} value={fuelForm.notes} onChange={e => updateFuelForm({ notes: e.target.value })} placeholder="Optional notes" />
                </div>
              </div>
              <div className="flex justify-end mt-4">
                <button onClick={handleAddFuel} disabled={savingFuel} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
                  {savingFuel ? 'Adding…' : 'Add Fuel Record'}
                </button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
