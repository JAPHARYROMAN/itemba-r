# Itemba POS — selling workspace checkpoint

Date: 3 October 2026. Branch: `codex/pos-remake-foundation`.

The next selling phase is implemented locally on top of checkpoint 1. Cashier shifts, opening floats, handovers and shift closing are excluded. The full remake plan records this decision. This checkpoint has not been deployed or enabled on production terminals.

## What is available

- **Held carts:** name an unpaid cart, add a note, hold it, sell another cart, then resume the first with its customer, quantities, price overrides, payment method, reference and entered cash amount. Rename and explicitly discard held carts. Holding creates no revenue, payment or stock reservation.
- **Recovery:** active unpaid carts save after 500 ms of inactivity on the same device. Refresh restores the same OS window's acknowledged copy. Online restoration refreshes authorised product references and default prices; offline restoration uses the cached catalogue. Checkout requires explicit review of a restored cart. Failed restoration retains the saved copy and exposes Retry.
- **Independent OS windows:** each host supplies its persistent workspace instance ID. Draft writes check revisions; held-cart claims are atomic, so two windows cannot resume the same held cart. Scope changes clear private displayed inputs, and old workspace callbacks cannot change a new owner's cart.
- **Selling control:** one browser window controls an activated till at a time through Web Locks. Release and Use this till transfer window control explicitly; other windows can prepare independent carts and inspect transactions. A separate device-operation mutex serialises checkout and outbox sync. This is window control, with no shift or cashier handover records.
- **Transactions:** a native list with search, Paid/Credit/Pending filters, receipt details, browser/thermal reprint and the existing canonical PDF receipt action. It shows the cashier's own terminal sales over seven business days, with up to 200 recent rows and separate exact server totals. Credit status follows the current outstanding balance. Cost and margin fields are excluded.
- **Sync:** unpaid held carts and submitted/offline cash sales are explained separately. New submitted records cannot be discarded from the list. Rejected new-format queued sales wait for explicit retry instead of repeated automatic posting. Retry checks the original outcome and preserves the request identity.
- **Appearance:** shared ITEMBA materials, readable light/dark business surfaces, responsive lists and detail panels, container-width layouts, accessible labels, focus styling and guarded scanner/keyboard actions. Restored-cart review is available on both Sell and Pay.

The existing `uiVersion >= 3` gate remains. Classic/Kaunta screens and their existing daily reporting, stock and receiving functions remain available. No database migration or parallel financial register was introduced.

## Verification

The final regression run passed **454 frontend tests and 264 backend tests**. Both production builds passed. Scoped frontend and backend lint have no errors; backend test warnings remain. Frontend compilation and route type checking were enabled.

Meaningful coverage includes independent duplicate windows, selling-control transfer, aborted draft writes, competing held-cart claims, stale revisions, account-boundary callbacks, refresh recovery, changed default prices, failed reference lookup recovery, explicit restored-cart review, interrupted submissions, original-key outcome checks, canonical transaction filtering and receipt reprinting without another sale request. Classic/Kaunta, device storage and affected finance/procurement dialogs are included in the regression scope.

Browser verification used the actual POS components and IndexedDB at `http://127.0.0.1:3013/` with a synthetic API. Holding/resuming, review-before-payment, checkout and native receipt details were exercised. Light/dark layouts were inspected at 390, 768, 1,440 and 1,920 px; checked layouts have no page-level horizontal overflow. Local screenshots and layout measurements are under `.release/pos-preview/` and `.release/pos-phase2-browser-layouts.json`.

### Business-record proof

`backend/scripts/verify-pos-selling.cjs` exercised the current compiled services in a generated disposable database on the local staging PostgreSQL server. It generated synthetic organisation, account, product, customer and terminal records, then removed that database. Existing business records and running application services were untouched.

Ten checks passed:

1. A cash sale has the canonical selling total.
2. Lost-response lookup and original-key replay produce one sale, stock issue and cash receipt.
3. A credit sale creates debt and one stock issue without adding cash.
4. Sales Desk reads the same canonical sale IDs.
5. Cash Desk projects collections and outstanding credit without a mirrored register entry.
6. Reports reads both canonical sales.
7. Transactions exposes paid/credit state and selling lines without costs.
8. Each sale has one balanced journal.
9. A wrong device secret or read-only company cannot post; another branch cannot read these collections.
10. No duplicate direct-entry Sales Desk or Cash Desk records are created.

The proof is a compiled-service integration test, not a deployed staging browser acceptance run. Its JSON result is `.release/pos-phase2-staging-service-proof.json`. Test/build reports are ignored local evidence under `.release/pos-phase2-*`.

## Remaining boundaries and rollout

- Unpaid carts are **device-private IndexedDB records**, not encrypted cloud drafts or cross-device cart sharing. Session storage holds only a non-sensitive standalone tab identity. Keep existing device storage during rollout; clearing browser storage removes device drafts and queues.
- Window control applies within the same browser origin. It is not a server edit lease across computers. Existing device-secret, assignment and organisation permissions remain server authority. New selling requires a browser that supports Web Locks.
- Physical printer/scanner checks, PDF browser acceptance against a deployed backend, fiscal integration and production performance measurements remain release checks. Browser reprint mechanics are tested; no physical hardware success is claimed.
- Split/partial payments, later collections, returns/refunds and native stock/receiving/daily-report interiors remain later remake phases. Cashier shifts are excluded from those phases as well.
- Deploy the checkpoint 1 outcome endpoint and this additive history response before activating the frontend on selected uiVersion 3 terminals. Preserve frozen queues, request identities and versioned carts. An older frontend rollback needs format-compatibility review; rollback cannot undo completed sales.

Next: complete the payment lifecycle and its reconciliation, then stock/report interiors and hardware acceptance, without cashier shifts.
