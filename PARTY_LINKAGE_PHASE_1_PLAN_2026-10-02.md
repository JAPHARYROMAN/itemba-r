# Party linkage, Phase 1 plan: the foundation

2026-10-02. Companion to `SUPPLIER_CUSTOMER_LINKAGE_REPORT_2026-10-02.md` (the report). This plan turns the report's foundation items F1, F2, F3, F6 and the matching sweeps into a sequenced, verifiable build. No UI redesign is in scope; Phase 1 is the plumbing that makes Phase 2 (surfaces) and Phase 3 (control) possible.

Code references are to commit `7d84b12b`. Schema is `database/prisma/schema.prisma`. Backend paths are under `backend/src/`.

---

## 1. What Phase 1 delivers

After Phase 1, every row that moves or owes money knows which supplier or customer it belongs to, every payment or collection leaves one payment row and one Cash Desk movement, and there is exactly one place that answers "what does this party owe or is owed".

Concretely, when Phase 1 is done:

1. `CashDeskMovement`, `Expense`, `RecordEntry`, `Debt`, `Contract`, `Loan` and `RecordBookExpense` carry nullable `supplierId` / `customerId` with real foreign keys. Free-text names stay as display snapshots.
2. A `SupplierPayment` entity exists, mirroring `CustomerPayment`. Paying a payable, paying an expense, paying an Invoice Desk invoice and recording a Cash Desk SUPPLIER_PAYMENT all create one.
3. Paying a receivable creates a `CustomerPayment` plus a `PaymentAllocation`, so customer statements include every collection.
4. Every ERP payment, collection, expense payment and refund writes one `CashDeskMovement` with the party and the settled document on it. Cash Desk becomes the one cash book. ERP `CashAccount.currentBalance` stays as a derived cache.
5. A `PartyBalanceService` is the only balance computation. Profiles, Cash Desk balance endpoints, CRM, POS customer search and the credit check all call it. The seven supplier and eight customer balance computations are deleted or redirected.
6. Every soft `supplierId` / `customerId` has a Prisma relation and a database foreign key.
7. Old rows with only a name can be matched to a master through reviewed, idempotent link endpoints and one minimal "Unmatched parties" queue screen.

What a user sees change in Phase 1: almost nothing, on purpose. Cash Desk Movements will start showing supplier payments and customer collections made elsewhere. Customer statements will start showing collections made in Cash Desk. The Unmatched parties screen appears for finance roles. Everything else is Phase 2.

---

## 2. Decisions adopted

| # | Decision | Rule it implies in Phase 1 |
| --- | --- | --- |
| D1 | Separate nullable `supplierId` and `customerId` columns on each row, no `Party` table. A `partyType` column on `CashDeskMovement` only (and on `JournalEntryLine` in Phase 3). | One row can carry both ids only where the business allows it (a `Contract` is one or the other, decided by `contractType`). `partyType` values: `SUPPLIER`, `CUSTOMER`, `EMPLOYEE`, `COMPANY`, `NONE`. |
| D2 | NoteBook: identity link now, money untouched. Promotion to a formal document is explicit and later. "Also record in Cash Desk" is a per-company setting, later. | Phase 1 adds `customerId` / `supplierId` to `RecordEntry` and `RecordBookExpense` plus link endpoints. No Records operation writes to `salesDeskSale`, `invoiceDeskInvoice`, `cashDeskMovement` or `journalEntry`. `backend/scripts/test-records.cjs` zero-ERP-writes assertion stays green unchanged. |
| D3 | Cash Desk is the cash book. ERP `CashAccount` is a mapped view. | Every ERP cash effect writes a `CashDeskMovement` in the same transaction, through the existing 1:1 mapping `CashDeskAccount.erpCashAccountId`. A payment against an ERP cash account with no mapped desk account is refused with a clear message until the mapping exists. `CashAccount.currentBalance` continues to be updated as today so nothing downstream breaks; it is retired in Phase 3. |
| D4 | Desk invoices and sales stay the entry surface; the ERP document is created underneath on first payment or on posting. | Phase 1 does not implement the underlying-document creation (Phase 2). Phase 1 does make `canonicalSupplierId` / `canonicalCustomerId` required for all new desk rows, including PetroDollar posting, so Phase 2 has a party to attach the ERP document to. |
| D5 | Employees and companies are party types on movements only. | `partyType = EMPLOYEE` on payroll movements (run-level, `employeeId` not added in Phase 1), `COMPANY` on intercompany loans. No employee columns on any other row. |
| D6 | NoteBook Debtors / Creditors permissions widen once linked. | Deferred to Phase 2. Phase 1 adds no new Records permissions. |

---

## 3. Non-negotiables

Carried over from the POS, PetroDollar and desk-link work. Every PR in Phase 1 is checked against these.

1. **Additive migrations only.** No column or table is dropped in Phase 1. Anything that would need `-- destructive-ok:` is out of scope (`docs/migration-safety-policy.md`).
2. **Idempotency by `requestId`.** Every new write endpoint takes a client `requestId`, stored unique, and a repeat returns the original result. Cash Desk already does this (`cash-desk.service.ts:240-300`); `SupplierPayment`, the receivable collection path and the link endpoints follow the same pattern.
3. **Row locks and version checks** on the document being paid or linked (`SELECT ... FOR UPDATE`, `version` claim with `updateMany` count check), as in `desk-transaction-links.service.ts`.
4. **One transaction per business event.** Payment row, document update, movement, journal and cache refresh commit together or not at all.
5. **No double posting.** A movement created by an ERP service carries its journal reference and is never offered for posting again in Accounting connections. A movement created in Cash Desk and posted there never produces a second ERP journal.
6. **Names are never proof of identity.** Matching suggests by normalised name; a human confirms; the audit log records who linked what.
7. **Currency and scope guards** on every movement: account currency equals document currency, account company equals document company, writer has WRITE on the document's division and branch.
8. **Tenant isolation.** Every new query is scoped by company through `CompanyScopeService` and by organisation through `OrganizationScopeService`. New endpoints get an isolation spec.
9. **Msaidizi.** New write endpoints are `@AgentExcluded`. The resolver's read endpoints are exposed at green tier only.
10. **Records independence.** No Phase 1 change makes `records.service.ts` write to an ERP table.

---

## 4. Workstreams

Seven workstreams. W1 and W6 are schema. W2, W3, W4 are the payment and cash-book unification. W5 is the resolver. W7 is matching. Dependencies are listed; the PR order is in section 9.

### W1. Party columns (F1)

**Schema, one migration `party_columns`:**

| Table | New columns | Notes |
| --- | --- | --- |
| `cash_desk_movements` | `partyType VARCHAR(10) NOT NULL DEFAULT 'NONE'`, `supplierId`, `customerId`, `payableId`, `receivableId`, `expenseId`, `refundId`, `supplierPaymentId UNIQUE`, `customerPaymentId UNIQUE`, `journalEntryId`, `journalReferenceType VARCHAR(40)` | All nullable except `partyType`. FKs: suppliers, customers, payables, receivables, expenses, refunds, supplier_payments, customer_payments, journal_entries, all `ON DELETE RESTRICT`. Indexes: `(supplierId, businessDate)`, `(customerId, businessDate)`, `(payableId)`, `(receivableId)`. CHECK: `partyType = 'SUPPLIER'` implies `supplierId IS NOT NULL`, same for CUSTOMER. |
| `expenses` | `supplierId` | FK suppliers, SetNull. `vendorName` stays as snapshot. |
| `record_entries` | `supplierId`, `customerId` | FK, SetNull. CHECK: at most one set; `kind = 'DEBTOR'` may only set `customerId`, `kind = 'CREDITOR'` only `supplierId`; SALE / PURCHASE / EXPENSE may set either. |
| `record_book_expenses` | `supplierId` | FK, SetNull. `paidTo` stays. |
| `debts` | `supplierId` | FK, SetNull. |
| `contracts` | `supplierId`, `customerId` | FK, SetNull. CHECK: at most one set, consistent with `contractType`. |
| `loans` | `supplierId` | FK, SetNull. Used when `lenderType` / `obligationType` is `SUPPLIER_CREDIT`. Remove the rejection at `loan-lifecycle.service.ts:192` for that type. |

**Backfill, same migration, SQL only, no name matching:**

- `cash_desk_movements.supplierId` from `invoicePaymentId → invoice_desk_payments.invoiceId → invoice_desk_invoices.supplierId → invoice_desk_suppliers.canonicalSupplierId` where the canonical id is set; `partyType = 'SUPPLIER'`.
- `cash_desk_movements.customerId` from `salesPaymentId → sales_desk_payments.saleId → sales_desk_sales.customerId → sales_desk_customers.canonicalCustomerId` where set; `partyType = 'CUSTOMER'`.
- `partyType = 'EMPLOYEE'` where `payrollRunId` is set. `partyType = 'COMPANY'` where `loanId` is set (intercompany).
- `journalEntryId` / `journalReferenceType` on payroll movements from `payrollJournalEntryId` (`'PayrollRunPayment'`) and on loan movements from `loan_financial_events.journalEntryId` (`'LoanLifecycle'`).
- Everything else stays `NONE` and goes to the W7 queue.

**Service changes:**

- `CashMovementDto` gains optional `supplierId` / `customerId` for `EXPENSE` and `OTHER_IN`. Validation: the party must be active in the account's company and in the user's scope (reuse `DeskPartyLinksService.masterScope`). `payee` becomes optional when `supplierId` is given and is defaulted to the supplier name.
- `CreateExpenseDto` gains optional `supplierId`; when present, `vendorName` defaults to the supplier name and the accrual payable at `expenses.service.ts:591-614` carries `supplierId` instead of `null`.
- `RecordValuesDto` gains optional `customerId` / `supplierId`; `records.service.ts` validates the kind rule and scope. The editor sends them when the user picks a party (Phase 2 UI; Phase 1 accepts them).
- Debts, contracts and loans DTOs gain the optional id; name fields default from the master when the id is present.

**Tests:** DTO validation specs for the kind rule and the CHECK constraints; backfill assertions on a disposable database (extend `backend/scripts/test-records.cjs` pattern into a new `scripts/test-party-columns.cjs`): movement rows with a resolvable chain get the party, unresolvable rows stay `NONE`.

**Exit:** migration applied on staging; backfill counts logged (rows resolved per source); no API consumer broken (all new fields optional).

### W2. Supplier payment entity (F2, supplier side)

**Schema, migration `supplier_payments`:**

- `supplier_payments`: `id`, `paymentNumber` (unique per company, sequence `SupplierPayment` via `entity-code-generator`), `companyId`, `divisionId?`, `branchId?`, `supplierId` (required, FK Restrict), `amount`, `method` (`PaymentMethodGeneral`), `reference?`, `paymentDate`, `appliedAmount`, `unappliedAmount`, `currency`, `status` (`COMPLETED` / `REVERSED`), `cashAccountId?` (FK ERP cash account), `cashDeskMovementId?` (unique, FK), `journalEntryId?`, `reversalJournalEntryId?`, `requestId` unique, `notes?`, `createdById?`, `reversedById?`, `reversedAt?`, `deletedAt?`, timestamps. Indexes mirror `CustomerPayment` (schema 4496-4548).
- `supplier_payment_allocations`: `id`, `supplierPaymentId` (FK Cascade), `payableId` (FK Restrict), `companyId`, `amount`, timestamps. Unique `(supplierPaymentId, payableId)`.
- `invoice_desk_payments.supplierPaymentId?` unique FK, so a desk payment and its ERP payment row are one event.

**Service: new `supplier-payments` module** cloned from `customer-payments` with the same shape: `findAll`, `findOne`, `create`, `reverse`, `buildPaymentLines`, `lockPayable`, `resolveCashAccount`, `syncSupplierBalance` (which, after W5, delegates to the resolver). Plus `createInTransaction(tx, user, input)` so other services can call it inside their own transaction.

**Routing every supplier payment through it:**

| Today | After W2 |
| --- | --- |
| `payables.recordPayment` (`payables.service.ts:380-546`) bumps `paidAmount`, posts, decrements cash | Calls `supplierPayments.createInTransaction` with one allocation. The payable update, journal, movement (W4) and cache refresh move into the payment service. The Expense-sourced block at line 408 stays. |
| `expenses.service.ts` pay (845-917) | Creates a `SupplierPayment` with `expenseId` on the movement and an allocation to the expense's accrual payable when one exists. Requires `expense.supplierId` to be set, or falls back to a payment with `supplierId` from the W7 match; a one-off vendor with no supplier is refused with "Pick or create the supplier first". |
| Invoice Desk `paymentInTransaction` and Cash Desk `SUPPLIER_PAYMENT` (`cash-desk.service.ts:363-412`) | Create a `SupplierPayment` for the canonical supplier (required after D4) with no allocation yet (the ERP payable does not exist until Phase 2). `invoice_desk_payments.supplierPaymentId` is set. |

**Journal rule (fixes side finding 13):** the cash line credits `CashAccount.ledgerAccountId` when the chosen account has one, else the role account, using the same resolver the expenses module already uses (`expenses.service.ts:885-908`). The AP line description keeps the supplier name; the party itself goes onto the movement, not the journal (GL party is Phase 3).

**Reversal:** `supplierPayments.reverse` reverses the journal, restores the payable, reverses the movement through `cashDesk.reverse` semantics (creates the REVERSAL movement), marks the payment REVERSED. Same guards as `customer-payments.service.ts:355-510`.

**Tests:** unit specs for create and reverse; a spec asserting payable paths produce exactly one payment, one allocation, one journal and one movement; an isolation spec; a replay spec for `requestId`.

**Exit:** no code path changes `Payable.paidAmount` without creating a `SupplierPayment` (grep-enforced in a spec: every writer of `paidAmount` is inside the payment service).

### W3. Receivable collection creates a customer payment (F2, customer side)

**Service change:** `receivables.recordPayment` (`receivables.service.ts:375-547`) becomes a thin wrapper that calls a new `customerPayments.createInTransaction(tx, user, { customerId, amount, cashAccountId, paymentDate, reference, allocations: [{ receivableId, amount }], requestId })`. The receivable update, journal, cash increment, `syncSalesOrderPaymentFromReceivable` and balance refresh all happen inside the payment service, once.

**Unlinked receivables:** `CustomerPayment.customerId` is required, and some receivables have `customerId = null` (generic walk-in credit sales, `sales-orders.service.ts:426`; manual unlinked receivables, `finance/receivables/page.tsx:1154`). Rule: a payment against an unlinked receivable is refused with "Match this receivable's customer before recording payment", and the receivable appears in the W7 queue. This is the same rule the desks already apply (`desk-party-links.service.ts:107-110`). Two mitigations ship in the same PR: the W7 queue screen, and a `receivables/:id/link-customer` endpoint so the cashier can match and pay in two clicks.

**Statement effect:** `customer-statements.service.ts` needs no change; it already reads `CustomerPayment`. The statement closing balance and the aging total stop disagreeing.

**Other callers:** `RecordSalesOrderPaymentModal` (Cash Desk "Collect payment") and the Receivables page keep calling the same endpoint. The response shape stays; it gains `customerPaymentId`.

**Tests:** spec that a receivable payment creates one `CustomerPayment` with one allocation and one movement; spec that the statement includes it; spec for the unlinked refusal; replay spec.

**Exit:** no code path changes `Receivable.paidAmount` outside the payment service.

### W4. One cash book (D3)

Every ERP cash effect writes a `CashDeskMovement` in the same transaction. A new `CashBookService` in `cash-desk` exposes `recordErpMovement(tx, user, input)` for other modules, next to the existing `recordFuelMovement` and `receiveSalesPayment` (`cash-desk.service.ts:825-950`).

**Mapping rule:** the ERP `cashAccountId` on the payment resolves to the `CashDeskAccount` with `erpCashAccountId = cashAccountId` (1:1, `schema.prisma` CashDeskAccount `erpCashAccountId @unique`). If none exists the write is refused: "Connect cash account X to a Cash Desk account first". No automatic provisioning in Phase 1, because `CashDeskAccount` requires a division and branch and ERP accounts may have neither. A pre-flight script lists ERP cash accounts used by payments in the last 12 months that have no desk mapping, so the owner connects them before release.

**Movement kinds and what each carries:**

| Business event | Kind | partyType | Document columns | journalReferenceType |
| --- | --- | --- | --- | --- |
| Payable payment (W2) | `SUPPLIER_PAYMENT` | SUPPLIER | `payableId`, `supplierPaymentId` | `Payable` |
| Expense payment (W2) | `EXPENSE` | SUPPLIER or NONE | `expenseId`, `supplierPaymentId` | `Expense` |
| Invoice Desk / Cash Desk desk payment (W2) | `SUPPLIER_PAYMENT` | SUPPLIER | `supplierPaymentId` (+ existing `invoicePaymentId`) | none until posted in Accounting connections, as today |
| Receivable collection (W3) | `CUSTOMER_RECEIPT` (new kind) | CUSTOMER | `receivableId`, `customerPaymentId` | `CustomerPayment` |
| Customer payment created directly | `CUSTOMER_RECEIPT` | CUSTOMER | `customerPaymentId` | `CustomerPayment` |
| External payment confirm | `CUSTOMER_RECEIPT` | CUSTOMER or NONE | `customerPaymentId` when it allocates | `ExternalPayment` |
| Refund paid | `REFUND` (new kind) | CUSTOMER | `refundId` | `Refund` |
| Sales Desk receipt (exists) | `SALE_RECEIPT` | CUSTOMER | `salesPaymentId` | as today |
| Payroll (exists) | `PAYROLL_PAYMENT` | EMPLOYEE | `payrollRunId` | `PayrollRunPayment` |
| Intercompany (exists) | `LOAN` / `LOAN_REPAYMENT` | COMPANY | `loanId` | as today |

Out of W4 in Phase 1: POS cash sales, Funga Siku and Westsides day close, legacy `FuelShiftCollection`. They are cash completeness, not party linkage, and they interact with the `DAILY_SALES` guard; Phase 2.

**Accounting connections (no double posting):** `cash-connections.service.ts:375-462` gains one branch before the DeskCash branch: if `row.journalEntryId` is set, status is `Posted (ERP)` when the journal is POSTED, not deleted, same date and the cash-account line matches the entry amount; `Reversed` when the row is reversed and the journal REVERSED; else `Needs review`. Such rows are excluded from the posting candidates and from `prepare()`. This is the same shape as the existing payroll branch.

**Balances:** `CashDeskAccount.balance` is updated through `entries()` as today. `CashAccount.currentBalance` continues to be incremented or decremented by the calling service, unchanged, so Business accounts cards and any report reading it keep working. A nightly check job compares the two for mapped pairs and raises a `Needs review` row in Accounting connections on mismatch.

**Reversal:** reversing an ERP payment reverses its movement (REVERSAL row pointing at the original) inside the same transaction. Reversing a movement from Cash Desk that has `journalEntryId` set is refused: "Reverse the payment in Payables / Receivables instead".

**Tests:** per path, assert one movement with correct kind, party, document, account, amount sign and `journalEntryId`; assert Accounting connections shows `Posted (ERP)`; assert reversal symmetry; assert refusal when the ERP account has no desk mapping; isolation spec for `recordErpMovement`.

**Exit:** Movements list on staging shows a payable payment made on the Payables page and a receivable collection made from Cash Desk "Collect payment", each with the party set.

### W5. Party balance resolver (F3)

**New `party-balance` module, `PartyBalanceService`:**

- `supplier(companyId, supplierId, { asOf?, currency? })` and `customer(companyId, customerId, { asOf?, currency? })`.
- Returns per currency: `erp` (open amount, overdue amount derived from `dueDate < asOf`, aging buckets 0-30 / 31-60 / 61-90 / 90+, unapplied payments), `desk` (unpromoted desk invoices or sales, `totalAmount - paidAmount`, for the canonical party), `notebook` (open DEBTOR or CREDITOR records linked to the party, `amount - settledAmount`, labelled informal and never added to the total), `total` (`erp + desk`), `creditLimit`, `creditAvailable`, `lastPaymentAt`.
- `refreshCached(tx, kind, companyId, partyId)` writes `Supplier.currentBalance` / `Customer.currentBalance` as the base-currency `erp.open` figure, documented as such. It is the single writer.
- Overdue is always derived from `dueDate`. Nothing filters on `status = 'OVERDUE'` any more.

**Consumers redirected in Phase 1** (each one is a small PR-sized change with a before/after assertion on staging data):

| Consumer | Today | After |
| --- | --- | --- |
| `suppliers.service.ts` `workbenchSummary` 90-150, `controlCenter` 185-232, `payablesSummary` 365-434, `ledger` 234-305 | three different sums; ledger double-counts PO + payable | all read the resolver; ledger lists documents and payments (W2 rows) with a running balance, no PO rows |
| `customers.service.ts` `workbenchSummary` 59-93, `controlCenter` 153-209, `profile` 546-744 | two sums, `status = 'OVERDUE'` filter | resolver |
| `sales-orders.service.ts` credit check 2024-2055 | cached `currentBalance`, skips when `customerId` null | resolver `total` per currency; still skips when no customer |
| `mobile-pos-lite.service.ts` customer search 1297-1337 | cached balance | resolver `total` (so POS can show it in Phase 2) |
| `crm.service.ts` 95-101, 226-235 | sum of cached balances | resolver totals |
| `invoice-desk.service.ts` `overview` 305-392 and `cash-sales-connection.service.ts` 57-323 | desk-only and SalesOrder-only | resolver, so Cash Desk "Supplier balances" and "Sales collections" show the same number the profile shows, with the breakdown available for Phase 2 chips |
| `financial-reports.service.ts` supplier / customer aging 447-658 | own bucket logic | resolver buckets; adds `supplier-aging-detail/:companyId/:supplierId` |
| `westsides-dashboard.service.ts` 440, 897, 1822 | `status = OVERDUE` (reads zero) | resolver overdue |
| The 3 `syncSupplierBalance` and 5 `syncCustomerBalance` copies | different currency rules | deleted; callers invoke `refreshCached` |

**Exposure:** `GET /party-balance/suppliers/:id` and `/customers/:id`, permission `suppliers.view` / `customers.view`, company-scoped, green tier for Msaidizi (read-only, no PII beyond what list endpoints already expose).

**Tests:** resolver unit spec with fixtures covering multi-currency, overdue by date, desk + ERP + notebook split, unlinked rows excluded; a staging reconciliation script that prints, per party, old figures (each legacy computation) next to the resolver's, with a diff report the owner signs off before the legacy code is deleted.

**Exit:** grep shows no `currentBalance` writers outside the resolver; the diff report is reviewed; Cash Desk and profile show identical totals for a sample of 20 suppliers and 20 customers.

### W6. Hard relations (F6)

**Pre-flight script** (`backend/scripts/party-orphans.cjs`): for each soft id column below, count rows whose id has no matching master in the same company, and write them to a CSV. Run on a staging copy first, then on production before the migration.

**Migration `party_relations`**, additive FKs with `NOT VALID` then `VALIDATE CONSTRAINT`, so the lock is short:

| Table.column | Target | On delete | Orphan handling |
| --- | --- | --- | --- |
| `goods_received_notes.supplierId` | suppliers | Restrict | required column; orphans must be fixed by hand before VALIDATE (pre-flight lists them) |
| `supplier_invoices.supplierId`, `.payableId` | suppliers, payables | Restrict / SetNull | same |
| `rfq_suppliers.supplierId`, `supplier_quotations.supplierId`, `bid_comparison_lines.supplierId`, `bid_comparisons.recommendedSupplierId`, `request_for_quotations.awardedSupplierId`, `purchase_requisition_lines.preferredSupplierId` | suppliers | SetNull where nullable, Restrict where required | nullable orphans set to null, logged |
| `supplier_performance_profiles.supplierId`, `customer_credit_profiles.customerId`, `customer_segment_memberships.customerId` | suppliers / customers | Cascade | orphan rows copied to `archive_party_orphans` then deleted; this is the one place a row is removed, and it is a row that references a party that does not exist |
| `supplier_statement_runs.supplierId`, `customer_statement_runs.customerId` | suppliers / customers | Restrict | column becomes nullable; the `'ALL'` sentinel becomes `NULL` (`supplier-statements.service.ts:140`), service updated |

Prisma relations and back-relations added on `Supplier` and `Customer` for each.

**Polymorphic existence checks:** `contact-persons.service.ts:39-58`, `communication-logs.service.ts:58-80`, documents with `ownerType` SUPPLIER / CUSTOMER, approval requests, tasks and notifications with a party entity type: on write, assert the referenced party exists in the same company. A shared `PartyExistsGuard` helper in `common/services`.

**Tests:** migration rehearsal on a disposable database seeded with orphans; spec for each existence check.

**Exit:** `prisma validate` clean; pre-flight on production returns zero required-column orphans; `'ALL'` no longer appears in statement runs.

### W7. Matching sweeps and the Unmatched parties queue

**Generic `PartyLinksService`** in `common/services`, generalising `DeskPartyLinksService`:

- `unlinked(user, source, query)` lists rows of a source with no party id, grouped by normalised name, with a suggested master when exactly one active master in the company has the same normalised name (suggestion only, never applied).
- `link(user, source, rowId, partyId, requestId)` sets the id, keeps the name snapshot, bumps `version` where the table has one, writes an audit log entry, and is idempotent (same row, same party, same request → same result; different party on an already linked row → conflict).
- `linkMany(user, source, rowIds[], partyId, requestId)` for "all rows with this exact name", transactional, same guards per row.
- Permissions: `suppliers.update` or `customers.update` plus the source app's manage permission (`cash_desk.record`, `records.manage`, `expenses.update`, `debts.update`, `contracts.update`, `loans.update`, `receivables.update`, `payables.update`).
- Company membership and WRITE scope on every affected row are required, as in `desk-transaction-links.service.ts`.

**Sources in Phase 1:** `cash_desk_movements` (payee, and unresolved desk chains), `expenses` (vendorName), `record_entries` (counterparty), `record_book_expenses` (paidTo), `debts` (creditorName), `contracts` (counterpartyName), `loans` (lenderName), `receivables` (customerName where customerId null), `payables` (supplierName where supplierId null), `invoice_desk_suppliers` and `sales_desk_customers` (already have endpoints; the queue just lists them too).

**Side effects of linking that Phase 1 must handle:**

- Linking a receivable or payable triggers `refreshCached` for the party.
- Linking an expense with an accrual payable also sets `payable.supplierId`.
- Linking a `RecordEntry` writes a `RecordEvent` (Records' own activity log), nothing else.
- Linking never changes amounts, statuses, journals or movements.

**Minimal UI (the only screen in Phase 1):** an "Unmatched parties" page under Settings or Finance, one table: source, name as typed, count of rows, total amount, suggested master, a picker, Link / Link all. Opens from a badge on the Cash Desk, Records and Receivables pages when the count for that source is non-zero. No redesign of any existing screen.

**Tests:** spec per source for link, linkMany, idempotent replay, conflict on relink, scope refusal; isolation spec; an audit-log spec.

**Exit:** on staging, every source's unlinked count is visible; a linked NoteBook debtor shows `customerId` set and `test-records.cjs` still passes.

---

## 5. Data migration order

All migrations are additive. Suggested timestamps follow the repo pattern (`YYYYMMDDHHMMSS_name`).

1. `party_columns` (W1) with its SQL backfill.
2. `supplier_payments` (W2).
3. `cash_desk_movement_kinds` (W4): widen any CHECK on `kind` to include `CUSTOMER_RECEIPT` and `REFUND`; add `cash_desk_movements.journalEntryId` FK (if not in 1).
4. `party_relations` (W6), run after the pre-flight orphan report is clean.
5. `party_links_permissions` (W7): seed the new permissions into the roles that already hold the source app's manage permission, following `20260925110000_records/migration.sql:108-113`.

Rollback: every migration leaves old columns and behaviour intact. The behavioural switch for W4 (ERP services writing movements) sits behind an environment flag `CASH_BOOK_UNIFIED` (default on in staging, off in production until the mapping pre-flight is clean), so production can run the new schema with the old behaviour if needed.

---

## 6. Guards against double counting

| Risk | Guard |
| --- | --- |
| A payment creates a movement and someone posts the movement again in Accounting connections | `journalEntryId` set → `Posted (ERP)`, excluded from candidates (W4) |
| A Cash Desk SUPPLIER_PAYMENT already posted as DeskCash later gets an ERP payable in Phase 2 | Phase 2 concern; Phase 1 records `supplierPaymentId` on the desk payment so Phase 2 can see the money already moved |
| Manual `DAILY_SALES` entered after `CUSTOMER_RECEIPT` rows exist for the account and date | Extend the existing `DAILY_SALES` vs `SALE_RECEIPT` guard (`cash-desk.service.ts:310-323`) to `CUSTOMER_RECEIPT` |
| Same request replayed | `requestId` unique on `SupplierPayment`, `CustomerPayment` (add if missing), movements (exists), links |
| Two payments racing on one payable | `SELECT ... FOR UPDATE` on the payable (exists), allocation sum checked against `outstandingAmount` inside the lock |
| Payment on a payable raised from an expense | existing block stays (`payables.service.ts:408`) |
| ERP cash account not mapped to a desk account | refused with a message; pre-flight lists the gaps |
| Currency mismatch | account currency must equal document currency (existing pattern in `receivables.service.ts:410-420` and `cash-desk.service.ts:896-915`) |
| Linking changes money | `PartyLinksService` touches only the id, the snapshot name, version and audit; a spec asserts amounts, statuses and journal counts are unchanged |

---

## 7. Permissions and Msaidizi

- New permissions: `supplier_payments.view`, `supplier_payments.create`, `supplier_payments.reverse`, `party_links.view`, `party_links.manage`. Seeded to the roles that hold `payables.update` (for supplier payments) and to GROUP_SUPER_ADMIN, GROUP_FINANCE_CONTROLLER and ACCOUNTANT (for links). CASHIER gets `party_links.view` plus `receivables.update`-based linking only, so the W3 refusal has a two-click resolution.
- `@AgentExcluded` on every new write endpoint: supplier payment create and reverse, link, linkMany, cash book record.
- Green tier reads: `party-balance` endpoints, `supplier-payments` list and detail.

---

## 8. Testing and verification

- **Unit and integration specs** per workstream as listed. All run under the existing `npm test` in `backend/` (8 GB heap, `--runInBand`).
- **Isolation specs** for every new endpoint, following `procurement-statements.isolation.spec.ts`.
- **Disposable-database scripts**: `test-records.cjs` unchanged and green; new `test-party-columns.cjs` for the W1 backfill and `test-party-links.cjs` for W7.
- **Staging reconciliation (W5):** script prints, per party, every legacy balance figure next to the resolver figure. The owner reviews the diff before legacy code is deleted. Expected diffs are explainable: currency grouping, desk inclusion, overdue by date.
- **Staging cash reconciliation (W4):** for each mapped account pair, `CashDeskAccount.balance` movement over the test period equals the change in `CashAccount.currentBalance`.
- **Release proof:** `docker-compose.release-proof.yml` run with the migrations, then the verification steps from `docs/os-business-connections.md` (counts, deep links, purchase → receipt → invoice → payment, sale → collection) plus: a payable payment appears in Movements with its supplier; a Cash Desk collection appears on the customer statement; the Unmatched queue lists and links a NoteBook debtor.
- **CI:** existing pipeline; watch for the Prisma client regeneration step and the jest heap setting (see memory note on the 8 GB heap).

---

## 9. PR sequence

Branch `party-linkage-phase-1` off `main`, one PR per step, each green and independently revertible.

1. **PR-1 Schema W1 + W6 pre-flight script.** Columns, backfill, orphan report. No behaviour change.
2. **PR-2 W6 relations.** After the owner runs the pre-flight on production and clears required-column orphans.
3. **PR-3 W2 SupplierPayment** with payables and expenses routed through it. Movements not yet written (flag off).
4. **PR-4 W3 receivable → CustomerPayment** plus `link-customer` endpoint and the refusal.
5. **PR-5 W4 cash book**, flag `CASH_BOOK_UNIFIED`, Accounting connections `Posted (ERP)` branch, nightly balance check.
6. **PR-6 W5 resolver** and consumer redirects, with the reconciliation script output attached to the PR.
7. **PR-7 W7 PartyLinksService**, endpoints, permissions seed, Unmatched parties screen.
8. **PR-8 docs**: update `docs/os-business-connections.md` with the D1 to D6 rules, the cash-book rule and the matching sources; update `docs/design/itemba-os/records.md` to say identity links are allowed and money links are not.

Each PR description lists which non-negotiables in section 3 it touched and how the spec proves them.

---

## 10. Risks and how the plan handles them

- **Cashiers blocked by the unlinked-receivable refusal (W3).** Mitigated by shipping the link endpoint and queue in the same PR, by the CASHIER role being able to link receivables, and by measuring the unlinked count on production before release. If the count is large, run a reviewed bulk `linkMany` session with the owner before enabling.
- **ERP cash accounts without a Cash Desk mapping (W4).** Pre-flight lists them; the flag keeps production on old behaviour until the owner has connected them through the existing Cash Desk Accounts tab.
- **Legacy balance figures that disagree with the resolver (W5).** Expected. The reconciliation diff is reviewed and the explanation recorded before deletion. Where a legacy figure was wrong (double-counted ledger, status-based overdue reading zero), the resolver is right by design.
- **Orphans in required soft-id columns (W6).** Pre-flight before migration; manual fixes; `NOT VALID` then `VALIDATE` keeps locks short.
- **PetroDollar posting still creates desk-only documents.** Unchanged in Phase 1 except the canonical party becomes required. Fuel credit and deliveries appear in the resolver's `desk` bucket, so they are counted, just not yet as Receivables and Payables (Phase 2, D4).
- **Volume of movements.** Phase 1 adds one movement per payment, collection, expense payment and refund. POS per-sale rows are deliberately excluded until Phase 2 settles the daily-sales guard.

---

## 11. Out of scope for Phase 1

Cash Desk counterparty column, party filter and clickable rows; profile aggregation; NoteBook matching screen beyond the generic queue; promotion of NoteBook records to Receivable / Payable; supplier credit and debit notes; GL party dimension and control reconciliation; alerts and approvals carrying the party; documents, contacts and communications on profiles; POS customer creation and credit display; POS cash and day close into Cash Desk; PetroDollar documents as Receivables / Payables; Msaidizi party 360; dashboards; integrations; permission widening for NoteBook (D6).

---

## 12. Exit criteria

Phase 1 is done when all of these are true on staging and the owner has signed the W5 diff:

- [ ] Every table in W1 has its party columns; backfill counts are logged.
- [ ] No writer of `Payable.paidAmount` or `Receivable.paidAmount` exists outside the two payment services.
- [ ] Every payable payment, expense payment, receivable collection, customer payment and refund produces exactly one `CashDeskMovement` with party and document set, visible in Movements, shown as `Posted (ERP)` in Accounting connections, never offered for posting.
- [ ] A collection made from Cash Desk "Collect payment" appears on the customer's statement.
- [ ] `PartyBalanceService` is the only writer of `currentBalance`; Cash Desk balances and profile balances match for the sample set.
- [ ] All soft ids in W6 have database foreign keys; the `'ALL'` sentinel is gone.
- [ ] The Unmatched parties queue lists every source and a link is idempotent and audited.
- [ ] `test-records.cjs` passes unchanged; the Records zero-ERP-writes guarantee holds.
- [ ] `docs/os-business-connections.md` records the adopted rules.

---

## 13. Status — 2 October 2026

Branch `party-linkage-phase-1` (worktree `C:\projects\Actual Projects\itemba-r-party-linkage`, based on `origin/main` at `395026f6`). Not pushed, no PR opened, not deployed. Commits, in order:

| PR | Commit | What landed |
| --- | --- | --- |
| PR-1 (W1) | `a7634942` | Party and document columns on `CashDeskMovement`, `Expense`, `RecordEntry`, `RecordBookExpense`, `Debt`, `Contract`, `Loan`; id-only backfill; `backend/scripts/party-orphans.cjs`. |
| PR-2 (W6) | `ac4d2ac6` | Real foreign keys for every soft supplier / customer id; statement runs lose the `'ALL'` sentinel; `PartyExistsService` on contact persons, communication logs, documents, tasks, approval requests; `archive_party_orphans`. |
| PR-3 (W2) | `c6598896` | `SupplierPayment` + allocations and the supplier-payments module; payables, expenses, Invoice Desk and Cash Desk routed through it; approved supplier invoices follow their payable. |
| PR-4 (W3) | `4f94bbe7` | Receivable collections create a `CustomerPayment`; `receivables/:id/link-customer`; legacy direct path kept for unlinked documents (see deviations). |
| PR-5 (W4) | `2b775caf`, `a01cffc5` | Cash-book module behind `CASH_BOOK_UNIFIED`; movements for supplier payments, collections, expense payments, refunds and the legacy paths; `Posted (ERP)` in Accounting connections; reconciliation and unmapped endpoints; `backend/scripts/cash-book-preflight.cjs`. |
| PR-6 (W5) | `77f1a279` | `party-balance` module: `computePartyBalance` resolver and endpoints, `balance` on both control centres, `refreshCachedPartyBalance` as the single cached-balance writer (eight copies now delegate), date-based overdue, live credit exposure. |
| PR-7 (W7) | `dd281fdf` | `party-links` module (list grouped by normalised name, unique-master suggestion, link / link-many, audited), permissions `party_links.view` / `manage`, `/finance/unmatched-parties` page and sidebar entry. |
| PR-8 | `38c0ad2c` | `docs/os-business-connections.md` and `docs/design/itemba-os/records.md` record the adopted rules. |
| follow-up | `670a0b6a` | Msaidizi capability contract kept closed: new endpoints agent-excluded until fixtures exist; domain primer and its tests follow the schema; pinned generated-field count 108 → 106. |

Deviations from the plan, and why:

1. **Unlinked documents are not refused.** The plan's hard refusal (W3, and the W2 payable rule) is replaced by keeping the legacy direct settlement path for payables and receivables that have no linked party. The Msaidizi financial-action evidence pack (`backend/src/modules/msaidizi/crud-financial-action-positive-evidence.ts`) is executed end to end by `backend/test/crud-coverage-loopback.e2e-spec.ts` in CI and pins the supplier-free and customer-free settlement behaviour for both capabilities; an unlinked document also has no party to attach a payment to or a statement to appear on. The Unmatched parties queue surfaces these rows; once matched, payments take the payment-service path. Linked documents follow the plan exactly.
2. **Expense payments record a `SupplierPayment` only when the expense names a supplier.** A one-off vendor has nothing to attach the payment to until it is matched.
3. **W4 scope.** POS cash takings, day closes and external payments are not mirrored into the cash book (Phase 2). The nightly balance check is a read-only endpoint (`GET /cash-book/reconciliation`) rather than a scheduled job.
4. **W5 consumers.** The resolver is exposed and attached to both control centres; the credit check uses live exposure; the cached balance has one writer. Cash Desk "Supplier balances" / "Sales collections", Invoice Desk overview, CRM and the POS customer search still read their own figures (Phase 2 surfaces will consume the resolver). Supplier prepayments (unapplied supplier payments) are not supported.
5. **W1 DTO party pickers** (Cash Desk expense / other-in, Records editor, debts, contracts, loans) are not added; linking happens through the queue in Phase 1 and the pickers belong with the Phase 2 surfaces.
6. **Msaidizi exposure is deferred.** The plan exposed the party-balance reads at green tier. The Msaidizi capability manifest must stay closed over positive evidence fixtures and explicit exclusions (several specs pin the exact inventory, and the fixtures are executed end to end in CI), so every new Phase 1 endpoint is agent-excluded until its fixture is authored. The domain primer and its load-bearing-claim tests were updated to the new schema facts.

Verification performed locally (no staging, no production): `prisma validate` / `generate`, `tsc --noEmit`, frontend typecheck, prettier and eslint (0 errors) on every changed file, per-PR unit suites (236 to 289 tests each run), full migration rehearsal on disposable databases (`party_columns` backfill, `party_relations` with seeded orphans, `supplier_payments`, fresh full deploy with drift check), `party-orphans.cjs` and `cash-book-preflight.cjs` against the local development database. Full backend unit suite (`npm run test:ci`, run before the Msaidizi compliance commit): 435 suites, 4423 tests, 4409 passing; the 14 failures were all in the seven Msaidizi contract specs fixed by `670a0b6a` plus `model-client.spec.ts`, which fails only when the shell exports `ANTHROPIC_BASE_URL` (it passes with the variable unset). After the fix, every Msaidizi suite passes: 147 suites, 1809 tests. No test outside Msaidizi failed at any point in the final run.

Next for the owner: review the branch, run the two pre-flights on a production copy, open the PR, and decide when to set `CASH_BOOK_UNIFIED=true` on staging.
