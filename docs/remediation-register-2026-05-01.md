# ITEMBA-R Remediation Register

Date opened: 2026-05-01

Source: `docs/master-audit-remediation-plan-2026-05-01.md`

Phase 0 baseline: `docs/phase-0-stabilization-baseline-2026-05-01.md`

Phase 2 progress: `docs/phase-2-progress-2026-05-01.md`

Phase 3 progress: `docs/phase-3-progress-2026-05-01.md`

Phase 4 progress: `docs/phase-4-progress-2026-05-01.md`

Phase 5 progress: `docs/phase-5-progress-2026-05-01.md`

Phase 6 progress: `docs/phase-6-progress-2026-05-01.md`

Phase 6 slice 2 progress: `docs/phase-6-slice-2-progress-2026-05-01.md`

Phase 3-6 post-review gap remediation: `docs/phase-3-6-gap-remediation-2026-05-01.md`

Status model:

- Open: not started.
- In progress: active remediation work.
- Blocked: cannot proceed without an external decision or prerequisite.
- Ready for review: implementation complete, verification pending.
- Verified: acceptance criteria passed.
- Accepted risk: explicitly deferred with named owner and expiry date.

---

## 1. Release Gate

Current gate status: blocked.

Gate owner: Product/Engineering leadership.

Reason:

- P0 issues remain open.
- Build/test/deployment baseline is not clean.
- Company isolation and core transactional controls are not yet remediated.

---

## 2. P0 Register - Ship Blockers

| ID | Title | Workstream | Status | Phase | Verification gate |
|---|---|---|---|---|---|
| P0-01 | Cross-company isolation / IDOR across business modules | Security/Tenancy | In progress | 1-5 | Cross-company e2e suite passes for all high-risk modules |
| P0-02 | Frontend production build fails | Frontend | Verified | 1 | `npm run verify:frontend:local` passes |
| P0-03 | Production env/Docker deployment broken or unsafe | DevOps/Runtime | In progress | 1 | Production compose validates with required secrets and migration path |
| P0-04 | Inventory stock corruption risks | Finance/Inventory | In progress | 2 | Concurrent movement and negative-stock tests pass |
| P0-05 | Fuel-shift close is not atomic | Finance/Inventory | In progress | 2 | Close-shift transaction/idempotency tests pass |
| P0-06 | Jobs, backups, exports, schedules lack reliable worker path | DevOps/Runtime | In progress | 3 | Worker creates real export/backup artifacts and reports failures |
| P0-07 | Role assignment workflow incomplete | Security/Tenancy + Frontend | In progress | 3 | User role assignment works through API/UI and is audited |
| P0-08 | Registration, CSRF, and login hardening gaps | Security/Tenancy + Frontend | In progress | 1 | Auth abuse and CSRF tests pass |
| P0-09 | API-key authentication exists but is unused | Security/Tenancy + Integrations | In progress | 3 | API-key scope enforcement tests pass |
| P0-10 | Payroll/accounting side effects can fail after status changes | Finance/Inventory | In progress | 2 | Payroll status cannot finalize with failed required postings |

### P0-01 Breakdown

Progress:

- 2026-05-01: `journal-entries` controller/service now pass `CurrentUser`, apply `CompanyScopeService.companyWhereFor()` on list, and assert record company access before detail/update/post/reverse/delete.
- 2026-05-01: `inventory-movements` list/detail paths now pass `CurrentUser` and apply scoped company filtering/access assertions.
- 2026-05-01: payroll approval/payment transactions now re-check company access after locking the payroll run row.
- 2026-05-01: post-review patch tightened `fuel-shifts` so all workflow writes and attendant-management writes pass `AuthUser` and assert company WRITE access before mutation.
- 2026-05-01: post-review patch prevented `cash-accounts.update()` from changing `companyId` after WRITE access is asserted on the existing record.
- 2026-05-01: wave 4 tightened `customer-statements`, `supplier-statements`, `supplier-quotations`, and `three-way-matching`: list/detail routes now receive `CurrentUser`, use `CompanyScopeService.companyWhereFor()` / `assertCanAccessCompany()`, mutation routes require WRITE access, statement generation validates customer/supplier ownership, supplier quotation update rejects company reassignment, and three-way matching validates procurement references against the selected company.
- 2026-05-01: wave 5 tightened `data-exports` and `report-runs`: list/detail routes now validate company scope, create routes require WRITE access to the target company, report runs validate saved report views before use, and cancel requires WRITE access.
- 2026-05-01: `COMPANY_ID_QUERY_OVERRIDE` static-analysis baseline reduced to 171 files after wave 5.

Required module sequence:

1. Journal entries.
2. Payroll runs.
3. Fuel shifts.
4. Inventory movements.
5. Customers.
6. Sales orders.
7. Data exports and reports.
8. Users and roles.
9. Tenants/company administration.
10. Remaining company-owned modules.

Controls:

- Controller methods must pass `CurrentUser`.
- Services must use canonical company scope.
- Client-supplied `companyId` must be validated, not trusted.
- `findOne` paths must assert record company access.
- Create/update paths must prevent cross-company mass assignment.

### P0-02 Breakdown

Status:

- Verified on 2026-05-01.
- `npm run verify:frontend:local` passes after JSX entity fixes and the `/reports/run` Suspense boundary fix.

Files with current blocking errors:

1. `frontend/src/app/(dashboard)/construction/billing/page.tsx`
2. `frontend/src/app/(dashboard)/construction/labour-cost/page.tsx`
3. `frontend/src/app/(dashboard)/hospitality/folio/[bookingId]/page.tsx`
4. `frontend/src/app/(dashboard)/hr/disputes/[id]/page.tsx`
5. `frontend/src/app/(dashboard)/hr/petroleum-commissions/page.tsx`
6. `frontend/src/app/(dashboard)/petroleum/fuel-shifts/page.tsx`
7. `frontend/src/app/(dashboard)/petroleum/fuel-shifts/[id]/page.tsx`
8. `frontend/src/app/(dashboard)/settings/preferences/page.tsx`
9. `frontend/src/app/(dashboard)/westsides/daily-close/page.tsx`

Required fix:

- Escape text entities or rewrite text content.
- Do not disable lint globally to hide the failure.

### P0-03 Breakdown

Progress:

- 2026-05-01: production compose now fails fast on missing `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `TWO_FACTOR_ENCRYPTION_KEY`, `REFRESH_TOKEN_PEPPER`, `REDIS_PASSWORD`, `FRONTEND_URL`, `CORS_ORIGIN`, and `NEXT_PUBLIC_API_URL`.
- 2026-05-01: production compose now includes a `backend-migrate` one-shot service using the backend Dockerfile `migration` target.
- 2026-05-01: backend Dockerfile has a non-root production user, OpenSSL installed for Prisma, and an increased builder Node heap.
- 2026-05-01: `.dockerignore` no longer excludes `backend/src/modules/backups`.
- 2026-05-01: backend production target and migration target both build.
- Residual: frontend Docker image build exceeded a 15-minute local verification timeout and still needs a clean pass/fail.

Required deployment fixes:

1. Add `TWO_FACTOR_ENCRYPTION_KEY` to production compose and production env examples.
2. Align `CORS_ORIGIN` and remove/alias stale `ALLOWED_ORIGINS`.
3. Fail fast on blank `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET`.
4. Add `prisma migrate deploy` path before API startup.
5. Add non-root users to production Docker images.
6. Ensure Redis cannot start with `--requirepass` and an empty value.

### P0-04 Breakdown

Progress:

- 2026-05-01: movement direction classification now treats `PURCHASE_RETURN` as outbound.
- 2026-05-01: inventory balance updates now run behind a transaction and row lock.
- 2026-05-01: outbound stock movements now reject negative on-hand and insufficient available stock.
- 2026-05-01: movement creation now validates product, unit, location, active/deleted state, and company consistency.
- 2026-05-01: backend validation/type/build gate passed.

Required inventory fixes:

1. Correct movement direction classification, especially `PURCHASE_RETURN`.
2. Use transaction-safe atomic balance mutation.
3. Reject negative stock unless a formal override policy exists.
4. Validate product/unit/location/company consistency.
5. Add concurrency tests.

### P0-05 Breakdown

Progress:

- 2026-05-01: fuel-shift close now locks the shift row and runs close writes in one transaction.
- 2026-05-01: already closed shifts now return an idempotent summary instead of writing again.
- 2026-05-01: close preconditions are validated before writes, including tank inventory location, reading/tank/company/branch/product consistency, and product base unit.
- 2026-05-01: nozzle reading updates, nozzle meter updates, inventory movements, collection aggregation, shift status, and generated attendance records now share the close transaction.
- 2026-05-01: fuel-shift delete audit action corrected to `FUEL_SHIFT_DELETE`.
- 2026-05-01: backend validation/type/build gate passed.

Required fuel-shift fixes:

1. Validate all close preconditions before writing.
2. Wrap close operation in one transaction.
3. Add idempotency.
4. Fail early if a tank lacks inventory location.
5. Correct audit action names.

### P0-06 Breakdown

Required runtime fixes:

1. Select worker runtime.
2. Add worker process/container.
3. Wire exports to actual artifact generation.
4. Wire backups to actual backup and restore verification.
5. Add retry/dead-letter handling.
6. Add worker health and job failure visibility.

### P0-07 Breakdown

Required role fixes:

1. Add user-role assignment API.
2. Add role assignment UI.
3. Enforce company/role scope.
4. Audit role changes.
5. Add tests proving permission effects.

### P0-08 Breakdown

Progress:

- 2026-05-01: login now has a route-specific throttle.
- 2026-05-01: register now has a route-specific throttle.
- 2026-05-01: public registration is disabled unless `ALLOW_PUBLIC_REGISTRATION` is explicitly enabled.
- 2026-05-01: frontend auth cookies use `sameSite: 'strict'`.
- 2026-05-01: login issues a non-httpOnly CSRF cookie and the backend proxy rejects unsafe methods without same-origin request metadata and matching `x-csrf-token`.
- 2026-05-01: dashboard fetch calls are patched to attach CSRF headers for unsafe `/api/backend/*` requests; shared `backendFetch` does the same.
- Residual: auth abuse and CSRF behavior still need automated tests.

Required auth fixes:

1. Disable public register or make it invite/admin-approved.
2. Add email verification if registration remains public.
3. Add login throttle.
4. Add register throttle.
5. Add CSRF token requirement for state-changing frontend proxy requests.
6. Add Origin/Referer allowlist checks.

### P0-09 Breakdown

Required API-key fixes:

1. Identify integration endpoints.
2. Apply API-key guard.
3. Define route scopes.
4. Add key revocation and per-key throttling.
5. Add tests.

### P0-10 Breakdown

Progress:

- 2026-05-01: payroll posting helpers now accept a Prisma transaction client.
- 2026-05-01: payroll approval now creates and links the accrual journal entry before committing `APPROVED`; posting failure rolls back the status transition.
- 2026-05-01: payroll payment now keeps `PAID` status, salary-advance recovery sync, sales-commission settlement, payment journal, project labour allocation, and labour reclass journal in one transaction.
- 2026-05-01: salary-advance payment now commits `PAID` and its disbursement journal in one transaction.
- 2026-05-01: payroll run, salary advance, and sales commission rows are locked where required for finalization updates.
- 2026-05-01: backend validation/type/build gate passed.

Required payroll/accounting fixes:

1. Identify all payroll status transitions with accounting side effects.
2. Wrap required side effects in transactions where possible.
3. Use pending/failed posting states for asynchronous side effects.
4. Add reconciliation and retry path.
5. Block period close on unresolved posting failures.

---

## 3. P1 Register - Enterprise Blockers

| ID | Title | Workstream | Status | Target phase |
|---|---|---|---|---|
| P1-01 | Active sessions are not authoritative | Security/Tenancy | In progress | 3 |
| P1-02 | Permission/user cache is per-process | Security/Tenancy | In progress | 3 |
| P1-03 | TOTP encryption uses unauthenticated AES-CBC | Security/Tenancy | Verified | 5 |
| P1-04 | Generic encryption key fallback is unsafe | Security/Tenancy | Verified | 3 |
| P1-05 | Security policies are records, not enforced controls | Security/Tenancy | Open | 3 |
| P1-06 | User deletion and admin changes lack sufficient auditability | Security/Tenancy | Verified (soft-delete + audit) | 3 |
| P1-07 | Report/export/download authorization is inconsistent | Security/Tenancy + DevOps/Runtime | In progress | 5 |
| P1-08 | Frontend auth proxy lacks robust expired-token retry | Frontend | Verified | 3 |
| P1-09 | Sensitive access interceptor logs only successes | Security/Tenancy | Verified | 3 |
| P1-10 | Account enumeration and security event logging weaknesses | Security/Tenancy | Verified | 3 |

---

### P1-07 Progress

- 2026-05-01: `data-exports` now applies canonical company scoping on list/detail, rejects unauthorized export targets before enqueueing background jobs, and records the resolved company in audit payloads.
- 2026-05-01: `report-runs` now applies canonical company scoping on list/detail, rejects unauthorized report-run targets before writing, validates saved report view ownership/sharing and company compatibility, and requires WRITE access before cancellation.
- 2026-05-01: `saved-report-views` now applies canonical company scoping on list/detail, defaults company-scoped creates to the caller's company, rejects unauthorized target companies, blocks company reassignment, and requires WRITE access plus ownership/group scope for mutations.
- Residual: scheduled reports, dashboard/report downloads, and export artifact retrieval still need the same authorization review before P1-07 can be marked verified.

---

## 4. P2 Register - Quality And Reliability

| ID | Title | Workstream | Status | Target phase |
|---|---|---|---|---|
| P2-01 | Test coverage too thin for platform size | QA/Automation | In progress | 4 |
| P2-02 | Frontend test dependency/install state incomplete | Frontend + QA/Automation | Verified | 1 |
| P2-03 | Backend test command does not complete | Backend + QA/Automation | Verified | 4 |
| P2-04 | Excessive `any` and DTO spreading weaken correctness | All engineering | Open | 5 |
| P2-05 | JavaScript number arithmetic in money/quantity workflows | Finance/Inventory | In progress | 2-5 |
| P2-06 | Audit classification and naming inconsistent | Security/Tenancy | In progress | 5 |
| P2-07 | Raw HTML preview creates XSS risk | Frontend + Security/Tenancy | Verified | 5 |
| P2-08 | Frontend hook dependency warnings and stale state risks | Frontend | Open | 5 |
| P2-09 | Build and script hygiene issues | DevOps/Runtime | In progress | 4 |
| P2-10 | Module count and AppModule composition difficult to govern | Architecture | Open | 6+ |

---

### P2-05 Progress

- 2026-05-01: inventory balance mutation now centralizes movement sign handling and quantity validation.
- 2026-05-01: payroll advance recovery updates round cumulative recovered amounts at the transaction boundary.
- Residual: broad Decimal/Prisma Decimal policy is still required across finance, inventory, payroll, tax, and costing modules.

---

## 5. P3 Register - ERP Maturity

| ID | Title | Workstream | Status | Target phase |
|---|---|---|---|---|
| P3-01 | General ledger and posting engine | Product/ERP Controls + Finance | In progress | 6+ |
| P3-02 | Approval engine as enforcement layer | Product/ERP Controls | Open | 6+ |
| P3-03 | Financial consolidation and group reporting | Finance/Product | Open | 6+ |
| P3-04 | Inventory costing and reservation depth | Finance/Inventory | Open | 6+ |
| P3-05 | Manufacturing/project depth | Product/ERP Controls | Open | 6+ |
| P3-06 | Enterprise analytics and observability | DevOps/Runtime + Product | Open | 6+ |
| P3-07 | Compliance-grade audit and records | Security/Tenancy + Product | Open | 6+ |

### P3-01 Progress

- 2026-05-01: `PostingEngineService.postLines()` added as the canonical path for workflows that already resolved exact debit/credit accounts but still need period-lock enforcement, balance validation, and centralized JournalEntry / JournalEntryLine creation.
- 2026-05-01: `ExpensesService.pay()` now uses `PostingEngineService.postLines()` instead of writing `journalEntry` / `journalEntryLine` rows directly. `GL_DIRECT_POSTING_OUTSIDE_ENGINE` baseline reduced from 6 to 5.

---

## 6. Phase 1 Working Queue

These are the first issues to pull from the register.

| Order | ID | Workstream | Reason |
|---:|---|---|---|
| 1 | P0-02 | Frontend | Unblocks root verification and CI build |
| 2 | P2-02 | Frontend/QA | Makes frontend tests executable |
| 3 | P0-03 | DevOps/Runtime | Makes production boot path honest and fail-fast |
| 4 | P0-08 | Security/Tenancy | Removes obvious auth/proxy exposure |
| 5 | P0-01 | Security/Tenancy | Starts the largest and most important security refactor |
| 6 | P0-04 | Finance/Inventory | Stops stock corruption risks |
| 7 | P0-05 | Finance/Inventory | Stops fuel close partial-write risk |
| 8 | P0-07 | Security/Tenancy/Frontend | Makes user onboarding operational |

---

## 7. Register Maintenance Rules

1. No P0 item may be closed without a passing verification command or regression test.
2. No severity downgrade may happen without an explicit rationale in this file.
3. No P0 accepted risk may be left without a named owner and expiry date.
4. Code changes that touch company-owned records must include a cross-company test.
5. Code changes that touch stock, fuel, payroll, or GL posting must include rollback/failure-path tests.
6. Production config changes must be verified through compose rendering and boot smoke test.
7. The release gate remains blocked until all P0 items are verified or formally accepted with written risk approval.
