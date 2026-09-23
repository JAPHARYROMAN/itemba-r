# Sales Desk

Sales Desk is an independent ITEMBA OS app at `/sales-desk`, available from Apps. It shares the existing company → division → branch structure and receives customer payments through Cash Desk. Its customers and sales are separate from core ERP customers, sales orders and receivables.

## Everyday flow

1. Open **Customers** and create a customer for the selling company.
2. Choose **New sale**. Select the organisation, customer, dates and currency; enter goods or services, quantities and final agreed unit prices.
3. Save the sale. Open its details and choose **Record payment** when money has been received. Select a Cash Desk account in the same company and currency.
4. Use **Overview** for sales, money received, outstanding and overdue amounts; use **Sales** to search by customer, sale number or item and filter by date or payment status.

Credit sales increase customer balances without increasing cash. Partial payments reduce what the customer owes. Each payment adds a linked receipt to Cash Desk in the same database transaction. Different currencies are always summarized separately. Overview covers all recorded history in the selected organisation scope; date filters apply to the sales register. Business dates use East Africa Time.

## Corrections and duplicate protection

- Reverse a linked receipt in Cash Desk to restore both the cash balance and customer balance together. Sales payment rights and write access to both the sale and cash account are required.
- Void an unpaid sale with a reason. A sale with payments must have those payments reversed first. History remains visible.
- Saved sales are not edited in place; void and replace an incorrect sale. Posted records are never deleted through this app.
- A manual Cash Desk daily-sales total and individual Sales Desk receipts cannot coexist for the same account and date. Reverse the manual total before switching that day's account receipts to Sales Desk. If that total included other receipts, record those individually in Sales Desk too, so the replacement remains complete.
- Retrying an identical sale or payment submission returns the original record. Changed payloads cannot reuse the same request ID. Concurrent changes are rejected with a refresh instruction.
- Amounts use exact decimal arithmetic, with half-up rounding per line. Database checks enforce positive amounts, valid balances and due-date order. Auditing, sale balances and cash entries commit or roll back together. Cash reversal cannot create a negative historical daily closing balance.

## Access and first-phase boundaries

`sales_desk.view` opens the app, `sales_desk.manage` creates customers/sales and voids sales, and `sales_desk.payments` records or reverses receipts. Recording also needs `cash_desk.view` and `cash_desk.record`; reversal uses Cash Desk's existing reversal permission. New permissions initially belong only to the group super administrator. Company and organisation scope checks still apply.

This phase deliberately has three sections: Overview, Sales, Customers. Prices include any tax or discount already agreed; there is no tax calculation engine. There is no CRM pipeline, quotation workflow, stock deduction, tax-invoice generation, return/credit-note workflow or bank transfer execution. Receipt entry records money already received. Customers are company-level; sale balances are division/branch scoped. Customer edits and exports can be added in a later phase.

## Verification

- Backend unit coverage: decimal and fractional-quantity calculations, limits, route permissions; existing Invoice Desk and Cash Desk suites.
- `backend/scripts/test-sales-desk.cjs`: disposable PostgreSQL lifecycle exercising exact totals, scope isolation, partial payments, idempotency, concurrency, overpayment rejection, receipt reversals, insufficient cash rollback, manual daily-total conflicts, voiding, audit rollback and ledger consistency.
- Existing Cash Desk disposable PostgreSQL proof covers supplier balances, expenses and intercompany flows after the integration.
- Frontend tests cover permission gating, separate currency summaries, read failures, sale line previews, request retry IDs, receiving-account currencies and payment/void controls.
- Local migration: `20260918200000_sales_desk`. Browser verification uses read-only screens and unsaved form drafts; no live test financial records are created.
