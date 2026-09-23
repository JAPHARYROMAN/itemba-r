export type ReportKind = 'employees' | 'attendance' | 'payroll' | 'leave';
export type Numeric = number | string;
export interface HrReportRow {
  id: string;
  employeeCode?: string;
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  employmentType?: string;
  employmentStatus?: string;
  hireDate?: string | null;
  department?: { name: string } | null;
  position?: { title: string } | null;
  company?: { name: string };
  employee?: { id: string; fullName?: string; employeeCode: string };
  attendanceNumber?: string;
  attendanceDate?: string;
  attendanceStatus?: string;
  totalHours?: Numeric;
  overtimeHours?: Numeric;
  lateMinutes?: number;
  clockInTime?: string | null;
  clockOutTime?: string | null;
  source?: string;
  notes?: string | null;
  payrollRunNumber?: string;
  payrollPeriod?: { id: string; name: string; startDate: string; endDate: string };
  _count?: { entries: number };
  totalGrossPay?: Numeric;
  totalDeductions?: Numeric;
  totalNetPay?: Numeric;
  status?: string;
  leaveRequestNumber?: string;
  leaveType?: { name: string };
  startDate?: string;
  endDate?: string;
  totalDays?: Numeric;
  reason?: string | null;
}
export interface HrReportResult {
  data: HrReportRow[];
  total: number;
  page: number;
  limit: number;
  summary?:
    | {
        totalRecords: number;
        totalHours: Numeric;
        totalOvertimeHours: Numeric;
        totalLateMinutes: Numeric;
      }
    | Array<{ status: string; count: number; totalDays: Numeric }>;
  totals?: { totalGrossPay: Numeric; totalDeductions: Numeric; totalNetPay: Numeric };
}
