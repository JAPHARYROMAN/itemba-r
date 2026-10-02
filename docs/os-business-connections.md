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
- `GET /party-balance/suppliers/:id` and `/customers/:id` are the one balance: ERP sub-ledger with date-based overdue and aging, desk ledger, NoteBook (informal), total, credit position. `refreshCachedPartyBalance` is the single writer of `Supplier.currentBalance` / `Customer.currentBalance` (open ERP outstanding in the company base currency). Overdue is derived from due dates everywhere; nothing writes an OVERDUE status.
- Unmatched parties (`/finance/unmatched-parties`, permissions `party_links.view` / `party_links.manage` plus the source app's own write permission): Cash Desk expense and supplier-payment movements, expenses, NoteBook debtors and creditors, Records Book money out, Group Control debts, supplier and customer contracts, supplier-credit loans, receivables and payables that still carry only a typed name, grouped by normalised name. A master is suggested only when exactly one active master in the company has the same normalised name; nothing is linked without a person confirming. Linking changes identity only and is audited (`PARTY_LINKED`).
- Soft `supplierId` / `customerId` columns (goods received notes, supplier invoices, RFQs, quotations, bid comparisons, requisition lines, performance profiles, statement runs, credit profiles, segment memberships) are real foreign keys. Statement runs use NULL for a whole-company run; the `'ALL'` sentinel is gone. Polymorphic SUPPLIER / CUSTOMER references on contact persons, communication logs, documents, tasks and approval requests must point at a live master in the same company.

Migrations, all additive: `20261002120000_party_columns` (columns, CHECKs, id-only backfill of existing Cash Desk chains), `20261002130000_party_relations` (foreign keys added NOT VALID then VALIDATE; nullable orphans NULLed and profile rows for a missing master deleted, each copied to `archive_party_orphans` first), `20261002140000_supplier_payments`.

Pre-flights, both read-only: `node backend/scripts/party-orphans.cjs` must report no BLOCKING rows before `party_relations` (required-column orphans fail the deploy, which is the intended gate); `node backend/scripts/cash-book-preflight.cjs` lists ERP cash accounts used by payments with no Cash Desk connection and connected pairs whose balances differ, and must be clean before `CASH_BOOK_UNIFIED=true`.

Rollback: every migration leaves old columns and behaviour intact. `CASH_BOOK_UNIFIED` returns the cash book to the previous split behaviour without a schema change. Older code does not know the new tables but is not broken by them.

## Release procedure

1. Back up the deployment database using the existing release procedure.
2. Apply `20260928180000_invoice_desk_supplier_master_link`. It adds references, indexes and foreign keys only; it performs no name matching or financial backfill.
3. Generate the Prisma client and deploy compatible backend/frontend builds together.
3a. Party linkage phase 1: run `node backend/scripts/party-orphans.cjs` against the target database and clear any BLOCKING rows, apply `20261002120000_party_columns`, `20261002130000_party_relations` and `20261002140000_supplier_payments` (additive; the second validates the new foreign keys), then run `node backend/scripts/cash-book-preflight.cjs` and connect every listed ERP cash account in Cash Desk → Accounts before setting `CASH_BOOK_UNIFIED=true`.
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
