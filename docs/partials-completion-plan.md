# Plan — Bringing the Partial Subsystems to Maturity

**Purpose:** A phased plan to close the "partial" subsystems identified in the master codebase study, before (or in parallel with) the hierarchical auth-role implementation.
**Source of facts:** master study, financial audit, bug-hunt report.
**Last updated:** 2026-05-18
**Status:** Draft — for decision and prioritization.

---

## Guiding principles

1. **Foundation before features.** Anything that fixes the data model has to land before anything that uses it (reports, role scope filters, etc.).
2. **GL completeness before reporting polish.** No point adding drill-down to a trial balance whose numbers are wrong.
3. **Critical path stays narrow.** Two foundation phases must finish before auth roles ship; everything else runs in parallel or after.
4. **Defer scope expansion.** Westsides POS, agriculture livestock, integration deliverers without a clear consumer — push to a future phase. Don't widen the surface area while we're still hardening.
5. **Every phase ends with a verification gate.** Tests passing, schema validated, key end-to-end flow green.

---

## Phase roadmap at a glance

```
Phase 0 ──► Phase 1 ──► Phase 2 ──┬──► Phase 3 ──► Phase 4
(blocking,  (blocking, (blocking, │   (parallel,   (parallel,
~2 wks)     ~3 wks)    ~2 wks)    │    ~3 wks)     ~4 wks)
                                  │
                              ⇨ AUTH ROLES IMPLEMENTATION can start
                                from end of Phase 2
```

| Phase | Theme | Effort | Auth-blocking? |
|---|---|---|---|
| 0 | Quick wins / safety fixes | ~3 days | Yes (one item) |
| 1 | Hierarchy schema migration | ~2 wks | Yes |
| 2 | GL posting completion | ~3 wks | Partially |
| 3 | Approval engine adoption + Rentals scaffold | ~3 wks | No (runs parallel with auth) |
| 4 | Reports/BI completion + Frontend gaps | ~4 wks | No |
| 5 | Hospitality / Truck Parking / Agriculture GL | ~3 wks | No |
| 6 | Integrations completion | ~2 wks | No |

Total: ~17 weeks of focused work if done strictly serially. Realistically: 8–10 weeks with parallel tracks.

---

## Phase 0 — Quick wins & safety fixes (3 days, blocking)

**Goal:** Land the small, contained fixes that unblock everything downstream and don't need design.

### Scope

1. **JWT scope priority order** (1 line)
   - `backend/src/modules/auth/strategies/jwt.strategy.ts:12`
   - Change `['GROUP', 'COMPANY', 'BRANCH', 'DIVISION']` → `['GROUP', 'COMPANY', 'DIVISION', 'BRANCH']`
   - Add a spec to lock the order.
   - **Auth-blocking** — must be in before role rollout.

2. **JournalEntry direct creation: gate by accounting locks**
   - Add `accountingControl.assertPostingAllowed()` to `journal-entries.service.create()` before `.post()`.
   - Closes a documented financial-control gap.

3. **Period close auto-activates AccountingLock**
   - On `period-close.close()`, atomically create an `AccountingLock` with `status: ACTIVE`, `lockedFrom: period.startDate`, `lockedTo: period.endDate`.
   - Removes the "honor system" gap.

4. **Frontend `AuthUser` carries scope**
   - Extend `frontend/src/lib/auth-types.ts` `AuthUser` to include `companyAccess`, `divisionAccess`, `branchAccess`, `roleScopes`.
   - Update `/api/auth/me` payload accordingly.
   - Unblocks branch/division scope filters in UI later.

5. **Fiscal-year date enforcement on JE posting**
   - In `accountingControl.assertPostingAllowed()`, validate transaction date falls within an active fiscal year for that company.

### Verification gate

- All existing tests still green.
- New specs: JWT scope priority lock; JE rejected if period locked; JE rejected if outside fiscal year; period close creates a lock.

---

## Phase 1 — Hierarchy schema migration (2 weeks, BLOCKING for auth)

**Goal:** Make the data model match the documented Group → Company → Division → Branch hierarchy on the financial tables so roll-up actually works from branch upward.

### Scope

Add optional `divisionId String?` and `branchId String?` columns + indexes + backfill on the following:

| Table | New columns | Backfill source |
|---|---|---|
| `Receivable` | `divisionId`, `branchId` | derive from `SalesOrder.divisionId/branchId` via `sourceSalesOrderId`; null if manual |
| `Payable` | `divisionId`, `branchId` | derive from `PurchaseOrder.divisionId/branchId` via `sourcePurchaseOrderId`; null if manual |
| `SupplierInvoice` | `divisionId`, `branchId` | derive from `goodsReceivedNote.branchId` then parent `PO.divisionId`; null if manual |
| `CashAccount` | `branchId` | manual data mapping by ops; null = company-wide cash |
| `BankAccount` | `branchId` | usually company- or group-level; null acceptable |
| `Loan` | (already group/company; no change) | n/a |
| `GoodsReceivedNote` | `divisionId` | derive from `purchaseOrder.divisionId` |
| `InventoryBalance` | `divisionId` | derive from `branch.divisionId` |
| `RFQ`, `SupplierQuotation`, `BidComparison` | `divisionId`, `branchId` | derive from linked `PurchaseRequisition` |
| `ChartOfAccount` | introduce separate `CostCenter` dimension table joined to `JournalEntryLine` rather than putting `branchId` on COA | new table; default cost-center per branch |

### Migration mechanics

- One Prisma migration per logical group (financial-tables migration; operations-tables migration; cost-center migration).
- Add column → backfill → add index → optionally tighten later if data is clean.
- Each migration includes an archival pre-step for any column drops (per the destructive-migrations policy from the bug-hunt closure).

### Service updates

- DTOs accept `divisionId/branchId` on create.
- `applyCompanyScopeWhere()` extended to optionally apply `divisionId/branchId` filters when a non-group user has explicit Division/Branch grants.
- Reports updated to optionally `groupBy('divisionId')` or `('branchId')`.

### Verification gate

- All Prisma migrations pass on a clean DB.
- Backfill spec: count of orphaned (null branchId where source row had branchId) is zero.
- New e2e: Branch Manager scoped to Branch X sees only their AR/AP, not Branch Y's.

### Auth interaction

This is the prerequisite that makes Branch / Division scope filters in the role architecture **actually work for AR/AP/Cash data**. Without it, those scopes return company-wide data. Must land before role rollout.

---

## Phase 2 — GL posting completion (3 weeks, partially auth-blocking)

**Goal:** Bring the trial balance to completeness. ~50% of transaction modules currently don't post; this closes that.

### Scope (sequenced by dependency)

1. **SupplierInvoice.approve()** posts DR Inventory (or relevant expense category) / CR Accounts Payable.
   - File: `supplier-invoices.service.ts`
   - Wraps in existing `$transaction`.
   - Idempotent on `journalEntryId`.

2. **Fixed-asset capitalization** posts DR Fixed Asset / CR Cash or Payable.
   - File: `fixed-assets.service.ts`
   - Trigger: on `FixedAsset.create` with non-null acquisition cost.

3. **Depreciation run** posts DR Depreciation Expense / CR Accumulated Depreciation.
   - File: `depreciation.service.ts`
   - One JE per period covering all assets due that period.
   - Adds a `postedJournalEntryId` to `DepreciationEntry`.

4. **Manual Receivables/Payables** post AR/AP control entries.
   - Direct creation routes (`receivables.service.create`, `payables.service.create`) post DR AR/CR Revenue or DR Expense/CR AP.

5. **Tax engine** posts tax liability/receivable.
   - `TaxTransaction.approve()` creates JE: DR Output VAT Receivable / CR Tax Liability (or DR Tax Liability / CR Input VAT Recoverable).
   - Wires `TaxTransaction.journalEntryId`.

6. **Three-way-matching variances** create adjustment JE on approval.
   - Variances above a threshold create a balanced JE; below threshold logged only.

### Cross-cutting changes

- `AccountResolverService` extended with any new role keys needed (e.g., `ACCUMULATED_DEPRECIATION`, `INPUT_VAT_RECOVERABLE`, `OUTPUT_VAT_PAYABLE`).
- Each integration is idempotent on its own `journalEntryId` field; second call returns existing JE.

### Verification gate

- New e2e per posting: assert JE exists, debits == credits, posted by correct user, period validated.
- Static-analysis: count of "transaction-generating module without PostingEngine call" drops from current to 0.

### Auth interaction

The Accountant / CFO roles depend on these postings being real. Auth itself works without them, but the audit trail, separation-of-duties enforcement, and approval thresholds in the role architecture lose meaning if there's no JE to approve. **Strongly recommended before role rollout, but not strictly blocking** — auth can ship in parallel.

---

## Phase 3 — Approval engine adoption + Rentals scaffold (3 weeks)

**Goal:** Make the approval engine actually own the flows the role architecture says it owns, and fill the rental-vertical schema-only gap.

### Sub-phase 3A — Approval engine adoption (1.5 weeks)

1. **Payroll runs through `ApprovalEngineService`.**
   - `PayrollRun.submitForApproval()` creates an `ApprovalRequest` with workflow `PAYROLL_RUN_APPROVAL`.
   - Workflow has two steps: Group HR Director (HR-side) and Company CFO (finance-side). Both must approve before `PayrollRun` transitions to `APPROVED`.
   - Maker-checker enforced (preparer ≠ approver).
   - **This is the high-stakes one** — payroll legal/financial sign-off must be airtight.

2. **Defer leave/tax to a later sub-phase** (3B at a later date, ~1 week each when prioritized). For now, document that leave + tax remain on inline approval.

3. **Add approval-workflow seeds** for the two-step payroll workflow and (eventually) leave/tax.

### Sub-phase 3B — Rentals scaffold (1.5 weeks)

Scaffold the four missing NestJS modules. Schema already exists; just need module + controller + service + DTOs + frontend pages.

1. **`lease-agreements`** — CRUD + approval workflow (`DRAFT → APPROVED → ACTIVE → EXPIRED/TERMINATED`).
2. **`rent-invoices`** — CRUD + monthly recurring generation job + AR linkage. Status: `DRAFT → SENT → APPROVED → PARTIALLY_PAID/PAID/CANCELLED`.
3. **`rent-payments`** — CRUD + idempotency key + cashAccountId linkage + GL posting.
4. **`property-maintenance`** — CRUD + expense linkage.

Plus a frontend page per module.

### Verification gate

- Payroll run cannot be approved without Group HR + Company CFO both approving via `ApprovalRequest`.
- Rentals: create lease → generate first month's invoice via scheduled job → record payment → see receivable settled.

### Auth interaction

- Approval engine adoption matches the role architecture's design — without it, the role's approval chains are aspirational. Important for governance but not a hard auth blocker; can run in parallel with auth role implementation.
- Rentals scaffolding lets us seed `Property Manager`, `Lease Officer`, `Rent Collection Officer`, `Property Maintenance Coordinator` roles. Without this, those roles are deferred.

---

## Phase 4 — Reports/BI completion + Frontend gaps (4 weeks, runs parallel with Phase 3)

**Goal:** Make the reports useful enough for a CFO and a Group Auditor to actually run the business off them.

### Scope

1. **Drill-down from every statement line to its journal entries.**
   - `getTrialBalance`, `getProfitAndLoss`, `getBalanceSheet`, `getCashFlow` return an `entries[]` array per line with JE IDs.
   - Frontend renders as expandable rows.

2. **Comparatives** (YTD, MTD, prior-period, prior-year).
   - Each statement endpoint accepts `comparePeriod: 'NONE' | 'PRIOR_PERIOD' | 'PRIOR_YEAR' | 'YTD'`.
   - Returns side-by-side columns + variance % per line.

3. **Real PDF / Excel materialization** in `print-engine`.
   - Add Puppeteer for PDF (or `pdfmake` if Puppeteer is too heavy).
   - Add `exceljs` for XLSX.
   - `scheduled-reports` honors `exportFormat: PDF | EXCEL` end-to-end.

4. **Cash flow surfaced in `/finance/reports`** UI (currently missing tab).

5. **Tax-return auto-computation** — `TaxReturn.prepare()` pulls from `TaxTransaction` totals for the period; populates fields instead of manual entry. VAT/WHT/CIT first; PAYE later.

6. **Audit evidence packs auto-link to statement runs.**
   - Running a TB/P&L/BS creates a `FinancialStatementRun` record and an optional `AuditEvidencePack` with linked JE IDs.

7. **Group consolidation with intercompany elimination.**
   - `getGroupConsolidatedBalanceSheet`, `getGroupConsolidatedProfitAndLoss`, `getGroupConsolidatedCashFlow`.
   - Identifies matching `Receivable` (Company A) / `Payable` (Company B) intercompany pairs and zeros them.

8. **Frontend gap fills:**
   - Posting-rules builder (replace read-only stub).
   - Bank reconciliation workflow (replace read-only stub).
   - Depreciation manager.
   - Period-close checklist.
   - Tax-anomaly-detection / tax-auto-apply / tax-filing-engine UIs.
   - Three-way-matching review screen (finance side).
   - Audit-evidence-packs UI.
   - Branch/division scope selectors on all finance pages.
   - `error.tsx` boundaries on dashboard segments.

### Verification gate

- Generate a TB PDF — open it, looks like a real trial balance.
- Generate a group consolidated P&L — intercompany sales eliminated.
- Click any P&L line — see the JEs that summed to it.
- Run a tax return — see VAT totals auto-populated from `TaxTransaction`.

### Auth interaction

None. Runs in parallel with anything.

---

## Phase 5 — Hospitality / Truck Parking / Agriculture GL (3 weeks)

**Goal:** Bring the remaining vertical GL integrations online.

### Scope

1. **Hospitality folio settlement (W5.5).**
   - On `GuestFolio.close()`, create a `SalesOrder` settling the folio total (room + restaurant + bar + laundry charges).
   - Wires `settlementSalesOrderId`.
   - Posts revenue + AR via SalesOrder pipeline.

2. **Restaurant order revenue posting.**
   - On `RestaurantOrder.settle()`, post DR Cash or AR / CR Food Revenue, Beverage Revenue (separated).
   - If guest is in-house, push to folio instead of immediate settlement.

3. **Housekeeping module completeness check** — if it's a stub, build the basics. Otherwise leave.

4. **Truck Parking GL.**
   - `ParkingPayment` posts DR Cash / CR Parking Revenue.
   - `ParkingSession.close()` for credit customers creates a `SalesOrder` + `Receivable` instead of expecting immediate payment.

5. **Agriculture GL.**
   - `FarmInputApplication.post()` posts DR Crop Work-In-Progress / CR Inventory or Cash.
   - `HarvestRecord.post()` creates Inventory IN movements at estimated value + closes the input cost to crop COGS.
   - `CropSeason.close()` finalizes season P&L (revenue from sales minus capitalized input cost).
   - (No livestock — that's a Phase 8+ scope expansion.)

### Verification gate

- Check out a hotel guest with restaurant charges — folio settlement creates a SalesOrder that posts revenue + AR.
- Park a truck overnight, pay cash — cash account up, parking revenue posted.
- Apply fertilizer to a crop season, harvest, sell — see crop P&L from start to finish.

### Auth interaction

None.

---

## Phase 6 — Integrations & automation completion (2 weeks)

**Goal:** Make the cross-cutting platform engines actually run.

### Scope

1. **Outbound webhook deliverer.**
   - Job-worker handler that picks up `WebhookEvent` records with `status: QUEUED`, signs the payload, delivers, retries with backoff, tracks delivery attempts.

2. **Alert rule evaluator.**
   - Scheduled job (hourly/daily per rule frequency) that evaluates `AlertRule.condition` JSON against the data and emits `AlertEvent` records + Notifications.

3. **Automation rule evaluator.**
   - Job-worker handler that triggers on entity create/update events (via Prisma middleware) and executes matching automation rules.

4. **ExternalMessage dispatcher.**
   - Job-worker handler picks up `QUEUED` `ExternalMessage` records, calls the appropriate provider (M-Pesa / Airtel / Tigo for mobile-money; SMTP for email; Twilio or local SMS gateway for SMS), updates status to `DELIVERED/FAILED/BOUNCED`, retries on transient failures.

### Verification gate

- Subscribe to a webhook event externally — receive a signed POST.
- Create an alert rule "license expires in 30 days" — see the alert fire next day.
- Send a payroll-paid notification — SMS lands on test number.

### Auth interaction

None.

---

## Deliberately deferred (do not start in this plan)

These are real items but not part of completing the partials. Scope expansion, not maturity.

- **Westsides POS terminal interface.** Future work.
- **Westsides promotions / loyalty engine.** Future work.
- **Agriculture livestock module.** Future work.
- **Mobile app (React Native or PWA).** Phase 10+.
- **Swahili localization.** Phase 10+.
- **Biometric attendance integration.** Phase 10+.
- **Cryptographic e-signature.** Phase 10+.
- **BullMQ migration from Postgres-based queue.** When load justifies; not yet.
- **Automated log rotation / data archive scheduling.** When DB size justifies.

---

## Decisions you need to make

Before this plan starts, I need answers to four things:

1. **Approval engine adoption for payroll: option (a), (b), or (c)?**
   - (a) Defer entirely; payroll stays on inline approval. Lowest effort, highest governance risk.
   - (b) Route payroll + leave + tax through the engine. Highest effort, cleanest architecture.
   - (c) Route only payroll through the engine; leave/tax stay inline. **My lean.**

2. **Rentals scaffolding: build now or defer?**
   - Build now (Phase 3B, 1.5 weeks) → Rentals vertical fully usable + matching role pack ships with auth roles.
   - Defer → Rentals vertical operates on schema-only with no UI; rental-specific roles deferred to Phase 2 of role rollout. **My lean: build now** — it's only 1.5 weeks and the schema is already designed.

3. **Frontend partials timing: bundle with Phase 4 or split out?**
   - Bundle with Phase 4 reports work (~4 weeks total for both) → ships together, coherent.
   - Split (Phase 4a backend + Phase 4b frontend) → backend can ship sooner; frontend gaps stay visible longer. **My lean: bundle.**

4. **Group consolidation with intercompany elimination: now (Phase 4) or later?**
   - Now → group reports finally produce real consolidated statements, biggest user-visible win.
   - Later → defer until the underlying Phase 1 hierarchy migration has bedded in. **My lean: now**, immediately after Phase 1 hierarchy + Phase 2 posting are in. The data will be ready.

---

## Recommended order (if you accept the leans)

```
Week 1   ──► Phase 0  (quick wins)
Weeks 2–3 ──► Phase 1  (hierarchy migration) ════ BLOCKS AUTH
Weeks 4–6 ──► Phase 2  (GL posting completion) + start auth roles in parallel
Weeks 7–9 ──► Phase 3  (approvals + rentals)   + auth roles continue
Weeks 8–11 ──► Phase 4  (reports + frontend, runs in parallel with Phase 3)
Weeks 12–14 ──► Phase 5 (hospitality / parking / agri GL)
Weeks 15–16 ──► Phase 6 (integrations)
```

Auth-role implementation can start at the end of Week 3 (Phase 1 lands). Phase 2 GL completion strengthens the role architecture but doesn't block it. Phases 3+ run after the foundation is in.

**Total elapsed time: ~16 weeks with parallel tracks. ~21 weeks if strictly serial.**

---

## What "done" looks like at the end

- All 200 backend modules either properly maturing or explicitly deferred.
- 100% of transaction modules post to the GL.
- All financial tables carry full Group→Company→Division→Branch scoping; reports can roll up from branch.
- Approval engine owns payroll runs (and leave/tax if you pick option b).
- All four core financial statements (TB, P&L, BS, CF) + group consolidations + drill-down + comparatives + PDF/Excel export work end-to-end.
- Rentals vertical fully usable.
- Hospitality, truck parking, agriculture all have GL wired.
- Outbound webhooks, alerts, automation rules, external messages all actually fire.
- Frontend has no read-only stubs in the finance/accounting-engine surface.
- Static-analysis "unsafe `if (companyId)` pattern" count drops from ~180 to 0.

When this plan ends, Itemba-R is production-ready in a meaningful sense — not just "the code builds" but "you could run a real group of companies on it."

---

## Related documents

- [docs/codebase-master-study.md](codebase-master-study.md) — the maturity assessment this plan responds to.
- [FINANCIAL_MODULE_AUDIT.md](../FINANCIAL_MODULE_AUDIT.md) — Phases 1 and 2 directly close this.
- [docs/bug-hunt-2026-05-18.md](bug-hunt-2026-05-18.md) — already closed; this plan builds on top of the closed state.
- [docs/auth-role-architecture.md](auth-role-architecture.md) — auth roles ship after Phase 1 lands.
- [docs/organization-hierarchy.md](organization-hierarchy.md) — Phase 1 is the schema migration to actually realize this.
