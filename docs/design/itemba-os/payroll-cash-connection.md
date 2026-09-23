# Payroll payments and Cash Desk

Payroll runs are paid through **Payroll → Payroll runs → Record payment**. Choose a connected Cash Desk account and the actual payment date. The action records a completed external payment; it does not send money to a bank or mobile-money provider.

## Posting and approvals

HR and Finance sign-off must come from different people. Accounting must independently post the payroll accrual before payment. Net pay must match both employee entries and the reviewed Salaries Payable (2270) amount. Payment debits that payable and credits the selected account's mapped asset ledger. The posting engine enforces open accounting periods and active accounts.

The payment commits one Cash Desk outflow, the posted journal, run status, employee salary-payment records, advance recovery and commission settlement in the same database transaction. Salary payments now display those employee records; new payments route to Payroll runs. The disconnected draft-payment posting path is retired.

Payroll remains company-wide. Payment requires company/group scope, company write access and `payroll.pay`, `cash_desk.view`, `cash_desk.record`, `journal_entries.create`, `journal_entries.post`. The selected account must belong to that company and match its accounting currency and organisation mapping. Historical daily balances must remain nonnegative; payment cannot precede account opening or the accrual. No FX conversion is inferred.

## Corrections

Use **Reverse payment** on a paid run. A reason and actual reversal date are required, plus `cash_desk.reverse` and `journal_entries.reverse`. Reversal restores cash, posts the opposite journal, marks employee payment records reversed, restores advance recovery and commission eligibility, and returns the run to Approved. The original records remain in history. Record the corrected payment with a new request key.

Payment requests have immutable UUID keys. Identical retries have no extra effects; changed or reversed requests are rejected. Reversals target a specific original movement, so a late retry cannot undo a later corrected payment. Run and cash-account locks serialize concurrent operations; a partial unique index prevents two active cash payments for one run. Cash Desk and manual journal routes direct payroll corrections back to Payroll.

## Migration and boundaries

Apply `20260919160000_payroll_cash_connection` before deploying the API. It adds nullable source links and indexes without rewriting historical money records. Previously paid runs and legacy salary records are not automatically treated as connected cash transactions: reconcile their original evidence before migrating them. This release pays and reverses a whole run; partial employee disbursements and bank execution are not included.

Cash Desk entries and the mapped ledger are checked together. The legacy ERP `CashAccount.currentBalance` remains a separate cache and is not overwritten. Gross payroll expenses remain in the accrual; the net payment is a cash outflow, not a second expense.

## Evidence

The isolated authenticated API rehearsal covers purchase/payment/reconciliation, sale/collection, payroll payment, same-key concurrent retries, reversal, corrected payment, employee payment history, advance recovery, commission settlement, rejected role/account/currency requests, closed periods and insufficient-funds rollback. Run `node scripts/prove-release-workflows.mjs` against the guarded rehearsal environment described in [release readiness](../../releases/itemba-os-release-readiness.md).

Statutory rates and opening balances still require business sign-off. Local verification is not staging user acceptance or production deployment.
