# ITEMBA-R Phase 1 Progress Log

Date: 2026-05-01

Phase: 1 - Production No-Go Cleanup

Baseline: `docs/phase-0-stabilization-baseline-2026-05-01.md`

Register: `docs/remediation-register-2026-05-01.md`

---

## 1. Completed In This Slice

### P0-02: Frontend production build

Status: verified.

Changes:

- Escaped JSX text entities that were blocking `react/no-unescaped-entities`.
- Wrapped `/reports/run` content in a Suspense boundary for `useSearchParams()`.

Verification:

- `npm run verify:frontend:local` passed.
- `npm run verify:local` passed.

Remaining:

- Non-blocking `react-hooks/exhaustive-deps` warnings remain and stay under P2.

### P2-02: Frontend test execution

Status: verified.

Changes:

- Regenerated the frontend install/lock state with `npm install`.
- Confirmed `npm ci` now succeeds.

Verification:

- `cd frontend && npm test` passed.
- Result: 2 test files, 31 tests passed.

Residual:

- `npm install` reported 11 frontend dependency vulnerabilities: 7 moderate, 3 high, 1 critical.
- This should become a security dependency follow-up, not a blind `npm audit fix --force`.

### P0-03: Production env/Docker release path

Status: in progress.

Changes:

- Added fail-fast production compose interpolation for required secrets.
- Added `TWO_FACTOR_ENCRYPTION_KEY` and `REFRESH_TOKEN_PEPPER` to production compose/env example.
- Replaced stale `ALLOWED_ORIGINS` production example with `CORS_ORIGIN`.
- Added a `backend-migrate` one-shot production compose service.
- Added backend Dockerfile `migration` target.
- Added OpenSSL to backend Docker stages for Prisma.
- Added non-root `app` user to backend production image.
- Increased backend Docker builder Node heap.
- Narrowed `.dockerignore` so source module `backend/src/modules/backups` is not excluded.

Verification:

- `docker compose -f docker-compose.production.yml config` fails when required secrets are missing.
- `docker compose -f docker-compose.production.yml config` passes with dummy production values.
- `docker build -f backend/Dockerfile --target production -t itemba-r-backend:phase1-check .` passed.
- `docker image inspect itemba-r-backend:phase1-check --format '{{.Config.User}}'` returned `app`.
- `docker build -f backend/Dockerfile --target migration -t itemba-r-backend-migrate:phase1-check .` passed.

Residual:

- Frontend Docker image build exceeded a 15-minute local timeout and was stopped. This still needs a clean pass/fail.
- Prisma generate inside Docker still performs auto-install because the Prisma schema lives outside `backend` and Prisma infers `/app` as project root. It builds, but the Docker build is slow and should be improved.

### P0-08: Registration, CSRF, and login hardening

Status: in progress.

Changes:

- Added route-level throttle to `POST /auth/login`.
- Added route-level throttle to `POST /auth/register`.
- Disabled public registration unless `ALLOW_PUBLIC_REGISTRATION` is explicitly enabled.
- Added `ALLOW_PUBLIC_REGISTRATION=false` to production env example.
- Tightened frontend auth cookies to `sameSite: 'strict'`.
- Login route now issues a non-httpOnly `itemba_csrf` cookie.
- Logout route clears the CSRF cookie and path-scoped refresh cookie.
- Backend proxy now rejects unsafe methods without same-origin request metadata and a matching `x-csrf-token`.
- Added dashboard `CsrfFetchProvider` to attach CSRF headers to unsafe `/api/backend/*` calls.
- Updated shared `backendFetch` client to attach CSRF headers for unsafe proxy calls.

Verification:

- `npm run verify:backend:locked` passed.
- `npm run verify:frontend:local` passed.
- `npm run verify:local` passed.

Residual:

- Need automated tests for public registration disabled behavior.
- Need automated tests for login/register throttle metadata if practical.
- Need route-handler tests or integration tests for CSRF rejection/acceptance.

### P0-01: Cross-company isolation

Status: in progress.

Changes:

- Started with `journal-entries`.
- `findAll` now receives `CurrentUser` and applies `CompanyScopeService.companyWhereFor()`.
- `findOne` now receives `CurrentUser` and asserts access to the journal's company.
- `create` now asserts write access to the DTO company before posting controls and line validation.
- `update`, `post`, `reverse`, and `remove` now assert write access through the scoped `findOne`.

Verification:

- `npm run verify:backend:locked` passed after the journal-entry refactor.

Residual:

- Need cross-company e2e tests for journal entries.
- Need to continue the same pattern through payroll runs, fuel shifts, inventory movements, customers, exports/reports, users/roles, tenants, and remaining company-owned modules.

---

## 2. Verification Summary

| Command | Result |
|---|---|
| `npm run verify:frontend:local` | Passed |
| `cd frontend && npm test` | Passed |
| `cd frontend && npm ci` | Passed |
| `npm run verify:backend:locked` | Passed |
| `npm run verify:local` | Passed |
| `docker compose -f docker-compose.production.yml config` without secrets | Failed as expected |
| `docker compose -f docker-compose.production.yml config` with dummy secrets | Passed |
| `docker build -f backend/Dockerfile --target production ...` | Passed |
| `docker build -f backend/Dockerfile --target migration ...` | Passed |
| `docker build -t itemba-r-frontend:phase1-check ./frontend` | Timed out after 15 minutes |

---

## 3. New Findings Surfaced During Phase 1

1. `.dockerignore` was excluding `backend/src/modules/backups`, causing backend Docker builds to fail.
2. Backend Docker build needed higher Node heap for the large NestJS application.
3. Frontend lockfile was out of sync with `package.json`, causing `npm ci` to fail.
4. Frontend dependency audit currently reports 11 vulnerabilities.
5. Prisma auto-install during Docker generate makes backend image builds slow because schema/project-root inference is awkward.

---

## 4. Next Phase 1 Actions

1. Get a clean frontend Docker image pass/fail.
2. Add tests for registration disabled behavior and CSRF proxy enforcement.
3. Continue P0-01 company-scope refactor in this order:
   - payroll runs
   - fuel shifts
   - inventory movements
   - customers
   - exports/reports
   - users/roles
4. Add cross-company e2e tests for `journal-entries`.
5. Decide how to handle dependency audit findings without blind breaking upgrades.

---

## 5. Current Phase 1 Position

Phase 1 has started and removed the original build/test/deployment blockers for the main local verification path. The platform is still not production-ready because company isolation is only partially remediated and several P0 items remain open, but the baseline is materially better: root verification passes, frontend tests run, backend production image builds, compose fails fast on missing secrets, and the first high-risk company-owned module has been moved to the canonical company-scope pattern.
