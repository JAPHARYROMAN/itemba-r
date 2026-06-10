# Westsides Tone-Down Plan
**ITEMBA-R → Westsides Company Ltd, Hardware & Building Materials Division (multi-branch)**
Prepared for the owner · 2026-06-10 · All claims traceable to the verified module classification (253 modules), reverse-dependency verification, coupling-hotspot analysis, and frontend route-group survey. Companion quality doc: `C:\projects\Actual Projects\itemba-r\CODEBASE_REVIEW_2026-06-10.md` (verified present).

---

## 1. Target product

The app becomes a single-company, multi-branch ERP for **Westsides Company Ltd — Hardware & Building Materials Division**: products and inventory across branches; counter and credit sales (POS incl. the live Mobile POS quick-sale flow, sales orders); quotations, proformas and delivery notes; full procure-to-pay (requisitions, RFQs, POs, GRNs, supplier invoices, three-way matching); receivables/payables; complete double-entry accounting (CoA, journals, posting runs, period close, financial statements, VAT/tax engine); cash and bank accounts; fixed assets and depreciation; users/roles/permissions, audit logs, documents, notifications and operational reporting. **The Company → Division → Branch scoping architecture is kept unchanged** — per the hotspot analysis it is the security backbone (`backend/src/common/services/company-scope.service.ts`, `UserCompanyAccess`/`UserDivisionAccess`/`UserBranchAccess`), scoping is purely hierarchical, and `DivisionType` is metadata only, so one company using it costs nothing and protects everything. What disappears: every other sector (agriculture, hospitality, petroleum, parking, rentals, construction), multi-company group consolidation, and the platform-bloat layers (QA, launch, training, help, monitoring/ops dashboards, BI vanity surfaces).

---

## 2. The numbers

| Layer | Total | KEEP | REMOVE | DECIDE |
|---|---|---|---|---|
| Backend modules (classified) | **253** | **111** (44%) | **102** (40%) | **40** (16%) |
| Frontend route groups | **53** | **29** | **21** | **3** (hr, logistics, business-units) |
| Frontend pages | **344** | **175** | **122** | **47** (hr 35, logistics 10, business-units 2) |

- On disk: 266 module directories under `backend/src/modules` (verified); `app.module.ts` flat-imports 267 modules — the ~13 unclassified ones are HR submodules and infra glue, handled under the HR decision and Phase 4 cleanup.
- **Codebase reduction: ~40% of backend modules and ~35% of frontend pages removed outright.** If the owner takes my DECIDE recommendations (Section 5), that rises to **~48% of backend modules**, while keeping HR/payroll and delivery logistics. Reports catalog shrinks from ~90 to ~40 entries; sidebar loses ~40 NavLeaf items.

---

## 3. KEEP list (111 backend modules, by domain)

**Commerce & customers (sell side)**
| Modules |
|---|
| sales-orders (incl. quick-sale/Mobile POS), quotations, proforma-invoices, delivery-notes, sales-channels, price-lists, customer-price-agreements, customers, customer-credit-profiles, customer-segments, customer-statements, contact-persons, debts, receivables, external-payments, returnable-packages, package-movements, westsides (umbrella), westsides-dashboard, westsides-reports, operations-dashboard, operations-reports, global-search |

**Inventory & products**
| Modules |
|---|
| products, product-categories, product-batches, units, stock-adjustments, stock-damage, (inventory/inventory-balances/inventory-movements — referenced as keepers throughout) |

**Procurement (buy side)**
| Modules |
|---|
| suppliers, supplier-quotations, supplier-invoices, supplier-statements, supplier-performance, purchase-orders, purchase-requisitions, rfqs, bid-comparisons, goods-received-notes, three-way-matching, procurement, procurement-plans, payables, contracts |

**Finance & accounting**
| Modules |
|---|
| accounting-engine, accounting-locks, accounting-periods, fiscal-years, period-close, chart-of-accounts, journal-entries, posting-rules, posting-runs, financial-reports, financial-statements, audit-adjustments, bank-accounts, bank-reconciliations, cash-accounts, expenses, expense-categories, fixed-assets, depreciation, finance, tax-anomaly-detection, tax-auto-apply, tax-filing-engine |

**Org, security & platform**
| Modules |
|---|
| auth, users, roles, permissions, active-sessions, user-security-profiles, security-events, security-policies, companies, divisions, branches, audit-logs, api-request-logs, data-isolation, data-isolation-issues, data-isolation-tests, documents, document-templates, document-number-sequences, generated-documents, print-engine, entity-code-generator, notifications, message-templates, communication-logs, alert-rules, alert-events, dashboard, settings-catalog, user-preferences, user-dashboard-preferences, background-jobs, job-queue-configs, job-worker, backups, backup-jobs, backup-runs, cache-management, data-exports, api-clients, api-keys, integration-api, webhook-endpoints, webhook-events |

**Frontend route groups kept (29):** accounting-engine, alerts, approvals, audit-logs, automation, background-jobs, backups, bi (trimmed — see D4), companies, compliance (tax), crm, dashboard, document-templates, finance, group-control (*the route group holds keeper pages — bank accounts, contracts, loans, debts, fixed assets, audit evidence — rename it "Company Assets & Finance Control"; it is NOT the backend group-control module*), integrations, internal-controls, notifications, operations, procurement, reports, roles, sales, security, settings, tasks, users, westsides, retention (*conflict — see Risks*).

---

## 4. REMOVE list — 102 backend modules in 9 bundles

Each bundle is one PR: unregister from `app.module.ts`, delete module dirs + spec files, delete frontend route group, build + smoke. Order respects blockers.

### Bundle A — Agriculture (8 modules, 0 blockers)
`agriculture-activities, agriculture-dashboard, farms, farm-fields, farm-input-applications, crops, crop-seasons, harvest-records` · Frontend: `agriculture` (10 pages). All verified safe — no keeper references.

### Bundle B — Hospitality (10 modules, 0 blockers)
`hospitality-facilities, hospitality-payments, housekeeping, menu-categories, menu-items, restaurant-orders, restaurant-tables, room-bookings, rooms, folios` · Frontend: `hospitality` (13 pages). ⚠️ `app.module.ts` sector 12 also registers a **Guests** module not in the classification — bundle it here after a grep confirms no keeper references.

### Bundle C — Petroleum (13 modules, 2 blockers)
`fuel-tanks, fuel-pumps, fuel-nozzles, fuel-prices, fuel-shifts, fuel-shift-collections, fuel-nozzle-readings, fuel-tank-dips, fuel-credit-sales, fuel-deliveries, fuel-daily-reconciliation, petroleum-dashboard, petroleum-reports` · Frontend: `petroleum` (13 pages).
**Untangle first:**
1. `frontend/src/app/(dashboard)/operations/purchase-orders/page.tsx` — **keeper route** imports the `FuelTank` type and fetches `/petroleum/fuel-tanks`. Strip the fuel-tank UI/fields from this page before deleting the module.
2. `backend/src/modules/global-search/global-search.service.ts` — delete `searchPetroleum()`/`searchFuelTanks` and remove from the `Promise.all()` (~6 lines).

### Bundle D — Parking (5 modules, 0 blockers)
`parking-facilities, parking-zones, parking-rates, parking-sessions, parking-payments` · Frontend: `parking` (7 pages).

### Bundle E — Property rentals (7 modules, 0 blockers)
`rental-properties, rental-units, tenants, lease-agreements, rent-invoices, rent-payments, property-maintenance` · Frontend: `rentals` (9 pages).

### Bundle F — Construction (9 modules, 1 hard blocker)
`construction-projects, construction-sites, construction-dashboard, construction-labour-cost, boq-items, project-material-issues, project-progress, project-billing, subcontractors` · Frontend: `construction` (9 pages).
**Untangle first:** `backend/src/modules/hr/payroll-runs/payroll-runs.module.ts` imports `ConstructionLabourCostModule`, and `payroll-runs.service.ts` calls `ConstructionLabourCostService.allocateForRun()` / `.reverseForRun()`. Refactor payroll-runs to drop the import and remove/no-op the allocation calls (payroll is staying — see D1) **before** deleting this module, or payroll breaks.

### Bundle G — Group consolidation (3 modules, 3 blockers)
`groups, group-control, group-reports` · Frontend: `itemba`'s group surfaces are in Bundle H; the *frontend* `group-control` route group stays (keeper pages — rename it).
**Untangle first:**
1. `frontend/src/app/(dashboard)/companies/new/page.tsx` — fetches `/groups` for the company-creation dropdown. Remove the group selector (single company).
2. `frontend/src/app/(dashboard)/companies/[id]/page.tsx` and `dashboard/page.tsx` — remove links/permission references to `/group-control` routes.

### Bundle H — Itemba multi-sector orchestration
Frontend: `itemba` (15 pages — sector command centre spanning petroleum/logistics/agriculture/construction/rentals/parking/hospitality). Backend: **itemba-dashboard** (registered in app.module's Itemba wrapper; not separately classified — it reads removed-sector tables via Prisma per the verification notes, so removing it *unblocks* Bundles B/C/D). `itemba-work-units` and `labor-records` are DECIDE (D1). Remove this bundle **first** among sectors — it's the page set that makes other sector removals look "referenced."

### Bundle I — Platform bloat (46 modules + 1 ghost)
| Sub-bundle | Backend modules | Frontend groups | Blockers to untangle first |
|---|---|---|---|
| QA | qa, qa-test-cases, qa-test-results, qa-test-runs, qa-test-suites | qa (5) | none |
| Launch/production | launch-assessments, launch-blockers, launch-readiness, launch-readiness-items, final-qa-dashboard, go-live-signoff, production-readiness, production-ops | launch (4), production (3) | `production/page.tsx` + `production/readiness/page.tsx` call production-readiness API — but the whole `production` group is REMOVE; delete pages in the same PR, frontend first |
| Training/help/docs | training, training-courses, training-enrollments, training-environment, training-lessons, guided-walkthroughs, help-articles, help-center, user-manuals, documentation | training (6), help (4) | `help/page.tsx` + `help/manuals/page.tsx` call documentation API — help group is REMOVE; delete pages first |
| Support desk | support, support-tickets, support-ticket-comments | support (4) | none |
| Ops/observability | monitoring, system-health, system-metrics, error-logs, performance, performance-traces, scalability, load-tests, environment-config-checks, deployment, deployment-releases, disaster-recovery, restore-tests, retention-policies | monitoring (4), performance (2), scalability (2), deployment (2), cache (1), api-gateway (3), mobile (3) | **(a)** `backend/src/common/health.controller.ts` imports `MonitoringService.getPublicHealth()` — inline a minimal DB-ping health check there before deleting monitoring (this endpoint keeps the load balancer alive). **(b)** `frontend/.../backups/disaster-recovery/page.tsx` lives in keeper `backups` group — delete that one page. **(c)** error-logs and environment-config-checks pages are inside removable groups — frontend first. |
| BI/CRM bloat | kpi-indicators, kpi-snapshots, executive-insights, external-messages, device-registrations, security (dashboard only — security-events/policies/user-security-profiles stay) | — | **(a)** `frontend/.../integrations/messages/page.tsx` (keeper `integrations` group) calls external-messages — delete the page. **(b)** device-registrations: verified no keeper refs, but **grep the Mobile POS client first** (see Risks). |
| Ghost | compliance (controller does not exist in codebase) | — | nothing to delete; confirm and drop from any registries |

Frontend `data-isolation` group (3 pages): route survey says REMOVE, but the backend data-isolation modules are KEEP (security verification). My call: keep backend, keep the pages admin-only behind permission — they verify the scoping backbone. Don't delete the backend.

---

## 5. DECIDE list — the real owner decisions

| # | Decision | Modules / pages | Keeping costs | Removing loses | **My recommendation (hardware trader, multi-branch)** |
|---|---|---|---|---|---|
| D1 | **HR & Payroll** | frontend `hr` (35 pages) + sales-commissions, itemba-work-units, labor-records | Largest kept surface (35 pages); payroll compliance maintenance (PAYE/NSSF) | In-house payroll, attendance, leave; commission tracking for sales staff | **KEEP HR + payroll + sales-commissions** (you flagged "probably kept"; counter/wholesale staff commissions are standard). **REMOVE itemba-work-units + labor-records** — itemba-specific casual-labour concepts, work-units has no frontend usage. Payroll refactor in Bundle F is mandatory either way. |
| D2 | **Delivery logistics (own fleet)** | vehicles, drivers, routes, trips, trip-expenses, trip-fuel-usage, vehicle-maintenance, logistics-dashboard (8) + frontend `logistics` (10 pages) | 8 modules + 10 pages; MEDIUM schema coupling (Trip.salesOrderId / receivableId are optional, SetNull) | Delivery tracking to customer sites, trip costing, vehicle maintenance — the thing that differentiates a building-materials trader | **KEEP.** Building-materials trade lives on site deliveries; Trip→SalesOrder linkage gives delivery-cost-per-order. Only remove if Westsides genuinely outsources 100% of transport — ask the owner this one question. |
| D3 | **Approval workflows** | approval-engine, approval-workflows, approval-requests, approval-steps, approval-delegations (5) | Workflow config complexity | PO/price-list/requisition approval governance — keeper modules (purchase-requisitions, price-lists, notifications) already integrate with it | **KEEP, simplify config** to single-step approvals. Removing it would force refactors inside keeper modules — worst ratio in the list. |
| D4 | **BI / custom-report stack** | bi, analytics-snapshot-runs, report-definitions, report-runs, reports-catalog, saved-report-views, scheduled-reports, dashboard-definitions, dashboard-widgets, business-automation (10) + parts of frontend `bi` (13 pages) | Aspirational analytics surface to maintain | Custom report builder, scheduled email reports, exec dashboards | **Split:** KEEP reports-catalog (trim to FINANCE/HR/OPERATIONS/COMPLIANCE/WESTSIDES sectors) + scheduled-reports + saved-report-views (cheap, attach to kept reports). **REMOVE bi gateway, analytics-snapshot-runs, dashboard-definitions, dashboard-widgets, business-automation.** westsides-reports + operations-reports + financial-reports already cover real needs. |
| D5 | **Automation rules** | automation-rules, automation-runs (2) | Low | Rule-triggered postings/notifications | **Data-driven:** in Phase 0, query prod for active AutomationRule rows. Any in use → KEEP; zero → REMOVE. |
| D6 | **Loans** | loans, loan-repayment-schedules (2) | Low | Bank/equipment financing tracking with amortization | **KEEP.** Hardware traders carry stock financing and vehicle loans; debts (keeper) covers the customer side, this covers the company side. |
| D7 | **CRM dashboard** | crm (1) | Trivial | Summary view over keeper CRM modules (credit profiles, segments, statements) | **KEEP** — thin dashboard, keepers underneath. |
| D8 | **Compliance extras** | business-licenses, licensed-business-units, audit-evidence-packs (3) | Low–moderate | License renewal tracking; audit evidence collation | **KEEP business-licenses** (TZ business licence per branch is real). **REMOVE licensed-business-units** (multi-unit group concept) and **audit-evidence-packs** (no frontend usage; documents module suffices). |
| D9 | **Mobile/offline** | mobile-sessions, offline-sync (2) | Low | Mobile POS session management and offline capability | **KEEP both.** The Mobile POS is live (recent commits: quick-sale idempotency, POS header). Verify device-registrations (Bundle I) against the POS client before deleting it. |
| D10 | **Tasks** | tasks (1) + frontend `tasks` (1 page) | Trivial | Follow-up/remediation tracking | **KEEP.** |
| D11 | **Equipment usage** | equipment-usage (1) | Low | Machinery-hours tracking | **REMOVE** — construction/agri artifact, unless Westsides rents out equipment (ask once). |
| D12 | **Data governance extras** | data-archive-jobs, data-quality (2) | Low | Scheduled archival; data-quality dashboards | **REMOVE both** — consistent with removing retention-policies; manual archiving suffices at this scale. |
| D13 | **Business-units pages** | frontend `business-units` (2 pages) | Trivial | Cost-center hierarchy UI | **REMOVE pages** — divisions + branches already model the structure. |

**Net effect of my recommendations:** +20 modules move from DECIDE→REMOVE (itemba-work-units, labor-records, bi, analytics-snapshot-runs, dashboard-definitions, dashboard-widgets, business-automation, report-definitions*, report-runs*, equipment-usage, licensed-business-units, audit-evidence-packs, data-archive-jobs, data-quality, + D5 if unused) → **~122/253 removed (48%)**, 20 stay. (*report-definitions/report-runs only if the custom-report builder is confirmed unused in prod — Phase 0 query.)

---

## 6. Phased execution plan (live app — app.itembagrouptz.com)

**Standing rules:** one bundle = one PR = one `git revert` unit. Every phase gates on: backend `npm run build` green, frontend `npm run build` green, smoke script hits every kept nav route (no 404s), Mobile POS quick-sale round-trip passes, `/health` returns 200. No schema migrations until Phase 5.

### Phase 0 — Decide, freeze, audit data (Week 1, no code)
- Owner signs off Section 5 (D1–D13). Hard freeze on new features in REMOVE modules.
- **Prod data audit:** row counts per removable sector table (FuelShift, FuelCreditSale, Farm, ConstructionProject, RentalProperty, ParkingSession, RoomBooking, Tenant, AutomationRule, ReportDefinition…). Any sector with real rows gets a `pg_dump` archive of those tables to cold storage before anything ships. D5/D4 decisions resolve from these counts.
- Confirm GL independence (expected per schema analysis: JournalEntry/Receivable/Payable have **no** FKs to sector models — verify with one query joining journal lines to fuel-era postings; they must render without the fuel modules).
- **Gate:** signed decision sheet + archive dumps stored. **Rollback:** n/a.

### Phase 1 — HIDE (Week 1–2, reversible in minutes)
- Sidebar (`frontend/src/components/layout/sidebar.tsx`) is already permission-filtered: strip removed-sector permissions (fuel_*, petroleum_*, farm_*, construction_*, rental_*, parking_*, hospitality_*, rooms, guests…) from all roles in prod DB (UPDATE, not DELETE — keep Permission rows for now). Add route guards/redirects on removed route groups.
- Users stop seeing 21 route groups immediately. Watch error logs + support channels for one week — anything someone screams about is a missed dependency.
- **Gate:** zero complaints tied to hidden hardware/finance functionality. **Rollback:** re-grant permissions (single SQL).

### Phase 2 — Delete frontend route groups (Week 2–3)
- Delete the 21 REMOVE route groups (122 pages) plus the four keeper-group stragglers: `backups/disaster-recovery/page.tsx`, `integrations/messages/page.tsx`, fuel-tank UI in `operations/purchase-orders/page.tsx`, group links in `companies/[id]` + `dashboard`, group dropdown in `companies/new`. Order: itemba (H) first, then sectors, then platform groups.
- **Gate:** frontend build green; nav smoke passes; no fetch in kept pages targets a doomed backend path (grep `api/backend/(fuel|farm|construction|rental|parking|hospitality|rooms|guests|groups|production-readiness|documentation|external-messages|disaster-recovery|environment-config-checks|error-logs)` returns zero hits in kept pages). **Rollback:** revert per-group commit.

### Phase 3 — Unregister + delete backend bundles (Weeks 3–5, dependency-safe order)
Per removalMechanics: 2 lines per module in `app.module.ts`, delete module dir + specs, rebuild, deploy, smoke. Order:

1. **H — itemba-dashboard** (unblocks Prisma reads into B/C/D tables)
2. **A — Agriculture** (zero blockers — proves the pipeline)
3. **D — Parking**, **E — Rentals**, **B — Hospitality** (zero blockers; verify Guests)
4. **C — Petroleum** (purchase-orders page already fixed in Phase 2; edit global-search in same PR)
5. **F — Construction** (payroll-runs refactor lands first, in its own PR, with payroll regression test)
6. **G — Group consolidation** (companies pages already fixed in Phase 2)
7. **I — Platform bloat**, sub-bundle by sub-bundle (**health.controller.ts refactor first**, in its own PR)
8. **DECIDE removals** per Section 5 outcomes.

- **Gate per bundle:** build green, deploy to staging, smoke kept routes, `/health` 200, one posting run + one quick-sale executed successfully. **Rollback:** `git revert` the bundle PR — no migrations means redeploy fully restores.

### Phase 4 — Cleanup (Week 5–6)
- **Permissions:** now DELETE orphaned Permission rows (`code LIKE 'fuel_%' OR 'petroleum_%' …`); RolePermission rows cascade. Update `database/seeds/seed.ts` to drop the removed `perms()` calls so reseeding stays consistent.
- **Reports catalog** (`backend/src/modules/reports-catalog/catalog.ts`): delete PETROLEUM/AGRICULTURE/CONSTRUCTION/ITEMBA(/LOGISTICS only if D2 reversed) entries; trim `ReportSector` enum + `SECTOR_OWNERS`. ~90 → ~40 entries.
- **Global search:** confirm only the 6 core buckets + Westsides documents + reports remain.
- **Westsides umbrella:** with sectors gone, the `westsides/` module is no longer a sector silo — keep it as-is for now (it's pure organization, 12 submodule imports); optionally flatten into app.module in a later refactor. Do **not** delete it — it registers quotations/proformas/delivery-notes/price-lists, your daily drivers.
- Rename frontend `group-control` route group; purge `IntegrationEvent`/`IntegrationMapping` rows referencing removed endpoints; update docs/README.
- **Gate:** clean seed → fresh DB → app boots, roles work, smoke passes.

### Phase 5 — LATER, optional: schema & data
- **Explicitly: this never blocks the plan.** Prisma models without modules are harmless orphaned tables (per removalMechanics). The app-layer removal is complete without touching the database.
- After a retention window (suggest 12 months, aligned with TZ record-keeping), archive then `prisma migrate` to drop sector tables. Keep the Phase 0 dumps forever. Watch the two known soft edges before dropping: `Trip.salesOrderId` (only if D2 reversed) and `SalesOrderLine.batchId` (ProductBatch is a keeper — untouched).

---

## 7. Risks & guardrails

| Risk | Reality check | Guardrail |
|---|---|---|
| **Financial history from removed sectors** | Per the schema analysis, JournalEntry/Receivable/Payable carry **no FKs to any sector model** — GL is sector-agnostic, so journal entries originating from fuel sales remain fully readable after petroleum removal | Phase 0 verification query; tables stay in DB until Phase 5 anyway |
| **Prod data in removable tables** | FuelCreditSale references Customer/CashAccount via nullable FKs; orphaning possible but non-breaking | Phase 0 dump-before-touch; no deletes until Phase 5 |
| **Permission cleanup breaking live roles** | Deleting Permission rows cascades to RolePermission; a role could silently lose unrelated grants if codes overlap | Phase 1 revokes (reversible UPDATE) before Phase 4 deletes; snapshot role-permission matrix before each step |
| **`/health` endpoint dies with monitoring module** | `common/health.controller.ts` hard-imports MonitoringService — this is the load-balancer probe | Dedicated refactor PR before Bundle I ops sub-bundle; verified blocker, highest-severity item in the plan |
| **Payroll breaks with construction** | payroll-runs.service calls ConstructionLabourCostService on every run | Dedicated refactor PR + payroll regression test before Bundle F |
| **Purchase orders page breaks with petroleum** | Keeper page imports FuelTank type | Fixed in Phase 2, gated by grep before Phase 3 step 4 |
| **Mobile POS regression** | POS is live (recent commits); mobile-sessions/offline-sync kept (D9), but device-registrations is slated REMOVE | Grep POS client for device-registration calls before deleting; Mobile POS quick-sale is in every phase gate |
| **Input inconsistencies** | (a) frontend `retention` group says KEEP but backend retention-policies says REMOVE — backend verdict wins: remove both, manual archiving; (b) frontend `data-isolation` group says REMOVE but backend modules are KEEP — keep backend, pages go admin-only; (c) frontend `group-control` group KEEP vs backend group-control REMOVE — different things, rename the route group | Each resolved explicitly above; no silent contradictions |
| **No feature flags** | app.module is a flat 267-import list, full rebuild per change, no conditional registration | That's why bundles are atomic PRs with `git revert` as the rollback story; never batch two bundles in one deploy |

---

## 8. What this does NOT fix

- **Inconsistency inside kept modules.** Removing 40–48% of the codebase makes the app smaller, not better. The correctness/security priorities in `CODEBASE_REVIEW_2026-06-10.md` (this repo root) remain the follow-on workstream — note the current branch (`audit/security-correctness-fixes`) is already mid-flight on exactly that.
- **The IDOR/scoping sweep** across controllers still has to happen — but it shrinks proportionally: ~111 keeper modules to audit instead of 253, and every removed module is an attack surface you no longer have to defend.
- Duplication between `westsides`, `operations`, and `sales` surfaces (the route survey flags `sales` as a likely stub overlapping operations/westsides) — a UX consolidation pass after the tone-down, not part of it.
- Performance, test coverage, and the flat app.module architecture (feature-flagging/lazy-loading) — deliberately out of scope; the bundle-PR mechanism works without them.

**Bottom line:** 102 modules and 122 pages leave with zero owner judgment required; 9 verified blockers are each a named file with a named fix; the only genuinely strategic calls are HR/payroll (keep), own delivery fleet (keep — ask once to confirm), and the BI stack (trim to scheduled reports). The scoping backbone, the accounting core, and the Mobile POS are never touched.