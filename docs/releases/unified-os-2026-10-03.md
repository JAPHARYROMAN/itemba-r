# Unified ITEMBA OS and website release

This release integrates the October 3 POS remake, all three party-linkage phases, configurable stock valuation, themed dropdowns, statutory-return PDFs and the public website rebuild. Existing PetroDollar equipment changes remain included. Cashier shifts, floats and handovers are excluded.

## Integration decisions

- Customer Payments retains its reusable transaction API, so a POS collection, its payment allocation, journal, cash effect, balance refresh and action identity commit or roll back together. The party-linkage payment implementation remains the shared implementation.
- Split-payment debt uses the same customer on its AR journal line as credit sales, collections and credit notes. Reversals preserve party references.
- Supplier/customer navigation filters are applied in the extracted finance feature screens; Next page files remain valid route wrappers.
- Dropdown changes preserve the new party selectors and stock-valuation filters. Existing native dropdown contrast fixes are incorporated by the dropdown branch.
- Statutory PDFs use the current return workspace, all employee rows, the generated company's letterhead, recorded contributions and whole-return totals. Changing the company, period or return cancels an in-flight PDF; exporting does not file a return.
- The website enquiry API and persistence contract remain unchanged. Production adopts the existing enquiry volume by identity and records it in the deployment environment; staging uses a named isolated volume. The rebuilt website's independent checks are included in release CI.

## Data gates and operation

Read-only preflight on October 3 found no blocking or review supplier/customer references in staging or production (14 checks each). Production has one used ERP cash account without a Cash Desk mapping, six idle unmapped accounts and no mapped pairs. Staging has two mapped pairs requiring balance review. **Keep `CASH_BOOK_UNIFIED=false`**; do not infer account mappings or opening amounts from names. Party links and new payment entities can ship with this switch off. Reconcile mappings and balances before a later activation.

Apply the nine party migrations and one POS payment-lifecycle migration through Prisma after an authenticated, validated backup and restore rehearsal. Preserve organisation, roles, business records, website enquiry storage, uploads, persistent volumes and device outboxes. Do not run the seed or widen permissions.

The combined POS database proof runs with mirroring both off and on, in disposable databases only. It checks replay, concurrent collections and returns, customer AR tags, debt/cash/stock/journal agreement and exports. The existing user instruction deferring a signed-in cashier pilot remains in force; synthetic proofs do not claim physical printer/scanner or fiscal-provider acceptance.

Deploy a committed, pushed candidate to staging first. Promote only the same source after combined checks, production-build proofs and browser acceptance. The normal production workflow requires that the exact merged main revision passes `ITEMBA-R CI`; website blocking checks must also pass. Keep before/after image identities, encrypted backups and a tested rollback record in the private operations evidence.

Verification so far: 318 targeted frontend regressions and 626 targeted backend tests passed. The website passed 713 unit tests and 416 browser tests (16 explicitly skipped), its build budgets and Docker smoke. Lighthouse's advisory run measured a 2,527 ms company-profile LCP against the 2,500 ms target; the other three measured routes met their budgets. The production encrypted backup authenticated, all six archive checksums verified and its database restored into 387 existing tables in an isolated database. Migration and staging results follow after completion.
