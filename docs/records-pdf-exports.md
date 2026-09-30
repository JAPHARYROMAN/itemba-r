# Records PDF exports

Records provides PDF downloads for the combined home, daily overview, daily sales,
money out, categories, trash, notebook registers and individual records. Existing
debtor/creditor statements and the seven daily reports retain their PDF exports.
CSV and other report formats remain available where previously supported; the
Categories screen no longer offers exports of unrelated money movements.

## Behaviour

- Downloads use the existing company letterhead service, with group fallback for
  personal or cross-company registers.
- Register downloads include all matching authorised rows, regardless of the UI
  page. Daily overview uses the same default Finalized status as its summary.
- Notebook amounts remain separate by register and currency. Daily sales and
  money out retain separate currency totals. Records does not post these totals
  to accounting or cash accounts.
- Notes and receipt lists continue across pages without truncation. Empty
  results produce an explicit empty document.
- Limits: 10,000 notebook entries or 5,000 daily/category/trash records per PDF.
  Larger selections fail with a request to narrow filters, never a partial file.
- Categories use company and search filters. Trash exports all three deleted
  registers using company and search. Transaction filters do not apply to these
  company-level category selections.

## API

- `GET /records/export/pdf`: existing RecordsQuery filters; records.view and
  records.export permissions.
- `GET /records/:id/export/pdf`: individual notebook record; debts use the existing
  statement exporter. Same permissions as the register export.
- `GET /record-book/export/pdf`: type sales, expenses, combined, categories or
  trash; optional recordId for individual sales/expenses. Requires
  record_book.view and record_book.export. Uses existing authorised list/detail
  services and the existing export audit log.

All endpoints return application/pdf with no-store and attachment headers. No
database migration or additional environment variable is required.

## Verification

Backend tests cover authorisation scope, complete filtered selection, size limits,
currency totals, long notes, category selection, deleted records and letterhead
ownership. Frontend tests cover independent window filters, download feedback,
retry and disabled controls; existing Records acceptance and statement tests are
included in regression verification.

Run `node scripts/render-records-pdfs.cjs` from backend to generate five synthetic
visual fixtures under tmp/pdfs/records-exports. The script has no database or
network access and writes no business records.

The release contract audit currently reports eight unrelated existing fixture
issues in approvals, loans and payroll. This feature does not resolve those
release-wide acceptance gaps. Production deployment and live acceptance are
separate from this local implementation.
