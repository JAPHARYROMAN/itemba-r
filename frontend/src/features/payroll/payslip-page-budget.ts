/**
 * How many allowance rows fit on payslip page 1.
 *
 * @page is A4 portrait with a 12mm margin (`payslip.css`) and print CSS zeroes
 * the sheet padding, so the printable column is 273mm tall — the same number
 * the quotation sheet uses. Cells are declared in px (12px type, 6px vertical
 * padding). At the CSS reference pixel that is 7.4mm per row including the
 * 1px rule. The budget is therefore arithmetic, not a DOM measurement:
 * screen pixels and printed millimetres do not agree.
 *
 * Page 1 must always be a COMPLETE payslip — identity, gross, total deductions
 * and net pay. Surplus allowance rows (and the employer-contribution block,
 * when it cannot share the sheet) go to a continuation. The employee should
 * never turn over to find what they were paid.
 *
 * Re-derive these if the layout changes. Over-estimating costs one row of
 * capacity; under-estimating costs the guarantee.
 */

export const PAGE_CONTENT_MM = 273;

/** 12px type + 6px padding either side + 1px rule, at 96dpi. */
export const ROW_MM = 7.4;

export const CHROME_MM = {
  /** Company block and run / period stack, including the rule beneath. */
  header: 32,
  /** Employee column plus the statutory-ID heading, before any ID rows. */
  identityBase: 26,
  earningsTitle: 8,
  earningsHead: 8,
  deductionsTitle: 8,
  deductionsHead: 8,
  netPay: 28,
  footer: 14,
} as const;

export const STATUTORY_ID_ROW_MM = 5;
export const EMPLOYER_TITLE_MM = 8;
export const EMPLOYER_HEAD_MM = 8;

export type PayslipBudgetFlags = {
  statutoryIdCount: number;
  extraEarningRows: number;
  deductionDetailRows: number;
  employerRows: number;
};

export function statutoryIdCount(employee: {
  tin?: string;
  nidaNumber?: string;
  nssfNumber?: string;
  pssfNumber?: string;
  nhifNumber?: string;
  heslbNumber?: string;
}): number {
  return [
    employee.tin,
    employee.nidaNumber,
    employee.nssfNumber,
    employee.pssfNumber,
    employee.nhifNumber,
    employee.heslbNumber,
  ].filter(Boolean).length;
}

export function payslipBudgetFlags(input: {
  employee: Parameters<typeof statutoryIdCount>[0];
  attendancePay: number;
  overtimePay: number;
  statutoryEmployeeRows: number;
  manualDeductionRows: number;
  employerRows: number;
}): PayslipBudgetFlags {
  return {
    statutoryIdCount: statutoryIdCount(input.employee),
    extraEarningRows: (input.attendancePay > 0 ? 1 : 0) + (input.overtimePay > 0 ? 1 : 0),
    deductionDetailRows: input.statutoryEmployeeRows + input.manualDeductionRows,
    employerRows: input.employerRows,
  };
}

export function requiredChromeMm(flags: PayslipBudgetFlags): number {
  const earningRows = 1 + flags.extraEarningRows;
  return (
    CHROME_MM.header +
    CHROME_MM.identityBase +
    flags.statutoryIdCount * STATUTORY_ID_ROW_MM +
    CHROME_MM.earningsTitle +
    CHROME_MM.earningsHead +
    earningRows * ROW_MM +
    ROW_MM +
    CHROME_MM.deductionsTitle +
    CHROME_MM.deductionsHead +
    flags.deductionDetailRows * ROW_MM +
    ROW_MM +
    CHROME_MM.netPay +
    CHROME_MM.footer
  );
}

export function employerBlockMm(employerRows: number): number {
  if (employerRows <= 0) return 0;
  return EMPLOYER_TITLE_MM + EMPLOYER_HEAD_MM + employerRows * ROW_MM + ROW_MM;
}

export function employerOnFirstPage(flags: PayslipBudgetFlags): boolean {
  const employer = employerBlockMm(flags.employerRows);
  return employer > 0 && requiredChromeMm(flags) + employer <= PAGE_CONTENT_MM;
}

export function firstPageAllowanceCapacity(flags: PayslipBudgetFlags): number {
  const reserved =
    requiredChromeMm(flags) +
    (employerOnFirstPage(flags) ? employerBlockMm(flags.employerRows) : 0);
  return Math.max(0, Math.floor((PAGE_CONTENT_MM - reserved) / ROW_MM));
}

export function splitPayslipForPrint<T>(allowances: T[], flags: PayslipBudgetFlags) {
  const capacity = firstPageAllowanceCapacity(flags);
  const overflowAllowances = allowances.slice(capacity);
  const keepEmployer = employerOnFirstPage(flags);
  return {
    capacity,
    firstPageAllowances: allowances.slice(0, capacity),
    overflowAllowances,
    employerOnFirstPage: keepEmployer,
    pageCount: overflowAllowances.length > 0 || (flags.employerRows > 0 && !keepEmployer) ? 2 : 1,
  };
}
