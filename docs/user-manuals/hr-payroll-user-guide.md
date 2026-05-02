# HR & Payroll User Guide

## Overview

The HR & Payroll module manages the full employee lifecycle for all companies in the Itemba Group — from department and position setup, employee records, and attendance through leave management, payroll processing, salary payments, advances, payslips, HR documents, and performance reviews.

---

## 1. Department and Position Setup

### Creating Departments
1. Navigate to **HR → Organization → Departments → New Department**.
2. Enter the department name (e.g., Operations, Finance, Logistics, Farm Management, Sales, Administration).
3. Assign to a company and optionally to a division.
4. Set the department head (linked to employee record — do this after adding employees).
5. Click **Save**.

### Creating Positions
1. Navigate to **HR → Organization → Positions → New Position**.
2. Enter the job title (e.g., Fuel Attendant, Accountant, Truck Driver, Farm Supervisor, Site Engineer).
3. Link to a department.
4. Set the salary grade (if using grade-based pay scales).
5. Enter the job description summary.
6. Click **Save**.

---

## 2. Employee Records

### Adding an Employee
1. Navigate to **HR → Employees → New Employee**.
2. Fill in the **Personal Information** tab:
   - Full name, date of birth, gender, nationality
   - National ID (NIDA) number
   - NSSF number (National Social Security Fund)
   - NHIF number (National Health Insurance Fund)
   - TIN (if applicable)
   - Contact: phone, emergency contact, physical address
3. Fill in the **Employment** tab:
   - Employee number (auto-generated or manual)
   - Employment type: Permanent, Contract, Casual, Internship
   - Start date
   - Department and Position
   - Company and Branch/Division
   - Probation period (months)
4. Fill in the **Bank Account** tab:
   - Bank name, branch, account number (for salary payments)
5. Upload documents (see HR Documents, section 13).
6. Click **Save**.

### Employee Directory
Navigate to **HR → Employees** to browse all employees with search and filters by company, department, position, and employment status.

---

## 3. Employment Assignments

When an employee changes department, role, or company:
1. Open the employee record.
2. Click **New Assignment**.
3. Select the new department, position, company, and effective date.
4. The previous assignment is automatically closed on the same date.
5. Payroll and reporting use the current active assignment.

---

## 4. Attendance Recording

### Manual Attendance Entry
1. Navigate to **HR → Attendance → Record Attendance**.
2. Select the date and department.
3. For each employee, mark: Present, Absent, Half Day, Late, On Leave, Public Holiday.
4. For late arrivals, record the actual arrival time.
5. Click **Save**.

### Attendance Import
If attendance data is available from a clocking system:
1. Navigate to **HR → Attendance → Import**.
2. Download the import template.
3. Fill in attendance data (date, employee ID, arrival time, departure time).
4. Upload the completed file.
5. Review and confirm.

### Monthly Attendance Summary
Navigate to **HR → Reports → Attendance Summary** to view days worked, absent, late, and on leave per employee per month. This feeds directly into payroll calculations.

---

## 5. Leave Types and Leave Requests

### Leave Types Setup (Admin)
1. Navigate to **HR → Leave → Leave Types**.
2. Standard leave types configured:
   - **Annual Leave**: 28 days per year (as per Employment and Labour Relations Act, Tanzania)
   - **Sick Leave**: 126 days per year (90 days with full pay, 36 with half pay)
   - **Maternity Leave**: 84 days (12 weeks)
   - **Paternity Leave**: 3 days
   - **Compassionate Leave**: 4 days
   - **Study Leave**: as per company policy
3. Set accrual rules (daily, monthly accrual) and carry-forward limits.

### Applying for Leave
1. Navigate to **HR → Leave → New Request**.
2. Select leave type, start date, and end date.
3. The system shows the leave balance for the selected type.
4. Enter a reason and click **Submit**.

### Approving Leave
1. Managers receive a notification for pending leave requests.
2. Navigate to **HR → Leave → Pending Approvals**.
3. Review the request (check leave balance, team coverage).
4. **Approve** or **Reject** with a comment.
5. Approved leave is reflected in attendance records.

### Leave Balance
Each employee can view their leave balance at **HR → Leave → My Balances**.

---

## 6. Payroll Periods

### Setting Up a Payroll Period
1. Navigate to **HR → Payroll → Periods → New Period**.
2. Enter the period name (e.g., June 2025), start date, and end date.
3. Set the **pay date** (date salary is transferred to employees).
4. Click **Save**.

---

## 7. Running Payroll

### Generate Payroll
1. Navigate to **HR → Payroll → Run Payroll**.
2. Select the payroll period.
3. Select the company (payroll is run separately per company).
4. Click **Generate** — the system creates payroll entries for all active employees:
   - Basic salary (from position/grade)
   - Allowances (transport, housing, meal — configured per employee)
   - Overtime pay (from attendance records if overtime applies)
   - Deductions: NSSF (10% employer + 10% employee), PAYE (graduated tax scale), NHIF
   - Salary advances recovered (if any outstanding)
   - Other deductions (arrears, loans)

### Payroll Calculation
ITEMBA-R applies Tanzania Revenue Authority (TRA) PAYE tax rates:
| Monthly Taxable Income (TZS) | PAYE Rate |
|---|---|
| Up to 270,000 | 0% |
| 270,001 – 520,000 | 8% |
| 520,001 – 760,000 | 20% |
| 760,001 – 1,000,000 | 25% |
| Over 1,000,000 | 30% |

---

## 8. Reviewing Payroll Entries

After generation:
1. Navigate to **HR → Payroll → [Period] → Review Entries**.
2. Review each employee's payroll line: gross pay, deductions, net pay.
3. Use **Edit** to correct any entry (requires HR Manager permission).
4. Run the **Payroll Summary** to verify totals by department.
5. Once satisfied, click **Submit for Approval**.

---

## 9. Approving Payroll

1. The Finance Controller and/or Director receives a notification.
2. Navigate to **HR → Payroll → Pending Approval**.
3. Review the payroll summary and spot-check individual entries.
4. Click **Approve Payroll** — the payroll is locked and moves to payment stage.
5. Rejected payrolls are returned to HR with comments.

---

## 10. Salary Payments

### Processing Salary Payments
1. Navigate to **HR → Payroll → [Period] → Process Payments**.
2. Select the payment method: Bank Transfer or Cash.
3. For bank transfers: generate the **bank payment file** (compatible with the company's bank's bulk payment format) and submit to the bank.
4. Once the bank confirms transfer, click **Mark as Paid** and enter the bank reference.
5. The Finance GL is updated: Debit Salaries Payable / Credit Bank Account.

---

## 11. Salary Advances

For employees requesting salary advances:
1. Navigate to **HR → Advances → New Advance Request**.
2. Select the employee and amount requested.
3. Set the recovery schedule (e.g., deduct over 3 months).
4. Submit for HR Manager and Finance approval.
5. Once approved, payment is processed.
6. Recovery deductions are automatically applied in subsequent payroll runs.

---

## 12. Payslips

After payroll is marked as paid, payslips are generated:
1. Navigate to **HR → Payroll → [Period] → Generate Payslips**.
2. Payslips are created for all employees.
3. Employees can view and download their payslips from **HR → My Payslips**.
4. HR can send payslips via email: **HR → Payroll → Send Payslips**.

---

## 13. HR Documents

Manage employee documents:
1. Navigate to **HR → Documents → Upload Document**.
2. Select the employee and document type: Contract, NIDA Copy, Passport Copy, Academic Certificates, Appointment Letter, Warning Letter, Disciplinary Record.
3. Upload the file and enter the document date and expiry (if applicable).
4. Documents are stored securely and accessible only to HR staff.

---

## 14. Performance Review Records

1. Navigate to **HR → Performance → New Review**.
2. Select the employee and review period (quarterly or annual).
3. Rate performance areas (1–5 scale): Job Knowledge, Attendance, Teamwork, Leadership, Output Quality.
4. Enter specific achievements and areas for improvement.
5. Set goals for the next period.
6. Both the employee and the reviewing manager sign off.
7. The review is saved to the employee's HR record.
