# Connected loan lifecycle

New borrowings and repayments connect the loan register, Cash Desk and the ledger in a single database transaction. Open **Group Control → Loans & Debts** to record borrowing; the loan detail shows **Loan, cash and accounting**, linked journals and reversal actions. Scheduled payments remain in **Accounting Engine → Loan Repayments**. Intercompany lending and repayments remain in **Cash Desk**.

## Setup and recording

- Connect each participating Cash Desk account to its ERP cash/bank account and dedicated asset ledger under Reports → Accounting → Account connections. The company accounting currency must match. Posting requires an open accounting period, journal view/create/post and cash view/record permissions, plus company and organisation WRITE access. Reversals additionally require journal reversal permission.
- Choose **New borrowing** for money received now. Select the loan liability account and receiving Cash Desk account. Fees withheld at drawdown debit the selected expense account; cash increases by net proceeds while principal increases by the full borrowing.
- Choose **Opening loan** to recognize an existing outstanding principal not already in the ledger. The selected opening equity account is debited and the loan liability credited. This creates no cash movement. Original principal and original disbursement date remain available, while reporting begins with the recognized remaining principal on the recognition date.
- Principal, cash identity, company and posted amounts cannot be edited through the loan register. Descriptive edits lock the loan and never write its financial balances. Settlement is derived from payments; cancellation uses a linked reversal.

## Schedules and payment allocation

Generated schedules use the annual decimal rate (0.18 means 18%) and the selected repayment frequency. Principal rounds to two decimal places, with the final installment taking the exact remainder; month-end due dates are clamped to valid dates. Bullet/other interest uses actual days divided by 365. Regular schedules use equal periodic rates; irregular lender terms should be entered as reviewed custom installments. The schedule is a projection: it does not accrue interest automatically in the ledger.

A scheduled payment is allocated proportionally across **remaining principal, interest and fees**, using integer cents and largest remainders. It is not allocated using the original ratio after earlier payments. The server shows the exact allocation before saving. A fingerprint prevents submitting an allocation after another payment has changed it. Overpayments, even one cent, are rejected. Once schedules exist, payments must use an installment rather than the separate ad hoc payment form.

Ad hoc payments explicitly separate principal, interest, fees and penalties. Only principal reduces the loan balance. Interest, fees and penalties debit the chosen expense accounts when paid; cash is credited by the complete payment. A stable request ID makes identical retries safe. Loan row locks serialize concurrent payments.

## Intercompany movements and corrections

Lending creates a receivable and cash credit for the lender, and cash debit and a liability for the borrower. Both companies must belong to the same group, use matching accounting currency and be writable by the actor. Repayments reduce principal on both sides; interest and fees credit lender income and debit borrower expenses. Both journals and both cash movements either commit or roll back together.

Reverse external borrowing/payments from the loan's financial history. Reverse intercompany movements from Cash Desk. Reversal restores the relevant principal and installment balance and posts opposite cash/journal entries. Originals remain visible. Reverse active repayments before cancelling recognition; a recognition reversal cannot predate later loan events. Direct manual journal reversal and generic Cash Desk reversal are blocked for connected external-loan events.

Financing reports use dated financial events, including reversals, to reconstruct principal at the selected date. Intercompany balances eliminate principal only when both sides are in the selected accessible scope. Loan reviews compare linked principal, cash and journal evidence and flag mismatches.

## Historical records and limits

The additive migration marks existing loans as LEGACY without inventing cash receipts or journals. Unlinked historical loans and scheduled payment allocations require accounting review before further posting. There is no automatic historical backfill. Foreign exchange, automatic interest accrual, restructuring, write-offs, multi-drawdown facilities and tax treatment of finance charges are outside this workflow. Cash Desk balances still require bank/physical-cash reconciliation; matching loan records alone do not prove bank reconciliation.

## Verification

`npm --prefix backend run test:loan-lifecycle` creates its own disposable database on the configured **local** PostgreSQL server, applies the actual loan migration, runs the lifecycle proof and drops that database. It never resets or seeds the application database. The proof checks drawdown fees, opening recognition, partial scheduled payments, fees, final settlement, exact generated principal, month ends, duplicate and concurrent requests, access denial, closed-period rollback, reversals, historical balances and paired intercompany postings. Every mapped Cash Desk balance is compared with its entry sum and posted ledger balance.

Verified locally on 2026-09-19: 116 targeted backend tests and 22 frontend tests passed, plus 51 assertions against a disposable PostgreSQL database using the actual additive migration. Backend build, frontend TypeScript, focused frontend lint, Prisma validation, migration-safety and DTO-contract checks passed. Local API health returned 200 after restart. Browser review covered borrowing/organisation controls and custom installments without creating business records. The application database still contained zero loans, loan events, schedules and intercompany loans after verification.

The broad frontend/backend route-contract scanner reports 18 unrelated route patterns (31 call sites), predominantly in existing HR workspaces; none are loan-lifecycle calls. This is not a claim that the entire application is ready for release. Account mappings and appropriate company WRITE access are prerequisites for real posting.
