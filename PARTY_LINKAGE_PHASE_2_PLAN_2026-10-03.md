# Party linkage, Phase 2 plan: the surfaces

2026-10-03. Follows `PARTY_LINKAGE_PHASE_1_PLAN_2026-10-02.md` (foundation, PR JAPHARYROMAN/itemba-r#95) and `SUPPLIER_CUSTOMER_LINKAGE_REPORT_2026-10-02.md` (findings). Phase 1 made every money row know its party, gave suppliers a payment entity, made Cash Desk the cash book behind a flag, and put one balance computation behind the OS. Phase 2 is what the owner sees: Cash Desk shows who the money went to, both profiles show everything about a party, names become links, and parties are picked at entry instead of typed.

Branch `party-linkage-phase-2` is stacked on `party-linkage-phase-1` (commit `aea69107`). Its PR targets the Phase 1 branch until #95 merges, then main.

---

## 1. What Phase 2 delivers

1. **Cash Desk Movements show the counterparty and the settled document**, filter by party, and click through to the supplier or customer profile and to the document.
2. **Cash Desk balances come from the resolver.** Supplier balances and Sales collections show one number per party with its ERP / desk / NoteBook breakdown, rows open the profile, and a payment can be recorded against a supplier across its open payables.
3. **Parties are picked, not typed**, on Cash Desk expenses and other-in, NoteBook records, expenses, debts, contracts, loans and purchase orders. The typed name remains as the display snapshot.
4. **Both profiles aggregate every related record**: payments, cash movements, expenses, NoteBook entries, supplier invoices and GRNs, credit notes and refunds, quotations, proformas and delivery notes, package balances, contracts, contact persons, communication logs and documents, with the resolver's aging beside the legacy tiles.
5. **Names are links everywhere.** One canonical customer profile route, global search opens it, list pages honour `customerId` / `supplierId` / `search` in the URL, report and dashboard rows open the party, and a shared Party card gives every app the same peek and "open in" actions.
6. **NoteBook per-party statement** and the deferred permission widening (D6).
7. **Desk documents get their ERP document underneath (D4)** on first payment or posting, so there is one AP / AR sub-ledger. This is the largest item and goes last; it may slip to Phase 3 without blocking the rest.

---

## 2. Rules carried over, plus two new ones

All of Phase 1's non-negotiables stand: additive migrations only, `requestId` idempotency on new writes, row locks and version checks, one transaction per business event, no double posting, names never proof of identity, currency and scope guards, tenant isolation with an isolation spec per new endpoint, NoteBook money independence, and every new controller route either agent-excluded or covered by a Msaidizi evidence fixture (the capability manifest is pinned by specs and the fixtures run in CI).

New for the surfaces:

- **The resolver is the only balance a surface shows.** No screen computes a party balance from its own query; it reads `computePartyBalance` (or the list variant added here). The cached `currentBalance` is never displayed as a balance.
- **A URL that names a party is honoured.** Every list page that can be opened for a party reads `customerId` / `supplierId` / `search` from the URL and filters, and every party name rendered by a Phase 2 screen is a link or a Party card trigger, never dead text.

---

## 3. PR sequence

Each PR is independently shippable and verified like Phase 1 (typecheck, lint, prettier, the touched unit suites, frontend vitest where the component has tests, and the Msaidizi capability specs whenever a controller route changes).

### PR-1 Cash Desk Movements know the party

Backend: the movements and movement-detail endpoints include `supplier { id, name }`, `customer { id, name }` and the settled document references (payable, receivable, expense, refund, supplier payment, customer payment numbers and ids). `CashQuery` gains `supplierId`, `customerId` and `partyType`; search also matches the payee and the party name. Frontend: Counterparty and Settles columns, a party filter, rows and the detail modal link to the profile and the document, labels for every kind.
Acceptance: with the cash-book flag on, a payable paid on the Payables page appears in Movements with its supplier and payable, and both are links.

### PR-2 Cash Desk balances from the resolver

Backend: list variants `GET /party-balance/suppliers?companyId=` and `/customers?companyId=` computed set-wise (grouped queries, not per-party loops), with per-party ERP / desk / NoteBook / total per currency and overdue. Frontend: Supplier balances reads it (breakdown chips, rows open the profile, "Record payment" allocates across the supplier's open payables through supplier-payments); Sales collections shows the customer as a link, includes Sales Desk direct sales and NoteBook debtors labelled by source, and the receivables and payables pages honour `customerId` / `supplierId` / `search` in the URL.

### PR-3 Parties picked at entry

Cash Desk expense and other-in get a supplier / customer picker (DTO `supplierId` / `customerId`, payee defaults to the name). The Records editor gets a picker for debtors, creditors, sales, purchases and expense notes (identity only). Expense, debt, contract and loan forms get an optional picker. The purchase order form requires a supplier from the directory. Each DTO validates company and scope through the existing `DeskPartyLinksService` rules.

### PR-4 Profiles aggregate everything

Backend: lazy per-tab endpoints on `suppliers/:id/*` and `customers/:id/*` (payments, cash movements, expenses, notebook, supplier invoices, GRNs, credit notes, refunds, quotations, proformas, delivery notes, packages, contracts, contacts, communications, documents), each company- and scope-checked, each agent-excluded until fixtures exist. Frontend: tabs on both profiles with clickable rows; the resolver's aging and breakdown beside the legacy tiles; payables, receivables, statement runs and audit rows become links.

### PR-5 Names are links

One canonical customer profile route (`/sales-desk/customers/:id`; the Westsides page redirects). Global search customers open it. Business report rows, dashboard exception rows, CRM supplier statements and performance pages, and the Sales Desk owed-balance chip (canonical id) all link to the party. A typed `openPartyIn(app, party)` helper in the OS shell and a shared `PartyCard` (name, code, resolver balance, overdue, last payment, phone, actions: profile, Cash Desk, NoteBook, statement, reports) used by Cash Desk, Records, Sales Desk and Invoice Desk.

### PR-6 NoteBook per-party statement and permissions

`GET /records/party-statement?customerId=|supplierId=` combines a party's records into one statement (PDF and CSV reuse the existing statement renderer, keeping the "independent of the ledger" footer). NoteBook tab on both profiles. Records Debtors / Creditors permissions seeded to the roles that already hold `record_book.view` (D6). Records rows link to the party; the Cash Desk and desk Party cards open the party's NoteBook.

### PR-7 Desk documents underneath (D4)

First payment or posting of an Invoice Desk invoice with a canonical supplier creates the `SupplierInvoice` + `Payable` underneath (`canonicalInvoiceId`), allocates the payment and keeps both in step; the same for a Sales Desk sale with a canonical customer (`SalesOrder` + `Receivable`). PetroDollar fuel credit and deliveries ride on this, so they reach profiles, statements, aging and the credit check. Guarded by the existing desk-transaction-link rules (same company, division, branch, party, currency, full amount; idempotent; no double posting with the DeskCash / DeskPurchase / DeskSale journals).

### PR-8 Docs and status

`docs/os-business-connections.md`, `docs/design/itemba-os/records.md` and this plan's status section.

---

## 4. Out of scope for Phase 2

GL party dimension and control-account reconciliation (Phase 3); alerts, approvals carrying the party, statement and remittance documents and messaging (Phase 3); POS customer creation and credit display, POS cash and day closes into the cash book, PetroDollar party at shift entry (Phase 4); Msaidizi fixtures for the new endpoints (Msaidizi track).

---

## 5. Status — 3 October 2026

PR-1 to PR-6 and PR-8 built and committed on `party-linkage-phase-2` (seven commits, stacked on `party-linkage-phase-1` at `aea69107`; PR #95 open with CI green so far). PR-7 deferred to Phase 3 (reasons in its row). The branch is not pushed and has no PR yet; when it is opened it should target `party-linkage-phase-1` until #95 merges. Nothing in Phase 2 was walked through in a browser; every PR was verified by typecheck, lint, the touched unit suites, the Msaidizi manifest specs and the frontend format baseline, and the one migration by the safety scan and a rolled-back dry run.

| PR | State | What landed |
|---|---|---|
| PR-1 Cash Desk Movements know the party | **Built** (first commit on `party-linkage-phase-2`) | Register and detail reads include the supplier, the customer and the settled documents (payable, receivable, expense, refund, supplier payment, customer payment, Invoice Desk invoice, Sales Desk sale). `CashQuery` gains `supplierId`, `customerId` and `partyType`, and its kind filter now accepts `CUSTOMER_RECEIPT` and `REFUND`, which the Movement type select already offered. Search reaches the payee and the party names on the register and on the expense list. Rows show the counterparty and the document; the detail modal links to the profile and the document when the reader holds the permission, plain text otherwise. A Counterparty type filter. `/cash-desk?supplierId=` or `?customerId=` opens the register filtered to that party with a clear chip, inside an OS window too. Payables, Receivables and Expenses honour `?search=` in the URL and read the window-local URL inside the OS. |
| PR-2 Cash Desk balances from the resolver | **Built** (second commit on `party-linkage-phase-2`) | `GET /party-balance/suppliers` and `/customers` (optional `companyId`, `asOf`) computed set-wise by `computePartyBalanceList`: grouped queries over payables / receivables, Invoice Desk invoices / Sales Desk sales mapped to the canonical party, NoteBook records and last payments, same rules as the per-party resolver (open documents only, no-balance rows ignored, overdue by due date, NoteBook outside the total); every read runs under `companyWhereFor`. Cash Desk Supplier balances read it: name opens the profile, chips show the ERP / Invoice Desk / NoteBook split, the total is the resolver's, and "Record payment" (supplier-payments.manage + payables.view + cash_accounts.view) allocates one payment across the supplier's open payables through `POST /supplier-payments` with an idempotent requestId. Sales collections: the customer name links to the profile, Sales Desk direct sales (unpromoted, canonical customer) and NoteBook debtors linked to a customer are listed labelled by source, each read under its own permission (`sales_desk.view`, `records.view`); desk sales count towards "Customers still owe", NoteBook is a separate informal figure. Payables and Receivables honour `?supplierId=` / `?customerId=` with a "Show all" line. |
| PR-3 Parties picked at entry | **Built** (third commit on `party-linkage-phase-2`) | Cash Desk expense gets a supplier picker and other money in a customer picker (`CashMovementDto.supplierId` / `customerId`; the service checks the party exists in the account's company, writes `partyType`, and defaults the payee to the supplier's name; wrong kind or two parties is a 400). NoteBook records: `supplierId` / `customerId` on the record DTO with register rules (debtor and sale → customer; creditor, purchase and expense → supplier; note → none; never both), a company existence check, pickers in the Records editor, identity only. Expense, debt, contract (by contract type) and loan (supplier credit) DTOs, services and forms take an optional supplier or customer profile with the same company check; clearing is allowed. The purchase order form requires a supplier from the directory and no longer sends a free-text name. Every service takes `PartyExistsService` as an optional trailing dependency, provided by each module. |
| PR-4 Profiles aggregate everything | **Built** (fourth commit on `party-linkage-phase-2`) | New `party-profile` module: `GET /party-profile/suppliers/:id/:section` and `/customers/:id/:section` (agent-excluded; the profile permission opens the route, each section also requires its own register permission), read inside the party's company and the reader's organisation scope, newest 50 rows in one shape (`number, date, amount, currency, status, detail, link`). Supplier sections: payments, Cash Desk, expenses, supplier invoices, goods received, purchase orders, Invoice Desk, NoteBook, contracts, loans, debts, contacts, communications, documents. Customer sections: payments, Cash Desk, Sales Desk, credit notes, refunds, quotations, proformas, delivery notes, package balances, NoteBook, contracts, contacts, communications, documents. Documents come from ownership (`ownerType` SUPPLIER / CUSTOMER) and from finance or operations attachments. Frontend: a shared `PartyRelatedTabs` (sections shown only with their permission, loaded lazily, rows link where a page or a filtered register exists) behind a new "Related" tab on both profiles, and a `PartyBalancePanel` above every profile section showing the resolver's total, ERP aging, desk and NoteBook parts, credit and last payment from the `balance` the control centre already carries. |
| PR-5 Names are links | **Built** (fifth commit on `party-linkage-phase-2`) | One canonical customer profile: the old Westsides customer page keeps its permission gate and redirects to `/sales-desk/customers/:id`; the Westsides list and print pages, global search and CRM customer statements point there. `openPartyIn(app, kind, id)` is the one place that knows where a party opens (profile, Cash Desk movements, NoteBook, statements, reports). A shared `PartyCard` (who they are, the resolver's balance and overdue, last payment, open-in actions gated by permission) behind "Peek" buttons on Cash Desk supplier balances, the movement detail's counterparty and Sales collections customers. Dashboard: recent sales and purchase order rows link the customer or supplier, and overdue receivable / payable exceptions carry their party and link its profile. CRM supplier statements and performance lists show the supplier's name as a link (the API now includes it); customer statements honour `?customerId=`. |
| PR-6 NoteBook per-party statement and permissions | **Built** (sixth commit on `party-linkage-phase-2`) | `GET /records/party-statement?supplierId=\|customerId=` (and `/export?format=pdf\|csv`) combines every NoteBook creditor record of a supplier or debtor record of a customer into one statement in one currency (`currency=` switches; the response lists the currencies present), in posting order with each record's title on its line, using the single-record debit / credit rules and the same CSV / letterhead PDF renderer with the "independent of the ERP general ledger" basis. It reads only records the reader may already see. `RecordsQuery` honours `supplierId` / `customerId`, the NoteBook reads them from the URL with a "Show all" chip, and register rows link the counterparty to its profile when it is linked and the reader may see profiles. Both profiles' NoteBook section offers the statement PDF and CSV (with `records.export`). Migration `20261003100000_records_party_permissions` grants `records.view` to every role holding `record_book.view` (D6; additive). |
| PR-7 Desk documents underneath (D4) | **Deferred to Phase 3** | Not built, as section 1 allowed. What it needs, found while scoping: an Invoice Desk invoice is posted later as a `DeskPurchase` journal and a Sales Desk sale as a `DeskSale` journal, while an ERP supplier invoice posts its own accrual when approved (`SupplierInvoicesService.approve` → `postSupplierInvoicePayable`) and a sales order creates its receivable on its own path. `DeskTransactionLinksService.link` deliberately refuses a link once a desk document has payments or journal history. Creating the ERP document on first payment therefore means: (1) deciding which side posts (desk journal or ERP accrual) and making the other side skip, including Accounting connections' "Posted (ERP)" rule; (2) converting the supplier payments already recorded per desk payment (Phase 1 W2) into payable allocations and keeping `paidAmount` in step on both documents; (3) the same for Sales Desk payments against a receivable; (4) PetroDollar fuel credit and deliveries on top; (5) the Msaidizi financial-action evidence, which pins the current settlement behaviour. It is a posting-path change with double-posting risk, better done with the GL party dimension in Phase 3. |
| PR-8 Docs and status | **Built** (seventh commit on `party-linkage-phase-2`) | `docs/os-business-connections.md` gained a "Party linkage phase 2" section (surfaces, rules, the deferral and the release step); `docs/design/itemba-os/records.md` gained the phase 2 NoteBook notes; this status section. |

Deviations from the PR-1 text:

1. Register rows show the counterparty and the document as text; the links sit in the detail modal one click away. Rows are buttons, and a link inside a button is invalid HTML, so the row restructure waits for PR-5's Party card.
2. Supplier payment, customer payment and refund numbers are shown but not linked, because those registers do not yet read a document from the URL (PR-2 and PR-4). Payable, receivable and expense numbers open their registers filtered by `?search=`; supplier invoices open in Invoice Desk and sales in Sales Desk.
3. The URL party chip takes the party's name from the first matching row; with no rows it reads "Showing supplier movements". No extra party read and no name guessing.

Deviations from the PR-2 text:

1. Supplier balances without `suppliers.view` show a one-line notice instead of the old Invoice Desk-only list; the resolver is the only balance the surface shows, so the desk-only sum was not kept as a fallback.
2. Unpromoted Sales Desk sales in Sales collections carry "View sale" but no collect action; their payments are recorded in Sales Desk, and NoteBook rows link to the NoteBook. Only receivables collect from Cash Desk.
3. The Cash Desk "Record payment" requires open ERP payables; Invoice Desk balances keep paying from the invoice (PR-7 puts the payable underneath).

Deviations from the PR-3 text:

1. The company and existence check uses `PartyExistsService` (the canonical master must exist in the record's company, or merely exist for group-level rows), not `DeskPartyLinksService`, whose rules concern desk directory entries and their canonical links, not canonical ids picked directly.
2. The purchase order DTO keeps `supplierId` optional on the backend (the executed Msaidizi evidence for purchase orders does not send one); the requirement lives in the form.
3. Pickers appear only to readers holding `suppliers.view` / `customers.view`, because the picker reads the directory; others keep the typed name.

Deviations from the PR-4 text:

1. One parameterised route per party kind (`/party-profile/:kind/:id/:section`) instead of a route per section under `suppliers/:id/*`; the section list is closed and validated, and every section is agent-excluded.
2. GRNs, supplier invoices, credit notes, refunds, customer payments, contracts and debts link to their list pages; quotations, proformas, delivery notes, contacts, communications, supplier payments and package balances are text, because no page opens one of those records yet. Expenses, NoteBook records, purchase orders, Invoice Desk invoices, Sales Desk sales, loans, documents and Cash Desk movements open the record.
3. The resolver panel reads the control centre's `balance` rather than calling `/party-balance/*` again, so a profile still makes one read (an existing profile test pins that count).

Deviations from the PR-5 text:

1. Business report rows: no report component renders a supplier or customer name field today (the reports area has no party rows to link), so nothing changed there. The Sales Desk owed-balance chip named in the plan does not exist in the current Sales Desk; nothing to relink.
2. The dashboard's recent-order rows were whole-row links; they are now cards whose number opens the order and whose party name opens the profile (a link inside a link is invalid HTML).
3. Supplier statement runs with no supplier ("All suppliers") stay text.

Deviations from the PR-6 text:

1. D6 widens reading only: roles with `record_book.view` gain `records.view`, not `records.manage` or `records.export`. Writing to the NoteBook stays an explicit grant.
2. The combined statement's PDF basis paragraph is the shared renderer's ("this individual Records debt"); the title line carries the record count. The CSV has the same basis line as a single-record statement.
3. The NoteBook tab on the profiles is the PR-4 "Related → NoteBook" section rather than a top-level tab.

PR-6 verification: backend typecheck clean; Records suites 5 files / 37 tests passing including the new `records-party-statement.spec.ts`; the seven Msaidizi manifest specs passing; migration-safety scan OK and the permissions migration dry-run inside a rolled-back transaction on the local database succeeded; frontend typecheck clean; vitest over Records, the related tabs, the partner profiles and party 7 files / 48 tests passing including the new statement export case; format baseline unchanged; eslint zero errors. Not walked through in a browser.

PR-5 verification: backend typecheck clean; global search, dashboard and supplier statements suites 5 files / 32 tests passing; the seven Msaidizi manifest specs passing; frontend typecheck clean; vitest over party (new `party-card.test.tsx`), Cash Desk, Sales Desk, Westsides, dashboard, CRM, the partner profiles and route-smoke coverage 17 files / 150 tests passing; format baseline unchanged (one previously unformatted page is now formatted); eslint zero errors. Not walked through in a browser.

PR-4 verification: backend typecheck clean; `party-profile.spec.ts` and the party-balance suites 3 files / 13 tests passing; the seven Msaidizi manifest specs passing; frontend typecheck clean; vitest over the partner profiles, the new `party-related-tabs.test.tsx`, Sales Desk, party and operations 9 files / 45 tests passing; format baseline unchanged; eslint zero errors. Not walked through in a browser.

PR-3 verification: backend typecheck clean; jest suites for Cash Desk, Records, expenses, debts, contracts and loans 16 files / 131 tests passing including the new `cash-party-entry.spec.ts` (party rules on the record path) and `records-party.spec.ts` (register rules); the seven Msaidizi manifest specs passing; frontend typecheck clean; vitest over Cash Desk, Records, the finance, group-control and operations pages and the party picker 17 files / 114 tests passing including a new Cash Desk case that picks a supplier from the directory and sends `supplierId` with the payee defaulted; format baseline unchanged; eslint zero errors. Not walked through in a browser.

PR-2 verification: backend typecheck clean; Cash Desk and party-balance jest suites 7 files / 39 tests passing including the new `party-balance.list.spec.ts` and two new sales-connection cases; the seven Msaidizi manifest specs 89 tests passing (the two new routes are agent-excluded); frontend typecheck clean; vitest over Cash Desk, the finance pages and the OS host 19 files / 125 tests passing including the new supplier-balances and collections cases; format baseline unchanged; eslint zero errors. Not walked through in a browser.

PR-1 verification: backend typecheck clean; Cash Desk jest suites 5 files / 28 tests passing including the new `cash-party-linkage.spec.ts`; the global search desk spec passing; frontend typecheck clean; vitest over Cash Desk, the finance pages and the OS host 19 files / 123 tests passing including two new Cash Desk cases (links with permission, text without, URL supplier filter and clear); format baseline unchanged; eslint zero errors. Not walked through in a browser: the acceptance check needs a running stack with the cash-book flag on and a paid payable.
