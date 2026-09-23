export interface Contract {
  id: string;
  updatedAt?: string;
  contractCode: string;
  employeeId?: string;
  companyId?: string;
  employee?: string | { fullName?: string; employeeCode?: string };
  company?: string | { name?: string };
  contractType: string;
  startDate?: string;
  endDate?: string;
  probationEndDate?: string;
  salaryAmount?: number | string;
  currency?: string;
  paymentFrequency?: string;
  terms?: string;
  status: string;
}
export interface FormState {
  code: string;
  employeeId: string;
  companyId: string;
  contractType: string;
  startDate: string;
  endDate: string;
  baseSalary: string;
  currency: string;
  probationEndDate: string;
  paymentFrequency: string;
  terms: string;
}
export const empty: FormState = {
  code: '',
  employeeId: '',
  companyId: '',
  contractType: 'PERMANENT',
  startDate: '',
  endDate: '',
  baseSalary: '',
  currency: 'TZS',
  probationEndDate: '',
  paymentFrequency: 'MONTHLY',
  terms: '',
};
export const types = [
  'PERMANENT',
  'FIXED_TERM',
  'CASUAL',
  'DAILY_WORKER',
  'CONSULTANT',
  'INTERNSHIP',
  'OTHER',
];
export const statuses = ['DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'CANCELLED'];
export const label = (value: string) =>
  value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (c) => c.toUpperCase());
export const options = (values: string[]) =>
  values.map((value) => ({ value, label: label(value) }));
export const employeeName = (row: Contract) =>
  typeof row.employee === 'string'
    ? row.employee
    : row.employee?.fullName || row.employee?.employeeCode || 'Employee';
export const companyName = (row: Contract) =>
  typeof row.company === 'string' ? row.company : row.company?.name || '—';
export const date = (value?: string) => (value ? new Date(value).toLocaleDateString('en-GB') : '—');

export const contractActionPermissions = {
  approve: 'employment_contracts.approve',
  terminate: 'employment_contracts.terminate',
};
