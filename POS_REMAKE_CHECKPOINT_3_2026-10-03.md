# Itemba POS — payment lifecycle checkpoint

Date: 3 October 2026. Branch: `codex/pos-remake-foundation`.

The native POS now supports split and partial payments, later customer collections, linked returns and refunds. It uses the shared business finance and inventory services. Cashier shifts, opening floats, handovers and shift closing remain excluded. Production is unchanged; staging packaging and runtime acceptance are recorded below when complete.

## Behaviour

- Split a sale across the till's configured Cash, Mobile Money and Bank Transfer accounts. Non-cash allocations require references. The server checks current prices, scope, account type, currency and total before posting. Positive allocations cannot exceed the amount due; a remaining balance requires an eligible named credit customer.
- Persist the allocated checkout payload and its expected total before sending. Recovery preserves the original request and allocations. Split payments remain online-only; the established cash-only offline policy continues.
- Transactions reads current debt, original tenders, later collections, returns and refund status from canonical records. Collect part or all of the outstanding balance through the shared customer payment service. Cash Desk projects each original tender and each later payment once.
- Return eligible quantities from an original sale with a mandatory reason. Non-void credit notes reserve quantities against over-return. Apply credit to debt first; pay the excess through the existing refund service and an authorised till account with sufficient funds. Restore saleable stock or mark the returned quantity damaged without putting it back into saleable stock.
- Return amounts and VAT are allocated cumulatively from the original discounted sale, so fractional quantities and the last returned unit reverse the exact original cents. Stock cost remains internal and is excluded from till detail responses.
- Sale, payment, credit note, refund, stock, audit and journal mutations share one transaction. Request records contain recovery evidence rather than a separate ledger. Same-key retries replay the same result; a changed actor, sale, action or payload is refused. Concurrent requests serialize against the original sale.
- Financial action intentions save to owner/device/till-scoped IndexedDB before the first POST. Unknown outcomes survive refresh. Check outcome or explicitly retry the original request; no automatic return or refund replay. Refused actions must be checked before they can be cleared. A failed local write prevents the POST.
- Company-branded PDFs cover sales, collections and returns. Reprints include original allocations, later collections, current debt and issued returns/refunds. A credit note updates the original sale's outstanding balance and paid status without recording the credited amount as cash received. Thermal reprints include acknowledged payments and current debt; printing never reposts a transaction.

## Verification

- **448 frontend tests and 415 backend tests passed** across the POS, device stores, shared sales/payment/credit/refund services and Cash Desk. Subsequent receipt changes passed the affected 211 backend and 44 frontend tests.
- The production frontend build passed with route/type checking enabled. The current compiled backend builds. Scoped frontend lint has no errors or warnings. Backend lint has no errors; existing untyped fixture/service warnings remain.
- `backend/scripts/verify-pos-payment-lifecycle.cjs` passed **21 compiled-service checks** in a generated disposable database on the staging PostgreSQL host. The database is removed in `finally`; existing staging business records are untouched. Evidence is under ignored `.release/pos-phase3-*` files.
- Checks cover canonical cash and credit selling, shared Sales Desk/Cash Desk/Reports records, split allocations, later partial collections, concurrent original-key replay, changed allocation rejection, debt-first returns and cash refunds, repeat/over-return rejection, damaged disposition, insufficient-funds and denied-refund rollback, branch revocation, exact discounted/VAT reversal and balanced journals.
- Real generated sale, collection and return PDFs were rendered and visually inspected as one-page documents. The reprinted split sale shows the later collection and zero debt after returns; revoked branch access cannot download the action receipt.

Browser layout evidence and staging deployment details are appended after final runtime verification. The local component fixture is explicitly synthetic; it is not a substitute for database-backed proof or physical hardware acceptance.

## Migration and rollout

`20261003150000_pos_payment_lifecycle` adds nullable original tender metadata and an owner/scope-bound transaction action table. Existing sales and queues are preserved. Deploy the backend and migration before the new frontend; retain the `uiVersion >= 3` terminal rollout control.

Staging deployment must archive the committed source, label images with that commit, preserve prior images and take an authenticated encrypted backup before migrating. Production promotion is a separate step. Do not drop the additive columns or table on rollback: existing financial documents and recovery request identities must remain available. Reverting UI cannot undo a completed sale, collection or refund.

## Remaining acceptance boundaries

- Current staging Group Administrator has no linked employee and no eligible company write access for till activation. No existing account permissions were changed to make a test pass. A properly scoped cashier/terminal session is needed for live staging business acceptance.
- Device-private financial intentions and unpaid carts are not cross-device cloud drafts or a server cashier lease. Web Locks prevent simultaneous selling windows on the same browser origin; the backend still checks current device assignment and organisation/action permissions.
- Mobile/bank references record an operator-confirmed payment, not automated provider settlement. Payment provider integrations, fiscal submission and fiscal retry are separate work. An ITEMBA PDF is not proof of fiscal acknowledgement.
- Physical printer/scanner acceptance and six-window production performance measurements remain release gates. This checkpoint does not claim hardware or fiscal certification.
- Native stock receiving/counting and daily-report interiors are the next remake phase. Existing gated workflows remain available in the legacy POS shell meanwhile.
