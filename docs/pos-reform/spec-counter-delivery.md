# MODULE SPEC — Counter delivery: marking a POS sale delivered at the moment it is paid

Build-ready spec for the owner's decision of 2026-08-15:

> **"fix it properly — mark counter sales delivered on payment"**

The alternative — teaching the sales-order lifecycle display that a cash-and-carry sale has no delivery stage — was rejected. Marking it delivered is honest about what physically happened, and it fixes the downstream fulfillment reports too. This spec builds the honest version.

**Scope: the Mobile POS Lite sale path only** — `MobilePosLiteService.createSale`, which BOTH shells run (`uiVersion 1`, the classic shell the whole fleet uses today, and `uiVersion 2`, the Kaunta pilot trading live right now). Nothing in this spec changes the desktop Quick Sale, the Operations sales-order flow, or `SalesOrdersService` itself.

Verified against main @ `47d11ebe`. Anchors read before writing this spec:

- `backend/src/modules/mobile-pos-lite/mobile-pos-lite.service.ts` — constructor 775–785, `createSale()` 2003–2088, `resolveSaleLines()` 2749–2790, `isUniqueViolation()` 342–344, `claimPurchaseKey()` 2980–2990, `findPurchaseByKey()` 3008–3054, `drivePurchaseChain()` 3077–3187, `settleUnfinishedPurchase()` 3204–3242
- `backend/src/modules/delivery-notes/delivery-notes.service.ts` — all 232 lines: `create()` 18–63, `findAll()` 65–79, `findOne()` 81–124, `dispatch()` 168–180, `deliver()` 182–201, `cancel()` 203–217
- `backend/src/modules/sales-orders/sales-orders.service.ts` — `mobilePosLiteQuickSale()` 1528–1542, `create()` 1543–1645, `confirm()` 2026+, `createAndConfirm()` 2519–2562, `replayQuickSale()` 2568–2642, `fulfillment()` 1046–1090, `findOne()` 1136–1214, list include 541–546, control-centre include 839–851
- `backend/src/modules/entity-code-generator/entity-code-generator.service.ts` — `next()` 74–86 (race-safe, accepts `tx`), `defaults.ts:129` (`DeliveryNote: DN-{YYYY}-`, padding 5, YEARLY)
- `backend/src/modules/westsides-dashboard/westsides-dashboard.service.ts` — `OPEN_DELIVERY_STATUSES` 55–59, seven delivery-note queries at 577, 582, 591, 600, 609, 893, 947; `ordersAwaitingDelivery` 626–629; fulfillment payload 1157–1184; `fulfillment-backlog` alert 2579–2586
- `backend/src/modules/westsides-reports/westsides-reports.service.ts` — `deliveryPerformance()` 1497–1545
- `backend/src/modules/global-search/global-search.service.ts` — `searchDeliveryNotes()` 905–940
- `database/prisma/schema.prisma` — `DeliveryNote` 4911–4947, `DeliveryNoteLine` 4950–4967, `DeliveryNoteStatus` 4506–4512, `SalesOrder.mobilePosTerminalId` 3465/3481/3502, `MobilePosTerminal` 11458–11497
- `database/prisma/migrations/20260813120000_mobile_pos_lite_idempotency_keys/migration.sql` — the company-scoped-unique idempotency pattern this spec follows
- Frontend: `frontend/src/app/(dashboard)/operations/sales-orders/[id]/page.tsx` `buildStatusSteps()` 114–175, `frontend/src/app/(dashboard)/westsides/delivery-notes/page.tsx` (list 433–530, modal 132–406)

**Key files this build touches**

| File | Change |
|---|---|
| `database/prisma/schema.prisma` | +1 nullable column + 1 unique index on `DeliveryNote` |
| `database/prisma/migrations/<ts>_delivery_note_counter_sale_key/migration.sql` | new, additive only |
| `backend/src/modules/delivery-notes/delivery-notes.service.ts` | `create()` gains a server-only context arg; `findAll()` gains one default filter |
| `backend/src/modules/delivery-notes/dto/query-delivery-note.dto.ts` | +1 optional boolean |
| `backend/src/modules/mobile-pos-lite/mobile-pos-lite.service.ts` | +1 dependency, +1 chain, +1 settle-log; `createSale()` gains one guarded call |
| `backend/src/modules/mobile-pos-lite/mobile-pos-lite.module.ts` | +`DeliveryNotesModule` |
| `backend/src/modules/mobile-pos-lite/mobile-pos-lite.controller.ts` | +1 manager-only backfill route |
| `backend/src/modules/westsides-dashboard/westsides-dashboard.service.ts` | 7 queries gain one `where` clause |
| `backend/src/modules/westsides-reports/westsides-reports.service.ts` | 1 query gains one `where` clause |
| `backend/src/modules/mobile-pos-lite/mobile-pos-lite.service.spec.ts` | new describes (§7) |
| `backend/src/modules/westsides-dashboard/westsides-dashboard.service.spec.ts` | new assertions (§7) |

**Files that must NOT change:** every file under `frontend/src/components/westsides/mobile-pos-lite/`, and above all `frontend/src/components/westsides/mobile-pos-lite/mobile-pos-lite.characterization.test.tsx` — **byte-identical and passing**. This is a backend-only change; nothing on the phone renders a delivery note and nothing on the phone needs to know one exists.

---

## 0. The defect, and the one fact that makes this change safe

Every POS sale sits at **"Delivered: PENDING"** forever. Confirmed in production across 19 orders spanning both shells — Aug 14 classic and Aug 15 Kaunta are identical: `status = CONFIRMED`, `paymentStatus = PAID`, zero delivery notes. This is pre-existing behaviour of the shared quick-sale path; the Kaunta reform did not introduce it.

It can never complete on its own. Fulfillment in this system is tracked **only** by `DeliveryNote` + `DeliveryNoteLine.deliveredQuantity` — `SalesOrderLine` carries no delivered-quantity field — and for a counter sale the customer carries the goods out at the moment of payment. There is no later delivery event to record, so the stage stays pending for the life of the order.

> **THE SAFETY FACT, verified line by line.** `delivery-notes.service.ts` is 232 lines and has **no inventory or stock effects of any kind** — no `inventoryMovement` write, no `inventoryBalance` write, no batch decrement, no GL posting. It is a pure document lifecycle: `create` (DRAFT) → `dispatch` (DISPATCHED) → `deliver` (DELIVERED), plus `cancel` and a soft `remove`. Stock is issued by the sale itself, as `SALE_ISSUE` inventory movements referencing the `SalesOrder`, inside `SalesOrdersService.confirm()` — which production confirms already happens correctly.
>
> **Therefore creating a delivery note for a POS sale cannot double-decrement stock.** That was the one risk that would have made this change dangerous, and it does not exist. §7 pins it with a test so it cannot quietly stop being true.

---

## 1. WHAT gets created, and in what state

### 1.1 Decision: drive `create → dispatch → deliver` through `DeliveryNotesService`. Do not write the terminal state directly.

**Decision.** The POS records a counter sale's note by calling `DeliveryNotesService.create()`, then `.dispatch()`, then `.deliver()` — three awaited calls in sequence, ending at `DELIVERED`. It never writes a `delivery_notes` row, a status, or a `delivery_note_lines` row through `prisma` directly.

**Why.** This is the house idiom and it is the idiom for a reason. `drivePurchaseChain()` (3077–3187) drives PO → `confirm` → GRN `create` → `approve` → `post` through the core services; the stock-count chain drives `create` → `submit` → `approve` → `post` the same way. Every state rule, every audit row (`DELIVERY_NOTE_CREATE` / `_DISPATCHED` / `_DELIVERED`), and every future rule added to `DeliveryNotesService` then applies to counter sales for free. Writing the terminal state directly would fork the delivery-note lifecycle into two implementations, and the second one — the POS one — is the one nobody would remember to update. The transitions are also individually state-guarded (`dispatch` refuses a non-DRAFT, `deliver` refuses a non-DISPATCHED), which is exactly what makes the chain safe to re-enter on a replay (§2.3).

The one cost — a note passes through DRAFT and DISPATCHED for a few milliseconds, and can be *stranded* there if the process dies mid-chain — is neutralised structurally, not by hoping: the discriminator column in §2 removes counter-sale notes from every worklist regardless of what state they end in (§5). A stranded note is invisible to the office and heals on the next replay or backfill run.

**Permissions.** These are service-to-service calls. `DeliveryNotesService.create/dispatch/deliver` take a bare `userId: string`, run no `CompanyScopeService` check and carry no guard — the guards live on `DeliveryNotesController`. **The POS must call the service, never the controller, and must NOT add a `delivery_notes.*` permission check.** A rep holds `mobile_pos_lite.use` and nothing else; requiring `delivery_notes.create` would stop every terminal in the fleet from selling.

### 1.2 The fields a counter sale carries

Built from the `sale` object returned by `salesOrders.mobilePosLiteQuickSale(...)` (which is `SalesOrdersService.findOne()` — it carries `companyId`, `branchId`, `customerId`, `customerName`, `orderDate`, and `lines` with `productId`/`quantity`/`unitId`/`description`) plus the authenticated `user` and the resolved `terminal`.

| `CreateDeliveryNoteDto` field | Value | Why |
|---|---|---|
| `companyId` | `sale.companyId` | — |
| `branchId` | `sale.branchId ?? undefined` | The counter the goods left from. |
| `salesOrderId` | `sale.id` | The link the whole fix depends on. |
| `customerId` | `sale.customerId ?? undefined` | Whatever the sale recorded — a chosen customer, or the terminal's general customer. |
| `customerName` | `sale.customerName ?? undefined` | The snapshot the sale already carries. |
| **`deliveryDate`** | `new Date(sale.orderDate).toISOString()` | **The moment of the sale, not `new Date()`.** An offline-queued sale replays later; pinning the note to the order's own instant keeps "sold today" and "delivered today" agreeing, and keeps a resumed chain from dating the note a day after the goods left. |
| **`deliveredById`** | **`user.id`** | The authenticated rep who handed the goods across the counter. **NOT `terminal.salespersonId`** — that is an `Employee` id, and `DeliveryNote.deliveredById` is a foreign key to `User` (schema 4938). Passing the salesperson id fails the FK and takes the sale's note down on every single sale. |
| **`receivedByName`** (via `deliver()`) | `sale.customerName ?? undefined` | **The one field where a walk-in matters.** A counter sale has no signature and no named recipient. We repeat the party the sale is already recorded against — for a walk-in that is the terminal's general customer, whose name is the shop's own record of "walk-in", and the dashboard already renders a missing one as `'Walk-in'`. **Never invent a person.** Do not put the rep's name here, do not write "Collected", do not synthesise a customer. |
| `receivedByPhone` | *(omitted)* | The POS never captures one. Leave it null rather than borrow the customer's. |
| `deliveryAddress` | *(omitted)* | There was no delivery and no destination. Do **not** fill in the branch address — that reads as a delivery having gone somewhere. |
| `driverName` / `vehicleNumber` | *(omitted)* | There was no driver and no vehicle. This is honest, and it is also why the dashboard's "open notes missing driver/vehicle" data-quality count must exclude counter notes (§5). |
| `notes` | `` `Counter sale — goods collected at the counter (${terminal.terminalCode})` `` | Plain, fixed, no client text. |
| `lines[]` | One per `sale.lines` entry, in order: `{ productId, description: line.description ?? undefined, quantity: Number(line.quantity), unitId: line.unitId }` | `quantity` must be a JS `number` — the Prisma value is a `Decimal`. `DeliveryNotesService.create()` writes it into both `orderedQuantity` and `deliveredQuantity`, which is correct: a counter sale is delivered in full by definition. |

> **DO NOT SET `salesOrderLineId` ON THE LINES.** `CreateDeliveryNoteLineDto` whitelists it and `DeliveryNotesService.create()` forwards it into `tx.deliveryNoteLine.createMany({ data })` — but **`delivery_note_lines` has no such column**. It is absent from `schema.prisma` (4950–4967), absent from the original DDL (`20260425082300_milestone_6_westsides/migration.sql:347`), absent from every later migration, and `grep -c salesOrderLineId backend/node_modules/.prisma/client/index.d.ts` returns `0`. A *defined* value there raises `PrismaClientValidationError` at runtime; only `undefined` survives, because Prisma strips undefined keys. This is a pre-existing latent defect (§9) — the POS path stays immune simply by never emitting the key.

**Terminal state: `DELIVERED`.** Not `PARTIALLY_DELIVERED`, not left at `DISPATCHED`. Every line went out in full at the counter, and `SalesOrdersService.fulfillment()` (1064–1075) only reports `DELIVERED` when a note's status is in `{DELIVERED, CLOSED}`.

**What the office then sees** on `/operations/sales-orders/<id>`: `fulfillment.summary.status = 'DELIVERED'`, `deliveryNoteCount = 1`, and `buildStatusSteps()` renders step 3 **Delivered → APPROVED**, described as "1 delivery note". That is the whole point of the fix.

---

## 2. IDEMPOTENCY — a database guarantee, not a read-then-write check

### 2.1 The rule this project keeps re-learning

The POS sale chain is replay-safe by marker and offline queued sales replay by construction, so a second `createSale` for one physical sale is normal traffic, not an edge case. **A read-then-write check cannot decide a create race:** Postgres stamps `createdAt` at transaction *start*, so a transaction that began earlier can commit later, and two concurrent requests carrying one key can each read a set in which they are the winner. Migration `20260813120000` exists because that exact bug received one lorry twice. This spec does not repeat it.

### 2.2 The migration

`database/prisma/migrations/<ts>_delivery_note_counter_sale_key/migration.sql` — **additive only**: one nullable column, one unique index. No backfill inside the migration, no data rewrite, nothing dropped.

```sql
-- The counter-sale delivery note's replay guarantee, and the discriminator that
-- keeps it out of the office's delivery worklists.
--
-- Nullable + company-scoped unique, exactly like sales_orders.idempotencyKey and
-- purchase_orders.idempotencyKey (20260813120000). Postgres treats NULLs as
-- distinct, so every existing note and every note the desktop creates from now
-- on leaves this NULL and they may coexist freely — including several partial
-- delivery notes against one sales order, which is a real business case this
-- index must not break.
--
-- The value is the SalesOrder id of the counter sale the note was auto-issued
-- for. Deliberately a plain TEXT marker with NO foreign key: salesOrderId is
-- already the FK (ON DELETE SET NULL), and a second constrained reference would
-- couple this marker to that cascade for no gain.
ALTER TABLE "delivery_notes"
  ADD COLUMN "counterSaleOrderId" TEXT;

CREATE UNIQUE INDEX "delivery_notes_companyId_counterSaleOrderId_key"
  ON "delivery_notes"("companyId", "counterSaleOrderId");
```

Prisma model (`schema.prisma`, inside `model DeliveryNote`):

```prisma
  /// SalesOrder id of the POS counter sale this note was auto-issued for.
  /// NULL on every desk-created note. Company-scoped unique: one auto note per
  /// counter sale, decided by the database and not by whichever query ran first.
  counterSaleOrderId String?
```

```prisma
  @@unique([companyId, counterSaleOrderId])
```

**Why keyed on the sales order and not on the sale's `idempotencyKey`.** The invariant we actually want is *one auto-issued note per counter sale*, and the sales-order id states it directly. It is also always present: a replayed sale resolves through `replayQuickSale()` to the **same** `SalesOrder` row, so the second request arrives holding the same id and collides. A `SalesOrder.idempotencyKey` mirror would be weaker — it is `null` on any order created before `20260609120000`, which is precisely the historical population §4 has to backfill. One column, one index, and both the live path and the backfill inherit the same guarantee.

**No notes marker.** The purchase and stock-count chains carry an `[MPL-…]` marker in `notes` as a fallback for rows written before their column existed, and because a phone can hold a frozen key across a deploy. Neither applies here: the column ships in the same release as the code that writes it, there are no pre-existing auto-issued notes, and no client ever holds a delivery-note key — the discriminator is derived server-side from the sale. A `contains`-matched marker would only add a control surface for no benefit.

### 2.3 The claim algorithm

`DeliveryNotesService.create()` gains a third argument, mirroring `SalesOrdersService.create(dto, user, context)` and its `SalesOrderCreateContext.mobilePosTerminalId` (1543, 1623) exactly:

```ts
export interface DeliveryNoteCreateContext {
  /** Server-derived only. Never sourced from a DTO — no client may set it. */
  counterSaleOrderId?: string;
}

async create(dto: CreateDeliveryNoteDto, userId: string, context: DeliveryNoteCreateContext = {}) {
  // …data: { …, counterSaleOrderId: context.counterSaleOrderId ?? null }
}
```

It stays off `CreateDeliveryNoteDto`, so no request body can reach it.

New private chain on `MobilePosLiteService`:

```
recordCounterDelivery(sale, terminal, user):
  1. existing = prisma.deliveryNote.findFirst({
       where: { companyId: sale.companyId, counterSaleOrderId: sale.id },
       select: { id: true, status: true },
     })
     // Cheap fast path ONLY. The index below is the decider, never this read.
  2. if (existing) → driveCounterDeliveryChain(existing, sale, user); return
  3. try   created = deliveryNotes.create(dto, user.id, { counterSaleOrderId: sale.id })
     catch if (isUniqueViolation(error))     // lost the create race
              winner = findFirst(same where) // the row that OWNS the key
              if (!winner) throw error
              → driveCounterDeliveryChain(winner, sale, user); return
            else throw
  4. driveCounterDeliveryChain({ id: created.id, status: created.status }, sale, user)

driveCounterDeliveryChain(note, sale, user):
  if status === 'DELIVERED'  → return              // replay: already done
  if status === 'CANCELLED'  → logCounterDeliveryNotRecorded('cancelled'); return
                                                   // never resurrect a cancelled note
  if status === 'DRAFT':
      try  deliveryNotes.dispatch(note.id, user.id); status = 'DISPATCHED'
      catch → re-read status; if still DRAFT rethrow, else continue (a concurrent
              retry won the transition — the purchase chain's exact pattern)
  if status === 'DISPATCHED' or 'PARTIALLY_DELIVERED':
      try  deliveryNotes.deliver(note.id, { receivedByName: sale.customerName ?? undefined }, user.id)
           status = 'DELIVERED'
      catch → re-read; if not DELIVERED rethrow, else continue
  if status !== 'DELIVERED' → throw ConflictException('counter-sale delivery note is no longer deliverable')
                              // caught and logged by the §3 wrapper; never reaches the rep
```

Reuse the module's existing `isUniqueViolation()` helper (342–344). Note that `create()` calls `codes.next()` **before** its transaction, so a lost race burns one `DN-` number; the step-1 pre-check keeps the ordinary replay from burning any, and gaps in a document sequence are harmless.

**Net guarantee: a replayed or retried sale produces exactly one delivery note, always, decided by `delivery_notes_companyId_counterSaleOrderId_key`.**

---

## 3. FAILURE ISOLATION — the note can never take the sale down

### 3.1 Placement

`recordCounterDelivery` is called from `MobilePosLiteService.createSale()`, **after** `salesOrders.mobilePosLiteQuickSale(...)` has returned, after the `lastSeenAt` touch, and after the `MOBILE_POS_LITE_SALE_COMPLETED` audit row — immediately before `return sale`.

It is therefore **outside every transaction the sale uses**. `create()` and `confirm()` each own their own `prisma.$transaction`, both already committed. The note's own writes run in their own transactions inside `DeliveryNotesService`. Nothing the note does can roll back the money, the stock, the receivable, the cash receipt, the commission or the GL posting.

```ts
    // The money and the stock ARE the sale; the note is a document about it.
    // A note that cannot be written is logged and the sale still stands —
    // never the reverse. This wrapper is TOTAL: recordCounterDelivery must not
    // be able to throw out of createSale under any circumstances.
    try {
      await this.recordCounterDelivery(sale, terminal, user);
    } catch (error) {
      await this.logCounterDeliveryNotRecorded(sale, terminal, user, error);
    }
    return sale;
```

**Awaited, not detached.** A detached promise makes the failure invisible to request-scoped logging, escapes the audit user's context, and risks an unhandled rejection taking the process down mid-trade. The cost is three short round trips on a path that already makes several; the benefit is that a failure is recorded where somebody will find it.

**Not placed in `SalesOrdersService.createAndConfirm()`.** That method is shared with the desktop `quickSale()` and `mobilePosQuickSale()`. Putting the chain there would widen the blast radius from "the POS module" to "every sales order created anywhere", which this spec explicitly refuses (§8).

### 3.2 What is logged when it fails

`logCounterDeliveryNotRecorded(sale, terminal, user, error)` follows `settleUnfinishedPurchase()` / `logStockCountNotPosted()`: it destroys nothing, it writes one line, and **it never lets its own failure replace the caller's.**

```
auditLogs.log({
  action:     'MOBILE_POS_LITE_COUNTER_DELIVERY_NOT_RECORDED',
  entityType: 'SalesOrder',
  entityId:   sale.id,
  userId:     user.id,
  companyId:  sale.companyId,
  severity:   AuditSeverity.MEDIUM,
  newValue: {
    terminalCode:    terminal.terminalCode,
    salesOrderNumber: sale.salesOrderNumber,
    reason:          error instanceof Error ? error.message : String(error),
  },
})
```

The whole body sits in `try { … } catch { this.logger.error(…) }`, and that `logger.error` call is itself inside the catch so nothing can escape — the audit row lives in the database that just failed, which is exactly when the fallback matters.

**Severity is MEDIUM, not HIGH.** No money and no stock is at risk; one sales order is left reading "Delivered: PENDING", which is the status quo the fix removes and is repaired by the next replay or the next backfill run (§4).

---

## 4. THE BACKFILL

### 4.1 Decision: yes, backfill. As a manager-authorised endpoint, not a migration.

The owner chose this fix partly because it "fixes downstream fulfillment reports too" — and it does not, for the 19 production orders and their historical siblings, unless history is repaired as well. Leaving them behind would also leave `ordersAwaitingDelivery` permanently overstated by the exact population the fix was meant to clear, which is the worst of both worlds: the office keeps chasing phantom deliveries and the dashboard number now means two different things depending on the date.

**Shipped as `POST /mobile-pos-lite/counter-delivery-backfill`, guarded by `@RequirePermissions('mobile_pos_lite.manage')`**, backed by a service method on `MobilePosLiteService`. This is the established house shape for a one-shot repair — `POST /entity-code-generator/backfill` (`sequence-backfill.service.ts`, "Conservative-by-design … Idempotent — running twice is a no-op the second time") is the model, right down to returning a report instead of printing one.

**Not a SQL backfill migration.** A migration would have to hand-roll `DN-{YYYY}-#####` numbering outside `EntityCodeGeneratorService`, which is how you get duplicate delivery-note numbers and a broken `@@unique([companyId, deliveryNoteNumber])`; it would write business documents with no audit rows; and it would fire automatically at deploy — possibly mid-trade — instead of when a manager decides. The endpoint reuses the *same* `recordCounterDelivery` chain the live path uses, so numbering, audit rows, field discipline and the idempotency guarantee are identical by construction.

### 4.2 Which orders qualify

```
SalesOrder where:
  mobilePosTerminalId IS NOT NULL          -- POS-originated ONLY. The single
                                           -- server-derived proof that this sale
                                           -- was rung at a physical counter.
  AND status IN ('CONFIRMED','PARTIALLY_PAID','PAID')
  AND deletedAt IS NULL
  AND lines is non-empty
  AND NOT EXISTS (delivery_notes dn WHERE dn."counterSaleOrderId" = so.id
                                     AND dn."companyId" = so."companyId")
```

Company-scoped to what the calling manager may access (`CompanyScopeService`), optionally narrowed by a `companyId` query param, processed oldest-first, in batches, with a hard per-run cap (`take: 500`) so a large tenant is repaired across several runs rather than in one long transaction.

**Why these filters, and what they refuse to invent:**

- `mobilePosTerminalId IS NOT NULL` is the *only* qualifier for POS origin. Not a notes `contains`, not the payment method, not the sales type — a marker in free text can be typed by a human and a cash sale can be rung from the desktop.
- `CONFIRMED` / `PARTIALLY_PAID` / `PAID` only. `confirm()` **is** the counter event — it is what issues the `SALE_ISSUE` movements and takes the payment, and it is what runs the instant the customer pays. A `DRAFT` order never charged anybody and the goods never moved; `CANCELLED` / `VOIDED` means the counter reversed it. Neither gets a note, ever.
- **`CREDIT` counter sales are included.** The goods still walked out; only the money is owed. Excluding them would leave exactly the orders where fulfillment tracking matters most reading "never delivered".
- Nothing is invented. `deliveryDate` = the order's own `orderDate`. `deliveredById` and `createdById` = the order's `createdById`, the rep who actually rang it (a recorded fact, and a valid `User` FK). `receivedByName` = the order's `customerName` snapshot. `driverName`, `vehicleNumber`, `deliveryAddress`, `receivedByPhone` stay **NULL** — there was no driver, no vehicle, no address and no phone, and writing one would be forging delivery evidence.
- The note's `notes` reads `` `Counter sale — goods collected at the counter (${terminalCode}). Recorded by backfill on ${ISO date}.` `` so that nobody, ever, mistakes it for a note a person wrote at the time.

**A stranded note from a mid-chain failure is healed, not duplicated.** The run's first step for each order is the same `findFirst` on `counterSaleOrderId`; an existing DRAFT or DISPATCHED note is resumed to DELIVERED rather than re-created. The backfill is therefore also the repair tool for §3 failures.

### 4.3 Re-runnable, and how it is verified

**Re-runnable** on three independent layers: the `NOT EXISTS` filter excludes anything already noted; the `findFirst` pre-check inside the chain excludes it again; and `delivery_notes_companyId_counterSaleOrderId_key` rejects it at the database if both reads somehow lose a race. A second run reports `created: 0, resumed: 0, skipped: N`.

**Response payload** (also the verification instrument):

```json
{ "scanned": 19, "created": 19, "resumed": 0, "skipped": 0, "failed": 0,
  "failures": [{ "salesOrderId": "…", "salesOrderNumber": "SO-…", "reason": "…" }] }
```

Individual failures are caught per order, counted, and never abort the run.

**Verification, before and after** (run against production, read-only):

```sql
-- BEFORE: the population, and proof it currently has no notes.
SELECT count(*) FROM sales_orders so
WHERE so."mobilePosTerminalId" IS NOT NULL
  AND so."status" IN ('CONFIRMED','PARTIALLY_PAID','PAID')
  AND so."deletedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM delivery_notes dn
                  WHERE dn."counterSaleOrderId" = so."id" AND dn."companyId" = so."companyId");
-- expect 19 (plus any sold between the count and the run)

-- BEFORE: prove no note is being replaced.
SELECT count(*) FROM delivery_notes WHERE "counterSaleOrderId" IS NOT NULL;   -- expect 0

-- AFTER: the population is empty, every note is DELIVERED, none carries invented evidence.
--   (1) the BEFORE query again                                   -> expect 0
SELECT status, count(*) FROM delivery_notes
WHERE "counterSaleOrderId" IS NOT NULL GROUP BY status;           -- expect DELIVERED = 19, nothing else
SELECT count(*) FROM delivery_notes
WHERE "counterSaleOrderId" IS NOT NULL
  AND ("driverName" IS NOT NULL OR "vehicleNumber" IS NOT NULL
       OR "deliveryAddress" IS NOT NULL OR "receivedByPhone" IS NOT NULL);   -- expect 0

-- AFTER: stock did NOT move again. Compare a snapshot taken before the run.
SELECT count(*) FROM inventory_movements WHERE "movementType" = 'SALE_ISSUE';  -- must be UNCHANGED
```

Run it against staging first, on a restored copy of the production database.

---

## 5. BLAST RADIUS — every reader of delivery notes and fulfillment status

Every place in the codebase that reads `DeliveryNote` or a fulfillment status, what it shows today, and what it must show after this change.

### 5.1 The rule that resolves all of it

> **The office's delivery-operations surfaces are about goods *dispatched to a customer*. A counter sale is not a dispatch. Counter-sale notes (`counterSaleOrderId IS NOT NULL`) are excluded from every one of them.** They remain fully visible where the *order* is the subject — the sales-order detail, the sales-order list, global search, and the note's own print view.

That single rule is what satisfies non-negotiable constraint 6, and it holds regardless of what state a note ends up in — including a note stranded at DRAFT by a §3 failure.

### 5.2 Required edits

| # | Reader | Today | After | Edit |
|---|---|---|---|---|
| 1 | `westsides-dashboard` `deliveryNote.groupBy` status counts (577) → `fulfillment.deliveries.{draft,dispatched,delivered,…}` | delivery ops volume | unchanged | **Add `counterSaleOrderId: null`** |
| 2 | `westsides-dashboard` overdue count (582), `OPEN_DELIVERY_STATUSES` + `deliveryDate < today` | overdue deliveries | unchanged | **Add `counterSaleOrderId: null`** — belt-and-braces for a stranded note |
| 3 | `westsides-dashboard` due-today count (591) | due today | unchanged | **Add `counterSaleOrderId: null`** |
| 4 | `westsides-dashboard` delivered-today count (600) | delivered today | unchanged | **Add `counterSaleOrderId: null`** |
| 5 | `westsides-dashboard` `recent` list (609, `take: 8`, `deliveryDate desc`) | last 8 deliveries | unchanged | **Add `counterSaleOrderId: null`** — **the sharpest regression if missed.** A shop at 30 counter sales/day would bury every real delivery in that panel on day one |
| 6 | `westsides-dashboard` freshness aggregate (893, `_max deliveryDate/updatedAt`) | "is delivery data fresh?" | unchanged | **Add `counterSaleOrderId: null`** — otherwise it reads "fresh" forever from counter traffic |
| 7 | `westsides-dashboard` **data-quality worklist**: open notes missing driver **or** vehicle (947) | notes needing details filled in | unchanged | **Add `counterSaleOrderId: null` — MANDATORY.** Every counter note has no driver and no vehicle by design; without this, a stranded note lands straight on the office's "fix these" list |
| 8 | `westsides-reports.deliveryPerformance()` (1497), groupBy status, DRAFT/DISPATCHED/PARTIALLY_DELIVERED flagged `WARNING` "need operational follow-up" | delivery ops | unchanged | **Add `counterSaleOrderId: null`** to its `where` |
| 9 | `DeliveryNotesService.findAll()` → `/westsides/delivery-notes` list page (all statuses, `limit=100`, `createdAt desc`, no status filter) | every note | **counter notes hidden by default** | **Add `includeCounterSales?: boolean` to `QueryDeliveryNoteDto` (default `false`)**; when false, `where.counterSaleOrderId = null`. See §5.3 |

`QueryDeliveryNoteDto` addition — use the repo's boolean-query-coercion pattern verbatim (`query-bank-account.dto.ts:15-19`), because the global pipe's `enableImplicitConversion` otherwise coerces any non-empty string, `'false'` included, to `true`:

```ts
  // @Type(() => String) keeps the value a string under enableImplicitConversion
  // (see query-bank-account.dto.ts) so 'false' does not arrive as boolean true.
  @IsOptional()
  @Type(() => String)
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  includeCounterSales?: boolean;
```

### 5.3 Deliberately NOT changed

| Reader | Why it stays |
|---|---|
| **`westsides-dashboard` `ordersAwaitingDelivery` (626): confirmed orders with `deliveryNotes: { none: { deletedAt: null } }`** | **This number MUST fall. It falling is the fix landing.** Those orders were never awaiting delivery; the goods left at the counter. Do not add the discriminator here, and do not "preserve" the old figure. |
| `fulfillment-backlog` alert (2579–2586), `overdueDeliveries + ordersAwaitingDelivery` | Inherits the corrected inputs. Its message — "N confirmed orders have no delivery note" — becomes true for the first time. |
| `SalesOrdersService.fulfillment()` (1046–1090) | The subject is the order. It must report `DELIVERED` for a counter sale — that is the whole change. |
| `SalesOrdersService.findAll()` include (541–546, `take: 3`) and `loadControlCenterOrder()` include (839–851) | Both scoped to one order. A counter sale showing its one note is correct. |
| Sales-order detail `buildStatusSteps()` (frontend 114–175) | **No frontend change.** `fulfillmentStatus === 'DELIVERED'` now satisfies the first branch of `isDelivered`, so step 3 flips from PENDING to APPROVED with the code exactly as it stands. (The middle branch, `['DELIVERED','COMPLETED'].includes(order.status)`, remains dead — `SalesOrderStatus` has no such member. Leave it alone; it is out of scope and touching it changes nothing.) |
| `global-search.searchDeliveryNotes()` (905–940) | Somebody typing `DN-2026-00123` must find it, whatever issued it. |
| `generated-documents.deliveryNotePdf()` (809) + `/westsides/delivery-notes/<id>/print` | Reachable by id. A counter note prints as a plain collection note with blank driver/vehicle — honest. |
| `/westsides/delivery-notes` page `STATUS_ACTIONS` (408–419) | Offers actions for `DRAFT` / `DISPATCHED` / `IN_TRANSIT` only. A `DELIVERED` note has none, so even if a counter note were visible it is not work to be done. Combined with edit #9 it is not visible either. |
| `finance/payables` "deliveries" | Fuel deliveries — a different entity entirely. Not affected. |

### 5.4 Volume side-effects to expect

- **Audit rows: +3 per counter sale** (`DELIVERY_NOTE_CREATE`, `_DISPATCHED`, `_DELIVERED`). Acceptable and deliberate — it is the transition history that makes the chain auditable. Flag it to whoever watches audit-table growth.
- **Delivery-note numbers: +1 `DN-{YYYY}-#####` per counter sale.** The sequence is race-safe and yearly-reset; a busy shop will simply consume the range faster. Padding is 5 (99,999/year/company).

---

## 6. WHAT COULD GO WRONG ON A LIVE SHOP MID-TRADE, AND THE REVERT

The Kaunta pilot is trading right now. This section is the one to re-read before deploying.

| # | Failure | Blast | Mitigation built in |
|---|---|---|---|
| 1 | **The note chain throws and takes the sale with it** — the catastrophic one; the shop stops selling | Fleet-wide | §3's total wrapper. The call is outside every sale transaction, and the wrapper cannot rethrow. CD-5 and CD-6 (§7) pin it, including the case where the *audit* write also fails. |
| 2 | `deliveredById` set to `terminal.salespersonId` (an `Employee`) | FK violation on **every** sale → mitigation #1 catches it → every sale logs a failure and no note is ever written | §1.2 states the rule; CD-10 asserts `user.id`. |
| 3 | `salesOrderLineId` emitted on lines | `PrismaClientValidationError` on every note (column does not exist) | §1.2 boxed warning; CD-9 asserts the key is absent. |
| 4 | **Replay creates a second note** | Duplicate fulfillment records; `deliveryNoteCount` of 2 on a one-item sale | `delivery_notes_companyId_counterSaleOrderId_key`. Not a read — the database. CD-3 and CD-4. |
| 5 | **Stock decremented twice** | Inventory corrupted mid-trade — unrecoverable without a manual count | Structurally impossible: `delivery-notes.service.ts` has no stock effects (§0). CD-2 asserts it now and, via the source-level guard, keeps asserting it if someone later adds one. |
| 6 | Latency: three extra awaited round trips before the receipt renders | A slower tap-to-receipt at the counter | Three small writes on a path that already does several. If the DB is slow enough for this to bite, the sale itself is already failing. |
| 7 | Chain dies between `create` and `deliver` → note stranded at DRAFT/DISPATCHED | Would land on the office's open-deliveries and missing-driver worklists | The discriminator excludes it from all seven dashboard queries and the report (§5.2). The next replay or backfill run resumes it. |
| 8 | Office's `recent deliveries` panel floods with counter sales | Real deliveries invisible; the office notices day one | Edit #5. Do not skip it. |
| 9 | Migration blocks a live table | Sales stall during deploy | `ADD COLUMN … TEXT` (nullable, no default) is a catalog-only change in PG 11+; the `CREATE UNIQUE INDEX` on a table of this size takes milliseconds. Use `CONCURRENTLY` only if `delivery_notes` is unexpectedly large in production — check `count(*)` first. |
| 10 | Backfill fires mid-trade | 19 document writes during business hours | It is a manager-triggered endpoint, not a migration. Run it outside trading hours, on staging first. |

**THE REVERT.** Three levels, cheapest first, and none of them needs a migration rollback:

1. **Stop the behaviour, keep the schema (seconds).** Wrap the `recordCounterDelivery` call in a module-level constant — `const RECORD_COUNTER_SALE_DELIVERY_NOTES = true;` beside the existing `AUTO_POST_MOBILE_POS_STOCK_COUNTS` — flip it to `false` and redeploy. Sales continue immediately; already-written notes stay valid and correct. **Ship the constant in the build; it is the revert.**
2. **Revert the code (one commit).** The column and index are additive and unused when nothing writes them. Leave them in place — dropping them buys nothing and costs a migration.
3. **Unwind the data (only if truly required).** `UPDATE delivery_notes SET "deletedAt" = now() WHERE "counterSaleOrderId" IS NOT NULL;` — a soft delete, exactly what `DeliveryNotesService.remove()` does. Every read path filters `deletedAt: null`, so the sales orders return to "Delivered: PENDING" and nothing else moves. **Never hard-delete**, and never touch `inventory_movements` — the notes never wrote any.

---

## 7. THE TESTS THE BUILD MUST CARRY

Backend jest (`cd backend && npm test`). The suite needs a raised heap — run with `NODE_OPTIONS=--max-old-space-size=8192`.

`buildService()` in `mobile-pos-lite.service.spec.ts` gains a `deliveryNotes` mock (`create`/`dispatch`/`deliver` jest fns) as a new **last** constructor argument, and the prisma mock gains `deliveryNote: { findFirst: jest.fn().mockResolvedValue(null) }`. `salesOrders.mobilePosLiteQuickSale` must return a realistic sale (`id`, `salesOrderNumber`, `companyId`, `branchId`, `customerId`, `customerName`, `orderDate`, `lines[]`) rather than today's `{ id: 'so-1' }`.

### New describe: `MobilePosLiteService createSale counter delivery note`

| id | Assertion |
|---|---|
| **CD-1** | A completed cash sale drives exactly one chain: `deliveryNotes.create` once, `dispatch` once, `deliver` once, in that order, ending DELIVERED. `create` receives `{ counterSaleOrderId: sale.id }` as its third argument, and `salesOrderId === sale.id`. |
| **CD-2** | **NO DOUBLE STOCK.** Over the whole `createSale` call, `prisma.inventoryMovement.create`, `prisma.inventoryMovement.createMany`, `prisma.inventoryBalance.update`, `prisma.inventoryBalance.upsert` and `prisma.productBatch.update` are **never** called from the delivery-note path. **Plus a source-level guard:** read `backend/src/modules/delivery-notes/delivery-notes.service.ts` with `fs.readFileSync` and assert it matches none of `/inventoryMovement/`, `/inventoryBalance/`, `/productBatch/`, `/stockLedger/`. That second assertion is the durable one — it fails the day someone adds a stock effect to the delivery-note service, which is the only way this change could ever move stock twice. |
| **CD-3** | **REPLAY.** `prisma.deliveryNote.findFirst` resolves an existing DELIVERED note → `deliveryNotes.create` is **not** called, `dispatch` is **not** called, `deliver` is **not** called, and `createSale` still resolves with the sale. |
| **CD-4** | **CREATE RACE.** `deliveryNotes.create` rejects with `P2002`; `findFirst` then resolves the winner (DRAFT); the chain drives *that* note to DELIVERED, `create` is not retried, and `createSale` does not throw. |
| **CD-5** | **FAILURE ISOLATION.** `deliveryNotes.create` rejects with a plain `Error`; `createSale` **resolves with the sale**, and one audit row with action `MOBILE_POS_LITE_COUNTER_DELIVERY_NOT_RECORDED` is written carrying the sales-order id and the reason. |
| **CD-6** | **FAILURE ISOLATION, AUDIT DOWN.** As CD-5, and `auditLogs.log` also rejects for the failure row. `createSale` still resolves with the sale; nothing escapes. |
| **CD-7** | **RESUME.** `findFirst` resolves a DISPATCHED note → `create` not called, `dispatch` not called, `deliver` called once. |
| **CD-8** | **CANCELLED IS NEVER RESURRECTED.** `findFirst` resolves a CANCELLED note → `create`/`dispatch`/`deliver` all uncalled; the sale still returns. |
| **CD-9** | **FIELD DISCIPLINE.** The `create` payload: `deliveryDate === new Date(sale.orderDate).toISOString()`; `driverName`, `vehicleNumber`, `deliveryAddress` all `undefined`; every line has `quantity` of `typeof 'number'` matching the sale line; and **no line object has a `salesOrderLineId` key** (`expect(line).not.toHaveProperty('salesOrderLineId')`). |
| **CD-10** | `deliveredById === user.id`, and **not** `terminal.salespersonId`. |
| **CD-11** | A CREDIT counter sale on a credit-enabled terminal also gets a note driven to DELIVERED. |
| **CD-12** | `deliver` is called with `receivedByName` equal to the sale's `customerName`, and with **no** `receivedByPhone`. |

### Worklist protection

| id | Where | Assertion |
|---|---|---|
| **CD-13** | `westsides-dashboard.service.spec.ts` | All **seven** `prisma.deliveryNote` calls (`groupBy`, four `count`s, `findMany`, `aggregate`) are invoked with `where.counterSaleOrderId === null`. Written as a loop over the mock's `mock.calls` so a future eighth query fails the test unless it opts in. |
| **CD-14** | `westsides-dashboard.service.spec.ts` | The `ordersAwaitingDelivery` `salesOrder.count` does **NOT** carry the discriminator — it must keep counting confirmed orders with no note at all. |
| **CD-15** | `westsides-reports.service.spec.ts` (or a new spec) | `deliveryPerformance()`'s `where` carries `counterSaleOrderId: null`. |
| **CD-16** | new `delivery-notes.service.spec.ts` | `findAll()` with no `includeCounterSales` sets `where.counterSaleOrderId = null`; with `includeCounterSales: true` the key is absent. |
| **CD-17** | new `delivery-notes.service.spec.ts` | `create()` with no context writes `counterSaleOrderId: null`; with `{ counterSaleOrderId: 'so-1' }` it writes `'so-1'`. And `CreateDeliveryNoteDto` has **no** `counterSaleOrderId` member (assert the key is stripped from a body that supplies it). |

### Backfill

| id | Assertion |
|---|---|
| **CD-18** | Selection filters exactly: `mobilePosTerminalId: { not: null }`, `status: { in: ['CONFIRMED','PARTIALLY_PAID','PAID'] }`, `deletedAt: null`, and the no-existing-note guard. A desktop order (`mobilePosTerminalId: null`), a DRAFT and a CANCELLED order in the fixture are all skipped. |
| **CD-19** | **RE-RUNNABLE.** Second run over the same fixture reports `created: 0` and calls `deliveryNotes.create` zero times. |
| **CD-20** | **NO INVENTED EVIDENCE.** No backfilled payload carries `driverName`, `vehicleNumber`, `deliveryAddress` or `receivedByPhone`; `deliveryDate` equals the order's `orderDate`; `deliveredById` equals the order's `createdById`. |
| **CD-21** | A single order's failure is counted in `failed` and does not abort the run — the remaining orders are still processed. |
| **CD-22** | The route is guarded by `mobile_pos_lite.manage` (controller metadata assertion, in the existing controller describe). |

### Non-regression

| id | Assertion |
|---|---|
| **CD-23** | `frontend/src/components/westsides/mobile-pos-lite/mobile-pos-lite.characterization.test.tsx` is **byte-identical** to `HEAD` — it must not appear in `git status` / the diff — and passes (`cd frontend && npm test -- mobile-pos-lite.characterization`). |
| **CD-24** | Every existing `MobilePosLiteService createSale` describe (spec 1034–1134) still passes unchanged in its assertions about `mobilePosLiteQuickSale` arguments. Only the `buildService` harness and the quick-sale mock return value may change. |

**Also run:** `cd backend && npm run lint && npm run build`, `npm run verify:env` from the repo root (it includes `validate-migration-safety.mjs` and `validate-dto-contract.mjs`), and `cd frontend && npm run build`.

---

## 8. BUILD ORDER

1. `schema.prisma` + the migration (§2.2). `npm run prisma:generate`. Confirm `counterSaleOrderId` appears in `backend/node_modules/.prisma/client/index.d.ts`.
2. `DeliveryNotesService.create()` context arg + `findAll()` default filter + the DTO boolean (§2.3, §5.2). CD-16, CD-17.
3. `MobilePosLiteModule` imports `DeliveryNotesModule`; `MobilePosLiteService` takes `DeliveryNotesService` as its **last** constructor argument. (No cycle: `DeliveryNotesModule` imports only `PrismaModule` + `AuditLogsModule`.)
4. `recordCounterDelivery` + `driveCounterDeliveryChain` + `logCounterDeliveryNotRecorded` + the `RECORD_COUNTER_SALE_DELIVERY_NOTES` constant (§2.3, §3, §6).
5. The guarded call in `createSale()` (§3.1). CD-1 … CD-12.
6. The seven dashboard `where` clauses and the one report `where` clause (§5.2). CD-13, CD-14, CD-15.
7. The backfill service method + controller route (§4). CD-18 … CD-22.
8. Full verification (§7). Then **stop** — do not commit, do not create or switch branches, do not run the backfill against production. Hand the diff and the §4.3 before/after queries to the owner.

### Explicitly out of scope

- `SalesOrdersService.quickSale()` (desktop Westsides counter sale) and `mobilePosQuickSale()`. They confirm and issue stock too, but they carry no terminal stamp — there is no server-derived proof that those goods physically left a counter, and widening the change to `createAndConfirm()` would put every sales order created anywhere in the system inside the blast radius of a pilot fix. A separate decision, on separate evidence.
- The dead `['DELIVERED','COMPLETED'].includes(order.status)` branch in `buildStatusSteps()`. Harmless; unrelated; leave it.
- Any frontend change whatsoever.

---

## 9. ONE PRE-EXISTING DEFECT FOUND WHILE GROUNDING THIS SPEC

**FIXED IN THIS BUILD** (owner's call, 2026-08-15) — see `delivery-notes.service.ts` and its spec. The paragraphs below are the original finding, kept because they record how it was reached and why §1.2 is so blunt about the POS path staying immune.

Do NOT open the follow-up task the last paragraph proposes: both of its branches now make things worse. Dropping `salesOrderLineId` from `CreateDeliveryNoteLineDto` turns every desktop create into a 400, because the global pipe runs `forbidNonWhitelisted` and the modal still sends the key on every line. Adding the column and re-emitting it puts a column nothing reads into production for a defect that no longer exists — and it compiles and passes the suite, so nothing would stop it.

**`DeliveryNotesService.create()` (lines 40–50) writes `salesOrderLineId` into `tx.deliveryNoteLine.createMany({ data })`, and that column does not exist.** It is absent from `schema.prisma`, from the original DDL, from every migration, and from the generated Prisma client. TypeScript does not catch it because the array comes from a `.map()` (no excess-property check on a non-fresh object type), so it fails only at runtime, and only when the value is defined — Prisma strips `undefined` keys.

The desktop delivery-note modal (`frontend/src/app/(dashboard)/westsides/delivery-notes/page.tsx:268`) sends `salesOrderLineId: line.salesOrderLineId || undefined`, where `salesOrderLineId` is set from `line.id` of the source sales order (page.tsx:116) — i.e. **always defined**. So creating a delivery note from the desktop, from a sales order with lines, should currently be failing with `PrismaClientValidationError`.

Worth its own task: either drop the field from `CreateDeliveryNoteLineDto` and the service, or add the column and the index. Do not fold it into this build — it is a desktop path, the pilot does not touch it, and this spec's whole value is a narrow blast radius.
