# ITEMBA-R Top-Down Code Audit

Date: 2026-05-01  
Workspace: `C:\projects\Actual Projects\itemba-r`  
Audit type: source-level architecture, implementation, security, ERP maturity, and release-readiness review

## Executive Summary

ITEMBA-R is attempting to become a full group digital governance and enterprise management platform for the Itemba group of companies. The codebase already contains a very wide ERP surface: group control, finance, accounting, petroleum retail, Westsides wholesale/retail, logistics, agriculture, construction, rental, parking, hospitality, HR/payroll, tax/compliance, procurement, CRM/SRM, BI, integrations, security, monitoring, backups, QA, launch readiness, training, and support.

The platform is ambitious and structurally promising, but it is not yet on par with a top-grade ERP. The main gap is not breadth. The main gap is control depth: company isolation is inconsistent, many workflows are CRUD-first rather than domain-controlled, several critical operations are not transactional, background/backup/export subsystems are mostly record-keeping without a working processor, and production configuration currently has launch blockers.

Current release posture: **not production-ready**.

Primary no-go items:

1. Frontend production build fails on ESLint errors.
2. Production Docker/env configuration is inconsistent with backend validation and will fail unless extra variables are supplied.
3. Company isolation is not enforced uniformly across finance, payroll, inventory, petroleum, exports, users, and several other modules.
4. Background jobs, exports, and backups do not have an implemented worker/executor path in the reviewed source.
5. Role assignment is functionally incomplete: users and roles can be managed, but no source-level API/UI path was found to assign roles to users after creation.
6. Multiple financial and stock workflows can create accounting/inventory drift because status transitions and side effects are not atomic.

## Audit Scope And Evidence

Reviewed:

- Root package scripts, Docker Compose files, Dockerfiles, environment examples, and build script.
- Backend NestJS bootstrap, global guards, auth, permissions, audit, company scope helper, key domain services, and representative controllers.
- Frontend Next.js auth proxy, middleware, API client, auth context, users/roles pages, and build status.
- Prisma schema and migrations at a structural level.
- Existing docs and roadmap files.

Source scale observed:

- Prisma schema: 311 models, 430 enums.
- Backend source: 1,413 TypeScript files.
- Frontend source: 441 TypeScript/TSX files.
- Backend controllers: 258 controller declarations.
- Permission decorators in backend controllers: 1,386 occurrences.
- Tests found: 16 backend `*.spec.ts`, 4 backend e2e files, 2 frontend tests.

Verification commands run:

- `npm run verify:local`: failed at `npx prisma generate --schema=../database/prisma/schema.prisma` with `write UNKNOWN`.
- `npm run verify:backend:locked`: passed Prisma validation, backend typecheck, and backend build.
- `npm run verify:frontend:local`: frontend typecheck passed, frontend production build failed on ESLint errors.
- `cd frontend && npm test`: failed because `vitest` is not present in `frontend/node_modules`.
- `cd backend && npm test -- --runInBand`: did not complete within 4 minutes.

Limitations:

- This folder is not a Git repository, so no branch/diff history was available.
- `rg` was blocked by local app package permissions, so PowerShell enumeration was used.
- No live database-backed e2e scenario was completed during this audit.

## What The Platform Is Trying To Achieve

The product vision is a multi-company governance and ERP platform that centralizes legal, financial, operational, compliance, and executive control across:

- Mwanjalisi Oil: petroleum/fuel-station operations.
- Itemba Enterprises: logistics, agriculture, construction.
- Westsides Company: wholesale/retail, beverages, hardware/building materials.

The intended control model is sound: legal ownership lives at company level, operational work happens at branch/site/project level, and sensitive records are accessed through a group-control layer. The codebase also shows intent to support Tanzania-specific statutory payroll/tax/compliance, procurement controls, BI, launch readiness, training, and support.

The system therefore wants to be more than a line-of-business app. It wants to be the group system of record.

## Architecture Assessment

Strengths:

- Clear monorepo split: NestJS backend, Next.js frontend, canonical Prisma schema under `database`.
- Global Nest guard chain for throttling, JWT, role checks, and permission checks.
- Broad permission catalog seeded into the database.
- JWT access and refresh token rotation with reuse detection.
- Audit log service with recursive sensitive-field redaction.
- Company-scope helper exists and is used in some sensitive modules.
- Prisma schema has many useful indexes and company-scoped unique constraints.
- The codebase has moved beyond scaffold: finance, payroll, petroleum, procurement, BI, security, QA, and support modules all exist.

Weaknesses:

- `AppModule` imports hundreds of modules directly. This is operationally heavy, hard to reason about, and makes module boundaries weak.
- The permission system is broad but not enough by itself. Many services never apply company/branch scope to reads or writes.
- Many services use `any`, `as any`, raw query objects, and inline DTO spreading, reducing type safety at the exact points where ERP controls matter.
- Several "enterprise" subsystems are modeled in the database but do not have full runtime behavior.
- Existing e2e isolation test only verifies unauthenticated denial. It does not prove cross-company isolation.
- Frontend route count is high, but production build currently fails.

## Severity Definitions

- Critical: production blocker, security boundary failure, financial data corruption, or cross-company data exposure.
- High: serious business-control gap, incomplete enterprise capability, or likely data inconsistency.
- Medium: reliability, maintainability, UX, or test weakness that increases delivery risk.
- Low: polish, minor correctness, naming, or hygiene issue.

## Critical Findings

### C-01: Frontend production build fails

Evidence:

- `npm run verify:frontend:local` passed typecheck, then failed at `npm run build`.
- ESLint build-blocking errors include:
  - `frontend/src/app/(dashboard)/construction/billing/page.tsx:316`
  - `frontend/src/app/(dashboard)/construction/labour-cost/page.tsx:271`
  - `frontend/src/app/(dashboard)/hospitality/folio/[bookingId]/page.tsx:426`
  - `frontend/src/app/(dashboard)/hr/disputes/[id]/page.tsx:204`
  - `frontend/src/app/(dashboard)/hr/petroleum-commissions/page.tsx:228`
  - `frontend/src/app/(dashboard)/petroleum/fuel-shifts/page.tsx:231,287`
  - `frontend/src/app/(dashboard)/petroleum/fuel-shifts/[id]/page.tsx:373,626`
  - `frontend/src/app/(dashboard)/settings/preferences/page.tsx:270`
  - `frontend/src/app/(dashboard)/westsides/daily-close/page.tsx:170`

Impact:

- The frontend cannot be built for production.
- CI/CD should reject this release.

Recommended remediation:

- Fix the unescaped JSX entities.
- Decide whether `react/no-unescaped-entities` is a build rule or warning-only rule. If it remains enabled, enforce it pre-commit.
- Add a CI step equivalent to `npm run verify:frontend:local`.

### C-02: Production config is inconsistent with backend env validation

Evidence:

- Backend validation requires `TWO_FACTOR_ENCRYPTION_KEY` in staging/production: `backend/src/config/env.validation.ts:89`.
- `docker-compose.production.yml` does not pass `TWO_FACTOR_ENCRYPTION_KEY` to the backend service.
- `backend/.env.production.example` also omits `TWO_FACTOR_ENCRYPTION_KEY`.
- Backend reads `CORS_ORIGIN`: `backend/src/main.ts`, `backend/src/config/env.validation.ts:38`.
- `backend/.env.production.example` documents `ALLOWED_ORIGINS`, not `CORS_ORIGIN`.
- `docker-compose.production.yml:36` defaults `CORS_ORIGIN` to `http://localhost:3000`, unsuitable for a public deployment unless overridden.

Impact:

- Production may fail at boot.
- If manually patched to boot, CORS may reject the real frontend or accidentally retain localhost policy.

Recommended remediation:

- Add `TWO_FACTOR_ENCRYPTION_KEY` to production compose and production env example.
- Replace `ALLOWED_ORIGINS` with `CORS_ORIGIN`, or teach the backend to read both.
- Make production compose fail fast when required secrets are missing.

### C-03: Company isolation is not uniformly enforced

Evidence examples:

- `backend/src/modules/journal-entries/journal-entries.controller.ts` does not pass `CurrentUser` to `findAll`/`findOne`.
- `backend/src/modules/journal-entries/journal-entries.service.ts:68` builds a query directly from `companyId`; line 73 applies caller-supplied `companyId` without access validation.
- `backend/src/modules/hr/payroll-runs/payroll-runs.service.ts:21` uses a local `companyFilter`, but line 30 overwrites it when `companyId` is supplied in query.
- `backend/src/modules/fuel-shifts/fuel-shifts.service.ts:27` and line 42 filter by caller-supplied `companyId` without user scope.
- `backend/src/modules/inventory-movements/inventory-movements.controller.ts` exposes movements without `CurrentUser`; service line 34 applies caller-supplied `companyId`.
- `backend/src/modules/data-exports/data-exports.service.ts` repeats the same local company-filter pattern and then allows query override.
- `backend/src/modules/tenants/tenants.service.ts` accepts arbitrary `companyId` filters with no access check.

Impact:

- A user with a module permission can potentially read or mutate data belonging to another company by supplying another `companyId` or record id.
- This undermines the core group/company/branch governance model.

Recommended remediation:

- Make `CompanyScopeService` mandatory for every company-owned model.
- Require controllers to pass `AuthUser` into all read and write service methods.
- Replace all local `companyFilter(user)` helpers with one shared helper that cannot be overridden by query parameters.
- Add e2e tests where a company A user attempts to access company B records by list, detail, create, update, approve, post, delete, export, and report endpoints.

### C-04: Finance journal entries are globally accessible to any user with journal permission

Evidence:

- `backend/src/modules/journal-entries/journal-entries.controller.ts:22` calls `service.findAll(query)` without user context.
- `backend/src/modules/journal-entries/journal-entries.controller.ts:28` calls `service.findOne(id)` without user context.
- `backend/src/modules/journal-entries/journal-entries.service.ts:114` creates entries for `dto.companyId` without checking that the user can access that company.

Impact:

- Cross-company financial exposure and unauthorized posting risk.
- Audit logs will show who acted, but the authorization boundary is still missing.

Recommended remediation:

- Inject `CompanyScopeService`.
- In `findAll`, use `companyWhereFor(user, query.companyId)`.
- In `findOne`, load record and assert access on `record.companyId`.
- In `create`, assert WRITE/MANAGE access to `dto.companyId` before accounting controls.
- Repeat for post, reverse, update, and delete.

### C-05: Payroll access can be bypassed with query companyId

Evidence:

- `backend/src/modules/hr/payroll-runs/payroll-runs.service.ts:21` returns `{ companyId: user.companyId }` for non-group users.
- `backend/src/modules/hr/payroll-runs/payroll-runs.service.ts:30` then overwrites `where.companyId` with query `companyId`.
- `create()` at line 62 directly creates from DTO without company access validation.

Impact:

- Payroll is among the most sensitive ERP domains. This can expose salaries, statutory deductions, payroll runs, and company labor costs across companies.

Recommended remediation:

- Reject `companyId` query values outside the user's accessible company set.
- For non-group users, never allow query filters to widen scope.
- Require MANAGE access to create, calculate, submit, approve, pay, cancel, and delete payroll runs.

### C-06: Petroleum shift close is not atomic

Evidence:

- `backend/src/modules/fuel-shifts/fuel-shifts.service.ts:347+` updates nozzle readings, nozzle meter state, inventory movements, collections aggregation, shift status, and attendance records through separate Prisma calls.
- No wrapping `$transaction` is used around the close operation.

Impact:

- Partial failures can leave the shift closed with incomplete stock movement, meter updates, attendance records, or audit records.
- This is a direct operational accounting risk for fuel sales.

Recommended remediation:

- Wrap shift closing in one transaction.
- Move inventory movement creation into the same transaction by passing `tx`.
- Ensure attendance creation is either in the same transaction or deferred as an idempotent background job after a durable domain event.
- Add idempotency checks so repeated close requests do not duplicate inventory or attendance side effects.

### C-07: Inventory movements can corrupt stock

Evidence:

- `backend/src/modules/inventory-movements/inventory-movements.service.ts:15` classifies `PURCHASE_RETURN` as inbound.
- `applyMovementToBalance()` at lines 158-197 uses read-modify-write against `InventoryBalance`.
- If no balance exists and an outbound movement occurs, the service creates a balance with quantity `0`, effectively hiding the outbound issue.
- No negative stock guard was found in this service.

Impact:

- Purchase returns can increase stock instead of reducing it.
- Concurrent movements can lose updates.
- Sales/issues can be recorded without available stock.

Recommended remediation:

- Move `PURCHASE_RETURN` to outbound.
- Add explicit outbound types and negative stock policy.
- Use a transaction plus row-level lock, atomic update, or optimistic concurrency for balances.
- Use `upsert` carefully with unique `[companyId, productId, inventoryLocationId]`.
- Add tests for every `InventoryMovementType`.

### C-08: Background jobs, exports, and backups are modeled but not executed

Evidence:

- `DataExportsService` documents a worker but only enqueues a `BackgroundJob`: `backend/src/modules/data-exports/data-exports.service.ts:11-24`.
- `BackgroundJobsService` can enqueue/retry/cancel/dead-letter jobs but no processor loop was found.
- `BackupRunsService.create()` creates a `REQUESTED` run but does not execute `pg_dump`, copy files, calculate checksum, or update status.
- `BackupJobsService` stores backup job definitions but does not schedule or run them.

Impact:

- Exports remain queued unless an external worker exists outside this repository.
- Backup dashboards can give a false sense of resilience.
- Disaster recovery claims are not operationally backed by code in this workspace.

Recommended remediation:

- Add a real worker process with leasing, heartbeats, retries, dead-lettering, idempotency, and observability.
- Implement backup execution and restore verification.
- Make the UI distinguish "configured" from "successfully executed and restore-tested".

### C-09: API-key authentication is implemented but unused

Evidence:

- `ApiKeyAuthGuard` exists: `backend/src/common/guards/api-key-auth.guard.ts:27`.
- `RequireApiScope` exists: `backend/src/common/decorators/require-api-scope.decorator.ts:12`.
- No controller usage of `ApiKeyAuthGuard` or `RequireApiScope` was found.

Impact:

- Integration/API-client features cannot authenticate through the intended API-key path.
- API keys can be created but are not useful for protected integrations.

Recommended remediation:

- Define external API routes separately from user-interactive routes.
- Apply `ApiKeyAuthGuard` and `RequireApiScope` to those routes.
- Add tests for active, revoked, expired, and insufficient-scope keys.

## High Findings

### H-01: Role assignment workflow is missing

Evidence:

- `UsersService.create()` creates user records but does not assign roles.
- `CreateUserDto` has no `roleIds`.
- No source-level usage of `prisma.userRole.create`, `upsert`, or `createMany` was found under `backend/src`.
- Frontend roles page says roles are assigned from the Users page, but `frontend/src/app/(dashboard)/users/page.tsx` has no role picker or role assignment call.

Impact:

- Admins can create users who cannot do anything, but cannot complete role assignment through the application.
- Access management is not operationally complete.

Recommended remediation:

- Add role assignment APIs with audit logs, maker-checker for sensitive roles, and cache invalidation.
- Add company/division/branch access assignment APIs.
- Add UI controls on Users detail/edit page.

### H-02: Users are hard-deleted and user admin changes are not audited

Evidence:

- `backend/src/modules/users/users.service.ts:49` uses `prisma.user.delete`.
- Users service has no `AuditLogsService`.

Impact:

- User lifecycle history can be lost.
- Hard delete can break audit/accountability expectations in an ERP.

Recommended remediation:

- Use `deletedAt`/status transitions instead of hard delete.
- Audit create, update, password reset by admin, suspend, reactivate, role assignment, and company access changes.

### H-03: Public self-registration is enabled

Evidence:

- `AuthController.register()` is marked `@Public()` at `backend/src/modules/auth/auth.controller.ts:42`.
- Register creates a user without role assignment or invite validation.

Impact:

- In a private group ERP, public registration should normally be disabled or invite-only.
- Even role-less accounts increase attack surface and account-management noise.

Recommended remediation:

- Disable public registration in production.
- Replace with invite-based onboarding, approval workflow, or admin-created accounts only.

### H-04: Security policies are CRUD records, not enforced controls

Evidence:

- `SecurityPoliciesService` stores policy rows and settings.
- Auth flows still hardcode login lockout, password minimum, and 2FA behavior.
- `REFRESH_TOKEN_PEPPER` is defined in env validation but not used by token hashing.

Impact:

- The system can display policies that do not govern runtime behavior.
- Compliance reports may overstate actual control enforcement.

Recommended remediation:

- Add a `SecurityPolicyEvaluator` and call it from auth, password reset, user admin, session, API key, and sensitive action flows.
- Enforce password history on all password changes, not only password reset.
- Use `REFRESH_TOKEN_PEPPER` or remove it from validation/docs.

### H-05: Active sessions do not appear to control authentication

Evidence:

- `ActiveSessionsService` can create/revoke session records.
- `AuthService.login()` issues tokens but does not create `ActiveSession`.
- JWT strategy does not check active session status.
- Refresh token records are separate from active session records.

Impact:

- "Revoke session" can become a dashboard-only action that does not invalidate actual access.

Recommended remediation:

- Introduce a session id claim in JWTs.
- Create active session on login.
- Link refresh token family to active session.
- Check revoked session state during refresh and, where necessary, access-token validation.

### H-06: Payroll can mark business milestones even when accounting side effects fail

Evidence:

- `PayrollRunsService.approve()` sets status `APPROVED` then catches and logs auto-posting failure.
- `PayrollRunsService.pay()` sets status `PAID`, then catches and logs payment JE posting, advance sync, commission settlement, and labor allocation failures.

Impact:

- Payroll can appear approved/paid while GL, advances, commissions, and project cost allocations are incomplete.

Recommended remediation:

- Separate business approval from posting completion.
- Use explicit statuses such as `APPROVED_PENDING_POSTING`, `PAID_PENDING_GL`, `POSTING_FAILED`.
- Make financial posting failures visible and actionable, not silent warnings.

### H-07: Sensitive 2FA secret encryption uses unauthenticated AES-CBC

Evidence:

- `TwoFactorService.encryptSecret()` uses `aes-256-cbc`: `backend/src/modules/auth/two-factor.service.ts:218`.
- No authentication tag or MAC is stored.

Impact:

- Ciphertext tampering is not reliably detected.

Recommended remediation:

- Use AES-256-GCM or libsodium secretbox.
- Version encrypted payloads for future rotation.
- Add key rotation and re-encryption procedure.

### H-08: Generic EncryptionService has unsafe fallback/key coupling

Evidence:

- `backend/src/common/services/encryption.service.ts:14-16` falls back from `APP_SECRET` to `JWT_ACCESS_SECRET` to a literal default.

Impact:

- Encryption and JWT signing key lifecycles become coupled.
- Default fallback is dangerous if used outside current validated backend path.

Recommended remediation:

- Require a dedicated encryption key in all non-test environments.
- Fail fast if not provided.
- Remove literal default.

### H-09: Report/export/download authorization is inconsistent

Evidence:

- Audit logs controller accepts arbitrary `companyId`, `userId`, and entity filters under one permission.
- Data exports use a company filter that can be widened by query.
- Backup run `filePath` is hidden unless `backup_runs.download`, but no actual download route was reviewed.

Impact:

- Administrative reporting can bypass business scoping if permissions are too broad.

Recommended remediation:

- Scope audit/export/report queries by company access unless the user has explicit group-audit authority.
- Split permissions into company-level and group-level audit/report permissions.

### H-10: Frontend auth proxy does not retry expired access tokens for business API calls

Evidence:

- `frontend/src/app/api/backend/[...path]/route.ts` forwards only `itemba_access`.
- It returns backend `401` if access token is expired.
- Silent refresh exists in AuthContext, but individual API calls do not refresh-and-retry.

Impact:

- Users returning to an idle tab may see failed business actions even with a valid refresh cookie.

Recommended remediation:

- In the Next backend proxy, on backend 401, call refresh once using `itemba_refresh`, set new cookies, and retry idempotent/safe request or return a structured session-expired response.
- Be careful with non-idempotent POST/PATCH retry semantics.

## Medium Findings

### M-01: Test coverage is thin relative to platform size

Evidence:

- 1,413 backend TS files vs 16 backend unit specs and 4 e2e files.
- 441 frontend TS/TSX files vs 2 frontend tests.
- Company isolation e2e only checks unauthenticated access, not cross-company access.

Impact:

- Regression risk is high.
- Many critical ERP invariants are untested.

Recommended remediation:

- Add invariant tests by domain:
  - company isolation
  - period locks
  - journal balancing
  - inventory movement direction
  - payroll statutory calculation
  - approval maker-checker
  - API key scope
  - audit redaction

### M-02: Frontend test dependency install is incomplete

Evidence:

- `cd frontend && npm test` fails: `vitest` is not recognized.
- `frontend/package.json` lists `vitest` as a devDependency, so local `node_modules` is incomplete or stale.

Impact:

- Local verification cannot run frontend tests until dependencies are repaired.

Recommended remediation:

- Run `npm ci` in `frontend`.
- Add CI to prevent stale dependency state from hiding test failures.

### M-03: Backend unit test command did not complete in reasonable time

Evidence:

- `cd backend && npm test -- --runInBand` timed out after 4 minutes.

Impact:

- Test suite may hang due open handles, database dependencies, or expensive module bootstrap.

Recommended remediation:

- Split pure unit tests from integration/e2e tests.
- Mock Prisma for unit tests.
- Add Jest open-handle diagnostics and time budgets.

### M-04: Excessive `any` usage weakens ERP correctness

Evidence:

- Static scan found 613 `as any` and 1,495 `: any` occurrences across backend/frontend source.

Impact:

- DTO validation and TypeScript safety are bypassed in critical paths.
- Incorrect enum values and missing required fields can reach Prisma only at runtime.

Recommended remediation:

- Start with financial, payroll, stock, auth, security, and integration modules.
- Replace generic `any` query/body DTOs with class-validator DTOs.
- Ban new `any` in domain services unless explicitly justified.

### M-05: `build-all.ps1` uses `Invoke-Expression`

Evidence:

- `scripts/build-all.ps1:39` runs command strings through `Invoke-Expression`.

Impact:

- Low immediate risk because commands are internal constants, but it is an avoidable footgun in build tooling.

Recommended remediation:

- Replace with direct invocation arrays or a helper accepting command plus args.

### M-06: Prisma generate fails locally with `write UNKNOWN`

Evidence:

- `npm run verify:local` fails at Prisma generation.
- `verify:backend:locked` works when generation is skipped.

Impact:

- Windows local developer flow is fragile.
- Generated client drift can be missed if developers rely on the locked path.

Recommended remediation:

- Document the lock cause and cleanup procedure.
- Ensure CI always runs clean `prisma generate`.

### M-07: Audit severity classification is inconsistent with action naming

Evidence:

- `AuditLogsService` derives severity from specific action strings like `LOGIN`, `BANK_ACCOUNT_CREATE`.
- Many services log generic actions like `CREATE`, `UPDATE`, `DELETE`.

Impact:

- Sensitive events can be classified LOW unintentionally.

Recommended remediation:

- Standardize action names.
- Let services pass explicit severity for sensitive domains.
- Add tests for severity classification by module/action.

### M-08: Document preview uses raw HTML injection

Evidence:

- `frontend/src/app/(dashboard)/document-templates/print-engine/page.tsx:122` renders `preview` with `dangerouslySetInnerHTML`.

Impact:

- If preview HTML can contain user-controlled content, this is an XSS risk.

Recommended remediation:

- Sanitize server-generated template output before rendering.
- Use a sandboxed iframe for document preview.
- Lock down template syntax and escaping.

### M-09: Frontend has many hook dependency warnings

Evidence:

- Build output reported `react-hooks/exhaustive-deps` warnings across BI, HR, monitoring, petroleum, reports, support, and command-palette pages.

Impact:

- Stale data, duplicate fetches, and missed reloads are likely.

Recommended remediation:

- Fix hooks with stable `useCallback` dependencies or move load functions inside effects.
- Treat hook warnings as errors after cleanup.

### M-10: Many modules are CRUD-first, not workflow-first

Evidence:

- Backup jobs, active sessions, security policies, job queue configs, support, QA, and several operational resources are mostly direct create/update/list wrappers.

Impact:

- The platform looks broad in navigation but lacks the control engine depth of mature ERP products.

Recommended remediation:

- Define domain state machines per critical module.
- Only expose commands that make sense for the current state.
- Enforce maker-checker, locks, and posting rules at the domain service layer.

## Low And Atomic Bugs

1. `FuelShiftsService.remove()` logs action `FUEL_SHIFT_CLOSE` instead of delete/remove at `backend/src/modules/fuel-shifts/fuel-shifts.service.ts:732`.
2. `FuelShiftsService.closeShift()` can pass `inventoryLocationId: undefined` into inventory movement creation when a tank is missing or not linked to a location.
3. `InventoryMovementsService` has no explicit validation that `productId`, `unitId`, and `inventoryLocationId` belong to the same company before creating movements.
4. `JournalEntriesService.validateLines()` uses JavaScript numbers for money arithmetic, which can produce rounding edge cases.
5. `AccountResolverService` fallback ordering uses `orderBy: accountCode asc`, which does not actually prefer the first conventional code listed if codes are not naturally sorted in the intended priority.
6. `UsersPage` debounce timer is set up but not actually used to delay filtering; filtering is client-side immediate.
7. `RolesPage` text tells admins to assign roles from Users page, but Users page has no role assignment controls.
8. `frontend/src/app/layout.tsx` loads Google Fonts in `<head>`, and Next warns this font path only loads for one page in the App Router pattern.
9. Docker Compose dev README says Postgres on `localhost:5432`, but `docker-compose.yml` maps `${POSTGRES_PORT:-5433}:5432`.
10. Root README says frontend runs on `localhost:3000`, but `frontend/package.json` runs dev/start on port `3009`.

## ERP Maturity Gap Against Top-Grade Platforms

To be comparable to top-grade ERP systems, ITEMBA-R needs more than many modules. It needs enforceable, auditable, cross-module controls.

Missing or immature capabilities:

- Universal company/division/branch/site/project data isolation.
- Centralized organization-scope query middleware or policy layer.
- Full user lifecycle: invite, role assignment, access approval, suspension, deprovisioning, session revocation.
- End-to-end maker-checker for high-risk actions.
- Immutable audit trail with tamper-evidence and retention policy enforcement.
- Consistent accounting integration for subledgers.
- Reliable background job worker and operational dashboards backed by real execution.
- Real backup execution, encrypted storage, restore drills, and RPO/RTO reporting.
- Import/export pipeline with validation, staging, reconciliation, and rollback.
- Domain-specific transaction boundaries around stock, fuel, payroll, GL, procurement, and payments.
- Integration gateway with API-key routes, scopes, webhooks, replay, signatures, and rate limits.
- Automated regression suite covering cross-company access and financial invariants.
- Observability: structured logs, tracing, metrics, alert routing, SLOs, and error budgets.
- Production hardening: secret management, container health, migrations, CI/CD, rollback, and DR.

## Recommended Remediation Roadmap

### Phase 0: Production No-Go Cleanup

Priority: immediate.

- Fix frontend build errors.
- Fix production env/compose mismatch.
- Restore clean dependency install for frontend tests.
- Ensure clean Prisma generation in CI.
- Add CI pipeline for backend build, frontend build, Prisma validate/generate, unit tests, and e2e tests.

### Phase 1: Security And Isolation

Priority: before any real company data.

- Enforce `CompanyScopeService` across all company-owned services.
- Add cross-company e2e tests.
- Disable public self-registration or make it invite-only.
- Implement user role/company/division/branch access assignment.
- Make active sessions authoritative.
- Wire API-key auth into external API routes.
- Convert security policies from records into enforced runtime policy.

### Phase 2: Financial And Operational Correctness

Priority: before operational rollout.

- Transaction-wrap fuel shift close, payroll pay/approve side effects, stock movements, procurement receiving, and accounting posting.
- Fix inventory movement direction and negative stock policy.
- Add subledger-to-GL reconciliation reports.
- Make posting failures visible state transitions rather than warnings.
- Enforce accounting periods and locks in every financial mutation path.

### Phase 3: Enterprise Runtime

Priority: before scale.

- Implement a real job worker.
- Implement real backups and restore tests.
- Implement export processors.
- Add observability with metrics, traces, logs, and alert routing.
- Add data retention and archival execution.
- Add load tests for high-traffic dashboards and posting workflows.

### Phase 4: Top-Grade ERP Depth

Priority: after core controls are stable.

- Advanced audit evidence packs tied to real transactions.
- Configurable workflow engine with delegation and separation of duties.
- BI data warehouse/materialized reporting layer.
- Mobile/offline sync conflict resolution.
- Integration certification for tax, payroll, banking, payment, messaging, and supplier/customer systems.
- Formal release train with migration rehearsals and customer acceptance gates.

## Suggested Quality Gates

Before staging:

- Frontend and backend builds pass from clean install.
- Prisma validate/generate passes.
- Unit tests complete under agreed timeout.
- Cross-company isolation e2e suite passes.
- Auth/session/API key tests pass.

Before production:

- No critical/high audit findings open.
- Restore test completed from latest backup.
- At least one full payroll, fuel shift, inventory movement, journal posting, procurement receipt, and report run exercised end-to-end in staging.
- All production secrets supplied through a secret manager or deployment environment, not example defaults.
- Monitoring and alerting active.

## Bottom Line

ITEMBA-R has the shape of a serious ERP platform and a strong amount of domain coverage. The next engineering step is to stop expanding surface area and harden the control plane. The biggest work is enforcing scope everywhere, making side effects transactional, completing background execution, and proving the system with tests that reflect real fraud, isolation, and accounting risks.

Until those controls are fixed, the platform should be treated as a broad pre-production ERP prototype rather than a production-grade group system of record.
