# Reports app

Reports is available in ITEMBA OS Apps at `/reports`. The home screen combines permitted Sales Desk, Invoice Desk and Cash Desk figures, with drill-downs into supporting reports. The existing catalog remains at `/reports/library`; `/reports/run` and `/reports/scheduled` are preserved. Specialist inventory, payroll, finance and ERP reports remain available through permission-filtered shortcuts.

## Everyday reports

- Business overview: sales, customer debt, purchases, supplier debt, paid expenses and closing cash; combined company/division/branch performance without presenting sales minus purchases as profit.
- Customers and suppliers: opening balances, period invoices and payments, closing balances, individual statements, payment history, outstanding invoices and ageing buckets through 90+ days. Invoice drill-downs open the current source record in a read-only dialog.
- Sales and purchases: invoice registers, branch breakdowns, monthly trends and comparison with the immediately preceding period of equal length.
- Expenses: paid spending by category, payee and branch, detailed expense records and monthly trends.
- Cash: account opening balances, inflows, outflows, closing balances and a signed cash book with running balances. Transfers are cash movements, not revenue.
- Intercompany loans retain the existing source report and complete paginated export.

Company, division, branch, period, currency and counterparty filters are reflected in the URL. Selecting a parent resets dependent filters. Dates use explicit Apply with calendar validation and presets. Currency amounts are never combined or converted. Saved views store filter URLs only, separately for each account in this browser; they do not sync between devices.

## Calculation and access boundaries

Read-only `/desk-reports/sales`, `/desk-reports/purchases` and `/desk-reports/cash` endpoints retain the source permission and accessible organisation scope. Each source report reads inside a repeatable-read database transaction. The combined overview reads its three sources independently, not as one cross-source snapshot. No schema migration, financial posting or new permission is introduced.

Trade opening balances include earlier invoices less earlier payments. Period payments include receipts/payments against older invoices. Closing balances and ageing are reconstructed through the selected period end from currently valid invoices and unreversed payments. Later voids, reversals and edits restate earlier periods: these reports are not locked historical ledgers. Expenses likewise reflect currently valid expense records; the cash book retains all signed entries, including reversals. The UI and exports state these bases explicitly.

Sales Desk and Invoice Desk are separate from older ERP receivable/payable records; the overview does not silently consolidate them. All money calculations use backend decimals and preserve decimal strings in display and CSV. A source failure displays an error rather than a zero balance.

Reports allow periods up to ten years and reject oversized reads above 20,000 documents, payments or cash entries per source query. Earlier activity needed for opening balances counts toward the limit. Narrow the organisation or counterparty when required; results are never silently truncated.

## Output and verification

Tables support searching, sorting and pagination. CSV and Print / PDF include all matching rows in the chosen table, not only the visible page. CSV includes scope, period, source, generation time and calculation basis; statements also include opening and closing balances. Spreadsheet formulas are neutralised. Intercompany loan exports retain their existing 10,000-row pagination limit and changing-data checks.

Automated coverage includes balance reconciliation, older-invoice payments, ageing boundaries, reversals, transfers, exact decimals, scoped reads, permission guards, date validation, drill-downs, saved views, complete exports and source errors. Live checks are read-only and do not create business records.
