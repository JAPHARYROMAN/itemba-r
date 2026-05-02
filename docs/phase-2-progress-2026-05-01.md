# ITEMBA-R Phase 2 Progress Log

Date: 2026-05-01

Phase: 2 - Data Correctness And Transactional Integrity

Baseline: `docs/phase-0-stabilization-baseline-2026-05-01.md`

Register: `docs/remediation-register-2026-05-01.md`

---

## 1. Objective

Phase 2 targets the platform paths where partial writes or incorrect movement logic can corrupt financial, inventory, or payroll truth. The focus is not feature breadth; it is making high-risk state transitions fail atomically and predictably.

---

## 2. Completed In This Slice

### P0-04: Inventory stock corruption risks

Status: in progress.

Changes:

- Corrected inventory movement direction classification so `PURCHASE_RETURN` is outbound.
- Added explicit inbound/outbound direction validation before balance mutation.
- Rejected zero or negative movement quantities.
- Moved balance mutation behind a transaction-safe balance-row lock using `FOR UPDATE`.
- Ensured a balance row exists before locking and updating it.
- Blocked negative stock for outbound movement types.
- Blocked outbound movements that would consume reserved quantity.
- Preserved weighted-average costing for inbound movements with unit cost.
- Added product, inventory-location, and unit validation before movement write.
- Enforced product/location/unit company consistency, allowing global units where `companyId` is null.
- Added company-scoped list/detail access for inventory movements through `CurrentUser` and `CompanyScopeService`.

Verification:

- `npm run verify:backend:locked` passed.

Residual:

- Need focused tests for negative-stock rejection, reserved-stock rejection, direction classification, and concurrent movements against the same balance row.
- Transfer-pair integrity still needs a higher-level policy so `TRANSFER_OUT` and `TRANSFER_IN` cannot drift apart.
- Existing caller modules still need functional tests to prove they pass valid movement metadata under real workflows.

### P0-05: Fuel-shift close atomicity

Status: in progress.

Changes:

- Wrapped shift close in a single Prisma transaction.
- Locked the fuel-shift row before closing to prevent concurrent close attempts.
- Made close idempotent for already closed shifts by returning a computed closed-shift summary instead of writing again.
- Validated all close prerequisites before writes:
  - readings belong to the locked shift company and branch,
  - each tank exists,
  - each tank has an inventory location,
  - tank company, branch, and product match the reading,
  - product exists in the same company,
  - product has a base unit.
- Kept nozzle reading updates, nozzle meter updates, fuel inventory movements, collection aggregation, shift status update, and attendance creation inside the same transaction.
- Routed fuel inventory issue movements through the corrected inventory movement service with the transaction client.
- Corrected fuel-shift delete audit action from `FUEL_SHIFT_CLOSE` to `FUEL_SHIFT_DELETE`.

Verification:

- `npm run verify:backend:locked` passed.

Residual:

- Need tests for duplicate close calls, missing tank inventory location, invalid reading/tank company mismatch, failed inventory movement rollback, and attendance idempotency.
- Existing fuel setup data with missing `inventoryLocationId` now fails close by design and must be corrected operationally.

### P0-10: Payroll/accounting side effects after status changes

Status: in progress.

Changes:

- Updated payroll posting helpers to accept a Prisma transaction client so journal creation and parent-row links can share the caller transaction.
- Changed payroll approval so the accrual journal entry is created and linked before the run can become `APPROVED`; failures roll back the approval.
- Changed payroll payment so the `PAID` status, advance recovery sync, sales commission settlement, payment journal entry, project labour allocation, and labour reclass journal all run in one transaction.
- Added payroll-run row locking before approval/payment status transitions.
- Added row locking for salary advances when payroll recoveries update cumulative recovered amounts.
- Added row locking and validation for sales commissions settled through payroll allowance lines.
- Changed salary-advance payment so the `PAID` status and advance disbursement journal entry happen in one transaction.
- Applied the existing `approvedAmount` salary-advance controller input by validating it and updating the approved amount before payment.
- Removed warning-only failure handling from required payroll posting paths.

Verification:

- `npm run verify:backend:locked` passed.

Residual:

- Need rollback tests proving payroll runs and salary advances do not finalize when required journal posting fails.
- Need reconciliation tooling for historic runs that may already be `APPROVED` or `PAID` without matching journal entries.
- Need a formal pending/failed posting state if any future posting step becomes asynchronous.
- Period-close blocking on unresolved payroll posting failures is not yet implemented.

### P0-01: Company isolation continuation

Status: in progress.

Changes:

- Continued the company-scope refactor into `inventory-movements` list/detail paths.
- Payroll approval/payment transactions now re-check company access after locking the run row.

Residual:

- Most company-owned modules still need the canonical `CompanyScopeService` pattern and cross-company tests.
- Payroll-run create/update still need deeper company-write validation beyond this Phase 2 status-transition work.

### P2-05: Money and quantity arithmetic risk

Status: in progress.

Changes:

- Inventory balance mutation now centralizes sign handling and quantity validation in one service path.
- Payroll recovery updates now round cumulative recovery amounts consistently at the transaction boundary.

Residual:

- The platform still uses JavaScript `number` arithmetic in many finance and quantity paths.
- A broad Decimal.js/Prisma Decimal policy remains required for ERP-grade precision.

---

## 3. Verification Summary

| Command | Result |
|---|---|
| `npm run verify:backend:locked` | Passed |

---

## 4. Files Changed In Phase 2

- `backend/src/modules/inventory-movements/inventory-movements.controller.ts`
- `backend/src/modules/inventory-movements/inventory-movements.module.ts`
- `backend/src/modules/inventory-movements/inventory-movements.service.ts`
- `backend/src/modules/fuel-shifts/fuel-shifts.service.ts`
- `backend/src/modules/hr/payroll-postings/payroll-postings.service.ts`
- `backend/src/modules/hr/payroll-runs/payroll-runs.service.ts`
- `backend/src/modules/hr/salary-advances/salary-advances.service.ts`
- `backend/src/modules/construction-labour-cost/construction-labour-cost.service.ts`
- `docs/remediation-register-2026-05-01.md`
- `docs/phase-2-progress-2026-05-01.md`

---

## 5. Current Phase 2 Position

Phase 2 has started and materially reduced corruption risk in the three highest-risk operational paths: inventory stock mutation, fuel-shift close, and payroll/accounting finalization. The code now fails required side effects before final business statuses are committed.

The release gate remains blocked. These fixes need behavioral regression tests, cross-company tests, and historic-data reconciliation before the related P0 items can be marked verified.
