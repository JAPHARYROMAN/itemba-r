# Records

Records is an independent notebook for debtors, creditors, sales, purchases, expenses and free-form notes. Its entries, settlements and history use their own tables. It never creates ERP customers, suppliers, stock movements, cash movements or journals.

## Access and organisation

An entry without a company is visible only to its creator. A company-linked entry is shared with users who have `records.view` and access to its company/division/branch. Creating, editing, settling, reversing and voiding also require `records.manage` and WRITE access to its scope. CSV export requires `records.export` and uses the same record visibility rules as the screen. The additive migration grants the new capabilities only to the existing group super administrator; other roles can be assigned these capabilities explicitly.

Organisation links are optional and use the existing directory. The company/division/branch hierarchy is validated. Branch-scoped users must choose their allowed branch when linking records. The register, currency and organisation become fixed after creation; correcting these requires voiding the original and creating a replacement.

## Registers

- Debtors: original amount owed to you, due date, collections and outstanding balance.
- Creditors: original amount you owe, due date, repayments and outstanding balance.
- Sales, purchases and expenses: independent dated monetary records with a party, category, reference, contact and notes. They do not create debt records automatically.
- Notes: useful text without a monetary amount.

Balances use decimal arithmetic. Settlements record payments already made; they do not execute a transfer. Partial settlements are supported. A settlement can be reversed with a reason. Voiding requires no active settlements and preserves the entry and activity history. Summary figures follow filters, exclude voided entries by default and never combine currencies or imply group profit/cash balances.

## Desktop and forms

Records appears in Apps and runs as an explicit independent desktop host. Multiple windows own separate filters and navigation. Allowlisted view settings participate in the existing account session layout; form contents never enter layout snapshots or browser storage. Canonical record URLs use `/records?view=debtors&record=<uuid>`.

Forms retain in-memory inputs while open and warn before abandoning edits. This first release does **not** register automatic server draft recovery for Records. Save before closing or refreshing. Creation and settlement requests retain a unique request identity for retries; uncertain network outcomes freeze the original request for a safe retry. Changes also use optimistic versions, so competing windows cannot silently overwrite a balance.

## API and storage

`/records`: list/create; `/records/:id`: detail/update; `/records/directory`; `/records/summary`; `/records/export`; `/records/:id/settlements`; `/records/:id/settlements/:settlementId/reverse`; `/records/:id/void`.

Migration: `20260925110000_records`. Tables: `record_entries`, `record_settlements`, `record_events`. Includes foreign keys, amount/date/hierarchy constraints and new permission definitions. No existing business tables or data are rewritten.

CSV register export includes all matching records across pages (maximum 10,000; narrow the date range for larger registers). It quotes cells and neutralises spreadsheet formula prefixes. Attachments, imports, approvals and accounting connections are outside this scope.

## Statements and partial payments

Each debtor or creditor record has its own dated account statement, with opening balance, debit, credit, running balance and closing balance. Debtor charges are debit and receipts credit; creditor charges are credit and payments debit. These are independent party statements, not a balanced general ledger or a combined account across similarly named records. Currencies and organisation scopes are never merged.

Use **Receive payment** for a debtor and **Pay creditor** for a creditor. Enter the amount actually received/paid; the form previews the remainder. **Use full balance** fills the amount when settling completely. Amounts must be positive and cannot exceed the outstanding balance. These actions record payments already made, rather than moving actual money. Discounts and write-offs are not implicit in a smaller payment.

`GET /records/:id/statement?from=&to=` returns the statement. `GET /records/:id/statement/export?format=pdf|csv&from=&to=` exports exactly that date range under `records.view` + `records.export` and current record visibility. PDF uses the shared company/branch letterhead renderer, with Itemba Group fallback, without creating an ERP document transaction. Its PDF can be printed through a normal PDF viewer. CSV includes the party, record identity, scope, currency and balances; formula prefixes are escaped.

Migration `20260925160000_record_statements` adds `record_postings` and `statementStartsOn`. New debt creation, payments, reversals, amount corrections and voids append immutable movements within the same transaction/version lock as the balance and audit event. A reversal remains visible on its reversal date. Amount corrections appear as today's adjustment; debt dates are fixed. Payment dates cannot precede the latest statement movement, avoiding historical overpayments. Idempotent settlement retries never append a second movement.

Existing debt records receive an explicitly labelled opening-balance snapshot at migration. Earlier mutable history cannot establish trustworthy historical debt amounts, so statements cannot predate this cutover. The existing payment and activity history is preserved. Previously fully paid or voided records start at zero. New records retain complete statement history from creation.

## Verification commands

Backend: `npm run build`, `npm test -- modules/records/records.spec.ts modules/records/records.statement.spec.ts modules/workspace/workspace.validation.spec.ts`, then `npm run test:records`.

The integration proof creates a uniquely named disposable database on the configured local PostgreSQL server and removes only that database. It tests owner privacy, branch sharing, write access, hierarchy checks, decimals, idempotency, simultaneous repayments, reversals, stale edits, rollback on audit failure, currency separation, CSV safety and absence of writes to ERP financial tables.

It also proves partial/full debtor and creditor payments, statement direction, period opening/closing balances, preserved historic reversals, atomic statement rollback, scoped exports and migration snapshots. `node scripts/render-records-statement.cjs` creates a synthetic multipage PDF in `tmp/pdfs` for visual review without any database writes.

Frontend: `npx vitest run src/features/records/records.test.tsx src/lib/desktop-view-state.test.ts src/lib/apps.test.ts src/components/workspace/desktop-recovery.test.tsx`, `npm run build`.

## Verified locally — 25 September 2026

- Backend and frontend production builds passed; changed app files passed ESLint. The final frontend build generated 211 static pages. Backend health reported database up.
- 25 focused backend tests and 13 focused frontend tests passed. The real PostgreSQL disposable-database proof passed and removed its test database.
- The only pending migration, `20260925110000_records`, was applied to the existing local development database. Both services were restarted from the new builds (frontend 3009, backend 3014).
- Opened Records from Apps, created and retrieved a private test note, voided it with a reason, and verified both activity entries. A CSV export of the voided filter reported one matching record. The note `13bc20e5-0781-45b1-97d3-03b3276e8e49` remains clearly labelled as a voided runtime check; active registers are empty. No live financial transactions were entered.
- Two Records windows retained distinct search terms through refresh. The extra verification window was closed and filters cleared afterwards.
- Checked the date picker, company → division → branch choices, unsaved-change warning, keyboard chooser and cancellation controls.
- Checked 390, 768, 1440 and 1920 px widths. Corrected a narrow-grid overflow; the final app content stays within the window at each width. Responsive table scrolling is local to its table container. The browser was left on Records with no open dialogs or console errors.
- Verification covered the local development environment, not a deployment to staging or production. New Records forms use explicit saves and navigation warnings; automatic server draft recovery is not included yet.

### Statement enhancement verification — 25 September 2026

- Backend and final frontend production builds passed; 24 backend and 8 frontend focused tests passed. Records frontend files passed ESLint.
- Disposable PostgreSQL proof passed partial/full debtor and creditor settlements, concurrency and idempotency, scoped statements/exports, historical reversals, current corrections, rollback, legacy opening snapshots and absence of ERP writes. Its database was removed.
- Applied the sole pending local migration `20260925160000_record_statements`, generated Prisma successfully after releasing the Windows engine lock, and restarted both services. Backend health returned 200.
- Rendered and visually checked both pages of `tmp/pdfs/records-statement-fixture.pdf`: company letterhead, party, period/currency, repeated headers, debit/credit/running balances, reversal and totals are readable.
- Live browser: private synthetic debtor `ab0b5b58-4cae-4708-bd90-f0ce8df8e09c` started at 100.30, received 30.10 and showed 70.20 on both record and statement. PDF/CSV requests succeeded and the browser displayed the export feedback. The in-app browser did not expose a download event/file location, so final filesystem delivery through that browser was not independently confirmed.
- Verified 390 px layout and horizontal keyboard scrolling. Added a visible scroll hint and a statement retry action. Refresh preserved all movements. Reversed the synthetic payment and voided the test record; its statement closes at 0.00 and active registers are empty. Original browser size was restored and the detail panel closed. No real money was moved.
