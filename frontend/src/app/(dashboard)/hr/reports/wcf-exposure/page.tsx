'use client';

import { useEffect, useMemo, useState } from 'react';
import { Btn, Card, FormSelect, PageHeader, PageSpinner } from '@/components/ui';

interface Company { id: string; name: string; code: string }

interface MonthlyExposure {
  month: number;
  gross: number;
  wcfAmount: number;
  employees: number;
}

interface BranchRow {
  branchId: string | null;
  branchName: string;
  branchCode: string | null;
  region?: string | null;
  monthlyExposure: MonthlyExposure[];
  totalGross: number;
  totalWcf: number;
  totalEmployees: number;
}

interface ExposureReport {
  header: {
    companyName: string;
    companyTin: string | null;
    year: number;
    fromMonth: number;
    toMonth: number;
    periodLabel: string;
  };
  summary: { branchCount: number; totalGross: number; totalWcf: number; effectiveRate: number };
  branches: BranchRow[];
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-TZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function monthShort(m: number): string {
  return new Date(2000, m - 1, 1).toLocaleDateString('en-GB', { month: 'short' });
}

export default function WcfExposurePage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [fromMonth, setFromMonth] = useState('1');
  const [toMonth, setToMonth] = useState(String(now.getMonth() + 1));
  const [data, setData] = useState<ExposureReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const yearOptions = useMemo(() => {
    const cy = now.getFullYear();
    return Array.from({ length: 8 }, (_, i) => String(cy - 5 + i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const monthOptions = useMemo(() =>
    Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: new Date(2000, i, 1).toLocaleDateString('en-GB', { month: 'long' }) })),
    [],
  );

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json())
      .then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []))
      .catch(() => setCompanies([]));
  }, []);

  const load = async () => {
    if (!companyId) { setError('Pick a company first.'); return; }
    if (Number(fromMonth) > Number(toMonth)) { setError('From month must be ≤ to month.'); return; }
    setError(''); setLoading(true); setData(null);
    try {
      const params = new URLSearchParams({ companyId, year, fromMonth, toMonth });
      const res = await fetch(`/api/backend/hr/wcf-audit/exposure?${params}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? 'Failed'));
      }
      const j = await res.json();
      setData(j.data ?? j);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  // Build the month list for the header column (stable order based on filter).
  const monthsInRange = useMemo(() => {
    if (!data) return [] as number[];
    const arr: number[] = [];
    for (let m = data.header.fromMonth; m <= data.header.toMonth; m++) arr.push(m);
    return arr;
  }, [data]);

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="WCF Exposure Register"
        subtitle="Workers Compensation Fund — wage exposure per branch per month, for audit and rate verification."
        breadcrumbs={[{ label: 'HR', href: '/hr' }, { label: 'Reports', href: '/hr/reports' }, { label: 'WCF Exposure' }]}
      />

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <FormSelect label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}
            options={companies.map(c => ({ value: c.id, label: `${c.name} (${c.code})` }))}
            placeholder="Select company"
          />
          <FormSelect label="Year" value={year} onChange={(e) => setYear(e.target.value)}
            options={yearOptions.map(y => ({ value: y, label: y }))}
          />
          <FormSelect label="From month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)}
            options={monthOptions}
          />
          <FormSelect label="To month" value={toMonth} onChange={(e) => setToMonth(e.target.value)}
            options={monthOptions}
          />
          <div>
            <Btn variant="primary" onClick={load} loading={loading} disabled={!companyId}>Generate</Btn>
          </div>
        </div>
      </Card>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading && <PageSpinner />}

      {!loading && data && (
        <>
          <Card className="p-4">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Workers Compensation Fund — Exposure Register</div>
                <div className="text-sm font-semibold mt-1">{data.header.companyName}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {data.header.companyTin && <>TIN: {data.header.companyTin} · </>}
                  Period: {data.header.periodLabel}
                </div>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryTile label="Branches with payroll" value={String(data.summary.branchCount)} />
            <SummaryTile label="Total gross emoluments (TZS)" value={fmt(data.summary.totalGross)} />
            <SummaryTile label="Total WCF contribution (TZS)" value={fmt(data.summary.totalWcf)} />
            <SummaryTile label="Effective rate" value={`${(data.summary.effectiveRate * 100).toFixed(2)}%`} />
          </div>

          {data.branches.length === 0 ? (
            <Card className="p-10 text-center text-sm text-slate-400">
              No WCF contributions recorded in this period. Make sure payroll runs are calculated and at least one employee has a WCF rule applied.
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100" style={{ color: 'var(--aurora-text-muted)' }}>
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">Branch / Location</th>
                      {monthsInRange.map(m => (
                        <th key={m} className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide" colSpan={2}>
                          {monthShort(m)} {data.header.year}
                        </th>
                      ))}
                      <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide" colSpan={3}>Total</th>
                    </tr>
                    <tr className="bg-slate-50 text-[10px] text-slate-400">
                      <th></th>
                      {monthsInRange.map(m => (
                        <>
                          <th key={`gross-${m}`} className="px-3 py-1 text-right">Gross</th>
                          <th key={`wcf-${m}`} className="px-3 py-1 text-right">WCF</th>
                        </>
                      ))}
                      <th className="px-3 py-1 text-right">Employees</th>
                      <th className="px-3 py-1 text-right">Gross</th>
                      <th className="px-3 py-1 text-right">WCF</th>
                    </tr>
                  </thead>
                  <tbody style={{ color: 'var(--aurora-text)' }}>
                    {data.branches.map(b => {
                      const monthMap = new Map(b.monthlyExposure.map(m => [m.month, m]));
                      return (
                        <tr key={b.branchId ?? 'unassigned'} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="px-4 py-2">
                            <span className="font-medium">{b.branchName}</span>
                            {b.branchCode && <span className="ml-2 text-xs font-mono text-slate-500">{b.branchCode}</span>}
                            {b.region && <div className="text-xs text-slate-400">{b.region}</div>}
                          </td>
                          {monthsInRange.map(m => {
                            const mm = monthMap.get(m);
                            return (
                              <>
                                <td key={`g-${m}-${b.branchId}`} className="px-3 py-2 text-right tabular-nums text-xs">{mm ? fmt(mm.gross) : '—'}</td>
                                <td key={`w-${m}-${b.branchId}`} className="px-3 py-2 text-right tabular-nums text-xs">{mm ? fmt(mm.wcfAmount) : '—'}</td>
                              </>
                            );
                          })}
                          <td className="px-3 py-2 text-right tabular-nums text-xs">{b.totalEmployees}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(b.totalGross)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(b.totalWcf)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-slate-100 border-t border-slate-200">
                    <tr>
                      <td className="px-4 py-2 text-xs font-semibold">All branches</td>
                      {monthsInRange.map(m => {
                        const monthGross = data.branches.reduce((s, b) => s + (b.monthlyExposure.find(x => x.month === m)?.gross ?? 0), 0);
                        const monthWcf = data.branches.reduce((s, b) => s + (b.monthlyExposure.find(x => x.month === m)?.wcfAmount ?? 0), 0);
                        return (
                          <>
                            <td key={`tg-${m}`} className="px-3 py-2 text-right tabular-nums text-xs">{fmt(monthGross)}</td>
                            <td key={`tw-${m}`} className="px-3 py-2 text-right tabular-nums text-xs">{fmt(monthWcf)}</td>
                          </>
                        );
                      })}
                      <td className="px-3 py-2 text-right text-xs"></td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold">{fmt(data.summary.totalGross)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold">{fmt(data.summary.totalWcf)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {!loading && !data && !error && (
        <div className="text-center py-12 text-sm text-slate-400">
          Pick a company, year and month range, then click <strong>Generate</strong>.
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </Card>
  );
}
