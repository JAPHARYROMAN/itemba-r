# ITEMBA OS web workspace

## Goal

Deliver an Apple-quality operating environment entirely in the browser. ITEMBA-R,
Invoice Desk, Cash Desk, Sales Desk, Inventory, Payroll, Reports, Documents and
future custom apps share one coherent workspace. No bootable or native operating
system is in scope.

## Required outcome and evidence

| Requirement | Acceptance evidence | Status |
| --- | --- | --- |
| Desktop, app library and dock | Live desktop/mobile review; permission-filtered launching, search, pins and keyboard navigation | Implemented and reviewed |
| Consistent materials, typography and app identities | Light/dark visual review across shell and business apps | In progress |
| Fluid, accessible motion | Opening, switching and reduced-motion checks; no animation-dependent actions | In progress |
| Personalisation | Theme, density and backdrop persist per documented scope; settings tested | Implemented; preference scopes documented below |
| Workspace continuity | App filters, selected records and unfinished drafts survive switching; browser navigation and sign-out remain safe | View state and explicit session drafts implemented in Invoice, Cash, Sales, Documents, Inventory stock-entry workflows, category/family/unit/conversion definitions, product/variant/image editors and adjustment/damage actions, Reports schedules, reusable report-view forms/actions, statement imports/reconciliation reviews and accounting reviews (invoice/cash posting, account connections and supplier-payment linking), and Payroll onboarding, employee profile/statutory/banking/mobile-money edits, termination requests, pay-input allocations, contracts, attendance, leave requests/action notes, payroll runs, cash payments/reversals, salary advances, pay periods, leave types/allocations, employee assignments, departments, positions and allowance/deduction definitions; shared draft ownership protects concurrent windows; remaining editors and live draft review remain |
| Universal search and actions | Scoped app/record search and useful actions open their targets | App/page filters and Invoice Desk, Sales Desk, Cash Desk and Documents record connections implemented; remaining legacy destinations and live review pending |
| Files and quick previews | Documents source permissions, versions where supported, preview, save/export/print journey | Shared Quick Look connects the Documents library/detail, Invoice Desk attachments and generated business PDFs; remaining legacy integrations and live native-PDF/printing review pending |
| Notification centre | Scoped real activity, loading/error/empty states and navigation to source records | Implemented against existing inbox; automated and isolated live checks passed |
| Shared app controls and states | Forms, lists, details, loading/empty/error/success and permission states consistent across release apps | Pending |
| Focused and side-by-side work | Usable desktop workspace with full-screen mobile adaptation and keyboard access | Implemented for Invoice, Cash, Sales, Documents, Inventory, Reports and Payroll; live review remains |
| Performance and accessibility | Representative large lists, touch targets, contrast, focus restoration and reduced motion verified | Pending |

## Implementation decisions

- Evolve the existing React 19 / Next.js 16 application and Aurora components.
- Use Motion for deliberate layout and control transitions; honour device and app motion preferences.
- Introduce React Aria for complex accessible controls beneath ITEMBA styling.
- Preserve server authorization and existing unsaved-work protections throughout.
- Keep financial information on readable surfaces; reserve translucency for workspace chrome.
- Reuse existing brand assets and icon library, with distinct coordinated app identities.
- Never describe recent apps as live sessions unless they actually remain mounted.
- Do not cache arbitrary Next.js route children to simulate multitasking. Workspace
  retention must preserve routing context, identity boundaries and draft lifecycle.

The visual standard is calm, readable business software: precise type hierarchy,
consistent spacing and coordinated app icons, with depth and translucency in the
shell. Motion should explain opening, switching and progress while respecting
reduced-motion preferences. Each app must adapt to its actual window width and
keep keyboard focus, unfinished work and organisation scope predictable. New UI
technology earns its place by improving those interactions; visual effects alone
do not satisfy the quality target.

## Visual and interaction quality standard

The user's Apple-grade direction is the quality target for the entire browser
workspace. ITEMBA keeps its own identity. The acceptance standard covers what
people see and how each control behaves:

- **Composition:** clear type hierarchy, consistent spacing, restrained colour and
  coordinated app identities across the desktop, dock and app interiors. Dense
  financial screens must remain easy to scan at both supported densities.
- **Materials:** depth and optional translucency belong to navigation and window
  chrome. Records, amounts, forms and document content use crisp, readable
  surfaces. Light, dark and reduced-transparency modes need separate review.
- **Motion:** opening, switching, selection and progress explain what changed.
  Transitions remain interruptible and respect reduced-motion preferences.
  Motion is already the shared implementation foundation; it is not a reason
  to add decorative effects to every control.
- **Controls:** visible focus, predictable keyboard movement, generous touch
  targets, clear validation and focus restoration are part of the finish.
  React Aria is the existing foundation for complex accessible controls, styled
  with ITEMBA tokens. Adoption across remaining controls is still incomplete.
- **Window behaviour:** each app responds to its actual available width, supports
  focused and paired work, and preserves the user's place and explicit drafts.
  On small screens, the same task remains usable in one full-height view.
- **Responsiveness:** lazy app/editor loading, bounded list rendering and honest
  loading/error feedback keep the workspace responsive. Performance needs
  measurement with realistic data before accepting the release.

Modern techniques serve these outcomes. The existing React/Next.js, Motion,
React Aria and CSS container-query foundations are sufficient for this pass;
additional UI frameworks or visual-effect engines require a specific unmet need.
A successful build or automated test run does not certify visual quality.

## Current implementation and review

2026-09-19, isolated release rehearsal: web 3109, API 3114. Only synthetic
organisation and notification fixtures were used for live write checks.

- Shared desktop, dock and app-switcher identities, coordinated materials, a
  category filter, and narrower screen layouts are implemented. Invoice, Cash and
  Sales now use the same app glyphs inside their workspaces.
- Motion provides a shared transition policy, respecting app/device reduced
  motion. React Aria supplies the account menu's keyboard and focus behaviour.
- Appearance settings add backdrop, comfortable/compact density and reduced
  transparency. Backdrop, density and transparency are stored per account on this
  device. Existing theme and motion settings apply to this browser/device.
- The notification drawer uses the existing scoped inbox and safe source URLs.
  It supports unread/recent filters, refresh, marking read, and honest failure
  states. It renders outside the translucent header to avoid clipping, while
  retaining the shared light/dark tokens.
- An account-bound, in-memory workspace store retains explicit view state across
  app navigation. Invoice/Sales selected IDs are refetched through their normal
  authorised endpoints. Financial response objects and transaction commands are
  not saved in browser storage. Explicit draft retention now extends these four apps, as detailed below.
- Documents panels now follow the shared appearance tokens; document paper stays
  a readable paper surface.
- Modal focus restores the original opener, including dialogs launched from
  temporary account-menu and app-switcher items. Marking a notification read
  moves focus to the current inbox filter if its action disappears.

### Live checks

1. Desktop at 1440 × 960: ten permitted apps, app filters, dock, appearance menu,
   and keyboard app-switcher shortcut reviewed.
2. Mobile at 390 × 844: desktop, Invoice Desk and full-height notification drawer
   reviewed. With all apps pinned, horizontal scrolling stays inside the dock;
   the page does not expand horizontally.
3. Switching Invoice Desk → Cash Desk → Invoice Desk retained the invoice search
   and active view. This check did not exercise unfinished financial drafts.
4. The synthetic notification opened Invoice Desk and marking it read updated
   the unread count. Both light and dark drawer surfaces were reviewed.
5. Account menu → Appearance → close restored focus to Account menu in the live
   browser after the fix. Keyboard switching to Settings also opened correctly.
6. No browser errors were reported in the inspected console output; Motion's
   reduced-motion diagnostic was expected during the accessibility check.

Evidence is under `.release/os-design`. Accepted captures include
`03-documents-dark.png`, `06-mobile-desktop.png`, `07-mobile-invoices.png`,
`08-mobile-notifications.png`, `09-dark-notifications-full.png` and
`10-desktop-refined.jpg`. Browser captures are JPEG bytes even where the original
capture filename uses `.png`. `02-documents-before.png` was cropped and is not
accepted review evidence. The captures support layout review, not a pixel-perfect
or complete accessibility certification.

### Automated checks

- The full frontend run passed 1,576 tests, with no failed or skipped tests
  (`frontend-tests-final.json` and `.log`).
- Subsequent app-glyph and notification fixes passed 47 focused tests; the final
  notification and dialog focus changes passed 22 tests across three suites.
- Final targeted ESLint passed without warnings or errors. The production build
  passed, including TypeScript and all 209 static pages (`frontend-build.log`).
  The final focus tests are captured in `focus-tests-final.log`.
- The verified development preview on port 3109 was stopped for the production
  build. Automatic approval review subsequently blocked both detached and attached
  attempts to start the production preview, returning only "blocked by policy".
  The preview is therefore stopped; the rehearsal API was left running. This is
  not a staging or production deployment.
- Dependency audit evidence is in `dependency-audit.json`. It reports existing
  framework/toolchain advisories, including Next.js; the new Motion and React Aria
  packages were not listed as affected. This is not a clean security release.

### Draft continuity implementation (2026-09-19)

- Invoice Desk, Cash Desk and Sales Desk editors now offer **Keep draft** and an
  app-level **Pick up where you left off** list with resume and confirmed discard.
  Drafts retain input, organisation selections and meaningful identifying text.
- The navigation guard offers **Keep draft and continue** only when every dirty
  form can be retained and the destination remains in the known workspace.
  Existing forms without retention still use their original stay/discard guard.
- Retained drafts do not interrupt ordinary app navigation. Closing/reloading the
  tab, leaving the workspace or signing out still warns, including when the form
  itself is no longer mounted. The UI states that drafts last for this session.
- The store remains in memory and is destroyed at the existing account/company/
  permission boundary. It saves user input and source IDs, not entire fetched
  business records. It never submits or replays an operation on resume.
- Invoice and sale source records reload through their scoped detail endpoints.
  Cash movements and intercompany loans now have similarly scoped read endpoints;
  movement details return only entries belonging to accessible cash accounts.
- Changed invoice/sale versions or loan/reversal state require review of current
  details before saving. A prior attempted transaction keeps its request identity
  and original version for retry, so resuming does not silently mint a second
  payment. The backend remains authoritative about whether a retry can succeed.
- Letter drafts preserve company, content and output format together. Resuming
  reloads the current letterhead, export failure keeps the draft, and successful
  export clears its retained copy. Switching between unfinished letters uses the
  same unsaved-work protection.

Automated evidence:

- Seven draft-lifecycle tests cover unmount/remount, no automatic submission,
  failed-save retry identity/version, repeated review, unload/sign-out, account
  and permission changes, and confirmed discard.
- Two Documents tests cover company/content/format restoration and failed exports.
- Invoice Desk's integration test resumes an entered payment after app unmount,
  fetches the newer invoice version, requires review and posts the preserved input.
- Eighteen backend tests pass across Cash Desk scope reads, ledger behaviour and
  financial connections. The first invocation hit Node's default heap limit;
  rerunning with the repository's 8 GiB test-process allowance passed.
- Frontend TypeScript, targeted ESLint, the 209-page frontend production build and
  backend production build pass (`draft-frontend-build.log`, `draft-backend-build.log`).
- The initial full frontend run passed 1,588 of 1,589 tests. One existing POS test
  waited for any persisted draft rather than the expected line before refusing
  later storage writes. Its wait now requires that line. The final full run passes
  all **1,589 tests**, with no failures or skips, as recorded in
  `draft-frontend-tests-final.json`.

Live review of these new draft controls is **pending**. Port 3109 remains stopped
following the previous automatic approval rejection. The running rehearsal API
on 3114 still needs a restart to expose the newly built Cash Desk read endpoints.
No new browser or end-to-end API claims are made for this draft implementation.

### Side-by-side workspace implementation (2026-09-20)

- **Work side by side** in the window title bar opens a permitted companion app.
  Invoice Desk, Cash Desk, Sales Desk and Documents have explicit lazy-loaded
  workspace adapters. The main app keeps normal Next routing. Opening a companion
  from the dock restores its existing instance; it does not create a duplicate.
- Desktop users can drag the divider, use arrow keys (35–65%), press Enter for
  equal widths, or focus one app. F6 moves focus between the windows. At widths
  of 1,000 px or less, named app controls switch the visible window while both
  apps remain mounted; the hidden pane is inert.
- The four apps use container queries as well as viewport breakpoints, so narrow
  windows receive their compact layouts. Cash Desk's navigation scrolls within
  its rail. Dialogs render in the shared system layer, outside pane containment,
  retaining OS tokens, mobile form rules, reduced motion and focus restoration.
- Closing or replacing the companion protects only that window's active forms.
  Changing the main route preserves a mounted companion's work. Navigating to
  that companion's own main route protects it before removing the second copy.
  Entering standalone POS also protects companion work because it unmounts the
  OS shell. Sign-out, reload and unload still protect every window and kept draft.
- Confirmed saves in Invoice, Cash and Sales notify other open desks to refetch
  through their normal authorised endpoints. The signal contains only the source
  app ID. Refresh waits while an editor is open, preserving entered values and
  the original transaction version. This is in-tab invalidation, not a live
  multi-user feed, and it does not post or replay transactions.
- The companion, pane ratio and focus mode are session state. No extra financial
  data is written to browser storage, and the existing account/permission boundary
  still destroys the workspace session.

Automated verification:

- Nineteen new tests cover separate-window draft protection, same-app restoration,
  navigation collisions, standalone POS, mobile visibility, keyboard/pointer
  resizing, dialog placement/focus and linked-desk invalidation.
- The final frontend run passes **1,608 tests across 162 suites**, with no failures
  or skips (`split-frontend-tests-final.json` and `.log`). It uses four workers,
  and runs separately from the production build.
- The first full run, concurrent with the build, exposed a POS test timeout and
  a test that captured the earlier supplier-only autosave key. The latter now
  waits for its entered line before capturing that key. Its assertions and POS
  production code are unchanged. All 35 POS draft tests also pass independently
  (`split-pos-check.log`). An intermediate run observed source changes while it
  was active; `split-frontend-tests-intermediate.*` is not final release evidence.
- Targeted ESLint and whitespace checks pass. The final production build passes,
  including TypeScript and static page generation (`split-frontend-build-final.log`).

Live visual review is still pending: the web preview has not been restarted after
the earlier automatic approval rejection. There are no new screenshot, printing
or live transaction verification claims for this increment.

### Independent Inventory and Reports navigation (2026-09-20)

- Inventory and Reports now join the four existing companion apps. Each has its
  own in-memory view history with Back, Forward and Home controls, independent of
  the browser's main route. History is bounded to 40 entries and belongs to the
  existing account/company/permission session boundary.
- Inventory tabs, search, hierarchy filters and product profiles use that local
  context. Embedded catalog links stay inside Inventory; the standalone ERP
  catalog retains its normal product routes. Product return links carry their
  company, division, branch and search scope.
- Reports' filters, saved views, customer/supplier drill-downs, library, report
  runner and schedules use the same explicit navigation adapter. Links to other
  business apps still use normal main-workspace routing and its unsaved-work
  guard. Server authorization remains authoritative for every read or write.
- Local navigation protects only the companion's affected forms. If navigation
  removes the focused control, focus moves to the stable content region, including
  while an app view is loading. Persistent history controls keep their focus.
- Inventory, Reports and their shared record/profile layouts respond to pane
  width using container queries. Narrow record views release fixed heights and
  inspector clipping so content can scroll in the app window.
- Scheduled reports now use the shared system-layer dialogs for editing, run
  history and deletion. Entered schedule values are protected on dismissal and
  local navigation. Users without schedule-view permission do not issue schedule
  list requests. Schedule draft retention is covered in the later Reports
  continuity increment below.
- Report print actions select their source pane, and print styles remove shell
  chrome and clipping while excluding the other app. Ordinary browser printing
  selects the active pane. These print paths still require live browser review.

Automated verification:

- The final full frontend run passes **1,622 tests across 166 suites**, with no
  failures or skips (`navigation-frontend-tests-final.json` and `.log`). It runs
  with four workers, separately from the production build.
- Fourteen added tests cover app-local history/query isolation, guarded local and
  cross-app navigation, account changes, product/report route adapters, focus,
  hierarchy isolation, print-target cleanup, and scheduled-report dialog placement,
  unsaved work and denied permissions. The existing product-register test also
  checks its corrected embedded Inventory profile link.
- Targeted ESLint, TypeScript and whitespace checks pass. A broader whitespace
  scan found pre-existing trailing whitespace in the document-detail and user-role
  screens; those unrelated files were not edited for this increment.
- The final production build passes, including TypeScript and all 209 generated
  static pages (`navigation-frontend-build-final.log`).

Live review remains pending. A read-only listener check still finds the rehearsal
API on 3114 and no web preview on 3009 or 3109. The previous automatic approval
review blocked preview startup with only "blocked by policy" as its reason.
No additional browser, live transaction or printed-output verification is claimed.

### Payroll companion implementation (2026-09-20)

- Payroll now opens as a permitted companion through the existing workspace picker.
  Its adapter covers 25 explicit overview/register/tool routes and three detail
  routes: employee profiles, a run's payslips and an individual payslip. Employees,
  contracts, attendance, leave, organisation, pay inputs, periods, runs, payments
  and payroll reports reuse their current screens and authorized API operations.
- Payroll's sidebar, compact section selector, breadcrumbs and record links use
  local navigation when it is a companion and normal routing otherwise. Employee
  and payslip details receive explicit IDs; they do not read the main window's
  route parameters. The native routes retain thin parameter-reading wrappers.
- Existing draft guards inherit the companion's work scope. Leaving an edited
  employee profile protects that editor without clearing another app's draft.
  Broader Payroll draft retention and cross-route view-state retention remain open.
- Payroll, employee profiles, payslips and HR report layouts now respond to window
  width as well as viewport width. Payroll uses the shared desktop/dock app glyph.
- Shared confirmation dialogs now use the system layer, unique accessible titles
  and keyboard handling that yields to a nested dialog. They retain safe initial
  focus, trapping and focus restoration outside a narrow app pane.
- Payslip print actions identify their originating window. Payslip styles no
  longer globally hide other windows' contents just because a payslip is mounted.
  Actual page breaks, paper output and cross-window printing require live review.

Automated verification:

- Seven added tests cover the real Payroll picker registration, company-filtered
  employee-to-profile navigation, explicit record IDs, profile draft protection
  alongside another app's draft, payslip return/print selection, denied employee
  access, navigation-target coverage and confirmation focus/portal behaviour.
- The final full frontend run passes **1,629 tests across 168 suites**, with no
  failures or skips (`payroll-navigation-tests-final.json` and `.log`). The
  existing employee, payroll-run, payslip and payment workflow tests also pass
  after extracting the detail components from their native route wrappers.
- Targeted ESLint, TypeScript and whitespace checks pass. No backend contract or
  database change is part of this increment.
- The final frontend production build passes, including TypeScript and all 209
  generated static pages (`payroll-navigation-build-final.log`).

Live review is still pending. The listener check again found the rehearsal API
on 3114 and no web preview on 3009 or 3109. No further startup attempt was made
after the earlier automatic approval rejection ("blocked by policy").

### Inventory continuity implementation (2026-09-20)

- Inventory has one shared shelf for unfinished stock counts, batches and damage
  reports, and one active entry editor within its workspace. A draft can resume
  from any Inventory view. Standalone ERP registers offer the same editors with
  a shelf restricted to their workflow. Editors load only when opened.
- Kept drafts preserve entered quantities, notes, dates, supplier/batch choices
  and organisation context in the existing account-bound session memory. Resuming
  does not submit a transaction. The UI explains that reload, tab closure and
  sign-out clear these drafts. Current create permission is checked on resume;
  directory choices and stock data reload through their normal authorized APIs.
- Resumed stock counts compare current balances with their retained snapshot.
  Changed balances, or a missing original snapshot for an entered count, require
  explicit review. Keeping an unreviewed draft again preserves that requirement.
  Failed saves retain input; a confirmed successful save removes the kept copy
  and refreshes the current register. Approval/posting rules are unchanged.
- Adjustment, batch and damage registers retain filters, page and selected record
  ID across app switching. Their normal queries reload the data. Query/scope
  changes invalidate the visible selection; the Inventory and legacy ERP view
  states have separate namespaces within the same account session.
- Shared record inspectors use unique opener IDs and the actual app-pane width
  for keyboard focus. Closing returns to the correct list instance; a background
  data refresh does not take focus away from another control.
- Workflow testing exposed stock-count add/remove/retry controls inheriting
  submit behaviour. They now explicitly act as ordinary buttons. The shared
  directory-choice retry control received the same correction.

Automated verification:

- Fourteen added tests cover retained forms, changed/unknown stock snapshots,
  independent resumed lines, failed saves, current permissions and batch choices,
  fresh register data, scope boundaries, and inspector focus. An existing native
  stock-adjustment page test now waits for branch choices before checking that
  the selection control is enabled.
- The final full frontend run passes **1,640 tests across 169 suites**, with no
  failures or skips (`inventory-continuity-tests-final.json` and `.log`).
- The production build passes, including TypeScript and all 209 generated static
  pages (`inventory-continuity-build-final.log`).
- Targeted ESLint, TypeScript and whitespace checks pass. The changed-file list
  is `inventory-continuity-files.json` under `.release/os-design`. No backend
  contract or database migration is part of this increment.

Live review remains pending. The read-only listener check found the rehearsal
API on 3114 and no web preview on 3009 or 3109. The earlier automatic approval
review rejected preview startup with only "blocked by policy". No further start
attempt, live stock transaction or new browser/print verification is claimed.

### Reports continuity and shared form controls (2026-09-20)

- Reports schedules use the shared modal and Aurora form sections, with named
  company, report and saved-view choices, delivery help, inline errors and retry
  states. The new read-only schedule-options endpoint filters company choices by
  accessible scope and report definitions by their required permission.
- New and edited schedule drafts can be kept in account-bound session memory.
  Resuming an edit reloads the schedule; changed source details require review.
  Unsuccessful saves retain entered values. Successful saves remove the retained
  copy. Clearing a description or linked saved view now reaches the update API.
- Shared draft ownership reserves a kept draft while its source loads and gives
  one mounted editor control of it. Other windows cannot resume, overwrite or
  discard that draft until it is released. Missing drafts, late duplicate editors
  and drafts belonging to a different app cannot submit. This is local session
  coordination, not server-side concurrency protection between users or tabs.
- Inventory and its legacy ERP registers use the same ownership mechanism.
  Invoice, Cash, Sales, Documents and Reports share it too. A form that remains
  mounted after an exit action can still keep or save subsequent work.
- Repeated Aurora input, select and textarea labels now have distinct control
  IDs, correctly associated help/error messages and accessible required states.
  Report schedule actions wrap on narrow layouts. Live layout, keyboard and
  mobile review remains pending.
- The scheduler describes its current execution limits: four supported snapshot
  datasets, company/group scope and at most 500 rows. A linked saved view remains
  a reference; its filters are not applied by the current snapshot engine.
  Unsupported reports cannot be chosen for new scheduled snapshots. Existing
  custom cadence and dashboard-only records remain editable with explicit help.
- Schedule lists, draft-source reads and run-history requests cancel superseded
  reads. The schedules page retains its page in the workspace session. No
  automatic emails or new live business transactions were sent for this change.

Automated verification:

- The full frontend run passes **1,654 tests across 170 test files**, with no
  failures or skips (`reports-continuity-tests-final.json` and `.log`). Fourteen
  additional tests cover shared draft ownership, unavailable/foreign-app drafts,
  continued work after an exit action, the Inventory/ERP handoff, Reports schedule
  retention and source review, and repeated accessible form labels.
- The scheduled-reports backend suite passes **11 tests**, including the two new
  scoped-choice checks (`reports-continuity-backend-tests.log`). This uses service
  tests, not a live API/database rehearsal of the new endpoint.
- Frontend and backend production builds pass. The frontend build includes
  TypeScript and all 209 static pages (`reports-continuity-build-final.log` and
  `reports-continuity-backend-build-final.log`).
- Targeted frontend ESLint and changed-file whitespace checks pass. Backend
  ESLint reports zero errors and 31 existing warnings in the inspected scheduler
  files; those warnings are not claimed resolved. Evidence and the 20-file
  manifest use the `reports-continuity-` prefix under `.release/os-design`.

The web and API changes must be released together for named schedule choices.
The previously running rehearsal API has not been reloaded with the new endpoint.
No database migration is required for this increment. Live review remains pending
because automatic approval review previously rejected preview startup with
"blocked by policy"; no alternative startup method was attempted.

### Payroll onboarding and allocation continuity (2026-09-20)

- Payroll has a shared session-draft shelf across its views, including its
  companion window. Employee onboarding and allowance/deduction editors load
  only when opened and retain entered values through Keep draft or Keep draft
  and continue. Standalone registers use the same editors and filtered shelves.
- Onboarding preserves organisation selections, identity, statutory inputs,
  employment and payment details. Choices reload on resume; an unavailable
  selected branch, department, position or user account must be corrected before
  saving. Unselected optional directory failures do not prevent creating an
  employee in a verified company. Failed submissions preserve input. No employee
  is created on resume.
- Editing an allocation reloads the current record before opening its draft.
  Changed or unknown source versions require review, with current employee,
  company, category, amount, percentage, status, dates and notes visible beside
  retained input. Keeping an unreviewed draft preserves that review requirement.
  Existing payroll calculation/date-range limitations remain explicitly stated.
- The shared ownership guard prevents one kept draft from being edited or
  discarded by two Payroll/ERP windows simultaneously. Successful saves refresh
  mounted participating registers across the account session. This does not add
  a server-side version precondition or transaction replay/idempotency mechanism.
- Employee and allocation registers retain filters, page and selected record ID
  separately for each window. Records are fetched afresh, obsolete pages clamp
  to an available page, and query changes invalidate the inspected selection.
  Form submission IDs are unique when multiple editors are mounted.
- Allocation detail reads now apply the same company-grant scope as their list
  reads, preserving the requested record ID even when no grants are available.
  This enables permitted secondary-company resume while excluding ungranted or
  deleted records. The change also affects existing update/delete methods that
  use these detail reads. It is not a full audit of Payroll mutation permissions.

Automated verification:

- The final frontend run passes **1,664 tests across 171 test files**, with no
  failures or skips (`payroll-continuity-tests-final.json` and `.log`). Ten new
  workflow tests cover complete onboarding retention, optional-directory failure,
  unavailable choices, allocation version review, cross-window ownership and
  refresh, current permissions, fresh register selection and pagination.
- Eight new backend service tests pass across allowance and deduction detail
  reads, including secondary-company grants, ungranted/deleted records, empty
  grants and group principals (`payroll-continuity-backend-tests.log`).
- Both production builds pass. The frontend build includes TypeScript and all
  209 static pages (`payroll-continuity-build-final.log` and
  `payroll-continuity-backend-build-final.log`).
- Targeted frontend ESLint and changed-file whitespace checks pass. Backend
  ESLint reports zero errors and 20 existing explicit-any warnings in the two
  allocation services. The 15-file manifest is `payroll-continuity-files.json`
  under `.release/os-design`.

No schema migration is required. The API build must be deployed for the updated
allocation detail scope; the existing rehearsal API is still the previously
loaded build. No live employee, allocation or payment transaction was performed.
The read-only listener check found API 3114 and no preview on 3009 or 3109.
Automatic approval review previously rejected preview startup with only
"blocked by policy"; no further startup attempt or live visual/printing review
is claimed.

### Employee profile, statutory and banking continuity (2026-09-20)

- The three employee editors use the shared Payroll shelf, session drafts and
  window ownership guard. They can resume from Payroll home or the employee's
  standalone ERP profile. Drafts store only fields explicitly changed by the
  user, plus source ID, section and version; they do not store the fetched
  employee record. Closing/reloading the tab or signing out still clears them.
- Resume reloads the employee through the authorised detail endpoint. Unedited
  values come from that fresh record. Changed or unknown versions require
  review, with current values for edited fields shown alongside the draft.
  Keeping an unreviewed draft preserves the review requirement. Save sends only
  changed permitted fields, including intentional zero/false/null values. Name
  edits rebuild the display name using the fresh, otherwise unchanged names.
- Sensitive source values are excluded from controls and payloads without the
  existing sensitive-view permission. A retained draft containing sensitive
  edits cannot reopen without that permission. This complements the existing
  account/company/permission session boundary; it does not change the field
  permission model.
- Linked-account choices refresh for each profile editor. A newly selected
  account must still be eligible; missing choices require correction. Directory
  failure does not prevent saving unrelated profile fields or removing a link.
  Source-read and save failures retain the draft and provide retry feedback.
- Employee tabs retain selection per employee and window. Tab/panel and mobile
  account form IDs are unique across windows. Saving employee details refreshes
  participating mounted Payroll registers and employee profiles.
- Employee detail reads now use the shared company-grant scope while preserving
  the requested ID. Termination request and approval require company WRITE
  access explicitly, so an additional company READ grant cannot authorise these
  mutations. Existing maker-checker restrictions remain. No schema migration,
  payroll calculation change, automatic submission or transaction replay was
  added. There is still no server-side version precondition for profile updates;
  source review protects resume, not changes made by others after the editor opens.

Automated verification:

- The full frontend suite passes **1,674 tests in 172 files**, with no failures,
  skips or pending tests (`employee-edits-tests-final.json` and `.log`). Ten new
  workflow tests exercise profile/statutory/banking recovery, fresh source data,
  changed/unknown version review, failed saves, sensitive permissions, account
  lookup failure and explicit unlink, failed source reads, window ownership,
  cross-window refresh and retained keyboard tabs.
- Eighteen backend tests pass across employee detail scope, sensitive redaction,
  company write checks for termination, maker-checker, deletion and account
  selection (`employee-edits-backend-tests-final.log`).
- Both production builds pass; the frontend includes TypeScript and all 209
  static pages (`employee-edits-build-final.log` and
  `employee-edits-backend-build-final.log`). Targeted frontend ESLint reports no
  errors or warnings. Backend ESLint reports zero errors and 20 existing
  explicit-any warnings in the employee service. The 11-file manifest and
  source hashes are in `employee-edits-files.json` and
  `employee-edits-verification.json`; changed-file whitespace checks pass.

Evidence for this increment is under `.release/os-design`. The rehearsal API
still runs its previously loaded build; these backend changes are not deployed.
Live visual and printing review remains pending: the
read-only listener check finds API 3114 (PID 40732), with no frontend on 3009 or
3109. Automatic approval review previously rejected preview startup with only
"blocked by policy". No additional startup attempt or live write is claimed.

### Employee payment-account and termination continuity (2026-09-20)

- Mobile-money account creation/editing and termination requests use Payroll's
  shared draft shelf in both the app and standalone employee profile. Each
  editor retains entered values through app switching, reports failed saves,
  and submits only after an explicit action. Drafts retain the existing
  session-only lifetime and shared window ownership protection.
- Mobile-money resume reloads the employee and their account collection through
  the existing scoped endpoints. It requires review when the employee, account
  or account set changed, or relevant versions are unknown. Current account
  details and the current primary account are visible for comparison. Existing
  account drafts retain only edited fields, preserving fresh unchanged values.
  Account-set version metadata excludes mobile numbers and account names.
  Missing accounts keep the draft on the shelf; failed collection reads can be
  retried. New-account provider availability is checked against the fresh list.
- Termination resume reloads the employee and requires review of changed or
  unknown versions. A pending request or terminated employee blocks submission
  without losing the draft. Request permission is checked separately from
  employee-edit permission. The existing separate-person approval rule remains.
- The server now passes the full actor into mobile-account create/update,
  scopes employee/account reads and requires company WRITE access before
  mutations or primary-account demotion. Deleted employees/accounts and foreign
  company sources are rejected. An existing account cannot be moved to another
  employee. Create/update audit events include the employee's company.
- Termination request and approval use conditional writes. A request cannot
  replace an already pending request, and overlapping approvals cannot overwrite
  each other's recorded decision. Conditions include the employee/company and
  relevant request state; failures return a conflict for the user to review.
- Employee-related lists retain their page and selected ID separately per
  employee, section and window. Data reloads when returning, and removed pages
  clamp to an available page. Mobile-account inspection also retains selection.

No migration or payroll-calculation change is required. These editors do not
add a general server-version precondition or idempotent replay contract for
mobile-account writes. Source review covers resume; it is not a guarantee
against every change made after the editor opens. Live review and deployment
remain separate release gates.

Automated verification:

- The full frontend suite passes **1,683 tests across 173 files**, with no
  failures, skips or pending tests (`employee-actions-tests-final.json` and
  `.log`). Nine new workflow tests cover mobile-account and termination draft
  recovery, fresh-source review, failed reads/saves, missing records, current
  permissions, related-record selection and obsolete-page recovery.
- The targeted backend run passes **41 tests across five suites**, covering
  company-scoped reads and writes, deleted sources, account ownership,
  termination request/approval conflicts and maker-checker restrictions
  (`employee-actions-backend-tests-final.log`).
- Both production builds pass. The frontend build includes TypeScript and all
  209 static pages (`employee-actions-build-final.log` and
  `employee-actions-backend-build-final.log`).
- Targeted frontend ESLint reports no errors or warnings. Backend ESLint reports
  zero errors and 28 existing explicit-any warnings in the inspected files.
  Changed-file whitespace checks pass. The 15-file manifest and source hashes
  are in `employee-actions-files.json` and `employee-actions-verification.json`.
  Evidence uses the `employee-actions-` prefix under `.release/os-design`.

The rehearsal API still runs its previously loaded build; these changes are not
deployed. No live employee or payment transaction was performed. Live visual and
printing review remains pending because automatic approval review previously
rejected preview startup with only "blocked by policy". No alternative startup
method was attempted.

### Universal search and Desk record destinations (2026-09-20)

- The command palette uses the shared dialog and workspace tokens, with Apps,
  Pages & actions, Records and All filters. The app catalogue supplies names,
  identities, launch destinations and current permission requirements. The empty
  view offers permitted apps alongside available favourites and recent pages.
  Existing action commands open their normal workflows; search does not submit
  business transactions.
- A labelled combobox and grouped results expose the active option to assistive
  technology. Arrow keys move selection, Enter opens it, and Escape closes the
  dialog and restores its trigger. Pinning is a separate focusable control, so
  Enter on that button no longer activates an unrelated result. The dialog traps
  focus; results scroll independently, category controls wrap, and the input,
  category, retry and pin controls use at least 44-pixel touch targets.
- Record reads are debounced and aborted on query/filter changes, close and the
  exposed account/company/permission boundary. Results are keyed to the current
  query; a late response cannot replace it. Read failures remain visible even
  when no results are available and provide an explicit retry. Remote result
  destinations must be internal paths. Search queries and records are not saved
  to browser storage. Navigation continues through the unsaved-work guard.
- Invoice Desk invoices, Sales Desk sales, Cash Desk movements and Documents
  files now participate in the existing global-search endpoint. Queries require
  each source's view permission. Desk records use both company and organisation
  grants; cash movements are visible through an accessible account, with only
  accessible account names included. Documents match their existing company
  scope and exclude deleted records. The per-source result limit remains bounded.
  This does not change Documents' existing confidentiality/organisation model
  or constitute a fresh access audit of every legacy search source.
- Invoice, sale and cash results open their exact record using a `record` query
  parameter and fetch current details through the owning app's authorised read.
  Closing a target removes that parameter. Companion windows receive no route
  target. Cash inspection now retains a selected ID and fetches details afresh,
  including linked-loan metadata so the existing reversal restrictions remain
  available. Missing or inaccessible details show retry feedback without a
  write. Document matches open the existing document detail/preview route, which
  already belongs to the Documents app in the OS registry.

Automated verification:

- The full frontend suite passes **1,698 tests across 174 files**, with no
  failures, skips or pending tests (`search-tests-final.json` and `.log`). Nine
  palette tests cover permitted app discovery, accessible semantics, keyboard
  selection, focus restoration/containment, pinning, failed reads/retry, stale
  requests, account changes, safe destinations and unsaved navigation. Six
  additional Desk tests cover direct record opening, current detail reads,
  inaccessible records, close behaviour and linked-loan controls.
- **16 backend tests pass across two suites**, using the actual company and
  organisation scope services for search fixtures. Coverage includes company,
  division and branch roles, missing/secondary grants, denied company selection,
  inaccessible transfer entries, deleted documents, permissions and bounded
  results (`search-backend-tests-final.log`). These are service tests, not a live
  database/API rehearsal.
- Both production builds pass, including the frontend TypeScript check and its
  209-page generation stage (`search-build-final.log` and
  `search-backend-build-final.log`). The three Desk entry routes resolve their
  search target from the request's query parameters.
- Targeted frontend ESLint reports zero errors or warnings. Backend ESLint
  reports zero errors and six existing explicit-any warnings in the Cash Desk
  draft-read test. Changed-file whitespace checks pass. The 20-file manifest and
  final source hashes are in `search-files.json` and `search-verification.json`;
  evidence uses the `search-` prefix under `.release/os-design`.

No schema migration is required. The web and API changes must be released
together for the new record connections. Live desktop/mobile, printing and
large-data review remain outstanding; the previously running rehearsal API has
not been reloaded. Automatic approval review previously rejected preview startup
with only "blocked by policy"; no alternative startup method was attempted.

### Shared Quick Look file previews (2026-09-20)

- Documents library files, Invoice Desk attachments and generated business PDFs
  now open in one shared Quick Look dialog. Document detail pages use the same
  preview pane. The dialog uses the existing OS materials, controls, focus trap
  and focus restoration. Previous/next file controls keep focus inside the
  current dialog, including when opened above an invoice's detail dialog.
- PDF and supported images use authenticated binary reads and temporary object
  URLs. Images have fit/zoom controls; text and Word text previews stay escaped;
  spreadsheet previews expose one selectable worksheet at a time. Existing
  parser limits and truncation notices remain visible. Unsupported formats keep
  an explicit original-file download. This does not add native Word editing,
  full spreadsheet calculation or new Invoice Desk upload formats.
- The viewer lazy-loads when opened. File/version and exposed account, company
  or permission changes discard prior preview state. Requests abort on changes
  and close; obsolete responses are ignored and object URLs are revoked.
  Loading, denied, failed-read, failed-download, empty and retry states are
  explicit. Content stays out of persistent browser storage.
- Download always makes a fresh authorised read. Binary reads use the existing
  session refresh/expiry behaviour. PDF/image bytes must have the expected safe
  response type before embedding. File identities select a known source adapter;
  callers cannot pass arbitrary preview URLs. Preview and download responses use
  private, no-store caching headers.
- Generated PDFs open within the workspace after generation. The Preview PDF
  action reopens that artifact without generating it again. A changed source or
  account discards the old artifact state and aborts pending frontend work;
  aborting does not undo a generation already accepted by the server.
- Invoice attachment preview checks the same invoice/company/organisation scope
  and attachment ownership as download. Generated previews reuse download's
  company and source-type permissions, then the existing document-file checks.
  General generated-file access alone does not grant access to payroll PDFs.
  This preserves the existing scope model; it is not a new audit of every
  generated source record's branch grants or Documents confidentiality rules.
- The PDF viewer provides an explicit authenticated browser-opening fallback and
  guidance for its native print controls. Wrapping toolbars and independently
  scrolling content support compact layouts. Native PDF rendering, keyboard
  interaction inside its frame, printing and live mobile layout still require
  browser review.

No schema migration or duplicate file storage is introduced. The web and API
changes must be released together for the new preview endpoints. No live
transaction, backend restart or deployment was performed for this increment.

Automated verification:

- The targeted frontend run passes **46 tests across five files**, covering
  library and invoice previews, worksheet selection and escaped content,
  nested-dialog focus and Escape, protected binary reads, current permissions,
  obsolete requests, download failures/retry and generated-artifact reuse
  (`files-targeted-initial.log`).
- **77 backend tests pass across three suites**, covering attachment ownership,
  parent invoice scope, format checks, cache/inline headers, generated source
  permissions, company restrictions, missing files and the existing bounded
  document parsers (`files-backend-tests-initial.log`). These use service and
  controller fixtures; they are not a live API/database rehearsal.
- Targeted frontend ESLint reports no errors or warnings. Backend ESLint reports
  zero errors and 37 explicit-any warnings in the inspected generated-document
  service and tests. The backend production build passes.
- The first full frontend run exposed an existing asynchronous product-refresh
  test race: closing the delete dialog did not guarantee the refresh effect had
  run. The assertion now waits for that refresh while preserving its failed-delete
  checks. Initial evidence is retained as `files-tests-first-full.json` and `.log`.

- The final full frontend suite passes **1,712 tests across 175 files**, with no
  failures, skips or pending tests (`files-tests-final.json` and `.log`). Both
  production builds pass, including the frontend TypeScript check and 209-page
  generation stage (`files-build-final.log` and `files-backend-build-final.log`).
- Changed-file whitespace checks pass. The 24-file manifest and final source
  hashes are recorded in `files-files.json` and `files-verification.json`. Evidence
  uses the `files-` prefix under `.release/os-design`.

Live review remains pending because automatic approval review previously rejected
preview startup with only "blocked by policy". No alternative startup method was
attempted. The rehearsal API has not been reloaded with these changes.

### Contract, attendance and leave continuity (2026-09-20)

- Employment agreements, attendance creation/editing and new leave requests now
  use the shared Payroll draft shelf. Contract termination reasons and leave
  approval/rejection/cancellation notes can also be kept. The same editors work
  inside Payroll and on standalone register routes. Drafts remain in memory for
  the current account session and never submit merely because they are resumed.
- Editing attendance retains only changed fields. Resuming reads the current
  record through the existing detail endpoint, merges fresh unedited fields and
  requires review when its version is unknown, changed or its approval changed.
  Current dates, status, approval, times and notes remain visible for comparison.
  A notes-only save preserves the server's exact unedited clock timestamps.
- Resuming contract or leave actions reloads their source record, checks current
  action permissions and presents fresh status, dates, terms/reason and approval
  information. Changed or unknown versions require review. Actions no longer
  available for that state are disabled without discarding entered notes. The
  server remains responsible for final authorisation and business-state checks.
- New forms reload available companies/employees and active leave types. Removed
  choices cannot be submitted using retained IDs. Choice and save failures keep
  input visible and offer the existing retry controls. Simultaneous clicks are
  guarded while a request is pending; editors have unique form IDs across panes.
- Draft source reads abort when navigating or replacing an editor, and ignore late
  responses. Existing shared ownership keeps a resumed draft in one window. A
  successful save updates Payroll's shared record revision so other mounted
  registers reload their current data.
- All three registers retain filters, search, page and selected record ID per
  workspace window. Returning fetches current records without resetting the saved
  page merely because the page mounted. If that page no longer has rows, it
  returns to an available page. Scope/filter changes do not expose the previous
  selection under the new query.
- Shared dialog, form, notice and list components preserve the existing ITEMBA OS
  styling and unsaved-work guard. Editor code loads on demand; list filters no
  longer load employee choices until a person-editing form opens. Existing
  workflow tests now wait for those asynchronously loaded editors.

This increment changes frontend workflow continuity only. It introduces no schema
migration, server scope-policy change, payroll calculation change or automatic
transaction replay. Source review occurs when resuming; there is no new server
version precondition guaranteeing that a record cannot change again before save.
Existing backend company/organisation policy limitations remain a release gate.

Automated verification:

- **50 targeted tests pass across five files**, including 12 new integration
  cases for contract/attendance/leave recovery, changed attendance fields and
  approvals, failed source reads/saves, revoked permissions, late responses,
  inactive leave types, retained pages/filters/selections and shared draft
  ownership (`people-targeted-final.log`). Existing tests continue to verify
  overnight times, null clears, approval separation and inclusive leave dates.
- The complete frontend suite passes **1,724 tests across 176 files**, with no
  failures, skips or pending tests (`people-tests-final.json` and `.log`).
- The frontend production build passes, including TypeScript and the 209-page
  generation stage (`people-build-final.log`). Targeted ESLint reports zero
  errors or warnings. Changed-file whitespace checks pass.
- The 16-file manifest and final source hashes are in `people-files.json` and
  `people-verification.json`, under `.release/os-design`. No backend code changed,
  and this frontend verification is not a new end-to-end permission audit.

Live mobile, keyboard, date-picker and printing review remains pending. Automatic
approval review previously rejected preview startup with only "blocked by policy";
no alternative startup attempt, live transaction or deployment was performed.

### Payroll run, payment and advance continuity (2026-09-20)

- New payroll runs, cancellation notes, cash payment/reversal details, salary
  advance requests and approval amounts, and legacy salary-payment reversal notes
  use the shared Payroll draft shelf. Forms resume from any Payroll view or their
  standalone register. They load on demand and retain the shared dialog, form,
  feedback and unsaved-work behaviour. Drafts remain in the current session;
  reopening a draft never submits it.
- Payroll runs, salary payments and salary advances retain company/status filters,
  search, page and selected record ID per window. Returning to the same run URL
  preserves manual filters and pagination. A different company/period/status deep
  link applies its new scope. Registers fetch current records and recover from an
  empty obsolete page. Successful saves refresh participating Payroll registers.
- Resuming record actions reads the current source through its existing authorised
  endpoint and rechecks the required permissions. Changed or unknown versions
  require explicit review. Current status, amount and company are visible;
  unavailable actions preserve entered notes while preventing submission. Source
  read failures leave the draft recoverable, and late reads after navigation are
  ignored. New run and advance forms reload their period and employee choices.
- An attempted payroll cash payment retains its original request ID, account and
  business date. An attempted reversal retains its original movement, date and
  reason. Those inputs remain locked after failure and after keeping/resuming the
  draft. An explicit retry uses the exact original request, including when the
  source now reflects a committed payment/reversal or account choices cannot load.
  This uses the existing server duplicate protection and does not automatically
  replay a transaction. Current permissions still apply.
- An unattempted reversal is also pinned to its original cash movement. If a newer
  payment replaces it, the kept reversal cannot silently switch targets. Advance
  approval amounts are validated against the freshly read request. A legacy salary
  record that becomes reversed or connected to a cash movement cannot be reversed
  from its old draft; connected payments use Payroll runs.

This increment changes frontend continuity only. There is no schema migration or
new server version precondition. New run/advance creation and legacy salary-record
reversals do not gain payment-style idempotency. Advance disbursement retains its
existing journal behaviour; the legacy salary reversal still updates its record
and audit history only. Existing financial-connection and organisation-permission
release gates remain open.

Automated verification:

- **59 targeted frontend tests pass across five files**, including 13 new
  integration cases for navigation recovery, changed net pay, exact payment and
  reversal retries, stale movement rejection, lost source access, revoked journal
  permission, late reads, changed advance limits, removed choices, legacy reversal
  restrictions and retained list scope (`pay-cycle-targeted-final.log`). Existing
  workflow tests now wait for the lazy dialogs and their asynchronous choices.
- **25 existing backend tests pass across three suites**, covering payroll cash
  duplicate requests, permissions, dual sign-off and advance payment behaviour
  (`pay-cycle-backend-targeted.log`). No backend code changed, and these fixture
  tests are not a live transaction or organisation-role rehearsal.
- The complete frontend suite passes **1,737 tests across 177 files**, with no
  failures, skips or pending tests (`pay-cycle-tests-final.json` and `.log`).
- The frontend production build passes, including TypeScript and all 209 static
  pages (`pay-cycle-build-final.log`). Targeted ESLint reports zero errors and
  warnings. Changed-file whitespace checks pass, and all 16 frontend files match
  the source freeze used for the full test/build run.
- The 17-file manifest, including this checklist, and final hashes are recorded in
  `pay-cycle-files.json` and `pay-cycle-verification.json` under
  `.release/os-design`.

Live mobile, keyboard, date-picker and printing review remains pending. Automatic
approval review previously rejected preview startup with only "blocked by policy";
no alternative startup attempt, live transaction or deployment was performed.

### Leave policy, allocation, assignment and pay-period continuity (2026-09-20)

- Pay-period creation, leave-type creation/editing, leave allocations and employee
  assignments now use Payroll's shared session draft shelf. They resume from any
  Payroll view and use the same lazy-loaded editors on standalone register routes.
  Forms retain entered choices, dates, notes and settings through explicit keep,
  app navigation and failed submissions. Resuming never submits a transaction.
- Leave-type edits, allocation adjustments and assignment edits retain only
  changed fields. Resuming reloads the current source and combines it with those
  edits. Untouched policy settings, entitlement totals, timestamps and transfer
  status are neither restored from an old draft nor resubmitted as changes.
  Explicit annual-allowance clears still send null; assignment branch/end-date
  clears send null; clearing allocation notes sends an empty string.
- Allocation adjustments show current used days and calculate the prospective
  remaining balance against current carry forward. Their upsert sends only edited
  allocation amounts/notes alongside the fixed employee, company, type and year;
  it never changes recorded usage. New allocations require currently available
  company/employee choices and an active leave category.
- Assignment edits show current placement and approval state. Company, division
  and employee remain fixed; transfers continue through a new assignment and the
  existing approval workflow. A retained status change cannot activate a now
  pending transfer: the form explains the conflict and lets the user restore the
  current status while keeping other edits. New assignments reload and validate
  employee, company, division and branch choices before submission.
- Changed or unknown record versions require explicit review. Source-read failures
  leave the draft recoverable; late reads after navigation are cancelled/ignored.
  Current view/manage permissions are checked before source reads and on save.
  Permission loss while a form is open now has explicit feedback, disabled saving
  and a usable Keep draft action. New employee selectors require directory access;
  existing fixed-identity adjustments do not need to refetch employee choices.
- All four registers retain filters, search, pagination and selected record ID
  per workspace window. Returning still fetches current records, preserving page
  position unless that page is now empty. Changing query scope clears the prior
  selection. Successful shared-editor saves refresh participating Payroll views.
  Existing status/deactivation/delete confirmations retain their normal behaviour.

This is a frontend continuity change using the existing service contracts. No
schema, financial posting or organisation authorisation policy changed. Drafts
remain in memory for the account session and are cleared by tab reload/close or
sign-out. Reading a current source on resume does not introduce a server version
precondition or guarantee that another user cannot change it again before saving.
Existing organisation-scope and end-to-end release gates remain open.

Automated verification:

- **71 targeted tests pass across six frontend files**, including 24 new
  integration cases. Coverage includes kept new/edit forms, current-source merging,
  explicit clears, changed usage and transfer approval, missing choices,
  permission loss, failed reads/saves, late source responses, retained filters,
  selections and pagination, and recovery from an obsolete page
  (`setup-targeted-final.log`). Existing workflow tests now await lazy editors;
  payload assertions verify that untouched fields are omitted.
- **11 existing backend tests pass across three suites**, verifying scoped
  queries, assignment date/branch clears and transfer restrictions, and nullable
  leave allowances (`setup-backend-targeted.log`). No backend source changed.
  These fixtures do not prove live organisation-role or concurrent-user behaviour.
- The full frontend suite passes **1,761 tests across 178 files**, with no failed,
  skipped or pending tests (`setup-tests-final.json` and `.log`). Targeted ESLint
  and TypeScript checks pass without errors; ESLint also reports no warnings.
- The frontend production build passes, including TypeScript and 209-page
  generation (`setup-build-final.log`). Changed-file whitespace checks pass.
  All 18 frontend source/test files match the source freeze used by the full
  suite and build. The 19-file manifest and final hashes, including this checklist,
  are in `setup-files.json` and `setup-verification.json` under `.release/os-design`.

Live mobile, keyboard, date-picker and printing review remains pending. Automatic
approval review previously rejected preview startup with only "blocked by policy";
no alternative startup attempt, live transaction or deployment was performed.

### Department, position and payroll-type continuity (2026-09-20)

- Department, position and allowance/deduction definition forms now share Payroll's
  session draft shelf and lazy-loaded editors. They can resume from Payroll home
  or standalone registers, retaining entered hierarchy, role, defaults and code
  choices without automatically submitting. Suggested new codes are refreshed on
  resume and remain suggestions until the server assigns a code on save.
- Edit drafts retain only changed fields. Resuming reads the current authorised
  source, merges the saved input and requires review when the record changed or
  lacks a version. Untouched company, hierarchy, salary, status and payroll
  defaults are not resubmitted. Explicit hierarchy/default clears still send
  null, and an entered zero remains zero.
- New definitions validate current company/location choices. Position forms load
  active department choices and reject a retained department that is unavailable.
  Without department directory access, users cannot select a new department;
  an existing position's department can remain fixed while other fields are
  edited. The server continues to validate the resulting hierarchy.
- Failed reads and saves preserve the draft. Source reads are cancelled/ignored
  after navigation. Current view/manage permissions are checked before resuming
  and saving; permission loss has an explanation, disabled saving and a usable
  Keep draft action. Shared draft ownership and unique form IDs continue to
  protect paired workspaces.
- All four registers retain search, filters, page and selected record ID per
  workspace window, refetch records on return and recover an obsolete empty page.
  Existing delete confirmations keep their normal behaviour.

This increment changes frontend continuity only. Drafts remain in memory for the
account session; there is no new schema, server version precondition, financial
posting or organisation-permission policy. A fresh read on resume does not prevent
another user changing the record again before saving. Live organisation-role and
transaction release gates remain open.

Automated verification:

- **71 targeted tests pass across five frontend files**, including 26 new
  integration cases for retained forms, current-source merging, explicit clears,
  unavailable choices, code previews, current permissions, failed reads/saves,
  late reads and retained register state (`definitions-targeted-final.log`).
- **7 existing backend tests pass across two suites**, covering department
  hierarchy clears/validation and nullable payroll-type defaults/scoped queries
  (`definitions-backend-targeted.log`). No backend source changed.
- The full frontend suite passes **1,787 tests across 179 files**, with no
  failures, skips or pending tests (`definitions-tests-final.json` and `.log`).
  TypeScript and targeted ESLint pass; ESLint reports no warnings.
- The frontend production build passes, including TypeScript and 209-page
  generation (`definitions-build-final.log`). All 14 frontend source/test files
  match the source freeze used by the full suite and build. Whitespace checks
  pass, including new files. The 15-file manifest and final hashes, including this
  checklist, are in `definitions-files.json` and `definitions-verification.json`.

Live mobile, keyboard, date-picker and printing review remains pending. Automatic
approval review previously rejected preview startup with only "blocked by policy".
The read-only listener check found the rehearsal API on 3114 and no frontend on
3009/3109. No alternative startup attempt, live transaction or deployment was
performed. Automated checks do not certify the Apple-grade visual target.

### Inventory category, family, unit and conversion continuity (2026-09-20)

- Categories, product families, units and conversions now share Inventory's
  session draft shelf and lazy-loaded editors, including standalone ERP registers.
  New entries retain entered values; edit drafts retain only changed fields.
  Resuming reloads the current authorised record, merges the saved input and
  requires review when the source changed or lacks a version. Explicit clears,
  zero prices and conversion precision remain meaningful.
- Family resume uses the current category and prices. A new or changed division,
  company, parent or conversion pair is checked against available choices.
  Protected units and lost permissions block saving with an explanation while
  keeping the draft available. Failed reads/saves and late responses preserve
  unfinished work without automatically submitting it.
- When category creation successfully creates a parent but fails to create the
  child, the draft retains the parent's ID. Resume reloads and validates that
  parent before retrying the child, avoiding a second parent creation in this
  known-success case. This does not introduce general request idempotency.
- All four registers retain filters, page and selected record ID per workspace
  window, reload records on return and recover obsolete empty pages. Saving
  refreshes participating lists without remounting unrelated work in another
  Inventory window.
- New family and conversion detail endpoints use the existing read permissions
  and company scope. Unit edits now check the existing base-unit status when
  changing type without resending that status, preserving the one-base-unit
  validation with partial updates.

Drafts remain in memory for the account session. Current-source review is not a
server version precondition; another user can still change a record before save.
There is no schema migration, new financial posting or organisation-scope policy.
The rehearsal API must load the rebuilt backend before live review of the new
source-read endpoints.

Automated verification for Inventory definitions:

- **68 targeted frontend tests pass across five files**, including 28 new
  integration cases covering current-source merging, explicit clears, failed
  reads/saves, retained parent creation, protected units, missing choices,
  permission changes, register state and independent paired-window work
  (`catalog-targeted-final.log`).
- **28 backend tests pass across five suites**, including five new cases covering
  scoped source reads and partial base-unit edits (`catalog-backend-targeted.log`).
  These service/controller fixtures do not prove live organisation-role workflows.
- The full frontend suite passes **1,815 tests across 180 files**, with no failures,
  skips or pending tests (`catalog-tests-final.json` and `.log`). Frontend
  TypeScript and targeted ESLint pass with zero errors/warnings. Targeted backend
  ESLint passes with zero errors and 26 existing explicit-any warnings; the
  affected lines are unchanged (`catalog-lint-baseline.json`).

- Frontend and backend production builds pass (`catalog-build-final.log` and
  `catalog-backend-build.log`), including frontend TypeScript and all 209 static
  pages. All 17 source/test files match the freeze used for verification.
  Whitespace/conflict checks pass, including new files. The 18-file manifest and
  final hashes, including this checklist, are in `catalog-files.json` and
  `catalog-verification.json` under `.release/os-design`.

Live visual, mobile, keyboard, date-picker and printing review remains pending.
Automatic approval review previously rejected preview startup with only "blocked
by policy". A fresh read-only check found API 3114 (PID 40732) and no frontend on
3009/3109. No alternative startup, API restart, live transaction or deployment was
performed. Automated success does not certify the Apple-grade visual target.

### Product, variant and image continuity (2026-09-20)

- The product register and full profile use the shared Inventory draft shelf and
  lazy-loaded editor. New products retain organisation, variant, unit, stock, tax
  and pricing input, including the explicit choice to create one or all family
  sizes. Inline family creation stays part of the existing product save contract.
- Edit drafts retain only changed fields. Resume reloads the authorised product,
  merges current defaults and requires review when the product, related family
  defaults or image source changed, or the version is unknown. Untouched fields
  are omitted from updates; optional clears and zero values remain explicit.
- New or changed company, division, category, family and unit choices are checked
  against current available choices. Existing unchanged references remain editable
  without unrelated directory permissions. Resume requires current product read
  and update access; new drafts require create access. Failed reads and saves keep
  the input, and late source responses cannot reopen an unmounted editor.
- Product image selection now stages the file instead of uploading immediately.
  Save image and Confirm image removal are explicit actions, separate from Save
  product. A failed image action can be kept and resumed, with no automatic replay.
  Selected files are retained in memory only, and temporary preview URLs are
  released. Image writes refresh participating registers/profiles without closing
  the product form or clearing text. A completed image-only draft is removed;
  unrelated product changes remain guarded. Saved image changes are not undone by
  cancelling product details.
- Generated and skipped family-size results remain available in the current
  workspace session until dismissed. Only the result count and skipped-family
  summary are retained. Product registers retain filters, page and selected ID;
  profiles retain their section and history page. Returning reloads current data,
  with recovery when a retained register/history page no longer has records.

This increment changes frontend interactions only. Drafts and selected images are
lost when the account session/tab closes or reloads. Current-source review is not
a server concurrency precondition, and a manually retried ambiguous request is not
guaranteed idempotent. There is no new schema, financial posting or permission
policy. New products must still be saved before an image can be added. Image
selection must be saved or discarded before submitting the product details.

Automated verification for product continuity:

- **129 targeted frontend tests pass across nine files**, including 27 new
  integration cases covering retained product/variant/image input, changed source
  review, explicit clears, current choices and permissions, failed reads/writes,
  independent image refresh, retained family results and register/profile state
  (`product-targeted-final.log`).
- **13 existing backend tests pass across two suites**, checking product read
  scope/pricing/stock and image upload/removal contracts
  (`product-backend-targeted.log`). No backend source changed in this increment;
  these fixtures are not live end-to-end organisation-role evidence.
- Frontend TypeScript and targeted ESLint pass, with zero lint errors or warnings
  (`product-typecheck-final.log` and `product-eslint-final.log`).

- The full frontend suite passes **1,842 tests across 181 files**, with no failed,
  skipped or pending tests (`product-tests-final.json` and `.log`). The production
  build passes, including TypeScript and all 209 static pages
  (`product-build-final.log`). All ten source/test files match the verification
  freeze. Whitespace/conflict checks pass, including new files. The eleven-file
  manifest and final hashes, including this checklist, are in `product-files.json`
  and `product-verification.json` under `.release/os-design`.

Live visual, mobile, keyboard, date-picker and printing review remains pending.
Automatic approval review previously rejected preview startup with only "blocked
by policy". The latest read-only listener check again found API 3114 (PID 40732)
and no frontend on 3009/3109. No alternative startup, restart, live transaction
or deployment was performed. Automated checks do not establish visual quality.

### Inventory action reviews and independent stock windows (2026-09-20)

- Adjustment submit/approve/reject/post/revert/delete and damage
  submit/approve/reject/post share one current-record confirmation pattern.
  Adjustment lines are reused in the read-only review and confirmation, so the
  decision screen includes quantities, differences, units and costs. The
  standalone adjustment review switches to the confirmation rather than nesting
  a second modal. Damage review preserves the distinction between estimated loss
  and the actual value relieved at posting.
- Every action can be kept on Inventory's session draft shelf and resumed from
  the app or its standalone register. Rejection reasons retain their exact input;
  the existing adjustment endpoint receives trimmed text within its 1,000-character
  limit. Damage rejection keeps its existing no-reason API contract. Retained
  confirmations never execute automatically.
- Opening/resuming reads the current authorised record. A changed or unversioned
  retained source requires review. Every explicit confirmation performs another
  scoped read before writing and checks the current permission again after that
  read. Changed status/quantities stop execution and show the new record; an
  ineligible action stays disabled. A failed/ambiguous action therefore cannot
  blindly repeat its write if a subsequent read shows that it has already posted.
- Failed reads/writes preserve the draft, with retry feedback. Unmounting cancels
  pending verification reads; rapid clicks cannot start duplicate requests.
  Permission loss disables execution while allowing the draft to be kept.
- Adjustment, damage and batch registers now keep their filters, pagination and
  selected IDs per window. A successful action refreshes other participating
  windows without remounting their unfinished work. The originating window keeps
  its existing save callback; child refresh callbacks do not duplicate that save.

This is a frontend interaction change using the existing action endpoints. The
fresh read is not an atomic version precondition; the backend remains responsible
for enforcing state transitions, scope, inventory and accounting invariants. No
schema, permission policy, posting logic or server idempotency changes were made.
Drafts remain in memory and are cleared with the account session/tab.

Automated verification for action reviews:

- **267 targeted frontend tests pass across 20 files**, covering all Inventory
  features and shared product/category/unit workspaces. This includes 28 new
  integration cases for all ten actions, changed sources, retained reasons,
  status/permission changes, failed requests, pending-read cancellation,
  duplicate-click protection and independent paired windows
  (`actions-targeted-final.log`).
- **19 existing backend tests pass across four suites**, covering adjustment
  revert/posting durability, damage value relief and scoped register/detail reads
  (`actions-backend-targeted.log`). These fixtures do not prove live end-to-end
  transactions across organisation roles.
- Frontend TypeScript and targeted ESLint pass without errors or lint warnings
  (`actions-typecheck-final.log` and `actions-eslint-final.log`).

- The full frontend suite passes **1,870 tests across 182 files**, with no failed,
  skipped or pending tests (`actions-tests-final.json` and `.log`). The production
  build passes, including TypeScript and all 209 static pages
  (`actions-build-final.log`). All 12 source/test files match the verification
  freeze. Whitespace/conflict checks pass, including new files. The 13-file
  manifest and final hashes, including this checklist, are in `actions-files.json`
  and `actions-verification.json` under `.release/os-design`.

Live visual, mobile, keyboard, date-picker and printing review remains pending.
Automatic approval review previously rejected preview startup with only "blocked
by policy". The latest read-only listener check found API 3114 (PID 40732) and no
frontend on 3009/3109. No alternative startup, restart, live transaction or
deployment was performed. Automated checks do not establish visual quality.

### Reports accounting forms and continuity (2026-09-20)

- Invoice journal review (sales and purchases), cash journal review, account
  connections (Cash Desk and bank accounts), and existing supplier-payment linking
  now use shared form sections, labelled account choices, review feedback and
  modal actions. Accounting colours use the shared theme tokens. Scrollable tables
  have named keyboard-focusable regions, and register actions use 44 px minimum
  targets. Existing window-width layouts, dialog focus and reduced-motion policy
  still apply; live visual/mobile review is outstanding.
- These four workflows can be kept as session drafts and resumed from Reports
  home or accounting views. The controller loads the editors only when needed.
  Guarded navigation protects entered choices and closes the editor when the
  view changes; returning does not submit anything. Financial acknowledgements
  must be checked again after reopening or changing account choices.
- Open/resume reads the current authorised source. Each explicit write performs
  another source read, checks current permissions after the read, and validates
  the current source state and account choices. Changed records stop execution
  and require review again. Read failures keep the input and offer retry; lost
  permission still allows keeping the draft. Pending verification reads are
  cancelled when the editor unmounts, and repeated clicks cannot duplicate them.
- Invoice/cash posting still sends the existing server fingerprint and respects
  blocked sources, prior journals and available account types. Account connections
  keep the original company/division/branch compatibility, dedicated asset-ledger
  checks and immutable historical mapping policy. Missing accounts and completed
  connections remain reviewable without offering another save.
- Supplier-payment linking reads the retained payment day and organisation through
  the existing scoped unlinked-payment endpoint. It uses the original payment ID,
  amount and date to record cash outflow without paying the invoice again. A failed
  link retains its request identity and locks the chosen cash account for retry.
  An attempted action cannot reuse its request context after its source changes;
  the user must review existing records before discarding and starting anew.
  Already-linked, reversed or inaccessible payments cannot be linked from the
  retained review. Account-choice load failures have an explicit retry action.
- Invoice/cash register searches and status filters belong to each window.
  Successful accounting actions refresh participating accounting registers without
  remounting open reviews or resetting filters. Existing payment-link success also
  invalidates the connected Cash Desk through the existing in-tab event. No server
  responses or drafts are persisted to browser storage.

These are frontend changes using existing endpoints. Source reads are not atomic
version preconditions; backend transactions, source fingerprints, permissions,
account mapping constraints and payment idempotency remain authoritative. No
schema, posting engine or permission policy changed. Kept input lasts only for
the account session/tab. Unlinked-payment reads retain the existing 1,000-record
limit and report an error if the selected day needs further narrowing.

Automated verification for Reports accounting:

- **80 targeted frontend tests pass across nine files**, including 29 new
  integration cases for both invoice types, cash posting, both connection types,
  payment linking, actual Reports-home resume, current-source and permission
  checks, failed reads/writes, retry identity, prior journal detection, guarded
  navigation, independent filters, shared-draft ownership and paired refresh
  (`accounting-targeted-final.log`). The native unsaved-work dialog is polyfilled
  in jsdom; these tests are not live keyboard/mobile acceptance.
- **27 existing backend tests pass across three suites**, covering posting
  fingerprints, duplicate rejection, scope/permission checks, exact journal
  values, historical mapping protection, supplier-payment linking without a
  second invoice payment, and cash reversal transactions
  (`accounting-backend-targeted.log` and `accounting-payment-backend.log`). These
  service fixtures do not prove live end-to-end transactions across roles.
- Frontend TypeScript and targeted ESLint pass without errors or warnings
  (`accounting-typecheck-final.log` and `accounting-eslint-final.log`).

- The full frontend suite passes **1,899 tests across 183 files**, with no failed,
  skipped or pending tests (`accounting-tests-final.json` and `.log`). The
  production build passes, including TypeScript and all 209 static pages
  (`accounting-build-final.log`). All 12 source/test files match the verification
  freeze. Whitespace/conflict checks pass, including new files. The 13-file
  manifest and final hashes, including this checklist, are in
  `accounting-files.json` and `accounting-verification.json` under
  `.release/os-design`. The last test-selector edit also passed targeted ESLint
  (`accounting-test-lint-final.log`).

Live visual, mobile, keyboard, date-picker and printing review remains pending.
Automatic approval review previously rejected preview startup with only "blocked
by policy". The latest read-only listener check found API 3114 (PID 40732) and no
frontend on 3009/3109. No alternative startup, restart, live transaction or
deployment was performed. Automated checks do not establish visual quality.

### Reconciliation workspace and statement-import continuity (2026-09-20)

- Bank Reconciliations now shares the ITEMBA workspace list/detail layout,
  labelled filters, themed surfaces, form sections, touch-sized actions and
  explicit loading/error/permission feedback. Registers use 25-row server pages;
  statement lines and CSV previews render 25 rows at a time. Amounts display in
  each reconciliation's currency instead of aggregating different currencies
  into a misleading total. The shared mobile detail/focus pattern and container
  layouts apply, with live visual and keyboard acceptance still outstanding.
- Reports companion windows own the reconciliation route through an explicit
  feature adapter. Back/forward navigation stays inside the Reports window.
  Company/status filters, page, selected reconciliation and selected match IDs
  belong to that window; successful writes refresh participating registers and
  details without remounting open editors.
- New reconciliations, manual statement lines, CSV imports and matching,
  unmatching, approval and closure reviews can be kept on the Reports draft
  shelf. They resume from Reports or the standalone register with retained input.
  Navigation protects unfinished work. Reopening never submits an operation;
  confirmations require acknowledgement again. Drafts are session-only and share
  the existing account/permission boundary and concurrent-owner protection.
- CSV selection reads at most 2 MB and uses the existing strict date, column,
  1,000-row and four-decimal validation. Every parsed row is available in the
  paged preview, with exact integer-based totals and normalized within-file
  duplicate counts. Preview totals include repeated rows; the import result
  reports the actual imported/skipped counts. Out-of-period rows block import.
  Invalid replacement files preserve the previous valid selection and reset its
  acknowledgement. Late file reads are ignored after replacement or unmount.
- Open/resume and each explicit statement write read the current authorised
  reconciliation. Changed source data stops submission and requires review again;
  status or permission loss prevents execution while preserving the draft.
  Failed reads/writes retain input and expose retry feedback. Repeated clicks
  cannot duplicate a pending request, and unmount cancels verification reads.
  CSV imports alone permit an explicitly reviewed retry after source changes,
  relying on the existing server's locked exact-row deduplication. Other attempted
  statement actions remain blocked from blind retry after their source changes.
- Creation loads complete authorised company and active cash-account choices;
  failed later pages cannot silently expose partial choices. Users without
  company-directory access can use their assigned company. A failed create
  retains its reconciliation number for retry. Existing create/manual-line APIs
  still receive JSON numbers; input that cannot round-trip exactly is rejected
  instead of rounded. CSV amounts remain exact decimal strings.
- Matching describes its saved exact-amount matches and three-day date window.
  Ambiguous candidates remain transient; saved candidate IDs cannot be used after
  returning until matching provides current choices. Approval/closure reviews
  show current evidence and explain unavailable actions. Existing backend state,
  scope, maker/checker, journal eligibility and exact balance checks remain the
  final authority. Retained confirmations do not bypass those checks.

This increment changes frontend interaction and navigation, not the schema,
posting logic or permission policy. Fresh reads are not atomic version
preconditions. Creation retains its existing company/number uniqueness contract;
no general backend request idempotency was added. Automated fixtures do not prove
live transactions across company, division and branch roles.

Automated verification for reconciliation:

- **110 targeted frontend tests pass across 11 files**, including 24 new
  reconciliation integration cases, five numeric/date cases and one Reports
  companion-navigation case (`reconciliation-targeted-final.log`). Coverage
  includes draft resume, guarded navigation, independent filters, CSV precision
  and pagination, invalid replacements, stale reads, permission changes,
  uncertain import outcomes, matching, and approval failures. The unsaved-work
  dialog is polyfilled in jsdom; this is not live keyboard/mobile acceptance.
- **24 existing backend tests pass across three suites**, covering reconciliation
  services, statement integrity and workflow checks
  (`reconciliation-backend-targeted.log`). No backend code changed in this pass.
- Frontend TypeScript and targeted ESLint pass without errors or warnings
  (`reconciliation-typecheck-final.log` and `reconciliation-eslint-final.log`).

- The full frontend suite passes **1,929 tests across 185 files**, with no failed,
  skipped or pending tests (`reconciliation-tests-final.json` and `.log`). The
  production build passes, including TypeScript and all 209 static pages
  (`reconciliation-build-final.log`). All 15 source/test files match the
  verification freeze. Whitespace/conflict checks pass for all 16 manifest files,
  including untracked files. Final hashes and evidence are recorded in
  `reconciliation-files.json` and `reconciliation-verification.json` under
  `.release/os-design`.

Live visual, mobile, keyboard, date-picker and printing review remains pending.
Automatic approval review previously rejected preview startup with only "blocked
by policy". The latest read-only listener check found API 3114 (PID 40732) and no
frontend on 3009/3109. No alternative startup, restart, live transaction or
deployment was performed. Automated checks do not establish visual quality.

### Report library, viewer and reusable views (2026-09-20)

- The library uses the shared list/detail workspace, labelled search/area/type
  filters, 25-row pages, themed surfaces and explicit retry states. Search and
  selected report survive navigation within their window. Additional catalogue
  sectors use readable labels instead of assuming only the original six areas.
  Details retain report purpose, questions, organisation scope, ownership,
  freshness and classification. The authenticated catalogue still describes all
  reports; run actions require the current report permission, and underlying
  endpoints retain server authorization.
- The viewer uses shared company/division/date controls and explicit **Run report**
  behaviour. It does not execute on every field edit or replay a run on navigation.
  Filters and presentation remain per-window/per-report session state. Existing
  deep-link parameters take precedence over default saved views; retained or
  manually changed choices are not overwritten by a later default. Organisation
  choices load all pages and expose errors without silently using partial lists.
- Results, source explanations, quality warnings and run metadata belong to one
  report/scope/period. Changed filters immediately remove the old result and its
  export actions. Pending reads are cancelled on scope/permission/navigation
  changes, obsolete responses are ignored, and rapid run clicks share one request.
  Existing endpoint query parameters are preserved when adding report filters.
  Invalid periods and unresolved per-record reports cannot execute from the viewer.
- Supporting reads run alongside the report. Unavailable lineage, quality or
  explanation is reported explicitly. The run manifest marks only the supporting
  reads that actually succeeded; a failed manifest remains a visible limitation
  while the report itself can be read. The client checksum now covers the full
  returned value, including middle rows, and remains informational rather than
  a cryptographic attestation or proof of an accounting snapshot.
- Main results and additional array sections use 50-row tables. All returned
  rows remain accessible; row search and chart choices do not truncate exports.
  Long charts sample at most 200 values, preserve the first and last values and
  disclose the sample. Numeric chart conversion is for display; tables and
  exports retain the reported decimal strings. Additional objects, full source
  details and run metadata remain available through keyboard-native disclosures.
- Reusable report views keep their existing server-backed list/create/default/
  delete APIs. The complete authorised list is paged for display. Create/default/
  delete reviews use the shared retained-draft controller and can resume from
  Reports home. A saved-view draft displays its entered name and retains its
  filters and chart choices. Resuming never saves, runs or sends a report.
  Current-source reads and permission checks precede saves; changed action
  targets require review again. Failures preserve the editor. New views are
  saved without making them default; **Set default** is a separate explicit action
  using the existing endpoint that clears the prior default.
- The completed-run export panel supports PDF, Word, Excel, CSV, text and JSON,
  plus clipboard JSON and printing the visible page. Branded formats carry the
  completed run's company and scope. Document exports exceeding 5,000 rows or
  40 columns stop with guidance to narrow the report or use full CSV/JSON; they
  do not silently truncate. Duplicate export clicks are prevented. Navigation
  cancels pending downloads, and failures expose the actual error.
- Export activity is recorded after successful file preparation/copy/print-dialog
  request. A failed file preparation is not logged as a completed export. A
  subsequent audit failure is disclosed separately and does not claim the file
  action failed. Printing targets only the selected workspace and is explicitly
  labelled **Print visible page**; it does not claim all result pages were printed
  or that the user completed the native dialog. Activity-read failures are shown
  as failures instead of an empty history.

No backend code, schema, permission policy or financial posting logic changed.
Original report endpoint limits and backend organisation restrictions remain in
force. Saved-view creation has no newly added server idempotency contract; an
uncertain create response still requires checking saved views before retrying.
Fresh source reads are not atomic version preconditions. Existing browser-local
bookmarks on Reports home are separate from server-backed reusable report views.
Live native printing, clipboard, date-picker, visual and mobile acceptance remains
outstanding.

Automated verification for the library/viewer:

- **155 targeted frontend tests pass across 13 files**, including 35 new
  integration cases and ten request/chart/checksum cases. Tests exercise actual
  Reports-home draft resume, local navigation, independent window filters,
  complete organisation choices, changed/default/deep-link filters, late results,
  current permissions, every export format, export limits/failures, saved-view
  actions, chart limits and additional report sections (`viewer-targeted-final.log`).
- **Seven existing backend isolation tests pass** (`viewer-backend-targeted-final.log`),
  including saved-view list/create/update company boundaries. The initial run
  exhausted Node's default heap; the same suite passed with an 8 GB heap. These
  service fixtures do not prove live end-to-end transactions across roles.
- Frontend TypeScript and targeted ESLint pass with no errors or warnings
  (`viewer-typecheck-final.log` and `viewer-eslint-final.log`).

- The full frontend suite passes **1,974 tests across 187 files**, with no failed,
  skipped or pending tests (`viewer-tests-final.json` and `.log`). The production
  build passes, including TypeScript and all 209 static pages
  (`viewer-build-final.log`). All 17 source/test files match the verification
  freeze. Whitespace/conflict checks pass for all 18 manifest files, including
  untracked files. Final hashes and evidence are recorded in `viewer-files.json`
  and `viewer-verification.json` under `.release/os-design`.

Live visual, mobile, keyboard, date-picker, clipboard and printing review remains
pending. Automatic approval review previously rejected preview startup with only
"blocked by policy". The latest read-only listener check found API 3114 (PID 40732)
and no frontend on 3009/3109. No alternative startup, restart, live transaction or
deployment was performed. Automated checks do not establish visual quality.

### Accounting control workspaces (2026-09-20)

Posting Runs, Period Close, Accounting Locks, Audit Adjustments and Depreciation
now share a themed register, explicit Review buttons, current-record detail panels,
search, company/status filters, 25-record display pages and clear loading, empty,
permission and retry states. Mobile uses the existing labelled-record table and
responsive detail panel. Filters and selected IDs remain independent per window;
record responses are refreshed rather than retained as draft data.

All five are explicit destinations inside the Reports companion window, including
its Back/Forward history, and are linked from Accounting readiness. Standalone ERP
routes reuse the same features. The Reports draft shelf can resume new records and
action reviews from either entry point during the current account-bound session.
Drafts remain memory-only and are cleared on reload or sign-out.

Creation forms use complete company/period/account/asset choices, validate their
scope, refresh selected dependencies before submission, retain rejected input and
recheck current permissions after pending reads. Company changes clear dependent
selections. An uncertain create outcome prevents a blind repeat save: the operator
must check the register for the retained reference. These endpoints have not gained
server idempotency keys or new server-side concurrency guarantees.

Post/reverse, close/reopen, release, adjustment submit/approve/post/reverse and
schedule generation/manual-entry/posting use current-source reviews with explicit
effect text and a fresh acknowledgement. Depreciation reviews read both the schedule
and its complete entry list so additions or posting by another operator invalidate
the old acknowledgement. Permissions and status are checked before writes; backend
accounting controls remain authoritative. Posting Run actions explicitly describe
tracking-status changes and do not claim to create or reverse ledger journals.

Adjustment creation checks exact balancing and the database's two-decimal line
precision. Posting/schedule amounts retain four-decimal precision, six-decimal
annual rates are supported, and unsafe numeric conversions are rejected. Asset
values prefill using decimal arithmetic. Depreciation writes use ISO dates; manual
entries check the current accumulated total and remaining depreciable amount.

Registers currently load all accessible pages for complete local search/status
filtering, because some legacy endpoints lack server-side status/search support.
Only 25 records/entries render per page. Production-scale read performance still
needs measurement; this increment does not claim server-side search or bounded
whole-register memory use. No backend service, schema, permission or posting logic
was changed.

Verification evidence is recorded under `.release/os-design/controls-*`:

- The full frontend suite passes **2,037 tests across 189 files**, with no failures
  or pending tests (`controls-tests-final.json` and `.log`).
- The final targeted run passes **156 tests across seven files**, including 41
  control-workflow cases, 21 amount/scope cases and companion navigation coverage.
  It also verifies the final account-label/default-value refinements made during
  the broader run (`controls-targeted-final.log`).
- **19 existing backend service tests pass across three suites**, covering period
  closure, accounting locks and depreciation (`controls-backend-final.log`). These
  are service fixtures, not live staging transactions or role acceptance.
- Targeted ESLint passes with no warnings or errors. The production build passes
  its TypeScript checks and generates all **209 static pages**. The 24 source/test
  files match the final targeted-check/build freeze; whitespace and conflict
  checks also pass, including untracked files (`controls-eslint-final.log`,
  `controls-build-final.log`, `controls-source-freeze.json`).

Live visual, mobile, native date-picker and printing acceptance remains pending:
automatic approval review previously rejected frontend preview startup with only
"blocked by policy". A read-only listener check found the API on 3114 and no frontend
on 3009/3109. No alternate preview startup, deployment or real transaction was used.

### Shared OS polish (2026-09-20)

The second pass refines the existing visual language across shared OS surfaces.
The app switcher has one search surface, result counts, an explicit clear action,
a recoverable empty state and keyboard hints. Each opening starts a fresh search;
Enter opens the first match, arrow keys move through results, and Home/End reach
the ends of the list. Composing text and repeated shortcuts do not launch apps.
The global switcher shortcut leaves financial reviews and other dialogs in charge
of focus. Minimizing, restoring and switching between visible app surfaces move
focus to the visible desktop/workspace;
existing route content and its drafts remain mounted as before.

Window controls keep their small coloured indicators within larger click areas.
System actions, mobile navigation and dialog dismissal have larger targets. The
desktop and split layout reserve space for the dock's bottom safe area. Switcher,
module-directory and notification content no longer repeat the dialog's outer
padding. Dialog titles wrap, footers wrap their actions and scrollable bodies use
the dynamic viewport. Closing dialogs become inert and leave the accessibility
tree during their exit animation.

Feedback cards appear above the workspace instead of over the dock. Short success
and information messages have six seconds of reading time, or eight when they
include a description; timers pause for hover, keyboard focus and a hidden browser
tab. Errors and warnings remain until explicitly dismissed. Keyboard dismissal
moves to another remaining notification, then returns to the preceding control.
Timer/listener cleanup is covered by tests. This transient feedback remains
separate from the server-backed notification inbox; it is not durable history.

The inbox uses the shared loading skeleton, more readable message/date text and
wrapping actions. Shared page spinners have less visual weight. Dock hover and tap
transforms are disabled in reduced-motion mode; shared global/dialog CSS now
honours an explicit full-motion preference instead of overriding it with the
system preference. Other app-specific motion still needs the live review below.

Verification and acceptance:

- Targeted component checks pass **47 tests across five files**, including nine
  new feedback tests and five new shell cases. Existing draft-restoration checks
  also assert focus on the visible destination.
- The full frontend suite passes **2,051 tests across 190 files**, with no failed
  or pending tests (`polish-tests-final.json` and `.log`). The final targeted run
  also passes all 47 cases, including the focus-restoration refinement
  (`polish-targeted-final.log`).
- Targeted ESLint and formatting checks pass. An initial full-suite run exposed a
  line-ending-sensitive POS theme setup check after a Windows edit converted the
  shared stylesheet. Its original LF format was restored; the eight theme tests
  and then the full suite pass. The failed run remains in
  `polish-tests-line-endings-failure.*` for traceability.
- The production build passes TypeScript and generates all **209 static pages**
  (`polish-build-final.log`). All 15 source/test files match the final targeted
  checks/build freeze (`polish-source-freeze.json`). All 16 manifest files pass
  whitespace/conflict checks, including new files. Final evidence is summarised in
  `polish-verification.json`.
- Live desktop/mobile layout, actual touch targets, text zoom, light/dark contrast,
  reduced/full motion, native keyboard behaviour and assistive-technology review
  remain pending. The current browser inventory has no tabs and the frontend is
  stopped. Automatic approval review previously rejected frontend preview startup
  with only "blocked by policy"; no alternate startup method was used.

This is a shared-component implementation pass, not a completed screenshot audit
or visual acceptance of every release workflow. No backend, financial posting,
permission or schema changes are included.

### Search and document connections (2026-09-20)

Universal search now has a dedicated **Files** category. It finds library documents
by title, filename, code and description, and Invoice Desk attachments by filename,
invoice number or supplier. This searches metadata, not the contents of a file.
The API's `category=files` mode queries only these file sources and retains the
existing bounded result limit. Other category values are rejected.

File results open the shared Quick Look dialog inside search. Previous/next controls
browse the matched files, **Open record** opens the currently previewed file's
owning document or invoice, and Escape/Done returns to the original query and
keyboard selection. The browser retains no search result or preview across an
account or permission boundary. Files use authenticated source identifiers;
search cannot supply arbitrary preview/download URLs or file bytes. Documents
retain their existing company scope; invoice files also require the invoice's
company, division and branch access. This does not expand Documents' existing
confidentiality model or audit every legacy search source.

Ctrl/Cmd+K respects the active editor or file dialog, ignores key repeat and IME
composition, and still toggles search when search owns the keyboard. Search result
navigation continues through the unsaved-work guard.

The Pages & actions category includes **Browse file library** and **Write a company
letter**, with the corresponding read/write permissions. Documents accepts a
validated `view` destination, keeps its letter/draft state across its own views,
and updates the main route when changing views. The companion adapter imports
the client workspace separately, so it does not consume or replace the main
route's target. Saving a draft returns to the overview without reopening the
composer. A stale letter destination falls back to the overview for readers who
cannot write.

Supplier, company, sales-order and purchase-order matches now use existing detail
pages. Inventory product matches use the register's actual `q` parameter. Fixed
asset and contract attachments offer the same permission-gated Quick Look,
previous/next and Open record controls. These actions reuse the existing uploaded
file; they do not create a second document or bypass its authorised file read.

Verification and acceptance:

- Targeted frontend verification passes **42 tests across six files**, including
  accessible nested search/file dialogs, keyboard focus, category request
  cancellation, preview/record routing, permission changes and letter drafts.
- **19 backend tests across two suites** pass, using real company/organisation
  scope services over fixture queries. These cover invoice attachment branch and
  division boundaries, source permissions, rejected company/category requests,
  file-only queries, encoded destinations, bounded results and metadata-only
  payloads. This is service verification, not a live database/API rehearsal.
- Frontend and backend production builds pass; the frontend includes TypeScript
  and the **209-page** generation stage. Targeted ESLint passes for both codebases.
- The full frontend regression suite passes **2,071 tests across 193 files**,
  with no failed or pending tests. Final evidence is recorded in
  `.release/os-design/search-documents-verification.json`; source/test hashes are
  frozen in `search-documents-source-freeze.json` and the changed-file manifest
  is `search-documents-files.json`.
- Live browser, touch, assistive-technology, native PDF/printing and large-library
  performance acceptance remain pending. Automatic approval review previously
  rejected frontend preview startup with only "blocked by policy"; no alternative
  startup method was attempted.

No database migration is required. The frontend and API changes must be released
together. No preview service was restarted and no deployment was performed.
Legacy receivable, payable, journal and cash-account results still need exact
record targets; other legacy attachment/export workflows remain on the release
review checklist below.

### Phase 4 business acceptance pass (2026-09-20)

The current isolated API and real PostgreSQL rehearsal pass 55 purchase, collection,
payroll, permission and reconciliation checks; 20 document checks; and 11 new
file-search/preview checks across company, division and branch roles. The loan
lifecycle passes another 51 service/database assertions in an owned disposable
database. The frontend/API route contract and its 12 tests pass. Two one-page
exported PDFs were rendered and visually inspected; native browser printing,
multi-page pagination and date-picker interaction remain unverified.

The full backend suite was refreshed: **4,172 pass and 17 fail** across 414 suites.
The failures are capability/evidence integration gaps, including changed loan and
payroll request contracts. The new `release:contracts-audit` command identifies
96 discovery-eligible operations without matching positive fixtures and eight
request fixtures requiring review. It returns nonzero and does not relax the
security/evidence gates. Phase 3 frontend/build evidence is retained; no app source
was changed in this acceptance pass.

See [phase 4 acceptance](../../releases/itemba-os-phase-4-acceptance.md) for the
repeatable checks, exact blockers and operator checklist. Local proof is not staging
acceptance or deployment approval. Live browser/mobile/native-control review remains
pending because automatic approval review previously rejected preview startup with
only “blocked by policy”; no alternate startup method was used.

### Remaining implementation

- Review the implemented draft flow live on desktop/mobile and extend retention
  to other Reports forms and the remaining legacy ERP editors. Verify
  concurrent-draft ownership, product/image work and adjustment/damage decisions
  and accounting posting/linking and reconciliation imports/actions live between app
  and legacy ERP panes before acceptance.
- Review the paired workspace and Inventory/Reports/Payroll navigation live,
  including printing and keyboard/mobile behaviour. Preserve the explicit app
  adapters; do not cache arbitrary Next.js route children to mimic concurrent windows.
- Apply and review shared controls/states across every release workflow, including
  the remaining legacy ERP screens.
- Complete the legacy search-destination and action-coverage review. Extend shared
  file previews to remaining legacy attachment/export workflows and review native
  PDF controls and printing live across the connected apps.
- Verify large-list performance, touch targets, contrast, mobile workflows and
  motion comprehensively, including ordinary and reduced-effect settings.

This checklist remains open until every requirement is verified. A polished shell
alone does not complete the overhaul.
