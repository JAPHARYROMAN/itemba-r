# ITEMBA-R Top-Down Code Audit Report

**Date:** 2026-05-01
**Auditor:** Claude (deep-read static audit)
**Scope:** Full codebase — backend (NestJS, 263 modules), frontend (Next.js 14, ~290 routes), Prisma schema (311 models / 14,173 lines), database migrations, deployment, CI, tests, and operational tooling.
**Inputs:** ~1,413 backend TS files, ~441 frontend TS/TSX files, 51 Prisma migrations, 18 unit specs.
**Method:** Direct read of bootstrap, common layer (guards, interceptors, decorators, services), auth module, schema head/key models, sampled domain services across finance, sales, inventory, payroll, fuel, customers, banking; frontend middleware, auth context, API proxy; CI workflow; production compose; Dockerfile.

This report is intentionally **frank**. It supersedes the optimistic 2026-04-27 report, which examined build status only and missed almost every issue listed here. The previous report stating "🟢 production-ready" is **incorrect** — there are several critical, exploitable issues that would fail any serious enterprise security review.

---

## Table of Contents

1. Executive Summary & Verdict
2. What ITEMBA-R Is Trying to Achieve
3. Severity-Ranked Bug Catalogue (104 findings)
4. Systemic / Architectural Issues
5. ERP Capability Gap vs Top-Tier Platforms (NetSuite, SAP B1, Odoo, Oracle Fusion)
6. Strengths Worth Preserving
7. Prioritized Remediation Roadmap

---

## 1. Executive Summary & Verdict

ITEMBA-R is an **ambitious, very large** Group ERP scaffold. The breadth — 263 backend modules, 311 Prisma models, ~290 frontend pages covering finance, procurement, inventory, fuel retail, POS, logistics, agriculture, construction, rental, parking, hospitality, HR/payroll, tax, compliance, approvals, BI, integrations, mobile sync, security, QA, training, and launch — is exceptional for a scratch build. Naming conventions are consistent, the milestone structure is disciplined, and several deep concerns (refresh-token family rotation, accounting period locks, sensitive-access interceptor, two-stage 2FA challenge tokens, encrypted TOTP secrets at rest) show real engineering thought.

**However**, the platform is *not* production-ready. The most damaging finding is that **the company-isolation pattern is enforced consistently for only ~14 of ~263 modules** (the Group Control records: bank-accounts, loans, debts, contracts, fixed-assets, plus a handful of payable/receivable services). The remaining ~249 modules — including high-value flows like customers, sales orders, journal entries, inventory movements, payroll, fuel shifts, invoices, GRNs, POs — accept `companyId` as a query/body parameter and apply it as a *filter*, not as an *enforcement boundary*. Any authenticated user who knows another company's id can read or mutate that company's data through the public API. This is a **critical, exploitable cross-tenant data leak / IDOR class bug** that affects the majority of the system.

Other show-stoppers:

- **CSRF protection is absent** on the Next.js → backend proxy, which forwards an httpOnly cookie as a Bearer token without an anti-forgery token. SameSite=lax is the only mitigation.
- **Login and register endpoints are not separately throttled.** They rely on the global 100/min limit, which permits credential stuffing across many accounts.
- **Inventory balance updates have a read-modify-write race.** Concurrent POS sales / fuel pumps will corrupt stock-on-hand and average cost.
- **Negative-stock guards are missing** entirely. Outbound movements can drive `quantityOnHand` below zero with no error.
- **Production docker-compose will fail to boot.** It does not set `TWO_FACTOR_ENCRYPTION_KEY` (required by env validation in production), does not run migrations on startup, and runs the backend as root.
- **Test coverage is 18 spec files** for 1,413 source files (~1.3% file coverage) — effectively zero. The earlier audit acknowledged this; no progress since.

These are addressable. The platform's architecture is sound enough that the fixes are mostly mechanical, not redesigns. But it is not "production-ready for supervised go-live" until at least the Critical and High items below are resolved.

**Verdict:**

> 🟠 **Beta / pre-pilot.** Excellent breadth and milestone discipline. Cross-tenant isolation, CSRF, inventory atomicity, auth throttling, and prod-compose are blockers. Estimate **3–5 weeks of focused remediation** to reach a defensible go-live state for the three Itemba Group companies, plus one more to harden against the ERP-grade gaps in Section 5.

---

## 2. What ITEMBA-R Is Trying to Achieve

The platform aspires to be a **single Group Digital Governance and Enterprise Management System** for the Itemba Group of Companies (Tanzania), unifying:

| Layer | Concern |
|---|---|
| **Group** | Strategic control — sensitive records (bank accounts, loans, debts, contracts, fixed assets, guarantees, licenses) owned by companies but accessed only by GROUP-scoped roles via a "Group Control layer". |
| **Company** | Legal entity scope (BRELA-registered): Mwanjalisi Oil, Itemba Enterprises, Westsides. Each is an independent accounting boundary. |
| **Division** | Functional pillar within a company — Petroleum, Logistics, Agriculture, Construction, Beverages, Hardware, Hospitality, Real Estate, etc. |
| **Branch / Site / Project / Farm / Warehouse / Fuel-Station** | Operational unit; the leaf level where transactions originate. |

Operationally it covers a complete double-entry chart of accounts, AR/AP, multi-currency, fuel-station shift accounting (tank dips, nozzle readings, variance), retail POS with batch/expiry, three-way procurement matching, MRP-lite for construction (BOQ, project material issues, progress billing), HR/payroll with Tanzania-specific statutory rules (PAYE, NSSF, WCF, SDL, OSHA, CCM disputes), tax filing engine, compliance obligations, approval workflow with maker-checker, alert engine, KPI/BI snapshots, integration providers / webhooks / API keys / mobile offline sync, security hardening with 2FA, backup/DR registries, period-close locks, and a full launch-readiness / QA / training / support / help-center stack.

It is, in scope, a **direct competitor to a mid-market NetSuite OneWorld or SAP Business One subscription** — narrower in some areas (no advanced consolidation eliminations, no MRP/BOM, no IFRS-16 lease accounting), broader in some operational ones (fuel retail, parking, hospitality folio in the same database).

The *intent* is to turn paper-based group governance into a single auditable digital system. The **execution covers the breadth but not the depth**: the schema and route layout are exhaustive, but the enforcement at the boundary (auth/tenancy/atomicity/precision) is uneven.

---

## 3. Severity-Ranked Bug Catalogue

Severity scale: **CRITICAL** = exploitable in production / data-corrupting; **HIGH** = direct security or correctness risk; **MEDIUM** = correctness or maintainability; **LOW** = cleanup. Paths are relative to repository root.

### 3.1 CRITICAL

**C-1. Cross-tenant data exposure across ~95% of business modules (IDOR / multi-tenancy bypass).**
*Location:* representative samples — `backend/src/modules/customers/customers.service.ts:16-58`, `backend/src/modules/customers/customers.controller.ts:24,30`, `backend/src/modules/journal-entries/journal-entries.service.ts:68-112`, `backend/src/modules/sales-orders/sales-orders.service.ts:49-118`, `backend/src/modules/inventory-movements/inventory-movements.service.ts:26-75`. The pattern is repeated across at least 96 services found by `grep "where.companyId = companyId"`.
*Issue:* `findAll(query)` accepts `companyId` from the query string and uses it as the only company filter. `findOne(id)` does no company check at all. There is no enforcement that the requested `companyId` is one the JWT user is allowed to access. A user from Company A can:
  - List Company B's customers/invoices/payroll/journals by sending `?companyId=<B>`.
  - Fetch Company B's records by ID directly (the IDOR is even easier: just change the URL).
  - Create records under Company B by setting `companyId` in the request body (the DTOs do not strip it).
*Why it matters:* This is *the* compliance-breaking issue for a multi-company group ERP — financials, payroll, customer PII, and contracts are leaking laterally. A user inside Mwanjalisi Oil can read Westsides' general ledger today.
*Fix:* Use the existing `CompanyScopeService` everywhere — it is already correctly used in 14 services (bank-accounts, loans, debts, etc.). Pattern:
  1. In every list/find/aggregate endpoint, always intersect the `where` clause with `await companyScope.companyWhereFor(user, requestedCompanyId)`.
  2. In every find-by-id endpoint, after `findFirst`, call `await companyScope.assertCanAccessCompany(user, record.companyId)` — fail with 404 (not 403, to prevent enumeration).
  3. In every create/update DTO, *strip* `companyId` server-side and resolve it from the user (or from the parent record on update). Never trust client-supplied `companyId`.
  4. Add a Nest `CompanyScopeInterceptor` that injects `accessibleCompanyIds` into every request and have services fail closed if the interceptor was bypassed.
  5. Backstop with Postgres Row Level Security (RLS) on `company_id` columns once the app side is correct, so any future regression is caught at the DB.

**C-2. The "safe" companyFilter helper is overridden by query parameter (silent bypass).**
*Location:* `backend/src/modules/hr/payroll-runs/payroll-runs.service.ts:21-31` and the same pattern elsewhere.
*Issue:*
```ts
const where: any = { deletedAt: null, ...this.companyFilter(user) }; // sets {companyId: user.companyId}
if (companyId) where.companyId = companyId; // unconditional override from query
```
The line that *looks* safe is silently overwritten by an attacker-controlled query param. Even modules that try to do the right thing get this wrong.
*Fix:* Compute the final `companyId` from the user first, then validate that any user-supplied `companyId` is a strict subset of the user's accessible set, then assign — never blind-overwrite.

**C-3. CSRF protection absent on the frontend → backend proxy.**
*Location:* `frontend/src/app/api/backend/[...path]/route.ts:1-46`.
*Issue:* The proxy reads `itemba_access` from an httpOnly cookie and forwards it as `Authorization: Bearer …` to the backend for any HTTP verb. Cookies are set with `sameSite: 'lax'`, which blocks cross-origin form POSTs but allows top-level navigation GETs and various subdomain attacks. There is no anti-CSRF token, no Origin/Referer check, no double-submit cookie. An attacker who can run JS on any same-site domain (XSS in any other app sharing the parent domain, a vulnerable subdomain, a careless SPA on the same eTLD+1) can trigger arbitrary state-changing requests.
*Fix:* Add a CSRF token (signed, per-session) returned at login and require it as `X-CSRF-Token` for non-GET requests in the proxy. Reject mismatches before forwarding. Verify Origin matches the configured allowlist. Tighten `sameSite` to `'strict'` for the access cookie.

**C-4. Inventory balance read-modify-write race.**
*Location:* `backend/src/modules/inventory-movements/inventory-movements.service.ts:152-202` (`applyMovementToBalance`).
*Issue:* The transaction reads `inventoryBalance` with `findFirst`, computes new quantities/costs in JS, then `update`s with the absolute value. Two concurrent movements on the same `(companyId, productId, locationId)` both see the same starting balance and the second's update overwrites the first's effect. There is no `SELECT … FOR UPDATE`, no Prisma `update({ data: { quantityOnHand: { increment: delta } } })` atomic counter, only a unique index that prevents *insert* races, not update races.
*Why it matters:* Highest-volume tables in the platform: POS sales (Westsides), fuel nozzle readings (Mwanjalisi). Concurrent transactions are the norm, not the exception. Stock-on-hand and average cost will drift, which then poisons COGS and inventory valuation in finance.
*Fix:* Replace with `db.inventoryBalance.upsert({ where: { companyId_productId_inventoryLocationId: ... }, create: ..., update: { quantityOnHand: { increment: delta }, lastMovementAt: ... } })`. For average-cost recompute, use `$executeRaw` with `UPDATE ... SET avg_cost = (total_value + new_in_value) / NULLIF(qty_on_hand + delta, 0) WHERE ...` inside the same transaction, or wrap in `SELECT … FOR UPDATE` first.

**C-5. Negative-stock check is missing.**
*Location:* `inventory-movements.service.ts:166-201`.
*Issue:* Outbound movements (`SALE`, `TRANSFER_OUT`, etc.) do not validate that on-hand ≥ requested quantity. `newQty = existing - movement.quantity` can go negative without an exception. Worse, when a balance row does not yet exist for a `(product, location)` pair and an outbound movement happens, line 188 sets `newQty = isInbound ? quantity : 0`, *records* the movement, and silently drops the negative effect — corrupted ledger.
*Fix:* Before applying the delta, compute the projected balance and throw `BadRequestException("Insufficient stock at <location> — requested X, available Y")`. Include `quantityReserved` in the calculation. For the unseen-balance case, throw `NotFoundException("No stock balance for product/location")` rather than creating a zero row.

**C-6. Production compose will fail to start: missing TWO_FACTOR_ENCRYPTION_KEY.**
*Location:* `docker-compose.production.yml:27-46` vs `backend/src/config/env.validation.ts:87-96`.
*Issue:* `env.validation.ts` makes `TWO_FACTOR_ENCRYPTION_KEY` *required* whenever `NODE_ENV=production` or `staging` and throws if it is missing. The production compose file does not declare this env var. The container will exit on boot with `Missing required production environment variables: TWO_FACTOR_ENCRYPTION_KEY`. Add to the compose env block: `TWO_FACTOR_ENCRYPTION_KEY: ${TWO_FACTOR_ENCRYPTION_KEY}` and document in `.env.example`. Same for `REFRESH_TOKEN_PEPPER` if it is required outside dev (currently optional).

**C-7. Production compose does not run migrations on startup.**
*Location:* `docker-compose.production.yml`.
*Issue:* The backend service does `node dist/main.js` (from the Dockerfile CMD) but never runs `prisma migrate deploy`. A fresh deploy or a release that adds a migration will start the API against a stale schema and produce runtime `column does not exist` errors.
*Fix:* Add a one-shot migration job: `command: sh -c "npx prisma migrate deploy --schema=/app/database/prisma/schema.prisma && node dist/main.js"`, or split into a separate `backend-migrate` service that the API depends on.

**C-8. Backend container runs as root.**
*Location:* `backend/Dockerfile:29-46` (no `USER` directive).
*Issue:* Standard Docker hardening expectation. Combined with `restart: unless-stopped`, an exploitable RCE in any dependency would give an attacker root inside the container plus access to the postgres network.
*Fix:* Add `RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app/backend && USER app`. Do the same in the frontend Dockerfile.

**C-9. Refresh-token cache is per-process.**
*Location:* `backend/src/modules/auth/strategies/jwt.strategy.ts:49,102`.
*Issue:* The 60-second `JwtStrategy.cache` is an in-memory `Map`. Behind two or more API replicas, a permission revocation, role change, or user disable on node A will not be reflected on node B until A's cached entry expires. The `invalidate()` method only clears the local map. For the ERP this means: revoking a fired employee's access takes up to 60 seconds and may not propagate at all if `invalidate()` is called on a different replica.
*Fix:* Move the cache to Redis (via `cache-manager`, which is already wired) keyed by `auth:user:${userId}`, with publish/subscribe invalidation across nodes; or short the TTL to 5 seconds and accept the extra DB load.

**C-10. Login endpoint is not separately throttled.**
*Location:* `backend/src/modules/auth/auth.controller.ts:49-55`.
*Issue:* `password-reset` and `2fa/challenge` have `@Throttle({ default: { ttl: 60000, limit: 5 } })`. `login` does not. The global `ThrottlerModule` allows 100 requests / 60 s — generous enough for credential stuffing across many accounts. Per-account lockout (5 fails → 15 min) only protects a *single* victim; an attacker rotating usernames is unaffected.
*Fix:* `@Throttle({ default: { ttl: 60000, limit: 10 } })` on `login` plus `@Throttle({ default: { ttl: 3600000, limit: 100 } })` on `register`. Better: a sliding-window IP throttle keyed by `ip + emailHash`.

**C-11. `register` endpoint has no throttle and no email verification.**
*Location:* `backend/src/modules/auth/auth.controller.ts:42-47`, `auth.service.ts:44-63`.
*Issue:* Registration creates a user with `status: 'ACTIVE'` and immediately issues access + refresh tokens. There is no email verification, no admin approval, no domain allowlist. An attacker can mass-register thousands of accounts. Even if no permissions are assigned, the audit log fills with junk and rate-limit budget is consumed.
*Fix:* Either remove the public register endpoint entirely (this is an internal Group platform — users should be provisioned by admins) or require `status: 'PENDING_VERIFICATION'`, send a verification email, and only issue tokens after verification.

### 3.2 HIGH

**H-1. Permissions cache TTL is 60 s, no cross-process invalidation.** Already covered in C-9 — flagged separately because revocation propagation on a single-node deploy is also too slow for a system with sensitive Group Control permissions.

**H-2. JWT `validate()` returns `null` instead of throwing on inactive users.** `backend/src/modules/auth/strategies/jwt.strategy.ts:79-82`. Passport interprets `null` as "no user", which most guards correctly reject; but it also clears the cache after the request, masking metrics. Throw `UnauthorizedException('Account is not active')` explicitly.

**H-3. `completeLogin2FA` accepts `twoFactorService: any`.** `auth.service.ts:153-157`. The signature suggests the author worked around a circular dependency. Loose typing has already let other bugs through (e.g. the `as any` casts on `audit.log` payload). Use `forwardRef(() => TwoFactorService)` and properly type.

**H-4. Sensitive-access interceptor only logs successes.** `backend/src/common/interceptors/sensitive-access.interceptor.ts:52-65`. `tap()` fires only on emitted values; failed attempts (403, 404, 500) are not audit-logged. An attacker probing the Group Control endpoints leaves no trace for unauthorized attempts. Use `tap({ next: ..., error: ... })` or wrap with `catchError` and log both branches.

**H-5. `logSecurityEvent` swallows errors silently.** `auth.service.ts:412-426` and `two-factor.service.ts:251-264`. If `securityEvent.create` fails, no Logger output is produced. Failed audit writes will be invisible. At minimum log via `Logger.error` and increment an error counter.

**H-6. AES-256-CBC for TOTP secrets without authentication.** `two-factor.service.ts:215-230`. CBC has no MAC; ciphertext tampering is not detected. Should use AES-256-GCM (authenticated) or AES-256-CBC + HMAC-SHA-256 (encrypt-then-MAC). Also: the IV is fine (random per encrypt) but there is no associated-data binding to userId — a copied ciphertext from one user could be pasted onto another.

**H-7. Account enumeration via login response timing.** `auth.service.ts:82-95`. When the user does not exist, `argon2.verify` is never called → fast response. When it does exist, argon2 runs (~50 ms+). The timing difference is measurable. Fix: always run a constant-time argon2 verify against a pre-computed dummy hash for missing users.

**H-8. Refresh handler reads token from Authorization header.** `auth.controller.ts:62-68`, `jwt-refresh.strategy.ts:19-29`. The refresh token is sent as a Bearer token in the same header used for access tokens. If the frontend ever stores access and refresh in the same place, or a logging proxy captures Authorization, both leak. The frontend correctly uses an httpOnly cookie scoped to `/api/auth/refresh`, so this is OK in practice — but the *backend* should also accept the refresh token from a body field or a path-scoped cookie, not the same header used for access.

**H-9. Logout body parsing trusts `req.body.refreshToken`.** `auth.controller.ts:74-83`. The handler tolerates `undefined` token (just returns success), so a stolen access token can call `/auth/logout` without revoking anything. Logout should always revoke based on the refresh-token cookie, not optionally on a body field.

**H-10. Refresh-token reuse-detection cleanup window is 24 h.** `auth.service.ts:382-392`. Tokens revoked >24 h ago are deleted, so replay >24 h after revocation will fail with "invalid token" rather than triggering family revocation. Acceptable trade-off, but keep revoked tokens for at least the refresh-token TTL (7 days) to ensure full window coverage.

**H-11. Journal-entry balance check uses JS number arithmetic.** `backend/src/modules/journal-entries/journal-entries.service.ts:25-50`. Decimals from the DTO are summed with `+=` (JS Number), then rounded to 2 dp. For a 1,000-line journal at 6+ significant digits this is fine in practice, but the *type signature* and the multi-line `Math.round(... * 100) / 100` papering over precision is fragile. Use `Decimal.js` or `bigint` cents.

**H-12. Sales-order line totals computed in JS Number.** `sales-orders.service.ts:17-36`. Same pattern as H-11. POS daily volumes (Westsides) on TZS amounts (large numerals) will exhibit cumulative error.

**H-13. Inventory cost arithmetic in JS Number.** `inventory-movements.service.ts:167-197`. Average-cost calc multiplies and divides with `Number(Decimal)` — precision loss across thousands of movements is observable and *poisons COGS*.

**H-14. Journal-entry `update`, `post`, `reverse`, `remove` use `findOne(id)` without company scope.** `journal-entries.service.ts:96-112,176-250,283-356,359-383`. Since `findOne` does not scope by company, an attacker with `journal-entries.update` permission for *their* company can update *any* company's draft journals.

**H-15. Customer profile (`customers.service.ts:profile`) does not assert the requesting user can see this customer's company.** A user from Company A calling `GET /customers/<B-customer-id>/profile` gets the full credit/order/payment 360° dump for Company B's customer.

**H-16. `customer.findOne` writes a `CUSTOMER_VIEW` audit log on every fetch.** `customers.service.ts:72-78`. Reasonable design choice but: (a) the log lacks `userId` (the controller does not pass it down), (b) over the AuditLog table this becomes a write-amplification vector — a list page that pre-fetches 50 details would create 50 AuditLog rows. Either drop view-logging for non-sensitive entities or attach `userId`.

**H-17. `findOne` patterns return 404 *and then* audit-log "view".** Several modules audit-log only after a successful read; a 404 leaves no record. For audit completeness, log read-attempts even on miss (with `entityId: id`, `entityType: 'X'`, `metadata: { result: 'not-found' }`).

**H-18. Mass-assignment risk: services spread `dto` directly into Prisma `data`.** Examples: `bank-accounts.service.ts:78-83`, `payroll-runs.service.ts:62-65,72-78`. If the DTO leaks an unwhitelisted field that happens to map to a Prisma column (e.g. `createdAt`, `id`, `companyId` on update), the user can override it. The global `ValidationPipe` is configured with `whitelist: true` and `forbidNonWhitelisted: true`, which mitigates this *if* every DTO declares every legal field — but several DTOs are loose (use `as any`, `as unknown as Record<string, unknown>`).

**H-19. `companyId` on update is not guarded across many services.** `customers.service.ts:138-158` excludes it (good); `payroll-runs.service.ts:72-78` spreads `...dto` (bad — caller can move payroll runs between companies). Make `companyId` immutable once set.

**H-20. Unbounded `findMany` calls.** Several aggregate / report services pull rows without `take`. Examples to scan and bound: `data-isolation` checks, several `*-dashboard.service.ts`, `audit-evidence-packs`. Any list endpoint that returns >1,000 rows is a DoS vector — paginate or stream.

**H-21. `documentNumberSequences` has race risk.** Quickly scanned — sequence generators frequently use a "find max + 1" pattern. `entity-code-generator.service.ts` is dispatched from many services; the implementation must use a Postgres SEQUENCE or `SELECT … FOR UPDATE` on the counter row. Verify and document.

**H-22. Prisma `onDelete: SetNull` on `User.companyId`.** `database/prisma/schema.prisma:821`. Deleting a Company would null out users' home company silently. The intended behavior is probably `Restrict` or a soft-delete pattern.

**H-23. `BankAccount` unique on `(bankName, accountNumber)` global.** `schema.prisma:1348`. This unique index is global, not company-scoped. If two Itemba companies legitimately hold accounts at different branches with the same number formatting, conflicts arise. Should be `@@unique([companyId, bankName, accountNumber])`.

**H-24. `JournalEntry.transactionDate` indexed but `(companyId, transactionDate)` is not the canonical index.** `schema.prisma:1956-1962`. The composite `(companyId, transactionDate, status)` exists ✅; verify the trial-balance / income-statement queries use it.

**H-25. No row-level history / versioning.** AuditLog captures `oldValue`/`newValue` JSON, but there is no `*_history` table for, e.g., bank account or contract amendments. NetSuite / SAP keep full version chains for compliance. For a Group Control-grade ERP, store immutable snapshots (`bank_account_versions`) so auditors can replay state at any past date.

**H-26. Frontend `silentRefresh` lacks single-flight de-duplication.** `frontend/src/contexts/auth-context.tsx:68-78`. If two route transitions both detect an expired access token and each calls `/api/auth/refresh`, the first rotation invalidates the second's refresh token → reuse detection → family revoked → user kicked to login. Wrap with a shared promise / AbortController.

**H-27. Frontend access-cookie expiry hard-coded to 15 min, refresh schedule 14 min.** `frontend/src/app/api/auth/login/route.ts:53`, `auth-context.tsx:72`. If `JWT_ACCESS_EXPIRES_IN` is changed in env, the cookie max-age and the silent refresh timer don't follow. Drive both from a `/auth/config` endpoint or a shared constant.

**H-28. Frontend backend proxy buffers entire request body in memory.** `frontend/src/app/api/backend/[...path]/route.ts:32`. `req.text()` blocks until full body is read. File uploads (the platform mentions `backend/uploads/`, GRN attachments, evidence packs, document templates) won't stream — they will OOM Node on large files. Either configure a `multipart/form-data` direct path or use `req.body` as a stream and pipe to upstream.

**H-29. No CI test gate.** `.github/workflows/ci.yml:108-109` uses `npm test --if-present -- --passWithNoTests`. With only 18 spec files and `--passWithNoTests`, anything red would still pass. Lift `--passWithNoTests` and require non-zero coverage before merging to `main`.

**H-30. No e2e test stage in CI.** Even contract tests against a live Postgres + the seed dataset would catch ~80% of the cross-tenant findings in this report. Spin up `services: postgres:16` in the workflow and run a small Jest e2e suite asserting that company A's user cannot read company B's data.

### 3.3 MEDIUM

**M-1. `as any` proliferation on `dto`, `user`, audit `metadata`.** Spot-checked >50 call sites. Loose typing is how H-14 / H-18 / H-19 slipped through. Tighten interfaces — Prisma types are already exported; the AuditLog DTO has a `metadata?: Json` field that should accept `Prisma.JsonObject`, not `any`.

**M-2. `payroll-runs.service.ts:21-24` types `user: any` and reads `user.role?.scope`.** The JWT payload has `roleScopes: string[]`; `role.scope` is a synthesized field. Use the typed `AuthUser`.

**M-3. Audit log `metadata: { ... } as any`** is repeated dozens of times. Define a typed `AuditMetadata` per action.

**M-4. `auditLogs.log` calls without `userId` exist in many services.** Examples: `customers.service.ts:72-78`. The audit row is anonymous. If the controller has the user, pass it.

**M-5. `errorBoundary` and global error reporting absent.** No Sentry, no OpenTelemetry exporter wired up. `error-logs/`, `system-metrics/`, `performance-traces/` are *database tables* tracking state but no actual telemetry pipeline emits to them at scale. The platform owns its observability database but doesn't fill it from the runtime.

**M-6. `backups`, `backup-jobs`, `backup-runs`, `restore-tests`, `disaster-recovery` modules are admin/registration UIs only.** They track "we plan to back up at 02:00" but do not invoke `pg_dump`, S3 sync, or anything else. Wire to a real cron + storage backend, or relabel as "backup tracking" so operators don't trust them as evidence of backups.

**M-7. `scheduled-reports`, `analytics-snapshot-runs` rely on what scheduler?** No `@nestjs/schedule`, no BullMQ in dependencies, no external cron in compose. These tables can be inserted into via API but nothing executes them.

**M-8. `cache-management` module appears to manage *cache entries* in Postgres** (`CacheEntry` model, schema:13265). That is a database table named "cache" — not Redis. If the intent is observability over the Redis cache, document that. If the intent is a cache via Postgres, drop it — Postgres is not a cache.

**M-9. `data-isolation`, `data-isolation-tests`, `data-isolation-issues` modules** exist and *test* the data-isolation pattern. Given the cross-tenant findings in C-1/C-2, either these tests do not actually check controller endpoints, or they are aspirational. Run them and fix until they pass.

**M-10. Pagination DTO inconsistency.** Some services accept `{page,limit}`, some `{skip,take}`, some accept both. Centralize a `PaginationDto` and make every list endpoint extend it.

**M-11. `findFirst` with `deletedAt: null` is the soft-delete pattern, but not enforced via Prisma middleware.** A future developer who writes `prisma.customer.findUnique({where:{id}})` will return soft-deleted rows. Add a Prisma middleware that injects `deletedAt: null` for finds, or migrate to native Postgres soft-delete views.

**M-12. `Receivable.status` and `SalesOrder.paymentStatus` are stringly typed via `as any`.** `customers.service.ts:220,226` casts strings to enum — Prisma already has the enum types; remove the cast.

**M-13. `SalesOrder.customerName` field referenced in search.** `sales-orders.service.ts:72`. If the column does not exist, this is a runtime error. If it does, it is denormalized data that must be kept in sync with `customer.name` — currently nothing keeps it consistent. Either drop the column or update on rename.

**M-14. The `AccountingControlService` is consulted for `assertPostingAllowed`, but only in `journal-entries`.** Other modules that ultimately produce GL effects (sales-orders, receivables, payroll-runs, fixed-asset depreciation, fuel reconciliation) should also gate on period-close locks and the AccountingLock table.

**M-15. Journal-entry reversal preserves the original `accountingPeriodId` of the source entry.** `journal-entries.service.ts:298-317`. If the original period is closed, reversal should post into the *current open* period, not re-open the closed one. Audit confirms `assertPostingAllowed` is called with `original.accountingPeriodId` — bug: that period may be closed.

**M-16. `Customer.creditLimit` enforced at *display* (Customer 360) but not at order creation.** A `SalesOrder` create flow that exceeds the credit limit should at least require approval. Couldn't find that gate in `sales-orders.service.ts`. Wire to the approval engine.

**M-17. Sales order does not reserve inventory on confirm.** `quantityReserved` exists on `InventoryBalance` (`schema:2737`) but no movement service writes to it. POS will oversell.

**M-18. Decimal precision — `quantityOnHand` is `Decimal(18, 4)` but `unitCost` and `averageCost` only `Decimal(18, 4)` — total value is `Decimal(18, 2)`.** Multiplying qty(4)*cost(4) loses 4 sig figs into 2 dp. For low-value high-volume items (loose hardware, small parts), rounding error per row > 1 cent. Use `Decimal(20, 6)` for working subtotals or settle with explicit ROUND() in arithmetic.

**M-19. `DocumentNumberSequence` race / generator fairness — schema model exists; verify implementation.** `schema:12972`. If the generator uses `MAX(number) + 1` it will collide under concurrency. Postgres has SEQUENCEs precisely for this.

**M-20. Frontend `permissions` check is `every` (AND).** `auth-context.tsx:109-115`. Any caller that meant "user must have at least one of these" silently fails. Add `hasAnyPermission` and `hasAllPermissions` and audit call sites.

**M-21. Frontend has only 2 test files.** `vitest` is wired up but barely used. For ~290 pages this is below diligence floor. Add a smoke suite that mounts each top-level route and asserts no error boundary fires.

**M-22. No i18n.** Tanzania context — Swahili support is on the known-limitations list. For a Group ERP serving local employees, English-only is a real adoption blocker. Plan to add `next-intl` or equivalent and wire all UI strings.

**M-23. No localized currency / date formatting.** Format helpers default to `Intl` with browser locale; the user's preferred locale (TZS amount, dd-mm-yyyy) is not configurable per company.

**M-24. No file storage abstraction.** Uploads go to local disk under `backend/uploads/`. No S3 / MinIO / Azure Blob driver. In Docker, this is ephemeral. For a Group ERP storing licenses, contracts, evidence packs, this is data loss waiting to happen. Pluggable storage with an S3 backend should be the default.

**M-25. No antivirus / mime-validation on uploads.** The platform stores user-supplied PDFs/images for legal documents and audit evidence. A user can upload an executable or a PDF with malicious JS. Add ClamAV or VirusTotal API + strict mime + extension + magic-byte check.

**M-26. Helmet defaults but no CSP customization.** `main.ts:23`. Default Helmet enables `contentSecurityPolicy` which will break any embedded asset (Prisma Studio? Swagger? user uploads?). Worth verifying once the frontend is wired through Helmet's CSP.

**M-27. CORS allowlist parsed from env, no wildcard handling.** `main.ts:25`. Users will eventually set `CORS_ORIGIN=*` and break SameSite. Validate that `*` is rejected when `credentials: true`.

**M-28. `ApiKey`/`ApiClient` flows: keys are presumably hashed. Verify.** `api-keys/`. If raw keys are stored plain, replace with HMAC or bcrypt-style hash with one-shot reveal at creation.

**M-29. `Webhook` endpoint signing.** `webhook-signature.service.ts` exists in `common/services`. Verify all outbound webhooks sign the body and consumers verify.

**M-30. `MobileSession` / `OfflineSyncBatch` / `OfflineSyncRecord` models exist** but the conflict-resolution UI and the record-level vector-clock approach aren't wired through to the controllers. Mobile sync is the kind of feature that is either rock-solid or causes data loss; status quo looks aspirational.

**M-31. Two `petroleum-dashboard` and `petroleum-reports` modules; HR has both `hr/dashboard` and `hr-dashboard` style.** Some consolidation would reduce module count and reduce app.module.ts size (currently 320+ imports). Target: <150 modules by merging dashboard/reports/feature triples into single modules.

**M-32. `app.module.ts` imports 320+ modules.** This is the largest file outside the schema. Module count fragmentation hurts cold-start, dependency discovery, IDE responsiveness. Consider feature-aggregating modules (e.g. `PetroleumModule` re-exports `FuelTanksModule`, `FuelPumpsModule`, ...).

**M-33. No Nest `Logger` wiring to JSON.** `main.ts:14` uses default Logger. In production logs should be structured JSON for ingestion (Loki, ELK, Datadog). Use `nestjs-pino` or similar.

**M-34. No request-id correlation.** `LoggingInterceptor` exists but a single `requestId` is not assigned and propagated; downstream audit log entries cannot be correlated to a specific HTTP call.

**M-35. `@Throttle({...})` is per-controller — global default is 100/min.** For 263 modules, the same default is too loose for read endpoints and too tight for some write endpoints (e.g. POS daily sync). Audit.

**M-36. Swagger is not behind auth.** `main.ts:44-53`. Mounted only when `NODE_ENV !== 'production'`. OK in production, but for staging it's exposed without auth — leaks endpoint surface. Gate with basic-auth or VPN.

**M-37. `process.env.THROTTLE_TTL` read at module-init time but `envValidate` does not validate it.** `app.module.ts:332-333`. A typo silently falls back to 60. Add to env.validation.

**M-38. `argon2.hash(refreshToken, { timeCost: 2 })`.** `auth.service.ts:32,365`. Comment says "speed-over-strength is fine". For refresh tokens stored as a hash, this is OK because the input is high-entropy. Document the threat model.

**M-39. `parseDuration` accepts `s/m/h/d` only.** `auth.service.ts:397-404`. If someone sets `JWT_REFRESH_EXPIRES_IN=2w`, it silently falls back to 7d. Validate.

**M-40. `AuditLog.metadata` and `oldValue`/`newValue` are unbounded JSON.** Snapshotting 5 MB rows blows up the audit table. Cap with `JSON.stringify(...).slice(0, 64KB)` or store large diffs externally.

### 3.4 LOW

L-1. `auth.service.ts:415` security event number uses `Math.random()` — fine for uniqueness suffix; consider `crypto.randomUUID()`.
L-2. `register` endpoint exists but not used by the frontend (admin creates users). If true, mark `@Internal()` and require admin auth.
L-3. `auth.controller.ts:73` `logout` returns 200 even when no token was passed. Either reject or no-op silently.
L-4. JWT `validate` silently falls back to first scope when none of `GROUP/COMPANY/BRANCH/DIVISION` matches. `jwt.strategy.ts:37`. For unknown role scopes this becomes "first available" — log a warning.
L-5. `health.controller.ts` only checks DB. Add Redis ping when configured.
L-6. Health endpoint returns hard-coded `version: '0.1.0'`. Drive from package.json.
L-7. `redis.config.ts` falls back to in-memory cache silently when `REDIS_HOST` is unset. In production this is dangerous (cache size unbounded, no eviction). Throw if `NODE_ENV=production` and Redis not configured.
L-8. `frontend/src/app/(auth)/login/` not opened — inspect for: useSearchParams in Suspense (the prior audit fixed three), client-side credential storage, error messaging that leaks user existence.
L-9. `Document` model is polymorphic via referenced relations; consider whether a native polymorphic `(entityType, entityId)` index exists.
L-10. CI does not run `npm audit` — known-vuln dependencies pass through.
L-11. Dockerfile copies whole `backend/` after `package.json` — busts npm cache on any source change. Negligible perf.
L-12. `.env.example` not in repo root (per README "cp .env.example .env"). Verify.
L-13. `pgAdmin` exposed at port 5050 in dev compose. Confirm no exposure in prod compose. ✅ confirmed not in prod.
L-14. README references `package.json` `verify` script using PowerShell — non-portable for Linux/Mac CI agents. Provide a bash equivalent.
L-15. Aurora Design System mentioned in earlier audit — verify the components/* directory is actually a coherent system, not a grab-bag.
L-16. 51 migrations, none squashed. After 100+ they slow `prisma migrate deploy` perceptibly. Plan a periodic squash.
L-17. `nodemailer` installed but no email sender wired up (per known-limitations). Either remove or implement.
L-18. README states the frontend runs on `:3000` but `frontend/package.json` `dev` runs on `:3009`. Pick one.
L-19. `FORBIDDEN_PROD_SECRETS` set is good — extend with `'admin'`, `'password'`, common GitHub-leaked values.
L-20. Console-log statements left in services — search & replace to `Logger`.
L-21. `data-archive-jobs`, `retention-policies` modules track config; verify a worker enforces them.
L-22. `permissions.guard.ts:30` falls back to "no permissions declared → allow". A controller that forgets `@RequirePermissions` is silently public to any authenticated user. Default to *deny* unless explicitly opted in (e.g. `@AllowAuthenticated()` decorator).
L-23. `RolesGuard` exists separately from `PermissionsGuard`. The interaction order is `Throttler → JWT → Roles → Permissions`. Confirm `RolesGuard` is not an alternative path that bypasses permissions.

---

## 4. Systemic / Architectural Issues

These are not single-line bugs but cross-cutting concerns:

### S-1. The platform is wide but shallow on enforcement boundaries.
The same care that produced 311 Prisma models was not applied to "every service must use `CompanyScopeService`". The remediation should not be 250 hand-edits — it should be (a) a Nest interceptor that tags requests with the user's accessible-company set, (b) a `BaseService<T>` that wraps Prisma queries with that filter, and (c) a code-mod / lint rule that fails CI when a service queries a model with `companyId` without using the base service.

### S-2. There is no single source of truth for "what posts to the GL".
Sales-orders, receivables, fuel-reconciliations, payroll, depreciation, journal-entries, expense, AP all eventually create GL effects. Some go via the `accounting-engine` posting rules (`AccountingPostingRule`), some via direct `prisma.journalEntry.create`. NetSuite-grade ERPs have a single "post to GL" pipeline that every transaction model funnels through. ITEMBA-R has the data model for it (`AccountingPostingRule`, `AccountingPostingRuleLine`, `PostingRun`) but only a portion of the modules use it. Make it mandatory and mark direct `journalEntry.create` outside `accounting-engine` as a code smell.

### S-3. The approval engine is a database registry, not an interceptor.
`ApprovalRequest`/`ApprovalStep`/`ApprovalAction` exist but services manually call `submitForApproval`. This is fragile (forgetting the call shipping skips approval). Wire approvals as a Nest interceptor on annotated controller methods (`@RequiresApproval('expenses.create', threshold: 1_000_000)`).

### S-4. Atomicity gaps in cross-aggregate transactions.
Multiple services do `tx -> create A; create B; create movement; update balance; create journal lines` partially in `$transaction` and partially outside. The failure mode is "movement created, journal not posted" or "stock decremented, sale not finalized". Audit every flow and make the entire saga transactional, or use an outbox pattern for downstream effects.

### S-5. Numeric precision is unprincipled.
The schema chose Decimal correctly. The application code converts every Decimal to JS Number for arithmetic. Either standardize on Decimal.js across all financial code, or use bigint cents. This bug class will *eventually* produce a TZS 1.00 imbalance in a financial statement that auditors will find.

### S-6. Background work has no engine.
There are tables for jobs (`BackgroundJob`, `JobQueueConfig`, `PerformanceTrace`) but no BullMQ, no @nestjs/schedule, no Bee-Queue, no cron container. Heavy work (payroll calculation, period close, financial-statement runs, scheduled reports, snapshot runs, backups, retention, archive) all run inline on the request thread. Add BullMQ + a worker container + idempotent job handlers.

### S-7. Observability is a registration system, not a pipeline.
Same problem: `ErrorLog`, `SystemMetric`, `SystemHealthCheck` are tables, not exporters. Wire OpenTelemetry SDK + Sentry + a metrics scraper before any production traffic hits this system.

### S-8. The sheer module count (263) is a cost in itself.
Every milestone added a module (or three). 60% of modules are CRUD over 1–3 entities and could be merged into domain modules of 8–10 entities. The current count slows IDE traversal, makes `app.module.ts` unscrollable, and makes new developers afraid to touch anything. Plan a consolidation pass after the security fixes.

### S-9. Test coverage is effectively zero relative to surface area.
18 spec files for 1,413 source files. Most specs are for `common/services/*`, not for module business logic. Without tests, every fix to the issues in this report is a leap of faith. Before remediation, add at least:
  - One e2e test per critical flow (login, create journal entry, post, reverse; create sales order, ship, invoice; payroll run end-to-end).
  - One isolation test per module asserting Company A user → Company B endpoint = 403/404.

### S-10. No row-level security at the database.
Even with all the application-layer fixes, Postgres RLS would close the gap entirely: a query smuggled through a misconfigured ORM call still gets blocked. RLS is not free (composability cost in raw queries) but for a multi-tenant ERP it is the seatbelt.

---

## 5. ERP Capability Gap vs Top-Tier Platforms

Compared with NetSuite OneWorld, SAP Business One, Oracle Fusion, and Odoo Enterprise.

| Capability | NetSuite | SAP B1 | Odoo Ent. | Oracle Fusion | ITEMBA-R Now | Gap to top-tier |
|---|---|---|---|---|---|---|
| **Multi-company / consolidation** | Full elimination engine | Cross-company JE | Multi-company chart sharing | Full Hyperion-grade | Has model `InterCompanyTransaction` but no eliminations engine | **Major** — add elimination journals, % ownership, NCI |
| **Multi-currency / FX revaluation** | Native + reval | Native + reval | Native | Native | `CurrencyCode` enum on accounts; no FX rates table; no reval journal | **Major** — add `ExchangeRate` model + monthly reval engine |
| **Period close** | Workflow + checklist | Workflow | Manual lock | Workflow | `AccountingPeriodClose` exists; checklist via `LaunchReadinessItem`-style would need wiring | Medium — extend existing model |
| **Chart-of-accounts hierarchy** | Multi-segment | Segment + dimension | One hierarchy | Flexfields | Single `ChartOfAccount` model | Medium — add account dimensions / segments |
| **Dimension-based reporting** | Yes (subsidiary, location, dept, class) | Cost centers | Analytic accounts | Yes | `divisionId`/`branchId` on lines but no analytical dimension model | Medium |
| **Budget vs actual at GL level** | Yes | Yes | Yes | Yes | Not present | **Major** — add `Budget`, `BudgetLine`, variance reports |
| **Lease accounting (IFRS 16)** | Yes | Add-on | Add-on | Yes | Not present | Medium for Tanzania context |
| **Revenue recognition (ASC 606)** | Yes | Limited | Limited | Yes | Not present | Optional |
| **Fixed asset componentization + impairment** | Yes | Yes | Yes | Yes | `FixedAsset` flat; `DepreciationSchedule` exists; no components, no impairment | Medium |
| **MRP / BOM explosion** | Yes (NS Manufacturing) | Yes | Yes (Manufacturing) | Yes | Not present | Major — add `BillOfMaterials`, `WorkOrder`, `MrpRun` for construction & beverages production |
| **Demand forecasting** | NS Demand Planning | Add-on | Yes | Yes | Not present | Optional but high value |
| **Cycle counting / ABC analysis** | Yes | Yes | Yes | Yes | Stock adjustments yes; ABC classification no | Medium |
| **Lot/batch/serial tracking** | Yes | Yes | Yes | Yes | `ProductBatch` with expiry — partial | Medium — add serial; tighten on outbound |
| **Costing methods (FIFO/LIFO/STD/AVG)** | All | All | All | All | AVG only | Medium |
| **Three-way match** | Yes | Yes | Yes | Yes | `ThreeWayMatch` model — present | None |
| **Procurement-to-pay full chain** | Yes | Yes | Yes | Yes | PR→RFQ→PO→GRN→Inv → Payable — present | None — **competitive** |
| **POS** | NS POS | SAP B1 POS | Yes | Yes | Westsides POS via sales-orders | Partial — no offline POS device sync UX |
| **Fuel station retail** | Vertical add-on | Vertical add-on | Niche | None | **Comprehensive** — tanks, pumps, nozzles, shifts, dips, reconciliation, variance | **Better than peers** |
| **Hospitality (folio, room, F&B)** | Niche | Add-on | Yes | Yes | Present | None |
| **Parking** | Niche | Niche | None | None | Present | Differentiator |
| **Rentals (property)** | Add-on | Add-on | Property module | None | Present — leases, rent invoices, payments, maintenance | Competitive |
| **HR + payroll local statutory (Tanzania PAYE/NSSF/WCF/SDL)** | Localization pack | Localization pack | Country pack | Yes | Present | **Better than off-the-shelf for TZ** |
| **Approval workflow** | Yes | Yes | Yes | Yes | Present but not consistently invoked | Wire it |
| **Audit log / SoX-style controls** | Yes | Yes | Yes | Yes | `AuditLog` + `InternalControlRule` models present | Wire systematically |
| **Tax engine (multi-country)** | Yes | Yes | Yes | Yes | Tanzania-focused; `TaxAuthority`, `TaxFilingPeriod`, `TaxReturn` | Adequate for TZ; would need extension for KE/UG/RW |
| **API integration / webhook / iPaaS** | SuiteCloud | Service Layer | iPaaS | OIC | `IntegrationProvider`, `Webhook*`, `ApiKey` models present | Solid for the use case |
| **Mobile app** | Yes | Yes | Yes | Yes | Models exist; app not built | Major if mobile is required |
| **Offline sync** | Limited | None | Yes | Limited | Models exist; engine not finished | Major if field workers need it |
| **Reporting / BI** | SuiteAnalytics | Crystal / Lumira | Studio | OBIEE | `KpiIndicator`, `KpiSnapshot`, `ReportDefinition`, dashboards — all in DB | Adequate registries; missing the actual SQL warehouse / cube |
| **i18n (Swahili)** | Yes | Yes | Yes | Yes | English only | Medium for adoption |
| **Row-level history / version replay** | SuiteAudit | DI | Yes | Yes | AuditLog yes, no version chain | Medium |
| **Production telemetry (OTEL, APM)** | Built-in | Built-in | Built-in | Built-in | Tables, no exporters | Medium |
| **Backup / DR (verifiable)** | Managed | Managed | Self-host varies | Managed | Tables, no executor | **Major before go-live** |
| **Localization beyond TZ** | Out of box | Out of box | Out of box | Out of box | TZ only | Optional |

**Strongest unique positioning:** fuel station retail + parking + rentals + Tanzania-statutory payroll, all in one platform — *no top-tier ERP ships this combination.* Lean into it.

**Weakest gaps to top-tier:** consolidation eliminations, FX revaluation, budget-vs-actual, dimension reporting, MRP/BOM, lease accounting, lot/serial costing, real BI cube, finished mobile/offline. Of these, **consolidation + FX reval + budget-vs-actual + a real BI cube** are the four that would matter most to the Itemba Group's CFO and external auditors.

---

## 6. Strengths Worth Preserving

- **Refresh-token family rotation with reuse-detection.** Among the better implementations seen at this scale (`auth.service.ts:230-282`).
- **Per-account lockout + 2FA challenge tokens (5 min `scope: 'twoFactor'` JWT).** Solid two-stage flow.
- **Encrypted TOTP secrets at rest.** Even if CBC should be GCM, the intent is right.
- **`CompanyScopeService`.** The right primitive — just needs to be applied everywhere.
- **`AccountingControlService.assertPostingAllowed`.** Period-close gate is real and used in journal-entries.
- **Schema decimal discipline.** No `Float`. Money is `Decimal(18,2)`. Quantities `Decimal(18,4)`. Avoids the worst-class precision bug.
- **Hot-path indexes.** `audit_logs(companyId, entityType, createdAt)`, `journal_entries(companyId, transactionDate, status)`, `inventory_balances(companyId, productId, inventoryLocationId)` unique — all correct.
- **Migration discipline.** 51 named migrations, no squashes; every milestone is a discrete migration.
- **Sensitive-access interceptor** is a smart pattern; just needs to log failures too.
- **CI workflow** runs schema validate + typecheck + lint + build on every PR. Just lift `--passWithNoTests` and add e2e.
- **The "Group Control" architectural concept** (sensitive records owned by company, accessed only via group-scoped roles) is genuinely a good fit for a Tanzanian holding-company governance model.
- **The breadth of the schema for fuel retail and Tanzanian statutory HR** is exceptional for a from-scratch build and is the platform's competitive moat.

---

## 7. Prioritized Remediation Roadmap

### Week 1 — Stop the bleeding (CRITICAL)
1. C-3 — Add CSRF token to the frontend → backend proxy. Tighten `sameSite` to `'strict'` on access cookie. *(0.5 day)*
2. C-6 / C-7 — Fix prod compose: add `TWO_FACTOR_ENCRYPTION_KEY` and `REFRESH_TOKEN_PEPPER` env, add a `migrate` one-shot service, add non-root `USER`. *(0.5 day)*
3. C-10 / C-11 — Throttle `login` and `register`; gate or remove public `register`. *(0.5 day)*
4. **C-1 / C-2 / H-14 / H-15** — Single biggest workstream. Build a `CompanyScopedService<T>` base, refactor at least the top-30 high-risk services (customers, suppliers, products, sales-orders, purchase-orders, invoices, GRNs, payroll-runs, journal-entries, inventory-movements, fuel-shifts) to use it. Add e2e isolation tests that assert Company A → Company B = 404. *(8 days)*

### Week 2 — Data correctness
5. C-4 / C-5 — Rewrite `applyMovementToBalance` to atomic `upsert + increment`, add negative-stock guard. Backfill a one-time recalc job. *(2 days)*
6. H-11 / H-12 / H-13 / S-5 — Standardize Decimal arithmetic (Decimal.js wrapper). *(2 days)*
7. M-15 / S-2 — Make accounting-engine the single funnel for GL postings; period-close lock check on every poster. *(3 days)*
8. M-17 — Reserve inventory on sales-order confirm. *(0.5 day)*

### Week 3 — Auth & observability
9. C-9 / H-1 — Move JwtStrategy permission cache to Redis with pub/sub invalidation. *(1 day)*
10. H-2 / H-4 / H-5 / H-7 — Smaller auth-hardening fixes. *(1 day)*
11. H-6 — Migrate TOTP secret encryption to AES-256-GCM with userId as AAD. Add a one-shot re-encrypt migration. *(1 day)*
12. M-5 / S-7 — Wire OpenTelemetry + Sentry + structured JSON logs (`nestjs-pino`). *(2 days)*
13. M-6 / M-7 / S-6 — Wire BullMQ + a worker container. Convert `scheduled-reports`, `analytics-snapshot-runs`, payroll calc, financial-statement runs, period close, backups to background jobs. *(3 days)*

### Week 4 — Test floor
14. S-9 — Establish the test floor. Target 60% line coverage on `accounting-engine`, `journal-entries`, `inventory-movements`, `payroll-calculator`, `auth`. Add an e2e suite that runs the seed dataset through the canonical happy path of every domain. *(5 days)*
15. M-21 — Add frontend smoke tests. *(1 day)*

### Week 5 — Hardening
16. C-8 — Both Dockerfiles non-root. Read-only root FS. Drop capabilities. *(0.5 day)*
17. M-24 — File storage abstraction with S3 backend default. *(2 days)*
18. M-25 — Mime + magic-byte + ClamAV on uploads. *(1 day)*
19. S-10 — Postgres RLS rollout on the top-30 tables already covered in Week 1. *(2 days)*
20. M-31 / M-32 / S-8 — Module consolidation pass to drop count from 263 → ~150. *(2 days)*

### Beyond — Top-tier ERP gap closure (in priority order)
21. Consolidation + intercompany elimination engine.
22. FX rates table + monthly reval engine.
23. Budget vs actual at GL with variance reports.
24. Dimension-based reporting (analytic dimensions on lines).
25. Real BI cube (warehouse + dimensional models, not just snapshot tables).
26. MRP/BOM for construction & beverages.
27. Lot/serial + FIFO/LIFO costing.
28. Mobile app + offline conflict UI.
29. i18n (Swahili).
30. Lease accounting (IFRS 16).

---

## 8. Method, Confidence, Limits

This audit was performed by direct read of:

- `backend/src/main.ts`, `app.module.ts`, `config/env.validation.ts`
- `backend/src/common/{guards,interceptors,decorators,services,filters,health.controller.ts}`
- `backend/src/modules/auth/*` (controller, service, two-factor service, both strategies)
- Sampled 6 representative business services in depth (`customers`, `bank-accounts`, `journal-entries`, `inventory-movements`, `sales-orders`, `payroll-runs`) plus quick reads of the `companyFilter` pattern across the rest.
- `database/prisma/schema.prisma` head, model index, BankAccount, Loan, JournalEntry, JournalEntryLine, AuditLog, RefreshToken, InventoryBalance segments
- All 51 migration directory names
- `frontend/src/middleware.ts`, `contexts/auth-context.tsx`, `lib/api-client.ts`, `app/api/auth/login/route.ts`, `app/api/backend/[...path]/route.ts`
- `docker-compose.production.yml`, `backend/Dockerfile`, `.github/workflows/ci.yml`
- `common/health.controller.ts`, `common/config/redis.config.ts`

**Limits:**

- Of the 263 backend modules I sampled ~10 in depth and grepped patterns across the rest. Issues filed under "systemic" generalize from that sample; module-specific exceptions exist.
- I did not run the test suite, the lint, or the Prisma migrate. Findings about runtime behavior (e.g. C-6 compose boot failure) are derived from static reading of env validation and compose env keys.
- I did not inspect every frontend page; findings about the frontend generalize from middleware, auth context, and the proxy.
- Severity is my judgment under a "this will be deployed to handle the financial books of three Tanzanian companies" threat model. A reader operating under a different threat model may re-rank.

If you act on only the **CRITICAL** items (C-1 through C-11), the platform's risk profile drops from "do not deploy" to "deploy with audited pilot scope." If you act on CRITICAL + HIGH within the 5-week roadmap, the platform reaches "deploy to all three group companies with reasonable confidence." Beyond that, Section 5 is the multi-quarter roadmap to genuine top-tier-ERP parity.

— *End of audit report.*
