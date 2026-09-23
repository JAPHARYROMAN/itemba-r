export type Kind = 'allowance' | 'deduction';
export interface Company {
  id: string;
  name: string;
}
export interface PayrollType {
  updatedAt?: string;
  id: string;
  companyId: string;
  company?: Company;
  name: string;
  code: string;
  taxable?: boolean;
  statutory?: boolean;
  recurring: boolean;
  isActive: boolean;
  defaultAmount?: number | string | null;
  defaultPercentage?: number | string | null;
}
export const booleanOptions = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];
export const money = (value: PayrollType['defaultAmount']) =>
  value == null
    ? 'Not set'
    : 'TZS ' +
      Number(value).toLocaleString('en-TZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const label = (kind: Kind) => (kind === 'allowance' ? 'Allowance' : 'Deduction');
export const toForm = (r?: PayrollType) => ({
  companyId: r?.companyId || '',
  name: r?.name || '',
  code: r?.code || '',
  taxable: String(r?.taxable ?? false),
  statutory: String(r?.statutory ?? false),
  recurring: String(r?.recurring ?? false),
  isActive: String(r?.isActive ?? true),
  defaultAmount: r?.defaultAmount == null ? '' : String(r.defaultAmount),
  defaultPercentage: r?.defaultPercentage == null ? '' : String(r.defaultPercentage),
});

export type FormState = ReturnType<typeof toForm>;
