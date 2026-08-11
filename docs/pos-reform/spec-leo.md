# MODULE SPEC — Leo (Daftari la Leo) + Mipangilio for Itemba POS

Build-ready spec for the Leo day-book and the Mipangilio settings screen under the Kaunta design direction. Written to close critique A1/A2/A6: the load-bearing day-book that the sales spec's queue surfaces ride on, the persisted day-log storage that makes "the book never looks empty" true offline, the relocated logout + identity, and the slab contract on verb-less screens. Verified against main @ 76597c47 (`pos-i18n.ts` flat `keyof` catalog at line 199; `mobile-pos-lite-store.ts` DB v3 at line 56, outbox rows deleted on successful sync via `removePendingMobilePosLiteSale` at line 196 — which is exactly why the day log must exist).

**Module scope:** the Leo screen (day total + tally row + reconciliation line + one merged day list containing the Foleni pending group and the sent list), the `daylog` IDB store and its write moments, the offline degradation contract for `my-sales-today`, the Mipangilio screen (identity, language, haptics, catalog re-sync, version, logout), and the slab contract on Leo/Stoo (critique A6 resolution). Queue *behavior* (Tuma Sasa semantics, rejected-sale ritual, removal) is owned by spec-sales §5; this spec owns the screen those surfaces live in.

**Key files:**
- `C:\projects\Actual Projects\itemba-r\frontend\src\components\westsides\mobile-pos-lite\` (new `screens/leo.tsx`, `screens/mipangilio.tsx` per Phase 2 seams)
- `C:\projects\Actual Projects\itemba-r\frontend\src\components\westsides\mobile-pos-lite\pos-i18n.ts` (21 new flat keys, §5)
- `C:\projects\Actual Projects\itemba-r\frontend\src\lib\mobile-pos-lite-store.ts` (IDB v4 `daylog` store — part of the single v4 migration, §4)
- `C:\projects\Actual Projects\itemba-r\backend\src\modules\mobile-pos-lite\mobile-pos-lite.service.ts` (`mySalesToday` at ~580 — used as-is, no backend changes in this module)

---

## 1. Screen: Leo — Daftari la Leo (the day book)

Route: `#leo` in the hash pseudo-router; anchor `#leo/foleni` scrolls to the pending group (the slab sync token deep-links here from every screen). Back-map: Leo → Mauzo. Rail tab `Leo` (book duotone chip), visible to all `mobile_pos_lite.use` holders. Forward nav `animate-slide-in-right`, back `slide-in-left`.

### Layout (top → bottom)

1. **Module rail** (Leo active) + status ribbon when non-clean.
2. **Header:** `leoTitle` ("Daftari la Leo", Title 22/700) + today's date `dd/MM` (Label, secondary).
3. **The book hero** — a card with the ruled-line pure-CSS background (repeating-linear-gradient in `--aurora-border`, the DUKA ledger texture; decorative, `aria-hidden` lines):
   - `leoDayTotal` label (Label 14/600, secondary) over the **day total in brass Display 40** (`.aurora-display .aurora-money`). Source and staleness rules in §2.
   - **Tally row:** five-stroke market tally marks (four verticals + one diagonal strike per group), one mark per finished job, rendered as inline SVG strokes in `--aurora-accent-text`. Accrues on **local commit** (the MUHURI moment — sent or queued alike), never waits on network. Wraps to new ruled lines past ~40 marks; the exact count lives in `leoTallyAria` for TalkBack. Tally truth comes from the `daylog` store (§3), so it survives app restarts offline.
   - **Reconciliation line** (Label, ink): `leoSent` + " · " + `leoHeld` — "Zimetumwa 12 · Mkononi 3". Zimetumwa = `my-sales-today` count (live, or cached with staleness per §2); Mkononi = live local outbox length (always local truth, never cached). Sent + held = the cash drawer.
4. **The day list — one list, one truth**, in two pinned groups:
   - **Pending group first** (anchor target `#leo/foleni`): **"Tuma Sasa"** button atop the group (existing `sendNow` key; disabled offline/while syncing, spinner while flushing). Queued rows: **brass left edge**, amount (ink on brass-subtle chip), line summary, `dd/MM hh:mm`, `queueWaiting`. Rejected rows: **red left edge**, `queueFailed`; tap → the rejected-sale ritual sheet. All row/ritual/removal behavior per spec-sales §5.2–5.3 — this screen just hosts it. Group header: existing `queueTitle`. Group hidden entirely when the outbox is empty (a clean book shows no empty pending shelf).
   - **Sent group:** header reuses existing `mySalesToday`. Rows 56px: time (`hh:mm`, Label secondary), amount (ink on brass-subtle chip, Label money rule), payment-method duotone icon chip, small green check (arrived-at-the-office). Newest first, from `GET /mobile-pos-lite/my-sales-today` `sales[]`. Mount animation `.aurora-stagger` first 12.
5. **Slab:** sync token · day total (when known — §6) · **MAUZO MAPYA** (`slabMauzoMapya`, blue) → Mauzo. The book is a glance; the counter is the job.

### Data flow

- Fetch `my-sales-today` on Leo open, pre-warmed on rail render (once per session — direction §6 pre-warm rule), re-fetched after every outbox flush completes and on the `online` event. No max-age throttle: this endpoint is small and is the truth surface of the screen.
- Every **successful** response writes the day-log sent snapshot (§3) — count, total, repId, `fetchedAt`.
- The tally row and Mkononi count never come from the network at all.

### States

- **Loading** (no cache): `.aurora-skeleton` hero number + rows.
- **Fetch error (online):** hero renders from the day-log cache with the staleness chip (§2); sent group shows inline `leoLoadError` + **`tryAgain`** button (shared key) — retry re-fires the fetch in place, never leave-and-re-enter.
- **Offline:** §2 in full. Pending group unaffected (IDB truth).
- **Empty day** (fetch succeeded, count 0, outbox empty, tally 0): existing `noSalesToday` under the hero; day total renders **TZS 0** honestly; the ruled lines stay — an open book with nothing written yet is a calm state, not an error.

---

## 2. Offline degradation of sent-today data (critique A1b)

`my-sales-today` needs network. The contract when it cannot be fetched:

1. **Day total + Zimetumwa count render from the last successful snapshot** in the `daylog` store for *today's date and the current rep* — with a **staleness chip** directly under the hero total: `leoLastKnown` ("Mwisho kuonekana {time}", grey Label chip, time = `fetchedAt` as `hh:mm`). The number is never dressed as live: no staleness chip means live, chip means cached. This mirrors Stoo's freshness-clock copy rule — always "last seen", never present-tense certainty.
2. **Sent rows are not cached v1** (storage discipline — the daylog row is ~40 bytes, a sales list is not). Offline, the sent group collapses to a single calm line `leoOfflineNote` in place of rows. The reconciliation line and hero total still carry the day's shape; the queue below is complete from IDB — the book never looks empty.
3. **Retry:** while online-but-failing, `tryAgain` shows (see States above). While offline the button is not rendered — the `online` listener refetches automatically, so a dead Retry button would be a lie; the ribbon already names the condition.
4. **No snapshot at all** (fresh terminal, first day offline): hero total shows "—" (em-dash, Display, secondary color) — never a fabricated 0 for a day that may have server-side sales; tally and queue still render. `salesCountLabel` line omitted.
5. **Shared-phone guard:** the cached snapshot stores `repId`. If the current session's rep differs (shift change on one terminal), the cached total is ignored (render as no-snapshot) — one rep must never glance another rep's money as their own. Tally is terminal-scoped by design (the phone's finished jobs), documented in §7.

---

## 3. The `daylog` store — local day-log design (critique A1a)

New IDB object store `daylog` in DB `itemba-mobile-pos-lite`, created by the **single v4 migration together with `stocks` and `drafts`** (spec-inventory §5, spec-purchases §6 — one `onupgradeneeded`, three `createObjectStore` calls, purely additive). Per critique B1 the v4-capable store code (version-less open + `VersionError` handling) ships **one release ahead of Phase 3**, since Leo needs `daylog` in Phase 3 while `stocks`/`drafts` are only populated in Phases 4–5 — empty pre-created stores are harmless.

**Key:** `` `${terminalCode}:${date}` `` (out-of-line), `date` = device-local `YYYY-MM-DD` (single-timezone EAT fleet; the server day is authoritative only via the snapshot itself — documented in §7).

```ts
export type PosDaylogEntry = {
  terminalCode: string;
  date: string; // device-local YYYY-MM-DD
  /** Finished jobs stamped on this phone this day — accrues on local commit. */
  tallyCount: number;
  /** Last successful my-sales-today snapshot — absent until the first successful fetch. */
  sent?: {
    repId: string; // shared-phone guard (§2.5)
    count: number;
    totalAmount: number;
    fetchedAt: number; // epoch ms — the staleness stamp
  };
};
```

**Write moments (exact):**
- `bumpDaylogTally(terminalCode)` — read-modify-write today's row (`tallyCount + 1`, create with `tallyCount: 1` if missing). Fires at the **MUHURI local-commit moment**, the same call sites as the stamp haptic: sale success *and* sale queued (spec-sales §4, Phase 3), purchase success (spec-purchases §3.2), count success (spec-inventory §3) — one stamp, one mark, per direction §5.
- `writeDaylogSent(terminalCode, sent)` — upsert today's row's `sent` field. Fires **only in the `my-sales-today` fetch success handler** (Leo open, pre-warm, Retry, post-flush, `online` refetch). Never written from client-side math — totals are server-authoritative, and a client-summed total would drift from server pricing.
- `readDaylogToday(terminalCode)` — read for render.

**Retention:** every write prunes rows for the same terminal older than **7 days** (`getAllKeys` + bounded deletes — the store never exceeds a handful of rows). Seven days keeps the last-known total across a weekend closure without becoming a shadow ledger; the UI reads only today v1.

**Failure posture:** daylog writes are wrapped, failures logged (`console.warn`) and never propagated — a full-disk private-mode phone must still complete the sale. Same posture as the frequents bump, honest about it per the no-swallowed-errors gate (log, don't ignore).

**Size: S** (store + 3 helpers + prune, in the v4 migration PR).

---

## 4. IndexedDB / store changes (summary)

DB `itemba-mobile-pos-lite` v3 → **v4** — the **one** migration, shared with spec-inventory §5 and spec-purchases §6: creates `stocks` + `drafts` + `daylog`. Ships with/before Phase 3 per §3 above and critique B1 (version-less open, `VersionError` catch, feature-detect stores). New exports in `mobile-pos-lite-store.ts`: `PosDaylogEntry`, `bumpDaylogTally`, `writeDaylogSent`, `readDaylogToday` — same open-transact-close-in-`finally` pattern as every existing helper. `outbox`, `bindings`, `catalogs`, `sessions`, `frequents` untouched. No new localStorage keys in this module (`itemba-pos-theme` / `itemba-pos-haptics` are owned by spec-sales §8; Mipangilio only reads/writes them through the existing setters).

---

## 5. Screen: Mipangilio (settings) — header gear (critique A2)

Route: `#mipangilio`. Back-map: Mipangilio → Mauzo (module-screen rule; deliberately not "back to where you came from" — one spatial answer beats a stack the rep can't see). Opened by the header gear on rail screens. Visible to all `mobile_pos_lite.use` holders; nothing here is manager-gated.

### Layout (top → bottom) — a single scrolling list of 56px rows, borderless cards

1. **Identity card** (the who-am-I block, read from the session — cached session offline, all fields already in `MobilePosLiteCachedSession`):
   - `settingsRep`: rep name (Body) — "Mhudumu".
   - `settingsTerminal`: terminal name + code (Body + Label secondary).
   - `settingsBranch`: branch name.
   Nothing editable — identity is set by the office. This card restores what the deleted home header used to show (critique A2).
2. **`settingsLanguage`** — SW/EN segmented control, wired to the existing `usePosLang` via `PosLangProvider`. Instant, no confirm.
3. **`settingsHaptics`** — toggle (48px switch), `itemba-pos-haptics`, default on; helper line `settingsHapticsNote`.
4. **`settingsResync`** — button; re-runs the catalog sync (and, when Phase 4 has landed, invalidates the Stoo snapshot max-age so the next Stoo open refetches). Below it `settingsLastSync` with the catalog's `updatedAt`. Disabled offline with inline `needsNetwork` (existing key); spinner while running; `settingsResyncDone` + 15ms tick on success.
5. **Theme — omitted until Phase 5 (documented decision).** Usiku is deferred to a Phase-5 toggle-on (owner decision 2026-08-11); the `.pos-shell` token table ships Mchana-only until then. **This spec chooses to render no theme row at all in v1** rather than a dead "Mchana (Usiku inakuja)" placeholder: a settings row that does nothing teaches low-literacy users that settings do nothing. When Phase 5 lands, the Mchana/Usiku row appears — its appearance *is* the announcement. (Alternative considered and rejected: single non-interactive "Mchana" entry with an "inakuja" note.)
6. **App version** row: `settingsVersion` label + build id (Label secondary) — the number a supervisor reads over the phone.
7. **Logout** (bottom, visually separated): existing `logOut` key ("Toka"), bordered secondary button — ink text, **not red** (red means server-rejected-needs-a-person, and leaving your shift is neither). Tap → confirm sheet: `logOut` (confirm, blue) / existing `back` (cancel), body `logoutConfirmBody`; when the outbox is non-empty the sheet adds `logoutQueueNote` with the count — informational, never a block (custody survives the shift). Mechanics unchanged from today's header logout (`mobile-pos-lite.tsx:1936–1946`): clears the auth session, redirects to login; it does **not** clear the terminal binding, outbox, frequents, or daylog — those are terminal property, not user property, and the next rep's login flushes the queue under the same terminal identity. **Disabled offline** with inline `needsNetwork`: a half-logged-out shared phone offline is a worse state than a handed-over phone, and login requires network anyway.

### States

Everything except re-sync and logout works fully offline (language, haptics, identity from cached session, version). No loading state — the screen renders synchronously from local data.

**Size: S–M** (one screen, no new data sources; the logout confirm sheet is the only new interaction).

---

## 6. Slab contract on verb-less screens (critique A6 resolution)

The slab law stands: **exactly one primary verb per screen — disabled, never hidden.** Leo and Stoo are glance screens whose natural next job is selling, so their verb returns to the counter:

| Screen | Verb | Slab money (brass Display) |
|---|---|---|
| **Leo** | `slabMauzoMapya` (MAUZO MAPYA) → Mauzo | Day total **when known** (live fetch or daylog cache) |
| **Stoo** (rep view) | `slabMauzoMapya` (MAUZO MAPYA) → Mauzo | Day total when known (same source) |
| **Stoo** (manager, `stockCountsEnabled`) | `countStart` (ANZA KUHESABU) → Hesabu | Day total when known |
| **Mipangilio** | `slabMauzoMapya` (MAUZO MAPYA) → Mauzo | — (settings are not a money moment) |

**Offline / unknown-total rule:** when neither a live value nor a valid cached snapshot exists (no snapshot, or the shared-phone rep guard rejects it), the slab shows **no number** — sync token + verb only. The slab never carries the staleness chip: staleness context renders on the Leo screen next to the number it qualifies; a bare stale number on a 64px slab with no room for the qualifier would be a lie. Sync token behavior is unchanged from spec-sales §1.2 on every screen.

This supersedes spec-inventory §2 step 6 ("no primary verb for reps … day-total only"), which is annotated accordingly.

---

## 7. Edge cases (build checklist)

1. **Midnight rollover with the app open:** the date key is computed at write/read time; the first render after midnight shows a fresh page (tally 0, no snapshot) — correct, the book turned a page. No timer needed; re-render on visibility/focus events suffices.
2. **Yesterday's queued sale flushes today:** its tally mark was made yesterday (local commit day); the server counts it in today's `my-sales-today` once posted. Tally ≠ Zimetumwa across a day boundary is accepted — the tally is the phone's work record, the reconciliation line is the server's; the book is a glance, not an audit.
3. **Device clock wrong:** date key and staleness times are device-local; the snapshot content is server truth. A wildly wrong clock degrades the chrome (odd staleness times), never the money. Accepted — same posture as the Stoo freshness clock keying off client `fetchedAt`.
4. **Rep counts vs terminal tally on shared phones:** `my-sales-today` is rep-scoped (per-rep accountability), the tally is terminal-scoped (this phone's stamped jobs). After a mid-day shift change the tally keeps counting, the sent snapshot resets per §2.5. Documented, accepted — matches the physical metaphor: the book belongs to the counter.
5. **Tally includes purchases and counts** (direction §5: every stamp adds a mark), so tally ≥ sales count on manager phones. The reconciliation line is sales-only by definition. If the owner ever wants a sales-only tally, the change is one call-site removal (see §3 write moments).
6. **Daylog write failure:** logged, never blocks the sale/purchase/count path (§3 failure posture).
7. **`#leo/foleni` cold boot:** honored by the hash-boot contract (spec-sales §0.3) — the queue renders entirely from IDB, making it the one deep link that is fully offline-proof.
8. **Retention prune races:** prune runs inside the same helpers, bounded to the terminal's own keys; a lost race leaves at most a stale row that the next write removes.
9. **Terminal re-activation with a new code:** orphaned daylog rows under the old code age out via the 7-day prune (no sweep needed, unlike drafts).
10. **`leoLastKnown` at Label size** on grey chip — ink text, not brass (Label-size money-adjacent text follows the brass contrast rule).

---

## 8. i18n — exact new keys (`pos-i18n.ts`, both catalogs, flat names, Swahili written first)

Reused as-is: `mySalesToday`, `salesCountLabel`, `noSalesToday`, `needsNetwork`, `sendNow`, `queueTitle`, `queueWaiting`, `queueFailed`, `logOut`, `back`, `offline`, plus spec-sales keys `slabMauzoMapya`, `ribbonOffline`, `syncCleanAria`/`syncQueuedAria`, and the one shared `tryAgain` (single definition, spec-purchases §7 — per critique A4 consolidation).

Leo (8):

| key | sw | en |
|---|---|---|
| `leoTitle` | Daftari la Leo | Today's Book |
| `leoDayTotal` | Jumla ya leo | Today's total |
| `leoSent` | Zimetumwa {count} | Sent {count} |
| `leoHeld` | Mkononi {count} | In hand {count} |
| `leoTallyAria` | Kazi {count} zimekamilika leo | {count} jobs finished today |
| `leoLastKnown` | Mwisho kuonekana {time} | Last known at {time} |
| `leoOfflineNote` | Hakuna mtandao — zilizotumwa zitaonekana mtandao ukirudi. | No network — sent sales will appear when the network returns. |
| `leoLoadError` | Imeshindikana kupakua mauzo ya leo | Could not load today's sales |

Mipangilio (13):

| key | sw | en |
|---|---|---|
| `settingsTitle` | Mipangilio | Settings |
| `settingsRep` | Mhudumu | Rep |
| `settingsTerminal` | Kituo | Terminal |
| `settingsBranch` | Tawi | Branch |
| `settingsLanguage` | Lugha | Language |
| `settingsHaptics` | Mtetemo | Vibration |
| `settingsHapticsNote` | Simu itatetema kidogo kazi ikikamilika. | A small buzz when a job finishes. |
| `settingsResync` | Pakua bidhaa upya | Re-download products |
| `settingsResyncDone` | Bidhaa zimepakuliwa upya | Products re-downloaded |
| `settingsLastSync` | Mara ya mwisho: {time} | Last: {time} |
| `settingsVersion` | Toleo la programu | App version |
| `logoutConfirmBody` | Ukitoka, utahitaji mtandao kuingia tena. | After logging out you need a network connection to sign in again. |
| `logoutQueueNote` | Mauzo {count} yanasubiri kutumwa. Yatabaki salama kwenye simu hii. | {count} sales are still waiting to send. They stay safe on this phone. |

21 new keys. **Size: S.**

---

## 9. Permission gates

Everything in this module: `mobile_pos_lite.use` + terminal binding — no manager gates, no new permissions, no backend changes. The only permission-sensitive pixel is the Stoo slab verb swap (`countStart` for `stockCountsEnabled`), owned by spec-inventory and restated in §6.

## 10. Build-size ledger

| Piece | Phase | Size |
|---|---|---|
| `daylog` store + 3 helpers + prune (inside the single v4 migration PR, ships one release ahead of Phase 3) | pre-3 | **S** |
| Leo screen (book hero, tally row, reconciliation, merged day list, states) | 3 | **M** |
| Foleni pending-group hosting (queue rows/ritual arrive from spec-sales rows 9–10) | 3 | **S** (rides sales spec) |
| Slab day-total wiring on Leo/Stoo + verb-less-screen contract | 3–4 | **S** |
| Mipangilio screen (identity, language, haptics, re-sync, version, logout confirm) | 3 | **S–M** |
| i18n 21 keys ×2 | 3 | **S** |

Total: roughly **1 M + 5 S** across Phase 3 (plus the store S landing one release earlier). No backend work; no new endpoints; one shared IDB migration with the other module specs.
