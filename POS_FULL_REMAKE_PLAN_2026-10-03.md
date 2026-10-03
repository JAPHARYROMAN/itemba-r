# Itemba-POS full remake plan

Prepared 3 October 2026, East Africa Time. Status: proposed delivery plan.

## Product direction

Itemba-POS becomes the counter and cashier app of ITEMBA OS. It should feel as polished and familiar as Sales Desk, Cash Desk and Inventory, while remaining quick enough to use during a queue of customers. A cashier should be able to find an item, charge the customer, issue a receipt and start the next sale without navigating office screens.

Build one POS product with two hosts: a focused, installable full-screen terminal for cashiers and an ITEMBA OS window for authorised users. Both use the same transaction logic, shared design system and organisation records. POS captures a sale; Sales Desk manages its customer and sales history; Cash Desk manages the money; Inventory manages stock; Reports explains the result.

This expands the September remake beyond a selling-screen reskin. Preserve the existing business services and offline safeguards, complete the interface across all modules, and add the missing counter workflows through explicit backend changes.

## Evidence and starting position

This is a source-based plan, not a fresh production browser acceptance report. The working checkout is at `395026f6`; the locally available `origin/main` is at `3346ce7e`. The inspected POS files are present in this checkout. Phase 0 must confirm the implementation against the selected release commit and actual terminal configuration. Existing unrelated working changes are outside this plan.

| Area                 | What the code already contains                                                                                                      | Remake implication                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| OS hosting           | App registry entry at `/pos`, `DesktopPos`, an instance navigation transport and a window close guard                               | Improve the existing host; preserve `/mobile-pos` and activation/deep links                               |
| Selling              | New `PosShell` selected by terminal `uiVersion >= 3`; search, cart, price changes, payment and receipts                             | Preserve behaviour and finish the design consistently                                                     |
| Other modules        | `PosShell` opens `KauntaShell skin="os"` for day book, stock, receiving, counts, history and closing                                | These need complete OS-native layouts, not just new colours                                               |
| Responsive layout    | Container-based phone/tablet/till rules; POS CSS also contains viewport-height assumptions                                          | Audit hosted height, small windows, scrolling and maximisation before redesign                            |
| Data                 | POS uses `MobilePosLiteService` and `SalesOrdersService.mobilePosLiteQuickSale`, with shared customers, products, stock and finance | Retain canonical business records rather than migrate sales into a parallel POS database                  |
| Payments             | POS request carries one method; terminal receipt methods are Cash, Mobile Money and Bank Transfer, with Credit separately enabled   | Split payment, deposits and additional methods require backend contracts, not frontend toggles            |
| Offline              | Existing IndexedDB binding, catalog/session cache, outbox, count/purchase drafts and day log                                        | Preserve queued transactions through the remake; add recovery deliberately                                |
| Receipts/hardware    | Letterhead PDF receipts/day reports, 58/80 mm printing, scanner support and Serial/Bluetooth ESC/POS code                           | Retest on actual equipment; direct-print support is not universal                                         |
| Closing              | Server-computed day report and declared held-sale counts/amounts                                                                    | A day report is not a full cashier shift and cash handover system                                         |
| Returns              | Core refund services exist, but the POS controller has no complete returns workflow                                                 | Inspect and extend shared services for POS permissions, item quantities, stock disposition and settlement |
| Transaction recovery | The sale action constructs a fresh idempotency key when called                                                                      | Explicitly test lost-response/retry paths; persist the submission identity before sending                 |

The September plan and pilot runbook contain historical rollout assumptions. Their statements about the desktop remaining disabled, deployment blockers and pilot completion must be revalidated; they are not current release status. This review did not reproduce a duplicate sale or verify that the historical pilot has completed.

## Experience and navigation

Open directly into **Sell**, with the branch, cashier, terminal and connection state visible. Avoid a dashboard as an extra step before every sale. Cashier shifts, opening floats, handovers and shift closing are excluded by the owner's 3 October decision.

| Section      | Purpose                                                                               |
| ------------ | ------------------------------------------------------------------------------------- |
| Sell         | Find products, scan, build the cart and charge                                        |
| Held sales   | Resume an unpaid customer cart without blocking the next customer                     |
| Transactions | Find receipts, reprint, inspect payments and start permitted returns                  |
| Customers    | Find the shared customer and view permitted balance information                       |
| Stock        | Branch quantities, availability, authorised counts and receiving                      |
| Sync centre  | Understand queued, rejected and uncertain transactions and resolve them               |
| Settings     | Language, terminal, scanner, printing and accessibility; administration by permission |

On phones, keep Sell, Transactions, Held carts and Sync within easy reach, with other sections in More. On tablets and desktop, use compact navigation. Managers can see a branch overview; cashiers see their own terminal sales and daily totals. Preserve Swahili-first copy with an English choice from the existing product direction.

### Layout and visual system

- Phone: product search and cart, then a focused payment step with a persistent action area above the software keyboard.
- Tablet: products and cart side by side; payment replaces or expands the cart area.
- Desktop till: products, cart and payment visible together, with efficient keyboard navigation.
- Choose layout using the app window's available width and height. Support 390, 768, 1,440 and 1,920 px screens, half-screen windows, short windows, 200% zoom and enlarged text.
- Reuse ITEMBA OS typography, spacing, icons, menus, sheets, dialogs, focus treatment, feedback and account appearance preferences. POS-specific tokens should alias the shared system rather than maintain a separate palette.
- Use restrained translucent navigation/chrome and opaque, high-contrast surfaces for amounts, product details, forms and receipts. This follows Apple's separation of materials for controls and content. [Apple materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials)
- Keep total, remaining balance and change easy to distinguish. Use tabular numbers and clear labels; colour alone must not convey Paid, Pending or Failed.
- Window resizing must reflow content without scaling text. Maximising must fill the available desktop workspace in width and height. Keep the payment action visible without clipping content.
- Use the shell's motion recipes: 120–160 ms controls, 180–240 ms panels, 240–360 ms windows. Prefer opacity and transforms on small surfaces, avoid animated blur or whole product-table layouts, and respect reduced motion/transparency.
- Use 48 px primary touch targets as the product design target, visible keyboard focus, properly labelled dialogs and focus restoration. Check WCAG 2.2 AA contrast, keyboard operation and unobscured focus. [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

## Features necessary for a complete release

### 1. Fast selling

Search by product name, code or barcode; hardware scanner input; favourites/frequent items; optional product photos; category filtering; clear branch availability; quantities and supported units; edit/remove lines; cart notes; discount/price changes with reasons and permission checks; large total and change calculation.

Keep current permitted price editing and backend profitability protections. Refusals must not expose buying cost or margin. Product quantities should use the product's supported precision; existing physical-count integer rules remain until explicitly changed. Include an obvious New sale action and safe confirmation before discarding a non-empty cart.

### 2. Held sales and draft recovery

Multiple named unpaid carts with customer/note, saved time and cashier ownership. Resume, rename, discard and transfer only with permission. Holding a cart does not create revenue, deduct stock or record payment. Make any reservation policy explicit; do not silently promise stock.

Give each cart a stable draft ID, revision and transaction identity. Revalidate stock, prices, customer and permissions before checkout. After submission begins, freeze the original payload and key until its outcome is reconciled; a later correction is a separate documented action.

### 3. Payments and collections

Retain Cash, Mobile Money, Bank Transfer and authorised Credit. Add split payments, partial payments/deposits and the ability to collect an existing customer's balance through the shared receivables services. Only offer card payment after a supported account/provider path exists.

Show tendered cash, change, each allocated payment, remaining amount and receipt references. Restrict change to the cash component. A cashier-entered mobile-money reference records money already received; it is not evidence of an automatic provider confirmation. Any future payment-provider integration needs its own status, reconciliation and retry contract.

Split payments require one canonical sale with several linked payment allocations, each scoped to the correct company, currency and account. Use exact decimal arithmetic and server-calculated totals. Prevent over-allocation, duplicate payment references where applicable, and conflict with manually recorded daily sales totals. Credit requires an eligible customer and current company/terminal controls.

### 4. Returns, refunds and corrections

Start from an original receipt. Allow full or partial item returns, with returned quantities bounded by what was sold minus previous returns. Record reason, condition, approving user, refund method and cash account. Distinguish resalable stock, damaged stock and no-stock-return cases.

Coordinate refund/credit, receivable correction, tax adjustment, inventory movement and journal posting through the core services. Refund only the eligible paid amount; a credit sale return may reduce debt rather than pay out cash. Print a linked return document. Keep immutable original records and reasons; no deletion of completed sales. Exchanges should be a linked return plus a new sale.

### 5. Daily accountability without cashier shifts

Keep the existing server-computed daily reports, cashier/terminal attribution, payment-method breakdown and pending-device totals. Use East Africa business dates consistently. Show acknowledged sales separately from unresolved or offline submissions. Cash Desk remains the place for authorised expenses, settlements and transfers; those movements must not create duplicate POS sales. No cashier shift, opening float, handover or shift-closing model or workflow will be introduced.

### 6. Shared customers and stock

Use Sales Desk's existing customer records. Search by name, code and phone; show balances only when permitted; allow customer creation through the shared customer service for authorised users. No second POS customer directory.

Use Inventory's existing products, units, balances and movements. Display quantity and snapshot freshness at the till. The server remains the authority on available stock at finalisation. Keep cost and valuation out of cashier payloads. Counts and receiving retain permission gates; approvals and office procurement detail belong in their existing apps. Discounts for damaged items do not replace inventory damage recording.

### 7. Receipts and documents

Support 58/80 mm receipts, company-branded A4/PDF receipts, reprints and linked return documents. Show sale number, date, branch, cashier, charged items, totals, payment allocations and customer where appropriate. Receipts use the app-wide company letterhead with Itemba Group fallback; roll receipts use a compact equivalent.

A printer failure must never rerun the sale. A queued/offline receipt must identify that its record awaits synchronisation. Copies retain the original identity. Sharing is a user action; do not automatically send customer documents.

Track fiscal status separately from printing and payment. Assess the existing EFD/VFD arrangements for each trading company and implement the confirmed integration contract where required. TRA publishes a receipt-processing interface and a receipt verification service; generating an ITEMBA PDF alone is not evidence of fiscal submission. [TRA receipt API](https://virtual.tra.go.tz/efdmsRctApi/), [TRA receipt verification](https://verify.tra.go.tz/Home/Index)

### 8. Terminal administration and reports

Provide terminal setup, assignment, activation/revocation, branch/account mapping, offline policy, price-change limits, language and printer settings. Restrict terminal reassignment while work is pending. Separate sell, price override, refund, return approval, receiving, stock count and terminal management permissions.

Cashiers need daily sales totals, payment breakdown, receipts and pending sync. Managers need branch/terminal/cashier sales, returns, discounts, outstanding credit and reconciliation exceptions. Reports can show authorised profit/margin data in the office; those fields must not enter the till API or offline cache.

## How it connects to ITEMBA OS

| App/service             | Ownership and connection                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organisation and access | Existing company → division → branch structure; terminal scope enforced server-side                                                                         |
| Sales Desk              | Same canonical sale/customer IDs, sale details, history, outstanding balances and document links                                                            |
| Cash Desk               | Canonical receipt/payment accounts, collections and refunds; trace to the originating sale                                                                  |
| Inventory               | Same products and stock movements; stock issue once per finalised sale and explicit return/disposition movements                                            |
| Invoice Desk            | Shared supplier/procurement references for authorised receiving; receiving goods does not imply paying an invoice                                           |
| Accounting              | Existing posting services for sales, VAT, inventory cost, collections and reversals; POS never independently constructs journals                            |
| Reports                 | Read posted source records; distinguish offline declarations, acknowledged transactions and final reconciled totals                                         |
| Documents               | Shared letterhead, PDF generation and canonical record links                                                                                                |
| PetroDollar             | Keep fuel-meter, tank and shift reporting there. Any later forecourt POS connection must map its transactions explicitly to prevent two sale/stock postings |
| Records                 | Remains the user's independent record book. No automatic mirrored sales, debts or expenses                                                                  |

Important boundary: the code contains both canonical `CashAccount`/business finance records and the separate `CashDeskAccount` register, plus canonical sales and Sales Desk direct entries. POS already uses the canonical business route. Link and expose that route clearly in the new app; do not copy its money into the separate register and count it twice.

Every transaction detail should offer permitted links to its sale, customer, receipt, payment, stock movement and accounting status. Invalidate shared views after changes so another open app window refreshes without losing its own filters.

## Architecture and resilience

### Complete the existing separation

Keep the `features/pos` core and hardware adapters. Introduce dedicated screen/layout components and a small application coordinator, then remove dependence on the legacy `KauntaShell` and its prop contract after parity is proven. Extract business components from legacy route-page modules rather than embedding Next.js pages or internal iframes.

Maintain explicit standalone and OS hosts using instance navigation. Preserve `/mobile-pos`, `/pos`, activation links, legacy receipt links and browser Back/Forward. Manager inspection windows can coexist; a selling terminal needs one active cashier controller/lease, with other windows clearly read-only or requiring a controlled handover. Independent drafts must never overwrite the terminal's count/purchase draft keys.

Add backend models only where needed: shared held-sale metadata, split-tender allocation and fiscal transmission status. Device-private unpaid carts initially reuse the existing versioned IndexedDB draft store. Reuse canonical sale/payment/refund/inventory models. Publish versioned request contracts and add migrations with reversibility and reconciliation checks. Do not rename shared tables merely to remove ITEMBA-R wording.

### Offline is a custody decision

Keep cash-only offline trading within the terminal's existing policy for the initial release. Credit, returns/refunds, split non-cash payments, provider confirmation and privileged overrides need online validation unless a later design explicitly proves a safe offline contract.

POS is an intentional exception to the general OS policy of not keeping business drafts in browser storage: offline trading needs a durable device queue. Document a separate POS retention and device-security policy. Keep sensitive contents out of localStorage; minimise terminal caches, protect IndexedDB contents/key handling, use restrictive application security controls and never claim browser encryption protects against an already compromised browser. Do not silently move cashier outboxes between devices.

Distinguish **unpaid held cart**, **saved offline sale**, **syncing**, **acknowledged**, **rejected** and **outcome uncertain**. Persist the intent and request identity before the first send. Reconcile an uncertain outcome by the original key and payload before permitting another charge. Reprinting, refreshing or service-worker updates must not submit another sale.

Use revision checks for held drafts and edit leases for active terminal custody. Ordinary OS appearance and appropriate acknowledged drafts may use the existing account/workspace services; offline outbox ownership remains device/terminal-bound. Recheck current permissions at sync. Clearly warn if an expired/revoked identity prevents settlement; preserve the pending transaction for an authorised resolution rather than discarding it.

No online design can promise exact global stock availability while independent terminals are offline. Limit offline exposure through explicit terminal policies and surface rejected/conflicting transactions for reconciliation. Update the service worker safely and defer disruptive updates while unsynchronised transactions exist.

## Delivery sequence and gates

| Phase                                 | Work                                                                                                                                                                                             | Completion gate                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Establish safe baseline            | Revalidate current release/pilot status, trace existing sale/payment/stock paths, verify role boundaries, persistent intent and uncertain-outcome recovery; audit height and shared device state | No duplicate after lost response/retry; existing offline outboxes recover; a documented feature/source map exists                               |
| 1. Design and OS foundation           | Design Sell, Pay, Receipt, Transactions, Held carts and Sync in light/dark phone/tablet/till layouts; define tokens and hosts                                                                    | Reviewed visual references; container resizing, focus, scanner ownership and full workspace maximisation work                                   |
| 2. Complete selling                   | Build native OS selling and module navigation, customer selection, price controls, held carts, drafts and sync centre                                                                            | One keyboard-only sale; two independent drafts; refresh/restart recovery; same records appear in Sales Desk                                     |
| 3. Complete payment lifecycle         | Split/partial payments, collections, returns/refunds and receipt/fiscal status integration                                                                                                       | Cash, customer balance, inventory and journal entries reconcile through sale, collection, return and retry                                      |
| 4. Complete stock and daily reporting | Native receiving/count/history screens and daily sales reports                                                                                                                                   | Daily totals match canonical sales; offline declarations remain separate; authorised workflows preserve scope and costing controls              |
| 5. Hardware and release hardening     | Real printers/scanners, PDFs, accessibility, performance, fiscal acceptance, migrations and operating runbook                                                                                    | Device matrix and business workflow tests pass; no misleading payment/print/fiscal success; rollback rehearsed                                  |
| 6. Pilot and retirement               | Enable by selected terminal/branch, observe real trading, expand gradually; retire classic/Kaunta UI after parity and accepted stability                                                         | Agreed pilot evidence, clean reconciliation and usable recovery; old links/outboxes preserved; old shells removed only after rollback need ends |

Finish each phase with reviewable staging evidence. New financial capabilities require additive migrations and service tests. Keep a per-terminal rollout control; rollback must read new queue/draft formats or activation of those formats must be deferred until compatible. A frontend rollback cannot undo completed business transactions.

## Acceptance scenarios

1. Cash, mobile money, bank transfer and credit produce one canonical sale, correct receipt, stock effect and finance result.
2. Split tender and a later partial collection update the same outstanding balance; reversing a payment restores that balance once.
3. Two concurrent terminals attempt the last unit; online enforcement and offline exception handling remain explainable.
4. Lose the response after a committed sale, refresh, retry and reconnect; still exactly one sale/payment/stock issue.
5. Hold cart A, sell cart B and resume A; separate OS windows cannot change one another's customer, prices or draft.
6. Cold-start an authorised offline terminal, sell cash, restart and sync; work survives and a rejected item remains resolvable.
7. A partial return, repeat return attempt, refund and damaged stock disposition do not over-refund or over-restock.
8. Cash change, daily payment breakdown and Cash Desk movements reconcile; expenses and transfers do not create additional POS revenue.
9. Revoked permission, expired identity, reassigned branch or stolen/revoked terminal cannot submit outside its authorised scope.
10. Printer disconnect and reprint create no sale/payment replay; fiscal retry has its own protected identity.
11. Sell and navigate entirely by keyboard; screen-reader dialogs, focus restoration, dark/custom themes and reduced effects remain usable.
12. Verify 390/768/1,440/1,920 px, short and snapped windows, maximisation, 200% zoom and phone keyboards with the Pay control reachable.
13. Measure production-build input latency and dragging with six populated OS windows, including duplicate inspection views. Target p95 interactive response under 200 ms on agreed devices and no shell-induced long tasks during a 60 Hz drag; measure rather than claim this in advance.
14. Reconcile end-to-end reports and exports using realistic staging transactions across cashier, branch, company and group roles. Pilot reports must show posted totals separately from pending device work.

## Later enhancements

After the complete till is stable: customer-specific price agreements, loyalty, quotations/order-to-counter conversion, delivery/collection coordination, promotions, bundles, batch/serial/expiry sales where relevant, scales/label printing, integrated payment providers and customer-facing displays. Keep multi-currency tills and fuel-pump control as separately scoped projects. Camera scanning remains excluded under the earlier owner decision unless changed.

## Decisions to resolve before dependent work

Use existing choices as defaults: Swahili first, TZS tills, shared organisation/customer/product records, controlled price edits, hardware scanning and browser-print fallback. Cashier shifts are excluded. Before hardware/fiscal acceptance, confirm actual printer/scanner models and each company's current receipt integration. Before payment implementation, agree refund approval and collection policies with the operating team. These are targeted phase decisions, not reasons to stop foundation work.

## Source references

- `POS_REMAKE_PLAN_2026-09-23.md` and `POS_PILOT_RUNBOOK_2026-09-23.md`: historical decisions and rollout design.
- `frontend/src/features/pos/ui/PosShell.tsx` and `pos-app.css`: current selling UI, legacy module handoff and layouts.
- `frontend/src/components/westsides/mobile-pos-lite/mobile-pos-lite.tsx`: sale coordinator and request construction.
- `frontend/src/features/pos/core/`, `frontend/src/lib/mobile-pos-lite-store.ts`: core hooks, host guard and device persistence.
- `frontend/src/components/os/desktop-pos.tsx`, `frontend/src/lib/apps.ts`: OS hosting and launcher identity.
- `frontend/src/features/sales-desk/sales-desk.tsx`, `frontend/src/features/cash-desk/cash-workspace.tsx`: canonical business routes and separate direct registers.
- `backend/src/modules/mobile-pos-lite/`: terminal scope, sale/receiving/count/day report contracts and PDF generation.
- `backend/src/modules/sales-orders/sales-orders.service.ts`, `backend/src/modules/customer-payments/`, `backend/src/modules/refunds/`: shared business lifecycle candidates.
- `database/prisma/schema.prisma`: existing canonical and separate desk models.
- [Apple materials](https://developer.apple.com/design/human-interface-guidelines/materials), [WCAG 2.2](https://www.w3.org/TR/WCAG22/): design/accessibility references.
- [Web Bluetooth](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API): limited browser availability is why direct printing requires a tested device matrix and fallback.
- [TRA receipt API](https://virtual.tra.go.tz/efdmsRctApi/), [TRA receipt verification](https://verify.tra.go.tz/Home/Index): starting points for confirmed fiscal integration.
