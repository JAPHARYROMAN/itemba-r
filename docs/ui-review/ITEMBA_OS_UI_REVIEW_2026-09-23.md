# ITEMBA OS UI review — 23 September 2026 (paused; partial coverage)

Step 1 of the UI improvement plan: look at every surface signed in before changing anything. Reviewed in the owner's Chrome (Claude in Chrome), dark appearance, local build at `78ebcac5` + the menubar branch. Findings are ranked:

- **P1:** broken or hides something the user needs.
- **P2:** clearly wrong or inconsistent.
- **P3:** polish.

## Coverage so far

| Surface | Width | Status |
|---|---|---|
| Menubar (after restructure) | 767 (narrow mode) | Reviewed |
| Desktop home (greeting, shortcuts, widgets, dock) | 767 | Reviewed |
| App library | 767 | Reviewed |
| Control centre | 767 | Reviewed |
| Notification centre | 767 | Reviewed |
| Account menu | 767 | Measured (no screenshot: the tab was hidden) |
| Search, Msaidizi quick ask, window overview | 767 | Reviewed |
| Windows: Invoice Desk, Cash Desk, Sales Desk, Inventory, Payroll, Documents | 767 | Reviewed (first screen of each) |
| Reports, Settings, Fuel Grid launcher, ERP pages, POS | — | Not yet |
| Desktop, Reports, Settings, Inventory | 1536 (desktop mode) | Reviewed; finding 8 confirmed at this width |
| ERP sample: dashboard, journal entries, employees, sales orders, Westsides daily close, approvals, procurement requisitions | 1536 | Reviewed |
| Compliance, group control, security, integrations, CRM ERP areas | — | Not yet |
| POS office screens: enrolment, terminal setup, day reports, install | 1536 | Reviewed |
| POS till (new POS, uiVersion 3): sale screen, cart, pay panel | 1536 (till), 750 (tablet) | Reviewed; phone width not reachable (Chrome will not go below 750 px). No sale completed, to keep local ledger postings out. OS-skinned modules not yet |
| Any surface at 1024; re-confirming finding 1 at narrow width | — | Not yet (the controlled Chrome window is maximised and ignores resizing) |

**Review caveat.** Chrome reports the controlled tab as `hidden` (its window is not in front). Browsers pause animation frames in hidden tabs, so opening animations freeze on their first frame (a new window stayed at 94% scale for 16 s). Anything that looked mid-animation was re-measured, and findings caused by that were withdrawn (see "Withdrawn").

## Findings

| # | Pri | Surface | Finding | Evidence | Likely cause |
|---|---|---|---|---|---|
| 1 | P1? (unconfirmed) | App library, narrow mode | The title "Your apps" and the close button measured off-screen above the viewport. **Re-verify with the tab visible:** the panel uses a CSS scale-in animation, so the offset may be a frozen first frame like the withdrawn window findings. | Panel top at −63 px; header spans −62…17 px; viewport 826 px tall. | The shared dialog becomes a bottom sheet (`items-end`) whose max-height is 96dvh, but it is also lifted about 95 px to clear the dock, so its top overflows. |
| 2 | P2 | Desktop home, narrow | The "Make room for your best work" greeting still shows below 1000 px, pushing shortcuts and widgets down and forcing the desktop to scroll. | `.desktop-greeting` computes `display: block` at 767 px. | The narrow-mode rule in `desktop.css` hides it, but a later rule re-shows it. |
| 3 | P2 | Desktop shortcuts | The "…" options button floats at the corner of a 173 px cell, not beside the 72 px icon, so it reads as belonging to the gap or the next icon. | Options at x=171 against a tile centred at x≈110. | Options are positioned against the cell, not the icon. |
| 4 | P2 | Control centre | "Reduce transparency" and "Reduce motion": the checkbox is at the far left and its label is right-aligned at the far right, so each pair reads as disconnected. | Screenshot. | Label and control are in a space-between row. |
| 5 | P3 | Notification centre | The selected "Recent" tab is only faintly different from "Unread". | Screenshot. | Segmented-control selected state too subtle in dark. |
| 6 | P3 | App library | The search field shows a double outline: the rounded field border plus a square focus ring on the inner input. | Input outline 1.6 px, radius 0, inside a 12 px-radius wrapper. | The focus ring is on the input, not the wrapper. |
| 7 | P3 | Desktop home, narrow | The last widget card is cut at the scroll edge with no cue that more is below. | "Needs your attention" bottom at 841 px, workspace bottom at 738 px. | No scroll affordance. |
| 8 | **P1 (fixed, branch `os-ui-wave-1`)** | Inventory, Payroll (any app using the navigable-app frame) | The in-window navigation strip is unstyled: bare back/forward arrows, a home icon and the app name stacked like raw HTML at the top of the window. | No loaded stylesheet contains `.os-navigable-app`; its buttons compute to 16x16 browser defaults. | The rules live in `os-split-workspace.css`, imported only by `os-split-workspace.tsx`, which the live `DesktopShell` never renders. Fix: import them from `os-navigable-app.tsx` (or move them to `os-foundation.css`). |
| 9 | P2 | App headers across the desks and apps | Three different navigation patterns: the Desks use a large branded header card with icon tabs; Inventory has its own header with underlined tabs; Payroll uses a breadcrumb and a view dropdown. | Screenshots of Invoice/Cash/Sales Desk, Inventory, Payroll. | No shared app-header component. |
| 10 | P2 | Cash Desk | The section tabs overflow the window at narrow widths ("Supplier ba…" is cut) with no scroll cue or overflow menu. | Screenshot at 767 px. | Tab row has no overflow handling. |
| 11 | P2 | Search results | Account results show raw codes: "CASH_ON_HAND · TZS 0 · ITEMBA_ENT". | Search for "cash". | Enum and company codes rendered instead of labels. |
| 12 | P3 | Every Desk window | The app is named twice: the window title bar ("Invoice Desk") and a large header card directly under it ("Invoice Desk / Your purchase companion"). | Screenshots. | The window chrome and the app header both brand the app. |
| 13 | P3 | Msaidizi quick ask | Same double outline as finding 6: a square focus ring inside the rounded field. | Screenshot. | Focus ring on the input, not its wrapper. |
| 14 | P3 | Window overview, empty | "Your open apps will appear here." is styled like a heading, unlike the notification centre's empty state (icon, title, one line of help). | Screenshot. | No shared empty-state component. |
| 15 | P2 | Desktop widgets column (1536 px) | The "Needs your attention" card is cut at the column's bottom edge; its "Review approvals" link is half hidden. | Screenshot at 1536x770. | Fixed-height widget column with inner scrolling. |
| 16 | P3 | Desktop widgets column | The column scrolls with the browser's bright default scrollbar, out of place in the dark theme. | Screenshot. | No themed scrollbar on the widget column. |
| 17 | P2 (fixed, branch `os-ui-wave-1`) | ITEMBA-R window sidebar | "Reports" is listed twice, and the console logs React's duplicate-key error on every render ("two children with the same key, Reports": 4 to 7 per page). The OS apps (Fuel Grid, Invoice Desk, Cash Desk and the rest) also appear as sidebar sections beside the ERP's own. | Screenshots; console. | `sidebar.tsx` keys rows by `item.label` (line 1197); the "Reports" app leaf collides with the "Reports" section, and the app leaves are shown in this sidebar although `sidebarHidden` is set in OS mode. |
| 18 | P2 | ERP tables in the ITEMBA-R window | The right-most column is cut at the default window width (journal entries: the "POSTED" badge shows as "POST"; requisitions: "ACTION" cut). No scroll cue. | Screenshots at 1536 px. | Tables wider than the default ITEMBA-R window with hidden overflow. |
| 19 | P2 | Reduce motion (accessibility) | With "Reduce motion" on, windows still animate: 8 CSS transitions ran on `.desktop-window` elements after navigation. | `document.getAnimations()` with `data-reduced-motion=true`. | The setting disables Motion animations but not the window chrome's CSS transitions. |
| 20 | P3 | Payroll employees | The search placeholder is cut: "Search employees by nam". | Screenshot. | Fixed-width search field. |
| 21 | P2 | POS terminal setup | With a company, division and branch chosen, "Sales rep", "General Customer" and the receipt accounts can be silently empty, with no line saying why or what to set up first. A failed request looks the same, because each list falls back to empty on error. | Locally every branch of every company has 0 reps and 0 customers (all five requests 200, empty). | `mobile-pos-terminal-admin.tsx` loads them with `Promise.allSettled` and maps a rejection to `[]`; no empty-state text under the selects. |
| 22 | P3 | POS day reports | The empty state says "once a rep closes her day", which assumes every rep is a woman. | Page text. | Copy. |
| 23 | P3 | POS day reports | The card titled "Discounts given" also counts lines sold at a raised price ("line(s) sold at a changed price"). | Page text. | Title predates price raises (phase 5a). |
| 24 | P2 | POS terminal setup | "Sales rep" lists every employee at the branch, but the server only accepts an active employee linked to a user account. Picking any other one fails only on submit ("Could not create terminal", with the server's reason), and the form gives no hint beforehand. | POST /mobile-pos-lite/terminals → 400 "The selected sales rep must be an active employee linked to a user account". | The list comes from `/hr/employees` unfiltered; the rule lives only on the server. Filter the list, or mark ineligible reps. |
| 25 | **P1 (fixed, branch `pos-p1-fixes`)** | POS till and tablet layouts | The finishing button is below the fold: "Maliza Mauzo" (till) sits at y=1044 in a 627 px viewport, and "Lipa" (tablet) at y=1438 in a 376 px viewport. The whole page scrolls, so a cashier scrolls down to finish every sale (F12 still works on a keyboard till). | Measured at 1536x627 and 750x376 with 12 frequent products listed. | The three panels are grid rows as tall as the product list, and the button is pinned to the bottom of its column by a spacer. The body needs a fixed height (100dvh minus the header) with the product list and cart lines scrolling inside their panels. |
| 26 | **P1 (fixed, branch `pos-p1-fixes`)** | POS price editing | No one can edit a price: the price button never shows, because no user can hold `mobile_pos_lite.edit_price`. The permission rows do not exist in the database. Meanwhile terminal setup confirms "Reps may now lower prices by up to 10%". | Local DB has only manage, use, purchase and stock_count under `mobile_pos_lite`; admin (GROUP_SUPER_ADMIN, 894 permissions) lacks edit_price. | The permissions are only in `permission-matrix.ts` (seed). Production deploys skip the seed (`RUN_PRODUCTION_SEED` off), and migration `20260923150000_mobile_pos_price_overrides` does not insert them, unlike Sales/Cash/Invoice Desk, whose migrations insert their permissions and grant GROUP_SUPER_ADMIN. Same gap in production. |
| 27 | P2 | POS cart | An out-of-stock item ("Imeisha") goes into the cart with no warning on the line, and "Maliza Mauzo" is enabled. Whether the server then refuses the sale was not tested. | Added "Paint 4 Litre" (Imeisha). | `addProduct` does not look at stock, and cart lines do not show it. |

## Summary so far

- **Fix first (P1):** finding 8, the unstyled navigation in Inventory and Payroll (a one-line stylesheet import); finding 1 once confirmed.
- **Systemic (P2):** no shared app header (9), no shared empty state (14), tables and tab rows that clip instead of scrolling (10, 18), the sidebar duplicating apps and keys (17), reduce motion incomplete (19), raw codes in search (11).
- **Polish (P3):** focus outlines, scrollbars, truncated placeholders, the double app name.
- **Solid:** the reworked menubar, search, the notification centre, the account menu, the dock, the desktop at full width, the approvals inbox and its empty state.

## Fixed

- **8:** the frame's rules moved to `os-navigable-app.css`, imported by `os-navigable-app.tsx` itself. Checked live at `/inventory`: the strip computes to flex with 6px 14px padding and a 1px bottom border, and its buttons to 36px grids.
- **17:** the ITEMBA-R window's navigation (`LegacyNavigation` in `desktop-shell.tsx`; the review blamed `sidebar.tsx`, but the OS window renders its own list) now skips `sidebarHidden` apps and keys sections by kind. Checked live at `/dashboard`: 23 sections, "Reports" once, no app sections. A test fails on the old code.
- **25:** on tablet and till the sale screen now takes the viewport height, and the product list, cart lines and payment panel scroll inside themselves, with the finishing button pinned. Checked live: till 1536x826, "Maliza Mauzo" at y=733-791, page height = viewport; tablet (container 800 px), "Lipa" at 739-797 and the payment step's button at 733-791. Phone layout unchanged (rules apply from 640 px).
- **26:** migration `20260924090000_mobile_pos_price_edit_permissions` creates both permissions and grants them as the matrix does (edit_price: GROUP_SUPER_ADMIN, COMPANY_MANAGER, BRANCH_MANAGER, CASHIER, SALESPERSON; unlimited: the three managers). A test keeps migration and matrix in step. Applied locally: the price button shows and the price sheet opens.

## Withdrawn

- "Windows do not open maximised in narrow mode" and "a window's bottom sits behind the dock": both were opening animations frozen by the hidden tab. Re-measured, windows end maximised (8 px inset) and above the dock.
- "App library clipped" is limited to the library's bottom-sheet mode: search, control centre and notifications place their headers correctly.

- "Direct links are ignored" (daily close, requisitions): my batched navigation reported before the page loaded; sampled again, both links load correctly.
- "Windows are see-through" (desktop width): every window computes `opacity: 1` on a solid `rgb(9 17 31)` background; the ghosting was a cross-fade frozen mid-way when the tab went hidden again.

## Not defects (checked)

- The menubar after the restructure: search and Msaidizi, then windows, notifications and control centre, then the avatar, each group separated; no overflow at 767 px.
- The dock does not cover desktop content; the cut card is the scroll edge (finding 7).
- The account menu opens inside the viewport with the user's identity, Appearance and Sign out.
