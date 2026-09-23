# Accounting readiness — invoice and cash connections

Open Reports → Accounting readiness, or follow the card in Group Health. The card checks accessible invoices, cash movements and unlinked supplier payments within the selected date and organisation filters. Zero outstanding checks is not a claim that all accounting is complete.

## Cash connections

1. In **Account connections**, map each ERP cash/bank account to its own active asset ledger account. Connect the Cash Desk account representing the same cash box or bank account. Company, organisation and accounting currency must agree. Each ERP account has at most one Desk connection and one dedicated ledger account. Connections are audited, do not post balances, and cannot be reassigned here. Mapped cash accounts retain their organisation and currency; corrections use financial transactions.
2. Review the opening balance against existing books. In **Cash movements**, choose an equity offset for a Desk opening balance only when it is not already in another journal. Opening balances are not copied from ERP cached cash balances.
3. Post invoices in **Invoices**, then review their payments in **Cash movements**. A supplier payment debits the payable used by its purchase invoice and credits mapped cash. A customer receipt debits cash and credits the sale's receivable. Neither posts invoice income/expense a second time.
4. Daily cash sales credit income; expenses debit expense/cost-of-sales; other receipts use an explicitly selected compatible offset. Same-company transfers post equal and opposite cash legs, retaining each leg's division/branch. Connected loan and intercompany movements post atomically through their own lifecycle; their linked journals appear here. Historical unconnected movements remain flagged for review.
5. Existing Invoice Desk payments without a cash account appear below the movement list. Link them to the account that paid them; this creates one cash outflow with the original date and amount without increasing the invoice's paid amount. The account must have sufficient historical funds. Do not link a payment already included in that account's opening balance or another movement.
6. Reverse posted cash through Cash Desk. Operational cash, linked invoice balances, the reversing journal and audit share a transaction. Reversal requires journal reversal permission and an open accounting period. Manual journal reversal is blocked for Desk cash; linked invoice journals cannot be reversed while active Desk payments remain.

Posting remains an explicit reviewed action, not automatic. Reviews include debit/credit lines, the source fingerprint, existing journals and a duplicate-entry acknowledgement. Source and account locks serialize posting with corrections; repeated or stale submissions cannot create another journal. Posting requires cash read, journal view/create/post, and company/organisation WRITE access. Mapping requires Cash Desk management, cash-account management and journal view. Supplier/customer source access is checked independently.

The account page displays all-date balances calculated from the mapped ledger, including original posted journals and their dated reversals. Cash-flow reports also recognize mapped cash accounts with custom account codes. Legacy ERP `CashAccount.currentBalance` remains its operational cache; it is not overwritten by Desk posting. Existing ERP transaction producers that still use company-wide account roles have not been migrated to these mappings.

Account setup also shows the recorded cash-account balance, the mapped ledger balance, and their difference. Before saving a mapping, its review displays the chosen ledger's existing balance, including for an unmapped account. These are separate balance sources: a difference calls for checking opening balances and movements recorded in each app, not an automatic adjustment. Matching amounts alone are not evidence of reconciliation. The accounting period filter does not restrict these all-date balances.

Review remains available when a user has read access but cannot write to the account's company or branch. The server returns the applicable connection capability and the form hides the save action for those accounts; the mutation independently enforces the same permissions and scope. Existing prefixed cash-account IDs and legacy chart IDs are accepted as bounded strings and validated against the actual records, rather than rejected as non-UUIDs.

## Invoice posting

- Lists unposted, posted, changed, duplicate, voided and review-required documents.
- Reviewer selects a receivable asset/income account for sales, or expense/asset/cost-of-sales and payable liability accounts for purchases. The UI shows balanced debit/credit totals and requires an acknowledgement about existing entries and tax splits.
- Posting uses the existing PostingEngine and accounting-period controls. It requires journal view/create/post permissions, source-app read permission, and company plus organisation WRITE scope.
- Source rows are locked, the preview fingerprint is rechecked, and existing source-linked journals block retries. The journal and audit are written in one transaction. Source references are `DeskSale` / `DeskPurchase`; the journal description stores the source fingerprint for later drift checks.
- Currency must match the company profile. Amounts that cannot pass exactly through the current ledger engine are rejected. Active accounts must belong to the source company and compatible division/branch.
- Linked journal numbers remain visible in the review. Corrections/voids flag drift; reversed journals require review instead of automatic reposting.

## Statement reconciliation

Existing Accounting Engine → Bank Reconciliations now includes CSV preview/import and fresh approval checks. CSV headers: `date,description,reference,debit,credit`; dates YYYY-MM-DD; debit means money out, credit means money in. Up to 1,000 rows, 2 MB in the browser, four decimal places. Exact duplicate date/description/reference/debit/credit combinations are skipped. Separate identical transactions need distinct references.

Imports validate the entire batch before writing. All reconciliation mutations lock the parent; a company advisory lock serializes matching across reconciliations. Auto matching checks direction and excludes used journal lines. Manual matches require exact signed amounts on the resolved cash/bank control account. Approve and Close recompute statement continuity, opening/closing agreement, complete matching, live journal validity, duplicate use and unmatched control-account entries. Maker-checker remains mandatory. Approval/close/import audit writes share the transaction.

## Deliberate limits

Tax splits and FX are not covered by the Desk cash bridge. Payroll payments use the [source-owned payroll cash connection](payroll-cash-connection.md), with reviewed accruals and atomic cash/payment journals. Loans and intercompany movements use the [connected loan lifecycle](loan-lifecycle.md). Unrelated manual ERP entries cannot automatically be recognized as the same Desk document or movement. Review them before posting. Invoice corrections are flagged, not automatically reversed or reposted. Real account classifications and historical opening balances still require accounting review.

Reconciliation requires the selected cash account's dedicated mapping and no longer falls back to a company-wide bank/cash role. Original POSTED/REVERSED journals and their dated reversals remain part of the books. Currency must match the company profile; FX reconciliation is blocked. Outstanding timing-item schedules remain future work. Opening balances are preparer supplied, and Group Health continues to label Cash Desk balances as recorded rather than bank-reconciled. Ambiguous matching candidates can be reviewed and matched in the workpaper; existing matches can be removed while it is a draft.

## Validation

Focused tests cover stale previews, repeated posting, source access, company/branch WRITE checks, currency mismatch, exact balanced amounts, changed/reversed evidence, statement continuity, duplicate CSV imports, malformed batches, matching direction/reuse, invalid journals, maker-checker, and rechecking before close. Frontend tests cover CSV parsing and the posting review/permission gate. Live checks are read-only; no real journals, bank lines or payments are created for testing.

Cash tests additionally cover all movement directions, exact amount limits, transfer balancing, account reuse/reassignment, invoice control-account selection, reversal permission and transactional handoff, and linking historical payments without paying twice. The additive `20260919120000_cash_ledger_connections` migration adds nullable unique mappings with restrictive foreign keys; existing account mappings are left unset until reviewed.

Setup checks cover legacy identifiers, exact balance differences, candidate balances before mapping, company write denial with read-only review, and preserving service failures rather than misreporting them as access restrictions.
