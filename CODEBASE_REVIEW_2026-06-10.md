# ITEMBA-R — State of the Codebase Report

**Prepared for the owner · 2026-06-10 · Branch: `audit/security-correctness-fixes`**
**All paths below are relative to the repo root: `C:\projects\Actual Projects\itemba-r\`**
**Method:** 34-agent review — 8 dimension reviewers (prior-audit residuals, backend architecture, frontend/UX, dead weight, testing, performance, schema, DX/ops), top findings independently re-verified against source by adversarial verifier agents, then synthesized. Refuted claims were dropped; partials downgraded and flagged.

---

## 1. Executive verdict

ITEMBA-R is a real, working multi-tenant ERP with genuinely strong bones — disciplined env validation, a well-tested company-scoping service, race-safe code generation, server-side recomputation of financial totals, and all three critical findings from the May 30 audit verifiably fixed. But it is carrying three kinds of debt that compound against each other: **(a) an incomplete security remediation** — roughly 109 backend `findOne(id)` methods still let any authenticated user read any company's records by ID, and a handful of verified-open high findings (refresh-token rotation, asset-disposal GL posting, payroll effective-dating, proforma conversion atomicity) can silently corrupt books or filings; **(b) near-zero test protection** — the controls that *do* exist are untested, CI passes with zero coverage enforcement, and the 6 most financially sensitive modules have no spec files at all, meaning the fixes you just paid for can regress without anyone noticing; and **(c) frontend duplication at industrial scale** — `interface Company` is defined 148 times, status-color maps 96 times, and every one of 347 pages hand-rolls its own data fetching. The single most important truth: **the system's correctness currently depends on conventions being followed by hand, with no automated gate catching when they aren't.** "Worth while" requires three things in order: finish the IDOR/financial fixes (weeks), lock them in with CI-enforced tests (month 1), then attack the frontend duplication so the next 100 features cost half as much (months 2–3).

---

## 2. Prior audit status (ITMB-001..108)

**Headline: the criticals are fixed; the marker count is misleading; a verified set of highs is still open.**

- **All 3 CRITICAL findings are fixed** (independently verified):
  - ITMB-001 — `backend/src/modules/intercompany-transactions/intercompany-transactions.service.ts` injects `CompanyScopeService` (line 28), asserts both-sides access before every posting (lines 120, 278–293). Fixed but **unmarked**.
  - ITMB-002/003 — restaurant-orders and sales-orders recompute all totals server-side; client-supplied financial fields are ignored.
- **The "only 31 of 108 IDs marked in code" signal is unreliable.** Verification showed many unmarked findings are actually fixed (ITMB-001, 004, 009, 010 among them). Do not use marker grep as a fix ledger. **Action:** run a reconciliation pass (script parses `AUDIT_FINDINGS.md`, greps each ID, human-verifies the gaps) before this branch merges to `main`. Effort: M.
- **Verified STILL OPEN (these outrank everything else in this report):**

| ID | Issue | Where | Verdict |
|---|---|---|---|
| ITMB-006 | Refresh token **not rotated** in persistent mode — `auth.service.ts:462` returns `refreshToken: rawToken` unchanged | `backend/src/modules/auth/auth.service.ts` | Confirmed open |
| ITMB-013 | Fixed-asset `dispose()` posts **no journal entry** — no accum-depreciation reversal, no gain/loss, balance sheet left wrong on every disposal | `backend/src/modules/fixed-assets/fixed-assets.service.ts:214-244` | Confirmed |
| ITMB-019 | Payroll tax/statutory rates **not effective-dated** — re-running a prior month applies today's PAYE/NSSF rates; regenerated statutory returns disagree with what was filed | `backend/src/modules/hr/payroll-calculator/payroll-calculator.service.ts:36-57`, caller `payroll-runs.service.ts:168` | Confirmed |
| ITMB-022 | Payroll period attribution diverges: statutory-returns uses paymentDate-first (`statutory-returns.service.ts:477-496`), tax-filing-engine uses startDate-only (`tax-filing-engine.service.ts:215`) — same payroll lands in different filing months | both files above | Confirmed |
| ITMB-030/071 (residual) | `ProformaInvoicesService.convertToSalesOrder` (lines 247–302) mints SO numbers with `Date.now().toString(36)`, writes `status=CONFIRMED` directly, **bypassing all inventory/tax/receivable posting** | `backend/src/modules/proforma-invoices/proforma-invoices.service.ts` | Confirmed |
| ITMB-030 (residual) | 5 modules still do `count()+1` outside any transaction: vehicle-maintenance, project-progress, trip-expenses, project-billing, stock-damage | `backend/src/modules/{vehicle-maintenance,project-progress,trip-expenses,project-billing,stock-damage}` | Confirmed |
| — | `loan-repayment-schedules` controller calls `findOne(id)` **without user** (lines 18–19); `generateForLoan` never asserts access to `loan.companyId` | `backend/src/modules/loan-repayment-schedules/` | Confirmed |
| — | `financial-statements.service.ts` `findOne` missing `deletedAt: null` (line 29) — reads soft-deleted statements | `backend/src/modules/financial-statements/financial-statements.service.ts` | Confirmed (found during verification) |

- **Reported open but not independently re-verified** (treat as probable, confirm during fix): ITMB-040 (room-booking overlap), ITMB-046 (credit limit never enforced on CREDIT sales — `sales-orders.service.ts:225` confirm path), ITMB-050/051 (in-memory login throttle; no 2FA lockout — `auth.service.ts:75,234`), ITMB-052 (BI `company_comparison` dataset cross-tenant + unbounded — `bi.service.ts:172`), ITMB-075/076 (~10-year auth cookie Max-Age — `frontend/src/lib/auth-cookie-config.ts`), ITMB-077 (edge auth middleware never loaded — `frontend/src/proxy.ts` exists but `frontend/src/middleware.ts` does not).
- **Refuted by verification — do NOT spend time on:** ITMB-023 SSRF (integration-connections already has `assertPublicUrl` with DNS resolution, private/metadata IP rejection, `redirect:'error'` — `integration-connections.service.ts:255,365-429`); ITMB-024 (labor-records already asserts company access, strips `paymentStatus`, validates `@Min(0)`); ITMB-049 (production logger gating already implemented correctly in `backend/src/main.ts:14-18`).

---

## 3. IMPROVE — make existing things better

Ranked by impact.

### 3.1 Test the financial controls that already exist — they are correct but unprotected (Effort: L, staged)
**Evidence:** 6 of the 7 most sensitive modules have **zero** spec files: `intercompany-transactions`, `restaurant-orders`, `depreciation`, `financial-statements`, `audit-adjustments`, `construction-labour-cost`. Verification confirmed the *controls exist* (dual-company assertion, server-side totals, integer-cent balance checks) but nothing stops a refactor from silently deleting them. 59–71 spec files cover 268 modules. The isolation-test pattern already exists in the repo (`backend/src/modules/journal-entries.isolation.spec.ts` style — `ForbiddenException` assertions across companies) but is applied to only 3 modules.
**Action:** Build a reusable tenant-isolation test helper; apply the existing isolation pattern to the 6 modules above plus `posting-engine`, `tax-calculator`, `payroll-calculator`. Test the three invariants: cross-company access rejected, client totals ignored, GL lines balance to the cent.
**Why:** Without this, every fix on this branch has a half-life.

### 3.2 Make CI actually gate quality (Effort: M)
**Evidence:** `.github/workflows/ci.yml:96-115` runs `npm run test:ci` = `jest --runInBand --ci` — **no `--coverage`, no `coverageThreshold` in `backend/package.json:112-116`**. Line 113's comment claims "missing suites must fail the build" but nothing enforces it. Frontend `vitest.config.ts` defines coverage config but excludes pages and enforces no thresholds. The build goes green with zero tests for intercompany GL posting.
**Action:** (1) Pre-test script that fails CI if a named list of high-risk modules lacks `.spec.ts`. (2) `--coverage` + thresholds (start at current baseline, ratchet up). (3) Post coverage to PRs.
**Why:** This converts the test investment in 3.1 from a one-time act into a permanent floor.

### 3.3 Fix the N+1 in the hottest financial path (Effort: M)
**Evidence (confirmed):** `backend/src/modules/sales-orders/sales-orders.service.ts` — `confirm()` lines 1100–1146 does `tx.product.findUnique()` + `tx.inventoryBalance.findUnique()` *per line item* (2N queries per confirmation); same pattern in `cancel()` at line 1556.
**Action:** Batch-load products and balances before the loop (`findMany` with `in:`; pre-load all balances for the branch given the composite key), look up from Maps.
**Why:** This is the daily-driver Operations flow; it scales linearly with order size today.

### 3.4 Bound the dashboard query storms (Effort: M–L)
**Evidence (confirmed):** `westsides-dashboard.service.ts` fires **85 queries** in one `Promise.all` (line 343); `itemba-dashboard` 93+ (lines 128, 671); `operations-dashboard` 83+ (line 83). Zero caching anywhere — no Redis use beyond permission invalidation, `CacheEntry` table unused, no HTTP cache headers. Every GET recomputes the entire cockpit. Also confirmed: `operations-dashboard.service.ts:143-154` loads *all* products with a reorderLevel into memory to slice 10.
**Action:** Redis (or CacheEntry) result cache at 5-min TTL keyed `companyId:branchId`; batch queries in groups of ~20; push the low-stock aggregation into `groupBy`/`having` with a `take`.
**Why:** Connection-pool saturation under concurrent dashboard users is the most likely "the app feels slow" complaint vector.

### 3.5 Frontend error recovery — stop silently swallowing failures (Effort: S)
**Evidence:** the canonical pattern across 100+ pages is `.catch(() => setX([]))` (e.g., `frontend/src/app/(dashboard)/operations/sales-orders/page.tsx` lines 415–420). A failed fetch renders "No sales orders found" with no error, no retry.
**Action:** Store the error alongside data; render an inline error callout with a Retry button for critical lists. (This becomes free if you adopt the query layer in §5.2 — do them together.)

### 3.6 Composite indexes for soft-delete-scoped queries (Effort: S)
**Evidence:** ~1,300 backend queries filter `deletedAt: null` + `companyId`/`status`; `database/prisma/schema.prisma` has single-column indexes but no `[companyId, deletedAt, status]` composites on SalesOrder, InventoryMovement, JournalEntry, Receivable/Payable, Product. AuditLog lacks `[companyId, createdAt]` and `[severity, createdAt]`.
**Action:** Add `@@index([companyId, deletedAt, status])` and `@@index([companyId, deletedAt, createdAt])` to the high-cardinality tables. Cheap, pure win.

---

## 4. MODIFY — change how things work

Ranked. Items 4.1–4.5 are the open audit residuals from §2 — listed here once with concrete fixes.

### 4.1 Close the systematic findOne IDOR — 109 methods (Effort: L, but mechanical) — **CRITICAL**
**Evidence (confirmed):** 109 service methods with signature `async findOne(id: string)` perform unscoped `findFirst({ where: { id, deletedAt: null } })` while their sibling `findAll` methods ARE correctly scoped via `applyCompanyScopeWhere`. Verified examples: `construction-projects.service.ts:34-38`, `crops.service.ts:30-34`, `automation-runs.service.ts:27-31`; controllers pass only `@Param('id')` (e.g., `construction-projects.controller.ts:24-25`). ~128 modules are already fixed — the template exists; the work is half done.
**Action:** Semi-automated refactor: inject `CompanyScopeService`, change to `findOne(id, user, minimum = AccessLevel.READ)`, assert after load, thread `@CurrentUser()` through controllers. Fix `loan-repayment-schedules` (controller lines 18–19 + `generateForLoan` assertion) first — it touches money.
**Why:** This is the open critical. Any authenticated user can read any company's individual records today by UUID.

### 4.2 Fixed-asset disposal must post the reversal JE (ITMB-013, Effort: M)
**Fix:** Wrap `dispose()` in `$transaction`; guard against re-posting via `referenceType='FixedAsset'/referenceId` (the `JournalEntry` model supports this — `schema.prisma:1981-1982`); resolve FIXED_ASSET, ACCUMULATED_DEPRECIATION, Cash/AR; post DR accum-dep + DR proceeds, CR asset at cost, residual to gain/loss. Follow `capitalize()` (lines 308–345) and `depreciation.service.ts:211-268` patterns. Note: accumulated depreciation lives on `DepreciationSchedule`, not the asset — resolve it there. You will also need a gain/loss account role; only `GENERAL_EXPENSE` exists today (`account-resolver.service.ts:122-143`).

### 4.3 Effective-date payroll reference data (ITMB-019, Effort: M)
**Fix:** Thread `periodStart/periodEnd` (already available at `payroll-runs.service.ts:151-152`) into `loadReferenceData()`; add `effectiveFrom: { lte: periodStart }` + `effectiveTo` bounds to every taxRates/`loadRule()` query (lines 52, 100–101). Copy the working pattern from `tax-calculator.service.ts:100-101`. Keep newest-ACTIVE as logged fallback.

### 4.4 Unify payroll period attribution (ITMB-022, Effort: S–M)
**Fix:** One canonical rule — paymentDate-first with startDate fallback over a half-open window (already documented at `statutory-returns.service.ts:486`) — applied identically in `tax-filing-engine.service.ts:215`.

### 4.5 Fix proforma conversion + 5 numbering races (ITMB-030/071 residual, Effort: M)
**Fix:** `QuotationsService.convertToSalesOrder` (lines 235–311) is **already correct** — `codes.next()` in a transaction, creates DRAFT. Copy it into `ProformaInvoicesService.convertToSalesOrder`. Then migrate the 5 unguarded `count()+1` modules (vehicle-maintenance, project-progress, trip-expenses, project-billing, stock-damage) to `EntityCodeGeneratorService.next()` — it exists, is atomic, and 34 services already use it. (boq-items/product-batches have transaction+retry; migrate them later for consistency, not urgency.)

### 4.6 Auth hardening: ITMB-006/050/051/075-077 (Effort: M combined)
- Rotate the refresh token in persistent mode (`auth.service.ts:462`).
- Move the email login-failure throttle (`auth.service.ts:75` in-memory Map) to Redis; keep the DB account lock as second layer.
- In `completeLogin2FA` (`auth.service.ts:234`): re-check `lockedUntil`, persist 2FA failures, lock after 5 bad codes.
- Cut cookie Max-Age in `frontend/src/lib/auth-cookie-config.ts` to match token lifetimes (15–60 min access, 7–30 day refresh).
- Create `frontend/src/middleware.ts` re-exporting from `proxy.ts` — the edge auth gate is currently **dead code Next.js never loads**. Verify post-deploy that protected paths 307-redirect.

### 4.7 Business-rule gaps: credit limit + room overlap + BI scoping (Effort: S each)
- `sales-orders.service.ts:225` `confirm()`: before creating the Receivable, sum open receivables + new amount vs `creditLimit`; reject without an override permission (ITMB-046).
- `room-bookings.service.ts:19`: half-open interval conflict check in `create()`/`checkIn()` (ITMB-040).
- `bi.service.ts:172`: apply `companyFilter` to `company_comparison`; clamp `take` on both datasets (ITMB-052).

### 4.8 Soft-delete unique-constraint collisions (Effort: M, staged)
**Evidence (confirmed):** 156 `@@unique` constraints in `database/prisma/schema.prisma`; **zero** account for soft-delete. A soft-deleted Customer `ABC-001` permanently blocks recreating that code (`Customer` line 2521, `Supplier` 2576, `Division` 730, `ChartOfAccount` 1910–1911, `FiscalYear` 1936, ~40+ more). App-layer checks (e.g., `customers.service.ts:124`) don't help — Postgres rejects the insert.
**Fix — note: Prisma schema does NOT support partial unique constraints.** The real fix is per-table raw-SQL migrations: drop the constraint, add `CREATE UNIQUE INDEX ... ON "Customer"("companyId","customerCode") WHERE "deletedAt" IS NULL`. Stage it: start with Customer/Supplier/Product/ChartOfAccount where the business pain is real; test soft-delete→recreate on staging.

### 4.9 Schema hygiene: nullable companyId + cascade audit (Effort: M, mostly documentation)
**Verified reality (downgraded from the review's framing):** 62 models have nullable `companyId`, but the app layer enforces scoping (`company-scope.service.ts:33-104` requires GROUP role for null) — this is intentional group-level design, not a broken contract. Two genuine items: **`TaxRate` has nullable `companyId` with no Company relation** (line 8743 — orphaned field; fix it), and **line-item models (JournalEntryLine, SalesOrderLine, etc.) lack `deletedAt`**, so explicit `deleteMany()` (e.g., `journal-entries.service.ts:365`) hard-deletes without audit logging while parents soft-delete. Cascade risk is mitigated by the soft-delete middleware (`backend/src/prisma/prisma.service.ts:36-57`) — severity medium, not high. Document the group-vs-company scoping intent per model; add audit logging on hard-delete paths.

---

## 5. ENHANCE — add what's missing

### 5.1 Graceful shutdown (Effort: M) — **highest-ranked enhance**
**Evidence (confirmed):** `backend/src/main.ts:77-81` — no `enableShutdownHooks()`, no SIGTERM handling anywhere in the backend (grep confirmed zero matches); `docker-compose.production.yml` has no `stop_grace_period` (defaults 10s); `/health/ready` (`health.controller.ts:28-32`) never signals draining. Every redeploy of a live financial system risks dropped in-flight writes.
**Action:** `app.enableShutdownHooks()`; draining flag flips `/health/ready` to 503; `stop_grace_period: 30s`; JobWorker awaits in-flight jobs on destroy.

### 5.2 Frontend shared data layer (Effort: M to start, pays compounding dividends)
**Evidence:** 1,015 raw `useEffect` fetch chains vs ~2 hook-based; every page hand-rolls loading/error/cancellation/pagination (e.g., sales-orders page has 6+ parallel `useEffect` loaders, lines 359–495).
**Action:** Adopt TanStack Query (or a minimal `useListData` hook). Refactor the 10 largest pages first — sales-orders (1,370 LOC) and purchase-orders (1,293 LOC) are the daily drivers. This also delivers §3.5 error recovery for free.

### 5.3 Audit-log retention job (Effort: M)
**Evidence (confirmed):** `AuditLog` is append-only — no purge methods in `audit-logs.service.ts:184-372`, no DELETE endpoints, `retention-policies.service.ts` stores policy metadata but **executes nothing**, and the `BackgroundJobType` enum (`schema.prisma:13319-13335`) has no cleanup job type. With 261 modules logging every write, unbounded growth is guaranteed.
**Action:** Add an `AUDIT_CLEANUP` job type + handler in the existing job-worker; severity-tiered retention (e.g., 2y LOW, 7y CRITICAL); legal-hold support.

### 5.4 Observability (Effort: M)
**Evidence:** `logging.interceptor.ts:18-26` logs method+url+timing to stdout only; no error tracking, no log aggregation, no slow-query logging documented anywhere. A live financial system at app.itembagrouptz.com is flying blind on errors.
**Action:** Sentry (SENTRY_DSN env + `@sentry/node`), `log_min_duration_statement=500` on Postgres, document a logging-driver setup in `docs/deployment.md`.

### 5.5 Frontend test baseline (Effort: M)
**Corrected facts:** 10 test files exist — `api-client.ts` is actually well-tested (8 tests incl. CSRF + 401 refresh-retry). The real gaps: **zero tests for any of 347 pages**, zero for `useAuth`/`useApiResource`/`useOrgScope` hooks, zero for the just-shipped Mobile POS pages. The smoke script (`frontend/scripts/smoke-dashboard-routes.mjs`) checks only HTTP 200 + no error signature.
**Action:** 30–40 high-leverage tests: hooks first, then trial-balance/GL/sales-orders/approval pages with MSW. Don't chase coverage percentage; chase the 20 pages where a bug costs money.

### 5.6 Form validation + the SO/PO experience (Effort: L — schedule for month 3+)
Sales/purchase order creation is a single monolithic modal with 20+ `useEffect` hooks, manual validation with inconsistent messages, no discount-range guard. Adopt react-hook-form + zod with shared schemas; consider the stepper/wizard rework **after** the data layer and types land — not before.

### 5.7 DX quick adds (Effort: S each)
- `scripts/setup-dev` script (copy envs, generate JWT secrets, validate DATABASE_URL port mismatch — README says 5433, compose defaults 5432).
- Create `.env.staging.example` — `scripts/validate-env-contract.mjs:10` expects it and **fails on fresh clone** today.
- Put obviously-wrong placeholders in `.env.production.example` empty secrets (`JWT_ACCESS_SECRET=CHANGE-ME-64-CHAR...`).

---

## 6. REMOVE — delete or archive

### 6.1 Frontend duplication — the biggest deletion opportunity in the repo (Effort: M)
**Evidence (confirmed):** `interface Company` defined **148 times**, `Division` 37, `Product` 16 (with divergent optional fields), `Customer` 9 — across 149 page files; zero shared type imports exist anywhere in `frontend/src`. Plus 96 `STATUS_CLR` + 24 `STATUS_COLORS` definitions and per-page CURRENCIES/PAYMENT_METHODS copies.
**Action:** Create `frontend/src/lib/api-types.ts` and `frontend/src/lib/domain-enums.ts` / `status-colors.ts`; migrate pages as they're touched (the recent `sales-order-constants.ts` extraction is the proven template). Every API contract change today means hunting 148 files.

### 6.2 Root clutter (Effort: S — do it this week)
Archive or delete: `_tmp_audit/`, `_fix_workflow.mjs`, `_gen_audit_docs.mjs`, `_mods.txt`, `_modules_list.txt`, `_plus1.txt`, `.next-start-*.log`, `logs/` (18.6 MB of stale dev logs — `git rm --cached`, add to `.gitignore`). Move `start-backend.bat`/`start-frontend.bat` into `scripts/` or replace with npm scripts. Keep `AUDIT_FINDINGS.md` and `AUDIT_FIX_SUGGESTIONS.md` as record. Verify `website/.next/` and `website/node_modules/` are not git-tracked (the website itself is an active marketing site — **do not remove it**).

### 6.3 Vestigial backend e2e job (Effort: S)
`backend/test/jest-e2e.json` + the `backend-e2e` CI job (ci.yml:116-161) run against **zero** `*.e2e-spec.ts` files — a green checkmark that tests nothing. Either delete the job or (better, month 2) write 3–4 real workflow e2e tests (SO→invoice→payment with ledger assertions). A fake gate is worse than no gate.

### 6.4 Zero-consumer dashboard modules (Effort: S — grep-verify first)
`backend/src/modules/final-qa-dashboard/` and `backend/src/modules/production-ops/` reportedly have no frontend references and duplicate monitoring/scalability metrics. **Caveat:** not adversarially verified — grep frontend + backend imports before deleting. Do *not* delete the `GET /sales-orders/mobile-pos/bootstrap` endpoint on the dead-weight review's say-so: Mobile POS was just re-integrated and that claim predates the work; verify against current frontend first.

### 6.5 Data-isolation helper modules (Effort: S — after §4.1 lands)
`data-isolation`, `data-isolation-issues`, `data-isolation-tests` (~207 LOC) exist to detect after-the-fact what should be enforced at query time. Once the findOne refactor + isolation tests are in, keep the test helper, delete the other two, and replace with a lint rule (flag `findOne` without an `AuthUser` parameter).

### 6.6 Misplaced spec files (Effort: S)
`backend/src/modules/procurement-statements.isolation.spec.ts` and `reports-exports.isolation.spec.ts` sit at the modules root. Move into their module folders; confirm jest's testMatch actually picks them up (if it doesn't, they're silently not running — which would be the real bug).

---

## 7. The 90-day plan

**Weeks 1–2 — Safety. Nothing else ships until these do.**
1. **findOne IDOR sweep** (§4.1): fix `loan-repayment-schedules` day 1; then the mechanical 109-method refactor, money-touching modules first (receivables, payables-adjacent, customer-credit-profiles, construction, fuel). Template exists in the 128 fixed modules.
2. **ITMB-006** refresh rotation, **ITMB-013** disposal JE, **ITMB-019** payroll effective-dating, **proforma conversion** fix (copy quotations), **ITMB-046** credit limit, **ITMB-052** BI scoping, financial-statements `deletedAt` one-liner.
3. Quick wins same sprint: `frontend/src/middleware.ts` (ITMB-077), cookie Max-Age (075/076), `.env.staging.example`, placeholder secrets, root clutter purge (§6.2).
4. Start the **ITMB reconciliation pass** (§2) — it's the merge gate for this branch.

**Month 1 — Lock it in.**
5. Isolation + financial-invariant tests for the 6 zero-spec modules (§3.1); apply the existing isolation-spec pattern.
6. CI teeth: spec-existence gate for high-risk modules, coverage flags + baseline thresholds (§3.2). Delete or replace the fake e2e job (§6.3).
7. Document-numbering migration for the 5 vulnerable modules + a concurrency test (50 parallel creates, assert unique).
8. ITMB-022 attribution unification; room-booking overlap; Redis-backed login throttle + 2FA lockout.
9. Graceful shutdown (§5.1). Sales-order N+1 fix (§3.3). Composite indexes (§3.6). Audit-log retention job (§5.3).

**Months 2–3 — Leverage.**
10. `api-types.ts` + enum/status-color extraction (§6.1) — migrate the 10 largest pages.
11. TanStack Query data layer (§5.2) + error-recovery UX, same 10 pages; standardize loading/error/permission states with the components that already exist in `frontend/src/components/ui`.
12. Dashboard caching + query batching (§3.4).
13. Soft-delete partial unique indexes, staged per table (§4.8). TaxRate relation fix.
14. Frontend test baseline (§5.5): hooks + Mobile POS + trial-balance/SO pages.
15. Observability: Sentry + slow-query logging (§5.4).

**Explicitly do NOT do in this window:** the 268→220 module consolidation (approvals/dashboards/agriculture), Postgres RLS or schema-per-tenant, the Prisma 6 upgrade, the SO/PO wizard rewrite, and the `@Audited`/`@Transactional` decorator infrastructure. All are reasonable Q4 ideas; all are distractions while criticals are open and tests don't exist. Also: stop trusting ITMB comment markers as fix status — the reconciliation pass replaces them.

---

## 8. What's genuinely good

- **All 3 critical audit findings are actually fixed**, with proper patterns: dual-company assertions in intercompany posting, server-side total recomputation in restaurant/sales orders, strict integer-cent balance validation in audit-adjustments (`audit-adjustments.service.ts:148-167`).
- **`CompanyScopeService`** (`backend/src/common/services/company-scope.service.ts`) is well-designed, well-tested (14 specs), and already adopted by ~128 modules — the IDOR fix is a fill-in, not an invention.
- **`EntityCodeGeneratorService`** — genuinely race-safe atomic numbering, adopted by 34 services with sequence backfill support.
- **SSRF protection in integration-connections is better than the audit claimed** — DNS resolution, private/metadata IP rejection, `redirect:'error'` (`integration-connections.service.ts:365-429`).
- **Env validation** (`backend/src/config/env.validation.ts:182-188`) refuses forbidden default secrets in production. Production logger gating is correctly implemented (`main.ts:14-18`).
- **Schema monetary discipline:** 354 Decimal fields with explicit precision; soft-delete middleware protects parent financial records from hard deletion.
- **`frontend/src/lib/api-client.ts` is properly tested** (8 tests: CSRF injection, 401 refresh-retry, envelope unwrapping) — the right foundation for the data layer.
- **The Mobile POS integration** shipped with idempotency guards *and* regression tests for them — the only recent feature that landed with its own tests. That's the standard to hold everything else to.
