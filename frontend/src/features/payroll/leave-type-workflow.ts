export interface LeaveType {
  updatedAt?: string;
  id: string;
  name: string;
  code: string;
  companyId: string;
  company?: { name?: string };
  paid: boolean;
  annualAllowanceDays?: number | string | null;
  carryForwardAllowed: boolean;
  isActive: boolean;
}
export interface FormState {
  companyId: string;
  name: string;
  code: string;
  paid: string;
  annualDays: string;
  carryForward: string;
  active: string;
}
export const empty: FormState = {
  companyId: '',
  name: '',
  code: '',
  paid: 'true',
  annualDays: '',
  carryForward: 'false',
  active: 'true',
};
export const booleanOptions = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];
export const toForm = (r: LeaveType): FormState => ({
  companyId: r.companyId,
  name: r.name,
  code: r.code,
  paid: String(r.paid),
  annualDays: r.annualAllowanceDays == null ? '' : String(r.annualAllowanceDays),
  carryForward: String(r.carryForwardAllowed),
  active: String(r.isActive),
});
