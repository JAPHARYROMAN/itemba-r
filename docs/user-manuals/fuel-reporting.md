# Fuel Reporting

Fuel Reporting is the station manager’s manual shift book. Open it from the login
page’s **Fuel Reporting** card or from the signed-in sidebar. Sign in with an
existing Itemba account. MWANJALISI is the default company when accessible; the
branch selector uses the active fuel stations already registered in Itemba.

The portal lives at `/fuel-reporting`, outside the Itemba dashboard layout, with
its own navigation and sign-in page at `/fuel-reporting/login`. Shared accounts,
branch permissions, and reporting data still come from Itemba. **Open Itemba**
returns to the main application. Signing out returns to the Fuel Reporting
sign-in page and ends the shared session. Sign-out is disabled while a report
has unsaved changes or is saving.

## Access and setup

- `BRANCH_MANAGER`: read, enter, close and correct reports for explicitly assigned
  branches. The branch grant must have WRITE or MANAGE access to submit. The
  account must also have access to the company.
- `GROUP_SUPER_ADMIN`: the same reporting workflow, plus station, pump, and tank
  configuration. Company write access is still enforced.
- Company managers, directors, auditors and accountants receive reporting read
  access; pump attendants receive no reporting permission in this version.
- Only an admin can configure pumps. Removing a pump sets it and its nozzles
  inactive, preserving existing reports. Close draft reports before removal.
- Use **Station setup** to add each branch tank and its fuel product/capacity,
  then add pumps with their nozzles. Existing seeded fuel registers are reused.
  Each report snapshots the register when first saved, so later configuration
  changes apply to new reports and do not rewrite history.

## Manage stations as an admin

Open **Stations** within Fuel Reporting. Choose the company and division, enter
a unique station code and name, and optionally a location, then select **Add
station**. Mwanjalisi Oil Co Ltd is selected by default, including when returning
from editing another company's station. If the account has no available Mwanjalisi
division, the company selection stays empty instead of defaulting to Itemba.
Use **Configure**
on the new station to open its tank and pump setup.

Use **Edit station** to change the name, code, or location. The company and
division stay fixed so existing records keep their ownership. **Remove station**
makes the shared branch inactive in both Fuel Reporting and Itemba. Close all
draft Fuel Reporting reports first. Removal retains reports, revisions, tanks,
pumps, and branch assignments; **Restore station** makes them available again.
Station changes are recorded in the audit log. Managers cannot use these controls
or call the administration endpoints.

## Enter a shift

1. Select the branch, business date, and **Day** or **Night**.
2. Copy each nozzle’s opening/closing meters, selling price, and attendant’s full
   name from paper. A nozzle with no sales still needs a named attendant and equal
   opening/closing readings. Add an interval for a handover or price change.
3. Enter gross cash sales collections, mobile money, bank/card collections,
   opening cash float, actual cash handed over, and any named customer credit sales.
4. Receive fuel by **fuel type and litres only**. Supplier, delivery reference and
   total cost are optional. Supplier payments are recorded separately from fuel
   quantities; select whether payment came from shift cash or another account.
5. Enter expenses and their payment source. Confirm deliveries and expenses even
   when there were none.
6. Manually enter every tank’s closing dip volume in litres. Opening volumes
   carry forward from the previous closed report. For the first report they must
   be entered manually as the baseline. Zero is valid; blank is incomplete.
7. Explain any differences, review the calculations, then **Submit & close shift**.

Changes save automatically after a pause in entry; **Save draft** is also available.
The saved indicator confirms server persistence. Do not leave the page while it
says unsaved or reports a save error. Paper images/PDFs can be attached through the
existing document upload permissions (`documents.manage` and `documents.view`).

## Reconciliation and history

- Fuel sold = sum of closing minus opening nozzle readings.
- Expected sales = sum of litres multiplied by the applicable interval price.
- Sales difference = cash + mobile + bank/card + credit sales − expected sales.
- Expected cash handover = opening cash + cash sales − expenses and supplier
  payments explicitly paid out of shift cash.
- Expected closing stock = opening dip stock + fuel received − fuel dispensed.
- Stock difference = actual closing dip stock − expected closing stock.

Stock is reconciled by fuel type, aggregating all tanks of that type. Deliveries
never require a receiving tank. Differences in opening meters and opening tank
volumes against the preceding report are recorded too. Negative differences are
shortages; positive differences are excesses. Zero results are retained as well.
These are manual reporting records; they do not post duplicate sales, stock or
accounting entries into other operational ledgers. They are not a profit statement.

Daily totals include **closed reports only**. A day is complete only after both
Day and Night have closed. Unknown delivery costs are explicitly marked; totals
for known purchase costs are not presented as complete. History includes drafts,
closed reports, all saved revisions, authors, timestamps and correction reasons.
Daily summaries and pump/attendant records can be exported as CSV.

Close shifts in business-date order. To correct a closed report, enter a reason
and reopen it. If later shifts have closed, reopen those first, then correct and
close in order so their opening balances can be checked. Earlier revisions remain
available. Concurrent saves use version checks and a branch database lock; a stale
browser receives a conflict instead of overwriting someone else’s report.

## Deployment

The feature uses the existing Next.js frontend, NestJS API, PostgreSQL database,
authentication, branch/company grants and document storage. No new service or
environment variable is required.

1. Review and apply the normal Prisma deployment migrations, including
   `20260905120000_fuel_reporting`, against the intended deployment database.
   The migration adds two report/revision tables and the three reporting
   permissions, and grants them to existing system roles.
2. Generate Prisma Client and rebuild/deploy the backend and frontend together.
3. Ensure station managers have `BRANCH_MANAGER`, company access and explicit
   branch WRITE/MANAGE assignments. Check the branch pump/tank register as admin.
4. Refresh the signed-in session if newly granted permissions have not appeared.

Future full seeds preserve these grants through `permission-matrix.ts`. No company,
branch or fuel-volume records are invented by the deployment migration.

## Verification

From `backend`, run:

```powershell
npm test -- --runTestsByPath src/modules/fuel-reporting/fuel-reporting.calculate.spec.ts src/modules/fuel-reporting/fuel-reporting.service.spec.ts
node scripts/verify-fuel-reporting.cjs
```

The integration runner requires local PostgreSQL with CREATE DATABASE rights and
`psql` on PATH. It creates a uniquely named disposable database, tests the actual
migration, permissions, service/API, concurrent saves and persistence, then removes
that database. It never migrates the application database.

For browser verification, run the integration runner with `--serve` (fixture API
at `127.0.0.1:3014`), point the local frontend’s `BACKEND_INTERNAL_URL` to
`http://127.0.0.1:3014/api/v1`, start the frontend on port 3009, and run
`node scripts/smoke-fuel-reporting.mjs` from the repository root. This uses Chrome,
fixture authentication and real reporting requests through the Next proxy into
the isolated database. Stop the fixture runner with Ctrl+C to clean up.
