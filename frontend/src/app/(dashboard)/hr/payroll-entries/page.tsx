'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, PageHeader, StatusBadge } from '@/components/ui';

const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

interface PayrollEntry {
  id: string;
  employee?: string;
  employeeId?: string;
  basePay?: number;
  totalAllowances?: number;
  grossPay?: number;
  totalDeductions?: number;
  netPay?: number;
  status: string;
}

function PayrollEntriesContent() {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<PayrollEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [runFilter, setRunFilter] = useState(searchParams.get('runId') ?? '');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (runFilter) params.set('runId', runFilter);
    const r = await fetch(`/api/backend/hr/payroll-entries?${params}`);
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  }, [runFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const fmt = (n?: number) => (n != null ? `TZS ${(Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-TZ') : '0')}` : '—');

  return (
    <div className="p-6">
      <PageHeader title="Payroll Entries" subtitle="Employee payroll line items per run" />

      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Filter by payroll run ID…"
          value={runFilter}
          onChange={(e) => setRunFilter(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 w-56 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
        <button
          onClick={load}
          className="px-4 py-2 text-sm border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
        >
          Search
        </button>
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls}>Employee</th>
                  <th className={thCls}>Base Pay</th>
                  <th className={thCls}>Allowances</th>
                  <th className={thCls}>Gross Pay</th>
                  <th className={thCls}>Deductions</th>
                  <th className={thCls}>Net Pay</th>
                  <th className={thCls}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`}>{e.employee ?? e.employeeId ?? '—'}</td>
                    <td className={tdCls}>{fmt(e.basePay)}</td>
                    <td className={tdCls}>{fmt(e.totalAllowances)}</td>
                    <td className={`${tdCls} font-medium`}>{fmt(e.grossPay)}</td>
                    <td className={`${tdCls} text-red-600`}>{fmt(e.totalDeductions)}</td>
                    <td className={`${tdCls} font-semibold text-green-700`}>{fmt(e.netPay)}</td>
                    <td className={tdCls}>
                      <StatusBadge status={e.status} />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-slate-400 text-sm">
                      No entries found. Filter by payroll run to load entries.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function PayrollEntriesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <PayrollEntriesContent />
    </Suspense>
  );
}
