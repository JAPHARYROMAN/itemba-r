# Sales Desk

Sales Desk is the ITEMBA OS home for customers and sales at `/sales-desk`, available from Apps. The default Customers and Sales sections now use the existing Operations customer and sales-order records, including POS sales. This is a workflow migration: there is no data copy, balance backfill or second accounting entry.

## Connected business records

- **Customers** (`/sales-desk/customers`) uses `/customers`, including existing balances, ledgers, statements and edit permissions.
- **Sales** (`/sales-desk/sales`) uses `/sales-orders`, including existing lines, customer links, receipts, stock movements, journals and audit history. The initial date range includes all history; users can narrow it explicitly.
- The overview reads the existing customer and sales workbench summaries. Customer and sales access are evaluated independently. It shows counts, rather than adding monetary amounts across currencies.
- `/operations/customers` and `/operations/sales-orders`, their detail pages and sales print links remain valid and open in Sales Desk. Record IDs are unchanged. Newly generated links use `/sales-desk/customers/:id` and `/sales-desk/sales/:id`.
- Existing `customers.*`, `sales.*`, organisation and payment permissions remain authoritative. Either `customers.view`, `sales.view` or `sales_desk.view` allows opening the app, but does not grant access to the other sections.
- Search, date/status/scope filters and page positions belong to each desktop window. Named desktop sessions persist only the allowlisted view settings; business forms keep using the existing draft facilities.

The former independent Sales Desk register remains under **Direct entries**. Its customers and sales are not automatically merged into Operations records: that would require reconciling identities, receipts and posted balances. Existing `/sales-desk?record=…` links continue to open that register. `source=direct` keeps navigation within it. No historical direct entries are deleted or hidden.

## Direct entries

Direct entries shares the existing company → division → branch structure and receives customer payments through Cash Desk. Its customers and sales remain separate from the connected business register. The following rules apply specifically to Direct entries.

### Everyday flow

1. Open **Customers** and create a customer for the selling company.
2. Choose **New sale**. Select the organisation, customer, dates and currency; enter goods or services, quantities and final agreed unit prices.
3. Save the sale. Open its details and choose **Record payment** when money has been received. Select a Cash Desk account in the same company and currency.
4. Use **Overview** for sales, money received, outstanding and overdue amounts; use **Sales** to search by customer, sale number or item and filter by date or payment status.

Credit sales increase customer balances without increasing cash. Partial payments reduce what the customer owes. Each payment adds a linked receipt to Cash Desk in the same database transaction. Different currencies are always summarized separately. Overview covers all recorded history in the selected organisation scope; date filters apply to the sales register. Business dates use East Africa Time.

### Corrections and duplicate protection

- Reverse a linked receipt in Cash Desk to restore both the cash balance and customer balance together. Sales payment rights and write access to both the sale and cash account are required.
- Void an unpaid sale with a reason. A sale with payments must have those payments reversed first. History remains visible.
- Saved sales are not edited in place; void and replace an incorrect sale. Posted records are never deleted through this app.
- A manual Cash Desk daily-sales total and individual Sales Desk receipts cannot coexist for the same account and date. Reverse the manual total before switching that day's account receipts to Sales Desk. If that total included other receipts, record those individually in Sales Desk too, so the replacement remains complete.
- Retrying an identical sale or payment submission returns the original record. Changed payloads cannot reuse the same request ID. Concurrent changes are rejected with a refresh instruction.
- Amounts use exact decimal arithmetic, with half-up rounding per line. Database checks enforce positive amounts, valid balances and due-date order. Auditing, sale balances and cash entries commit or roll back together. Cash reversal cannot create a negative historical daily closing balance.

### Access and boundaries

`sales_desk.view` opens the app, `sales_desk.manage` creates customers/sales and voids sales, and `sales_desk.payments` records or reverses receipts. Recording also needs `cash_desk.view` and `cash_desk.record`; reversal uses Cash Desk's existing reversal permission. New permissions initially belong only to the group super administrator. Company and organisation scope checks still apply.

This phase deliberately has three sections: Overview, Sales, Customers. Prices include any tax or discount already agreed; there is no tax calculation engine. There is no CRM pipeline, quotation workflow, stock deduction, tax-invoice generation, return/credit-note workflow or bank transfer execution. Receipt entry records money already received. Customers are company-level; sale balances are division/branch scoped. Customer edits and exports can be added in a later phase.

## Verification

- The business workflow migration requires no Prisma schema or data migration. Existing `/customers` and `/sales-orders` services remain the source of truth.
- Route tests cover legacy/canonical record identity, original direct-entry links and print routes. Workspace tests verify the original customer source, permission boundaries and separate Sales filters across two windows and remounts.
- The Operations acceptance, customer profile, order workspace and print suites exercise the extracted business components. Workspace validation rejects private fields and cross-app routes in persisted view settings.

- Backend unit coverage: decimal and fractional-quantity calculations, limits, route permissions; existing Invoice Desk and Cash Desk suites.
- `backend/scripts/test-sales-desk.cjs`: disposable PostgreSQL lifecycle exercising exact totals, scope isolation, partial payments, idempotency, concurrency, overpayment rejection, receipt reversals, insufficient cash rollback, manual daily-total conflicts, voiding, audit rollback and ledger consistency.
- Existing Cash Desk disposable PostgreSQL proof covers supplier balances, expenses and intercompany flows after the integration.
- Frontend tests cover permission gating, separate currency summaries, read failures, sale line previews, request retry IDs, receiving-account currencies and payment/void controls.
- Local migration: `20260918200000_sales_desk`. Browser verification uses read-only screens and unsaved form drafts; no live test financial records are created.
