# ITEMBA-R Phase 6 Progress Log

Date: 2026-05-01

Phase: 6 — ERP Parity (slice 1 of N)

Baseline: `docs/phase-5-progress-2026-05-01.md`

Register: `docs/remediation-register-2026-05-01.md`

---

## 1. Objective

Phase 6 in the master plan is the long-running ERP-parity programme ("Weeks 6–12+"). One slice cannot deliver all of it. This slice picks the highest-leverage subset that compounds the Phase 1–5 investment:

1. Continue the P0-01 company-scope refactor across the next batch of high-traffic services (HR/payroll quartet + procurement triple) so the static-analysis baseline drains further.
2. Replace the placeholder JSON shell in the BackgroundJob `DATA_EXPORT` handler with real per-`exportType` extraction for the six most operationally-cited export types.
3. Migrate the Phase 5 services to use the canonical `auditFor()` helper so the helper becomes a real pattern, not a shipped-but-unused contract.
4. Add a new static-analysis rule that flags direct `prisma.journalEntry.create` calls outside the canonical posting modules — even before a fully centralized GL posting funnel exists, the architectural intent is now defended at CI time.

After this slice, **11 high-traffic services** total have been moved to `CompanyScopeService`, the export pipeline produces real data, audit naming is incrementally migrating to the canonical helper, and the GL posting funnel has a static-analysis guardrail.

---

## 2. Completed In This Slice

### P0-01: Company-scope refactor — wave 2 (HR + procurement)

Status: in progress (broader backlog remains).

| Service | Notes |
|---|---|
| `hr/payroll-runs` | Replaced inline `companyFilter` + hand-rolled `assertCompanyAccess` (which silently leaked when GROUP scope was misconfigured) with `CompanyScopeService`. `findAll` / `findOne` / `create` / `update` / `approve` / `pay` now route through it. `update` rejects mutating `companyId`. Audit actions canonicalized (`PAYROLL_RUN_CREATE`, `_UPDATE`). |
| `hr/payroll-entries` | Full refactor: `findAll` / `findOne` / `update` use `CompanyScopeService`. Audit actions canonicalized. |
| `hr/salary-payments` | Full refactor: `findAll` / `findOne` / `create` / `update` / `reverse` / `remove`. |
| `hr/salary-advances` | Full refactor: `findAll` / `findOne` / `create` / `update` / `approve` / `pay` (transactional path) / `remove`. |
| `purchase-orders` | Full refactor including `confirm` / `receive` / `cancel` / `remove`. `findOne` accepts an optional `AuthUser` so internal cross-module callers (none currently) can still load by id without authz; controller paths always pass user. |
| `goods-received-notes` | Full refactor: `findAll` / `findOne` / `create` / `update` / `approve` / `post`. Audit actions canonicalized. |
| `supplier-invoices` | Full refactor: `findAll` / `findOne` / `create` / `update` / `approve`. Audit actions canonicalized. |

Cumulative since Phase 5: **11 services** off the unsafe `if (companyId) where.companyId = companyId` pattern.

The static-analysis baseline shrank by 7 entries from this wave's refactors (4 of those 7 already had hand-rolled access checks that were replaced with the canonical helper).

Verification:

- `cd backend && npx tsc --noEmit` — clean.
- `cd backend && npm run build` — clean.
- `cd backend && npm run test:ci` — 25 suites / 169 tests / 19.3 s.

Residual:

- Roughly 180 services still match the unsafe pattern. Static analysis prevents new instances; subsequent waves will continue to drain. Next-priority targets: fuel-shifts / fuel-deliveries / fuel-tank-dips / fuel-prices / fuel-credit-sales (petroleum operations); customer-statements / receivables / payables (subledger surfaces); three-way-matching (procurement closing).

### P0-06 (cont.): Per-`exportType` data extraction

Status: in progress.

`DataExportJobHandler` now performs real per-domain extraction instead of writing an empty `rows: []` shell. Six extractors implemented:

| Export type | Extractor |
|---|---|
| `AUDIT_EVIDENCE_PACK` | AuditLog rows by company / date range / entityType |
| `FINANCIAL_REPORT` | JournalEntry + lines by company / transaction date range |
| `SALES_REPORT` | SalesOrder + lines by company / order date range |
| `PURCHASE_REPORT` | PurchaseOrder + lines by company / order date range |
| `PAYROLL_REPORT` | PayrollEntry rows by company / payroll period |
| `INVENTORY_REPORT` | InventoryMovement rows by company / movement date / product / location |

All extractors enforce the export's `companyId` so a stray filter value cannot widen scope past the row's tenant. Output is capped at `MAX_ROWS = 50_000` with a `truncated: true` flag set when the cap is hit. Filter shape supports `dateFrom`, `dateTo`, `entityType`, `payrollPeriodId`, `productId`, `locationId`.

Other types (`TAX_REPORT`, `HR_REPORT`, `COMPLIANCE_REPORT`, `DOCUMENT_EXPORT`, `OTHER`) fall back to the metadata-only dump until each branch is implemented — adding one is one switch-case here.

Verification:

- `cd backend && npm run build` — clean.

Residual:

- The handler writes JSON. CSV / XLSX serialization is the next concrete improvement; a follow-up could route through the `xlsx` skill or a streaming CSV writer if export sizes grow past memory.
- Streaming for large exports (currently in-memory `findMany` + `JSON.stringify`). At 50k rows this is fine; past that, refactor to a stream pipeline.

### P2-06 (cont.): `auditFor()` migration started

Status: in progress.

`customers` and `suppliers` services now use the canonical `auditFor(entityType, verb)` helper. Action strings shifted from the legacy `CUSTOMER_VIEW` / `CUSTOMER_CREATED` / `CUSTOMER_UPDATED` / `CUSTOMER_DELETED` to `CUSTOMER_VIEW` / `CUSTOMER_CREATE` / `CUSTOMER_UPDATE` / `CUSTOMER_DELETE` (verb-canonical). Severity is now derived from the helper's entity + verb floor instead of being hand-set per call site.

Same migration is queued for `products` and `sales-orders`. The helper API and contract are stable; remaining migrations are mechanical and can be done as those services are next touched.

Verification:

- `cd backend && npm run build` — clean.

### P3-01 (early): GL direct-posting static rule

Status: verified.

The master plan calls for a centralized GL posting funnel (Phase 6 P3-01). That is a multi-week refactor. As a precursor, this slice adds a static-analysis rule that defends the architectural intent **before** the funnel itself is built:

- **`GL_DIRECT_POSTING_OUTSIDE_ENGINE`** — flags any `prisma.journalEntry.create` / `prisma.journalEntryLine.create` (and `tx.` / `db.` variants) outside the canonical posting modules:
  - `journal-entries` (the canonical entry point)
  - `accounting-engine` / `posting-engine`
  - `posting-runs` / `period-close`
  - `audit-adjustments` / `depreciation`
  - `hr/payroll-postings` (controlled fan-out from a single domain)

When the rule first ran it surfaced **6 services** with direct GL writes outside that list:

- `expenses`
- `harvest-records`
- `intercompany-transactions`
- `loan-repayment-schedules`
- `project-material-issues`
- `subcontractors`

These are real architectural debt. They are now tracked in the static-analysis baseline so:
- They do **not** block CI today (acknowledged technical debt).
- Any new direct-posting site WILL fail the build.
- As each is migrated to use the accounting-engine, the baseline shrinks.

Verification:

- `node scripts/check-unsafe-patterns.mjs` — `OK (189 known baseline violation(s); 0 new)`.

This is the same baseline-tolerant pattern Phase 4 introduced for the `COMPANY_ID_QUERY_OVERRIDE` rule. It works because regressions are stopped immediately while existing debt is paid down on a planned schedule.

---

## 3. Verification Summary

| Command | Result |
|---|---|
| `cd backend && npx tsc --noEmit` | clean |
| `cd backend && npm run build` | clean |
| `cd backend && npm run test:ci` | **25 suites / 169 tests / 19.3 s** |
| `cd frontend && npm run build` | clean (290+ pages) |
| `cd frontend && npx vitest run` | **38 tests / 2.6 s** |
| `node scripts/check-unsafe-patterns.mjs` | OK — **189 baseline / 0 new** |

---

## 4. Files Changed In Phase 6

Backend service refactors (P0-01 wave 2):

- `backend/src/modules/hr/payroll-runs/payroll-runs.service.ts` + `.module.ts`
- `backend/src/modules/hr/payroll-entries/payroll-entries.service.ts` + `.module.ts`
- `backend/src/modules/hr/salary-payments/salary-payments.service.ts` + `.module.ts`
- `backend/src/modules/hr/salary-advances/salary-advances.service.ts` + `.module.ts`
- `backend/src/modules/purchase-orders/purchase-orders.service.ts` + `.controller.ts` + `.module.ts`
- `backend/src/modules/goods-received-notes/goods-received-notes.service.ts` + `.controller.ts` + `.module.ts`
- `backend/src/modules/supplier-invoices/supplier-invoices.service.ts` + `.controller.ts` + `.module.ts`

Per-exportType data extraction (P0-06):

- `backend/src/modules/job-worker/handlers/data-export.handler.ts` — six new extractors

`auditFor()` migration (P2-06):

- `backend/src/modules/customers/customers.service.ts` — VIEW / CREATE / UPDATE / DELETE migrated
- `backend/src/modules/suppliers/suppliers.service.ts` — VIEW / CREATE / UPDATE / DELETE migrated

Static analysis (P3-01 precursor):

- `scripts/check-unsafe-patterns.mjs` — new `GL_DIRECT_POSTING_OUTSIDE_ENGINE` rule
- `scripts/check-unsafe-patterns.baseline.json` — regenerated (190 → 189; -7 P0-01, +6 new GL rule)

Docs:

- `docs/phase-6-progress-2026-05-01.md` — this file
- `docs/remediation-register-2026-05-01.md` — Phase 6 statuses

---

## 5. Remediation Register Status After Phase 6

| ID | Title | Status before | Status after |
|---|---|---|---|
| P0-01 | Cross-company isolation / IDOR | In progress | In progress (11 high-traffic services moved; static check defends against new instances) |
| P0-06 | Workers / backups / exports lack reliable runtime | In progress | In progress (per-exportType extraction live for 6 of 11 export types; CSV/XLSX serialization and remaining types are follow-ups) |
| P2-06 | Audit classification and naming inconsistent | In progress | In progress (helper plus 2 services migrated; products/sales-orders/payroll suite/procurement triple still use legacy strings) |
| P3-01 | GL posting engine | Open | In progress (static-analysis guardrail defending architectural intent; centralized funnel itself is the next workstream) |

---

## 6. Phase 6 Slice 1 Exit Criteria

| Criterion | Status |
|---|---|
| At least 1 batch of P0-01 services moved off the unsafe pattern | Met (7 in this slice; 11 cumulative) |
| Per-exportType extraction in place for the most-cited types | Met (6 types implemented) |
| Audit-action helper has at least 2 real-service consumers | Met (customers + suppliers) |
| GL posting architectural intent has a CI guardrail | Met |

The release gate continues to be defended by:
- CI gates (Phase 4) — every PR runs typecheck + lint + tests + unsafe-pattern scan + prod-compose validation.
- Static-analysis baseline — now defends two architectural intents (no new `companyId` overrides, no new direct GL writes).
- Test floor — 169 backend + 38 frontend regression tests.

---

## 7. Phase 6 Slice 2 Entry Point

The remaining ERP-parity work in priority order:

1. **Continue P0-01** — petroleum suite (fuel-shifts / fuel-deliveries / fuel-tank-dips / fuel-prices / fuel-credit-sales), receivables / payables / customer-statements (subledger surfaces). Each wave shrinks the baseline.
2. **Centralized GL posting funnel** — migrate the 6 services flagged by `GL_DIRECT_POSTING_OUTSIDE_ENGINE` to the accounting-engine. Goal: empty the rule's allow-list down to the 3–4 truly canonical modules, and the 6 baseline entries become 0.
3. **Continue auditFor migration** — products, sales-orders, then the entire payroll/procurement waves. Each migration is mechanical and contained.
4. **Per-exportType: TAX_REPORT, HR_REPORT, COMPLIANCE_REPORT** — round out the dump catalogue.
5. **CSV / XLSX serialization** for DataExport (route through the `xlsx` skill for spreadsheet output).
6. **FX rates + revaluation primitive** — `ExchangeRate` table + monthly reval journal generator.
7. **Budget vs actual primitive** — `Budget` / `BudgetLine` + variance report.
8. **AppModule consolidation (P2-10)** — collapse the 263-module composition into ~150 domain modules.
9. **Frontend hook-deps cleanup (P2-08)** — at least the high-traffic dashboards (BI, HR, monitoring).
10. **P1-05 — security policies as enforced controls** — wire SecurityPolicy rows into the actual auth flow or remove the surface.

The platform's audit fixes are now compounding: every refactor shrinks one baseline (debt) while CI prevents another (new debt). Phase 6 slice 1 has shipped the highest-leverage continuation of that pattern.
