# ITEMBA-R — Production Bug Audit (2026-05-15)

Triggered by: live deployment at `app.itembagrouptz.com` exhibiting issues immediately after going live.

Scope: read-only review of backend (NestJS), frontend (Next.js 14), Prisma schema/migrations/seed, deployment artifacts (Docker, Caddy), and environment files. No code was modified.

Severity legend:
- **Critical** — service unavailable, data leak/corruption, auth bypass, or breaks the live deployment now.
- **High** — privilege escalation, audit/forensics gap, money precision, or will break on next operator action.
- **Medium** — logic/precision/UX bugs, latent footguns.
- **Low** — hygiene, defense-in-depth.

---

## 1. Top 10 most likely causes of "troubles right now on the live domain"

Ranked by probability of being what the user is hitting today:

1. **[Critical] `APP_URL` default falls back to `http://localhost:3009`** in password reset emails — every reset email currently sends a localhost link. `backend/src/modules/auth/password-reset.service.ts:175,182,195`. Add `APP_URL=https://app.itembagrouptz.com` to production env and pass it to the backend container.
2. **[Critical] `app.set('trust proxy', 1)` is never called.** Behind Caddy, every request appears to come from the same Docker bridge IP, so the global throttler (100 req/min) rate-limits ALL users as one IP. First user logs in, everyone else gets 429. `backend/src/main.ts`.
3. **[Critical] Frontend middleware file is named `proxy.ts` instead of `middleware.ts`** — Next.js requires the literal filename `middleware.ts` in `src/`. As-is, no auth-redirect middleware runs at all; unauthenticated users hitting `/dashboard` see whatever the page renders. `frontend/src/proxy.ts`.
4. **[Critical] PurchaseOrder global unique constraint** — the migration `per_company_unique_numbers` fixed 10 tables but missed `purchase_orders`. As soon as two companies issue the same PO number, the second `prisma.purchaseOrder.create()` throws `P2002`. `schema.prisma:3043`.
5. **[Critical] No soft-delete middleware on Prisma client.** 207 references to `deletedAt` across the schema, but `backend/src/prisma/prisma.service.ts` has no `$extends`. Every service has to remember `where: { deletedAt: null }`. Deleted employees show up in payroll dropdowns, deleted customers in receivables, etc.
6. **[High] `next.config.js` bakes `NEXT_PUBLIC_API_URL` at build time with a `localhost:3001` fallback.** If the build arg isn't passed, the production image silently ships a client bundle that calls localhost. `frontend/next.config.js:11-13`, `frontend/Dockerfile:12-19`.
7. **[High] `sameSite: 'strict'` on all auth cookies.** Users following a link from email (password reset, marketing) land on the app already "logged out" until they reload. CSRF cookie also missed on first navigation → all POSTs fail with 403. `frontend/src/app/api/auth/*/route.ts`.
8. **[High] CORS allow-list defaults to `http://localhost:3000`** if `CORS_ORIGIN` env is unset, and is marked `@IsOptional()` in the validator. Mis-configured deploys silently reject every browser request from `app.itembagrouptz.com`. `backend/src/main.ts:20`, `backend/src/config/env.validation.ts:36-38`.
9. **[High] `backend/.env.production.example` still points at the OLD domain `itemba-r.co.tz`.** Any operator who copies the backend example instead of the root will configure the wrong CORS origin / API URL.
10. **[High] Westsides quick-sale `SETTINGS_KEY = 'itemba.quickSale.settings.v1'` is global, not per-user.** On a shared device, User B sees User A's selected company/branch/cash-account. Their first sale fails with a permission error they can't explain. `frontend/src/app/(dashboard)/westsides/page.tsx`.

---

## 2. Deployment & domain configuration

### Critical / High

| # | Severity | File:line | Issue |
|---|---|---|---|
| 2.1 | Critical | `backend/src/modules/auth/password-reset.service.ts:175` | `APP_URL` defaults to `http://localhost:3009` in reset emails; not declared in any env example. |
| 2.2 | Critical | `backend/src/main.ts` (whole file) | `app.set('trust proxy', 1)` missing → throttler limits everyone as Caddy's container IP; audit logs record proxy IP. |
| 2.3 | High | `backend/src/main.ts:20`, `env.validation.ts:36` | `CORS_ORIGIN` optional with `localhost:3000` default. |
| 2.4 | High | `frontend/next.config.js:11-13` | `env:` block bakes `NEXT_PUBLIC_API_URL` at build time; runtime overrides ignored; fallback is localhost. |
| 2.5 | High | `frontend/Dockerfile:12-19` | Build args not validated non-empty before `npm run build`. |
| 2.6 | High | `backend/.env.production.example:58,59,67,69,83,125,126` | Still references `itemba-r.co.tz`, not `itembagrouptz.com`. |
| 2.7 | High | `deploy/caddy/Caddyfile` | Only `app.` and `api.` subdomains routed; bare apex `itembagrouptz.com` and `www.` return Caddy default 404. |
| 2.8 | High | `website/` (whole directory) | No Dockerfile and no `website:` service in `docker-compose.production.yml` — the marketing site isn't deployed at all. |
| 2.9 | High | `docker-compose.production.yml:173-181` | Frontend healthcheck hits `/login` (full SSR render) every 30s → CPU spikes can flip container "unhealthy" and Caddy depops it. |
| 2.10 | High | `frontend/src/app/api/auth/*/route.ts` (4 files) | All cookies use `sameSite: 'strict'`, no explicit `domain`. Breaks email-link nav and first POST. |
| 2.11 | High | `frontend/src/app/api/backend/[...path]/route.ts:90-94` | CSRF requires both cookie and header — combined with sameSite=strict, first POST after cross-site nav silently 403s. |

### Medium / Low

- `backend/src/main.ts:23` — `helmet()` used with defaults; default CSP + `Cross-Origin-Resource-Policy: same-origin` will block any future cross-origin asset embed.
- `backend/src/config/env.validation.ts` — does NOT validate `SMTP_*`, `REDIS_PASSWORD` (required by prod compose), `FRONTEND_URL`, `APP_URL`. Prod can boot with no email delivery and password resets logging the token to stdout.
- `frontend/src/lib/api-client.ts:1`, `frontend/src/lib/backend-url.ts:21` — both default to `http://localhost:3001/api/v1`.
- `docker-compose.production.yml:135-143` — backend healthcheck depends on `MonitoringService.getPublicHealth()` returning non-200 on hard failure; verify it doesn't return 200 with `status:'degraded'` when DB is down.
- `docker-compose.staging.yml` is missing env passthroughs that production has (BACKUP_*, STORAGE_*) — "works in staging, breaks in prod" lurking.
- `deploy/caddy/Caddyfile` healthcheck uses `caddy validate` (syntax only) — won't detect stuck ACME or unreachable upstreams. Use `wget http://localhost:2019/config/`.
- `database/seeds/seed.ts:2359` seeds health URLs as `http://localhost:3001/health`.

---

## 3. Authentication & sessions (backend + frontend)

### Critical

- **3.1 Refresh-token pepper required but never used.** `REFRESH_TOKEN_PEPPER` is in `env.validation.ts:68,115` as required for prod, but `auth.service.ts:490` calls `argon2.hash(refreshToken, { timeCost: 2 })` with no `secret:` option. False sense of defense-in-depth.

### High

- **3.2 Argon2 `timeCost: 2`** for refresh tokens is dangerously low. `backend/src/modules/auth/auth.service.ts:40`.
- **3.3 O(N) argon2 verification on every refresh.** `auth.service.ts:305-315, 248, 439` — loops `argon2.verify` over every active refresh token for the user. A user logged in across multiple tabs can DoS the worker. Also under load this is the most likely cause of a "logged out randomly" symptom because the work timeout fires before verification completes.
- **3.4 Logout silently succeeds when refreshToken missing.** `auth.controller.ts:79-90` — `if (rawToken && user)` means clients that forget the body get `200 OK` with NO revocation. Sessions remain valid up to the refresh-token expiry.
- **3.5 Logout cookie path mismatch.** The `itemba_refresh` cookie is path-scoped to `/api/auth/refresh`, so the browser does NOT send it to `/api/auth/logout`. As a result, even when the user logs out the backend never revokes the refresh token.
- **3.6 Per-IP only login throttle.** No per-email lockout for distributed brute-force; failed logins on non-existent emails don't increment any counter. `auth.controller.ts:53`, `auth.service.ts:130-143`.
- **3.7 2FA setup endpoint has no throttle and no RecentAuthGuard.** Stolen access token → attacker can overwrite the victim's 2FA secret. `auth.controller.ts:146-150`, `two-factor.service.ts:40-44`.
- **3.8 No throttle on `/auth/refresh`** — combined with O(N) argon2 verify, easy DoS.
- **3.9 Password reset O(N) argon2 over all active tokens.** `password-reset.service.ts:81-91` — fetches every active reset row in the system, verifies each.
- **3.10 Password length inconsistency.** Reset DTO requires 8 chars, login DTO accepts 6, register requires 8. A user with a legacy 6-char password is told their new 6-char password is too short during reset.
- **3.11 silentRefresh timer stacking.** `frontend/src/contexts/auth-context.tsx` — schedules a 14-min refresh but doesn't always clear the prior timer on token rotation. After a few hours of active use, multiple parallel refresh calls hit the reuse-detection logic and force a logout.
- **3.12 Dashboard 401-handler races silentRefresh.** Two refreshes in flight at once → backend reuse detection → forced logout.

### Medium

- 3.13 `auth.service.issueTokens` deletes expired tokens on every issuance (should be a periodic cron).
- 3.14 `JwtStrategy.validate` makes two DB queries per request (60s cache mitigates).
- 3.15 `JOB_WORKER_ENABLED` defaults to `false`. If misconfigured in prod, queued jobs silently accumulate.

---

## 4. Authorization / RBAC / tenant isolation

### Critical — direct cross-tenant data leaks

| # | File:line | Issue |
|---|---|---|
| 4.1 | `mobile-sessions.service.ts:64-83` | `revoke(id, user.id)` does not verify the session belongs to the actor's company → any user with `mobile_sessions.revoke` can revoke any user's session. |
| 4.2 | `mobile-sessions.service.ts:55-62` | `findOne(id)` returns any session without scope check. |
| 4.3 | `audit-logs.controller.ts:17-86` | `findAll/findByEntity/findByUser/findSensitive/getEntityTypes/getSummary/findOne` — none accept or use the current user for company scoping. Company A admin reads Company B's audit trail. |
| 4.4 | `tenants.service.ts:36-58` | `findOne/update/remove/create` don't check company scope; `dto.companyId` accepted as-is. |
| 4.5 | `bank-reconciliations.service.ts:60-106` | No `CompanyScopeService` injected at all; `findOne/create/update/addLine` all unprotected. |
| 4.6 | `backup-jobs.controller.ts:24-31` + `service.ts:53-81` | `@Body() dto: any`, no scope check, accepts arbitrary `storageConfigEncrypted` as plaintext. |

### High — partial gaps

- 4.7 `generated-documents.controller.ts:28-32` — `findOne` takes no user, service doesn't scope.
- 4.8 `support-tickets.service.ts:75-108` — `findOne`/`update` cross-company; `dto.companyId` reassignment unchecked.
- 4.9 `companies.service.ts:127-152` — `create/update/remove` write NO audit logs. Company is the most sensitive root entity.
- 4.10 `bank-accounts.service.ts:52-73` — `findOne` only checks `assertGroupScoped` (gate the role) but not the user's accessible groups; cross-group bank-account read possible.
- 4.11 `bank-accounts.service.ts:98,124` — `update/remove` skip `findOne(id, user)` (no user passed) → audit log of view missed.
- 4.12 `applyCompanyScopeWhere` returns `{}` for group-scoped users when no `companyId` supplied (`company-scope.service.ts:72-87`). Group-scoped user from Group A querying loans sees loans from ALL groups. The schema's `Company.groupId` is never used as a filter.
- 4.13 **68 controllers use `@Body() dto: any`** — bypasses the global ValidationPipe (`whitelist: true, forbidNonWhitelisted: true`). Clients can include arbitrary fields (including `companyId`) that pass straight into `prisma.*.create({ data: { ...dto } })`. Worst offenders: `bank-reconciliations`, `backup-jobs`, `security-policies`, `integration-api`, `active-sessions`.
- 4.14 `mobile-sessions.findAll` accepts arbitrary `userId` filter without checking actor's relationship.
- 4.15 Documents `findByEntity` omits the companyId filter when `accessibleCompanyIds === null` (group-scoped).
- 4.16 Companies `findAll` allows group-scoped users to enumerate all groups' companies.
- 4.17 Two stranded isolation specs at `backend/src/modules/procurement-statements.isolation.spec.ts` and `reports-exports.isolation.spec.ts` indicate the team has *already* hit isolation bugs in those modules; re-audit `procurement`, `supplier-quotations`, `three-way-matching`, `data-exports`, `report-runs`, `saved-report-views`.

---

## 5. Money & finance correctness

### Critical

- **5.1 `parseFloat()` on Decimal columns across Loans / Debts / Contracts / FixedAssets.** Money fields converted through JS `number` (15-17 sig figs) lose precision for TZS totals >14 digits.
  - `loans.service.ts:122-129, 169-175, 217-220, 232`
  - `debts.service.ts:81-82, 109-110`
  - `contracts.service.ts:117, 151`
  - `fixed-assets.service.ts:118-122, 153-157, 200`
- **5.2 `Number(existing.outstandingAmount); newOutstanding = Math.round((outstanding - dto.amount) * 100) / 100;`** in `payables.service.ts:141-150` — JS float math on money.

### High

- **5.3 Race conditions on payment recording — no SELECT FOR UPDATE.**
  - `payables.service.ts:137-173` — not even wrapped in a transaction.
  - `hospitality-payments.service.ts:26-61` — in a transaction but uses `findUniqueOrThrow` (no row lock).
  - `parking-payments.service.ts:30-58` — same.
  - `loans.service.ts:203-247` — `recordRepayment` reads loan, creates repayment, updates outstandingBalance in three separate queries, no lock.
  Two concurrent payments can both read the old `outstandingAmount` and both write back → balance double-credited.
- **5.4 Tax calculator uses `Math.round(x*100)/100`** — `tax-calculator.service.ts:150-152`.
- **5.5 Bank reconciliation tolerance check uses `Number(line.creditAmount)`** — `bank-reconciliations.service.ts:141-174`.

### Medium

- 5.6 `customer-statements.service.ts:58-64` aggregates via JS `+=` on Decimal-as-Number.
- 5.7 Hospitality/parking payments don't validate `dto.amount > 0`; a negative payment can *increase* outstanding.
- 5.8 Loans `recordRepayment` writes repayment + balance update outside a single transaction — partial failure leaves loan inconsistent.

---

## 6. Prisma schema, migrations, indexes

### Critical

- **6.1 PurchaseOrder global `@unique` not converted to per-company** (see top-10 #4). `schema.prisma:3043`.
- **6.2 ~80 other business-number fields are still globally `@unique`** when they should be per-company. Most impactful in the operator workflow:
  `FuelShift.shiftNumber`, `FuelTankDip.dipNumber`, `FuelCreditSale.creditSaleNumber`, `FuelDelivery.deliveryNumber`, `FuelDailyReconciliation.reconciliationNumber`, `ProductBatch.batchNumber`, `StockDamage.damageNumber`, `Quotation.quotationNumber`, `ProformaInvoice.proformaNumber`, `DeliveryNote.deliveryNoteNumber`, `ApprovalRequest.approvalRequestNumber`, `AlertEvent.alertEventNumber`, `Task.taskNumber`, `PurchaseRequisition.requisitionNumber`, `RequestForQuotation.rfqNumber`, `GoodsReceivedNote.grnNumber`, `SupplierInvoice.supplierInvoiceNumber`, `LaunchBlocker.blockerNumber`, `SupportTicket.ticketNumber`.
- **6.3 No global Prisma soft-delete extension.** 279 of 662 backend files reference `deletedAt`, but `backend/src/prisma/prisma.service.ts` has no `$extends`. Many services likely return deleted rows.
- **6.4 Seed default admin password** — `database/seeds/seed.ts:2187-2188` — `'ChangeMe!123'` is the hardcoded fallback when `SEED_ADMIN_PASSWORD` is unset. The most recent commit shows the seed IS run in production. Trivial admin takeover risk.
- **6.5 Seed admin user has `mustChangePassword` defaulting to `false`.** `seed.ts:2191-2200`.

### High

- 6.6 Migration `20260430144135_w1_pos_removal_sales_order_enrichment` makes `sales_commissions.salesOrderId` NOT NULL — pre-existing NULLs would fail the deploy.
- 6.7 Migration `20260424181132_contracts_registry_v2` drops enum values `LEASE`/`LOAN` from `ContractType` — fails if rows still hold those values.
- 6.8 `attendance_records` (`schema.prisma:7376`) has no index on `(employeeId)` or `(attendanceDate)` — payroll full-scans monthly.
- 6.9 `employee_assignments` (`schema.prisma:7253`) has **zero indexes**.
- 6.10 Other HR/payroll tables missing tenant index: `LeaveType`, `AllowanceType`, `DeductionType`, `EmployeeAllowance`, `EmployeeDeduction`, `WorkShift`, `ShiftSchedule`, `PerformanceRecord`.
- 6.11 `Employee.nidaNumber` is indexed but NOT unique — two employees can share a national ID → duplicate statutory contributions.
- 6.12 117 relations omit explicit `onDelete` → default `Restrict` for required FKs. Result: deleting/replacing a User is effectively impossible because every `createdById` FK refuses. Likely cause of "we can't remove staff who left."
- 6.13 Audit-trail FKs (`createdById`) on Group Control records (BankAccount, Loan, Debt, Contract, FixedAsset) are nullable — operators can create a loan with no creator recorded.
- 6.14 `Document` typed FKs (`companyId`, `groupId`) use `SetNull` → deleting a company leaves orphan documents with no tenant scope.
- 6.15 `Loan.linkedAssetIds String[]` (`schema.prisma:1389`) — denormalised; no FK; deleting a FixedAsset leaves dangling IDs.
- 6.16 Seed `update:` clauses overwrite live production data on every re-run: `company.upsert.update`, `companyProfile.upsert.update`, `division.upsert.update`, `branch.upsert.update` (seed.ts:2063-2140).
- 6.17 Seed sections M5-M16 (`seed.ts:5292-6580`) contain demo employees with real-sounding names + salaries, fake license numbers — gate behind `SEED_DEMO_DATA=true` so they don't pollute prod.
- 6.18 No `connection_limit` / `pool_timeout` query params on `DATABASE_URL` in production compose. Backend + in-process job worker share Prisma default pool (vCPU × 2 + 1). Exhausts on small VPS.

### Medium

- 6.19 `DataExportLog` (PII) has no `@@index` at all.
- 6.20 `documents` lacks `(uploadedById, createdAt)` index.
- 6.21 Schema generator output is `../../backend/node_modules/.prisma/client` — brittle cross-package path coupling.

---

## 7. Frontend bugs (Next.js / React)

### Critical

- **7.1 Middleware filename `proxy.ts` instead of `middleware.ts`** — Next.js requires the literal name in `src/`. As-is the auth-gate redirect never runs. `frontend/src/proxy.ts` should be renamed and re-exported.
- **7.2 Westsides quick-sale `SETTINGS_KEY` global localStorage key** — `frontend/src/app/(dashboard)/westsides/page.tsx`. User B sees User A's company/branch/cash-account on shared devices, then gets a 403 they can't interpret.

### High

- 7.3 Login page `?from=` redirect target is dropped — users coming from a deep link land on `/dashboard` instead of where they were going. `frontend/src/app/(auth)/login/page.tsx`.
- 7.4 `silentRefresh` doesn't reliably clear the previous timer on rotation → stacking refreshes after hours of use → backend reuse-detection → forced logout. `frontend/src/contexts/auth-context.tsx`.
- 7.5 Dashboard 401-handler races `silentRefresh` (same symptom as 7.4).
- 7.6 Logout cookie path issue means the refresh token is never sent on `/api/auth/logout` → backend session never revoked even when the user "logged out."
- 7.7 No `loading.tsx` / `error.tsx` for major route groups → users see blank pages on any backend hiccup.
- 7.8 `package.json` declares React 18 with Next 16; Next 16 expects React 19+. Hydration quirks and `'use client'` boundary oddities are consistent with this.

### Medium

- 7.9 7 logistics pages still reference `localStorage('accessToken')` for DELETE requests (dead code — the proxy adds the header anyway, but a future contributor may build on it).
- 7.10 `<img>` paths assume `/brand/itemba-group-logo.png`; the favicon commit messages claim a favicon was added but no file exists in `public/brand/`. Verify.
- 7.11 139 places use `toLocaleDateString()` / `toLocaleString()` with no locale or timezone — server SSR (UTC) differs from client (Africa/Dar_es_Salaam UTC+3) → hydration mismatches and wrong-day display near midnight UTC+3.
- 7.12 `isOverdue` / `daysToExpiry` computed client-side with `Date.now()` — same TZ bug surface.
- 7.13 No `visibilitychange` listener for stale-data refresh.
- 7.14 Unused `js-cookie` dependency in `package.json:23`.
- 7.15 `eslint.config.cjs` disables `react-hooks/purity` and `react-hooks/set-state-in-effect` rules — real footguns ungated.

---

## 8. Input validation, file uploads, error handling

### High

- 8.1 Documents upload has **no MIME validation** — `documents.controller.ts:39-46`. Only a 50MB size cap.
- 8.2 Documents inline download (`?inline=1`) echoes user-supplied `mimeType` and uses `Content-Disposition: inline` — a user can upload an HTML file and serve it via the API for stored XSS on the same origin. `documents.controller.ts:97-111`.
- 8.3 Upload destination is `os.tmpdir()`; no cleanup on failure → file accumulation. `documents.controller.ts:41`.
- 8.4 Many list endpoints accept `@Query() query: any` and pass raw strings to Prisma `where`.

### Medium

- 8.5 `readFileBuffer` and `createFromBuffer` use sync FS calls — blocks the event loop on 50 MB files. `documents.service.ts:147, 322`.
- 8.6 `HttpExceptionFilter` returns `exception.message` for non-HttpException errors directly to clients (leaks Prisma error text including schema names). `http-exception.filter.ts:34-36`.
- 8.7 `LoggingInterceptor` never logs error paths — 4xx requests are invisible in HTTP logs. `logging.interceptor.ts:14-19`.
- 8.8 PDF logo extraction may fetch arbitrary URL paths via `documents.readFileBuffer(documentId, user)` — `generated-documents.service.ts:632-637`. Permission gate exists; existence leak via thrown vs caught.

---

## 9. Background jobs

- 9.1 [Medium] `STALE_AFTER_MS = 5 * 60_000` — long backup-runs (>5 min) get reclaimed mid-execution and re-queued, causing duplicates. `job-worker.service.ts:11`.
- 9.2 [Medium] Retried jobs re-execute handlers with no idempotency lock on payload IDs. Non-idempotent handlers cause duplicate side effects. `job-worker.service.ts:282-348`.
- 9.3 [Medium] `markRelatedWorkFailed` swallows failures (`.catch(() => undefined)`) — stuck "in progress" exports forever.

---

## 10. Date / timezone

- 10.1 Many "overdue" / "expiring" checks use raw `new Date()` against DB dates (e.g. `loans.service.ts:395-409, 424-428`) — UTC comparison vs. Tanzanian business-day → loans show as overdue between 00:00–03:00 UTC.
- 10.2 `parseDuration()` (`auth.service.ts:522-529`) handles only `[smhd]`; `1w`/`1mo` silently returns the default 7 days. Should warn.

---

## 11. Secret / log leakage

- 11.1 [Medium] `password-reset.service.ts:179-184` logs the **full reset URL with token** when SMTP is unconfigured. In prod where SMTP wiring is wrong, reset tokens leak to log streams.
- 11.2 [Low] API key auth uses unsalted SHA-256 (`api-key-auth.guard.ts:42`). Switch to HMAC with server pepper.

---

## 12. Hygiene

- 12.1 `auth.service.ts: AuthUser` interface doesn't match what `JwtStrategy.validate` actually returns (`sid` field type drift).
- 12.2 CORS `credentials: true` set but app uses Bearer JWT (no cookies) — either remove or document.
- 12.3 `permissions: []` and `roleScopes: []` synthesized for API-key requests means **no API-key request can hit any `@RequirePermissions` endpoint** unless it uses `@RequireApiScope` — undocumented.
- 12.4 `TenantsController` double-applies `JwtAuthGuard` and `PermissionsGuard` (already global).
- 12.5 Two `.spec.ts` files stranded at `backend/src/modules/*.isolation.spec.ts` (`procurement-statements`, `reports-exports`) — wrong directory level; Jest picks them up; signal of prior isolation incidents.

---

## Suggested fix order (impact × effort)

**Now (hours, not days):**
1. Set `APP_URL=https://app.itembagrouptz.com` in prod env; pass to backend container. (2.1)
2. Add `app.set('trust proxy', 1)` in `main.ts`. (2.2)
3. Rename `frontend/src/proxy.ts` → `frontend/src/middleware.ts`. (7.1)
4. Add a per-company unique index on `purchase_orders` and write the migration. (6.1)
5. Add `?connection_limit=20&pool_timeout=30` to production `DATABASE_URL`. (6.18)
6. Switch all auth cookies to `sameSite: 'lax'`. (2.10)
7. Fix logout cookie path so backend revokes refresh tokens. (7.6)
8. Delete or rewrite `backend/.env.production.example` to remove `itemba-r.co.tz`. (2.6)
9. Expand `CORS_ORIGIN` to include website hosts; drop `@IsOptional()`. (2.3)
10. Add `website:` Dockerfile + compose service + Caddyfile entry. (2.7/2.8)

**This week:**
11. Soft-delete Prisma extension (one place, fixes 50+ services). (6.3)
12. Convert the remaining ~80 global `@unique` business-number fields to per-company. (6.2)
13. Fix cross-tenant data leaks in `audit-logs`, `tenants`, `bank-reconciliations`, `mobile-sessions`, `support-tickets`, `generated-documents`, `backup-jobs`. (4.1–4.9)
14. Wrap all payment recording in `prisma.$transaction` with `SELECT FOR UPDATE`. (5.3)
15. Replace `parseFloat`/`Number` on Decimal columns with `Prisma.Decimal` or string passthrough. (5.1/5.2)
16. Wire `REFRESH_TOKEN_PEPPER` into argon2 and switch to indexed HMAC lookup to remove O(N) verify loops. (3.1/3.3)
17. Type the 68 `@Body() dto: any` controllers. (4.13)

**Hardening:**
18. MIME validation + safe inline download for `documents`. (8.1/8.2)
19. Per-email login throttle + RecentAuthGuard on `/2fa/setup`. (3.6/3.7)
20. Tighten `env.validation.ts` for `SMTP_*`, `APP_URL`, `FRONTEND_URL`, `REDIS_PASSWORD`. (env safety)
21. Replace frontend healthcheck `/login` with a dedicated `/api/health` route. (2.9)
22. Gate seed M5-M16 demo data behind `SEED_DEMO_DATA=true`. (6.17)
23. Make seed admin require `SEED_ADMIN_PASSWORD` in prod, set `mustChangePassword: true`. (6.4/6.5)
24. Add indexes on `attendance_records`, `employee_assignments`, `data_export_logs`. (6.8/6.9/6.19)
25. Address `silentRefresh` timer-stacking + dashboard 401 race. (7.4/7.5)

---

## Appendix — Key file paths

Backend:
- `backend/src/main.ts`
- `backend/src/config/env.validation.ts`
- `backend/src/modules/auth/{auth.controller.ts, auth.service.ts, password-reset.service.ts, two-factor.service.ts, strategies/jwt.strategy.ts}`
- `backend/src/modules/audit-logs/audit-logs.controller.ts`
- `backend/src/modules/tenants/tenants.service.ts`
- `backend/src/modules/bank-reconciliations/bank-reconciliations.service.ts`
- `backend/src/modules/bank-accounts/bank-accounts.service.ts`
- `backend/src/modules/mobile-sessions/mobile-sessions.service.ts`
- `backend/src/modules/backup-jobs/backup-jobs.service.ts`
- `backend/src/modules/payables/payables.service.ts`
- `backend/src/modules/loans/loans.service.ts`
- `backend/src/modules/documents/{documents.controller.ts, documents.service.ts}`
- `backend/src/modules/job-worker/job-worker.service.ts`
- `backend/src/common/services/company-scope.service.ts`
- `backend/src/common/filters/http-exception.filter.ts`
- `backend/src/prisma/prisma.service.ts`

Frontend:
- `frontend/next.config.js`
- `frontend/Dockerfile`
- `frontend/src/proxy.ts` ← should be `middleware.ts`
- `frontend/src/contexts/auth-context.tsx`
- `frontend/src/app/api/auth/{login,logout,refresh,register}/route.ts`
- `frontend/src/app/api/backend/[...path]/route.ts`
- `frontend/src/app/(auth)/login/page.tsx`
- `frontend/src/app/(dashboard)/westsides/page.tsx`
- `frontend/src/lib/{api-client.ts, backend-url.ts}`

Database & deploy:
- `database/prisma/schema.prisma`
- `database/prisma/migrations/20260429120000_per_company_unique_numbers/migration.sql`
- `database/seeds/seed.ts`
- `docker-compose.production.yml`
- `docker-compose.staging.yml`
- `deploy/caddy/Caddyfile`
- `backend/.env.production.example` (still references old domain)
- `.env.production.example`
