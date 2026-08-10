# ITEMBA-R Simplification Plan — Rep-First, Swahili-First, Smaller

**Date:** 2026-08-10 · **Baseline:** commit `50e64841` (main) · **Companion:** `FEATURES_UI_REVIEW_2026-08-10.md` (209 findings; file:line evidence for every claim referenced below)

**Goal:** reduce complexity and improve efficiency through simplicity. The primary user is an under-qualified sales rep in Tanzania — possibly with little or no formal education, on a low-end Android phone, on patchy connectivity. The measure of success is: *a rep who reads only Swahili can sell, unaided, without training, and nothing the app shows them is a lie.*

## Guiding principles

1. **The rep's app is Itemba POS; the ERP is the office's app.** Reps never see the sidebar, the dashboard, or any of the 225 pages. One login → straight into the POS.
2. **Subtract before you fix; fix before you build.** Every page must earn its training cost. A deleted page can't confuse anyone, break, or need translation.
3. **Nothing fails silently.** For a low-literacy user a lying button is worse than an error — they assume *they* did something wrong. Every error message says what happened and what to do, in Swahili.
4. **Swahili first on rep-facing surfaces**, English as the toggle. (The payslip is already bilingual — extend that pattern, don't invent a new one.)
5. **No data risk.** All phases are UI/nav-level except one additive backend piece (daily-close persistence). No destructive migrations anywhere.

---

## Phase 1 — Itemba POS, rep-first (do first; zero office risk)

| # | Item | Where | Size |
|---|---|---|---|
| 1.1 | **Role-based landing**: users whose role is POS-only land on `/mobile-pos` full-screen; sidebar/topbar suppressed for them | `auth-context.tsx`, `(dashboard)/layout.tsx`, `login/page.tsx` | M |
| 1.2 | **Offline cold start**: open from cached binding/catalog when the session fetch fails offline; queue sales; re-verify when back online (today a cold start offline dead-ends on the splash gate) | `mobile-pos-lite.tsx:166-192,337` | M |
| 1.3 | **Visible sale queue**: each waiting/failed sale as a plain-language row ("Inasubiri mtandao" / "Imekataliwa — mwambie msimamizi") with supervisor-gated discard; today `lastError` is recorded but never shown and stuck sales retry forever | `mobile-pos-lite.tsx:120-127`, `mobile-pos-lite-store.ts:121-127` | M |
| 1.4 | **Numeric keypad for quantity** (today: +/- taps only; 40 crates = 40 taps) | `mobile-pos-lite.tsx:434` | S |
| 1.5 | **QR activation survives login**: carry the query string through the auth redirect (today `from` stores only pathname, so a scanned QR lands on an empty form) | `proxy.ts:38`, `login/page.tsx:107-108` | S |
| 1.6 | **Define the missing `--aurora-*-subtle` tokens** so POS status chips and the offline banner actually render visibly | `styles/globals.css` (7 usages listed in review) | S |
| 1.7 | **Swahili-first POS**: small dictionary module (sw default, en toggle) covering POS Lite, activation, install screens, and every POS error message | POS components | M |
| 1.8 | **Big-target product tiles**, optionally with product photos (one image per product) — a non-reader recognizes a Coca-Cola crate faster than any label | POS catalog screen (+ optional product image field) | M |
| 1.9 | **One name**: brand it "Itemba POS" everywhere; fix the install page pointing at the wrong route | `mobile-pos-install/routes.ts:3`, install page copy | S |

**Acceptance:** a phone restarted in airplane mode can open the app and queue a sale; a Swahili-only rep completes a sale unaided; a failed queued sale shows its reason and can be discarded by a supervisor; scanning the activation QR on a signed-out phone needs no retyping.

---

## Phase 2 — Subtraction pass (**veto list** — strike anything you disagree with)

### 2A. Delete now (dead or leftover; page/nav-level only, no data touched)

| Route / code | Why it's safe to delete |
|---|---|
| `/automation` (landing page only — **keep** `/automation/rules` + `/runs`) | Calls nonexistent `business-automation/summary`; permanently renders zeros |
| `/backups/restore-tests` (+ its link in the disaster-recovery checklist) | Calls a nonexistent endpoint; currently false compliance evidence |
| `/internal-controls` | Stub — four buttons with no onClick |
| `/operations/mobile-pos` | Duplicate mount of the Westsides sale entry |
| `/compliance/reports` | 2 of 3 tabs 404; the working tab renders raw JSON; real reports live in the catalog |
| `components/petroleum/CompanyBranchPicker.tsx` | Dead petroleum leftover, zero imports |
| Hotel KPI tiles in the Westsides cockpit | "No rooms configured" noise for a beverage/hardware business |
| Settings "Include planned" toggle | Inert — catalog has zero PLANNED entries |
| Unreachable status filter options (GRN INSPECTED/REJECTED/CANCELLED, three-way MANUAL_OVERRIDE, comm-log RESOLVED badge, 3 dead `/group-reports/*` catalog entries) | Options/entries that can never match or run |

### 2B. Consolidate (one way to do each thing)

- **POS: keep `MobilePosLite` only.** Retire one of the two remaining manual sale screens — recommendation: keep `/westsides/quick-sale` for the office counter, delete `MobilePosSaleEntry` (~2,740 lines, currently mounted twice). *(Decision 3 below picks the survivor.)*
- **Approval chains sized to real staffing**: HR transfer (5 approvals), disciplinary (2), termination (3) currently have **no UI at all** — documents enter states they can never leave. Collapsing each chain to a single approval server-side and adding one small Approve button is *less* work than building five-step UI, and matches an SME's actual control capacity. *(Decision 5.)*
- **Saved report views**: two mutually incompatible surfaces exist (runner uses catalog ids, admin page demands UUIDs; neither can ever save). Keep at most one — recommendation: delete `/reports/saved-views`, fix or drop the runner's save panel.
- **Scheduled reports**: the page claims nothing sends automatically while the dispatcher actually emails recipients contentless, undownloadable snapshots. Either hide the page *and* disable the dispatcher, or fix snapshot content + download. Half-alive is the worst state. *(Decision 6.)*

### 2C. Hide from production nav (keep code; admin/engineering tooling)

- `/data-isolation` (+issues, +test-runs) — internal QA tool; fix the `.map` crash only if kept anywhere
- `/background-jobs` (+queues) — gate admin-only; its unguarded Retry/Cancel-on-anything buttons must not meet normal users
- `/api-gateway/logs` — read-only log of an API nobody can provision keys for from the UI *(Decision 7 decides the section's fate)*

### 2D. Fix instead of delete (statutory or business-critical; small diffs)

- **The 9 tax pages** — TRA/VAT compliance is non-negotiable in TZ. Path fix (`compliance/tax-*` → `tax/*`), verb fix (POST→PATCH), `compliance/exports` → `data-exports`. Mostly one-line changes per call.
- **Westsides scaffold pages that map to real wholesale workflows** — price lists (add the missing items UI; the cockpit already nags "productsMissingPrice"), product-batches, stock-damage, package-movements, delivery-notes: replace raw-ID text fields with the existing `ProductPicker`/dropdowns.
- **Daily close persistence** — the one *addition* in this plan: one small model + one POST, because the control is already used daily on screen and silently loses the counts and sign-offs it collects.

### 2E. Business decisions — RESOLVED 2026-08-10

1. **Competitive sourcing: NO** → delete `/procurement/rfqs`, `/supplier-quotations`, `/bid-comparisons`, `/plans`; keep the working half (PO → GRN → supplier invoice).
2. **Three-way matching: KEEP** → fix its form contradictions and the `view`/`list` permission-gate mismatch (S).
3. **Manual sale screen: keep desktop `quick-sale`** → delete `MobilePosSaleEntry` and both of its mounts (`/westsides/mobile-pos`, `/operations/mobile-pos`).
4. **CRM extras: keep supplier performance only** → delete/hide customer segments, communication logs, contact persons; keep customer-statements and credit-profiles as planned.
5. **HR trims: NO to performance reviews, shift scheduling, multi-step transfer approvals** → delete `performance`, `shift-schedules`, `work-shifts`, `hr-documents`; collapse transfer/disciplinary/termination chains to a single approval; keep payroll spine + leave + attendance + disputes/disciplinary/medical.
6. **Scheduled/saved reports: KEEP (office relies on them)** → fix properly: runner save with real `ReportDefinition` ids, delete the incompatible `/reports/saved-views` admin page, fix scheduled snapshot content + add a download endpoint, correct the misleading banner.
7. **Integrations & public API: NOT live** → hide `/integrations` and `/api-gateway` nav groups entirely until needed.

**Expected result:** roughly 225 → ~170 pages (≈25 deleted, ≈20 hidden, ≈10 consolidated), before any Decision-list deletions.

---

## Phase 3 — Repair the survivors (contract fixes on pages that remain)

- **Finance**: PUT→PATCH on the 8 broken edit pages; refunds envelope parser; financial-statements result shape; **remove** the fiscal-year/period Delete buttons (no backend endpoint exists — subtract the button rather than add risk); make every DeleteConfirm/lifecycle action check `res.ok`.
- **HR (kept pages)**: align create payloads with DTOs; POST→PATCH verb fixes; leave submit→approve with real status values; **sidebar permission codes → the seeded codes** (`employees.view`, `payroll.view`, …) so the section becomes visible again; fix relation-object render crashes; fix `runId`/`periodId` param drift; replace UUID inputs with selects (the data is already loaded on most pages).
- **Compliance**: the 2D tax-path/verb fixes; tax cockpit + OSHA into the compliance hub grid.
- **Procurement (kept)**: GRN supplier-name lookup (UUIDs in CSV/PDF today); dead `search` params; ConfirmDialog on supplier-invoice Approve.
- **Operations**: fix the `/operations/procurement/grns` 404 quick action; Out-of-Stock card filter; add PurchaseOrder to movement reference links.
- **Dashboard/shell**: notifications unread-count + pager; drop the dead `?create=1` quick-create params or implement them; remove the three settings-catalog rows that 404.
- **Westsides**: light-theme readability on quotations/proformas/delivery-notes (hardcoded dark-on-light text); daily-close persistence (2D).

## Phase 4 — One language for money, errors, and defaults (app-wide)

- **One money format**: whole-shilling TZS with thousands separators, one locale everywhere; real currency codes on foreign amounts; never sum mixed currencies under one label.
- **One error standard**: all fetches through `lib/api-client.ts`; `res.ok` mandatory; toast + ErrorState-with-retry; lint rule banning `.catch(() => {})`.
- **Defaults over decisions**: auto-select a sole company (inventory hub already does), persist last company/branch per user, one primary button per screen, advanced fields behind "Zaidi".
- **One dialog language**: shared ConfirmDialog everywhere; delete every native `confirm()`/`alert()`/`prompt()`.
- **A11y at the primitives**: `forms.tsx` label `htmlFor`/`id` + `aria-invalid`/`aria-describedby`; ConfirmDialog focus trap and z-index above Modal — one fix each, inherited by the whole app.

## Guard rails — "without breaking the app"

- **Add `verify:contract` to CI**: a script that enumerates every `/api/backend/...` call in `frontend/src` and asserts path + method against the NestJS route table. This converts the entire class of Critical findings into build failures, forever. Sits beside the existing `verify:env` family.
- Keep `smoke:frontend-routes` in step with Phase 2 deletions (update its route list in the same PR as each removal).
- Small PRs per module; each phase independently shippable; Phase 1 touches no office workflow; deletions are page/nav-level only — no Prisma model is dropped.

## Sequencing

1. **Phase 1** (POS) — first, standalone, ~a dozen S/M items.
2. **Phase 2** — answer the 7 decisions, then the deletions land in days (they're removals).
3. **Phase 3** — module-by-module contract repairs, `verify:contract` landing first so every fix locks in.
4. **Phase 4** — rolling standard, enforced by lint/CI, applied opportunistically as pages are touched.
