# ITEMBA OS phase 4 — business workflow acceptance

20 September 2026. **Status: local business proofs pass; staging acceptance and release approval remain open.**

The rehearsal follows an operator action through an authenticated API, stored records,
cash entries, posted journals and the resulting report. It uses synthetic records in
the dedicated `itemba_release_proof` database on port 5549, Redis on 6399 and the
rehearsal API on 3114. The current API build was restarted for this pass. No working
business database, posted opening balances or production deployment was changed.

## Evidence from this pass

| Boundary                                           | Result                           | Evidence and limits                                                                                                                                                                                                                                       |
| -------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purchases, collections, payroll and reconciliation | 55 checks pass                   | Real authenticated API and PostgreSQL; duplicate requests, reversals, closed periods, insufficient funds, role restrictions and cash/ledger/report agreement. `.release/os-design/acceptance-workflows.log` and `.release/workflows.json`.                |
| Document exports and reads                         | 20 checks pass                   | Company letterhead; PDF, Word, text, Excel and CSV exports; upload/preview/original byte agreement; company and reader/writer restrictions. `.release/os-design/acceptance-documents.log`.                                                                |
| OS search → file preview/download                  | 11 checks pass                   | New repeatable proof covers company, division, branch, absent grants, source permissions, guessed IDs, company selection, bounded results and exact owner links against the real API. `.release/os-design/acceptance-search.json`.                        |
| Loans → schedules → cash and journals              | 51 assertions pass               | Separate disposable database; borrowing, opening recognition, fees, allocation, retries, reversals, intercompany entries and full cash/ledger equality. The owned database was removed after the run. `.release/os-design/acceptance-loan-lifecycle.log`. |
| Frontend/API route agreement                       | Pass                             | 945 literal calls checked against 1,404 routes; 71 dynamic call sites are outside this static check. All 12 validator tests pass.                                                                                                                         |
| Full backend regression                            | **Fail**                         | 4,172 passed, 17 failed across 414 suites. All 12 failing suites concern Msaidizi capability/evidence contracts. `.release/os-design/acceptance-backend-tests.json`.                                                                                      |
| Frontend regression and builds                     | Previous phase evidence retained | Phase 3 passed 2,071 frontend tests and both production builds. No application source changed in this acceptance pass. These are not represented as newly run CI or an immutable release candidate.                                                       |
| Browser interaction → rendered application         | **Pending**                      | The frontend preview is stopped. Automatic approval review previously rejected startup with only “blocked by policy”; no alternate startup was attempted.                                                                                                 |

The loan proof calls the actual financial services against PostgreSQL. It does not
exercise browser or HTTP authentication. The other transaction, document and search
proofs use real sign-in and API permission guards. None constitutes business-owner
sign-off or certification of the configured payroll reference rates.

## Concrete CI blockers

`npm run release:contracts-audit` now produces a read-only diagnostic with the exact
affected capabilities and request fields. It exits nonzero when contracts disagree;
it does not change permissions, exclusions, fixtures or signed evidence.

- The current manifest has 1,392 capabilities, of which 1,160 are discovery-eligible;
  1,064 have registered positive fixtures. The remaining **96** need reviewed evidence
  or an explicit policy decision. This count is not 96 failed business transactions.
- Four approval creation/update DTOs use conditional validation that the schema
  projector correctly treats as partial. Their previous strict fixture contracts
  cannot be assumed to remain valid.
- Loan creation fixtures lack `fundingMode`, `principalLedgerAccountId` and
  `requestId`. Scheduled repayment fixtures lack `allocationFingerprint`,
  `cashDeskAccountId` and `requestId`; direct repayment fixtures lack the latter two.
- Payroll payment fixtures lack `businessDate`, `cashDeskAccountId` and `requestId`,
  and still send the retired `disbursingChartOfAccountId` field.
- Read/mutation inventories, derived-report fixtures, audit/principal coverage and
  read-exclusion contracts also need review against changed routes. The document
  preview reads are correctly excluded for their persistent audit effects, but the
  pinned audited-read inventory has not yet been updated.

The next engineering pass must update the real seeded scenarios, scope denials,
review fingerprints and exact financial effects before updating inventories. Merely
increasing expected counts, weakening assertions or disabling suites would not
resolve these blockers. Full backend CI must then pass on the selected candidate.

## PDF export review

The refreshed [letter](../../.release/document-proof/letter.pdf) and
[supplier report](../../.release/document-proof/report.pdf) were read and rendered
with Poppler. Both are one-page documents. Their legal identity, reference, body/table
values and page footer are visible without overlap or clipping in the inspected
renders. The letter preserves `125,000.50`; the report preserves `125000.50` and
`12.25`. The spreadsheet-formula sample remains literal text in the PDF.

Render evidence and extracted text are in `.release/os-design/pdf-review/`.
Poppler emitted fallback-font warnings for Symbol and ArialUnicode; no missing
characters were observed in these supplied pages. This does not verify other scripts,
multi-page pagination, browser Print/PDF, native date controls or physical printers.

## Operator acceptance checklist

Run these on the selected staging candidate with approved test data. Use a company
finance operator, division supervisor, branch operator and read-only user; include
an inaccessible company, sibling branch and second division. Record the candidate,
user role, organisation scope, record/reference IDs, expected/actual result, date,
viewport/browser and evidence for each row. A pending row is not a pass.

| ID     | Operator journey                                                                                | Acceptance result                                                                                                                             | Current live status |
| ------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| UAT-01 | Apps → Invoice Desk → supplier invoice → reviewed posting → Cash Desk payment → supplier report | One purchase and payment; matching remaining balance and balanced journals; retry does not duplicate settlement.                              | Pending             |
| UAT-02 | Sales Desk → credit sale → reviewed posting → collection → customer report                      | One collection, correct customer balance, linked cash receipt and matching revenue/receivable entries.                                        | Pending             |
| UAT-03 | Reports → reconciliation → import statement → match → independent approval → close              | Cash, statement and ledger agree; the preparer cannot self-approve; closing preserves evidence.                                               | Pending             |
| UAT-04 | Payroll → employee run → HR approval → Finance approval → accrual → payment → payslip/report    | Independent approvals, paid employee records, cash and posted journals agree; correction preserves original history.                          | Pending             |
| UAT-05 | Loans & Debts → disbursement → schedule → reviewed repayment → correction                       | Principal, interest and fees are distinct; scheduled allocations match remaining balance; both intercompany sides agree.                      | Pending             |
| UAT-06 | Repeat reads and attempted writes across company/division/branch/read-only roles                | Allowed scope works; forbidden records and writes stay unavailable; stale data disappears after scope/account changes.                        | Pending             |
| UAT-07 | Ctrl/Cmd+K → Files → Quick Look → next/previous → Open record                                   | Correct file and owner, original download, focus returns to the query; financial forms retain keyboard control and unsaved work is protected. | Pending             |
| UAT-08 | Documents → letter/library → company branding → export; preview a contract or asset attachment  | Correct company letterhead, no duplicate upload, readable preview and original download, reader/writer permissions enforced.                  | Pending             |
| UAT-09 | Enter dates using the native picker and keyboard, including month boundaries                    | The saved business date equals the selected date in East Africa Time; period checks use the intended date.                                    | Pending             |
| UAT-10 | Browser print/PDF and original generated PDFs for invoices, reports and payslips                | Correct company identity and totals; no controls in print output, clipped columns, lost rows or broken multi-page headers/footers.            | Pending             |
| UAT-11 | Repeat critical journeys at 390px, tablet and desktop widths, 200% zoom and with keyboard only  | Readable lists/forms, reachable actions, predictable focus and scrolling; no trapped or obscured controls.                                    | Pending             |
| UAT-12 | Light/dark appearance, reduced motion, screen reader and error/retry states                     | Legible status/feedback, correctly announced dialogs and validation, no false success or stale values after failed requests.                  | Pending             |

Business owners still need to agree the opening date/data and payroll reference
rates. Staging access, operator sign-off, the selected immutable release contents
and operational cutover approval have not been recorded.

## Repeat the checks

With the isolated rehearsal dependencies and API already running:

```powershell
npm run release:workflows
node scripts/prove-document-workspace.mjs
npm run release:search
npm run release:contracts-audit
```

The workflow proof creates a fresh synthetic company fixture. Run it before the
document and search proofs, which consume that fixture. The contract audit currently
returns exit code 1 to preserve the outstanding CI gate. Private credentials, binary
exports and record-level evidence remain under the ignored `.release/` directory.
