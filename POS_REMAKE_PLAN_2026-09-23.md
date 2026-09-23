# POS remake plan — 23 September 2026

## 1. What we are building and why

A new point-of-sale app that replaces both POS shells in use today: the classic shell (`uiVersion 1`) and Kaunta (`uiVersion 2`). Owner direction, 23 September 2026:

| Decision | Answer |
|---|---|
| Why remake | Kaunta doesn't fit ITEMBA OS; its visual design (brass ledger, MUHURI stamp, warm paper) is not wanted; reps need to be able to **edit prices** |
| Depth | **Frontend remake.** The proven POS backend stays. The one exception is price editing, which needs a small, controlled backend addition (§5) |
| Placement | **One codebase, two hosts:** a standalone full-screen app for locked POS-only reps (`/mobile-pos`) and a registered ITEMBA OS app for managers |
| Devices | Android phones, counter tablets, desktop/laptop tills, receipt printers and barcode scanners |

Kaunta's first pilot day (15 August: 10 sales, TZS 1,875,500, zero errors) shows the backend and offline model work. This remake changes how the POS looks, where it lives and what it can do. It does not change how sales are recorded.

## 2. Non-negotiables carried over

These were learned in production or in adversarial review. Every phase must keep them, and each has a test that must stay green.

1. **Server truth for money.** The server computes totals, VAT and posting. The client never posts a journal.
2. **Idempotency.** A key is minted per document, **persisted with the draft**, frozen from the first send until a 2xx or an explicit discard, and never released by an edit. A replay is verified as identical on the server (409 on mismatch).
3. **Never destroy work on a downstream failure.** A queued or rejected sale stays visible and resumable. Error classification may choose the wording, never whether the work is destroyed.
4. **A load-bearing write that fails blocks the action.** No screen claims custody it doesn't have.
5. **Company-scoped unique indexes** decide create races, not read-then-write checks.
6. **One clock** for capture age (`capturedAgoMs`) and **one business-day timezone** for both ends.
7. **Cost-blindness is structural.** POS reads use explicit `select`s and never `include`. No buying cost, margin or average cost ever reaches a rep's screen, including in error messages (this matters for price editing, §5).
8. **Offline cash selling works from a cold start.** A bound terminal with a cached session must reach the till with no network. *Broken by the OS checkpoint and fixed in Phase 0 (§3).*
9. Owner rulings still in force: purchases are for managers only; integer counting; **no camera scanning** (hardware scanners are fine, see §6); Swahili-first copy with an English toggle.

## 3. Prerequisites (before any new UI)

| # | Item | Why |
|---|---|---|
| P1 | **Fix the offline cold-start regression.** In `mobile-pos-lite.tsx:48-49,76,568`, `hasPermission('mobile_pos_lite.use')` is false when `authOffline && !user`, so the POS shows Access Restricted and never reaches the IndexedDB session fallback. Allow the POS in that state and let the terminal binding plus the cached session decide. | Breaks invariant 8. Introduced in `4a155f19`; it is not in production. |
| P2 | **Repair the POS test fixtures.** Every Kaunta suite mocks `useAuth` as `{ logout }` only, so about 200 tests crash on render. Add `hasPermission`, `loading` and `authOffline`, plus an offline cold-start test at the `MobilePosLite` level, not only at the gate. | The characterization suite is our safety net for the remake. |
| P3 | **Decide the base branch.** The remake depends on the OS shell, which exists only on `itemba-os`. Either (a) land `itemba-os` on `main` first, or (b) build the POS on `itemba-os` and ship them together. **Recommend (a)**, even if the OS stays behind a flag, so the POS work isn't blocked on the OS release decision. | Avoids two very large unmerged branches. |
| P4 | **Fix the OS named-container gap.** Feature CSS uses `@container os-workspace`, which is only defined on the split pane the live `DesktopShell` never renders. As a result, apps inside windows fall back to viewport `@media` rules. | The POS layout (§4) must respond to its window's width, not the screen's. |

### Phase 0 status (23 September 2026, branch `itemba-os`)

| Item | Status |
|---|---|
| P1 offline cold start | **Fixed.** `mobile-pos-lite.tsx` grants the POS when `!user && authOffline`. New `mobile-pos-lite.offline-auth.test.tsx` fails against the old code and passes now; it also pins that a signed-in user without `.use`, and a signed-out user with the server reachable, are still refused. |
| P2 test fixtures | **Fixed.** The `useAuth` mock line was updated in all 8 POS suites (no assertion changed, characterization suite included): 16 files / 306 tests green. Also fixed four other stale fixtures from the phase 5 sweep (notifications, scheduled reports, Westsides reports, quotation print). |
| P3 base branch | **Owner chose option 1: add a switch, then land on `main`.** The switch `NEXT_PUBLIC_ITEMBA_OS_ENABLED` (build-time, off unless exactly `"true"`) is added. Off gives back the pre-OS sidebar/topbar shell, the original sign-in page, `/` → `/dashboard`, and the Fuel Grid sidebar row; `/desktop` and `/apps` redirect to `/dashboard`. It is plumbed through the frontend Dockerfile, both compose files and the env examples (default `false`); tests and local dev run with it on. Pages, APIs, migrations and the POS are not switched, so they ship either way. Merging to `main` is the remaining step. |
| P4 named container | **Fixed** in code (`.desktop-window-content` now declares `os-workspace`). **Live visual review still open.** A default 1080px window now triggers the ≤1100px and ≤1050px narrowing rules in several apps. |

## 4. Architecture

### 4.1 One core, two hosts

```
frontend/src/features/pos/
  core/        domain: cart, pricing display, payment, outbox, drafts, day log
               (ported from mobile-pos-lite/hooks; no UI)
  data/        IndexedDB store (reuse itemba-mobile-pos-lite; see 4.3), API client with terminal headers
  ui/          screens and components on OS tokens
  layouts/     phone | tablet | till, chosen by container width
  hardware/    scanner input, receipt printing, cash drawer
  hosts/
    standalone.tsx   /mobile-pos: full-screen, PWA, POS-only lock, offline grace
    os-app.tsx       registered OS app "pos": window, draft continuity, OS theme
```

- **Standalone host.** Replaces the body of `app/(dashboard)/mobile-pos/page.tsx`. It keeps the webmanifest, the service worker (which never caches the API), the activation flow and the `AuthGate` POS-only redirect.
- **OS host.** Registered in `lib/apps.ts` with `launch.kind: 'route'` and the permission `mobile_pos_lite.use`, plus the four hosting edits Sales Desk needed (`lib/desktop.ts`, `desktop-app-host.tsx`, `os-companion-app.tsx`, route page). A manager who opens it inside the desktop still needs a **bound terminal**. The device binding is the POS's security boundary, and the OS host does not bypass it. On an unbound browser it offers the activation flow.
- `usesStandalonePosShell()` stays for `/mobile-pos*`. The OS host is served from a separate route (e.g. `/pos`).

### 4.2 Three layouts, chosen by container width

| Layout | Width | Shape |
|---|---|---|
| Phone | < 640px | Single column: search/scan → cart → pay. Persistent bottom action bar. One-thumb reach. |
| Tablet | 640–1100px | Two panes: product grid/search on the left, live cart and pay on the right. Large touch targets. |
| Till | ≥ 1100px | Three zones: search with results, cart table, payment panel. **Keyboard-first**: search always focused, scanner input goes straight to the cart, shortcuts for quantity, price, customer, pay and new sale. |

Layout follows the container, so the POS in a half-width OS window gets the tablet layout.

### 4.3 Offline store

Reuse the existing `itemba-mobile-pos-lite` IndexedDB database (v4: bindings, catalogs, sessions, frequents, outbox, stocks, drafts, daylog). **Do not bump the version unless a new store is required.** If one is, keep the version-less open and the VersionError recovery from the Kaunta gate, so older cached shells can't brick. Outbox entries written by Kaunta must replay unchanged from the new app. This is tested explicitly, because terminals will switch with sales still queued.

## 5. Price editing (the only backend change)

Today `POST /mobile-pos-lite/sales` lines are `{productId, quantity}`, and the server prices each line from `Product.defaultSellingPrice → retailPrice → wholesalePrice` (then the same three on the family). The below-cost profit guard (`profit.service.ts:240-339`) already refuses a sale whose net ex-VAT price is at or below cost. Nothing else exists: no floor price, no override concept and no discount permission.

### Proposed design

- **DTO.** Each line gains an optional `unitPrice` (VAT-inclusive, matching how reps quote) and an optional `priceReason`. If `unitPrice` is omitted, behaviour is unchanged.
- **Permission.** Add `mobile_pos_lite.edit_price`, seeded to the roles the owner chooses (open decision D1). It is exposed in the session payload as `priceEditEnabled`, derived like `purchasesEnabled`.
- **Limits, checked on the server:**
  1. The existing below-cost guard always applies.
  2. An optional **maximum discount %** per terminal (new column `maxPriceDropPct`, null means no limit beyond the guard).
  3. Optionally, price *increases* above list (D2).
- **Cost-blind refusals.** A refused price returns a fixed message, e.g. "Bei hii iko chini ya kiwango kinachoruhusiwa / This price is below the allowed level". It never includes the cost, the floor value or the margin. A test asserts the refusal body contains no numeric value from the product's cost fields.
- **Record.** `SalesOrderLine` stores both the list price and the charged price, the difference as `discountAmount`, and `priceOverriddenById` plus the reason. This reuses the discount support sales orders already have (`sales-orders.service.ts:189-221`).
- **Idempotency.** The replay comparison (`idempotentSalesOrderMatchesDto`) must include the edited `unitPrice`. A resend with a different price is a mismatch (409), not a silent re-price.
- **Offline.** An edited-price sale can be queued offline only if it is within the terminal's `maxPriceDropPct`, checked on the client against the cached list price. The server re-checks. If the server refuses a queued sale (for example, the guard trips because cost changed), it becomes a **rejected sale** in the queue for the manager, never discarded (invariant 3).
- **Visibility.** Price edits appear in the day close (count and total given away), in the office day-report register and in a new "price overrides" report. The owner sees who changed what, when and why.
- **Receipt.** The receipt shows the charged price. Whether it also shows "was / now" is decision D3.

### Phase 3 status (23 September 2026, branch `pos-remake-phase-3`)

Built as designed above, with these specifics and one pre-existing leak closed:

- **Schema** (migration `20260923150000_mobile_pos_price_overrides`, additive): `mobile_pos_terminals.maxPriceDropPct` (default 0, so no terminal allows a drop until an administrator sets one) and `mobile_pos_price_overrides` (list price, charged price, quantity, reason, note, user, terminal), written in the **same insert** as the sales order.
- **Permissions**: `mobile_pos_lite.edit_price` (cashier, salesperson, branch and company managers) and `mobile_pos_lite.edit_price_unlimited` (managers). Both were added to the dashboard's POS-only set; without that, a rep holding `edit_price` would have been sent from the till into the ERP shell.
- **Rules** (server, `resolveSaleLines`): a changed price needs `edit_price` and a reason; raising has no cap (D2); lowering is capped by the terminal unless `edit_price_unlimited`; the below-cost guard always applies; one price per product per sale; a missing or unreadable limit counts as 0.
- **Cost leak closed**: the profit guard's refusal names the product's cost ("…must be greater than cost TZS X"). That reached reps **before** this work whenever a list price sat below cost. On the POS route it is now replaced by one fixed sentence, used for both the terminal limit and the cost guard, so a refusal says nothing about where the cost is.
- **Phone**: tap a line's price (or F4 on the till) for the approved price sheet; changes are shown as a percentage of list, never against a cost. An unedited line is sent exactly as before (`{ productId, quantity }`); Kaunta and classic never set a price.
- **Still to do**: the day close and the office day-report register do not yet show price changes (they come with the phase 5 port); an office "price overrides" report is not built yet. Until then the records exist but are read only through the database. Repeated refusals could still be used to probe roughly where the cost is; the terminal limit and the audit log are the mitigations.

## 6. Hardware

| Device | Approach | Notes |
|---|---|---|
| USB or Bluetooth barcode scanner | **Keyboard wedge.** Detect a fast keystroke burst ending in Enter, route it to "add by barcode" whatever has focus, and tell it apart from typing. Works in every browser. | Matches the existing exact-barcode search. **Camera scanning stays excluded** under the owner's ruling. D4 asks whether that still holds. |
| Receipt printer, stage 1 | **80mm / 58mm HTML receipt** printed through the browser with `@page` sizing. Works with any printer the OS already knows about. | Low risk; works on desktop tills and Android with a print service. |
| Receipt printer, stage 2 | **ESC/POS direct**: Web Serial / WebUSB on desktop Chrome, Web Bluetooth on Android Chrome. Silent printing, no dialog. | Needs a model shortlist and a device matrix. D5. |
| Cash drawer | Kicked open by an ESC/POS command through the printer (stage 2), only on a completed cash sale. | No drawer without a direct-print printer. |
| Share receipt | Keep the existing letterhead PDF share (`GET sales/:id/receipt`) for phones without a printer. | Already shipped. |

### Phase 4 status (23 September 2026, branch `pos-remake-phase-4`)

- **Scanner (keyboard wedge), done:** a burst of 4+ keys less than 50 ms apart, ending in Enter, is a scan. Outside a text field it adds the exact barcode (or product code) match; an unknown code goes into search with a plain note. Inside the search box, Enter now prefers an exact barcode over the top fuzzy result. No camera (D4).
- **Browser receipts, done:** one receipt model drawn for the browser print dialog at 80 mm (72 mm printable) or 58 mm (48 mm), chosen per device under Menu → Printa na droo. It holds charged prices only (D3) and never a cost; a held sale prints "not yet sent" and no order number. Measured in a browser at both widths: every amount sits on the right edge and nothing overflows.
- **Direct ESC/POS and the cash drawer, built, not certified:** an encoder (init, bold, double height, partial cut, drawer pulse `ESC p 0 25 250`), a Web Serial connection (desktop Chrome/Edge) and a Web Bluetooth one (Chrome on Android), off by default. The drawer opens once per finished cash sale (sent or held), only with a directly connected printer and the setting on, and never for credit or mobile money. **Not tried on real hardware:** D5 (the printer and scanner models) is still open, so the panel says "not yet certified". Certification means a test print on each model, adding its Bluetooth service if it is not one of the three common ones, and confirming the drawer pulse.

## 7. Visual direction

Adopt the ITEMBA OS language: Inter, pearl and white surfaces, restrained blue for primary actions, the OS light/dark themes, 16px window radius, and frosted glass only on chrome. The POS-specific rules below are kept because they serve a counter, not a style:

- **Money is always tabular and large.** Totals and change get the strongest type on the screen.
- **One primary action per screen** (Add → Charge → New sale), always in the same place for each layout.
- **Status colour is only for status:** green for done or synced, amber for queued or offline, red for needing a person.
- The offline/queue state is always visible and always honest.
- Brass, the MUHURI stamp and warm paper are retired. The paid confirmation becomes a clear OS-style success state that still gives a haptic cue on phones.
- Touch targets are at least 48px on phone and tablet. WCAG AA contrast in both themes, with reduced motion respected.

A visual reference (desktop till, tablet and phone, light and dark) is produced and approved in Phase 1 **before** screens are built, using the same comparison method as `design-qa.md`.

## 8. Phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 — Prerequisites** | P1–P4 from §3. Owner answers D1–D7. | Offline cold-start test passes; POS suites green; base branch decided. |
| **1 — Foundation** | `features/pos` core ported from the Kaunta hooks with **no behaviour change**; the three layouts; OS tokens; the standalone and OS hosts; a new `uiVersion 3` pilot flag (existing mechanism, admin toggle `1..3`); approved visual reference. | The characterization suite runs against the core; both hosts boot; a v3 terminal shows the new shell and v1/v2 are untouched. |
| **2 — Selling** | Search, product grid, scanner input, cart, quantity keypad, customer picker, payment (all methods, CREDIT rules), receipt share, offline queue with visible custody, rejected-sale handling. | Parity with Mauzo/Malipo/Risiti on all three layouts; a Kaunta-queued outbox replays from v3; keyboard-only sale on the till layout. |
| **3 — Price editing** | Backend (§5) plus the UI: tap a price to edit, reason picker, limit shown as a percentage (never as a cost), the override visible in the cart and at close. | Server tests: guard, % limit, cost-blind refusal, idempotent replay with price, offline-queued refusal becomes rejected-not-lost. UI tests for the permission gate. |
| **4 — Hardware** | Scanner wedge (every layout), 80/58mm browser receipt, then ESC/POS direct print and cash drawer on the shortlisted models. | A device matrix is signed off on real hardware: at least one Android phone, one tablet, one desktop till, one scanner and one printer. |
| **5 — Day and stock** | Port the day book, day close (Funga Siku), stock (Stoo), counts (Hesabu), purchases (Manunuzi) and history onto the new UI. **Server contracts unchanged.** | Existing invariant tests (count key persisted with the draft, 6-hour capture limit, cost-blind history) pass unchanged; day close includes price overrides. |
| **6 — Pilot and retirement** | Flip the Kisimani Main terminals to v3; run alongside for 2 weeks with v2 as a one-flag rollback; then move the fleet; then delete the classic and Kaunta shells and the `uiVersion < 3` branches. | Two clean pilot weeks (no stuck outbox, no rejected sale that can't be explained); owner sign-off; old shells removed. |

Phases 2–5 are independent enough to split across parallel workers once Phase 1's core and layouts exist. Price editing (3) can start on the backend as soon as Phase 0 is done.

## 9. Testing and verification

- **Keep:** the characterization suite (unedited through every phase, as in the Kaunta reform), `pos-errors` tripwire tests against the exact backend text, and every invariant test listed in §2.
- **Add:**
  - offline cold start at the component level
  - Kaunta-outbox → v3 replay
  - cost-blind price-refusal assertion
  - container-width layout tests
  - scanner-burst vs typing discrimination
  - receipt print layout snapshots at 58/80mm
- **Live:** signed-in review on real devices for each phase, desktop at 1487×1058 plus tablet and phone at 390×844, both themes. A green unit suite is not a signed-in review (the lesson from phase 5 of ITEMBA OS).
- **Pilot health:** the daily check of queued/rejected sales, the day-close vs office register comparison, and the price-override totals.

## 10. Owner decisions

**Resolved 23 September 2026: the owner accepted every recommendation below.** D5 still needs the actual printer and scanner model names before Phase 4 stage 2.

| # | Decision | Recommendation (accepted) |
|---|---|---|
| D1 | Who may edit prices: reps, managers only, or reps within the terminal limit with a manager allowed to go further? | Reps within the terminal's max-drop %; managers up to the below-cost guard. |
| D2 | Allow prices **above** list (e.g. delivery, special orders)? | Yes, with a reason; no upper limit. |
| D3 | Receipt shows only the charged price, or "was / now"? | Charged price only; the override stays internal. |
| D4 | Keep the "no camera scanning" ruling? | Keep it for now; hardware scanners cover the till and tablet. |
| D5 | Which printer/scanner models? We need the models the shops have or will buy. | Pick one 80mm ESC/POS printer with USB and Bluetooth and one Bluetooth scanner, and certify those. |
| D6 | Should credit-limit and customer-specific pricing (existing `CustomerPriceAgreement`, currently unused) feed POS prices? | Not in this remake; revisit after the pilot. |
| D7 | App name shown to reps (Kaunta stays? new name?) | Keep "Kaunta" as the rep-facing name for continuity; the OS app label is "POS". |

## 11. Out of scope

Rewriting the sale, purchase, stock-count or day-report backends; returns and refunds; loyalty; multi-currency tills; camera scanning (unless D4 changes); customer-specific pricing (D6).
