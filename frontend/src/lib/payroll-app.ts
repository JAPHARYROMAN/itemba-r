export const PAYROLL_INPUTS = [
  {
    href: '/hr/employee-allowances',
    label: 'Employee allowances',
    description: 'Additions to employee pay.',
    permission: 'allowances.view',
  },
  {
    href: '/hr/employee-deductions',
    label: 'Employee deductions',
    description: 'Deductions assigned to each employee.',
    permission: 'deductions.view',
  },
  {
    href: '/hr/salary-advances',
    label: 'Salary advances',
    description: 'Requests, payments and payroll recovery.',
    permission: 'salary_advances.view',
  },
  {
    href: '/hr/allowance-types',
    label: 'Allowance types',
    description: 'Reusable allowance rules and defaults.',
    permission: 'allowances.view',
  },
  {
    href: '/hr/deduction-types',
    label: 'Deduction types',
    description: 'Reusable deduction rules and defaults.',
    permission: 'deductions.view',
  },
] as const;
export const PAYROLL_ORGANISATION = [
  {
    href: '/hr/departments',
    label: 'Departments',
    description: 'Organise teams within each company.',
    permission: 'departments.view',
  },
  {
    href: '/hr/positions',
    label: 'Positions',
    description: 'Job titles and roles for your employees.',
    permission: 'positions.view',
  },
  {
    href: '/hr/employee-assignments',
    label: 'Employee assignments',
    description: 'Company, division and branch placements over time.',
    permission: 'employees.assignments.manage',
  },
] as const;
export const PAYROLL_LEAVE = [
  {
    href: '/hr/leave-requests',
    label: 'Leave requests',
    description: 'Request, review and approve time away.',
    permission: 'leave_requests.view',
  },
  {
    href: '/hr/leave-balances',
    label: 'Leave balances',
    description: 'Entitlements and remaining leave for each employee.',
    permission: 'leave_balances.view',
  },
  {
    href: '/hr/leave-types',
    label: 'Leave types',
    description: 'Configure the leave categories your business uses.',
    permission: 'leave_types.view',
  },
] as const;
export const PAYROLL_APP_PERMISSIONS = [
  'employees.view',
  'employment_contracts.view',
  'attendance.view',
  'hr.reports.view',
  ...PAYROLL_ORGANISATION.map((x) => x.permission),
  ...PAYROLL_LEAVE.map((x) => x.permission),
  'payroll.view',
  'salary_payments.view',
  'allowances.view',
  'deductions.view',
  'salary_advances.view',
];
export const PAYROLL_ROUTE_PREFIXES = [
  '/hr/employees',
  '/hr/employment-contracts',
  '/hr/attendance',
  '/hr/reports',
  ...PAYROLL_ORGANISATION.map((x) => x.href),
  ...PAYROLL_LEAVE.map((x) => x.href),
  '/hr/payroll-periods',
  '/hr/payroll-runs',
  '/hr/payroll-entries',
  '/hr/payslips',
  '/hr/salary-payments',
  ...PAYROLL_INPUTS.map((x) => x.href),
];
export const PAYROLL_TABS = [
  { href: '/payroll', label: 'Overview', group: 'Workspace', permissions: PAYROLL_APP_PERMISSIONS },
  { href: '/hr/employees', label: 'Employees', group: 'People', permissions: ['employees.view'] },
  {
    href: '/hr/employment-contracts',
    label: 'Contracts',
    group: 'People',
    permissions: ['employment_contracts.view'],
  },
  {
    href: '/hr/attendance',
    label: 'Attendance',
    group: 'People',
    permissions: ['attendance.view'],
  },
  {
    href: '/payroll/leave',
    label: 'Leave',
    group: 'People',
    permissions: PAYROLL_LEAVE.map((x) => x.permission),
  },
  {
    href: '/payroll/organisation',
    label: 'Organisation',
    group: 'People',
    permissions: PAYROLL_ORGANISATION.map((x) => x.permission),
  },
  {
    href: '/hr/payroll-periods',
    label: 'Pay periods',
    group: 'Pay',
    permissions: ['payroll.view'],
  },
  { href: '/hr/payroll-runs', label: 'Payroll runs', group: 'Pay', permissions: ['payroll.view'] },
  { href: '/hr/payroll-entries', label: 'Payslips', group: 'Pay', permissions: ['payroll.view'] },
  {
    href: '/hr/salary-payments',
    label: 'Payments',
    group: 'Pay',
    permissions: ['salary_payments.view'],
  },
  {
    href: '/payroll/inputs',
    label: 'Pay inputs',
    group: 'Pay',
    permissions: ['allowances.view', 'deductions.view', 'salary_advances.view'],
  },
  { href: '/hr/reports', label: 'Reports', group: 'Insights', permissions: ['hr.reports.view'] },
];
export function activePayrollTab(path: string) {
  if (path.startsWith('/hr/payslips/') || /^\/hr\/payroll-runs\/[^/]+\/payslips(?:\/|$)/.test(path))
    return '/hr/payroll-entries';
  if (PAYROLL_INPUTS.some((x) => path === x.href || path.startsWith(`${x.href}/`)))
    return '/payroll/inputs';
  if (PAYROLL_ORGANISATION.some((x) => path === x.href || path.startsWith(`${x.href}/`)))
    return '/payroll/organisation';
  if (PAYROLL_LEAVE.some((x) => path === x.href || path.startsWith(`${x.href}/`)))
    return '/payroll/leave';
  return (
    [...PAYROLL_TABS]
      .sort((a, b) => b.href.length - a.href.length)
      .find((x) => path === x.href || path.startsWith(`${x.href}/`))?.href ?? '/payroll'
  );
}
