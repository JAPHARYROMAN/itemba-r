# ITEMBA-R Master Audit And Rectification Plan

Date: 2026-05-01

Source reports:

- `docs/audit-report-2026-05-01.md`
- `docs/top-down-code-audit-2026-05-01.md`
- `docs/audit-comparison-2026-05-01.md`

Purpose: consolidate both independent audits into one actionable master plan, remove duplicate findings, preserve the strongest evidence from each report, and define a rectification path that can move ITEMBA-R from beta/pre-pilot status toward a defensible enterprise ERP release.

---

## 1. Consolidated Verdict

ITEMBA-R has the scope and structural ambition of a serious group ERP platform. It already contains broad coverage across group control, finance, procurement, inventory, petroleum retail, payroll, tax/compliance, hospitality, construction, logistics, agriculture, BI, integrations, security, launch readiness, training, and support.

The platform is not production-ready.

The blockers are not mostly feature gaps. They are control-plane gaps:

1. Company isolation is not uniformly enforced.
2. The frontend production build currently fails.
3. Production deployment configuration is incomplete and unsafe.
4. Inventory and fuel-shift operations can corrupt stock and accounting state.
5. Background jobs, backups, and exports are modeled but not reliably executed.
6. Authentication/session/registration controls need enterprise hardening.
7. Role assignment and user lifecycle management are incomplete.
8. Financial posting and payroll side effects are not consistently atomic.
9. Tests and CI gates are too thin for the platform surface area.
10. Several ERP-grade capabilities exist as database shape or UI surface but not as enforceable workflow engines.

Current release classification: beta / pre-pilot.

Recommended release decision: no production data, no customer-facing deployment, and no unsupervised pilot until all P0 items and the selected P1 minimum-control set are complete and verified.

---

## 2. Master Planning Principles

The rectification plan should be run as a stabilization program, not as scattered bug fixing.

Principles:

- Stop data leakage before improving features.
- Make production boot, build, and migration paths deterministic before any pilot.
- Enforce company scope at the framework/service boundary, not by convention.
- Make financial, stock, payroll, and fuel-station state transitions transactional and idempotent.
- Turn registry-style enterprise modules into executable systems, or label them honestly as not implemented.
- Add tests around the controls that failed, especially cross-company access, stock movement, posting, auth, and role assignment.
- Prefer a smaller correctly enforced ERP surface over a wider CRUD surface with weak controls.

---

## 3. Severity Model

P0 - Ship blocker:

- Exploitable cross-company data exposure.
- Broken production build or boot path.
- Data corruption in financial, stock, payroll, or fuel workflows.
- Security control that is represented as active but does not work.
- Operational promise that can mislead administrators, such as backups or exports appearing to run when no worker exists.

P1 - Enterprise blocker:

- Serious security, auditability, lifecycle, or authorization gap that may not block a supervised demo but blocks scale, compliance, and real operations.

P2 - Quality and reliability:

- Defect, maintainability issue, weak typing, frontend warning, or tooling drift that increases delivery risk but does not independently create a production incident.

P3 - ERP maturity:

- Capability gap against top-grade ERP products. These are important for long-term parity but should not displace P0/P1 stabilization.

---

## 4. Consolidated P0 Remediation Register

### P0-01: Cross-company isolation / IDOR across business modules

Source: both audits.

Problem:

Many services accept `companyId` from query/body parameters and use it as a filter rather than an authorization boundary. Some `findOne` paths do not check record ownership at all. Known representative areas include journal entries, payroll runs, fuel shifts, inventory movements, customers, sales orders, exports, tenants, and other company-owned records.

Business impact:

- Lateral exposure between Itemba companies.
- Payroll, financial, customer, and operational data leakage.
- Invalid multi-company governance.
- Fails any serious ERP security review.

Rectification:

1. Define one canonical company-scope contract:
   - `companyWhereFor(user, requestedCompanyId?)`
   - `assertCanAccessCompany(user, companyId)`
   - `assertCanAccessRecordCompany(user, record)`
2. Refactor every company-owned service to require `CurrentUser` for list, detail, create, update, delete, export, aggregate, and reporting paths.
3. Reject or ignore client-supplied `companyId` unless it is validated as a strict subset of the user's accessible companies.
4. Make `companyId` immutable after creation unless a specific admin workflow exists.
5. Add cross-company e2e tests for every high-value module.
6. Add a static check or review gate that flags controller methods using company-owned services without `CurrentUser`.

Acceptance criteria:

- A user from Company A cannot list, fetch, mutate, export, or aggregate Company B records by passing Company B IDs.
- Tests prove 404/403 behavior for cross-company access in finance, payroll, inventory, petroleum, customers, sales, reports, exports, and users.
- No service blind-overwrites a safe company filter with request query `companyId`.

Verification:

- Automated e2e isolation test suite.
- Code search for unsafe patterns: `where.companyId = companyId`, `dto.companyId`, `findUnique({ where: { id } })` in company-owned services, and controllers omitting `CurrentUser`.

### P0-02: Frontend production build fails

Source: local verification audit.

Problem:

`npm run verify:frontend:local` fails during the production build due `react/no-unescaped-entities` errors across multiple pages. The frontend cannot currently produce a clean production build.

Rectification:

1. Fix unescaped JSX entities in the listed pages.
2. Decide whether `react/no-unescaped-entities` remains a blocking rule. Prefer keeping it enforced and fixing the code.
3. Add frontend build to required CI.

Acceptance criteria:

- `npm run verify:frontend:local` passes.
- `npm run build` passes inside `frontend`.

### P0-03: Production environment and Docker deployment are broken/incomplete

Source: both audits.

Problem:

Production validation requires `TWO_FACTOR_ENCRYPTION_KEY`, but production compose and production env examples do not provide it. Env names drift between `CORS_ORIGIN` and `ALLOWED_ORIGINS`. Production compose does not run `prisma migrate deploy`. Backend container lacks a non-root `USER`.

Rectification:

1. Add all required production secrets to compose and env examples:
   - `TWO_FACTOR_ENCRYPTION_KEY`
   - `REFRESH_TOKEN_PEPPER` if retained
   - correct `CORS_ORIGIN`
2. Remove or alias stale env names.
3. Add a migration job or startup command that runs `prisma migrate deploy` before API startup.
4. Add non-root users to backend and frontend Dockerfiles.
5. Add a production boot smoke test in CI or release checklist.

Acceptance criteria:

- Production compose fails fast when required secrets are missing.
- Production compose boots with a valid env file.
- Migrations are applied before API traffic.
- Containers run as non-root.

### P0-04: Inventory stock corruption risks

Source: both audits.

Problem:

Inventory movements perform read-modify-write balance updates, allowing concurrent updates to overwrite each other. Negative-stock checks are missing. Outbound movements without an existing balance can silently create a zero row. `PURCHASE_RETURN` is misclassified as inbound.

Rectification:

1. Fix movement direction classification, including `PURCHASE_RETURN`.
2. Replace read-modify-write updates with atomic balance updates inside a transaction.
3. Guard negative stock using current on-hand minus reserved quantity.
4. Validate product, unit, inventory location, and company consistency before posting a movement.
5. Add idempotency keys for movement creation where upstream events can retry.

Acceptance criteria:

- Concurrent sales or fuel movements produce correct final balances.
- Outbound movement fails when stock is insufficient.
- Purchase returns reduce stock.
- Cross-company product/location/unit contamination is rejected.

### P0-05: Fuel-shift close is not atomic

Source: local verification audit.

Problem:

Fuel shift close updates nozzle readings, meter state, inventory movements, collections, shift status, and attendance through separate operations. Partial failure can leave a shift closed with incomplete inventory/accounting side effects. It can also attempt an inventory movement without a valid tank inventory location.

Rectification:

1. Wrap close-shift operations in one Prisma transaction.
2. Validate all preconditions before mutation:
   - shift is open
   - nozzles belong to station/company
   - tank has inventory location
   - meter readings are monotonic
   - products and tanks belong to the same company/location
3. Add idempotent close protection so repeated submissions do not duplicate movements.
4. Ensure audit action names distinguish close, delete, reopen, and adjustment.

Acceptance criteria:

- A simulated failure rolls back all close-shift mutations.
- Duplicate close request is safely rejected or returns the original result.
- Missing tank inventory location fails before any write.

### P0-06: Background jobs, backups, exports, and scheduled work lack a reliable worker path

Source: both audits.

Problem:

The platform models jobs, backups, exports, and operational registries, but the reviewed source did not show a reliable worker/executor path. This is critical because operators may believe backups, exports, jobs, or alerts are running when they are only recorded.

Rectification:

1. Choose and standardize the job runtime, preferably BullMQ/Redis or the existing Nest queue stack if present.
2. Add a worker process/container to dev and production compose.
3. Wire data exports, backups, notifications, scheduled reports, and long-running jobs to the worker.
4. Add job status transitions, retry policy, dead-letter handling, and audit events.
5. Add restore drills for backups, not just backup job creation.

Acceptance criteria:

- Creating an export produces an actual downloadable artifact.
- Creating/running a backup job produces a verifiable backup and restore proof.
- Failed jobs are visible, retryable, and audited.
- Worker health is exposed to monitoring.

### P0-07: Role assignment workflow is incomplete

Source: local verification audit and comparison report.

Problem:

Users and roles exist, but no reliable API/UI path was found to assign roles to users after creation. The roles page appears to imply assignment from the users page, but the users page does not provide a role picker.

Rectification:

1. Add role assignment to user create/update APIs or a dedicated user-role endpoint.
2. Enforce company/role scope when assigning roles.
3. Add user-role audit logging.
4. Add UI role picker and role visibility rules.
5. Add tests for user creation with roles, role changes, and permission effect.

Acceptance criteria:

- An admin can create a user and assign appropriate roles in one coherent flow.
- Permission changes take effect predictably and are audited.
- Cross-company role assignment is rejected.

### P0-08: Authentication registration, CSRF, and login hardening

Source: both audits, with nuance on CSRF severity depending deployment topology.

Problem:

Public registration creates active users and issues tokens without email verification or admin approval. Login lacks a strict per-route throttle beyond global throttling. The frontend backend proxy forwards cookie-backed access tokens without a dedicated anti-CSRF token or Origin/Referer enforcement for state-changing methods.

Rectification:

1. Disable public self-registration for internal deployments, or move to invite/admin approval.
2. If registration remains, require email verification and pending status before token issuance.
3. Add login throttling keyed by IP and account/email hash.
4. Add register throttling and abuse controls.
5. Add CSRF token validation for non-GET proxy requests.
6. Enforce Origin/Referer allowlist on state-changing requests.
7. Tighten cookie settings where deployment supports it.

Acceptance criteria:

- Unverified users cannot receive active tokens.
- Login and register abuse is rate-limited independently.
- State-changing proxy requests without valid CSRF token and Origin are rejected.

### P0-09: API-key authentication exists but is unused

Source: local verification audit.

Problem:

`ApiKeyAuthGuard` and `RequireApiScope` exist, but no controller usage was found. Integration/API-key features are therefore structurally present but not operational.

Rectification:

1. Identify external integration endpoints that should accept API keys.
2. Apply `ApiKeyAuthGuard` and `RequireApiScope`.
3. Define scope names, scope-to-route mapping, rotation, and revocation behavior.
4. Add request logging and per-key throttling.
5. Add tests proving key scope enforcement.

Acceptance criteria:

- At least one real integration route is protected by API key scope.
- A key without required scope is rejected.
- Revoked key cannot access any protected route.

### P0-10: Payroll/accounting side effects can fail after status changes

Source: local verification audit and comparison report.

Problem:

Payroll approval/payment flows can mark milestones such as approved or paid while GL posting, advance syncing, commission settlement, or labor allocation fails and is only logged. This creates reconciliation drift.

Rectification:

1. Make payroll approve/pay flows transactional across status and accounting side effects.
2. If some side effects must be asynchronous, introduce an explicit intermediate state such as `POSTING_PENDING` or `PAYMENT_POSTING_FAILED`.
3. Add retry and reconciliation workflow.
4. Prevent period-close while payroll posting failures exist.

Acceptance criteria:

- Payroll cannot be marked fully approved/paid while required accounting entries fail.
- Failures are visible, actionable, and block close where appropriate.

---

## 5. Consolidated P1 Remediation Register

### P1-01: Active sessions are not authoritative

Problem:

Active session records exist, but login/JWT validation does not appear to depend on them. Revoking a session may not invalidate active access.

Rectification:

- Create active session records on login.
- Tie access tokens to session IDs or token version.
- Check session status in JWT validation or enforce short-lived tokens with server-side revocation.
- Add logout/revoke-all behavior that works across devices and nodes.

### P1-02: Permission/user cache is per-process

Problem:

JWT/user permission cache invalidation is local to one API process. Role changes, user disablement, or permission revocation may not propagate across replicas.

Rectification:

- Move auth cache to Redis or shared cache.
- Add pub/sub invalidation on role, user, and permission changes.
- Reduce TTL during transition.
- Add tests for revocation under two simulated API instances.

### P1-03: Sensitive 2FA secret encryption uses unauthenticated AES-CBC

Problem:

TOTP secrets are encrypted with AES-CBC without authentication. Tampering may not be detected.

Rectification:

- Migrate to AES-256-GCM or encrypt-then-MAC.
- Bind ciphertext to user ID as associated data.
- Add key rotation plan.
- Migrate existing encrypted secrets carefully with versioned encryption metadata.

### P1-04: Generic encryption key fallback is unsafe

Problem:

Generic encryption falls back from app secrets to JWT signing secrets or a literal default. That couples unrelated key domains and creates dangerous deployment behavior.

Rectification:

- Require a dedicated field-level encryption key in production.
- Remove literal defaults.
- Fail fast when secrets are missing.
- Document rotation procedure.

### P1-05: Security policies are records, not enforced controls

Problem:

Security policy screens/records can represent controls that do not actually govern runtime behavior.

Rectification:

- Map each security policy to concrete enforcement points.
- Remove or label policies that are informational only.
- Add tests proving password, lockout, 2FA, session, and access policies are enforced.

### P1-06: User deletion and admin changes lack sufficient auditability

Problem:

Users can be hard-deleted and user administration changes are not consistently audited.

Rectification:

- Soft-delete users or move them to disabled/deactivated states.
- Restrict hard-delete to exceptional maintenance.
- Audit create/update/role-change/disable/reactivate/delete.
- Prevent deleting users with historical audit references.

### P1-07: Report/export/download authorization is inconsistent

Problem:

Reports and exports can leak data if they do not apply the same company/permission scope as transactional APIs.

Rectification:

- Make every export/report accept `CurrentUser`.
- Use canonical company scope.
- Add per-report permission checks.
- Store export requestor, scope, filter, status, and artifact ownership.

### P1-08: Frontend auth proxy does not retry expired access tokens for business APIs

Problem:

Business API calls can fail on expired access token instead of performing a safe refresh/retry path.

Rectification:

- Add single-flight token refresh.
- Retry one time on backend 401 caused by expiration.
- Ensure refresh-token reuse detection is not tripped by parallel tabs.
- Add tests for parallel expired requests.

### P1-09: Sensitive access interceptor logs only successes

Problem:

Failed attempts against sensitive endpoints may not be logged.

Rectification:

- Log success and failure paths.
- Include user ID, entity, action, outcome, IP, user agent, and reason.
- Ensure logging failures are visible.

### P1-10: Account enumeration and security event logging weaknesses

Problem:

Login response timing can reveal whether an account exists. Security event logging can swallow errors silently.

Rectification:

- Use dummy password hash verification for missing users.
- Normalize login error timing and messages.
- Log security-event persistence failures via application logger and metrics.

---

## 6. Consolidated P2 Remediation Register

### P2-01: Test coverage is too thin for platform size

Rectification:

- Add a test floor before broad refactors.
- Prioritize tests for company isolation, auth, role assignment, inventory, fuel shift, payroll posting, exports, and production env validation.
- Remove any CI behavior that passes with no meaningful tests.

### P2-02: Frontend test dependency/install state is incomplete

Rectification:

- Restore/install `vitest` and related dependencies.
- Ensure `cd frontend && npm test` runs consistently.
- Add smoke tests around auth proxy and key dashboard flows.

### P2-03: Backend test command does not complete in a reasonable time

Rectification:

- Identify hanging tests/resources.
- Add teardown for Prisma, queues, timers, and Nest app instances.
- Split unit and integration test commands.

### P2-04: Excessive `any` and DTO spreading weaken correctness

Rectification:

- Prioritize `any` removal in auth, company scope, finance, payroll, inventory, petroleum, exports, and integrations.
- Avoid spreading DTOs directly into Prisma data for sensitive entities.
- Use explicit mapping functions for create/update inputs.

### P2-05: JavaScript number arithmetic in money/quantity workflows

Rectification:

- Use Decimal.js or integer minor units for monetary calculations.
- Standardize quantity, unit cost, total value, tax, discount, and FX precision rules.
- Add rounding tests for journal entries, sales orders, inventory cost, payroll, and tax.

### P2-06: Audit classification and naming are inconsistent

Rectification:

- Define canonical audit actions.
- Map action/entity combinations to severity.
- Fix misleading names such as delete logging as close.
- Add user IDs to read/access audit events where appropriate.

### P2-07: Raw HTML preview creates XSS risk

Rectification:

- Sanitize HTML before rendering previews.
- Restrict template variables.
- Consider sandboxed iframe previews.
- Add tests for script/event-handler injection.

### P2-08: Frontend hook dependency warnings and stale state risks

Rectification:

- Fix `react-hooks/exhaustive-deps` warnings in high-use dashboards and operational pages first.
- Avoid suppressing warnings without a documented reason.

### P2-09: Build and script hygiene

Rectification:

- Replace `Invoke-Expression` in build scripts.
- Fix README port drift.
- Document the Windows Prisma generate issue and remove workaround once resolved.

### P2-10: Module count and AppModule composition are difficult to govern

Rectification:

- Group modules into bounded domains.
- Introduce domain modules for finance, inventory, petroleum, HR/payroll, security, integrations, support, and platform operations.
- Add ownership boundaries and domain-level tests.

---

## 7. P3 ERP Maturity Roadmap

These items move ITEMBA-R from "safe custom ERP" toward top-grade ERP parity.

### P3-01: General ledger and posting engine

Target state:

- One posting funnel for every module that creates accounting effects.
- Consistent posting rules, reversals, period checks, dimensions, and audit trail.
- No module directly creates accounting entries without the posting service.

### P3-02: Approval engine as enforcement layer

Target state:

- Approval rules gate state transitions.
- Maker-checker controls apply automatically where configured.
- Bypassing approval requires explicit privileged override with audit.

### P3-03: Financial consolidation and group reporting

Target state:

- Multi-company consolidation.
- Intercompany eliminations.
- FX revaluation.
- Budget vs actual.
- Segment/dimension reporting.

### P3-04: Inventory costing and reservation depth

Target state:

- Reservation engine for sales, projects, production, and fuel.
- Lot/serial/batch costing where needed.
- Valuation reconciliation to GL.
- Physical count and adjustment workflows.

### P3-05: Manufacturing/project depth

Target state:

- BOM/MRP where relevant.
- BOQ/project material issue controls.
- WIP capitalization.
- Cost-to-complete and variance reporting.

### P3-06: Enterprise analytics and observability

Target state:

- Real BI cube or semantic layer, not only snapshot tables.
- Structured logs, traces, metrics, and alerting.
- Operational dashboards for job health, auth events, error rates, backup status, and data quality.

### P3-07: Compliance-grade audit and records

Target state:

- Immutable version chains for sensitive master data.
- Retention and legal hold policies.
- Exportable audit packages.
- Period-close evidence packs.

---

## 8. Rectification Timeline

### Phase 0: Stabilization Baseline - Days 0 to 2

Goal: freeze the release posture and create a trustworthy baseline.

Actions:

1. Freeze feature work except fixes tied to this plan.
2. Create a remediation branch and issue register using the IDs in this document.
3. Re-run and capture:
   - root verify script
   - backend locked verify
   - frontend verify
   - backend tests
   - frontend tests
   - production compose config validation
4. Mark current production readiness as blocked.
5. Assign technical owners for Security/Tenancy, Finance/Inventory, Frontend, DevOps, QA, and Product Workflow.

Exit criteria:

- All P0 items have owners.
- Current failing commands are recorded.
- No team member treats the prior reports as separate unresolved narratives; this master plan is the canonical register.

### Phase 1: Production No-Go Cleanup - Week 1

Goal: make the application build, boot, and reject obvious unsafe access.

Actions:

1. Fix frontend production build.
2. Fix production env/compose/Dockerfile issues.
3. Add migration deployment path.
4. Disable or harden public registration.
5. Add login/register throttles.
6. Add CSRF/Origin checks for state-changing proxy calls.
7. Start company-scope refactor with finance, payroll, inventory, petroleum, customers, reports, exports, and users.
8. Add first cross-company e2e tests.

Exit criteria:

- Frontend and backend build pass.
- Production boot smoke test passes with valid env.
- Cross-company access is blocked in at least the top-risk modules.

### Phase 2: Data Correctness And Atomicity - Week 2

Goal: stop stock, fuel, payroll, and accounting drift.

Actions:

1. Replace inventory balance mutation with atomic transaction-safe logic.
2. Add negative-stock guard and fix movement direction bugs.
3. Make fuel-shift close transactional and idempotent.
4. Make payroll approve/pay side effects transactional or explicitly pending/failed.
5. Start Decimal.js/precision refactor in journal, sales, inventory, payroll, and tax calculations.
6. Validate cross-company FK relationships before writes.

Exit criteria:

- Concurrent inventory tests pass.
- Fuel close rollback test passes.
- Payroll cannot reach final paid/approved state with failed required postings.

### Phase 3: Runtime Control Plane - Week 3

Goal: make security/session/integration/worker features actually enforce behavior.

Actions:

1. Implement user-role assignment API and UI.
2. Make active sessions authoritative or remove misleading session controls until implemented.
3. Move permission/user cache to shared invalidation.
4. Wire API-key guard and scopes to real integration routes.
5. Implement job worker process for exports/backups/notifications/schedules.
6. Upgrade TOTP encryption and generic encryption key handling.
7. Log sensitive access failures and security event logging failures.

Exit criteria:

- Role assignment works end to end.
- Session revocation works across active requests/instances.
- API-key scope tests pass.
- Export and backup worker flows create real artifacts.

### Phase 4: Test Floor And CI Gates - Week 4

Goal: prevent the same control failures from returning.

Actions:

1. Restore frontend tests.
2. Fix backend test hangs.
3. Add CI gates for:
   - Prisma validation/generation
   - backend typecheck/build/test
   - frontend typecheck/build/test
   - lint
   - production env validation
4. Add P0 regression tests.
5. Add static search checks for unsafe company scope patterns.

Exit criteria:

- CI fails on missing tests, build failure, or company-scope regressions.
- P0 regression suite is green.

### Phase 5: Enterprise Hardening - Week 5

Goal: close high-risk enterprise gaps before supervised pilot.

Actions:

1. Finish company-scope refactor across all company-owned modules.
2. Complete report/export authorization audit.
3. Replace dangerous HTML preview behavior.
4. Remove high-risk `any` and DTO spreading in sensitive modules.
5. Normalize audit actions/severity.
6. Add restore-drill evidence for backups.
7. Add observability for auth, jobs, backups, exports, and error rates.

Exit criteria:

- All P0 complete.
- P1 items either complete or explicitly accepted with mitigation.
- A supervised pilot readiness review can be held.

### Phase 6: ERP Parity Program - Weeks 6 to 12+

Goal: raise the platform toward top-grade ERP maturity.

Actions:

1. Build a single GL posting engine.
2. Enforce approval workflow centrally.
3. Add consolidation, eliminations, FX revaluation, budget vs actual, and dimensions.
4. Deepen inventory reservations, costing, lot/serial, and physical count.
5. Build BI semantic layer and operational telemetry.
6. Add immutable version chains for sensitive entities.

Exit criteria:

- Platform can be benchmarked module-by-module against a mid-market ERP control matrix.

---

## 9. Workstream Ownership Model

Suggested workstreams:

| Workstream | Owns | Priority |
|---|---|---|
| Security/Tenancy | Company scope, CSRF, throttling, sessions, permission cache, API keys | P0/P1 |
| DevOps/Runtime | Docker, env validation, migrations, workers, backups, CI | P0/P1 |
| Finance/Inventory | GL posting, inventory movement, fuel close, payroll posting, Decimal arithmetic | P0/P1 |
| Frontend | Build failures, auth proxy, role assignment UI, hook warnings, unsafe previews | P0/P2 |
| QA/Automation | P0 regression tests, e2e isolation tests, CI quality gates | P0/P2 |
| Product/ERP Controls | Workflow design, approval enforcement, ERP parity backlog | P1/P3 |

Each P0 issue should have:

- one owner
- one reviewer
- one regression test owner
- one explicit acceptance checklist

---

## 10. Minimum Go-Live Gates

The platform should not enter production or an unsupervised pilot until all of these are true:

1. Frontend production build passes.
2. Backend production build passes.
3. Production compose boots with valid secrets and runs migrations.
4. Containers do not run as root.
5. Cross-company tests pass for all high-value modules.
6. Registration/login/CSRF controls are in place.
7. Role assignment works end to end.
8. Inventory and fuel-shift transaction tests pass.
9. Payroll posting cannot silently drift from payroll status.
10. Export and backup workers produce real artifacts.
11. API-key routes enforce scopes where integration functionality is exposed.
12. CI blocks regressions in build, typecheck, tests, and company-scope enforcement.
13. Backup restore drill is documented.
14. Known P1 exceptions, if any, are formally accepted with mitigation and expiry date.

---

## 11. Immediate Engineering Checklist

The first practical sprint should execute this exact checklist:

1. Fix frontend JSX lint errors and rerun frontend verify.
2. Patch production env docs/compose for required secrets and CORS naming.
3. Add migration deploy path and non-root Docker users.
4. Disable public registration or move it to pending verification.
5. Add per-route throttles to login/register.
6. Add CSRF token and Origin checks for non-GET proxy calls.
7. Implement canonical company-scope helpers and refactor journal entries, payroll runs, fuel shifts, inventory movements, customers, exports, and users.
8. Add cross-company e2e tests for those modules.
9. Fix inventory movement direction and atomic balance updates.
10. Make fuel-shift close transactional.
11. Add user-role assignment API and UI.
12. Define and start the worker process for exports/backups.

This checklist is deliberately narrower than the full report. Completing it does not make ITEMBA-R top-grade, but it changes the platform from "unsafe to pilot" to "ready for deeper controlled hardening."

---

## 12. Final Position

The two audits are complementary. The static security-heavy audit gives a wider enterprise risk catalogue. The locally verified audit adds concrete build/test failures and workflow gaps. This master plan adopts the union.

The highest leverage work is not to add more modules. It is to make the existing modules enforce the same rules everywhere: company scope, permissions, transactional state changes, real background execution, auditability, and tests. Once those controls are stable, ITEMBA-R can move from a broad ERP scaffold toward a credible top-grade ERP platform.
