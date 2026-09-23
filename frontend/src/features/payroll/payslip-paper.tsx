import { WorkspaceTable } from '@/components/ui/workspace-table';
import {
  payslipBudgetFlags,
  splitPayslipForPrint,
} from './payslip-page-budget';

export const TAX_LABELS: Record<string, { en: string; sw: string }> = {
  PAYE_MAINLAND: { en: 'PAYE (Mainland)', sw: 'PAYE (Bara)' },
  PAYE_ZANZIBAR: { en: 'PAYE (Zanzibar)', sw: 'PAYE (Zanzibar)' },
  NSSF: { en: 'NSSF (Pension)', sw: 'NSSF (Pensheni)' },
  PSSSF: { en: 'PSSSF (Pension)', sw: 'PSSSF (Pensheni)' },
  WCF: { en: 'Workers Compensation Fund', sw: 'Mfuko wa Fidia kwa Wafanyakazi' },
  SDL: { en: 'Skills Development Levy', sw: 'Tozo ya Kuendeleza Ujuzi' },
  NHIF: { en: 'National Health Insurance', sw: 'Bima ya Afya ya Taifa' },
  HESLB: { en: 'HESLB Loan Repayment', sw: 'Marejesho ya Mkopo HESLB' },
};

export function fmt(n: number): string {
  return new Intl.NumberFormat('en-TZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function fmtDate(d?: string): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export interface PayslipPayload {
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
    profile?: {
      tin?: string;
      vrn?: string;
      registeredAddress?: string;
      postalAddress?: string;
    } | null;
  };
  payrollRun: {
    id?: string;
    payrollRunNumber: string;
    runDate: string;
    payrollPeriod?: {
      name: string;
      startDate?: string;
      endDate?: string;
      paymentDate?: string;
    } | null;
  };
  allowances: Array<{ id: string; name?: string; code?: string; taxable: boolean; amount: number }>;
  manualDeductions: Array<{
    id: string;
    name?: string;
    code?: string;
    statutory: boolean;
    amount: number;
  }>;
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

export function PayslipPaper({ data }: { data: PayslipPayload }) {
  const { entry, employee, company, payrollRun, allowances, manualDeductions, statutoryLines, totals } =
    data;
  const employeeStatutory = statutoryLines.filter((line) => line.employeeContribution > 0);
  const employerLines = statutoryLines.filter((line) => line.employerContribution > 0);
  const split = splitPayslipForPrint(
    allowances,
    payslipBudgetFlags({
      employee,
      attendancePay: entry.attendancePay,
      overtimePay: entry.overtimePay,
      statutoryEmployeeRows: employeeStatutory.length,
      manualDeductionRows: manualDeductions.length,
      employerRows: employerLines.length,
    }),
  );

  return (
    <>
      <article
        className="payslip-paper payslip-sheet mx-auto max-w-4xl bg-white shadow-md rounded-lg p-10"
        data-payslip-sheet="1"
        aria-label="Payslip"
      >
        <Header company={company} payrollRun={payrollRun} />
        <Identity employee={employee} />
        <Earnings
          entry={entry}
          allowances={split.firstPageAllowances}
          overflowCount={split.overflowAllowances.length}
        />
        <Deductions
          statutoryLines={employeeStatutory}
          manualDeductions={manualDeductions}
          totalDeductions={entry.totalDeductions}
        />
        <Net employee={employee} netPay={entry.netPay} />
        {split.employerOnFirstPage && (
          <Employer lines={employerLines} total={totals.employerStatutory} />
        )}
        <Footer pageNumber={1} pageCount={split.pageCount} />
      </article>
      {split.pageCount === 2 && (
        <article
          className="payslip-paper payslip-sheet payslip-continuation mx-auto mt-4 max-w-4xl bg-white shadow-md rounded-lg p-10"
          data-payslip-sheet="2"
          aria-label="Payslip continuation"
        >
          {split.overflowAllowances.length > 0 && (
            <EarningsContinued allowances={split.overflowAllowances} />
          )}
          {!split.employerOnFirstPage && employerLines.length > 0 && (
            <Employer lines={employerLines} total={totals.employerStatutory} />
          )}
          <Footer pageNumber={2} pageCount={2} />
        </article>
      )}
    </>
  );
}

function Header({
  company,
  payrollRun,
}: {
  company: PayslipPayload['company'];
  payrollRun: PayslipPayload['payrollRun'];
}) {
  return (
    <div className="payslip-heading border-b pb-4 mb-6 flex justify-between items-start gap-4">
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
        <div className="text-xs uppercase tracking-wide text-slate-500">
          Payslip / Hati ya Malipo
        </div>
        <div className="text-xl font-bold mt-1">{payrollRun.payrollRunNumber}</div>
        <div className="text-xs text-slate-500 mt-1">
          Period / Kipindi: {payrollRun.payrollPeriod?.name ?? '—'}
        </div>
        <div className="text-xs text-slate-500">
          {payrollRun.payrollPeriod?.startDate &&
            payrollRun.payrollPeriod?.endDate &&
            `${fmtDate(payrollRun.payrollPeriod.startDate)} → ${fmtDate(payrollRun.payrollPeriod.endDate)}`}
        </div>
        <div className="text-xs text-slate-500">
          Pay date / Tarehe ya malipo: {fmtDate(payrollRun.payrollPeriod?.paymentDate)}
        </div>
      </div>
    </div>
  );
}

function Identity({ employee }: { employee: PayslipPayload['employee'] }) {
  return (
    <div className="payslip-identity grid grid-cols-2 gap-6 mb-6 text-sm">
      <div>
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">
          Employee / Mfanyakazi
        </div>
        <div className="font-bold text-base">{employee.fullName}</div>
        <div className="text-xs text-slate-500 mt-1 font-mono">{employee.employeeCode}</div>
        {employee.position?.title && (
          <div className="text-xs mt-1">
            {employee.position.title}
            {employee.department?.name ? ` · ${employee.department.name}` : ''}
          </div>
        )}
        {employee.branch?.name && (
          <div className="text-xs text-slate-500">
            {employee.branch.code} — {employee.branch.name}
          </div>
        )}
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">
          Statutory IDs / Vitambulisho
        </div>
        <WorkspaceTable className="text-xs">
          <tbody>
            {employee.tin && (
              <tr>
                <td className="text-slate-500 pr-2">TIN:</td>
                <td className="font-mono">{employee.tin}</td>
              </tr>
            )}
            {employee.nidaNumber && (
              <tr>
                <td className="text-slate-500 pr-2">NIDA:</td>
                <td className="font-mono">{employee.nidaNumber}</td>
              </tr>
            )}
            {employee.nssfNumber && (
              <tr>
                <td className="text-slate-500 pr-2">NSSF:</td>
                <td className="font-mono">{employee.nssfNumber}</td>
              </tr>
            )}
            {employee.pssfNumber && (
              <tr>
                <td className="text-slate-500 pr-2">PSSSF:</td>
                <td className="font-mono">{employee.pssfNumber}</td>
              </tr>
            )}
            {employee.nhifNumber && (
              <tr>
                <td className="text-slate-500 pr-2">NHIF:</td>
                <td className="font-mono">{employee.nhifNumber}</td>
              </tr>
            )}
            {employee.heslbNumber && (
              <tr>
                <td className="text-slate-500 pr-2">HESLB:</td>
                <td className="font-mono">{employee.heslbNumber}</td>
              </tr>
            )}
          </tbody>
        </WorkspaceTable>
      </div>
    </div>
  );
}

function Earnings({
  entry,
  allowances,
  overflowCount,
}: {
  entry: PayslipPayload['entry'];
  allowances: PayslipPayload['allowances'];
  overflowCount: number;
}) {
  return (
    <>
      <SectionTitle en="Earnings" sw="Mapato" />
      <WorkspaceTable className="payslip-table mb-6">
        <thead>
          <tr>
            <th>Item / Kipengele</th>
            <th style={{ textAlign: 'right' }}>TZS</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              Basic pay <span className="text-slate-400">/ Mshahara wa msingi</span>
            </td>
            <td style={{ textAlign: 'right' }}>{fmt(entry.basePay)}</td>
          </tr>
          {entry.attendancePay > 0 && (
            <tr>
              <td>
                Attendance pay <span className="text-slate-400">/ Malipo ya mahudhurio</span>
              </td>
              <td style={{ textAlign: 'right' }}>{fmt(entry.attendancePay)}</td>
            </tr>
          )}
          {entry.overtimePay > 0 && (
            <tr>
              <td>
                Overtime <span className="text-slate-400">/ Muda wa ziada</span>
                {entry.overtimeHours != null && (
                  <span className="text-xs text-slate-400"> ({entry.overtimeHours}h)</span>
                )}
              </td>
              <td style={{ textAlign: 'right' }}>{fmt(entry.overtimePay)}</td>
            </tr>
          )}
          {allowances.map((a) => (
            <tr key={a.id}>
              <td>
                {a.name}{' '}
                <span className="text-slate-400">{a.taxable ? '· taxable' : '· non-taxable'}</span>
              </td>
              <td style={{ textAlign: 'right' }}>{fmt(a.amount)}</td>
            </tr>
          ))}
          <tr className="payslip-totals">
            <td>
              Gross pay <span className="text-slate-400">/ Malipo ya jumla</span>
            </td>
            <td style={{ textAlign: 'right' }}>{fmt(entry.grossPay)}</td>
          </tr>
        </tbody>
      </WorkspaceTable>
      {overflowCount > 0 && (
        <p className="payslip-continue-note text-xs text-slate-600 mb-6">
          {overflowCount} further allowance(s) continue overleaf. Gross includes every earning.
        </p>
      )}
    </>
  );
}

function EarningsContinued({ allowances }: { allowances: PayslipPayload['allowances'] }) {
  return (
    <>
      <SectionTitle en="Earnings (continued)" sw="Mapato (endelezo)" />
      <WorkspaceTable className="payslip-table mb-6">
        <thead>
          <tr>
            <th>Item / Kipengele</th>
            <th style={{ textAlign: 'right' }}>TZS</th>
          </tr>
        </thead>
        <tbody>
          {allowances.map((a) => (
            <tr key={a.id}>
              <td>
                {a.name}{' '}
                <span className="text-slate-400">{a.taxable ? '· taxable' : '· non-taxable'}</span>
              </td>
              <td style={{ textAlign: 'right' }}>{fmt(a.amount)}</td>
            </tr>
          ))}
        </tbody>
      </WorkspaceTable>
    </>
  );
}

function Deductions({
  statutoryLines,
  manualDeductions,
  totalDeductions,
}: {
  statutoryLines: PayslipPayload['statutoryLines'];
  manualDeductions: PayslipPayload['manualDeductions'];
  totalDeductions: number;
}) {
  return (
    <>
      <SectionTitle en="Statutory deductions" sw="Makato ya kisheria" />
      <div
        className="payslip-table-scroll"
        role="region"
        aria-label="Statutory deductions"
        tabIndex={0}
      >
        <WorkspaceTable className="payslip-table payslip-deductions mb-6">
          <thead>
            <tr>
              <th>Item / Kipengele</th>
              <th>Basis / Msingi</th>
              <th style={{ textAlign: 'right' }}>Rate</th>
              <th style={{ textAlign: 'right' }}>TZS</th>
            </tr>
          </thead>
          <tbody>
            {statutoryLines.map((l) => {
              const lbl = TAX_LABELS[l.taxTypeCode ?? ''] ?? {
                en: l.taxTypeName ?? l.taxTypeCode ?? '—',
                sw: '',
              };
              return (
                <tr key={l.id}>
                  <td>
                    {lbl.en}
                    {lbl.sw && <span className="text-slate-400"> / {lbl.sw}</span>}
                  </td>
                  <td className="text-xs text-slate-500">
                    {l.basis} · {fmt(l.basisAmount)}
                  </td>
                  <td style={{ textAlign: 'right' }} className="text-xs text-slate-500">
                    {l.appliedRate != null ? `${(l.appliedRate * 100).toFixed(2)}%` : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmt(l.employeeContribution)}</td>
                </tr>
              );
            })}
            {manualDeductions.map((d) => (
              <tr key={d.id}>
                <td>
                  {d.name}{' '}
                  <span className="text-slate-400">
                    · {d.statutory ? 'statutory' : 'non-statutory'}
                  </span>
                </td>
                <td colSpan={2}></td>
                <td style={{ textAlign: 'right' }}>{fmt(d.amount)}</td>
              </tr>
            ))}
            <tr className="payslip-totals">
              <td colSpan={3}>
                Total deductions <span className="text-slate-400">/ Jumla ya makato</span>
              </td>
              <td style={{ textAlign: 'right' }}>{fmt(totalDeductions)}</td>
            </tr>
          </tbody>
        </WorkspaceTable>
      </div>
    </>
  );
}

function Net({ employee, netPay }: { employee: PayslipPayload['employee']; netPay: number }) {
  return (
    <div className="payslip-net my-6 px-6 py-4 bg-emerald-50 border-2 border-emerald-200 rounded-lg flex justify-between items-center gap-4">
      <div>
        <div className="text-xs uppercase tracking-wide text-emerald-700">
          Net pay / Malipo halisi
        </div>
        <div className="text-xs text-emerald-900 mt-0.5">
          {employee.bankName
            ? `→ ${employee.bankName} · ${employee.bankAccountNumber ?? '—'}`
            : 'Payment destination: see disbursement details / Angalia taarifa za malipo'}
        </div>
      </div>
      <div className="text-3xl font-bold text-emerald-700">TZS {fmt(netPay)}</div>
    </div>
  );
}

function Employer({
  lines,
  total,
}: {
  lines: PayslipPayload['statutoryLines'];
  total: number;
}) {
  return (
    <>
      <SectionTitle
        en="Employer contributions (for reference, not deducted)"
        sw="Michango ya mwajiri (rejea, haijatolewa)"
      />
      <WorkspaceTable className="payslip-table mb-6">
        <thead>
          <tr>
            <th>Item / Kipengele</th>
            <th style={{ textAlign: 'right' }}>Rate</th>
            <th style={{ textAlign: 'right' }}>TZS</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const lbl = TAX_LABELS[l.taxTypeCode ?? ''] ?? {
              en: l.taxTypeName ?? l.taxTypeCode ?? '—',
              sw: '',
            };
            return (
              <tr key={l.id}>
                <td>
                  {lbl.en}
                  {lbl.sw && <span className="text-slate-400"> / {lbl.sw}</span>}
                </td>
                <td style={{ textAlign: 'right' }} className="text-xs text-slate-500">
                  {l.appliedRate != null ? `${(l.appliedRate * 100).toFixed(2)}%` : '—'}
                </td>
                <td style={{ textAlign: 'right' }}>{fmt(l.employerContribution)}</td>
              </tr>
            );
          })}
          <tr className="payslip-totals">
            <td colSpan={2}>
              Total employer contributions{' '}
              <span className="text-slate-400">/ Jumla ya michango ya mwajiri</span>
            </td>
            <td style={{ textAlign: 'right' }}>{fmt(total)}</td>
          </tr>
        </tbody>
      </WorkspaceTable>
    </>
  );
}

function Footer({ pageNumber, pageCount }: { pageNumber: number; pageCount: number }) {
  return (
    <div className="border-t pt-4 mt-8 text-xs text-slate-500 grid grid-cols-2 gap-4">
      <div>
        Payslip generated {new Date().toLocaleString('en-GB')}
        <br />
        Hati ya malipo imetolewa
      </div>
      <div className="text-right">
        This is a system-generated document.
        <br />
        Hii ni hati iliyotengenezwa na mfumo.
        {pageCount > 1 && (
          <>
            <br />
            Page {pageNumber} of {pageCount}
          </>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ en, sw }: { en: string; sw: string }) {
  return (
    <div className="text-xs uppercase tracking-wide font-semibold mt-2 mb-2 text-slate-700">
      {en} <span className="text-slate-400 font-normal">/ {sw}</span>
    </div>
  );
}
