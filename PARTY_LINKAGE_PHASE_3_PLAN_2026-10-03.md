# Party linkage, Phase 3 plan: control

2026-10-03. Follows `PARTY_LINKAGE_PHASE_1_PLAN_2026-10-02.md` (foundation, PR JAPHARYROMAN/itemba-r#95), `PARTY_LINKAGE_PHASE_2_PLAN_2026-10-03.md` (surfaces, PR JAPHARYROMAN/itemba-r#96) and `SUPPLIER_CUSTOMER_LINKAGE_REPORT_2026-10-02.md` (findings; its section 5 names this phase "control"). Phase 1 gave every money row its party and one balance resolver; Phase 2 put the party on every screen. Phase 3 makes the books prove it: the general ledger learns the party, the sub-ledgers are reconciled to the control accounts and the period close checks them, the OS raises the alerts it already has types for, approvals and tax rows say who, and suppliers get the statement and remittance documents customers already have.

Branch `party-linkage-phase-3` is stacked on `party-linkage-phase-2` (commit `f8ba6adb`). Its PR targets the Phase 2 branch until #96 merges, then main.

---

## 1. What Phase 3 delivers

1. **The general ledger knows the party.** Every accounts payable and accounts receivable control line carries `partyType` and the supplier or customer id; the posting engine persists it; existing control lines are backfilled from their source documents by an idempotent, reviewable script. A party on a posted payable or receivable can no longer be re-pointed without re-posting.
2. **Control proves the sub-ledger.** A control-by-party report (control-account balance per party per currency beside the open sub-ledger outstanding, with the difference), a supplier aging detail mirroring the customer one, and a sub-ledger-versus-control reconciliation endpoint.
3. **Period close checks and remembers.** Closing a period runs the reconciliation; a difference blocks the close unless the closer gives a reason, and the per-party balances at close are snapshotted.
4. **The alerts the OS already has types for are raised.** Overdue receivable, overdue payable and a new credit-limit breach, one per party per day, each linked to the party with a destination the reader can open.
5. **Approvals carry the party.** An approval request about a payable, receivable, payment, order, expense, credit note or refund records the supplier or customer, and the approvals pages show and link them.
6. **Suppliers get their documents.** Supplier statement PDF and CSV from a statement run, and a remittance advice PDF per supplier payment, both on the supplier profile.
7. **Tax rows say who.** Every tax transaction snapshots the party and its TIN / VRN at creation, and a tax-by-party report groups them.
8. **The ERP cash-account balance stops being a second truth.** With the cash book on, cash-account reads return the connected Cash Desk account's balance, and the reconciliation is visible in Cash Desk.

---

## 2. Rules carried over, plus three new ones

All of Phase 1's and Phase 2's non-negotiables stand: additive migrations only, `requestId` idempotency on new writes, row locks and version checks, one transaction per business event, no double posting, names never proof of identity, currency and scope guards, tenant isolation with an isolation spec per new endpoint, NoteBook money independence, the resolver as the only balance a surface shows, a URL that names a party is honoured, and every new route agent-excluded or covered by a Msaidizi evidence fixture (the manifest is pinned by specs; the evidence packs run in CI).

New for control:

- **A control line without a party is a finding, not an error.** Posting never fails because a party is missing (legacy documents and manual journals exist); the reconciliation reports lines without a party as their own bucket, so nothing is hidden and nothing is blocked retroactively.
- **Reconciliation is read-only and derived.** Nothing in Phase 3 writes a balance; snapshots record what the ledger and the sub-ledger said at close, never what they should have said.
- **Alerts are idempotent per party per day** and carry a destination from `openPartyIn`, never a guessed path.

---

## 3. PR sequence

Each PR is independently shippable and verified like Phase 2 (typecheck, lint, the touched unit suites, frontend vitest where the component has tests, the seven Msaidizi manifest specs whenever a route or DTO changes, the migration-safety scan and a rolled-back dry run for every migration).

### PR-1 The ledger knows the party

Migration `journal_entry_lines` + `partyType` (NONE | SUPPLIER | CUSTOMER), `supplierId`, `customerId` (nullable, foreign keys, indexes, CHECK that the id matches the type). `PostingLine` gains optional `partyType` / `supplierId` / `customerId`; both persist paths in `PostingEngineService` write them. Every `AP_CONTROL` / `AR_CONTROL` line writer passes the party through one helper (`partyLine(...)`): payables, receivables, supplier payments, customer payments, supplier invoices, sales orders, credit notes, refunds, expenses, desk posting and cash connections. `backend/scripts/backfill-journal-party.cjs` (idempotent, dry-run by default) fills existing control lines from `JournalEntry.referenceType / referenceId`. Payables and receivables refuse a party change once posted or partly paid (report side finding 6).
Acceptance: a payable payment posts an AP control line with the supplier; the backfill script reports and, when run with `--apply`, fills the historical lines without touching amounts.

### PR-2 Control reports

`GET /financial-reports/control-by-party/:companyId?role=AP|AR&asOf=` (per party per currency: control balance from party-tagged lines, untagged control balance as its own row, sub-ledger open outstanding from the resolver's set-wise list, difference), `GET /financial-reports/supplier-aging-detail/:companyId/:supplierId` mirroring the customer one, both agent-excluded. Frontend: a "Control by party" report under Finance reports with party links, and the supplier aging detail on the supplier profile beside the resolver panel.

### PR-3 Period close checks and remembers

`AccountingPeriodsService.close` runs the control-by-party reconciliation for the period's company; a non-zero difference is refused unless the request carries `acknowledgeDifferences: true` with a reason, which is audited. Migration `party_balance_snapshots` (period, company, partyType, partyId, currency, subLedger, control, difference, snapshotAt); the close writes one row per party and currency. `GET /accounting-periods/:id/party-snapshots` reads them. Frontend: the close dialog shows the differences and asks for the reason.

### PR-4 Alerts with a destination

Enum value `CREDIT_LIMIT_BREACH` (additive). A daily job (`PARTY_ALERTS`, same registry as `LOW_STOCK`) raises `OVERDUE_RECEIVABLE` per customer, `OVERDUE_PAYABLE` per supplier and `CREDIT_LIMIT_BREACH` per customer over its limit, from the resolver's set-wise list, idempotent per party per day (throttled like low stock), with `linkedEntityType` SUPPLIER / CUSTOMER, `linkedEntityId`, metadata (amounts per currency, `href` from `openPartyIn`), plus a notification with `actionUrl` to the profile. Frontend: alert rows open the profile.

### PR-5 Approvals carry the party

Columns `partyType` / `supplierId` / `customerId` on `approval_requests` (additive). `ApprovalRequestsService.create` derives the party from `entityType` / `entityId` (Payable, Receivable, SupplierPayment, CustomerPayment, PurchaseOrder, SalesOrder, Expense, CreditNote, Refund, Supplier, Customer) and stores it; list and detail include the party; the approvals requests and pending pages show the party as a link.

### PR-6 Supplier statement and remittance advice

`GET /supplier-statements/:id/export?format=pdf|csv` renders a statement run's period (opening balance, payables raised, supplier payments and credit notes, closing balance) through the shared letterhead renderer; `GET /supplier-payments/:id/remittance?format=pdf` renders a remittance advice (payment, method, reference, allocations with payable numbers and balances). Buttons on the supplier profile's Statements tab and the Related → Payments section.

### PR-7 Tax rows say who

Columns `partyType` / `supplierId` / `customerId` / `partyTin` / `partyVrn` on `tax_transactions` (additive). Tax auto-apply snapshots the party from the source (sales order → customer; purchase order and expense → supplier; others none). `GET /tax/transactions/by-party?companyId=&from=&to=` groups taxable and tax amounts per party, direction and tax type. Input-VAT re-posting and per-supplier withholding stay out (section 5).

### PR-8 One cash balance

With `CASH_BOOK_UNIFIED` on, `GET /cash-accounts` and `/:id` return `currentBalance` from the connected Cash Desk account (and `mirrorBalance`, the stored figure, for comparison); the stored column keeps being written so nothing downstream breaks. Cash Desk → Accounts shows the connected ERP account and any difference from `/cash-book/reconciliation`.

### PR-9 Docs and status

`docs/os-business-connections.md` ("Party linkage phase 3"), `docs/design/itemba-os/records.md` if touched, and this plan's status section.

---

## 4. Out of scope for Phase 3

- **D4, the ERP document underneath a desk document** (Phase 2 PR-7). Beyond the posting-path conflict already recorded, a SupplierInvoice and a SalesOrder require product lines (`lines!` on both create DTOs) and post inventory or expense per line, while a desk document carries only totals. Creating one underneath needs a summary-line convention and a decision on which side posts. That is a design decision for the owner (section 5), then Phase 4.
- Input-VAT posting to the VAT receivable account and per-supplier withholding tax (report 4.7): accounting policy changes, decided with the accountant.
- POS, PetroDollar party at entry, Msaidizi party 360, dashboards, integrations (Phase 4).
- Msaidizi fixtures for the new endpoints (Msaidizi track).

---

## 5. Decisions for the owner

1. **Period close on differences:** block until explained (this plan), or warn only.
2. **D4 summary-line convention:** whether a desk invoice may become a SupplierInvoice with one summary line posted to a configurable expense or inventory account, and which side posts.
3. **Tax posting changes:** whether Phase 4 should re-post supplier-invoice input VAT to the VAT receivable account and add withholding.

---

## 6. Status — 3 October 2026

Built, PR-1 to PR-9 (D4 stays out, see section 4). Stacked on Phase 2 (`party-linkage-phase-2` at `f8ba6adb`, PR #96 open).

| PR | State | What landed |
|---|---|---|
| PR-1 The ledger knows the party | **Built** (first code commit on `party-linkage-phase-3`) | Migration `20261003110000_journal_line_party`: `partyType` (NONE / SUPPLIER / CUSTOMER), `supplierId`, `customerId` on `journal_entry_lines` with foreign keys, indexes and a CHECK. `PostingLine` gains the three optional fields; `partyOf(kind, id)` tags a line and `partyColumns` derives the stored columns so an id is never stored under the wrong type; both persist paths in `PostingEngineService` write them and the four built-in AP / AR handlers take the party from their payload. Every AP / AR control line writer passes the party: payables (creation and write-off), receivables (creation, settlement, write-off), supplier payments, customer payments (settlement and the overpayment held in AR), supplier invoices, sales orders (credit sales only), credit notes, refunds, expenses (accrual and settlement), external payments (from the relieved receivable) and desk postings (the canonical party behind the desk document). Payables and receivables refuse a party change once posted or partly paid. `backend/scripts/backfill-journal-party.cjs` (dry run by default, `--apply` to write, idempotent) tags historical control lines from thirteen reference types including desk documents through their canonical party, and lists the control lines it cannot explain as findings. |
| PR-2 Control reports | **Built** | `GET /financial-reports/control-by-party/:companyId?role=AP|AR&asOf=` groups the posted lines on the resolved AP / AR control account by party up to `asOf` (AP as credit minus debit, AR as debit minus credit), puts the open sub-ledger from the resolver's set-wise list beside each party, names parties that exist only in the control, shows the control balance without a party as its own row, and totals the difference; a missing control account is reported, not thrown. `GET /financial-reports/supplier-aging-detail/:companyId/:supplierId` mirrors the customer aging detail over open payables. Both are agent-excluded and read-only. Finance reports gains "AP Control by Supplier" and "AR Control by Customer" tabs (company + as-of) whose rows link to the party profile through `openPartyIn`, with differences highlighted; the supplier profile Overview shows a payables-aging panel under the resolver panel for users with `finance.reports.view`. |
| PR-3 Period close checks and remembers | **Built** | Both closes (the formal `POST /period-close/:id/close` and the raw `PATCH /accounting-periods/:id/close`) run the control-by-party reconciliation for AP and AR as of the period end before writing anything; a non-zero difference, or a control balance without a party, is refused with the differences in the error unless the close goes through the acknowledged route with a reason (5 to 500 characters), which the audit log keeps with the totals of both sides. Migration `20261003120000_party_balance_snapshots`: one row per party and role plus one 'NONE' row per role for the untagged control, in the base currency, sharing one `snapshotAt`, written inside the close transaction. `GET /period-close/:id/party-check`, `GET /period-close/:id/party-snapshots`, `POST /period-close/:id/close-acknowledged` and the same three on `/accounting-periods/:id`, all agent-excluded. Frontend: the Period Close dialog shows the check (differences with party links, untagged control) and asks for the reason when the sides differ; a closed record shows the balances recorded at close. |
| PR-4 Alerts with a destination | **Built** | Migration `20261003130000_alert_type_credit_limit_breach` adds the enum value. A fourth automation pass in the job worker (`enqueueDuePartyAlerts`, beside overdue reminders, low stock and scheduled reports) reads the resolver's set-wise list for every company and raises `OVERDUE_PAYABLE` per supplier with overdue outstanding, `OVERDUE_RECEIVABLE` per customer with overdue outstanding and `CREDIT_LIMIT_BREACH` (critical) per customer whose base-currency total exceeds its credit limit; one event per party per type per window (`AUTOMATION_PARTY_ALERT_INTERVAL_HOURS`, default 24) guarded like low stock, with `linkedEntityType` Supplier / Customer, `linkedEntityId`, metadata (overdue and total per currency, credit limit and excess, `href`) and a company notification whose `actionUrl` opens the profile. A worker scans parties at most once an hour. Frontend: alert rows about a supplier or customer carry an "Open profile" link built with `openPartyIn`; the rules page lists the new type. |
| PR-5 Approvals carry the party | **Built** | Migration `20261003140000_approval_request_party`: `partyType` / `supplierId` / `customerId` on `approval_requests` with foreign keys, indexes and a CHECK. `PartyExistsService.partyOfEntity` derives the party from `entityType` / `entityId` for Payable, SupplierInvoice, SupplierPayment, PurchaseOrder, Expense, Receivable, CustomerPayment, SalesOrder, CreditNote, Refund, Supplier and Customer (any spelling of the type), NONE otherwise and never an error; both creators (`ApprovalRequestsService.create` and the engine's `createApprovalRequest`) store it; list, detail, pending-for-me and submitted-by-me include the supplier / customer. Frontend: inbox rows name the party beside the reference, the inspector's primary fields link the party to its profile through `openPartyIn`. |
| PR-6 Supplier statement and remittance advice | **Built** | `GET /supplier-statements/:id/export?format=pdf|csv` renders a statement run through the shared letterhead renderer (`GeneratedDocumentsService.renderLetterheadPdf`, the same one Records uses): the run's recorded opening, payables raised, settlements and closing, then the period's activity (payables by issue date, payments by payment date) with a running balance, and a "recorded closing" line whenever the two closings differ; CSV carries the same rows. `GET /supplier-payments/:id/remittance?format=pdf` renders the payment, method, reference, paying account and every allocation with the payable's amount, paid to date and outstanding now, plus the applied / on-account split. Both agent-excluded and read-only. Frontend: PDF and CSV buttons on each run in the supplier profile's Statements tab (`supplier_statements.view`), and a "Remittance PDF" button on each row of Related → Payments. |
| PR-7 Tax rows say who | **Built** | Migration `20261003150000_tax_transaction_party`: `partyType` / `supplierId` / `customerId` / `partyTin` / `partyVrn` on `tax_transactions` with foreign keys, indexes and a CHECK. Tax auto-apply reads the party with the source (sales order → customer, purchase order and expense → supplier, with the master's TIN and VRN as they stand) and stamps it on every row it books; a source without a party books NONE. `GET /tax/transactions/by-party?companyId=&dateFrom=&dateTo=&direction=` (agent-excluded, read-only) groups taxable and tax amounts per party snapshot, direction, tax type and currency, keeps rows without a party as "No party", and totals per direction and currency. Finance reports gains a "Tax by Party" tab (company + period) with party links. |
| PR-8 One cash balance | **Built** | `GET /cash-accounts`, `/:id` and `/company/:companyId` read the connected Cash Desk account beside every ERP cash account; with `CASH_BOOK_UNIFIED` on and a connection present, `currentBalance` is the Cash Desk balance and `mirrorBalance` the stored figure, otherwise both are the stored figure; `balanceSource` ("cash-desk" or "stored") and `cashDeskAccount` say which and through what. The stored column keeps being written by every caller. Cash Desk → Accounts reads the connected ERP account with each desk account and shows the mirror and any difference, exact to the cent, or that the account is not connected; the Finance cash accounts page shows the stored figure under a Cash Desk balance. |
| PR-9 Docs and status | **Built** | `docs/os-business-connections.md` gains "Party linkage phase 3" (the three new rules, every PR, what stays open, the release order) and release step 3b; this section records each PR, its deviations and its verification. `docs/design/itemba-os/records.md` was not touched: the NoteBook did not change in phase 3. |

Deviations from the PR-1 text:

1. Fixed-asset capitalisation on supplier credit stays untagged: a fixed asset carries no supplier id, so its AP line is a finding until the asset learns its supplier.
2. Cash-book journals (`DeskCash`) and manual journals are not tagged; both are reconciliation findings by design (rule 1 of section 2).
3. Control-line balances are in the company base currency (journal lines carry no currency); the reconciliation in PR-2 compares them with the resolver's base-currency bucket.

PR-1 verification: backend typecheck clean; the suites of every touched module (accounting engine, payables, receivables, customer payments, supplier invoices, refunds, expenses, external payments, sales orders, credit notes, purchase orders, supplier payments, desk reports) 21 files / 408 tests passing, including the new `journal-line-party.spec.ts`, a desk-posting case for the canonical party and a payables case for the re-point refusal; the seven Msaidizi manifest specs passing; migration-safety scan OK; the migration applied inside a rolled-back transaction on the local database and on a fresh database created from all 166 migrations; the backfill's SELECT, UPDATE and findings statements validated on that migrated database inside a rolled-back transaction and its dry run executed. The local database holds no payables or AP / AR journals (4 journal lines in total), so the backfill could not be shown tagging real rows; eslint zero errors. Not walked through in a browser.

Deviations from the PR-2 text:

1. The reconciliation is in the company base currency only, not per currency: journal lines carry no currency (deviation 3 above), so the sub-ledger side is the resolver's base-currency bucket and open documents in other currencies are listed by count only.
2. The sub-ledger side is the resolver's current open outstanding, not a historical one: documents keep no balance history, so for a past `asOf` the difference is informational until PR-3's snapshots exist.

PR-2 verification: backend typecheck clean; `financial-reports` suites 2 files / 18 tests passing including the new `control-by-party.spec.ts` (AP netting, AR netting, control-only party naming, untagged row, missing control account, supplier aging buckets); the seven Msaidizi manifest specs passing with the two new agent-excluded routes; eslint zero errors. Frontend typecheck clean; party, supplier profile, finance and workspace tests passing including the new `supplier-aging-panel.test.tsx`; eslint zero errors; format baseline OK (the reports page is in the baseline and was edited, not reformatted). Root `verify:deploy` OK. Not walked through in a browser.

Deviations from the PR-3 text:

1. The acknowledgement is its own route (`close-acknowledged` with `{ reason }`), not an `acknowledgeDifferences` body on the existing close: `PeriodCloseController.close` has a pinned body-less Msaidizi fixture, and the manifest spec requires a fixture body exactly when the route takes one.
2. A control balance without a party counts as a difference for the gate (it is a difference at the total level), so a company whose legacy lines await the backfill closes only with a reason until the backfill runs.
3. The sub-ledger side of a snapshot is the resolver's current open outstanding (documents keep no history); the control side is the ledger as of the period end. Snapshots are not unique per period: a reopen and re-close records a new set, and the read returns the latest set with the number of closes.

PR-3 verification: backend typecheck clean; `financial-reports`, `period-close` and `accounting-periods` suites 5 files / 35 tests passing including the new `party-close-check.spec.ts` (both roles as of the date, untagged as a difference, refusal message and payload, audit metadata, snapshot rows and shared timestamp, latest-set read) and gate cases in both close services; the seven Msaidizi manifest specs passing with the six new agent-excluded routes; eslint zero errors; migration-safety scan OK; the migration applied inside a rolled-back transaction on the local database with an insert round trip and the CHECK proven. Frontend typecheck clean; party and reports feature tests passing including the new panel tests and three Period Close dialog cases (reason required and acknowledged route, plain close when the sides agree, recorded balances on a closed record); eslint zero errors; format baseline OK. Root `verify:deploy` OK. Not walked through in a browser.

Deviations from the PR-4 text:

1. There is no `PARTY_ALERTS` background-job type: low stock is not a registered job either but an automation pass on the worker's poll loop, so the party alerts are the fourth pass in that loop (gated by `AUTOMATION_DISPATCH_ENABLED` like the others) rather than a new job type.
2. `linkedEntityType` is `Supplier` / `Customer` (the model names, as every other alert uses) rather than SUPPLIER / CUSTOMER.
3. The backend persists the profile href through its own `partyProfileHref` (it cannot import the frontend helper); the alerts page builds its link with `openPartyIn` from the linked entity and only the stored notification `actionUrl` relies on the backend copy.

PR-4 verification: backend typecheck clean after regenerating the client; `job-worker` suites 4 files / 71 tests passing including five new cases (three alert types with destinations and metadata, idempotency per party per type plus the batch cap, nothing raised when nothing is due, the transaction guard, the hourly scan gate); eslint zero errors; migration-safety scan OK; the enum migration rehearsed inside a rolled-back transaction. No route or DTO changed, so the Msaidizi manifest was not re-run. Frontend typecheck clean; alerts acceptance tests 4 passing including the new profile-link case; eslint zero errors; format baseline OK (both alerts pages are in the baseline and were edited, not reformatted). Root `verify:deploy` OK. Not walked through in a browser.

Deviations from the PR-5 text:

1. `SupplierInvoice` is derived as well (the inbox's own fixtures use it as an entity type); no other type in the list was dropped.
2. Existing approval requests keep `partyType` NONE: no backfill was written, because the party of a historical request is only as good as its document and the inspector shows a dash rather than a guess. A backfill through `partyOfEntity` is a one-script follow-up if the owner wants history linked.
3. The approvals requests and pending pages are the one `ApprovalInbox` component; the rows are buttons, so the party is text on the row and the link is in the inspector.

PR-5 verification: backend typecheck clean after regenerating the client; `party-exists`, `approval-requests` and `approval-engine` suites 5 files / 39 tests passing including the new derivation cases (spelling variants, NONE for unknown types and partyless documents), the create / detail-include cases and the engine cases with and without the resolver; the seven Msaidizi manifest specs plus the approvals mutation manifest passing (no route or DTO changed, the fixtures' body-less close and create stay pinned); eslint zero errors; migration-safety scan OK; the migration rehearsed inside a rolled-back transaction with the CHECK proven. Frontend typecheck clean; approvals inbox tests 13 passing including the party row text and the inspector link; eslint zero errors; format baseline OK. Root `verify:deploy` OK. Not walked through in a browser.

Deviations from the PR-6 text:

1. There are no supplier-side credit notes in the schema (`CreditNote` is customer-facing), so the statement lists payables raised and supplier payments; a supplier credit note would appear once a model exists.
2. The run's recorded balances attribute a payable's settlement to the payable's own period (that is how `generate` reconciles with the payables ledger), while the activity lists payments by payment date; the document shows both and names the recorded closing when they differ rather than silently picking one.
3. Statement export is gated by `supplier_statements.view` (the run's own permission) and the remittance by `supplier-payments.view`; no new permission was added.

PR-6 verification: backend typecheck clean; `supplier-statements` and `supplier-payments` suites 4 files / 30 tests passing including the pure builders (ordering, running balance, whole-company naming, CSV escaping, letterhead model, mismatch line; allocations, on-account and reversed remittances) and the service cases (period scoping, CSV without the renderer, PDF through the renderer for the run company or the payment's company and branch, refusal without it); the seven Msaidizi manifest specs passing with the two new agent-excluded routes; eslint zero errors. Frontend typecheck clean; workspace and supplier profile tests passing including the new remittance case (two unrelated workspace suites time out only under parallel load and pass alone, as in Phase 2); eslint zero errors; format baseline OK. Root `verify:deploy` OK. Not walked through in a browser; the PDFs were not opened.

Deviations from the PR-7 text:

1. The range parameters are `dateFrom` / `dateTo` (what every Finance report sends) rather than `from` / `to`.
2. Rows are grouped by the TIN and VRN snapshot as well as the party, so a party whose registration changed mid-period shows one row per registration rather than one blended row.
3. Manual tax transactions (`POST /tax/transactions`) and the other source types (POS, payroll, rent, parking, bookings) book NONE: only the three auto-apply sources know their party. Existing rows keep NONE; no backfill was written.

PR-7 verification: backend typecheck clean after regenerating the client; `tax-auto-apply` and `tax-transactions` suites 2 files / 17 tests passing including the new snapshot cases (customer with TIN and VRN on a sales order, supplier on a purchase order, NONE then supplier on an expense) and the by-party cases (grouping, naming, "No party", totals, direction filter, invalid date); the seven Msaidizi manifest specs passing with the new agent-excluded route; eslint zero errors; migration-safety scan OK; the migration rehearsed inside a rolled-back transaction with the CHECK proven. Frontend typecheck clean; finance page tests passing; eslint zero errors; format baseline OK (the reports page is in the baseline and was edited, not reformatted). Root `verify:deploy` OK. Not walked through in a browser.

Deviations from the PR-8 text:

1. Cash Desk → Accounts computes the difference from the ERP account it already reads with each desk account (the same two figures `/cash-book/reconciliation` compares) rather than making a second request to that endpoint; the reconciliation view is unchanged and remains the place that also says whether the flag is on.
2. The flag is read by the cash accounts service itself (global config), so no module wiring changed; without the config the stored figure is shown.

PR-8 verification: backend typecheck clean; `cash-accounts`, `cash-desk` and `cash-book` suites 8 files / 44 tests passing including the new `cash-accounts.service.spec.ts` (unified with a connection, flag off, no connection, no config); the seven Msaidizi manifest specs plus the execution-evidence spec passing (no route changed; the cash account reads gained fields); eslint zero errors. Frontend typecheck clean; Cash Desk and cash accounts tests passing including the exact-cents mirror cases and the card text; eslint zero errors; format baseline OK (the cash accounts page is in the baseline and was edited, not reformatted). Root `verify:deploy` OK. Not walked through in a browser.

### Whole-branch verification — 3 October 2026

- Full backend jest (441 suites) on the branch: every suite passed except five under `msaidizi`. One (`model-client.spec`) needs `ANTHROPIC_BASE_URL` unset and passes with it unset. The other four check that every mutation evidence fixture closes every scalar of a created row, and the party columns added to `journal_entry_lines` and `tax_transactions` broke that closure. Fixed in the follow-up commit: the manual-journal evidence (base) expects `partyType` NONE and null ids literally, because a manual journal writes the defaults; the autonomy, finance and administrative tranches list the new columns as allowed (unpinned) on their journal-line and tax-transaction effects, so the executed pack accepts whatever the posting paths now write. Pinning the party values per line (which fixture lines are AP / AR control lines, and what tax auto-apply stamps from the fixture sales order) is a follow-up once the pack has run against party data. After the fix the whole `msaidizi` module passes (147 suites / 1,809 tests), backend typecheck is clean and eslint has zero errors.
- Full frontend vitest (268 files): 13 failures in 8 files, none touched by phase 3. The three that fail for a reason other than a timeout (`itemba-os-flag.test.tsx` ×2, `accounting-drafts.test.tsx` "exposes kept accounting work") fail identically on the phase 2 base commit `f8ba6adb` in a separate worktree, so they predate this branch; the remaining ten are 5-second timeouts under parallel load and their files pass when run alone (as in phase 2).
- Lesson recorded: a schema change that adds scalar columns must run the whole `backend/src/modules/msaidizi` directory, not only the seven manifest specs.
