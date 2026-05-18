'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

const fmtCurrency = (n: number | string | null | undefined) => { const value = Number(n ?? 0); return `TZS ${new Intl.NumberFormat('en-US').format(Math.round(Number.isFinite(value) ? value : 0))}`; };
const fmtNum = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n * 100) / 100);
const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

function Spinner() {
  return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;
}
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

function exportCSV(data: any[], filename: string) {
  if (!data.length) return;
  const keys = Object.keys(data[0]);
  const rows = [keys.join(','), ...data.map(row => keys.map(k => JSON.stringify(row[k] ?? '')).join(','))].join('\n');
  const blob = new Blob([rows], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

interface Company { id: string; name: string; }

type ReportTab = 'profitability' | 'yield' | 'inputs' | 'labor';

export default function AgricultureReportsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [tab, setTab] = useState<ReportTab>('profitability');
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [reportData, setReportData] = useState<any[]>([]);
  const [reportSummary, setReportSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const runReport = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError(''); setReportData([]); setReportSummary(null);
    try {
      let url = '';
      if (tab === 'profitability') url = `/api/backend/agriculture/dashboard/reports/season-profitability?companyId=${companyId}&year=${year}`;
      else if (tab === 'yield') url = `/api/backend/agriculture/dashboard/reports/yield-analysis?companyId=${companyId}`;
      else if (tab === 'inputs') url = `/api/backend/agriculture/dashboard/reports/input-cost?companyId=${companyId}`;
      else if (tab === 'labor') url = `/api/backend/agriculture/dashboard/reports/labor-cost?companyId=${companyId}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load report');
      const json = await res.json();
      const d = json.data ?? json;
      if (Array.isArray(d)) {
        setReportData(d);
      } else {
        setReportData(d.items ?? []);
        setReportSummary(d);
      }
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId, tab, year]);

  const tabs: { id: ReportTab; label: string; icon: string }[] = [
    { id: 'profitability', label: 'Season Profitability', icon: '📈' },
    { id: 'yield', label: 'Yield Analysis', icon: '🌾' },
    { id: 'inputs', label: 'Input Cost Breakdown', icon: '🧪' },
    { id: 'labor', label: 'Labor Cost', icon: '👷' },
  ];

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Agriculture Reports" subtitle="Profitability, yield, cost and labor analytics" />
        <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
          <option value="">— Select Company —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {!companyId && <div className="text-center py-10 text-sm text-slate-400">Select a company to run reports.</div>}

      {companyId && (
        <>
          {/* Tab nav */}
          <div className="flex gap-2 flex-wrap">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2 text-sm rounded-md font-medium transition-colors ${tab === t.id ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* Filters */}
          <Card className="p-4">
            <div className="flex items-end gap-4 flex-wrap">
              {tab === 'profitability' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Year</label>
                  <select value={year} onChange={e => setYear(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                    {[2026, 2025, 2024, 2023].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              )}
              <button onClick={runReport} disabled={loading} className="px-5 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-60 font-medium">
                {loading ? 'Running…' : 'Run Report'}
              </button>
              {reportData.length > 0 && (
                <button onClick={() => exportCSV(reportData, `agriculture-${tab}-report.csv`)} className="px-4 py-2 border border-slate-200 text-sm rounded-md text-slate-600 hover:bg-slate-50 font-medium">
                  Export CSV
                </button>
              )}
            </div>
          </Card>

          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
          {loading && <Spinner />}

          {/* Report results */}
          {!loading && reportData.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 font-semibold text-sm text-slate-700 flex items-center justify-between">
                <span>{tabs.find(t => t.id === tab)?.label}</span>
                <span className="text-xs font-normal text-slate-500">{reportData.length} records</span>
              </div>
              <div className="overflow-x-auto">
                {tab === 'profitability' && (
                  <>
                    {reportSummary && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-slate-100">
                        <div className="bg-slate-50 rounded-lg p-3 text-center">
                          <div className="text-xs text-slate-500 mb-1">Seasons</div>
                          <div className="text-xl font-bold text-slate-800">{reportData.length}</div>
                        </div>
                        <div className="bg-red-50 rounded-lg p-3 text-center">
                          <div className="text-xs text-red-600 mb-1">Total Cost</div>
                          <div className="text-lg font-bold text-red-700">{fmtCurrency(reportData.reduce((s: number, r: any) => s + (Number(r.actualCost ?? 0) || 0), 0))}</div>
                        </div>
                        <div className="bg-emerald-50 rounded-lg p-3 text-center">
                          <div className="text-xs text-emerald-600 mb-1">Total Revenue</div>
                          <div className="text-lg font-bold text-emerald-700">{fmtCurrency(reportData.reduce((s: number, r: any) => s + (Number(r.revenue ?? 0) || 0), 0))}</div>
                        </div>
                        <div className="bg-blue-50 rounded-lg p-3 text-center">
                          <div className="text-xs text-blue-600 mb-1">Net Profit</div>
                          <div className="text-lg font-bold text-blue-700">{fmtCurrency(reportData.reduce((s: number, r: any) => s + (Number(r.profit ?? 0) || 0), 0))}</div>
                        </div>
                      </div>
                    )}
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className={thCls}>Season</th><th className={thCls}>Crop</th><th className={thCls}>Farm</th>
                          <th className={thCls}>Budget</th><th className={thCls}>Actual Cost</th><th className={thCls}>Revenue</th>
                          <th className={thCls}>Profit</th><th className={thCls}>Margin %</th><th className={thCls}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.map((r: any) => (
                          <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                            <td className={`${tdCls} font-medium`}>{r.seasonName}</td>
                            <td className={tdCls}>{r.cropName}</td>
                            <td className={tdCls}>{r.farmName}</td>
                            <td className={tdCls}>{fmtCurrency(r.budgetAmount)}</td>
                            <td className={tdCls}>{fmtCurrency(r.actualCost)}</td>
                            <td className={`${tdCls} text-emerald-700 font-medium`}>{fmtCurrency(r.revenue)}</td>
                            <td className={`${tdCls} font-medium ${r.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmtCurrency(r.profit)}</td>
                            <td className={`${tdCls} font-medium ${r.marginPercent >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{r.marginPercent}%</td>
                            <td className={tdCls}><span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-600">{r.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {tab === 'yield' && (
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        <th className={thCls}>#</th><th className={thCls}>Farm</th><th className={thCls}>Crop</th>
                        <th className={thCls}>Quantity</th><th className={thCls}>Quality Grade</th><th className={thCls}>Est. Value</th><th className={thCls}>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.map((r: any) => (
                        <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className={`${tdCls} text-indigo-600 font-medium`}>{r.harvestNumber}</td>
                          <td className={tdCls}>{r.farmName}</td>
                          <td className={tdCls}>{r.cropName}</td>
                          <td className={`${tdCls} font-medium`}>{fmtNum(r.quantity)}</td>
                          <td className={tdCls}>{r.qualityGrade || '—'}</td>
                          <td className={`${tdCls} text-emerald-700 font-medium`}>{fmtCurrency(r.estimatedTotalValue)}</td>
                          <td className={tdCls}>{fmtDate(r.harvestDate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {tab === 'inputs' && (
                  <>
                    {reportSummary && (
                      <div className="p-4 border-b border-slate-100 space-y-2">
                        <div className="font-semibold text-sm text-slate-700 mb-2">Cost by Type</div>
                        <div className="flex flex-wrap gap-3">
                          {reportSummary.summary?.map((s: any) => (
                            <div key={s.applicationType} className="bg-slate-50 rounded-lg px-3 py-2 text-sm">
                              <span className="font-medium text-slate-700">{s.applicationType}</span>
                              <span className="text-slate-500 ml-2">{s.count} records — {fmtCurrency(s.totalCost)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="text-sm font-semibold text-slate-700">Grand Total: {fmtCurrency(reportSummary.grandTotal ?? 0)}</div>
                      </div>
                    )}
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className={thCls}>#</th><th className={thCls}>Type</th><th className={thCls}>Farm</th>
                          <th className={thCls}>Crop/Season</th><th className={thCls}>Date</th><th className={thCls}>Qty</th><th className={thCls}>Total Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.map((r: any) => (
                          <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                            <td className={`${tdCls} text-indigo-600 font-medium`}>{r.applicationNumber}</td>
                            <td className={tdCls}>{r.applicationType}</td>
                            <td className={tdCls}>{r.farmName}</td>
                            <td className={tdCls}>{r.cropName || '—'}</td>
                            <td className={tdCls}>{fmtDate(r.applicationDate)}</td>
                            <td className={tdCls}>{fmtNum(r.quantity)}</td>
                            <td className={`${tdCls} font-medium`}>{fmtCurrency(r.totalCost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {tab === 'labor' && (
                  <>
                    {reportSummary && (
                      <div className="p-4 border-b border-slate-100">
                        <div className="font-semibold text-sm text-slate-700 mb-2">Grand Total Labor Cost: {fmtCurrency(reportSummary.grandTotal ?? 0)}</div>
                      </div>
                    )}
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className={thCls}>#</th><th className={thCls}>Worker</th><th className={thCls}>Role</th>
                          <th className={thCls}>Date</th><th className={thCls}>Hours</th><th className={thCls}>Total</th><th className={thCls}>Payment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.map((r: any) => (
                          <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                            <td className={`${tdCls} text-indigo-600 font-medium`}>{r.laborRecordNumber}</td>
                            <td className={`${tdCls} font-medium`}>{r.workerName || '—'}</td>
                            <td className={tdCls}>{r.role || '—'}</td>
                            <td className={tdCls}>{fmtDate(r.laborDate)}</td>
                            <td className={tdCls}>{r.hoursWorked ?? '—'}</td>
                            <td className={`${tdCls} font-medium`}>{fmtCurrency(r.totalAmount)}</td>
                            <td className={tdCls}><span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-600">{r.paymentStatus}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            </Card>
          )}

          {!loading && reportData.length === 0 && !error && (
            <div className="text-center py-12 text-sm text-slate-400">Select a report type and click Run Report.</div>
          )}
        </>
      )}
    </div>
  );
}
