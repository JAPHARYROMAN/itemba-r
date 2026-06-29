# Flow Pages Improvement Plan — Inbound / Outbound / Valuation

**Scope:** the order-to-cash and procure-to-pay *flow* surfaces of the ERP — purchase-orders, sales-orders (list + detail), mobile-pos, profit/valuation, the shared order-line-editor, GRNs, supplier-invoices, and three-way-matching.

**Companion document:** [`INVENTORY_PAGES_IMPROVEMENT_PLAN.md`](./INVENTORY_PAGES_IMPROVEMENT_PLAN.md) covers the six core inventory pages (balances, movements, locations, products, categories, adjustments). This plan does **not** repeat that work. Where a flow fix depends on stock coupling or inventory valuation, it is cross-referenced as **[INV]**.

All findings below are already grounded and adversarially verified. Priorities: **P0** = correctness/money/lifecycle blocker, **P1** = high-value structural, **P2** = important consistency/control, **P3** = polish. Effort: **S** ≈ <0.5d, **M** ≈ 0.5–2d, **L** ≈ multi-day/design-first.

---

## 1. Executive summary — the highest-leverage moves

These are the moves that matter most, money/lifecycle bugs first:

1. **Inventory is valued at *quoted* PO price, never the price the supplier actually billed (P0, valuation).** The GRN posts the `PURCHASE_RECEIPT` movement at `poLine.unitCost`; supplier-invoice approval posts AP but **never re-values `InventoryBalance.averageCost`**. Any PO-vs-invoice price delta is permanently wrong in WAC, and every downstream COGS/margin inherits the error. `GoodsReceivedNoteLine` has no `unitCost` column at all. Worse, a receipt with **no PO match or a UoM mismatch passes `unitCost=undefined` and throws in `assertInventoryMovementHasCost`, aborting the entire receipt transaction** — some legitimate receipts simply cannot post. This is the single biggest valuation-integrity hole in the chain. (`goods-received-notes.service.ts:215-245`, `supplier-invoices.service.ts` `postSupplierInvoicePayable:446`, `profit.service.ts:183-188`)

2. **A paid sales order can be silently cancelled with no cash refund or reversing journal (P0, money).** `cancel()` allows `[DRAFT, CONFIRMED]`, but a fully/partially-paid credit order is still `CONFIRMED` (payment lives in `paymentStatus`, never advances `status`). Cancel zeroes the receivable outstanding, leaves `paidAmount` untouched, reverses stock, and posts **no** reversing GL/cash entry — ledger and inventory drift apart. (`sales-orders.service.ts` cancel `2299-2385`, `syncSalesOrderPaymentFromReceivable` in `receivables.service.ts:684-692`)

3. **Three-way matching trusts operator-typed variances (P0, control + money).** The manual create modal lets a clerk hand-key `quantityVariance`/`amountVariance`/`matchStatus`; `create()` persists them verbatim and `approve()` posts a real `PURCHASE_VARIANCE` GL entry off that fabricated number. A falsely-zeroed variance silently skips the posting. The Decimal-precise computed matcher already exists in `supplier-invoices.service.ts` — extract and use it. (`three-way-matching/page.tsx:365-366`, `three-way-matching.service.ts:53`)

4. **Supplier-invoice approval is non-atomic and double-postable (P0, lifecycle).** `approve()` reads status in JS outside a guarded claim (unlike SO/PO/GRN which use `updateMany({where:{id,status}})`), and `Payable` has no `@@unique(sourceType,sourceId)`. Two concurrent approvals each create a payable and post AP → doubled accounts-payable. (`supplier-invoices.service.ts:263-371`, `schema.prisma:2201-2241`)

5. **The Profit report overstates gross profit by counting NULL-COGS lines as zero-cost (P0, valuation trust).** `productSummary` has no `cogsAmount` filter; lines whose cost was never snapshotted contribute full revenue and 0 cost, inflating profit/margin. The empty-state copy actively reinforces the false belief that such lines are excluded. Flag them, don't drop them. (`profit.service.ts:316-348`, `page.tsx:529`)

6. **The procure-to-pay chain is invisible from the PO and the GRN page is a pre-design-system stub (P1, structural).** Purchase orders have no `[id]` control-center (only print), so a buyer cannot see receipts, the supplier invoice, the match variance, or the payable from the PO. The GRN list is 63 lines of raw `fetch`, no permission gate, no shared primitives, renders raw UUIDs, references a status (`PENDING`) not in the enum — and **always renders empty** because the paginated response shape never matches what the page reads, so today the GRN register shows nothing at all. The supplier invoice already *holds* PO/GRN/match/payable references but renders them all as dead text.

7. **Partial receipt is structurally impossible and over-receipt is unguarded (P1, lifecycle).** `PARTIALLY_RECEIVED` is read but never written; GRN `post()` issues per-line accepted qty then unconditionally flips the PO to `RECEIVED`, stranding the unreceived remainder forever. There is also no check that accepted qty ≤ ordered-minus-received, so a GRN can post 1000 units against a 100-unit PO line. (`goods-received-notes.service.ts:234-271`)

8. **Five incompatible money formatters and no FX model across the flow (P1, consistency + valuation).** The same TZS amount renders three different ways depending on the page; three-way-matching has unbounded decimals; multi-currency invoices/POs post and reconcile as if single-currency (USD numbers into a TZS ledger, cross-currency `Outstanding` sums). Consolidate formatters and at minimum **lock document currency to the company functional currency**.

9. **Two newly-verified money bugs in the daily-driver surfaces (P1).** The POS rewrites the operator's chosen tender via `paymentMethodForAccount` (BANK_CARD silently recorded as BANK_TRANSFER, corrupting the GL reference and receipt) and posts every sale with **zero VAT/discount** despite the backend supporting both — so an 18% VAT retailer books no output-VAT leg. On the PO side, for VAT-registered companies recoverable input VAT is **capitalized into inventory cost** (full tax-inclusive total debited to INVENTORY_ASSET, no VAT-input account), inflating WAC. (`mobile-pos-sale-entry.tsx:1210,1218-1219`; `purchase-orders.service.ts:677-680,1085-1120`)

---

## 2. Cross-cutting improvements

| Priority | Improvement | Affected pages | Grounded in |
|---|---|---|---|
| **P0** | **Landed-cost reconciliation** — re-value `InventoryBalance.averageCost` on supplier-invoice approval (or three-way match) for the PO-vs-invoice delta; add `unitCost`/landed-cost to `GoodsReceivedNoteLine`. **[INV]** | GRNs, supplier-invoices, three-way-matching, profit, SO detail, inventory-balances | `goods-received-notes.service.ts:245`, `supplier-invoices.service.ts:446-509`, `schema.prisma:12828-12846` |
| **P0** | **Guard money-losing lifecycle reversals** — block/refund cancellation of paid SOs (cash + reversing journal); post reversing GL on SO cancel for cash sales. **[INV]** | SO list, SO detail | `sales-orders.service.ts:2299-2385`, `1936-1945` |
| **P0** | **Atomic + idempotent approvals** — guarded status CAS (`updateMany` count===1) + partial unique index `Payable(companyId, sourceType, sourceId) WHERE deletedAt IS NULL`; same for `ThreeWayMatch(companyId, supplierInvoiceId)`. | supplier-invoices, three-way-matching | `supplier-invoices.service.ts:263-371`, `three-way-matching.service.ts:53`, `schema.prisma:2201-2241,12914-12941` |
| **P0** | **Computed (not typed) variances** — extract the Decimal matcher into a shared service; drive both the manual page and `run-match` from it; user reviews, never types. | three-way-matching, supplier-invoices | `three-way-matching/page.tsx:365-366`, `supplier-invoices.service.ts:711-724,784-809` |
| **P0** | **Rebuild the GRN page on the canonical template** (`backendPage` + `useAuth` gate + PageHeader/StatCard/PageToolbar/StatusBadge + pager); resolve company/supplier names; drive status from real `GRNStatus`; add Approve/Post actions. Highest-leverage consistency fix in the set. | GRNs | `procurement/grns/page.tsx` (whole file) |
| **P1** | **PO control-center** — add `purchase-orders/[id]/page.tsx` (Lines & Receiving / GRNs / Supplier Invoice & Variance / Payable / Inventory Movements / Audit) + a "View" row action, mirroring the SO detail. | purchase-orders, supplier-invoices, three-way-matching | `operations/purchase-orders/` (only `page.tsx` + `[id]/print`); SO detail `[id]/page.tsx` |
| **P1** | **Drill-through everywhere** — make already-loaded references clickable: SI → PO/GRN/match/payable; SO detail → delivery notes/movements/journal/specific receivable; profit ledger → SO; PO/GRN ↔ each other. Add `referenceType`/`referenceId` to inventory movements for reverse edges. **[INV]** | supplier-invoices, SO detail, profit, inventory-movements, purchase-orders | `supplier-invoices/page.tsx:1041-1083`, `sales-orders/[id]/page.tsx:496-637`, `profit/page.tsx:600-605`, `inventory-movements/page.tsx:39,350` |
| **P1** | **Lifecycle integrity** — implement true partial receipt + over-receipt guard; add status guard + typed DTO to GRN `update()`; align UI cancel gates with backend allow-lists. | GRNs, purchase-orders, SO list/detail | `goods-received-notes.service.ts:87-110,234-271`, `purchase-orders.service.ts:1141-1143`, `sales-orders.service.ts:2302-2304` |
| **P1** | **Confirm-dialog all ledger-posting actions** — route Confirm/Cancel (SO + PO) through `confirm-dialog` with a side-effect summary; derive success toasts from the response, not hard-coded text. | SO list, SO detail, PO list | `confirm-dialog.tsx` exists; `sales-orders/page.tsx:1618-1638,1334`, `purchase-orders/page.tsx:1262-1287` |
| **P1** | **Currency safety** — lock document currency to the company functional currency (or assert match in `assertProcurementReferences`/`assertReferencesBelongToCompany`); validate `cashAccount.currency === order.currency`; fix cross-currency `Outstanding`/`syncSupplierBalance` sums. Includes the mixed-currency PO `Total Cost (page)` stat + hardcoded-TZS `fmtMoney` symbol. | supplier-invoices, three-way-matching, PO, SO, profit | `supplier-invoices.service.ts:568-679,881-899`, `sales-orders.service.ts:1673-1706,2089-2151`, `purchase-orders/page.tsx:998-1004,186-188` |
| **P1** | **Unit-conversion in the SO/issue + receipt path** — thread `conversionFactor` through `calculateLineTotals`/`createMovement` so a non-base sales/receipt unit is converted to base before the balance write; stop the products endpoint conflating `defaultUnitId` with `baseUnitId` if sales-unit selling is introduced. The conversion factor data already exists and is unused. **[INV]** | mobile-pos, sales-orders, GRNs, inventory-movements | `units.service.ts` (factor unused), `inventory-movements.service.ts:249-292`, `products.service.ts:328` |
| **P1** | **Modal focus management (one fix, eight forms)** — add focus trap + initial focus + restore-on-close + `useId()` title id in the shared `Modal`. | all flow forms via `components/ui/modal.tsx` | `modal.tsx:48-93` |
| **P1** | **Debounce + abort list search** — debounce search (~250–300ms) before the `load()` dep chain; thread `AbortSignal` through `backendPage/backendGet`; don't refetch the workbench summary on pure pagination. | SO list, PO list, supplier-invoices, three-way-matching | `sales-orders/page.tsx:1188-1215,1432-1435`, `purchase-orders/page.tsx:852-862`, `api-client.ts` (no AbortController) |
| **P2** | **DB-aggregate the stat cards** — replace `findMany`-then-JS-reduce with `groupBy`/`_sum` (revenue via raw SUM where qty\*price-discount can't be expressed); add a PO workbench-summary; fix profit's 1000-row truncation (distorts totals **and** the per-product table). | SO list, PO list, profit, three-way-matching | `sales-orders.service.ts:514-565`, `profit.service.ts:335-348`, `purchase-orders/page.tsx:998-1004` |
| **P2** | **Centralize status/lifecycle enums + one CURRENCIES list** — move `SALES_STATUSES`/`PURCHASE_STATUSES`/`PAYMENT_STATUSES`/`SUPPLIER_INVOICE_STATUSES`/`MATCH_STATUSES` into shared constants; reconcile the two conflicting CURRENCIES lists; remove/implement unreachable statuses (`VOIDED`, SI `CANCELLED`). | SO list, PO, supplier-invoices, three-way-matching | `sales-order-constants.ts`, `sales-orders/page.tsx:242-243`, `purchase-orders/page.tsx:141-159`, `supplier-invoices/page.tsx:163-173` |
| **P2** | **One shared line-math + line-editor** — extract line-total/totals math (incl. documented discount semantics: per-unit sales vs flat purchase) into one helper; migrate supplier-invoices onto `OrderLineEditor` (or a new `variant="invoice"`); add a shared `roundMoney` so UI totals equal persisted totals. | order-line-editor, supplier-invoices, mobile-pos | `order-line-editor.tsx:269-393`, `supplier-invoices/page.tsx:229-303,657-735` |
| **P2** | **Export/pager parity** — extract the duplicated PO/SO `exportCsv` into one helper; add Export + manual pager to supplier-invoices, GRNs, three-way-matching. | PO, SO, supplier-invoices, GRNs, three-way-matching | `purchase-orders/page.tsx:869-946`, `sales-orders/page.tsx:1218-1297` |
| **P2** | **Table & control a11y** — `scope="col"` + `sr-only` caption on every register table; non-color cue for sign-coded amounts; keyboard-operable clickable rows (`role`/`tabIndex`/`onKeyDown`); combobox semantics for mobile-pos search. | all flow tables, three-way-matching, mobile-pos | `three-way-matching/page.tsx:296,303-304`, `profit/page.tsx:542-548`, `mobile-pos-sale-entry.tsx:2147-2181` |
| **P2** | **Server-side recompute backstop** — even with computed-variance UI, recompute from lines in `create()`/`approve()` and post the JE against the recomputed amount; have `postVarianceIfNeeded` read the updated row, not the stale `existing`. | three-way-matching, supplier-invoices | `three-way-matching.service.ts:50-73,90-111` |
| **P3** | **Canonical formatters/date helper + Alert primitive** — adopt `formatMoney({decimals:2})`/`formatDate`/`formatPercent`; **introduce a true local-date helper** (do NOT route through `formatDateOnly` — it has the identical UTC-shift bug); replace ~15 copy-pasted red error-banner divs with `ErrorState`/Alert. | all flow pages | `formatters.ts:12-29`, `report-export.ts:71-75`, error-banner divs across pages |
| **P3** | **PageToolbar/FilterSelect parity** — extract the byte-for-byte duplicated `filterSelectCls/filterStyle` selects into a shared `FilterSelect`; move three-way-matching filters into PageToolbar; standardize `StatusBadge` on the `value=` prop. | PO, SO, supplier-invoices, three-way-matching, profit | `purchase-orders/page.tsx:990-996` vs `sales-orders/page.tsx:1357-1363` |

---

## 3. Per-page plan

### 3.1 Purchase Orders (`operations/purchase-orders/page.tsx`)
*Current state:* full list + print, but no detail control-center; the UI offers a Cancel transition the backend rejects on RECEIVED, recoverable input VAT is capitalized into stock cost, `PARTIALLY_RECEIVED` is a phantom state, and stat cards aggregate only the current 20-row page.

| Priority | Improvement | Impact | Effort | Grounded in |
|---|---|---|---|---|
| P1 | Add `[id]` control-center + "View" row action (mirror SO detail) | high | L | dir has only `page.tsx` + `[id]/print`; SO `[id]/page.tsx` |
| P1 | Remove `RECEIVED` from the Cancel condition so Cancel shows only for CONFIRMED (DRAFT uses Delete) — currently a dead button that 400s and falsely implies a posted receipt can be undone; treat a real reversal/return flow as a separate backlog item | high | S | `page.tsx:1278`, `purchase-orders.service.ts:1141-1143` |
| P1 | Input VAT wrongly capitalized into inventory for VAT-registered companies (not a double-count): receive folds per-line tax into `unitCost` and `postPurchaseOrderLedger` debits the full tax-inclusive total to INVENTORY_ASSET with no recoverable-VAT account. For VAT-registered entities capitalize at net `(extended − discount)/qty` and post recoverable VAT to a VAT-input GL account; **leave tax-in-cost for non-registered entities** (gate on a VAT-registration flag — confirm one exists). Coordinate avg-cost recompute with the inventory plan **[INV]** | high | L | `purchase-orders.service.ts:677-680,70,1085,1090,1113-1120`; `tax-auto-apply.service.ts:309-318` |
| P1 | Confirm-dialog Confirm/Cancel (post tax-apply / cancel payable) | medium | S | `page.tsx:1262-1287`, `doAction:960-977` |
| P1 | Debounce + abort list search (shared cross-cutting fix) | medium | M | `page.tsx:852-862,1083-1086` |
| P1 | Canonical purchase-cost definition shared with GRN receive path **[INV valuation]** | high | M | `purchase-orders.service.ts:677-680` vs `goods-received-notes.service.ts:245` |
| P2 | Defer the cash-PO PAID transition to receive: `paymentStateForPurchaseType` marks CASH_PURCHASE DRAFTs Payment=PAID / Outstanding=0 on creation, before any cash credit or GL posting (those happen at receive), so an unreceived/cancellable cash PO reads as fully settled in list/print | medium | S | `purchase-orders.service.ts:77-83,302,326-329,1092,1126`; `page.tsx:1253` |
| P2 | Remove the phantom `PARTIALLY_RECEIVED` from the UI filter list, the Received stat, and the Receive-enable condition — it is read in guards but never written (receive is all-or-nothing); treat real per-line partial receiving as a separate large feature | medium | S | `purchase-orders.service.ts:649,812`; `goods-received-notes.service.ts:266`; `page.tsx:1000-1002,1272` |
| P2 | Add `CONFIRMED`/`RECEIVED`/`PARTIALLY_RECEIVED` to `BADGE_MAP` (the two key statuses currently fall through to neutral zinc); **separately** add `'received'` to the success branch of `documentStatusTone` so the print document stops rendering RECEIVED neutral (BADGE_MAP does not feed print) | medium | S | `status-badge.tsx:1-107,121`; `document-utils.ts:65-99` |
| P2 | Demote the money stat card (`Total Cost (page)`) to a per-page count or remove it: it sums only the fetched 20-row page across **mixed currencies** with no conversion and renders a hardcoded TZS symbol via `fmtMoney`; a true register total needs a backend filtered-aggregate endpoint, currency-grouped/converted | medium | M | `page.tsx:998-1004,1061,186-188` |
| P2 | Add a destination-tank selector (and per-line received qty) to `ReceiveOrderModal` populating `fuelTankAllocations` for fuel lines with 0/>1 tanks — the modal posts an empty body so multi-tank fuel POs hit an unsatisfiable 400; alternatively route fuel POs to the Petroleum receive flow | medium | L | `page.tsx:738,781`; `purchase-orders.service.ts:975-987`; `receive-purchase-order.dto.ts:31-37` |
| P2 | Centralize PURCHASE_TYPES/STATUSES/PAYMENT_STATUSES; drop duplicate CURRENCIES | low | S | `page.tsx:141-159` |
| P2 | Extract shared `exportCsv` helper (dedupe vs SO) | low | S | `page.tsx:869-946` |
| P3 | Apply `roundMoney` in `calcLineTotals` and to subtotal/discount/tax/total at persistence, and derive the payable from the same rounded total the journal posts (raw payable vs rounded journal can drift sub-cent) | low | S | `purchase-orders.service.ts:69-74,282-301,381-400,779-781,1085` |
| P3 | Optimistic-concurrency guard on `update()`: return `updatedAt`, require it on PATCH, do the line delete+recreate via `updateMany` matching id AND `updatedAt` (currently DRAFT-only last-write-wins) | low | M | `purchase-orders.service.ts:350-443` |
| P3 | Swap hand-rolled filter `<select>`/`<input>` to `FormSelect`/shared input; render the register via `DataTable`/`ResponsiveDataTable` with a custom actions column | low | M | `page.tsx:990-1173,1192-1298`; `data-table.tsx`; `docs/responsive-tables-adoption.md` |
| P3 | Adopt `formatDate` + `formatMoney` for row date/money, **passing `{decimals:2}`** to preserve cents (a naive swap silently drops cents — `formatMoney` defaults to 0 decimals) | low | S | `page.tsx:1233,186-189,895`; `lib/design-system/formatters.ts:27-28` |

### 3.2 Sales Orders — list (`operations/sales-orders/page.tsx`)
*Current state:* solid list with workbench summary, but `status` never advances with payment, the status filter exposes states no order reaches, and Confirm/Cancel fire with no dialog.

| Priority | Improvement | Impact | Effort | Grounded in |
|---|---|---|---|---|
| P0 | Block silent cancel of a paid credit order; require refund/credit-note + reverse cash/journal if allowed | high | M | `sales-orders.service.ts:2302-2358`, `page.tsx:1628-1631` |
| P1 | Advance `salesOrder.status` alongside `paymentStatus`; define a real state machine; centralize `SALES_STATUSES`; implement or remove `VOIDED` | high | M | `receivables.service.ts:684-692`, `page.tsx:242,1481` |
| P1 | Confirm-dialog Confirm/Cancel; derive success toast from response (stock issued/reversed, cash vs receivable) | medium | S | `page.tsx:1618-1640,1334,1857-1858` |
| P1 | DB-aggregate workbench summary (`groupBy` + `_sum`, preserve CANCELLED/VOIDED exclusion) | medium | M | `sales-orders.service.ts:514-565` |
| P1 | Debounce search + abort/request-id guard on `load()` | medium | M | `page.tsx:1188-1191,1432-1435` |
| P1 | Lock currency to functional (or block confirm on mismatch); validate `cashAccount.currency` | high | M | `sales-orders.service.ts:2089-2151,1673-1706` |
| P3 | Local-calendar default order/payment dates (new helper, NOT `formatDateOnly`) | low | S | `page.tsx:347` |
| P3 | Clean up `replayQuickSale` dead `PAID` branch (folds into state-machine work) | low | S | `sales-orders.service.ts:2290` |
| P3 | Guard non-credit confirm with null `cashAccountId` (robustness) | low | S | `sales-orders.service.ts:1893-1945,2097-2100` |
| P2 | Rate-based tax tied to product/customer tax profiles (roadmap feature) | medium | L | `order-line-editor.tsx:903-910`, `tax-auto-apply.service.ts:53` |

### 3.3 Sales Orders — detail (`operations/sales-orders/[id]/page.tsx`)
*Current state:* the order-to-cash hub aggregates the right data but renders cross-entity rows inert and fires destructive Cancel with no dialog.

| Priority | Improvement | Impact | Effort | Grounded in |
|---|---|---|---|---|
| P1 | Confirm-dialog (danger) on Cancel naming side effects (stock reversal + receivable cancellation) | high | S | `page.tsx:323-331`, `sales-orders.service.ts:2306-2365` |
| P1 | Make aggregated rows clickable: delivery note→DN, movement→inventory-movements, journal→journal-entries, deep-link the specific receivable; add `?tab=` deep-linking | medium | M | `page.tsx:468,496-510,532-543,620-637` |
| P1 | Link Profit tab product rows → `/operations/profit?productId=` | medium | S | `page.tsx:577-594` |
| P2 | Tighten Cancel gate to `CONFIRMED` (PARTIALLY_PAID/PAID branches are dead) | medium | S | `page.tsx:323` |
| P3 | Use shared `ErrorState`; aurora tokens for tabs/tables; ARIA tab roles; empty state for Lines & Stock; numeric `Record Payment` input | low | M | `page.tsx:246-263,357-372,421-449,156-161` |

### 3.4 Mobile POS (`components/westsides/mobile-pos/mobile-pos-sale-entry.tsx`)
*Current state:* functional counter sale entry, but it corrupts the recorded tender type by deriving payment method from account type, always posts zero VAT/discount, search dropdowns are keyboard-inoperable, and printing uses deprecated `document.write` with a fixed timer.

| Priority | Improvement | Impact | Effort | Grounded in |
|---|---|---|---|---|
| P1 | Send the operator-chosen payment method verbatim: `checkout()` and the account-select `onChange` rewrite the method via `paymentMethodForAccount`, collapsing BANK_CARD→BANK_TRANSFER and corrupting the recorded tender, the GL "Cash sale" reference, and the receipt. Send `settings.paymentMethod` directly; keep `paymentMethodForAccount` only to nudge when the current method is *incompatible* with the picked account | high | S | `mobile-pos-sale-entry.tsx:1210,308-320,1695,2608,326-328,577,1887`; `sales-orders.service.ts:1335,1404,89-92,64-66,1682-1684` |
| P1 | Add per-line discount + branch-default VAT plumbing onto the existing backend contract: the line payload hardcodes `discountAmount:0,taxAmount:0` and the cart summary hardcodes "TZS 0.00", so no output-VAT leg is ever posted for an 18% TRA-VAT retailer. DTO/`calculateLineTotals`/`postSalesOrderLedger` already accept and post them. **Send discount PER-UNIT** (`calculateLineTotals` multiplies by qty; note `profit.service.ts:268` treats the same field as a line total) **[INV]** | high | L | `mobile-pos-sale-entry.tsx:1218-1219,1726-1727,1033-1036`; `create-sales-order.dto.ts:39-48`; `sales-orders.service.ts:122-158,2102,2125-2134`; `profit.service.ts:268` |
| P2 | Block CREDIT checkout unless a real `customerId` is selected (frontend guard + backend assertion): a credit sale to an anonymous/generic walk-in creates an open Receivable with `customerId:null` and no credit-limit check — effectively uncollectable/unreconcilable AR. `canCheckout` doesn't require a customer for CREDIT | medium | M | `mobile-pos-sale-entry.tsx:1044-1050`; `sales-orders.service.ts:1304-1331,340-341,1720,1915-1935` |
| P2 | Make the search results a proper ARIA combobox: rows fire only `onMouseDown` (Enter/Space dead for keyboard), inputs lack `role=combobox`/`aria-expanded`/`aria-activedescendant`, containers lack `role=listbox`, `handleSearchKey` supports only Enter. Add Arrow nav + Enter-select + Escape-close and switch to `onClick` | high | M | `mobile-pos-sale-entry.tsx:2147-2151,2178-2182,1479-1518,1614-1652,1171-1179` |
| P2 | Print via a hidden same-document iframe (print on load, after fonts/images) or the existing `/operations/sales-orders/[id]/print` route, replacing `document.write` + hardcoded 250ms `setTimeout`; add a 58/80mm thermal `@page` variant | medium | M | `mobile-pos-sale-entry.tsx:1258-1271,1958-1968,547,560` |
| P2 | Prefix currency code in `formatMoney`; adopt shared formatters | low | S | `lines 220,227` |
| P3 | Re-validate stock/cost against a fresh fetch immediately before posting (or surface the backend's specific Insufficient-stock message): `availableStock`/`effectiveCost` are frozen at add-time. UX only — correctness is already server-enforced (`FOR UPDATE` + guarded claim) | medium | M | `mobile-pos-sale-entry.tsx:1093-1146,998-1031,1181-1240`; `inventory-movements.service.ts:234-261` |
| P3 | Remove the hardcoded `'kisimani'` branch bias from `receiptAccountScore` (a tenant-specific literal biasing which cash drawer is credited); if stronger branch affinity is wanted, raise the weight of the existing normalized branchName match | low | S | `mobile-pos-sale-entry.tsx:371,369-370` |
| P3 | Disclose that naming a walk-in creates a persistent customer: a non-generic typed name auto-creates a permanent `WALK_IN` Customer (consuming a code) with no UI hint, proliferating near-duplicate one-offs | low | S | `mobile-pos-sale-entry.tsx:1224-1226`; `sales-orders.service.ts:218-230,341,342-389` |
| P3 | Require `paymentReference` for MOBILE_MONEY/BANK_TRANSFER at checkout (the field is shown for non-CASH but never enforced; these are the methods with a slip/confirmation code) | low | S | `mobile-pos-sale-entry.tsx:1711-1719`; `create-sales-order.dto.ts:119-122` |

> Note: a POS-scoped "issue stock against `baseUnitId`" item was **dropped** — the products endpoint already synthesizes `defaultUnitId = baseUnitId`, so the POS already issues at the base unit. The real concern (no unit conversion anywhere in the SO/issue path) is re-filed as a cross-cutting **[INV]** row in §2.

### 3.5 Profit / Valuation (`operations/profit/page.tsx`)
*Current state:* headline cards overstate gross profit (NULL-COGS counted as zero cost), aggregation truncates at 1000 rows, the Division filter is a no-op, and Fix Cost patches the balance with no GL entry.

| Priority | Improvement | Impact | Effort | Grounded in |
|---|---|---|---|---|
| P0 | Flag (don't drop) NULL-COGS lines: return `linesMissingCost`/`revenueMissingCost`, badge Revenue + Gross Profit cards, fix empty-state copy | high | M | `profit.service.ts:316-372`, `page.tsx:486-529` |
| P1 | Replace 1000-row JS aggregation with `groupBy` (_sum cogs/qty/profit) + raw SUM for revenue; apply to export; fixes per-product table + CSV distortion too | high | M | `profit.service.ts:335-348,519` |
| P1 | Fix Division→Branch cascade (adopt `ScopeSelector` or filter by `divisionId`); remove always-true filter | medium | S | `page.tsx:355-359`, `use-org-scope.ts:101,161-168` |
| P1 | Fix Cost via inventory revaluation/ADJUSTMENT movement posting to GL; interim confirm-dialog showing before/after **[INV]** | high | L | `profit.service.ts:613-640,872-873` |
| P2 | Scope cost-gaps consistently (master half ignores `branchId`; stock half ignores `divisionId`) so card matches filter | medium | S | `profit.service.ts:391-463` |
| P2 | Backfill: chunked `$transaction` + confirm-dialog; document current-avg-cost basis; stretch: as-of-sale-date cost | medium | M | `profit.service.ts:663-785`, `page.tsx:412-416` |
| P2 | Adopt shared formatters (`{decimals:2}`) + report-export helpers; UTC-consistent default date range | medium | M | `page.tsx:100-124,229-253` |
| P2 | Single-currency guard/warn (gate full FX grouping on confirmed multi-currency usage) | medium | M | `profit.service.ts:341-348` |
| P3 | One color threshold (≥0) on both cards; distinguish zero-COGS-by-design rows; `role=status`/`aria-live` banners; shared table primitives | low | M | `page.tsx:421-431,489-500`, `profit.service.ts:282-285` |

### 3.6 Order Line Editor (`operations/_components/order-line-editor.tsx`)
*Current state:* cleanly shared by PO + SO, but sums at float precision, exposes one `discountAmount` field with three different meanings across surfaces, has no blocking validation in the purchase variant, and coerces blank/garbage number input to 0.

| Priority | Improvement | Impact | Effort | Grounded in |
|---|---|---|---|---|
| P1 | Make discount semantics explicit/self-documenting: `discountAmount` means PER-UNIT for SO (`qty × unitDiscount`), FLAT-per-line for PO, and FLAT for supplier-invoices (which reimplements its own line + a divide-by-qty reload hack). Introduce `discountMode:'PER_UNIT'|'FLAT'` (or distinct field names) through the DTOs + editor prop, document on both line DTOs, and migrate supplier-invoices onto the shared `OrderLineEditor`. No live bug today, but a high-probability future-corruption trap with real money impact | high | M | `order-line-editor.tsx:883`; `sales-orders.service.ts:149,1500-1501`; `sales-orders/page.tsx:720,408-412`; `purchase-orders.service.ts:49,63-70`; `procurement/supplier-invoices/page.tsx:229-234,454` |
| P2 | Add shared `roundMoney`: round each line's extended/discount to 2dp before composing `lineTotal`, then derive header subtotal/discount/tax/total by summing the **rounded** line values, in both the editor and `calculateLineTotals`/`calcLineTotals`. Today header subtotal and Σ(persisted lineTotal) can diverge by a cent or two for fractional unit price/qty | medium | M | `order-line-editor.tsx:378-393,275-278`; `sales-orders.service.ts:151-157,81-83`; `purchase-orders.service.ts:63-75,106-108`; `schema.prisma:2944-2947,3109-3111` |
| P2 | Wire PO pre-submit validation symmetrically: have the editor emit `hasBlockingErrors` for missing product/unit/qty regardless of variant (the data already exists), and have the PO modal pass `onValidationChange` + `disabled` (SO already gates; PO currently relies on a backend 400) | medium | S | `order-line-editor.tsx:330-331,346-347,280-286,394`; `purchase-orders/page.tsx:649-661,493`; `sales-orders/page.tsx:762` |
| P2 | Harden number inputs: `qty`/`price`/`discount`/`tax` patch via `Number(e.target.value)`, so clearing Qty snaps to 0, `'abc'`→NaN becomes the controlled value, and negatives/exponents are entered (caught only server-side). Back each with a string field allowing empty/partial entry, parse on change/blur, reject NaN/negatives, commit only finite ≥0 | medium | S | `order-line-editor.tsx:836,872-873,890-891,907-908`; `sales-orders.service.ts:134,137-139` |
| P2 | Key transient per-line UI state by a stable line id (and/or remap on remove): `productSearch`/`productCategoryFilter` are `Record<number,…>` and lines render with `key={index}`, so removing a middle line leaves a typed query/category aliased onto whatever line slides into that index (transient-UI confusion only; the line model is correctly spliced) | medium | M | `order-line-editor.tsx:303-304,550` |
| P2 | Memoize per-line `filteredProducts`/`searchResults` keyed on (products, query, category, allocation); build the `<select>` option-label list once per products change rather than per render/keystroke | medium | M | `order-line-editor.tsx:508-512,721-725,127-155,129` |
| P2 | Validate sale profitability against server before enabling submit (preview cost == frozen cost) **[INV valuation]** | medium | M | `lines 202-208`, `profit.service.ts:856` |
| P3 | Drop `'location'` from the incomplete-lines warning copy — the editor only validates product/unit/quantity and has no location field | low | S | `order-line-editor.tsx:1011,280-286` |
| P3 | Add an optional per-line tax-rate selector (18%/0%/exempt) auto-computing `taxAmount` from the taxable base with manual override, plus a header inclusive/exclusive toggle: today Tax is a raw amount the ledger mirrors verbatim into the VAT-return aggregation, so a mistyped value flows through. Net-new scope — roadmap item | medium | L | `order-line-editor.tsx:896-911,386`; `tax-auto-apply.service.ts:32,203-237`; `sales-orders.service.ts:1970` |
| P3 | Replace local `money()`/`quantity()` with `formatMoney(v, currency, {decimals:2})`/`formatNumber`, verifying each call site's null/0 handling (the chip/totals expect `'0.00'`, not `formatMoney`'s `'—'`/0-decimal default) | low | S | `order-line-editor.tsx:102-107,109-115`; `lib/design-system/formatters.ts:17,27` |

### 3.7 Goods Received Notes (`procurement/grns/page.tsx`)
*Current state:* a 63-line read-only stub whose list **always renders empty** (response-shape mismatch), with no permission gate, swallowed errors, raw UUIDs, a status pill keyed on a non-existent `PENDING`, and no Approve/Post actions — and a backend where partial receipt is impossible, over-receipt is unguarded, non-PO/UoM-mismatched receipts can't post, and `update()` can mutate POSTED GRNs.

| Priority | Improvement | Impact | Effort | Grounded in |
|---|---|---|---|---|
| P0 | Fix the empty-list response-shape mismatch (two-sided, backend-first): `findAll` returns `{items,…}`, the `TransformInterceptor` wraps it as `{data:{items,…}}`, and both the stub's `Array.isArray` checks and `normalizePaginated` read `undefined` → always `[]`. Backend must return `{ data: items, items, total, page, limit, totalPages }` (mirror supplier-invoices) **and** the frontend must move to `backendPage` | high | S | `goods-received-notes.service.ts:43`; `transform.interceptor.ts:21-25`; `grns/page.tsx:13`; `api-client.ts:79-88,104`; `supplier-invoices.service.ts:87-89` |
| P0 | Rebuild on canonical template (`backendPage` + `useAuth` gate + PageHeader/StatCard/PageToolbar/Card/StatusBadge + pager); resolve company/supplier names; real `GRNStatus` pills; surface load errors. **Also add pagination** — the stub fetches with no page/limit and the backend defaults to limit=20, so >20 GRNs are silently invisible | high | M | `grns/page.tsx:7-62`; `goods-received-notes.service.ts:19`; `api-client.ts:252` |
| P0 | Capture/derive line `unitCost` (+ UoM conversion): `GoodsReceivedNoteLine` has no `unitCost` column; cost comes only from an exact `productId:unitId` PO match, so a no-PO ad-hoc receipt or a UoM-mismatched line passes `unitCost=undefined`, which `assertInventoryMovementHasCost` throws on for stock products, **aborting the whole `$transaction`**. Add the column (default from the matching PO line), pass `line.unitCost` to `createMovement`, convert qty to stock UoM **[INV valuation]** | high | L | `schema.prisma:12828-12846`; `goods-received-notes.service.ts:215-245`; `inventory-movements.service.ts:142`; `profit.service.ts:183-188` |
| P1 | True partial-receipt + over-receipt guard in `post()`: it unconditionally flips the PO to `RECEIVED` (stranding the remainder; `PARTIALLY_RECEIVED` exists but is never written) and the only quantity check is `accepted > 0` (so 1000 can post against an ordered 10). Sum received-to-date per PO line across this + prior POSTED GRNs vs `PurchaseOrderLine.quantity`; set `PARTIALLY_RECEIVED` vs `RECEIVED`; relax `assertLinkedPurchaseOrderCanReceiveStock` to permit further GRNs while `PARTIALLY_RECEIVED` **[INV]** | high | L | `goods-received-notes.service.ts:234-235,257-270,263,328-332`; `schema.prisma:2462,12832` |
| P1 | Status guard + typed DTOs on `update()`: it spreads `dto:any` with `data:{ ...dto }` and no status check (controller binds `@Body() dto: any`, no DTO file), so a POSTED GRN's lines/quantities/status are mutable after stock moved. Throw unless `DRAFT`, drop `status` from the editable surface, add class-validator Create/Update DTOs | high | M | `goods-received-notes.service.ts:87-110,96-99`; `controller.ts:30` |
| P1 | Validate line-quantity invariants in `CreateGoodsReceivedNoteDto`: `create()` builds lines via `{ create: lines }` with no check that `accepted ≤ received ≤ ordered`, `rejected + accepted` reconciles, or quantities are non-negative — garbage entered at create surfaces only at post as inflated stock. Fold into the typed-DTO item | medium | M | `goods-received-notes.service.ts:64-74` |
| P1 | Wire status-gated Approve (`grn.approve`) / Post (`grn.post`) via `backendPost` guarded by `ConfirmDialog` + `busyId` (mirror supplier-invoices `runAction`), plus a create-from-PO flow pulling open PO lines into the line editor. Post is irreversible — confirm with GRN# and accepted totals | high | M | `grns/page.tsx` (read-only); `controller.ts:34-44`; supplier-invoices `page.tsx:846-868` |
| P1 | Add a permission gate (`useAuth().hasPermission('grn.list'\|'grn.view')`) with an Access Restricted panel: the page has no gate, so an unprivileged user gets a backend 403 swallowed by `.catch(()=>{})` and just sees an empty table. Folds into the canonical rewrite | high | S | `grns/page.tsx` (no `useAuth`); `controller.ts:11,17` |
| P2 | Add PO + Supplier-Invoice columns/links (chain drill-through) | medium | M | model carries `purchaseOrderId` |
| P2 | Surface `ErrorState` + `EmptyState` + permission-denied distinctly: `.catch(()=>{})` makes a 403/500/network drop indistinguishable from an empty list. Folds into the rewrite | medium | S | `grns/page.tsx:14,42` |
| P2 | Replace `{row.companyId}`/`{row.supplierId}` UUIDs with names: include `company { name }` (relation exists) and **decorate** `supplier { name }` via a separate `findMany` (no supplier relation on the GRN model — mirror `decorateInvoices`) | medium | S | `grns/page.tsx:46-47`; `goods-received-notes.service.ts:35-39`; `schema.prisma:12792-12826` |
| P2 | GRN detail drawer + print route (ordered/received/accepted/rejected, condition, batch/expiry, costs, approved/posted-by), mirroring `sales-orders/[id]/print`. Defer behind the actions/correctness fixes | medium | M | only `page.tsx` exists; detail-drawer + SO print precedent |
| P2 | Validate `receivedDate` vs open period and disallow future before posting: `movementDate`/PO `receivedAt`/`lastMovementAt` all derive from the user-supplied `receivedDate` with no bound, so a back/future-dated GRN stamps the wrong/closed period and distorts WAC timing. Coordinate the period rule with the inventory plan **[INV]** | medium | S | `goods-received-notes.service.ts:246,267,68`; `inventory-movements.service.ts:295` |
| P3 | Replace the hand-rolled status pill (branches on a non-existent `PENDING`, so every status except POSTED falls to grey, color-only) with `StatusBadge`; **add a `RECEIVED` key to `BADGE_MAP`** — it's absent so RECEIVED rows would still render grey after the swap | medium | S | `grns/page.tsx:50`; `schema.prisma:11957-11965`; `status-badge.tsx` |

### 3.8 Supplier Invoices (`procurement/supplier-invoices/page.tsx` + service)
*Current state:* the convergence point of the chain — holds PO/GRN/match/payable refs but renders them as dead text; approval is non-atomic, never re-values inventory, and there's no cancel/void path.

| Priority | Improvement | Impact | Effort | Grounded in |
|---|---|---|---|---|
| P0 | Atomic approve: status CAS (`updateMany` count===1) + partial unique `Payable(companyId,sourceType,sourceId)` | high | M | `supplier-invoices.service.ts:262-370`, `schema.prisma:2201-2241` |
| P0 | Landed-cost / PPV: post inventory revaluation (or PURCHASE_PRICE_VARIANCE split) for PO-vs-invoice delta on approve **[INV valuation]** | high | L | `service:446-509`, GRN `:245` |
| P1 | Pass `tx` into `createThreeWayMatch`'s status update (one-line: `db.supplierInvoice.update` at `:748`) | high | S | `service:685,726,748` |
| P1 | Soft-delete prior `ThreeWayMatch` when invoice edited back to DRAFT; require fresh match before approve | high | S | `service:196,226`, `schema.prisma:12931` |
| P1 | Cancel/void endpoint with payable + journal reversal; wire/implement `CANCELLED` status | high | L | controller `:14-56`, `schema.prisma:11975`, `page.tsx:172` |
| P1 | Drill-through links: PO/GRN/match/payable cells → their registers | medium | M | `page.tsx:1041-1083` |
| P2 | Currency lock (invoice == PO/GRN in `assertProcurementReferences`); fix cross-currency `Outstanding` + `syncSupplierBalance` | medium | M | `service:568-679,881-899`, `page.tsx:883,929` |
| P2 | Three-way baseline fix: build `expectedAmount` from PO line's own discount/tax (not invoice's); add currency precondition | medium | M | `service:784-809` |
| P2 | Per-line `lineTotal < 0` rejection; cap modal discount at `qty*unitPrice` | medium | S | `service:402-407`, `page.tsx:425-428,667-714` |
| P2 | GRN selector → POSTED only; copy PO discount/tax in `copyGrnLines` (stop zeroing) | medium | M | `page.tsx:362-364,408-412,602-608` |
| P2 | DB-aggregate stat cards (register-wide count-by-status + sum(outstanding) per currency) | medium | M | `page.tsx:879-885` |
| P3 | Detail/print document surface (DocumentShell precedent); `sum(lineTotal)==totalAmount` re-check at approve | medium | L | only `page.tsx` exists; `service:473,481-488` |
| P3 | Shared loading/error/empty/permission-denied primitives; per-input `aria-label` + `aria-live`; canonical formatters | medium | M | `page.tsx:488,640-714,870-876,1014-1024` |

### 3.9 Three-Way Matching (`procurement/three-way-matching/page.tsx` + service)
*Current state:* the financial control point — but it lets clerks type the variance, is completely ungated, mints match numbers client-side, and uses raw `fetch` throughout.

| Priority | Improvement | Impact | Effort | Grounded in |
|---|---|---|---|---|
| P0 | Replace manual variance entry with the shared computed matcher; expose `POST /three-way-matching/run`; fields read-only | high | M | `page.tsx:214-215,365-366`, `supplier-invoices.service.ts:711-724` |
| P0 | Server-side recompute-and-verify in `create()`/`approve()`; post JE against recomputed amount; reject divergence beyond tolerance | high | M | `service:50-56,90,111` |
| P1 | Dedup/unique guard on `ThreeWayMatch` (companyId+supplierInvoiceId where deletedAt null); reconcile auto vs manual matcher | high | M | `schema.prisma:12914-12941`, `service:53` |
| P1 | Flip linked invoice MATCHED/DISPUTED on create/approve (within tx) | high | S | `service:50-76`, `supplier-invoices.service.ts:748-751` |
| P1 | Enforce PO↔GRN↔invoice link (backend assertion + drop `!purchaseOrderId ||` UI clause) | high | S | `service:141-166`, `page.tsx:191-196` |
| P1 | Permission gating (`three_way_match.view/.create/.approve`) like supplier-invoices | high | S | no `useAuth` in `page.tsx` |
| P1 | Migrate raw `fetch` → `backendList/backendPage/backendPost/backendGet` | high | M | `page.tsx:122-242` |
| P2 | Per-line variance breakdown table colored by tolerance bands | high | L | `page.tsx:323-329`, `supplier-invoices.service.ts:756-809` |
| P2 | Pagination + server-side stat aggregation (Variance Value under-reports beyond 100) | medium | M | `page.tsx:152,171-173` |
| P2 | Server-generated `matchNumber` via `codes.next({entityType:'ThreeWayMatch'})`; remove from DTO/form | medium | S | `page.tsx:90-93,207`, `supplier-invoices.service.ts:728-732` |
| P2 | Clickable PO/GRN/invoice references (cite an actual `router.push` example for the pattern) | medium | S | `page.tsx:323-382` |
| P3 | Shared empty/error/loading primitives; keyboard-operable rows; non-color variance cue; `formatMoney({decimals:2})` + doc currency; align `matchStatus` to computed variances | medium | S | `page.tsx:86-88,275-316,296,303-304` |

---

## 4. Sequenced roadmap

### Phase 1 — Correctness blockers + quick wins (P0 + P1-low-effort)
Ship the money/lifecycle holes and the cheap structural fixes first. Several P0s share a backend pass.

- **Ticket 1.1 — Supplier-invoice approve hardening (backend pass).** Status CAS, partial unique `Payable(companyId,sourceType,sourceId)`, pass `tx` into `createThreeWayMatch:748`, soft-delete stale matches on edit-to-DRAFT, `sum(lineTotal)==totalAmount` re-check. *(P0/P1; supplier-invoices §3.8)*
- **Ticket 1.2 — Three-way-matching trust + gating.** Extract shared computed matcher, make variance fields read-only, server recompute-and-verify, dedup unique index, flip invoice status in-tx, enforce PO link, add permission gates, server-side matchNumber. *(P0/P1; §3.9)* **Depends on 1.1** (shared matcher + unique-index migration land together).
- **Ticket 1.3 — Sales-order cancel money guard.** Block/refund cancel of paid orders; post reversing journal + reverse cash on cash-sale cancel. *(P0; §3.2/3.3)*
- **Ticket 1.4 — Profit NULL-COGS flagging + cascade fix.** `linesMissingCost`/`revenueMissingCost`, badge cards, fix empty-state copy, fix Division→Branch filter, Fix-Cost confirm-dialog (interim). *(P0/P1; §3.5)*
- **Ticket 1.5 — Confirm-dialogs for all ledger-posting actions** (SO/PO Confirm/Cancel; GRN Post) + truthful toasts. *(P1; cross-cutting)*
- **Ticket 1.6 — Cancel-gate alignment** (PO + SO UI gates match backend allow-lists). *(P1/P2 low-effort; §3.1/3.3)*
- **Ticket 1.7 — POS tender-type fix.** Stop deriving `paymentMethod` from account type so the recorded tender, GL reference, and receipt match the operator's choice. *(P1; §3.4; standalone, no deps)*
- **Ticket 1.8 — GRN list resurrection.** Fix the backend `findAll` response shape (`{data:items,…}`) so the register stops rendering empty — a prerequisite for the Phase-2 GRN rebuild. *(P0; §3.7)*

### Phase 2 — High-value structural (chains, valuation, lifecycle)
- **Ticket 2.1 — Landed-cost reconciliation** (add GRN line `unitCost`, re-value WAC on invoice approve / three-way match). *(P0 valuation; §2, §3.7, §3.8)* **Depends on 1.1/1.2** (revaluation hooks into the hardened approve/match path). **[INV]**
- **Ticket 2.2 — GRN page rebuild + lifecycle** (canonical template, Approve/Post, partial-receipt + over-receipt guard, `update()` guard + typed DTO, `CreateGrnDto` line-quantity invariants, non-PO/UoM zero-cost receipt fix, pagination). **Depends on Ticket 1.8** — the response-shape fix must land first or the rebuilt `backendPage` list still returns `[]`. *(P0/P1; §3.7)*
- **Ticket 2.3 — PO control-center** (`[id]/page.tsx` + View action + control-center endpoint). *(P1; §3.1)* **Enables** the PO node of drill-through.
- **Ticket 2.4 — Chain drill-through** (SI refs, SO-detail aggregated rows, profit ledger→SO, movement `referenceType`/`referenceId`, delivery-note selectors + "Create DN from SO", procurement dashboard count links). *(P1/P2; §2)* **Depends on 2.3** (PO target route). **[INV]**
- **Ticket 2.5 — Currency safety** (lock to functional currency, validate cash/cross-doc currency, fix cross-currency sums). *(P1; §2)*
- **Ticket 2.6 — DB-aggregate stat cards** (SO/PO/profit/SI/three-way summaries; profit 1000-row truncation). *(P1/P2; §2)*
- **Ticket 2.7 — Modal focus management + search debounce/abort** (two shared-component fixes covering all flow pages). *(P1; §2)*
- **Ticket 2.8 — Canonical purchase-cost basis** (PO-receive vs GRN-receive parity; COGS-vs-WAC rounding reconciliation). *(P1 valuation; §3.1)* **[INV]**

### Phase 3 — Polish
- **Ticket 3.1 — Formatters/date/Alert consolidation** (shared `formatMoney({decimals:2})`/`formatDate`, true local-date helper, Alert primitive replacing ~15 banner divs, centralized enums + one CURRENCIES list).
- **Ticket 3.2 — Shared line-math + line-editor** (one totals helper, `roundMoney`, supplier-invoices onto `OrderLineEditor`, memoize per-line filtering, document discount semantics).
- **Ticket 3.3 — Table & control a11y** (`scope`/captions, non-color cues, keyboard rows, mobile-pos combobox, three-way per-line variance table).
- **Ticket 3.4 — Export/pager parity + PageToolbar/FilterSelect extraction.**
- **Ticket 3.5 — Supplier-invoice detail/print surface; mobile-pos offline queue + iframe print; rate-based tax (roadmap feature, can split out).**

**Key dependencies:** 1.2 → 1.1 (shared matcher + unique-index migration); 2.1 → 1.1/1.2 (revaluation rides the hardened approve/match path); 2.4 → 2.3 (PO route must exist before linking to it). Phase 3 is independent and parallelizable.
