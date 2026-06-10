# Itemba-R — Master Codebase Study

**Purpose:** A single, dense, comprehensive understanding of the Itemba-R codebase, written so that someone reading this can hold a complete mental model of the system without further investigation.
**Method:** Six parallel deep-dive studies (documentation, operations, industry verticals, HR/payroll/compliance, cross-cutting platform, infrastructure) + synthesis with the prior financial-module audit, hierarchy doc, auth doc, role architecture, and bug-hunt report.
**Last updated:** 2026-05-18
**Status:** Reference document. Update when major refactors land.

---

## 1. What Itemba-R Is

Itemba-R is not a generic ERP template — it is a **Group Digital Governance and Enterprise Management System** built to encode the legal, operational, and control structure of the **Itemba Group of Companies** in Tanzania. Its purpose is to digitize one specific group's reality: three legal entities, ten divisions across radically different verticals (petroleum, logistics, agriculture, construction, beverages, hardware, hospitality, real estate, truck parking, rental shops), governed by a single Group with shared treasury, group-level audit, and a single HR policy.

The system is in **Milestone 16 territory** — the original ten phases (Monorepo scaffold → ERP parity → Hardening) plus six extension milestones (QA, Launch Readiness, Training, Help Center, Support, plus the financial-module-audit closure work). It is **stabilizing on a production posture** — not yet live, but well past prototype.

### The three Companies in scope

| Company | Code | Industry | Code prefix | BRELA |
|---|---|---|---|---|
| Mwanjalisi Oil Ltd | `MWANJALISI` | Petroleum & Energy | `MWAN` | BRN-TZ-2010-001234 |
| Itemba Enterprises Co. Ltd | `ITEMBA_ENT` | Logistics, Agriculture & Construction | `ITEM` | BRN-TZ-2008-005678 |
| Westsides Company Ltd | `WESTSIDES` | Wholesale & Retail Trade | `WEST` | BRN-TZ-2015-009012 |

Each is a separately BRELA-registered legal entity with its own TIN, VRN, and tax obligations. The group is `ITEMBA` ("ITEMBA Group"), seeded with address "ITEMBA House, Ohio Street, Dar es Salaam".

### The design ethos

> *Legal ownership at company level · Strategic control at group level · Operational activity at branch/site/project level · Sensitive access controlled through the Group Control layer.* (from `README.md`)

This single sentence is the operating philosophy. Everything in the system answers to it.

---

## 2. Tech Stack & Runtime

### Stack

- **Frontend:** Next.js 14 (App Router) · TypeScript · Tailwind CSS 3.4 · custom Aurora design system
- **Backend:** NestJS 10 · TypeScript · Passport (JWT + JWT-refresh) · class-validator
- **Database:** PostgreSQL 16 · Prisma 5 (schema lives in `database/`, not `backend/`)
- **Cache / Pub-Sub:** Redis 7 (permission-cache pub/sub, NestJS CacheModule)
- **Reverse Proxy:** Caddy 2 (auto-HTTPS via Let's Encrypt)
- **Auth:** argon2 password hashing · JWT access (15 min) + refresh (7 d) · 2FA via TOTP (AES-GCM encrypted) · API keys for service-to-service
- **Security:** Helmet · CORS allowlist · global ThrottlerGuard · ValidationPipe (whitelist + forbidNonWhitelisted)
- **Audit:** `AuditLogsService` canonicalized via `auditFor()` helper; severity-tagged
- **Storage:** Local in dev, S3-compatible in prod via `STORAGE_DRIVER`
- **Job queue:** PostgreSQL-backed (`BackgroundJob` table with `SELECT FOR UPDATE SKIP LOCKED` leasing) — not BullMQ; sufficient for current load
- **Docs:** Swagger auto-mounted at `/api/v1/docs` (non-prod only)

### Runtime topology

```
       Internet
          │
        Caddy 2 (HTTPS, ACME) ── app.itembagrouptz.com / api.itembagrouptz.com
          │
   ┌──────┴───────┐
   ▼              ▼
 Frontend       Backend (NestJS, port 3001/api/v1)
 (Next.js)        │
                  ├── PostgreSQL 16 (single primary)
                  ├── Redis 7 (cache + permission invalidation)
                  └── Job Worker (in-process, JOB_WORKER_ENABLED=true in prod)
```

Three Compose stacks: `docker-compose.yml` (dev — Postgres + pgAdmin + Redis only), `docker-compose.staging.yml` (full stack, staging.itembagrouptz.com), `docker-compose.production.yml` (full stack, production hostnames). A separate `backend-migrate` service runs Prisma migrations before the backend starts, gated by `depends_on: service_completed_successfully`.

### Bootstrap pipeline ([`backend/src/main.ts`](backend/src/main.ts))

In order, every request passes through:
1. Helmet (security headers, HSTS, X-Frame, CSP)
2. `app.set('trust proxy', 1)` — trust X-Forwarded-* from Caddy
3. CORS allowlist (comma-split, credentials enabled)
4. Global ThrottlerGuard (rate limit per IP)
5. JwtAuthGuard (skip for `@Public()` or `@JwtRefreshRoute()`)
6. PermissionsGuard (`@RequirePermissions` / `@RequireAnyPermissions`)
7. RolesGuard (`@Roles(...)`)
8. RecentAuthGuard (`@RecentAuth(N)` for sensitive ops)
9. ValidationPipe (whitelist + forbidNonWhitelisted + transform with implicit conversion)
10. Controller / Service
11. HttpExceptionFilter + PrismaExceptionFilter (structured `{success, statusCode, error, message, path, method, timestamp}` envelope)
12. LoggingInterceptor + TransformInterceptor (wraps success in `{success: true, data}`)

Swagger mounts at `/${apiPrefix}/docs` in non-prod only. Health endpoints: `/api/v1/health`, `/api/v1/health/live`, `/api/v1/health/ready` — used by Docker healthchecks.

---

## 3. The Four-Level Organizational Hierarchy

Strictly parent-child, enforced by required FKs:

```
                      Group  (1 — ITEMBA)
                        │
        ┌───────────────┼───────────────────┐
     Company         Company             Company   (3 BRELA entities)
        │               │                   │
   ┌────┴────┐     ┌────┴────┐       ┌──────┴──────┐
 Div  Div  Div   Div  Div  Div     Div   Div   Div    (10 divisions)
  │    │    │     │    │    │       │     │     │
 Br   Br   Br    Br   Br   Br      Br    Br    Br    (6 seeded; will grow)
```

- **Group** — `groupId` PK; holds shared metadata + Group-Control assets (bank accounts, loans, contracts, group-level fixed assets). Has no `deletedAt` (intentionally permanent).
- **Company** — `groupId` FK with `onDelete: Restrict` (can't drop a group with companies). Carries `code` (globally unique), `industryType` (free-text, display only), `status` (`CompanyStatus`), `employeeCodePrefix` (4 chars), sister `CompanyProfile` 1:1 with BRELA/TIN/VRN/incorporation data.
- **Division** — `companyId` FK with `onDelete: Cascade`. Has `type: DivisionType` enum — `PETROLEUM | LOGISTICS | AGRICULTURE | CONSTRUCTION | BEVERAGES | HARDWARE_BUILDING | TRUCK_PARKING | RENTAL_SHOPS | HOSPITALITY | REAL_ESTATE | OTHER`. The type drives which modules apply to the division.
- **Branch** — `divisionId` FK with `onDelete: Cascade`. Has `type: BranchType` — `BRANCH | SITE | PROJECT | FARM | WAREHOUSE | FUEL_STATION | OFFICE | PARKING_FACILITY | HOSPITALITY_FACILITY | OTHER`. Generic operational location.

**Code uniqueness:** Group/Company codes are globally unique; Division codes are unique per `(companyId, code)`; Branch codes are unique per `(divisionId, code)`.

**Seeded data:**
- 1 Group (ITEMBA)
- 3 Companies (Mwanjalisi/Itemba Enterprises/Westsides)
- 10 Divisions (Petroleum, Parking, Rental at Mwanjalisi; Logistics, Agriculture, Construction, Real Estate at Itemba Enterprises; Beverages, Hardware, Hospitality at Westsides)
- 6 Branches (FS-001, LOG-HQ, FARM-001, SITE-001, BEV-STORE, HWB-STORE)

**Cardinality reality:** Live operations will multiply branches drastically. Mwanjalisi alone will have many fuel stations. Itemba Enterprises will have many construction sites + farms. Hospitality has multiple properties.

---

## 4. The Authorization Model

### Three orthogonal axes

1. **Identity** — JWT (access 15 min + refresh 7 d), session-bound via `payload.sid` + `ActiveSession.status==ACTIVE` checks on every request, plus 2FA challenge tokens (scope='twoFactor') restricted to the `/2fa/challenge` endpoint, plus API-key auth for service accounts.
2. **Capability** — Role-bundled permissions. `Permission.code = "module.action"` (e.g. `"bank-accounts.read"`). Roles bundle permissions. `UserRole` joins users to roles. Permission flag `isGroupControl: Boolean` marks Group-Control-only permissions.
3. **Scope** — `UserCompanyAccess`, `UserDivisionAccess`, `UserBranchAccess` — three parallel tables with `accessLevel: AccessLevel` enum (`READ < WRITE < MANAGE`). Plus `User.companyId` as the "home" company (implicit MANAGE).

### Role scope enum

```prisma
enum RoleScope { GROUP  COMPANY  DIVISION  BRANCH }
```

JWT strategy synthesizes a "highest priority scope" at validate time. **Note: the order in code is `['GROUP', 'COMPANY', 'BRANCH', 'DIVISION']` — BRANCH outranks DIVISION, which contradicts the documented chain Group → Company → Division → Branch.** Worth flagging.

### Enforcement

- **`JwtAuthGuard`** authenticates (skip on `@Public()`).
- **`PermissionsGuard`** checks `@RequirePermissions(...)` (AND) or `@RequireAnyPermissions(...)` (OR).
- **`RolesGuard`** checks `@Roles(...)` (OR over role names).
- **`RecentAuthGuard`** enforces `@RecentAuth(N)` — recent password re-prompt window for sensitive ops.
- **`ApiKeyAuthGuard`** authenticates `x-api-key` header, checks `@RequireApiScope(...)`, synthesizes a fake `req.user` (roles: `['API_CLIENT']`, permissions: `[]`).
- **`CompanyScopeService`** is the canonical scoping authority. `applyCompanyScopeWhere(where, user, requestedCompanyId)` injects either `companyId: X` (when scoped to a specific company they have access to) or `companyId: { in: [...] }` (for group-scoped users with access to several) or `{ id: { in: [] } }` (no access — returns empty).

### Permission cache

`PermissionCacheService` keeps the resolved `AuthUser` for 60s per user-id. The `AuthModule` is `@Global` specifically so other modules can call `JwtStrategy.invalidate(userId)` on role/scope mutations, which broadcasts cache invalidation across replicas via Redis pub/sub. Without the global declaration, that entry point isn't reachable.

### What the docs say about roles

The role architecture document defines 25+ baseline roles plus industry-specific role packs per `DivisionType`. Key design choices documented:

- Scope ≠ Capability (separately stored).
- Authority flows down, data rolls up.
- Three access tiers (READ/WRITE/MANAGE).
- Legal-entity isolation by default (no implicit cross-Company visibility).
- Separation of duties (preparer ≠ approver, enforced at role-assignment time).
- Group-Control resources only mutable by GROUP-scope roles.
- Roles namespaced (no per-company role cloning).
- Industry roles attach to `DivisionType`.
- **HR concentrated at Group, executed at Division, absent from Branch.** One Group HR Director; no Company HR role; Division Managers carry HR authority for their staff with mandatory Group HR co-signature on material actions; Branch Managers have zero HR authority.

The seed currently has 26 roles wired but the catalog needs to converge to the canonical architecture.

### Frontend mirror

`frontend/src/contexts/auth-context.tsx` carries a lighter `AuthUser` — just `{ id, email, fullName, roles, permissions, companyId }`. **It does not carry `companyAccess`, `divisionAccess`, `branchAccess`, or `roleScopes`** — so UI scope filtering is limited to the home company. Single-flight silent refresh prevents refresh-token reuse detection from kicking in when multiple tabs see 401 simultaneously.

---

## 5. The Domain Map — 200+ modules

The backend has roughly 200 modules under `backend/src/modules/`. They group into seven layers:

**Layer 1 — Identity & Governance:** `auth`, `users`, `roles`, `permissions`, `groups`, `companies`, `divisions`, `branches`, `group-control`, `audit-logs`, `documents`, `document-templates`, `document-number-sequences`, `entity-code-generator`.

**Layer 2 — Operations Backbone:** `customers`, `suppliers`, `products`, `product-categories`, `product-batches`, `units`, `inventory-balances`, `inventory-movements`, `stock-adjustments`, `stock-damage`, `sales-orders`, `quotations`, `proforma-invoices`, `delivery-notes`, `sales-channels`, `sales-commissions`, `price-lists`, `customer-price-agreements`, `purchase-orders`, `purchase-requisitions`, `rfqs`, `supplier-quotations`, `bid-comparisons`, `procurement-plans`, `goods-received-notes`, `supplier-invoices`, `three-way-matching`, `returnable-packages`, `package-movements`, `crm`, `procurement`, `customer-segments`, `customer-credit-profiles`, `customer-statements`, `supplier-statements`, `supplier-performance`, `contact-persons`, `communication-logs`.

**Layer 3 — Finance:** `finance`, `chart-of-accounts`, `fiscal-years`, `accounting-periods`, `journal-entries`, `cash-accounts`, `bank-accounts`, `bank-reconciliations`, `expense-categories`, `expenses`, `receivables`, `payables`, `intercompany-transactions`, `financial-reports`, `financial-statements`, `group-reports`, `accounting-engine`, `posting-rules`, `posting-runs`, `period-close`, `accounting-locks`, `audit-adjustments`, `audit-evidence-packs`, `depreciation`, `fixed-assets`, `debts`, `loans`, `loan-repayment-schedules`, `contracts`, `tax`, `tax-anomaly-detection`, `tax-auto-apply`, `tax-filing-engine`.

**Layer 4 — Industry Verticals:**
- **Petroleum:** `fuel-tanks`, `fuel-pumps`, `fuel-nozzles`, `fuel-nozzle-readings`, `fuel-tank-dips`, `fuel-shifts`, `fuel-shift-collections`, `fuel-deliveries`, `fuel-prices`, `fuel-credit-sales`, `fuel-daily-reconciliation`, `petroleum-dashboard`, `petroleum-reports`.
- **Logistics:** `vehicles`, `drivers`, `routes`, `trips`, `trip-expenses`, `trip-fuel-usage`, `vehicle-maintenance`, `logistics-dashboard`.
- **Agriculture:** `farms`, `farm-fields`, `crops`, `crop-seasons`, `farm-input-applications`, `harvest-records`, `agriculture-activities`, `agriculture-dashboard`.
- **Construction:** `construction-projects`, `construction-sites`, `construction-labour-cost`, `boq-items`, `project-material-issues`, `project-progress`, `project-billing`, `subcontractors`, `construction-dashboard`.
- **Westsides retail/wholesale:** `westsides`, `westsides-dashboard`, `westsides-reports` (re-exports cross-cutting modules above).
- **Hospitality:** `hospitality-facilities`, `hospitality-payments`, `rooms`, `room-bookings`, `guests`, `folios`, `housekeeping`, `restaurant-orders`, `restaurant-tables`, `menu-categories`, `menu-items`.
- **Rentals/Real Estate:** `rental-properties`, `rental-units`, `tenants`, `lease-agreements`, `rent-invoices`, `rent-payments`, `property-maintenance`, `business-licenses`, `licensed-business-units`.
- **Truck Parking:** `parking-facilities`, `parking-zones`, `parking-rates`, `parking-sessions`, `parking-payments`.
- **Itemba cross-vertical:** `itemba-dashboard`, `itemba-work-units`, `equipment-usage`, `labor-records`.

**Layer 5 — HR & Compliance:** `hr` (umbrella), departments, positions, employees (in `users` or `hr`), employee-assignments, employment-contracts, work-shifts, shift-schedules, attendance-records, leave-types, leave-requests, allowance-types, deduction-types, employee-allowances, employee-deductions, payroll-periods, payroll-runs, payroll-entries, salary-payments, salary-advances, performance-records, hr-documents, public-holidays, osha-registrations, medical-exam-records, employment-disputes, disciplinary-actions; `compliance`, `internal-controls`.

**Layer 6 — Cross-Cutting Platform:** `automation-rules`, `automation-runs`, `approval-engine`, `approval-workflows`, `approval-steps`, `approval-requests`, `approval-delegations`, `notifications`, `alert-rules`, `alert-events`, `external-messages`, `message-templates`, `external-payments`, `integration-api`, `integration-providers`, `integration-connections`, `integration-events`, `integration-mappings`, `webhook-endpoints`, `webhook-events`, `api-clients`, `api-keys`, `api-request-logs`, `documents`, `document-templates`, `generated-documents`, `print-engine`, `bi`, `dashboard`, `dashboard-definitions`, `dashboard-widgets`, `user-dashboard-preferences`, `kpi-indicators`, `kpi-snapshots`, `executive-insights`, `analytics-snapshot-runs`, `reports-catalog`, `report-definitions`, `report-runs`, `saved-report-views`, `scheduled-reports`, `data-exports`, `data-quality`, `data-quality-issues`, `tasks`, `background-jobs`, `job-queue-configs`, `job-worker`, `mobile-sessions`, `device-registrations`, `offline-sync`, `support`, `support-tickets`, `support-ticket-comments`, `help-center`, `help-articles`, `user-manuals`, `training`, `training-courses`, `training-lessons`, `training-enrollments`, `training-environment`, `guided-walkthroughs`, `settings-catalog`, `user-preferences`, `documentation`.

**Layer 7 — Infrastructure & Ops:** `monitoring`, `system-health`, `system-metrics`, `performance`, `performance-traces`, `scalability`, `load-tests`, `backups`, `backup-jobs`, `backup-runs`, `restore-tests`, `disaster-recovery`, `retention-policies`, `data-archive-jobs`, `error-logs`, `active-sessions`, `security`, `security-policies`, `security-events`, `user-security-profiles`, `data-isolation`, `data-isolation-issues`, `data-isolation-tests`, `environment-config-checks`, `deployment`, `deployment-releases`, `launch-readiness`, `launch-readiness-items`, `launch-blockers`, `launch-assessments`, `production-readiness`, `go-live-signoff`, `qa`, `qa-test-suites`, `qa-test-cases`, `qa-test-runs`, `qa-test-results`, `final-qa-dashboard`, `cache-management`.

Total: ~200 backend modules, all wired into `AppModule`.

---

## 6. The Operations Backbone

Two flows + supporting modules.

### Sales cycle

**Customer → Quotation → Proforma → Sales Order → Delivery Note → Payment**

State machines:
- **Quotation:** `DRAFT → SENT → ACCEPTED/REJECTED/EXPIRED/CONVERTED`
- **Proforma:** same path; can spawn SalesOrder
- **SalesOrder:** `DRAFT → CONFIRMED → PARTIALLY_PAID/PAID/CANCELLED/VOIDED` — one model for both cash and credit sales
- **DeliveryNote:** `DRAFT → DISPATCHED → DELIVERED/PARTIALLY_DELIVERED/CANCELLED`
- **SalesCommission:** `DRAFT → APPROVED → PAID/CANCELLED`

### Procurement cycle

**Requisition → RFQ → Supplier Quotation → Bid Comparison → PO → GRN → Supplier Invoice → 3-Way Match → AP**

State machines:
- **PurchaseRequisition:** `DRAFT → SUBMITTED → APPROVED/REJECTED → CONVERTED_TO_RFQ/CONVERTED_TO_PO → CANCELLED`
- **RFQ:** `DRAFT → SENT → RESPONSES_RECEIVED → EVALUATED → AWARDED/CANCELLED`
- **SupplierQuotation:** `DRAFT → RECEIVED → EVALUATED → ACCEPTED/REJECTED/EXPIRED/CANCELLED`
- **BidComparison:** `DRAFT → REVIEWED → APPROVED/REJECTED`
- **PurchaseOrder:** `DRAFT → CONFIRMED → RECEIVED/PARTIALLY_RECEIVED/CANCELLED/VOIDED`
- **GoodsReceivedNote:** `DRAFT → RECEIVED → INSPECTED → APPROVED → POSTED/REJECTED/CANCELLED`
- **SupplierInvoice:** `DRAFT → RECEIVED → MATCHED → APPROVED → PARTIALLY_PAID/PAID/DISPUTED/CANCELLED`
- **ThreeWayMatch:** `MATCHED | PARTIAL_MATCH | VARIANCE | FAILED | MANUAL_OVERRIDE`

### Inventory

- **InventoryBalance** per product per branch — `quantityOnHand`, `quantityReserved`, `averageCost`. Branch-scoped.
- **InventoryMovement** audit trail — types: `OPENING_STOCK, PURCHASE_RECEIPT, SALE_ISSUE, SALES_RETURN, PURCHASE_RETURN, TRANSFER_IN/OUT, ADJUSTMENT_IN/OUT, DAMAGE, WASTAGE, INTERNAL_USE, PRODUCTION_IN/OUT`. Uses `FOR UPDATE SKIP LOCKED` and explicit `prisma.$transaction` (hardened in Phase 2).
- **StockAdjustment:** `DRAFT → PENDING_APPROVAL → APPROVED/REJECTED → POSTED/CANCELLED`.
- **StockDamage:** `DRAFT → REPORTED → INSPECTED → APPROVED/REJECTED → POSTED`.

### Number generation

`EntityCodeGeneratorService.next({ entityType, companyId, tx? })` is **atomic** via Prisma's `{ increment: 1 }` in a single UPDATE. Per-company sequences with prefix/suffix interpolation (`{YYYY}`, `{YY}`, `{MM}`, `{DD}`) and reset frequency (`YEARLY`/`MONTHLY`/`DAILY`). All transaction entities (SalesOrder, PO, GRN, Quotation, Proforma, SupplierInvoice) call this on create. Atomic, race-safe.

⚠️ **Exception:** `DocumentNumberSequencesService.nextNumber()` (which is a *separate* sequence service for things like document numbers) is read-then-write and was found racing in the bug hunt — fixed in the closure addendum.

### CRM / SRM coverage

`contact-persons` (multi per customer/supplier), `communication-logs` (`OPEN → FOLLOWED_UP → CLOSED` with `followUpRequired`/`followUpDate`), `customer-segments` (criteria JSON), `customer-credit-profiles` (risk rating `LOW/MEDIUM/HIGH/BLOCKED`, credit status `ACTIVE/REVIEW_REQUIRED/BLOCKED`), `supplier-performance` (onTimeDeliveryRate, qualityScore, priceCompetitivenessScore, disputeCount), `customer-statements` / `supplier-statements` (read-only balance summaries).

### Scoping gaps in operations

- **GoodsReceivedNote** has `companyId + branchId?` but **no `divisionId`**
- **SupplierInvoice** has only `companyId` — no `divisionId`, no `branchId`
- **RFQ / SupplierQuotation / BidComparison** — only `companyId`

These prevent division-scoped procurement reporting. Same family of issues as the financial audit found.

### Frontend coverage

Sales and procurement frontends are full CRUD. CRM dashboard + 8 sub-pages exist. Three-way matching has a dedicated page. No read-only stubs observed in the operations frontend.

---

## 7. The Industry Verticals

### 7.1 Petroleum (Mwanjalisi Oil — `DivisionType.PETROLEUM`)

**Most mature vertical.** 14 tables, 8 modules. Fuel-station operational stack:

- **Infrastructure:** `FuelTank` (current book balance, last dip balance), `FuelPump`, `FuelNozzle` (with `currentMeterReading`), `FuelPrice` (time-versioned per product/branch).
- **Operations:** `FuelShift` (`OPEN → SUBMITTED → SUPERVISOR_APPROVED → MANAGER_APPROVED → CLOSED`, DAY/NIGHT), `FuelNozzleReading` (litres sold per nozzle per shift, expected revenue), `FuelShiftCollection` (cash/mobile-money/card aggregation), `FuelCreditSale` (customer ledger sales).
- **Supply:** `FuelDelivery` (`DRAFT → SUBMITTED → APPROVED → POSTED`, creates Payable when supplier cost is set).
- **Inventory variance:** `FuelTankDip` (physical inventory counts, variance bookings).
- **Reconciliation:** `FuelDailyReconciliation` (aggregates shifts + dips per branch per day).

**Scoping:** All branch-scoped (hard scoped — `companyId + branchId`). `FuelShift` has optional `divisionId`. Branch-uniqueness keyed on `(branch, code)`.

**GL integration:**
- Deliveries → Payable (on POSTED)
- Credit sales → Receivable (when customer + amount set)
- Daily reconciliation does **not** auto-post to GL — operational record only (gap)

**Controls:** `PetroleumShiftControlService` enforces:
- Shifts can't close without nozzle readings
- No duplicate readings
- Closing meters ≥ opening meters
- Daily reconciliation requires no active unclosed shifts + at least one closed shift

**Notable:** `FuelShiftAttendant` is polymorphic — links to User, Employee, or free-text `attendantName` (casual workers). At least one must be set.

### 7.2 Logistics (Itemba Enterprises — `DivisionType.LOGISTICS`)

7 entities, 6 modules. Fleet + trip:

- **Fleet:** `Vehicle` (registration, insurance/license/inspection expiry, linked to `FixedAsset` for depreciation), `DriverProfile` (polymorphic: User or Employee, license details), `Route` (origin/dest/distance/standard rate).
- **Operations:** `Trip` (`PLANNED → DISPATCHED → IN_TRANSIT → COMPLETED → CLOSED`).
- **Trip costs:** `TripExpense` (FUEL, TOLL, LABOR, ACCOMMODATION, OTHER), `TripFuelUsage` (litres, cost, odometer).
- **Maintenance:** `VehicleMaintenance` (service records, next service tracking).

**Strong GL integration:** On Trip CLOSE with customer + revenue > 0, the system **auto-creates a CREDIT SalesOrder**, confirms it, opens a Receivable. Service product `TRANSPORT-SVC` is auto-ensured. Soft-fail (logs warning if it errors).

**Scoping:** `Trip` carries `companyId + divisionId + branchId?`. Vehicle/Driver scoped to `companyId + divisionId` (required).

**Gotchas:** Driver license-expiry tracked but no enforcement on dispatch. Trip cargo description is free-text — weights recorded but no insurance/capacity checks.

### 7.3 Agriculture (Itemba Enterprises — `DivisionType.AGRICULTURE`)

7 entities, 4 modules. Farm operations:

- `Farm` (location, size, ownership type OWNED/LEASED, manager) → `FarmField` (nested, soil/irrigation) → `Crop` (master per company, types: GRAIN/VEGETABLE/FRUIT/CASH_CROP).
- `CropSeason` per farm-field-crop (`PLANNED → LAND_PREPARATION → PLANTED → GROWING → HARVESTING → HARVESTED → CLOSED/CANCELLED`).
- `FarmInputApplication` (fertilizer/chemical/pesticide/seeding, ties to crop season with cost).
- `HarvestRecord` (`DRAFT → SUBMITTED → APPROVED → POSTED`).
- `AgricultureActivity` (general farm work).

**GL integration: deferred.** Input costs and harvest values recorded but **no GL posting wired**. No livestock/animal models. No pest/disease tracking. No crop insurance. Harvest → inventory → sales-order linkage not yet connected.

**Scoping:** All `companyId + divisionId` (required). Branch optional on Farm. Harvest has optional branchId.

### 7.4 Construction (Itemba Enterprises — `DivisionType.CONSTRUCTION`)

9 entities, 4 modules. **Strong GL backbone.**

- `ConstructionProject` (`PLANNED → ACTIVE → ON_HOLD → COMPLETED → CLOSED/CANCELLED`, type RESIDENTIAL/COMMERCIAL/ROAD/etc, with contract value, budget, actual cost).
- `ConstructionSite` (one or more per project).
- `BOQItem` (Bill of Quantities — quantity, unit rate, total).
- `ProjectMaterialIssue` (`DRAFT → SUBMITTED → APPROVED → POSTED` — posts stock → project WIP).
- `ProjectProgressRecord` (% complete updates).
- `ProjectBilling` (milestone invoices → SalesOrder + Receivable).
- `SubcontractorRecord` (supplier subcontracts, paidAmount + outstandingAmount).
- `ProjectCostAllocation` — auto-created when payroll run is paid, captures `allocatedGross + allocatedEmployerStatutory`. Idempotent on `(payrollEntryId, projectId)`. Provides full project P&L: revenue (billing) + costs (material + labor).

### 7.5 Truck Parking (`DivisionType.TRUCK_PARKING`)

5 entities, 5 modules. Operationally complete; GL scaffolded.

- `ParkingFacility → ParkingZone → ParkingRate` (`HOURLY/DAILY/MONTHLY`, time-versioned, manager-approved).
- `ParkingSession` (`ACTIVE → CLOSED`, paymentStatus `UNPAID → PAID`, auto-calculated amount).
- `ParkingPayment` (cash/check/mobile/bank, optional idempotency key, optional cashAccountId).

Sessions optionally link to SalesOrder + Receivable for named customers. ParkingPayment recorded but not posting to GL.

### 7.6 Hospitality (`DivisionType.HOSPITALITY`)

12 entities, 4 modules. Ops complete; GL wiring deferred (W5.5 milestone).

- `HospitalityFacility` (linked to LicensedBusinessUnit).
- Hotel: `Room` (type STANDARD/SUITE/DELUXE, default rate, occupancy), `Guest`, `RoomBooking` (`RESERVED → CHECKED_IN → CHECKED_OUT`, paymentStatus path), `GuestFolio` (running tab `OPEN → CLOSED`), `FolioCharge` (polymorphic sourceType: ROOM/RESTAURANT/BAR/LAUNDRY).
- Restaurant: `MenuCategory`, `MenuItem`, `RestaurantTable`, `RestaurantOrder`.
- Operations: `HousekeepingTask` (`PENDING → SCHEDULED → COMPLETED`).
- `HospitalityPayment` for settlement.

**Folio settlement is the W5.5 gap:** `settlementSalesOrderId` is null today; folio close doesn't yet create a SalesOrder. Schema-flagged.

### 7.7 Real Estate / Rentals (`DivisionType.REAL_ESTATE | RENTAL_SHOPS`)

7 entities, 2 modules. **Data model complete; many NestJS modules missing.**

- `RentalProperty` (OWNED/LEASED/MANAGED, building/shop block/residential/mixed-use/land).
- `RentalUnit` (per property, with rental rate + billing frequency + security deposit).
- `Tenant` (linked to Customer).
- `LeaseAgreement` (tenant + unit + property, with approval).
- `RentInvoice` (`DRAFT → SENT → APPROVED → PARTIALLY_PAID → PAID/CANCELLED` — links to Receivable).
- `RentPayment` (cash/bank/mobile, idempotencyKey, optional cashAccountId).
- `PropertyMaintenance`.

**Gap:** `lease-agreements`, `rent-invoices`, `rent-payments`, `property-maintenance` NestJS modules don't exist as separate modules — only the data models. No automated monthly invoicing. No deposit escrow. No aging.

### 7.8 Westsides (`DivisionType.BEVERAGES | HARDWARE_BUILDING`)

Westsides is a **horizontal operational layer**, not a vertical. The module re-exports `sales-channels`, `price-lists`, `customer-price-agreements`, `product-batches`, `stock-damage`, `returnable-packages`, `package-movements`. No POS terminal integration. No promotions engine. The `westsides-dashboard` and `westsides-reports` modules exist as simple aggregations.

**Returnable packages** (beer bottles, water crates) are asset-tracked via `ReturnablePackage` + `PackageMovement`. Batch tracking via `ProductBatch` (manufacture date, expiry, batch code) supports FIFO/LIFO valuation.

---

## 8. Finance Architecture

(Detail in the standalone [FINANCIAL_MODULE_AUDIT.md](../FINANCIAL_MODULE_AUDIT.md). Summary here.)

### The GL stack

- **`accounting-engine`** — `PostingEngineService` with handler-based GL posting and period-lock awareness. Well-designed.
- **`journal-entries`** — Full CRUD with debit=credit validation. **Direct creation bypasses period locks** — gap (open).
- **`posting-rules` + `posting-runs`** — CRUD complete; `postRun()` is a status update, not an executor.
- **`accounting-periods` + `fiscal-years` + `accounting-locks` + `period-close`** — All present. Period close sets status `CLOSED` but does **not** auto-activate a lock (gap).

### Posting integration matrix

| Module | Posts to GL | Notes |
|---|---|---|
| expenses (on pay) | ✓ | DR expense / CR cash |
| audit-adjustments | ✓ | Balanced JE on post |
| intercompany-transactions | ✓ | Injected |
| harvest-records, project-material-issues, subcontractors, loan-repayment-schedules | ✓ | Domain handlers |
| **supplier-invoices.approve()** | ✗ | Creates Payable but no JE |
| **fixed-assets purchase** | ✗ | No capitalization JE |
| **depreciation** | ✗ | Schedule generated, no posting |
| **receivables/payables (manual)** | ✗ | No AR/AP control account posting |
| **tax / tax-auto-apply** | ✗ | No tax liability posting |
| **three-way-matching variances** | ✗ | Variance logged, no adjustment JE |

About half of transaction modules don't post — this is the single biggest financial-module gap.

### Hierarchy gap in finance

Most financial tables carry only `companyId`:
- Receivable, Payable, SupplierInvoice, CashAccount, BankAccount, Loan, ChartOfAccount — all missing `divisionId/branchId`.
- JournalEntry, JournalEntryLine, Expense, FixedAsset — correctly scoped to all four levels.

This breaks the "data builds up from branch to group" principle for AR, AP, cash, and tax accounting.

### Reports

- Trial Balance, P&L, Balance Sheet, Cash Flow (indirect method) — all exist at company level.
- Group-level versions of TB / P&L / BS exist (in `financial-reports.service.ts:469-664`).
- Group consolidation lacks intercompany elimination logic.
- No drill-down from any statement line to its journal entries.
- No comparatives (YTD/MTD/prior-period).
- Tax returns: status workflow but no auto-population from journal data; no XML/PDF export.
- Scheduled-reports accepts `exportFormat: PDF | EXCEL` but `print-engine` only emits HTML. PDFs never materialize.

### Closure status

The financial-module audit is open (40-finding-strong); the bug-hunt audit's closure addendum closed all 40 of its findings via code fixes, guardrails, or policy controls. They are different reports — the financial audit's recommendations are still pending.

---

## 9. HR & Payroll

(Detail in the standalone [auth-role-architecture.md](auth-role-architecture.md). Summary here.)

### Data model

- **`Employee`** — Rooted to Company (mandatory), optional Division/Branch/Department/Position. Carries Tanzania-specific fields: NIDA, passport, TIN, NSSF, NHIF, PSSSF, WCF, HESLB registration, tax-residency, disability.
- **`MobileMoneyAccount`** — one+ per employee, exactly one `isPrimary`. E.164 MSISDN for M-Pesa/Airtel/Tigo APIs.
- **`EmployeeAssignment`** — current/historical assignment to Division/Branch/Department/Position with date ranges.
- **`EmploymentContract`** — `DRAFT → ACTIVE → TERMINATED`.
- Master data: `Position`, `Department`, `LeaveType`, `AllowanceType`, `DeductionType`.

### Payroll

- **`PayrollPeriod`** — `OPEN → CALCULATED → APPROVED → CLOSED`, company-scoped.
- **`PayrollRun`** — `DRAFT → CALCULATED → APPROVED → PAID`, types: REGULAR/BONUS/SETTLEMENT. Carries `journalEntryId` (accrual JE) and `paymentJournalEntryId` (payment JE).
- **`PayrollEntry`** — per employee per run. Gross/deductions/net + `payrollStatutoryLines` (PAYE/NSSF/SDL/WCF/NHIF/PSSSF/HESLB breakdown).
- **`PayrollStatutoryLine`** — basis (GROSS/BASIC/PENSIONABLE/TAXABLE_INCOME), employee + employer contribution, applied rate, calc detail JSON.
- **`SalaryPayment`** — one+ per entry, `DRAFT → PAID`.
- **`SalaryAdvance`** — request → approved → paid → recovered via payroll deduction.

### GL integration: ✓ FULLY IMPLEMENTED

`PayrollPostingsService.postRun()` on approve creates accrual JE:
- **Debits:** Salaries Expense (6000), NSSF Employer (6040), PSSSF Employer (6045), WCF Expense (6050), SDL Expense (6060), NHIF Employer (6070).
- **Credits:** PAYE Payable (2210), NSSF Payable (2220), PSSSF Payable (2225), WCF Payable (2230), SDL Payable (2240), NHIF Payable (2250), HESLB Payable (2260), Salaries Payable (2270).

Idempotent on `payrollRunId`. On pay, creates `paymentJournalEntryId` — DR Bank / CR Salaries Payable.

### HR architecture (canonical role doc)

One **Group HR Director** for the entire group. **No Company HR Manager** — that role does not exist. **Division Managers** carry HR authority for their staff (recruitment within band, leave, attendance, performance, first-line discipline, payroll inputs). **No HR at Branch level** — Branch Managers can record attendance but cannot hire, fire, discipline beyond informal coaching, approve leave, or change compensation. A **direct grievance channel** routes from employees to Group HR Director, bypassing the Division Manager.

### Gaps

- **No leave-balance table** — cannot answer "how many days used/remaining?" per employee/type (HIGH).
- **Payroll not segmented by Division** — runs are company-wide; Division Managers cannot run payroll for their division only (MEDIUM).
- **Tax transactions don't auto-post to GL** (`TaxTransaction.journalEntryId` exists but no service wires it).
- **Approval engine underutilized** — payroll, leave, and tax workflows use inline approval (`approvedById` field) instead of `ApprovalRequest` through the engine.
- **Disciplinary actions and medical exams** — schema exists but no service/controller wired.

---

## 10. Tax & Compliance

### Tax architecture

- **`TaxType`** — `PAYE_MAINLAND | PAYE_ZANZIBAR | NSSF | PSSSF | WCF | SDL | NHIF | HESLB | VAT | ...` Each with flags: `isRecoverable, isWithholding, appliesToPayroll`.
- **`TaxRate` + `TaxRateBracket`** — progressive brackets for PAYE (fromAmount/toAmount/marginalRate/fixedAmount/tierOrder).
- **`TaxCode`** — maps TaxType → GL account.
- **`TaxTransaction`** — DR/CR record, sourceType MANUAL/PAYROLL/SALES/PURCHASE, direction INPUT/OUTPUT.
- **`TaxFilingPeriod`** — `OPEN → PREPARED → REVIEWED → APPROVED → SUBMITTED → CLOSED` with multi-approver workflow.
- **`TaxReturn`** — `DRAFT → PREPARED → REVIEWED → APPROVED → SUBMITTED → PAID → CLOSED`. **No GL posting service.**
- **`CompanyTaxRegistration`** — TIN, VAT, sector-specific registrations per Company.
- **`StatutoryDeductionRule`** — Company-scoped or global. Defines PAYE/NSSF/SDL calc method + rates. `effectiveFrom/To` gating.

### Compliance

- **`ComplianceObligation`** — linked to Company (+ optional Division/Branch). Types: TAX_FILING, STATUTORY_AUDIT, LICENSE_RENEWAL, etc. Recurrence: MONTHLY/QUARTERLY/ANNUAL/NONE.
- **`ComplianceEvent`** — audit trail per obligation.
- **`AuditEvidencePack`** — pack with items linking to entities; manual curation, no auto-link to statement runs.

Frontend has 19+ sub-pages under `/compliance/` — tax authorities, tax registrations, tax codes, tax types, tax rates, tax-filing-periods, statutory-rules, compliance calendar, cockpit, obligations, events, document requirements, document status, OSHA registrations, evidence packs, exports, reports.

---

## 11. The Cross-Cutting Platform

### Common services (`backend/src/common/services/`)

The foundational shared utilities:

- **`CompanyScopeService`** — multi-tenant row-level security; `companyWhereForUser()`, `applyCompanyScopeWhere()`, `assertCanAccessCompany()`. The most-used service in the codebase.
- **`PermissionCacheService`** — local Map cache + Redis pub/sub for cluster-wide invalidation. 60s TTL.
- **`AccountResolverService`** — semantic CoA lookup by role (CASH_ON_HAND, AR_CONTROL) — tries `accountSubType` first, then fallback Tanzanian SME codes. Prevents hardcoded account numbers.
- **`AuditActionHelper`** — `auditFor(entityType, verb)` returns canonical action string + severity. Entity-sensitivity matrix (HIGH for BankAccount/Loan, MEDIUM for JournalEntry, LOW for Customer) + verb floor (POST/REVERSE/APPROVE all HIGH). Adoption uneven across newer modules.
- **`AccountingControlService`** — period/date/lock/company validation before JE create/update/post/reverse/delete.
- **`PetroleumShiftControlService`** — shift workflow enforcement.
- **`ObservabilityBudgetService`** — trace budgets for API requests/DB queries/reports/jobs.
- **`EncryptionService`** — APP_ENCRYPTION_KEY-driven, v1/v2 versioned ciphertexts.
- **`WebhookSignatureService`** — constant-time secret verification.
- **`StagedImportValidationService`** — staged data import validation.
- **`EmailService`** — SMTP envelope.

### Automation & Approvals

- **`AutomationRule`** — rule config with status + conditions JSON. `AutomationRun` records execution. **No visible evaluator/dispatcher** in the engine — rules likely consumed by a background-jobs consumer.
- **`ApprovalEngineService`** — multi-step orchestration, `REQ-{timestamp}-{nonce}` request numbers, maker-checker enforced (requester ≠ approver), notifies via NotificationsService on transitions.
- **`ApprovalWorkflow + ApprovalStep`** — workflow definitions; **delegation logic appears stubbed**.
- **`ApprovalDelegation`** — time-bound delegation records.

**Adoption gap:** Payroll, leave, tax workflows bypass the approval engine and use inline `approvedById` fields.

### Notifications & Alerts

- **`Notification`** — type (enum), priority (NORMAL/HIGH), status (UNREAD/READ/DISMISSED), linked entity. Sends email if `emailAddress` provided.
- **`AlertRule`** — alertType, entityType, daysBefore, condition JSON, target (ROLE/PERMISSION/USER), frequency (HOURLY/DAILY/WEEKLY). **No visible evaluator** — likely consumed by background-jobs.
- **`AlertEvent`** — fired alert records.
- **`ExternalMessage`** — SMS/email/push/WhatsApp queue with status `QUEUED → DELIVERED/FAILED/BOUNCED`. **No visible dispatcher**.
- **`MessageTemplate`** — referenced but not examined.

### Integration platform

- **`IntegrationApiController`** — external gateway protected by `ApiKeyAuthGuard` + `@RequireApiScope`. Routes: `/integration/payments`, `/integration/messages/delivery-callback`, `/integration/webhooks/events/{id}`. companyId always from authenticated ApiKey (never from request body).
- **`ApiKey`** — scopes array, keyPrefix (UI masking), keyHash (HMAC with APP_ENCRYPTION_KEY pepper). `lastUsedAt`, `expiresAt`, `revokedAt`.
- **`WebhookEndpoint`** — webhookCode, allowedEvents JSON, secret hash. `WebhookEventControlService` validates constant-time secret + active + allowed event + duplicate event ID + replay eligibility.
- **`WebhookEvent`** — inbound event records. **No visible outbound webhook deliverer.**
- **`IntegrationConnection + IntegrationProvider + IntegrationMapping + IntegrationEvent`** — provider connection lifecycle, field translation rules. Lifecycle not fully examined.
- **`ExternalPayment`** — payment-gateway integration; trusted-confirmation flow now idempotent (per bug-hunt closure).

### Documents & Print

- **`DocumentsService`** — multer upload, storage to `STORAGE_LOCAL_PATH/documents` (or S3 in prod), polymorphic owner (ownerType/ownerId), soft-delete (`deletedAt`).
- **`DocumentTemplate + GeneratedDocument`** — template definitions and rendered output records.
- **`PrintEngineService`** — only emits HTML. **Promised PDF/Excel never materialized.** Scheduled-reports queue jobs with `exportFormat: PDF | EXCEL` but the engine doesn't produce the artifact.
- **`DocumentNumberSequencesService`** — separate from `EntityCodeGeneratorService`; was found racing in bug-hunt (now fixed).

### BI & Analytics

- **`BiService`** — executive summary, group summary, dataset queries (cash_position, inventory_summary, asset_summary, receivables_aging). Raw data; no aggregation/charting.
- **`DashboardService`** — executive summary with ~78 `Promise.all` queries (one of the heaviest endpoints). Uses scope helpers (companyEntityWhere, branchEntityWhere).
- **`DashboardDefinitions + DashboardWidgets + UserDashboardPreferences`** — config-driven dashboards.
- **`KpiIndicator + KpiSnapshot`** — KPI definitions and time-series snapshots.
- **`AnalyticsSnapshotRun`** — snapshot orchestration (companyId now required + scoped per bug-hunt closure).
- **`ExecutiveInsight`** — high-level findings surfaced in dashboards.
- **`ReportDefinition + ReportRun + SavedReportView + ScheduledReport`** — report metadata, executions, saved filters, scheduled instances. Scheduled reports enqueue jobs that produce HTML (no real PDF/Excel yet).
- **`DataQuality + DataQualityCheckRunnerService`** — six checks: negative inventory, missing bank accounts, stale draft journals (>7d), overdue receivables, stuck reports (>30m), unposted fuel reconciliations (>2d). Deduplicated by `(entity, type, status)`. Audit logs DATA_QUALITY_CHECK_RUN.

### Tasks & Jobs

- **`Task`** — generic task model (likely user-facing TODOs).
- **`BackgroundJob`** — PostgreSQL-backed queue. Status: `QUEUED → RUNNING → COMPLETED/FAILED → RETRYING → DEAD_LETTER`. Idempotency via `idempotencyKey`. Tracks `attempts/maxAttempts/scheduledAt/correlationId`.
- **`JobWorker`** (NestJS service, in-process when `JOB_WORKER_ENABLED=true`) — polls every 2s with batch of 5, uses `SELECT FOR UPDATE SKIP LOCKED` for multi-instance safety. Stale-recovery for jobs stuck `RUNNING > 30min`.
- **Handlers:** `backup-run.handler.ts`, `notification-dispatch.handler.ts`, `data-export.handler.ts`, `restore-test.handler.ts`, plus likely report-generation, automation-run, alert-evaluation, bi-snapshot, webhook-processing, integration-retry, email-send, sms-send.

### Support, Help, Training (Milestone 16)

- **Support:** dashboard (totalTickets, openTickets, urgentTickets, overdueTickets), SLA cutoffs per priority. Status: `OPEN → IN_PROGRESS → WAITING_USER → RESOLVED → CLOSED`.
- **Help center:** help-articles, user-manuals (16 manuals seeded), search, rating.
- **Training:** 10 courses, 8 guided walkthroughs, training environment, my-training. Status: `ASSIGNED → IN_PROGRESS → COMPLETED/CANCELLED`.

### Mobile / Offline

- `MobileSession`, `DeviceRegistration`, `OfflineSync` — backend conflict detection exists; frontend UI basic. Mobile app not yet implemented (responsive web provides usable mobile experience).

### Settings & Catalogs

- `SettingsCatalog` — tenant configuration (feature flags, integrations enabled).
- `UserPreference` — per-user dashboard/menu/default-context preferences.
- `Documentation` — meta documentation catalog.

---

## 12. Infrastructure & DevOps

### Bootstrap & security

Already covered in §2. Key wrinkle: in production, `env.validation.ts` enforces:
- Distinct secrets (APP_ENCRYPTION_KEY ≠ JWT secrets ≠ 2FA key ≠ refresh pepper)
- No placeholder values (`FORBIDDEN_PROD_SECRETS` set)
- HTTPS-only origins (no `http://`, no `localhost`)
- SMTP all-or-none
- Minimum key lengths (JWT ≥32 chars, encryption ≥32 chars)
- Fast-fail on bootstrap

### Background processing

`JobWorker` polls PostgreSQL every 2s, leases 5 jobs at a time via `FOR UPDATE SKIP LOCKED`. Stale recovery at 30 min. Idempotent on `idempotencyKey`. Handlers wired for backup-run, notification-dispatch, data-export, restore-test (and likely more — full handler set not examined).

### Monitoring

`MonitoringService` aggregates a **readiness score (0–100)** with penalty per blocker:

| Category | Critical blocker | Warning blocker |
|---|---|---|
| Health | 1+ critical health checks | Warning/stale/unknown/0 checks |
| Errors | Open critical errors | Open high errors |
| Security | Open critical events | Open high events; 24h critical events |
| Backups | 0 active jobs / overdue | Failed runs in last 24h |
| Jobs | Dead-letter jobs | Failed/stale/queued >1h |
| Retention | — | 0 active policies; failed archives |

Status classification: `critical` (any critical blocker OR score < 80), `degraded` (warning blockers only), `ok` (clean).

Public health is a 3-tier check: ping DB, count critical issues, return `{status, checks, uptime, timestamp}`.

### Error logs

`ErrorLog.stackTrace` only visible with `error_logs.sensitive.view` permission. 5xx logged with stack; <5xx logged as warning. Bug-hunt closure added a secret scrubber for stack-context logging.

### Backup / DR

- **`BackupJob`** — `backupType: DATABASE/FILE_STORAGE/CUSTOM`, `schedule: MANUAL/DAILY/WEEKLY/MONTHLY`, `storageTarget: LOCAL/S3`, `retentionDays`.
- `BackupRun` records — `backupRunNumber`, status, size, SHA-256 checksum.
- `RestoreTest` — restore to temp schema, verify row count + checksum.
- `RetentionPolicy` — `legalHold` flag prevents deletion regardless of age.
- `DataArchiveJob` — moves old records to archive schema/external storage.
- `DisasterRecovery` — recovery procedures, runbooks, RTO/RPO.

### Security ops

- `SecurityEvent` — `SE-{timestamp}`, eventType (LOGIN_FAILURE, PERMISSION_DENIED, SUSPICIOUS_ACTIVITY, etc.), severity, status (`OPEN → REVIEWED → RESOLVED`), reviewedBy/resolvedBy.
- `ActiveSession` — tracks concurrent sessions by IP/device/location; revocation logic; revocation spec test validates multi-session cleanup.
- `UserSecurityProfile` — 2FA enabled, MFA method, trusted devices.
- `SecurityPolicy` — password requirements, IP allow/geo-block rules, session timeouts.
- `DataIsolation + DataIsolationTest + DataIsolationIssue` — multi-tenant test framework with severity-classified findings. Bug-hunt closure scoped these to group-only.

### Launch readiness & QA

- `LaunchReadiness + LaunchReadinessItem + LaunchBlocker + LaunchAssessment` — pre-go-live checklist (backup tests, security policies set, data isolation verified, etc.).
- `ProductionReadiness` — schema/index/connection-pool/Caddy/healthcheck/migration validation.
- `FinalQADashboard` — QA test suite results aggregation.
- `GoLiveSignoff` — stakeholder sign-off, immutable.
- `QaTestSuite + QaTestCase + QaTestRun + QaTestResult` — 22 QA suites seeded.

### Test coverage

- **41 unit `.spec.ts` files** + **6 main e2e suites** (auth, company-isolation, api-read-smoke, critical-workflows, finance, plus others).
- Total backend test count: **270 passing** per the bug-hunt closure addendum.
- E2E disables `ThrottlerGuard` to avoid rate-limit failures in heavy runs.
- Frontend tests: Vitest unit/component; no browser-driven E2E.

### Deployment

Multi-stage Docker (builder → migration → production). `backend-migrate` Compose service runs Prisma migrations gated by `depends_on: service_completed_successfully` before `backend` boots.

Pre-deploy verification:
- `npm run verify` (typecheck, build, Prisma validate)
- `npm run verify:deploy` (env contract, secret fail-fast, healthcheck defs)
- `npm run smoke:deploy -- --allow-local` (disposable local Compose run)

Rollback: UI button (Deployment → Releases → Rollback) or manual Compose image-tag revert.

### Performance & scalability

- `Performance + PerformanceTrace` — request traces, slow-trace count, observability budget.
- `Scalability + LoadTest` — manual load test harness.
- `CacheManagement` — `CacheEntry` with `cacheKey/cacheType/expiresAt/scopeHash/companyId`. Bulk invalidation by company.
- Redis cache module registered globally.

### Known infrastructure debt

- No external job queue (PostgreSQL works to ~5 jobs/2s — BullMQ upgrade path noted but not implemented).
- 30-min stale recovery is hardcoded.
- No automated log rotation (ErrorLogs / AuditLogs / PerformanceTraces grow indefinitely; DataArchiveJob can prune, but not automated).
- Refresh-token pepper is distinct but has no rotation mechanism.
- `pg_dump` for backups is single-writer (slow for large DBs).
- No circuit breakers for external integrations.
- DataIsolationTests run on-demand only — no scheduled periodic runs.

---

## 13. The Hardening Story (Phases 1–6)

This is the historical narrative of how the codebase got to today.

- **Phase 0 — Monorepo scaffold** (✅). Established baseline; identified as beta/pre-pilot (frontend build failed, tests timed out, Compose unsafe, isolation uneven).
- **Phase 1 — Production no-go cleanup** (✅). Fixed frontend prod build (JSX entity escaping, Suspense boundary). Stabilized frontend tests. Hardened production Compose with fail-fast secrets. Added 8 P0 regression tests pinning company-scope, inventory atomicity, job-worker, API-key auth, permission cache. Backend tests: 162 passing in 17s.
- **Phase 2 — Data correctness & transactional integrity** (🔄). Inventory: direction classification corrected (PURCHASE_RETURN outbound), `FOR UPDATE` row lock, rejected negative/zero/reserved quantities, weighted-average costing preserved. Fuel-shift close wrapped in single transaction, idempotent, prerequisites validated. Payroll/accounting side effects pending.
- **Phase 3 — Runtime control plane** (✅). Encryption hardened (`APP_ENCRYPTION_KEY` strict, versioned ciphertexts v1:iv:tag:ct, fast-fail). TOTP migrated AES-CBC → AES-GCM with admin re-encrypt endpoint. API-key auth wired. Background jobs/exports/backups have working handlers. Role assignment has UI/API. Sessions visible & authoritative. Permission cache propagates revocations. Login constant-time.
- **Phase 4 — Test floor & CI gates** (✅). Stabilized runners (`--forceExit`, 17s suite). 8 P0 regression specs. Static-analysis rule for unsafe `if (companyId) where.companyId = companyId` patterns (baseline 194 → 190).
- **Phase 5 — Enterprise hardening** (🔄). Company-scope refactor wave 1: customers, sales-orders, suppliers, products → `CompanyScopeService`. Backup worker verifies restore integrity (pg_dump → checksum). Replaced `dangerouslySetInnerHTML` XSS in print engine. Canonicalized audit-action naming.
- **Phase 6 — ERP parity** (🔄). Wave 2: payroll-runs, payroll-entries, salary-payments, salary-advances, purchase-orders, GRN, supplier-invoices → `CompanyScopeService`. Per-exportType extraction for 6 export types. `auditFor()` helper adopted. Static-analysis rule for direct `prisma.journalEntry.create` outside canonical posting modules.

### Remaining hardening (per docs/hardening-* files)

- **Financial control:** `AccountingControlService` validation before all JE actions. Reversals blocked if target date locked.
- **Tenant isolation iteration 2:** Auth user carries `roleScopes/companyId/companyAccess`. Group-Control modules require GROUP scope.
- **Company operations workflow iteration 4:** `PetroleumShiftControlService`.
- **Performance & observability iteration 9:** `ObservabilityBudgetService`, structured request logging, cache invalidation policies (in flight).
- **Reporting & BI iteration 6:** `DataQualityCheckRunnerService`.
- **Integrations & automation iteration 7:** `WebhookEventControlService`. Inbound webhook ingestion controller, delivery-attempt tracking, API scope enforcement, outbound webhook signing, automation retry/backoff — pending.

### Bug-hunt closure

The bug-hunt audit (2026-05-18) closed all 40 findings via code fixes, guardrails, or policy controls. Verification commands documented:
- `npx prisma validate`
- `npx prisma generate`
- `npm run verify:env`
- `npm --prefix backend run build`
- `npm --prefix backend test` (270 passing)
- `npm --prefix frontend run build`

---

## 14. Current State Assessment

### What works well

- **Architecture is sound.** Four-level hierarchy is explicit and enforced. `CompanyScopeService` is the right abstraction. `PostingEngineService` is well-designed. `EntityCodeGeneratorService` is atomic and reset-aware.
- **Bug-hunt closure is real.** 40/40 closed with code fixes / guardrails / policy controls + a verification pipeline.
- **Payroll → GL is fully wired.** This is one of the most complete subsystems — Tanzanian statutory deductions (PAYE/NSSF/PSSSF/SDL/WCF/NHIF/HESLB) all post correctly on payroll-run approve.
- **Phase 1–6 hardening narrative is coherent.** Successive waves of `CompanyScopeService` adoption, atomicity hardening, encryption upgrades, test floor — this is a real maturity arc, not a marketing story.
- **Petroleum, Logistics, Construction are mature verticals.** They have full lifecycle, controls, and GL integration where applicable.
- **Test infrastructure is real.** 270 passing tests, e2e suites for auth/isolation/critical-workflows/finance, static-analysis guardrails preventing regressions.

### What still needs work

- **Hierarchy gap on financial tables.** Receivable, Payable, SupplierInvoice, CashAccount, BankAccount, Loan, ChartOfAccount all lack `divisionId/branchId`. Roll-up from branch upward is broken for these tables. This is the single biggest gap.
- **Half the transaction modules don't post to GL.** Supplier invoices, fixed-asset purchase, depreciation, tax, manual AR/AP, three-way-match variances — all skip the posting engine. The accounting engine is great; adoption is partial.
- **Period close is on the honor system.** `JournalEntry.create` doesn't check `AccountingLocksService`. Period close sets status but doesn't auto-activate the lock.
- **No drill-down from statements to JEs.** No comparatives. Tax returns are status-only, not auto-computed. Scheduled reports promise PDF/Excel but `print-engine` only emits HTML.
- **Approval engine underutilized.** Payroll, leave, tax use inline approval instead of `ApprovalRequest`. Engine exists; adoption is the bottleneck.
- **CSS / hardening waves not finished.** ~180 of 200 services are still on the unsafe `if (companyId) where.companyId = companyId` pattern; only ~11 fully cleaned.
- **Several modules are data-models-only.** Rental: `lease-agreements`, `rent-invoices`, `rent-payments`, `property-maintenance` have schema but no NestJS module. Hospitality folio settlement is W5.5-deferred. Agriculture has no GL posting wired. Truck parking GL is scaffolded but not active.
- **Westsides isn't a vertical.** It's a re-export bundle. No POS, no promotions engine, no fulfillment workflow specific to retail.
- **Frontend gaps.** 9 finance pages are read-only stubs; 12+ backend modules have no UI (tax-anomaly-detection, tax-auto-apply, tax-filing-engine, three-way-matching, audit-evidence-packs, debts, customer-credit-profiles in finance form, etc.). No branch/division scope filter on any finance page.
- **JWT scope priority order is wrong.** `['GROUP', 'COMPANY', 'BRANCH', 'DIVISION']` — BRANCH outranks DIVISION; should be `['GROUP', 'COMPANY', 'DIVISION', 'BRANCH']`.
- **Frontend `AuthUser` drops `companyAccess/divisionAccess/branchAccess/roleScopes`** — UI cannot easily render scope-aware filters.
- **Documentation drift.** Phase numbering doesn't align with the 16-milestone map. `.env.production.example` references old domain. Health-check URLs hardcoded as `localhost:3001`. Constant-time login mentioned in docs but not in `auth.service.ts`.

### Production-readiness verdict

**Stabilizing on production posture but not yet live.** Phase 1 unblocked the basics; Phases 2–6 hardened high-risk paths; the bug-hunt closure confirms remediation. Remaining work is breadth (finish company-scope refactor across all services), depth (wire posting for half-still-missing modules, fix hierarchy on financial tables), and several specific operational concerns (no PDF/Excel materialization, period locks on honor system, several stub frontend pages).

### Adoption maturity score (rough)

| Layer | Maturity | Notes |
|---|---|---|
| Identity & Governance | ✓ Mature | Full RBAC + 4-level scope + audit + 2FA + API keys |
| Operations backbone | ✓ Mature | All state machines complete, frontend full CRUD |
| Petroleum vertical | ✓ Mature | Full lifecycle + controls + partial GL |
| Logistics vertical | ✓ Mature | Strong GL integration via auto-SalesOrder |
| Construction vertical | ✓ Mature | Strong project P&L (revenue + cost allocation) |
| HR & Payroll | ✓ Mature | Full statutory deduction handling, GL posting |
| Agriculture vertical | 🟡 Partial | Data complete; GL deferred; no livestock |
| Hospitality vertical | 🟡 Partial | Ops complete; folio settlement deferred (W5.5) |
| Rental vertical | 🟡 Partial | Schema only; NestJS modules missing |
| Truck Parking vertical | 🟡 Partial | Ops complete; GL scaffolded |
| Westsides vertical | 🟡 Partial | Utility layer only; no POS / promotions |
| Finance / GL | 🟡 Partial | Engine sound; ~50% of modules don't post |
| Reports & BI | 🟡 Partial | Core statements exist; no drill-down, no real export |
| Approvals | 🟡 Partial | Engine built; payroll/leave/tax bypass it |
| Integrations | 🟡 Partial | API gateway works; outbound webhook delivery unclear |
| Mobile / Offline | 🟡 Partial | Backend conflict detection; frontend basic |
| Infrastructure & DevOps | ✓ Mature | Docker + Caddy + healthchecks + readiness scoring |
| Tax & Compliance | 🟡 Partial | Tax types + rates + brackets present; returns are status-only |

---

## 15. The 16 Milestones (Compact Map)

(Per the documentation deep-study.)

1. Monorepo scaffold (Phase 0)
2. Frontend production build (Phase 1)
3. Frontend test execution (Phase 1)
4. Production env path / Compose hardening (Phase 1)
5. Backend test stabilization (Phase 1)
6. P0 regression test floor (Phase 4)
7. Inventory stock atomicity (Phase 2)
8. Fuel-shift close atomicity (Phase 2)
9. Encryption key hardening (Phase 3)
10. TOTP encryption upgrade (Phase 3)
11. Company-scope refactor wave 1 (Phase 5)
12. Company-scope refactor wave 2 (Phase 6)
13. Data export real extraction (Phase 6)
14. Backup restore verification (Phase 5)
15. Audit action canonicalization (Phase 6)
16. GL posting funnel guardrail (Phase 6)

Plus the extension work for QA, Launch Readiness, Help Center, Training, Support that lands under "Milestone 16" umbrella in the README.

---

## 16. Architectural Patterns Worth Internalizing

These are the patterns to recognize when reading the codebase.

1. **`CompanyScopeService.applyCompanyScopeWhere(where, user, requestedCompanyId)`** — the canonical multi-tenant filter. Every list/detail endpoint that reads company-scoped data passes through this. If you see `if (companyId) where.companyId = companyId`, that's the unsafe pattern being phased out (~180 occurrences remaining).

2. **`EntityCodeGeneratorService.next({ entityType, companyId, tx })`** — for transaction-document numbers. Atomic, race-safe, reset-aware. Must be called inside the same transaction that creates the entity. (`DocumentNumberSequencesService.nextNumber()` is a separate sequence for documents — fixed in bug-hunt closure.)

3. **`PostingEngineService.post(...)`** — for all GL postings. Handler-based, period-lock aware. If a domain module is creating financial transactions but not calling this, it's likely a gap.

4. **`auditFor(entityType, verb)` → `AuditLogsService.log(...)`** — canonical audit pattern. Auto-derives severity. Newer modules should use it; older modules may still write audit logs ad-hoc.

5. **State machine on every transactional entity.** Every business document (SalesOrder, PO, GRN, SupplierInvoice, FuelShift, RoomBooking, LeaseAgreement, RentInvoice, ParkingSession, etc.) has an explicit status enum and lifecycle transitions. Look for `@RequirePermissions('module.confirm')` etc. on `PATCH /:id/confirm` controller endpoints.

6. **Polymorphic actors** (e.g., `FuelShiftAttendant` linking to User OR Employee OR free-text name; `DriverProfile` linking to User OR Employee). Used when an operational role can be filled by a regular employee, a system user, or a casual worker. At least one must be set.

7. **Idempotency via `idempotencyKey`** — on `ExternalPayment`, `ParkingPayment`, `BackgroundJob`. Optional but recommended for retry-safe writes.

8. **`FOR UPDATE SKIP LOCKED`** for multi-instance worker leasing in `JobWorker`. Also `FOR UPDATE` for inventory balance mutations.

9. **Period-lock + accounting-control gates.** `AccountingControlService.assertPostingAllowed()` should be called before any JE posting. Currently called from posting-engine handlers but **not** from direct `journal-entries.service.create()` — gap.

10. **Soft-delete via `deletedAt`** on ~35+ tables. Prisma middleware now centralizes the filter (bug-hunt closure §4.7).

11. **Compose service dependencies** (`depends_on: service_completed_successfully`) — `backend-migrate` runs Prisma migrations before `backend` boots. This is how schema deploys happen safely.

12. **The `CompanyScopeService` family** for assertions: `isGroupScoped`, `assertGroupScoped`, `assertCanAccessCompany`, `accessibleCompanyIds`, `companyWhereFor`.

---

## 17. Mental Models for Working in This Codebase

### When adding a new feature

Ask in this order:
1. **What's the scope?** Group / Company / Division / Branch — pick the right level. If unsure, default to Branch and let it roll up.
2. **Does it post to the GL?** If it's a financial event, find the right handler in `PostingEngineService` and wire it. Don't write to `journalEntries` directly.
3. **Does it need an audit log?** Almost always yes — use `auditFor(...)`.
4. **Does it need approval?** If so, route through `ApprovalEngineService.createApprovalRequest()`, not an inline `approvedById` field.
5. **Does it need a document number?** Use `EntityCodeGeneratorService.next()`.
6. **Does it have a status?** Define the enum, write the state machine, gate transitions with `@RequirePermissions`.
7. **Multi-tenant?** Use `applyCompanyScopeWhere` on every read; check `assertCanAccessCompany` on every write.
8. **Run in background?** Define a handler under `job-worker/handlers/` and enqueue via `BackgroundJobsService`.

### When debugging

- **Permission-denied for a known-good user?** Check `roleScopes` and `companyAccess` on the JWT payload. Then check `permission-cache` (60s TTL).
- **Period rejected my transaction?** Check `accounting-locks` table for ACTIVE locks covering that date. Check `period-close` status.
- **Number collision?** Should be impossible if using `EntityCodeGeneratorService.next()` inside the transaction. If using `DocumentNumberSequencesService.nextNumber()`, it's now atomic too.
- **Cross-tenant data showed up?** Look for the `if (companyId) where.companyId` pattern — that's the bug. Replace with `applyCompanyScopeWhere`.
- **Background job stuck?** Check `BackgroundJob.status` — RUNNING > 30 min is auto-recovered to QUEUED. If DEAD_LETTER, retry manually via UI.

### When reading the schema

The Prisma schema is **14,000+ lines** across one file. Key landmarks:
- Enums first (lines 1–~150) — `RoleScope`, `AccessLevel`, `CompanyStatus`, `DivisionType`, `BranchType`, `CurrencyCode`, etc.
- Hierarchy entities ~316–800 (Group, Company, Division, Branch, CompanyProfile)
- Identity & access ~800–1300 (User, Role, Permission, UserRole, UserCompanyAccess, UserDivisionAccess, UserBranchAccess)
- Finance ~1800–2900 (ChartOfAccount, FiscalYear, AccountingPeriod, JournalEntry, JournalEntryLine, CashAccount, Expense, Receivable, Payable, InterCompanyTransaction)
- Operations ~2700–4500 (Customer, Supplier, Product, Inventory*, SalesOrder, PurchaseOrder, Quotation, Proforma, DeliveryNote, SalesCommission)
- Petroleum ~ (FuelTank, FuelPump, FuelNozzle, FuelShift, FuelNozzleReading, FuelTankDip, FuelDelivery, FuelPrice, FuelCreditSale, FuelDailyReconciliation)
- Logistics, Agriculture, Construction ~ (Vehicle, DriverProfile, Trip*, Farm, Crop, CropSeason, ConstructionProject, BOQItem, etc.)
- Westsides & Hospitality & Rentals & Parking ~ (PriceList, ProductBatch, ReturnablePackage, HospitalityFacility, Room, Guest, RoomBooking, GuestFolio, FolioCharge, RentalProperty, LeaseAgreement, RentInvoice, ParkingFacility, ParkingSession)
- HR & Payroll ~7100–7900 (Employee, MobileMoneyAccount, EmployeeAssignment, EmploymentContract, LeaveRequest, PayrollPeriod, PayrollRun, PayrollEntry, PayrollStatutoryLine, SalaryPayment, SalaryAdvance)
- Tax & Compliance ~8400–8900 (CompanyTaxRegistration, TaxType, TaxRate, TaxRateBracket, TaxCode, TaxTransaction, TaxFilingPeriod, TaxReturn, ComplianceObligation, ComplianceEvent, StatutoryDeductionRule)
- Cross-cutting ~9000+ (Notification, AlertRule, ApprovalRequest, ApprovalAction, Integration*, WebhookEndpoint, WebhookEvent, ApiKey, BackgroundJob, RetentionPolicy, ActiveSession, SecurityEvent, BackupJob, etc.)

### When reading the docs

- **Start with:** `README.md`, `docs/architecture.md`, `docs/database-design.md`, `docs/permissions-model.md`, `docs/multi-company-isolation.md` — they set the foundation.
- **Then read:** the hardening docs (`financial-control-hardening.md`, `security-tenant-isolation-hardening.md`, `performance-observability-resilience.md`, `reporting-bi-executive-controls.md`, `integrations-automation-hardening.md`, `company-operations-workflow-hardening.md`) — these are the "decisions made and patterns established" record.
- **Audits:** `audit-report-2026-05-01.md`, `top-down-code-audit-2026-05-01.md`, `production-bug-audit-2026-05-15.md`, plus the closure-addended `docs/bug-hunt-2026-05-18.md` — these are the historical mistakes and how they were resolved.
- **Phase reports:** `phase-0` through `phase-6` and `phase-6-slice-2` — the forensic record of what shipped when.
- **Launch:** `docs/launch/known-limitations.md`, `docs/launch/go-live-plan.md`, `docs/launch/post-launch-support-plan.md`, `docs/launch/final-signoff-template.md`.
- **Admin:** `docs/admin/admin-manual.md`, `docs/admin/role-permission-guide.md`, `docs/admin/deployment-operations-guide.md`, `docs/admin/backup-restore-guide.md`, `docs/admin/environment-variables.md`, `docs/admin/troubleshooting-guide.md`, `docs/admin/company-setup-guide.md`, `docs/admin/go-live-checklist.md`.
- **User manuals:** 16 manuals under `docs/user-manuals/` covering each functional area (finance-accounting, procurement, sales-inventory, petroleum, hospitality, hr-payroll, compliance-tax, approvals-controls, bi-reporting, group-control, integrations, rentals-parking, security-admin, itemba-enterprises, westsides, getting-started).
- **QA:** `docs/qa/qa-strategy.md`, `data-isolation-test-plan.md`, `security-test-plan.md`, `regression-test-plan.md`, `accounting-verification-plan.md`, `user-acceptance-test-plan.md`, `uat-test-users.md`.

### When extending a vertical

For each `DivisionType`, the pattern is the same:
1. Add operational entities scoped to `companyId + divisionId + branchId?`.
2. Add lifecycle status enum + state-machine endpoints (`PATCH /:id/<verb>`).
3. Wire `EntityCodeGeneratorService` for any document numbers.
4. Wire the appropriate `*ControlService` for workflow enforcement.
5. Wire `PostingEngineService` for any GL impact (DR/CR via account roles, not codes).
6. Wire `AuditLogsService` via `auditFor()`.
7. Build the frontend dashboard + CRUD pages.
8. Add a vertical role pack per the role architecture.

---

## 18. Related Documents (One-Stop References)

These are the documents I have produced or that exist canonically in the repo. They form the complete reference layer for understanding the system.

**Produced in this session (in `docs/` or repo root):**
- [`FINANCIAL_MODULE_AUDIT.md`](../FINANCIAL_MODULE_AUDIT.md) — financial module deep audit and fix plan
- [`docs/bug-hunt-2026-05-18.md`](bug-hunt-2026-05-18.md) — 40-finding bug hunt with closure addendum
- [`docs/organization-hierarchy.md`](organization-hierarchy.md) — the Group/Company/Division/Branch entity model
- [`docs/auth-role-architecture.md`](auth-role-architecture.md) — canonical role architecture (HR model: Group-strong, Division-executed, no Company HR, no Branch HR)
- [`docs/codebase-master-study.md`](codebase-master-study.md) — this document

**Existing canonical docs:**
- `README.md` — entry point, setup, repository layout
- `docs/architecture.md` — system architecture
- `docs/database-design.md` — schema overview
- `docs/permissions-model.md` — authorization model
- `docs/multi-company-isolation.md` — tenant isolation
- `docs/aurora-design-system.md` — UI design system
- `docs/development-roadmap.md` + `docs/ROADMAP.md` + `docs/grand-roadmap-next-iterations.md` — roadmap
- `docs/deployment.md` — deployment operations
- `docs/background-jobs.md` — job worker, queues, schedules
- `docs/financial-control-hardening.md`, `docs/security-tenant-isolation-hardening.md`, `docs/performance-observability-resilience.md`, `docs/reporting-bi-executive-controls.md`, `docs/integrations-automation-hardening.md`, `docs/company-operations-workflow-hardening.md`, `docs/data-migration-adoption-hardening.md`, `docs/platform-expansion-hardening.md` — hardening decision records
- `docs/phase-0-stabilization-baseline-2026-05-01.md` through `docs/phase-6-slice-2-progress-2026-05-01.md` — phase progress records
- `docs/master-audit-remediation-plan-2026-05-01.md`, `docs/remediation-register-2026-05-01.md` — remediation tracking
- `docs/ui-ux-refinement-master-plan-2026-05-01.md`, `docs/ux-consolidation-operator-efficiency.md`, `docs/responsive-tables-adoption.md` — UI/UX work
- `docs/release-checklist.md`, `docs/launch/launch-readiness-framework.md`, `docs/launch/known-limitations.md`, `docs/launch/go-live-plan.md`, `docs/launch/post-launch-support-plan.md` — launch
- `docs/admin/*.md` — admin manuals (admin, role-permission, deployment-operations, backup-restore, environment-variables, troubleshooting, company-setup, go-live-checklist)
- `docs/user-manuals/*.md` — 16 user-facing manuals
- `docs/qa/*.md` — QA plans
- `docs/training/*.md` — training plans

---

## 19. Closing Frame

Itemba-R is **an ambitious, well-scoped, methodically hardening multi-tenant ERP for a real Tanzanian group of three legal entities running radically different verticals.** Its architecture is sound — four-level hierarchy, three-axis authorization, atomic number generation, transactional inventory, period-aware accounting engine, double-locked payroll, scoped multi-tenancy via a single canonical service. Its current state is **late-stage hardening: not yet production-live but with a coherent six-phase remediation arc behind it and a clear closure trail for ~40 distinct bug-hunt findings.**

The remaining work clusters around three themes:
1. **Finish the hierarchy** — add `divisionId/branchId` to the financial tables that miss them, so roll-up actually works from branch upward.
2. **Wire the missing posting integrations** — supplier-invoice approval, fixed-asset purchase, depreciation runs, tax transactions, manual AR/AP — these need to call `PostingEngineService` so the trial balance is complete.
3. **Bring the underused engines online** — approval-engine (for payroll/leave/tax), print-engine (for real PDF/Excel), automation-rules (for dispatch), alert-rules (for evaluation).

Beyond those, a long tail of frontend stubs, several data-models-without-services (rental modules, hospitality folio settlement, agriculture GL), the JWT scope ordering bug, and the documentation drift round out the work.

The system is built; the discipline to finish it cleanly is the remaining lift.
