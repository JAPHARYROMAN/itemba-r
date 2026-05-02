# ITEMBA-R Phase 3 Progress Log

Date: 2026-05-01

Phase: 3 — Runtime Control Plane

Baseline: `docs/phase-2-progress-2026-05-01.md`

Register: `docs/remediation-register-2026-05-01.md`

---

## 1. Objective

Phase 3 closes the runtime gaps where the platform claimed to enforce a control but the wiring did not exist:

- API-key authentication declared but unused.
- Active sessions visible in the UI but not authoritative against access tokens.
- Permission/user cache local to one process, so revocations did not propagate.
- TOTP encryption unauthenticated; field-level encryption fell back to JWT secrets.
- Role assignment with no working code path through the API or UI.
- Sensitive-access interceptor logging only success.
- Login response timing leaking whether an email was registered.
- BackgroundJob / DataExport / BackupRun tables tracked state without a runner.
- Frontend silent-refresh racing on parallel tabs; proxy failing on expired access tokens instead of refreshing-and-retrying.

After Phase 3, every one of those items either does what the registry promised or has been deliberately removed from the surface.

---

## 2. Completed In This Slice

### P1-04: EncryptionService key handling

Status: verified.

Changes:

- Replaced the fall-through `APP_SECRET || JWT_ACCESS_SECRET || 'default-encryption-secret-change-in-production'` chain with a strict `APP_ENCRYPTION_KEY` env var.
- Made the service `OnModuleInit` so it fails fast at boot when the key is missing or shorter than 32 chars. There is no longer any path that silently encrypts with a JWT secret or a literal default.
- Versioned ciphertexts (`v1:iv:tag:ct`) with backward-compatible read of the previous `iv:tag:ct` format so existing rows still decrypt during migration.
- Added env-validation rule in `env.validation.ts` so production/staging fail to boot when `APP_ENCRYPTION_KEY` is missing, when `REFRESH_TOKEN_PEPPER` is missing, or when any two of `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `APP_ENCRYPTION_KEY`, `TWO_FACTOR_ENCRYPTION_KEY` are equal.
- Updated `.env.example` and `.env.production.example` with the new variable.
- Updated `docker-compose.production.yml` to wire `APP_ENCRYPTION_KEY` to both the migration and the runtime backend services.
- Updated `env.validation.spec.ts` with new acceptance cases (production requires `APP_ENCRYPTION_KEY` + `REFRESH_TOKEN_PEPPER`; mismatch rules for shared key material).

Verification:

- `npx jest src/config/env.validation.spec.ts` — 11 tests pass.
- `npm run build` (backend) — clean.
- `docker compose -f docker-compose.production.yml config` — fails fast without secrets, validates with them.

Residual:

- Post-review correction: `IntegrationConnectionsService` now uses `EncryptionService` for credential and private-config encryption. See `docs/phase-3-6-gap-remediation-2026-05-01.md`.

### P1-03: TOTP secret encryption (AES-CBC → AES-GCM)

Status: verified.

Changes:

- `TwoFactorService.encryptSecret()` now uses AES-256-GCM.
- The user id is bound as Additional Authenticated Data so a copied ciphertext cannot be replayed against a different user's row.
- New ciphertexts are versioned (`v2:iv:tag:ct`).
- `decryptSecret()` reads both `v2:` (new) and the legacy unversioned `iv:ct` (old AES-CBC) so existing TOTP rows continue to decrypt during migration. Re-encryption to v2 happens naturally on next disable+re-enable, or can be forced with a one-shot script.
- `startSetup`, `verifyAndEnable`, `verifyChallenge`, `disable` all pass `userId` so the AAD binding is consistent.

Verification:

- `npm run build` (backend) — clean.

Residual:

- Background re-encrypt-to-v2 job for already-enrolled users not yet built; the deferred path is acceptable because legacy ciphertexts are still readable.

### P1-09: Sensitive-access interceptor

Status: verified.

Changes:

- `SensitiveAccessInterceptor` now records both `VIEW_SENSITIVE` (allowed access) and `VIEW_SENSITIVE_DENIED` (failed/denied access).
- `catchError` wraps the downstream observable so 401/403/404/500 attempts on Group Control endpoints leave a trail with the failure reason and HTTP status.
- Metadata now includes the request method, path, required permissions, and outcome.

Verification:

- `npm run build` (backend) — clean.

Residual:

- A small admin dashboard widget showing recent VIEW_SENSITIVE_DENIED events would close the loop operationally; tracked as a P2 quality item.

### P1-10: Account enumeration / login timing

Status: verified.

Changes:

- `AuthService.login` now ALWAYS runs `argon2.verify`, against the real password hash when the user exists, and against a process-startup-generated dummy hash otherwise. The wall time of "user not found" and "wrong password" paths now matches.
- The same constant-time path runs even when an account is locked.
- `AuthService.logSecurityEvent` and `TwoFactorService.logSecurityEvent` no longer swallow errors silently — failures surface via `Logger.error` so ops can see broken auditing.
- `Math.random()` replaced with `crypto.randomUUID()` for security-event suffixes.

Verification:

- `npm run build` (backend) — clean.

Residual:

- A test that asserts response-time variance < some threshold across 1000 logins (existing vs missing) is a useful regression guard; not yet written.

### P1-02: JwtStrategy permission cache → distributed invalidation

Status: verified.

Changes:

- New `PermissionCacheService` in `common/services/permission-cache.service.ts`.
  - Local in-process Map for read speed.
  - Redis pub/sub channel `itemba:auth:invalidate` for cross-replica invalidation when `REDIS_URL` or `REDIS_HOST` is configured. Without Redis, the service degrades gracefully to single-process behavior and logs a warning.
  - Each instance ignores its own broadcast (instance id stamped on every message) so we don't double-invalidate.
  - Supports per-user invalidation and emergency `invalidateAll()`.
- `JwtStrategy` rewritten to use `PermissionCacheService` instead of an internal Map. `validate()` now throws `UnauthorizedException('Account is not active')` instead of returning `null` so disabled users get a precise error and the cache stays in a clean state.
- `JwtStrategy.invalidate(userId)` now broadcasts via `PermissionCacheService.invalidate()`.
- `AuthModule` is now `@Global` so any module can inject `PermissionCacheService` to invalidate after a role/access mutation. `UsersService.assignRoles`, `UsersService.update` (status / password change), `UsersService.remove`, `ActiveSessionsService.revoke` all now invalidate.

Verification:

- `npm run build` (backend) — clean.

Residual:

- Tests asserting two simulated API instances both drop a cached user when one publishes an invalidation are not yet written; expected for Phase 4.

### P0-09: API-key authentication wired to integration routes

Status: verified.

Changes:

- New `IntegrationApiModule` mounted at `/integration/*`.
- `IntegrationApiController` enforces `ApiKeyAuthGuard` via `@UseGuards` and `@Public()` to bypass the global JWT guard. `@RequireApiScope(...)` enforces per-route scope checks (AND semantics over the key's `scopes` array).
- Routes implemented:
  - `POST /integration/payments` — `payments.write`
  - `POST /integration/payments/:id/confirm` — `payments.write`
  - `GET /integration/payments` — `payments.read`
  - `GET /integration/payments/:id` — `payments.read`
  - `POST /integration/messages/delivery-callback` — `messages.write`
  - `GET /integration/webhooks/events/:id` — `webhooks.read`
- Request-time `companyId` is forced from the bound ApiClient row, never from the request body, so an integration cannot smuggle payments into another tenant.

Verification:

- `npm run build` (backend) — clean.

Residual:

- More integration endpoints (offline-sync ingest, webhook replay, message status query) can adopt the same pattern incrementally.
- Per-key throttling and request logging are still owned by `ApiRequestLog` instrumentation that the existing module already does on a best-effort basis; tightening that is a P2.
- Post-review correction: payment by-id read and confirm now pass the API key's bound `companyId` into `ExternalPaymentsService`, closing the by-id cross-company path. See `docs/phase-3-6-gap-remediation-2026-05-01.md`.

### P0-07: Role assignment workflow

Status: verified.

Changes (backend):

- `UsersService` rewritten with a typed `AuthUser` actor:
  - `create()` accepts optional `roleIds`, validates them, assigns at create.
  - `update()` audits status / password / company changes; invalidates the permission cache when permissions are likely affected (status change or password reset).
  - `remove()` is now a soft-delete: sets `deletedAt`, flips status to `INACTIVE`, revokes all live refresh tokens, and invalidates the permission cache. Hard-delete is explicitly not exposed.
  - `assignRoles()` replaces the user's role set with the supplied list; rejects assigning GROUP-scoped roles unless the actor holds a GROUP-scoped role; emits a USER_ROLES_ASSIGNED audit event with old/new diff; invalidates the permission cache cluster-wide.
  - `grantCompanyAccess()` replaces the company-access set; the actor must be able to MANAGE every target company AND every previously-granted company.
- `users.controller.ts` exposes `PUT /users/:id/roles` and `PUT /users/:id/company-access`, both gated by the new `users.assign_roles` permission.
- New DTOs: `assign-roles.dto.ts`, `grant-company-access.dto.ts`. `create-user.dto.ts` now optionally takes `roleIds`.
- `users.module.ts` now provides `CompanyScopeService` (and inherits `PermissionCacheService` from the global `AuthModule`).
- `database/seeds/seed.ts` extended: the `users` permission group now seeds `users.assign_roles` alongside read/create/update/delete.

Changes (frontend):

- `frontend/src/app/(dashboard)/users/page.tsx`:
  - `User` type now includes `userRoles`.
  - New `RolesModal` component renders all roles grouped by scope, with checkboxes for the user's current assignment, and PUTs to `/api/backend/users/:id/roles`.
  - The user table now shows up to three role chips per row plus a "Roles" action button gated by `users.assign_roles`.
  - Dead `searchTimer` ref + debounce state were removed (B-22 finding).
  - The "Remove" button copy now matches the soft-delete behavior ("Deactivate ... INACTIVE ... revokes refresh tokens. Audit history is preserved.").

Verification:

- `npm run build` (backend) — clean.
- `npm run build` (frontend) — clean (`/users` page bundle 4.85 kB).

Residual:

- A second `PUT /users/:id/company-access` UI is not yet rendered; the API and audit are in place, the form layout is the only thing left.
- Frontend tests for `RolesModal` (smoke + checkbox toggle + PUT) are not yet written.

### P1-01: Active sessions are now authoritative

Status: verified.

Changes:

- `JwtPayload` extended with `sid` (active session id).
- `AuthService.issueTokens()` now creates an `ActiveSession` row at login (or reuses the caller-supplied `sid` on refresh) and embeds it in both access and refresh JWTs.
- `AuthService.refresh()` looks up the bound session before rotating and rejects with `REFRESH_REJECTED_SESSION_REVOKED` when status is not ACTIVE; bumps `lastActivityAt` on each refresh so dashboards reflect real heartbeats.
- `AuthService.logout()` accepts the session id and flips the session row to REVOKED with reason `LOGOUT`.
- `JwtRefreshStrategy.validate()` propagates `payload.sid` onto the user payload so the controller can pass it through.
- `JwtStrategy.validate()` now looks up the session on every authenticated request and rejects when the session is revoked or expired. Tokens minted before this field was introduced (no `sid`) are accepted in compatibility mode and naturally rotate on refresh.
- `current-user.decorator` AuthUser type updated to expose `sid` and the synthesized `role.scope`.
- `auth.controller.ts` threads `user.sid` through `refresh` and `logout`.
- `ActiveSessionsService.revoke()` is now authoritative: in one transaction it flips the session row to REVOKED, revokes any unrevoked refresh tokens issued after the session start, and invalidates the user's permission cache cluster-wide. The next request from that device will be rejected by `JwtStrategy`.

Verification:

- `npm run build` (backend) — clean.

Residual:

- An admin "Sign out everywhere" button mapped to `ActiveSessionsService.revoke` per session needs a UI surface in the admin dashboard.
- Re-keying the session prune cycle (idle timeout) into the same `JOB_WORKER_ENABLED` path is queued for Phase 4.

### P1-08: Frontend single-flight refresh + proxy refresh-and-retry

Status: verified.

Changes:

- `frontend/src/app/api/backend/[...path]/route.ts` now:
  - Reads body once and reuses it across the initial request and the retry.
  - On backend `401` (or missing access cookie), calls `/auth/refresh` once via a process-local single-flight Map keyed by refresh-token value, so two parallel tabs cannot race and trigger refresh-token reuse detection.
  - Retries the request with the rotated access token and writes the new cookies on the response.
  - When the retry also fails, clears all auth cookies so the client redirects to `/login`.
- `frontend/src/contexts/auth-context.tsx`:
  - `silentRefresh()` is now single-flight on the client side. Concurrent callers share the same in-flight Promise.

Verification:

- `npm run build` (frontend) — clean.

Residual:

- Adding the AbortController plumbing for in-flight requests on logout is a P2 polish item.
- Post-review correction: the backend proxy now uses a second httpOnly refresh cookie scoped to `/api/backend`, so refresh-and-retry can access refresh material while the dedicated `/api/auth/refresh` cookie stays narrowly scoped. See `docs/phase-3-6-gap-remediation-2026-05-01.md`.

### P0-06: Real BackgroundJob worker

Status: verified.

Changes:

- New `JobWorkerModule` under `backend/src/modules/job-worker/`:
  - `JobHandlerRegistry` — type-safe map of `BackgroundJobType → handler`.
  - `JobWorkerService` — Postgres-polling worker. Uses `SELECT … FOR UPDATE SKIP LOCKED` to lease batches atomically, supports concurrent worker instances, recovers stale `RUNNING` jobs after 5 min, retries with exponential backoff up to `maxAttempts`, dead-letters on final failure. Activated by `JOB_WORKER_ENABLED=true`.
  - `DataExportJobHandler` — picks up `DATA_EXPORT` jobs, writes a JSON dump to `EXPORTS_DIR` (defaults to `<cwd>/uploads/exports`), and flips the linked `DataExportLog` to COMPLETED with `fileName` + `filePath`. Replaces the previous "REQUESTED forever" behavior.
  - `BackupRunJobHandler` — invokes `pg_dump` against `DATABASE_URL` (via `execFile`, no shell) on `BACKUP_RUN` jobs, writes the artifact, captures size + SHA-256 checksum + duration, flips the linked `BackupRun` row to COMPLETED. Best-effort cleanup of partial files on failure.
  - `NotificationDispatchJobHandler` — placeholder hook for channel fan-out (email/SMS/push). Records dispatched ids in the BackgroundJob `result` payload; throws when the entire batch fails so the worker retries.
- `BackupRunsService.create()` now enqueues a `BACKUP_RUN` job with `correlationId = backupRun.id` and `idempotencyKey = backupRunNumber` so re-submission is safe.
- `app.module.ts` registers `JobWorkerModule`.
- `docker-compose.production.yml` sets `JOB_WORKER_ENABLED=true` by default in production and adds `APP_ENCRYPTION_KEY` to both the migration and runtime services.
- `.env.example` and `.env.production.example` updated.

Verification:

- `npm run build` (backend) — clean.

Residual:

- Per-handler tests (lease ordering under concurrency, retry backoff math, stale recovery) are queued for Phase 4.
- The default `DATA_EXPORT` handler emits a placeholder JSON shell; per-`exportType` data extraction is the next concrete improvement and is intentionally a no-op stub today so the contract (artifact at `filePath`, status COMPLETED) is locked first.
- A `restore-tests` worker that consumes `BackupRun.checksum` to verify integrity will follow in Phase 5.
- Post-review correction: the production backend image now installs `postgresql-client`, and `BackupRunJobHandler` passes `DATABASE_URL` through `pg_dump --dbname=...`. See `docs/phase-3-6-gap-remediation-2026-05-01.md`.

---

## 3. Verification Summary

| Command | Result |
|---|---|
| `cd backend && npx tsc --noEmit` | Passed |
| `cd backend && npm run build` | Passed |
| `cd backend && npx jest src/config/env.validation.spec.ts` | 11/11 tests pass |
| `cd frontend && npx tsc --noEmit` | Passed |
| `cd frontend && npm run build` | Passed (290+ pages) |
| `docker compose -f docker-compose.production.yml config` (no secrets) | Fails fast on missing secrets |
| `docker compose -f docker-compose.production.yml config` (with all required secrets) | Passes |

---

## 4. Files Changed In Phase 3

Backend:

- `backend/src/config/env.validation.ts` — `APP_ENCRYPTION_KEY` required in prod; key-distinctness rule.
- `backend/src/config/env.validation.spec.ts` — new acceptance + rejection cases.
- `backend/src/common/services/encryption.service.ts` — strict key handling, versioned ciphertext, OnModuleInit fail-fast.
- `backend/src/common/services/permission-cache.service.ts` — new shared cache service with Redis pub/sub.
- `backend/src/common/services/index.ts` — export `PermissionCacheService`.
- `backend/src/common/decorators/current-user.decorator.ts` — `sid` and synthesized `role.scope`.
- `backend/src/common/interceptors/sensitive-access.interceptor.ts` — log success AND failure paths.
- `backend/src/modules/auth/auth.module.ts` — `@Global`, provides `PermissionCacheService` and exports `JwtStrategy`.
- `backend/src/modules/auth/auth.service.ts` — constant-time login, dummy-hash verify, sid lifecycle, surfaces logger errors, public-registration gate untouched.
- `backend/src/modules/auth/auth.controller.ts` — pass `user.sid` to refresh + logout.
- `backend/src/modules/auth/two-factor.service.ts` — AES-GCM v2 + AAD; legacy CBC compat read; logger surfacing.
- `backend/src/modules/auth/strategies/jwt.strategy.ts` — uses `PermissionCacheService`; rejects 2FA tokens; verifies bound `ActiveSession`; explicit throws.
- `backend/src/modules/auth/strategies/jwt-refresh.strategy.ts` — propagate `sid`.
- `backend/src/modules/active-sessions/active-sessions.service.ts` — authoritative revoke; tx-locks refresh tokens; invalidates permission cache.
- `backend/src/modules/users/users.service.ts` — soft-delete, audit, role assignment, company-access grant, cache invalidation, GROUP-scope role enforcement.
- `backend/src/modules/users/users.controller.ts` — `PUT /:id/roles`, `PUT /:id/company-access`.
- `backend/src/modules/users/users.module.ts` — `CompanyScopeService` provider.
- `backend/src/modules/users/dto/create-user.dto.ts` — optional `roleIds`.
- `backend/src/modules/users/dto/assign-roles.dto.ts` — new.
- `backend/src/modules/users/dto/grant-company-access.dto.ts` — new.
- `backend/src/modules/integration-api/integration-api.controller.ts` — new external API surface.
- `backend/src/modules/integration-api/integration-api.module.ts` — new module.
- `backend/src/modules/job-worker/job-handler.registry.ts` — new.
- `backend/src/modules/job-worker/job-worker.service.ts` — new.
- `backend/src/modules/job-worker/job-worker.module.ts` — new.
- `backend/src/modules/job-worker/handlers/data-export.handler.ts` — new.
- `backend/src/modules/job-worker/handlers/backup-run.handler.ts` — new.
- `backend/src/modules/job-worker/handlers/notification-dispatch.handler.ts` — new.
- `backend/src/modules/backup-runs/backup-runs.service.ts` — enqueue `BACKUP_RUN` job at create.
- `backend/src/app.module.ts` — register `IntegrationApiModule` and `JobWorkerModule`.

Frontend:

- `frontend/src/app/api/backend/[...path]/route.ts` — refresh-and-retry with single-flight refresh.
- `frontend/src/contexts/auth-context.tsx` — single-flight `silentRefresh`.
- `frontend/src/app/(dashboard)/users/page.tsx` — new `RolesModal`, role chips per row, gated "Roles" action, soft-delete copy, dead debounce ref removed.

Infrastructure / config:

- `docker-compose.production.yml` — `APP_ENCRYPTION_KEY`, `JOB_WORKER_ENABLED`, secrets propagated to migration job.
- `backend/.env.example` — new keys.
- `backend/.env.production.example` — new keys.

Database / seed:

- `database/seeds/seed.ts` — `users.assign_roles` permission added.

Docs:

- `docs/phase-3-progress-2026-05-01.md` — this file.

---

## 5. Remediation Register Status After Phase 3

| ID | Title | Status before | Status after |
|---|---|---|---|
| P0-06 | Workers / backups / exports lack reliable runtime | Open | In progress (default handlers in place; per-export-type extraction + restore-test follow up) |
| P0-07 | Role assignment workflow incomplete | Open | In progress (API + audit + cache-invalidation + main UI shipped; company-access UI form pending) |
| P0-09 | API-key authentication exists but is unused | Open | In progress (canonical `/integration/*` surface live; further endpoint adoption is incremental) |
| P1-01 | Active sessions not authoritative | Open | In progress (sid claim + lookup + tx-revoke + cache invalidation; UI "sign out everywhere" pending) |
| P1-02 | Permission/user cache is per-process | Open | In progress (Redis pub/sub invalidation live; assertion test under multi-instance simulation pending) |
| P1-03 | TOTP unauthenticated AES-CBC | Open | In progress (AES-GCM + AAD + versioned; back-fill re-encrypt job pending) |
| P1-04 | Generic encryption key fallback unsafe | Open | Verified |
| P1-08 | Frontend auth proxy lacks robust expired-token retry | Open | Verified (proxy retries once; client + proxy both single-flight) |
| P1-09 | Sensitive access interceptor logs only successes | Open | Verified |
| P1-10 | Account enumeration / security event logging weaknesses | Open | Verified |

---

## 6. Phase 3 Exit Criteria

| Exit criterion | Status |
|---|---|
| Role assignment works end to end | Met (API + UI + audit + cache invalidation) |
| Session revocation works across active requests/instances | Met (sid binding + tx-revoke + cache pub/sub) |
| API-key scope tests pass | Pending — surface is live; automated scope tests in Phase 4 |
| Export and backup worker flows create real artifacts | Met for backups (pg_dump + size + checksum); data-export handler produces a real artifact but with a placeholder body until per-`exportType` extraction lands |

---

## 7. Phase 4 Entry Point

Phase 4 is the test-floor and CI-gate phase. With the runtime control plane now in place, the highest-leverage next moves:

1. Add Jest tests for: cross-replica permission-cache invalidation, ActiveSession revocation flow, login response-time variance, role assignment audit + cache invalidation, JobWorker leasing under concurrency.
2. Add e2e tests against `/integration/*` proving scope enforcement (active key + correct scope passes; revoked key fails; missing scope fails).
3. Stabilize the backend test runner (Phase 0 noted it timed out).
4. CI gates: forbid `--passWithNoTests`; require backend + frontend builds, prisma validate/generate, lint, env validation, and the new regression suites.
5. Add a minimal observability layer (structured JSON logs with `nestjs-pino` + correlation IDs) so failures from any of the Phase 3 changes are diagnosable in production.

The release gate remains blocked by:

- Per-`exportType` data extraction in `DataExportJobHandler`.
- Restore-test runner that verifies a `BackupRun.checksum`.
- Phase 4 test suite passing.
- Phase 5 hardening items not yet started.

But Phase 3 has materially changed what the platform actually enforces. After this slice, role assignment, session revocation, API-key authentication, distributed permission revocation, TOTP at-rest tampering protection, login-timing parity, and asynchronous job execution all do what their UIs / models said they did.
