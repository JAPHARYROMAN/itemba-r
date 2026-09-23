export interface Assignment {
  updatedAt?: string;
  id: string;
  employee?: string | { fullName?: string; employeeCode?: string };
  employeeId?: string;
  assignmentContextType?: string;
  company?: string | { id?: string; name?: string };
  companyId?: string;
  divisionId?: string | null;
  branchId?: string | null;
  startDate?: string;
  endDate?: string;
  status: string;
  approvalStatus?: string | null;
  isPrimary?: boolean;
  notes?: string;
  department?: { name?: string };
  position?: { title?: string };
}
export interface EmployeeChoice {
  id: string;
  fullName?: string;
  employeeCode?: string;
  company?: { name?: string };
}
export interface FormState {
  employeeId: string;
  contextType: string;
  companyId: string;
  branchId: string;
  divisionId: string;
  startDate: string;
  endDate: string;
  status: string;
  notes: string;
}
export const empty: FormState = {
  employeeId: '',
  contextType: 'COMPANY',
  companyId: '',
  branchId: '',
  divisionId: '',
  startDate: '',
  endDate: '',
  status: 'ACTIVE',
  notes: '',
};
export const employeeName = (r: Assignment) =>
  typeof r.employee === 'string'
    ? r.employee
    : r.employee?.fullName || r.employee?.employeeCode || r.employeeId || 'Employee';
export const companyName = (r: Assignment) =>
  typeof r.company === 'string' ? r.company : r.company?.name || '—';
export const label = (value: string) =>
  value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (c) => c.toUpperCase());
export const date = (value?: string) => (value ? new Date(value).toLocaleDateString('en-GB') : '—');

export const toForm = (record: Assignment): FormState => ({
  employeeId: record.employeeId || '',
  contextType: record.assignmentContextType || 'COMPANY',
  companyId:
    (typeof record.company === 'object' ? record.company?.id : undefined) || record.companyId || '',
  branchId: record.branchId || '',
  divisionId: record.divisionId || '',
  startDate: record.startDate?.slice(0, 10) || '',
  endDate: record.endDate?.slice(0, 10) || '',
  status: record.status,
  notes: record.notes || '',
});
