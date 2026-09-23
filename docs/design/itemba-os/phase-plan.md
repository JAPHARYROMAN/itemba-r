# ITEMBA OS — phases 1–4

Scope: complete the four phases requested on 17 September 2026. The previous desktop work is a foundation, not evidence that these phases are complete.

1. Consistent Companies, Sales, Purchases and Finance workflows: searchable lists, usable detail panels, forms and clear actions, preserving permissions, real data, pagination and business operations. Verify rendered desktop/mobile and representative create/edit/cancel flows without submitting real financial transactions.
2. Workspace continuity: per-user remembered app/route, pinned apps and layout; protect dirty forms on navigation, modal dismissal and browser exit. Verify reload, account isolation, discard/stay/save and app switching.
3. App standard: typed registry for identity, permissions, navigation and connection status; shared launch/dock/library behavior; documented contract and validation tests for a future app.
4. Fuel Grid: identify actual service, connect the launcher, verify login/launch/return and unavailable states. Do not substitute a placeholder, redirect to Fuel Reporting, or claim connected from a configuration value alone.

Current status: all four phases are complete within the scope above. Final verification passed on 17 September 2026: 65 frontend tests across 17 files, three backend search tests, targeted ESLint and the production frontend build (including TypeScript and 200 generated static pages). Existing phase 1 backend build evidence is recorded below. No production deployment or real financial transaction is claimed.

Phase 1 evidence (17 September 2026):

- Companies uses a shared keyboard-accessible record list/inspector with server search, pagination, read/create/delete permission boundaries, and typed-code archive confirmation. Company creation now groups identity/contact fields; company details share the OS surface styling.
- Sales/Purchases reuse their original permission/status-aware actions in Focus and Ledger layouts. Existing customer/day summaries, exports, confirmations, payment/receiving actions and line editors remain. Order forms now group context, party/date and payment fields and collapse to a single column on mobile.
- Finance has direct workspace navigation; receivables, payables and expenses share the same focus/ledger pattern, scoped server search, explicit failures/retry, and request cancellation. Company/status URL filters are respected. Existing detail/payment/editor dialogs remain functional.
- 34 frontend checks passed (30 across eight files plus four order-action tests). Three backend tests prove search preserves company boundaries and pagination. Frontend TypeScript and production build passed (200 generated static pages); backend TypeScript and build passed. Backend restarted from the new build and `/api/v1/health` returned 200.
- Browser checks used the real signed-in account: company list/selection, search/filter controls, Sales and Purchase create/cancel forms, AR/AP/Expense create/cancel forms, Finance dashboard, and mobile company selection/back navigation. No business records or financial transactions were submitted. The current Sales/Purchase/AR/AP/Expense datasets are empty; populated inspector/action behavior is covered with isolated test records.
- Visual comparison: selected reference and Companies capture displayed together at 1487×1058. Adjusted overly small type, excessive header spacing and offscreen inspector actions; revised `companies-desktop.png` shows the fixes. Mobile 390×844 capture `companies-mobile.png` shows reachable actions and no horizontal document overflow. Browser console contained no errors at the end of this pass.

Phase 2 evidence (17 September 2026):

- Added validated, versioned, per-account workspace preferences. Pins, last ERP path, recent app IDs, window size, startup choice and record layouts persist on the current device. Same-account surfaces and browser tabs synchronize. Storage failures retain in-memory changes. Stored paths reject external/script URLs and startup checks the most specific current navigation permission.
- Library pins now include ITEMBA-R and Settings, and the dock reflects app pins while retaining the active app. Added a startup choice in System settings. Legacy ERP navigation favorites remain a separate store; app pins no longer use that global store.
- Live browser proof: switched Sales to Ledger, reloaded and observed `aria-pressed=true`; opened Apps and launched ITEMBA-R, which returned to `/operations/sales-orders`. Restored Focus afterward.
- Core Company, Sales, Purchase and Finance forms now register unsaved changes. Shared guards cover internal links, programmatic navigation, modal close/cancel/backdrop/Escape, browser Back/Forward and unload. Stay preserves input; explicit Discard restores the baseline; successful saves clear protection and failed saves retain it. Untouched forms do not prompt.
- Live browser checks confirmed repeated Back and Forward protection, Stay retaining a Company draft, Discard returning to Companies, and reopening a cached Company page without resurrecting discarded input. Desktop/Fuel Grid/ERP switching retained the draft. A reload attempt retained edited input; native browser chrome is not exposed by the automation surface, so no visual claim is made about the browser's native confirmation. Cancelable unload/reload events are also covered in isolated tests.
- Successful and failed Company saves were verified with isolated API mocks; no real record was submitted. Preference tests cover account isolation and storage failure.

Phase 3 evidence (17 September 2026):

- A typed registry now owns app identity, launch kind, permissions, appearance and external connection configuration. The library, dock, launch overlay and registered external route share this metadata. ITEMBA-R, Fuel Grid and Settings are the shipping entries.
- Authenticated status endpoints check the registered permission before probing either the application or its health URL. Unknown apps and unauthorized callers cannot trigger service probes. URLs come from server configuration and accept only HTTP(S) without embedded credentials.
- A test-only future app proves library visibility, pinning, dock launch, permission filtering and returning to an unchanged ERP draft through the common launcher. Registration requirements and an example are documented in `app-contract.md`.
- Reviewed desktop and mobile screenshots: `apps-registered.png` (1280×720) and `apps-registered-mobile.png` (390×844). Mobile document width equals the viewport; primary controls remain reachable.

Phase 4 evidence (17 September 2026):

- Connected the actual sibling Fuel Grid service, including its Go API, existing PostgreSQL database, dedicated local Redis port and Next.js web app. The database was backed up before applying its checked-in migrations from 102 to 114. Startup and recovery instructions are in `fuel-grid-local.md`.
- Live launcher showed Available; opening it reached the real Fuel Grid sign-in and an existing demo account reached `/command-center`. Returning to ITEMBA preserved the ERP workspace. Fuel Grid retains its own authentication; this phase does not introduce SSO.
- Stopping the local API produced the explicit Unavailable state. Restarting it and checking again restored Available. The API readiness endpoint and application login both returned HTTP 200 on the final health check; ITEMBA backend health also returned 200.
- `fuel-grid-connected.png` records the connected launcher at 1280×720, including its launch, status and retry controls. This is a verified local integration, not a production deployment.

Next proposed phase — complete the OS experience:

1. Inventory the remaining ERP screens and extend the shared page, list, detail, form and feedback patterns through the remaining modules. Keep the restrained Apple-inspired spacing, type, surfaces and motion consistent.
2. Extend shared search and notifications with permission-aware real results and links back to the originating app.
3. Refine keyboard navigation, focus restoration, reduced motion, small-screen behavior and loading/error states across the complete journey.
4. Prepare a production pilot: service startup/recovery, deployed connection URLs, monitored health and role-based end-to-end verification. Evaluate shared sign-in as a separate integration decision.

The proposed next phase is a roadmap, not work claimed complete or started by this record.
