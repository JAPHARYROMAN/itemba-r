# Group Health

Open Reports → Group Health (`/reports?view=health`). The screen combines permission-scoped Sales Desk, Invoice Desk, Cash Desk and ERP borrowing. Source apps retain ownership of loans and payments; reports never create financial transactions.

## Position and outlook

Balances use the selected To date; From/To selects repayment history. Future balance dates are blocked in the UI. Currency amounts remain separate and use exact decimals. The 7/30/90-day windows include overdue amounts and overlap. They combine recorded supplier invoices, external loan instalments and one-sided intercompany repayment obligations. Payroll, tax, operating costs, unscheduled loans and expected collections are not forecast. Source failures and missing access remain visibly unavailable.

Intercompany principal is eliminated once only when both accounts are inside the selected accessible scope. A company or branch view retains its side. Counterparty names outside the reader's access are masked. These eliminations do not cover trading, interest, foreign exchange or ownership adjustments. ERP supplier-credit and intercompany records remain visible but are excluded from external-debt totals to avoid overlap. Matching duplicates across registers remains a reconciliation task.

Group-level loans appear only for group roles with no company/division/branch filter. Each source uses a repeatable-read database transaction, scoped queries and 20,000-record limits. Sources are independently read; their generation times are shown. ERP financing requires both `loans.read` and `loan_schedules.list`, with sensitive-access auditing. Intercompany reports require `cash_desk.view`.

## Loan accounting

Historical principal bridges backwards from the current loan register by adding later recorded principal repayments. Direct repayments use their stored split; legacy null principal follows the existing full-principal rule. Scheduled payments obtain principal from their linked posted journal and resolved principal-payable account. Missing allocation, currency discrepancies, negative balances, missing schedules and exceptional loan statuses trigger reconciliation checks. Unknown historical amounts are not rendered as zero.

Unscheduled loan repayments now validate the principal/interest/penalty split, currency, calendar date and remaining principal. The saved allocation drives the existing journal posting. Principal overpayment is rejected instead of silently clamped. Existing scheduled-payment allocation is unchanged; ERP payments are not copied into Cash Desk.

## Boundaries and verification

This is a provisional management view, not a complete consolidated financial statement. Cash Desk balances are not verified unrestricted bank cash. Profit, payroll/statutory obligations, inventory/assets, bank reconciliation, full cash forecasting and locked historical snapshots are not integrated into this view yet. Later corrections and status changes can restate earlier reports. These boundaries are visible in the UI and exports.

Automated coverage includes exact decimals, historical repayments, principal/finance-charge separation, duplicate-register exclusion, intercompany elimination, access masking, scope/permission retention, cumulative commitments, source availability and future-date handling. Repayment tests verify the stored split and journal agree and overpayments write nothing. Live verification reads existing records only.
