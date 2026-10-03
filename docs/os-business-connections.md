# ITEMBA OS business connections

## What uses the original records

| OS workspace | Original service / records | Behaviour |
| --- | --- | --- |
| Invoice Desk → Suppliers | Supplier directory and supplier control centre | Existing profiles, order history, payables and statements; no copied master directory |
| Invoice Desk → Order drafts / Purchase orders | SupplierOrderDraft / PurchaseOrder | Existing purchasing actions, product catalogue, receipt workflow and printing |
| Invoice Desk → Goods received / Supplier invoices / Matching | GoodsReceivedNote / SupplierInvoice / ThreeWayMatch | Existing stock, invoice approval, payable and accounting services |
| Sales Desk → Customers / Sales | Customer / SalesOrder | Existing integration retained; historical direct entries can now reference the shared customer |
| Cash Desk → Business accounts / Supplier payments / Customer collections / Business expenses | CashAccount / Payable / Receivable / Expense | Original balances and payment services hosted in Cash Desk |
| Reports → Business records | SalesOrder, Receivable, Payable, Expense, CashAccount | Permission-scoped current balances, organisation/date/currency filters and CSV export |
| Documents → Linked invoice files | InvoiceDeskAttachment | Original private attachments, with invoice access checked again on preview/download |
| Inventory / Payroll | Existing inventory and employee/payroll services | Retained; purchasing and payment screens reuse their existing services rather than introducing another stock or employee database |
| Records | Existing independent Records and record-book integration | Financial separation retained; debtor and creditor records may carry a shared customer or supplier identity (party linkage phase 1), never money |

Legacy purchasing and cash URLs remain valid. The desktop registry recognises their explicit app hosts. No iframe or cached arbitrary route children are used. List filters are held in each window's workspace state.

## Historical direct registers

InvoiceDeskSupplier and SalesDeskCustomer now hold nullable references to Supplier and Customer. Reads of the directory never create business records. A new direct entry selects an authorised shared party; its small compatibility reference is created within the transaction.

Older parties require explicit matching in the app. Names are not used as proof of identity. Matching preserves all original IDs, invoices, sales, payments and attachments. More than one historical alias can point to the same shared profile; filters and direct statements follow that identity. Company membership and writable access to every affected transaction are required.

Party matching does **not** make a direct invoice a SupplierInvoice or a direct sale a SalesOrder. Their financial histories remain separate.

An additional reviewed transaction link is available when an unpaid direct entry duplicates an existing business transaction:

- Same company, division, branch, shared party, currency and full amount.
- Source is not void and has no payment history, including reversed payments.
- Source has no previous direct journal history.
- Target is an active business sale or an approved supplier invoice with a payable.
- The review is explicit; references are not inferred from similar names or numbers.

Row locks, version checks and unique target references prevent competing links/payments from silently succeeding. Repeating the same successful link is idempotent. Linked entries remain available as history but cannot receive another direct payment, edit or posting. Their amounts are excluded from direct lists used for totals, direct overviews, direct reports and journal posting candidates.

Paid or posted historical entries are deliberately blocked from automatic conversion. Reconcile their cash, payment allocations and journals before deciding which record is authoritative. A separate genuine purchase or sale must not be matched merely because its amount is the same.

## Reporting boundaries

Business reports use original business records. Existing direct reports are labelled accordingly. Never add a sales report to its receivables, or supplier invoices to their payables: those are different views of the same event.

Business report dates select originating documents; paid amounts and balances are current, not historical balances as of the end date. Currencies remain separate and totals use decimal arithmetic. More than 20,000 rows produces an explicit request to narrow the filters rather than incomplete totals.

Group Health still describes its existing source coverage. The new business report view is not a replacement for a reconciled, consolidated group balance sheet. Unknown duplicates across old registers still require review.

## Party linkage phase 1 — 2 October 2026

Decisions adopted (see `PARTY_LINKAGE_PHASE_1_PLAN_2026-10-02.md` at the repository root for the plan and `SUPPLIER_CUSTOMER_LINKAGE_REPORT_2026-10-02.md` for the findings):

- **D1** Separate nullable `supplierId` / `customerId` columns on each money row, no Party table. `CashDeskMovement.partyType` is NONE, SUPPLIER, CUSTOMER, EMPLOYEE or COMPANY and must agree with the id (database CHECK).
- **D2** NoteBook records carry identity only. A debtor may name a shared customer, a creditor a shared supplier; no settlement writes to Cash Desk, receivables, payables or journals, and `npm run test:records` still asserts zero ERP writes.
- **D3** Cash Desk is the cash book. Behind `CASH_BOOK_UNIFIED` every ERP supplier payment, customer collection, expense payment and refund writes one Cash Desk movement through the connected account (`CashDeskAccount.erpCashAccountId`); an ERP cash account without a connection is refused. Accounting connections shows those movements as "Posted (ERP)" and never offers them for posting; Cash Desk refuses to reverse them (reverse the payment instead).
- **D4** Desk invoices and sales stay the entry surface. New desk payments require the canonical supplier; the ERP document underneath is Phase 2.
- **D5** EMPLOYEE and COMPANY are party types on movements only.
- **D6** NoteBook permission widening is deferred to Phase 2.

What exists now:

- `SupplierPayment` + `SupplierPaymentAllocation` mirror `CustomerPayment`. Paying a payable, paying an expense that names a supplier, paying an Invoice Desk invoice and a Cash Desk SUPPLIER_PAYMENT all create one row. Approved supplier invoices behind a payable follow its paid / outstanding figures.
- Receivable collections for a linked customer create a `CustomerPayment` with one allocation, so customer statements include every collection. `PATCH receivables/:id/link-customer` matches an unlinked receivable to a shared customer.
- Unlinked documents (free-text supplier or customer name only) keep the legacy direct settlement path: journal referenced to the payable or receivable, no payment row. The Msaidizi financial-action evidence pack, executed end to end in CI, pins that behaviour for both capabilities, and an unlinked document has no party to attach a payment to. The Unmatched parties queue surfaces them.
- `GET /party-balance/suppliers/:id` and `/customers/:id` are the one balance: ERP sub-ledger with date-based overdue and aging, desk ledger, NoteBook (informal), total, credit position. `refreshCachedPartyBalance` is the single writer of `Supplier.currentBalance` / `Customer.currentBalance` (open ERP outstanding in the company base currency). Overdue is derived from due dates everywhere; nothing writes an OVERDUE status. The new endpoints (party balance, party links, cash book, supplier payment reads and writes, receivable link-customer) are agent-excluded until their Msaidizi evidence fixtures are authored: the capability manifest must stay closed over positive fixtures and explicit exclusions, and the evidence packs are executed end to end in CI.
- Unmatched parties (`/finance/unmatched-parties`, permissions `party_links.view` / `party_links.manage` plus the source app's own write permission): Cash Desk expense and supplier-payment movements, expenses, NoteBook debtors and creditors, Records Book money out, Group Control debts, supplier and customer contracts, supplier-credit loans, receivables and payables that still carry only a typed name, grouped by normalised name. A master is suggested only when exactly one active master in the company has the same normalised name; nothing is linked without a person confirming. Linking changes identity only and is audited (`PARTY_LINKED`).
- Soft `supplierId` / `customerId` columns (goods received notes, supplier invoices, RFQs, quotations, bid comparisons, requisition lines, performance profiles, statement runs, credit profiles, segment memberships) are real foreign keys. Statement runs use NULL for a whole-company run; the `'ALL'` sentinel is gone. Polymorphic SUPPLIER / CUSTOMER references on contact persons, communication logs, documents, tasks and approval requests must point at a live master in the same company.

Migrations, all additive: `20261002120000_party_columns` (columns, CHECKs, id-only backfill of existing Cash Desk chains), `20261002130000_party_relations` (foreign keys added NOT VALID then VALIDATE; nullable orphans NULLed and profile rows for a missing master deleted, each copied to `archive_party_orphans` first), `20261002140000_supplier_payments`.

Pre-flights, both read-only: `node backend/scripts/party-orphans.cjs` must report no BLOCKING rows before `party_relations` (required-column orphans fail the deploy, which is the intended gate); `node backend/scripts/cash-book-preflight.cjs` lists ERP cash accounts used by payments with no Cash Desk connection and connected pairs whose balances differ, and must be clean before `CASH_BOOK_UNIFIED=true`.

Rollback: every migration leaves old columns and behaviour intact. `CASH_BOOK_UNIFIED` returns the cash book to the previous split behaviour without a schema change. Older code does not know the new tables but is not broken by them.

## Party linkage phase 2 — 3 October 2026

The surfaces (plan: `PARTY_LINKAGE_PHASE_2_PLAN_2026-10-03.md` at the repository root, status section included). Two rules hold on every screen: the party balance resolver is the only balance a surface shows (no screen adds up documents on its own, and the cached `currentBalance` is never shown as a balance), and a URL that names a party is honoured.

- **Cash Desk Movements** include the supplier, the customer and the settled document (payable, receivable, expense, refund, supplier payment, customer payment, Invoice Desk invoice, Sales Desk sale). `GET /cash-desk/movements` and `/expenses` take `supplierId`, `customerId` and `partyType`; search also matches the payee and the party names. `/cash-desk?supplierId=` or `?customerId=` opens the register for one party, inside an OS window too. Payables, Receivables and Expenses honour `?search=`; Payables and Receivables also honour `?supplierId=` / `?customerId=`.
- **Resolver lists.** `GET /party-balance/suppliers` and `/customers` (optional `companyId`, `asOf`) are computed set-wise with grouped queries under `companyWhereFor`, with the same rules as the per-party form (open documents only, overdue by due date, NoteBook outside the total). Cash Desk Supplier balances read it; "Record payment" there allocates one payment across the supplier's open payables through `POST /supplier-payments` (idempotent `requestId`). Sales collections link the customer and list unpromoted Sales Desk sales and customer-linked NoteBook debtors by source, each under its own permission; desk sales count towards what customers owe, NoteBook is a separate informal figure.
- **Parties picked at entry.** Cash Desk expenses may name a supplier and other money in a customer (`CashMovementDto.supplierId` / `customerId`; the party must exist in the account's company; the payee stays the typed snapshot, defaulting to the supplier's name). NoteBook records, expenses, debts, contracts (by contract type), loans (supplier credit) and purchase orders take a profile from the directory; the purchase order form requires one. `PartyExistsService` is the company check everywhere; register rules for the NoteBook live in `records.domain.ts`.
- **Profiles.** `GET /party-profile/suppliers/:id/:section` and `/customers/:id/:section` (agent-excluded; the profile permission opens the route, each section requires its register's own permission) return the newest 50 related rows in one shape. Both profiles show them behind a "Related" tab and the resolver's total, aging, desk and NoteBook parts above every section, read from the `balance` the control centre already carries.
- **Names are links.** One canonical customer profile at `/sales-desk/customers/:id` (the Westsides customer page redirects); global search, CRM statements and performance, the dashboard's recent orders and overdue exceptions link the party. `openPartyIn(app, kind, id)` (frontend `features/party/party-links.ts`) is the one place that knows where a party opens; `PartyCard` is the shared peek with its open-in actions.
- **NoteBook.** `GET /records/party-statement?supplierId=|customerId=` (and `/export?format=pdf|csv`) combines a party's debtor or creditor records into one statement per currency with the single-record rules and the independent-of-the-ledger basis. `/records?supplierId=|customerId=` lists one party's records. Migration `20261003100000_records_party_permissions` grants `records.view` to every role holding `record_book.view` (D6, read only, additive).
- **Deferred to phase 3 (D4).** Creating the ERP SupplierInvoice + Payable or SalesOrder + Receivable underneath a desk document on its first payment was not built. A desk document is posted later as a `DeskPurchase` / `DeskSale` journal while an ERP supplier invoice posts its own accrual on approval, and the existing link rule deliberately refuses a link once payments or journal history exist; building it automatically means changing those posting paths so neither side posts twice, and reconciling the supplier payments already recorded per desk payment with payable allocations. The link rules in `DeskTransactionLinksService` remain the manual path.

Release: apply `20261003100000_records_party_permissions` (additive; it only inserts role grants). No flag changes. Every new route is agent-excluded until its Msaidizi evidence fixture exists.

## Party linkage phase 3 — 3 October 2026

Control (plan: `PARTY_LINKAGE_PHASE_3_PLAN_2026-10-03.md` at the repository root, status section included). Three rules join the earlier ones: a control line without a party is a finding, not an error (posting never fails for a missing party; reconciliation lists such lines as their own bucket); reconciliation is read-only and derived (nothing in phase 3 writes a balance; snapshots record what both sides said at close); alerts are idempotent per party per day and carry a destination from `openPartyIn`.

- **The ledger knows the party.** `journal_entry_lines` carry `partyType` (NONE / SUPPLIER / CUSTOMER), `supplierId` and `customerId` (migration `20261003110000_journal_line_party`). `partyOf(kind, id)` tags a posting line and every AP / AR control writer passes it: payables, receivables, supplier and customer payments, supplier invoices, credit sales, credit notes, refunds, expenses, external payments and desk postings (through the canonical party). A payable or receivable refuses a party change once posted or partly paid. `backend/scripts/backfill-journal-party.cjs` (dry run by default, `--apply`, idempotent) tags historical control lines from their documents and lists what it cannot explain. Fixed-asset, cash-book and manual journals stay untagged by design.
- **Control reports.** `GET /financial-reports/control-by-party/:companyId?role=AP|AR&asOf=` puts the control account balance per party beside the resolver's open sub-ledger with the difference, names control-only parties, shows the untagged control as its own row and reports a missing control account rather than failing; `GET /financial-reports/supplier-aging-detail/:companyId/:supplierId` mirrors the customer aging. Finance reports: "AP Control by Supplier" and "AR Control by Customer"; the supplier profile shows payables aging under the resolver panel. Base currency only (journal lines carry no currency).
- **Period close checks and remembers.** Both closes (`POST /period-close/:id/close` and `PATCH /accounting-periods/:id/close`) run the reconciliation as of the period end before writing; a difference, or untagged control, is refused with the differences in the error unless the close goes through `.../close-acknowledged` with a reason, which the audit log keeps with both totals. The close writes `party_balance_snapshots` (migration `20261003120000_party_balance_snapshots`): one row per party and role plus one NONE row per role, base currency, one `snapshotAt` per close; `GET .../party-check` and `.../party-snapshots` read them. The Period Close dialog shows the check with party links and asks for the reason; a closed record shows the balances recorded at close.
- **Alerts with a destination.** Alert type `CREDIT_LIMIT_BREACH` (migration `20261003130000_alert_type_credit_limit_breach`). A fourth automation pass on the job worker raises `OVERDUE_PAYABLE` per supplier, `OVERDUE_RECEIVABLE` per customer and `CREDIT_LIMIT_BREACH` per customer over its limit from the resolver's set-wise list, one event per party per type per `AUTOMATION_PARTY_ALERT_INTERVAL_HOURS` (default 24), linked to the Supplier / Customer with the profile href in metadata and a company notification whose `actionUrl` opens the profile; a worker scans parties at most once an hour. Alert rows about a party carry "Open profile".
- **Approvals carry the party.** `approval_requests` carry `partyType` / `supplierId` / `customerId` (migration `20261003140000_approval_request_party`), derived at creation by `PartyExistsService.partyOfEntity` from the document behind `entityType` / `entityId` (payables, supplier invoices and payments, purchase orders, expenses, receivables, customer payments, sales orders, credit notes, refunds, the parties themselves; NONE otherwise, never an error). Every read includes the supplier or customer; inbox rows name the party and the inspector links it.
- **Supplier statement and remittance advice.** `GET /supplier-statements/:id/export?format=pdf|csv` renders a statement run through the shared letterhead renderer (recorded balances, then the period's payables by issue date and payments by payment date with a running balance, naming the recorded closing when the two differ); `GET /supplier-payments/:id/remittance?format=pdf` renders a payment with its allocations and the applied / on-account split. Buttons on the supplier profile's Statements tab and on Related → Payments.
- **Tax rows say who.** `tax_transactions` carry `partyType` / `supplierId` / `customerId` / `partyTin` / `partyVrn` (migration `20261003150000_tax_transaction_party`); tax auto-apply snapshots the party from the sales order, purchase order or expense it books from. `GET /tax/transactions/by-party?companyId=&dateFrom=&dateTo=&direction=` groups taxable and tax per party snapshot, direction, tax type and currency, keeping rows without a party visible; Finance reports: "Tax by Party".
- **One cash balance.** Cash account reads carry the connected Cash Desk account; with `CASH_BOOK_UNIFIED` on and a connection present, `currentBalance` is the Cash Desk balance and `mirrorBalance` the stored figure (still written by every caller), with `balanceSource` saying which. Cash Desk → Accounts shows the ERP mirror and any difference to the cent, or that the account is not connected.
- **Still open.** D4 (ERP documents underneath desk documents) needs the owner's summary-line decision; input-VAT re-posting and withholding stay out; historical approval requests and tax rows keep NONE until a backfill is wanted.

Release: apply the five additive migrations above in order (`20261003110000` to `20261003150000`), regenerate the client, deploy compatible builds, then run `node backend/scripts/backfill-journal-party.cjs` (dry run first, then `--apply`) so the control reports and the close gate see historical lines. The close gate applies as soon as the build is live: a company whose control lines are untagged closes a period only with a reason until the backfill runs. No flag changes; the party alerts run only where `AUTOMATION_DISPATCH_ENABLED` already runs the other passes. Every new route is agent-excluded until its Msaidizi evidence fixture exists.

## Release procedure

1. Back up the deployment database using the existing release procedure.
2. Apply `20260928180000_invoice_desk_supplier_master_link`. It adds references, indexes and foreign keys only; it performs no name matching or financial backfill.
3. Generate the Prisma client and deploy compatible backend/frontend builds together.
3a. Party linkage phase 1: run `node backend/scripts/party-orphans.cjs` against the target database and clear any BLOCKING rows, apply `20261002120000_party_columns`, `20261002130000_party_relations` and `20261002140000_supplier_payments` (additive; the second validates the new foreign keys), then run `node backend/scripts/cash-book-preflight.cjs` and connect every listed ERP cash account in Cash Desk → Accounts before setting `CASH_BOOK_UNIFIED=true`.
3b. Party linkage phase 3: apply `20261003110000_journal_line_party`, `20261003120000_party_balance_snapshots`, `20261003130000_alert_type_credit_limit_breach`, `20261003140000_approval_request_party` and `20261003150000_tax_transaction_party` (additive), regenerate the client, then run `node backend/scripts/backfill-journal-party.cjs` (dry run, then `--apply`) before the first period close on the new build.
4. Verify supplier/customer counts, organisation access and old deep links using authorised staging roles.
5. Verify purchase → receipt → invoice → payable payment, sale → collection and payroll → payment through the existing transaction services. Check printing and exports in the staging browser.
6. Match older parties, then review candidate duplicate transactions. Compare source counts, per-currency balances, cash movements and journal history before and after.
7. Keep unresolved paid/posted duplicates on a reconciliation list; do not hide them or delete their originals.

Rollback after transaction linking needs special care: older code does not understand the new read-only history flags. Keep the link-aware mutation/posting guards, or disable affected direct actions while restoring a compatible release. Dropping the references or reverting blindly can make historical entries payable/postable again.

## Verification

- Targeted backend tests cover party/transaction linking, permissions, exact amounts, reports, existing payments, posting and cash-sales connections.
- Frontend tests cover route ownership, explicit review, safe exports, existing desk workflows and desktop isolation.
- Both applications are checked with production builds.
- `backend/scripts/prove-desk-links.cjs` runs against an empty disposable PostgreSQL database only. It rehearses the exact migration over populated historical tables and proves shared histories, alias filtering, idempotent links, current reports, branch restrictions and a real payment competing with a link.
- The proof script refuses remote hosts and any database name except `itemba_link_proof`; it also requires `ITEMBA_DISPOSABLE_PROOF=1`. Prepare the empty database with the current schema using `prisma db push --skip-generate` before running it.

Local service/database proofs do not replace final authorised staging browser acceptance or deployment verification.

### Local verification result — 28 September 2026

- Backend production build and TypeScript checks passed.
- Frontend production build passed with an explicit local BACKEND_INTERNAL_URL (build verification only).
- Backend regression run: 9 suites, 110 tests passed.
- Desk/report/desktop frontend run: 23 suites, 271 tests passed.
- Additional hosted finance/procurement/form run: 15 suites, 100 tests passed (overlaps the preceding run).
- Disposable PostgreSQL proof passed, including historical aliases and concurrent payment/link requests.
- Migration-safety, ID-strategy and frontend/backend literal-route contract checks passed.
- A whole-schema database comparison reported three unrelated existing Msaidizi default-expression normalisations; it reported no differences in the new linking columns, indexes or foreign keys.
- No staging or production deployment, customer-data matching or live browser acceptance was performed in this implementation pass.
