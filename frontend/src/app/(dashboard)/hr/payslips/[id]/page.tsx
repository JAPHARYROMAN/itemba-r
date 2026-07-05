'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Btn, PageSpinner } from '@/components/ui';
import { DocumentArtifactButton } from '@/components/documents';
import { useAuth } from '@/hooks/use-auth';

/**
 * Bilingual (English / Swahili) printable payslip. Uses CSS print styles so
 * the operator hits "Print" and gets a clean A4 PDF via the browser. No
 * server-side PDF dependency required for the MVP.
 */

interface PayslipPayload {
  entry: {
    id: string;
    basePay: number;
    attendancePay: number;
    overtimePay: number;
    totalAllowances: number;
    grossPay: number;
    totalDeductions: number;
    netPay: number;
    daysWorked: number | null;
    overtimeHours: number | null;
    status: string;
  };
  employee: {
    employeeCode: string;
    fullName: string;
    nidaNumber?: string;
    tin?: string;
    nssfNumber?: string;
    nhifNumber?: string;
    pssfNumber?: string;
    heslbNumber?: string;
    payrollRegion?: string;
    bankName?: string;
    bankAccountNumber?: string;
    department?: { name: string } | null;
    position?: { title: string } | null;
    branch?: { name: string; code: string } | null;
  };
  company: {
    name: string;
    code: string;
    profile?: { tin?: string; vrn?: string; registeredAddress?: string; postalAddress?: string } | null;
  };
  payrollRun: {
    payrollRunNumber: string;
    runDate: string;
    payrollPeriod?: { name: string; startDate?: string; endDate?: string; paymentDate?: string } | null;
  };
  allowances: Array<{ id: string; name?: string; code?: string; taxable: boolean; amount: number }>;
  manualDeductions: Array<{ id: string; name?: string; code?: string; statutory: boolean; amount: number }>;
  statutoryLines: Array<{
    id: string;
    taxTypeCode?: string;
    taxTypeName?: string;
    basis: string;
    basisAmount: number;
    employeeContribution: number;
    employerContribution: number;
    appliedRate: number | null;
    notes?: string;
  }>;
  totals: { employeeStatutory: number; employerStatutory: number; manualDeductions: number };
}

const TAX_LABELS: Record<string, { en: string; sw: string }> = {
  PAYE_MAINLAND: { en: 'PAYE (Mainland)', sw: 'PAYE (Bara)' },
  PAYE_ZANZIBAR: { en: 'PAYE (Zanzibar)', sw: 'PAYE (Zanzibar)' },
  NSSF: { en: 'NSSF (Pension)', sw: 'NSSF (Pensheni)' },
  PSSSF: { en: 'PSSSF (Pension)', sw: 'PSSSF (Pensheni)' },
  WCF: { en: 'Workers Compensation Fund', sw: 'Mfuko wa Fidia kwa Wafanyakazi' },
  SDL: { en: 'Skills Development Levy', sw: 'Tozo ya Kuendeleza Ujuzi' },
  NHIF: { en: 'National Health Insurance', sw: 'Bima ya Afya ya Taifa' },
  HESLB: { en: 'HESLB Loan Repayment', sw: 'Marejesho ya Mkopo HESLB' },
};

function fmt(n: number): string {
  return new Intl.NumberFormat('en-TZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtDate(d?: string): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function PayslipPage() {
  const params = useParams();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const id = params.id as string;
  const [data, setData] = useState<PayslipPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/backend/hr/payslips/${id}`)
      .then((r) => r.json())
      .then((j) => setData(j.data ?? j))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageSpinner />;
  if (error || !data) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error || 'Payslip not found.'}
        </div>
      </div>
    );
  }

  const { entry, employee, company, payrollRun, allowances, manualDeductions, statutoryLines, totals } = data;

  return (
    <>
      {/* Print stylesheet — hides everything outside .payslip-paper when printing */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .payslip-paper, .payslip-paper * { visibility: visible; }
          .payslip-paper { position: absolute; inset: 0; margin: 0; box-shadow: none; }
          .no-print { display: none !important; }
        }
        .payslip-paper {
          font-family: 'Inter', system-ui, sans-serif;
          color: #1f2937;
          background: white;
        }
        .payslip-table { width: 100%; border-collapse: collapse; }
        .payslip-table td, .payslip-table th { padding: 6px 10px; font-size: 12px; }
        .payslip-table thead th {
          background: #f3f4f6;
          text-align: left;
          font-weight: 600;
          color: #4b5563;
          border-bottom: 1px solid #e5e7eb;
        }
        .payslip-table tbody td { border-bottom: 1px solid #f3f4f6; }
        .payslip-totals td { font-weight: 600; }
      `}</style>

      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between no-print">
          <div className="flex gap-2">
            <Btn variant="secondary" size="sm" onClick={() => router.back()}>← Back</Btn>
          </div>
          <div className="flex gap-2">
            {hasPermission('payroll.view') && <DocumentArtifactButton entityType="PAYSLIP" entityId={id} />}
            <Btn variant="primary" size="sm" onClick={() => window.print()}>Print / Save as PDF</Btn>
          </div>
        </div>

        <div className="payslip-paper mx-auto max-w-4xl bg-white shadow-md rounded-lg p-10">
          {/* Header */}
          <div className="border-b pb-4 mb-6 flex justify-between items-start">
            <div>
              <div className="text-2xl font-bold">{company.name}</div>
              <div className="text-xs text-slate-500 mt-1">
                TIN: {company.profile?.tin ?? '—'}
                {company.profile?.vrn && <> · VRN: {company.profile.vrn}</>}
              </div>
              {company.profile?.registeredAddress && (
                <div className="text-xs text-slate-500">{company.profile.registeredAddress}</div>
              )}
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-slate-500">Payslip / Hati ya Malipo</div>
              <div className="text-xl font-bold mt-1">{payrollRun.payrollRunNumber}</div>
              <div className="text-xs text-slate-500 mt-1">
                Period / Kipindi: {payrollRun.payrollPeriod?.name ?? '—'}
              </div>
              <div className="text-xs text-slate-500">
                {payrollRun.payrollPeriod?.startDate && payrollRun.payrollPeriod?.endDate &&
                  `${fmtDate(payrollRun.payrollPeriod.startDate)} → ${fmtDate(payrollRun.payrollPeriod.endDate)}`}
              </div>
              <div className="text-xs text-slate-500">
                Pay date / Tarehe ya malipo: {fmtDate(payrollRun.payrollPeriod?.paymentDate)}
              </div>
            </div>
          </div>

          {/* Employee block */}
          <div className="grid grid-cols-2 gap-6 mb-6 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Employee / Mfanyakazi</div>
              <div className="font-bold text-base">{employee.fullName}</div>
              <div className="text-xs text-slate-500 mt-1 font-mono">{employee.employeeCode}</div>
              {employee.position?.title && <div className="text-xs mt-1">{employee.position.title}{employee.department?.name ? ` · ${employee.department.name}` : ''}</div>}
              {employee.branch?.name && <div className="text-xs text-slate-500">{employee.branch.code} — {employee.branch.name}</div>}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Statutory IDs / Vitambulisho</div>
              <table className="text-xs">
                <tbody>
                  {employee.tin && <tr><td className="text-slate-500 pr-2">TIN:</td><td className="font-mono">{employee.tin}</td></tr>}
                  {employee.nidaNumber && <tr><td className="text-slate-500 pr-2">NIDA:</td><td className="font-mono">{employee.nidaNumber}</td></tr>}
                  {employee.nssfNumber && <tr><td className="text-slate-500 pr-2">NSSF:</td><td className="font-mono">{employee.nssfNumber}</td></tr>}
                  {employee.pssfNumber && <tr><td className="text-slate-500 pr-2">PSSSF:</td><td className="font-mono">{employee.pssfNumber}</td></tr>}
                  {employee.nhifNumber && <tr><td className="text-slate-500 pr-2">NHIF:</td><td className="font-mono">{employee.nhifNumber}</td></tr>}
                  {employee.heslbNumber && <tr><td className="text-slate-500 pr-2">HESLB:</td><td className="font-mono">{employee.heslbNumber}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Earnings */}
          <SectionTitle en="Earnings" sw="Mapato" />
          <table className="payslip-table mb-6">
            <thead>
              <tr>
                <th>Item / Kipengele</th>
                <th style={{ textAlign: 'right' }}>TZS</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Basic pay <span className="text-slate-400">/ Mshahara wa msingi</span></td>
                <td style={{ textAlign: 'right' }}>{fmt(entry.basePay)}</td>
              </tr>
              {entry.attendancePay > 0 && (
                <tr>
                  <td>Attendance pay <span className="text-slate-400">/ Malipo ya mahudhurio</span></td>
                  <td style={{ textAlign: 'right' }}>{fmt(entry.attendancePay)}</td>
                </tr>
              )}
              {entry.overtimePay > 0 && (
                <tr>
                  <td>
                    Overtime <span className="text-slate-400">/ Muda wa ziada</span>
                    {entry.overtimeHours != null && <span className="text-xs text-slate-400"> ({entry.overtimeHours}h)</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmt(entry.overtimePay)}</td>
                </tr>
              )}
              {allowances.map((a) => (
                <tr key={a.id}>
                  <td>{a.name} <span className="text-slate-400">{a.taxable ? '· taxable' : '· non-taxable'}</span></td>
                  <td style={{ textAlign: 'right' }}>{fmt(a.amount)}</td>
                </tr>
              ))}
              <tr className="payslip-totals">
                <td>Gross pay <span className="text-slate-400">/ Malipo ya jumla</span></td>
                <td style={{ textAlign: 'right' }}>{fmt(entry.grossPay)}</td>
              </tr>
            </tbody>
          </table>

          {/* Statutory deductions (employee side) */}
          <SectionTitle en="Statutory deductions" sw="Makato ya kisheria" />
          <table className="payslip-table mb-6">
            <thead>
              <tr>
                <th>Item / Kipengele</th>
                <th>Basis / Msingi</th>
                <th style={{ textAlign: 'right' }}>Rate</th>
                <th style={{ textAlign: 'right' }}>TZS</th>
              </tr>
            </thead>
            <tbody>
              {statutoryLines.filter((l) => l.employeeContribution > 0).map((l) => {
                const lbl = TAX_LABELS[l.taxTypeCode ?? ''] ?? { en: l.taxTypeName ?? l.taxTypeCode ?? '—', sw: '' };
                return (
                  <tr key={l.id}>
                    <td>
                      {lbl.en}
                      {lbl.sw && <span className="text-slate-400"> / {lbl.sw}</span>}
                    </td>
                    <td className="text-xs text-slate-500">{l.basis} · {fmt(l.basisAmount)}</td>
                    <td style={{ textAlign: 'right' }} className="text-xs text-slate-500">
                      {l.appliedRate != null ? `${(l.appliedRate * 100).toFixed(2)}%` : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>{fmt(l.employeeContribution)}</td>
                  </tr>
                );
              })}
              {manualDeductions.length > 0 && manualDeductions.map((d) => (
                <tr key={d.id}>
                  <td>{d.name} <span className="text-slate-400">· non-statutory</span></td>
                  <td colSpan={2}></td>
                  <td style={{ textAlign: 'right' }}>{fmt(d.amount)}</td>
                </tr>
              ))}
              <tr className="payslip-totals">
                <td colSpan={3}>Total deductions <span className="text-slate-400">/ Jumla ya makato</span></td>
                <td style={{ textAlign: 'right' }}>{fmt(entry.totalDeductions)}</td>
              </tr>
            </tbody>
          </table>

          {/* Net pay banner */}
          <div className="my-6 px-6 py-4 bg-emerald-50 border-2 border-emerald-200 rounded-lg flex justify-between items-center">
            <div>
              <div className="text-xs uppercase tracking-wide text-emerald-700">Net pay / Malipo halisi</div>
              <div className="text-xs text-emerald-900 mt-0.5">
                {employee.bankName
                  ? `→ ${employee.bankName} · ${employee.bankAccountNumber ?? '—'}`
                  : '→ Mobile money / Pesa za simu (see disbursement file)'}
              </div>
            </div>
            <div className="text-3xl font-bold text-emerald-700">TZS {fmt(entry.netPay)}</div>
          </div>

          {/* Employer contributions (transparency) */}
          {totals.employerStatutory > 0 && (
            <>
              <SectionTitle en="Employer contributions (for reference, not deducted)" sw="Michango ya mwajiri (rejea, haijatolewa)" />
              <table className="payslip-table mb-6">
                <thead>
                  <tr>
                    <th>Item / Kipengele</th>
                    <th style={{ textAlign: 'right' }}>Rate</th>
                    <th style={{ textAlign: 'right' }}>TZS</th>
                  </tr>
                </thead>
                <tbody>
                  {statutoryLines.filter((l) => l.employerContribution > 0).map((l) => {
                    const lbl = TAX_LABELS[l.taxTypeCode ?? ''] ?? { en: l.taxTypeName ?? l.taxTypeCode ?? '—', sw: '' };
                    return (
                      <tr key={l.id}>
                        <td>{lbl.en}{lbl.sw && <span className="text-slate-400"> / {lbl.sw}</span>}</td>
                        <td style={{ textAlign: 'right' }} className="text-xs text-slate-500">
                          {l.appliedRate != null ? `${(l.appliedRate * 100).toFixed(2)}%` : '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>{fmt(l.employerContribution)}</td>
                      </tr>
                    );
                  })}
                  <tr className="payslip-totals">
                    <td colSpan={2}>Total employer contributions <span className="text-slate-400">/ Jumla ya michango ya mwajiri</span></td>
                    <td style={{ textAlign: 'right' }}>{fmt(totals.employerStatutory)}</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}

          {/* Footer */}
          <div className="border-t pt-4 mt-8 text-xs text-slate-500 grid grid-cols-2 gap-4">
            <div>
              Payslip generated {new Date().toLocaleString('en-GB')}<br />
              Hati ya malipo imetolewa
            </div>
            <div className="text-right">
              This is a system-generated document.<br />
              Hii ni hati iliyotengenezwa na mfumo.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function SectionTitle({ en, sw }: { en: string; sw: string }) {
  return (
    <div className="text-xs uppercase tracking-wide font-semibold mt-2 mb-2 text-slate-700">
      {en} <span className="text-slate-400 font-normal">/ {sw}</span>
    </div>
  );
}
