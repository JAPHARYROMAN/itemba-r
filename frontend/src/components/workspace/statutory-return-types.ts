import { payrollMoney } from './payroll-types';

export type ReturnKind = 'paye' | 'nssf' | 'psssf' | 'wcf' | 'sdl' | 'nhif' | 'heslb';
export interface ReturnFile {
  filename: string;
  mimeType: string;
  rowCount: number;
  content: string;
}
export interface StatutoryReturn {
  header: {
    companyId: string;
    companyName: string;
    companyTin?: string | null;
    periodLabel: string;
    taxType: string;
  };
  formCode: string;
  formName: string;
  summary: Record<string, number | boolean>;
  rows: Array<Record<string, string | number | null | undefined>>;
  file: ReturnFile;
}
export type ReturnRow = StatutoryReturn['rows'][number] & { id: string };
export const returnTypes: Array<{ key: ReturnKind; label: string; description: string }> = [
  { key: 'paye', label: 'PAYE', description: 'Recorded taxable income and withholding amounts.' },
  {
    key: 'nssf',
    label: 'NSSF',
    description: 'Recorded employee and employer pension contributions.',
  },
  {
    key: 'psssf',
    label: 'PSSSF',
    description: 'Recorded employee and employer pension contributions.',
  },
  { key: 'wcf', label: 'WCF', description: 'Recorded gross pay and employer contributions.' },
  { key: 'sdl', label: 'SDL', description: 'Recorded gross pay and levy amounts.' },
  {
    key: 'nhif',
    label: 'NHIF',
    description: 'Recorded employee and employer health contributions.',
  },
  { key: 'heslb', label: 'HESLB', description: 'Recorded basic salary and loan deductions.' },
];
interface ReturnColumn {
  key: string;
  label: string;
  format: (v: string | number | null | undefined) => string;
}
const text = (key: string, label: string): ReturnColumn => ({
  key,
  label,
  format: (v) => (v == null || v === '' ? 'Not recorded' : String(v)),
});
const money = (key: string, label: string): ReturnColumn => ({ key, label, format: payrollMoney });
const pension = [
  money('pensionableSalary', 'Pensionable salary'),
  money('totalContribution', 'Total contribution'),
  text('memberNumber', 'Member number'),
  money('employeeContribution', 'Employee contribution'),
  money('employerContribution', 'Employer contribution'),
];
export const returnColumns: Record<ReturnKind, ReturnColumn[]> = {
  paye: [
    money('taxableIncome', 'Taxable income'),
    money('payeAmount', 'PAYE'),
    text('tin', 'TIN'),
    text('nidaNumber', 'NIDA'),
  ],
  nssf: pension,
  psssf: pension,
  wcf: [
    money('gross', 'Gross pay'),
    money('wcfAmount', 'WCF'),
    text('wcfNumber', 'WCF number'),
    {
      key: 'rate',
      label: 'Recorded rate',
      format: (v) => (v == null ? 'Not recorded' : `${(Number(v) * 100).toFixed(2)}%`),
    },
  ],
  sdl: [money('gross', 'Gross pay'), money('sdlAmount', 'SDL')],
  nhif: [
    money('employeeContribution', 'Employee contribution'),
    money('employerContribution', 'Employer contribution'),
    text('nhifNumber', 'NHIF number'),
  ],
  heslb: [
    money('basicSalary', 'Basic salary'),
    money('deduction', 'Deduction'),
    text('heslbNumber', 'HESLB number'),
  ],
};
const summaryLabels: Record<string, string> = {
  employees: 'Employees',
  totalTaxable: 'Taxable income',
  totalPaye: 'PAYE',
  totalPensionable: 'Pensionable salary',
  totalEmployee: 'Employee contributions',
  totalEmployer: 'Employer contributions',
  totalContribution: 'Total contributions',
  totalGross: 'Gross pay',
  totalWcf: 'WCF',
  totalSdl: 'SDL',
  thresholdMet: 'Recorded threshold met',
  membersWithoutNumber: 'Members without a number',
  totalBasic: 'Basic salary',
  totalDeduction: 'Deductions',
};
export function returnSummaryLabel(key: string) {
  return summaryLabels[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}
export function returnSummaryValue(key: string, value: number | boolean) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return key.startsWith('total') ? payrollMoney(value) : value.toLocaleString('en-GB');
}
export function downloadReturnCsv(file: ReturnFile) {
  const url = URL.createObjectURL(new Blob([file.content], { type: 'text/csv;charset=utf-8;' }));
  const anchor = document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = file.filename;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}
