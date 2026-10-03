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

Started. Stacked on Phase 2 (`party-linkage-phase-2` at `f8ba6adb`, PR #96 open). PR-1 in progress.
