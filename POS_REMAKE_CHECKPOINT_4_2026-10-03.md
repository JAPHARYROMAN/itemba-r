# Itemba POS - native stock and daily reports

Date: 3 October 2026. Branch: `codex/pos-remake-foundation`.

Stock receiving, blind stock counts, delivery history and daily reports now use the native ITEMBA OS POS workspace. Cashier shifts, floats, handovers and shift closing remain excluded. Live staging cashier acceptance is deferred at the user's request; no permissions were changed to bypass it. Production promotion is a separate step.

## Behaviour and connections

- **Stock:** branch stock search, low/out-of-stock filters and a detail panel. Snapshot time and refresh failures are visible. Stock valuations and costs never reach this read surface. Count-enabled staff can see on-hand/reserved quantities; cashier availability remains clamped at zero.
- **Receiving:** choose a shared supplier and delivered products, enter quantities and optional unit costs, review, then confirm. Blank costs are resolved by the existing purchase service. Typed-cost totals are labelled as partial input totals rather than final invoice values. Canonical purchase orders and posted goods received notes update inventory and valuation; this workflow does not pay a supplier. Delivery history uses the existing private seven-day, newest-100 receiving book.
- **Counts:** enter absolute shelf quantities without system quantities. Empty means not counted and zero means an empty shelf. Review shows estimated variance; the server resolves exact stock and produces the canonical adjustment. Large variances require additional acknowledgement. Unsent device sales block counting and submission. Pending office approval is shown as pending rather than completed. The count-history endpoint returns the current cashier's terminal-scoped, seven-day, newest-100 adjustments, without cost fields.
- **Daily reports:** select one of seven East Africa business dates and read current canonical sales, original receipts/credit, later collections, paid refunds, net receipts and product totals. Later payments are allocated to eligible receivables, not counted from a shared payment's entire header amount. Collections/refunds use their own payment date even when the original sale is older. Read operations run in a repeatable-read database snapshot. Net receipts are explicitly distinct from an account or drawer balance. Unsent device sales are separated and excluded from report/PDF totals.
- **PDF:** the selected daily report uses the shared company letterhead service. It is a read-only export, with scope rechecked, private cache headers and no daily-close or shift mutation. The existing sale, collection and return PDFs remain available.
- **Navigation:** native Stock and Daily reports tabs, operation navigation, compatible legacy links and browser/OS-window history. Settings alone retains the compatible Kaunta surface. Writer components remain mounted across native workspace navigation so a stock draft is not reset by visiting Sell or Reports.

## Recovery and permission boundaries

Receiving and count request identities must be durably stored before the POST. A local storage failure stops submission. Unknown outcomes preserve the original payload/key across refresh and require an explicit reviewed retry; inputs and discard stay frozen until acknowledgement or office resolution. New unattempted receiving drafts remain editable. Older drafts without the new attempt flag are conservatively frozen. No financial action is replayed automatically.

Only the window holding this browser's till control can mount a stock-draft writer. Read-only duplicate windows cannot open or overwrite the controlling draft. A non-empty stock draft prevents releasing the till or replacing the workspace with Settings. Device-private saved drafts are not account-synchronised cloud drafts or a cross-device cashier lease.

The existing terminal gate now validates current division/branch WRITE access as well as company WRITE access, actor assignment, active status and device registration. A revoked branch grant cannot read stock, reports or history, or submit a transaction. Existing action-specific purchase/count permissions remain required.

## APIs and storage

Additive read routes:

- `GET /mobile-pos-lite/daily-summary?businessDate=YYYY-MM-DD`
- `GET /mobile-pos-lite/daily-summary/pdf?businessDate=YYYY-MM-DD`
- `GET /mobile-pos-lite/stock-counts`

They use the existing authenticated terminal/device headers and permission system. They are excluded from agent tooling because device credentials are not represented there. Existing receiving, count, stock, supplier and purchase-history APIs are reused. No new database migration is required. IndexedDB purchase drafts gain an optional `attempted` flag; existing drafts remain readable.

## Verification

- 453 frontend POS/device-store tests and 251 backend POS/controller/DTO tests passed. The final report/copy changes also passed their affected 37 tests. An additional duplicate-window delivery-draft check is included in the final shell run.
- Frontend type checking and scoped lint passed. Backend compiled with declaration output disabled for the local dependency-junction environment; normal declaration output is validated by the packaged Docker build.
- `backend/scripts/verify-pos-payment-lifecycle.cjs` passed 24 compiled-service checks in a generated disposable database on staging PostgreSQL. No existing staging business records changed. The database is removed in `finally`.
- The added checks verify one shared PO/GRN and stock increase on receiving replay, one posted adjustment with a balanced journal on count replay, and report totals against real allocations/refunds. Existing cash/credit/split selling, later collections, returns, tax allocation, financial rollback, concurrent replay, branch revocation and company PDF checks also passed.
- The actual component/IndexedDB browser fixture demonstrated reviewed receiving, interrupted-response freeze, refresh recovery and original retry; blind count entry/review and pending-approval feedback; readable report layouts at 390, 768, 1,440 and 1,920 px; light/dark surfaces; dialog keyboard containment and Escape focus restoration. There was no page-level horizontal overflow. Fixture transactions are synthetic, not live staging acceptance.
- The real generated daily PDF was rendered and inspected as one clean A4 page. Physical printing/scanner acceptance remains outstanding.

Local evidence: ignored `.release/pos-phase4-*`, `.release/pos-proof-pdfs/` and `.release/pos-stock-stage/`. The staging image proof must rerun these checks using the exact packaged compiled backend and Prisma client before promotion.

## Remaining release gates

An existing authorised staging cashier must activate an eligible till and exercise deployed selling, collection, refund, receiving and counting. Physical printer/scanner acceptance, fiscal/provider integrations and six-populated-window performance acceptance remain separate release gates. This checkpoint does not claim completion of those checks.
