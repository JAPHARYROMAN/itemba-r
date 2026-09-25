# ITEMBA OS — desktop gap closure

Implementation and local production-build verification against the 25 September runtime review. Changes are in the working tree on top of `4581a8e7`; no deployment or rollout flag change was made.

## Changes

- **Phone launcher:** panel height now accounts for its dock clearance and safe area. The header stays visible while the app list scrolls. At 390×844, the Close button moved from y=-68 to y=23, with a 44px touch target.
- **Return to work:** version 1 view snapshots are saved through the existing account-private workspace-session service. Explicit fields cover Invoice, Cash and Sales Desk lists, Documents view/company, Reports registers and Payroll lists; Inventory's main view/scope remains in its canonical URL. Form bodies, payment values, attachments and API responses are excluded. Server validation rejects unsupported fields. This does not add automatic recovery to previously unsupported forms.
- **Window switching:** normal dock clicks focus the latest window. A separate visible count button opens its window list/options. Titles and overview cards include view, company where authorised, filters and a stable short instance identifier. These are context summaries, not captured document screenshots.
- **Keyboard focus:** dialogs hand off focus after their exit animation to the chosen window and its last connected control. Minimising the active window selects the next visible window, including on narrow screens.
- **POS:** Point of Sale is in Apps and has an explicit `/pos` desktop host. It is a singleton terminal window. Existing `/mobile-pos` routes, device activation, terminal UI-version rollout, payment handlers and outbox remain in use. Window-local transport isolates POS history; scanner bursts and payment shortcuts are restricted to its active window. Closing a counter with unfinished inputs uses the unsaved-work guard.
- **Shared presentation:** all hosted apps share Back/Forward/Home navigation. Desk sections participate in local history. Shared heading/control rhythm, less repetitive sidebar copy and a smaller desktop welcome make more room for work. Recent apps condense on shorter desktops to leave room for approvals; widgets remain scrollable. Shortcuts use saved coordinates when returning from mobile widths, rather than allowing drag constraints to rescale their positions.

## Verification

- Backend production build passed; five workspace-validation tests passed, including view-field rejection and POS singleton enforcement.
- Frontend production build and lint of changed TypeScript files passed.
- 138 distinct frontend test cases passed across 20 relevant files (desktop recovery, navigation, focus, POS, scanner isolation, invoice/cash/sales, unsaved-work, app registration, release-switch and inactive-window dismissal regressions).
- Browser: two Invoice Desk windows were set to Itemba / Runtime A / Unpaid and Westsides / Runtime B / Paid. A full reload restored both exact contexts and their Invoices view.
- Browser: keyboard overview selection returned focus into the selected Invoice window after the exit animation. A normal dock click focused it without opening a dialog.
- Browser: launcher search found Point of Sale; opening it reached `/pos/activate` inside its desktop window, alongside the existing Invoice windows. Its options did not offer a second terminal window. No terminal was activated.
- Browser: at 768px, minimising POS exposed one Invoice window and document width matched the viewport.
- Browser: the final build opened all seven core app hosts, plus duplicate Invoice and POS windows. Each used the shared navigation bar and no app-host error was displayed. At 390px only the active window was exposed, with no page-width overflow. At 1920px Reports → Group Health retained its canonical deep link. The browser returned no warnings/errors in the sampled final checks.
- Browser: at 1280×720 the approvals action ended at y=567 inside its widget area (bottom y=583). Window-count buttons had distinct positions beside their corresponding dock icons. After 1280 → 768 → 1280 resizing, Invoice/Cash/Sales shortcut coordinates returned exactly to their prior values. A test shortcut move was restored to its original position.
- Browser: after session expiry and signing in again, all nine test windows and the two distinct Invoice filter sets recovered. Shortcut dragging was then verified without launching the app on release; desktop footer controls remain outside the shortcut fitting area.
- Browser: rapid Cash/Sales closing and inactive-window dismissal no longer recreated windows from delayed route commits. All verification windows were closed; the tab was left at `/desktop` with zero windows, the original Invoice shortcut position and the normal viewport restored. Frontend port 3009 and backend port 3014 remain running.

Logs: `tmp/desktop-gaps-frontend-build.log`, `tmp/desktop-gaps-backend-build.log`, `tmp/desktop-gaps-tests.log`, `tmp/desktop-gaps-business-regressions.log`, `tmp/desktop-gaps-registry-tests.log`, `tmp/desktop-gaps-final-window-tests.log`, `tmp/desktop-gaps-backend-tests.log`, and the corresponding `*-runtime.log` files.

## Acceptance still requiring a separate proof

This is local administrator verification, not staging acceptance across organisation roles. It does not certify physical POS hardware, live financial postings, every legacy form, cross-device permission expiry/interrupted submissions, or 60Hz performance with populated windows. No payment, approval, export or print transaction was performed in the browser. The previously saved, clearly labelled unsent Documents test draft remains private. Release enablement remains an explicit rollout decision.
