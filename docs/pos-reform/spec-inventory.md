# MODULE SPEC — Stoo (Inventory) for Itemba POS

Build-ready spec for the new Stoo module under the Kaunta design direction. Covers: the Stoo branch-stock screen, low-stock surfacing, product lookup (photo / price / on-hand), and the v1 stock-counting decision with the full backend contract. Verified against main @ 76597c47 (`mobile-pos-lite.service.ts` products() at lines 459–538, purchases wrap at 671–1106, `requireTerminal` at 1155, `sessionPayload` purchasesEnabled at 1356; `stock-adjustments.service.ts` create/submit/approve/post at 133/230/255/360; seed permission block at `database/seeds/seed.ts:259–277`, role predicates at 1541/1593).

---

## 0. V1 decision on stock counting — DECIDED, not deferred

**Decision: Stoo ships read-only in Phase 4; Hesabu (counting) ships in Phase 5 as a manager-gated, capture-offline/submit-online flow that auto-posts a StockAdjustment.** Both halves are specced fully here; they are two PRs, not one.

Why not read-only forever:
- Shrinkage/variance is the field problem the branch-stock view will *expose* — a manager who can see "Zaidi ya rekodi" and do nothing about it phones the office, and the office types the count into the desktop UI from a phone call. That is strictly worse data than a blind count captured at the shelf.
- The trust precedent already exists: `mobile_pos_lite.purchase` lets the same manager drive a PO→GRN→post chain that moves inventory *and* GL in one call. A stock count is the same class of action with the same class of user.
- Safety is by construction, not policy: blind entry (no anchoring), server-authoritative `systemQuantity` (client never supplies it — same spirit as server-authoritative sale pricing), review-step variance + threshold double-confirm, online-only submission, notes-marker idempotency, and a documented one-flag escape to stop at PENDING_APPROVAL if the business later wants desktop approval.

Why counting is **online-only to submit** (capture may be offline): core `create` trusts client `systemQuantity` (`normalizeAdjustmentLine`, service line 150 — it never reads the live balance), so the POS wrapper must read `inventoryBalance.quantityOnHand` itself at post time. A queued/outboxed count would post against a balance that moved since capture with no human in the loop. Counts therefore never enter the sales outbox; the draft is form-state (like kikaratasi), and submission requires a human tapping TUMA HESABU while online, with the capture time shown on the confirm screen.

---

## 1. Backend

### 1.1 `GET /mobile-pos-lite/stock` — NEW

| | |
|---|---|
| Verb/path | `GET /mobile-pos-lite/stock` |
| Permission | `@RequirePermissions('mobile_pos_lite.use')` |
| Auth | terminal headers `x-mobile-pos-terminal` + `x-mobile-pos-device` → `requireTerminal()` (inherits ACTIVE terminal, assigned-user match, company WRITE, timing-safe secret check, and `terminal.branchId` — the client can never supply a branch) |
| Query | `search?: string` (same OR terms as `products()`: barcode equals-insensitive, productCode/sku/name contains-insensitive); ~~`low?: boolean` using the documented coercion `@Type(() => String) @Transform(({value}) => value === 'true') @IsBoolean()` (plain pattern is clobbered by `enableImplicitConversion`)~~ **[CUT from v1 — owner decision 2026-08-11, critique D4: `?low=true` dropped until a notification use-case exists; the filter chips are client-side. The coercion note stays for whoever revives it.]** |

Implementation: direct Prisma in `MobilePosLiteService` (precedent: `products()` already reads `inventoryBalance` directly at 506–517). **Do not** touch `products()` — its drop-unpriced filter (line 523) is load-bearing for the sale flow. **Do not** wrap `InventoryBalancesService.liveStock()` — it leaks `averageCost`/`totalValue`/`riskValue` and its `findAll` filters in memory with no `take`.

Where clause: `companyId = terminal.companyId`, `status: 'ACTIVE'`, `divisionId ∈ {terminal.divisionId, null}`, and stock items only — `trackInventory: true` AND `productType NOT IN ('SERVICE','NON_STOCK_ITEM')` (reuse `isStockItem()`, service line 59). Select adds `reorderLevel`, `minimumStockLevel` to the products() select. `take: 1500`, name order from DB; join balances for `terminal.branchId` exactly like products(); products with no balance row ⇒ quantities 0. **Include unpriced products** (`sellingPrice: null`). **Do not clamp negatives.**

Server-computed per row (in JS after fetch, like products() maps in JS):
- `threshold = reorderLevel ?? minimumStockLevel ?? 10` (the `annotateBalance`/`liveStock` predicate)
- `available = quantityOnHand − quantityReserved` (unclamped)
- `status`: `OVERSOLD` if `available < 0`; `OUT_OF_STOCK` if `available === 0`; `LOW_STOCK` if `0 < available ≤ threshold`; else `IN_STOCK`
- Final sort problems-first: `OVERSOLD → OUT_OF_STOCK → LOW_STOCK → IN_STOCK`, then name asc. ~~`?low=true` filters to `status ≠ IN_STOCK` post-compute.~~ **[CUT from v1 — owner decision 2026-08-11, critique D4]**

Response:
```json
{
  "asOf": "2026-08-11T09:14:00.000Z",
  "branch": { "id": "…", "name": "…" },
  "items": [{
    "productId": "…", "name": "…", "code": "…", "barcode": null,
    "unitId": "…", "unitSymbol": "pc", "imageUrl": "/products/:id/image" | null,
    "sellingPrice": 12000 | null,
    "quantityOnHand": 7, "quantityReserved": 2, "available": 5,
    "threshold": 10,
    "status": "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | "OVERSOLD"
  }]
}
```
**No cost/value fields, ever** (rep phones get stolen). This is a review-blocking rule on the endpoint and on any future change to it.

This one endpoint IS the product lookup too: photo (`imageUrl` via the existing `/api/backend` cookie proxy), price (`sellingPrice`, nullable), on-hand (`available` + split). Nothing new is needed for lookup — `GET /products?search=` stays exactly as-is for the sale flow.

DTO file: `backend/src/modules/mobile-pos-lite/dto/mobile-pos-lite-stock.dto.ts` (`QueryMobilePosLiteStockDto`). **Size: S** (endpoint) + **S** (unit tests: status boundaries incl. negative/zero/threshold-equal, unpriced included, no-balance-row, division-null, no cost fields in payload) = **M total**.

### 1.2 `POST /mobile-pos-lite/stock-counts` — NEW

| | |
|---|---|
| Verb/path | `POST /mobile-pos-lite/stock-counts` |
| Permission | `@RequirePermissions('mobile_pos_lite.stock_count')` — NEW permission (see 1.3) |
| Auth | terminal headers → `requireTerminal()` |

Body (`CreateMobilePosLiteStockCountDto`, new file `dto/mobile-pos-lite-stock-count.dto.ts`):
```ts
{
  idempotencyKey: string,   // @Length(16,64) @Matches(/^[A-Za-z0-9._:-]+$/) — same rule as purchases
  countedAt?: string,       // @IsISO8601 — capture time, informational, embedded in notes
  lines: [{                 // @ArrayMinSize(1) @ArrayMaxSize(200)
    productId: string,
    countedQuantity: number // @Min(0) @Max(1_000_000); 0 is valid ("shelf is empty")
  }]
}
```
Client sends **no** `systemQuantity`, no variance, no costs, no unitId, no branch/company.

Wrapper flow (mirrors the purchases wrap, service lines 671–1106, same file):
1. `requireTerminal()`.
2. **Idempotency/resume first:** marker `[MPL-COUNT:<key>]`; `findCountByMarker(companyId, marker)` = `prisma.stockAdjustment.findFirst({ where: { companyId, deletedAt: null, notes: { contains: marker } }, orderBy: { createdAt: 'asc' } })` — `contains`, exactly like `findPurchaseByMarker` (line 993), because `reject()` *appends* to notes and the marker must survive. If found, **resume** from its recorded status (state-guarded steps; concurrent loser re-reads and continues). Best-effort twin-detect: after create, re-query by marker; if an earlier row exists, delete the later duplicate DRAFT and continue with the earlier — verbatim the purchases mechanic.
3. Validate lines: dedupe productIds (reject duplicates, 400); load products with `companyId = terminal.companyId`, `status ACTIVE`, `divisionId ∈ {terminal.divisionId, null}` (the `resolvePurchaseLines` scoping); reject any non-`isStockItem()` or missing product with a 400 naming the productId.
4. **Server-authoritative systemQuantity:** read `inventoryBalance.quantityOnHand` for `terminal.branchId` per productId (missing row ⇒ 0). Note: system side is `quantityOnHand`, NOT `onHand − reserved` — a physical count counts physical stock; reservations are irrelevant.
5. Build `CreateStockAdjustmentDto` and drive the core chain `StockAdjustmentsService.create → submit → approve → post`:
   - `companyId: terminal.companyId`, `divisionId: terminal.divisionId ?? undefined`, `branchId: terminal.branchId`
   - `reason: 'MOBILE_POS_STOCK_COUNT'`
   - `notes: `[MPL-COUNT:<key>] Stock count from terminal <terminal.code>` + (countedAt ? ` captured <countedAt>` : '')`` — marker written atomically with the row at create
   - lines: `{ productId, systemQuantity, countedQuantity, unitId: product.baseUnitId }` — `unitCost` omitted; `post()` (line 360) resolves WAC→default purchase price itself, and its atomic `APPROVED→POSTED` `updateMany` claim makes retried posts safe
   - Core services enforce company-scope WRITE only (permissions live on their controllers — verified: create line 134, submit/approve/post via `findOne(..., WRITE)`), so the controller-level `mobile_pos_lite.stock_count` is the sole gate. Document this in a comment exactly like the purchases wrap does at 671–678.
6. **One-flag escape (documented in the wrapper):** module-level `const AUTO_POST_MOBILE_POS_STOCK_COUNTS = true;` — when flipped to `false`, the chain stops after `submit()` and the adjustment rests at `PENDING_APPROVAL` for a desktop approver (`inventory.adjustments.approve/post`). Resume logic must handle both terminal states.

Response:
```json
{
  "id": "…", "adjustmentNumber": "…",
  "status": "POSTED" | "PENDING_APPROVAL",
  "lines": [{ "productId": "…", "systemQuantity": 7, "countedQuantity": 5, "varianceQuantity": -2 }]
}
```
Lines are returned so the success screen can show *server-truth* variance (the client's review-step preview was computed against a possibly-stale snapshot).

**Size: L** (wrapper + resume/twin tests + idempotent-replay test + reject-appended-notes marker-survival test + escape-flag test).

### 1.3 Permission + session flag

- Seed `mobile_pos_lite.stock_count` in `database/seeds/seed.ts` immediately after the `mobile_pos_lite.purchase` block (lines 264–270): `{ code: 'mobile_pos_lite.stock_count', description: 'Record stock counts from a Mobile POS Lite terminal', module: 'mobile_pos_lite', action: 'stock_count', isGroupControl: false }`. Grant in the same two role predicates that grant `.purchase` (lines 1541 and 1593): `(p) => p.code === 'mobile_pos_lite.stock_count'` — manager-tier only, never cashiers (the WESTSIDES/cashier predicates at ~1673/1707 stay `.use`-only).
- `sessionPayload` (service ~1356) grows one line beside `purchasesEnabled`: `stockCountsEnabled: user.permissions?.includes('mobile_pos_lite.stock_count') ?? false`. **No `configVersion` bump** — permission-derived, not terminal config.
- Frontend: add optional `stockCountsEnabled?: boolean` to `MobilePosLiteCachedSession` in `frontend/src/lib/mobile-pos-lite-store.ts` (the runtime object is structured-cloned into IDB, so the flag survives offline cold-start automatically — same as the existing `purchasesEnabled` quirk; adding the type field just makes it honest).

**Size: S.**

### 1.4 Explicitly NOT built

- No `PATCH`/`DELETE`/list endpoints for counts on the POS surface; no `revertApproval`/`reject` exposure. Corrections are a desktop job (`inventory.adjustments.*`).
- No changes to `products()`, `/catalog`, the SW, terminal binding, or the outbox contract.
- No per-line `reason` field v1 — one count, one reason code.

---

## 2. Frontend — Stoo screen (Phase 4)

Route: pushState pseudo-screen inside `/mobile-pos` per the nav model; rail tab `Stoo` (box duotone chip), visible to all `mobile_pos_lite.use` holders. Back-map: Stoo → Mauzo. Forward nav `animate-slide-in-right`, back `slide-in-left`.

### Layout (top → bottom)
1. **Header row:** screen name "Stoo" (Title 22/700) + **freshness clock** chip right-aligned (Label 14): derived from the *client* `fetchedAt` (not server `asOf` — avoids device clock skew): `<60s` → green `stockFreshNow`; minutes → green `stockFreshMinutes`; hours → brass `stockFreshHours`; ≥1 day → grey, and copy always framed as `stockLastSeen` ("mwisho kuonekana …") — never present-tense certainty. *(Key references in §2–3 corrected to the flat names §4 defines — critique A4; the catalog is a flat `keyof` union, dot names break typing.)*
2. **Search input** (`.aurora-input`, 56px): local filter over the snapshot (name/code/barcode, contains, case-insensitive). No remote call while typing — the snapshot is the truth on this screen; keyboard-wedge scans work because barcode is in the filter. On focus the slab collapses to the 28px strip (global keyboard rule).
3. **Filter chips** (48px, Label 600): `Zote · Kidogo · Imeisha` — client-side filters over the snapshot (`Kidogo` = LOW_STOCK; `Imeisha` = OUT_OF_STOCK + OVERSOLD). Low stock is a chip, not a screen. Selected chip = green-selected style (matches customer/supplier chips).
4. **List** (rows 56px min, borderless cards Mchana / 1px border Usiku):
   - 44px photo tile (`/api/backend${imageUrl}`, lazy; `onError` and offline → the designed **brass initial-letter tile**)
   - Name (Body 17/500, 1-line ellipsis) over code (Label, `--aurora-text-muted`)
   - Right: **big quantity + unit** (Title 22/700 ink, `.aurora-money` tabular) + status dot-and-word under it (Label): green **Ipo** / brass **Inakwisha** / red-ringed **Imeisha** / purple **Zaidi ya rekodi**
   - Sort: problems-first as delivered by the server (OVERSOLD→OUT→LOW→OK, then name). No client re-sort.
   - Mount animation: `.aurora-stagger` first 12.
5. **Row tap → detail bottom sheet** (the product-lookup moment): large photo (or brass initial tile), name (Title), code + barcode, **price** — brass at Title size on an `--aurora-accent-subtle` chip (brass-text-only-at-Title-and-above rule), or `stockNoPrice` grey chip when `sellingPrice === null` — **on-hand** split ("Kiasi: 7 pc · Zilizowekwa: 2"), status word, threshold line for managers only ("Kikomo: 10"). Sheet dismiss = drag/tap-scrim; no navigation event.
6. **Slab:** ~~on Stoo the slab shows no primary verb for reps (sync token + day-total only).~~ **[AMENDED 2026-08-11 — critique A6, resolved in spec-leo §6: the slab law holds — never verb-less. Reps get `slabMauzoMapya` (MAUZO MAPYA → Mauzo); the day total shows only when known from the Leo daylog cache (staleness renders on the Leo screen, never on the slab).]** For managers (`stockCountsEnabled`), the slab verb is **ANZA KUHESABU** → enters Hesabu mode.

### Manager-only presentation gates (client-side)
`isManagerView = session.stockCountsEnabled || session.purchasesEnabled`. Reps: `available < 0` renders as `0` + red **Imeisha** (a negative number is office noise to a rep). Managers: true negative value + purple **Zaidi ya rekodi**. Server always sends the truth; presentation gates it.

### Data / freshness / offline
- **Fetch policy (DB-storage discipline):** `GET /stock` fires on Stoo tab open **only if** the cached snapshot is missing or older than `STOCK_SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000`; plus a manual refresh affordance (tap the freshness chip). Pre-warm: fire the same conditional fetch when the rail renders, so the tab switch feels instant. NOT fetched on every catalog sync.
- Every successful response snapshots to IDB `stocks` (see §5) with `fetchedAt = Date.now()`.
- **Offline:** render the snapshot behind the freshness clock. **>24h stale ⇒ quantities hidden entirely** — rows show photo/name/status **dot + word** ~~dot only (no word, no number)~~ **[AMENDED 2026-08-11 — critique A8: the status WORD stays; only the number is dropped. Color is never the sole channel — a bare dot is exactly the imperceptible-on-720p signal Rejected #12 bans.]** plus the grey `stockLastSeen` header chip. The detail sheet in this state shows price (catalog data ages differently) but no quantities.
- **Error state** (online fetch failed, no/expired snapshot): inline card `stockLoadError` + **`tryAgain`** retry button (the one shared retry key — critique A4; never leave-and-re-enter). If a snapshot exists, show it with the stale header instead of the error card.
- **Empty state:** `stockEmpty` card with the box duotone icon (only when the server genuinely returns zero items; a filtered-empty chip state shows `stockFilterEmpty`).

**Size: M** (screen + snapshot plumbing + freshness + gates), assuming the Phase 2 hooks extraction (`usePosBootstrap` etc.) has landed.

---

## 3. Frontend — Hesabu (count mode, Phase 5)

Entry: slab **ANZA KUHESABU** on Stoo; gated `session.stockCountsEnabled`. Back-map: Hesabu → Stoo (**draft persists**). Screen is Stoo's list re-rendered in count mode — same rows, different right side.

### Blind entry
- Each row's quantity/status block is replaced by a **CountInput** (new component, 48px, `inputMode="numeric"`): **integers only, digits, range 0–1,000,000** ~~`inputMode="decimal"`: digits + one optional `.` + ≤3 decimals~~ **[AMENDED 2026-08-11 — owner decision, critique D6: integer-only counting v1; decimals return with weighed-goods support]**, select-on-focus, commit on blur/Enter. Empty = **not counted** (`countNotCounted` ghost text); `0` = counted-as-zero (valid, distinct). NOT the existing `QuantityInput` (it clamps 1–9999 integer and restores-on-empty — wrong semantics here; reuse its remount-by-`key` pattern only).
- **System quantity is never shown while counting** — no quantity, no status word, no dot on any row in count mode (anchoring). Search and chips still work for finding products; the `Kidogo`/`Imeisha` chips are disabled in count mode (they'd leak status).
- Progress chip in header: `countProgress` ("Umehesabu 12").
- **Every edit autosaves the draft** to IDB `drafts` (key `${terminalCode}:count`) — counting happens in storerooms where signal dies; the draft survives app kill and offline cold-start. `capturedAt` = first edit timestamp.
- Draft management: entering Hesabu with an existing draft offers `countResumeDraft` / `countDiscardDraft` (two big buttons, no typed confirm). One draft per terminal, by construction.

**Queued-sales-before-count gate [ADDED 2026-08-11 — critique B3, owner-accepted]:** a count posted while CASH sales sit in the local outbox double-counts shrinkage — the count captures the already-sold stock as variance, then the queued sale syncs and decrements again. Two defenses: (1) **entry warning** — tapping ANZA KUHESABU with a non-empty local outbox shows an inline notice `countQueueGate` ("Tuma Sasa kabla ya kuhesabu") with a Tuma Sasa button right there; capture itself is never blocked (blind entry touches no balances, and storeroom counting is offline by design); (2) **hard submit gate** — TUMA HESABU is the online moment, so if the local outbox is non-empty at submit, the confirm is replaced by `countQueueGate` + Tuma Sasa; the count posts only once the local queue is flushed. The client can only see its *own* outbox — another terminal's queued sales are invisible; the **cross-terminal case is documented as accepted** (same class as edge case 7: the later poster's `systemQuantity` is read live, and the office reviews variance reports).

### Review step (slab: KAGUA → TUMA HESABU)
- Slab verb while entering: **KAGUA HESABU** (enabled once ≥1 line counted). Tap → review list: only counted lines; each shows name, counted value, and **preview variance** vs the snapshot's **`quantityOnHand`** — never `available` **[AMENDED 2026-08-11 — critique A7: pinned to `quantityOnHand` to match the server's systemQuantity baseline (§1.2 step 4); previewing against `available` (onHand − reserved) would make any branch with reservations show previews that systematically disagree with server-returned truth, teaching managers to distrust the review screen]** — `+n` green / `−n` red, Label size, with the caveat line `countPreviewNote` ("makadirio — rekodi kamili itasomwa ofisini wakati wa kutuma"). Variance appears here for the first time (resolves blind-entry vs review).
- **Threshold double-confirm:** `const COUNT_VARIANCE_CONFIRM_THRESHOLD = 20` (sum of absolute preview variances, tunable constant, documented). Above it, the confirm dialog gains the amber-free warning card `countBigVariance` and requires a second tap on a differently-labeled button (`countConfirmAnyway`). This is caution copy, not amber chrome — it renders as a bordered card, red variance numerals already carry the weight.
- Confirm dialog always shows **capture time** (`countCapturedAt` with the draft's `capturedAt`) — the variance may be surprising even when correct.
- **Online-only submit:** offline ⇒ slab disabled + grey wifi-slash + inline `countNeedsNetwork`. No outbox entry, ever.
- Submit: generate `idempotencyKey` via existing `newIdempotencyKey()`; POST only counted lines; `busy` state = slab `--aurora-glow-primary` in-flight glow.
- **Success:** MUHURI stamp **HESABU IMEKAMILIKA** (`pos-stamp` keyframe, `--aurora-glow-accent`, [30,40,30] stamp haptic), summary card shows server-returned line variances (truth), adjustment number, and — if the escape flag ever ships OFF — the `PENDING_APPROVAL` variant stamps hollow with `countPendingApproval` copy. Draft cleared **only on 2xx**. Tally: a count is a finished job — one tally mark in Leo's Daftari. Slab: MAUZO MAPYA (back to the money path) with RUDI STOO secondary.
- **Rejection (4xx/5xx):** `shake` on the slab, [60,40,60] reject haptic, mapped Swahili error via `posErrorMessage()` (new patterns: unknown product, non-stock item, duplicate line), raw English collapsed behind "Maelezo ya kiufundi". **Draft retained** — nothing is lost on failure. Connection-shaped failure (`isConnectionProblem()`): inline `countNeedsNetwork` (reused — no separate `sendFailedOffline` key; the message is the same truth) + retry stays available; because of the idempotency marker, blind retries are safe even after a lost response.

**Size: L** (CountInput, draft lifecycle, review/confirm, MUHURI variant, error paths).

---

## 4. i18n — exact new keys (`pos-i18n.ts`, both catalogs, Swahili written first)

Stoo (22 — was 23; `stockRetry` consolidated into the one shared `tryAgain`, critique A4):
| key | sw | en |
|---|---|---|
| `stockTab` | Stoo | Stock |
| `stockAll` | Zote | All |
| `stockLowChip` | Kidogo | Low |
| `stockOutChip` | Imeisha | Out |
| `stockInStock` | Ipo | In stock |
| `stockLow` | Inakwisha | Running low |
| `stockOut` | Imeisha | Out of stock |
| `stockOversold` | Zaidi ya rekodi | More than recorded |
| `stockSearchPlaceholder` | Tafuta bidhaa stoo | Search stock |
| `stockEmpty` | Hakuna bidhaa za stoo bado | No stock items yet |
| `stockFilterEmpty` | Hakuna bidhaa kwenye kichujio hiki | Nothing matches this filter |
| `stockLoadError` | Imeshindikana kupakua stoo | Could not load stock |
| ~~`stockRetry`~~ | ~~Jaribu tena~~ | ~~Try again~~ **[CONSOLIDATED 2026-08-11 — critique A4: use the shared `tryAgain` defined in spec-purchases §7]** |
| `stockFreshNow` | Sasa hivi | Just now |
| `stockFreshMinutes` | Dakika {count} zilizopita | {count} min ago |
| `stockFreshHours` | Saa {count} zilizopita | {count} hr ago |
| `stockLastSeen` | Mwisho kuonekana {time} | Last seen {time} |
| `stockStaleHidden` | Taarifa za zamani — idadi zimefichwa | Data is old — quantities hidden |
| `stockPrice` | Bei | Price |
| `stockNoPrice` | Haina bei | No price set |
| `stockOnHand` | Kiasi | On hand |
| `stockReserved` | Zilizowekwa | Reserved |
| `stockThreshold` | Kikomo: {count} | Reorder at: {count} |

Hesabu (20 — `countQueueGate` added 2026-08-11 per critique B3):
| key | sw | en |
|---|---|---|
| `countStart` | ANZA KUHESABU | START COUNT |
| `countTitle` | Hesabu | Stock count |
| `countReview` | KAGUA HESABU | REVIEW COUNT |
| `countSubmit` | TUMA HESABU | SEND COUNT |
| `countSubmitting` | Inatuma… | Sending… |
| `countNotCounted` | Haijahesabiwa | Not counted |
| `countProgress` | Umehesabu {count} | {count} counted |
| `countVariance` | Tofauti | Variance |
| `countPreviewNote` | Makadirio — rekodi kamili itasomwa wakati wa kutuma | Estimate — exact records are read when you send |
| `countCapturedAt` | Ilihesabiwa {time} | Counted at {time} |
| `countConfirmBody` | Hesabu hii itabadilisha rekodi za stoo mara moja. | This count updates stock records immediately. |
| `countBigVariance` | Tofauti ni kubwa — hakiki tena kabla ya kutuma. | The variance is large — check again before sending. |
| `countConfirmAnyway` | Ndiyo, tuma hesabu | Yes, send the count |
| `countDone` | HESABU IMEKAMILIKA | COUNT COMPLETE |
| `countPendingApproval` | Inasubiri idhini ya ofisi | Waiting for office approval |
| `countNeedsNetwork` | Kutuma hesabu kunahitaji mtandao | Sending a count needs a network connection |
| `countResumeDraft` | Endeleza hesabu ya awali | Continue earlier count |
| `countDiscardDraft` | Futa rasimu | Discard draft |
| `countDraftSaved` | Rasimu imehifadhiwa kwenye simu hii | Draft saved on this phone |
| `countQueueGate` | Kuna mauzo yanasubiri kutumwa — Tuma Sasa kabla ya kuhesabu. | Sales are still waiting to send — send them before counting. |

Plus `posErrorMessage()` pattern additions (best-effort maps over raw backend text): "not a stock item" → "Bidhaa hii haihifadhiwi stoo", "Product not found"/scoping → "Bidhaa haipatikani kwenye tawi hili", duplicate-line 400 → "Bidhaa imeandikwa mara mbili". **Size: S.**

## 5. IndexedDB / store changes (`frontend/src/lib/mobile-pos-lite-store.ts`)

DB `itemba-mobile-pos-lite` **version 3 → 4**, `onupgradeneeded` stays purely additive create-if-missing. **[AMENDED 2026-08-11 — critique A1/B1: this is the ONE v4 migration, shared with spec-purchases §6 (`drafts`) and spec-leo §3 (`daylog`) — one upgrade creates `stocks` + `drafts` + `daylog`; the v4-capable store code (version-less open + VersionError handling) ships one release ahead of Phase 3.]**
- **`stocks`** — key: `terminalCode` (out-of-line). Value: `{ items: PosStockItem[], asOf: string, fetchedAt: number }` where `PosStockItem` mirrors the endpoint item shape exactly.
- **`drafts`** — key: `` `${terminalCode}:count` `` (out-of-line; `` :purchase `` reserved for the kikaratasi draft, same store, same phase). Value for count: `{ type: 'count', lines: Record<productId, number>, capturedAt: number, updatedAt: number }`.

New functions (same one-transaction-open-close-in-`finally` style): `readCachedStock`, `writeCachedStock`, `readCountDraft`, `writeCountDraft`, `clearCountDraft`. Type additions: `PosStockItem`, `PosStockSnapshot`, `PosCountDraft`, and `stockCountsEnabled?: boolean` on `MobilePosLiteCachedSession`. Outbox untouched. **Size: S.**

## 6. Permission gates (summary)

| Surface | Gate |
|---|---|
| Stoo tab + `GET /stock` | `mobile_pos_lite.use` (everyone on the terminal) |
| Oversold word + negative quantities + threshold line | client-side `stockCountsEnabled \|\| purchasesEnabled` |
| ANZA KUHESABU + Hesabu screen | `session.stockCountsEnabled` |
| `POST /stock-counts` | `mobile_pos_lite.stock_count` (controller) + terminal binding; core services company-scope only — controller gate is the sole permission gate, documented |

## 7. Edge cases (build checklist)

1. Product with stock but no price — appears in Stoo (`stockNoPrice` chip), never in sale search. 2. No `inventoryBalance` row — 0 / OUT_OF_STOCK, countable (systemQuantity 0). 3. `reserved > onHand` — `available` negative ⇒ OVERSOLD even with positive shelf stock; detail sheet's on-hand/reserved split explains it. 4. Duplicate `productId` in count body — 400, mapped. 5. Product deactivated between capture and submit — 400 naming the product; draft retained; rep removes the line and resubmits (new key not required — but client MUST reuse the same key only for byte-identical retries; an edited resubmit generates a fresh key, mirroring the sale-outbox frozen-payload rule). 6. Lost response after POST — retry with same key resumes via marker; safe at every chain state including half-posted (atomic APPROVED→POSTED claim). 7. Two terminals counting the same branch — both post; the later one's systemQuantity is read after the earlier posted, so variance math stays correct; no lock needed v1. 8. `reject()` appends to notes — marker search uses `contains`; survives. 9. Draft older than snapshot / >24h snapshot — counting still allowed (blind entry doesn't use the snapshot); only the review *preview* is stale, which the `countPreviewNote` copy owns; server truth arrives in the response. 10. 1500-item cap — matches catalog's accepted bound; note in code comment. 11. Decimal-unit products (kg) — ~~CountInput accepts 3dp; display trims trailing zeros~~ **[AMENDED 2026-08-11 — owner decision, critique D6: integer-only v1; kg-tracked items are counted in whole units; decimals return with weighed-goods support]**. 12. Escape flag OFF — hollow stamp + `countPendingApproval`; resume path must treat PENDING_APPROVAL as terminal, not an error. 13. Stoo fetch during in-flight sale sync — independent; no shared `busy`. 14. Keyboard-wedge scan on Stoo search — plain input filter, works by construction. 15. ~~`?low=true` unused by the app v1 (chips are client-side) but specced and tested — it exists for future notification/polling use without a second endpoint.~~ **[CUT from v1 — owner decision 2026-08-11, critique D4: not specced, not tested, not built until the notification use-case exists.]**

## 8. Build-size ledger

| Piece | Size |
|---|---|
| `GET /stock` + DTO + tests | **M** |
| `POST /stock-counts` wrapper + resume/idempotency tests | **L** |
| Permission seed + session flag + cached-session type | **S** |
| IDB v4 (`stocks`, `drafts`) + store fns | **S** |
| Stoo screen (list, chips, freshness, detail sheet, offline/stale/error/empty) | **M** |
| Hesabu (CountInput, draft lifecycle, review, confirm, MUHURI, error paths) | **L** |
| i18n (42 keys + error-map patterns — still 42 after 2026-08-11: `stockRetry` −1, `countQueueGate` +1) | **S** |

Sequencing per the design direction: Phase 4 = rows 1,3(read half),4(`stocks` only),5(Stoo),7(Stoo keys). Phase 5 = rows 2,3(count half),4(`drafts`),6(Hesabu),7(Hesabu keys). Backend `GET /stock` can land and deploy ahead of the UI (additive, unused-safe); `stock-counts` should land in the same release train as Hesabu so the permission never gates a nonexistent screen.