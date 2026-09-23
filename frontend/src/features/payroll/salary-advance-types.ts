export interface Company {
  id: string;
  name: string;
}
export interface Employee {
  id: string;
  fullName: string;
  employeeCode: string;
}
export interface SalaryAdvance {
  updatedAt?: string;
  id: string;
  advanceNumber: string;
  company?: Company;
  employee?: Employee;
  companyId: string;
  employeeId: string;
  amount: number | string;
  currency?: string;
  recoveredAmount?: number | string;
  repaymentMethod?: string;
  installmentAmount?: number | string | null;
  status: string;
  requestDate?: string;
  approvedAt?: string;
  paidAt?: string;
  reason?: string;
  notes?: string;
}
export const statuses = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'PAID',
  'DEDUCTING',
  'SETTLED',
  'CANCELLED',
];
export const dateLabel = (value?: string) =>
  value ? new Date(value).toLocaleDateString('en-GB') : '—';
export const name = (r: SalaryAdvance) =>
  r.employee?.fullName || r.employee?.employeeCode || 'Employee';
export function money(value: number | string | null | undefined, currency = 'TZS') {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return (
    currency +
    ' ' +
    Number(value).toLocaleString('en-TZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}
export function today() {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
