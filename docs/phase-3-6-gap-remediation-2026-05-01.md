# ITEMBA-R Phase 3-6 Gap Remediation Addendum

Date: 2026-05-01

Scope: post-review correction pass for Phase 3, Phase 4, Phase 5, Phase 6, and Phase 6 slice 2.

Source: reviewer findings on the phase progress documents.

---

## Summary

This pass closes six gaps where the phase documents overstated production readiness or where an implementation still had a tenant-isolation or runtime-control hole.

Status: implemented and verified.

---

## Corrections Applied

| Finding | Severity | Remediation |
|---|---:|---|
| API-key payment read/confirm bypassed company scope | P1 | `integration-api` now requires a company-bound API key for payment routes and passes the bound `companyId` into `ExternalPaymentsService.findOne()` and `confirm()`. The payment service now scopes by id + company for read/confirm/reverse when a company is supplied. |
| Frontend backend proxy could not see the refresh cookie | P1 | Auth routes now set two httpOnly refresh cookies: `itemba_refresh` scoped to `/api/auth/refresh` and `itemba_backend_refresh` scoped to `/api/backend`. The backend proxy reads the proxy-scoped cookie, rotates both cookies together, and clears both on session failure/logout. |
| Backup worker could not reliably run `pg_dump` in production | P1 | `backup-run.handler.ts` now passes the database URL through `--dbname=...` instead of `PGURL`. The backend production image now installs `postgresql-client` so `pg_dump` exists at runtime. |
| Integration connection credential encryption still used unsafe fallback material | P2 | `IntegrationConnectionsService` now uses the canonical `EncryptionService` for credential and private-config JSON encryption. The local `APP_SECRET || JWT_ACCESS_SECRET || 'default-secret'` AES helper was removed. |
| Fuel-shift mutations still bypassed company access | P1 | Fuel-shift controller mutation routes now pass the full `AuthUser`. The service asserts WRITE access on open/update/submit/approve/reject/close/delete/attendant-management paths and READ access on efficiency. The close transaction checks company access after row lock and before any write. |
| Cash-account update could reassign records across companies | P1 | `CashAccountsService.update()` now rejects a changed `companyId` and strips `companyId` from the update payload before writing, preserving compatibility with clients that echo the existing company. |

---

## Files Changed

- `backend/src/modules/integration-api/integration-api.controller.ts`
- `backend/src/modules/external-payments/external-payments.service.ts`
- `frontend/src/app/api/auth/login/route.ts`
- `frontend/src/app/api/auth/refresh/route.ts`
- `frontend/src/app/api/auth/logout/route.ts`
- `frontend/src/app/api/backend/[...path]/route.ts`
- `backend/src/modules/job-worker/handlers/backup-run.handler.ts`
- `backend/Dockerfile`
- `backend/src/modules/integration-connections/integration-connections.service.ts`
- `backend/src/modules/integration-connections/integration-connections.module.ts`
- `backend/src/modules/fuel-shifts/fuel-shifts.controller.ts`
- `backend/src/modules/fuel-shifts/fuel-shifts.service.ts`
- `backend/src/modules/cash-accounts/cash-accounts.service.ts`

---

## Verification

| Command | Result |
|---|---|
| `npm run verify:backend:locked` | Passed: Prisma schema validation, backend typecheck, backend build |
| `cd backend && npm run test:ci` | Passed: 25 suites / 169 tests |
| `cd frontend && npx vitest run` | Passed: 3 files / 38 tests |
| `npm run verify:frontend:local` | Passed: frontend typecheck and Next production build; existing hook/font lint warnings only |
| `node scripts/check-unsafe-patterns.mjs` | Passed: 185 known baseline violations / 0 new |

---

## Residual Risk

- P0-01 remains broader than this patch. Many company-owned services are still in the unsafe-pattern backlog and must continue through later waves.
- The backend proxy now has a production-valid refresh path, but cross-tab/browser-session behavior still deserves an end-to-end browser test once the auth e2e harness is available.
- Backup execution is production-valid for the container image, but restore testing still depends on external database/storage wiring and should remain part of the disaster-recovery gate.
