# Payroll in ITEMBA OS

Payroll is available in Apps at `/payroll`. It contains the employee-to-pay lifecycle: employee records and onboarding, contracts, time and leave, organisation setup, pay inputs, calculations, approvals, payslips, payments and reports. Existing records remain the source of truth; there is no duplicate employee directory.

## Navigation

- **Overview:** company filter, total/active employees, counts of draft/submitted/approved runs, five recent runs and a prepare → review → record guide. Counts cover all matching records. Employee and payroll links carry the selected company and status into their registers.
- **Employees:** create employee records, review the register, open and edit profiles. Profiles include personal/contact details, identity/statutory details, salary and payment frequency, banking, assignments, contracts, attendance, leave, payroll history and documents, subject to the existing field and action permissions.
- **Contracts:** employment agreements and lifecycle actions.
- **Attendance:** daily employee attendance records and hours.
- **Leave:** requests, employee balances and leave types.
- **Organisation:** departments, positions and company/division/branch assignments.
- **Pay periods:** create and manage the company's pay cycles.
- **Payroll runs:** calculate, submit, obtain HR and Finance sign-off, approve and record payment using the existing permission and workflow rules.
- **Payslips:** review employee payroll entries and open printable individual or run-wide payslips.
- **Payments:** salary payment records and permitted corrections.
- **Pay inputs:** employee allowances, deductions, salary advances and allowance/deduction types.
- **Reports:** workforce/payroll reports and the existing statutory report screens.

The app registry associates employee profiles, contracts, attendance, leave, organisation, reports and payroll routes with Payroll. Existing links continue working inside the Payroll window. Breadcrumbs return to Payroll. Desktop navigation is grouped into People, Pay and Insights; mobile uses a section selector. Unrelated HR case-management screens keep their existing routes/workspaces.

## Access and boundaries

The app uses the existing permissions for each employee and payroll tool, including `employees.view`, `employment_contracts.view`, `attendance.view`, leave/organisation permissions, `hr.reports.view`, `payroll.view`, `salary_payments.view`, allowances, deductions and advances. Each operation retains its own permissions. Employee-only roles can manage permitted employee records without fetching full payroll runs; payment-only roles do not fetch employee summaries. Sensitive profile fields retain existing protections. Company choices additionally require `companies.read`; otherwise the overview covers accessible companies using existing backend scope checks.

Payroll runs and periods remain company-level; employees keep their existing division and branch assignments. This change does not add branch-level payroll calculations, a separate payroll database, new tax rules or bank transfer execution. The subsequent [payroll cash connection](payroll-cash-connection.md) adds an additive migration and synchronizes payments with Cash Desk; existing roles need the listed financial permissions.

## Verification

- App registration, owned-route matching and OS navigation tests.
- Overview tests for permission gating, restricted roles, employee and run company/status links, exact decimal display, read failures and first-use guidance.
- Existing employee profile, employee pay allocation, attendance, leave, payroll run, payslip and salary payment UI tests. Idle search debounce guards prevent pagination resets in employee/run/payslip registers.
- Frontend production build and targeted lint.
- Live browser checks use read-only pages; no payroll runs are calculated, approved or paid during verification.
