# Regression Test Plan

## 1. Regression Approach

Regression testing in ITEMBA-R ensures that new code changes do not break existing functionality that previously passed QA. The approach is **risk-based regression**: the most critical suites (AUTH, FINANCE, SECURITY, DATA_ISOLATION, ACCOUNTING_VERIFY) are run in full for every release. Lower-priority suites are run selectively based on the scope of changes.

---

## 2. Regression Trigger Events

Regression testing is triggered by:

| Trigger | Regression Scope |
|---|---|
| **New major release** (feature addition) | Full regression — all 22 suites |
| **Minor release** (bug fixes, small features) | Critical suites + affected module suites |
| **Hotfix deployment** | Targeted — the specific module(s) affected by the hotfix |
| **Database migration** | Full regression if schema changes affect multiple modules |
| **Infrastructure change** (server upgrade, Docker version) | Critical suites + sanity check on all modules |

---

## 3. Critical Regression Suites

The following 5 suites are classified as **Critical Regression Suites** and must be run in full for every release:

### Suite 1: AUTH (Authentication & Sessions)
**Scope:** Login (valid/invalid credentials), token refresh, logout, account lockout, password change, 2FA, session revocation, permission enforcement.

**Key test cases:**
- TC-AUTH-001: Valid login returns access and refresh tokens
- TC-AUTH-002: Invalid password returns 401, not 403
- TC-AUTH-003: Account locked after 5 failed attempts
- TC-AUTH-004: Refresh token renews access token before expiry
- TC-AUTH-005: Revoked refresh token is rejected
- TC-AUTH-006: User cannot access routes without a valid token
- TC-AUTH-007: User with no role cannot access any protected route
- TC-AUTH-008: Maker cannot approve their own record (maker-checker)

### Suite 2: FINANCE (Finance & Accounting)
**Scope:** Journal entry balance enforcement, posting to closed periods, AR/AP accuracy, trial balance, P&L, balance sheet.

**Key test cases:**
- TC-FIN-001: Unbalanced journal entry is rejected
- TC-FIN-002: Journal entry to a closed period is rejected
- TC-FIN-003: Posted journal appears in trial balance
- TC-FIN-004: AR invoice posting updates receivables balance
- TC-FIN-005: AP invoice posting updates payables balance
- TC-FIN-006: Trial balance debit total equals credit total
- TC-FIN-007: P&L revenue + expense totals match journal postings
- TC-FIN-008: Balance sheet assets equal liabilities + equity

### Suite 3: SECURITY (Security Controls)
**Scope:** Cross-company access prevention, Group Control access restriction, sensitive data masking, permission denial logging.

**Key test cases:**
- TC-SEC-001: Company A user cannot access Company B data via API
- TC-SEC-002: Bank accounts not returned to non-Group Control users
- TC-SEC-003: Permission denial is logged in security events
- TC-SEC-004: JWT tampering is detected and rejected
- TC-SEC-005: API rate limiting blocks excessive requests
- TC-SEC-006: Sensitive fields (NSSF, salary) not included in general list responses

### Suite 4: DATA_ISOLATION (Cross-Company Data Isolation)
**Scope:** Every API endpoint that returns data must be verified to apply company-level filtering.

**Key test cases:**
- TC-ISO-001: `/api/v1/finance/journals` returns only the authenticated user's company journals
- TC-ISO-002: `/api/v1/hr/employees` returns only the authenticated user's company employees
- TC-ISO-003: Group-level user can see all companies' data
- TC-ISO-004: Company-level user cannot elevate to group-level access
- TC-ISO-005: Division-level user sees only their division's data

### Suite 5: ACCOUNTING_VERIFY (Accounting Verification)
**Scope:** Financial integrity — every transaction that affects the GL must produce balanced entries.

**Key test cases:**
- TC-ACCT-001: Fuel shift close generates correct revenue journal entries
- TC-ACCT-002: Expense payment posts correct debit/credit
- TC-ACCT-003: Payroll run generates balanced journal entries (gross pay = net pay + all deductions)
- TC-ACCT-004: Inter-company transaction creates mirror entries in both companies
- TC-ACCT-005: Depreciation run updates accumulated depreciation and expense account

---

## 4. Regression Test Execution Procedure

### Step 1: Prepare the Regression Environment
1. Deploy the new release to the staging environment.
2. Run database migrations.
3. Verify health check passes.
4. Do not reset the staging database — run regression against existing data.

### Step 2: Create a Regression Test Run
1. Navigate to **QA → Test Runs → New Test Run**.
2. Name the run: `Regression - [Version] - [Date]` (e.g., `Regression - v1.0.1 - 2025-08-20`).
3. Select **Regression** as the run type.
4. Add the 5 critical suites (always) + any affected module suites.
5. Click **Create Run**.

### Step 3: Execute Test Cases
1. For each test case, follow the test steps exactly as documented.
2. Record the result: PASS / FAIL / BLOCKED.
3. For FAILs, take a screenshot and describe the actual vs. expected behavior.
4. Create a launch blocker immediately for any FAIL in the critical suites.

### Step 4: Report Results
1. Navigate to **QA → Test Runs → [Run] → Generate Report**.
2. The report shows: pass rate per suite, total PASS/FAIL/BLOCKED, all open blockers.
3. Share the report with the development team and Group Director.

---

## 5. Pass/Fail Criteria

| Result | Criteria |
|---|---|
| **PASS** | The feature behaves exactly as specified in the test case expected result. |
| **FAIL** | The feature does not match the expected result. A blocker is created if severity warrants. |
| **BLOCKED** | The test cannot be executed due to an environment issue or dependency failure. Escalate immediately. |
| **SKIPPED** | Intentionally not executed (with documented justification). |

### Regression Run Outcome
- **GREEN (Passed):** All critical suite test cases passed. 0 CRITICAL blockers. 0 HIGH blockers.
- **YELLOW (Passed with Risks):** All critical suite test cases passed. Some MEDIUM/LOW failures noted. Risks documented.
- **RED (Failed):** One or more CRITICAL or HIGH failures in the critical suites. Release is blocked until resolved.

---

## 6. Regression Blocker Policy

Any CRITICAL or HIGH severity failure found during regression **blocks the release**. The release cannot proceed until:
1. The failure is fixed by the development team.
2. The specific failed test case is re-executed and passes.
3. The blocker status is updated to **RESOLVED** by the QA Lead.

No exceptions without explicit Group Director sign-off.

---

## 7. Regression Frequency

| Release Type | Regression Timing |
|---|---|
| **Major release** | Full regression 48 hours before deployment |
| **Minor release** | Targeted regression 24 hours before deployment |
| **Hotfix** | Targeted regression 4 hours before deployment |
| **Scheduled maintenance** | Smoke test (AUTH + FINANCE) after maintenance |
