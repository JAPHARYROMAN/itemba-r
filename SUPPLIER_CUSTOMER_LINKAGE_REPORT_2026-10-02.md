# Suppliers and Customers: how they could be linked to the rest of ITEMBA OS

Suggestions report. No code. 2026-10-02.
Basis: read-through of `database/prisma/schema.prisma`, the backend modules and the OS apps at commit `7d84b12b` (branch `codex/petrodollar-connections`). Line numbers are from that commit. Every finding below was traced in code; every suggestion is a proposal for the owner to accept, change or reject.

Tags used throughout:

- `[LINKED]` real foreign key and the UI can navigate to the party
- `[PARTIAL]` an id exists but has no relation, no UI link, or the link is broken
- `[FREE-TEXT]` the party is only a typed name
- `[MISSING]` no party concept at all

---

## 1. The shape of the problem in one page

Suppliers and customers are the two most important things in the OS, but the OS does not treat them as one thing each. It treats them as several unconnected things.

1. **Each party has three ledgers that never meet.**
   - ERP ledger: `Payable` / `Receivable` (Finance pages, profiles, statements, aging, Cash Desk "Supplier payments" and "Customer collections").
   - Desk ledger: `InvoiceDeskInvoice` / `SalesDeskSale` (Invoice Desk "Who you owe", Sales Desk "Customer balances", Cash Desk "Supplier balances", all PetroDollar credit and deliveries).
   - NoteBook ledger: `RecordEntry` DEBTOR / CREDITOR plus Group Control `Debt`. Deliberately isolated, and a test enforces zero ERP writes (`backend/scripts/test-records.cjs:325-344`).

2. **Cash Desk movements do not know who the money went to or came from.** `CashDeskMovement` (schema 17251-17296) has no `supplierId`, `customerId`, `payableId` or `receivableId`. It has a free-text `payee` used only for EXPENSE. Supplier or customer is reachable only through a three-hop chain (`invoicePaymentId` or `salesPaymentId`) that the movements API does not even include (`cash-desk.service.ts:472-476`).

3. **Two cash ledgers run side by side.** Cash Desk (`CashDeskAccount` + movements) and ERP (`CashAccount.currentBalance` only, no transaction table). Payments made on the Payables and Receivables pages, the Cash Desk "Collect payment" button, CustomerPayment, Refund, ExternalPayment, ERP Expense pay, all POS sales and legacy fuel collections hit only the ERP balance and never appear in Movements.

4. **Paying a supplier leaves no payment row.** `payables.recordPayment` (`payables.service.ts:380-546`) bumps `paidAmount`, posts a journal and decrements a cash balance. There is no `SupplierPayment` model at all. So there is no supplier payment history, statements attribute payments to the invoice's issue period (`supplier-statements.service.ts:115-120`), and the cash account used is discarded.

5. **Collecting from a customer through a receivable leaves no `CustomerPayment`.** `receivables.recordPayment` (`receivables.service.ts:375-547`) is the same pattern. Customer statements take credits only from `CustomerPayment` rows (`customer-statements.service.ts:286-520`), so a collection made in Cash Desk never shows on the customer's statement.

6. **The general ledger has no party dimension.** `JournalEntryLine` (schema 3938-3960) carries account, amount, division, branch. One AP control and one AR control per company. The GL cannot answer "what do we owe supplier X". Nothing compares control accounts to the sub-ledgers, not in reports and not at period close.

7. **Balances are computed many ways and disagree.** Supplier balance: at least 7 computations (profile summary, statements, accounts view, aging, supplier-360, three different `syncSupplierBalance` copies, PO outstanding, Invoice Desk overview). Customer balance: at least 8 (live receivable sum, cached `currentBalance` written by five helpers, statement closing balance, Sales Desk direct total, Records debtor balance, hand-typed `CustomerCreditProfile`, fuel credit via desk, accounts view keyed by name). The `Supplier.currentBalance` sync in payables is base-currency only while the purchase-order and supplier-invoice copies sum all currencies.

8. **Free-text party names sit in money-adjacent rows.** `CashDeskMovement.payee`, `RecordEntry.counterparty`, `RecordBookExpense.paidTo`, `Expense.vendorName`, `Debt.creditorName`, `Loan.lenderName`, `Contract.counterpartyName`, `ExternalPayment.payerName`, fuel shift `supplier` / `customer` JSON strings. None can be joined to a profile.

9. **Many ids are soft.** `supplierId` / `customerId` with no Prisma relation and no referential integrity on: GoodsReceivedNote, SupplierInvoice, RFQSupplier, SupplierQuotation, BidComparison(Line), SupplierPerformanceProfile, SupplierStatementRun (which stores the string `'ALL'`), CustomerCreditProfile, CustomerSegmentMembership, CustomerStatementRun. ContactPerson, CommunicationLog, Document, Task, Notification and ApprovalRequest are polymorphic with no existence checks.

10. **Navigation dead-ends.** The OS has no "open app X scoped to party Y" mechanism. `?customerId=` and `?search=` are silently dropped by the receivables, payables and sales list pages. Global search sends customers to the legacy Westsides page but suppliers to the proper profile. Cash Desk supplier rows are not clickable. Both profiles aggregate only four record types each and leave out payments, cash, NoteBook, contracts, contacts, communications, documents, packages, GRNs, credit notes, quotations and more.

11. **Nothing talks about parties.** Overdue payable / receivable alert types exist but only LOW_STOCK is generated. Reminder notifications have no `actionUrl`. Approval requests do not carry the party. There is no supplier statement PDF or remittance advice. Msaidizi can list parties but every single-party endpoint is agent-excluded.

The rest of this report lists, app by app, every place a link could be added, then proposes a foundation, a sequence and the decisions only the owner can make.

---

## 2. Where a supplier or customer appears today

| Place | Supplier | Customer |
| --- | --- | --- |
| Master record | `Supplier` (schema 4872) `[LINKED]` | `Customer` (schema 4804) `[LINKED]` |
| Desk party table | `InvoiceDeskSupplier.canonicalSupplierId` nullable `[PARTIAL]` | `SalesDeskCustomer.canonicalCustomerId` nullable `[PARTIAL]` |
| ERP sub-ledger | `Payable.supplierId` nullable + `supplierName` `[PARTIAL]` | `Receivable.customerId` nullable + `customerName` `[PARTIAL]` |
| Payment entity | none `[MISSING]` | `CustomerPayment` + `PaymentAllocation` `[LINKED]`, but bypassed by receivable record-payment |
| Cash Desk movement | no column, `payee` text on expenses `[FREE-TEXT]` | no column `[MISSING]` |
| Cash Desk balances view | "Supplier balances" reads only desk invoices, rows not clickable `[PARTIAL]` | "Sales collections" shows name text, links only to the sale `[PARTIAL]` |
| NoteBook (Records) | CREDITOR `counterparty` text `[FREE-TEXT]` | DEBTOR `counterparty` text `[FREE-TEXT]` |
| Records Book money out | `paidTo` text `[FREE-TEXT]` | n/a |
| Group Control debts | `Debt.creditorName` text `[FREE-TEXT]` | n/a |
| Expenses | `vendorName` text; expense payables get `supplierId: null` `[FREE-TEXT]` | n/a |
| Purchase / sales orders | `supplierId` nullable + name; form accepts free text `[PARTIAL]` | `customerId` nullable + name; walk-in auto-create `[PARTIAL]` |
| GRN / Supplier invoice / 3-way match | soft `supplierId`, no relation `[PARTIAL]` | n/a |
| RFQ / quotations / bid comparison | soft ids, no relation, invites unvalidated `[PARTIAL]` | `Quotation.customerId` nullable FK `[PARTIAL]` |
| Proforma / delivery note | n/a | nullable FK, UI shows name only `[PARTIAL]` |
| Credit note / refund | no supplier credit-note model `[MISSING]` | nullable FK `[PARTIAL]` |
| Returnable packages | `PackageMovement.supplierId` FK `[LINKED]` | `CustomerPackageBalance` FK, not on profile `[PARTIAL]` |
| Product batches | FK + UI link `[LINKED]` | n/a |
| Fuel / PetroDollar | shift JSON `supplier` text, mapped to desk party at posting `[PARTIAL]` | shift JSON `customer` text, posts as `SalesDeskSale` not `Receivable` `[PARTIAL]`; `FuelCreditSale` model unused |
| Contracts | `counterpartyName` text `[FREE-TEXT]` | same `[FREE-TEXT]` |
| Loans | `lenderName` text; `SUPPLIER_CREDIT` type rejected `[FREE-TEXT]` | n/a |
| Fixed assets | no vendor field `[MISSING]` | n/a |
| Contact persons / communication logs | polymorphic, no UI `[PARTIAL]` | same `[PARTIAL]` |
| Documents | `ownerType SUPPLIER` + raw `ownerId`, no tab `[PARTIAL]` | same `[PARTIAL]` |
| External messages (SMS/email) | no party id `[MISSING]` | no party id; statement emails bypass the log `[MISSING]` |
| Journal entry lines | no party `[MISSING]` | no party `[MISSING]` |
| Bank reconciliation | match to JE line only, party two hops away `[MISSING]` | same `[MISSING]` |
| Tax transactions | no party, no TIN snapshot, no WHT per supplier `[MISSING]` | no party `[MISSING]` |
| Alerts | `OVERDUE_PAYABLE` defined, never generated `[MISSING]` | `OVERDUE_RECEIVABLE` defined, never generated; no credit-limit alert `[MISSING]` |
| Approvals / tasks | generic entity, no party `[MISSING]` | same `[MISSING]` |
| Global search | result opens profile `[LINKED]` | result opens legacy `/westsides/customers/:id` `[PARTIAL]` |
| Reports app | `partyId` filter honoured `[LINKED]` | `partyId` filter honoured `[LINKED]` |
| Business reports rows | party text, href to list page `[FREE-TEXT]` | same `[FREE-TEXT]` |
| Dashboard | "{name} is overdue" rows link to ignored `?search=` `[PARTIAL]` | same; Westsides `topCustomers` computed but never rendered `[PARTIAL]` |
| Msaidizi | list only; `:id` and control-center excluded `[PARTIAL]` | same `[PARTIAL]` |
| Print / PDF | PO, draft, GRN, supplier invoice only; no statement or remittance `[MISSING]` | profile, debt statement, payment receipt `[LINKED]` |
| Integrations | mapping type is a free string; no party API `[MISSING]` | same `[MISSING]` |

---

## 3. Foundation suggestions (make everything else possible)

These six are the load-bearing changes. Every per-app suggestion in section 4 either depends on one of them or is much cheaper once they exist.

### F1. Put a party reference on every row that moves or owes money

Add nullable `supplierId` and `customerId` (with real Prisma relations) to the rows that today carry only a name or nothing. Keep the existing free-text field as a display snapshot so old rows stay readable.

Rows to cover, in priority order:

1. `CashDeskMovement` (plus `payableId`, `receivableId`, `expenseId` so a movement knows what it settled, not only whom)
2. `RecordEntry` (NoteBook debtors and creditors)
3. `Expense` (replace `vendorName`-only with a supplier picker; expense-accrued payables then carry the supplier)
4. `Debt` (Group Control "Trade Debt / Payable")
5. `RecordBookExpense.paidTo`
6. `Contract` (one of supplierId / customerId depending on `contractType`)
7. `Loan` (lender may be a supplier; `ObligationType.SUPPLIER_CREDIT` already exists and is rejected at `loan-lifecycle.service.ts:192`)
8. `ExternalPayment` and `ExternalMessage` (`recipientType` already has CUSTOMER / SUPPLIER values with nowhere to put the id)
9. `FixedAsset` vendor, `ProcurementPlan` preferred supplier
10. Fuel shift report lines: pick the master supplier / customer at shift entry, not at posting

Rule for new rows: a party picker with "no party / one-off" as an explicit choice, never a bare text box. Rule for old rows: a matching sweep, same pattern the desks already use (`sales-desk.controller.ts:50-55`, `invoice-desk.controller.ts:67-72`), names are never proof of identity.

### F2. Give suppliers a payment entity, and make every payment write exactly one cash movement

- Create `SupplierPayment` + `SupplierPaymentAllocation`, mirroring `CustomerPayment` + `PaymentAllocation`. Payable record-payment, Invoice Desk payment and Cash Desk SUPPLIER_PAYMENT all create one.
- Make receivable record-payment create a `CustomerPayment` + allocation instead of only bumping `paidAmount`. This alone fixes statements missing Cash Desk collections.
- Every payment or collection, whichever screen it starts from, produces one `CashDeskMovement` carrying `supplierId` / `customerId` and the document id. This closes the split between the two cash ledgers (decision D3 below decides which ledger is authoritative).
- Store the cash account on the payment row. Today it is thrown away.
- Add a supplier credit / debit note model. Customers have `CreditNote`; suppliers have nothing, so returns to a supplier cannot be recorded against the balance.

### F3. One balance resolver per party

A single backend service that answers "what does party X owe / is owed, per currency, as of now (or as of a date)" and returns a breakdown: ERP sub-ledger, desk ledger, NoteBook, GRNI, unapplied payments. Every consumer calls it: profile tiles, Cash Desk balances, CRM, POS credit check, Sales Desk credit check, statements, aging, dashboards, Msaidizi.

Then either retire `Supplier.currentBalance` / `Customer.currentBalance` or make the resolver the only writer. Today three supplier copies and five customer copies write it with different currency rules.

### F4. Collapse the desk party tables into the masters

- Make `canonicalSupplierId` / `canonicalCustomerId` required for all new desk rows (new sales already require it: `desk-party-links.service.ts:107-110`; extend to suppliers and to PetroDollar posting).
- Run the matching sweep for old desk parties, with the reviewed, idempotent rules already documented in `docs/os-business-connections.md`.
- Decide (D4) whether desk invoices and sales become Payables / Receivables, or stay separate but always appear in the F3 resolver. Either way the two Cash Desk supplier views stop showing two different numbers.

### F5. Party dimension in the general ledger

- Add nullable `partyType` + `partyId` (or `supplierId` / `customerId`) to `JournalEntryLine`, populated on every AP control and AR control line.
- Add a report: control account by party, and a reconciliation: sum of open Payables per supplier vs AP control per supplier (same for AR).
- Make period close fail or warn when sub-ledger and control disagree, and snapshot per-party balances at close (`AccountingPeriodClose` has no snapshot fields today).
- Block manual journals and bank reconciliation adjustments from hitting AP / AR control without a sub-ledger document, or require the party on those lines.

### F6. Turn soft ids into real relations

Add Prisma relations (and foreign keys) for `GoodsReceivedNote.supplierId`, `SupplierInvoice.supplierId` and `.payableId`, `RFQSupplier`, `SupplierQuotation`, `BidComparison.recommendedSupplierId`, `BidComparisonLine`, `RequestForQuotation.awardedSupplierId`, `PurchaseRequisitionLine.preferredSupplierId`, `SupplierPerformanceProfile`, `SupplierStatementRun` (drop the `'ALL'` sentinel), `CustomerCreditProfile`, `CustomerSegmentMembership`, `CustomerStatementRun`. Add existence checks to ContactPerson, CommunicationLog, Document, ApprovalRequest and Task writes.

---

## 4. Linkage suggestions by app

### 4.1 Cash Desk

What is there today: Overview, Sales collections, Daily sales, Expenses, Movements, Accounts, Intercompany, Supplier balances, plus outer tabs that embed the Finance Payables / Receivables / Expenses / Cash accounts pages.

**Movements**

- Add a Counterparty column (supplier, customer, employee, company, or "none") and a party filter. Needs F1.
- Add a "Settles" column: payable number, receivable number, expense number, sale, invoice.
- Make the party clickable to the profile, and the document clickable to its detail. Today the detail modal says only "Linked to an Invoice Desk payment" (`cash-desk.tsx:901-905`).
- Include `invoicePayment` and `salesPayment` in the movements API response so the chain can at least be displayed before F1 lands.
- Search should match party name and payee, not only description and reference (`cash-desk.service.ts:459-466`).
- Show payments made anywhere in the OS, not only those created in Cash Desk. Needs F2 / D3.

**Supplier balances**

- Rows open the supplier profile, or a side drawer with aging buckets, open documents and recent payments.
- Show one balance per supplier per currency from the F3 resolver, with chips for the breakdown (ERP payables, desk invoices, GRNI, NoteBook creditor). Today this view reads only unpromoted desk invoices while the "Supplier payments" tab next to it reads only Payables.
- "Record payment" from the supplier row, allocating across open documents, not only from a single desk invoice.
- Add "Open in Invoice Desk", "Open NoteBook creditor", "Open statement", "Open supplier reports" actions per row.

**Customer collections / Sales collections**

- Same treatment: one balance per customer, rows open the profile, payments allocate across documents.
- "Collect payment" must create a `CustomerPayment` and a Cash Desk movement (F2). Today it bumps the receivable and a hidden ERP balance.
- Include Sales Desk direct sales, PetroDollar credit and NoteBook debtors in the outstanding list, each labelled by source. Today only SalesOrder-linked receivables appear (`cash-sales-connection.service.ts:69-118`).
- Honour `?customerId=` when another app opens Cash Desk for a customer.

**Expenses**

- Replace the free-text payee with a supplier picker that still allows a one-off name. Expense-accrued payables then carry `supplierId` instead of `null` (`expenses.service.ts:591-614`).
- Expense category should come from `ExpenseCategory` or the chart of accounts, not the hard-coded enum in `cash-desk.dto.ts:16`, so posting does not need a second mapping.

**Daily sales / Other in**

- Optional party on OTHER_IN (a customer deposit, a supplier refund). Today these kinds have no counterparty at all.

**Per-party cash history**

- A "Money with this party" view: every movement in or out for a supplier or customer across all kinds and all cash accounts, exportable. This is the view a business owner asks for first.

**POS day close**

- Not a party link, but a cash completeness gap found on the way: Funga Siku and the Westsides daily close are snapshots with no cash movement and no variance entry (`mobile-pos-lite.service.ts:2742-2885`). The day close should produce a Cash Desk movement so counter cash and Cash Desk agree.

### 4.2 Records (the NoteBook)

What is there today: Debtors, Creditors, Individual sales, Purchases, Expense notes, Notes; per-record statements; settlements that touch nothing else; Daily records (Records Book) with daily sales and money out. Separation is intentional and test-enforced.

Suggested stance: **linked identity, independent money.** Let a NoteBook entry know *who* without forcing it to post *what*. The owner decides (D2) how far money linkage goes.

- **Debtor → Customer, Creditor → Supplier link.** Optional picker on the entry, with the current free text kept as the display name. An "unlinked → link" matching screen like the desks have. Needs F1.
- **Party-level statement.** Today a statement is per record (`records.service.ts:479-509`), so one person with three debts gets three statements. With a party link, offer a combined NoteBook statement per customer or supplier, and show NoteBook balance as its own labelled column on the customer and supplier profiles ("Informal / NoteBook"). Keep the existing footer that says it is independent of the ledger.
- **Settlement with an optional cash movement.** "Receive payment" / "Pay creditor" offers "also record in Cash Desk" which creates a movement referencing the `RecordSettlement`. Default off if the owner wants to keep the zero-ERP-writes guarantee; the reference alone already lets Cash Desk and NoteBook be reconciled instead of double-entered.
- **Promote a record to a formal document.** A reviewed, explicit action: debtor record → Receivable, creditor record → Payable, purchase record → Invoice Desk invoice, sale record → Sales Desk sale. Same guard rules as the desk business-link (same party, currency, amount, unpaid, idempotent). The record becomes read-only history with a pointer, exactly like linked desk entries.
- **Party on SALE / PURCHASE / EXPENSE records too**, so "everything with supplier X" includes informal purchases.
- **Records Book money out `paidTo`** gets the same supplier picker as Cash Desk expenses.
- **Group Control `Debt`** overlaps both NoteBook creditors and ERP Payables (its modal is literally titled "New Trade Debt / Payable"). Options: link `creditorName` to Supplier and give it a payment history table, or fold it into Payables / NoteBook creditors and retire it. Either way the dashboard debt total should agree with `/debts/summary` (it currently drops PARTIALLY_PAID and does not net `amountPaid`, `dashboard.service.ts:197-203`).
- **Visibility.** Index NoteBook entries in global search; add a NoteBook tab on both profiles; allow Cash Desk / Sales Desk / Invoice Desk to open Records filtered to a party, and Records to open the party profile.
- **Permissions.** Debtors / Creditors are GROUP_SUPER_ADMIN only by seed. If they become linked, cashiers and accountants who already see Daily records should be able to see them.

### 4.3 Invoice Desk and the supplier profile

- **Profile aggregates everything.** Add tabs or sections for: supplier invoices (procurement), GRNs and three-way matches, payments (F2), Cash Desk movements, expenses paid to the supplier, NoteBook creditor entries, contracts, contact persons, communication logs, documents, returnable packages, product batches, fuel deliveries, maintenance / subcontractor records, quotations and RFQs, order drafts, loans and debts, aging buckets. Today `controlCenter()` queries five tables (`suppliers.service.ts:185-232`).
- **One balance with breakdown** from F3, currency-aware. Today tiles always format as TZS (`SupplierProfile.tsx:212`), and the profile itself admits Payable and Invoice Desk balances are not added together (`SupplierProfile.tsx:729-731`).
- **Clickable rows everywhere.** Payables rows, statement runs and audit events are dead text today.
- **Fix the supplier ledger** so a PO and the Payable raised from it are not both listed as debits (`suppliers.service.ts:274-302`), and add a running balance that includes payments.
- **Statement and remittance documents.** Supplier statement PDF, remittance advice per payment, supplier aging detail endpoint (customers have one, suppliers do not).
- **CRM supplier statements / performance pages** show raw UUIDs (`crm/supplier-statements/page.tsx:83`, `crm/supplier-performance/page.tsx:231`). Show names and link to the profile, or move them into the profile.
- **Supplier performance** figures (`totalPurchases`, `totalReturns`, disputes) are hand-typed. Compute them from POs, GRNs, matches and supplier credit notes.
- **Business invoice detail** links to `/cash-desk/payables?search=` which is ignored. Link to the payable itself.
- **Purchase order form** still accepts a free-text supplier. Require a picker.
- **Supplier credit / debit notes** (see F2) so returns reduce the balance.
- **GRNI.** Goods received but not invoiced is owed to the supplier and appears nowhere in any supplier balance. Once the GRNI accrual exists it should be a line in the F3 breakdown.

### 4.4 Sales Desk and the customer profile

- **One profile route.** `/sales-desk/customers/:id` and the legacy `/westsides/customers/:id` both exist; global search and the Westsides list use the legacy one. Pick the Sales Desk profile, redirect the other.
- **Profile aggregates everything.** Add: customer payments, credit notes, refunds, quotations, proformas, delivery notes, package balances and movements, Cash Desk collections, NoteBook debtor entries, fuel credit, contracts, contact persons, communication logs, documents, segments, credit profile, loans. Today the control center covers sales orders, receivables, statements and price agreements only.
- **Honour the filters.** "Open receivables" pushes `?customerId=` and the page ignores it; "Open sales" opens an unfiltered list. Fix both pages to read the party from the URL.
- **One credit position.** `Customer.creditLimit` and `CustomerCreditProfile.creditLimit` both exist; the second is hand-typed and never enforced. Keep one, compute `currentOutstanding` and `overdueAmount` from F3, enforce it in Sales Desk, POS and PetroDollar credit, and raise a credit-limit alert.
- **Statements must include every collection.** Needs F2 (receivable record-payment creates a `CustomerPayment`).
- **Direct Sales Desk "owed" chip** compares a canonical customer id to a desk customer id (`direct-sales-desk.tsx:522`), so it likely never renders for linked customers. Fix once F4 lands or compare on the canonical id now.
- **Delivery notes** take `customerId` from the DTO rather than the order, so they can disagree with the sale. Derive it from the order.
- **Overdue** is a status that nothing ever writes. Derive overdue from `dueDate` everywhere (the job worker already does) or schedule a nightly status update, so the profile, Westsides dashboard and reports stop reading zero.

### 4.5 Point of Sale and Kaunta

- **Customer chip on every sale** already exists. Add: create a customer at the till (name + phone), show credit limit and current balance when a customer is chosen (the API returns them, the UI type drops them, `pos-types.ts:34-39`), a "this customer's recent sales" shortcut, and the customer code on the receipt.
- **Credit sales** already create a Receivable with the customer. Keep that, and make the credit check use the F3 resolver so desk and fuel balances count.
- **Day close** produces a Cash Desk movement (see 4.1).
- **Loyalty** does not exist in code. A customer link on every sale is the prerequisite; nothing more is needed now.

### 4.6 PetroDollar and fuel reporting

- **Pick the master party at shift entry**, not at posting. Today the shift stores free-text supplier and customer strings and the poster maps them later.
- **Fuel credit sales become Receivables** (or at minimum appear in F3), so a station credit customer's debt shows on their profile, statement, aging and credit check. Today they are `SalesDeskSale` rows only.
- **Fuel deliveries become Payables** linked to the supplier, or appear in F3 as desk invoices with a required canonical supplier.
- **`FuelCreditSale`** has a real `customerId` FK but no service reads or writes it. Use it or drop it.
- Evidence links from a posted shift should open the party, not the generic desk view.

### 4.7 Accounting, Reports, Tax, Bank

- **Party on AP / AR control lines** (F5), then: control account by party report, sub-ledger vs GL reconciliation report, period-close check and per-party snapshot.
- **Journal entries list** gets party and reference filters and links from `referenceType / referenceId` to the document and the party.
- **Supplier aging detail** endpoint and report, mirroring customer aging detail.
- **Business reports** rows link to the party profile instead of `/cash-desk/payables`.
- **Payables and receivables can be re-pointed to another party after posting** without touching the journal (`payables.service.ts:331-365`). Block it, or re-post.
- **Bank reconciliation** should match a statement line to a supplier payment or customer collection (F2 rows) and show the party. Adjustments should not hit AP / AR control without a party and document.
- **Tax by party.** Snapshot TIN / VRN on `TaxTransaction`, add SUPPLIER_INVOICE as a tax source, post supplier-invoice input VAT to the VAT receivable account (today it is buried in inventory / expense), and implement per-supplier withholding tax using the existing `TAX_WITHHOLDING_PAYABLE` role.
- **Reports app** already honours `partyId`. Extend it to Cash Desk money-with-party and NoteBook views.

### 4.8 Documents, contacts, communications

- **Documents tab** on both profiles. `DocumentOwnerType` already has SUPPLIER and CUSTOMER; the UI shows a raw owner UUID today.
- **Contact persons and communication logs** have backend modules and no UI anywhere. Surface them on the profiles, replacing the single free-text `contactPerson` field.
- **External messages carry the party.** Add `partyType` / `partyId`; route statement emails and overdue reminders through `ExternalMessage` so there is a log per party instead of direct `EmailService` calls.
- **Templates.** Add statement, overdue reminder and remittance advice types to `MessageTemplateType` and a REMITTANCE_ADVICE document template type. Add SUPPLIER_STATEMENT, SUPPLIER_PROFILE and REMITTANCE_ADVICE to the business PDF types.
- **Contracts** link to the supplier or customer and appear on the profile.

### 4.9 Approvals, notifications, alerts, tasks, audit

- **Approval requests carry the party** (supplier for a payment or PO approval, customer for a credit-limit override) so approvers see who, not only "Payable PAY-0042".
- **Generate the alerts that already have types.** OVERDUE_PAYABLE, OVERDUE_RECEIVABLE, and a new CREDIT_LIMIT_BREACH, each linked to the party with an `actionUrl` to the profile. Today only LOW_STOCK is generated and reminder notifications cannot be clicked through.
- **Tasks** linked to a party ("call supplier about short delivery") show on the profile.
- **Audit trail by party.** Allow audit log filtering by `entityId`, and build the profile Audit tab from every related document, not only the party row.

### 4.10 Global search and the OS shell

- **A typed party deep link.** The app registry declares which apps accept a party (`cash-desk`, `records`, `reports`, `sales-desk`, `invoice-desk`, `documents`), and `openApp` accepts a target. Then every party name in the OS can carry a context menu: Open profile, Open in Cash Desk, Open in NoteBook, Open statement, Open in Reports.
- **A shared Party card** (hover or click peek) used by every app: name, code, balance from F3, overdue, last payment, phone, plus the actions above. One component replaces dozens of dead-text labels.
- **Fix the filter drops.** Receivables, payables and sales lists read `customerId` / `supplierId` / `search` from the URL.
- **Search results** for customers open the Sales Desk profile. Add desk parties, contracts, debts, loans, contact persons and NoteBook entries to the index, and let a party result expand to "open in X".

### 4.11 Msaidizi

- Expose a read-only **party 360** tool built on the F3 resolver: balance per currency, overdue, open documents, last payments, NoteBook balance, contacts. Keep `:id` and control-center routes excluded if preferred, but give the agent one safe way to answer "how much does X owe us".
- Keep every write excluded as today.

### 4.12 Integrations and dashboards

- `IntegrationMapping.internalEntityType` becomes an enum with CUSTOMER and SUPPLIER, and the integration API gains read endpoints for parties so an accounting export can map them.
- `ExternalPayment` carries the party (F1) so mobile money receipts land on the right customer.
- Dashboard widgets: top customers by sales and by exposure, top suppliers by purchases and by balance, overdue by party. The Westsides `topCustomers` figure is already computed and never rendered (`westsides/page.tsx:1903-1927`).

### 4.13 Employees as a third party type (consideration only)

Payroll movements in Cash Desk are run-level and the employee is reachable only in reverse through `SalaryPayment.cashMovementId`. If the OS adopts a `partyType` column rather than separate supplier / customer columns, EMPLOYEE and COMPANY (intercompany) fit the same model and the Movements counterparty column covers everything. This is a design choice for D1, not a requirement.

---

## 5. Suggested sequence

No code here, only order. Each phase is independently shippable and each later phase gets cheaper because of the earlier one.

**Phase 0: decide.** Answer D1 to D6 below. Write the chosen rules into `docs/os-business-connections.md` next to the existing matching rules.

**Phase 1: foundation (backend-heavy, invisible to users).**
F1 columns on CashDeskMovement, Expense, RecordEntry, Debt, Contract, Loan, RecordBookExpense. F2 SupplierPayment entity, receivable record-payment creates CustomerPayment, every payment writes a movement. F3 balance resolver. F6 hard relations. Matching sweeps for old rows, reviewed, idempotent.

**Phase 2: surfaces (what the owner sees first).**
Cash Desk counterparty column, party filter, clickable supplier and customer rows, single balance with breakdown. NoteBook party link and matching screen. Both profiles aggregate the missing records. Deep-link filters honoured. Global search customers open the right profile. Shared Party card and context menu.

**Phase 3: control.**
F5 GL party dimension, control-by-party report, reconciliation, period-close check and snapshot. Overdue and credit-limit alerts with actionUrl. Approvals carry the party. Supplier statement and remittance PDFs. Tax by party.

**Phase 4: reach.**
POS customer creation and credit display. PetroDollar credit → Receivable and party-at-entry. Documents, contacts, communications on profiles. Msaidizi party 360. Dashboards. Integration enums and endpoints. Records promote-to-formal-document.

---

## 6. Decisions only the owner can make

- **D1. Separate `supplierId` / `customerId` columns, or one `Party` table?** A single Party (with roles supplier, customer, employee, company) is cleaner and handles a business that is both a supplier and a customer. Separate columns are far less disruptive to the existing two masters and all their relations. Recommendation: separate nullable columns now, plus a `partyType` on `CashDeskMovement` and `JournalEntryLine` only, so the ledger views are uniform without a migration of the masters.
- **D2. How independent does the NoteBook stay?** Options: (a) identity link only, money untouched, test still passes; (b) identity link plus optional "also record in Cash Desk" with a reference; (c) full promotion to Receivable / Payable on request. Recommendation: (a) and (c) now, (b) as a per-company setting.
- **D3. Which cash ledger is authoritative?** Either every ERP cash effect writes a `CashDeskMovement` (Cash Desk becomes the one cash book, ERP `CashAccount` a mapped view), or Cash Desk is retired into ERP cash accounts with a new transaction table. Recommendation: Cash Desk as the cash book; it already has entries, accounts, reversals and a posting review.
- **D4. Do desk invoices and sales become Payables and Receivables?** One AP / AR is simpler for statements, aging and the GL. Keeping them separate preserves the lightweight desk workflows. Recommendation: keep the desk workflows as the entry surface but create the ERP document underneath on first payment or on posting, so there is one sub-ledger.
- **D5. Employees as a party type in Cash Desk movements?** See 4.13.
- **D6. Widen NoteBook Debtors / Creditors permissions** to cashier and accountant roles once they are linked?

---

## 7. Side findings (not linkage, found on the way)

These are defects or risks worth their own tickets.

1. `Receivable.status = OVERDUE` is never written; profile overdue, Westsides dashboard overdue and the debt statement read zero while the job worker derives overdue from `dueDate`.
2. `Supplier.currentBalance` has three writers with different currency rules (`payables.service.ts:1084-1126` base currency only; `purchase-orders.service.ts:1789-1809` and `supplier-invoices.service.ts:1568-1587` all currencies).
3. Supplier ledger double-counts a PO and its Payable (`suppliers.service.ts:274-302`).
4. Customer statements miss every collection made through receivable record-payment (`customer-statements.service.ts`, credits from `CustomerPayment` only).
5. Expense-accrued payables have `supplierId: null` and `supplierName` falls back to "Expense vendor" (`expenses.service.ts:591-614`).
6. Payable and receivable party, date, division and branch are editable after posting without touching the journal (`payables.service.ts:331-365`, `receivables.service.ts:356-357`).
7. Supplier-invoice input VAT is not posted to the VAT receivable account; it is buried in inventory / expense (`supplier-invoices.service.ts:1018-1025`).
8. Dashboard debt total drops PARTIALLY_PAID and does not net `amountPaid`, disagreeing with `/debts/summary` (`dashboard.service.ts:197-203`).
9. Package-movement by-customer endpoints have no company scope (`package-movements.service.ts:163-175`, controller 29-42). Possible tenant-isolation issue; verify before fixing.
10. Direct Sales Desk "owed" chip compares canonical id to desk id (`direct-sales-desk.tsx:522`).
11. `FuelCreditSale` is a dead model; `CustomerPriceAgreement` is stored but never applied in any pricing path; `ApprovalEngineService.createApprovalRequest` has no business callers; Westsides `topCustomers` is computed but never rendered.
12. `?search=`, `?customerId=` and `?supplierId=` are dropped by the receivables, payables and sales list pages, so global search, the dashboard exception rows and both profiles deep-link to unfiltered lists.
13. Payable and receivable payment journals credit / debit generic role accounts (`CASH_ON_HAND` / `BANK`) rather than the selected cash account's mapped ledger account (`payables.service.ts:462-500`).
14. POS day close (Funga Siku) and the Westsides daily close produce no cash movement and no variance entry.

---

## 8. Evidence index

Schema: `database/prisma/schema.prisma`. Supplier 4872, Customer 4804, Payable 4275, Receivable 4224, CustomerPayment 4496, PaymentAllocation 4550, Expense 4029, CashAccount 3966, JournalEntry 3883, JournalEntryLine 3938, Debt 3340, Contract 3373, Loan ~3256, InvoiceDeskSupplier 1989, InvoiceDeskInvoice 2007, InvoiceDeskPayment 2044, SalesDeskCustomer 17427, SalesDeskSale 17483, SalesDeskPayment 17535, CashDeskAccount ~17225, CashDeskMovement 17251, CashDeskEntry 17298, RecordEntry 17336, RecordSettlement 17376, RecordPosting 17394, RecordBook* 4082-4215, GoodsReceivedNote 15538, SupplierInvoice 15595, CustomerCreditProfile ~15789, SupplierPerformanceProfile ~15818, statement runs 15875-15925, ContactPerson 15740, CommunicationLog 15761, ExternalPayment 13673, ExternalMessage 13717, TaxTransaction 11390, AlertType 11901-11902.

Backend (under `backend/src/modules/`): `cash-desk/cash-desk.service.ts` 278-498, 896-950; `cash-desk/cash-sales-connection.service.ts` 36-323; `payables/payables.service.ts` 54-188, 227-546, 1084-1126; `receivables/receivables.service.ts` 66-199, 375-547, 1064-1082; `suppliers/suppliers.service.ts` 90-305, 365-434; `customers/customers.service.ts` 59-282, 546-744; `supplier-statements/supplier-statements.service.ts` 70-162; `customer-statements/customer-statements.service.ts` 206-556; `invoice-desk/invoice-desk.service.ts` 227-520; `sales-desk/sales-desk.service.ts` 147-456; `records/records.service.ts` 41-550; `record-book/*`; `debts/debts.service.ts`; `expenses/expenses.service.ts` 528-626, 845-917; `accounting-engine/posting-engine.service.ts` 123-357; `desk-reports/cash-connections.service.ts` 179-792; `desk-reports/desk-posting.service.ts` 153-246; `petrodollar/petrodollar-posting.service.ts` 566-850; `mobile-pos-lite/mobile-pos-lite.service.ts` 1297-1337, 2031-2128, 2742-2885; `financial-reports/financial-reports.service.ts` 378-658; `global-search/global-search.service.ts` 175-269, 470-639; `job-worker/job-worker.service.ts` 811-890, 983; `msaidizi/tool-registry.ts` 164-203, 344-407; `common/services/desk-party-links.service.ts` 94-155; `common/services/desk-transaction-links.service.ts` 24-173.

Frontend (under `frontend/src/`): `features/cash-desk/cash-desk.tsx` 54-63, 440-909; `features/cash-desk/cash-workspace.tsx` 17-92; `features/cash-desk/cash-sales-connection.tsx`; `features/cash-desk/cash-editor.tsx` 419, 566; `features/records/*`; `features/sales-desk/customer-profile.tsx` 20-30, 402-412, 520-528, 850-1139; `features/sales-desk/direct-sales-desk.tsx` 363-587; `app/(dashboard)/operations/suppliers/_components/SupplierProfile.tsx` 200-209, 286-299, 403, 432-957; `app/(dashboard)/finance/receivables/page.tsx` 1296-1302, 1703; `app/(dashboard)/finance/payables/page.tsx` 385-516, 1233-1238; `app/(dashboard)/westsides/customers/[id]/page.tsx` 95, 313; `components/os/desktop-shell.tsx` 394-500; `components/os/desktop-app-host.tsx` 49-87; `components/os/os-notifications.tsx` 192-215; `lib/apps.ts` 100-290, 326-335.

Docs already describing the current boundaries: `docs/os-business-connections.md`, `docs/design/itemba-os/records.md`, `docs/records-pdf-exports.md`.
