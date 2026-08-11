'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, PageHeader, FormInput, FormSelect, Btn } from '@/components/ui';

// ── Types mirroring the backend responses ────────────────────────────────────
interface Company { id: string; name: string; code: string; }

interface FilingPeriod {
  id: string;
  filingPeriodCode: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  dueDate?: string | null;
  status: 'OPEN' | 'PREPARED' | 'SUBMITTED' | 'PAID' | 'CLOSED' | 'OVERDUE' | 'CANCELLED';
  taxType: { id: string; taxTypeCode: string; name: string };
  taxReturns: TaxReturn[];
}

interface TaxReturn {
  id: string;
  taxReturnNumber: string;
  status: string;
  taxPayable: number | string;
  taxRecoverable: number | string;
  netTaxDue: number | string;
  totalDue: number | string;
  outstandingAmount: number | string;
  amountPaid: number | string;
}

interface ComputeResult {
  taxReturnId?: string;
  taxReturnNumber?: string;
  notSupported?: boolean;
  reason?: string;
  taxTypeCode: string;
  taxableAmount: number;
  taxPayable: number;
  taxRecoverable: number;
  netTaxDue: number;
  lines: { label: string; amount: number; basis?: number }[];
  assumptions?: string[];
}

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

interface Anomaly {
  severity: Severity;
  category: string;
  code: string;
  message: string;
  entityType?: string;
  entityId?: string;
  companyId?: string;
  suggestedAction?: string;
}

interface AnomalyResponse {
  asOf: string;
  total: number;
  bySeverity: Record<Severity, number>;
  anomalies: Anomaly[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtNumber = (n: number | string | undefined | null): string => {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-GB', { maximumFractionDigits: 2 });
};
const fmtDate = (s?: string | null): string => (s ? new Date(s).toLocaleDateString('en-GB') : '—');
const daysFromNow = (s?: string | null): number | null => {
  if (!s) return null;
  return Math.ceil((new Date(s).getTime() - Date.now()) / (24 * 3600 * 1000));
};

const SEVERITY_META: Record<Severity, { label: string; color: string; dot: string }> = {
  CRITICAL: { label: 'Critical', color: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
  HIGH: { label: 'High', color: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  MEDIUM: { label: 'Medium', color: 'bg-sky-50 text-sky-700 border-sky-200', dot: 'bg-sky-500' },
  LOW: { label: 'Low', color: 'bg-zinc-100 text-zinc-700 border-zinc-200', dot: 'bg-zinc-400' },
};

const STATUS_META: Record<string, string> = {
  OPEN: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  PREPARED: 'bg-sky-50 text-sky-700 border-sky-200',
  SUBMITTED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  PAID: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CLOSED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  OVERDUE: 'bg-red-50 text-red-700 border-red-200',
  CANCELLED: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  DRAFT: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  APPROVED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  REVIEWED: 'bg-violet-50 text-violet-700 border-violet-200',
};

function trafficLight(period: FilingPeriod): 'green' | 'amber' | 'red' | 'gray' {
  if (period.status === 'PAID' || period.status === 'CLOSED') return 'green';
  if (period.status === 'CANCELLED') return 'gray';
  const days = daysFromNow(period.dueDate);
  if (days === null) return 'gray';
  if (days < 0) return 'red';
  if (days <= 7) return 'amber';
  return 'green';
}

const TRAFFIC_DOT: Record<'green' | 'amber' | 'red' | 'gray', string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  gray: 'bg-zinc-300',
};

// ── Page ─────────────────────────────────────────────────────────────────────
export default function ComplianceCockpitPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [periods, setPeriods] = useState<FilingPeriod[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [computing, setComputing] = useState<string | null>(null);
  const [drillDown, setDrillDown] = useState<ComputeResult | null>(null);
  const [autoApplyType, setAutoApplyType] = useState<'sales-order' | 'purchase-order'>('sales-order');
  const [autoApplyId, setAutoApplyId] = useState('');
  const [autoApplying, setAutoApplying] = useState(false);

  // Load companies once.
  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => {
        const inner = j.data?.data ?? j.data;
        const rows: Company[] = Array.isArray(inner) ? inner : Array.isArray(inner?.data) ? inner.data : [];
        setCompanies(rows);
      })
      // Without companies the cockpit cannot load anything, so surface the failure.
      .catch(() => setError('Failed to load companies. Refresh the page to try again.'));
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError(''); setInfo('');
    try {
      const [periodsRes, anomaliesRes] = await Promise.all([
        fetch(`/api/backend/tax/filing-periods?companyId=${companyId}&limit=50`),
        fetch(`/api/backend/tax-anomalies/scan?companyId=${companyId}`),
      ]);
      if (!periodsRes.ok) throw new Error(`Filing periods: HTTP ${periodsRes.status}`);
      if (!anomaliesRes.ok) throw new Error(`Anomalies: HTTP ${anomaliesRes.status}`);

      const periodsJson = await periodsRes.json();
      const periodsInner = periodsJson.data?.data ?? periodsJson.data ?? periodsJson;
      const periodRows: FilingPeriod[] = Array.isArray(periodsInner)
        ? periodsInner
        : Array.isArray(periodsInner?.data) ? periodsInner.data : Array.isArray(periodsInner?.items) ? periodsInner.items : [];
      // Sort by dueDate ascending so what's most pressing is at the top.
      periodRows.sort((a, b) => {
        const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return da - db;
      });
      setPeriods(periodRows);

      const anomJson = await anomaliesRes.json();
      const anomData: AnomalyResponse = anomJson.data ?? anomJson;
      setAnomalies(anomData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cockpit');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const computeReturn = async (periodId: string) => {
    setComputing(periodId); setError(''); setInfo('');
    try {
      const res = await fetch(`/api/backend/tax-filing-engine/compute/${periodId}`, { method: 'POST' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      const data: ComputeResult = json.data ?? json;
      if (data.notSupported) {
        setError(data.reason ?? 'Tax category not supported by the engine');
      } else {
        setInfo(`Drafted ${data.taxReturnNumber} — net due ${fmtNumber(data.netTaxDue)} TZS.`);
        setDrillDown(data);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compute');
    } finally {
      setComputing(null);
    }
  };

  const previewReturn = async (periodId: string) => {
    setError(''); setInfo('');
    try {
      const res = await fetch(`/api/backend/tax-filing-engine/preview/${periodId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const data: ComputeResult = json.data ?? json;
      if (data.notSupported) {
        setError(data.reason ?? 'Tax category not supported by the engine');
      } else {
        setDrillDown(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview');
    }
  };

  const runAutoApply = async () => {
    if (!autoApplyId.trim()) {
      setError('Enter the sales order or purchase order ID to apply tax to');
      return;
    }
    setAutoApplying(true); setError(''); setInfo('');
    try {
      const res = await fetch(`/api/backend/tax-auto-apply/${autoApplyType}/${autoApplyId.trim()}`, { method: 'POST' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message ?? `HTTP ${res.status}`);
      }
      setInfo('Tax auto-apply completed for the selected source document.');
      setAutoApplyId('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to auto-apply tax');
    } finally {
      setAutoApplying(false);
    }
  };

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    let computedTotal = 0;
    let declaredTotal = 0;
    let paidTotal = 0;
    let outstandingTotal = 0;
    for (const p of periods) {
      for (const r of p.taxReturns ?? []) {
        const due = Number(r.netTaxDue ?? 0);
        const paid = Number(r.amountPaid ?? 0);
        const out = Number(r.outstandingAmount ?? 0);
        declaredTotal += due;
        paidTotal += paid;
        outstandingTotal += out;
        if (r.status !== 'CANCELLED') computedTotal += due;
      }
    }
    return { computedTotal, declaredTotal, paidTotal, outstandingTotal };
  }, [periods]);

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Tax Cockpit"
        subtitle="Per-period filing status, computed amounts, and anomalies that need attention."
        breadcrumbs={[{ label: 'Compliance', href: '/compliance' }, { label: 'Cockpit' }]}
        actions={
          <div className="flex items-center gap-2">
            <Btn variant="secondary" onClick={load} disabled={!companyId || loading}>Reload</Btn>
          </div>
        }
      />

      <Card className="p-4">
        <FormSelect
          label="Company"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          required
          placeholder="— Select Company —"
          options={companies.map((c) => ({ value: c.id, label: c.name }))}
        />
      </Card>

      <Card className="p-4">
        <div className="grid md:grid-cols-[220px_minmax(0,1fr)_auto] gap-3 items-end">
          <FormSelect
            label="Tax Auto Apply"
            value={autoApplyType}
            onChange={(e) => setAutoApplyType(e.target.value as 'sales-order' | 'purchase-order')}
          >
            <option value="sales-order">Sales Order</option>
            <option value="purchase-order">Purchase Order</option>
          </FormSelect>
          <FormInput
            label="Source Document ID"
            value={autoApplyId}
            onChange={(e) => setAutoApplyId(e.target.value)}
            placeholder="Paste the order ID"
          />
          <Btn variant="secondary" onClick={runAutoApply} loading={autoApplying}>Run Auto Apply</Btn>
        </div>
      </Card>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {info && <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-700">{info}</div>}
      {loading && <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>}

      {!loading && companyId && (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-4">
              <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Declared (returns)</div>
              <div className="text-xl font-semibold text-slate-800 tabular-nums">{fmtNumber(kpis.declaredTotal)}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">TZS, sum of netTaxDue across drafts + above</div>
            </Card>
            <Card className="p-4">
              <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Paid</div>
              <div className="text-xl font-semibold text-emerald-700 tabular-nums">{fmtNumber(kpis.paidTotal)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Outstanding</div>
              <div className="text-xl font-semibold text-amber-700 tabular-nums">{fmtNumber(kpis.outstandingTotal)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Anomalies</div>
              <div className="text-xl font-semibold text-slate-800 tabular-nums">{anomalies?.total ?? 0}</div>
              {anomalies && anomalies.total > 0 && (
                <div className="flex items-center gap-2 mt-1 text-[11px]">
                  {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as Severity[]).map((s) => (
                    anomalies.bySeverity[s] > 0 && (
                      <span key={s} className="inline-flex items-center gap-1 text-slate-600">
                        <span className={`w-1.5 h-1.5 rounded-full ${SEVERITY_META[s].dot}`} />
                        {anomalies.bySeverity[s]} {SEVERITY_META[s].label.toLowerCase()}
                      </span>
                    )
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Filing periods grid */}
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Filing periods</div>
              <div className="text-[11px] text-slate-400">{periods.length} period{periods.length === 1 ? '' : 's'}</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="px-3 py-2 w-6"></th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Tax Type</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Period</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Due</th>
                    <th className="px-3 py-2 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Net Due (TZS)</th>
                    <th className="px-3 py-2 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Outstanding</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Period Status</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Return</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {periods.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">No filing periods configured for this company. Create some in <a href="/compliance/tax-filing-periods" className="text-indigo-600 hover:underline">Tax Filing Periods</a>.</td></tr>
                  ) : periods.map((p) => {
                    const tl = trafficLight(p);
                    const latestReturn = (p.taxReturns ?? [])[0];
                    const days = daysFromNow(p.dueDate);
                    return (
                      <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-3 py-2"><span className={`inline-block w-2 h-2 rounded-full ${TRAFFIC_DOT[tl]}`} title={`Traffic light: ${tl}`} /></td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-800">{p.taxType.name}</div>
                          <div className="text-[11px] text-slate-400 font-mono">{p.taxType.taxTypeCode}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          <div>{p.name}</div>
                          <div className="text-[11px] text-slate-400">{fmtDate(p.periodStart)} – {fmtDate(p.periodEnd)}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          <div>{fmtDate(p.dueDate)}</div>
                          {days !== null && (
                            <div className={`text-[11px] ${days < 0 ? 'text-red-600' : days <= 7 ? 'text-amber-600' : 'text-slate-400'}`}>
                              {days < 0 ? `${-days}d overdue` : days === 0 ? 'today' : `in ${days}d`}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {latestReturn ? fmtNumber(latestReturn.netTaxDue) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {latestReturn ? fmtNumber(latestReturn.outstandingAmount) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center px-2 py-0.5 border rounded-full text-[10px] font-medium ${STATUS_META[p.status] ?? STATUS_META.OPEN}`}>{p.status}</span>
                        </td>
                        <td className="px-3 py-2">
                          {latestReturn ? (
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center px-2 py-0.5 border rounded-full text-[10px] font-medium ${STATUS_META[latestReturn.status] ?? STATUS_META.DRAFT}`}>{latestReturn.status}</span>
                              <span className="text-[11px] text-slate-400 font-mono">{latestReturn.taxReturnNumber}</span>
                            </div>
                          ) : <span className="text-[11px] text-slate-400">No return yet</span>}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button
                            onClick={() => previewReturn(p.id)}
                            className="text-xs text-slate-600 hover:underline mr-3"
                          >Preview</button>
                          <button
                            onClick={() => computeReturn(p.id)}
                            disabled={computing === p.id}
                            className="text-xs text-indigo-600 hover:underline disabled:opacity-50"
                          >
                            {computing === p.id ? 'Drafting…' : latestReturn ? 'Recompute' : 'Draft return'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Anomalies panel */}
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">What needs attention</div>
              <div className="text-[11px] text-slate-400">scanned {anomalies?.asOf ? new Date(anomalies.asOf).toLocaleTimeString() : '—'}</div>
            </div>
            <div className="divide-y divide-slate-50">
              {!anomalies || anomalies.anomalies.length === 0 ? (
                <div className="p-10 text-center text-sm text-slate-400">No anomalies — all checks passed for this company.</div>
              ) : anomalies.anomalies.map((a, i) => (
                <div key={i} className="px-4 py-3 flex items-start gap-3">
                  <span className={`inline-flex items-center px-1.5 py-0.5 border rounded text-[10px] font-semibold uppercase tracking-wide ${SEVERITY_META[a.severity].color} flex-shrink-0 mt-0.5`}>
                    {SEVERITY_META[a.severity].label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-800">{a.message}</div>
                    {a.suggestedAction && <div className="text-[12px] text-slate-500 mt-0.5">→ {a.suggestedAction}</div>}
                    <div className="text-[10px] text-slate-400 font-mono mt-1">{a.code}{a.entityType && ` · ${a.entityType}:${a.entityId?.slice(0, 8)}`}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Drill-down modal */}
          {drillDown && (
            <Card className="p-5 border border-indigo-200 bg-indigo-50/30">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">{drillDown.taxReturnNumber ? `Return ${drillDown.taxReturnNumber}` : `${drillDown.taxTypeCode} preview`}</div>
                  <div className="text-sm text-slate-600">{drillDown.taxTypeCode} computed totals</div>
                </div>
                <button onClick={() => setDrillDown(null)} className="text-xs text-slate-500 hover:text-slate-700">Close</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {drillDown.lines.map((l, i) => (
                      <tr key={i} className="border-b border-indigo-100/70 last:border-b-0">
                        <td className="py-1.5 text-slate-700">{l.label}</td>
                        {l.basis !== undefined && <td className="py-1.5 text-right text-slate-500 tabular-nums">basis {fmtNumber(l.basis)}</td>}
                        <td className="py-1.5 text-right tabular-nums font-medium text-slate-800">{fmtNumber(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {drillDown.assumptions && drillDown.assumptions.length > 0 && (
                <div className="mt-3 text-[11px] text-slate-500 border-t border-indigo-100 pt-2 space-y-1">
                  <div className="font-semibold uppercase tracking-wide text-[10px]">Assumptions</div>
                  {drillDown.assumptions.map((a, i) => <div key={i}>• {a}</div>)}
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
