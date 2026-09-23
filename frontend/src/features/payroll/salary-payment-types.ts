export interface Company {
  id: string;
  name: string;
}
export interface Employee {
  id: string;
  fullName: string;
  employeeCode: string;
}
export interface SalaryPayment {
  updatedAt?: string;
  cashMovementId?: string | null;
  id: string;
  salaryPaymentNumber: string;
  company?: Company;
  employee?: Employee;
  companyId: string;
  employeeId: string;
  payrollRunId: string;
  payrollEntryId: string;
  amount: number | string;
  paymentMethod: string;
  paymentDate: string;
  status: string;
  reference?: string;
  notes?: string;
}
export const statuses = ['DRAFT', 'PAID', 'CANCELLED', 'REVERSED'];
export const dateLabel = (value?: string) =>
  value ? new Date(value).toLocaleDateString('en-GB') : '—';
export const employeeName = (r: SalaryPayment) =>
  r.employee?.fullName || r.employee?.employeeCode || 'Employee';
