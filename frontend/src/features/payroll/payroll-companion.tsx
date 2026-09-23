'use client';
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import { PageSpinner } from '@/components/ui/loading-state';
import { useWorkspacePathname } from '@/components/workspace/workspace-navigation';
import { PayrollWorkspace } from './payroll-workspace';
import { payrollCompanionRoute, type PayrollStaticPath } from './payroll-companion-routes';

const loading = () => <PageSpinner label="Opening Payroll" />;
const PeopleTools = dynamic(
  () => import('./payroll-people-tools').then((m) => m.PayrollPeopleTools),
  { loading },
);
const Employee = dynamic(() => import('./employee-detail').then((m) => m.EmployeeDetail), {
  loading,
});
const RunPayslips = dynamic(() => import('./run-payslips').then((m) => m.RunPayslips), { loading });
const Payslip = dynamic(() => import('./payslip-detail').then((m) => m.PayslipDetail), { loading });
const pages = {
  '/payroll': dynamic(() => import('./payroll-home').then((m) => m.PayrollHome), { loading }),
  '/payroll/inputs': dynamic(() => import('./payroll-home').then((m) => m.PayrollInputs), {
    loading,
  }),
  '/payroll/leave': () => <PeopleTools kind="leave" />,
  '/payroll/organisation': () => <PeopleTools kind="organisation" />,
  '/hr/employees': dynamic(() => import('@/app/(dashboard)/hr/employees/page'), { loading }),
  '/hr/employment-contracts': dynamic(
    () => import('@/app/(dashboard)/hr/employment-contracts/page'),
    { loading },
  ),
  '/hr/attendance': dynamic(() => import('@/app/(dashboard)/hr/attendance/page'), { loading }),
  '/hr/departments': dynamic(() => import('@/app/(dashboard)/hr/departments/page'), { loading }),
  '/hr/positions': dynamic(() => import('@/app/(dashboard)/hr/positions/page'), { loading }),
  '/hr/employee-assignments': dynamic(
    () => import('@/app/(dashboard)/hr/employee-assignments/page'),
    { loading },
  ),
  '/hr/leave-requests': dynamic(() => import('@/app/(dashboard)/hr/leave-requests/page'), {
    loading,
  }),
  '/hr/leave-balances': dynamic(() => import('@/app/(dashboard)/hr/leave-balances/page'), {
    loading,
  }),
  '/hr/leave-types': dynamic(() => import('@/app/(dashboard)/hr/leave-types/page'), { loading }),
  '/hr/payroll-periods': dynamic(() => import('@/app/(dashboard)/hr/payroll-periods/page'), {
    loading,
  }),
  '/hr/payroll-runs': dynamic(() => import('@/app/(dashboard)/hr/payroll-runs/page'), { loading }),
  '/hr/payroll-entries': dynamic(() => import('@/app/(dashboard)/hr/payroll-entries/page'), {
    loading,
  }),
  '/hr/salary-payments': dynamic(() => import('@/app/(dashboard)/hr/salary-payments/page'), {
    loading,
  }),
  '/hr/salary-advances': dynamic(() => import('@/app/(dashboard)/hr/salary-advances/page'), {
    loading,
  }),
  '/hr/allowance-types': dynamic(() => import('@/app/(dashboard)/hr/allowance-types/page'), {
    loading,
  }),
  '/hr/deduction-types': dynamic(() => import('@/app/(dashboard)/hr/deduction-types/page'), {
    loading,
  }),
  '/hr/employee-allowances': dynamic(
    () => import('@/app/(dashboard)/hr/employee-allowances/page'),
    { loading },
  ),
  '/hr/employee-deductions': dynamic(
    () => import('@/app/(dashboard)/hr/employee-deductions/page'),
    { loading },
  ),
  '/hr/reports': dynamic(() => import('@/app/(dashboard)/hr/reports/page'), { loading }),
  '/hr/reports/statutory': dynamic(() => import('@/app/(dashboard)/hr/reports/statutory/page'), {
    loading,
  }),
  '/hr/reports/wcf-exposure': dynamic(
    () => import('@/app/(dashboard)/hr/reports/wcf-exposure/page'),
    { loading },
  ),
} satisfies Record<PayrollStaticPath, ComponentType>;

export function PayrollCompanion() {
  const route = payrollCompanionRoute(useWorkspacePathname());
  if (!route) return <p role="alert">This Payroll view is unavailable.</p>;
  const Page = route.kind === 'static' ? pages[route.path] : null;
  return (
    <PayrollWorkspace>
      {Page ? (
        <Page />
      ) : route.kind === 'employee' ? (
        <Employee key={route.id} employeeId={route.id} />
      ) : route.kind === 'run-payslips' ? (
        <RunPayslips key={route.id} runId={route.id} />
      ) : route.kind === 'payslip' ? (
        <Payslip key={route.id} payslipId={route.id} />
      ) : null}
    </PayrollWorkspace>
  );
}
