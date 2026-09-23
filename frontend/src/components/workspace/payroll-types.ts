export interface PayrollRunRecord {
  updatedAt?: string;
  id: string;
  payrollRunNumber?: string;
  runNumber?: string;
  payrollPeriodId?: string;
  periodId?: string;
  payrollPeriod?: { name?: string };
  period?: string;
  companyId?: string;
  company?: { name?: string };
  payrollType?: string;
  runType?: string;
  totalGrossPay?: number | string;
  totalNetPay?: number | string;
  totalDeductions?: number | string;
  totalGross?: number | string;
  totalNet?: number | string;
  cashMovements?: { id: string }[];
  status: string;
  runDate?: string;
  notes?: string;
  hrApprovedById?: string | null;
  financeApprovedById?: string | null;
}
export interface PayrollPeriodChoice {
  id: string;
  name?: string;
  payrollPeriodCode?: string;
  companyId?: string;
  company?: { name?: string };
}
export const runName = (r: PayrollRunRecord) => r.payrollRunNumber || r.runNumber || 'Payroll run';
export const periodName = (r: PayrollRunRecord) =>
  r.payrollPeriod?.name || r.period || 'Period not available';
export const payrollMoney = (value?: number | string | null) =>
  value == null || !Number.isFinite(Number(value))
    ? '—'
    : 'TZS ' +
      Number(value).toLocaleString('en-TZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const payrollLabel = (v: string) =>
  v
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (c) => c.toUpperCase());
export type PayrollAction =
  | 'calculate'
  | 'submit'
  | 'approve-hr'
  | 'approve-finance'
  | 'approve'
  | 'cancel'
  | 'pay'
  | 'reverse-payment';
export const payrollActionLabels: Record<PayrollAction, string> = {
  calculate: 'Calculate run',
  submit: 'Submit run',
  'approve-hr': 'HR sign-off',
  'approve-finance': 'Finance sign-off',
  approve: 'Approve run',
  cancel: 'Cancel run',
  pay: 'Record payment',
  'reverse-payment': 'Reverse payment',
};
export function payrollActions(
  r: PayrollRunRecord,
  allowed: (permission: string) => boolean,
): PayrollAction[] {
  const actions: PayrollAction[] = [];
  if (['DRAFT', 'CALCULATED'].includes(r.status) && allowed('payroll.calculate'))
    actions.push('calculate');
  if (r.status === 'CALCULATED' && allowed('payroll.submit')) actions.push('submit');
  if (r.status === 'SUBMITTED') {
    if (!r.hrApprovedById && allowed('payroll.approve.hr')) actions.push('approve-hr');
    if (!r.financeApprovedById && allowed('payroll.approve.finance'))
      actions.push('approve-finance');
    if (r.hrApprovedById && r.financeApprovedById && allowed('payroll.approve'))
      actions.push('approve');
  }
  const canPay = [
    'payroll.pay',
    'cash_desk.view',
    'cash_desk.record',
    'journal_entries.create',
    'journal_entries.post',
  ].every((permission) => allowed(permission));
  if (r.status === 'APPROVED' && canPay) actions.push('pay');
  if (
    r.status === 'PAID' &&
    r.cashMovements?.length &&
    canPay &&
    allowed('cash_desk.reverse') &&
    allowed('journal_entries.reverse')
  )
    actions.push('reverse-payment');
  if (
    ['DRAFT', 'CALCULATED', 'SUBMITTED', 'APPROVED'].includes(r.status) &&
    allowed('payroll.cancel')
  )
    actions.push('cancel');
  return actions;
}

/** Permission check independent of state, also used for replaying an existing payment attempt. */
export function payrollActionAllowed(
  action: PayrollAction,
  allowed: (permission: string) => boolean,
) {
  const permission: Record<PayrollAction, string> = {
    calculate: 'payroll.calculate',
    submit: 'payroll.submit',
    'approve-hr': 'payroll.approve.hr',
    'approve-finance': 'payroll.approve.finance',
    approve: 'payroll.approve',
    cancel: 'payroll.cancel',
    pay: 'payroll.pay',
    'reverse-payment': 'payroll.pay',
  };
  if (!allowed(permission[action])) return false;
  if (!['pay', 'reverse-payment'].includes(action)) return true;
  return [
    'cash_desk.view',
    'cash_desk.record',
    'journal_entries.create',
    'journal_entries.post',
    ...(action === 'reverse-payment' ? ['cash_desk.reverse', 'journal_entries.reverse'] : []),
  ].every((p) => allowed(p));
}
export function payrollRunSourceKey(run: PayrollRunRecord) {
  return JSON.stringify([
    run.updatedAt,
    run.companyId,
    run.payrollPeriodId,
    run.status,
    run.totalNetPay ?? run.totalNet,
    run.hrApprovedById,
    run.financeApprovedById,
    run.cashMovements?.map((m) => m.id),
  ]);
}
