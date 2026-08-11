# Build Spec — Sales (Mauzo) Module: Mauzo → Malipo → Risiti + Offline Queue

Scope: the sale flow of Itemba POS rebuilt under the Kaunta direction. Covers the three sale screens, the sale-owned parts of the shared chrome (slab, ribbon, sync token), the offline sales queue surfaces (slab pill → Leo `#leo/foleni` pending section + rejected-sale ritual), haptics, and the platform prerequisites the sale flow rides on. Stoo/Hesabu/Manunuzi/Leo-proper/Mipangilio are separate module specs; their contracts with this module are stated where they touch.

All paths absolute under `C:\projects\Actual Projects\itemba-r\`. Verified against Ground 1–3 (main @ 76597c47).

---

## 0. Prerequisite platform pieces (this module's foundation — Phases 0–2)

These are not screens but the sale flow cannot ship without them. Each is a separate PR.

### 0.1 Phase 0 — characterization tests (M)
Jest/RTL tests against the current `mobile-pos-lite.tsx` BEFORE any refactor, locking the load-bearing quirks:
1. Cart survives into success; receipt text built from it; resets only on `beginSale`.
2. Sync loop: connection error ⇒ `break` (order preserved); server rejection ⇒ `updatePendingMobilePosLiteSaleError` + continue.
3. Frequency bump fires on queued sales too (before outcome).
4. Offline cold start: session restored from IDB `sessions`, catalog from `catalogs`, queue rendered; `online` event triggers session+catalog refetch.
5. Queued payload is frozen (idempotencyKey inside payload; replay posts identical bytes).
6. Queue eligibility gate: exactly `paymentMethod==='CASH' && terminal.offlineCashEnabled && isConnectionProblem(error)`.

### 0.2 Phase 1 — identity shell (M)
- `.pos-shell` wrapper class in `frontend/src/styles/globals.css`: full `--aurora-*` override table from the design direction §2.1, both Mchana (default) and Usiku, keyed off `itemba-pos-theme` (POS-local, `safeLocalStorage*`, forced default `mchana` regardless of `aurora-theme`/system). Applied to the POS `<main>` — zero markup changes elsewhere (all POS color already resolves through inline `var(--aurora-*)`).
- Delete the Google Fonts `@import` at `globals.css:1`; self-host Inter via `next/font/local` under `/_next/static/` (SW-cached prefix).
- `frontend/src/app/(dashboard)/mobile-pos/page.tsx`: add `viewport` export with `viewportFit:'cover'`; media-paired `themeColor` `#FAF7F0`/`#0B1B2B`.
- `frontend/src/app/westsides-mobile-pos.webmanifest/route.ts`: `theme_color`/`background_color` `#FAF7F0` (kill orphan teal `#0f766e`), shortcuts `Mauzo Mapya` (`/mobile-pos`) + `Stoo`; maskable brass-stamp icon under `/brand/` (non-blocking follow-up).
- `frontend/tailwind.config.ts`: one new keyframe `pos-stamp` (scale 1.6→1, rotate −6°→−3°, 250ms `ease-aurora`). Nothing else.

### 0.3 Phase 2 — structure (L)
Hooks-first extraction of the 1949-line `mobile-pos-lite.tsx`, UI pixel-identical, shipped before any reskin:
- `hooks/use-pos-bootstrap.ts` — binding read, session fetch, offline-cold-start restore, `sessionFromCacheRef`, online-return refetch.
- `hooks/use-pos-outbox.ts` — `syncPendingSales` engine, `syncingRef` re-entrancy lock, pending list, sync triggers (mount / `online` / manual).
- `hooks/use-pos-cart.ts` — cart map, `total`, `cartCount`, add/inc/dec/setQty/remove, frequents bump.
- `pos-lang-provider.tsx` — wraps `usePosLang()` in context (multi-component split desyncs per-hook instances otherwise; noted in Ground 1 §6).
- Per-screen components under `screens/`; extract `money()`, `newIdempotencyKey()`, `terminalHeaders()`, `isConnectionProblem()`, `mergeProducts()`, `pendingTime()`, `QuantityInput` into `pos-lib.ts` / `quantity-input.tsx`.
- `pos-router.ts` — **[AMENDED 2026-08-11 — critique A3: hash-only routing is MANDATED.]** `history.pushState`/`popstate` pseudo-routing inside the single `/mobile-pos` mount, mutating **only `location.hash`** — never the pathname. Rationale (verified): the SW navigate allowlist is an exact-path Set (`frontend/public/mobile-pos-sw.js:2,21` — `POS_ROUTES.has(url.pathname)`), so a path-shaped pushState (`/mobile-pos/malipo`) dead-ends every offline reload/PWA relaunch and 404s an online hard refresh (no such Next route). Hashes are never sent to the server and never reach the SW match — `/mobile-pos` stays the only navigate URL.
  - **The hash map (exhaustive; this is the app-wide contract, all module specs conform):** `#mauzo` (default/root — empty, missing, or unknown hash normalizes here via `replaceState`), `#malipo`, `#risiti`, `#leo`, `#leo/foleni` (Leo scrolled to the pending group — the slab sync token's deep link), `#stoo`, `#hesabu`, `#manunuzi` (+ `#manunuzi/risiti`, spec-purchases §2), `#mipangilio`.
  - **Cold-boot hash contract:** after bootstrap (binding read, session restore), the boot sequence reads `location.hash` and opens that screen — this is how deep links work (manifest `shortcuts` are deferred per critique D5, but the contract exists now, so adding them later is a manifest-only change). Module-level hashes (`#mauzo`, `#leo`, `#leo/foleni`, `#stoo`, `#manunuzi`, `#mipangilio`) are honored, gated ones only when the session flag permits (else normalize to `#mauzo`). Flow-interior hashes whose state is memory-only normalize to their parent: `#malipo`/`#risiti` → `#mauzo` (cart doesn't survive a cold boot), `#hesabu` → `#stoo` (the count draft survives in IDB, but entry must pass the resume-draft offer and the queue gate — spec-inventory §3).
  - Explicit back-map: Malipo→Mauzo (cart intact); **Risiti→Mauzo fresh, never re-pops Malipo** (replaceState on entering Risiti); Hesabu→Stoo (draft persists); Leo/Stoo/Manunuzi/Mipangilio→Mauzo; Mauzo→PWA exit (no pushState at root). Test matrix: `popstate` × QR `?terminal=&code=` login redirect on real Android gesture-nav (`?query` and `#hash` must coexist through `/login?from=`). SW allowlist, middleware, providers, `isPosOnlyUser` redirect untouched.
- `pos-haptics.ts` (~10 lines): `navigator.vibrate` wrapper, gated by `itemba-pos-haptics` (default on). Patterns: `tick` 15ms; `stampSent` [30,40,30]; `stampHeld` [80]; `reject` [60,40,60]. Nothing else vibrates.

---

## 1. Shared chrome (sale-flow contract)

### 1.1 Module rail (top, 44px) — S
`Mauzo · Stoo · Leo` + `Manunuzi` when `session.purchasesEnabled`; header gear → Mipangilio. Duotone rounded-square Lucide icon chips + one Swahili word (Label 14/18/600): cart=Mauzo, box=Stoo, book=Leo, truck=Manunuzi. Active tab: `--aurora-primary-subtle` chip. Fixed positions — never reflow.

### 1.2 Kaunta Slab (bottom, 64px + `env(safe-area-inset-bottom)`) — M
Present on every screen. Anatomy, left→right:
- **Sync token** (left edge, min 44×44 tap target): green check glyph when outbox empty and online; **counted brass pill** (`--aurora-accent-subtle` bg, `--aurora-accent-text` number, `pulse-subtle`) showing queue count when >0; grey wifi-slash when offline. Tap → navigate `#leo/foleni`. Never a bare dot.
- **Money display** (brass, `.aurora-display` 40px tabular): cart total on Mauzo (150ms count-up tick per add), Chenji on Malipo, JUMLA on Risiti.
- **Primary verb** (blue `brand-600`, Title 22/700, fills remaining width): LIPA → KAMILISHA MAUZO → MAUZO MAPYA. Exactly one primary verb per screen; disabled state = `--aurora-text-disabled` on `--aurora-bg-subtle`, never hidden.
- In-flight: `--aurora-glow-primary` on the slab (one of the two glow budget moments), verb swaps to spinner + `completing`.
- **Keyboard rule:** any focused text input collapses the slab to a 28px strip (sync token + verb text only, no money); restores on blur.

### 1.3 Status ribbon (top, fixed, only when non-clean) — S
- Offline: grey chip, wifi-slash icon + `ribbonOffline` — calm grey, **not amber** (offline is weather).
- Flushing: brass `ribbonSending` while `use-pos-outbox` is posting.
- (Slip badge for drafts is Manunuzi/Hesabu scope.)
Amber appears in this app only as genuine inline cautions (Malipo "Bado"; disabled-method notice), icon+text chips, never for routine offline/pending.

### 1.4 Four-color law (review gate on every PR)
Brass = money/custody (all TZS numerals, queue tokens, stamps). Blue = press me. Green = arrived/confirmed. Red = server-rejected only. Brass text only at Title 22px+ or as `--aurora-accent-text` on `--aurora-accent-subtle` chips; Label-size money = ink on brass-subtle chip. Light brass is `#B45309`, not `#D97706`.

---

## 2. Screen: Mauzo (sale builder) — boot root — M

### Layout (top→bottom)
1. Module rail.
2. Status ribbon (conditional).
3. Search input (`.aurora-input`, 56px, autoFocus **off** on boot to avoid keyboard-collapsing the slab at open; focuses on tap; keyboard-wedge scans land here as today; min 2 chars; placeholder `productSearchPlaceholder`).
4. **Quick-pick grid** (query empty): 2-col, tiles ≥104px, `.aurora-stagger` mount (first 12, 50ms). Tile anatomy: 64px photo (top, `object-cover`, lazy, `/api/backend${imageUrl}`), brass **price** in Title 22 (`.aurora-money`), name in Body 17/500 2-line clamp, ink, visually subordinate (hierarchy: picture → number → word). Photo `onError`/offline → **designed brass initial-letter tile** (first letter of name, brass-700 on `--aurora-accent-subtle`, radius `--aurora-radius`) — formalizes the existing `onError` path.
5. Search results (query ≥2): rows 56px — name (Body), code, `Stock {n}` when `availableStock !== null`, price (brass chip, Label money rule). Local filter (name/code/barcode, ≤12) merged with 220ms-debounced remote `GET /products?search=` (online only), `mergeProducts` id-keyed remote-wins, cap 12. Unchanged logic.
6. Slab: sync token · cart total (0 hidden until first add) · **LIPA** (disabled when cart empty) · cart-count chip on the verb's left shoulder (opens tray).

### Counter tray (bottom sheet) — part of this screen
Opens from the slab count chip; `slide-up`. Lines: photo/initial tile 44px, name Body, − / `QuantityInput` (reused verbatim: select-on-focus, commit blur/Enter, clamp 1–9999, empty/0 restores previous) / + (48px steppers), trash. Line total ink on brass-subtle chip. Tray footer repeats JUMLA. **First add of a session auto-peeks the tray** ~1.2s then retracts (**once per app session** — ~~once per mount~~ **[AMENDED 2026-08-11 — critique C8: "per mount" would re-peek on every screen return; a module-scoped `hasPeekedRef` lives for the app session, teaching the tray exactly once per boot]**; no copy needed). Empty state (tray opened with empty cart): `trayEmpty`.

### Interactions
- Tap tile/row: add-or-increment, clear query, `scale-pop` on tile, `tick` haptic, slab total count-up.
- Barcode: keyboard-wedge into search input (unchanged; no camera).
- Frequents: local IDB counter, bumped on completed **or queued** sale (unchanged).

### States
- **Empty catalog** (fresh terminal, no sync yet): grid falls back to first catalog items; if catalog empty entirely → centered notice `typeTwoOrScan` + catalog re-sync attempt on `online`.
- **Offline:** grid renders from cached catalog with initial-letter tiles; remote search silently skipped (local only); ribbon shows `ribbonOffline`; everything else identical.
- **Search no match:** `noMatch` row.
- **Error:** search fetch failure is silent (local results stand) — no toast, per current behavior.

### Edge cases
- Adding while tray open updates line in place (no re-peek).
- `cancelSale` action lives in the tray header (secondary, text button) — clears cart, stays on Mauzo.
- Android back on Mauzo exits the PWA (root; no pushState entry).

---

## 3. Screen: Malipo (payment) — forward nav (`slide-in-right`) — M

### Layout
1. Rail hidden (focused flow) — back chevron + `payment` title (Title 22) + items count.
2. **Method grid**: 2-col duotone tiles from `session.paymentMethods`, ≥64px, fixed mnemonic icons (banknote=CASH/Fedha, phone=MOBILE_MONEY/Simu, building=BANK_TRANSFER/Benki, notebook=CREDIT/Daftari). **CASH pre-selected on entry** (the modal case — one fewer tap). Selected tile: `--aurora-primary` border + subtle bg. Offline: non-CASH tiles disabled with grey wifi-slash glyph overlay + `methodUnavailableOffline` micro-label (teaching why through iconography); if terminal lacks `offlineCashEnabled`, CASH also carries the amber inline caution `cashOnlyOffline` (existing key) — this is a genuine caution, amber allowed.
3. **CREDIT selected** ⇒ mandatory customer block: 220ms-debounced `GET /customers?search=` (≥2 chars, online only); result rows 56px; selection collapses to **green chip** (name + `change` action). CREDIT + offline: tile disabled like the others.
4. **CASH selected** ⇒ **change calculator (the hero)**:
   - `received` input (digits only, ≤10, `inputMode=numeric`) — while focused the slab collapses per keyboard rule.
   - Denomination chips: `exactAmount` (⌈total⌉) + `[5000,10000,20000,50000]` filtered `>= total`, first 3 (unchanged).
   - Result card, `--aurora-accent-subtle`, full-width: **Chenji in 40px brass Display** (`.aurora-display .aurora-money`) — sized so the rep turns the phone to show the customer. Underpaid: amber icon+text chip `stillOwed` ("Bado") + amount in ink — the one amber caution in the flow.
5. `requiresReference` methods ⇒ optional reference field (`reference` / `optional` / `referencePlaceholder`, existing keys).
6. Slab: sync token · Chenji (or total when no received amount) · **KAMILISHA MAUZO**.

### Interactions / completeSale (logic unchanged, invariants hard)
Guards: CREDIT without customer ⇒ `shake` on customer block + inline `selectCreditCustomer`; offline non-CASH ⇒ unreachable (tiles disabled). Payload `{paymentMethod, customerId?, paymentReference?, idempotencyKey (uuid sans dashes), lines:[{productId, quantity}]}` — **no prices** (server-authoritative). Frequency bump before outcome. `POST /mobile-pos-lite/sales` with terminal headers. Failure routing:
- Queueable (`CASH && offlineCashEnabled && isConnectionProblem`) ⇒ `PendingMobilePosLiteSale` (own uuid, frozen payload, display snapshot) → IDB outbox → proceed to Risiti in **held** state.
- Any other error ⇒ stay on Malipo, `shake` the slab verb, inline notice = `posErrorMessage(raw)` (see §7.3) — never a bare toast, never raw English as the primary line.

### States
- Offline: banner-free (ribbon covers it); CASH-only interaction as above.
- Customer search: empty→`typeTwoLetters`; no results→`noMatch`; fetch failure→silent (search yields nothing; retry by retyping).
- In-flight: slab glow-primary, verb → `completing`, all inputs disabled.

### Edge cases
- Back (chevron or Android back) → Mauzo with cart intact.
- Switching method clears method-specific state (customer chip kept if switching back to CREDIT within the session; receivedValue kept for CASH).
- Received amount is display-only — never sent to the server.
- Double-tap on KAMILISHA: `busy` guard (existing) — single submit.

---

## 4. Screen: Risiti (success — the MUHURI moment) — M

### Layout
1. Summary card (`--aurora-card`, radius-xl): line items (`qty x name`), JUMLA in brass Display, payment method chip, `salesOrderNumber` when present (absent for queued sales).
2. **The stamp**, slammed onto the card top-right at ~−3° via `pos-stamp` keyframe + one `--aurora-glow-accent` bloom (the second glow budget moment), fired on **local commit** (never waits on network):
   - Sent: **solid brass seal `stampImelipwa` (IMELIPWA)** + small green check; haptic `stampSent` [30,40,30].
   - Queued: **hollow brass seal `stampImehifadhiwa` (IMEHIFADHIWA)** + custody copy `custodyNote` in Body ink — brass custody styling, **never warning-amber**; haptic `stampHeld` [80] (distinct palm signature).
3. Slab: sync token (now showing the new count if queued) · JUMLA · **MAUZO MAPYA**, with **SHIRIKI RISITI** as a secondary button directly above the slab.

### Receipt share (logic unchanged)
Plain text: new header line `— KAUNTA YA ITEMBA —`, then company, branch, `toLocaleString('en-GB')` timestamp **[DELIBERATE — critique C8 decision 2026-08-11: the receipt keeps en-GB `dd/MM/yyyy, HH:mm` in both languages — it is the date shape Tanzanian paper receipts already use, numerals are language-neutral, and a receipt is a document that outlives the phone's language setting]**, order/receipt no., `qty x name = TZS…` lines, `JUMLA`, payment label, `receiptThanks`. `navigator.share` (user-dismiss rejection swallowed) else clipboard + `receiptCopied` toast.

### Invariants and edge cases
- **Cart survives into this screen** (receipt source) — resets only on MAUZO MAPYA (`beginSale`). Characterization test #1 guards this.
- History: entering Risiti **replaces** the Malipo entry — back from Risiti → Mauzo fresh (also runs `beginSale`), never re-pops Malipo.
- If the queued sale syncs while Risiti is open, the stamp does **not** morph (avoid mid-glance change); the slab pill count updates — that is the live truth channel.
- Reduced motion (`prefers-reduced-motion` / `html.motion-reduced`): stamp appears without animation (both kill-switches already global); haptics unaffected (separate toggle).

---

## 5. Offline queue surfaces (Foleni) — M

The standalone queue screen is deleted. Queue truth lives in exactly two places:

### 5.1 Slab sync token (every screen) — spec in §1.2
The sync-legibility law: every unsent sale is one counted brass token in one fixed place, three states — brass (safe with you) · in-flight (glow-primary) · red never on the token itself (red lives on the rows). Tap → `#leo/foleni`.

### 5.2 Leo `#leo/foleni` pending section (shared surface with the Leo spec — spec-leo §1 hosts it; sale-queue behavior owned here)
- **"Tuma Sasa"** button atop the pending group (existing `sendNow` key; disabled offline/while syncing, spinner while flushing).
- Queued rows inline in the day list: **brass left edge**, amount (ink on brass-subtle), line summary, dd/MM hh:mm, `queueWaiting` label. Sync semantics untouched: break on connection error (order preserved), flag-and-continue on rejection.
- Rejected rows: **red left edge**, `queueFailed` label.

### 5.3 Rejected-sale ritual (tap a red row)
Full-screen sheet:
1. Line-by-line inspection of the frozen payload (name resolved from cached catalog by productId; fallback to productId), qty, snapshot total, method, captured time.
2. Plain-Swahili mapped error via `posErrorMessage()` (§7.3); raw English server text collapsed behind a `technicalDetails` disclosure (for supervisors).
3. Exactly two big buttons (64px): **`retryThisSale` (Jaribu tena)** — re-posts this single item (same frozen payload/idempotency key; success removes it, connection error returns to waiting state, rejection updates `lastError`); **`callSupervisor` (Mwite msimamizi)** — informational, closes the sheet.
4. **Remove** stays honor-system two-step (existing `removeConfirmTitle/Body`, `confirmRemove`, `keepIt` keys; soft supervisor language, no permission check, no typed-amount) — hard-deletes from outbox; `reject` haptic on confirm. Server-side tombstone report is flagged to the audit track, not built here.

### 5.4 Degradation
Offline, Leo still shows the full queue from IDB (the book never looks empty). Sales queue needs no network to render — only to flush.

---

## 6. i18n — exact new keys (`pos-i18n.ts`, both catalogs, Swahili written first)

Reuse existing keys wherever they exist (do NOT duplicate): `pay, completeSale, completing, saleComplete, savedOffline, shareReceipt, receiptCopied, receiptThanks, totalLabel (JUMLA), changeDue (Chenji), stillOwed (Bado), received, exactAmount, reference, optional, referencePlaceholder, customer, change, customerSearchPlaceholder, typeTwoLetters, selectCreditCustomer, cashOnlyOffline, productSearchPlaceholder, typeTwoOrScan, noMatch, stock, cancelSale, queueWaiting, queueFailed, sendNow, remove, removeConfirmTitle, removeConfirmBody, confirmRemove, keepIt, back, offline, online, couldNotComplete, needsNetwork`.

New keys (sale-flow set, ~26):

| key | sw | en |
|---|---|---|
| `railMauzo` | Mauzo | Sales |
| `railStoo` | Stoo | Stock |
| `railLeo` | Leo | Today |
| `railManunuzi` | Manunuzi | Purchases |
| `slabLipa` | LIPA | PAY |
| `slabKamilisha` | KAMILISHA MAUZO | COMPLETE SALE |
| `slabMauzoMapya` | MAUZO MAPYA | NEW SALE |
| `slabShirikiRisiti` | SHIRIKI RISITI | SHARE RECEIPT |
| `stampImelipwa` | IMELIPWA | PAID |
| `stampImehifadhiwa` | IMEHIFADHIWA | HELD ON PHONE |
| `custodyNote` | Imeandikwa kwenye daftari — itatumwa mtandao ukirudi | Written in the day book — it will be sent when the network returns |
| `receiptBrand` | — KAUNTA YA ITEMBA — | — KAUNTA YA ITEMBA — |
| `ribbonOffline` | Hakuna mtandao — mauzo ya pesa taslimu tu | No network — cash sales only |
| `ribbonSending` | Inatuma… | Sending… |
| `syncCleanAria` | Yote yametumwa | All sent |
| `syncQueuedAria` | Mauzo {count} yanasubiri mtandao | {count} sales waiting for network |
| `trayTitle` | Kwenye kaunta | On the counter |
| `trayEmpty` | Hakuna bidhaa bado — gusa picha kuongeza | Nothing yet — tap a product to add it |
| `methodUnavailableOffline` | Haipatikani bila mtandao | Needs network |
| `retryThisSale` | Jaribu tena | Try again |
| `callSupervisor` | Mwite msimamizi | Call a supervisor |
| `technicalDetails` | Maelezo ya kiufundi | Technical details |
| `errorFallback` | Haikukubaliwa — mwite msimamizi | Not accepted — call a supervisor |
| `errCreditLimit` | Mteja amefikia kikomo cha mkopo | Customer has reached their credit limit |
| `errCustomerInvalid` | Mteja huyu hakubaliki kwa mkopo hapa | This customer cannot buy on credit here |
| `errAlreadySent` | Mauzo haya yameshatumwa | This sale was already sent |

Aria labels currently hard-coded inline (lang toggle) migrate into the catalog opportunistically; not blocking.

`posErrorMessage(raw: string): PosStringKey` in `pos-i18n.ts`: best-effort case-insensitive pattern map over server free text — `/credit limit/ → errCreditLimit`, `/customer/ → errCustomerInvalid`, `/idempoten|duplicate/ → errAlreadySent`, `/terminal|suspend/ → terminalUnavailable` (existing) — generic fallback `errorFallback`. Acknowledged best-effort; real error codes are an audit-track ask, not a blocker.

---

## 7. Backend endpoints

**No new endpoints for this module.** Used as-is (all via `/api/backend` proxy + terminal headers `x-mobile-pos-terminal`/`x-mobile-pos-device`; controller `backend/src/modules/mobile-pos-lite/mobile-pos-lite.controller.ts`):

| Verb/path | Permission | Used by | Response (unchanged) |
|---|---|---|---|
| `GET /mobile-pos-lite/session` | `mobile_pos_lite.use` | boot, online-return refresh | terminal config, `purchasesEnabled`, `paymentMethods[{code,label,requiresReference}]`, rep, generalCustomer |
| `GET /mobile-pos-lite/catalog` | `.use` | boot sync → IDB `catalogs` | product array (priced-only, take 1500) |
| `GET /mobile-pos-lite/products?search=` | `.use` | Mauzo remote search | same shape, take 12 |
| `GET /mobile-pos-lite/customers?search=` | `.use` | Malipo CREDIT picker | `[]` unless `creditEnabled` |
| `POST /mobile-pos-lite/sales` | `.use` | KAMILISHA + queue flush + single-row retry | full serialized SalesOrder; DB-level idempotency replay on `idempotencyKey` |
| `GET /mobile-pos-lite/my-sales-today` | `.use` | Leo (contract only here) | `{count, totalAmount, sales[]}` |

Backend work items in the design direction (stock endpoint, stock-counts, permission seed) belong to the Stoo/Hesabu specs — none block this module. API contract stays backward-compatible throughout the reskin (SW update lag: old cached shells must keep working).

---

## 8. IndexedDB / storage changes

**No schema change for this module.** DB `itemba-mobile-pos-lite` stays at v3 for the sale flow; the v3→v4 bump (`stocks`, `drafts`) ships with Stoo/Hesabu (Phases 4–5). **[AMENDED 2026-08-11 — critique A1/B1: the v4 bump is ONE migration creating `stocks` + `drafts` + `daylog` (spec-leo §3–4), and it ships one release ahead of Phase 3 because Leo's day log needs `daylog` then; the sale-flow success path gains exactly one call, `bumpDaylogTally()`, at the MUHURI local-commit moment (Phase 3). Schema ownership stays with the other specs.]** Unchanged: `bindings`, `catalogs`, `outbox` (`PendingMobilePosLiteSale` shape frozen), `sessions`, `frequents`; `frontend/src/lib/mobile-pos-lite-store.ts` untouched by this module.

New localStorage keys (both via `safeLocalStorageSet`, alongside `itemba-pos-lang`):
- `itemba-pos-theme` — `'mchana' | 'usiku'`, default `'mchana'` (forced, ignores system theme).
- `itemba-pos-haptics` — `'on' | 'off'`, default on.

---

## 9. Permission gates

- Everything in this module: `mobile_pos_lite.use` (+ terminal binding via `requireTerminal`: ACTIVE terminal, assigned user, company WRITE, timing-safe device-secret match). POS-only users (`isPosOnlyUser`) remain hard-redirected to `/mobile-pos` — untouched.
- CREDIT method: `terminal.creditEnabled` (server; tile only appears when session sends it).
- Offline queueing: `terminal.offlineCashEnabled` + CASH + connection-shaped failure — the exact triple, no widening.
- `Manunuzi` rail tab: `session.purchasesEnabled` (render gate only; module itself out of scope).
- Queue removal: honor-system, no permission check (deliberate — Rejected call #9).

---

## 10. Edge cases (master checklist for QA)

1. Offline cold start: cached session + catalog + queue render; brass initial tiles; ribbon grey; on `online` return, session/catalog refetch applies suspensions/method changes.
2. Terminal suspended mid-session: next session refetch fails non-connection ⇒ spinner screen + `terminalUnavailable` + "set up again" (clears binding only) — unchanged.
3. Queued-sale replay after lost response: frozen payload idempotency key ⇒ server replays, no double-post.
4. `popstate` after QR login redirect (`?terminal=&code=` preserved through `/login?from=`) on Android gesture-nav — explicit device test.
5. Keyboard open on 5-inch screen: slab at 28px strip; change-calculator card still visible above keyboard.
6. `QuantityInput`: empty/0 restores previous; removal only via trash; clamp 1–9999.
7. Received-amount chips when total > 50,000: only Exact chip renders (filter yields none) — acceptable, verified behavior.
8. Share sheet dismissed: rejection swallowed, no error UI.
9. Sync while on Risiti: stamp static, slab pill live.
10. Haptic motor variance on cheap Androids: patterns short; toggle discoverable in Mipangilio.
11. Reduced-motion users: stamp/count-up/stagger all killed by existing global switches; app fully usable.
12. Dark-bridge hazard: all new markup stays on `var(--aurora-*)` or `brand-*` (not remapped) — no raw Tailwind palette classes (the `.dark !important` bridge would recolor them).
13. Fonts: first load must be online (no SW precache — unchanged); Inter self-hosted under SW-cached `/_next/static/`.
14. Old SW-cached shell during rollout: hits the same API contract successfully until its next update.

---

## 11. Build-size estimates (per shippable piece)

| # | Piece (PR) | Phase | Size |
|---|---|---|---|
| 1 | Characterization tests (6 behaviors) | 0 | **M** |
| 2 | `.pos-shell` both themes + Inter self-host + viewport/themeColor/manifest | 1 | **M** |
| 3 | Hooks extraction + screen split + lang provider (UI identical) | 2 | **L** |
| 4 | Hash router (hash-only mandate + cold-boot contract, §0.3) + back-map + Android/QR test matrix | 2 | **M** |
| 5 | Module rail + Kaunta Slab + sync token pill + status ribbon | 2 | **M** |
| 6 | Mauzo reskin: tiles, stagger, counter tray, auto-peek, brass initial tiles | 2 | **M** |
| 7 | Malipo reskin: method tiles, CASH pre-select, Chenji hero card | 2 | **M** |
| 8 | Risiti + MUHURI (`pos-stamp` keyframe) + `pos-haptics.ts` + receipt header | 3 | **M** |
| 9 | Foleni merge into Leo pending section + Tuma Sasa (queue side only) | 3 | **S** (rides Leo spec's screen) |
| 10 | Rejected-sale ritual sheet + `posErrorMessage()` map + new i18n keys | 3 | **M** |

Total: roughly 1 L + 8 M + 1 S across Phases 0–3; no backend work; no IDB migration; one Tailwind keyframe; one globals.css block.