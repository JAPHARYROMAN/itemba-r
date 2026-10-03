# Itemba POS remake — first implementation checkpoint

Date: 3 October 2026
Branch: `codex/pos-remake-foundation`
Base: `3346ce7e5d70037d0d2723f462da88e9bc5bf3b5` (release source)

This checkpoint implements the approved first step: protect interrupted checkout, then improve Sell, Payment and Receipt in the standalone terminal and ITEMBA OS window. It does not complete the full remake and has not been deployed.

## Implemented behaviour

- Every new checkout saves its original request, prices, payment reference, cashier identity and display snapshot before sending. IndexedDB writes wait for transaction completion, so an aborted write prevents the sale request.
- An uncertain mobile-money/credit/online sale stays protected behind a recovery screen. Refresh reloads that saved intent. Checking its outcome is read-only; an explicit retry checks again and uses the same request identity and payload.
- Confirmed outcomes restore the receipt without another sale POST. A local cleanup failure does not undo a server acknowledgement. A saved receipt retains the cart, selected customer, payment method, reference and entered cash amount.
- Offline cash remains subject to the existing terminal policy. New-format queued sales check their outcome before automatic sync or manual retry. Incomplete, voided or deleted canonical orders require attention instead of automatic completion.
- Owned device intents cannot be displayed or replayed by a different cashier. Older ownerless queues keep their established replay behaviour; server terminal and organisation permissions still apply.
- Added `GET /mobile-pos-lite/sales/requests/:requestId`, protected by POS permission, activated device/assigned terminal and current company/division/branch access. It returns only outcome, reference and sale acknowledgement fields, with private/no-store caching, and performs no business writes.
- Sell, Receipt and Sync navigation, coordinated ITEMBA materials, opaque business surfaces, light/dark colours, clear payment totals, cash shortfall/reference validation and a receipt preview.
- Menu keyboard navigation and focus restoration. Recovery and receipt focus respect the active desktop host. Instance-scoped element IDs avoid collisions between hosted windows. Reduced-motion styles remain in place.

The new visual experience retains the existing `uiVersion >= 3` terminal gate. This work does not change production terminal settings or force fleet-wide retirement of classic/Kaunta. The recovery coordinator protects new checkout attempts across those versions.

Sales still use the canonical sales-order service and its existing stock, cash/payment and journal integration. This checkpoint creates no parallel financial ledger and requires no database migration.

## Production-build compatibility correction

Thirteen existing route entries blocked Next's production type checking. Five legacy screens were moved intact into reusable feature modules, leaving valid page entry points and type re-exports. Only two relative imports were changed to absolute aliases; an automated comparison verified that their business source otherwise matches the baseline. Eight customer/sales routes now wrap Sales Desk with valid page signatures. Dialog tests import the reusable implementations, and their checks are included in the frontend regression run.

This correction is committed separately as `e21274ba`.

## Verification

Final run: **440/440 frontend tests and 210/210 backend tests passed**. Both production builds passed.

- Backend POS service/controller suite: 210 tests passed.
- Frontend regression scope: POS core, UI, hardware/receipt, classic/Kaunta flows, storage and affected finance/procurement dialogs.
- Backend production TypeScript build passed. Local dependency junctions require `--preserveSymlinks --declaration false` for this worktree; no runtime code bypass was added.
- Frontend production build passed using `next build --webpack` and a local build-only `BACKEND_INTERNAL_URL`. Webpack was necessary because the worktree's dependency junction points outside Turbopack's filesystem root. Compilation and route checking remain enabled.
- Scoped frontend ESLint passed; backend ESLint has no errors and existing test warnings.
- Browser checks used actual POS components and IndexedDB against an isolated synthetic API at `http://127.0.0.1:3013/`. No live sale, stock movement, permission or production data was changed.
- Viewed phone (390), tablet (768), desktop (1440) and large dark desktop (1920) layouts. The checked layouts have no page-level horizontal overflow. Verified missing-reference and short-cash blocking, a lost mobile-payment response followed by refresh and recovered receipt, menu Escape focus restoration, and keyboard sale completion in both hosts.

Local evidence is in `.release/pos-preview/`: `sell-1440.jpg`, `sell-768.jpg`, `payment-390.jpg`, `recovery-390.jpg`, `receipt-390.jpg`, and `sell-1920-dark.jpg`. Test/build reports are also under `.release/` and are ignored operational artifacts.

An intermediate broad run hit an intermittent timeout in the existing stock-count retry test; the isolated check passed. Earlier heavy concurrent checks also hit existing purchase-draft timing tests, which passed with a single worker. The final frontend run uses one worker and a 15-second per-test timeout; assertions were not weakened.

## Release and remaining scope

Deploy the additive backend outcome endpoint before activating the updated frontend. Keep device queues; never reset storage to make a rollout look clean. Check selected uiVersion 3 terminals in staging before production rollout. Changing the UI flag back to classic/Kaunta on this code retains the recovery coordinator; an older frontend rollback needs explicit compatibility review for new intent metadata.

Still required by the full plan: unpaid held carts and their recovery, terminal edit leases/controlled handover, native transaction and shift screens, split/partial tender and later collections, returns/refunds, shift/cash declarations, receiving/count interior redesign, device-cache protection/retention, real printer/scanner and fiscal integration checks, complete staging reconciliation and production performance measurements. The synthetic browser preview is not evidence of live database reconciliation or physical printing.
