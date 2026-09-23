import type { RecordField } from './record-browser';
import { payrollMoney } from './payroll-types';
import { disputeDate, disputeLabel } from './dispute-types';
import type { HrReportResult, HrReportRow, Numeric, ReportKind } from './hr-report-types';
export const reports: Array<{ key: ReportKind; label: string; description: string }> = [
  {
    key: 'employees',
    label: 'Employees',
    description: 'Employee profiles across the companies you can access.',
  },
  {
    key: 'attendance',
    label: 'Attendance',
    description: 'Recorded attendance and hours. Totals include every matching record.',
  },
  {
    key: 'payroll',
    label: 'Payroll',
    description: 'Payroll runs and recorded totals. Use a pay period to narrow the report.',
  },
  {
    key: 'leave',
    label: 'Leave',
    description: 'Leave requests by start date, with request counts and days by status.',
  },
];
export const reportStatuses = {
  employees: ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED', 'RESIGNED', 'INACTIVE'],
  payroll: ['DRAFT', 'CALCULATED', 'SUBMITTED', 'APPROVED', 'PAID', 'CANCELLED'],
  leave: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'],
};
const number = (n?: Numeric) =>
  n == null ? '—' : Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 });
export const reportEmployeeName = (r: HrReportRow) =>
  r.fullName || r.employee?.fullName || r.employee?.employeeCode || r.employeeCode || 'Employee';
const time = (v?: string | null) => (v ? new Date(v).toLocaleString('en-GB') : 'Not recorded');
const companyField: RecordField<HrReportRow> = {
  label: 'Company',
  value: (r) => r.company?.name || '—',
};
export const reportFields: Record<
  ReportKind,
  { fields: RecordField<HrReportRow>[]; details: RecordField<HrReportRow>[] }
> = {
  employees: {
    fields: [companyField, { label: 'Department', value: (r) => r.department?.name || '—' }],
    details: [
      { label: 'Position', value: (r) => r.position?.title || '—' },
      {
        label: 'Employment type',
        value: (r) => (r.employmentType ? disputeLabel(r.employmentType) : '—'),
      },
      { label: 'Hire date', value: (r) => disputeDate(r.hireDate) },
      { label: 'Email', value: (r) => r.email || 'Not recorded' },
      { label: 'Phone', value: (r) => r.phone || 'Not recorded' },
    ],
  },
  attendance: {
    fields: [
      { label: 'Date', value: (r) => disputeDate(r.attendanceDate) },
      { label: 'Hours', value: (r) => number(r.totalHours) },
    ],
    details: [
      companyField,
      { label: 'Employee code', value: (r) => r.employee?.employeeCode },
      { label: 'Overtime hours', value: (r) => number(r.overtimeHours) },
      { label: 'Late minutes', value: (r) => number(r.lateMinutes) },
      { label: 'Clock in', value: (r) => time(r.clockInTime) },
      { label: 'Clock out', value: (r) => time(r.clockOutTime) },
      { label: 'Source', value: (r) => (r.source ? disputeLabel(r.source) : '—') },
      { label: 'Notes', value: (r) => r.notes || 'Not recorded' },
    ],
  },
  payroll: {
    fields: [companyField, { label: 'Net pay', value: (r) => payrollMoney(r.totalNetPay ?? 0) }],
    details: [
      { label: 'Period start', value: (r) => disputeDate(r.payrollPeriod?.startDate) },
      { label: 'Period end', value: (r) => disputeDate(r.payrollPeriod?.endDate) },
      { label: 'Employees', value: (r) => number(r._count?.entries) },
      { label: 'Gross pay', value: (r) => payrollMoney(r.totalGrossPay ?? 0) },
      { label: 'Deductions', value: (r) => payrollMoney(r.totalDeductions ?? 0) },
    ],
  },
  leave: {
    fields: [
      { label: 'Leave type', value: (r) => r.leaveType?.name || '—' },
      { label: 'Days', value: (r) => number(r.totalDays) },
    ],
    details: [
      companyField,
      { label: 'Employee code', value: (r) => r.employee?.employeeCode },
      { label: 'Start date', value: (r) => disputeDate(r.startDate) },
      { label: 'End date', value: (r) => disputeDate(r.endDate) },
      { label: 'Reason', value: (r) => r.reason || 'Not recorded' },
    ],
  },
};
export function ReportSummary({ data, kind }: { data: HrReportResult; kind: ReportKind }) {
  const values: Array<[string, string]> = [['Matching records', number(data.total)]];
  if (kind === 'attendance' && data.summary && !Array.isArray(data.summary))
    values.push(
      ['Hours', number(data.summary.totalHours)],
      ['Overtime hours', number(data.summary.totalOvertimeHours)],
      ['Late minutes', number(data.summary.totalLateMinutes)],
    );
  if (kind === 'payroll' && data.totals)
    values.push(
      ['Gross pay', payrollMoney(data.totals.totalGrossPay)],
      ['Deductions', payrollMoney(data.totals.totalDeductions)],
      ['Net pay', payrollMoney(data.totals.totalNetPay)],
    );
  return (
    <section className="hr-report-totals" aria-label="Totals for all matching records">
      <p>All matching records · totals across every page</p>
      <dl>
        {values.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {kind === 'leave' && Array.isArray(data.summary) && (
        <ul className="hr-leave-totals">
          {data.summary.map((s) => (
            <li key={s.status}>
              <strong>{disputeLabel(s.status)}</strong>
              <span>
                {number(s.count)} requests · {number(s.totalDays)} days
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
