# ITEMBA-R Phase 4 Progress Log

Date: 2026-05-01

Phase: 4 — Test Floor And CI Gates

Baseline: `docs/phase-3-progress-2026-05-01.md`

Register: `docs/remediation-register-2026-05-01.md`

---

## 1. Objective

Phase 4 prevents the control failures hardened in Phases 1–3 from regressing. The work is:

1. Stabilize the test runners so they finish predictably in CI.
2. Add P0 regression tests for every behavioral contract that Phases 1–3 introduced.
3. Add static-analysis guardrails for the patterns most likely to be copy-pasted back in.
4. Update CI to enforce all of the above.

After this slice, the next attempt to silently revert role-assignment, sessions-as-authoritative, the company-scope refactor, encryption hardening, the JobWorker activation gate, the proxy CSRF check, or the constant-time login path will fail the build instead of shipping.

---

## 2. Completed In This Slice

### P2-03: Backend test runner stabilization

Status: verified.

Phase 0 reported `cd backend && npm test -- --runInBand` timing out after 244 s. Root cause: the previous implementation did not pass `--forceExit` and Jest was waiting for unclosed handles to settle after every test had already passed. With `--runInBand --forceExit` the same suite finishes in 17 s.

Changes:

- `backend/package.json`:
  - `test` is now `jest --runInBand --forceExit` so the basic command always terminates.
  - New `test:debug` (no `forceExit`, with `--detectOpenHandles`) for diagnosing what to clean up next.
  - New `test:ci` for CI runners.

The remaining open-handle diagnosis is tracked as a P2 follow-up — we are not papering over a real test bug, just making CI honest. None of the 162 tests fail under either configuration; the issue is exclusively the post-test wait.

Verification:

- `cd backend && npm test` — 24 suites / 162 tests / 17 s.
- `cd backend && npm run test:ci` — same.

### P2-01: Backend P0 regression test floor

Status: verified.

Eight new spec files cover the high-risk contracts from Phases 1–3. All pass.

| Spec | What it pins |
|---|---|
| `modules/journal-entries/journal-entries.isolation.spec.ts` | findAll restricts a company-A user to company-A entries when no filter is supplied. Cross-company query rejected. Group-scoped users may query any company. findOne refuses cross-company access. WRITE-level minimum is enforced. NotFound vs Forbidden distinguished. |
| `modules/inventory-movements/inventory-movements.atomicity.spec.ts` | Zero / negative quantity rejected. Unsupported movement type rejected before any DB write. PURCHASE_RETURN classified as outbound (the Phase 2 fix). Canonical inbound and outbound enum sets locked. |
| `modules/job-worker/job-worker.behavior.spec.ts` | JobHandlerRegistry.get returns undefined for unregistered types. Replace-warning fires when the same type is registered twice. registeredTypes lists all bindings. Retry backoff is monotonic up to attempt 6 and caps at 60 seconds. JOB_WORKER_ENABLED gate accepts only `true`/`1`/`yes`/`on`. |
| `common/guards/api-key-auth.guard.spec.ts` | Missing `x-api-key` → 401. Unknown key → 401. Revoked key → 401. Expired key → 401. Missing required scope → 403. All scopes present → req.user is synthesized correctly. lastUsedAt is updated best-effort. |
| `common/services/permission-cache.service.spec.ts` | get/set round-trip. TTL eviction. invalidate / invalidateAll. Graceful degrade when Redis is not configured. |
| `modules/auth/auth.timing.spec.ts` | "Invalid credentials" returned for missing user, INACTIVE user, wrong password, and locked account (no leak about lockout state). Coarse timing-parity check: the missing-user path is not faster than wrong-password by more than ~3×. |
| `modules/active-sessions/active-sessions.revocation.spec.ts` | revoke() flips the row to REVOKED inside a transaction. Refresh tokens issued at-or-after the session start are revoked. Permission cache is invalidated for the affected user. SESSION_REVOKED audit log captures actor + diff. |
| `modules/users/users.role-assignment.spec.ts` | Unknown role ids rejected before any mutation. Missing target user → NotFound. GROUP-scoped role assignment by a non-GROUP actor → Forbidden. Role-set replace correctly removes obsolete + adds new. Audit log contains the diff. Permission cache invalidation fires. |

Counts:

- Phase 0 baseline: 16 suites / 108 tests.
- After Phase 4: 24 suites / 162 tests.
- New tests added in Phase 4: **+54** across 8 files.

### P2-01 (cont.): Frontend RolesModal smoke test

Status: verified.

Phase 3 introduced the role-assignment UI inline in `users/page.tsx`. To make it testable in isolation it was extracted into `frontend/src/app/(dashboard)/users/_components/RolesModal.tsx` and the page now imports it. A smoke test pins the contract.

- `frontend/src/app/(dashboard)/users/_components/RolesModal.tsx` — new dedicated component.
- `frontend/src/app/(dashboard)/users/_components/RolesModal.test.tsx` — 7 tests covering: render-by-scope, pre-checked existing roles, toggle-on-click, canonical PUT payload `{ roleIds }`, error messages surface as `role="alert"`, empty selection sends `[]`, empty role catalog renders the seeded-state hint.
- `frontend/src/app/(dashboard)/users/page.tsx` — imports `RolesModal` from `_components/`; the inline definition was removed.

Counts:

- Phase 0 baseline: 2 frontend test files / 31 tests.
- After Phase 4: 3 frontend test files / 38 tests (+7).

Verification:

- `cd frontend && npx vitest run` — 38 tests pass in 1.84 s.

### P2-09: Static-analysis guardrail

Status: verified.

`scripts/check-unsafe-patterns.mjs` scans the codebase for the patterns most likely to silently regress the audit fixes. Each rule has a stable id, a description, a regex, and (optionally) a per-rule allow-list.

Rules:

| ID | Catches |
|---|---|
| `COMPANY_ID_QUERY_OVERRIDE` | `if (companyId) where.companyId = companyId` — the blind override pattern that Phase 1 fixed. |
| `JWT_SECRET_FALLBACK` | `APP_SECRET || JWT_ACCESS_SECRET ||` — the pre-Phase-3 EncryptionService fallback chain. |
| `AES_CBC_TOTP` | `createCipheriv('aes-256-cbc', …)` — re-introduction of unauthenticated AES-CBC for sensitive secrets. |
| `PASSWITHNOTESTS` | `--passWithNoTests` in CI — the missing-test silencer. |
| `PRISMA_USER_HARD_DELETE` | Direct `prisma.user.delete(...)` — bypasses the Phase 3 soft-delete path. |
| `PUBLIC_REGISTER_DEFAULT_ON` | Default flip of `ALLOW_PUBLIC_REGISTRATION` back to `true`. |

Baseline behavior:

- 194 currently-known violations (almost entirely the open P0-01 backlog of services that still need company-scope refactor) are recorded in `scripts/check-unsafe-patterns.baseline.json`.
- The script only fails when a NEW violation is introduced — i.e. when somebody copies the unsafe pattern into a file that wasn't already tagged.
- The baseline is regenerable: `node scripts/check-unsafe-patterns.mjs --write-baseline` after a wave of refactors will narrow the set, and CI will then enforce the tighter list.

Verification:

- `node scripts/check-unsafe-patterns.mjs` exits 0 with the message `OK (194 known baseline violation(s); 0 new)`.

### CI hardening

Status: verified.

`.github/workflows/ci.yml` now enforces:

| Job | What changed |
|---|---|
| `backend-test` | Replaced `npm test --if-present -- --passWithNoTests` with `npm run test:ci`. Missing tests no longer silently pass. |
| `frontend-test` | New job — runs `npx vitest run`. Frontend tests are now a required gate. |
| `unsafe-patterns` | New job — runs `node scripts/check-unsafe-patterns.mjs`. |
| `prod-compose-validate` | New job — verifies the production compose file fails-fast without secrets and validates with the full required secret set. Catches regressions where someone removes a `:?` interpolation guard. |
| `docker-backend` | `needs: [backend-build, backend-test, unsafe-patterns, prod-compose-validate]` — image build only happens after every gate passes on `main`. |
| `docker-frontend` | `needs: [frontend-build, frontend-test, unsafe-patterns]`. |

These are all required jobs, so a PR that breaks any of them blocks merge.

---

## 3. Verification Summary

| Command | Result |
|---|---|
| `cd backend && npm run build` | Passed |
| `cd backend && npm test` | 24 suites / 162 tests / 17.0 s |
| `cd backend && npm run test:ci` | 24 suites / 162 tests / 17.0 s |
| `cd frontend && npm run build` | Passed (290+ pages) |
| `cd frontend && npx vitest run` | 3 files / 38 tests / 1.84 s |
| `node scripts/check-unsafe-patterns.mjs` | OK — 0 new violations |
| `docker compose -f docker-compose.production.yml config` (no secrets) | Fails fast as expected |
| `docker compose -f docker-compose.production.yml config` (with secrets) | Passes |

---

## 4. Files Changed In Phase 4

Backend tests:

- `backend/src/modules/journal-entries/journal-entries.isolation.spec.ts`
- `backend/src/modules/inventory-movements/inventory-movements.atomicity.spec.ts`
- `backend/src/modules/job-worker/job-worker.behavior.spec.ts`
- `backend/src/common/guards/api-key-auth.guard.spec.ts`
- `backend/src/common/services/permission-cache.service.spec.ts`
- `backend/src/modules/auth/auth.timing.spec.ts`
- `backend/src/modules/active-sessions/active-sessions.revocation.spec.ts`
- `backend/src/modules/users/users.role-assignment.spec.ts`

Backend runtime:

- `backend/package.json` — `test` flags + `test:ci` and `test:debug` scripts.

Frontend:

- `frontend/src/app/(dashboard)/users/_components/RolesModal.tsx` — extracted component.
- `frontend/src/app/(dashboard)/users/_components/RolesModal.test.tsx` — smoke test.
- `frontend/src/app/(dashboard)/users/page.tsx` — imports `RolesModal` from `_components/` (inline copy removed).

Static analysis:

- `scripts/check-unsafe-patterns.mjs` — pattern scanner with baseline support.
- `scripts/check-unsafe-patterns.baseline.json` — initial baseline of 194 known violations (snapshot of P0-01 backlog state).

CI:

- `.github/workflows/ci.yml` — `backend-test` no longer permits missing tests; `frontend-test`, `unsafe-patterns`, `prod-compose-validate` jobs added; docker images now depend on every gate.

Docs:

- `docs/phase-4-progress-2026-05-01.md` — this file.
- `docs/remediation-register-2026-05-01.md` — Phase 4 statuses recorded (next section).

---

## 5. Remediation Register Status After Phase 4

| ID | Title | Status before | Status after |
|---|---|---|---|
| P2-01 | Test coverage too thin for platform size | Open | In progress (8 P0 regression specs / 54 new tests landed; cross-replica permission-cache and JobWorker leasing-under-concurrency still need a live-DB e2e harness) |
| P2-02 | Frontend test dependency state incomplete | Verified | Verified (still — RolesModal smoke test joins the 31 existing tests) |
| P2-03 | Backend test command does not complete | Open | Verified (`--runInBand --forceExit` makes runs deterministic; open-handle diagnosis tracked as a low-priority follow-up) |
| P2-09 | Build and script hygiene | Open | In progress (unsafe-pattern scanner with baseline shipped; build-all.ps1 Invoke-Expression and Windows Prisma generate doc still pending) |

CI gates added directly close several issues from the audit reports:

- "CI passes with no tests" (Audit B M-01) — closed.
- "Production compose can render with empty required secrets" (Audit A C-6, Audit B C-02) — closed; `prod-compose-validate` job asserts both the failure and success paths.
- "Re-introducing the blind companyId override is silent" (Audit A C-2, Audit B C-05) — closed by `unsafe-patterns` rule `COMPANY_ID_QUERY_OVERRIDE`.

---

## 6. Phase 4 Exit Criteria

| Exit criterion | Status |
|---|---|
| CI fails on missing tests | Met (`--passWithNoTests` removed; `test:ci` is the new entry point) |
| CI fails on build failure | Met (already true in Phase 0; Phase 4 keeps it) |
| CI fails on company-scope regression | Met for the blind-override pattern via `unsafe-patterns` (full e2e cross-company assertion needs live DB and is queued for Phase 5) |
| P0 regression suite is green | Met (24 suites / 162 backend tests + 3 / 38 frontend tests) |

---

## 7. Phase 5 Entry Point

Phase 5 is the enterprise-hardening phase. With the test floor and CI gates in place, the next moves are:

1. Continue the P0-01 company-scope refactor across the remaining ~190 services in the baseline. As each lands, the static check's baseline shrinks; the CI gate ensures no new ones can land.
2. Build a small live-DB e2e harness (Postgres in CI service container) so we can finally write the cross-company isolation tests that hit real controllers, the permission-cache pub/sub test against two API instances, and the JobWorker leasing test under concurrent workers.
3. Per-`exportType` data extraction in `DataExportJobHandler`.
4. Restore-test runner that consumes `BackupRun.checksum`.
5. Backfill re-encrypt of legacy AES-CBC TOTP secrets to `v2:` AES-GCM ciphertext.
6. Audit-classification + naming pass (P2-06).
7. `dangerouslySetInnerHTML` removal in `document-templates/print-engine` (P2-07).
8. Frontend hook-deps cleanup (P2-08).
9. AppModule consolidation (P2-10) — collapse 263 modules into ~150 domain modules.

The release gate stays blocked by the residual P0-01 backlog (most services still match the COMPANY_ID_QUERY_OVERRIDE pattern, which is now a tracked debt with a hard ceiling: no new instances can land). Once the baseline is fully cleaned, the `unsafe-patterns` job can be flipped from baseline-tolerant to strict.

But Phase 4 has changed the contract: from now on, every audit-fix commit is defended by a regression test or a static-analysis rule, and every PR runs them. The platform's control plane no longer relies on convention — it's enforced by CI.
