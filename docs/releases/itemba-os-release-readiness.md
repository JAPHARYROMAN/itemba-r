# ITEMBA OS — release verification, 20 September 2026

> Historical evidence. See the [25 September release candidate assessment](itemba-os-2026-09-25.md)
> for current packaging, CI, workflow, dependency and recovery status.

**Release decision: hold.** This is evidence from an isolated local rehearsal, not staging acceptance or approval to deploy. No working business records were changed by the rehearsal. The opening-data audit used a PostgreSQL read-only transaction.

## Current phase 4 acceptance pass — 20 September

The current rehearsal API was restarted against the latest build. All **55 business
workflow checks**, **20 document checks**, **11 new file-search checks** and **51
loan database assertions** pass. The route contract check also passes: 945 literal
frontend calls, 1,404 API routes and 12 validator tests; 71 dynamic call sites are
outside that static check.

**Full backend CI remains red: 4,172 passed, 17 failed across 414 suites.** The 12
failing suites identify capability/evidence drift: 96 discovery-eligible operations
lack matching positive fixtures, and eight existing mutation request contracts need
review. This includes the changed loan and payroll payment fields. The failure list
and new read-only diagnostic are in `.release/os-design/acceptance-blockers.json`
and `acceptance-contract-audit.json`. No suite or security assertion was weakened.

Phase 3's 2,071 frontend tests and successful frontend/backend builds remain the
latest application-build evidence. This acceptance pass adds rehearsal/diagnostic
scripts and documentation; it does not change application code or claim a new
remote CI run. Two one-page exported PDFs were visually inspected; native printing,
multi-page output and live desktop/mobile/date-picker acceptance remain pending.
Automatic approval review previously rejected preview startup with “blocked by
policy”; the frontend was not restarted through another method.

See the [phase 4 acceptance evidence and operator checklist](itemba-os-phase-4-acceptance.md)
for precise boundaries, remaining scenarios and repeatable commands. Opening-data
approval, staging UAT and release packaging are still outstanding. Historical browser
and operational rehearsals below remain dated evidence, not current sign-off.

## Gate 4 — complete business workflows

The authenticated API rehearsal currently records **55 passed checks and zero failed checks**. It uses a separate PostgreSQL database and Redis instance, synthetic companies, divisions, branches, suppliers, customers and employees, and actual sign-in/permission guards.

| Workflow                     | Evidence                                                                                                                                                                                       | Remaining requirement                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Purchase → supplier payment  | Invoice Desk invoice, reviewed purchase posting, Cash Desk supplier payment, cash posting and zero supplier report balance pass. Retrying the same payment does not duplicate it.              | Repeat with approved staging roles and real opening data.                                                                |
| Sale → collection            | Sale posting, collection, linked cash receipt and zero customer report balance pass. Retrying the collection does not duplicate it.                                                            | Confirm representative business scenarios with the sales owner.                                                          |
| Cash → reconciliation        | Cash Desk equals the mapped bank ledger before and after payroll; statement import, matching, independent approval and close pass. The preparer cannot approve their own reconciliation.       | Historical ERP cached balances still need a separate opening reconciliation.                                             |
| Payroll → payment → journals | Reviewed accrual, atomic payroll/Cash Desk/ledger payment, per-employee salary records, retry protection, reversal and corrected payment pass. Advances and commissions reverse with payment.  | Repeat with approved staging roles, opening data and signed-off statutory rates.                                         |
| Organisation permissions     | Invoice writes outside company/division/branch scope and writes by a read-only actor are rejected. A sibling-branch invoice is hidden from the branch actor and visible to its division actor. | This is not a complete permission certification of every app or payroll action. Run the approved role matrix in staging. |

Payroll retains separate HR and Finance sign-off and independent Accounting review of the accrual. The payment action now requires a posted accrual, a connected Cash Desk account and cash/journal permissions. Payment and reversal commit the run status, employee payment records, cash entry, journal, advance recovery and commission settlement in one transaction. The latest fixture pays TZS 419,679.80 including commission and advance recovery; Cash Desk and the mapped bank ledger both finish at TZS 581,120.20. Closed periods, insufficient funds, wrong company/currency, restricted roles and stale retries are rejected. See [payroll cash connection](../design/itemba-os/payroll-cash-connection.md).

The rehearsal uses the repository's configured Tanzania reference seed; that does not certify the rates for the release's payroll dates.

Cash Desk's entries and mapped ledger are the sources checked by the cash bridge. The legacy ERP `CashAccount.currentBalance` remains a separate operational cache. The rehearsal does not silently overwrite it or create balancing adjustments. See [accounting readiness](../design/itemba-os/accounting-readiness.md).

### Historical browser review — 19 September

- Payroll follow-up: the production browser completed a synthetic reversal and corrected payment. The run returned to Paid, Cash Desk displayed TZS 581,120.20 and its payroll detail linked corrections back to Payroll. At 390 × 844 the forms had no page-level horizontal overflow; keyboard navigation moved from account selection to Back. Evidence: `.release/payroll-cash-mobile.png`.

- At the time of this review, the production frontend on port 3109 signed into the isolated API on 3114 and displayed the populated Invoice Desk and Reports app. It is currently stopped.
- Reports display the fixture's sales, purchases, customer/supplier balances and branch breakdown. The mobile report has a 390-pixel viewport without page-level horizontal overflow. Keyboard navigation moves from the From filter to To.
- Opening the native Invoice Desk date picker crashed the in-app browser tab. Calendar selection remains **unverified**, rather than passed.
- The Reports Print / PDF action was invoked, but no inspectable native print preview/PDF was available. Pagination, clipping, printed totals and actual printer output remain **unverified**.
- The broader route-by-route live review in [phase 5](../design/itemba-os/phase-5-rollout.md) still needs its outstanding acceptance checks.

## Gate 5 — opening data

The read-only audit currently finds:

| Finding                                                | Count | Required resolution                                                                                                                  |
| ------------------------------------------------------ | ----: | ------------------------------------------------------------------------------------------------------------------------------------ |
| Company missing accounting currency/profile            |     2 | Confirm the companies in release scope and complete their approved profiles.                                                         |
| Posted journal line linked to a deleted ledger account |     2 | Review the historical ledger and restore or correct the account through the approved accounting process; do not infer a replacement. |
| Nonzero cash/bank account without ledger mapping       |     1 | Agree the bank/cash opening position and map the proper control account.                                                             |
| Stock value differs from quantity × average cost       |     1 | Reconcile the count, valuation method and approved stock opening value.                                                              |

The current database contains five companies, ten divisions, six branches, eight employees, fifteen products and two stock-balance rows. Its Desk invoice/supplier/customer/payment registers and loan registers are empty. Empty registers are not evidence that all opening purchases, debts or balances have been imported.

The audit checks hierarchy consistency, cross-app supplier/customer and purchase-document duplicate candidates, paid/outstanding amounts, stock valuation, cash entries, posted journal controls and paid payroll posting. Identity matches are candidates for human review; they are never merged automatically. Detailed record IDs stay in the ignored `.release/opening-data-audit.json` file.

Opening approval remains **false** until the business supplies and agrees:

1. Opening date, source-system freeze and companies/branches in scope.
2. Signed trial balance by company and currency; bank statements and cash counts.
3. Unpaid supplier/customer documents, credits, deposits and unallocated payments, tied to control accounts.
4. Employee register and payroll liabilities/advances; verified payroll reference rates.
5. Stock counts and values; lender statements and intercompany confirmations.
6. A source-of-truth mapping for each register, duplicate decisions, control totals and owner sign-off.

Record an external source ID, company/division/branch codes, currency, opening date, source document and control account with every imported balance. Import into the selected owning app once, reconcile it, then confirm reports before permitting ordinary transactions. No guessed opening journals or duplicate adjustments were created.

## Gate 6 — packaging and operations

| Check                        | Result                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend tests               | 193 files / 2,071 tests passed in phase 3; not rerun during this acceptance pass.                                                                                                                                                                                                                                    |
| Full backend test baseline   | 4,172 passed / 17 failed, across 402 passing and 12 failing suites. Current failures are Msaidizi capability/evidence contracts. This is not green CI.                                                                                                                                                               |
| Focused final backend checks | 45 passed: health probes, accounting dates, cash bridge and reconciliation workflow. The earlier statement-service suite also passed.                                                                                                                                                                                |
| Builds                       | Backend Nest build and frontend production build passed; frontend generated 208 static pages.                                                                                                                                                                                                                        |
| Lint/format                  | Frontend lint passed. Backend baseline has zero errors and existing warnings. Both formatting gates now report zero new drift; existing baselines were not expanded.                                                                                                                                                 |
| Frontend/backend routes      | 944 calls checked against 1,390 routes; contract gate and 12 extractor regressions pass. 67 dynamic call sites remain outside static proof.                                                                                                                                                                          |
| Deployment shapes            | Production/staging Compose validation passes. The aggregate deployment gate fails because staging-only Msaidizi provider/attestation variables differ from the production environment contract.                                                                                                                      |
| Empty-database migrations    | All 153 migrations applied to the isolated database.                                                                                                                                                                                                                                                                 |
| Upgrade rehearsal            | A 150-migration predecessor upgraded through the three financial migrations, including the additive payroll/cash connection. Its existing cash value was preserved, ledger mapping stayed unset, and a second deploy had no pending migrations. This is a synthetic predecessor, not a restored production database. |
| Database restoration         | 381 tables / 3,678 rows restored to a new database and compared using row counts and SHA-256 content hashes. Restore took approximately 9.0 seconds locally.                                                                                                                                                         |
| Restored application         | A second API on port 3115 passed readiness, restored-user login, paid-invoice retrieval and the sales report; it was then stopped.                                                                                                                                                                                   |
| Dependency failure/recovery  | Readiness: 200 → 503 during isolated PostgreSQL outage → 200 after restart. Process liveness remained 200.                                                                                                                                                                                                           |
| Remote operations            | Object/file storage restoration, external alert delivery, production-capacity recovery timing, old-image rollback and traffic cutover remain pending.                                                                                                                                                                |

### Payroll connection follow-up

- Backend build, frontend production build (208 pages), 68 targeted backend tests and 36 targeted UI tests pass after the payroll connection.
- Route validation passes against 1,391 endpoints. Targeted backend lint reports no errors (existing warnings remain).
- The earlier full-suite counts below are baseline evidence; they have not been rerun as full CI for the changed candidate. Release scope, the recorded unrelated failures, staging UAT and opening sign-off remain outstanding.

### Fixes made during verification

- Accounting-period lookup now normalizes business dates in UTC. Local-midnight conversion previously moved the first of the month into the preceding period in East Africa Time.
- Reconciliation's PostgreSQL advisory lock casts its void return to a Prisma-supported type. Statement imports previously returned HTTP 500 on a real database.
- Database-dependent health probes return HTTP 503 when unavailable, allowing infrastructure to detect the outage. Liveness remains separate.
- The route validator parses TypeScript expressions, follows scoped constants and edit/create branches, and checks concatenated/nested-template paths. It no longer mistakes URL fragments for separate endpoints. The deployment CI job installs its pinned TypeScript tooling.
- New formatting drift from the overhaul was formatted without adding exemptions to the baseline.

### Release branch and acceptance

The working checkout contains ITEMBA OS changes mixed with separate Msaidizi work. **No release branch, commit, remote CI run or deployment is represented as complete.** Release contents must be selected before packaging the shared schema, application module, environment contracts and CI changes together.

The final candidate must have an immutable commit and image digests, an explicit migration list, pinned configuration, a rollback image, an access matrix and signed acceptance evidence. Deploy that same candidate to staging, repeat the business workflows and browser checks, and restore both database and uploaded files into a separate recovery environment. Do not repair a failed migration by deleting migration history or rewriting posted opening data.

For release operation, assign owners for readiness/error alerts, database connectivity, backup age, disk capacity and failed background jobs. Route alerts to the agreed channel and prove delivery. Record the accepted recovery point/time and the maintenance/cutover decision. A local restore time does not establish production recovery targets.

## Repeating the local proof

Private configuration, fixture credentials, detailed audits and generated evidence are ignored under `.release/`. These commands use only the dedicated rehearsal project, database and ports. The scripts refuse a different database host/port/name for mutation rehearsals.

```powershell
node scripts/prepare-release-proof.mjs
docker compose --project-name itemba-os-release --env-file .release/rehearsal.env -f docker-compose.release-proof.yml up -d --wait

# In the shell used to migrate/start the rehearsal API:
Get-Content .release/rehearsal.env | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
  }
}
npx prisma migrate deploy --schema=database/prisma/schema.prisma
npm --prefix backend run build
# Run node dist/main.js from backend with this shell's environment (port 3114).

node scripts/prove-release-workflows.mjs
node scripts/rehearse-release-upgrade.mjs
node scripts/rehearse-release-recovery.mjs
node scripts/rehearse-release-cutover.mjs
node scripts/rehearse-release-health.mjs
```

The workflow command verifies payroll/Cash Desk agreement and exits nonzero on any failed assertion. Run recovery after workflow writes finish; run the database-outage rehearsal after other database checks finish. Rehearsals retain their isolated databases for inspection and never remove working volumes.

Run `node scripts/audit-opening-data.mjs` for the **read-only** opening audit. It uses `OPENING_AUDIT_DATABASE_URL` when explicitly configured, otherwise `backend/.env`. It always reports that opening approval is outstanding.
