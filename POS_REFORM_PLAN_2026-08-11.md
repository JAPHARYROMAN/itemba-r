# ITEMBA POS REFORM — the "Kaunta" Plan

**Date:** 2026-08-11 · **Baseline:** main @ `76597c47` · **Status:** 4 of 5 owner decisions resolved 2026-08-11 (§7); decision 3 (pilot branches) open until Phase 1. Documentation gate closed: spec-leo.md written, all specs amended in place, direction carries §12 post-critique amendments.

**One-line essence:** *The phone is the shop counter — it opens already selling, the thumb lives on one bottom slab, every shilling glows brass, every finished job gets a stamp in the day's book, and offline is custody, not a warning.*

A ground-up UI remake of Itemba POS with three built-in modules — **Mauzo (Sales) · Manunuzi (Purchases) · Stoo (Inventory)** — plus the **Leo** day-book, under a distinctive brass-ledger design language named **Kaunta**. Ships to users as "Itemba POS". Every existing invariant survives untouched: terminal binding, server-authoritative pricing, idempotent offline CASH queue, network-first service worker, permission gating.

## How this plan was made

Fifteen agents in a structured design workflow: 3 grounding readers mapped the real POS code, backend surface, and design-system levers; 4 independent concepts were designed through different lenses (rep-speed, brand identity, information architecture, offline resilience); 3 judges scored every concept for low-literacy usability, engineering feasibility, and design distinction; a synthesis pass produced the definitive direction from the winner plus grafts; 3 module specs were written against it; and a completeness critic audited the whole against the codebase. Two concepts independently converged on the brass/counter identity — a good sign it's the right story for this product.

Full artifacts in [docs/pos-reform/](docs/pos-reform/):
- **[design-direction.md](docs/pos-reform/design-direction.md)** — the spec of record: four-color law, Kaunta tokens (Mchana/Usiku palettes, type scale, shape, motion, haptics), navigation model (top rail + bottom slab, boot-into-Mauzo, hash pseudo-routing), complete screen map, the MUHURI stamp ritual, offline model per module, 15 explicitly rejected alternatives with reasons, and 8 owned risks.
- **[spec-sales.md](docs/pos-reform/spec-sales.md) · [spec-purchases.md](docs/pos-reform/spec-purchases.md) · [spec-inventory.md](docs/pos-reform/spec-inventory.md) · [spec-leo.md](docs/pos-reform/spec-leo.md)** — build-ready screen specs, i18n keys, endpoints, store changes, sizes (spec-leo covers Leo/Daftari + Mipangilio + the `daylog` store + the slab contract on verb-less screens).
- **[critique.md](docs/pos-reform/critique.md)** — the completeness audit; its findings are binding amendments (§4).
- **[concept-verdicts.md](docs/pos-reform/concept-verdicts.md)** — judge scores and rationale for all four concepts.

## 1. What the reps and managers get

- **Opens selling.** No home screen: the app boots straight into the Mauzo sale builder with the photo-first quick-pick grid. Module rail on top (Mauzo · Stoo · Leo, + Manunuzi for managers); one persistent blue action slab on the bottom whose verb changes with the screen (LIPA → KAMILISHA → MAUZO MAPYA / POKEA / TUMA HESABU).
- **The MUHURI.** Every finished job slams a brass stamp onto its summary card with a haptic signature: solid IMELIPWA when sent, hollow IMEHIFADHIWA when held offline — sync truth encoded wordlessly. Each stamp adds one five-stroke tally mark to Leo's ruled day-book.
- **Offline is custody, not a warning.** Queued sales are a counted brass pill on the slab ("safe with you"), never amber anxiety. Red means exactly one thing app-wide: a human is needed — and the rejected-sale ritual gives two big buttons (Jaribu tena / Mwite msimamizi) instead of a dead end.
- **Stoo (new):** branch stock with problems-first sorting (Imeisha → Inakwisha → Ipo), photo tiles, a freshness clock that refuses to lie when data is stale, and manager-only **Hesabu** blind stock counting — captured offline in the storeroom, confirmed online with variance revealed only at review.
- **Manunuzi (promoted to a module):** the receiving flow under sales grammar (supplier chip, same tiles, POKEA), with crash-proof draft persistence.
- **Leo:** day total in brass, tally row, "Zimetumwa 12 · Mkononi 3" reconciliation, the queue, and per-sale history — the day's book.
- **Mchana** (paper/ink light) is the forced default for Dar sunlight; brass = money, blue = press me, green = arrived, red = needs a person.

## 2. Backend additions (small, following the purchases-wrapper precedent)

1. `GET /mobile-pos-lite/stock` — branch-locked stock list, server-computed status, **no cost/value fields ever** (stolen-phone rule), `truncated` flag on the 1500-row cap.
2. `POST /mobile-pos-lite/stock-counts` — wraps the core stock-adjustment chain create→submit→approve→post with `[MPL-COUNT:<key>]` marker idempotency and a documented stop-at-approval escape flag.
3. Seed: `mobile_pos_lite.stock_count` permission (managers), `session.stockCountsEnabled`.
4. i18n: ~93+ new sw/en keys (critique-corrected count), Swahili written first; `posErrorMessage()` best-effort error map with backend-string tripwire tests.

## 3. Build phases

- **Gate (pre-Phase-0) — the critique's five actions, all blocking:** write the missing Leo/Daftari + Mipangilio spec including the local day-log store and logout relocation; fix the IndexedDB version-open hazard (version-less open + VersionError handling, one v4 migration creating `stocks`+`drafts`+`daylog`, shipped one release ahead); prove or fix **offline cold start through the AuthGate on a real device** (likely a live bug today — the plan's central promise rests on it); mandate hash-only pseudo-routing with cold-boot hash handling; add the per-terminal `uiVersion` pilot flag and a falsifiable performance budget (≤3s warm boot on a Tecno-Spark-class phone, ≤100ms tap-to-cart, JS bundle ceiling in CI, Stoo list virtualization, thumbnail endpoint or payload budget for tiles).
- **Phase 0 — characterization tests** for the load-bearing quirks (cart-into-success, sync break-vs-flag semantics, frequents counting queued sales, offline cold-start restore, frozen idempotent payloads) plus the on-device offline E2E.
- **Phase 1 — visible identity, near-zero risk:** `.pos-shell` scoped Kaunta re-theme (Mchana), manifest/theme-color/safe-area fixes. The Inter self-hosting is **split out** as its own app-wide PR with desktop QA (critique B6).
- **Phase 2 — structure:** hooks-first extraction of the 1,949-line monolith (`usePosBootstrap`, `usePosOutbox`, `usePosCart`, per-screen components) with UI unchanged, shipped; then hash-routing + rail + slab; re-skin screen by screen behind the pilot flag.
- **Phase 3 — ritual:** MUHURI + haptics + Leo day-book merge (queue dissolves into it) + rejected-sale ritual + error map.
- **Phase 4 — Stoo:** endpoints, virtualized list, snapshot store + freshness clock, IDB v4.
- **Phase 5 — new state surfaces last:** Hesabu offline capture + Manunuzi draft restore; Usiku toggle-on after Mchana QA (per amendment).

Rollout per phase: 1–2 pilot branches for a week via the terminal flag → fleet. Rollback rehearsed (safe once the IDB fix lands). Telemetry from day one: rejected-sale rate, queue age at flush, count-variance magnitudes, session refetch failures. A11y gate per phase (focus management for the pseudo-router, sheet focus traps, icon-chip labels, contrast audit) alongside the four-color-law review gate.

## 4. Binding amendments from the critique

Adopted in full: the five gate actions (§3); logout + identity move to Mipangilio; flat i18n keys with one shared `tryAgain`; slab law reconciled on Stoo/Leo (verb-less screens show the day context but never hide the slab); Hesabu variance pinned to `quantityOnHand`; stale-Stoo rows keep the status **word** (color never the sole channel); queued-sales × stock-count shrinkage warning ("Tuma Sasa kabla ya kuhesabu" gate when the local outbox is non-empty, cross-terminal case documented); `POS_ONLY_PERMISSIONS` decision required (§7); seed-propagation notes (custom roles need manual grants; re-login may be needed for the session flag); SW cache eviction on activate; kikaratasi simplified to auto-persist + silent restore (no reconnect state machine); `?low=true` and manifest shortcuts deferred; integer-only counting v1 (pending catalog check, §7).

## 5. Sizing (rough)

Gate+Phase 0: **M** · Phase 1: **S–M** (+ separate font PR **S**) · Phase 2: **L** (the structural heart) · Phase 3: **M** · Phase 4: **M–L** · Phase 5: **M**. Backend total: **M**. Nothing here blocks normal ERP work; the POS keeps working throughout — the old component stays mounted behind the pilot flag until Phase 3 sign-off.

## 6. Explicitly rejected (full reasoning in the direction, §9)

Dark-mode default (sunlight wins) · bottom tab bar (the slab owns the bottom) · real Next.js routes (breaks the SW offline model) · the coin/tray object system (theft-fear misread) · WebAudio earcons · live variance during counting (anchoring) · camera barcode scanning (owner decision, prior wave) · any home screen · amber as the queued color · an offline purchase outbox (money-bearing chains never replay from a phone).

## 7. Open decisions (owner) — 4 of 5 RESOLVED 2026-08-11

1. **Historia (purchase history in the POS):** the purchases spec added a list+detail+endpoint the direction never approved, and it puts 30–90 days of buying costs on phones. Recommend: **cut from v1** (office desktop covers review); alternative: a 10-row list, no detail, no costs.
   **→ RESOLVED 2026-08-11 (owner): CUT from v1 entirely** — list, detail overlay, and `GET /mobile-pos-lite/purchases` all dropped (no 10-row fallback). spec-purchases annotated in place; direction §12-1 records it.
2. **Usiku dark mode:** direction says ship day one; critique says defer to Phase 5 (near-zero users under a forced-light default, doubles visual QA). Recommend: **defer**.
   **→ RESOLVED 2026-08-11 (owner): DEFERRED** to a Phase-5 toggle-on after Mchana QA. The §2.1 token table stays in the direction; no theme row in Mipangilio until the toggle ships (spec-leo §5).
3. **Pilot branches:** name the 1–2 branches that pilot each phase for a week.
   **→ still OPEN — needed before Phase 1 begins** (the terminal `uiVersion` flag can land without the names).
4. **Phone-only managers:** should `mobile_pos_lite.purchase`/`.stock_count` holders with no other permissions get the POS-only lock (no ERP shell)? Recommend: **yes** — add both codes to `POS_ONLY_PERMISSIONS`.
   **→ RESOLVED 2026-08-11 (owner): YES** — both codes join `POS_ONLY_PERMISSIONS` in `(dashboard)/layout.tsx`; phone-only managers get the POS shell.
5. **Integer-only stock counting v1** (decimals return with weighed-goods support): confirm your stock items are effectively integer-unit. Recommend: **yes**.
   **→ RESOLVED 2026-08-11 (owner): YES** — integer-only CountInput v1 (`inputMode="numeric"`, 0–1,000,000); decimals return with weighed-goods support (spec-inventory §3 amended).
