# Sales Desk collections in Cash Desk

Cash Desk's **Sales collections** view reads the original business sales, receivables,
customer payments and cash accounts now hosted in Sales Desk. Opening a sale preserves its
canonical `/sales-desk/sales/:id` link. Collecting a payment uses the existing receivable
settlement transaction, updating the sale, customer balance, receipt account and journal.

This is a live projection, not a migration or a second posting. It never inserts a
`CashDeskMovement` for an already recorded business receipt. Desk accounts and Direct entries
remain separately labelled; their balances are not added to business account balances.

- Business account balances are current balances, grouped by currency.
- Outstanding sales include open, partially paid and overdue receivables from confirmed sales.
- The selected accounting date shows posted cash-sale journals, receivable settlements and
  completed customer-payment allocations to the visible sales. COGS, write-offs, advances,
  reversed receipts and duplicate representations of the same payment are excluded.
- Old receivable settlements did not retain a receipt-account reference. These display the
  original posting reference and explicitly show that the account is unavailable; no account
  attribution is invented.
- Read access requires Cash Desk, sales and receivables permissions. Account balances and
  complete receipt history additionally require the existing cash-account and customer-payment
  viewing permissions. Collection requires `receivables.manage`; company and branch write scope,
  account custody and matching currency are checked on the backend.
- The projection uses a repeatable-read snapshot. More than 10,000 source records requires a
  narrower organisation selection rather than silently truncating totals.
- Open Cash Desk and Sales Desk windows refetch through their authorised endpoints after
  changes. Refresh is deferred while the receiving window has an active form.

Verification: backend/frontend focused suites plus `node backend/scripts/test-sales-cash-connection.cjs`.
The latter creates a unique disposable local PostgreSQL database, exercises real settlement,
reversal, scope protection and journal/account agreement, and removes that database afterward.
