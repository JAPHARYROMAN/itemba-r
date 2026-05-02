# Security Test Plan

## 1. Security Test Objectives

The security test plan verifies that ITEMBA-R protects company data, prevents unauthorized access, and maintains an auditable record of all sensitive activities. Given that ITEMBA-R handles multi-company financial data, employee payroll, and sensitive corporate records, security testing is non-negotiable before go-live.

**Objectives:**
1. Verify that authentication is robust against common attack patterns.
2. Verify that authorization prevents any cross-company or out-of-role data access.
3. Verify that sessions can be managed and revoked effectively.
4. Verify that sensitive data is not exposed through API responses.
5. Verify that API keys and webhooks are secured.
6. Verify that the audit log is complete and tamper-proof.

---

## 2. Authentication Tests

### TC-SEC-AUTH-001: Valid Login
- **Setup:** Active user account with known password.
- **Steps:** POST `/api/v1/auth/login` with correct email and password.
- **Expected:** 200 OK with `accessToken` and `refreshToken` in response.

### TC-SEC-AUTH-002: Invalid Password
- **Steps:** POST `/api/v1/auth/login` with correct email, wrong password.
- **Expected:** 401 Unauthorized. Response body does NOT reveal whether the email exists.

### TC-SEC-AUTH-003: Non-Existent Email
- **Steps:** POST `/api/v1/auth/login` with an email not in the database.
- **Expected:** 401 Unauthorized. Response body is identical to TC-SEC-AUTH-002 (no email enumeration).

### TC-SEC-AUTH-004: Brute Force Protection
- **Steps:** Send 6 consecutive invalid login attempts for the same email.
- **Expected:** On the 6th attempt, the account is locked. Response: 429 or 401 with "Account locked" message.

### TC-SEC-AUTH-005: Token Expiry
- **Steps:** Obtain a valid access token. Wait 16 minutes (or manipulate the server time). Attempt a protected API call.
- **Expected:** 401 Unauthorized — "Token expired" or "jwt expired" error.

### TC-SEC-AUTH-006: Refresh Token Renewal
- **Steps:** Obtain a refresh token. POST `/api/v1/auth/refresh` with the refresh token.
- **Expected:** 200 OK with a new `accessToken` (and optionally a new refresh token).

### TC-SEC-AUTH-007: Revoked Refresh Token
- **Steps:** Obtain a refresh token. Revoke the session via the admin UI. Attempt to use the revoked refresh token.
- **Expected:** 401 Unauthorized.

### TC-SEC-AUTH-008: JWT Tampering
- **Steps:** Obtain a valid JWT. Modify the payload (e.g., change `role` or `companyId`). Send the tampered token.
- **Expected:** 401 Unauthorized — signature verification fails.

---

## 3. Authorization Tests

### TC-SEC-AUTHZ-001: Cross-Company Access via API (Company A → Company B)
- **Setup:** User X belongs to Company A only. Company B has customers with known IDs.
- **Steps:** Authenticate as User X. GET `/api/v1/customers?companyId=[Company B ID]`.
- **Expected:** 403 Forbidden or empty result (no Company B customers returned).

### TC-SEC-AUTHZ-002: Accessing Records by ID from Another Company
- **Steps:** Authenticate as User X (Company A). GET `/api/v1/finance/journals/[Company B Journal ID]`.
- **Expected:** 404 Not Found or 403 Forbidden — never returns Company B's journal.

### TC-SEC-AUTHZ-003: Role Boundary — Fuel Attendant Cannot Set Prices
- **Steps:** Authenticate as a Fuel Attendant. POST `/api/v1/petroleum/prices` with a new price.
- **Expected:** 403 Forbidden.

### TC-SEC-AUTHZ-004: Group Control Access Denied to Company User
- **Steps:** Authenticate as a Company Manager (no group_control permissions). GET `/api/v1/group-control/bank-accounts`.
- **Expected:** 403 Forbidden.

### TC-SEC-AUTHZ-005: Maker-Checker — Cannot Approve Own Record
- **Steps:** User A creates an expense and submits it for approval. User A attempts to approve it.
- **Expected:** 403 Forbidden — "You cannot approve your own submission."

### TC-SEC-AUTHZ-006: Read-Only Role Cannot Write
- **Steps:** Authenticate as Group Auditor. POST `/api/v1/finance/journals` with a new journal entry.
- **Expected:** 403 Forbidden.

---

## 4. Session Management Tests

### TC-SEC-SESS-001: Admin Can Revoke Any Session
- **Steps:** User A is logged in. Admin navigates to Active Sessions and revokes User A's session. User A attempts a protected API call.
- **Expected:** User A receives 401 Unauthorized.

### TC-SEC-SESS-002: User Can Revoke Own Session
- **Steps:** User A has two active sessions. User A revokes one session via My Profile → Security.
- **Expected:** The revoked session token is rejected. The other session remains valid.

### TC-SEC-SESS-003: Maximum Concurrent Sessions
- **Setup:** Maximum sessions per user set to 3 in security policy.
- **Steps:** Log in as the same user from 4 different browsers/devices.
- **Expected:** The oldest session is automatically invalidated when the 4th login is created (or the 4th login is rejected — per configuration).

---

## 5. Sensitive Data Tests

### TC-SEC-DATA-001: Bank Accounts Not Exposed to Company Users
- **Steps:** Authenticate as Company Manager. GET all endpoints in the finance, procurement, and HR modules.
- **Expected:** No bank account numbers appear in any response. Group Control data is completely absent.

### TC-SEC-DATA-002: Payroll Data Masking
- **Steps:** Authenticate as a General User. GET `/api/v1/hr/payroll`.
- **Expected:** 403 Forbidden — no payroll data is returned.

### TC-SEC-DATA-003: Employee Sensitive Fields Not in List Responses
- **Steps:** Authenticate as Sales Officer. GET `/api/v1/hr/employees`.
- **Expected:** 403 Forbidden or if the endpoint returns basic employee info, salary and NSSF numbers must not be included.

### TC-SEC-DATA-004: Group Control Sensitive Access is Audit-Logged
- **Steps:** Authenticate as Group Finance Controller. View a bank account record.
- **Expected:** Navigate to Group Control → Access Audit Log. The access event is recorded with user, timestamp, IP, and record reference.

---

## 6. API Key Security Tests

### TC-SEC-API-001: Request Without API Key Rejected
- **Steps:** Call a protected API endpoint with no Authorization header.
- **Expected:** 401 Unauthorized.

### TC-SEC-API-002: Revoked API Key Rejected
- **Steps:** Create an API key. Make a successful API call. Revoke the key. Attempt another call with the same key.
- **Expected:** 401 Unauthorized immediately after revocation.

### TC-SEC-API-003: API Key Scope Enforcement
- **Steps:** Create an API key scoped to read-only petroleum data. Attempt to POST a new fuel delivery using this key.
- **Expected:** 403 Forbidden.

---

## 7. Webhook Signature Verification

### TC-SEC-WH-001: Valid Webhook Signature Accepted
- **Steps:** Configure a webhook with a secret. Trigger an event. The receiving endpoint verifies the HMAC-SHA256 signature.
- **Expected:** Signature matches — payload is processed.

### TC-SEC-WH-002: Invalid Signature Rejected
- **Steps:** Replay a webhook payload with a modified signature.
- **Expected:** The receiving endpoint rejects the payload (signature mismatch).

---

## 8. Audit Log Completeness

### TC-SEC-AUDIT-001: All Group Control Accesses Logged
Run the sequence: view a bank account, edit a loan record, download a document.
**Expected:** All 3 events appear in the Sensitive Access Audit Log with correct action, user, and timestamp.

### TC-SEC-AUDIT-002: Failed Permission Attempt Logged
**Steps:** Attempt to access a Group Control endpoint as a Company Manager.
**Expected:** The failed access attempt is recorded in Security Events with action = `PERMISSION_DENIED`.

### TC-SEC-AUDIT-003: Audit Log is Read-Only
**Steps:** Authenticate as Group Super Admin. Attempt to DELETE an audit log entry via the API.
**Expected:** 405 Method Not Allowed or 403 Forbidden.

---

## 9. Penetration Test Checklist

Before go-live, the following penetration test scenarios should be completed by the IT Administrator:

- [ ] SQL injection on all login, search, and filter inputs
- [ ] XSS (Cross-Site Scripting) on all text input fields
- [ ] CSRF (Cross-Site Request Forgery) protection on state-changing requests
- [ ] Path traversal on file upload/download endpoints
- [ ] IDOR (Insecure Direct Object Reference) on all record-by-ID endpoints
- [ ] Rate limiting effectiveness (test throttle limits)
- [ ] HTTP security headers present (Helmet): HSTS, X-Frame-Options, CSP
- [ ] Sensitive data in URLs (no tokens, passwords, or IDs in GET query strings)
- [ ] TLS configuration: minimum TLS 1.2, strong cipher suites
- [ ] Docker container runs as non-root user
