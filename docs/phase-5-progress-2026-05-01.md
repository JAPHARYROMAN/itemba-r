# ITEMBA-R Phase 5 Progress Log

Date: 2026-05-01

Phase: 5 — Enterprise Hardening

Baseline: `docs/phase-4-progress-2026-05-01.md`

Register: `docs/remediation-register-2026-05-01.md`

---

## 1. Objective

Phase 5 closes the highest-leverage enterprise-hardening items left by Phases 1–4 before a supervised pilot is run. Per the master plan, the work is:

1. Continue the P0-01 company-scope refactor across high-traffic operational services.
2. Wire the Phase 3 BackgroundJob worker to actually verify backup integrity (not just create them).
3. Replace the `dangerouslySetInnerHTML` XSS surface in the print-engine.
4. Normalize audit-action naming and severity into a single helper.
5. Land a one-shot admin endpoint to re-encrypt legacy AES-CBC TOTP secrets to the Phase 3 v2 (AES-GCM) format.
6. Tighten the static-analysis baseline so the new clean services become a contract.

After this slice, the four highest-traffic operational entry points (customers, sales orders, suppliers, products) are protected by `CompanyScopeService`, the backup story has a verifiable end-to-end loop, and the worst remaining frontend XSS surface is sandboxed.

---

## 2. Completed In This Slice

### P0-01: Company-scope refactor — wave 1 (operational core)

Status: in progress. Four high-traffic services moved to the canonical pattern.

| Service | Notes |
|---|---|
| `customers` | `findAll` / `findOne` / `create` / `update` / `remove` / `profile` (Customer 360°) all require `AuthUser` and route every read/write through `CompanyScopeService.companyWhereFor` and `assertCanAccessCompany`. `update` rejects any attempt to mutate `companyId` — it is immutable after creation. |
| `sales-orders` | Same pattern, plus `confirm` / `cancel` / `quickSale` / internal `findOne` lookups. Internal callers (`folios.settle`, `project-billing.approve`, `trips.close`) updated to thread `AuthUser` through their own controllers and into the SalesOrders service. |
| `suppliers` | Identical to `customers`. `companyId` immutable post-create. |
| `products` | `findOne` is now mandatory `AuthUser`; `update` and `remove` route through it. Cross-module callers checked — none depended on the old signature. |

The four refactored services were the most-cited threat modules in both the original audit reports — they handle Westsides POS, customer 360, hospitality settlement, project billing, fleet revenue closure, and the entire Quick Sale flow.

The static-analysis baseline shrank from 194 → 190; the four removed entries map exactly to these services.

Verification:

- `cd backend && npx tsc --noEmit` — clean.
- `cd backend && npm run build` — clean.
- `cd backend && npm run test:ci` — 25 suites / 169 tests (up from 24/162).
- `node scripts/check-unsafe-patterns.mjs` — `OK (190 known baseline; 0 new)`.

Residual:

- ~190 services still match the unsafe pattern. Static analysis prevents new instances; subsequent waves will whittle the baseline down. Next-priority targets: payroll-runs / payroll-entries / salary-payments / salary-advances; purchase-orders / GRN / supplier-invoices / three-way-matching; fuel-shifts / fuel-deliveries / fuel-tank-dips / fuel-prices.

### P0-06 (cont.): Restore-test handler verifies BackupRun.checksum

Status: verified.

Phase 3 wired the BackgroundJob worker to actually run `pg_dump` and record `BackupRun.fileSizeBytes` + `checksum`. Phase 5 closes the loop by adding the verifier:

- `backend/src/modules/job-worker/handlers/restore-test.handler.ts` — new handler. Listens on the `CUSTOM` BackgroundJob type with `payload.kind === 'RESTORE_TEST'`, loads the linked RestoreTest + BackupRun, re-hashes the file at `BackupRun.filePath`, compares to `BackupRun.checksum`, and flips the RestoreTest to `PASSED` or `FAILED` with a summary. `TEST_RESTORE` / `FULL_RESTORE_DRILL` / `PARTIAL_RESTORE` types fail with a clear "operator runbook required" message rather than sit in PLANNED indefinitely.
- `backend/src/modules/restore-tests/restore-tests.service.ts` — new `verifyBackup(backupRunId, userId)` method creates a `CHECKSUM_VERIFY` RestoreTest and enqueues a CUSTOM job in one transaction. Idempotency key (`RT-VERIFY-<backupRunNumber>`) means re-submission against the same backup returns the existing job rather than running twice.
- `backend/src/modules/restore-tests/restore-tests.controller.ts` — new `POST /restore-tests/verify/:backupRunId` admin endpoint.
- `backend/src/modules/job-worker/job-worker.module.ts` — registers the new handler.

The end-to-end DR loop is now: enqueue backup → worker runs `pg_dump`, captures SHA-256 → admin enqueues verification → worker re-hashes, sets PASSED/FAILED → admin sees a real status row instead of PLANNED forever.

The chosen design uses `BackgroundJobType.CUSTOM` with a `payload.kind` discriminator rather than introducing a new `RESTORE_TEST` enum value. This keeps the change Prisma-migration-free; if the queue grows, a future migration can promote it.

Residual:

- An external scheduled task (cron / GitHub Actions) that calls `POST /restore-tests/verify/:backupRunId` daily for the latest backup is the next concrete operational improvement.
- `TEST_RESTORE`-type runs still need a runbook script that spins up a sibling Postgres, applies the dump, and verifies a known query — that's a Phase 6+ DR exercise, not Phase 5.

### P2-07: Sandbox `dangerouslySetInnerHTML` in print-engine

Status: verified.

`frontend/src/app/(dashboard)/document-templates/print-engine/page.tsx` previously rendered server-generated template HTML inline via `dangerouslySetInnerHTML`. Any user-controlled substitution embedded in a template could execute JavaScript in the dashboard's same-origin context — full access to the `/api/backend/*` proxy and httpOnly-cookie-backed auth.

The render is now a sandboxed `<iframe srcDoc>` with `sandbox=""` (no allowances at all), which:
- Disables script execution inside the preview document.
- Prevents the iframe document from reading parent cookies/storage even via DOM walking (no `allow-same-origin`).
- Keeps the visual layout fidelity since the same HTML is loaded into the iframe document.

Verification:

- `cd frontend && npm run build` — clean.

### P2-06: Centralized audit action + severity helper

Status: verified.

Audit B M-07 noted that audit action names drifted across services (some logged `CREATE` / `UPDATE` / `DELETE`, others logged `BANK_ACCOUNT_CREATE`) and severity was hand-set inconsistently — a `delete` on a bank account and a `delete` on a help-article both got `MEDIUM`.

`backend/src/common/services/audit-action.helper.ts` introduces `auditFor(entityType, verb, overrides?)` returning `{ action, severity }`:

- Action follows the canonical `<ENTITY_PREFIX>_<VERB>` shape (`BANK_ACCOUNT_DELETE`, `JOURNAL_ENTRY_POST`, `GOODS_RECEIVED_NOTE_CREATE`).
- Severity is the maximum of an entity floor (Group Control entities → HIGH; financial mutations → MEDIUM; operational → LOW), a verb floor (POST / REVERSE / APPROVE / REVOKE / PAY → HIGH; DELETE / CANCEL / CLOSE → MEDIUM), and an explicit override.

The helper is non-throwing — unknown entities fall back to a derived prefix and `LOW` so it can be dropped into any service incrementally without breaking existing logs.

A new spec file pins the contract: `backend/src/common/services/audit-action.helper.spec.ts` (7 tests).

Verification:

- `cd backend && npm run test:ci` — 25 suites / 169 tests (up 1/7).

Residual:

- This phase introduces the helper but does NOT bulk-rewrite existing `audit.log({ action: 'CREATE', ... })` call sites. That migration is Phase 6 housekeeping; the helper can replace inline strings call-by-call as those services are touched.

### P1-03 (cont.): Admin endpoint to re-encrypt legacy TOTP secrets

Status: verified.

Phase 3 introduced AES-256-GCM (`v2:`) for new TOTP secrets and kept compat-read for the legacy `iv:ct` AES-CBC format. Phase 5 adds the migration:

- `TwoFactorService.reencryptLegacyTotpSecrets()` scans every `UserSecurityProfile` with a non-null `twoFactorSecretEncrypted`, decrypts (auto-handles legacy + v2), re-encrypts to v2 with the userId AAD, and updates the row. Returns `{ scanned, migrated, skipped, failed }`. Idempotent — already-v2 entries are skipped.
- `POST /auth/2fa/admin/reencrypt-legacy` — gated by `users.assign_roles` permission and the `RecentAuthGuard` (last password verification within 15 minutes). Logs a HIGH-severity `TWO_FACTOR_SECRETS_REENCRYPTED` audit event with the migration summary.

Residual:

- A boot-time job that runs the migration automatically on first deploy is a follow-up — for now operators trigger it once per environment.

### Static-analysis baseline tightened

Status: verified.

`scripts/check-unsafe-patterns.baseline.json` regenerated:

- 194 → 190 known violations (4 services moved to the canonical pattern).
- The four removed entries are `customers`, `sales-orders`, `suppliers`, `products`.
- New regressions in any of those four services would now fail CI (they're no longer baseline-allowed).

---

## 3. Verification Summary

| Command | Result |
|---|---|
| `cd backend && npx tsc --noEmit` | clean |
| `cd backend && npm run build` | clean |
| `cd backend && npm run test:ci` | 25 suites / 169 tests |
| `cd frontend && npx tsc --noEmit` | clean |
| `cd frontend && npm run build` | clean (290+ pages) |
| `cd frontend && npx vitest run` | 3 files / 38 tests |
| `node scripts/check-unsafe-patterns.mjs` | OK — 190 baseline / 0 new |

---

## 4. Files Changed In Phase 5

Backend service refactors:

- `backend/src/modules/customers/customers.service.ts` + `.controller.ts` + `.module.ts`
- `backend/src/modules/sales-orders/sales-orders.service.ts` + `.controller.ts` + `.module.ts`
- `backend/src/modules/suppliers/suppliers.service.ts` + `.controller.ts` + `.module.ts`
- `backend/src/modules/products/products.service.ts` + `.controller.ts` + `.module.ts`

Backend internal-caller updates (downstream of sales-orders signature change):

- `backend/src/modules/folios/folios.service.ts` + `.controller.ts`
- `backend/src/modules/project-billing/project-billing.service.ts` + `.controller.ts`
- `backend/src/modules/trips/trips.service.ts` + `.controller.ts`

Backend new code:

- `backend/src/modules/job-worker/handlers/restore-test.handler.ts` — new
- `backend/src/modules/job-worker/job-worker.module.ts` — registers the new handler
- `backend/src/modules/restore-tests/restore-tests.service.ts` — new `verifyBackup` method
- `backend/src/modules/restore-tests/restore-tests.controller.ts` — new `POST /verify/:backupRunId`
- `backend/src/common/services/audit-action.helper.ts` — new
- `backend/src/common/services/audit-action.helper.spec.ts` — new (7 tests)
- `backend/src/common/services/index.ts` — export `auditFor` and `AuditVerb`
- `backend/src/modules/auth/two-factor.service.ts` — new `reencryptLegacyTotpSecrets`
- `backend/src/modules/auth/auth.controller.ts` — new `POST /auth/2fa/admin/reencrypt-legacy`

Frontend:

- `frontend/src/app/(dashboard)/document-templates/print-engine/page.tsx` — `dangerouslySetInnerHTML` replaced with sandboxed iframe.

Static analysis:

- `scripts/check-unsafe-patterns.baseline.json` — regenerated (194 → 190).

Docs:

- `docs/phase-5-progress-2026-05-01.md` — this file.
- `docs/remediation-register-2026-05-01.md` — Phase 5 statuses recorded (next section).

---

## 5. Remediation Register Status After Phase 5

| ID | Title | Status before | Status after |
|---|---|---|---|
| P0-01 | Cross-company isolation / IDOR | In progress | In progress (4 high-traffic services moved; static check enforces no new instances) |
| P0-06 | Workers / backups / exports lack reliable runtime | In progress | In progress (restore-test verification handler + endpoint live; per-`exportType` data extraction still pending) |
| P1-03 | TOTP unauthenticated AES-CBC | In progress | Verified (one-shot admin re-encrypt endpoint shipped) |
| P2-06 | Audit classification and naming inconsistent | Open | In progress (helper + tests landed; per-call-site migration is incremental) |
| P2-07 | Raw HTML preview creates XSS risk | Open | Verified |

---

## 6. Phase 5 Exit Criteria

| Exit criterion | Status |
|---|---|
| All P0 complete | Not yet — P0-01 (substantial backlog), P0-06 (per-`exportType` extraction) and P0-07 (company-access UI form) remain open. The remaining work is incremental rather than blocking; the static analysis ensures no new regressions. |
| P1 items complete or accepted with mitigation | Mostly — P1-03 verified by this slice. P1-05 (security policies are records, not enforced controls) remains open and is a candidate for explicit acceptance with mitigation if it stays unaddressed. |
| Pilot readiness review can be held | Yes for an opt-in supervised pilot — the four highest-traffic operational entry points are now scope-enforced, the DR loop is verifiable, and CI gates regressions. The pilot would carry the documented residual risk of the remaining ~190 unscoped services. |

---

## 7. Phase 6 Entry Point

Phase 6 is the ERP-parity phase per the master plan, but the residual stabilization work needs to land first. In priority order:

1. Continue P0-01 batch refactor — payroll-runs / payroll-entries / salary-payments / salary-advances; fuel-shifts / fuel-deliveries / fuel-tank-dips / fuel-prices / fuel-credit-sales; purchase-orders / GRN / supplier-invoices / three-way-matching. Each wave shrinks the baseline and tightens the CI gate further.
2. Per-`exportType` data extraction in `DataExportJobHandler` — replace the placeholder JSON shell with real per-entity dumps for the most-requested export types (audit-logs, journal-entries, sales-orders).
3. Schedule a daily cron that calls `POST /restore-tests/verify/:backupRunId` against the most recent backup so DR drills are continuous, not manual.
4. Migrate existing `audit.log({ action: '...', ... })` call sites to use `auditFor(entity, verb)` so the action vocabulary becomes consistent across the codebase.
5. P1-05: decide whether to wire SecurityPolicy rows into the actual auth flow (lockout policy, password-min-length policy, 2FA enforcement policy) or remove the surface and document the omission.
6. AppModule consolidation (P2-10) — collapse the 263-module composition into ~150 domain modules.
7. Begin the ERP-parity items: GL posting funnel, FX revaluation, budget-vs-actual, dimension-based reporting.

The release gate continues to be defended by:
- CI gates (Phase 4) — every PR passes typecheck + lint + tests + unsafe-pattern scan + prod-compose validation.
- Static-analysis baseline — every refactored service is locked in; no new instances of the unsafe pattern can land.
- Test floor — 169 backend regression tests + 38 frontend tests pin the audit fixes.

Phase 5 completes the highest-leverage hardening that fits inside one slice. The platform is materially safer to pilot than it was at the end of Phase 4.
