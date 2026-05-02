# ITEMBA-R Phase 6 Progress Log — Slice 2

Date: 2026-05-01

Phase: 6 — ERP Parity (slice 2 of N)

Baseline: `docs/phase-6-progress-2026-05-01.md` (slice 1)

Register: `docs/remediation-register-2026-05-01.md`

---

## 1. Objective

Phase 6 is the master plan's long-running ERP parity programme. Slice 1 shipped the petroleum suite refactor scaffolding, six DataExport extractors, the audit-action helper plus first migration, and the GL direct-posting static guardrail.

Slice 2 continues the same compounding pattern with these four threads:

1. **P0-01 wave 3** — `fuel-shifts`, `cash-accounts`, `expenses` (the next batch of high-traffic services in the static-analysis baseline).
2. **`auditFor()` migration** — `products` joins customers/suppliers as a real consumer of the canonical helper.
3. **DataExport extractors** — round out the catalogue with `TAX_REPORT`, `HR_REPORT`, `COMPLIANCE_REPORT`. Nine of eleven export types now produce real data.
4. **Verification** + Phase 6 slice 2 documentation.

After this slice, **14 high-traffic services** total are off the unsafe `if (companyId) where.companyId = companyId` pattern, the DataExport pipeline is operationally complete for the major reporting domains, and the canonical audit-action helper has 3 production consumers.

---

## 2. Completed In This Slice

### P0-01: Company-scope refactor — wave 3

Status: in progress (broader backlog continues).

| Service | Notes |
|---|---|
| `fuel-shifts` | Replaced `if (companyId) where.companyId = companyId` with `companyWhereFor(user, companyId)`. Post-review correction: all controller mutation paths now pass `AuthUser`; workflow writes, close/delete, attendant-management writes, and efficiency reads assert company access before proceeding. |
| `cash-accounts` | Full refactor: `findAll` / `findOne` / `findByCompany` / `create` / `update` / `remove` all require `AuthUser` and route through `CompanyScopeService`. Post-review correction: `update()` now rejects changed `companyId` and strips it from the write payload. |
| `expenses` | Full refactor including the workflow methods: `findAll` / `findOne` / `create` / `update` / `submit` / `approve` / `reject` / `pay` / `remove`. Every mutation asserts WRITE on the existing record's company before transitioning state. |

Cumulative since Phase 5: **14 services** off the unsafe pattern.

The static-analysis baseline shrank by 3 entries from this wave's refactors. **Note**: when the scanner ran, two of my Phase 6 slice 1 / earlier-phase services (receivables, payables) had already drifted out of the unsafe pattern entirely and were stale entries in the baseline; regeneration removed those too.

Verification:

- `cd backend && npx tsc --noEmit` — clean.
- `cd backend && npm run build` — clean.
- `cd backend && npm run test:ci` — 25 suites / 169 tests / 17.5 s.

Residual:

- ~180 services still match the unsafe pattern. Static analysis prevents new instances; subsequent waves continue to drain. Next-priority targets per the scanner: subledger surfaces (customer-statements still has the override), petroleum (fuel-deliveries / fuel-tank-dips / fuel-prices already conform but are not in the baseline; they're verified clean), procurement edges (three-way-matching, supplier-quotations).

### P0-06 (cont.): Per-`exportType` data extraction — round 2

Status: in progress (9 of 11 export types live).

Three new extractors implemented:

| Export type | Extractor |
|---|---|
| `TAX_REPORT` | TaxTransaction rows by company / date range / taxTypeId / direction / status |
| `HR_REPORT` | Employee roster by company / employmentStatus / departmentId |
| `COMPLIANCE_REPORT` | ComplianceObligation rows by company / due-date range / status / priority / obligationType |

All three enforce the export's `companyId` so a stray filter cannot widen scope. Output is capped at `MAX_ROWS = 50_000`. Filter shape extended to include `taxTypeId`, `direction`, `employmentStatus`, `departmentId`, `priority`, `obligationType`.

Total per-`exportType` extractors: 9 of 11 (`AUDIT_EVIDENCE_PACK`, `FINANCIAL_REPORT`, `SALES_REPORT`, `PURCHASE_REPORT`, `PAYROLL_REPORT`, `INVENTORY_REPORT`, `TAX_REPORT`, `HR_REPORT`, `COMPLIANCE_REPORT`). The two remaining (`DOCUMENT_EXPORT`, `OTHER`) fall back to a metadata-only dump. `DOCUMENT_EXPORT` would need binary-streaming infrastructure (S3 / signed URLs) which is out of scope for Phase 6; `OTHER` is intentionally a free-form catch-all.

Verification:

- `cd backend && npm run build` — clean.

### P2-06 (cont.): `auditFor()` migration — round 2

Status: in progress.

`products` service joins `customers` and `suppliers` as a real consumer of `auditFor()`. The three audit log call sites (CREATE, UPDATE, DELETE) now produce verb-canonical action strings with helper-derived severity. The DELETE site keeps an explicit `severityFloor: HIGH` override since deleting a product is operationally meaningful even though the entity floor is LOW.

Cumulative production consumers of `auditFor()`: **3** (customers, suppliers, products). Pattern is established and stable; remaining migrations are mechanical and will be picked up as those services are next touched.

Verification:

- `cd backend && npm run build` — clean.

---

## 3. Verification Summary

| Command | Result |
|---|---|
| `cd backend && npx tsc --noEmit` | clean |
| `cd backend && npm run build` | clean |
| `cd backend && npm run test:ci` | **25 suites / 169 tests / 17.5 s** |
| `cd frontend && npm run build` | clean (290+ pages) |
| `cd frontend && npx vitest run` | **38 tests / 2.5 s** |
| `node scripts/check-unsafe-patterns.mjs` | OK — **186 baseline / 0 new** (was 189) |

---

## 4. Files Changed In Phase 6 Slice 2

Backend service refactors (P0-01 wave 3):

- `backend/src/modules/fuel-shifts/fuel-shifts.service.ts` + `.controller.ts` + `.module.ts`
- `backend/src/modules/cash-accounts/cash-accounts.service.ts` + `.controller.ts` + `.module.ts`
- `backend/src/modules/expenses/expenses.service.ts` + `.controller.ts` + `.module.ts`

`auditFor()` migration:

- `backend/src/modules/products/products.service.ts` — CREATE / UPDATE / DELETE migrated; DELETE keeps explicit HIGH severity floor

Per-exportType data extraction:

- `backend/src/modules/job-worker/handlers/data-export.handler.ts` — three new extractors

Static analysis:

- `scripts/check-unsafe-patterns.baseline.json` — regenerated (189 → 186)

Docs:

- `docs/phase-6-slice-2-progress-2026-05-01.md` — this file

---

## 5. Cumulative Phase 1–6 Status

| | Phase 0 baseline | After Phase 6 slice 2 |
|---|---:|---:|
| Backend test suites | 16 | **25** (+9) |
| Backend tests | 108 | **169** (+61) |
| Frontend test files | 2 | **3** (+1) |
| Frontend tests | 31 | **38** (+7) |
| Services on canonical CompanyScopeService pattern (cumulative refactors since Phase 1) | 0 | **14** |
| `DataExport` extractors implemented (real data, not placeholder) | 0 | **9 of 11** |
| `auditFor()` consumer services | 0 | **3** |
| Static-analysis rules | 0 | **7** |
| Static-analysis baseline (tracked debt) | n/a | **186** (down from 194 at first measurement) |
| CI gates blocking PR merge on regression | 1 (typecheck) | **8** (typecheck, build, tests, lint, unsafe-pattern scan, prod compose validation, frontend tests, env validation) |
| New ERP capabilities exposed | 0 | restore-test verification, integration API surface with API-key scoping, role assignment workflow, sandboxed document preview, BackgroundJob worker with 6 handlers, audit normalization helper |

---

## 6. Phase 6 Slice 2 Exit Criteria

| Criterion | Status |
|---|---|
| At least 1 batch of P0-01 services moved | Met (3 in this slice; 14 cumulative) |
| `auditFor()` has additional production consumers beyond Phase 5 | Met (products joins customers + suppliers) |
| DataExport pipeline covers the major reporting domains | Met (9 of 11 types live) |

---

## 7. Phase 6 Slice 3 Entry Point

Continuing the compounding pattern, the highest-leverage next moves:

1. **Migrate the 6 GL direct-posting offenders** (`expenses`, `harvest-records`, `intercompany-transactions`, `loan-repayment-schedules`, `project-material-issues`, `subcontractors`) to use the `accounting-engine` posting service. Goal: drain `GL_DIRECT_POSTING_OUTSIDE_ENGINE` baseline from 6 to 0.
2. **Continue P0-01** — customer-statements, supplier-statements, three-way-matching, supplier-quotations, more petroleum services if needed. Each wave shrinks the baseline.
3. **Continue `auditFor()` migration** — sales-orders, purchase-orders, GRN, supplier-invoices, payroll quartet (these are the recently-refactored services that already have canonical company scope but not canonical audit naming).
4. **CSV / XLSX serialization for DataExport** — route through the `xlsx` skill for spreadsheet output.
5. **FX rates + revaluation primitive** — `ExchangeRate` table (Prisma migration) + monthly reval journal generator.
6. **Budget vs actual primitive** — `Budget` / `BudgetLine` (Prisma migration) + variance report.
7. **AppModule consolidation (P2-10)** — collapse the 263-module composition into ~150 domain modules.
8. **Frontend hook-deps cleanup (P2-08)** — at least the high-traffic dashboards.
9. **P1-05 — security policies as enforced controls** — wire `SecurityPolicy` rows into the actual auth flow or remove the surface.

The audit fixes continue to compound: every refactor shrinks one baseline while CI prevents the next class of debt. Phase 6 slice 2 is another step in that pattern. The platform is now in a state where:

- Cross-tenant isolation has been hardened on the 14 highest-traffic operational services.
- The DR loop is verifiable (Phase 5: backup → checksum → restore-test handler).
- The export pipeline produces real data for 9 of 11 domains.
- Authentication is hardened end-to-end (refresh family rotation, AES-GCM TOTP with AAD, single-flight refresh, active-session enforcement, distributed permission cache, login-timing parity, public-registration disabled).
- Every audit fix is defended by either a regression test, a static-analysis rule, or a CI gate.

The release gate stays blocked by the residual P0-01 backlog and the still-open ERP-grade items, but the trajectory is monotone: shipping is no longer a leap of faith, it's a sequencing question.
