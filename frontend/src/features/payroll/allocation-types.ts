import { payrollLabel } from '@/components/workspace/payroll-types';

export type Kind = 'allowance' | 'deduction';
export interface Company {
  id: string;
  name: string;
}
export interface Employee {
  id: string;
  fullName: string;
  employeeCode: string;
}
export interface AllocationType {
  id: string;
  name: string;
  code: string;
  isActive?: boolean;
}
export interface Allocation {
  id: string;
  updatedAt?: string;
  companyId: string;
  company?: Company;
  employeeId: string;
  employee?: Employee;
  allowanceTypeId?: string;
  deductionTypeId?: string;
  allowanceType?: AllocationType;
  deductionType?: AllocationType;
  amount?: number | string | null;
  percentage?: number | string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  status: string;
  notes?: string | null;
}
export const statuses = ['ACTIVE', 'INACTIVE', 'EXPIRED'].map((value) => ({
  value,
  label: payrollLabel(value),
}));
export const employeeName = (r: Allocation) =>
  r.employee?.fullName || r.employee?.employeeCode || 'Employee';
export const typeOf = (r: Allocation, kind: Kind) =>
  kind === 'allowance' ? r.allowanceType : r.deductionType;
export const typeId = (r: Allocation, kind: Kind) =>
  (kind === 'allowance' ? r.allowanceTypeId : r.deductionTypeId) || '';
export const dateLabel = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString('en-GB') : 'Open ended';
export const toForm = (kind: Kind, r?: Allocation) => ({
  companyId: r?.companyId || '',
  employeeId: r?.employeeId || '',
  typeId: r ? typeId(r, kind) : '',
  amount: r?.amount == null ? '' : String(r.amount),
  percentage: r?.percentage == null ? '' : String(r.percentage),
  effectiveFrom: r?.effectiveFrom.slice(0, 10) || '',
  effectiveTo: r?.effectiveTo?.slice(0, 10) || '',
  status: r?.status || 'ACTIVE',
  notes: r?.notes || '',
});
