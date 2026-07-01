# ITEMBA-R UI Experience Enhancement Plan

*Design-engineering lead synthesis of four audits (foundation, component library, high-traffic screens, motion & feedback). All claims cite files in `C:\projects\Actual Projects\itemba-r\frontend\`. Presentational layer only — no API, data-flow, route, or backend changes.*

> **Status update (verified against code, 2026-07-01).** Parts of this plan have shipped since it was written; several original claims are now stale. Corrected inline below (see ⚠️ annotations). Summary:
> - **DONE — Toast is live.** `showToast` now has ~84 call sites across ~29 files (not "zero call sites"), and `ToastProvider` is mounted in `app/(dashboard)/layout.tsx:69`. Phase 2's "Toast (built, zero call sites)" and much of Phase 4's "Toast everywhere" are effectively delivered.
> - **DONE — Phase 1 keyframes exist.** `fade-out`, `scale-out`, `scale-pop`, and `shake` are all defined in `tailwind.config.ts` (lines ~107–117). The "~90% of the motion system is dormant" figure and the "new keyframes to add" list in Phase 1 no longer describe current state.
> - **DONE — POS "Sale Complete" celebration is shipped.** The flagship Phase-3 moment (`scale-pop` card + brass checkmark + receipt #/total + "Posted" badge + vibration buzz) exists in `components/westsides/mobile-pos/mobile-pos-sale-entry.tsx` (~lines 1923–1951). It is no longer a to-build item.
> - **STILL OPEN.** Accent/elevation/status-contrast tokens and typography ramp (rest of Phase 1); the primitive upgrades (Phase 2 buttons, StatCard count-up, skeletons, icon set, modal exit animations); the hero-screen redesigns beyond POS (login, dashboard, sales-orders layout, westsides hub); count-up KPIs, stagger, route progress bar (rest of Phase 4); and the consistency sweep + dark mode (Phase 5).

---

## 1. Design vision

**Direction: "Confident Trade Counter" — warm industrial precision.** Itemba-R should feel like the best-run hardware counter in Tanzania: fast hands, clear numbers, and a visible pulse of activity — never a casino. The evidence says the bones are excellent: a complete Aurora token system (`src/styles/globals.css` defines color, shadow, radius, and motion tokens including `--aurora-duration-fast/200ms/slow` and three easing curves) and a full keyframe library in `tailwind.config.ts` — but ~~**~90% of the motion system is dormant** (only 5 of 10+ keyframes used across 35 of 200+ files)~~ *(⚠️ stale: the Phase-1 keyframes have since been added to `tailwind.config.ts`; the exit/pop/shake set is now present — see Status update)*, ~~the Toast system has **zero call sites**~~ *(⚠️ stale: `showToast` now has ~84 call sites across ~29 files and `ToastProvider` is mounted in `app/(dashboard)/layout.tsx:69`)*, KPI numbers render flat, and success is silent everywhere (sales-orders modal closes mutely at `operations/sales-orders/page.tsx:598-603`; mobile POS says only "Receipt ready."). "Energetic" here means: numbers that count up, rows that cascade in, sales that *celebrate*, statuses you can read across the counter, and one warm amber accent (hardware-store brass against the existing trustworthy blue `#2563eb`) reserved for moments of pride. "Trustworthy" means: density preserved, motion under 350ms, everything respecting the `prefers-reduced-motion` guard already in `globals.css:191-199`, and zero animation in the POS critical path.

---

## 2. What's already good — keep and build on

- **Aurora CSS variable system** (`globals.css`): complete light/dark token sets (`.dark` scope exists at line 91, including a dark-mode compatibility shim for raw Tailwind classes at lines 367+), shadows (`--aurora-shadow-sm/-/lg/command`), radius scale, motion tokens. *This is the foundation — we extend, never replace.*
- **Motion infrastructure already written**: `tailwind.config.ts` keyframes (`fade-in`, `fade-up`, `slide-in-right/left`, `slide-up`, `scale-in`, `skeleton`, `pulse-subtle`, `spin-slow`) and the `prefers-reduced-motion` kill-switch. We deploy, not invent. *(⚠️ update: the Phase-1 exit/pop/shake set — `fade-out`, `scale-out`, `scale-pop`, `shake` — has since been added too, lines ~107–117.)*
- **Toast system fully built** (`components/aurora/feedback/Toast.tsx`, typed variants, auto-dismiss) — ~~needs only call sites~~ *(⚠️ update: now wired — ~84 `showToast` call sites across ~29 files; `ToastProvider` mounted in `app/(dashboard)/layout.tsx:69`)*.
- **Semantic status mapping across 50+ states** (StatusBadge) — consistent finance/inventory/HR/compliance semantics; we raise contrast, not redo the taxonomy.
- **Feature-complete DataTable** (sort, search, pagination, skeleton rows), solid form infrastructure (prefix/suffix, error/help text), Modal/overlay keyboard support, focus rings, unified scrollbars.
- **Accessibility baseline & data density**: semantic HTML, labeled forms, color+text badges, responsive grids; mobile POS already phone-targeted (`max-w-md`).
- **Inter typography** wired in `tailwind.config.ts:66-67` — a fine workhorse; we add weight discipline, not a new font circus.

---

## 3. The enhancement programme — five shippable, presentational-only phases

### Phase 1 — Foundation (tokens only; zero component edits)
**Files: `src/styles/globals.css`, `tailwind.config.ts`. Nothing else.**

1. **Accent ramp**: add `--aurora-accent: #f59e0b`-family ("brass") tokens distinct from `--aurora-warning` — `--aurora-accent`, `--aurora-accent-subtle`, `--aurora-accent-text` in both `:root` and `.dark`. Reserved for celebration/pride moments only.
2. **Elevation tiers**: add `--aurora-shadow-prominent` and `--aurora-glow-primary` / `--aurora-glow-success` (soft colored box-shadows) so cards can have prominence hierarchy — audit found *all* cards share `aurora-shadow-sm`.
3. **Status contrast tokens**: darken `-text` pairs one step (e.g. emerald-700 → emerald-900 pattern flagged in the badge audit) at the token level so every consumer inherits the fix.
4. **New keyframes** in `tailwind.config.ts`: `fade-out`, `scale-out` (modal exits — audit: no exit animations anywhere), `scale-pop` (success pop), `count-up` registration hook class, `stagger` utility (row cascade), `shake` (form error). All ≤350ms, all inside the existing reduced-motion guard. *(⚠️ update: `fade-out`, `scale-out`, `scale-pop`, and `shake` already exist in `tailwind.config.ts` lines ~107–117 — this sub-item is largely DONE; only the `count-up` hook class and `stagger` utility remain.)*
5. **Dark-mode groundwork**: verify token completeness of the `.dark` block (it exists and is substantial); add a `data-theme` toggle hook + localStorage persistence stub in `globals.css`/layout class only. No shipping yet — Phase 5.
6. **Typography ramp**: define `--aurora-display` sizes for hero numerals (KPI cards) using existing Inter 700/800 weights already imported at `globals.css:1`.

*Shippable alone: pure token additions, visually near-invisible, zero regression surface.*

### Phase 2 — Primitives (the ~10 components that lift all 200 pages)

| Component (file) | Current (audited) | Target |
|---|---|---|
| **AuroraButton** (`aurora/actions/AuroraButton.tsx`, `ui/Btn.tsx`) | Flat color shift on hover; disabled = `opacity-50` only | Hover: `-translate-y-0.5` + shadow lift; press: scale-pop; loading: spinner + "Saving…" label; disabled: muted fill + `cursor-not-allowed`; success flash variant |
| **StatusBadge** (`aurora/data-display/StatusBadge.tsx`, `ui/status-badge.tsx`) | Low-contrast light fills, no hover | Darker text via Phase 1 tokens (counter-readable), subtle `hover:scale-105` + shadow; keep all 50+ semantic mappings untouched |
| **Icon system** (new `ui/icon-set.tsx`) | Emoji in CommandPalette lines 47-86, 220-248 vs SVG in sidebar — OS-inconsistent | One Lucide-based IconSet (~35 domain icons: order, product, payment, customer…); swap into CommandPalette, nav defaults, card titles |
| **DataTable** (`aurora/data-display/DataTable.tsx`) | Text arrows ↑↓ (line 159), hover = bg shift, skeleton hardcoded 5 rows (line 44) | Rotating SVG chevrons, active-sort header highlight (`--aurora-primary` + left border), configurable skeleton rows, optional row-stagger flag (off by default — see guardrails) |
| **StatCard / MetricCard** (`aurora/dashboards/`) | Static number + label, one shadow tier | `tier` prop (default/prominent/critical → Phase 1 elevation tokens), optional sparkline + trend badge ("+12% vs yesterday"), `useCountUp` hook (rAF, 0.8s) |
| **FormInput/Select/Textarea** (`aurora/forms/`) | Error = border color only | Animated focus transition, error icon + one-time shake, optional success checkmark fade-in |
| **Skeleton primitives** (new, `aurora/feedback/`) | Bare `PageSpinner` (`ui/loading-state.tsx:13-27`), no label | `SkeletonCardGrid`, `SkeletonTable`, `SkeletonForm` using existing shimmer keyframe; `PageSpinner`/`LoadingState` gain `context` prop ("Loading journal entries…") |
| **Toast** (`aurora/feedback/Toast.tsx`) | ~~Built, **zero call sites**~~ ⚠️ now wired: ~84 `showToast` sites / ~29 files, `ToastProvider` mounted | Add `slide-in` entrance/exit polish; document the `showToast` pattern — ~~mass wiring is Phase 4~~ (mass wiring largely DONE) |
| **Modal/Drawer** (`aurora/overlays/`) | Entry-only `animate-scale-in` (Modal.tsx:33); snap-close; no backdrop fade | Backdrop fade-in, staggered entrance, `isClosing` exit animation (~150ms); new **ConfirmDialog** to retire `window.confirm` (mobile POS line 1256) |
| **EmptyState** (`aurora/feedback/EmptyState.tsx`) | Static icon + generic copy | Fade-in entry, contextual copy + CTA slot ("No orders yet — start one") |
| **MiniTrendLine / ProgressRing** (`aurora/charts/`) | Static SVG | Animated stroke draw-in, hover value tooltip |

*Component APIs are strictly additive (new optional props). Every page upgrades for free.*

### Phase 3 — Hero screens (the daily drivers)

**Login** (`app/(auth)/login/page.tsx:51-65` — audit: "zero brand presence")
1. Itemba/Westsides wordmark + tagline ("Your operations center").
2. Subtle gradient or hardware-line-art SVG background panel (split layout on desktop, stacked on mobile).
3. Animated focus states on fields; button uses new loading/success states.
4. **Delight:** on successful auth, a half-second brass check + "Karibu, [name]" before redirect.

**Dashboard** (`app/(dashboard)/dashboard/page.tsx:351-754` — audit: "no hero moment, dumps into 5 dense sections")
1. Open with a "Today's Pulse" hero card: 3–4 KPIs with sparklines + trend badges, gentle 3s pulse border.
2. Count-up numbers on load (Phase 2 StatCard).
3. Tier the five sections: Alerts get `critical` card treatment; Activity gets compact treatment.
4. **Delight:** live-pulse dot next to the greeting tied to data freshness.

**Sales Orders** (`app/(dashboard)/operations/sales-orders/page.tsx`)
1. Stats row → tiered StatCards with trends; mobile shows Orders + Revenue first (audit lines 1104-1109).
2. DataTable chevron sort + active-column highlight; filter toolbar visual grouping.
3. Wire `showToast` success/error to the save path (lines 338, 598-603).
4. **Delight:** "Sale #12345 confirmed ✓" success toast with brass check pop on order creation.

**Mobile POS** (`components/westsides/mobile-pos/mobile-pos-sale-entry.tsx`)
1. Cart-add pulse + smooth scroll-into-view; Vibration API buzz (50ms) on add — feedback only, zero logic change.
2. Replace `window.confirm` (line 1256) with branded ConfirmDialog.
3. Error states: input bounce/red flash instead of silent text (lines 1026-1058).
4. Receipt gets Westsides header flourish + "Asante!" line (lines 490-579).
5. **Delight (the signature moment of the whole programme):** ~~replace "Receipt ready." (lines 1335-1346) with a **Sale Complete card** — scale-up 0.9→1.0, brass checkmark, receipt #, total, then Print/Share/"Next sale" buttons.~~ *(⚠️ SHIPPED: the **Sale Complete card** now exists in `mobile-pos-sale-entry.tsx` (~lines 1923–1951) — `animate-scale-pop`, brass/amber checkmark, receipt # + total, "Posted" badge, and a 50ms vibration buzz on land.)*

**Westsides Hub** (`app/(dashboard)/westsides/page.tsx:423-500` — audit: "wall of 13 text buttons")
1. "Today's Priority" hero card (e.g. "5 high-risk receivables") with tone color + link, gentle pulse.
2. Regroup the 13 quick links into 3–4 groups with icons + one-line descriptions.
3. Health panels get status-tinted left edges.
4. **Delight:** daily-close completion gets a brass "Day closed ✓" moment.

*(Finance dashboard gets its narrative headline — "Group cash position is healthy" tone-driven line at `finance/page.tsx:103-120` — folded in here as a sixth, small item.)*

### Phase 4 — Motion & feedback layer (roll the energy through everything)
1. **Toast everywhere**: replace the ~60 silent `setError → red div` patterns (audit: `journal-entries/page.tsx:305-350`, `operations/page.tsx:130-144`, POS `:1026-1058`) with `showToast` calls. *Catch-block message routing only — fetch logic untouched.* *(⚠️ largely DONE: `showToast` is now wired across ~29 files / ~84 sites; remaining work is sweeping the last un-migrated `setError`-only spots, not building the system.)*
2. **Skeletons everywhere**: every `PageSpinner` becomes a contextual skeleton or labeled spinner.
3. **Count-up KPIs** across all dashboards (operations, finance, HR, compliance, westsides).
4. **Stagger** on dashboard card grids (50ms cascade) — *not* on large tables (see §7).
5. **Modal/drawer exit animations** live across the ~100 modal uses.
6. **Route-feel**: a thin top progress bar / content fade on navigation (CSS + a tiny layout wrapper; no route changes).
7. **Reduced-motion audit** + a Settings toggle to disable animations manually.

### Phase 5 — Consistency sweep + dark mode
1. Sweep remaining ~150 pages: replace stray emoji, raw hex, ad-hoc spinners, inline styles with Phase 1/2 tokens and primitives. Mechanical, reviewable in batches by module (finance → HR → compliance → security).
2. **Ship dark mode**: the `.dark` token block and Tailwind-class shim already exist in `globals.css` (lines 91+, 367+); add the topbar toggle + persistence, then QA module-by-module. Counter PCs on night shifts and phone POS in bright sun both benefit.
3. Copy-tone pass: "Executive operating rhythm" → "Today's operation" style warmth (audit's copy findings), strings only.

---

## 4. Guardrails — how we guarantee nothing breaks

1. **Presentational-file allowlist per PR**: changes confined to `src/styles/globals.css`, `tailwind.config.ts`, `src/components/ui/**`, `src/components/aurora/**`, `src/components/layout/{sidebar,topbar}.tsx`, and page-level JSX/className/copy edits. **Forbidden in diff review:** any line touching `fetch`/`backendPost`/`backendGet`, handlers' logic branches, permission checks, route files, or `next.config`.
2. **Gate per phase**: `tsc --noEmit` + `next build` + a route-smoke script hitting every page route for 200/render (the 200-page surface makes this non-negotiable).
3. **Additive component APIs only**: new optional props, no renames/removals — existing call sites compile unchanged by construction.
4. **POS protection**: mobile POS flows re-verified with the existing harness after Phases 2, 3, and 4; POS gets a hard "no animation on the input→add→total loop" rule — feedback fires *after* state commits, never gating it.
5. **Toast wiring rule**: in catch blocks we may *add* `showToast(...)` beside existing `setError`; we never alter try/catch structure or retry/submit logic.
6. **Reduced-motion**: every new keyframe lands inside the existing `globals.css:191-199` guard; CI grep for animations declared outside it.
7. **Visual regression spot-checks** on the six hero screens (before/after screenshots) at each phase merge.

---

## 5. Dependencies & choices for the owner

| Decision | Recommendation | Why |
|---|---|---|
| **Icon library** | **Lucide (`lucide-react`)** | Tree-shaken (only imported icons bundle, ~1KB each), stroke style matches the existing sidebar SVGs, fixes the emoji-vs-SVG inconsistency and OS rendering drift flagged in CommandPalette. |
| **Sparklines/charts** | **No library — hand-rolled SVG** | You already have `MiniTrendLine` and `ProgressRing`; sparklines are ~30 lines of SVG. Recharts et al. cost 100KB+ for what we don't need. Revisit only if real charting is requested later. |
| **Motion approach** | **CSS-first, no framer-motion** | framer-motion adds ~30–50KB gzipped to a POS app on Tanzanian mobile networks. Your keyframes are already written in `tailwind.config.ts`; the only JS needed is a ~40-line `useCountUp` rAF hook. |
| **Fonts** | **Keep Inter; no second font.** Add weight/size discipline (800 display numerals for KPIs, 600 headers, 400 body) and `font-variant-numeric: tabular-nums` on all money/qty columns | Inter is already loaded (`globals.css:1`); a second font costs load time and adds nothing a hardware ERP needs. Tabular numerals are the single highest-trust typographic fix for a financial app. |
| **Dark mode** | **Yes — Phase 5** | Tokens and the `.dark` compatibility shim already exist in `globals.css`; cost is mostly QA, payoff is real for night closes and bright-sun phone use. Don't ship earlier — sweep first so tokens are universal. |
| **Haptics** | Vibration API, progressive enhancement (Android Chrome only; silently no-ops elsewhere) | Free, zero-dependency POS confirmation feel. |

---

## 6. Effort & sequencing

| Phase | Scope | Effort | Risk | Visible payoff |
|---|---|---|---|---|
| 1. Foundation | 2 files: tokens + keyframes | **2 days** | Minimal | Low directly — unlocks everything |
| 2. Primitives | ~12 components in `ui/` + `aurora/` | **6–8 days** | Low (additive APIs + gate) | **High** — all 200 pages lift at once |
| 3. Hero screens | 5 screens + finance narrative | **6–8 days** | Medium (page JSX edits; POS harness re-run) | **Highest** — daily drivers transformed; POS celebration is the moment staff talk about |
| 4. Motion & feedback | Toast wiring (~60 sites), skeletons, count-ups, exits | **5–7 days** | Low-medium (catch-block additions only) | High — app finally *answers back* on every action |
| 5. Sweep + dark mode | ~150 pages mechanical + theme toggle | **6–10 days** | Low per batch | Medium-high — coherence + dark mode launch |

**Total: ~25–35 working days**, each phase independently shippable; stop after any phase and the app is strictly better.

---

## 7. What we will NOT do

- **No data-layer rewrite** — no TanStack Query, no fetch-pattern refactors, no optimistic-UI rollback machinery (the audit's optimistic-UI item is explicitly **deferred**: it requires handler refactors, which violates our constraint).
- **No route restructuring or API/backend edits** of any kind.
- **No breaking component-API changes** — every new prop optional, every default the current behavior.
- **No heavy animation on data tables** — no per-row animation on 50+ row lists, no animated sort reflows on large datasets; density and scan-speed win.
- **Nothing that slows the POS** — no animation gating input, no sound by default, no library weight added to the POS bundle; celebration fires after commit and respects reduced-motion.
- **No emoji-based "fun", no confetti libraries, no gamification** — energy comes from responsiveness and light, not noise. This is where money is counted.