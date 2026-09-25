# ITEMBA OS — completion pass

25 September 2026. This continues the visual refinement with attention to dependable everyday behaviour. It is a verified improvement to the desktop, not a numerical claim that every release requirement is complete.

## Implemented

| Area | Result |
| --- | --- |
| Workspace recovery | Connection failures and revision conflicts preserve local windows and offer explicit retry, use-saved or keep-local choices. Lost save responses are reconciled against the server before retrying. Responses from a previous account cannot replace the current workspace. |
| Save feedback | Changes immediately show Saving, including the debounce period. Undoing a change before it is sent returns to Saved. Another session is described by its apps, window count and date; the current session is excluded. |
| Window menus | Menus focus the first available command, support arrows/Home/End/Escape, close on outside interaction and restore focus appropriately. Phone/tablet menus omit desktop-only arrangement commands. |
| Keyboard access | A fully covered desktop becomes inert. Show desktop restores its controls. Control Centre includes visible keyboard shortcut help and an attention indicator for failed synchronisation. |
| Motion | Launch/minimise/restore use the corresponding dock icon position. Show desktop has a separate transition. Reduced motion stops icon scaling and bounce, and hidden pages pause decorative dock motion and the clock update. |
| Contrast | Shared light secondary/muted text was darkened. Custom focus colours are derived for light and dark surfaces, with automated contrast checks. Business status colours are unchanged. |
| Verification | Corrected the route-smoke fixture and matcher for the existing optional catch-all POS route. Added an opt-in local timing panel; normal sessions do not start performance observers. |

The preceding [refinement pass](./ITEMBA_UI_REFINEMENT_2026-09-25.md) covers the quieter desktop, launcher, shared app title bars, responsive Records list and simpler forms. Those changes were retained.

## Live findings and evidence

1. **Window actions:** the previous compact menu exposed ineffective desktop arrangement commands. The new compact menu contains New window and Done, explains the full-size mobile layout, and Escape returns focus to the trigger. Desktop arrows moved focus from Restore to Maximise as expected.

   ![Compact window menu after correction](<C:/projects/Actual Projects/itemba-r/tmp/ui-completion-2026-09-25/05-phone-menu.png>)

2. **Control Centre:** workspace saving was acknowledged by the running backend. Other sessions now have distinguishing app names and timestamps. Conflict/connection outcomes were verified in controlled tests; no live conflict was induced against the user's account.

   ![Control Centre at tablet width](<C:/projects/Actual Projects/itemba-r/tmp/ui-completion-2026-09-25/06-tablet-control-centre.png>)

3. **Multitasking and recovery:** six windows were opened: Settings, two Records windows, Invoice Desk, Cash Desk and Reports. The original Records window retained Overview while the second retained Creditors. Refresh restored all six and the different registers. Snapping, restoring, minimising, showing the desktop and window overview were exercised. At 390px only the active window was exposed.

4. **Production timing:** a 15.8-second sample across 941 frames recorded **59.7 average fps**, **16.9ms p95 frame interval**, and **0 long tasks**. It included a drag, minimise/restore, show-desktop/return and overview. Six windows were mounted. This measures browser, app and review overhead together; it does not attribute costs exclusively to the shell. The available business dataset was small, so this is not acceptance of six large populated tables. Timing observers were off during builds and tests, and the diagnostic URL was removed afterward.

   ![Six-window production timing](<C:/projects/Actual Projects/itemba-r/tmp/ui-completion-2026-09-25/07-production-performance.png>)

5. **Responsive presentation:** the current production build was inspected at 390, 768, 1440 and 1920px. Launcher, window menus, Control Centre and Records remained usable. The prior pass separately exercised light/solid/reduced-motion modes and all seven core app hosts. This pass added numerical checks for shared light/dark tokens and custom accent extremes.

   ![Final launcher at desktop width](<C:/projects/Actual Projects/itemba-r/tmp/ui-completion-2026-09-25/09-launcher-final.png>)

Normal shared text is tested against a 4.5:1 threshold and custom focus indicators against 3:1. These checks follow the relevant [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) thresholds; they are not a full accessibility conformance claim. The lowest corrected light muted-token pair measured about 4.59:1 on the subtle surface.

## Verification record

- Full frontend suite: `npm run test:ci -- --maxWorkers=4` — **249 files and 2,425 tests passed** in 273 seconds. Earlier unbounded runs suffered widespread timeouts and intermittent asynchronous assertions under local load. A new session test was also corrected to wait for the acknowledged save, not merely the outgoing request.
- After the final save-status and reduced-motion refinements, **31 focused tests passed** across six suites. This includes seven session-recovery tests, window keyboard handling, dock motion, contrast, route coverage and Records.
- Targeted ESLint passed. Formatting corrections were applied, and `git diff --check` passed with existing line-ending warnings only.
- Both the reviewed production build and the final rebuild passed. The final build was restarted at `http://localhost:3009` against the existing backend on port 3014.
- Route smoke passed: **202 static routes and 30 dynamic samples**. Dynamic samples check rendering/404 tolerance, not real-record or permission correctness.
- The browser error log contained no entries during the production review. Backend readiness returned `status: ok` and `database: up`.

No business transactions, payments, approvals, employee records or existing drafts were changed during the live review. The temporary extra windows were closed; the original Settings and Records windows and the user's Graphite/Frozen Orbit appearance were retained. The viewport override was reset.

## Remaining release acceptance

- Longer profiling with large populated production-like tables, including sustained dragging and input latency on lower-powered hardware.
- Manual screen-reader review and remaining legacy workflow visual reviews; shared token checks do not cover every semantic colour or custom control.
- Window overview still uses app-level saved-draft availability; richer previews and a dedicated per-window unsaved-work indicator remain part of the original desktop specification.
- Staging transactions across company/division/branch roles, exports and printing, and real concurrent-device/interrupted-submit exercises. Regression tests cover many of these contracts, but the live pass was read-only for business data.
- Existing release operations work: opening-data reconciliation, migrations, restore/rollback and deployment packaging. The local start script still emits the pre-existing standalone-output warning.

These are concrete acceptance tasks, rather than reasons to add more desktop decoration or invent a completion percentage.
