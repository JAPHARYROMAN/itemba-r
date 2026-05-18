'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, Btn, PageSpinner } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company { id: string; name: string; }

type ReportTab = 'profitability' | 'fleet' | 'fuel' | 'maintenance';

interface ProfitabilitySummary {
  totalRevenue: number;
  totalExpenses: number;
  totalFuelCost: number;
  netProfit: number;
  marginPercent: number;
  tripCount: number;
}
interface ProfitabilityTrip {
  id: string; tripNumber: string; origin: string; destination: string;
  vehiclePlate: string; driverName: string; tripDate: string | null;
  revenue: number; expenses: number; fuel: number; profit: number; margin: number;
}
interface FleetRow {
  vehicleCode: string; registrationNumber: string; currentOdometer: number;
  tripCount: number; totalRevenue: number; totalKmDriven: number; totalMaintenanceCost: number;
}
interface FuelRow {
  vehicleCode: string; registrationNumber: string;
  totalLitres: number; totalKm: number; litresPer100Km: number; totalFuelCost: number;
}
interface MaintenanceRow {
  vehicleId: string; vehicleCode: string; registrationNumber: string;
  nextServiceDate: string | null; nextServiceOdometer: number;
  currentOdometer: number; kmUntilService: number | null; status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

function fmtCurrency(n: number | string | null | undefined) {
  const value = Number(n ?? 0);
  return `TZS ${new Intl.NumberFormat('en-US').format(Math.round(Number.isFinite(value) ? value : 0))}`;
}
function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtNum(n: number, dec = 0) {
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function downloadCsv(filename: string, rows: string[][], headers: string[]) {
  const lines = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Tab button ───────────────────────────────────────────────────────────────

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
        active ? 'bg-white text-indigo-700 border border-b-white border-slate-200 -mb-px' : ''
      }`}
      style={!active ? { color: 'var(--aurora-text-muted)' } : {}}
    >
      {children}
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LogisticsReportsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [tab, setTab] = useState<ReportTab>('profitability');

  // Profitability
  const [profFrom, setProfFrom] = useState('');
  const [profTo, setProfTo] = useState('');
  const [profSummary, setProfSummary] = useState<ProfitabilitySummary | null>(null);
  const [profTrips, setProfTrips] = useState<ProfitabilityTrip[]>([]);
  const [profLoading, setProfLoading] = useState(false);
  const [profError, setProfError] = useState('');

  // Fleet
  const [fleetData, setFleetData] = useState<FleetRow[]>([]);
  const [fleetLoading, setFleetLoading] = useState(false);
  const [fleetError, setFleetError] = useState('');

  // Fuel
  const [fuelData, setFuelData] = useState<FuelRow[]>([]);
  const [fuelLoading, setFuelLoading] = useState(false);
  const [fuelError, setFuelError] = useState('');

  // Maintenance
  const [maintData, setMaintData] = useState<MaintenanceRow[]>([]);
  const [maintLoading, setMaintLoading] = useState(false);
  const [maintError, setMaintError] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then(r => r.json())
      .then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  // Auto-load maintenance when tab or company changes
  const loadMaintenance = useCallback(async (cid: string) => {
    if (!cid) return;
    setMaintLoading(true); setMaintError('');
    try {
      const res = await fetch(`/api/backend/logistics/dashboard/reports/maintenance-schedule?companyId=${cid}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setMaintData(Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : []);
    } catch (e: unknown) {
      setMaintError(e instanceof Error ? e.message : 'Error');
    } finally { setMaintLoading(false); }
  }, []);

  useEffect(() => {
    if (tab === 'maintenance' && companyId) loadMaintenance(companyId);
  }, [tab, companyId, loadMaintenance]);

  async function runProfitability() {
    if (!companyId) return;
    setProfLoading(true); setProfError('');
    try {
      const params = new URLSearchParams({ companyId });
      if (profFrom) params.set('from', profFrom);
      if (profTo) params.set('to', profTo);
      const res = await fetch(`/api/backend/logistics/dashboard/reports/trip-profitability?${params}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      const d = json.data ?? json;
      setProfSummary(d?.summary ?? null);
      setProfTrips(Array.isArray(d?.trips) ? d.trips : []);
    } catch (e: unknown) {
      setProfError(e instanceof Error ? e.message : 'Error');
    } finally { setProfLoading(false); }
  }

  async function runFleet() {
    if (!companyId) return;
    setFleetLoading(true); setFleetError('');
    try {
      const res = await fetch(`/api/backend/logistics/dashboard/reports/fleet-utilization?companyId=${companyId}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setFleetData(Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : []);
    } catch (e: unknown) {
      setFleetError(e instanceof Error ? e.message : 'Error');
    } finally { setFleetLoading(false); }
  }

  async function runFuel() {
    if (!companyId) return;
    setFuelLoading(true); setFuelError('');
    try {
      const res = await fetch(`/api/backend/logistics/dashboard/reports/fuel-efficiency?companyId=${companyId}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setFuelData(Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : []);
    } catch (e: unknown) {
      setFuelError(e instanceof Error ? e.message : 'Error');
    } finally { setFuelLoading(false); }
  }

  // CSV exports
  function exportProfitabilityCsv() {
    downloadCsv('trip-profitability.csv', profTrips.map(t => [
      t.tripNumber, t.origin, t.destination, t.vehiclePlate, t.driverName,
      fmtDate(t.tripDate), String(t.revenue), String(t.expenses), String(t.fuel), String(t.profit), String(t.margin),
    ]), ['Trip #', 'Origin', 'Destination', 'Vehicle', 'Driver', 'Date', 'Revenue', 'Expenses', 'Fuel', 'Profit', 'Margin %']);
  }
  function exportFleetCsv() {
    downloadCsv('fleet-utilization.csv', fleetData.map(r => [
      r.vehicleCode, r.registrationNumber, String(r.tripCount), String(r.totalRevenue), String(r.totalMaintenanceCost), String(r.totalKmDriven),
    ]), ['Vehicle Code', 'Plate', 'Trip Count', 'Total Revenue', 'Maintenance Cost', 'Km Driven']);
  }
  function exportFuelCsv() {
    downloadCsv('fuel-efficiency.csv', fuelData.map(r => [
      r.vehicleCode, r.registrationNumber, String(r.totalLitres), String(r.totalKm), String(r.litresPer100Km), String(r.totalFuelCost),
    ]), ['Vehicle Code', 'Plate', 'Total Litres', 'Total Km', 'L/100km', 'Total Fuel Cost']);
  }
  function exportMaintCsv() {
    downloadCsv('maintenance-schedule.csv', maintData.map(r => [
      r.vehicleCode, r.registrationNumber, fmtDate(r.nextServiceDate),
      String(r.nextServiceOdometer), String(r.currentOdometer),
      r.kmUntilService != null ? String(r.kmUntilService) : '—',
    ]), ['Vehicle Code', 'Plate', 'Next Service Date', 'Next Service Odometer', 'Current Odometer', 'Km Until Service']);
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const in7Days = new Date(today); in7Days.setDate(today.getDate() + 7);

  function maintRowClass(row: MaintenanceRow) {
    if (!row.nextServiceDate) return '';
    const d = new Date(row.nextServiceDate); d.setHours(0, 0, 0, 0);
    if (d < today) return 'bg-red-50';
    if (d <= in7Days) return 'bg-amber-50';
    return 'bg-emerald-50/30';
  }
  function maintStatusLabel(row: MaintenanceRow) {
    if (!row.nextServiceDate) return { label: 'No Date', cls: 'bg-slate-100 text-slate-500' };
    const d = new Date(row.nextServiceDate); d.setHours(0, 0, 0, 0);
    if (d < today) return { label: 'Overdue', cls: 'bg-red-100 text-red-700' };
    if (d <= in7Days) return { label: '< 7 Days', cls: 'bg-amber-100 text-amber-700' };
    return { label: 'Upcoming', cls: 'bg-emerald-100 text-emerald-700' };
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Logistics Reports" subtitle="Analytics & performance reports" />
        <select
          value={companyId}
          onChange={e => setCompanyId(e.target.value)}
          className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          style={{ color: 'var(--aurora-text)' }}
        >
          <option value="">— Select Company —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {!companyId && (
        <div className="text-center py-16 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to run reports</div>
      )}

      {companyId && (
        <>
          {/* Tabs */}
          <div className="flex gap-1 border-b border-slate-200">
            <TabBtn active={tab === 'profitability'} onClick={() => setTab('profitability')}>Trip Profitability</TabBtn>
            <TabBtn active={tab === 'fleet'} onClick={() => setTab('fleet')}>Fleet Utilization</TabBtn>
            <TabBtn active={tab === 'fuel'} onClick={() => setTab('fuel')}>Fuel Efficiency</TabBtn>
            <TabBtn active={tab === 'maintenance'} onClick={() => setTab('maintenance')}>Maintenance Schedule</TabBtn>
          </div>

          {/* ── Tab 1: Trip Profitability ── */}
          {tab === 'profitability' && (
            <div className="space-y-5">
              <Card className="p-4">
                <div className="flex flex-wrap gap-4 items-end">
                  <div>
                    <label className="block text-xs mb-1" style={{ color: 'var(--aurora-text-muted)' }}>From</label>
                    <input type="date" value={profFrom} onChange={e => setProfFrom(e.target.value)}
                      className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      style={{ color: 'var(--aurora-text)' }} />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: 'var(--aurora-text-muted)' }}>To</label>
                    <input type="date" value={profTo} onChange={e => setProfTo(e.target.value)}
                      className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      style={{ color: 'var(--aurora-text)' }} />
                  </div>
                  <Btn loading={profLoading} onClick={runProfitability}>Run Report</Btn>
                  {profTrips.length > 0 && (
                    <Btn variant="secondary" onClick={exportProfitabilityCsv}>Export CSV</Btn>
                  )}
                </div>
              </Card>

              {profError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{profError}</div>}
              {profLoading && <PageSpinner />}

              {profSummary && !profLoading && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card className="p-4">
                    <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--aurora-text-muted)' }}>Total Revenue</p>
                    <p className="text-xl font-bold text-emerald-600">{fmtCurrency(profSummary.totalRevenue)}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>{profSummary.tripCount} trips</p>
                  </Card>
                  <Card className="p-4">
                    <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--aurora-text-muted)' }}>Total Costs</p>
                    <p className="text-xl font-bold text-red-600">{fmtCurrency(profSummary.totalExpenses + profSummary.totalFuelCost)}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>Fuel: {fmtCurrency(profSummary.totalFuelCost)}</p>
                  </Card>
                  <Card className="p-4">
                    <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--aurora-text-muted)' }}>Net Profit</p>
                    <p className={`text-xl font-bold ${profSummary.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {fmtCurrency(profSummary.netProfit)}
                    </p>
                  </Card>
                  <Card className="p-4">
                    <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--aurora-text-muted)' }}>Margin %</p>
                    <p className={`text-xl font-bold ${profSummary.marginPercent >= 0 ? 'text-indigo-600' : 'text-red-600'}`}>
                      {fmtNum(profSummary.marginPercent, 1)}%
                    </p>
                  </Card>
                </div>
              )}

              {profTrips.length > 0 && !profLoading && (
                <Card className="p-0 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className={`${thCls} text-left`} style={{ color: 'var(--aurora-text-muted)' }}>Trip #</th>
                          <th className={`${thCls} text-left`} style={{ color: 'var(--aurora-text-muted)' }}>Route</th>
                          <th className={`${thCls} text-left`} style={{ color: 'var(--aurora-text-muted)' }}>Vehicle</th>
                          <th className={`${thCls} text-right`} style={{ color: 'var(--aurora-text-muted)' }}>Revenue</th>
                          <th className={`${thCls} text-right`} style={{ color: 'var(--aurora-text-muted)' }}>Expenses</th>
                          <th className={`${thCls} text-right`} style={{ color: 'var(--aurora-text-muted)' }}>Fuel</th>
                          <th className={`${thCls} text-right`} style={{ color: 'var(--aurora-text-muted)' }}>Profit</th>
                          <th className={`${thCls} text-right`} style={{ color: 'var(--aurora-text-muted)' }}>Margin %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {profTrips.map(t => (
                          <tr key={t.id} className="hover:bg-slate-50/50">
                            <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{t.tripNumber}</td>
                            <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{t.origin} → {t.destination}</td>
                            <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{t.vehiclePlate}</td>
                            <td className={`${tdCls} text-right text-emerald-700`}>{fmtCurrency(t.revenue)}</td>
                            <td className={`${tdCls} text-right text-red-600`}>{fmtCurrency(t.expenses)}</td>
                            <td className={`${tdCls} text-right text-amber-600`}>{fmtCurrency(t.fuel)}</td>
                            <td className={`${tdCls} text-right font-medium ${t.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmtCurrency(t.profit)}</td>
                            <td className={`${tdCls} text-right ${t.margin >= 0 ? 'text-indigo-600' : 'text-red-600'}`}>{fmtNum(t.margin, 1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* ── Tab 2: Fleet Utilization ── */}
          {tab === 'fleet' && (
            <div className="space-y-5">
              <Card className="p-4">
                <div className="flex gap-4">
                  <Btn loading={fleetLoading} onClick={runFleet}>Run Report</Btn>
                  {fleetData.length > 0 && <Btn variant="secondary" onClick={exportFleetCsv}>Export CSV</Btn>}
                </div>
              </Card>

              {fleetError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{fleetError}</div>}
              {fleetLoading && <PageSpinner />}

              {fleetData.length > 0 && !fleetLoading && (
                <Card className="p-0 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className={`${thCls} text-left`} style={{ color: 'var(--aurora-text-muted)' }}>Vehicle Code</th>
                          <th className={`${thCls} text-left`} style={{ color: 'var(--aurora-text-muted)' }}>Plate</th>
                          <th className={`${thCls} text-right`} style={{ color: 'var(--aurora-text-muted)' }}>Trip Count</th>
                          <th className={`${thCls} text-right`} style={{ color: 'var(--aurora-text-muted)' }}>Total Revenue</th>
                          <th className={`${thCls} text-right`} style={{ color: 'var(--aurora-text-muted)' }}>Maintenance Cost</th>
                          <th className={`${thCls} text-right`} style={{ color: 'var(--aurora-text-muted)' }}>Km Driven</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {fleetData.map(r => (
                          <tr key={r.vehicleCode} className="hover:bg-slate-50/50">
                            <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{r.vehicleCode}</td>
                            <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{r.registrationNumber}</td>
                            <td className={`${tdCls} text-right`} style={{ color: 'var(--aurora-text)' }}>{r.tripCount}</td>
                            <td className={`${tdCls} text-right text-emerald-700`}>{fmtCurrency(r.totalRevenue)}</td>
                            <td className={`${tdCls} text-right text-red-600`}>{fmtCurrency(r.totalMaintenanceCost)}</td>
                            <td className={`${tdCls} text-right`} style={{ color: 'var(--aurora-text)' }}>{fmtNum(r.totalKmDriven)} km</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* ── Tab 3: Fuel Efficiency ── */}
          {tab === 'fuel' && (
            <div className="space-y-5">
              <Card className="p-4">
                <div className="flex gap-4">
                  <Btn loading={fuelLoading} onClick={runFuel}>Run Report</Btn>
                  {fuelData.length > 0 && <Btn variant="secondary" onClick={exportFuelCsv}>Export CSV</Btn>}
                </div>
              </Card>

              {fuelError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{fuelError}</div>}
              {fuelLoading && <PageSpinner />}

              {fuelData.length > 0 && !fuelLoading && (
                <Card className="p-0 overflow-hidden">
                  <p className="px-5 py-2 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>Sorted worst efficiency first</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className={`${thCls} text-left`} style={{ color: 'var(--aurora-text-muted)' }}>Vehicle Code</th>
                          <th className={`${thCls} text-left`} style={{ color: 'var(--aurora-text-muted)' }}>Plate</th>
                          <th className={`${thCls} text-right`} style={{ color: 'var(--aurora-text-muted)' }}>Total Litres</th>
                          <th className={`${thCls} text-right`} style={{ color: 'var(--aurora-text-muted)' }}>Total Km</th>
                          <th className={`${thCls} text-right`} style={{ color: 'var(--aurora-text-muted)' }}>L/100km</th>
                          <th className={`${thCls} text-right`} style={{ color: 'var(--aurora-text-muted)' }}>Total Fuel Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {fuelData.map(r => (
                          <tr key={r.vehicleCode} className="hover:bg-slate-50/50">
                            <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{r.vehicleCode}</td>
                            <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{r.registrationNumber}</td>
                            <td className={`${tdCls} text-right`} style={{ color: 'var(--aurora-text)' }}>{fmtNum(r.totalLitres, 1)} L</td>
                            <td className={`${tdCls} text-right`} style={{ color: 'var(--aurora-text)' }}>{fmtNum(r.totalKm)} km</td>
                            <td className={`${tdCls} text-right font-medium ${r.litresPer100Km > 20 ? 'text-red-600' : r.litresPer100Km > 12 ? 'text-amber-600' : 'text-emerald-600'}`}>
                              {fmtNum(r.litresPer100Km, 2)}
                            </td>
                            <td className={`${tdCls} text-right`} style={{ color: 'var(--aurora-text)' }}>{fmtCurrency(r.totalFuelCost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* ── Tab 4: Maintenance Schedule ── */}
          {tab === 'maintenance' && (
            <div className="space-y-5">
              <Card className="p-4">
                <div className="flex gap-4">
                  <Btn loading={maintLoading} onClick={() => loadMaintenance(companyId)}>Refresh</Btn>
                  {maintData.length > 0 && <Btn variant="secondary" onClick={exportMaintCsv}>Export CSV</Btn>}
                </div>
              </Card>

              {maintError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{maintError}</div>}
              {maintLoading && <PageSpinner />}

              {maintData.length === 0 && !maintLoading && (
                <div className="text-center py-12 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No scheduled maintenance found</div>
              )}

              {maintData.length > 0 && !maintLoading && (
                <Card className="p-0 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className={`${thCls} text-left`} style={{ color: 'var(--aurora-text-muted)' }}>Vehicle Code</th>
                          <th className={`${thCls} text-left`} style={{ color: 'var(--aurora-text-muted)' }}>Plate</th>
                          <th className={`${thCls} text-left`} style={{ color: 'var(--aurora-text-muted)' }}>Next Service Date</th>
                          <th className={`${thCls} text-right`} style={{ color: 'var(--aurora-text-muted)' }}>Next Odometer</th>
                          <th className={`${thCls} text-right`} style={{ color: 'var(--aurora-text-muted)' }}>Current Odometer</th>
                          <th className={`${thCls} text-right`} style={{ color: 'var(--aurora-text-muted)' }}>Km Until Service</th>
                          <th className={`${thCls} text-left`} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {maintData.map(r => {
                          const s = maintStatusLabel(r);
                          return (
                            <tr key={`${r.vehicleId}-${r.nextServiceDate}`} className={`${maintRowClass(r)} hover:opacity-90`}>
                              <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{r.vehicleCode}</td>
                              <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{r.registrationNumber}</td>
                              <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(r.nextServiceDate)}</td>
                              <td className={`${tdCls} text-right`} style={{ color: 'var(--aurora-text)' }}>{r.nextServiceOdometer > 0 ? `${fmtNum(r.nextServiceOdometer)} km` : '—'}</td>
                              <td className={`${tdCls} text-right`} style={{ color: 'var(--aurora-text)' }}>{fmtNum(r.currentOdometer)} km</td>
                              <td className={`${tdCls} text-right`} style={{ color: 'var(--aurora-text)' }}>{r.kmUntilService != null ? `${fmtNum(r.kmUntilService)} km` : '—'}</td>
                              <td className={tdCls}>
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${s.cls}`}>{s.label}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
