# PetroDollar

The station operations app for **Mwanjalisi Oil Co Ltd**, the group's fuel trading arm. It is a native ITEMBA OS window (`/petrodollar`) that sits beside Cash Desk, Records and Point of Sale. It is not Fuel Grid, which is a separate product that the OS only launches (`fuel-grid-local.md`).

## What it does (v1)

One station day, four views, switched in the rail (`?view=`):

| View | Purpose |
| --- | --- |
| Shift report | Pump meters, tank dips, attendants and cash for one Day or Night shift. Autosaves a draft; closing runs the stock, sales and cash reconciliation. |
| Fuel received | Deliveries during the shift (same report, deliveries section). |
| Daily summary | Both shifts for the business date. Closed shifts only count towards totals. |
| Report history | Every saved shift, its differences and revision, with paging. |

Closing a paper shift creates no cash, stock or journals. A separate **Review & post shift** step connects a closed, reconciled revision to the business apps in one atomic transaction.

## How it is built

PetroDollar reuses the Fuel Reporting engine rather than duplicating it.

- **Backend** `backend/src/modules/petrodollar/` delegates paper reporting to `FuelReportingService`. `PetroDollarPostingService` owns reviewed posting and whole-shift reversal, using existing party, cash, inventory and accounting services. Company and station access are rechecked, including retries.
- **Frontend** `frontend/src/features/petrodollar/` is the OS shell (rail, scope row, states). `ReportEditor` and `DailySummary` come from `components/fuel-reporting/` and are re-skinned for the window in `petrodollar.css`, scoped under `.petrodollar` so the standalone `/fuel-reporting` portal is untouched.
- **Additive migration:** `20261001220000_petrodollar_postings` stores posting history and source ownership. Existing records stay intact. The app is visible with `fuel_reporting.read`; saving needs `fuel_reporting.manage` and the same role rules as Fuel Reporting (`BRANCH_MANAGER`, or `GROUP_SUPER_ADMIN`). Posting additionally requires the relevant Sales Desk, Cash Desk, inventory and journal permissions; deliveries need supplier/invoice access and payments need invoice payment permission. Flagged dip variances need stock-adjustment approval permission.

## Reviewed posting

Select existing customers and suppliers, due dates, connected station cash/mobile/bank accounts and separate receivable, revenue, payable, inventory, cost, expense and variance ledger accounts. No party or opening cost is guessed. Posting requires:

- A closed revision whose collections plus credit equal meter sales.
- Inventory opening quantities equal to opening tank dips, with verified costs and litre units.
- A positive purchase cost for every delivery, a TZS company profile and an open accounting period.
- Active accounts in the company/division/branch and sufficient cash and available stock.

| Source | Result |
| --- | --- |
| Collected sales | One paid Sales Desk direct sale with separate cash, mobile and bank receipts; corresponding cash and revenue/receivable journals. |
| Credit sales | One unpaid direct sale for each named customer, due date and receivable journal. |
| Fuel delivered | Invoice Desk direct supplier invoice, exact-cost stock receipt and inventory/payable journal. |
| Supplier payments | Invoice payment, Cash Desk movement and settlement journal; unpaid balance remains in Invoice Desk. |
| Expenses | Cash Desk expense and expense journal; original station category retained in notes. |
| Meter sales and dip variance | Costed stock issues and approved variance adjustments, with matching ledger valuation. |

Opening floats and handovers are reconciliation inputs, not additional receipts. Fuel sales and supplier invoices currently use the existing **Direct entries** registers in their apps, with canonical party links. This does not create legacy sales orders, fiscal tax invoices or petroleum POS transactions.

The browser retains a posting request identity in memory if the outcome is uncertain. **Check status** recovers an acknowledged posting before a retry is enabled. The server serialises station postings and compares the original request semantically; JSONB key order cannot create a false conflict. A different request cannot post an already-connected shift. Nothing retries a financial transaction automatically.

## Corrections

Owned sales, supplier invoices, cash movements and journals cannot be separately voided or reversed. Use **Correct this posting** in PetroDollar, with a reason, to reverse the entire posting. Then reopen, correct and close the paper shift and review a new posting. History remains intact.

Later customer collections and supplier payments are supported. They must be undone before reversing their source shift. Later closed shifts, subsequent stock activity or changed reservations also block reversal. An accepted reversal compensates cash/payments, voids source documents, reverses stock and journals, and restores the verified opening quantity and exact weighted-average valuation in one transaction. Closed accounting periods block both posting and reversal.

## Verification

`backend/scripts/verify-petrodollar-posting.cjs` creates and removes a named disposable **local** PostgreSQL database. It rehearses the actual additive migration, starts the real Nest module graph, and exercises a station day through validated APIs. It tests scope and read-only correction denial, inactive-company denial, stale revisions, opening-stock mismatch, closed-period rollback, concurrent retries (including reordered JSON), shared balances, later collections and supplier settlements, reservation safeguards, exact valuation reversal and reposting with a fractional supplier cost. Every ledger account must net to zero after reversal. `--serve` retains synthetic data and a loopback-only API on port 3017 for browser checks until interrupted. It does not use production data.

Frontend posting tests cover permission gates, reconciliation blockers, unsaved review warnings, uncertain submission recovery and identical-request retries. Release still requires staging acceptance with the actual station's opening stock and account mappings.

Local verification on 1 October 2026 passed the database/API proof, 61 frontend tests across PetroDollar and the affected desk screens, and the focused backend suites. Production builds and Prisma schema validation passed. A browser run closed and posted a synthetic shift, followed its Sales Desk link and reversed the entire posting. The posting panel was visually reviewed at 390px, 768px and 1440px. This is local evidence; production data and full staging business acceptance have not been checked for this change.

## The Mwanjalisi pin

- The company is found by **code `MWANJALISI`** (`PETRODOLLAR_COMPANY_CODE`), active and not deleted. Never by name (the stored name is "Mwanjalisi Oil"; "Mwanjalisi Oil Co Ltd" is a display string) and never by id (ids differ per environment).
- It is enforced on the server. `bootstrap` lists only Mwanjalisi stations. `workspace`, `history`, `save`, `reopen` and `revisions` answer 404 "Branch not found" for another company's station, as if it did not exist. The client never sends a company.
- The window has no company selector and never calls `/companies`.
- If the company is missing or inactive the API answers 503 and the window says PetroDollar isn't set up. This is a configuration problem, not a permission one.
- The editor must save through `/petrodollar`, not `/fuel-reporting`. `ReportEditor` takes an `apiBase` prop (default `/fuel-reporting`) for exactly this. A test asserts PetroDollar passes `/petrodollar`.

## Data it needs

- An active `FUEL_STATION` branch under a Mwanjalisi division, with tanks, pumps and nozzles. Set these up in the Fuel Reporting portal (Stations, Station setup); v1 has no setup screens.
- Access: the user needs `UserCompanyAccess` on Mwanjalisi. A group-level user gets implicit READ everywhere but **not** a station list: the station list comes from explicit company grants, and saving needs WRITE or MANAGE. Branch managers also need a `UserBranchAccess` row for their station.

## Window behaviour

- Independent windows (several may be open). Two windows editing one shift are protected by the report version (409 "changed in another window").
- The editor reports "unsaved or saving" through `onLock`. PetroDollar mirrors it into the window's unsaved-work guard, so closing the window or leaving the app prompts. Because the editor autosaves about 1.6 seconds after the last edit, the prompt only appears inside that window or when a save is failing.
- While locked, the other sections, station, date, shift and Refresh are disabled.
- `workspace.validation.ts` has a `petrodollar` host entry. Without it, any saved layout containing a PetroDollar window is rejected.

## Later phases

1. Station, pump and tank setup inside PetroDollar.
2. Save station-specific posting account mappings to reduce repeated selections.
3. Structured product-level sales and fiscal/tax documents, with an explicit migration from the direct registers.
4. Structured, queryable readings and deliveries; price management (`FuelPrice` has no writer today).
5. A pump-attendant entry role; Msaidizi eligibility (the routes are `@AgentExcluded` for now).
6. Retire the standalone `/fuel-reporting` portal.
