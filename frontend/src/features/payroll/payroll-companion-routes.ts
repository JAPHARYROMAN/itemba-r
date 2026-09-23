/** Explicit Payroll views that can run independently of the browser's main route. */
export const PAYROLL_COMPANION_PATHS = [
  '/payroll',
  '/payroll/inputs',
  '/payroll/leave',
  '/payroll/organisation',
  '/hr/employees',
  '/hr/employment-contracts',
  '/hr/attendance',
  '/hr/departments',
  '/hr/positions',
  '/hr/employee-assignments',
  '/hr/leave-requests',
  '/hr/leave-balances',
  '/hr/leave-types',
  '/hr/payroll-periods',
  '/hr/payroll-runs',
  '/hr/payroll-entries',
  '/hr/salary-payments',
  '/hr/salary-advances',
  '/hr/allowance-types',
  '/hr/deduction-types',
  '/hr/employee-allowances',
  '/hr/employee-deductions',
  '/hr/reports',
  '/hr/reports/statutory',
  '/hr/reports/wcf-exposure',
] as const;
export type PayrollStaticPath = (typeof PAYROLL_COMPANION_PATHS)[number];
type PayrollRoute =
  | { kind: 'static'; path: PayrollStaticPath }
  | { kind: 'employee' | 'payslip' | 'run-payslips'; id: string };
export function payrollCompanionRoute(path: string): PayrollRoute | null {
  if (PAYROLL_COMPANION_PATHS.some((candidate) => candidate === path))
    return { kind: 'static', path: path as PayrollStaticPath };
  const patterns = [
    ['employee', /^\/hr\/employees\/([^/]+)$/],
    ['run-payslips', /^\/hr\/payroll-runs\/([^/]+)\/payslips$/],
    ['payslip', /^\/hr\/payslips\/([^/]+)$/],
  ] as const;
  for (const [kind, pattern] of patterns) {
    const match = pattern.exec(path);
    if (match) {
      try {
        return { kind, id: decodeURIComponent(match[1]) };
      } catch {
        return null;
      }
    }
  }
  return null;
}
