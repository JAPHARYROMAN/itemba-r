# Role & Permission Guide

## Overview

ITEMBA-R uses Role-Based Access Control (RBAC) with 26 predefined roles. Each role is a named collection of permissions. Users can hold multiple roles across one or more companies. This guide describes all roles, their permissions, and how to assign and manage them.

---

## 1. Complete Role List

### Group-Level Roles (cross-company access)

| # | Role | Description | Typical Users |
|---|---|---|---|
| 1 | **Group Super Admin** | Full system access across all companies. Can manage users, roles, companies, system settings. | IT Administrator only |
| 2 | **Group Director** | Read access to all company data and Group Control. Approve high-value transactions and launch sign-off. | Group Owner/CEO |
| 3 | **Group Finance Controller** | Full finance access across all companies. Approve payroll, journals, and period close. | CFO, Head of Finance |
| 4 | **Group Compliance Officer** | Access to compliance obligations, tax filings, and regulatory documents across all companies. | Compliance Manager |
| 5 | **Group HR Manager** | HR and payroll access across all companies. | HR Director |
| 6 | **Group Auditor** | Read-only access to all modules including audit logs and Group Control. Cannot create or modify records. | External/Internal Auditor |

### Company-Level Roles (scoped to one company)

| # | Role | Description | Typical Users |
|---|---|---|---|
| 7 | **Company Manager** | Full operational access within a single company. Cannot access Group Control sensitive records. | Company General Manager |
| 8 | **Finance Manager** | Full finance and accounting access for the company. | Finance Manager |
| 9 | **Accountant** | Journal entries, invoices, expense approvals, bank reconciliation, reports. Cannot approve payroll. | Accountant, Finance Officer |
| 10 | **Procurement Officer** | Requisitions, RFQs, POs, GRNs, supplier management. | Procurement Officer |
| 11 | **Sales Officer** | Sales orders, quotations, delivery notes, customer management, invoicing. | Sales Executive, Counter Staff |
| 12 | **Inventory Clerk** | Inventory movements, stock adjustments, product catalog (read), goods received. | Storekeeper, Warehouse Staff |
| 13 | **HR Officer** | Employee records, attendance, leave management. Cannot approve payroll (requires HR Manager). | HR Assistant |
| 14 | **Payroll Officer** | HR plus payroll processing and payslip generation. Cannot approve payroll. | Payroll Clerk |
| 15 | **Compliance Officer** | Company-level compliance obligations, licenses, tax filings. | Compliance Officer |

### Module-Specific Operational Roles

| # | Role | Description | Typical Users |
|---|---|---|---|
| 16 | **Petroleum Supervisor** | Full petroleum module: shifts, tanks, deliveries, credit sales, reports. | Fuel Station Manager |
| 17 | **Fuel Attendant** | Open/close shifts, record nozzle readings, record collections. Cannot configure tanks/prices. | Fuel Pump Attendant |
| 18 | **Westsides Supervisor** | Full Westsides module: products, batches, POS, wholesale, returnables, reports. | Westsides Branch Manager |
| 19 | **POS Cashier** | POS transactions, daily session open/close. Read-only product catalog. | Cashier |
| 20 | **Logistics Supervisor** | Full logistics module: vehicles, drivers, trips, fuel, maintenance, billing. | Transport Manager |
| 21 | **Driver** | View assigned trips. Record trip updates (start, in transit, delivered, returned). | Truck Driver |
| 22 | **Farm Supervisor** | Full agriculture module: farms, seasons, inputs, harvests, produce inventory. | Farm Manager |
| 23 | **Construction Supervisor** | Full construction module: projects, BOQ, materials, labour, subcontractors, billing. | Site Engineer, Project Manager |
| 24 | **Hospitality Supervisor** | Full hospitality module: rooms, bookings, housekeeping, restaurant, bar, reports. | Uzunguni Inn Manager |
| 25 | **Front Desk Staff** | Bookings, check-in/check-out, folio management, payments. Cannot manage room types/rates. | Receptionist |
| 26 | **General User** | Login, view own profile, view notifications, submit approvals, submit support tickets, view Help Center. | Any staff member with system access |

---

## 2. Permission Groups by Module

### Authentication Module (`auth.*`)
- `auth.login` — Can log in
- `auth.refresh` — Can refresh tokens
- `auth.2fa.setup` — Can set up 2FA
- `auth.sessions.revoke_own` — Can revoke own sessions
- `auth.sessions.revoke_all` — Can revoke any user's session (Admin only)

### Finance Module (`finance.*`)
- `finance.coa.view` / `create` / `update` / `delete`
- `finance.journals.view` / `create` / `post` / `reverse`
- `finance.expenses.submit` / `approve` / `pay`
- `finance.receivables.view` / `create` / `record_payment`
- `finance.payables.view` / `create` / `record_payment`
- `finance.bank_reconciliation.view` / `create` / `complete`
- `finance.periods.view` / `close` / `reopen`
- `finance.reports.view` / `export`
- `finance.depreciation.run`

### Procurement Module (`procurement.*`)
- `procurement.requisitions.create` / `approve`
- `procurement.rfq.create` / `send`
- `procurement.quotations.record` / `compare`
- `procurement.purchase_orders.create` / `approve` / `issue`
- `procurement.grn.create` / `confirm`
- `procurement.invoices.create` / `verify_match`
- `procurement.suppliers.view` / `manage`

### Petroleum Module (`petroleum.*`)
- `petroleum.tanks.view` / `manage`
- `petroleum.pumps.view` / `manage`
- `petroleum.prices.view` / `set`
- `petroleum.shifts.open` / `close` / `view`
- `petroleum.nozzle_readings.record`
- `petroleum.collections.record`
- `petroleum.deliveries.record`
- `petroleum.dips.record`
- `petroleum.credit_sales.create` / `view`
- `petroleum.reports.view` / `export`

### Group Control Module (`group_control.*`)
- `group_control.companies.view` / `update`
- `group_control.bank_accounts.view` / `create` / `update`
- `group_control.loans.view` / `create` / `update` / `record_repayment`
- `group_control.fixed_assets.view` / `create` / `update`
- `group_control.contracts.view` / `create` / `update`
- `group_control.documents.view` / `upload` / `download`
- `group_control.access_audit.view`

### HR Module (`hr.*`)
- `hr.employees.view` / `create` / `update`
- `hr.attendance.record` / `view` / `import`
- `hr.leave.request` / `approve` / `manage`
- `hr.payroll.generate` / `review` / `approve` / `pay`
- `hr.payslips.view_own` / `view_all` / `send`
- `hr.advances.request` / `approve`
- `hr.documents.upload` / `view`
- `hr.performance.create` / `view`

### Security Module (`security.*`)
- `security.users.view` / `manage`
- `security.roles.view` / `manage`
- `security.sessions.view` / `revoke`
- `security.events.view`
- `security.policies.view` / `update`
- `security.backup.run` / `restore`
- `security.health.view`
- `security.releases.manage`

---

## 3. How to Assign Roles to Users

### Single Role Assignment
1. Navigate to **Settings → Users → [User] → Roles → Add Role**.
2. Select the role from the dropdown.
3. Select the **company scope** (or Group Level for cross-company roles).
4. Click **Save**.

### Bulk Role Assignment (when onboarding multiple users)
1. Navigate to **Settings → Users → Bulk Actions → Assign Role**.
2. Select users.
3. Select the role and company scope.
4. Click **Apply**.

---

## 4. Custom Permission Patterns

### Adding a Permission to a Role
1. Navigate to **Settings → Roles → [Role] → Permissions**.
2. Use the filter to find the permission.
3. Toggle the permission on.
4. Click **Save Changes**.

### Common Custom Patterns

**Finance Controller who can also manage compliance:**
- Assign `Finance Manager` role + `Compliance Officer` role to the same user.

**Auditor with petroleum read access:**
- Assign `Group Auditor` role + add `petroleum.reports.view` permission override.

**Multi-company Accountant:**
- Assign `Accountant` role scoped to Company A + `Accountant` role scoped to Company B.

---

## 5. Group Control Sensitive Access

Group Control permissions are the most restricted in the system:
- `group_control.*` permissions are only available on Group-level roles.
- They cannot be assigned to Company-level role scopes.
- Even Group-level users only see Group Control data for companies they are explicitly authorized for.
- Every access to Group Control records generates an audit event in the Sensitive Access Audit Log.

Roles with any Group Control access:
- Group Super Admin (full)
- Group Director (read-only)
- Group Finance Controller (bank accounts, loans, fixed assets)
- Group Compliance Officer (compliance documents, licenses)
- Group Auditor (read-only all)

---

## 6. Company vs. Group Permissions

| Permission Type | Scope | Isolation |
|---|---|---|
| **Company-scoped** | One company only | User sees only their company's data |
| **Group-level** | All companies | User can see all companies (subject to Group Control rules) |
| **Division-scoped** | One division within a company | User sees only their division's operational data |

The backend enforces scope at the API layer — even if a frontend bug exposes a company selection, the API will return 403 Forbidden for out-of-scope data.
