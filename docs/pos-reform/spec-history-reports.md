# MODULE SPEC — Historia (sales + purchase viewing) and Funga Siku (the end-of-day report)

Build-ready spec for the three surfaces the owner asked for on 2026-08-14: **Historia ya Mauzo** (a rep's own sales, 7 days, with the detail a rep actually needs), **Historia ya Manunuzi** (what this branch received, 7 days, with **no buying costs of any kind**), and **Funga Siku** — the closing ritual that submits an end-of-day sales report the office reads in the ERP *and* hands the rep a letterhead PDF for the phone's share sheet.

Kaunta only. Everything here is reached through `KauntaShell`; the classic shell (`uiVersion 1`) — which is what the entire fleet runs today — is not touched by a single line of this spec.

Verified against main @ `e0cbdddb` (`mobile-pos-lite.service.ts`: `stock()` 881–984 and its no-cost discipline, `mySalesToday()` 1028–1085, `createPurchase()` 1135–1285, `createStockCount()` 1338–1463, `createSale()` 1465–1553, `saleReceipt()` 1563–1664, `claimPurchaseKey()` 1897–1908, `findPurchaseByKey()` 1925–1950, `requireTerminal()` 2935, `sessionPayload()` 3124; controller `stock`/`sales/:id/receipt`/`my-sales-today` at 106/144/161; `generated-documents.service.ts` `renderLetterheadPdf()` 286–313; `pos-router.ts` `bootRouteFromHash()` 99–105; `mobile-pos-lite-store.ts` DB v4 at line 73 with `stocks`/`drafts`/`daylog` created at 123–125; `pos-errors.ts` `ERROR_PATTERNS` 211 and `posPurchaseFailureMessage()` 466; migration `database/prisma/migrations/20260813120000_mobile_pos_lite_idempotency_keys`).

**Key files**

- `backend/src/modules/mobile-pos-lite/mobile-pos-lite.service.ts` (+3 read methods, +1 write chain, +1 PDF renderer)
- `backend/src/modules/mobile-pos-lite/mobile-pos-lite.controller.ts` (+5 routes)
- `backend/src/modules/mobile-pos-lite/dto/mobile-pos-lite-day-report.dto.ts` (new)
- `database/prisma/schema.prisma` + `database/prisma/migrations/<ts>_mobile_pos_day_reports/migration.sql` (new, additive)
- `frontend/src/components/westsides/mobile-pos-lite/screens/HistoriaScreen.tsx`, `screens/ManunuziHistoriaScreen.tsx`, `screens/FungaSikuScreen.tsx`, `screens/RipotiScreen.tsx` (new)
- `frontend/src/components/westsides/mobile-pos-lite/hooks/use-pos-history.ts`, `hooks/use-pos-day-report.ts` (new)
- `frontend/src/components/westsides/mobile-pos-lite/pos-router.ts` (+4 routes, one gate-ordering fix — §2.2)
- `frontend/src/components/westsides/mobile-pos-lite/KauntaShell.tsx` (routes, slab verbs, Leo entry)
- `frontend/src/components/westsides/mobile-pos-lite/pos-i18n.ts` (40 new flat keys, §5), `pos-errors.ts` (+2 certified rows, +1 classifier), `pos-receipt.ts` (+1 generalised share helper)
- `frontend/src/lib/mobile-pos-lite-store.ts` (**no version bump** — one optional field on the existing `daylog` value, §6)

---

## 0. What this spec revives, and the law it revives it under

`POS_REFORM_PLAN_2026-08-11.md` §7-1 cut **Historia** from v1 on the owner's decision, and design-direction §12-1 recorded it: *"no buying-cost history lands on phones"*. spec-purchases §3.3–3.4, §5.2 and its nine Historia i18n keys were struck in place. That cut was never about purchase *viewing* — it was about putting 30–90 days of what this business pays its suppliers onto a device that gets stolen out of a rep's hand.

The owner's 2026-08-14 decision revives purchase viewing **and keeps the protection**:

> **THE COST-BLINDNESS LAW.** No cost, total, or value field may appear anywhere on the purchase-history payload or screen. Not `unitCost`, not `lineTotal`, not `totalAmount`, not `subtotal`/`taxAmount`/`discountAmount`/`paidAmount`/`outstandingAmount`, not `averageCost`, not margin, not anything derived from them — including a client-side sum. A manager sees **supplier · date · reference · goods-received number · products · quantities** and nothing else. A stolen phone must still reveal nothing about what this business pays its suppliers.

This is the single most important constraint in the module. It is review-blocking on the endpoint, on the screen, and on every future change to either (§1.2, §8-C, §10).

Two consequences follow immediately, and both are load-bearing because the ORM makes the mistake easy:

- `PurchaseOrderLine` carries `unitCost`, `lineTotal`, `discountAmount` and `taxAmount` (schema 3699–3722); `PurchaseOrder` carries `subtotal`, `totalAmount`, `paidAmount`, `outstandingAmount` (3640–3650). **`include:` is BANNED on this endpoint at every level.** Only explicit `select:` blocks, so a field added to either model tomorrow cannot ride out to a phone.
- `SalesOrderLine` carries `unitCostAtSale`, `cogsAmount`, `grossProfitAmount`, `grossMarginPct` (3612–3616). The *sales* history is allowed to show selling prices — they are already on the phone in the catalog, so it is no new exposure — but it is **not** allowed to show cost or margin. Same explicit-`select` rule, same key-set test (§1.1, §8-C).

The precedent for all of this already exists and this spec follows it verbatim: `stock()` (service 865–984) carries a REVIEW-BLOCKING comment naming the rule and the reason, and is deliberately not a wrapper over `InventoryBalancesService.liveStock()` *because* that projection leaks `averageCost`/`totalValue`/`riskValue`. Both new read endpoints get the same comment, in the same voice, on both the service method and the controller route.

**History window: 7 days on both lists** (owner decision). It is a **server constant**, not a query parameter — see §1.1.

---

## 1. Backend

### 1.0 Shared decisions (both read endpoints)

| | |
|---|---|
| Window | `const MOBILE_POS_HISTORY_DAYS = 7;` — module constant. **No `days` query parameter on either route.** A client-supplied window is a knob nobody turns and a widening waiting to happen; the owner set 7, so 7 lives on the server. (This deliberately drops the `days?: number` DTO the cut spec-purchases §5.2 proposed.) |
| Window boundary | Midnight **in the business timezone** (§1.0.1), `MOBILE_POS_HISTORY_DAYS - 1` days back, walked as calendar days rather than by subtracting 6×24h from an instant. Today counts as day 1, so "siku 7" means today plus the six before it. |

#### 1.0.1 THE BUSINESS TIMEZONE — one authority for where a day begins

> `const MOBILE_POS_BUSINESS_TIMEZONE = 'Africa/Nairobi';`
>
> Every day boundary in this module — the two history windows, the day-report window, and the today-or-yesterday check — is cut at midnight in this zone. **Never the server process's own zone, never the device's.**

This replaces the original draft of this spec, which said "server-local midnight" everywhere and assumed the process ran at UTC+3. Nothing in the deployment enforces that: `backend/Dockerfile` sets no `ENV TZ`, the backend service in `docker-compose.production.yml` sets none, and no `process.env.TZ` exists anywhere in `backend/src`, so `node:20-alpine` runs UTC — three hours behind every time this module *renders*, all of which were already pinned to `Africa/Nairobi`. The two consequences were not cosmetic: a rep in Dar who closed at 00:30 was refused outright with `errReportDateClosed` for an ordinary act, with no recovery until 03:00; and every trading day was silently cut at 03:00 local, so a sale rung at 01:00 was filed under the previous day while its own receipt printed today's date.

**Why a pinned constant rather than config:**

- **Not `ENV TZ` on the container.** It would fix this module by moving *every other* module's local-day arithmetic at the same time — `mySalesToday()`, which the CLASSIC shell reads, and the westsides daily close among them. That is a fleet decision, not a POS-report one. It is also invisible in the source: one redeploy onto a host, base image or compose file that does not carry the variable re-breaks the boundary exactly as before, with nothing in review to catch it. A constant cannot be lost in a deploy.
- **Not a company or branch setting.** There is no such column, and the only `timezone` in the schema is `UserPreference.timezone` — a per-user *display* preference the user edits herself. A trading day that moves when a rep changes her profile is worse than one pinned to the wrong zone. Adding a company column would also give the boundary a null/unset state, which is the bug again with a migration attached.
- **Not the device clock.** A phone's clock can be wrong; the server owning *whether* a day is closable is the whole point (§1.3).

It is `Africa/Nairobi` because that is the string this module already pins for every rendered time (`receiptDateTime`, `reportFileTime`, the letterhead builder), so the day a report is filed under and the clock printed on the receipts inside it now read the *same* string and cannot disagree. EAT is UTC+3 with no DST and none since 1936; `Africa/Dar_es_Salaam` is a link to the same zone, and naming one zone twice is how two halves of a boundary drift apart. The arithmetic still reads the offset from ICU rather than hard-coding +3, so it does not quietly depend on that never changing.

**Known residual, deliberately out of scope:** `mySalesToday()` still cuts its day at the process's midnight, so Leo's "today" total and the Funga Siku preview remain three hours out on a UTC container. It is left alone because the classic shell — which the whole fleet runs — reads that endpoint, and §1.8/§10-2 forbid moving it here. Only the *preview* is affected; the submitted record and the paper are computed over the business-zone window and are right. Moving `mySalesToday()` onto `businessDayWindow` is a release of its own.
| Auth | Terminal headers `x-mobile-pos-terminal` + `x-mobile-pos-device` → `requireTerminal()`, exactly like every other mobile-pos-lite route. Company, division, **branch** and rep identity all come from the terminal; the client can never supply any of them. |
| `lastSeenAt` | Not updated. Reads never touch it — consistent with `mySalesToday()`, `stock()`, `products()`. |
| Decimals | Every Prisma `Decimal` crosses the wire as `Number()`, as everywhere else in this service. |
| Serialisation | **Explicit `select` at every level. `include` is banned on both routes.** |

### 1.1 `GET /mobile-pos-lite/sales` — NEW (sales history, 7 days)

| | |
|---|---|
| Verb/path | `GET /mobile-pos-lite/sales` (same path as the existing `POST`; verbs disambiguate — Nest handles this, and it is the shape the cut purchases spec already approved) |
| Permission | `@RequirePermissions('mobile_pos_lite.use')` |
| Query | none |

Service method `salesHistory(terminalCode, deviceSecret, user)`, sitting next to `mySalesToday()` and reusing its scoping decisions verbatim:

```ts
const where: Prisma.SalesOrderWhereInput = {
  companyId: terminal.companyId,
  mobilePosTerminalId: terminal.id,   // this terminal
  createdById: user.id,               // this rep — per-rep accountability, as mySalesToday
  status: { in: [...CONFIRMED_SALES_STATUSES] },
  orderDate: { gte: from, lt: dayEnd },
};
```

Two queries, both scoped by that `where`:

1. `aggregate({ _count: { _all: true }, _sum: { totalAmount: true } })` — the headline numbers, **exact and unbounded**.
2. `findMany({ orderBy: { createdAt: 'desc' }, take: 200, select: { … } })` — the rows.

`take: 200` is the accepted bound (≈28 sales/day for a week). The list is newest-first, so truncation drops the OLDEST rows, never the ones a rep is looking for — and because the totals come from the unbounded aggregate, a truncated list can never produce a wrong total. Note the bound in a code comment, as `stock()` notes its 1500.

**Response** (this is the complete payload; nothing else is added):

```jsonc
{
  "days": 7,
  "from": "2026-08-08T00:00:00.000Z",
  "count": 23,
  "totalAmount": 412000,
  "sales": [{
    "id": "uuid",
    "salesOrderNumber": "SO-2026-0912",
    "createdAt": "2026-08-14T09:14:00.000Z",
    "paymentMethod": "CASH",
    "paymentReference": null,
    "customerName": "Mama Asha",           // customer.name ?? customerName snapshot ?? null
    "totalAmount": 18000,
    "lines": [{
      "productId": "uuid",
      "name": "Embe Dodo",                 // product.name, fallback line.description, fallback ''
      "quantity": 3,
      "unitSymbol": "pc",
      "unitPrice": 6000,
      "lineTotal": 18000
    }]
  }]
}
```

Selling prices ride here on purpose: `unitPrice`/`lineTotal` are the same numbers the catalog already caches on the phone and the receipt already prints, so this is no new exposure — and a rep who cannot see what she charged cannot answer the customer standing in front of her. **`unitCostAtSale`, `cogsAmount`, `grossProfitAmount`, `grossMarginPct` are never selected.** Asserted (§8-C).

`unitSymbol` comes from the line's `unit: { select: { symbol: true } }` relation (SalesOrderLine 3603/3623).

**"Whether it is still queued locally" is a CLIENT concern.** The server cannot know what is sitting in a phone's outbox and must not pretend to; the merge happens on the device (§3.1). Nothing on this payload refers to queued state.

**Size: S** (one method, two queries, precedent-shaped) + **S** (tests: window boundary, rep isolation, terminal isolation, truncation-does-not-affect-totals, Decimal→Number, key-set/no-margin assertion) = **M**.

### 1.2 `GET /mobile-pos-lite/purchases` — NEW (purchase history, 7 days, NO COSTS)

| | |
|---|---|
| Verb/path | `GET /mobile-pos-lite/purchases` |
| Permission | `@RequirePermissions('mobile_pos_lite.purchase')` — the same manager gate that already guards recording a delivery. Never `.use`. |
| Query | none |

Service method `purchaseHistory(terminalCode, deviceSecret, user)`. Carries a REVIEW-BLOCKING docstring in the shape of `stock()`'s, naming the cost-blindness law, the reason (rep and manager phones get stolen), and the `include`-is-banned rule.

```ts
const where: Prisma.PurchaseOrderWhereInput = {
  companyId: terminal.companyId,
  branchId: terminal.branchId,
  purchaseType: 'STOCK_PURCHASE',
  deletedAt: null,
  notes: { contains: '[MPL-PURCHASE:' },   // POS-originated only
  createdAt: { gte: from, lt: dayEnd },
};
```

```ts
select: {
  id: true,
  purchaseOrderNumber: true,
  createdAt: true,
  status: true,                                  // consumed to derive COMPLETE/INCOMPLETE; NOT emitted raw
  supplier: { select: { name: true } },          // no supplierName snapshot exists on PurchaseOrder
  lines: {
    select: {
      productId: true,
      description: true,
      quantity: true,
      product: { select: { name: true } },
      unit: { select: { symbol: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
}
orderBy: { createdAt: 'desc' }, take: 100
```

Then one second query for the receipt numbers — **also cost-free**:

```ts
this.prisma.goodsReceivedNote.findMany({
  where: { purchaseOrderId: { in: poIds }, deletedAt: null },
  select: { purchaseOrderId: true, grnNumber: true, status: true },
});
```

**Scoping decisions (documented in the service docstring):**

- **Branch-scoped, not user-scoped.** Receiving is a branch activity; the manager sees the branch's whole POS receiving book, a colleague's entries included. This deliberately differs from the sales history's per-rep scope, and the reason is the same in both cases: sales are personal accountability, deliveries are the branch's stock.
- **Marker-filtered.** `notes: { contains: '[MPL-PURCHASE:' }` — desktop-ERP purchases at the same branch are excluded. This screen is the POS book; the office sees everything in the ERP proper. The marker is written atomically with the row at create (service 1182–1192) and client notes are sanitised (`sanitizeClientNotes`), so it cannot be planted from a phone. Unindexed but riding `@@index([companyId])` plus a ≤7-day branch window — fine at this scale. **Do NOT widen company-wide.**
- **INCOMPLETE surfaces honestly.** An interrupted chain leaves a marker-bearing PO with no POSTED GRN; hiding it would make a stock movement unexplainable to the manager who made it. `status: 'COMPLETE'` iff a GRN exists for the PO with GRN status `POSTED`; otherwise `'INCOMPLETE'` and `grnNumber: null`.

**Response — this is the EXACT and COMPLETE key set:**

```jsonc
{
  "days": 7,
  "from": "2026-08-08T00:00:00.000Z",
  "count": 6,
  "purchases": [{
    "id": "uuid",
    "purchaseOrderNumber": "PO-2026-0141",
    "grnNumber": "GRN-2026-0139",
    "supplierName": "Azam Distributors",
    "recordedAt": "2026-08-13T09:14:00.000Z",
    "status": "COMPLETE",
    "lines": [{
      "productId": "uuid",
      "name": "Embe Dodo",
      "quantity": 24,
      "unitSymbol": "pc"
    }]
  }]
}
```

Top level: exactly `days`, `from`, `count`, `purchases`. **There is no window total and no per-purchase total** — the cut spec-purchases §5.2 had both, and both are deleted here by the owner's decision. Purchase object: exactly `id`, `purchaseOrderNumber`, `grnNumber`, `supplierName`, `recordedAt`, `status`, `lines` — 7 keys. Line object: exactly `productId`, `name`, `quantity`, `unitSymbol` — 4 keys.

- `recordedAt` = `PurchaseOrder.createdAt` — the moment the manager tapped POKEA, which is the moment she remembers. One field for both the window filter and the display, so the two can never disagree.
- `supplierName` = `supplier?.name ?? ''` (the relation is `onDelete: SetNull`, schema 3675 — there is no snapshot column, contrary to the cut spec's claim).
- `name` = `product?.name ?? description ?? ''`.

**A test MUST assert this key set exactly.** Not "does not contain unitCost" — the whole set, recursively, so that a field added to `PurchaseOrderLine` next year cannot slip through a passing suite. See §8-C for the exact assertion.

**Size: S** (two queries, no chain) + **S** (tests: key-set assertion, branch isolation, marker filter, INCOMPLETE/null-GRN, window boundary, 403 for a `.use`-only user) = **M**.

### 1.3 `POST /mobile-pos-lite/day-reports` — NEW (the end-of-day report)

| | |
|---|---|
| Verb/path | `POST /mobile-pos-lite/day-reports` |
| Permission | `@RequirePermissions('mobile_pos_lite.use')` |
| Auth | terminal headers → `requireTerminal()` |

**Body** (`CreateMobilePosLiteDayReportDto`, new file `dto/mobile-pos-lite-day-report.dto.ts`):

```ts
{
  idempotencyKey: string,   // @Length(16,64) @Matches(/^[A-Za-z0-9._:-]+$/) — same rule as purchases/counts
  businessDate: string,     // @Matches(/^\d{4}-\d{2}-\d{2}$/) — device-local calendar date, FROZEN with the key
  heldCount: number,        // @IsInt @Min(0) @Max(500)   — declared by the phone
  heldAmount: number,       // @IsNumber @Min(0) @Max(1_000_000_000) — declared, display snapshot sum
}
```

The client sends **no totals, no lines, no method breakdown, no rep or terminal identity**. Everything the office reads as fact is recomputed on the server from `SalesOrder` rows. The only client-declared numbers on the whole record are `heldCount`/`heldAmount` — what the phone is still holding, which is the one thing the server genuinely cannot know — and they are stored under names that say so (`declaredHeldCount`, `declaredHeldAmount`) and printed on the paper under a heading that says so.

**Why `businessDate` comes from the client at all, and what the server does with it:** the key is frozen against a specific day (§4), so a retry at 00:01 for a close begun at 23:59 must still close *yesterday*; if the server picked the day, the retry would silently close a different one. So the phone owns *which* day it is closing, and the server owns *whether* that day is closable: `businessDate` must resolve to **today or yesterday in the business timezone** (§1.0.1) — `const MOBILE_POS_CLOSABLE_DAYS_BACK = 1` — else `BadRequestException('Only today or yesterday can be closed from a Mobile POS terminal')`. Never the process's own zone: read there on a container that sets no TZ, this refused every close made between midnight and 03:00 EAT, i.e. exactly the window the allowance exists for.

**The window is still today-or-yesterday, and now it means it.** With the boundary fixed, "yesterday" is yesterday *in the rep's own calendar*, which covers both cases the allowance was written for and one it never reached: she finished at 23:50 and closes on the bus at 00:30; she finished at 20:00 with no signal and closes over breakfast; her whole day ran past midnight and she closes the day she traded rather than the day the clock rolled into. It stops at yesterday for three reasons: the phone offers exactly those two days (§3.3), a day older than that is a device clock rather than a work day, and nothing is lost by refusing — the report is a snapshot of records the office already holds, not a financial fact, so a day that falls out of the window is still fully readable in the ERP. **Widening it would buy no reachable case and would let a clock two weeks out mint reports for days nobody worked.**

**Device clock wrong is a degraded-chrome outcome, never a corrupted record.** The server never takes the phone's word for what day it is; it only accepts or refuses the phone's claim. A phone whose clock is two or more days out therefore cannot close from the app at all, and `errReportDateClosed` names the office, which can read the day's records directly. Nothing she has sold is affected and selling is never blocked. (A future hardening — putting the server's own business date on a payload the phone already reads, so the day picker is anchored to the server rather than the device — is deliberately **not** in this release: it would change `sessionPayload`, which §1.7 forbids, and it needs a client that consumes it.)

**Server computation** (window = midnight of `businessDate` **in the business timezone** to the next midnight there — §1.0.1, not the `mySalesToday()` boundary math, which is left on the process's zone for the fleet reason §1.0.1 gives):

```ts
const where = {
  companyId: terminal.companyId,
  mobilePosTerminalId: terminal.id,
  createdById: user.id,
  status: { in: [...CONFIRMED_SALES_STATUSES] },
  orderDate: { gte: dayStart, lt: dayEnd },
};
```

- `salesCount` / `grossTotal` — from `aggregate` over that `where`. **Unbounded and exact.**
- `byMethod[]` — `groupBy({ by: ['paymentMethod'], _count, _sum: { totalAmount } })`, each entry `{ paymentMethod, label, count, amount }` where `label` is the terminal's own configured label (`terminal.paymentMethods.find(...)?.label ?? null`). CREDIT has no configured payment row and gets `label: null`. The breakdown is what makes the gross legible: money in the pocket is the CASH row, not the total.
- `items[]` and `itemsSoldQuantity` — `salesOrderLine.groupBy({ by: ['productId'], where: { salesOrder: <the same where> }, _sum: { quantity, lineTotal } })`. **Unbounded**, like the two above: no `take`, no `skip`, the database sums the whole day. The rows are ranked by `amount` desc, **the printed list is capped at 50 entries** with `itemsTruncated: boolean` when the cap bit, and names are looked up (`product.findMany`, `select: { id, name }`) only for the rows that survive the cap — with the productId standing in if a name will not resolve.

  This replaces the original design, which read `take: 500` whole orders and summed them in JS. `itemsSoldQuantity` was printed in the PDF's `Muhtasari / Summary` beside two exact aggregates, under a paragraph promising "the totals above are complete" — a financial document must not carry a number it quietly qualifies elsewhere, so the bound that could move it is **gone rather than annotated**. The 50-row display cap is now the only bound on the record, it is applied *after* the whole day has been ranked, and it can move no total. `MOBILE_POS_DAY_REPORT_ORDER_TAKE` is deleted.

**Idempotency — the write path in full.** This is the only write in this spec, and it obeys the same discipline as the sale, purchase and stock-count chains.

1. `requireTerminal()`.
2. Resolve and validate `businessDate` (above). This is the only refusal that can happen before anything exists, and by construction it has nothing to undo.
3. `findFirst({ where: { companyId: terminal.companyId, idempotencyKey: dto.idempotencyKey } })`.
   - **Found ⇒ verify before replaying.** A matching key is only a *claim* that this is the same close; the phone's key is frozen across a midnight rollover on purpose, so only the server can check the claim. Assert all three: `terminalId === terminal.id`, `repUserId === user.id`, and the stored `businessDate` equals the requested one. Any mismatch ⇒ `ConflictException('This day report key was already used for a different day or terminal')` **plus an audit row** (`MOBILE_POS_LITE_DAY_REPORT_CONFLICT`, severity `HIGH`) — the refusal names the office as the recovery, so the office has to be able to see it, exactly as `assertPurchaseMatchesOrSettle` does (service 1857–1885). Match ⇒ return the stored row serialised: the same numbers the office already has, so a re-fetched PDF equals the paper already issued.
   - **Not found ⇒ compute, then `create` with the key already on the row.**
4. **Replay protection is a database guarantee.** `@@unique([companyId, idempotencyKey])` (§1.6). Catch `isUniqueViolation` on the create ⇒ re-read by key ⇒ run the same three-way verification ⇒ return the winner. **This is a single-write claim: unlike the purchase and count chains, the key is written by the INSERT itself, so there is no window between "row exists" and "key claimed" and no loser row to retire.** Those chains have to create through a core service that does not take the key and then claim it in a second statement (`claimPurchaseKey`, service 1897–1908) — this model is ours, so the stronger form is available and is what we use. A read-then-write twin check is not an option here for the reason the 20260813120000 migration states: Postgres stamps `createdAt` at transaction start, so both racers can conclude they won.
5. `terminal.lastSeenAt` update (this is a write path, so it does touch it — like `createSale`/`createPurchase`/`createStockCount`) + `auditLogs.log({ action: 'MOBILE_POS_LITE_DAY_REPORT_SUBMITTED', entityType: 'MobilePosDayReport', entityId, severity: MEDIUM, newValue: { terminalCode, businessDate, salesCount, declaredHeldCount } })`.

**Nothing is ever destroyed or permanently refused.** There is no downstream chain to strand: a day report creates no financial fact, no stock movement and no GL entry — it is a snapshot of records that already exist. If the create fails for any other reason, the row simply does not exist, the client keeps its frozen key, and the identical retry is safe. **A submitted report is immutable**: a replay never rewrites the stored declared-held figures even if the phone's outbox drained in between, because mutating a record the office may already have read and printed is worse than a five-minute-stale disclosure. A rep who wants the corrected picture closes again — a new key, a new row, a later `submittedAt` (§8-D case 4).

**Response** (also the shape the PDF and the office list read):

```jsonc
{
  "id": "uuid",
  "businessDate": "2026-08-14",
  "reference": "TERM-014-20260814",
  "submittedAt": "2026-08-14T18:42:11.000Z",
  "terminal": { "id": "…", "code": "TERM-014", "name": "Kaunta 1" },
  "branch": { "id": "…", "name": "Uzunguni" },
  "rep": { "id": "…", "name": "Asha Mwinyi" },
  "salesCount": 23,
  "grossTotal": 412000,
  "itemsSoldQuantity": 87,
  "byMethod": [{ "paymentMethod": "CASH", "label": "Fedha", "count": 19, "amount": 331000 }],
  "items": [{ "productId": "…", "name": "Embe Dodo", "quantity": 14, "amount": 84000 }],
  "itemsTruncated": false,
  "declaredHeldCount": 2,
  "declaredHeldAmount": 26000
}
```

`reference` = `` `${terminalCode}-${businessDate without dashes}` `` — computed, not stored, and deliberately not a new document-number sequence: `EntityCodeGeneratorService` exists but a report is not a numbered business document, and `saleReceipt()` already sets the precedent of falling back to a derived reference.

**Size: L** (chain + verification + audit rows + tests: fresh close, exact replay, key-with-different-date conflict, key-with-different-terminal conflict, unique-violation race path, date-window refusal, zero-sale day, method breakdown, item cap, declared-held immutability on replay).

### 1.4 `GET /mobile-pos-lite/day-reports/:id/pdf` — NEW (the letterhead paper)

| | |
|---|---|
| Permission | `@RequirePermissions('mobile_pos_lite.use')` + terminal headers |
| Shape | **Byte-for-byte the shape of `sales/:id/receipt`** (controller 139–159): non-passthrough `@Res()` so the bytes bypass the `TransformInterceptor` envelope, `Content-Type: application/pdf`, `Content-Disposition: inline; filename="…"`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`. |

Service `dayReportPdf(terminalCode, deviceSecret, reportId, user)`: `requireTerminal()`, then `findFirst({ where: { id, companyId: terminal.companyId, terminalId: terminal.id } })` — terminal-bound by construction, so a rep can never pull another terminal's report, exactly as `saleReceipt()` is bound through `mobilePosTerminalId`. `NotFoundException('Day report not found for this Mobile POS terminal')` otherwise.

**The paper is rendered from the STORED RECORD, never from client state or a re-query.** That is the whole reason the PDF is a separate GET on a submitted id rather than a field on the POST response: the paper the rep hands over and the record the office reads are the same numbers by construction, and they stay the same numbers if she re-shares it a week later.

Rendered through `this.generatedDocuments.renderLetterheadPdf({ companyId, branchId }, { … }, user)`, reusing the receipt's existing helpers verbatim (`bilingualPaymentMethod`, `tzsWhole`, `receiptQty`, `receiptDateTime`, `receiptFileStem`, `BusinessPdfSection`):

- `title: 'RIPOTI YA SIKU / DAY SALES REPORT'`, `subtitle: repName`, `reference`, `generatedAt: new Date()`
- meta: `Tarehe / Date` (businessDate), `Kituo / Terminal` (code + name), `Tawi / Branch`, `Muuzaji / Sales Rep`, `Imetumwa / Submitted` (submittedAt)
- **`Muhtasari / Summary`** — items: `Mauzo / Sales` (count), `Jumla / Gross Total`, `Bidhaa zilizouzwa / Items Sold`
- **`Malipo / Payment Methods`** — table `['Njia / Method', 'Idadi / Count', 'Jumla / Total']`, numeric columns 1–2, one row per `byMethod` entry (label ?? `bilingualPaymentMethod(...)`), totals row `JUMLA / TOTAL`
- **`Bidhaa / Items`** — table `['Bidhaa / Item', 'Idadi / Qty', 'Jumla / Total']`, capped rows; when `itemsTruncated`, a paragraph saying so
- **`Mauzo Yaliyo Mkononi / Sales Still On The Phone`** — **rendered if and only if `declaredHeldCount > 0`**, carrying the count, the declared amount, and the sentence *"Hazijajumuishwa kwenye jumla hapo juu. Idadi hii imetolewa na simu. / Not included in the total above. This figure is declared by the phone."* This section is what makes the report honest, and a test asserts it is present whenever `declaredHeldCount > 0` (§8-C).

`fileName`: `` `RIPOTI-${receiptFileStem(reference)}-${hhmm}.pdf` `` — the submit time disambiguates a second close of the same day.

**No office-side PDF route in v1.** The office reads the record, which carries every number the paper does; the paper is the rep's hand-off artifact. Adding a second gate to this route (or a second route) buys nothing and doubles the surface that must stay terminal-bound. One line, deliberate.

**Size: M** (renderer + section assembly + tests: terminal isolation 404, held section present/absent, envelope-bypass headers).

### 1.5 `GET /mobile-pos-lite/day-reports` — NEW (the office read surface)

| | |
|---|---|
| Permission | `@RequirePermissions('mobile_pos_lite.manage')` — the existing terminal-admin gate. **No terminal headers**: this is a desktop call. |
| Query | `QueryMobilePosLiteDayReportsDto`: `terminalId?: string`, `from?: string`, `to?: string` (ISO dates), `limit` fixed at 100 |

Scoped exactly like `findTerminals()` — company scope resolved from the `AuthUser` through `companyScope`, never a client-supplied `companyId`. Returns the same serialised shape as §1.3, newest `submittedAt` first, `@@index([companyId, businessDate])` doing the work.

**Office UI (minimum viable):** a read-only "Ripoti za siku" register — a table of date · terminal · rep · sales count · gross total · held count, newest first, with a row expander showing the method and item breakdowns. This is the office surface, it is additive, it is behind a permission that already exists, and it touches **no POS shell code**. (Built as a first-class page at `frontend/src/app/(dashboard)/westsides/mobile-pos/day-reports/`, with the pure helpers in `day-reports-data.ts`, rather than as a panel inside `mobile-pos-terminal-admin.tsx` — the record is the deliverable and the page costs no more.)

**THE SUPERSESSION RULE — REVIEW-BLOCKING on every figure this surface totals.** §1.6 deliberately permits a terminal-day to be closed more than once, and §1.3 recomputes the WHOLE day from `SalesOrder` on every close. A later report therefore **fully contains** the earlier one: the rows of a terminal-day are successive snapshots, never additive slices. **No total on this surface may sum the rows.**

- **Deduplication key: `(terminal.id, businessDate, rep.id)` — the newest `submittedAt` wins.** The rep is part of the key because the report is `createdById`-scoped (§1.3): two reps sharing one terminal across a shift change (§8-D case 8) file two *disjoint* reports for one calendar day and both must count. A row missing any part of the key is keyed by its own id and always counted — hiding real money to satisfy a lookup gap is the worse error.
- **Every totalled figure obeys it**, `declaredHeldCount` / `declaredHeldAmount` included: a second close re-declares the same outbox rather than reporting a second one.
- **Resolve supersession AFTER the filters, over exactly the rows on screen.** The register must be verifiable by hand — the totals are the sum of the rows the table marks as counted — under any date range, branch, rep or terminal narrowing, not only in the default view.
- **A superseded close is shown, marked, never hidden.** That a day was closed twice is information (a shift handover reads differently from a rep who kept selling after ruling the line). Its figures render visibly un-counted rather than struck through: they were true of that snapshot.
- **The exports carry the screen's figures, from the same helper.** The register CSV/PDF gains a `Counted` column per row (`Yes` / `Yes (close n of N)` / `Superseded (close n of N)`), the PDF summary reports *terminal-days counted* alongside the submission count, and a superseded window carries the disclosure sentence. A single-report PDF built from a superseded close is stamped `SUPERSEDED`, because filed on its own it would otherwise read as the day.
- **The window cap cannot corrupt this.** The endpoint orders `submittedAt desc` and caps at 100, and a later close always carries a later `submittedAt` than the close it supersedes — so the cap can only drop superseded rows, never the counted one. A truncated window may under-report how many closes a day had; it can never mistake an earlier close for the day's truth.
- **Copy may not over-claim.** "Every figure is recomputed on the server" is true of a row and false of a sum; the footer says which of the two it is speaking about.

**Size: S** (endpoint) + **M** (register page: supersession, marked rows, exports).

### 1.6 Schema + migration

New model. Additive: no existing model gains a field or a relation.

```prisma
/// End-of-day sales report submitted from a Mobile POS Lite terminal
/// (spec-history-reports §1.3). Relation-free — plain ids plus name snapshots —
/// deliberately mirroring WestsidesDailyClose: the record must outlive a renamed
/// branch, a reassigned terminal and a deactivated rep, and the migration stays
/// purely additive. Every figure except declaredHeld* is computed server-side
/// from SalesOrder rows; the declared pair is what the PHONE was still holding,
/// which is the one fact the server cannot know, and it is named so on the
/// record and on the paper.
model MobilePosDayReport {
  id                 String   @id @default(uuid())
  companyId          String
  divisionId         String?
  branchId           String
  branchName         String
  terminalId         String
  terminalCode       String
  terminalName       String
  repUserId          String
  repName            String
  businessDate       DateTime @db.Date
  salesCount         Int
  grossTotal         Decimal  @db.Decimal(18, 2)
  itemsSoldQuantity  Decimal  @db.Decimal(18, 4)
  /// [{ paymentMethod, label, count, amount }]
  byMethod           Json
  /// [{ productId, name, quantity, amount }] — capped at 50, see itemsTruncated
  items              Json
  itemsTruncated     Boolean  @default(false)
  declaredHeldCount  Int      @default(0)
  declaredHeldAmount Decimal  @default(0) @db.Decimal(18, 2)
  /// Client-supplied idempotency token, written by the INSERT itself. NOT NULL
  /// on purpose: sales_orders and purchase_orders keep theirs nullable because
  /// desktop-created rows share those tables and Postgres treats NULLs as
  /// distinct — this table has no non-POS writer, so the nullable form would
  /// only weaken the guarantee.
  idempotencyKey     String
  submittedAt        DateTime @default(now())
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([companyId, idempotencyKey])
  @@index([companyId, businessDate])
  @@index([terminalId, businessDate])
  @@map("mobile_pos_day_reports")
}
```

Migration `database/prisma/migrations/<ts>_mobile_pos_day_reports/migration.sql`: `CREATE TABLE` + the unique index + the two indexes, with the same style of explanatory header the 20260813120000 migration carries. No backfill, no data rewrite, nothing dropped.

**Deliberately NOT unique on `(terminalId, businessDate)`.** A rep may legitimately close twice — a shift handover, or she sold more after closing — and refusing the second close either strands her or forces the first report to be a lie. Rows are timestamped snapshots; the newest for a terminal-day is the day's truth and the earlier ones are its history, which is what the office panel shows. A `sequence` column was considered and rejected: computing it by counting existing rows is exactly the create race the idempotency migration exists to prevent.

### 1.7 Permissions (summary)

| Surface | Gate |
|---|---|
| `GET /sales` + Historia ya Mauzo screen | `mobile_pos_lite.use` |
| `GET /purchases` + Historia ya Manunuzi screen | `mobile_pos_lite.purchase` (managers only — the same gate that guards recording a delivery) |
| `POST /day-reports`, `GET /day-reports/:id/pdf`, Funga Siku + Ripoti screens | `mobile_pos_lite.use` |
| `GET /day-reports` (office list) + admin panel | `mobile_pos_lite.manage` |

**No new permission codes, no seed change, no `sessionPayload` change, no `configVersion` bump.** The purchase history rides `purchasesEnabled`, which the session already carries (service 3124 region); the rest rides `.use`, which every terminal user has. This is the cheapest possible permission story and it is the correct one.

### 1.8 Explicitly NOT built

- No `days`/`search`/`page` parameters on either history route. No `/purchases/:id` or `/sales/:id` detail route — the list payload carries its lines, so the detail sheet costs zero extra round trips on a patchy network (the same call the cut spec-purchases §5.2 made, and the right one).
- No IDB snapshot of either history list (§6).
- No `PATCH`/`DELETE` on day reports from the POS surface. Corrections are a new close.
- No changes to `mySalesToday()`, `stock()`, `products()`, `createSale()`, `createPurchase()`, `createStockCount()`, the SW, terminal binding, or the outbox contract.
- No cost, total or value field on the purchases payload. Ever. (§0)

---

## 2. Navigation

### 2.1 Placement, and why

| Surface | Lives at | Reached from | Gate |
|---|---|---|---|
| **Historia ya Mauzo** | `#historia` | Leo — a full-width secondary row directly under the day list, `historyTitle` + chevron | `.use` |
| **Historia ya Manunuzi** | `#manunuzi/historia` | Manunuzi (Pokea) — the same secondary row under the form, `purchaseHistoryTitle` + chevron | `.purchase` |
| **Funga Siku** | `#funga` | Leo — a secondary button directly above the slab, `reportClose` (the SHIRIKI RISITI precedent, spec-sales §4) | `.use` |
| **Ripoti** (success) | `#ripoti` | forward from `#funga` on a 2xx | `.use` |

**Judgement call: the two histories live in two different modules rather than one screen with a Mauzo | Manunuzi toggle.** Reason: the permission boundary is the navigational boundary — sales history is everyone's, purchase history is managers' — and a shared screen would need an in-screen gate for a distinction the rail already encodes. It also avoids reviving the segment control that critique D3/D1 removed from Manunuzi.

**Judgement call: no new rail tab.** `KauntaShell`'s rail comment already states the rail must never grow a tab the back-map has no room for, and both histories are glance surfaces reached from the module whose book they are.

**Judgement call: Funga Siku belongs to Leo.** Leo is the day book; closing the day is ruling the line under the day's page. Naming follows the same logic — the ritual is a verb (`Funga Siku`, like `Tuma Sasa`), the artifact is a noun (`Ripoti ya Siku`), and the seal is `SIKU IMEFUNGWA` in the family of `IMELIPWA` / `MZIGO UMEPOKELEWA` / `HESABU IMEKAMILIKA`.

### 2.2 Router changes (`pos-router.ts`)

Four new `KauntaRoute` values — `'historia'`, `'manunuzi/historia'`, `'funga'`, `'ripoti'` — added to `ALL_ROUTES`. **None is added to `MODULE_ROUTES`**: all four are flow-interior, so a cold boot or a forward-button trip normalises to a parent rather than landing on a screen whose data has not been fetched.

```ts
const FLOW_PARENT: Partial<Record<KauntaRoute, KauntaRoute>> = {
  malipo: 'mauzo',
  risiti: 'mauzo',
  hesabu: 'stoo',
  historia: 'leo',
  'manunuzi/historia': 'manunuzi',
  funga: 'leo',
  ripoti: 'leo',
};
```

**REQUIRED FIX in `bootRouteFromHash()` — the gate must move after the parent resolution.** As written (lines 99–105) the function returns `FLOW_PARENT[raw]` *before* the `purchasesEnabled` check, so a hand-typed or restored `#manunuzi/historia` would resolve a rep's boot straight onto `#manunuzi`, bypassing the gate. Today's code is correct only by accident — `#hesabu`'s parent `stoo` is ungated. Restructure:

```ts
export function bootRouteFromHash(hash: string, opts: { purchasesEnabled: boolean }): KauntaRoute {
  const raw = routeFromHash(hash);
  if (!raw) return 'mauzo';
  const resolved = MODULE_ROUTES.has(raw) ? raw : (FLOW_PARENT[raw] ?? 'mauzo');
  if (resolved === 'manunuzi' && !opts.purchasesEnabled) return 'mauzo';
  return resolved;
}
```

`pos-router.test.ts` gains a case for exactly this: `bootRouteFromHash('#manunuzi/historia', { purchasesEnabled: false }) === 'mauzo'`.

**Stack discipline is unchanged and needs no new machinery.** Forward from the root pushes, forward between non-root screens replaces — so `#funga` → `#ripoti` replaces, and hardware back from the report can never re-open the confirm (the Risiti rule, for the same reason). Hardware back from any of the four unwinds to the root and the existing `FLOW_PARENT` rewrite pushes the parent, restoring the canonical `[#mauzo, screen]` depth. Leo and Manunuzi are both module routes, so the rewrite lands somewhere real.

**Mid-session revocation:** the shell's existing rule for Manunuzi (spec-purchases §1 — a refreshed session with `purchasesEnabled === false` navigates to Mauzo with no error screen) covers `#manunuzi/historia` unchanged, since it is reached only through the module.

### 2.3 Slab verbs and back-map

| Screen | Slab verb (blue) | Slab money (brass Display) | Back |
|---|---|---|---|
| `#historia` | `newSale` (MAUZO MAPYA) → Mauzo | day total when known (the Leo rule, spec-leo §6) | Leo |
| `#manunuzi/historia` | `slabNewDelivery` (MZIGO MPYA) → fresh Pokea | **none** — a cost-free screen carries no money, and inventing one would be the leak wearing a different hat | Manunuzi |
| `#funga` | `reportClose` (FUNGA SIKU) — disabled offline, disabled while busy | the day's gross total (preview) | Leo |
| `#ripoti` | `newSale` (MAUZO MAPYA) → Mauzo, with `slabShareReport` (SHIRIKI RIPOTI) as the secondary above it | the report's `grossTotal` | Leo |

The slab law holds everywhere: exactly one primary verb, disabled and never hidden.

---

## 3. Screens

Forward nav `animate-slide-in-right`, back `slide-in-left`. Keyboard rule (focused input collapses the slab to 28px) applies wherever an input exists. Mount animation `.aurora-stagger` on the first 12 rows. All four screens are Kaunta-only components under `screens/`; the classic shell never mounts them and they carry no `slabMode` prop (the StooScreen precedent).

### 3.1 Historia ya Mauzo (`#historia`)

**Layout, top to bottom:**

1. Header: `historyTitle` (Title 22/700) + `historyDays` (Label, secondary).
2. **Hero strip** (no ruled-line card — that texture belongs to Leo): `salesCountLabel` + count, and the window total in brass Display. Both from the server payload. When the merged held rows are non-empty, a second line in brass: `historyHeldTotal` ("Mkononi 2 · TZS 26,000") — the same shape as Leo's reconciliation line, and for the same reason: sent plus held is the drawer. **Its count and total come from the MERGED held rows and nothing else** — the same window-filtered set the list beneath renders. Totalling the whole outbox here (as the first cut did) put money on screen with no row to explain it: the outbox has no prune, so a row rejected twelve days ago read "Mkononi 2 · TZS 6,000" over a list showing one held sale worth 1,000. Out-of-window held rows are still in custody and still visible — in **Leo's queue**, which owns queue actions and shows the outbox whole.
3. **One list, newest first**, merging two sources — this is the "still queued locally" answer:
   - **Sent rows** from `sales[]`: `hh:mm` and `dd/MM` (Label secondary), amount as ink on a brass-subtle chip, the payment-method duotone icon chip with the session's configured label, customer name when present, small green check. Tap → detail sheet.
   - **Held rows** from the live IDB outbox, filtered to the same 7-day window — compared as **business-day keys** (`posDaylogDate`, §1.0.1) rather than as instants, so the phone's half of this one merged list cuts on exactly the midnights the server's half did: **brass left edge**, amount from the row's display snapshot, `lineSummary`, `pendingTime(createdAt)`, `queueWaiting` — or **red left edge** + `queueFailed` when `lastError` is set. Tap → detail sheet.
   - Held rows are **never counted into the server totals**. The server's numbers are the server's; the phone's are labelled as the phone's.
   - Merge key: sort by timestamp desc across both sources. Held rows have no `salesOrderNumber` — the chip reads `historyHeldChip` ("Mkononi") in its place.
4. **Detail sheet** (bottom sheet overlaying the list, the StooScreen/`RejectedSaleSheet` pattern — no route, no fetch, drag/scrim dismiss):
   - Sent sale: `salesOrderNumber` (Title), date + time, payment label, `paymentReference` when present, `customer` chip when present, then the lines — `qty × name`, unit symbol, `stockPrice` per unit and the line total as ink on brass-subtle chips — and `totalLabel` (JUMLA) in brass Display at the foot.
   - Held sale: rendered from the frozen outbox payload. Line names resolve from the cached catalog by `productId` with the productId itself as fallback — the exact resolution the rejected-sale ritual already uses (spec-sales §5.3). No order number; `queueWaiting`, or the mapped Swahili error via `posErrorMessage()` with the raw English collapsed behind `technicalDetails` when the row is red. **The sheet is read-only** — retry and removal stay in Leo's ritual, which is the one place that owns queue actions.
5. Slab per §2.3.

**States.** Loading (no data): `.aurora-skeleton` rows; the held rows render immediately regardless, since they are local truth. Empty: `historyEmpty` with the book duotone chip — **gated on `history !== null` and nothing else**, because "Hakuna mauzo katika siku 7 zilizopita" is a claim about the SERVER's book and the phone may only make it after reading that book. Offline it fetched nothing and caches nothing (§6), so the claim is unavailable to it and `leoOfflineNote` stands in its place, exactly as the States line below prescribes. (The first cut admitted `|| !online`, so an offline phone with a drained outbox printed the offline note and the empty-book claim one under the other.) Fetch error while online: inline `historyLoadError` + `tryAgain` (never leave-and-re-enter). Offline: `leoOfflineNote` in place of the sent group — reused verbatim, because its sentence ("sent sales will appear when the network returns") is exactly the truth here — with the held rows and their brass total still rendering. No Retry button offline: the `online` listener refetches by itself and the ribbon already names the condition (spec-leo §2.3).

**Fetch policy:** on screen open, and again on the `online` event and after an outbox flush completes. No max-age throttle and no snapshot store — the payload is small, the screen is not the boot path, and a cached sales list on a phone is a storage cost with no offline story (spec-leo §2.2's discipline).

**Size: M.**

### 3.2 Historia ya Manunuzi (`#manunuzi/historia`)

**Layout:**

1. Header: `purchaseHistoryTitle` + `historyDays`.
2. **No hero strip and no total anywhere on this screen.** The absence is the feature.
3. **List**, newest first, rows ≥56px, tap → detail sheet: supplier name (Body 17/500), `purchaseOrderNumber` + `dd/MM HH:mm` (Label secondary), a right-aligned quantity summary (`n bidhaa` using the existing `items` key), and a **brass** `purchaseIncomplete` chip when `status === 'INCOMPLETE'` — brass, not red, because no action of hers can fix it and red is reserved for server-rejected-needs-a-person.
4. **Detail sheet** (same pattern, zero extra fetches): supplier (Title), `poNumberLabel` + number, `grnNumberLabel` + number or "—" with the `purchaseIncomplete` chip, date/time, then the lines as `qty unitSymbol × name` — **and nothing else per line.** At the foot, the standing note `purchaseNoCostsNote` ("Bei za ununuzi hazionyeshwi kwenye simu.") in Label secondary. That line is not decoration: a manager who cannot find the cost must learn that the absence is deliberate, or she will report the screen as broken and someone will "fix" it.
5. Slab per §2.3.

**States.** Loading: skeleton. Empty: `purchaseHistoryEmpty` with the truck duotone chip. Error while online: `purchaseHistoryLoadError` + `tryAgain`. **Offline: `needsNetwork` and no rows** — unlike sales, there is no local source, and no snapshot store (managers check history in signal; a snapshot store was pre-approved as a follow-up in the cut spec and stays out of scope). No Retry button offline, same rule as above. The ribbon's kikaratasi slip badge still shows if a slip is parked — the unsent slip is visible even when history is not.

**Fetch policy:** on screen open, plus the `online` event. Pre-warmed on Manunuzi rail render, like Stoo and Leo.

**Size: M.**

### 3.3 Funga Siku (`#funga`) — the closing ritual

**Layout, top to bottom:**

1. Header: `reportTitle` + `reportForDate` with the date being closed.
2. **THE DATE CONTROL** (added after review — §3.3.1): `reportPickDay` over two chips, `reportDayYesterday` and `reportDayToday`, each carrying its `dd/MM/yyyy`. Exactly the two days the server accepts (§1.3), left to right in calendar order, the chosen one `aria-pressed` and ink on brass-subtle. Disabled while a send is in flight; it is a picker and not a warning, so it carries no colour of its own.
3. **`reportYesterdayNote`** — rendered only when the resumed/selected `businessDate` is yesterday: *"Unafunga siku ya jana. Mauzo uliyotuma leo asubuhi yataingia kwenye kitabu cha leo."* This is the honest disclosure of a real boundary (§8-D case 6), not a warning: calm secondary text, no amber.
4. **`reportDayUnclosed`** — rendered when the OTHER day still needs closing: *"Siku ya {date} bado haijafungwa."* In brass, because an unclosed trading day is custody. Its whole job is that a rep can never sign off an empty report for a day nobody worked while the day she DID work goes unclosed **and unmentioned**.
5. **`reportDayAlreadyClosed`** — rendered when the selected day already has a submitted report on this phone: *"Siku hii ilishafungwa. Ukifunga tena, ofisi itasoma ripoti mpya badala ya ile ya awali."* A second close is legitimate (§8-D case 2) and supersedes the first; it must be a knowing act rather than a surprise.
6. **Preview card** (`--aurora-card`): `salesCountLabel` + count; `reportGross` with the day total in **brass Display 40**; `reportByMethod` with one 48px row per method (duotone icon chip, configured label, count, amount as ink on brass-subtle). **Every figure on this card belongs to the day in the header** (§3.3.1), resolved by the pure `resolveClosePreview()` which the shell also feeds to the slab money, so the two can never disagree. Sources, in trust order: when the day being closed IS today, the live `my-sales-today` payload the shell already holds, else the rep-guarded `daylog` cache for today with its staleness chip (`leoLastKnown`); for any other day, that day's own rep-guarded `daylog` snapshot with the same chip; otherwise "—". The method breakdown is computed client-side from the live `daySummary.sales[]` rows and therefore renders **only** when today is the day being closed — the phone caches day totals, not rows, so another day has no breakdown to show and none is borrowed from today.
7. **`reportPreviewNote`** — *"Makadirio — ofisi itasoma rekodi kamili wakati wa kutuma."* The preview is a preview; the submitted numbers are recomputed server-side, and `itemsSoldQuantity` has no client source at all so it appears only on the report and the paper. This is the identical posture (and nearly the identical sentence) as Hesabu's `countPreviewNote`, which was reviewed and accepted for the same reason. **When the phone has no figures for the day being closed it is replaced by `reportNoFiguresForDay`** — *"Simu haina hesabu za siku hii. Ofisi itasoma rekodi kamili wakati wa kutuma."* — because "Makadirio" over another day's money would not be an estimate, it would be the wrong day's total.
8. **The held card** — rendered only when the local outbox is non-empty, in brass, never amber:
   - `reportHeldTitle` + the held rows (amount, `lineSummary`, `pendingTime`), red-edged for rejected ones.
   - `reportHeldNote`: *"Mauzo {count} bado hayajatumwa. Tuma sasa ili yaingie kwenye ripoti; yasipotumwa yataandikwa kwenye ripoti kama yaliyo mkononi."*
   - A **Tuma Sasa** button right there (existing `sendNow`), wired to the same `syncPendingSales` the Leo pending group uses; spinner while flushing, disabled offline or while syncing.
   - This card counts the WHOLE outbox, unlike Historia's brass line (§3.1): the declared held pair on the record is everything the phone is still holding, whenever it was rung up, and an out-of-window row is money in custody exactly like a fresh one.
9. Slab: `reportClose` (FUNGA SIKU). Disabled offline with inline `reportNeedsNetwork` above it. Disabled while `busy`, with `reportSubmitting` and the in-flight `--aurora-glow-primary`. Its money is the resolved preview's total — the day in the header's, or none at all.
10. `reportNotLocked` in Label secondary at the foot: *"Kufunga siku hakuzuii kuuza."* Closing does not lock the terminal, does not stop the outbox, does not end the shift. Saying so once, in the ritual, is cheaper than a support call.

**THE QUEUED-SALES DECISION — what happens when sales are still on the phone at close.** The rule is: **offer the flush, never block on the queue, always disclose.**

- A report that silently omits unsent sales is a lie, so silence is not on the table.
- Blocking the close until the outbox drains strands the rep the design exists for — the one in a village shop with no signal and three rejected rows she cannot clear. That is the same failure mode design-direction §9-9 rejected for the queue, and it is rejected again here.
- So: the held card offers **Tuma Sasa** first, because the *best* outcome is that the sales go and the report is simply complete. If the rep flushes and the queue drains, the close proceeds with `declaredHeldCount: 0` and no held section anywhere.
- If sales remain — rejected rows, or the flush failed — the close still proceeds. Pressing FUNGA SIKU with a non-empty outbox opens a **one-step confirm** (`reportConfirmHeld` naming the count, `reportConfirmAnyway` as the differently-labelled confirm button, `back` to cancel), because sending a report you know is incomplete should be a deliberate act rather than a reflex. With an empty outbox there is **no confirm at all** — a day report creates no financial fact and does not deserve friction.
- The declared figures then ride into the record and are printed on the paper under their own heading, saying they are not in the total and that the phone declared them (§1.4).
- **Offline the close cannot happen at all**, and the slab says so. Both halves of it — a record the office can see, and a letterhead PDF — require the office. There is no offline substitute for either, and inventing an outboxed day report would mean the office reading a snapshot of a day computed by a phone. Nothing is stranded: the daylog persists — including the INTENT written when this screen is opened with no signal (§3.3.1) — and `reportYesterdayNote` plus the server's today-or-yesterday window exist precisely so a rep who lost signal at 20:00 can close on the bus, or over breakfast.

#### 3.3.1 THE DAY BEING CLOSED — explicit, and always reachable

*(Added after review. The first cut of this screen had no date control at all, and the day was resolved silently from a frozen key. Two consequences, both severe: the server's yesterday allowance was unreachable in exactly the case it was built for — the rep with no signal never got to tap anything, so no key was ever frozen — and a day that ended offline could **never** be closed. The next morning the phone silently offered to close today, she submitted an empty report for a day nobody had worked, and the day she actually traded never reached the office.)*

**The day is a state of its own, independent of the key's** (§4-1). The key answers "what may I safely re-send"; the day answers "what am I closing". Conflating them is what made a whole trading day unreachable.

| | |
|---|---|
| The two days | `posDaylogDate()` and one day back, both in the **business timezone** (§1.0.1) — the same two days `resolveClosableBusinessDate` accepts, so the ends agree by construction rather than by coincidence. |
| Where the day comes from | Never the raw device clock's zone. `posDaylogDate` reads the business zone through ICU, mirroring the server's `businessDayKeyOf`, and falls back to the device's own calendar **only** when the engine carries no data for the zone — a missing timezone database must never leave a rep unable to name a day. A wrong device *clock* still degrades to a wrong day, and the picker is the recovery: it offers both days the server will accept, so a bad clock can never lock her out of closing. |
| Which day the screen opens on | In order of obligation: (1) an outstanding key for today; (2) an outstanding key for yesterday; (3) **yesterday still needing a close**; (4) today. Yesterday outranks today at (3) because yesterday *expires* — tomorrow the server refuses it — while today can still be closed all day. |
| "Still needing a close" | A day with no submitted `reportId` on this phone AND any of: an outstanding key, an offline INTENT, marks on that day's `tallyCount` (every queued or sent sale stamps one, so an offline evening leaves a trail), or a rep-guarded `sent` snapshot with sales in it. The rep guard is spec-leo §2.5's, unchanged: another rep's cached day is neither her money nor her obligation. |
| The INTENT | When the screen is opened **with no signal** and that day carries no close record, a close row is written carrying `businessDate`, `startedAt` and `openedOffline: true` — **and no `idempotencyKey`**. Nothing is being sent, so the freeze-before-send discipline of §4-2 is *satisfied*, not bent; and this row is what the next morning finds. Best-effort: the write returning false refuses nothing, because there is no send to refuse. |
| Choosing the other day | The chips call `selectDay(date)`, which adopts that day's own frozen key if it has one and mints nothing if it does not, so switching can neither strand a chain nor start one. Refused while a send is in flight — the day a request is already carrying cannot change under it — and refused for any date outside the two. |
| A day already closed | Still selectable and disclosed with `reportDayAlreadyClosed`. A second close is a legitimate newer snapshot of the same day (§8-D case 2) which the office reads as superseding the first. |

**Size: M.**

### 3.4 Ripoti (`#ripoti`) — the MUHURI

Reached only after a 2xx, so it renders from the server response and never from the preview.

1. **The stamp:** the solid brass seal `stampSikuImefungwa` (**SIKU IMEFUNGWA**) slams onto the summary card at ~−3° via the `pos-stamp` keyframe with one `--aurora-glow-accent` bloom and the `stampSent` [30,40,30] haptic. **Always solid** — the report exists on the server by construction, so there is no held variant, exactly like `MZIGO UMEPOKELEWA`.
2. Summary card from the response: date, `salesCountLabel` + `salesCount`, `reportGross` in brass Display, the `byMethod` rows, `reportItemsSold` + `itemsSoldQuantity`, and — when `declaredHeldCount > 0` — the held card repeated with the same "not in the total" sentence. `reportSentNote` ("Ripoti imefika ofisini.") under the card.
3. **`slabShareReport` (SHIRIKI RIPOTI)** as the secondary button directly above the slab. Pressed, it fetches `GET /day-reports/:id/pdf` and hands the `File` to the share sheet. **Never auto-invoked** — a share sheet that opens by itself is hostile, and the rep may want to look at the numbers first.
4. Slab: `newSale` (MAUZO MAPYA) → Mauzo. The counter is the job.

**The tally does NOT move.** design-direction §5-3 says every stamp adds a mark to the Daftari, and spec-leo §3 lists the write moments. This stamp is the documented exception: closing the day is ruling the line *under* the marks, not another entry on the page. `bumpDaylogTally` is not called from this path, and spec-leo §7 case 5 is amended accordingly.

**PDF share implementation.** `pos-receipt.ts` gains one exported function and loses nothing:

```ts
export async function sharePdfDocument(
  binding: MobilePosLiteBinding,
  path: string,          // '/api/backend/mobile-pos-lite/day-reports/<id>/pdf'
  fallbackName: string,
): Promise<'shared' | 'downloaded' | null>
```

— the body of `sharePdfReceipt` with the URL and fallback name lifted out, reusing `canShareReceiptFile` and `downloadReceiptFile` unchanged. **`sharePdfReceipt` and `fetchReceiptPdf` keep their exact signatures and behaviour** so `pos-receipt.test.ts` and the sale path do not move.

**Failure handling on the share:** the record already exists at the office, so a failed PDF fetch is never re-submitted and never re-keyed. Inline `reportPdfFailed` ("Karatasi haikupatikana — ripoti ipo ofisini. Jaribu tena.") with the share button still live. Desktop/no-file-share fallback downloads the file and toasts `reportDownloaded`, mirroring `receiptDownloaded`. A share sheet the user dismisses is swallowed with `.catch(() => undefined)` and surfaces nothing (the existing rule, and the ESLint empty-catch gate: `.catch(() => undefined)`, never `catch {}`).

**Size: M.**

---

## 4. The write path (`hooks/use-pos-day-report.ts`)

This is the only write in the module, and it obeys the discipline Phase 5 cost five review rounds to learn. `usePosSlip` (`hooks/use-pos-slip.ts`) is the reference implementation; this hook is its sibling and should be read beside it.

**1. The key is persisted with the local state that backs the submission, and frozen from the first send attempt.**

The close's local state is the day, so the key lives in the `daylog` entry for that date (§6):

```ts
close?: {
  idempotencyKey?: string;  // frozen from the first send attempt; ABSENT = none outstanding
  businessDate: string;     // frozen WITH it — a midnight rollover must not move the day
  startedAt: number;
  reportId?: string;        // set on 2xx
  submittedAt?: number;     // set on 2xx
  openedOffline?: boolean;  // THE INTENT (§3.3.1) — written with NO key, because nothing is sent
}
```

- The key is minted **at the first send attempt**, not on screen entry: opening a screen is not attempting a close, and a key minted per visit would litter the daylog. The offline INTENT is not an exception to this and must never become one: it carries no key, claims no chain, and exists only so the day itself stays reachable (§3.3.1).
- It is **frozen from that attempt until a 2xx or an explicit new close** — surviving remount, navigation, app kill, cold start and eviction. It never lives in a React ref alone: a key that dies on remount is how you get a duplicate.
- It is **never released by an edit**. There is nothing on this screen to edit; the frozen `businessDate` is what makes that true across midnight.
- On 2xx: `close.idempotencyKey` is cleared and `close.reportId` / `close.submittedAt` are written. A later deliberate close of the same day mints a fresh key — correct, because it is a genuinely new snapshot of records the server recomputes, and there is nothing to double-book.

**2. The write is load-bearing: a refused write refuses the send.**

`submit()` mirrors `PosSlip.sendKey()` exactly:

```
key = existing frozen key for this businessDate ?? newIdempotencyKey()
saved = await writeDaylogClose(terminalCode, businessDate, { idempotencyKey: key, businessDate, startedAt })
if (!saved) { rejectHaptic(); shake the slab; notice = t('reportKeySaveFailed'); return }   // POST nothing
POST /day-reports { idempotencyKey: key, businessDate, heldCount, heldAmount }
```

The write is **awaited** before the request, so "ahead" means the row is really down and not merely scheduled. A phone that would not keep the key is holding nothing to ask the server with; posting anyway is the whole failure written out — the POST lands, the answer is lost, the next attempt mints a fresh key and the office gets two reports for one day with nothing linking them. Nothing is lost by stopping: the screen stands, the numbers stand, the verb is unchanged, **and she is told** (`reportKeySaveFailed`) — a badge quietly failing to appear is not telling.

**3. A marker-matched replay is verified before it is replayed.** Server-side, three ways: terminal, rep, and `businessDate` (§1.3 step 3). A frozen key is a claim of sameness that only the server can check, and the mismatch is refused with a `ConflictException` plus an audit row, mapped on the phone to `reportConflict`.

**4. Replay protection is a database guarantee.** `@@unique([companyId, idempotencyKey])` on the INSERT itself (§1.3 step 4, §1.6). No read-then-write twin check anywhere on this path.

**5. Failure classification chooses WORDING only — never what is stored or destroyed.** New `posDayReportFailureMessage(error, t)` in `pos-errors.ts`, the same expression as `posPurchaseFailureMessage` because it is the same question, and with the same answer because the day report — like the purchase and unlike the sale — **has a frozen key**:

```ts
export function posDayReportFailureMessage(error: unknown, t: PosTranslate): string {
  const raw = error instanceof Error ? error.message : '';
  return posErrorKey(raw) === 'errorFallback' && posRefusalStatus(error) === null
    ? t('reportSendFailedRetry')          // unproven: the identical retry is safe under the frozen key
    : posErrorMessage(raw, t);
}
```

Whatever it says, the outcome is identical: **the key is kept, the screen stays, nothing navigates, nothing is cleared, nothing is stamped.** A connection-shaped failure and a 400 differ in one sentence of copy and in nothing else.

**6. The failure blocks the action and is told.** `#ripoti` is entered *only* on a 2xx. There is no optimistic stamp, no "sent" state on a pending request, no path on which the screen claims the office has something it does not. A failed close leaves the slab shaking (`shake` + `reject` [60,40,60]) with the mapped sentence inline above it — never a bare toast, never raw English as the primary line.

**7. Resume across a day boundary — and reach a day that ended with no signal.** On screen entry the hook reads **both** closable days' daylog rows *whole* (`getDaylogEntry`, not a close-only reader) and resolves the day being closed by the order of obligation in §3.3.1: an outstanding key for today, then one for yesterday, then **yesterday still needing a close**, then today. The screen renders `reportForDate` for the resolved day, `reportYesterdayNote` when it is not today, and the date control that reaches the other one.

The third rule is the one that matters, and it is why the reader is the whole row rather than the close: resuming only on a frozen `idempotencyKey` made the server's yesterday allowance unreachable in exactly the case it exists for. The rep who finished at 23:50 with no signal never tapped FUNGA SIKU, so no key was ever frozen — and the next morning the phone offered to close TODAY, she signed off an empty report for a day nobody had worked, and the day she traded never reached the office. Opening the close offline now persists the INTENT (§3.3.1) with **no key**, which is what the morning finds; and even without it, marks on that day's tally are evidence enough.

Entry is a **no-op once this session already holds a key or a report** — re-reading then could resurrect a key whose release write failed and turn a deliberate second close into a replay of the first.

---

## 5. i18n — exact new keys (`pos-i18n.ts`, both catalogs, flat `keyof` names, Swahili written first)

**Reused as-is, do NOT duplicate:** `salesCountLabel`, `totalLabel`, `payment`, `customer`, `items`, `saleItems`, `stockPrice`, `queueWaiting`, `queueFailed`, `sendNow`, `sending`, `needsNetwork`, `tryAgain`, `back`, `newSale`, `slabNewDelivery`, `technicalDetails`, `errorFallback`, `leoOfflineNote`, `leoLastKnown`, `noSalesToday`, `slipBadge`, `couldNotComplete`.

**Historia ya Mauzo (6):**

| key | sw | en |
|---|---|---|
| `historyTitle` | Historia ya Mauzo | Sales history |
| `historyDays` | Siku 7 zilizopita | Last 7 days |
| `historyEmpty` | Hakuna mauzo katika siku 7 zilizopita. | No sales in the last 7 days. |
| `historyLoadError` | Imeshindikana kupakua historia | Could not load history |
| `historyHeldChip` | Mkononi | On the phone |
| `historyHeldTotal` | Mkononi {count} · {amount} | On the phone {count} · {amount} |

**Historia ya Manunuzi (7):**

| key | sw | en |
|---|---|---|
| `purchaseHistoryTitle` | Historia ya Manunuzi | Purchase history |
| `purchaseHistoryEmpty` | Hakuna mzigo katika siku 7 zilizopita. | No deliveries in the last 7 days. |
| `purchaseHistoryLoadError` | Imeshindikana kupakua historia ya manunuzi | Could not load purchase history |
| `purchaseIncomplete` | Haijakamilika — itamaliziwa ofisini | Not finished — the office will complete it |
| `poNumberLabel` | Namba ya oda | Order number |
| `grnNumberLabel` | Namba ya kupokea | Goods received number |
| `purchaseNoCostsNote` | Bei za ununuzi hazionyeshwi kwenye simu. | Buying prices are not shown on the phone. |

(The first six revive names struck from spec-purchases §7 on 2026-08-11; the annotations there should be updated to point here rather than deleted, so the record of the cut and its reversal both survive.)

**Funga Siku + Ripoti (27):**

| key | sw | en |
|---|---|---|
| `reportClose` | FUNGA SIKU | CLOSE THE DAY |
| `reportTitle` | Funga Siku | Close the day |
| `reportForDate` | Ripoti ya {date} | Report for {date} |
| `reportPickDay` | Unafunga siku gani? | Which day are you closing? |
| `reportDayToday` | Leo · {date} | Today · {date} |
| `reportDayYesterday` | Jana · {date} | Yesterday · {date} |
| `reportDayUnclosed` | Siku ya {date} bado haijafungwa. | {date} has not been closed yet. |
| `reportDayAlreadyClosed` | Siku hii ilishafungwa. Ukifunga tena, ofisi itasoma ripoti mpya badala ya ile ya awali. | This day was already closed. Closing it again sends the office a newer report that replaces the earlier one. |
| `reportNoFiguresForDay` | Simu haina hesabu za siku hii. Ofisi itasoma rekodi kamili wakati wa kutuma. | This phone has no figures for this day. The office reads the full records when you send. |
| `reportGross` | Jumla ya mauzo | Gross sales |
| `reportByMethod` | Kwa njia ya malipo | By payment method |
| `reportItemsSold` | Bidhaa zilizouzwa | Items sold |
| `reportPreviewNote` | Makadirio — ofisi itasoma rekodi kamili wakati wa kutuma | Estimate — the office reads the full records when you send |
| `reportHeldTitle` | Mauzo yaliyo mkononi | Sales still on this phone |
| `reportHeldNote` | Mauzo {count} bado hayajatumwa. Tuma sasa ili yaingie kwenye ripoti; yasipotumwa yataandikwa kwenye ripoti kama yaliyo mkononi. | {count} sales have not been sent yet. Send them now to include them; otherwise the report records them as still on the phone. |
| `reportConfirmHeld` | Ripoti hii haitajumuisha mauzo {count} yaliyo mkononi. Endelea? | This report will not include {count} sales still on this phone. Continue? |
| `reportConfirmAnyway` | Ndiyo, funga siku | Yes, close the day |
| `reportSubmitting` | Inatuma ripoti… | Sending the report… |
| `reportNeedsNetwork` | Kufunga siku kunahitaji mtandao | Closing the day needs a network connection |
| `reportKeySaveFailed` | Simu haikuhifadhi ripoti — jaribu tena. | The phone could not save the report — try again. |
| `reportSendFailedRetry` | Ripoti haikutoka — jaribu tena; haiwezi kutumwa mara mbili. | The report did not go out — try again; it cannot be sent twice. |
| `stampSikuImefungwa` | SIKU IMEFUNGWA | DAY CLOSED |
| `reportSentNote` | Ripoti imefika ofisini. | The report reached the office. |
| `slabShareReport` | SHIRIKI RIPOTI | SHARE REPORT |
| `reportPdfFailed` | Karatasi haikupatikana — ripoti ipo ofisini. Jaribu tena. | The paper could not be prepared — the report is at the office. Try again. |
| `reportDownloaded` | Ripoti imepakuliwa — ambatisha kwenye ujumbe wowote. | Report downloaded — attach it to any message. |
| `reportNotLocked` | Kufunga siku hakuzuii kuuza. | Closing the day does not stop you selling. |
| `reportYesterdayNote` | Unafunga siku ya jana. Mauzo uliyotuma leo asubuhi yataingia kwenye kitabu cha leo. | You are closing yesterday. Sales you sent this morning belong to today's book. |

**Mapped rejections (2):**

| key | sw | en |
|---|---|---|
| `reportConflict` | Ripoti hii ni ya siku au kituo kingine — ulizia ofisi. | This report belongs to a different day or terminal — ask the office. |
| `errReportDateClosed` | Siku hii haiwezi kufungwa — ulizia ofisi. | This day cannot be closed — ask the office. |

**`pos-errors.ts` — two new `ERROR_PATTERNS` rows, appended after the existing ones, each certified verbatim against its throw site** (the file's tripwire rule, header lines 12–26 — `pos-errors.test.ts` replays every sentence exactly as the service throws it):

| pattern | key | backend sentence (verbatim, `mobile-pos-lite.service.ts` `createDayReport`) |
|---|---|---|
| `/day report key was already used/i` | `reportConflict` | `This day report key was already used for a different day or terminal` |
| `/can be closed from a mobile pos terminal/i` | `errReportDateClosed` | `Only today or yesterday can be closed from a Mobile POS terminal` |

Ordering check (required, because the file's own comment records a near-collision that had to be ordered around): neither sentence matches any earlier row — the `terminalUnavailable` row's alternatives are *"terminal is not active"*, *"device is not registered"*, *"assigned to a different sales rep"*, *"mobile pos user is not active"*, *"activate this mobile pos device"*, and *"different day or terminal"* matches none of them. `pos-errors.test.ts` asserts both sentences map to their keys **and** that no earlier row claims them.

**Total: 40 new flat keys ×2 catalogs, +2 error rows. Size: S.** (34 in the original cut; the six `reportPickDay` / `reportDay*` / `reportNoFiguresForDay` keys were added with the date control and the day-bound preview, §3.3.1.)

---

## 6. IndexedDB

**DB `itemba-mobile-pos-lite` stays at version 4. There is no migration in this module.**

The one piece of new local state — the close's frozen key — reuses the existing `daylog` store, which is semantically its home: the close belongs to the day, and the daylog is already keyed `` `${terminalCode}:${date}` ``, already pruned to 7 days, and already the thing that survives an app kill offline. IndexedDB values are schemaless, so an optional field on an existing store's value needs no `onupgradeneeded` change and no version bump; a daylog row written before this ships loads unchanged and simply carries no close.

```ts
/** An end-of-day close for this date (spec-history-reports §4). */
export type PosDaylogClose = {
  /** FROZEN from the first send attempt until a 2xx or a new close. Absent = no attempt outstanding. */
  idempotencyKey?: string;
  /** Frozen WITH the key: a retry after midnight must still close the day it began on. */
  businessDate: string;
  startedAt: number;
  /** Set on 2xx — the id the PDF is fetched from, and the proof the day was closed. */
  reportId?: string;
  submittedAt?: number;
  /**
   * THE INTENT (§3.3.1, added after review): the rep opened Funga Siku for this
   * day with NO SIGNAL. Carries no key — nothing is being sent — and is what the
   * next morning's entry finds. Without it, a day that ended offline left no
   * trace at all and could never be closed from the phone.
   */
  openedOffline?: boolean;
};

export type PosDaylogEntry = {
  terminalCode: string;
  date: string;
  tallyCount: number;
  sent?: PosDaylogSent;
  close?: PosDaylogClose;   // NEW — optional, additive, no version bump
};
```

New helpers, in the existing one-transaction-open-close-in-`finally` style beside `bumpDaylogTally` / `writeDaylogSent`:

- `writeDaylogClose(terminalCode, date, close): Promise<boolean>` — read-modify-write of that date's row. **Returns whether the write actually landed**, so `submit()` can refuse to send when the phone refused to keep the key (§4-2). This is deliberately unlike `bumpDaylogTally`, whose failure is fire-and-forget: a tally mark is bookkeeping, a frozen key is custody. It also writes the offline INTENT, where a false return refuses nothing because nothing is being sent.
- **No narrow `readDaylogClose` reader** (dropped after review). The close screen has to weigh a day's WHOLE row — the close record, the tally marks and the rep-guarded `sent` snapshot together — to answer "does this day still need closing, and what may I honestly show for it?", and a reader that returned only the close is exactly what let the first cut resolve the day from an idempotency key alone and lose a day that ended with no signal. The existing `getDaylogEntry` is the reader; the judgement lives in `usePosDayReport` (§3.3.1).

**`posDaylogDate` reads the BUSINESS timezone** (§1.0.1), not the device's zone: it is the daylog's day key, the day a close is filed under, and the `businessDate` the phone sends, so it must be the same string the server's `businessDayKeyOf` produces for the same instant. It falls back to the device's own calendar only when the engine carries no ICU data for the zone — a missing timezone database must never leave a rep unable to name a day.

Retention is unchanged: the existing 7-day prune already covers close records, and a close's useful life is the day it closes plus the morning after.

**Untouched:** `outbox`, `bindings`, `catalogs`, `sessions`, `frequents`, `stocks`, `drafts`, and every existing daylog helper. **No history snapshot store** for either list — a cached sales or purchase list is a storage cost with no offline story (the sales history already has its held rows from the outbox, which is the only part a rep can act on offline). **No new localStorage keys.**

**Size: S.**

---

## 7. Offline behaviour (offline-as-custody, per screen)

| Screen | Offline |
|---|---|
| **Historia ya Mauzo** | Held rows in the window render in full from IDB — they are local truth and need no network. The sent group collapses to `leoOfflineNote`; the brass `historyHeldTotal` still shows, so the screen never looks empty. **`historyEmpty` does not render offline at all**: with nothing fetched and nothing cached the phone cannot say the server's book is empty (§3.1). No Retry button (the `online` listener refetches; the ribbon names the condition). No stale server list is shown, because none is cached. |
| **Historia ya Manunuzi** | `needsNetwork`, no rows, no Retry. There is no local source and nothing is pretended. The ribbon's slip badge still shows if a kikaratasi is parked. |
| **Funga Siku** | Fully browsable: the preview renders from the day being closed's own rep-guarded `daylog` snapshot with `leoLastKnown` staleness (or says it has none — §3.3.1), and the held card renders from the live outbox. The slab verb is **disabled** with `reportNeedsNetwork` inline — submission and the paper both need the office, and a report computed by a phone is not a report. **Opening it offline persists the INTENT** for the day being closed: a close row with no key, which is what makes the day reachable in the morning. Nothing is lost: the frozen key, the intent and the day all persist, and the server's today-or-yesterday window is what makes closing later legitimate rather than a workaround. |
| **Ripoti** | Reachable only after a 2xx, so it is online-born. If the network dies before the share, the record is already safe at the office and the screen says exactly that (`reportSentNote` stands, `reportPdfFailed` explains the paper, the share button stays live). The stamp is never rolled back. |

The ribbon, the slab sync token and the four-color law are unchanged on all four screens: brass for money and custody (held rows, held totals, the seal), blue for the one verb, green for arrived-at-the-office, red only for a server-rejected sale. **No amber appears anywhere in this module.**

---

## 8. Build checklist

### A. Backend

0. `MOBILE_POS_BUSINESS_TIMEZONE = 'Africa/Nairobi'` module constant (§1.0.1) and the four helpers that read it — `businessDayKeyOf`, `businessDayStart`, `shiftBusinessDayKey`, `businessDayWindow`. **Every** day boundary in the module goes through these; `new Date(v.getFullYear(), v.getMonth(), v.getDate())` is review-blocking anywhere in this file except inside `mySalesToday()`, which is deliberately untouched.
1. `MOBILE_POS_HISTORY_DAYS = 7` module constant; both read methods share the boundary helper.
2. `salesHistory()` — aggregate + bounded findMany, explicit selects, no cost/margin fields.
3. `purchaseHistory()` — REVIEW-BLOCKING docstring, explicit selects at every level, GRN join, COMPLETE/INCOMPLETE derivation, exact key set.
4. `createDayReport()` — validation → key lookup → three-way verification → compute → insert-with-key → unique-violation path → audit rows. Both throw sentences copied into `pos-errors.ts`'s header comment as sources.
5. `dayReportPdf()` — terminal-bound lookup, letterhead assembly, held section gated on `declaredHeldCount > 0`.
6. `dayReports()` — company-scoped office list.
7. Controller: 5 routes, terminal headers on 4 of them, the PDF route copying `saleReceipt`'s `@Res()` shape and header set.
8. DTOs: `CreateMobilePosLiteDayReportDto`, `QueryMobilePosLiteDayReportsDto`. No boolean query params anywhere — the `@Type(() => String) @Transform` coercion gotcha does not arise.
9. Prisma model + additive migration.

### B. Frontend

10. `pos-router.ts`: 4 routes, `FLOW_PARENT` entries, **the gate-ordering fix** and its test.
11. `use-pos-history.ts`: two fetchers, `online`/post-flush refetch, error/empty/loading state, the sales merge with the outbox. The empty state is the merge's, and so is Historia's brass held line (§3.1).
12. `use-pos-day-report.ts`: frozen-key lifecycle; **the day machine of §3.3.1** — both days read whole, the order of obligation, `selectDay`, the offline INTENT — the pure `resolveClosePreview()`, `submit()` with the write-before-send gate, failure classification, PDF share.
13. Four screens + two detail sheets. Funga Siku carries the date control, the unclosed/already-closed disclosures, and a preview bound to the day in its header.
14. `KauntaShell`: route rendering, slab verbs (§2.3), the Leo entry row and button, the Manunuzi entry row, `repId` into the close hook, and the ONE `resolveClosePreview()` result feeding both the card and the slab money.
15. `pos-receipt.ts`: `sharePdfDocument` extracted; `sharePdfReceipt` untouched.
16. `pos-i18n.ts` 40 keys ×2; `pos-errors.ts` 2 rows + `posDayReportFailureMessage`.
17. `mobile-pos-lite-store.ts`: `PosDaylogClose` (with `openedOffline`), `writeDaylogClose`, `posDaylogDate` in the business timezone (§1.0.1). **No version bump.**
18. `mobile-pos-terminal-admin.tsx`: the office panel.

### C. Tests that must exist

**C1 — the cost-blindness assertion (review-blocking).** In `mobile-pos-lite.service.spec.ts`, against a purchase history response built from a PO whose lines carry non-zero `unitCost`/`lineTotal`:

```ts
expect(Object.keys(res).sort()).toEqual(['count', 'days', 'from', 'purchases']);
expect(Object.keys(res.purchases[0]).sort()).toEqual([
  'grnNumber', 'id', 'lines', 'purchaseOrderNumber', 'recordedAt', 'status', 'supplierName',
]);
expect(Object.keys(res.purchases[0].lines[0]).sort()).toEqual([
  'name', 'productId', 'quantity', 'unitSymbol',
]);
// And recursively, so a field added to PurchaseOrderLine next year cannot slip
// through a suite that still passes. Keys only — a product legitimately named
// "Total Motor Oil" must not fail the build.
const keys = (value: unknown): string[] =>
  Array.isArray(value) ? value.flatMap(keys)
  : value && typeof value === 'object'
    ? Object.entries(value).flatMap(([k, v]) => [k, ...keys(v)])
    : [];
expect(keys(res).filter((k) => /cost|price|amount|total|value|margin|profit|cogs/i.test(k)))
  .toEqual([]);
```

**C2 — the same recursive key scan on the sales history**, with the allowlist admitting `totalAmount`, `unitPrice` and `lineTotal` (selling-side, already on the phone) and rejecting `unitCostAtSale`, `cogsAmount`, `grossProfitAmount`, `grossMarginPct`.

**C3** — `.use`-only user gets 403 on `GET /purchases`; `.purchase` user gets 200.

**C4** — day report: fresh close; exact replay returns the identical record and creates no second row; same key with a different `businessDate` ⇒ 409 + audit row; same key from a different terminal ⇒ 409; simulated unique violation on insert resolves to the existing row; a `businessDate` two days old ⇒ 400 with the verbatim sentence; a zero-sale day submits honestly; `declaredHeld*` survive a replay unchanged.

**C4-TZ** (added after review) — the business-day boundary, asserted as ABSOLUTE instants under fake timers set to `2026-08-14T21:30:00.000Z` (00:30 on 15 August in Dar): a close for `2026-08-15` is accepted rather than 400'd; its window is `[2026-08-14T21:00Z, 2026-08-15T21:00Z)` so nothing is cut at 03:00; `2026-08-14` is reachable as yesterday while `2026-08-13` and `2026-08-16` are refused; both history windows cut on the same midnights. The expectations are computed from the zone by *name*, never from the machine's, so the suite asserts one boundary whether it runs on the UTC container, on CI, or on a laptop in EAT — and a revert to process-local arithmetic fails on the two clocks that matter. Verified green under `TZ=UTC`, `TZ=Africa/Nairobi` and `TZ=Pacific/Kiritimati`.

**C4-ITEMS** (added after review) — `salesOrderLine.groupBy` is called with no `take`/`skip` and with `where.salesOrder` deep-equal to the headline aggregate's `where`; a 900-order day reports its true `itemsSoldQuantity`; `salesOrder.findMany` is not called at all on this path; and the PDF's truncation paragraph vouches only for figures no bound can move.

**C5** — PDF: held section present when `declaredHeldCount > 0` and absent when 0; another terminal's report id ⇒ 404.

**C6** — frontend: `writeDaylogClose` failure ⇒ **no POST is issued**, `reportKeySaveFailed` is shown, the slab shakes (the `usePosSlip` refused-write test is the template); the frozen key survives a hook remount; a close begun before midnight and retried after it sends the original `businessDate`.

**C6-DAY** (added after review, `kaunta-history.test.tsx` HIST-13/14 and `mobile-pos-lite-store.test.ts`) — the day machine:

- a day worked and never closed (tally marks only, no key) is the day the screen OPENS on the next morning, and the close it sends carries that `businessDate` with a fresh key;
- the same when the day's only trace is the offline INTENT;
- opening the close offline WRITES that intent — a close row with `openedOffline: true`, **no `idempotencyKey`**, no `reportId` — and still posts nothing;
- the date control reaches the other day, and the day still needing a close is named on screen (`reportDayUnclosed`) once she has moved away from it;
- a day already closed does not hijack the default, and re-selecting it discloses `reportDayAlreadyClosed`;
- the preview and the slab show "—" plus `reportNoFiguresForDay` for a day the phone has no figures for, never today's live total under yesterday's date; that day's OWN stored snapshot renders with its `leoLastKnown` chip; another rep's snapshot renders as no snapshot at all;
- `posDaylogDate` cuts the day at 21:00Z (midnight EAT) — asserted from absolute instants so it holds on a UTC container, on CI and on a laptop in EAT, and fails on any revert to device-local arithmetic.

**C6-HONESTY** (HIST-15/16) — Historia says only what the phone can know: offline with a drained outbox it renders `leoOfflineNote` and **not** `historyEmpty`, while a server-reported empty book still renders it; and the brass held line counts exactly the held rows the list shows, so a twelve-day-old outbox row is absent from both rather than totalled with no row to explain it.

**C7** — `pos-errors.test.ts`: both new sentences map, and no earlier row claims them.

**C8** — `pos-router.test.ts`: `#manunuzi/historia` with `purchasesEnabled: false` boots to `mauzo`; all four new hashes normalise to their parents on cold boot.

### D. Edge cases

1. **Rep sells after closing.** Nothing is locked (`reportNotLocked`). The sale posts normally and is simply not on the submitted report; a second close captures it as a later snapshot.
2. **Two closes of the same day.** Both rows survive and both are listed; no unique constraint refuses her (§1.6). The office register counts the terminal-day **once**, from the newest close, and marks the earlier one superseded — every close recomputes the whole day, so the later report contains the earlier and adding them would inflate the day. See the supersession rule in §1.5, which governs every figure the office totals and both of its exports.
3. **Double-tap FUNGA SIKU.** The slab is disabled while `busy`; the frozen key makes the race harmless anyway, and the unique index settles it in the database.
4. **Outbox drains between a failed attempt and its retry.** The replay returns the first record with its original `declaredHeldCount` — deliberately stale rather than mutating a record the office may have printed. A fresh close corrects it (§1.3).
5. **A queued sale flushes the next morning.** `createSale` stamps `orderDate` at post time, so the sale lands in *today's* book, not the day it was rung up. Yesterday's report discloses it as held; today's counts it. Accepted, and `reportYesterdayNote` says so on the one screen where it matters. Changing `orderDate` semantics is a sales-module decision, not a POS-report one.
6. **Midnight during a close.** The frozen `businessDate` rides the retry; both closable days are read on entry and the day still needing a close is the one the screen opens on (§3.3.1/§4-7); the server accepts today or yesterday **in the business timezone**, which is the same zone the phone derives them in. All three agree by construction.
6b. **The day that ended with NO SIGNAL.** She rings sales offline until 20:00 in a village shop, opens Funga Siku — the slab is dead and says so, and the INTENT is written — and goes home. The next morning on wifi, Funga Siku opens on YESTERDAY, named in the header and in the picker, and the close she sends carries yesterday's `businessDate`. Under the first cut nothing was written offline, the morning found nothing, the phone silently offered today, and the day she traded never reached the office. This is now the case the whole day machine is shaped around, and even without the intent the day's tally marks are evidence enough.
7. **Device clock wrong.** The server refuses any `businessDate` outside today-or-yesterday **in the business timezone** (§1.0.1), mapped to `errReportDateClosed`. A wrong clock degrades the chrome, never the record — the same posture as the Stoo freshness clock and the daylog date key. Note what this is *not*: the boundary is never taken from the device, so a wrong clock cannot file a day under the wrong date, cannot move a total, and cannot block a sale. It can only stop the app minting a report the office can already read — and even that is recoverable rather than a lock-out, because the picker offers both days the server accepts rather than one day derived from the clock.
8. **Shift change on one terminal.** The report is `createdById`-scoped, so each rep closes her own day; the daylog `close` is date-keyed per terminal, so a second rep closing the same date under the same terminal mints her own key and gets her own record (the shared-phone guard on the cached *total*, spec-leo §2.5, is unchanged and still governs what she is shown before she closes).
9. **Terminal re-activated with a new code.** Orphaned daylog rows (close records included) age out through the existing 7-day prune. No sweep needed.
10. **>200 sales in the window / >50 distinct products on a report day.** The history list truncates oldest-first, and the report's item breakdown ranks the whole day by value and prints the top 50 with `itemsTruncated`. Every figure the record or the paper presents as a total — `count`/`totalAmount` on the history, `salesCount`/`grossTotal`/`itemsSoldQuantity` on the report — comes from an unbounded aggregate and cannot be moved by any bound. There is no longer an order-count bound on the report at all.
11. **Purchase recorded by a colleague.** Visible — the branch book, by design (§1.2). Recorded-by is deliberately omitted to avoid implying blame.
12. **INCOMPLETE purchase never completes.** The office finishes it from the desktop; the row flips on the next fetch. No retry from history: the resume token lives with the client that owns it, and a different device retrying blind could diverge.
13. **Manager looks for a buying price.** `purchaseNoCostsNote` tells her it is deliberate. There is no setting, no long-press, no manager-only reveal — the payload does not contain the number.
14. **`popstate` × QR login.** All four new hashes join the existing Android gesture-nav × `?terminal=&code=` test matrix.
15. **Reduced motion.** The `SIKU IMEFUNGWA` stamp appears without animation via the existing global kill-switches; the haptic is independent.

---

## 9. Build-size ledger

| Piece | Size |
|---|---|
| `GET /sales` + tests (incl. C2 key scan) | **M** |
| `GET /purchases` + tests (incl. C1 key-set assertion) | **M** |
| `POST /day-reports` — chain, verification, audit rows, tests C4 | **L** |
| `GET /day-reports/:id/pdf` — letterhead assembly + tests C5 | **M** |
| `GET /day-reports` (office list) | **S** |
| Prisma model + additive migration | **S** |
| Office panel in `mobile-pos-terminal-admin.tsx` | **S** |
| Router: 4 routes + gate-ordering fix + tests C8 | **S** |
| `use-pos-history.ts` (two fetchers + the outbox merge) | **S** |
| `use-pos-day-report.ts` (frozen-key lifecycle, resume, submit gate) + tests C6 | **M** |
| Historia ya Mauzo screen + detail sheet | **M** |
| Historia ya Manunuzi screen + detail sheet | **M** |
| Funga Siku screen (preview, held card, Tuma Sasa, confirm) | **M** |
| Ripoti screen + MUHURI + `sharePdfDocument` | **M** |
| i18n 40 keys ×2 + 2 error rows + `posDayReportFailureMessage` + tests C7 | **S** |
| `PosDaylogClose` + 2 store helpers (no version bump) | **S** |

**Total: 1 L + 7 M + 7 S.**

**Suggested PR order** (each ships independently; nothing below blocks anything above it):

1. `GET /sales` + `GET /purchases` + their tests — pure additive reads, deployable before any UI exists.
2. Router routes + gate fix + i18n keys — inert until screens land.
3. Historia ya Mauzo, then Historia ya Manunuzi.
4. Prisma model + migration + `POST /day-reports` + `GET /day-reports/:id/pdf` — backend only, no screen yet.
5. `use-pos-day-report.ts` + Funga Siku + Ripoti.
6. Office list endpoint + admin panel.

Backend reads can deploy ahead of the phones safely; the day-report backend **must** land in the same release train as Funga Siku, so no screen can ever call an endpoint that is not there.

---

## 10. Invariants and review gates

1. **`frontend/src/components/westsides/mobile-pos-lite/mobile-pos-lite.characterization.test.tsx` stays byte-identical.** `git diff --stat` on it must be empty in every PR of this module. Nothing here touches the behaviours it pins.
2. **The classic shell (`uiVersion 1`) stays behaviourally identical.** Every new screen, route, hook and slab verb is reached only through `KauntaShell`. The new components take no `slabMode` prop, the classic screens are not edited, and `mobile-pos-lite.tsx` gains nothing beyond the props the Kaunta path already threads. The whole fleet runs classic today; this module must be invisible to it.
3. **No cost or value field on the purchases payload — asserted, not assumed** (§0, §1.2, §8-C1). `include:` is banned on both read endpoints. This is review-blocking on every future change to either route.
4. **Server-authoritative everything.** Every figure the office reads is recomputed server-side from `SalesOrder` rows; the only client-declared numbers on the record are `declaredHeldCount`/`declaredHeldAmount`, and they are named as declared on the record, in the response and on the paper. Terminal binding via `x-mobile-pos-terminal`/`x-mobile-pos-device` → `requireTerminal()` on all four device-facing routes. **No figure a record stores or a paper prints as a total may come from a bounded query** — the only bound left in the module is the 50-row display cap on the report's item list, applied after the whole day is ranked (§1.3).
4b. **One business timezone** (§1.0.1). Every day boundary in this module is cut at midnight in `MOBILE_POS_BUSINESS_TIMEZONE`, which is the same zone the module renders every time in. Deciding a day from the process's zone, from `process.env.TZ`, or from a client-supplied instant is review-blocking anywhere in `mobile-pos-lite.service.ts` except inside `mySalesToday()`, whose own comment records why it is frozen. The regression tests assert absolute instants computed from the zone by name, so the boundary cannot be re-broken by the container's environment. **The phone obeys the same constant**: `posDaylogDate` (`frontend/src/lib/mobile-pos-lite-store.ts`) reads `POS_BUSINESS_TIMEZONE = 'Africa/Nairobi'` through ICU for the daylog key, the day picker and the `businessDate` it sends, so the two ends name the same day for the same instant. Deriving a business day from the device's zone is review-blocking there too.
5. **Permissions:** sales viewing `.use`; purchase viewing `.purchase`; the day report `.use`; the office list `.manage`. No new codes, no seed change, no `configVersion` bump.
6. **Swahili first.** All 40 keys are flat `keyof` names in **both** catalogs, Swahili written first and English translated from it. Every reachable backend rejection maps to actionable Swahili in `pos-errors.ts`, with `pos-errors.test.ts` certifying against sentences copied verbatim from the service.
7. **No empty catch blocks.** Every swallow is `.catch(() => undefined)` with a comment saying why ignoring is safe (the dismissed share sheet), or it is not swallowed at all (the daylog close write, which returns its outcome and blocks the send).
8. **The write path.** Key persisted with the local state and frozen from the first attempt; verified before replay; database-guaranteed against races; never destroyed on failure; never claimed as sent when it was not.
9. **The day is explicit and reachable** (§3.3.1). The screen names the day it is closing, offers both days the server accepts, and opens on the one that still needs closing. A day that ended with no signal must stay closable the next morning: the offline INTENT carries no key precisely so the freeze-before-send rule of §4-2 stays intact. Removing the picker, resolving the day from a frozen key alone, or writing a key on screen entry are each review-blocking.
10. **A screen shows one day's money under one day's date.** Every figure on Funga Siku — card, breakdown, staleness chip and the slab money above it — comes from the single `resolveClosePreview()` result for the day in the header, or is rendered as "—" with `reportNoFiguresForDay`. Likewise Historia: the brass held line counts the rows the list shows, and `historyEmpty` is a claim about the server's book that is never made without having read it.
