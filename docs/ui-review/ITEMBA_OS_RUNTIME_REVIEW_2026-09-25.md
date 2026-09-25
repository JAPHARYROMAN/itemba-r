# ITEMBA OS runtime review — 25 September 2026

Follow-up: the findings below describe the original audit. Implementation and fresh verification are recorded in [Desktop gap closure](./ITEMBA_OS_GAP_CLOSURE_2026-09-25.md).

Reviewed commit: `4581a8e7`. Local verification, approximately 07:08–07:19 EAT.

## Verdict

The persistent web-desktop direction remains intact. The seven core apps still have explicit independent hosts, and the desktop, launcher, dock, appearance service and private drafts are running. Later POS work and deployment safeguards have not replaced that architecture.

There is partial drift in delivery and consistency: the OS is disabled unless enabled at frontend build time; POS has a new standalone interface but no entry in the desktop's ten-app registry; and the shell's continuity, overview and mobile launcher still fall short of the agreed experience. This review does not certify the complete release.

## Environment and fresh checks

- Built the current backend and frontend successfully. Frontend compiled in 24.0 seconds, completed TypeScript in 38.5 seconds and generated 210 static pages.
- Started the freshly built frontend on `http://localhost:3009` and backend on port 3014. Existing local PostgreSQL and Redis containers were healthy.
- `/api/v1/health` returned `status: ok`, `database: up` (16 ms on the sampled request).
- Prisma reported all 157 migrations applied. No migration or seed was run.
- Local `NEXT_PUBLIC_ITEMBA_OS_ENABLED=true`; repository release default remains off.
- Used the existing signed-in Group Administrator session and local data. No financial transaction, approval or business-record submission was performed.
- Six focused test files passed: 24 tests covering the desktop model, release switch, navigation, dock motion, instance isolation and draft synchronisation.

Evidence logs (local, uncommitted):

- `tmp/runtime-frontend-build-20260925.log`
- `tmp/runtime-backend-build-20260925.log`
- `tmp/runtime-desktop-tests-20260925.log`
- `tmp/runtime-frontend-20260925.log`
- `tmp/runtime-backend-20260925.log`

## Confirmed in the browser

| Flow | Result and evidence |
|---|---|
| Home and launcher | `/` resolved to `/desktop`. Apps opened a searchable launcher with pinned, all and recent apps. `/apps` also opened that launcher. |
| Seven app hosts | Invoice Desk, Cash Desk, Sales Desk, Inventory, Payroll, Reports and Documents opened as separate windows. Payroll loaded six employee records; reporting sources reported Connected. Several local financial datasets were empty, so these were loading/navigation checks rather than transaction proofs. |
| Duplicate-window isolation | Invoice A held Itemba Enterprises / search `Runtime A` / Unpaid. Invoice B held Westsides / search `Runtime B` / Paid. Both retained their separate values while open. |
| Window controls | Half snapping, Show desktop and restore, minimise and restore through the dock's window list, pointer dragging, keyboard resizing, maximise and restore worked. |
| Window geometry | At 1920px, a Documents window moved to x344/y206, resized from 1080 to 1112px wide, maximised to 1880x922 at x20/y50, then restored to its prior bounds. Eight core-app instances were open during that check, including two Invoice Desk windows. |
| Layout persistence | A full reload restored the two Invoice windows and their left/right arrangement. Later reloads restored the larger window set. In-app filters were not restored; see finding 2. |
| Browser navigation | Reports → Group Health updated the canonical URL with `view=health` and the active instance marker. Browser Back returned to All reports; Forward restored Group Health. |
| Legacy compatibility | Manage borrowing opened `/group-control/loans-debts` in the ITEMBA-R window while retaining the desktop and other apps. |
| Basic keyboard flow | Ctrl+Shift+Space opened overview; Tab and Enter selected a window. Ctrl+Shift+L opened Apps; Escape dismissed it. Focus after overview selection needs correction; see finding 4. |
| Appearance | Appearance Studio exposed all six collections. Ocean selection changed the accent to `#007b99`; Aurora was restored. Light mode and reduced effects were applied and survived reload. At 768px, the active window had no backdrop blur and a computed transition duration of 0.00001 seconds with reduced motion enabled. |
| Responsive windows | Checked 390x844, 768x1024, 1440x900 and 1920x1080. At 390 and 768, only the active app was exposed in the accessibility tree, and page width equalled viewport width. Returning to desktop size retained the desktop window arrangements. This does not mean every app/form passed every size. |
| Private draft recovery | A document letter automatically showed `Saved · Private draft`. After Keep draft and full reload, Resume restored its exact subject/body and required review. Backend logs recorded draft/session/preference requests. |
| Concurrent editor protection | While the recovered letter was open in the first tab, Resume in a second tab was refused with `This draft is open in another window or device`. No competing write was attempted. |
| Browser errors | No console warnings/errors were returned for the main tab during the sampled desktop/app checks. The expected lease refusal was observed separately. |

## Findings

### 1. High: phone launcher Close control is outside the viewport

At 390x844, the launcher heading and Close button were above the visible screen. The Close button's rectangle was y=-68.2 to -24.2px. Closing with Escape and reopening directly at that width reproduced the issue. Search, pinned apps and the app list remained visible, but the touch dismissal control did not.

The launcher overlay reserves 95px below the panel on narrow screens while the shared modal permits a panel up to 92dvh. Constrain the launcher panel to the actual available height, retaining its header and scrolling only its body. Relevant code: `frontend/src/components/os/desktop.css` around lines 959 and 1546; `frontend/src/components/ui/modal.tsx` around line 213. This is a blocker for mobile launcher acceptance.

### 2. Medium: reload restores window positions but loses Invoice Desk context

Both Invoice windows returned to Overview / All companies after reload. The separate searches and payment-status filters disappeared. Instance isolation works during the session, but desktop restoration is incomplete as a return-to-work experience. Invoice Desk uses instance-scoped in-memory `useWorkspaceState`; the saved desktop session contains href and geometry, not those values.

Add explicit versioned app-view serializers or canonical URL state for non-sensitive navigation/filter settings. Do not put business draft contents into browser storage.

### 3. Medium: duplicate windows are difficult to identify

Overview showed two identical `Workspace Invoice Desk Open` cards. Its previews are app glyphs rather than a representation of the selected view. The dock list used Window 1 / Window 2. With multiple instances, clicking the dock icon opened an options dialog rather than immediately focusing the latest instance as described in the original plan.

Use descriptive instance titles and selected-view context; reserve an explicit secondary action for the full window list. See `desktop-shell.tsx` overview and dock handlers.

### 4. Medium: keyboard selection does not reliably return focus into the chosen window

After opening overview with Ctrl+Shift+Space and selecting the first card with Tab/Enter, the chosen window came forward but the observed focused element was the top-bar Window overview button. Coordinate overview dismissal/focus restoration so the chosen app receives focus. Full keyboard and screen-reader acceptance remains open.

### 5. Integration gap: POS is not an Apps launcher entry

The live launcher listed ten apps: ITEMBA-R, Fuel Grid, Settings and the seven core apps. POS was absent. The registry and explicit window-app list also contain no POS host. Direct navigation to `/mobile-pos` reached terminal activation, so the terminal boundary remains enforced. No terminal was bound for this review; the selling flow and hardware were not exercised.

Keep the standalone till for POS-only users, and complete the manager-facing desktop entry/host if POS is intended to be a first-class OS app.

### 6. Experience consistency remains unfinished

Invoice/Cash/Sales Desk, Inventory, Payroll, Reports and ITEMBA-R use different app-navigation and header patterns. Some app identity is repeated inside the window chrome. The desktop landing view also retains a large introductory message and a scrolling widget stack; at the initial 1280x720 size, the approvals widget extended below its visible region. These are finishing gaps relative to the desired restrained, cohesive desktop experience, rather than proof that the new POS or deployment changes removed the OS concept.

## Limits and remaining acceptance

- This was one local administrator account, not staging role coverage across company/division/branch users.
- The concurrent test used two browser tabs on one device. Cross-device leases, expired permissions, offline edits and interrupted financial submissions were not certified.
- Basic dragging worked, but 60Hz frame pacing, input latency and shell-induced long tasks with six populated business windows were not measured.
- No supplier payment, customer collection, payroll payment, loan repayment, export/print run, wallpaper upload or physical printer/scanner test was performed.
- Local startup logs reported single-process permission caching and the Next standalone/start-command warning. This run is not a multi-replica deployment rehearsal.
- The initial automatic appearance, Aurora collection and full transparency were restored; motion was returned to Follow device. Verification windows and temporary browser tabs were closed. A clearly labelled private letter draft, `Runtime verification — unsent test draft`, remains as recovery evidence; it was not sent, exported or submitted to company records.

## Recommended next implementation

Finish the existing OS experience before expanding its shell scope: fix phone launcher geometry, restore app view context, make duplicate windows identifiable, correct focus handoff, then integrate POS through the same app contract. Follow that with consistent app headers/navigation and the remaining staging, accessibility and performance acceptance checks. Keep deployment controls as rollout safeguards with an explicit OS launch decision.
