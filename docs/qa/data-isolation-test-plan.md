# Data Isolation Test Plan

## 1. Test Objectives

Data isolation is one of the most critical properties of a multi-company system like ITEMBA-R. The objective of these tests is to **verify with certainty** that:

1. A user in Company A cannot access any data belonging to Company B, Company C, or the Group level (unless they hold explicit group-level access).
2. A user scoped to Division X cannot access data from Division Y within the same company.
3. API endpoints enforce company-level filtering at the server — client-side filtering is not sufficient.
4. Privilege escalation attacks (manipulating request parameters to gain broader access) are blocked.

**Methodology:** All tests are performed at the API level using direct HTTP requests, not just through the frontend UI. The frontend may implement its own filtering, but the backend must also enforce isolation independently.

---

## 2. Test Setup

### Test Accounts Required
| Account | Company | Role | Expected Access |
|---|---|---|---|
| `tester.mwanjalisi@test.local` | Mwanjalisi Oil | Company Manager | Mwanjalisi data only |
| `tester.westsides@test.local` | Westsides | Company Manager | Westsides data only |
| `tester.itemba@test.local` | Itemba Enterprises | Company Manager | Itemba data only |
| `tester.group@test.local` | Group Level | Group Director | All companies (limited) |
| `tester.groupadmin@test.local` | Group Level | Group Super Admin | Full system |

### Test Data Required
- At least 3 customers, 3 invoices, 3 employees in each company.
- At least 1 bank account in Group Control for each company.
- At least 1 loan record in Group Control for each company.

---

## 3. Company Scope Tests

### TC-ISO-COMP-001: Customer List Returns Only Own Company's Customers
**User:** `tester.mwanjalisi@test.local`
**Request:** `GET /api/v1/customers`
**Expected:** Only Mwanjalisi Oil customers are returned. Zero Westsides or Itemba customers appear.
**Verification:** Count returned records and compare against known Mwanjalisi customer count.

### TC-ISO-COMP-002: Cannot Access Specific Record from Another Company by ID
**User:** `tester.mwanjalisi@test.local`
**Setup:** Obtain the ID of a Westsides customer.
**Request:** `GET /api/v1/customers/{westsides_customer_id}`
**Expected:** 404 Not Found or 403 Forbidden. The Westsides customer record is never returned.

### TC-ISO-COMP-003: Journal Entries Scoped to Own Company
**User:** `tester.westsides@test.local`
**Request:** `GET /api/v1/finance/journals`
**Expected:** Only Westsides journal entries are returned.

### TC-ISO-COMP-004: Cannot Update Another Company's Record
**User:** `tester.mwanjalisi@test.local`
**Setup:** Obtain the ID of an Itemba product.
**Request:** `PATCH /api/v1/products/{itemba_product_id}` with updated name.
**Expected:** 404 Not Found or 403 Forbidden. The Itemba product is not updated.

### TC-ISO-COMP-005: Cannot Delete Another Company's Record
**User:** `tester.westsides@test.local`
**Request:** `DELETE /api/v1/customers/{mwanjalisi_customer_id}`
**Expected:** 404 Not Found or 403 Forbidden.

---

## 4. Division Scope Tests

### TC-ISO-DIV-001: Logistics User Sees Only Logistics Data
**User:** Logistics staff member (scoped to Itemba → Logistics division).
**Request:** `GET /api/v1/itemba/agriculture/farms`
**Expected:** 403 Forbidden or empty response — no Agriculture data.

### TC-ISO-DIV-002: Farm Supervisor Does Not See Construction Projects
**User:** Farm Supervisor (Itemba → Agriculture).
**Request:** `GET /api/v1/itemba/construction/projects`
**Expected:** 403 Forbidden.

---

## 5. Branch Scope Tests

### TC-ISO-BRANCH-001: Branch User Sees Only Their Branch's Transactions
**Setup:** Create two branches under Westsides (Mwanza Branch, Dodoma Branch). Assign tester to Mwanza Branch.
**Request:** `GET /api/v1/sales/orders`
**Expected:** Only Mwanza Branch orders are returned — Dodoma orders do not appear.

---

## 6. Permission Boundary Tests

### TC-ISO-PERM-001: Query Parameter Override Attack
**User:** `tester.mwanjalisi@test.local` (Company Manager for Mwanjalisi).
**Request:** `GET /api/v1/customers?companyId={westsides_company_id}`
**Expected:** The `companyId` query parameter is ignored or overridden by the server to enforce the authenticated user's company. Only Mwanjalisi customers are returned.

### TC-ISO-PERM-002: Request Body Company Override Attack
**User:** `tester.mwanjalisi@test.local`
**Request:** `POST /api/v1/finance/journals` with `companyId: {westsides_company_id}` in the body.
**Expected:** The journal entry is created for Mwanjalisi Oil, ignoring the `companyId` in the body. Or the request is rejected.

### TC-ISO-PERM-003: No Over-Fetching in List Responses
All list endpoints must not include records from other companies even in nested/included relations.
**Request:** `GET /api/v1/finance/invoices?include=customer,company`
**Expected:** All returned invoices and their nested customer records belong to the authenticated user's company.

---

## 7. Group Control Access Tests

### TC-ISO-GC-001: Company Manager Cannot Access Bank Accounts
**User:** `tester.mwanjalisi@test.local` (Company Manager — no group_control permissions).
**Request:** `GET /api/v1/group-control/bank-accounts`
**Expected:** 403 Forbidden. Zero bank account records returned.

### TC-ISO-GC-002: Company Manager Cannot Access Loans
**User:** `tester.westsides@test.local`
**Request:** `GET /api/v1/group-control/loans`
**Expected:** 403 Forbidden.

### TC-ISO-GC-003: Group Director Can Access Bank Accounts (Read-Only)
**User:** `tester.group@test.local` (Group Director).
**Request:** `GET /api/v1/group-control/bank-accounts`
**Expected:** 200 OK with bank accounts from all companies.

### TC-ISO-GC-004: Group Director Cannot Create Bank Accounts
**User:** `tester.group@test.local` (Group Director — read-only Group Control).
**Request:** `POST /api/v1/group-control/bank-accounts` with new bank account data.
**Expected:** 403 Forbidden — Group Director has read-only access.

---

## 8. Cross-Company API Endpoint Matrix

Verify these endpoints enforce company-level filtering:

| Endpoint | Isolation Level | Test Status |
|---|---|---|
| `GET /api/v1/customers` | Company | ☐ |
| `GET /api/v1/finance/journals` | Company | ☐ |
| `GET /api/v1/finance/invoices` | Company | ☐ |
| `GET /api/v1/hr/employees` | Company | ☐ |
| `GET /api/v1/hr/payroll` | Company | ☐ |
| `GET /api/v1/petroleum/shifts` | Company | ☐ |
| `GET /api/v1/procurement/purchase-orders` | Company | ☐ |
| `GET /api/v1/sales/orders` | Company + Branch | ☐ |
| `GET /api/v1/group-control/bank-accounts` | Group (restricted) | ☐ |
| `GET /api/v1/group-control/loans` | Group (restricted) | ☐ |
| `GET /api/v1/audit-logs` | Company + Group | ☐ |

---

## 9. Expected Results

| Test Category | Expected Pass Rate | Required for Go-Live |
|---|---|---|
| Company Scope Tests | 100% | Yes — CRITICAL |
| Division Scope Tests | 100% | Yes — CRITICAL |
| Permission Boundary Tests | 100% | Yes — CRITICAL |
| Group Control Tests | 100% | Yes — CRITICAL |
| Cross-Company API Matrix | 100% | Yes — CRITICAL |

**Any failure in data isolation is a CRITICAL launch blocker.** No exceptions.

---

## 10. Failure Handling

If a data isolation test fails:
1. **Immediately create a CRITICAL launch blocker** in the QA system.
2. **Do not continue testing other isolation scenarios** until the failing test is investigated — the same flaw may affect multiple endpoints.
3. The development team must fix the issue at the backend service layer (not just the frontend).
4. Re-run the full Data Isolation suite after the fix is deployed.
5. The QA Lead must personally verify the fix before closing the blocker.
