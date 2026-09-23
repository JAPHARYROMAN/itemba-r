export interface Attendance {
  id: string;
  updatedAt?: string;
  attendanceNumber?: string;
  employee?: string | { fullName?: string; employeeCode?: string };
  company?: string | { name?: string };
  employeeId?: string;
  companyId?: string;
  attendanceDate?: string;
  clockInTime?: string | null;
  clockOutTime?: string | null;
  totalHours?: number | string;
  overtimeHours?: number | string;
  lateMinutes?: number;
  earlyLeaveMinutes?: number;
  attendanceStatus?: string;
  approvedById?: string | null;
  approvedAt?: string;
  source?: string;
  notes?: string;
}
export interface FormState {
  companyId: string;
  employeeId: string;
  date: string;
  clockIn: string;
  clockOut: string;
  status: string;
  notes: string;
}
export const empty: FormState = {
  companyId: '',
  employeeId: '',
  date: '',
  clockIn: '',
  clockOut: '',
  status: 'PRESENT',
  notes: '',
};
export const statuses = [
  'PRESENT',
  'ABSENT',
  'LATE',
  'HALF_DAY',
  'ON_LEAVE',
  'HOLIDAY',
  'SICK',
  'UNPAID_ABSENT',
];
export const label = (value: string) =>
  value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (c) => c.toUpperCase());
export const employeeName = (r: Attendance) =>
  typeof r.employee === 'string'
    ? r.employee
    : r.employee?.fullName || r.employee?.employeeCode || r.employeeId || 'Employee';
export const companyName = (r: Attendance) =>
  typeof r.company === 'string' ? r.company : r.company?.name || '—';
export const date = (value?: string) =>
  value ? new Date(value).toLocaleDateString('en-GB', { timeZone: 'UTC' }) : '—';
export const timestamp = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';
// Local controls display the operator's clock; requests carry unambiguous UTC instants.
export function localInput(value?: string | null) {
  if (!value) return '';
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
}
export function formFor(r: Attendance): FormState {
  return {
    companyId: r.companyId || '',
    employeeId: r.employeeId || '',
    date: r.attendanceDate?.slice(0, 10) || '',
    clockIn: localInput(r.clockInTime),
    clockOut: localInput(r.clockOutTime),
    status: r.attendanceStatus || 'PRESENT',
    notes: r.notes || '',
  };
}
