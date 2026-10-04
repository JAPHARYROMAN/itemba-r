# ITEMBA POS remake and POS Draft resumption plan

Reviewed 4 October 2026 at approximately 11:55 East Africa Time. This extends the owner's supplied **ITEMBA POS remake and POS Draft** plan against the recovered implementation. The product direction remains approval before posting, simple phone enrolment, six-digit PINs, offline capture only, complete sales and full supplier-order receipts, and no cashier shifts.

Most of the requested implementation already exists in an isolated candidate. Resume its integration and acceptance work; do not restart it from the older main checkout. The initial recovery review found CI and staging acceptance outstanding. Exact-source CI and staging workflow evidence subsequently passed for 8afa7e1a. On 4 October 2026 the owner waived remaining phone tests and pre-deployment pilot selection, requested the simple OS notification/approve/reject flow, and authorised completion and production deployment. That instruction supersedes the physical-device completion gates below; new implementation changes still require automated checks and focused staging verification.

## Recovered implementation and interruption point

| Item                            | Verified state                                                                                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Previous chat                   | **Add apps module and landing page**, interrupted during release preparation                                                                                                                       |
| Active candidate checkout       | `C:/Users/user/.codex/worktrees/pos-draft-remake/itemba-r`                                                                                                                                         |
| Branch                          | `codex/pos-draft-remake`                                                                                                                                                                           |
| Base                            | `6fa821b92df2c5065fb25964e39e4cae711044b2`, recorded by the previous work as the deployed baseline; deployment was not independently reread in this audit                                          |
| Main implementation             | `877995f0`, committed 4 October at 11:14 EAT                                                                                                                                                       |
| Recovery and verification fixes | `0410dcef6a6ace100e8ad5cef93a1b9cb98cd26b`, committed at 11:28 EAT                                                                                                                                 |
| Review                          | [PR 99](https://github.com/JAPHARYROMAN/itemba-r/pull/99), open, targeting `main`, with the same candidate head at review time                                                                     |
| Candidate working tree          | Clean before this documentation addition                                                                                                                                                           |
| Main workspace                  | Still on `codex/native-select-contrast` at `395026f6`, with unrelated fuel and procurement changes; it does not contain this candidate                                                             |
| Release preparation             | Committed source archive, candidate metadata and staging helpers exist; the last backend image build log ends during `nest build`. These artifacts do not establish completed images or deployment |

The candidate changes 109 files relative to its base. Its scope includes frontend, authentication, canonical posting services, schema/migrations, permissions, workflow proofs and rollout documentation. The older `codex/pos-remake-foundation` checkout contains a separate native POS foundation and historical staging evidence; do not mistake that staging release for POS Draft acceptance.

## Product rules to preserve

| Transaction                                            | Required stages                                                                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Cashier sale                                           | Capture → administrator approves sale and reserves stock → stockist prepares the same sale → administrator approves dispatch → post |
| Stockist customer sale                                 | Capture complete sale → administrator approves → post                                                                               |
| Full supplier-order receipt, transfer, count or damage | Stockist captures → administrator approves → post                                                                                   |
| Collection against existing debt                       | Cashier captures → administrator approves → post payment                                                                            |
| Authorised administrator transaction                   | Explicit direct-post action → validate → post                                                                                       |

Pending work remains outside canonical sales, cash, debt, stock movements and posted report totals. Collected funds remain visible as a pending claim. No sale, payment or stock issue is created merely because a phone saved or submitted a capture.

Use shared customers, suppliers, products, prices and accounts. Retain original operator attribution and separate capture, decision and posting timestamps. Posted corrections use canonical return/refund/adjustment services. A requested Admin role requires an existing authorised OS account. Do not create HR employees, infer identity from a name, or restore immediate staff posting as a rollback.

## Existing implementation against the supplied plan

“Implemented” below means present in the candidate with supporting code or automated evidence. It does not mean accepted on physical devices or deployed.

| Requirement                                       | Current evidence                                                                                                         | Remaining acceptance                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Redesigned OS sign-in                             | Updated `os-login.tsx`, CSS and tests; installation promotion removed from `AuthShell`                                   | Password change, expired session and deep-link continuation in the staged production bundle                                                   |
| Install on desktop and Devices                    | Desktop install widget, QR component and Devices workspace                                                               | Actual Samsung Galaxy A57 5G installation, including setup context across browser/app storage boundaries; the owner removed iPhone acceptance |
| Name and requested role registration              | `mobile-join.tsx` and invite/enrolment service                                                                           | Repeat QR scans, expired invitations, pending approval across app restarts and conflicting approvals                                          |
| Approval without required employee/email          | Canonical user and assigned terminal creation; optional employee linkage                                                 | Representative existing users and custom roles; verify no accidental identity merge                                                           |
| Six-digit PIN and device security                 | PIN hashing, lockout, refresh rotation, reset and revocation in `mobile-pos-auth`                                        | Lost/replaced phone, interrupted PIN setup/reset and real-device credential continuity                                                        |
| Branch defaults                                   | Branch setup and account/customer configuration in Devices                                                               | Review actual branch account mappings; do not infer them from names                                                                           |
| Native OS POS Draft                               | Pending, Sales, Stock, History and Devices; inspector, capture form and workspace navigation                             | Multiple independent windows, record links, search and Back/Forward on staging                                                                |
| Role-based phone app                              | `mobile-pos-app.tsx`, capture forms, requests and dispatch preparation                                                   | Full cashier, stockist and existing-admin journeys on phones                                                                                  |
| Draft persistence and identity                    | `PosDraft`, decisions, owned reservations, company/request uniqueness and revision checks                                | Interrupted submissions, conflicting reviewers and migrations on a representative staging backup                                              |
| Two-stage cashier posting                         | `submit`, `approve`, `prepare`, then final posting; compiled workflow proof                                              | End-to-end staging sale with exact records and balances at each stage                                                                         |
| Stockist single approval and admin direct posting | Implemented for supported transactions and included in the workflow proof                                                | Authority/branch checks on real pilot roles                                                                                                   |
| Duplicate comparison                              | Normalised same-business-day signatures, company-wide candidates, canonical-sale comparison and advisory locks           | Cross-branch concurrent captures, genuine repeats, ordinary office sales racing approval, midnight boundary                                   |
| Reservations                                      | 24-hour ownership, availability reduction, release/renewal and final posting under stock locks                           | Idle expiry outside POS requests and races with other stock writers; see hardening below                                                      |
| Pending collected money                           | Separate pending amount, rejection/blocked state and explicit return confirmation decision                               | Cashier and reviewer can find unresolved funds; no official ledger entry fabricated by a return declaration                                   |
| Debt collection                                   | Approved collection delegates to canonical customer payments with sale/debt locking                                      | Competing partial collections and current outstanding balance in linked desks                                                                 |
| Full purchase-order receipt                       | Confirmed-order fingerprint, complete receipt and prior-receipt rejection; canonical receiving reuse                     | Cash and credit orders, existing invoices, conflicts and partial orders routed to office                                                      |
| Supplier invoice financial coverage               | Existing payable/journal reuse and company-scoped match number uniqueness                                                | Migration preserves existing matches; receipt/invoice orderings reconcile once                                                                |
| Counts, damage and transfers                      | Physical-stock revision, stale-count checks, available-stock checks and shared-transaction transfers                     | All physical stock writers advance revision; competing reservations/movements; posted corrections                                             |
| Staff cannot bypass approval                      | Global mobile session guard plus canonical legacy-write policy; password and historical terminal routes covered by proof | Close capability/guard CI failures without weakening the restriction                                                                          |
| Offline capture and reset recovery                | Device/operator/credential partitioning; explicit outcome-before-submit; same-phone held-capture recovery                | Real offline restart, device reassignment, service-worker update and lost-response acceptance                                                 |
| Legacy queue cutover                              | Quarantine UI and original-identity outcome lookup; no automatic old-queue replay                                        | Inventory every affected phone's queue and reconcile individually before pilot cutover                                                        |
| Release and rollback                              | CI proof runner, rollout document and private staging helpers                                                            | Complete exact-revision CI, images, backup restore rehearsal, staging UAT and device acceptance                                               |

## Current verification and concrete blockers

The local proof JSON records **24/24 compiled API/database checks passing**, completed at 11:20:46 EAT. The proof document records 175 applied migrations and targeted auth/posting regression tests. These are existing evidence, not newly rerun tests from this audit. The proof JSON itself does not embed a Git revision; associate future proof artifacts with the exact source SHA and image digest.

[CI run 37189047584](https://github.com/JAPHARYROMAN/itemba-r/actions/runs/37189047584) ran against `0410dcef`. The isolated POS transaction/security proof, migration rehearsal, schema validation, frontend tests/lint/build, backend lint/build and dependency audits passed. Full CI failed; image and runtime jobs were skipped.

### Backend unit gate

CI reports **8 failed suites and 9 failed tests**, with 446 suites and 4,605 tests passing. Failed suites:

- `common/capabilities/capability-manifest.spec.ts`
- `app.module.guard-order.spec.ts`
- `modules/msaidizi/crud-mutation-ns-evidence.manifest.spec.ts`
- `modules/msaidizi/crud-query-read-evidence.manifest.spec.ts`
- `modules/msaidizi/crud-coverage.service.spec.ts`
- `modules/msaidizi/crud-admin-operations-positive-evidence.manifest.spec.ts`
- `modules/msaidizi/unrepresented-read-contract-exclusion.spec.ts`
- `modules/msaidizi/crud-path-read-evidence.manifest.spec.ts`

The new controllers expand the live capability inventory and add a global guard. Inventory assertions and evidence contracts must be reconciled with the new authenticated, public device-proof and human-review routes. Updating counts alone is insufficient. Preserve explicit exclusion of approval, direct posting and device management from agent execution, and prove intended public PIN/onboarding operations remain credential/claim protected. The precise repair for each failure still needs focused investigation.

### Backend read-route smoke gate

`test/api-read-smoke.e2e-spec.ts` fails because `/api/v1/mobile-pos-auth/me` returns 401 to the ordinary office-token fixture, while the generic test rejects every 401. The new service requires the mobile session contract. Add an appropriate mobile credential fixture and negative office-token assertion, or an exact documented route exception with separate positive coverage. Do not relax every route's authentication assertion or widen the endpoint to satisfy the smoke test. CI reports 496 passing smoke tests and one failure, with other tests skipped.

### Staging preparation gate

The source archive and private staging scripts exist, but no successful backup, restoration, migration, deployment or runtime acceptance record was found for this POS Draft candidate. Check any surviving build process and operation lock before restarting helpers. A lock is not evidence that a process is still running; do not delete it or start a competing release operation without checking ownership.

The interrupted chat also records a previous automatic approval rejection of local preview startup. That is historical context only: a future continuation must assess the current tool outcome. It does not justify manufacturing browser acceptance or skipping staged device checks.

## Resume sequence and completion gates

### 1 Recover the candidate and close CI

Continue in the recovered checkout, preserve unrelated work, and read applicable directory instructions before code changes. Record clean status and head revision. Inspect each failing suite, repair the actual capability/evidence/fixture integration, and retain staff approval enforcement. Run the affected suites first, then the required full CI once the focused failures pass. Keep `/mobile-pos-auth/me` restricted to its intended credentials.

Completion: full CI is green for the same committed SHA that will be built. Preserve explicit tests for public-device proof, PIN refresh, global guard ordering, direct ERP denial and human-only decisions.

### 2 Resolve remaining workflow hardening questions

These are audit follow-ups, not reproduced production bugs:

- **Idle reservation expiry:** expiry is currently invoked by POS context, submission, approval and preparation. No scheduled expiry path was found in this module. Prove that other stock availability paths do not retain an expired reservation indefinitely when no POS request arrives. Add an idempotent expiry worker or shared stock-boundary expiry if required, preserving locking order and each reservation's ownership.
- **Concurrency beyond POS Draft:** prove a competing canonical stock issue and ordinary office sale cannot bypass reservation or duplicate checks. The existing proof covers concurrent final reviewers; broader interleavings need explicit evidence.
- **Physical revisions:** audit direct balance writes as well as `InventoryMovementsService`. A movement out and back must invalidate an earlier count even if the final quantity matches its baseline.
- **Attribution and secondary effects:** canonical sale posting accepts the approval transaction and origin user; commission creation retains its uniqueness rule. Verify origin attribution throughout receipt/payment/audit records and any notification or commission retry behavior. Do not claim complete side-effect coverage solely from the atomic sale proof.
- **Business date and validation:** test East Africa midnight, delayed offline submission, changed price or permission, closed period and renewed approval after correction. Keep collected amounts unchanged until an explicit reviewed correction.
- **Owner/device isolation:** verify old credential captures remain recoverable only by the same approved operator/phone, while reassignment and another operator cannot read or submit them. Outcomes must be checked using the original identity.

Completion: each question has a passing meaningful test or a documented verified existing contract. Any required code change gets a fresh exact-SHA CI and proof artifact; do not rebuild stable completed UI merely to restart progress.

### 3 Finish the immutable staging release

Use `docs/pos-draft-rollout.md` and the private `.release/pos-draft-staging/README.md`. Reconcile incomplete build metadata and record passing readiness for the final SHA. Build backend, migration and frontend images from the committed archive and verify revision labels. Preserve website services and persistent volumes.

Pause only the affected staging writers, take and authenticate the encrypted backup, restore it to a separate temporary database, apply migrations without full seeding, and compare preserved business rows. Deploy only the verified candidate and check health, protected routes, installed migration set and image revision. Do not claim 175 migrations will always be the final count if new migrations are added during repairs.

Completion: backup/restore/migration evidence, healthy exact-revision services and route checks are recorded. Existing production remains unchanged at this stage.

### 4 Accept one staging branch across roles and records

Configure explicit general-customer and payment-account mappings. Use approved cashier, stockist and administrator identities. Execute every transaction row above and reconcile Sales Desk's canonical business view, Cash Desk's connected accounts, Inventory and posted reports. Independent direct desk registers remain separate; do not duplicate entries into them.

Observe snapshots before capture, after submission, after first approval, after preparation and after posting. Pending records must have no canonical financial/physical effects; first cashier approval changes availability only; final posting changes the intended balances exactly once. Include collected-funds rejection/return, duplicate review, full receipt/invoice sequencing, stale count, transfer, damage and canonical posted correction.

Completion: a reviewer can trace each stage to draft decisions, reservation, original recorder and final canonical record, with amounts/quantities reconciled.

### 5 Record the owner's physical-device waiver

The owner confirmed the Samsung Galaxy A57 5G, then removed iPhone testing and waived the remaining phone tests as deployment gates on 4 October 2026. The user reported that the installed app reopened its pending request; later staging inspection matched Japhary Mwampuwa requesting Admin in Synthetic UAT source. The user had not completed Admin linking. Preserve this partial evidence without declaring the unperformed checks passed.

QR installation, PIN recovery, offline restart, service-worker updates and owner/device isolation remain useful optional follow-up checks. They no longer block this authorised deployment. Automated security and workflow evidence and readable staged layouts remain required for the implemented changes.

Completion: record physical acceptance as **OWNER-WAIVED**, with partial user reports separately; the owner will report live misbehaviour. Browser and API results must retain their own evidence labels.

### 6 Promote the accepted candidate and retain governed rollback

After exact-source CI and focused staging verification, promote through normal reviewed production backup/migration controls. Real branch setup uses deliberate customer/account mappings after publishing; it no longer delays deployment for pilot selection. Check old phone queues before enabling the new workflow on each device.

Pause a branch to stop affected staff writes while keeping captures, decisions, reservations and pending-money tasks. Keep the new approval guard in any backend recovery build. A frontend rollback must not reinstate immediate staff posting. Preserve original transactions and resolve posted corrections through canonical workflows.

Completion: production runtime matches the verified source, notification-driven approval/rejection works, and the governed pause/recovery procedure preserves drafts and staff restrictions. No cashier shifts are added.

## Source map for continuation

- `backend/src/modules/pos-drafts/`: normalisation, duplicate review, decisions, expiry, dispatch and canonical posting coordinator.
- `backend/src/modules/mobile-pos-auth/`: branch setup, invites, enrolment, PIN sessions/reset and revocation. Actual onboarding API is `/mobile-pos-onboarding`, rather than the supplied plan's proposed extension of `/mobile-pos-lite`; reuse this implemented boundary unless a concrete compatibility need requires changing it.
- `backend/src/common/guards/mobile-pos-session.guard.ts` and `common/services/pos-draft-policy.ts`: global staff restriction and canonical legacy-write enforcement.
- `backend/src/modules/sales-orders/`, `customer-payments/`, `purchase-orders/`, `supplier-invoices/`, `stock-adjustments/`, `stock-damage/`, `inventory-movements/`: canonical shared-transaction effects.
- `database/prisma/schema.prisma` and candidate migrations: enrolment, drafts, decisions, reservations, physical revision and company-scoped invoice match uniqueness.
- `frontend/src/features/pos-draft/`: office workspace, capture/inspection, Devices, phone enrolment/app, owner-partitioned offline storage and legacy quarantine.
- `frontend/src/app/api/mobile-pos/[...path]/route.ts`, `lib/mobile-pos-proxy-policy.ts` and `lib/server/mobile-pos-refresh.ts`: staff cookie proxy and restricted refresh.
- `backend/scripts/verify-pos-draft-workflows.cjs`, `scripts/run-pos-draft-proof.mjs` and `.github/workflows/ci.yml`: repeatable compiled proof and release gates.
- [Local proof record](pos-draft-mobile-proof.md) and [rollout procedure](pos-draft-rollout.md): existing acceptance evidence and operating procedures.

The recovery audit above describes the state at resumption. Subsequent implementation has repaired the guard/capability and mobile smoke integration, added idle reservation expiry with ownership checks, prevented expired holds from being restored by stock reversals, and enabled correction of approved unposted sales while retaining collected funds. A correction releases its hold and invalidates prior review/dispatch. Cancellation uses the administrator's rejection decision; collected funds retain their return/reconciliation task.

Phone recovery now tolerates a lost successful PIN-reset response through same-device/new-PIN login, and late setup/login responses cannot overwrite a reassigned device. Captures retain the original East Africa business date across midnight. Office confirmation and POS approval share company sale-posting and duplicate-identity locks; office sales matching active POS work require administrator review. Proof artifacts now record source revision, clean-tree status and the compiled entry hash.

The final browser review found that ordinary inspector anchors reloaded the desktop. Canonical references now use existing workspace navigation, so Sales Desk opens while the POS Draft review window remains available. The service worker also retains exact original invitation and pending-claim pages across updates, fetching the new page's public dependencies before replacing a working offline page; failed downloads or storage writes retain the earlier public cache. API responses and private work are excluded.

Exact stockist matches continue a same-branch cashier sale by default. An administrator can classify a capture as a separate genuine purchase only after reviewing every current company-wide match and supplying a fresh explanation. That purchase uses its own stock availability; it cannot consume the cashier's reservation. A failed post retains its separate collected funds for reconciliation. Cross-branch matches remain independent captured requests awaiting review rather than attempting to open another branch's cashier record.

The legacy queue's terminal discovery previously used a GROUP-only provisioning endpoint, preventing company administrators from reconciling old captures. POS Draft now provides an office-only, scoped read of minimal historical terminal references under the existing reconciliation permissions. Suspended/revoked terminals remain discoverable; no provisioning privilege or retained credential is exposed. The legacy Sales Desk link also preserves native workspace navigation.

The final local production backend build passed 40/40 compiled workflow checks against 176 isolated migrations, including separate-repeat concurrency, cross-branch review and scoped original-identity reconciliation. POS Draft passed 41 focused unit tests. The API read smoke passed 414/414 checks before the added read endpoint, the service-worker/join/app run passed 26/26 tests, and legacy/navigation/split-workspace tests passed 20/20. These are local implementation evidence, not final exact-source CI, deployment or physical acceptance. See the proof record for results and outstanding release gates.
