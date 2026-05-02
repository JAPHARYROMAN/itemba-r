'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Btn, Card, PageHeader, PageSpinner } from '@/components/ui';

interface PayslipRow {
  entry: { id: string; basePay: number; grossPay: number; totalDeductions: number; netPay: number };
  employee: {
    id: string;
    employeeCode: string;
    fullName: string;
    department?: { name: string } | null;
    position?: { title: string } | null;
  };
  payrollRun: { payrollRunNumber: string; payrollPeriod?: { name: string } | null };
}

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

function fmt(n: number) {
  return new Intl.NumberFormat('en-TZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export default function RunPayslipsPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.id as string;
  const [rows, setRows] = useState<PayslipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    fetch(`/api/backend/hr/payslips/run/${runId}`)
      .then(r => r.json())
      .then(j => {
        const list = j.data ?? j;
        setRows(Array.isArray(list) ? list : []);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [runId]);

  const runNumber = rows[0]?.payrollRun?.payrollRunNumber ?? '—';
  const periodName = rows[0]?.payrollRun?.payrollPeriod?.name;
  const totals = rows.reduce(
    (acc, r) => ({
      gross: acc.gross + Number(r.entry.grossPay),
      deductions: acc.deductions + Number(r.entry.totalDeductions),
      net: acc.net + Number(r.entry.netPay),
    }),
    { gross: 0, deductions: 0, net: 0 },
  );

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title={`Payslips · ${runNumber}`}
        subtitle={periodName ? `Period: ${periodName}` : 'All payslips for this run'}
        actions={<Btn variant="secondary" onClick={() => router.back()}>← Back</Btn>}
      />

      {loading ? (
        <PageSpinner />
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Card className="p-4">
              <div className="text-xs text-slate-500">Employees</div>
              <div className="text-2xl font-bold mt-1">{rows.length}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-slate-500">Total gross (TZS)</div>
              <div className="text-2xl font-bold mt-1">{fmt(totals.gross)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-slate-500">Total deductions (TZS)</div>
              <div className="text-2xl font-bold mt-1">{fmt(totals.deductions)}</div>
            </Card>
            <Card className="p-4 bg-emerald-50 border-emerald-200">
              <div className="text-xs text-emerald-700">Total net (TZS)</div>
              <div className="text-2xl font-bold mt-1 text-emerald-800">{fmt(totals.net)}</div>
            </Card>
          </div>

          <Card className="overflow-hidden">
            {rows.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-400">
                No payslips for this run yet. Calculate the run first.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-100" style={{ color: 'var(--aurora-text-muted)' }}>
                    <tr>
                      <th className={thCls}>Code</th>
                      <th className={thCls}>Employee</th>
                      <th className={thCls}>Department</th>
                      <th className={thCls + ' text-right'}>Gross</th>
                      <th className={thCls + ' text-right'}>Deductions</th>
                      <th className={thCls + ' text-right'}>Net</th>
                      <th className={thCls + ' text-right'}>Action</th>
                    </tr>
                  </thead>
                  <tbody style={{ color: 'var(--aurora-text)' }}>
                    {rows.map(r => (
                      <tr key={r.entry.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className={`${tdCls} font-mono`}>{r.employee.employeeCode}</td>
                        <td className={`${tdCls} font-medium`}>{r.employee.fullName}</td>
                        <td className={tdCls}>
                          {r.employee.department?.name ?? '—'}
                          {r.employee.position?.title && (
                            <span className="text-xs text-slate-400"> · {r.employee.position.title}</span>
                          )}
                        </td>
                        <td className={`${tdCls} text-right tabular-nums`}>{fmt(Number(r.entry.grossPay))}</td>
                        <td className={`${tdCls} text-right tabular-nums`}>{fmt(Number(r.entry.totalDeductions))}</td>
                        <td className={`${tdCls} text-right tabular-nums font-semibold text-emerald-700`}>{fmt(Number(r.entry.netPay))}</td>
                        <td className={`${tdCls} text-right`}>
                          <Link href={`/hr/payslips/${r.entry.id}`}>
                            <Btn variant="ghost" size="xs">View payslip</Btn>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
