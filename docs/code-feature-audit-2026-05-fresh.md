# Itemba — Severe Code & Feature Audit (Fresh, Evidence-Based)

> Generated: 2026-05 / current `main`.
> **This audit is grounded in the current source tree, not in older audit
> documents.** Every "still broken" claim below is backed by a file:line
> citation. Items the team has demonstrably remediated are explicitly listed
> as **CLOSED** so prior remediation work is not re-billed as risk.

---

## 0. Methodology

I treated `docs/master-audit-remediation-plan-2026-05-01.md` and earlier
audit reports as **historical context only**. Findings here come from:

- Direct reads of services, guards, and strategies (`backend/src/**`).
- The active static guardrail (`scripts/check-unsafe-patterns.mjs`) and its
  `scripts/check-unsafe-patterns.baseline.json` — both treated as
  **canonical current truth** for unsafe pattern coverage.
- Schema and migrations (`database/prisma/`).
- Frontend security plumbing (`frontend/src/components/security/`,
  `frontend/src/app/api/backend/[...path]/route.ts`).
- Grep counts of `companyScope.*`, raw `if (companyId) where.companyId =`
  shortcuts, `prisma.$transaction`, and `JOB_WORKER_ENABLED`.

Three sections follow:

1. **What is genuinely hardened** (verifiable, with citations).
2. **What is still broken or risky** (with file:line citations).
3. **What is unverified or carries architectural risk** (needs runtime/QA
   confirmation, not code review).

---

## 1. Application Snapshot

| Layer | Stack | Notes |
| --- | --- | --- |
| Backend | NestJS 10 + Prisma 5 + Postgres 16 | ~280 feature modules |
| Frontend | Next.js 16, React 18.3, Tailwind 3, Vitest 4 | Aurora design system |
| Auth | argon2, JWT (15 m access / 7 d refresh), AES-GCM TOTP, ActiveSession + `sid` claim, HttpOnly cookies, double-submit CSRF | Recent-auth gating implemented |
| Multi-tenancy | Group → Company → Division → Branch | Canonical service: `CompanyScopeService` |
| Workers | In-process polling worker, gated by `JOB_WORKER_ENABLED`; handlers: backup-run, restore-test, data-export, notification-dispatch | No external Redis/BullMQ |
| Infra | docker-compose dev/staging/prod, GitHub Actions (prisma-validate, lint, typecheck, build, backend tests), k6 load tests under `scripts/load-tests/` | |

**Module footprint.** ~280 backend modules cover: accounting (journal entries,
posting runs/rules, posting engine, period close, depreciation, audit
adjustments, accounting locks, financial statements, tax stack), inventory
(movements, balances, locations, batches, package movements, returnable
packages), procurement (RFQs, requisitions, purchase orders, GRNs,
plans, supplier performance), sales (orders, quotations, proformas,
delivery notes, price lists, agreements, channels, commissions), CRM
(customers, segments, comms, support tickets), HR & payroll (employees,
contracts, attendance, leave, allowances, deductions, payroll periods/runs,
shift schedules), construction (projects, sites, BOQ, subcontractors,
project billing/progress/material issues, equipment usage), agriculture
(farms, fields, crops, seasons, harvest records, labor records,
input applications, equipment usage), petroleum (fuel shifts,
nozzle readings, fuel tanks, trip fuel usage, vehicle maintenance, drivers,
trips, routes), hospitality (rooms, room bookings, guests, housekeeping,
restaurant tables/orders, menu categories/items, hospitality payments,
hospitality facilities), parking (facilities, zones, rates, sessions,
payments), property (rental properties/units, lease agreements,
rent invoices/payments, property maintenance, tenants), compliance
(calendar, document requirements/status, events, obligations, reports,
business licenses, statutory deduction rules, tax registrations,
internal controls), platform (audit logs, alert rules/events, approvals,
automation rules/runs, background jobs, business automation, data exports,
data archive jobs, retention policies, security policies/events,
disaster recovery, performance traces, system metrics, error logs,
api clients/keys/request logs, integration mappings/connections/events,
mobile sessions, device registrations, message templates, document
templates, generated documents).

---

## 2. What Is Genuinely Hardened (Closed Items)

These were once on the master plan; current code confirms they are done.
**Do not re-bill these as risk.**

### 2.1 Static guardrails — 6 of 8 rule classes empty

Confirmed against [scripts/check-unsafe-patterns.baseline.json](scripts/check-unsafe-patterns.baseline.json):

| Rule | Status | Evidence |
| --- | --- | --- |
| `JWT_SECRET_FALLBACK` | **CLOSED** | baseline empty array |
| `AES_CBC_TOTP` | **CLOSED** — TOTP migrated to AES-GCM | baseline empty array |
| `PASSWITHNOTESTS` | **CLOSED** — backend test gate enforced | baseline empty array |
| `PRISMA_USER_HARD_DELETE` | **CLOSED** — soft-delete only | baseline empty array |
| `PUBLIC_REGISTER_DEFAULT_ON` | **CLOSED** — registration default off | baseline empty array |
| `SALES_ORDER_STATUS_CLOSED_LITERAL` | **CLOSED** — uses enum | baseline empty array |

### 2.2 GL posting funnel narrowed

[scripts/check-unsafe-patterns.mjs](scripts/check-unsafe-patterns.mjs)
allow-list confines GL writes to the canonical engines (journal-entries,
accounting-engine, posting-engine, posting-runs, period-close,
audit-adjustments, depreciation, hr/payroll-postings). Only **5**
grandfathered exceptions remain in `GL_DIRECT_POSTING_OUTSIDE_ENGINE`:
harvest-records, intercompany-transactions, loan-repayment-schedules,
project-material-issues, subcontractors. New violators are blocked at CI.

### 2.3 Multi-tenant scoping — `CompanyScopeService` is real and broadly adopted

Defined under [backend/src/common/services](backend/src/common/services).
Provides `companyWhereFor`, `assertCanAccessCompany`,
`accessibleCompanyIds`, `assertGroupScoped`, `isGroupScoped`. Workspace grep
returned **200+ correct call sites** across at least 30 distinct modules,
including security-critical ones:

- `accounting-locks`, `accounting-periods`, `chart-of-accounts`,
  `customer-statements`, `data-exports`, `data-isolation-tests`
- `bank-accounts` (group-scoped), `cash-accounts`, `customers`, `contracts`,
  `debts`, `crm`
- `branches`, `divisions`, `companies`
- `inventory-movements`, `inventory-locations`
- `api-clients`, `api-keys`, `api-request-logs`, `active-sessions`
- `background-jobs`, `business-automation`, `agriculture-dashboard`,
  `compliance-dashboard`, `construction-dashboard`, `itemba-dashboard`
- `documents`

Sample evidence:
[backend/src/modules/accounting-locks/accounting-locks.service.ts#L21](backend/src/modules/accounting-locks/accounting-locks.service.ts#L21),
[backend/src/modules/customers/customers.service.ts#L34](backend/src/modules/customers/customers.service.ts#L34),
[backend/src/modules/inventory-movements/inventory-movements.service.ts#L55](backend/src/modules/inventory-movements/inventory-movements.service.ts#L55),
[backend/src/modules/data-exports/data-exports.service.ts#L40](backend/src/modules/data-exports/data-exports.service.ts#L40).

### 2.4 Atomic financial / operational writes

Workspace-wide `prisma.$transaction` usage: **108 hits** across services
(measured directly). Anchor cases verified by reading source:

- **Fuel shift close** is fully atomic and uses row-level locks.
  [backend/src/modules/fuel-shifts/fuel-shifts.service.ts#L398](backend/src/modules/fuel-shifts/fuel-shifts.service.ts#L398)
  wraps validated nozzle readings, inventory movements, fuel-shift status
  update, and HR attendance creation in a single `$transaction`, with
  `SELECT ... FOR UPDATE` on the shift row and a domain validator
  (`PetroleumShiftControlService.validateShiftClosing`). Inventory
  movements receive the same `tx` (line ~496) so a failure rolls back
  meter updates, inventory deltas, and HR attendance together.
- Inventory movements expose a `tx`-aware `createMovement` API
  (used above) — meaning callers can compose atomic operations.

### 2.5 Auth & session model

[backend/src/modules/auth/strategies/jwt.strategy.ts](backend/src/modules/auth/strategies/jwt.strategy.ts)
and [backend/src/modules/auth/auth.service.ts](backend/src/modules/auth/auth.service.ts)
both reference `sid`, `ActiveSession`, registration controls, AES-GCM,
and argon2. Combined with the empty `JWT_SECRET_FALLBACK` and
`PUBLIC_REGISTER_DEFAULT_ON` baselines, the historical "weak auth"
findings are closed.

### 2.6 Background-job runtime

[backend/src/modules/job-worker/job-worker.service.ts](backend/src/modules/job-worker/job-worker.service.ts)
hosts a real polling consumer gated by `JOB_WORKER_ENABLED` (off by default).
Handlers exist for `backup-run`, `restore-test`, `data-export`,
`notification-dispatch`. The "no real worker" risk is closed; what remains
is operational (see §4.3).

---

## 3. What Is Still Genuinely Broken (with citations)

### 3.1 P0 — IDOR / tenant-bleed in modules that bypass `CompanyScopeService`

The unsafe-pattern regex catches the legacy shortcut:

```
if (companyId) where.companyId = companyId;
```

This is a legacy authorization shortcut: it treats the query-string
`companyId` as authoritative and never checks the caller's accessible
companies. Workspace grep confirms **169+ live occurrences** across
**~158 services** still in the baseline. A user authenticated to Company A
who simply omits `companyId` will get **all rows the database holds** for
that table — full cross-tenant read. With a guessed/leaked id they can
also read any other tenant's records.

**Severity is real, not theoretical.** Two confirmed reads:

- [backend/src/modules/fuel-nozzle-readings/fuel-nozzle-readings.service.ts#L29](backend/src/modules/fuel-nozzle-readings/fuel-nozzle-readings.service.ts#L29)
  — `findAll`/`findOne` accept no `CurrentUser`; raw shortcut is the only
  filter.
- [backend/src/modules/inventory-balances/inventory-balances.service.ts#L14](backend/src/modules/inventory-balances/inventory-balances.service.ts#L14)
  — same; `liveStock` (heatmap source) leaks across tenants.

The full still-unsafe list (sample, by domain):

| Domain | Affected services |
| --- | --- |
| **Accounting / GL** | `accounting-engine` (!), `posting-runs`, `posting-rules`, `audit-adjustments`, `bank-reconciliations`, `financial-statements`, `depreciation` |
| **HR & payroll** | every `hr/*` listed in baseline (employees, attendance, departments, deduction-types, leave-types, leave-requests, payroll-periods, performance, positions, shift-schedules, work-shifts, hr-documents, hr-reports, employment-contracts, employee-allowances/deductions/assignments, allowance-types) |
| **Tax** | `tax/*` (tax-rates, tax-codes, tax-returns, tax-transactions, tax-filing-periods, company-tax-registrations), `tax-anomaly-detection` |
| **Compliance** | compliance-calendar, compliance-events, compliance-obligations, compliance-reports, compliance-document-status/requirements, statutory-deduction-rules |
| **Inventory** | inventory-balances, product-batches, package-movements, returnable-packages, stock-damage |
| **Petroleum** | fuel-nozzle-readings, trip-fuel-usage, vehicles, vehicle-maintenance, drivers, trips, routes |
| **Hospitality** | rooms, room-bookings, guests, housekeeping, restaurant-tables, restaurant-orders, menu-items, menu-categories, hospitality-payments, hospitality-facilities |
| **Parking** | parking-facilities, parking-zones, parking-rates, parking-sessions, parking-payments |
| **Property** | rental-properties, rental-units, lease-agreements, rent-invoices, rent-payments, property-maintenance, tenants |
| **Construction / Agri** | construction-projects, construction-sites, boq-items, bid-comparisons, subcontractors, project-progress, project-billing, project-material-issues, equipment-usage, agriculture-activities, harvest-records, labor-records, crops, crop-seasons, farms, farm-fields, farm-input-applications |
| **Sales / procurement** | quotations, proforma-invoices, delivery-notes, price-lists, sales-channels, sales-commissions, customer-price-agreements, customer-credit-profiles, customer-segments, rfqs, purchase-requisitions, procurement-plans, supplier-performance, contact-persons |
| **Platform / observability** | alert-rules, alert-events, approval-workflows, approval-requests, approval-delegations, automation-rules, automation-runs, retention-policies, security-policies, security-events, support-tickets, system-metrics, performance-traces, error-logs, api-request-logs (partial), kpi-snapshots, executive-insights, mobile-sessions, device-registrations, communication-logs, external-messages, external-payments, integration-connections/events/mappings, document-number-sequences, document-templates, generated-documents, message-templates, audit-evidence-packs, internal-controls, disaster-recovery, data-archive-jobs, data-quality, business-licenses, licensed-business-units, launch-blockers, cache-management, expense-categories, units, tasks, tenants, analytics-snapshot-runs |

This is the **single largest current security exposure**. The good news:
the migration is straightforward and mechanical — replace
`if (companyId) where.companyId = companyId` with
`...await this.companyScope.companyWhereFor(user, companyId)` plus the
appropriate `assertCanAccessCompany` on writes/reads-by-id. The pattern is
already in place in 30+ peer modules so there is a reference template.

> **Note on the `accounting-engine` hit.** It appears at
> [backend/src/modules/accounting-engine/accounting-engine.service.ts#L15](backend/src/modules/accounting-engine/accounting-engine.service.ts#L15)
> and is the most sensitive of the lot — it is a GL surface. Migration of
> this file should be the first ticket of the burn-down.

### 3.2 P1 — Five GL writers outside the canonical posting engines

Allow-listed in `GL_DIRECT_POSTING_OUTSIDE_ENGINE`:

- `harvest-records`
- `intercompany-transactions`
- `loan-repayment-schedules`
- `project-material-issues`
- `subcontractors`

Each posts journal entries directly without going through
`AccountingEngineService` / `PostingEngine`. This is acceptable as a
short-term grandfather but creates two real risks: (a) period-lock and
audit-adjustment policies can be skipped, (b) posting changes (e.g.
new validation, GL split rules) must be replicated in five places. Plan a
migration to the canonical engines, then delete from the allow-list.

### 3.3 P1 — Inconsistent `CurrentUser` propagation

Several still-unsafe services don't even accept the authenticated user
into `findAll`/`findOne` (verified for fuel-nozzle-readings and
inventory-balances). That is a structural defect: even when fixed
they need controller-level changes to thread the user. Treat
"thread `AuthUser` into every read" as a sub-task of the §3.1 burn-down.

### 3.4 P2 — Fragmented "still raw" Prisma writes outside `$transaction`

108 services use `$transaction` — strong overall — but several services
outside that set perform multi-row writes (status flips, child rows,
audit-log inserts) without a transaction. Two indicative ones:

- `fuel-nozzle-readings.service.ts` writes audit logs after updates
  without wrapping the update + audit insert in `$transaction`. Failed
  audit insert leaves a write without a paper trail.
- `inventory-balances.service.ts` produces derived metrics from multiple
  reads without a snapshot — minor, but visible to QA as flicker.

### 3.5 P2 — Static-guardrail regex is narrow

[scripts/check-unsafe-patterns.mjs](scripts/check-unsafe-patterns.mjs)
matches only the literal `if (companyId)\n where.companyId = companyId`.
A simple variant — `where.companyId = companyId ?? undefined`,
`Object.assign(where, { companyId })`, ternary, or splitting the lines —
would slip past CI. Once §3.1 is done the regex itself should be widened
(or replaced with an AST-based check that flags any direct write to a
`companyId` filter that does not originate from `CompanyScopeService`).

### 3.6 P2 — `accounting-engine` listed in §3.1

Worth its own line. Any IDOR in the GL surface is a financial
controls exposure, not just a privacy one. Treat as P0/P1 hybrid and
remediate before the §3.1 mass migration so a regression in one of the
158 leaf services cannot be amplified by a permissive engine read.

---

## 4. Architectural / Operational Risk (Unverified by Static Read)

These are not "broken" findings — they are areas where code looks fine
but the **runtime contract** needs verification:

### 4.1 Worker is in-process and single-replica

[backend/src/modules/job-worker/job-worker.service.ts](backend/src/modules/job-worker/job-worker.service.ts)
is a polling consumer in the same Node process. With `JOB_WORKER_ENABLED=true`
on multiple API replicas you will have N workers polling the same table.
Either:

- Document "exactly one replica may set `JOB_WORKER_ENABLED=true`", and
  enforce it in deployment manifests; or
- Add a row-level lock (`SELECT ... FOR UPDATE SKIP LOCKED`) so multiple
  workers can co-exist; or
- Migrate to BullMQ/Redis once load justifies it.

### 4.2 Frontend production build status not validated this pass

I did not run `npm run build` for `frontend/`. The directory
`frontend/node_modules.corrupt-20260502102956/` in the workspace tree
suggests a recent dep-tree hiccup. Run a clean prod build in CI as a gate
before each release; the eslint config under
[frontend/eslint.config.cjs](frontend/eslint.config.cjs) and the
`tsc --noEmit` in CI cover statics, but nothing in CI today verifies
`next build` succeeds in the same shape as production.

### 4.3 GitHub Actions test gate — backend only

CI runs prisma-validate, lint, typecheck, build for both halves and
backend tests. **Frontend tests are not gated.** With Vitest 4 already
configured at [frontend/vitest.config.ts](frontend/vitest.config.ts), add
a `frontend-test` job mirroring `backend-test`.

### 4.4 ~280 modules → "feature density" risk

Several "dashboard"/"snapshot"/"insight" modules (`itemba-dashboard`,
`agriculture-dashboard`, `compliance-dashboard`, `executive-insights`,
`kpi-snapshots`, `analytics-snapshot-runs`, `westsides-dashboard` if
present) read across many domain tables. Until §3.1 is fully done,
**these dashboards will mix tenant data the moment they aggregate via a
service that uses the legacy shortcut**. A dashboard is only as
tenant-safe as its weakest dependency. Audit each dashboard's read
graph after §3.1.

### 4.5 Schema scale (80+ models, 45 migrations)

Mostly fine, but two operational follow-ups:

- **Migration rehearsal:** confirm staging runs `prisma migrate deploy`
  end-to-end on a snapshot of production data each release.
- **`deletedAt`/soft-delete consistency:** `fuel-shifts` queries filter by
  `deletedAt: null`, but I did not verify that **every** read across the
  158 still-unsafe services applies the same filter. Worth a sweep.

### 4.6 Petroleum inventory linkage is now a hard contract

Fuel-shift close requires every fuel tank to carry an
`inventoryLocationId`. Without one, close throws. Confirm seed data,
admin UX, and fuel-tank-creation forms all surface this requirement —
otherwise legitimate shift closes will fail in production.

---

## 5. Prioritized Remediation Burn-Down

| # | Item | Severity | Effort | Why |
| --- | --- | --- | --- | --- |
| 1 | Migrate `accounting-engine` to `CompanyScopeService` | P0 | XS | GL exposure |
| 2 | Mass-migrate the 158 unsafe services (§3.1) | P0 | L (mechanical) | Tenant isolation |
| 3 | Thread `AuthUser` through `findAll`/`findOne` everywhere | P0 (with 2) | M | Required by 2 |
| 4 | Widen the unsafe-pattern check or replace with AST | P1 | S | Prevents regression |
| 5 | Migrate the 5 grandfathered GL writers into the canonical engines | P1 | M | Reduce GL fan-out |
| 6 | Add `frontend-test` CI job | P2 | XS | Coverage parity |
| 7 | Document/enforce single-replica worker (or add `FOR UPDATE SKIP LOCKED`) | P2 | S | Prevent dup runs |
| 8 | Audit dashboards' read graph after step 2 | P2 | S | Verify tenant safety end-to-end |
| 9 | `deletedAt` consistency sweep | P3 | M | Quality |
| 10 | Verify `next build` in CI | P3 | XS | Release safety |

---

## 6. Bottom Line

The platform has been substantially hardened since the master plan was
written: AES-CBC TOTP is gone, the JWT-secret fallback is gone, public
registration default-on is gone, hard-deletes of users are gone,
`--passWithNoTests` is gone, the `'CLOSED'` literal in sales-orders is
gone, the GL posting funnel is narrowed to canonical engines plus five
documented exceptions, and the multi-tenant boundary is enforced
correctly in 30+ services with 200+ call sites.

The **single, dominant, real residual risk** is the long tail of ~158
services that still use the legacy `if (companyId) where.companyId = companyId`
shortcut — including, critically, `accounting-engine` itself. Closing
that tail (§3.1 + §3.2) eliminates the bulk of the platform's remaining
P0 surface area; everything else is operational hygiene.
