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

Started. Stacked on Phase 1 (`party-linkage-phase-1` at `aea69107`, PR #95 open with CI green so far).

| PR | State | What landed |
|---|---|---|
| PR-1 Cash Desk Movements know the party | **Built** (first commit on `party-linkage-phase-2`) | Register and detail reads include the supplier, the customer and the settled documents (payable, receivable, expense, refund, supplier payment, customer payment, Invoice Desk invoice, Sales Desk sale). `CashQuery` gains `supplierId`, `customerId` and `partyType`, and its kind filter now accepts `CUSTOMER_RECEIPT` and `REFUND`, which the Movement type select already offered. Search reaches the payee and the party names on the register and on the expense list. Rows show the counterparty and the document; the detail modal links to the profile and the document when the reader holds the permission, plain text otherwise. A Counterparty type filter. `/cash-desk?supplierId=` or `?customerId=` opens the register filtered to that party with a clear chip, inside an OS window too. Payables, Receivables and Expenses honour `?search=` in the URL and read the window-local URL inside the OS. |
| PR-2 Cash Desk balances from the resolver | **Built** (second commit on `party-linkage-phase-2`) | `GET /party-balance/suppliers` and `/customers` (optional `companyId`, `asOf`) computed set-wise by `computePartyBalanceList`: grouped queries over payables / receivables, Invoice Desk invoices / Sales Desk sales mapped to the canonical party, NoteBook records and last payments, same rules as the per-party resolver (open documents only, no-balance rows ignored, overdue by due date, NoteBook outside the total); every read runs under `companyWhereFor`. Cash Desk Supplier balances read it: name opens the profile, chips show the ERP / Invoice Desk / NoteBook split, the total is the resolver's, and "Record payment" (supplier-payments.manage + payables.view + cash_accounts.view) allocates one payment across the supplier's open payables through `POST /supplier-payments` with an idempotent requestId. Sales collections: the customer name links to the profile, Sales Desk direct sales (unpromoted, canonical customer) and NoteBook debtors linked to a customer are listed labelled by source, each read under its own permission (`sales_desk.view`, `records.view`); desk sales count towards "Customers still owe", NoteBook is a separate informal figure. Payables and Receivables honour `?supplierId=` / `?customerId=` with a "Show all" line. |
| PR-3 to PR-8 | Not started | |

Deviations from the PR-1 text:

1. Register rows show the counterparty and the document as text; the links sit in the detail modal one click away. Rows are buttons, and a link inside a button is invalid HTML, so the row restructure waits for PR-5's Party card.
2. Supplier payment, customer payment and refund numbers are shown but not linked, because those registers do not yet read a document from the URL (PR-2 and PR-4). Payable, receivable and expense numbers open their registers filtered by `?search=`; supplier invoices open in Invoice Desk and sales in Sales Desk.
3. The URL party chip takes the party's name from the first matching row; with no rows it reads "Showing supplier movements". No extra party read and no name guessing.

Deviations from the PR-2 text:

1. Supplier balances without `suppliers.view` show a one-line notice instead of the old Invoice Desk-only list; the resolver is the only balance the surface shows, so the desk-only sum was not kept as a fallback.
2. Unpromoted Sales Desk sales in Sales collections carry "View sale" but no collect action; their payments are recorded in Sales Desk, and NoteBook rows link to the NoteBook. Only receivables collect from Cash Desk.
3. The Cash Desk "Record payment" requires open ERP payables; Invoice Desk balances keep paying from the invoice (PR-7 puts the payable underneath).

PR-2 verification: backend typecheck clean; Cash Desk and party-balance jest suites 7 files / 39 tests passing including the new `party-balance.list.spec.ts` and two new sales-connection cases; the seven Msaidizi manifest specs 89 tests passing (the two new routes are agent-excluded); frontend typecheck clean; vitest over Cash Desk, the finance pages and the OS host 19 files / 125 tests passing including the new supplier-balances and collections cases; format baseline unchanged; eslint zero errors. Not walked through in a browser.

PR-1 verification: backend typecheck clean; Cash Desk jest suites 5 files / 28 tests passing including the new `cash-party-linkage.spec.ts`; the global search desk spec passing; frontend typecheck clean; vitest over Cash Desk, the finance pages and the OS host 19 files / 123 tests passing including two new Cash Desk cases (links with permission, text without, URL supplier filter and clear); format baseline unchanged; eslint zero errors. Not walked through in a browser: the acceptance check needs a running stack with the cash-book flag on and a paid payable.
