import { describe, expect, it } from 'vitest';
import { payslipFixture } from '@/test/payslip-fixture';
import {
  PAGE_CONTENT_MM,
  ROW_MM,
  employerBlockMm,
  employerOnFirstPage,
  firstPageAllowanceCapacity,
  payslipBudgetFlags,
  requiredChromeMm,
  splitPayslipForPrint,
} from './payslip-page-budget';

function flagsFromFixture(allowanceCount = payslipFixture.allowances.length) {
  const employeeStatutory = payslipFixture.statutoryLines.filter(
    (line) => line.employeeContribution > 0,
  ).length;
  const employerRows = payslipFixture.statutoryLines.filter(
    (line) => line.employerContribution > 0,
  ).length;
  return {
    flags: payslipBudgetFlags({
      employee: payslipFixture.employee,
      attendancePay: payslipFixture.entry.attendancePay,
      overtimePay: payslipFixture.entry.overtimePay,
      statutoryEmployeeRows: employeeStatutory,
      manualDeductionRows: payslipFixture.manualDeductions.length,
      employerRows,
    }),
    allowanceCount,
  };
}

describe('payslip print page budget', () => {
  it('never promises more allowance rows than the printable column can hold', () => {
    const { flags } = flagsFromFixture();
    const capacity = firstPageAllowanceCapacity(flags);
    const reserved =
      requiredChromeMm(flags) +
      (employerOnFirstPage(flags) ? employerBlockMm(flags.employerRows) : 0);

    expect(reserved + capacity * ROW_MM).toBeLessThanOrEqual(PAGE_CONTENT_MM);
  });

  it('keeps the typical fixture on a single sheet, including employer contributions', () => {
    const { flags } = flagsFromFixture();
    const split = splitPayslipForPrint(payslipFixture.allowances, flags);

    expect(employerOnFirstPage(flags)).toBe(true);
    expect(split.overflowAllowances).toHaveLength(0);
    expect(split.pageCount).toBe(1);
  });

  it('splits without dropping or duplicating a single allowance', () => {
    const { flags } = flagsFromFixture();
    const allowances = Array.from({ length: 32 }, (_, index) => index);
    const { firstPageAllowances, overflowAllowances, capacity } = splitPayslipForPrint(
      allowances,
      flags,
    );

    expect(firstPageAllowances).toHaveLength(capacity);
    expect(overflowAllowances.length).toBeGreaterThan(0);
    expect([...firstPageAllowances, ...overflowAllowances]).toEqual(allowances);
  });

  it('still reports net-pay chrome when every allowance overflows', () => {
    const { flags } = flagsFromFixture();
    const reserved =
      requiredChromeMm(flags) +
      (employerOnFirstPage(flags) ? employerBlockMm(flags.employerRows) : 0);

    expect(reserved).toBeLessThanOrEqual(PAGE_CONTENT_MM);
    expect(firstPageAllowanceCapacity(flags)).toBeGreaterThanOrEqual(0);
  });
});
