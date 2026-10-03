# ITEMBA OS and website: undeployed updates

Read-only deployment audit, 3 October 2026, approximately 22:04 East Africa Time.

The live app is on `3346ce7e5d70037d0d2723f462da88e9bc5bf3b5`. There is substantial newer work, but it is distributed across unmerged branches and local checkouts. Redeploying current `main` would not include it. The website rebuild is also not live. The current staging app contains the POS remake; it does not contain all the other pending branches.

## 1. What was inspected and how status was established

The audit covered the ITEMBA-R repository, its OS apps, backend, database migrations, public website, 18 registered Git worktrees and 201 local/remote reference entries representing 132 distinct commit heads. Remote references were refreshed. Commit ancestry and equivalent patches were compared with the production checkout; branch documentation was checked against actual files and current PR status. Overlapping branches, older prototypes and recovery snapshots were separated from genuine pending additions.

Production was inspected through authenticated, read-only SSH: checkout revision, running image identities, service health, completed migration names and website asset hashes. Public HTTP checks were made against the app, API and website. Current local staging container revisions were also inspected. No deployment, production transaction, permission change or service restart was performed.

| Surface | Fresh evidence | Current state |
|---|---|---|
| Live app source | `/opt/itemba-r` checkout `3346ce7e`; backend/frontend production images running and healthy | Last release includes PetroDollar equipment CRUD, not the October 3 POS remake or party-linkage phases |
| Live app/API availability | App health and API readiness returned HTTP 200; API reports database up | Reachable during this audit |
| Live website | Homepage, Contact, Company Profile, health and sitemap returned HTTP 200 | Earlier design remains live |
| Website downloads | All four running-container PDF hashes match the files in production source `3346ce7e`, and differ from the rebuild | New profile documents are not live; two also matched over public downloads. The larger Group and Mwanjalisi public requests timed out, so their comparison uses container files |
| Production schema | 161 successfully completed, non-rolled-back migrations; no October 2/3 party-linkage migrations or POS payment-lifecycle migration | Pending financial features cannot be enabled by replacing only the frontend |
| Current staging app | Backend/frontend images `pos-stock-d3f5bdb7`, both healthy, revision `d3f5bdb7…` | POS checkpoints 1–4 deployed to staging only |
| Current merged main | `origin/main` matches production `3346ce7e` | Pending branches must be integrated before the normal production workflow can deploy them |

The production images do not carry OCI source-revision labels, and the inspected frontend build configuration has no `APP_BUILD_SHA`. Production provenance therefore uses the checkout, image identities, previous verified release record and selected asset hashes; a container label alone cannot prove its complete source. Staging POS images do carry the expected revision labels.

## 2. Pending release inventory

Five main branch families span **861 distinct changed paths**, including source, tests, documentation, assets and deletions. This is a measure of scope, not a feature count. Party phases are cumulative, and the two valuation branches contain the same feature; neither should be counted twice.

| Update group | Location / revision | Deployment position | Release condition |
|---|---|---|---|
| POS remake, checkpoints 1–4 | `codex/pos-remake-foundation`, `baeb2155`; executable staging source `d3f5bdb7` | **Staging only**; 101 changed paths against production | Authorised cashier acceptance, combined financial regression, hardware/performance checks and production CI |
| Party-linkage foundation | `party-linkage-phase-1`, `aea69107`; [PR #95](https://github.com/JAPHARYROMAN/itemba-r/pull/95) | **Not deployed**; 13 unique non-merge commits, 99 changed paths | Data preflights, migrations, cash-account mapping and staging acceptance |
| Party-linked app surfaces | `party-linkage-phase-2`, `f8ba6adb`; [PR #96](https://github.com/JAPHARYROMAN/itemba-r/pull/96) | **Not deployed**; seven additional commits, cumulative 171 paths | Foundation first; full CI on the integration with main; browser acceptance |
| Party-linked accounting controls | `party-linkage-phase-3`, `79b4b0e5`; [PR #97](https://github.com/JAPHARYROMAN/itemba-r/pull/97) | **Not deployed**; 12 additional commits, cumulative 243 paths | Earlier phases, additional migrations, journal backfill and close/export acceptance |
| Configurable stock valuation | `codex/stock-valuation-format`, `e7042ae8`; [draft PR #82](https://github.com/JAPHARYROMAN/itemba-r/pull/82) | **Not live**; previously staged September 26, superseded by later staging releases; 11 paths | Refresh integration, finish review and verify populated Inventory/Reports exports |
| Themed dropdown system | `select-field-dropdowns`, `884d570a`; [PR #83](https://github.com/JAPHARYROMAN/itemba-r/pull/83) | **Not deployed**; four feature commits, 98 paths | Combined form/keyboard regression after integration |
| Small native-dropdown contrast fix | Uncommitted `frontend/src/styles/globals.css` in the primary checkout | **Not deployed** | Integrate with the dropdown branch rather than treating as another complete UI release |
| Statutory returns PDF | `statutory-pdf`, `47cb1426`; [PR #39](https://github.com/JAPHARYROMAN/itemba-r/pull/39) | **Not deployed**; old one-file implementation | Conflicting PR: port to current `StatutoryReturnWorkspace`, then verify exports |
| Public website rebuild and assets | `website/rebuild`, `0dc25224`; image branch `8c0a2dd9` is incorporated in its history | **Local/preview work, not live**; 22 unique non-merge commits, 429 changed paths including one workflow | Fresh release checks, content decisions, production image and live website acceptance |

## 3. POS remake: what customers and staff are not receiving in production

This is a newer continuation of POS work already present in production. Existing barcode, printing and earlier OS hosting work should not be described as entirely new.

### Selling, recovery and independent windows

- Refined native Sell, Payment, Receipt and Sync surfaces, shared ITEMBA materials, opaque business surfaces and readable light/dark states.
- Persisted checkout intent before submission: original identity, request, prices, references, tender details and cashier ownership. Failed local persistence stops the request.
- Recovery after an uncertain response or refresh: read the original outcome; explicitly retry the same request rather than create another sale. Acknowledged receipts can be restored without reposting.
- Unpaid held carts with independent window state, revision checks and atomic claims. Restored carts use authorised current reference data and require review.
- One controlling browser window per activated till through Web Locks; other windows retain independent preparation/inspection. This is not cashier shifts or cross-device custody.
- A native transactions list with search, paid/credit/pending state, selected receipt details, reprinting and PDF actions. It is cashier/terminal-scoped, over seven business days, with a recent-row cap.

### Payments, collections, returns and refunds

- Online split payments across configured cash, mobile-money and bank accounts; references for non-cash allocations; partial payment with the remaining debt assigned to an eligible named customer.
- Later partial/full collections against the canonical customer receivable and shared payment service.
- Linked returns from the original sale with a reason, quantity limits and exact cumulative allocation of original discounts and VAT.
- Debt is reduced first; only paid excess is refunded. Saleable returns restore stock; damaged returns do not become saleable stock.
- Payment, credit note, refund, stock, journal and audit changes are transactional and protected against replay and competing returns.
- Durable, explicit recovery for financial actions; no automatic refund replay. Company-letterhead sale, collection and return PDFs reflect the linked lifecycle.

### Native stock operations and daily reports

- Stock search, low/unavailable filters, details, cache/as-of feedback and forced online refresh when returning from selling. Cashier reads do not expose stock costs or valuation.
- Receiving through shared suppliers/products, review and confirmation, producing one canonical purchase order and posted GRN. This does not pay the supplier.
- Delivery history and receiving draft recovery across interrupted requests.
- Blind absolute stock counts: blank means uncounted, zero means empty. Large variances require acknowledgement; queued device sales block counting; approval-pending results remain labelled pending.
- Native daily summaries by East Africa business date: original tenders, credit, later allocated collections, paid refunds, net receipts and product totals. Queued device sales are separate and excluded from verified totals.
- Read-only daily PDF through the shared letterhead renderer. A daily summary is not a drawer balance or account balance.

### Other changes bundled with the POS branch

Five legacy finance/procurement screens were extracted into reusable feature modules, and related page wrappers were corrected for Next production route checking. Their business implementations were retained. These structural fixes are part of the pending build even though they are not new business features.

**Evidence and limits:** the latest native-stock scoped run passed 454 frontend and 251 backend tests, and the exact packaged backend passed 24 disposable-database workflow checks. Production builds and responsive component checks passed. Staging currently runs this source. These are not a claim of full live cashier acceptance: the user explicitly deferred that check. Physical printing/scanning, fiscal/provider integration and populated-window performance acceptance remain outstanding. Held carts/drafts are device-private, not cloud-synchronised; Web Locks do not establish a cross-computer lease. Cashier shifts, floats and handovers remain excluded.

Detailed checkpoint: [POS checkpoint 4](C:/Users/user/.codex/worktrees/pos-remake/itemba-r/POS_REMAKE_CHECKPOINT_4_2026-10-03.md).

## 4. Party-linkage foundation: financial records know whom they belong to

This is substantially deeper than the supplier/customer directory and desk-to-business links already live.

- Supplier/customer references and document references on cash movements and other money-related records: expenses, Records entries, record-book expenses, debts, contracts and loans.
- Real foreign keys for previously soft party IDs, existence checks on polymorphic contacts, communications, documents, tasks and approval references, plus orphan inspection/archive support.
- A new **SupplierPayment** and allocations, reused by linked payable payments, supplier expenses and Invoice/Cash Desk settlement paths. Payment history, account, reversal and request identity become durable records.
- Linked receivable collections create **CustomerPayment + allocation**, so collections can appear on customer statements rather than only increment paid totals.
- A cash-book service behind **`CASH_BOOK_UNIFIED`**, recording supported ERP cash effects in Cash Desk while retaining the ERP balance mirror. Accounting connections recognise already-posted ERP movements to avoid posting twice.
- One party-balance resolver, currency-separated totals and date-based overdue calculations; cached-balance writers delegate to it.
- An **Unmatched parties** queue with suggestions and explicit, audited linking. Similar names are suggestions, not proof of identity.

Important limits: unlinked payable/receivable settlements retain legacy behaviour; supplier-free expenses do not acquire a fictional supplier payment. Records links are identity links and do not post Records money into ERP. The new cash-book switch defaults off, requires mapped accounts, and is not an all-path POS/external-payment unification. Those paths still need explicit integration work.

**Release position:** PR #95 is open against main and its required build/test/migration checks are green at this audit. Docker image/runtime jobs marked skipped are not evidence of a deployed release. Production has none of this branch's migrations. A production-copy orphan preflight and cash-account mapping/reconciliation must precede rollout.

## 5. Party-linked surfaces: what changes across the OS

| App / module | New pending behaviour |
|---|---|
| Cash Desk | Movements show supplier/customer and settled documents; party-type and party-ID filters; search includes party names; permission-aware profile/document links; party-scoped deep links |
| Supplier balances / collections | Shared resolver totals with ERP/Desk/Records breakdowns; payments allocated across supplier payables; formal customer debt and informal Records debt labelled separately |
| Invoice Desk / supplier profiles | Shared balance panel and Related sections for payments, movements, expenses, invoices, GRNs, purchases, Records, debts, loans, contracts, contacts, communications and documents |
| Sales Desk / customer profiles | Related collections, movements, direct sales, credit notes, refunds, quotations, proformas, delivery notes, package balances, Records, contracts and documents; canonical customer profile navigation |
| Records | Optional shared-party pickers with register-specific rules; combined debtor/creditor statement per linked customer/supplier, including settlements, running balances and PDF/CSV |
| Expenses / Group Control | Supplier/customer pickers for expenses, debts, contracts and supplier-credit loans, validated within the company |
| Procurement | Purchase order entry requires a directory supplier instead of relying on a typed supplier name |
| Dashboard / CRM / legacy links | Party names and exceptions open the canonical profile; shared party preview cards; Westsides/search/statement links align with Sales Desk |
| Permissions | A migration widens Records reading for existing record-book readers; managing/exporting remains an explicit permission |

Profile sections are permission-scoped, lazy-loaded and capped at the newest 50 rows. Some related items open a list rather than a record; some remain text because no detail page exists. The combined Records statement remains an informal Records ledger, excluded from formal party totals.

**Release position:** PR #96 is open against phase 1. Only two Vercel/preview checks are attached, not full repository CI. Documented focused tests/typechecks passed; browser acceptance is explicitly not done. Automatic creation of ERP supplier invoices/sales orders under total-only Desk documents was deferred because line/account/posting conventions are unresolved. It is not hidden completed functionality.

## 6. Party-linked accounting and control additions

Phase 3 adds controls across accounting, finance, approvals, alerts and tax:

1. **Journal party dimension:** supplier/customer tags on journal lines and AP/AR posting paths. Historical control-line backfill is dry-run by default. Reversals preserve the original party rather than create untagged control lines.
2. **AP/AR control reports:** compare control-account amounts by supplier/customer with the resolver's sub-ledger; expose untagged balances and differences. Supplier aging detail is added to profiles.
3. **Period-close controls:** check party differences, block unexplained differences, support a reasoned acknowledgement and save close snapshots. Re-closing records a new snapshot set.
4. **Actionable alerts:** overdue suppliers, overdue customers and credit-limit breaches, with party/profile destinations, per-party deduplication and worker scan limits.
5. **Party-aware approvals:** new requests carry the party derived from their document; inbox rows and inspectors show/profile-link it. Existing requests are not automatically backfilled.
6. **Supplier documents:** supplier statement PDF/CSV and payment remittance PDF through shared company letterheads, showing activity, allocations and current outstanding information.
7. **Tax by party:** party and TIN/VRN snapshots on new tax rows, plus grouping/reporting by party, tax type, direction and currency.
8. **One displayed cash balance:** with the unification flag and an account mapping, ERP reads use the Cash Desk balance while exposing the stored mirror and difference for reconciliation.

**Limits requiring release review:** historical documents do not retain full balance history. A past-date control report compares a historical GL position with current open sub-ledger amounts; it is not a fully historical trial balance. Close snapshots also have this limitation. GL reconciliation is company-base-currency based. Supplier statement closings can explicitly disclose a recorded/activity mismatch. New supplier PDFs have tests but were not opened in the documented phase-3 browser review. Input-VAT policy, supplier withholding, automatic Desk-to-ERP promotion, full POS/PetroDollar party-at-entry work and agent tools remain outside this phase.

**Release position:** PR #97 is open against phase 2 with preview checks only. Recorded unit/type/manifest checks passed, including reversal fixes. Its documented full frontend run still has three reproducible baseline failures and parallel-load timeouts; these must be resolved or explained in the release integration, not treated as an entirely green full suite. Historical backfill has not been proven on populated production-like AP/AR data.

## 7. Stock valuation formats and filters

The pending change implements the requested ability to remove Category and choose a standard report layout in both Inventory and Reports:

- Search by product/name/code/SKU; filters for category, branch/location, stock status and positive/zero/negative/available quantities.
- Standard, Compact (without Category), Detailed and custom column selections; at least one selected column.
- Sixteen supported fields, including product code, SKU, quantities, cost/value, reorder/minimum/maximum levels, status and last movement.
- One filtered projection for preview and exports. Hidden columns remain hidden in CSV/PDF/Excel and Reports Word/Text/JSON/copy/print.
- Filtered stock-value totals, explicit unvalued positions, retained review notes, all matching rows in print and saved Reports views.
- Export selections survive filter changes; changing the projection during an export cancels stale output. Small-window layouts are constrained.

**Release position:** PR #82 is still a draft; latest attached required CI checks passed. Sixty-four distinct targeted tests and a production frontend build were recorded. The September 26 staging review checked keyboard removal/restoration of Category and responsive layouts; populated data used fixtures because staging had no inventory balances. Current staging has since been replaced, so those controls must be reintegrated and rechecked. No new backend migration or valuation formula is introduced by this branch.

## 8. Dropdowns and remaining payroll export

### Themed dropdown system

PR #83 supplies a shared React Aria `SelectField`: opaque theme-controlled option surfaces, selected checkmark, accessible labels/errors, keyboard behaviour and search for longer lists (threshold eight). Cash/Sales/Invoice Desk filters and forms adopt it, and both shared `FormSelect` families render through it. Compatibility adapters and tests preserve existing values and form call patterns. This is a broad shared-control change affecting many modules, not just Cash Desk.

The separate uncommitted `globals.css` change sets readable backgrounds/text for native options and optgroups, including auth-light and disabled states. Its saved contrast evidence has 12 light/dark/accent/POS-theme configurations without failures. It overlaps the broader dropdown branch and should be integrated once, retaining coverage for native controls still in use.

**Release position:** PR #83 is open, mergeable and has passing required CI at the audit snapshot. It still needs integrated browser/form checks with the other pending UI work.

### Statutory returns PDF

PR #39 adds company-letterhead PDF export beside CSV for PAYE, NSSF, PSSSF, WCF, SDL, NHIF and HESLB returns, using displayed columns, period metadata and summaries. Production's current workspace offers CSV only.

The PR modifies the old page implementation, while that route now wraps `StatutoryReturnWorkspace`. GitHub reports a merge conflict. Reusing the existing PDF builder in the current workspace is needed; merging the old screen wholesale would regress the newer UI. Its old CI does not establish current readiness; the advisory Windows timing check failed in the recorded run.

## 9. Public website rebuild

Branch `website/rebuild` at `0dc25224` contains a full frontend redesign, content architecture, assets and verification tooling. It is not a new deployed website simply because its files exist locally.

### Design and page coverage

- An Apple-inspired typography/material system with design tokens, locally bundled/subset Inter, coordinated company accents and shared cards, actions, tables, heroes and page layouts.
- New site shell: compact translucent header, company crest, mobile menu, footer directory, sub-navigation and persistent quick-contact actions.
- Rebuilt Home, About, companies and company detail pages, service directory/details, locations and location details, Insights/articles, FAQ, Capabilities, Partnerships, Contact and Company Profile.
- Map facades/corridor storytelling and photo/typographic layouts for stronger company/service presentation.
- A private UI-kit route and page composition guide for consistent future additions.

### Enquiries, accessibility and motion

- An intent-aware enquiry interface directing general and company enquiries, contextual messages and phone/WhatsApp/email actions, with validation, sending/error/success feedback and conversion tracking.
- Existing enquiry API/storage/delivery contracts are preserved; the design does not itself establish a new production mailbox or delivery setup.
- Small interactive islands rather than page-wide client rendering; legacy motion components/Framer Motion are removed from this rebuild.
- Modal mobile-menu focus containment, Escape/restoration, visible focus edges, reduced-motion behaviour and spacing that keeps focused controls above the quick-contact bar.
- Tests for no-JavaScript behaviour, route links, enquiries, analytics, accessibility, metadata and printing.

### Photography, SEO and documents

- Regraded image masters, responsive optimised AVIF/WebP derivatives and generated media dimensions/placeholders.
- Weaker or unverified photos replaced with typographic/icon treatments on selected pages; other publication choices remain flag-controlled.
- Per-page SEO/structured-data builders, Open Graph cards, errors/404, redirects, robots, sitemap and manifest handling.
- Four regenerated company-profile PDFs (Group, Enterprises, Mwanjalisi and Westsides), recorded page counts 9/4/4/4, new print layouts and a dependency/input lock to prevent silent document/content drift.

### Release tooling and limits

New website-specific CI, unit/e2e contract tests, frozen baselines, asset/client/HTML budgets and Lighthouse reporting are included. Recorded local e2e `.last-run.json` says passed on September 27; this audit did not rerun the complete website suite. There is no open release PR for `website/rebuild`.

The performance baseline records a deviation from 110 kB planned shared JS to a 122 kB budget; Lighthouse reporting is non-blocking. These are not proof that the desired performance target is already achieved. A fresh production image and slow-device measurements are needed.

Content review remains: manufacturing and division counts, legal identifiers/directors, exact headquarters/station identity, location pins, hospitality image provenance and regional growth claims. Several uncertain claims are suppressed, but legal identifiers and hospitality photos remain enabled in the checked flags. Approval of their public use must not be inferred from a passing technical test.

The image branch is in the rebuild's ancestry, not an additional website release to stack on top. All four live-container PDF hashes confirm that the regenerated downloads are still pending. Marketing pages already exist in production; the change is their rebuild, not their first creation.

## 10. Changes that must not be mistaken for pending releases

| Discovery | Classification |
|---|---|
| Eleven modified Fuel Reporting/PetroDollar/purchase-safety files in the primary checkout, plus three untracked equipment test/proof files | Content hashes match current production-source blobs. Already released through PR #94; local dirty state is not deployment status |
| PetroDollar station access/selection, OS window clarity, supplier/customer route unification, Sales/Cash connection, Records PDF support | Already in production ancestry. The pending party phases extend these, rather than introduce them for the first time |
| Original public-website branch and old local website animation edits in `.claude/worktrees/blissful-euclid-841184` | Archived/alternative implementation, superseded by the current site and new rebuild. PR #1 is still open but should not be merged as a new release |
| Older Claude finance phases | Integrated through `9f9ca788` and subsequent changes. Unique old commit hashes alone do not prove missing features |
| Old `ops-finance-linkage` waves | Salvaged through merged PR #40 on the newer payable-at-receipt model. Reintroducing the old GRNI/variance model would risk incompatible posting |
| Inventory formatting-only branch | Formatting residue, not another inventory feature release |
| Thirteen `wip/*` date/print/suite snapshots | Explicit recovery points; large snapshot diffs include already-integrated OS work. Current production already has the shared date field. Do not count these as thirteen product releases |
| Temporary Msaidizi worktree showing thousands of deleted files | Incomplete/cleaned scratch checkout, not an authorised mass-deletion change to deploy |
| Whitepaper, POS/party plans, older audit and pilot documents | Planning/evidence artifacts, not automatically implemented features |
| External Fuel Grid | Separate repository/deployment. Running app images are tagged `attendant-d801aee`; the inspected main local checkout `04f359a` is an ancestor of that revision, not newer committed product work. Local untracked scheduled-report migrations/helper documents were noted, but this audit does not certify a separate Fuel Grid release |

Other projects on the computer (for example Itemba Net, Itemba-Z or independent Records projects) were not assumed to be code shipping with ITEMBA OS. This report covers the OS/app repository and its public site, with the linked external Fuel Grid boundary above.

## 11. Integration and release requirements

### Concrete overlap needing review

The POS and party-linkage branches modify eight of the same files: Sales/Cash collection projection, customer payments, refunds, credit notes, sales orders, Prisma schema, and payable/receivable route entries. The POS branch also moves reusable financial implementations, so old page edits need to follow those modules. Verify that one business event still creates the intended payment, movement, stock effect and balanced journal exactly once after integration.

Party-linkage and dropdowns share seven files, including Cash Desk forms/styles and Records styles. POS/dropdowns share four dialog-test files; valuation/dropdowns share two test files. These are changed-file overlaps, not a claim that every overlapping file has a textual merge conflict. No merge was attempted in this audit.

### Data and migration requirements

- POS adds `20261003150000_pos_payment_lifecycle`.
- Party phases add nine migrations: party columns, party relations, supplier payments, Records read permissions, journal parties, close snapshots, credit-limit alert type, approval parties and tax parties.
- Before migration: rehearse on a production copy, inspect blocking party orphans, confirm mappings and reconcile initial Cash Desk/ERP balances.
- Enable `CASH_BOOK_UNIFIED` only after its mapping/reconciliation preflight; a code deployment alone will not activate it.
- Run historical journal-party backfill in dry-run mode and review findings before applying. Amounts or identities must not be guessed from similar names.
- Preserve current device queues, frozen financial intentions, schema-compatible rollback and existing business data.

### Practical release sequence

1. **Prepare one integration branch** from live main and resolve shared-service/UI changes there. Keep the website release independently reviewable.
2. **Ship the smaller visual/report improvements** after integrated checks: dropdowns, valuation and the statutory PDF port. Keep native-option contrast coverage.
3. **Release the website rebuild independently** after fresh builds/contracts/PDF review, publication decisions, enquiry delivery/storage checks and a rollback rehearsal.
4. **Finish POS staging cashier acceptance** for sale → collection → return/refund, receiving and counts. Complete required device/hardware/performance checks; shifts remain excluded.
5. **Roll out party phases in dependency order** 1 → 2 → 3, after data preflights and full CI on the final merged source. Verify Cash Desk, party statements, postings, reversals, permissions and period close with realistic scoped roles.

These are proposed release steps, not deployments performed by this report. The current staging image must be rebuilt from the final integration; earlier separate staging passes do not certify the combined result.

## 12. Evidence and confidence

Fresh audit evidence is saved locally under `C:/projects/Actual Projects/itemba-r/.release/undeployed-audit-20261003/`:

- `live.json`: production checkout and running image/service identities.
- `inventory.json` / `summary.json`: references, branch additions and worktree comparison.
- `public-http.json` / `public-proof.json`: public responses, selected PDF comparisons, completed migrations, container PDF hashes and current staging identities.
- `pull-requests.json`: PR heads, bases, merge state and attached check results.
- `overlaps.json`: changed-file intersections used for the integration review.

Supporting records include the POS checkpoint/release artifacts, September 26 valuation verification, three party plans/status sections and the latest PetroDollar equipment release record. Historical documentation is not treated as current deployment truth: for example, party documents saying "not pushed" have been superseded by the open PRs, and old staging valuation evidence has been superseded by the current POS images.

**High confidence:** which six main release packages remain outside live main; current production/staging source positions; absence of new financial migrations; pending website/PDFs; open PR state; duplicate local equipment edits.

**Not certified by this audit:** every production user workflow, merged-branch behaviour, unseen work outside the scoped repositories, physical devices, external fiscal/payment providers, or current readiness of every historical test result. Those are release verification work, not evidence of additional completed features.
