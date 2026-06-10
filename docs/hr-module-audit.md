# HR Module — Deep Audit

**Date:** 2026-05-18
**Scope:** Every HR-related backend module + schema + frontend page + statutory/compliance integration + approval flows + bugs/races
**Method:** Six parallel deep-dive agents — schema, services, controllers/frontend, Tanzanian compliance/GL accuracy, approval-architecture conformance, bugs/races/edge cases — synthesized into one report.
**Status:** Findings only. No code changes made.

---

## Executive summary

The HR module is **architecturally rich and Tanzania-aware**. Payroll calculation, GL posting, statutory deductions (PAYE/SDL/NSSF/PSSSF/WCF/NHIF/HESLB), CMA/CCM dispute handling, and the Phase 3A dual sign-off all exist and are largely correct. But the system has **four classes of serious shortcomings** that need addressing before payroll can be trusted in production:

1. **A critical concurrency race in the Phase 3A dual sign-off** that can post the payroll accrual JE twice when HR and CFO approve simultaneously. The pessimistic row lock guards the run state but doesn't prevent both transactions from observing the same pre-approval state and both calling `postRun()`.
2. **A permission-seeding gap** — the new `payroll.approve.hr` and `payroll.approve.finance` permission codes are hardcoded in the controller but **not seeded in the database**. Every user attempting to approve payroll will fail the permission check until the seed is updated.
3. **Approval architecture only partially conforms to the role doctrine.** Payroll has the documented dual sign-off; but long leave, written-warning discipline, termination, and inter-division transfers all use single-user inline approval — none route through the documented multi-approver chains. The `ApprovalEngineService` is single-step only and isn't used by HR at all.
4. **Several latent bugs in cancellation, recovery, idempotency, and multi-assignment handling** that won't fire often but will produce wrong numbers when they do — most painfully, cancelling an approved payroll does **not** reverse its posted JE.

Below: every finding, severity-ranked, with the source file and line. The format follows the financial-module audit and bug-hunt reports that closed last week.

---

## Findings by severity

### CRITICAL (3)

| # | Finding | Source |
|---|---|---|
| C1 | Dual sign-off race: concurrent `approveHr` + `approveFinance` can post the accrual JE twice | [`payroll-runs.service.ts:484-582`](backend/src/modules/hr/payroll-runs/payroll-runs.service.ts) |
| C2 | `payroll.approve.hr` and `payroll.approve.finance` permission codes **not seeded** — Phase 3A endpoints are unusable as shipped | [`payroll-runs.controller.ts:55,65`](backend/src/modules/hr/payroll-runs/payroll-runs.controller.ts) vs [`seed.ts:477`](database/seeds/seed.ts) |
| C3 | `payroll-runs.service.cancel()` does **not** reverse the posted accrual JE — books left with permanent unmatched accruals when an approved run is cancelled | [`payroll-runs.service.ts:760-769`](backend/src/modules/hr/payroll-runs/payroll-runs.service.ts) |

### HIGH (7)

| # | Finding | Source |
|---|---|---|
| H1 | Salary-advance recovery uses `Number()` arithmetic accumulation across many advances — float drift can mis-settle or fail-to-settle balances | [`payroll-runs.service.ts:688-689`](backend/src/modules/hr/payroll-runs/payroll-runs.service.ts) |
| H2 | `pay()` can settle the same sales commission twice if invoked concurrently before the first completes | [`payroll-runs.service.ts:735-757`](backend/src/modules/hr/payroll-runs/payroll-runs.service.ts) |
| H3 | `SalaryAdvancesService.pay()` has no re-entry guard — two parallel calls double-post the payment JE | [`salary-advances.service.ts:119-144`](backend/src/modules/hr/salary-advances/salary-advances.service.ts) |
| H4 | Long-leave approval is single-user — role architecture requires **Division Manager + Group HR** dual sign-off | [`leave-requests.service.ts:89-98`](backend/src/modules/hr/leave-requests/leave-requests.service.ts) |
| H5 | Employee termination has **no approval workflow** — `employees.update` permission alone can set `status: TERMINATED` (role doc requires Group HR + Company GM co-sign, never unilateral) | [`employees.service.ts:116-121`](backend/src/modules/hr/employees/employees.service.ts) |
| H6 | Inter-division and inter-company employee transfers bypass the documented multi-approver workflow entirely | [`employee-assignments.service.ts:52-69`](backend/src/modules/hr/employee-assignments/employee-assignments.service.ts) |
| H7 | `payroll-postings.service.ts` converts Prisma `Decimal` → JS `Number` during accumulation (`+= Number(...)`) — accrual totals can drift on large employee counts; debit/credit balance check could fail | [`payroll-postings.service.ts:115-120`](backend/src/modules/hr/payroll-postings/payroll-postings.service.ts) |

### MEDIUM (12)

| # | Finding | Source |
|---|---|---|
| M1 | Disciplinary written warnings and disciplinary terminations are single-user — role doc requires Group HR co-sign (written) and Group HR + Company GM (termination) | [`disciplinary-actions.service.ts`](backend/src/modules/hr/disciplinary-actions/disciplinary-actions.service.ts) |
| M2 | Construction project cost allocations are **not reversed** when the parent payroll run is cancelled | [`construction-labour-cost.service.ts:45-154`](backend/src/modules/construction-labour-cost/construction-labour-cost.service.ts) and [`payroll-runs.service.ts:760`](backend/src/modules/hr/payroll-runs/payroll-runs.service.ts) |
| M3 | `LeaveRequest.approve` doesn't update any leave-balance counter, and there's no `LeaveBalance` table to update — no answer to "how many leave days has this employee taken / has left?" | [`leave-requests.service.ts:89-98`](backend/src/modules/hr/leave-requests/leave-requests.service.ts) |
| M4 | `AttendanceRecord` has no `@@unique([companyId, employeeId, attendanceDate])` — duplicate clock-in records for the same employee on the same day are accepted by the DB | [`schema.prisma:7512`](database/prisma/schema.prisma) |
| M5 | No constraint enforcing exactly one `isPrimary=true` `MobileMoneyAccount` per employee — payroll disbursement target is undefined when multiple primaries exist | [`schema.prisma:7345`](database/prisma/schema.prisma) |
| M6 | `EmployeeAssignment` allows unlimited overlapping ACTIVE assignments; no explicit "primary" flag; payroll silently picks one when an employee has multiple assignments with different salaries | [`employee-assignments.service.ts:52`](backend/src/modules/hr/employee-assignments/employee-assignments.service.ts) and [`schema.prisma:7351`](database/prisma/schema.prisma) |
| M7 | Employee soft-delete doesn't cascade to active allowances, deductions, in-flight payroll entries, leave requests, or salary advances — they become orphans | [`employees.service.ts:123-128`](backend/src/modules/hr/employees/employees.service.ts) |
| M8 | Payroll period date queries use bare Date objects → midnight-UTC off-by-one excludes records dated on the period end day in non-UTC timezones | [`payroll-runs.service.ts:163`](backend/src/modules/hr/payroll-runs/payroll-runs.service.ts) and similar |
| M9 | `TaxFilingPeriod` rows are **not auto-created** when payroll runs — companies will accumulate statutory PAYE/SDL/NSSF data with no filing period to attach a tax return to | [`payroll-runs.service.ts`](backend/src/modules/hr/payroll-runs/payroll-runs.service.ts) (entire flow), no filing-period creation observed |
| M10 | Front-end `salary-advances` page sends `POST /:id/approve` and `POST /:id/pay`; backend controller declares them as `PATCH` — frontend calls will 404 | [`salary-advances/page.tsx:64`](frontend/src/app/(dashboard)/hr/salary-advances/page.tsx) vs [`salary-advances.controller.ts:39,45`](backend/src/modules/hr/salary-advances/salary-advances.controller.ts) |
| M11 | Phase 3A dual sign-off endpoints not surfaced in the payroll-runs frontend — UI still shows one "Approve" button that will fail under the new permission model | [`payroll-runs/page.tsx:215`](frontend/src/app/(dashboard)/hr/payroll-runs/page.tsx) |
| M12 | No explicit "Group HR Director" role in the seed — only `HR_MANAGER` at COMPANY scope. The role architecture's Group-level HR authority has no seeded identity to grant `payroll.approve.hr` / disciplinary co-sign permissions to | [`seed.ts:1735-1767`](database/seeds/seed.ts) |

### LOW (10)

| # | Finding | Source |
|---|---|---|
| L1 | All HR controllers' `findAll` accept `@Query() query: any` — no DTO validation on query params (universal pattern across 34 controllers) | every `hr/**/controller.ts` |
| L2 | Permission code inconsistency between sidebar (`hr.payroll.view`) and controllers (`payroll.view`); sidebar guards may not align with backend enforcement | [`sidebar.tsx:908-1040`](frontend/src/components/layout/sidebar.tsx) vs HR controllers |
| L3 | `DisciplinaryActionsService` and `PerformanceService` still use the legacy unsafe `if (companyId) where.companyId = companyId` pattern (Phase 1's `scopedWhereFor` not adopted) | [`disciplinary-actions.service.ts:26`](backend/src/modules/hr/disciplinary-actions/disciplinary-actions.service.ts), [`performance.service.ts:22`](backend/src/modules/hr/performance/performance.service.ts) |
| L4 | `AttendanceRecord`, `LeaveRequest`, `HRDocument`, `PerformanceRecord` carry only `companyId` (no `divisionId/branchId`) — Phase 1 hierarchy work didn't reach the HR-record tables | [`schema.prisma:7483,7540,7959,7997`](database/prisma/schema.prisma) |
| L5 | `HRDocument` has no `deletedAt` — sensitive HR records (payslips, ID scans, warnings) can be hard-deleted, breaking audit trail | [`schema.prisma:7997`](database/prisma/schema.prisma) |
| L6 | No `direct grievance channel` endpoint — role doc says employees can escalate complaints directly to Group HR bypassing Division Manager; not implemented | (no endpoint exists) |
| L7 | `AttendanceService` is CRUD-only — no clock-in/out validation, no late-arrival enforcement, no automatic LWOP detection. Data is consumed by payroll but the service itself enforces nothing | [`attendance.service.ts`](backend/src/modules/hr/attendance/attendance.service.ts) |
| L8 | NHIF rule seeded at 3% employee, 0% employer — actual schemes typically include employer match; seed comment notes this is a placeholder requiring per-company override | [`tz-reference.ts:397-400`](database/seeds/tz-reference.ts) |
| L9 | PayrollRun status enum doesn't surface dual-sign states (HR_SIGNED / FINANCE_SIGNED) — current state machine relies on field-presence in the service layer | [`schema.prisma:7081`](database/prisma/schema.prisma) |
| L10 | `PayrollPeriod`, `LeaveRequest`, `HRDocument` missing hot-path indexes | [`schema.prisma:7668,7540,7997`](database/prisma/schema.prisma) |

---

## Detailed analysis by area

### 1. Schema & data model

**Strong points:**
- 34 HR-related models well-organized; soft-delete on 27 of them.
- All money fields use `Decimal(18, 2)` correctly. Tax rates use `Decimal(10, 6)`. No `Float`/`Int` slips.
- Status enums comprehensive: `PayrollRunStatus`, `LeaveRequestStatus`, `EmploymentContractStatus`, `SalaryAdvanceStatus`, `EmploymentDisputeStatus` (RAISED → INTERNAL_MEDIATION → CMA_REFERRED → CMA_HEARING → RESOLVED), `DisciplinaryActionStatus`, `OshaRegistrationStatus`.
- Tanzania-specific Employee fields: `nidaNumber`, `votersIdNumber`, `tin`, `nssfNumber`, `nhifNumber`, `pssfNumber`, `wcfRegistrationNumber`, `heslbNumber`, `payrollRegion` (MAINLAND | ZANZIBAR | BOTH).
- `EmploymentDispute` and `MinimumWageRule` correctly model Tanzanian CMA/labor-law concepts (Form 1 termination notices, CMA-F1 referrals).
- Phase 3A dual-signature fields on `PayrollRun` are coherent: `hrApprovedById/At` + `financeApprovedById/At` with separate User FKs and indexes.

**Gaps** (severity-ranked above):

The most impactful schema issues are M4–M6 — `AttendanceRecord` missing the natural unique constraint (`(companyId, employeeId, attendanceDate)`), `MobileMoneyAccount` missing single-primary enforcement, and `EmployeeAssignment` allowing unlimited overlapping ACTIVE assignments. Each of these defaults to silent data-quality drift rather than loud failures, which makes them dangerous.

L4 (HR-record tables missing `divisionId/branchId`) is the same hierarchy gap the financial audit flagged — Phase 1 closed it for AR/AP/cash but didn't extend to HR records.

### 2. Service layer

The payroll services are the most mature subsystem in the codebase. `PayrollCalculatorService` (228 lines) correctly:
- Distinguishes PAYE_MAINLAND vs PAYE_ZANZIBAR per employee `payrollRegion`.
- Applies the progressive PAYE brackets tier-by-tier (8% / 20% / 25% / 30% on TZS Mainland) — not a single rate on gross.
- Computes chargeable income as `gross − non-taxable allowances − employee pension`.
- Applies NSSF (private) vs PSSSF (public) per the employee's `isPublicSector` heuristic.
- SDL gated on ≥10 employees per regulation.
- WCF differentiated by sector (0.5% private / 1.0% public).
- HESLB at 15% of **basic** (not gross) when the borrower flag is set.
- PWD relief applied (15,000 TZS/month, floored).

`PayrollPostingsService` produces a balanced accrual JE with the correct chart of accounts:

```
DR Salaries Expense (6000)         gross
DR Employer NSSF (6040)            employer share
DR Employer PSSSF (6045)           employer share
DR WCF Expense (6050)              employer
DR SDL Expense (6060)              employer (≥10 employees)
DR Employer NHIF (6070)            employer share
   CR PAYE Payable (2210)
   CR NSSF Payable (2220)
   CR PSSSF Payable (2225)
   CR WCF Payable (2230)
   CR SDL Payable (2240)
   CR NHIF Payable (2250)
   CR HESLB Payable (2260)
   CR Salaries Payable (2270)       net
```

Balance verification at posting time with 0.01 tolerance. `referenceType:'PayrollRun'` / `referenceId:run.id` for traceability. Idempotent via existing `journalEntryId` check.

**Where the services fall short:**

- `LeaveRequestsService.approve` flips status to APPROVED but **doesn't deduct from a leave balance** — no balance table exists at all (M3). Long-leave dual sign-off (H4) and approval logic for a Division Manager's own leave aren't modeled.
- `AttendanceService` is CRUD only (L7). No clock-in validation, no late-arrival detection, no LWOP auto-flagging — and yet payroll consumes this data to compute pay.
- `DisciplinaryActionsService` and `PerformanceService` haven't been migrated to `CompanyScopeService.scopedWhereFor` (L3).
- `ApprovalEngineService` is unused by HR — every HR approval is inline. Phase 3A payroll built its own dual-sign rather than routing through the engine.

### 3. Controllers + frontend + UX

All 34 HR modules have backend controllers, and frontend pages exist for all of them — no module is invisible.

**Permission codes are inconsistent.** The sidebar guards use one convention (`hr.payroll.view`, `hr.employees.view`, `hr.leave.view`) while the controllers enforce a different one (`payroll.view`, `employees.view`, `leave_requests.view`). This is L2 — sidebar gating may not match what the backend actually permits.

The most damaging frontend issue is M10 — the salary-advances page sends `POST` to approval/payment endpoints that the backend declares as `PATCH`. Every advance approve/pay action through the UI will fail with 404 or 405 until either side is adjusted.

M11 is the Phase 3A surface gap. The dual-sign endpoints (`/approve-hr`, `/approve-finance`) are live on the backend but the payroll-runs UI still renders a single "Approve" button calling the legacy `/approve` endpoint. The deprecated endpoint will now reject the call (per Phase 3A, it requires both signatures to already be present). So payroll approval is broken end-to-end in the UI until M11 is fixed.

Other UX gaps:
- No guided onboarding flow — creating an employee requires 5–7 separate page visits.
- No responsive breakpoints (`sm:`/`md:`/`lg:`) in HR pages. Tables fall back to horizontal scroll on mobile. Branch-level attendance entry on phones will be painful.
- Generic `/approvals/pending` page exists but its Approve/Reject buttons have no `onclick` handlers — non-functional.
- CCM Notices, Disputes, Medical Exams, OSHA Registrations, Disciplinary Actions, Petroleum Commissions have backend modules but no sidebar entries — reachable only via direct URL.

### 4. Tanzanian statutory compliance + payroll-GL accuracy

Strongest area of the audit. The TaxType seeding is complete (all 8 statutory types — PAYE_MAINLAND, PAYE_ZANZIBAR, NSSF, PSSSF, WCF, SDL, NHIF, HESLB — with correct `appliesToPayroll` / `isWithholding` flags). PAYE brackets seeded with the current Tanzania Mainland tiers (0 / 270k / 520k / 760k / 1M boundaries at 0% / 8% / 20% / 25% / 30% with the right `fixedAmount` cumulative offsets).

Worked example verified in test (`calculators.spec.ts`): TZS 850,000 → tier 4 → 68,000 + 90,000 × 25% = 90,500. Correct.

CompanyTaxRegistration seeded for all three companies with TIN / VRN / PAYE numbers tied to TRA-TZ authority.

`autoComputeFromTransactions` (Phase 4) uses `Prisma.Decimal` throughout — clean.

**Three compliance gaps:**

1. **M9 — TaxFilingPeriod is not auto-created.** Companies running monthly payroll will accumulate `PayrollStatutoryLine` data with no filing-period row to attach a `TaxReturn` to. Either auto-create on first calculation of a new month, or refuse to calculate without an explicit period.

2. **H7 — `payroll-postings.service.ts:115-120` converts `Prisma.Decimal` to JS `Number` during accumulation across employees.** For a 500-employee run with TZS-scale amounts, accumulated rounding error can push the debit-vs-credit balance check (0.01 tolerance) over the limit, aborting the posting. The `tax-returns.service.ts` uses `Decimal` throughout correctly — this is solvable by using the same pattern in postings.

3. **L8 — NHIF rule is seeded as a placeholder (3% employee, 0% employer).** Most real schemes include an employer match. Operators must override per-company before running production payroll.

The Zanzibar PAYE brackets are seeded as a mirror of Mainland with a comment recommending verification against the latest ZRB notice. Acceptable as a starting point; flag for compliance officer to confirm.

### 5. Approval flows + role-architecture conformance

The role architecture (committed under `docs/auth-role-architecture.md` at the repo root) says HR approvals run between **Group HR Director** (only dedicated HR role) and **Division Managers** (line authority), with Company GM and CFO co-signing where money or executive scope is involved. Phase 3A delivered the payroll piece of this faithfully.

The rest hasn't been built.

**Compliant:**
- ✓ Payroll dual sign-off (HR + Finance, maker-checker, transaction-safe stamp + finalize) — C1 race aside.
- ✓ No Company HR Manager role seeded (the doctrine requires its absence).
- ✓ CMA/CCM notice generation for Tanzanian labor-law compliance.

**Non-compliant:**
- ✗ **Long leave** (H4) — single-user approval; doc requires Division Manager + Group HR.
- ✗ **Disciplinary written warning** (M1) — single user; doc requires Group HR co-sign.
- ✗ **Disciplinary termination** (M1) — single user; doc requires Group HR + Company GM co-sign.
- ✗ **Employee termination** (H5) — generic `employees.update` permission. Anyone with HR_MANAGER role can unilaterally flip `status: TERMINATED`. Doc says never unilateral.
- ✗ **Inter-division and inter-company employee transfers** (H6) — direct `EmployeeAssignment` create; doc requires multi-party approval involving both Division Managers, both Company GMs, Group HR, and (for inter-company) Group CFO.
- ✗ **Direct grievance channel** (L6) — no endpoint that routes complaints around the Division Manager.

**Foundational gap (C2 + M12):**

The `payroll.approve.hr` and `payroll.approve.finance` permissions are referenced in [`payroll-runs.controller.ts:55,65`](backend/src/modules/hr/payroll-runs/payroll-runs.controller.ts) but **not defined in the permission catalog seed** ([`seed.ts:477`](database/seeds/seed.ts)). Worse, there's no seeded **Group HR Director** role to assign them to — only `HR_MANAGER` at `COMPANY` scope, which the doctrine specifically rejects.

In its current shipped state, Phase 3A's dual sign-off endpoints will return `403 Forbidden` for every user. The permission gate is unreachable.

**ApprovalEngine readiness:** `ApprovalEngineService` exists with `ApprovalWorkflow → ApprovalStep` modeling, but `approveRequest()` doesn't iterate steps or progress `currentStepOrder` — it just flips status to APPROVED on a single call. The infrastructure for multi-party chains is scaffolded; it isn't connected. Until that's done, multi-step chains have to be implemented inline (more `xxxApprovedById/At` fields per entity) or by sequential `createApprovalRequest()` calls. Either path requires deliberate design.

### 6. Bugs, races, edge cases

The critical concurrency finding is C1 — the dual sign-off race. Walk through:

1. Run is `SUBMITTED`, neither signature stamped.
2. HR Director calls `approveHr` at time T.
3. Company CFO calls `approveFinance` at time T+ε.
4. Both transactions begin. Both acquire `FOR UPDATE` on the run row (one after the other; the second waits for the first to commit).
5. The first transaction (say HR's) reads the run, sees `financeApprovedById = null`, stamps HR, **doesn't finalize** (because Finance side is still empty in its snapshot), commits.
6. The second transaction (Finance's) acquires the lock, reads the run, sees `hrApprovedById = <set>`, stamps Finance, **finalizes** (posts JE), commits.

That's the happy path. The race is more subtle:

If the two calls overlap such that **both transactions read the run state before either has committed** (which can happen in `READ COMMITTED` isolation if the SELECT happens before the FOR UPDATE on certain Prisma configurations), both will see the other side as empty, both will stamp their own side, and the second commit will succeed. Then when payroll later transitions to APPROVED via a subsequent path (or worse, if the application logic in `approveFinance` re-fetches and sees both sides stamped), both finalize calls fire. Result: two accrual JEs for the same payroll run.

The `lockPayrollRun` helper acquires the lock — but the read of `financeApprovedById` / `hrApprovedById` for the finalization-decision logic happens **on a separately-fetched record** ([`payroll-runs.service.ts:492-498`](backend/src/modules/hr/payroll-runs/payroll-runs.service.ts)), not on the locked row. That's the race surface.

The fix is to make the read-modify-write atomic: hold the lock, in the same tx select all signature fields **from the locked row**, decide whether to finalize, stamp the missing side, and call `postRun()` if-and-only-if this transaction is the one completing the second signature. Then commit. Prisma's `update` returning the new row, combined with a single transactional `findUnique` over the locked row, can express this safely.

Other significant bugs:

- **H1 (advance recovery float drift)**: The recovery accumulator uses `(byAdvance.get(...) ?? 0) + Number(deduction.amount)`. With TZS-scale balances and recurring partial recoveries, accumulated rounding can either prematurely settle an advance or fail to settle one that's been fully recovered.
- **H2 (commission double-settlement)**: `settleSalesCommissions` checks `paidPayrollEntryId === payout.payrollEntryId` to detect re-entry; if `pay()` is called twice in quick succession the check can pass on the second call after the first has set the field. The status transitions are idempotent in DB but downstream webhooks/notifications won't be.
- **H3 (advance pay re-entry)**: No status guard before posting. Two parallel `pay()` calls on the same APPROVED advance both succeed.
- **C3 (cancel doesn't reverse JE)**: This is the biggest single bug for accounting hygiene. The `cancel` method only flips `status: CANCELLED`. The accrual JE stays posted. The trial balance keeps the expense and the payable. There's no way back from this except a manual reversing JE.
- **M2 (labour cost not reversed on cancel)**: Same shape as C3 — `ProjectCostAllocation` rows survive payroll cancellation, inflating project P&L permanently.
- **M8 (date boundary off-by-one)**: The same class of bug the bug-hunt audit closed for finance date filters. HR services still use bare `Date` objects in `lte` filters.

---

## Comparison to the role architecture

This table maps the documented HR approval chains against current code reality:

| Workflow | Role doc says | Code reality | Status |
|---|---|---|---|
| **Payroll run finalization** | Group HR + Company CFO (dual sign-off, maker-checker) | Phase 3A: `approveHr` + `approveFinance` with maker-checker | ✓ Implemented, but **C1 race** + **C2 missing permissions** |
| **New hire within band** | Division Manager initiates → Group HR approves | `employees.create` with single `employees.create` permission | ✗ No approval routing |
| **New hire above band / executive** | Division Manager → Group HR + Company GM + Group CFO (if exec) | Same as above | ✗ Not modeled |
| **Salary change within %** | Division Manager → Group HR | Direct `employees.update` | ✗ No approval routing |
| **Salary change above %** | Division Manager → Group HR + Company GM + Group CFO | Direct `employees.update` | ✗ Not modeled |
| **Promotion across grade** | Division Manager → Group HR + Company GM | Direct `employees.update` / `employee-assignments.update` | ✗ No approval routing |
| **Termination (any kind)** | Division Manager → Group HR + Company GM (never unilateral) | Direct `employees.update` to `status: TERMINATED` | ✗ Unilateral allowed |
| **Verbal warning** | Division Manager (auto-logged) | `disciplinary-actions.create` | ~ Logged but no co-sign needed |
| **Written warning** | Division Manager + Group HR co-sign | Single `issuedById` field; no co-sign | ✗ Not modeled |
| **Disciplinary termination** | Division Manager + Group HR + Company GM | Single `issuedById`; auto-applies fine deduction | ✗ Not modeled |
| **Short leave (≤ threshold)** | Division Manager | `leave-requests.approve` (single user) | ✓ Matches (by coincidence — same shape) |
| **Long leave (> threshold)** | Division Manager + Group HR | Same single-approver method | ✗ No second approver |
| **Leave for a Division Manager** | Company GM + Group HR | Same single-approver method | ✗ No special routing |
| **Salary advance** | Implicit Division Manager → Group HR | Single `approvedById`; recovery via payroll ✓ | ~ Partial (recovery good, approval flat) |
| **Inter-division transfer** | Both Division Managers + Company GM + Group HR | Direct `EmployeeAssignment.create` | ✗ Not modeled |
| **Inter-company transfer** | Both Division Managers + Group HR + both Company GMs + Group CFO | Same — direct create | ✗ Not modeled |
| **Grievance against a Division Manager** | Direct channel to Group HR Director | No endpoint | ✗ Not implemented |
| **CCM / CMA referral** | Tanzanian labor law process | Full lifecycle modeled in `EmploymentDispute` | ✓ Implemented |

---

## Top remediations (recommended order)

These map to the audit findings. Order is by blast-radius descending (the things that produce wrong numbers or unauthorized actions first, then conformance, then polish).

**Week 1 — Stop the bleeding**

1. **C1**: Refactor `approveHr` / `approveFinance` so the finalization decision is made on the same locked row that was selected — no separate fetch for signature state. The simplest atomic pattern: in one transaction, lock + `findUnique({ id, FOR UPDATE })` + check current signatures + `update` (stamp + possibly post JE inside the same tx). Add a unit test that runs two concurrent approvals.
2. **C2**: Add `payroll.approve.hr` and `payroll.approve.finance` to the permission seed; create a `GROUP_HR_DIRECTOR` role at `GROUP` scope and grant the HR permission; create or extend `COMPANY_CFO` role at `COMPANY` scope and grant the Finance permission. Backfill existing user-role assignments.
3. **C3**: Add a reversing-JE call to `payroll-runs.service.cancel()` — post DR/CR swap of the original accrual via `PostingEngineService` with `referenceType:'PayrollRunReversal'`. Same fix for **M2** (call `ConstructionLabourCostService.reverseForRun()` in cancellation).
4. **M11 + M10**: Update the payroll-runs UI to call `/approve-hr` and `/approve-finance` as PATCH; remove the legacy single "Approve" button. Fix the salary-advances frontend HTTP method mismatch.
5. **H7**: Convert `payroll-postings.service.ts:115-120` to `Prisma.Decimal` arithmetic; remove all `+= Number(...)` accumulators.

**Week 2 — Idempotency & race hardening**

6. **H1, H2, H3**: Add `Prisma.Decimal`-based accumulators throughout `payroll-runs.service.ts`. Add status-based re-entry guards to `pay()` on both PayrollRun and SalaryAdvance (early-exit when already PAID).
7. **M8**: Apply the same date-boundary normalizer the finance bug-hunt closed — when a date string is supplied with no time component, treat the upper bound as end-of-day. Audit HR date filters for the pattern.
8. **M4**: Add `@@unique([companyId, employeeId, attendanceDate])` to `AttendanceRecord` via migration. Plus a service-level check before creating duplicates.
9. **M5**: Add a partial unique index `WHERE isPrimary = true` to `MobileMoneyAccount` per employee.
10. **M6**: Either add `isPrimary` to `EmployeeAssignment` or enforce exactly one ACTIVE assignment per employee (partial unique). Define payroll's selection rule explicitly.

**Week 3 — Role-doctrine conformance**

11. **H4, H5, H6, M1**: Wire approval workflows for long leave, employee termination, inter-division/company transfers, and disciplinary written warnings + terminations. Two design choices to make:
    - **Path A**: Extend `ApprovalEngineService` to handle true multi-step (`currentStepOrder` advancement, step-specific approvers), then route every HR flow through it. Cleaner long-term.
    - **Path B**: Add explicit per-entity `xxxApprovedBy{Hr|Gm|Cfo}Id/At` fields (the Phase 3A payroll pattern). Less elegant but matches what's already there.
12. **M12**: Seed `GROUP_HR_DIRECTOR` (GROUP scope) with permissions: `payroll.approve.hr`, `leave_requests.approve.hr`, `disciplinary.cosign`, `termination.cosign`, etc. Pull HR_MANAGER (COMPANY) back to a non-approval role per the doctrine.
13. **L6**: Add a `grievance` model + endpoint that routes notifications directly to whoever holds `GROUP_HR_DIRECTOR`, bypassing the employee's own line manager.

**Week 4 — Hygiene + polish**

14. **M3**: Build `LeaveBalance` table (employee × leaveType × year) + service that increments on approval and decrements on cancellation.
15. **M9**: Auto-create or require explicit `TaxFilingPeriod` linkage before payroll calculation.
16. **M7**: Add cascade cleanup or block on employee soft-delete when active payroll/leave/advance records exist.
17. **L3**: Migrate `DisciplinaryActions` and `Performance` services to `CompanyScopeService.scopedWhereFor`.
18. **L4, L5, L10**: Add `divisionId/branchId` to HR-record tables; add `deletedAt` to `HRDocument`; add the missing hot-path indexes.
19. **L7**: Build out `AttendanceService` workflow rules (clock-in validation, late-arrival, LWOP detection).
20. **L8**: Confirm NHIF rates with the compliance officer; update the seed.

---

## Files inspected (selection)

**Schema:** [`database/prisma/schema.prisma`](database/prisma/schema.prisma) — 34 HR models, 7150–8270 + 8914–8981.

**Seeds:** [`database/seeds/seed.ts`](database/seeds/seed.ts) (permission catalog + roles), [`database/seeds/tz-reference.ts`](database/seeds/tz-reference.ts) (statutory tax data), [`database/seeds/c1-tz-tax-extensions.ts`](database/seeds/c1-tz-tax-extensions.ts).

**Backend services (under `backend/src/modules/`):**
- `hr/payroll-runs/payroll-runs.service.ts`
- `hr/payroll-runs/payroll-runs.controller.ts`
- `hr/payroll-calculator/payroll-calculator.service.ts`
- `hr/payroll-calculator/calculators.ts`
- `hr/payroll-postings/payroll-postings.service.ts`
- `hr/leave-requests/leave-requests.service.ts`
- `hr/salary-advances/salary-advances.service.ts`
- `hr/disciplinary-actions/disciplinary-actions.service.ts`
- `hr/employment-disputes/employment-disputes.service.ts`
- `hr/employees/employees.service.ts`
- `hr/employee-assignments/employee-assignments.service.ts`
- `hr/attendance/attendance.service.ts`
- `hr/performance/performance.service.ts`
- `hr/ccm-notices/ccm-notices.service.ts`
- `hr/disbursements/disbursements.service.ts`
- `hr/statutory-returns/statutory-returns.service.ts`
- `construction-labour-cost/construction-labour-cost.service.ts`
- `approval-engine/approval-engine.service.ts`
- `tax/tax-returns/tax-returns.service.ts`

**Frontend pages (under `frontend/src/app/(dashboard)/hr/`):** every page surveyed; sidebar [`frontend/src/components/layout/sidebar.tsx`](frontend/src/components/layout/sidebar.tsx) reviewed for menu coverage.

**Tests:** [`backend/src/modules/hr/payroll-runs/payroll-runs.dual-signoff.spec.ts`](backend/src/modules/hr/payroll-runs/payroll-runs.dual-signoff.spec.ts) (8 specs validating dual sign-off contracts).

---

## Method

Six parallel Explore agents, each scoped to one dimension of the HR module:

| Agent | Focus | Key findings |
|---|---|---|
| A | Schema + data model | 12 schema issues (M4–M6 most impactful) |
| B | Service-layer implementation | Payroll core verified; leave/attendance/disciplinary stubs |
| C | Controllers + frontend + UX | M10 + M11 broken integrations; permission code drift |
| D | Tanzanian compliance + GL accuracy | M9 + L8 + H7 are the compliance gaps |
| E | Approval flows + role architecture | C2 + every non-payroll flow non-conformant |
| F | Bugs, races, edge cases | C1 + C3 + H1–H3 + M2 |

Total: ~32 distinct findings (3 CRITICAL, 7 HIGH, 12 MEDIUM, 10 LOW).

Read-only audit. No code changed.
