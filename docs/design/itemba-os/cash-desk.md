# Cash Desk

Cash Desk is an ITEMBA OS app at `/cash-desk`. It shares the existing company → division → branch directory, supplier profiles and purchase invoices. Its own cash ledger also connects business payments to their existing payables, cash accounts and accounting journals.

## Expense management

Open **Cash Desk → Expenses** to manage expenses already paid. Record the paying account, amount, date, category, payee, description, receipt/payment reference and optional supporting notes. The expense uses the account's company, division, branch and currency, and reduces its balance in the same audited transaction. Account choices identify their branch to distinguish tills with the same name.

The register supports inclusive date ranges (current month by default), account, category, paid/reversed status and search by payee, description, reference or notes. Summaries cover all filtered records across pages, separate currencies, and show paid amounts, reversed amounts, record counts and category totals. Paid category totals exclude records currently reversed; this is the current status of expenses dated in the selected period, not a historical cash-flow statement. Earlier expenses without category metadata remain visible as Uncategorized.

Open an expense to inspect its details and reverse a mistake with a reason. Reversal restores the cash balance and retains the original payee, category and notes. Record a corrected replacement afterward. For supplier invoices already in Invoice Desk, use **Supplier balances → Record payment** to avoid duplicating the cost and keep the invoice balance correct. This release covers paid expenses; claims, expense approvals, unpaid expense accruals and receipt-file uploads are not included.

Expense migration: `20260918180000_cash_desk_expenses` adds nullable metadata to existing cash movements without changing existing amounts or ledger entries. The disposable PostgreSQL test now also verifies category/payee persistence, legacy records, filtered reports, currency separation, organisation isolation and expense reversals. Frontend tests cover expense entry, reporting, scoped filters and error states.

## First use

1. Open Apps → Cash Desk → Accounts → New account.
2. Choose its company, division and branch, then enter the name, currency, opening date and actual opening balance. Supported account types are cash, bank and mobile money.
3. Record the daily sales received into each account. There is one sales total per account per business date; reverse a mistaken total and enter its replacement.
4. Record expenses, other receipts, same-company account transfers, or intercompany loans. Lending requires write access to both companies/accounts and matching currencies within the same group.
5. Use Intercompany to record repayments against the original loan. The remaining principal updates with each repayment.
6. Use Supplier balances to choose an invoice and record payment from a same-company, same-currency account. Cash and invoice balances change in one transaction. Invoice Desk identifies linked payments and directs their management to Cash Desk.

The date selector changes daily sales totals; account balances are explicitly labelled **now**. Money is grouped by currency, never added across currencies. Dates follow East Africa Time. Supplier balances are available even without creating duplicate suppliers here.

## Purchases in Movements

Choose **Cash Desk → Movements → New movement → Movement type → Purchases** to record money already paid against an existing supplier purchase or invoice. Select the paying account, the shared supplier profile and the unpaid document, then enter the amount, transaction date and payment reference. Partial payments are allowed up to the document's outstanding balance. This records the payment against the existing purchase; it does not receive the goods again or create a second purchase cost.

For a business purchase, the paying Cash Desk account must be connected to its existing business cash account and ledger. Saving settles the selected payable, updates the linked supplier invoice and supplier balance, posts the payment journal and reduces both cash balances in one transaction. The movement retains links to the supplier, payable, supplier invoice, purchase order and payment journal where those records exist. It updates Cash Desk even when automatic mirroring of other ERP payments is disabled.

Invoice Desk invoices remain available through their existing payment workflow. Their invoice balance, shared supplier payment history and Cash Desk balance change together; their accounting connection retains its existing posting workflow. Supplier and document choices must match the paying account's company and currency and the operator's access. Changing the account or supplier clears a document selection that must be chosen again.

Movement history and its type filter show these payments as **Purchases**, including earlier supplier payments. Existing records retain their `SUPPLIER_PAYMENT` identity. A retry with the same saved request cannot pay a document twice; changing an acknowledged request requires a new movement. Correct a mistake through the linked reversal workflow so the cash, outstanding balance and posted payment journal are restored together, retaining the original records and reason.

## Record integrity

Sales Desk payments now create linked **Sale receipt** movements. Daily sales lists and totals include these receipts. A manual daily-sales total cannot be mixed with individual Sales Desk receipts for the same account and date; reverse the manual total before switching that day's receipts. Reversing a linked receipt restores the customer's outstanding balance atomically and requires Sales Desk payment access as well as Cash Desk reversal access.

- Decimal amounts and signed ledger entries; account balances reconcile to the sum of their entries.
- Transfers and loans produce matching debit/credit entries in one transaction and do not count as sales.
- Concurrent account updates use version checks. Duplicate request references cannot create duplicate movements; reusing a reference with changed inputs is rejected.
- Withdrawals must leave nonnegative daily closing balances, including when backdated. No future movements or movements before the account opening date.
- Reversals preserve the original record and append compensating entries with actor, date and reason. Linked invoice payments reverse in the same transaction. Direct Invoice Desk reversal of a cash-linked payment is rejected.
- Active repayments must be reversed before reversing their original loan. No repayment beyond remaining principal.
- Company and organisation scopes govern reads and writes. Movement entries only expose accessible accounts. Loan counterparties identify the two companies, but do not expose the counterparty account balance.
- Strict audit writes are part of the transaction; audit failure rolls the financial change back.

## Permissions and boundaries

`cash_desk.view`, `cash_desk.manage`, `cash_desk.record`, `cash_desk.reverse`. Initial migration grants these only to the existing Group Super Admin role; administrators can assign appropriate access. Purchases entry uses `suppliers.view` for the shared supplier picker. Business purchase payments and reversals require `payables.view`, `supplier-payments.view` and `supplier-payments.manage`; Invoice Desk payments require `invoice_desk.view` and `invoice_desk.payments`. Existing company and organisation write/management rules still apply. Enrolled Cashier and Stockist identities cannot use this office payment path to bypass POS approval.

Cash Desk records movements already made. It does not send bank/mobile money payments, sync bank statements or convert currencies. Business purchase payments post their existing payable's settlement journal immediately; Invoice Desk payments retain the separate Accounting connections workflow. Existing payments entered directly in Invoice Desk are not retroactively assigned to cash accounts. Account names/currencies/scope remain fixed after creation.

## Verification

- Purchases update: 84 focused backend tests, 40 Cash Desk frontend tests and 29 accounting-draft regression tests passed, with both type checks and the backend production build. The expanded isolated compiled proof passed 51/51 POS and finance checks, including payment/reversal retries, both cash-book flags, strict-audit and closed-period rollback, linked supplier/invoice/order balances and POS staff confinement. Exact committed-source CI and deployment evidence are recorded separately.
- Backend ledger/permission and Invoice Desk regression tests: 34 passing.
- Frontend and OS/app registry tests: 30 passing. Coverage: access gating, currency separation, exact display, shared invoice permissions, retry references, supplier invoice/version linkage, plus existing Invoice Desk and app registry checks.
- `backend/scripts/test-cash-desk.cjs`: actual PostgreSQL lifecycle in a uniquely named disposable database. Verifies ledger reconciliation, scope isolation, duplicate sales, correction, concurrent overspending, loans/repayments, invoice/cash atomicity and strict-audit rollback. The test creates no business records in the configured application database.
- Backend and frontend production builds; live desktop/mobile checks for empty state, organisation choices and unsaved form protection.
- Additive migration: `20260918160000_cash_desk`.
