# Invoice Desk — first release

An independent purchase-invoice app launched from ITEMBA OS Apps. Reuses authenticated identity and the existing Company → Division → Branch directory. Suppliers, invoices, attachments and recorded payments belong only to Invoice Desk; nothing posts to the ERP ledger, inventory or banking integrations.

The first release includes a scoped overview, searchable invoice register, independent suppliers, due/overdue balances by currency, partial payments, payment reversals with reasons, voiding unpaid mistakes, private attachments and an activity history. No currency conversion or mixed-currency totals. A payment records an already-completed payment; it does not transfer money.

Every invoice requires company, division, branch, supplier, invoice number, issue/due dates, currency and total. Duplicate supplier invoice numbers are prevented per company. Amounts use fixed decimal arithmetic. Concurrent writes use an invoice version; payment retries use an idempotency key. Records are retained rather than deleted. Invoice details can be corrected before the first payment; organisation and supplier remain fixed. East Africa time (Africa/Nairobi) determines today and overdue status. Supported currencies: TZS, KES, UGX, USD, EUR and GBP.

Access is separately controlled by invoice_desk.view, invoice_desk.manage and invoice_desk.payments, in addition to company/division/branch access. Initial grants are limited to GROUP_SUPER_ADMIN; administrators can grant app permissions to other roles. Directory reads are provided by the app with the same scope checks, without requiring ERP module permissions.

Visual direction: quiet Apple-inspired workspace, a compact app rail, generous spacing, restrained blue accents, readable balances and a focused invoice inspector. Usable on phones and in dark appearance. Empty states contain no invented business data.

Acceptance: scope isolation, exact balances, overpayment rejection, duplicate prevention, stale-write rejection, permission gates, attachment access and reversal history must be tested. Live checks must not create fake financial records in the working database.

## Verification — 18 September 2026

- Additive migration `20260918120000_invoice_desk` applied locally; existing ERP data and posting flows were not changed. Prisma validation and generation completed.
- 24 backend tests and 23 frontend/app-registry/OS-shell tests pass. Targeted lint, TypeScript, backend build and frontend production build pass.
- `node scripts/test-invoice-desk.cjs` (run from backend after building) creates a separate local test database, checks real PostgreSQL invoice creation/correction, duplicate supplier/invoice prevention, branch isolation, competing payment writes, rollback, idempotent retry, full settlement, reversal, authenticated attachment access, attachment duplication, database amount constraints and voiding. It removes its own generated test database afterwards. Global audit is stubbed in this test; application-owned activity entries are persisted and checked. The working database receives no test purchases.
- Live browser: Apps tile and dock launch, minimised app restoration, existing company/division/branch selectors, scope carried into capture, supplier onboarding, unsaved draft discard protection, 390px phone layout/form, light and dark appearances. Viewport and Light appearance restored; temporary QA tab closed.
- Captures: `invoice-desk-desktop.png`, `invoice-desk-mobile.png`, `invoice-desk-dark-mobile.png`, `invoice-desk-form-mobile.png`. Live register is empty; populated states and financial mutations are covered by isolated tests.
- Initial release intentionally excludes ERP posting, bank transfers, OCR, credit-note allocation, automated reminders, exchange-rate conversion and bulk import. Attachments are private database-backed files, capped at 10 files of 10 MB per invoice. Supplier contacts are company-level; invoice balances respect both company and organisation access.
