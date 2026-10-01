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

It records and reconciles only. Closing a shift creates no Cash Desk movement, stock change or journal entry, exactly like Fuel Reporting today.

## How it is built

PetroDollar reuses the Fuel Reporting engine rather than duplicating it.

- **Backend** `backend/src/modules/petrodollar/` is a thin layer over `FuelReportingService`. It resolves the company, rejects anything outside it, and delegates. Branch-manager and permission rules stay in Fuel Reporting.
- **Frontend** `frontend/src/features/petrodollar/` is the OS shell (rail, scope row, states). `ReportEditor` and `DailySummary` come from `components/fuel-reporting/` and are re-skinned for the window in `petrodollar.css`, scoped under `.petrodollar` so the standalone `/fuel-reporting` portal is untouched.
- **No migration, no new permission.** The app is visible with `fuel_reporting.read`; saving needs `fuel_reporting.manage` and the same role rules as Fuel Reporting (`BRANCH_MANAGER`, or `GROUP_SUPER_ADMIN`).

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
2. Post closed shifts to Cash Desk `DAILY_SALES` and the ledger.
3. Post tank-dip variance as a stock adjustment, and reconcile tank balances with inventory.
4. Structured, queryable readings and deliveries; price management (`FuelPrice` has no writer today).
5. A pump-attendant entry role; Msaidizi eligibility (the routes are `@AgentExcluded` for now).
6. Retire the standalone `/fuel-reporting` portal.
