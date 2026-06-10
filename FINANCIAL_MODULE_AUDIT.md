# Financial Module — Deep Audit

**Date:** 2026-05-17
**Scope:** All financial-arm modules (backend + frontend + schema)
**Method:** 4 parallel deep-dive audits — backend, frontend, hierarchy, reports

---

## TL;DR

The financial module's **architecture is sound** but its **execution is fractured in two critical ways**:

1. **The hierarchy is structurally inverted at the data layer.** You asked for data to build *up* from branch → division → company → group. Today, ~7 of the most important financial tables (Receivable, Payable, SupplierInvoice, CashAccount, BankAccount, Loan, ChartOfAccount) are scoped to `companyId` only — they have no `branchId` or `divisionId`. You can drill *down* from group to company, but you cannot roll *up* from branch because the branch identity is never written. This is the single biggest issue.

2. **About half of transaction-generating modules don't post to the GL.** SupplierInvoice approval, fixed-asset purchase, depreciation, tax, AR/AP, three-way-matching variances — all skip the posting engine. This means the trial balance will be incomplete the moment real operations begin, and every downstream report will be wrong.

Reports, period close, and frontend coverage have additional gaps detailed below — but the two findings above are the ones to fix first.

---

## 1. Hierarchy Roll-Up — INVERTED

You explicitly said data must build up from branch → division → company → group, not top-down. Here is where the current implementation breaks that.

### 1.1 Schema scoping matrix

| Entity | companyId | divisionId | branchId | Status |
|---|---|---|---|---|
| JournalEntry | ✓ | ✓ | ✓ | OK |
| JournalEntryLine | ✓ | ✓ | ✓ | OK |
| Expense | ✓ | ✓ | ✓ | OK |
| InventoryMovement | ✓ | ✓ | ✓ | OK |
| SalesOrder | ✓ | ✓ | ✓ | OK |
| PurchaseOrder | ✓ | ✓ | ✓ | OK |
| FixedAsset | ✓ | ✓ | ✓ | OK |
| Customer / Supplier | ✓ | ✓ | ✓ | OK |
| **Receivable** | ✓ | ✗ | ✗ | **BROKEN** — [`schema.prisma:2097-2131`](database/prisma/schema.prisma) |
| **Payable** | ✓ | ✗ | ✗ | **BROKEN** — [`schema.prisma:2134-2167`](database/prisma/schema.prisma) |
| **SupplierInvoice** | ✓ | ✗ | ✗ | **BROKEN** — [`schema.prisma:12628-12666`](database/prisma/schema.prisma) |
| **CashAccount** | ✓ | ✗ | ✗ | **BROKEN** — [`schema.prisma:1999-2025`](database/prisma/schema.prisma) |
| **ChartOfAccount** | ✓ | ✗ | ✗ | **BROKEN** — [`schema.prisma:1841-1868`](database/prisma/schema.prisma) |
| **BankAccount** | groupId or companyId | ✗ | ✗ | **BROKEN** — no branch banks |
| **Loan** | groupId or companyId | ✗ | ✗ | **BROKEN** — no branch loans |
| GoodsReceivedNote | ✓ | ✗ | ✓ | Partial — missing division |
| InventoryBalance | ✓ | ✗ | ✓ | Partial — missing division |

**What this means in practice:**
- A branch creates a receivable → it gets recorded at company level. The branch identity is gone.
- A branch's petty cash, supplier invoices, and AP cannot be reported separately.
- AR aging, AP aging, and cash position reports can never drill below company.
- Cost-center accounting must be hacked into account-code strings ("1000-DAR" vs "1000-ARU") because the COA itself has no branch dimension.

### 1.2 Aggregation direction

The aggregation code itself is structurally OK *where* the data has scope — but it stops at company level for AR/AP/cash and never reaches branches:

- [`financial-reports.service.ts:48-71`](backend/src/modules/financial-reports/financial-reports.service.ts) — `getGroupSummary()` iterates companies and sums their summaries. It never queries branch-level data.
- [`financial-reports.service.ts:15-35`](backend/src/modules/financial-reports/financial-reports.service.ts) — groups `journalEntryLine` by `companyId` only; `divisionId`/`branchId` are dropped from the `groupBy`.
- [`group-reports.service.ts:43-61`](backend/src/modules/group-reports/group-reports.service.ts) — sales report supports `byCompany` and `byDivision`, but **no `byBranch`** rollup is exposed.

### 1.3 Group consolidation

[`group-reports`](backend/src/modules/group-reports/) only consolidates **sales orders** and **audit activity**. There is **no consolidated balance sheet, no consolidated P&L, no consolidated cash flow, and no intercompany elimination**. An executive cannot run "Group total assets" or "Group net income" from the API today — only "group sales".

### 1.4 Period close & fiscal year

`FiscalYear`, `AccountingPeriod`, `AccountingPeriodClose`, and `AccountingLock` are all scoped per **company**. That is correct for multi-subsidiary scenarios. The trade-off: a single company cannot have branches with different fiscal calendars. Acceptable for now; flag for future.

---

## 2. GL Posting — Half the Modules Don't Post

The `PostingEngineService` ([`accounting-engine/`](backend/src/modules/accounting-engine/)) is well-designed: handler-based, period-lock aware. The problem is that most domain modules **never call it**.

### 2.1 Posting integration matrix

| Module | Posts to GL? | Evidence |
|---|---|---|
| expenses (on pay) | ✓ | [`expenses.service.ts:305`](backend/src/modules/expenses/expenses.service.ts) — DR expense / CR cash |
| audit-adjustments (on post) | ✓ | [`audit-adjustments.service.ts:9-20`](backend/src/modules/audit-adjustments/audit-adjustments.service.ts) |
| intercompany-transactions | ✓ (injected; logic unverified) | posting engine injected |
| harvest-records, project-material-issues, subcontractors, loan-repayment-schedules | ✓ (injected; domain-specific) | — |
| **supplier-invoices.approve()** | ✗ | [`supplier-invoices.service.ts:246-288`](backend/src/modules/supplier-invoices/supplier-invoices.service.ts) — creates Payable, no JE |
| **fixed-assets purchase** | ✗ | no posting engine call on capitalization |
| **depreciation** | ✗ | [`depreciation.service.ts:76-100`](backend/src/modules/depreciation/depreciation.service.ts) — generates schedule, never posts |
| **receivables (manual)** | ✗ | no AR/Revenue posting |
| **payables (manual)** | ✗ | no AP/Expense posting |
| **tax / tax-auto-apply** | ✗ | tax liability/receivable accounts never updated |
| **three-way-matching variances** | ✗ | [`three-way-matching.service.ts:46-52`](backend/src/modules/three-way-matching/three-way-matching.service.ts) — variance logged, no adjustment |
| **bank-reconciliations** | reads only | reconciles but doesn't post clearing entries |

### 2.2 Top-priority posting fixes

1. **SupplierInvoice.approve()** must post DR Inventory/Expense / CR Payables — without this the entire AP ledger is empty.
2. **FixedAsset capitalization** must post DR Fixed Asset / CR Cash or Payable.
3. **Depreciation run** must post DR Depreciation Expense / CR Accumulated Depreciation each period.
4. **Receivables / Payables** (manual creation) must post AR/AP and matching contra accounts.
5. **Tax transactions** must update tax liability accounts.

---

## 3. Period Close & Locks — Honor System

`AccountingLocksService` and `PeriodCloseService` both work in isolation but are **not enforced** at posting time in critical paths:

- [`journal-entries.service.ts:1-21`](backend/src/modules/journal-entries/journal-entries.service.ts) — direct JE creation does **not** check `AccountingLocksService` or `AccountingControlService`. A user can post a JE after the period is closed.
- [`period-close.service.ts:73-82`](backend/src/modules/period-close/period-close.service.ts) — closing a period sets status to `CLOSED` but does **not** automatically create an `AccountingLock` record. Close ≠ locked.
- No fiscal-year date validation on transaction dates — a user can post a JE dated outside fiscal-year bounds.

---

## 4. Reports & Statements

### 4.1 Coverage matrix

| Statement | Exists | Company-scoped | Group-scoped | Branch/Division-scoped | Drill-down to JE |
|---|---|---|---|---|---|
| Trial Balance | ✓ | ✓ | ✓ | ✗ | ✗ |
| Profit & Loss | ✓ | ✓ | ✓ | ✗ | ✗ |
| Balance Sheet | ✓ | ✓ | ✓ | ✗ | ✗ |
| Cash Flow (indirect) | ✓ | ✓ | ✗ | ✗ | ✗ |
| AR Aging | ✓ | ✓ | ✓ | ✗ (and can't — Receivable has no branch) | ✗ |
| AP Aging | ✓ | ✓ | ✓ | ✗ (and can't — Payable has no branch) | ✗ |

References: [`financial-reports.service.ts:73-216`](backend/src/modules/financial-reports/financial-reports.service.ts) (company), [`financial-reports.service.ts:469-664`](backend/src/modules/financial-reports/financial-reports.service.ts) (group).

### 4.2 What's missing

- **No drill-down** from any statement line to its underlying journal entries — auditors get totals only.
- **No comparatives** — single-period snapshot only; no YTD/MTD/prior-year deltas.
- **No PDF/Excel materialization** — [`scheduled-reports`](backend/src/modules/scheduled-reports/) accepts `exportFormat: PDF | EXCEL`, but [`print-engine.service.ts:12-39`](backend/src/modules/print-engine/print-engine.service.ts) only renders HTML. Export jobs enqueue and run, but nothing produces a real PDF or Excel file.
- **Cash flow not surfaced in UI** — backend has `getCashFlow()` for companies, but the [`finance/reports`](frontend/src/app/(dashboard)/finance/reports/page.tsx) page has no tab for it.
- **Tax returns are status-only** — [`tax-returns.service.ts:50-76`](backend/src/modules/tax/tax-returns/tax-returns.service.ts) tracks DRAFT→PREPARED→APPROVED→SUBMITTED→PAID, but the amounts are **not auto-computed** from journal entries. No VAT/WHT/CIT form export. Filing is manual.
- **Audit evidence packs not auto-linked** to statement runs — [`audit-evidence-packs.service.ts:72-77`](backend/src/modules/audit-evidence-packs/audit-evidence-packs.service.ts) accepts manual item attachment only.

---

## 5. Frontend Pages

### 5.1 Pages with full functionality

These 11 finance pages are complete with real data, mutations, and company-scope filters:

`/finance` (dashboard), `/finance/accounting-periods`, `/finance/cash-accounts`, `/finance/chart-of-accounts`, `/finance/expenses`, `/finance/fiscal-years`, `/finance/journal-entries`, `/finance/payables`, `/finance/receivables`, `/finance/intercompany`, `/finance/reports`.

### 5.2 Stub or read-only pages

| Page | Status |
|---|---|
| [`/accounting-engine/posting-rules`](frontend/src/app/(dashboard)/accounting-engine/posting-rules) | read-only, no rule builder |
| [`/accounting-engine/posting-runs`](frontend/src/app/(dashboard)/accounting-engine/posting-runs) | read-only |
| [`/accounting-engine/bank-reconciliations`](frontend/src/app/(dashboard)/accounting-engine/bank-reconciliations) | read-only — no matching workflow |
| [`/accounting-engine/audit-adjustments`](frontend/src/app/(dashboard)/accounting-engine/audit-adjustments) | read-only — no CRUD or workflow |
| [`/accounting-engine/financial-statements`](frontend/src/app/(dashboard)/accounting-engine/financial-statements) | minimal generate form |
| [`/accounting-engine/period-close`](frontend/src/app/(dashboard)/accounting-engine/period-close) | shell only — no checklist/workflow |
| [`/accounting-engine/depreciation`](frontend/src/app/(dashboard)/accounting-engine/depreciation) | shell only |
| [`/accounting-engine/loan-repayments`](frontend/src/app/(dashboard)/accounting-engine/loan-repayments) | shell only |
| [`/internal-controls`](frontend/src/app/(dashboard)/internal-controls) | "+ New Control" button not wired |

### 5.3 Backend modules with NO matching frontend page

`audit-evidence-packs`, `customer-credit-profiles`, `customer-statements` (finance copy), `debts`, `tax`, `tax-anomaly-detection`, `tax-auto-apply`, `tax-filing-engine`, `three-way-matching` (finance view), `supplier-invoices` (finance view), `supplier-statements` (finance copy), `financial-reports` (the module page itself).

### 5.4 Sidebar / navigation gaps

[`frontend/src/components/layout/sidebar.tsx:272-337`](frontend/src/components/layout/sidebar.tsx) — Finance section. Issues:
- No "Reports" entry under Accounting Engine (other modules have one).
- Internal Controls is a leaf — should expand with rules / violations / audit-log sub-pages.

### 5.5 Hierarchy filters in UI

All present finance pages filter by **company** only. None offer a branch or division scope selector. Even when a user wants "expenses for branch X", they cannot filter at the page level — they must rely on URL params if any.

---

## 6. Top 15 Critical Gaps (Ranked)

| # | Gap | Layer | Impact |
|---|---|---|---|
| 1 | Receivable/Payable/SupplierInvoice/CashAccount/COA missing `branchId`+`divisionId` | Schema | Hierarchy roll-up broken |
| 2 | SupplierInvoice.approve() doesn't post to GL | Backend | AP ledger empty |
| 3 | FixedAsset purchase doesn't post to GL | Backend | Asset accounts zero |
| 4 | Depreciation generates schedule but never posts | Backend | Accumulated depreciation always zero |
| 5 | No consolidated group P&L / Balance Sheet / Cash Flow | Backend | No group-level reporting |
| 6 | No intercompany elimination logic | Backend | Group reports double-count |
| 7 | JournalEntry direct creation bypasses period locks | Backend | Closed periods accept postings |
| 8 | Period close doesn't auto-activate AccountingLock | Backend | Close ≠ locked |
| 9 | Receivables/Payables (manual) don't post AR/AP | Backend | Trial balance incomplete |
| 10 | Tax modules don't post liabilities + tax returns not auto-computed | Backend | Tax accounts never update |
| 11 | No drill-down from any statement to JEs | Reports | Audit unfriendly |
| 12 | Scheduled report exports promise PDF/Excel but only HTML is produced | Reports | Silent failure |
| 13 | Bank reconciliation workflow is read-only stub | Frontend | No real reconciliation |
| 14 | Posting-rules builder is read-only | Frontend | Can't configure GL mappings |
| 15 | No branch/division scope filter on any finance page | Frontend | Operators can't see branch view |

---

## 7. Recommended Sequence

**Phase 1 — Fix the hierarchy foundation (blocking everything else):**
1. Add `divisionId String?` and `branchId String?` columns + indexes to: Receivable, Payable, SupplierInvoice, CashAccount, BankAccount, Loan, GoodsReceivedNote, InventoryBalance.
2. Add `branchId` (optional) + cost-center concept to ChartOfAccount, OR introduce a separate `CostCenter` dimension table joined to JournalEntryLine.
3. Backfill any existing rows from related entities (e.g., a Receivable's branchId from its parent SalesOrder).
4. Update DTOs and services to accept and persist these IDs.

**Phase 2 — Wire posting:**
5. SupplierInvoice.approve → post DR Inventory / CR Payable.
6. FixedAsset.capitalize → post DR Asset / CR Cash|Payable.
7. Depreciation.run → post DR Depreciation Expense / CR Accumulated Depreciation per period.
8. Receivables / Payables manual creation → post AR/AP and contra accounts.
9. Tax engine → post tax liability/receivable.
10. Add `accountingControl.assertPostingAllowed()` to JournalEntry.create and to all posting-engine entry points.
11. Period close should atomically activate `AccountingLock` for the closed period.

**Phase 3 — Reporting:**
12. Build consolidated group P&L, Balance Sheet, Cash Flow with intercompany elimination.
13. Add branch and division scope params to all statement endpoints (now possible because of Phase 1).
14. Add drill-down: each statement line returns the JE IDs it summed.
15. Implement real PDF/Excel render in print-engine (e.g., Puppeteer for PDF, exceljs for XLSX).
16. Auto-populate tax returns from JE data and produce a fileable export.

**Phase 4 — Frontend:**
17. Build out posting-rules builder, bank-reconciliation workflow, depreciation manager, period-close checklist.
18. Add branch/division scope selectors to all finance pages and reports.
19. Surface Cash Flow in `/finance/reports`.
20. Build UI for tax-anomaly-detection, tax-auto-apply, tax-filing-engine, three-way-matching, audit-evidence-packs.

---

## Appendix — Audit method

Four parallel deep-dive agents:
- **Backend modules** — service/controller spot-reads across 40+ finance modules, AppModule wiring check.
- **Frontend pages** — page inventory, render check, mutation check, navigation/sidebar cross-reference.
- **Hierarchy** — Prisma schema scoping FK matrix, aggregation-direction code reads, group-consolidation status.
- **Reports** — TB/P&L/BS/CF coverage, tax filings, drill-down, scheduling/export, frontend↔backend matching.

Total files inspected: ~100+ services/controllers/pages and the Prisma schema. Read-only; no code changes made.
