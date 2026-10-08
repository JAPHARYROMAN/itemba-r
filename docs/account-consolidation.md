# Account consolidation

Transaction registers now start with one row per party, company and currency. Select the account to see its underlying transactions, then select a transaction to inspect its ID, document number, dates, amounts and available actions. Existing full-detail screens, statements, payments and approval controls remain the authority for each document.

## Coverage

Consolidation is the default for Finance payables and receivables (also reached through Cash Desk), Sales Desk business sales / sales orders, purchase orders, supplier order drafts, supplier invoices, expenses, credit notes, quotations, proformas, Group Control loans and debts, direct Sales Desk sales, direct Invoice Desk invoices, Records Book Money Out by recipient, and the independent Notebook debtor, creditor, sale, purchase and expense registers. Customer and supplier master lists already contain one row per registered party and keep their existing connected profiles and balance resolvers.

The individual transaction view remains available. Notes and operational records without an account balance keep their existing views. Financial document totals are shown within their own register: an order, its supplier invoice and its payable are not added together as three liabilities. Quotation, proforma, expense, draft and credit-note account views show recorded totals rather than implying an unpaid liability. Unpriced draft lines are identified on their documents.

Purchase orders show their payment totals without treating an expected delivery date as a payment due date. Loan account totals show principal and outstanding principal; repayment and interest details remain in each loan's payment history.

## Identity and totals

- Transactions keep their existing immutable database IDs and document numbers. This feature needs no migration or renumbering.
- Registered parties group by their ID. Direct desk aliases use the canonical customer/supplier ID when present in their existing API response.
- Legacy name-only entries group by trimmed, case-insensitive names with repeated whitespace removed. They remain separate from registered parties until explicitly linked. Different registered parties with the same name never merge.
- Companies and currencies stay separate; no exchange-rate conversion is implied. Private Notebook entries also remain separate by owner and register kind.
- Cancelled or voided documents remain inspectable and contribute zero to active money totals.
- Existing company, organization and permission checks remain in place; consolidation applies to records the caller can already read. Search, status, date and scope filters define the matching documents in the account total.

## Implementation and verification

AR/AP account endpoints, sales/purchase order list requests with `view=accounts`, and Notebook list requests with `view=accounts` aggregate the complete authorized result before account pagination. Backend totals use Prisma Decimal arithmetic. Supporting registers reuse their existing paginated APIs and accumulate integer cents after every matching page has loaded. A later-page failure, duplicate page or invalid amount produces a recoverable error rather than a partial account total. Requests are aborted on scope changes and unmount; the displayed result must match the current filters and refresh revision.

The shared interface uses the app's table, buttons and record inspector, with keyboard-operable account selection and transaction actions. Tests cover seven transactions under one account, exact monetary arithmetic, company/currency/identity isolation, private-owner separation, cancelled documents, account pagination, complete multi-page loading, later-page failure and retry, and existing read-only/action-confirmation behavior.

The current aggregation loads matching documents into memory; supplementary registers make sequential page requests. Very large registers will take longer to consolidate. A database aggregation plus a separately paginated account-detail API can replace this implementation without changing the account/transaction interface.
