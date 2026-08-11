# DESIGN DIRECTION — KAUNTA: The Brass Counter That Stamps the Book

**Base concept:** Kaunta — The Brass Counter (aggregate winner: usability 8.5, feasibility 8.5, distinction 8.5). Every other concept contributes named grafts below; every contradiction between them is resolved explicitly in §10–11. Ships to users as **Itemba POS**; *Kaunta* is the design-language name. All Aurora token hexes below are verified against `frontend/src/styles/globals.css` and `frontend/tailwind.config.ts`.

**One-line essence:** The phone is the shop counter — it opens already selling, the thumb lives on one bottom slab, every shilling glows brass, every finished job gets a stamp in the day's book, and offline is custody, not a warning.

---

## 1. The governing law: four colors, four meanings

Adopted from Kaunta Imara (distinction judge: "adopt regardless of winner") and enforced everywhere:

- **Brass = money and custody.** Every TZS numeral, the day total, the tally, queued-work tokens, the stamp. If it is shillings, it is brass — no exceptions (this resolves the Chenji-color split; see §11).
- **Blue = press me.** All primary verbs keep `brand-600` blue. Trained muscle memory is an asset we do not spend.
- **Green = arrived / confirmed at the office.** Sent-checkmarks, the clean sync state, supplier/customer selected chips.
- **Red = needs a human.** Server-rejected sales only. Nothing else is ever red.
- **Amber is demoted, not deleted:** it survives only for genuine cautions ("Bado" still-owed in the change calculator, non-CASH-disabled-offline notices), always as icon+text chips, only in the top ribbon or inline field context — never for routine offline/pending state. Pending moves OFF warning-amber onto brass (Imara's custody reframe: "offline is Tuesday"). This structurally dissolves the brass-vs-amber confusion risk all four concepts flagged: amber almost disappears from the app.

---

## 2. Identity tokens

### 2.1 Palette — one wrapper class `.pos-shell` on the POS `<main>`, variable overrides only

All POS color already resolves through inline `var(--aurora-*)`, so this is a scoped re-theme with zero markup changes. Two branded modes. **Mchana (light) is the forced default** regardless of system theme, persisted POS-locally as `itemba-pos-theme` next to `itemba-pos-lang` (SHABA's call; two judges scored Kaunta's dark default as its one coherence crack — reps work in Dar sunlight on low-nit LCDs).

| Token (`.pos-shell` override) | Mchana (default) | Usiku (option) |
|---|---|---|
| `--aurora-bg` | Warm paper `#FAF7F0` | Ink navy `#0B1B2B` |
| `--aurora-bg-subtle` | `#F4EFE4` | `#12233A` |
| `--aurora-card` | `#FFFFFF` | `#12253A` |
| `--aurora-card-elevated` | `#FFFFFF` | `#1A3049` |
| `--aurora-text` | Ink `#101C2B` (~15:1 on paper) | Warm white `#F4EFE6` |
| `--aurora-text-secondary` | `#475569` | `#A8B3C4` |
| `--aurora-primary` (verbs) | `#2563EB` (brand-600, unchanged) | `#3B82F6` (existing dark primary) |
| `--aurora-accent` (money/custody) | Brass-700 `#B45309` | Brass `#FBBF24` |
| `--aurora-accent-subtle` | `#FFFBEB` (brass-50) | `#422006` |
| `--aurora-accent-text` | `#78350F` (brass-900) | `#FDE68A` |
| success / warning / danger (+bg/text) | unchanged Aurora values (`#10B981` / `#F59E0B` / `#EF4444`) | unchanged dark values |
| `--aurora-glow-accent` | existing `rgb(217 119 6 / .2)` ring+bloom | existing `rgb(251 191 36 / .3)` |

**Brass contrast rule (from Imara risk 8):** brass *text* appears only at Title size (22px) and above, or as `--aurora-accent-text` on `--aurora-accent-subtle` chips. Label-size money renders in ink on a brass-subtle chip. Light-mode brass is `#B45309` (brass-700), not `#D97706` — the extra contrast step is deliberate.

**Manifest/head:** kill the orphan teal `#0f766e`. `themeColor`: media-paired `#FAF7F0` (light) / `#0B1B2B` (dark). Manifest `theme_color`/`background_color` `#FAF7F0`. Maskable brass-stamp icon under `/brand/` (already SW-cached prefix; non-blocking — theme ships without it). Manifest `shortcuts`: "Mauzo Mapya", "Stoo". `viewport` export with `viewportFit: 'cover'`; slab gets `env(safe-area-inset-bottom)` padding.

### 2.2 Type

Self-hosted **Inter** via `next/font/local` under `/_next/static/` — the Google Fonts runtime `@import` at `globals.css:1` is deleted (flaky-network render risk; the bundle shrinks). Four sizes, nothing smaller:

- **Display** 40/44, 800, tabular, tight — slab total, Chenji, JUMLA, day total (`.aurora-display`, built for this and never used)
- **Title** 22/28, 700 — screen names, tile prices
- **Body** 17/24, 500 — names, rows (SHABA's cheap-screen floor beats Kaunta's 16px)
- **Label** 14/18, 600 — chips, field labels (SHABA's 14px floor beats Kaunta's 13px)

All money through `.aurora-money` tabular-nums. **Scale frozen against Swahili copy at 320px width, Swahili written first, English translated from it.** Hierarchy law: picture → number → word; product names are visually subordinate to photos and prices.

### 2.3 Shape and elevation

`--aurora-radius` 0.875rem, `-lg` 1.25rem, `-xl` 1.75rem. Mchana: borderless cards + soft `--aurora-shadow`; Usiku: 1px `--aurora-border` retained (shadows die on navy). Glow budget is exactly two moments: `--aurora-glow-accent` on the MUHURI stamp, `--aurora-glow-primary` on the slab while a request is in flight. Touch floors: 56px rows, 64px slab, quick-pick tiles ≥104px, steppers 48px. Icons: Lucide only, presented as **duotone rounded-square chips** (SHABA) with a fixed mnemonic set learnable once — banknote=Fedha, phone=Simu, building=Benki, **notebook=Daftari for CREDIT** (the debt book — culturally exact), cart=Mauzo, box=Stoo, truck=Manunuzi, book=Leo.

### 2.4 Motion

Compiled Tailwind vocabulary only (transform/opacity; both reduced-motion kill-switches already global), plus **one** new keyframe — the only `tailwind.config.ts` addition:

- `pos-stamp`: scale 1.6→1 with −6°→−3° rotate, 250ms `ease-aurora` (the MUHURI)
- Forward nav `animate-slide-in-right`, back `slide-in-left` — position is spatial grammar
- Add-to-cart: `scale-pop` on tile + 150ms count-up tick on the slab total
- Quick-pick mount: `.aurora-stagger` (first 12, 50ms cascade)
- Errors: `shake` on the offending control, never a bare toast; queued token: `pulse-subtle`

### 2.5 Haptics (no sound)

New ~10-line `pos-haptics.ts` wrapping `navigator.vibrate`, toggle persisted as `itemba-pos-haptics`: **15ms tick** (add/qty), **[30,40,30] stamp-sent**, **[80] single long stamp-held** (distinct palm signature for queued vs sent — Imara's literacy-free sync feedback), **[60,40,60] reject**. Scarcity is the signal; nothing else vibrates. WebAudio earcons are rejected for v1 (§10).

---

## 3. Navigation model

- **The app boots into Mauzo.** The home screen is deleted; its contents move to Leo. This removes one tap and one screen-read from every sale (the single most valuable decision in the set, per two judges). Managers land here too — one rail tap to Manunuzi; `localStorage` last-module memory is the pre-approved follow-up if field feedback demands.
- **Top module rail** (44px, duotone icon chip + one Swahili word): `Mauzo · Stoo · Leo`, plus `Manunuzi` when `session.purchasesEnabled`. Header gear opens Mipangilio. Bottom tabs are rejected (§10) — the slab owns the bottom, and module switching is rare (frequency zoning).
- **Kaunta Slab** fixed bottom, 64px + safe-area — see §5.
- **History-backed pseudo-routing:** `history.pushState`/`popstate` inside the single existing mount at `/mobile-pos`. SW allowlist, middleware, `(dashboard)` providers, `isPosOnlyUser` redirect all untouched. Explicit per-screen back-map (SHABA): Malipo→Mauzo (cart intact); **Risiti→Mauzo fresh, never re-pops Malipo**; Hesabu→Stoo (draft persists); Stoo/Leo/Manunuzi→Mauzo; Mauzo→PWA exit. Test `popstate` against the QR `?terminal=&code=` login survival on real Android gesture-nav.
- **Keyboard rule:** when any text input is focused, the slab collapses to a 28px total strip; restores on blur (DUKA's 5-inch crush mitigation, applied to our chrome).

---

## 4. Complete screen map

| Screen | State | Who | Notes |
|---|---|---|---|
| **Mauzo** (sale builder) | boot root | all | Search/scan top (unchanged local+220ms-remote merge, keyboard-wedge). Photo-first 2-col quick-pick, frequents-sorted: 64px photo, brass Title price, Body name 2-line clamp. Tap = pop + tick + slab count-up. Cart = **counter tray** bottom sheet from the slab's count chip, reusing `QuantityInput` verbatim; **first add of a session auto-peeks the tray for a beat** (answers "where did my items go" day one — usability judge's objection). Slab verb: LIPA. |
| **Malipo** | forward | all | **CASH pre-selected** (the modal case; one fewer tap). 2-col duotone method tiles from `session.paymentMethods`; CREDIT keeps mandatory customer search → green chip. Offline: non-CASH tiles disabled with a grey wifi-slash glyph (teaching why through iconography). Change calculator is the hero: denomination chips (Exact/5000/10000/20000/50000 ≥ total), **Chenji in 40px brass Display** on an accent-subtle card — the rep turns the phone to show the customer (SHABA's trust gesture). "Bado" owed = the one amber caution. Slab: KAMILISHA MAUZO. |
| **Risiti** (MUHURI moment) | after sale | all | Stamp slams onto the summary card (§5). Sent: solid brass seal **IMELIPWA** + green check. Queued: hollow brass seal **IMEHIFADHIWA** + custody copy "Imeandikwa kwenye daftari — itatumwa mtandao ukirudi" (DUKA) — never warning styling. Cart survives into this screen (receipt-source invariant); plain-text receipt via `navigator.share`/clipboard unchanged, gains "— KAUNTA YA ITEMBA —" header. Slab: MAUZO MAPYA, with SHIRIKI RISITI secondary. |
| **Leo — Daftari la Leo** (day book = day summary + my-sales + queue) | rail tab | all | DUKA's ledger, grafted whole: ruled-line pure-CSS background; hero day total in brass Display + **tally row** (five-stroke market notation, one mark per stamp, accrues on local commit — SHABA); reconciliation line "Zimetumwa 12 · Mkononi 3" (sent + held = the cash drawer). One list, one truth: sent rows (time, amount, method icon), queued rows inline with **brass** left edge ("Inasubiri mtandao"), rejected rows red-edged. "Tuma Sasa" atop the pending group; sync semantics untouched (break on connection error, flag-and-continue on rejection). **Retry button on fetch failure** (kills leave-and-re-enter). Offline: local tally + full queue from IDB + last-known day total with staleness stamp — the book never looks empty. |
| **Foleni** | `#foleni` anchor in Leo | all | Dissolved into the Daftari's pending section; slab sync token deep-links here. **Rejected-sale ritual** (Imara): tap red row → full line inspection, plain-Swahili mapped error, exactly two big buttons — **Jaribu tena** (retry this one) / **Mwite msimamizi** — raw English server text collapsed behind "Maelezo ya kiufundi". Removal stays honor-system two-step (no typed-amount, no rep dead-end; server-side tombstone report flagged to the audit track). |
| **Stoo** (stock) | rail tab | all (`mobile_pos_lite.use`) | New `GET /mobile-pos-lite/stock`. Rows: photo/initial tile, name, **big quantity + unit**, status dot + word — green **Ipo** / brass **Inakwisha** / red ring **Imeisha** / purple **Zaidi ya rekodi** (managers only). **Problems-first sort** (OUT→LOW→OK, Imara). Filter chips **Zote / Kidogo / Imeisha** — low stock is a chip, not a screen. **Freshness clock** with aging colors: minutes=green, hours=brass, day+=grey; **>24h stale hides quantities entirely (status dot only)** and copy is always "mwisho kuonekana" — never present-tense certainty. No cost/value fields, ever — rep phones get stolen; the projection strip is review-blocking. |
| **Hesabu** (count mode on Stoo) | gated | managers (`mobile_pos_lite.stock_count`, new) | **Blind entry**: rows grow a counted field; system quantity is never shown while counting (anchoring — SHABA/Imara) — so no live variance either (resolves Kaunta's contradiction, §11). Counts **capture offline into a local draft** (counting happens in storerooms where signal dies — Imara, the only field-correct Hesabu); **submission is online-only with explicit confirm** showing capture time. Review step before submit reveals per-line variance (+n green / −n red) with double-confirm above a total-absolute-variance threshold. Slab: TUMA HESABU. Posts `{productId, countedQuantity}` to new `POST /mobile-pos-lite/stock-counts`; server reads `systemQuantity` live at post time; `[MPL-COUNT:<key>]` notes-marker idempotency; auto-drive create→submit→approve→post with the **documented one-flag escape to stop-at-PENDING_APPROVAL**. |
| **Manunuzi** (receive stock) | rail tab, gated | managers (`mobile_pos_lite.purchase`) | Sales grammar in reverse: supplier chip where the customer chip lives, same tiles/rows, optional buying-price field marked "si lazima". Slab: POKEA, online-only to post. Offline: **kikaratasi** — the filled form saves locally as a single draft, slip badge appears on the ribbon; on reconnect, "Una kikaratasi cha mzigo. Tuma sasa?" with **explicit human confirm** (never auto-send); visible 48h expiry "imepitwa — hakiki kabla ya kutuma". Success: MUHURI **MZIGO UMEPOKELEWA** + existing office-handles-invoice line; backend contract and `[MPL-PURCHASE:<key>]` resume chain untouched. |
| **Mipangilio** (settings) | header gear | all | Minimal: language SW/EN, Mchana/Usiku, haptics toggle, terminal + branch identity, catalog re-sync button, app version. Nothing else. |
| **Activation** | `/mobile-pos/activate` | — | Mechanics unchanged; brass-welcome reskin; says "maliza usajili ukiwa na mtandao" (first load must be online — no SW precache, unchanged). |

---

## 5. The signature element: the ritual chain — *the counter stamps the book*

Three objects, one story, all firing on **local commit** so feedback never waits on the network:

1. **The Kaunta Slab** (persistent, every screen): exactly one primary blue verb, full-width, 64px — LIPA → KAMILISHA → MAUZO MAPYA → POKEA → TUMA HESABU. Position is the meaning; after a week the rep never reads it. The money number that matters now lives on it in brass Display (cart total counts up per add; Chenji on Malipo; JUMLA on Risiti; day total on Leo). Left edge carries the **sync token — a counted brass pill, not a dot** (usability judge: a 10px hollow-vs-solid dot is imperceptible on 720p): green check glyph when clean, brass pill with the queue **count** (pulse-subtle) when sales are held, grey wifi-slash when offline. Tap → Leo `#leo/foleni`.
2. **The MUHURI stamp** (SHABA, grafted as the slab's completion state): on every finished job in every module, a brass seal slams onto the summary card — `pos-stamp` keyframe + one `--aurora-glow-accent` bloom + the stamp haptic. Solid brass IMELIPWA / hollow brass IMEHIFADHIWA / MZIGO UMEPOKELEWA / HESABU IMEKAMILIKA. Color and haptic encode sync truth wordlessly.
3. **The Daftari** records it: each stamp adds one five-stroke tally mark to Leo — the day's work made physical in the notation every market trader already uses.

**The sync-legibility law** (Imara's law, without its coin object): every piece of unsent local data is exactly one counted, colored token in one fixed place — the slab pill for queued sales, the ribbon slip badge for drafts — with exactly three states: **brass (safe with you) · in-flight (traveling, glow-primary) · red (needs a person)**. No text required to know the state of the world.

Top **status ribbon** (fixed, only when non-clean): grey chip "Hakuna mtandao — mauzo ya pesa taslimu tu" (calm, not amber — offline is weather), brass "Inatuma…" while flushing, slip badge for parked drafts. Warnings proper (amber) appear only here and inline at fields.

---

## 6. Offline model per module (all four invariants untouched)

Terminal-binding headers on every call; server-authoritative pricing; IndexedDB outbox with in-payload idempotency keys; network-first SW that never caches `/api/*`. No SW changes.

- **Mauzo — full offline for CASH, unchanged core:** cached catalog + frequents; queue on `offlineCashEnabled` + connection-shaped failure; frozen payloads; sync on mount/`online`/Tuma Sasa. Legibility upgrades only: hollow-brass stamp + custody copy, slab pill count, Daftari inline rows. Photos offline collapse to a **designed brass initial-letter tile** (formalizing the `onError` path). Frequency bump still counts queued sales.
- **Manunuzi — online-to-post; offline is never a dead end:** no purchase outbox (a stale-`unitCost` replay is a valuation bug wearing a UX hat — unanimous across concepts). The kikaratasi draft is **form-state persistence, not a transaction queue**: one draft, human-confirmed send, visible expiry, server re-validates everything at post time.
- **Stoo — read offline, write online:** `/stock` responses snapshot to a new `stocks` IDB store (DB v4, additive `onupgradeneeded`), **throttled to on-tab-open + max-age** (~10 min), not every catalog sync (DUKA's low-end storage discipline). Offline renders the snapshot behind the freshness clock; >24h → dot only. Pre-warm the Stoo/Leo fetches on rail render so tab switches feel instant.
- **Hesabu — capture offline, confirm online:** draft in the new `drafts` store; correct by construction because `systemQuantity` is server-read at post time; the confirm screen shows capture time because the variance may be *surprising* even when *correct*.
- **Leo — degrades honestly:** `my-sales-today` needs network; offline shows local tally + full queue + last-known total with a staleness stamp, plus Retry.

---

## 7. Backend and platform work (all pre-scoped, Ground 2 verbatim)

1. `GET /mobile-pos-lite/stock` — direct Prisma in `MobilePosLiteService` (precedent: `products()`), `terminal.branchId` hard-set server-side via `requireTerminal`, includes unpriced stock items, unclamped negatives, server-computed status (reorderLevel→minimumStockLevel→10), **no cost/value fields**, `?low=true` using the documented `@Type(() => String) @Transform(v=>v==='true')` boolean-coercion pattern.
2. `POST /mobile-pos-lite/stock-counts` — wraps `StockAdjustmentsService` create→submit→approve→post; `[MPL-COUNT:<key>]` marker with `contains` search + twin-detect; `isStockItem()` guard; one-flag stop-at-PENDING_APPROVAL escape documented in the wrapper.
3. Seed `mobile_pos_lite.stock_count` beside `.purchase` (`database/seeds/seed.ts` ~259–277, role predicates ~1537/1593); `session` grows `stockCountsEnabled` (permission-derived, no `configVersion` bump).
4. Frontend stores: IDB v3→v4 additive — `stocks` + `drafts`.
5. i18n: ~40 new keys in both catalogs (rail, Stoo/Hesabu, stamp labels, ribbon states, settings), Swahili-first; new `posErrorMessage()` best-effort pattern map in `pos-i18n.ts` with generic fallback "Haikukubaliwa — mwite msimamizi" and raw text collapsed for supervisors (acknowledged best-effort — the backend emits free text; real error codes are an audit-track ask, not a blocker).

**Key files:** `frontend/src/components/westsides/mobile-pos-lite/*` (split + new screens + `pos-haptics.ts`), `frontend/src/styles/globals.css` (`.pos-shell`, delete line-1 `@import`), `frontend/src/app/(dashboard)/mobile-pos/page.tsx` (viewport/themeColor), `frontend/src/app/westsides-mobile-pos.webmanifest/route.ts`, `frontend/src/lib/mobile-pos-lite-store.ts` (v4), `frontend/tailwind.config.ts` (`pos-stamp`), `backend/src/modules/mobile-pos-lite/*`, `database/seeds/seed.ts`. **Untouched:** `mobile-pos-sw.js` semantics, terminal binding, pricing authority, outbox idempotency, permission model.

---

## 8. Rollout sequencing (SHABA's phasing, extended)

- **Phase 0 — characterization tests first**, before any refactor: cart-survives-into-success, sync break-on-connection/skip-on-rejection, frequents-counts-queued, offline cold-start restore, idempotency payload freeze.
- **Phase 1 — visible identity, near-zero risk:** `.pos-shell` theme (both modes, same PR), self-hosted Inter, manifest/head/safe-area fixes.
- **Phase 2 — structure:** hooks-first extraction of the 1949-line monolith along Ground 1's seams (`usePosBootstrap`, `usePosOutbox`, `usePosCart`, `PosLangProvider`, per-screen components) with UI untouched, ship; then pushState history + rail + slab; re-skin screen by screen. Keep the API contract backward-compatible so old cached shells survive the SW update lag.
- **Phase 3 — ritual:** MUHURI + haptics + Daftari merge + rejected-sale ritual + error map.
- **Phase 4 — Stoo:** endpoints, list, snapshot store, freshness clock.
- **Phase 5 — the new state surfaces, last:** Hesabu (offline capture) + kikaratasi drafts.

---

## 9. Explicitly REJECTED, and why

1. **Dark-navy default** (Kaunta) — the one aesthetic-first call in the winning concept, overruled by SHABA's sunlight argument and two judges. Mchana paper/ink is default; Usiku ships day one as the option.
2. **Bottom tab bar** (SHABA, DUKA) — the slab owns the bottom; tabs + slab + keyboard would crush a 5-inch screen (DUKA's own risk). Module switching is rare; it rides the top rail. We accept the familiarity cost and mitigate with duotone icon chips in fixed positions.
3. **Real Next.js routes** (DUKA) — verified against the SW: the allowlist is an exact-path Set matched on navigate-mode requests only; App Router client navigations fetch RSC flight payloads as non-navigate GETs the SW ignores, so offline tab-switching breaks. Also forces an atomic SW+routes release and per-navigation remounts on low-end Android. pushState buys the back button at a fraction of the risk.
4. **The coin/tray/Ukanda object system** (Imara) — a coin "in the phone" invites money-stored-on-device misreads (theft fear, delete-the-app-lose-the-money), and coin/slip/sheet × three states is six combinations to learn where one stamp teaches one. Its *law* (counted tokens, three states, one place) is adopted; its *object* is not.
5. **Removing blue CTAs** (SHABA) — destroys the fleet's one piece of trained muscle memory and makes brass mean four things in dark mode, violating its own discipline rule and our four-color law.
6. **WebAudio earcons** (SHABA) — markets are loud, counters are shared, scope is precious. Haptics are the channel. Revisit only on field demand.
7. **One-product-per-screen count wizard** (SHABA) — honest but too slow for a forty-SKU closing count. Inline blind sheet + review step instead.
8. **Showing system quantity during counting** (DUKA), and **live variance during entry** (Kaunta) — both invite anchoring/type-what-the-screen-says. Blind entry; variance revealed only at the review step.
9. **Enforced queue-removal gating with no rep button** (DUKA) — strands a rep alone in a village shop with a stuck red row. Honor-system two-step stays, hardened with full line inspection and the two-button ritual; server-side rejected-sale tombstone report goes to the audit track.
10. **Type-the-exact-amount removal confirm** (Imara) — demands numeric precision from precisely the user we design around.
11. **Any home screen / hub of doors** (Imara, status quo) — an extra tap and screen-parse on the highest-frequency action. Boot into Mauzo.
12. **The bare 10px sync dot** (Kaunta as drafted) — hollow-vs-solid is imperceptible on a 720p LCD; replaced by the counted brass pill. Numbers are the literacy-safe channel.
13. **An offline purchase outbox** (nobody proposed auto-send; formally rejected anyway) — money-bearing document chains never replay from a phone. Kikaratasi is a human-confirmed draft, not a queue.
14. **Amber as the pending/queued color** (status quo) — trains anxiety about routine offline. Custody brass instead; red reserved for needs-a-person.
15. **13px labels** (Kaunta) — under the 14px cheap-screen floor.

## 10. Contested calls, resolved

- **Default theme:** Mchana light (SHABA) over dark navy (Kaunta) — sunlight beats theatre. Both ship day one.
- **Nav chrome:** top rail + bottom slab (Kaunta) over bottom tabs — one thumb home beats familiar tabs that steal the slab's real estate.
- **Chenji color:** brass (Kaunta), not green (SHABA/DUKA) — "if it's shillings, it's brass" is a cleaner law than a one-off exception; green stays reserved for "arrived at the office".
- **Counting UX:** Kaunta's inline sheet + SHABA/Imara's blind entry + Imara's offline capture + Kaunta's threshold double-confirm, variance at review only.
- **Queue removal:** current honor-system + Imara's inspection ritual, minus its typed-amount friction, minus DUKA's hard gate.
- **Drafts (kikaratasi + count sheets):** adopted despite the feasibility judge's new-risk flag, because both other lenses rated the field problem real (retyping twenty lines, counting in dead-signal storerooms) — de-risked by construction: form-state only, one draft per module, explicit human confirm, visible 48h expiry, server re-validation, and scheduled last (Phase 5) so everything else ships without them.

## 11. Risks carried forward (owned, with mitigations)

Refactor regression on load-bearing quirks (Phase 0 characterization tests, hooks-first, separate PRs); popstate × QR-login-redirect on real Android (explicit test matrix); manager boot-into-Mauzo friction (watch; last-module memory pre-approved as follow-up); stale-snapshot trust (24h grey-out + "mwisho kuonekana" copy rule); auto-posted counts moving GL instantly (review variance + threshold confirm + one-flag escape); haptic motor variance on cheap Androids (short patterns, discoverable toggle); SW update lag during reskin (backward-compatible API during rollout); brass discipline drift (the four-color law is a review gate, not a hope).

---

## 12. Post-critique amendments (2026-08-11)

Binding deltas recorded after the completeness critique (critique.md) and the owner's decisions. Where this section conflicts with §1–11, this section wins.

1. **Owner decisions (2026-08-11):**
   - **Historia (purchase history) is CUT from v1 entirely** — list, detail, `GET /mobile-pos-lite/purchases`, and its i18n keys (critique A5/D1). The office desktop covers purchase review; no buying-cost history ships on phones. spec-purchases is annotated in place.
   - **Usiku dark mode is DEFERRED to a Phase-5 toggle-on** after Mchana QA (critique D2). This overrides §9-1's "Usiku ships day one" and §10's "Both ship day one." The §2.1 token table stays as written; `.pos-shell` ships Mchana-only until the Phase-5 toggle.
   - **Integer-only stock counting v1** (critique D6): CountInput is `inputMode="numeric"`, integers 0–1,000,000; decimals return with weighed-goods support.
   - **POS-only lock extended** (critique B4): `mobile_pos_lite.purchase` and `mobile_pos_lite.stock_count` join `POS_ONLY_PERMISSIONS` in `(dashboard)/layout.tsx` — phone-only branch managers get the POS shell, not the ERP.
   - **Kikaratasi simplified** (critique D3): auto-persist + silent restore into the Pokea form; the reconnect prompt / 48h-expiry / discard state machine is cut.
   - Camera barcode scanning **remains rejected** (owner decision, prior wave).
2. **Hash-only routing mandate (critique A3):** §3's "history-backed pseudo-routing" is now hash-only — `pushState` mutates `location.hash` exclusively, never the pathname (the SW navigate allowlist is an exact-path Set; a path-shaped URL dead-ends offline reloads and 404s online refreshes). The exhaustive hash map (`#mauzo` default · `#malipo` · `#risiti` · `#leo` · `#leo/foleni` · `#stoo` · `#hesabu` · `#manunuzi` · `#mipangilio`) and the cold-boot deep-link contract (boot reads `location.hash`; gated/flow-interior hashes normalize) live in spec-sales §0.3. Manifest `shortcuts` (§2.1) are deferred until they can target those hashes (critique D5).
3. **Single IDB v4 migration, now three stores (critique A1/B1):** §7-4's "v3→v4 — `stocks` + `drafts`" is superseded — the ONE v4 upgrade creates `stocks` + `drafts` + **`daylog`** (Leo's persisted day log: per-date `{date, tallyCount, sent?}`, spec-leo §3, which is what makes §6's "local tally + last-known day total" actually exist offline — outbox rows are deleted on successful sync, so nothing else remembers the day). The v4-capable store code ships one release ahead of Phase 3, opens version-less, and handles `VersionError` (old-shell downgrade hazard).
4. **i18n scope corrected (critique A4):** §7-5's "~40 new keys" was under-scoped >2×. Real count: ~99 flat keys across the four module specs after the cuts (sales 26 · purchases 10 · inventory 42 · Leo/Mipangilio 21), flat `keyof`-union names only (no dot namespaces), one shared `tryAgain` as the app-wide retry key.
5. **Logout and identity move to Mipangilio (critique A2):** §4's Mipangilio row ("Nothing else") is amended — Mipangilio gains the rep/terminal/branch identity card and logout (confirm sheet; binding/outbox/daylog survive logout — terminal property, not user property). The Usiku toggle row is omitted until Phase 5 rather than shown dead. Full spec: spec-leo §5.
6. **Slab law on Leo/Stoo (critique A6):** no screen is verb-less — Leo and rep-view Stoo carry MAUZO MAPYA (managers on Stoo: ANZA KUHESABU). The slab day total renders only when known (live or from the `daylog` cache, current-rep-guarded); staleness renders on the Leo screen next to the number, never on the slab. spec-leo §6 is the contract.
7. **Corrected claim (critique B8i):** §2.3's radius values (0.875/1.25/1.75rem) are `.pos-shell` **CSS-variable overrides**; Tailwind's `rounded-aurora*` utilities compile the *config* values (`aurora: 0.625rem` etc.) and will **not** pick up the override. POS markup must take radius from `var(--aurora-radius*)` (inline or via classes that resolve the vars) — auditing which mechanism each reused component uses is part of the Phase-1 theme PR's review gate.
8. **Queued-sales × stock-count gate (critique B3):** entering Hesabu with a non-empty local outbox warns, and TUMA HESABU hard-gates until the local queue is flushed ("Tuma Sasa kabla ya kuhesabu"); the cross-terminal case is documented as accepted (spec-inventory §3).