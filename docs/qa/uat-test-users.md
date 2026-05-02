# ITEMBA-R UAT Test Users

This document provides test user credentials and scenarios for User Acceptance Testing.

## Test Environment

- URL: http://localhost:3000 (development) or staging URL
- Backend: http://localhost:3001/api/v1

## Seeded Test Users

The seed script creates the following users. Contact your system administrator for passwords.

### Group Level Users

| Email | Role | Company | Purpose |
|-------|------|---------|---------|
| admin@itemba-r.com | Group Super Admin | All Companies | System administration, all permissions |
| director@itemba-r.com | Group Director | All Companies | Executive oversight, strategic control |
| finance-controller@itemba-r.com | Group Finance Controller | All Companies | Consolidated finance, bank accounts, loans |
| auditor@itemba-r.com | Group Auditor | All Companies | Read-only audit access to all records |

### Mwanjalisi Oil Users

| Email | Role | Company | Purpose |
|-------|------|---------|---------|
| manager@mwanjalisi.co.tz | Company Manager | Mwanjalisi Oil | Full company management |
| accountant@mwanjalisi.co.tz | Accountant | Mwanjalisi Oil | Finance and accounting |
| petroleum-ops@mwanjalisi.co.tz | Operations Manager | Mwanjalisi Oil | Fuel shifts, tanks, nozzles |
| attendant@mwanjalisi.co.tz | Ordinary User | Mwanjalisi Oil | Shift attendance entry only |

### Westsides Company Users

| Email | Role | Company | Purpose |
|-------|------|---------|---------|
| manager@westsides.co.tz | Company Manager | Westsides | Full company management |
| sales@westsides.co.tz | Operations Manager | Westsides | POS sales, inventory |
| warehouse@westsides.co.tz | Ordinary User | Westsides | Warehouse stock entry |

### Itemba Enterprises Users

| Email | Role | Company | Purpose |
|-------|------|---------|---------|
| manager@itemba.co.tz | Company Manager | Itemba Enterprises | Full company management |
| driver@itemba.co.tz | Ordinary User | Itemba Enterprises | Trip recording only |
| farm-manager@itemba.co.tz | Operations Manager | Itemba Enterprises | Farm/crop management |
| hr@itemba-r.com | HR Manager | All Companies | HR and payroll management |

## UAT Test Scenarios

### Scenario 1: Company Isolation Test
1. Log in as `sales@westsides.co.tz`
2. Try to view Mwanjalisi Oil records → should be denied (403 or filtered)
3. Try to view Itemba records → should be denied
4. Log out

### Scenario 2: Finance Flow
1. Log in as `accountant@mwanjalisi.co.tz`
2. Navigate to Finance → Accounts → Create new account
3. Navigate to Finance → Journal Entries → Create entry
4. Navigate to Finance → Reports → Trial Balance
5. Verify numbers are correct

### Scenario 3: Petroleum Flow
1. Log in as `petroleum-ops@mwanjalisi.co.tz`
2. Navigate to Petroleum → Fuel Shifts → Start new shift
3. Enter nozzle readings
4. Record tank dip reading
5. Close shift and verify variance report

### Scenario 4: HR & Payroll Flow
1. Log in as `hr@itemba-r.com`
2. Navigate to HR → Employees → Create employee
3. Navigate to HR → Payroll Runs → Create payroll run
4. Submit for approval
5. Log in as Group Finance Controller
6. Approve payroll
7. Verify payslip generated

### Scenario 5: Approval Workflow
1. Log in as any company user
2. Create a purchase requisition
3. Submit for approval
4. Log in as approver
5. Navigate to Approvals → Pending
6. Approve the requisition
7. Verify status changed

### Scenario 6: Permission Restriction Test
1. Log in as `attendant@mwanjalisi.co.tz` (Ordinary User)
2. Try to access Bank Accounts → should be denied
3. Try to access Loans → should be denied
4. Try to access Payroll → should be denied
5. Try to view other company data → should be denied

## UAT Sign-Off Checklist

For each scenario, the UAT tester should:
- [ ] Execute all steps
- [ ] Verify the expected behavior
- [ ] Note any deviations
- [ ] Sign off on the scenario

Record results in the UAT Test Run form in the system:
- Navigate to QA → Test Runs → Create New Run
- Select "UAT" as the run type
- Record pass/fail for each scenario
