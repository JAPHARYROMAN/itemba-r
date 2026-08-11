# MODULE SPEC — Manunuzi (Purchases): Receive Stock + Purchase History

> **[AMENDED 2026-08-11 — owner decisions.]** (1) **Historia is CUT from v1 entirely** (critique A5/D1): the list, the detail overlay, `GET /mobile-pos-lite/purchases`, and their i18n keys. The office desktop covers the review need; no buying-cost history lands on phones. Affected sections are annotated in place below (§2 rows, §3.3–3.4, §5.2, §7 keys, §8 cases 8–9, §9 rows) — text retained for the record, none of it is built. (2) **Kikaratasi is simplified per critique D3:** auto-persist + silent restore into the form stay; the reconnect prompt / 48h-expiry / discard-ritual state machine is cut (annotated at §3.1 and §7). Manunuzi v1 is: Pokea + Risiti ya Mzigo + the simplified kikaratasi.

Build-ready spec for the full Manunuzi module of Itemba POS under the Kaunta design direction. Verified against main @ 76597c47. Manunuzi is the manager's module: sales grammar in reverse, brass for every shilling, MUHURI on completion, kikaratasi (not a queue) for offline, and — new in this spec — a purchase history book with a single new GET endpoint **[CUT from v1 — owner decision 2026-08-11]**.

**Module scope:** supplier picking → receiving lines with optional buying prices → one POST that drives the whole PO→GRN chain (existing, untouched) → MZIGO UMEPOKELEWA stamp; plus Historia (list + detail) backed by `GET /mobile-pos-lite/purchases` (new, specced in §5.2) **[CUT from v1 — owner decision 2026-08-11]**; plus the kikaratasi offline draft.

**Key files:**
- `C:\projects\Actual Projects\itemba-r\frontend\src\components\westsides\mobile-pos-lite\mobile-pos-lite.tsx` (current purchase screen: extracted to `screens/manunuzi/*` per Phase 2 seams)
- `C:\projects\Actual Projects\itemba-r\frontend\src\components\westsides\mobile-pos-lite\pos-i18n.ts` (existing purchase keys at en 73–82 / sw 163–172)
- `C:\projects\Actual Projects\itemba-r\frontend\src\lib\mobile-pos-lite-store.ts` (IDB v3 → v4)
- `C:\projects\Actual Projects\itemba-r\backend\src\modules\mobile-pos-lite\mobile-pos-lite.controller.ts` (+1 GET route)
- `C:\projects\Actual Projects\itemba-r\backend\src\modules\mobile-pos-lite\mobile-pos-lite.service.ts` (createPurchase chain at 671–795; `resumePurchaseChain`, `findPurchaseByMarker`, `purchaseIdempotencyMarker` — all reused, none modified)
- `C:\projects\Actual Projects\itemba-r\backend\src\modules\mobile-pos-lite\dto\mobile-pos-lite-purchase.dto.ts` (+1 query DTO)

---

## 1. Visibility and permission gates

| Surface | Gate | Behavior when absent |
|---|---|---|
| `Manunuzi` rail tab | `session.purchasesEnabled` (server-derived from `mobile_pos_lite.purchase`, service line 1356 — unchanged) | Tab not rendered at all |
| Deep link `#manunuzi*` (pushState hash) | same flag | `popstate`/boot lands on Mauzo instead; no error screen |
| `GET /mobile-pos-lite/suppliers` | `@RequirePermissions('mobile_pos_lite.purchase')` (existing) | 403 |
| `POST /mobile-pos-lite/purchases` | same (existing) | 403 |
| ~~`GET /mobile-pos-lite/purchases` (NEW)~~ **[CUT from v1 — owner decision 2026-08-11]** | ~~same permission — history shows `unitCost`/`totalAmount`, so it must sit behind the manager gate, never `mobile_pos_lite.use`~~ | ~~403~~ |

Session refresh may revoke the flag mid-session (permission removed, terminal config change): if the user is on any Manunuzi screen when a refreshed session arrives with `purchasesEnabled === false`, navigate to Mauzo with a plain notice (reuse `terminalUnavailable` tone, no new key needed — the rail tab disappearing is the message). The kikaratasi draft in IDB is left alone (harmless; resurfaces only if the flag returns).

**Cost-visibility rule:** the four-color law says money is brass, and the Stoo rule says rep phones never show cost. Manunuzi is the deliberate exception: the manager typed the buying price, so buying prices, line totals, and purchase totals render here (brass, per §2.1 contrast rules) — but only ever behind `mobile_pos_lite.purchase`. No purchase money field may leak into any `mobile_pos_lite.use` response or screen. Review-blocking.

No `configVersion` bump anywhere: nothing in this module is terminal config.

---

## 2. Screen map and navigation

Manunuzi lives inside the `/mobile-pos` pushState pseudo-router. Hash map and back-map (explicit, per the SHABA back-map rule):

| Screen | Hash | Back goes to | Slab verb (blue) | Slab money (brass Display) |
|---|---|---|---|---|
| **Pokea** (receive form) | `#manunuzi` | Mauzo (form state persists via draft) | `POKEA` — or `HIFADHI KIKARATASI` when offline | running total cost of lines |
| **Risiti ya Mzigo** (success) | `#manunuzi/risiti` | Pokea **fresh** — never re-pops the filled form (mirrors Risiti→Mauzo rule) | `MZIGO MPYA` | purchase `totalAmount` |
| ~~**Historia** (list)~~ **[CUT from v1 — owner decision 2026-08-11]** | ~~`#manunuzi/historia`~~ | ~~Pokea~~ | ~~`MZIGO MPYA` (jumps to fresh Pokea)~~ | ~~window total (`totalAmount` from GET)~~ |
| ~~**Historia detail**~~ **[CUT from v1 — owner decision 2026-08-11]** | ~~`#manunuzi/historia/:id`~~ | ~~Historia (list scroll position preserved — component stays mounted, detail overlays)~~ | ~~`MZIGO MPYA`~~ | ~~that purchase's `totalAmount`~~ |

Forward nav `animate-slide-in-right`, back `slide-in-left`. Entry to the module is always Pokea (receiving is the frequent job); ~~Historia is reached by a two-chip segment control in the Pokea header: `Pokea | Historia` (Label size, 48px height, selected chip `--aurora-primary-subtle`)~~ **[CUT from v1 — owner decision 2026-08-11: no segment control; the Pokea header carries the plain module title]**. Keyboard rule applies: any focused input collapses the slab to the 28px strip. Hash shapes and cold-boot handling follow the hash-only routing contract mandated in spec-sales §0.3 (critique A3); with Historia cut, `#manunuzi` and `#manunuzi/risiti` are this module's only hashes.

---

## 3. Screens in detail

### 3.1 Pokea (receive form)

Sales grammar in reverse — a manager who can sell can receive with zero new learning.

**Layout, top to bottom:**
1. Header: module title "Manunuzi" (Title 22px), segment control `Pokea | Historia`, status ribbon above when non-clean (grey offline chip / slip badge).
2. **Supplier slot** — exactly where the customer chip lives on Malipo. Empty state: search input (autoFocus off — supplier is step 1 but managers often add lines first; no forced order), `supplierSearchPlaceholder`, 220ms debounce ≥2 chars → `GET /mobile-pos-lite/suppliers?search=` (existing; online only). Result rows 56px: name (Body), `supplierCode · phone` (Label, secondary). Tap → **green chip** (green = confirmed/selected, per four-color law) with name + "badilisha" change affordance (reuse existing `change` key pattern from customer chip).
3. **Product search + quick-pick** — same components as Mauzo. Search is **local catalog only** (≤8 results — existing behavior, kept: no remote call on this screen). Quick-pick grid (same photo-first 2-col tiles, ≥104px, frequents-sorted) shown when query empty — restocking targets the same goods that sell. Tap = add line (or increment), `scale-pop` + 15ms tick haptic + slab total count-up.
4. **Lines** ("Bidhaa zilizopokelewa", existing `purchaseItems`): 56px+ rows — name (Body, 2-line clamp), qty stepper (48px, `QuantityInput` verbatim, 1–9999 integers, trash to remove), and per-line **buying-price field**: label `buyingPrice` + existing `optional` key rendered as "(si lazima)", digits only ≤10, `inputMode=numeric`, whole TZS. When filled, the line shows a computed line total as ink-on-brass-subtle chip (Label-size money never renders in raw brass text — §2.1 contrast rule). When empty, chip reads nothing (server falls back to defaultPurchasePrice → family; don't display a guessed cost).
5. **Slab**: `POKEA`, enabled when supplier chosen AND ≥1 line AND online. Disabled states show why inline above the slab, never a toast: no supplier → `selectSupplierFirst`; offline → see below.

**Offline state (the kikaratasi — form-state persistence, NOT a transaction queue):**
- Ribbon shows the grey offline chip; an inline calm note `purchaseOfflineNote` sits under the header. Nothing amber — offline is weather.
- The form keeps working fully (supplier chip persists if already chosen; supplier *search* is dead offline — show `needsNetwork` hint inline in the search slot; local product search and quick-pick work).
- Slab verb becomes `HIFADHI KIKARATASI` (still blue — it's the primary verb). Tap → draft committed (see §6), 15ms tick, navigate to Mauzo, **slip badge** appears on the ribbon (`slipBadge`, brass — unsent local data is custody, one counted token in one fixed place).
- Auto-persist: independent of the button, form state (supplier + lines + notes) writes to the draft store debounced 500ms whenever non-empty — battery death never loses twenty typed lines. The explicit button is the *acknowledged* save (badge + navigation); auto-persist is silent crash insurance that restores into the form on next Pokea open.
- Only **one** draft per module. Opening Pokea with a draft present restores it into the form (online or offline).

~~**Reconnect prompt:** when `online` fires (or on boot online) and a draft exists, show a bottom sheet — `slipPromptTitle` / `slipPromptBody`, buttons: **Tuma sasa** (primary, reuses existing `sendNow`), **Hakiki kwanza** (`slipReview` — opens Pokea prefilled), **Futa kikaratasi** (`slipDiscard`, two-step inline confirm `slipDiscardConfirm`). Never auto-send. If the draft is **>48h old** (from `savedAt`): the sheet swaps body to `slipExpired`, "Tuma sasa" is hidden, only Hakiki/Futa remain — expired slips must pass through human eyes.~~
**[AMENDED per critique D3 — owner decision 2026-08-11: the reconnect prompt / 48h-expiry / discard-ritual state machine is CUT from v1.]** Replacement behavior: on the next Pokea open (online or offline), the draft **silently restores into the form** — supplier chip, lines, typed costs, notes all prefilled — and the manager simply reviews what is on screen and taps POKEA. Never auto-send (unchanged). No expiry state: `savedAt` is kept in the draft and may render as a quiet "iliyohifadhiwa {time}" line in the form header, but nothing gates on age — the server re-validates everything at post time, and the restored form *is* the human review. Discard is manual: clear the supplier chip and remove lines (or complete a different receive — success clears the draft). Same safety, one fewer state machine; the sheet ritual returns only if field feedback shows managers actually losing slips.

**Submit (`POKEA` or `Tuma sasa`):** POST body `{supplierId, idempotencyKey, notes?, lines:[{productId, quantity, unitCost? (only when >0)}]}` — existing DTO, charset-restricted key 16–64 (`^[A-Za-z0-9._:-]+$`). The idempotency key is generated **once per draft/form-session** and frozen in the draft; a retry after timeout reuses it so the server resumes the chain (`[MPL-PURCHASE:<key>]` marker, `findPurchaseByMarker`) instead of double-receiving. Key regenerates only after success or explicit discard. While in flight: slab gets `--aurora-glow-primary`, verb shows existing `recording`.

**Error handling:** connection-shaped failure (`isConnectionProblem`) → form and draft intact, calm note "network dropped, slip kept" (`slipSaved` copy doubles here), ribbon slip badge on. Server rejection → `shake` on the slab, mapped Swahili message via `posErrorMessage()` (supplier-invalid → `supplierNotAvailable`; non-stock/unknown product → generic fallback "Haikukubaliwa — mwite msimamizi" with raw English collapsed behind "Maelezo ya kiufundi"), form intact for editing. A rejected slip is never silently dropped.

**Success:** clear draft, regenerate nothing (fresh key next session), navigate to Risiti ya Mzigo, re-kick `syncCatalog` (existing behavior — availableStock just changed).

### 3.2 Risiti ya Mzigo (success — the MUHURI)

Summary card: supplier name, line count + `purchaseItems` list (qty × name, and buying price when it was typed), `TOTAL` cost in brass Display via `totalCostLabel`, `purchaseOrderNumber` + `grnNumber` (Label, secondary — office reference numbers). The brass seal **MZIGO UMEPOKELEWA** (`stampStockReceived`) slams on via the `pos-stamp` keyframe + one `--aurora-glow-accent` bloom + [30,40,30] stamp haptic. Always the *solid* seal — purchases are online-to-post, there is no queued variant. Below the card: existing `purchaseStockNote` ("Stoo na thamani vinasasishwa sasa; ankara inashughulikiwa na ofisi."). Slab: `MZIGO MPYA` → fresh Pokea. ~~Secondary text link to Historia.~~ **[CUT from v1 — owner decision 2026-08-11: no Historia to link to]** No share-receipt v1 (suppliers get office invoices; add only on field demand).

### 3.3 Historia (purchase history list) **[CUT from v1 — owner decision 2026-08-11]**

The manager's side of the Daftari: what has this branch received lately.

**Layout:** header with segment control (Historia selected); a hero strip — window total in brass Display + `purchaseHistoryDays` ("Siku 30 zilizopita") + count; then the list. Rows (56px+, tap → detail): supplier name (Body), `purchaseOrderNumber` + time `dd/MM HH:mm` (Label secondary), right-aligned amount as ink-on-brass-subtle chip, and a status affordance: nothing when COMPLETE (done is the default, don't decorate it), a **brass** `purchaseIncomplete` chip when INCOMPLETE (custody/attention, not red — no rep action can fix it; red is reserved for needs-a-person rejects, and this isn't one).

**States:**
- Loading: `.aurora-skeleton` rows.
- Empty: `purchaseHistoryEmpty`, duotone truck icon chip, calm.
- Fetch error: inline message + **Jaribu tena** button (`tryAgain`) — never leave-and-re-enter (Leo's retry rule).
- Offline: network-required, degrades honestly like Leo's my-sales — banner `needsNetwork` + `tryAgain`; if a slip badge exists, it still shows in the ribbon (the unsent slip is visible even when history isn't). No IDB snapshot v1 (managers check history in signal; a `snapshots` store is a pre-approved follow-up if field feedback demands — keep it out of the v4 migration now).

Fetch on tab select, pre-warmed on rail render of Manunuzi (same pre-warm rule as Stoo/Leo).

### 3.4 Historia detail **[CUT from v1 — owner decision 2026-08-11]**

Overlays the list (list stays mounted; back restores scroll). Content — all from the already-fetched list payload, **zero extra network calls** (see §5.2 design note):
- Header card: supplier name (Title), `poNumberLabel`: `purchaseOrderNumber`, `grnNumberLabel`: `grnNumber` (or "—" + `purchaseIncomplete` chip when null), date/time, recorded-by is omitted v1 (the endpoint is branch-scoped; adding names is a follow-up).
- Lines: qty × name @ unitCost (ink-on-brass-subtle) = lineTotal per row, unit symbol after qty.
- Footer: `totalCostLabel` in brass Display.
- INCOMPLETE state: brass banner explaining `purchaseIncomplete` — no retry button here (retries ride the original idempotency key from the client that owns it; a different device retrying blind could diverge — the office completes it from the desktop ERP).

---

## 4. Interactions summary (haptics + motion budget)

- Add line / qty change: 15ms tick.
- MUHURI: `pos-stamp` + glow-accent + [30,40,30]. Purchases never use the [80] held-stamp (no queued purchases exist, by design §9-13).
- Server reject: [60,40,60] + `shake` on slab.
- Draft saved (explicit `HIFADHI KIKARATASI`): 15ms tick only — saving a slip is routine custody, not a celebration.
- List mount: `.aurora-stagger` on first 12 rows.
- All via compiled Tailwind vocabulary; both reduced-motion kill-switches already apply.

---

## 5. Backend

### 5.1 Used as-is (no changes)

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /mobile-pos-lite/suppliers?search=` | `mobile_pos_lite.purchase` | ≥2 chars, branch/division-or-null scoped, take 20 (service 639–669) |
| `POST /mobile-pos-lite/purchases` | `mobile_pos_lite.purchase` | Full chain: DRAFT PO → confirm → GRN create → approve → post; `[MPL-PURCHASE:<key>]` notes-marker resume/replay + twin-detect (service 671–795). Cost fallback explicit → product default → family. Rejects non-stock items. Returns `{id, purchaseOrderNumber, grnNumber, totalAmount}` |
| `GET /mobile-pos-lite/session` | `mobile_pos_lite.use` | `purchasesEnabled` flag already present |

### 5.2 NEW: `GET /mobile-pos-lite/purchases` — purchase history **[CUT from v1 — owner decision 2026-08-11: endpoint not built; §5.1 is the module's entire backend surface]**

One endpoint, list-with-lines, no separate detail call. Rationale: branch purchase volume is small (a handful/day), lines are short, and a single bounded response lets the detail screen work with zero extra round trips on patchy networks. A `/purchases/:id` endpoint is explicitly rejected as needless surface.

**Route:** `GET /mobile-pos-lite/purchases?days=30` (same path as the POST — verbs disambiguate; Nest handles this fine).
**Permission:** `@RequirePermissions('mobile_pos_lite.purchase')` + terminal headers → `requireTerminal()` (inherits terminal-ACTIVE, assigned-user, company-WRITE, timing-safe secret — branch lock for free; the client never sends a branch or company id).

**Query DTO** (add to `dto/mobile-pos-lite-purchase.dto.ts`):
```ts
export class QueryMobilePosLitePurchasesDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90)
  days?: number; // default 30
}
```
(Numeric coercion is safe; the documented `@Type(() => String) @Transform` gotcha applies to booleans only — no boolean params here, deliberately.)

**Service query** (new `myPurchases()` in `MobilePosLiteService`, precedent `mySalesToday` at 580):
```
where: {
  companyId: terminal.companyId,
  branchId: terminal.branchId,
  purchaseType: 'STOCK_PURCHASE',
  deletedAt: null,
  notes: { contains: '[MPL-PURCHASE:' },   // POS-originated only
  orderDate: { gte: now - days },
}
orderBy: { createdAt: 'desc' }, take: 50
include: { lines: { include: { product: {select:{name:true}}, unit: {select:{symbol:true}} }, orderBy: {createdAt:'asc'} } }
```
Then one second query: `goodsReceivedNote.findMany({ where: { purchaseOrderId: { in: poIds }, deletedAt: null }, select: { purchaseOrderId, grnNumber, status } })` → map by PO id.

**Scoping decisions (deliberate, documented in the service docstring):**
- **Branch-scoped, not user-scoped** — receiving is a branch activity; the (usually one) manager sees the branch's whole POS receiving book, including a colleague's entries. This differs from `my-sales-today` (per-rep accountability) on purpose.
- **Marker-filtered** — desktop-ERP purchases at the branch are excluded; this screen is the POS book, the office sees everything in the ERP proper. The `notes contains` filter is unindexed but rides `@@index([companyId])`/`@@index([orderDate])` and a ≤90-day branch window — fine at this scale; do NOT widen company-wide.
- **INCOMPLETE surfaces honestly** — an interrupted chain leaves a marker-bearing PO not yet at RECEIVED/POSTED; hiding it would make stock movements unexplainable to the manager.

**Response shape** (all Prisma Decimals → `Number()`):
```jsonc
{
  "days": 30,
  "count": 14,
  "totalAmount": 1250000,            // sum of totalAmount over returned rows (incl. INCOMPLETE)
  "purchases": [{
    "id": "uuid",
    "purchaseOrderNumber": "PO-2026-0141",
    "grnNumber": "GRN-2026-0139",    // null when chain incomplete
    "supplierName": "Azam Distributors", // PO.supplierName snapshot, fallback supplier relation name
    "totalAmount": 480000,
    "status": "COMPLETE",            // COMPLETE = GRN exists with status POSTED; else INCOMPLETE
    "createdAt": "2026-08-11T09:14:00Z",
    "lines": [{
      "productId": "uuid",
      "name": "Embe Dodo",           // product.name (live join; PO line description as fallback)
      "quantity": 24,
      "unitSymbol": "pc",
      "unitCost": 1500,              // PurchaseOrderLine.unitCost — always set (resolved at create)
      "lineTotal": 36000
    }]
  }]
}
```
Cost fields are intentional here (manager gate — §1). Update `lastSeenAt` like the other device-facing reads do not — reads skip it; keep consistent with `mySalesToday` (no update there either).

**Controller addition** (mobile-pos-lite.controller.ts, next to the POST at line 140): standard `@Headers` pair + `@Query() query: QueryMobilePosLitePurchasesDto` + `@CurrentUser()`, delegating to `service.myPurchases(...)`.

**Tests (backend):** happy path with 2 POs (one complete, one stuck at CONFIRMED → INCOMPLETE/null grn); branch isolation (other-branch PO invisible); marker filter (desktop PO at same branch invisible); `days` clamp; Decimal→Number; permission 403 for `mobile_pos_lite.use`-only user.

---

## 6. IndexedDB / store changes (`frontend/src/lib/mobile-pos-lite-store.ts`)

DB `itemba-mobile-pos-lite` v3 → **v4**, purely additive `onupgradeneeded` (matches the design-direction v4 which also adds `stocks` for Stoo **and `daylog` for Leo — ONE shared migration creating all three stores** (spec-leo §3–4, critique A1/B1), shipped one release ahead, or guarded with create-if-missing as the store already does):

**New store `drafts`** — out-of-line keys, key `${terminalCode}:purchase` (the count draft will use `${terminalCode}:count`; one draft per module per terminal, enforced by the fixed key):
```ts
interface MobilePosLitePurchaseDraft {
  terminalCode: string;
  idempotencyKey: string;          // generated at draft creation, FROZEN until success/discard
  supplierId: string | null;
  supplierName: string | null;     // display snapshot for the chip
  lines: { productId: string; name: string; unitSymbol: string; quantity: number; unitCost?: number }[];
  notes?: string;
  savedAt: number;                 // epoch ms; refreshed on every edit-save (display only — the 48h expiry gate is CUT per critique D3)
}
```
New helpers: `readPurchaseDraft(terminalCode)`, `savePurchaseDraft(draft)`, `deletePurchaseDraft(terminalCode)` — same open-transact-close-in-`finally` pattern as every existing helper. No history snapshot store in v1 (§3.3).

**Untouched:** `outbox` (purchases never enter it — an offline purchase outbox is formally rejected: stale-`unitCost` replay is a valuation bug), `bindings`, `catalogs`, `sessions`, `frequents`. localStorage: nothing new.

---

## 7. i18n — exact new keys (`pos-i18n.ts`, both catalogs, Swahili written first)

Reused as-is: `supplier`, `supplierSearchPlaceholder`, `buyingPrice`, `purchaseItems`, `recording`, `purchaseComplete`, `purchaseStockNote`, `selectSupplierFirst`, `optional`, `sendNow`, `needsNetwork`, `back`, `change`. `recordPurchase` is superseded by `slabReceive` on the slab but stays for the transition.

| Key | sw | en |
|---|---|---|
| ~~`purchaseTabReceive`~~ | ~~Pokea~~ | ~~Receive~~ **[CUT from v1 — owner decision 2026-08-11: segment control gone with Historia]** |
| ~~`purchaseTabHistory`~~ | ~~Historia~~ | ~~History~~ **[CUT from v1 — owner decision 2026-08-11]** |
| ~~`purchaseHistoryTitle`~~ | ~~Historia ya Manunuzi~~ | ~~Purchase history~~ **[CUT from v1 — owner decision 2026-08-11]** |
| ~~`purchaseHistoryDays`~~ | ~~Siku {count} zilizopita~~ | ~~Last {count} days~~ **[CUT from v1 — owner decision 2026-08-11]** |
| ~~`purchaseHistoryEmpty`~~ | ~~Hakuna manunuzi bado. Mzigo wa kwanza utaonekana hapa.~~ | ~~No purchases yet. Your first delivery will appear here.~~ **[CUT from v1 — owner decision 2026-08-11]** |
| ~~`purchaseIncomplete`~~ | ~~Haijakamilika — itamaliziwa ofisini~~ | ~~Not finished — the office will complete it~~ **[CUT from v1 — owner decision 2026-08-11: only surfaced in Historia]** |
| ~~`purchaseDetailTitle`~~ | ~~Maelezo ya Mzigo~~ | ~~Delivery details~~ **[CUT from v1 — owner decision 2026-08-11]** |
| ~~`poNumberLabel`~~ | ~~Namba ya oda~~ | ~~Order number~~ **[CUT from v1 — owner decision 2026-08-11]** |
| ~~`grnNumberLabel`~~ | ~~Namba ya kupokea (GRN)~~ | ~~Goods received number (GRN)~~ **[CUT from v1 — owner decision 2026-08-11]** |
| `totalCostLabel` | JUMLA YA GHARAMA | TOTAL COST |
| `stampStockReceived` | MZIGO UMEPOKELEWA | STOCK RECEIVED |
| `slabReceive` | POKEA | RECEIVE |
| `slabNewDelivery` | MZIGO MPYA | NEW DELIVERY |
| `slabSaveSlip` | HIFADHI KIKARATASI | SAVE SLIP |
| `slipSaved` | Kikaratasi kimehifadhiwa kwenye simu hii. | Slip saved on this phone. |
| ~~`slipPromptTitle`~~ | ~~Una kikaratasi cha mzigo~~ | ~~You have a saved delivery slip~~ **[DEFERRED with the reconnect state machine — critique D3]** |
| ~~`slipPromptBody`~~ | ~~Mtandao umerudi. Tuma sasa?~~ | ~~The network is back. Send it now?~~ **[DEFERRED — critique D3]** |
| ~~`slipReview`~~ | ~~Hakiki kwanza~~ | ~~Review first~~ **[DEFERRED — critique D3]** |
| ~~`slipDiscard`~~ | ~~Futa kikaratasi~~ | ~~Discard slip~~ **[DEFERRED — critique D3]** |
| ~~`slipDiscardConfirm`~~ | ~~Kikaratasi kitafutwa kabisa. Endelea?~~ | ~~The slip will be deleted for good. Continue?~~ **[DEFERRED — critique D3]** |
| ~~`slipExpired`~~ | ~~Kikaratasi kimepitwa — hakiki kabla ya kutuma.~~ | ~~This slip is old — review it before sending.~~ **[DEFERRED — critique D3]** |
| `slipBadge` | Kikaratasi | Slip |
| `purchaseOfflineNote` | Hakuna mtandao — jaza fomu; kikaratasi kitahifadhiwa kwenye simu. | No network — fill the form; the slip will be saved on this phone. |
| `supplierNotAvailable` | Muuzaji huyu hapatikani kwa tawi hili — chagua mwingine. | This supplier is not available for this branch — choose another. |
| `tryAgain` | Jaribu tena | Try again |

~~25 new keys.~~ **[AMENDED 2026-08-11: 10 new keys after the cuts — 9 Historia keys CUT (incl. `purchaseTabReceive`), 6 slip-prompt keys DEFERRED with the D3 state machine. Active set: `totalCostLabel`, `stampStockReceived`, `slabReceive`, `slabNewDelivery`, `slabSaveSlip`, `slipSaved`, `slipBadge`, `purchaseOfflineNote`, `supplierNotAvailable`, `tryAgain`.]** `tryAgain` and `slipBadge` are shared vocabulary (Leo/Stoo/queue reuse them — define once here; `tryAgain` is THE one retry key app-wide per critique A4). `posErrorMessage()` gains one pattern: `/supplier is not available/i → supplierNotAvailable`.

---

## 8. Edge cases

1. **Timeout on POKEA / Tuma sasa** — response lost, chain may have completed server-side. Client keeps the draft (with its frozen key) and shows the connection-failure state; the next send resumes/replays via the marker and returns the same result. The key must NEVER regenerate on retry — only on success or discard.
2. **Double-tap POKEA / two concurrent sends** — client disables the slab while `busy`; server-side the twin-detect (service 754–772) handles the race anyway; a `ConflictException` ("being recorded by another request") maps to `tryAgain` copy.
3. **Supplier deactivated / rescoped between draft and send** — 400 → `supplierNotAvailable`, draft intact, supplier chip cleared for re-pick, lines untouched.
4. **Product turned non-stock or removed between draft and send** — whole purchase rejected (existing `resolvePurchaseLines` behavior); generic mapped error + collapsed raw text; manager deletes the offending line (rows are editable, so this is recoverable without office help).
5. **`unitCost` typed as 0 or cleared** — omitted from payload (existing `>0` rule); DTO min is 0.0001 so a zero must never be sent.
6. **48h-stale buying prices in a slip** — the expiry gate forces review; the server re-resolves fallback costs at post time for lines without explicit cost; explicit typed costs are the manager's own numbers and are sent as reviewed.
7. **`resetTerminal` / re-activation** — drafts are keyed by terminalCode and survive a binding reset; a revoked-then-replaced terminal with a new code orphans the old draft (harmless dead row; a lazy sweep of foreign-key drafts on boot is a one-liner, include it).
8. **History shows a colleague's purchase** — intended (branch book, §5.2); detail omits recorded-by v1 to avoid implying blame.
9. **INCOMPLETE row never completes** — office finishes it from the desktop ERP; the row flips to COMPLETE on next fetch. No client retry from history (the retry token lives with the originating client only).
10. **Decimal quantities** — schema supports 18,4 but POS `QuantityInput` is integer 1–9999; kept integer v1 (matches sales; loose produce is weighed at sale, not at receipt).
11. **Locale money** — `money()` (TZS, 0 decimals) everywhere; server may return decimal `unitCost` from fallback pricing — display rounds, `lineTotal`/`totalAmount` come from the server, never recomputed client-side for display math beyond the running form total (which is display-only; the server reprices).
12. **`popstate` × QR login** — `#manunuzi/*` hashes must survive the `?terminal=&code=` login redirect test matrix like every other hash (design §11 risk).
13. **Draft present but `purchasesEnabled` revoked** — no prompt fires (prompt is gated on the flag); draft stays inert in IDB.

---

## 9. Build-size estimates

| Piece | Size | Notes |
|---|---|---|
| Backend `GET /purchases` (DTO + service `myPurchases` + controller + e2e/unit tests) | **S** | Pure read, two queries, precedent-shaped (`mySalesToday`) |
| `posErrorMessage()` supplier pattern | **S** | One regex + key |
| IDB v4 `drafts` store + 3 helpers (+ orphan sweep) | **S** | Additive, existing pattern |
| Pokea reskin (slab integration, segment control, supplier chip, brass line chips, quick-pick reuse) | **M** | Mostly re-composition of extracted Phase-2 components |
| Kikaratasi lifecycle (auto-persist, explicit save, reconnect sheet, expiry gate, discard confirm, ribbon badge) | **M** | The one genuinely new state machine; ships in Phase 5 per rollout order |
| Risiti ya Mzigo + MUHURI wiring | **S** | Stamp/haptic primitives arrive from Phase 3; this is composition |
| Historia list + detail (fetch, states, retry, overlay detail) | **M** | One fetch, no snapshot store, skeleton/empty/error/offline states |
| i18n 25 keys ×2 | **S** | |

**Total: roughly 1 backend S + frontend 2M + 4S.** Sequencing per the rollout plan: history endpoint + Historia can ship any time after Phase 2 (pure additive read); kikaratasi is Phase 5 (last new state surface); until then Pokea's offline state is the current disabled-button plus the calm ribbon chip — never amber.