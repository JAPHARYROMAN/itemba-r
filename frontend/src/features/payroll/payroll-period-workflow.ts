export interface PayrollPeriod {
  id: string;
  payrollPeriodCode: string;
  company?: string | { name?: string };
  name: string;
  startDate?: string;
  endDate?: string;
  paymentDate?: string;
  status: string;
}
export interface FormState {
  code: string;
  companyId: string;
  name: string;
  startDate: string;
  endDate: string;
  paymentDate: string;
}
export const empty: FormState = {
  code: '',
  companyId: '',
  name: '',
  startDate: '',
  endDate: '',
  paymentDate: '',
};
