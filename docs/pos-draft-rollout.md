# ITEMBA POS Draft rollout

## Release boundary

This release replaces the counter landing page with native OS POS Draft and a role-based installable phone app. Existing customers, products, prices, supplier orders and accounting remain canonical. No cashier shifts, fictitious employees, automatic staff posting, automatic offline replay or data seed are introduced.

Build the candidate from `codex/pos-draft-remake`, based on deployed revision `6fa821b92df2c5065fb25964e39e4cae711044b2`. Preserve other checkouts and all existing database, uploads, website enquiry and backup volumes. The migrations create onboarding/draft records, physical stock revisions and permissions, and align invoice match number uniqueness with its company-scoped sequence. They do not migrate or delete posted sales or old outboxes.

## Branch pilot

1. Back up staging and rehearse migration restoration in an isolated database. Record the source revision and image IDs before changing application services. Run migrations without seeding.
2. In POS Draft → Devices, an existing authorised administrator selects the company, division and one pilot branch. Choose the existing general customer and the actual branch receipt accounts; Cash is required, other receipt methods are optional. Only TZS accounts with compatible company/branch ownership are offered. Do not infer mappings from account names.
3. Create an installation link. Scan the QR on the authenticated desktop, install the phone app, and open its icon. Registration asks for name and requested role. The office approves Cashier or Stockist; requesting Admin requires that person to sign in to their existing authorised OS account. Staff choose a six-digit PIN after approval.
4. Test the cases below with clearly identified staging transactions. Reconcile the canonical sale, cash or receivable, stock movements, journal lines and reports after every accepted transaction. Pending proposals must not appear in posted reports.
5. Obtain Android acceptance on the **Samsung Galaxy A57 5G**, including closing the installed app while approval is pending, PIN recovery on the approved phone, offline capture and reconnect, and a second operator/device. The owner removed iPhone acceptance from this release on 4 October 2026. Browser simulations do not replace physical Android checks.
6. Reconcile legacy captures by their original request identity before entering them again. Devices provides a read-only lookup for locally stored older captures. Keep their old data and posted transactions; the new app never runs the old outbox automatically. Reconcile other phones individually, since one browser cannot read another device's storage.
7. Pass the complete CI and production builds for the exact candidate. Promote only the staging-accepted source tree through the normal production workflow, its backup/migration gates and environment review. Start with the accepted branch, then configure further branches deliberately.

## Acceptance cases

| Case                                   | Required result                                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cashier cash and credit sale           | Capture changes no official balances; first approval reserves stock; stockist prepares the same request; final approval posts sale, stock, cash/receivable and journal once.                                 |
| Stockist customer sale                 | Full customer, product, quantity, price and payment details; one office approval; matching cashier capture is continued instead of posted twice.                                                             |
| Admin sale and stock activity          | An explicit authorised direct-post action validates and posts, without another reviewer.                                                                                                                     |
| Genuine repeat and suspected duplicate | Company-wide same East Africa day comparison, including another representative/branch; every candidate is reviewed and a genuine repeat has a reason. Concurrent reviewers cannot both post.                 |
| Interrupted submission                 | Original request identity finds the acknowledged result; neither a lost response nor refresh creates another sale/payment.                                                                                   |
| Reservation expiry and competing issue | Expiry releases only owned availability, requires renewed review, and cannot consume another dispatch's stock. On-hand stock changes only at posting.                                                        |
| Collection                             | One approval posts against the selected existing debt and receipt account; debt cannot be overallocated.                                                                                                     |
| Full supplier order                    | Whole confirmed order arrives; no earlier receipt; costs and terms are inherited. Stock posts once and later linked invoice uses existing payable/journal coverage. Partial orders stay in office receiving. |
| Count, damage and transfer             | A stale physical count requires recount; damage awaits approval; transfer conserves quantity and value across both branches atomically.                                                                      |
| Rejected collected funds               | Rejected cash remains visible as a return task. An administrator explicitly confirms the full return with verification details; the decision is retained without fabricating a posted cash movement.         |
| Access and devices                     | Staff cannot post through old clients, normal ERP APIs or refresh. Withdrawing origin access blocks approval; revoked devices cannot access or refresh. PIN lockout and reset persist.                       |
| OS and mobile                          | Independent windows retain separate scope/search/forms; record links and Back/Forward work. Keyboard focus, light/dark/custom accents and 390px, 768px and desktop layouts remain usable.                    |

## Offline and device handling

Offline work is a provisional capture, never a final receipt or authoritative balance. Reconnect and select **Check and submit safely** to observe the original identity and revalidate server access/prices. Device entries are partitioned by operator, approved device and credential version. Account changes hide previous private entries and cannot silently submit them. Saved server drafts and decision history remain authoritative.

An installed original invitation or pending-claim URL remains available offline across service-worker updates. The update fetches the public page and its required public assets before replacing a working cached page. Failed asset downloads or storage writes retain the previous public shell; API responses and private office pages remain excluded.

After a PIN reset, the same operator on the same approved phone can review held unsent captures from earlier credential versions. Recovery keeps the original request identity, checks its server outcome first and requires the current branch scope. The earlier copy remains available for reconciliation. Captures from another operator or device stay inaccessible, and acknowledged requests are never offered for replay.

Five incorrect PIN attempts lock the device PIN for 15 minutes. An administrator can issue a reset in Devices; it immediately revokes previous credentials and the reset must be completed on the originally approved phone. A lost setup response can be recovered only with the same saved device secret and correct PIN. If a PIN reset was saved but its response was lost, retrying verifies the newly chosen PIN on that same phone without changing the PIN again. Reloading the consumed reset link offers **Open POS to recover sign-in**; enter the new PIN there. If the reset was never saved or its link expired, request a fresh administrator reset. A late response cannot overwrite a changed operator/device binding. Device replacement requires a new approved enrolment.

Legacy reconciliation uses an office-only POS Draft terminal-reference read with the existing view and legacy-management permissions. Company/branch scope is enforced, and suspended/revoked terminal identities remain available for original-request lookup. This read does not grant GROUP provisioning privileges, expose device/activation hashes or submit an old capture.

## Pause and rollback

Disable the affected branch setup to stop its staff capture/session access while preserving its drafts, reservations and decisions. The historical staff guard remains effective even after pause or revocation; disabling a setup does not give a worker ordinary ERP write access. Keep the security-capable backend running when rolling back a frontend image. Do not switch back to an earlier backend that lacks the new guard: old staff password sessions could regain immediate posting.

If backend recovery is necessary, stop affected mobile writes first and retain the approval guard in the recovery build. Preserve database/draft/reservation data; deploy a corrected compatible backend rather than restoring immediate staff posting. Continue read-only inspection and office reconciliation when safe. Restore an older database only as a deliberate disaster recovery cutover, since it can discard later business transactions.

## Automated proof

`scripts/run-pos-draft-proof.mjs` migrates the dedicated loopback proof database and starts only its own compiled API, then runs `backend/scripts/verify-pos-draft-workflows.cjs`. It refuses other database names/ports and an occupied API port. CI creates fresh PostgreSQL/Redis services and publishes only the redacted check-result JSON. It neither uses production credentials nor uploads its private configuration or API logs.

See [the local proof record](pos-draft-mobile-proof.md) for the tested financial and access cases. CI evidence, staging acceptance and physical-device acceptance must be recorded separately; local proof is not a deployment claim.
