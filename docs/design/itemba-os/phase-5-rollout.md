# ITEMBA OS — phase 5 rollout

## Scope and acceptance

Extend the approved Apple-inspired OS language through the remaining ERP modules. Settings is the reference workflow, not the entire scope. Preserve routes, permissions, API operations, pagination and business rules. Verify actual desktop/mobile rendering, keyboard access, reduced motion, loading/error states and representative complete workflows. Cross-app search/notifications and production deployment belong to subsequent phases.

## Current progress

- 19 September: the shared legacy-screen rollout now covers 116 page files and five route components, plus a rebuilt Loans & Debts register, seven accounting list/detail workspaces and eight unified dialogs. Mobile and keyboard evidence, validation and remaining release acceptance are recorded in [visual-overhaul.md](visual-overhaul.md). This broad presentation rollout does not automatically increment the individually reviewed workflow counts below.

- Settings hub: shared page and dock experience implemented and checked. Search, category/scope filters, permission-aware links, appearance, motion, startup preferences and confirmed personal-default reset. Desktop comparison at 1487x1058, mobile at 390x844 with document width 390, plus dark appearance and nested Escape verified. Account-preferences form now protects unsaved edits; failed/successful saves checked with isolated API mocks.
- Shared components: page headers wrap actions and expose breadcrumbs, cards inherit OS surfaces, errors use theme tokens, loading exposes status, keyboard focus is visible, and nested confirmation focus/Escape is corrected. Remaining module-specific structures and workflows still require rollout and verification.
- The phase remains active. Passing a Settings test is not evidence that the remaining ERP rollout is complete.
- 23 September 2026: Grok 4.7 closed the remaining inventory families at the code bar. The contributor note, including the acceptance bar, checkpoint branches, and what is still open, is [phase-5-grok-4.7-contribution.md](phase-5-grok-4.7-contribution.md).

## Users — 23 September 2026

- Closed `/users`. The list stays closed until `users.read`, the permission the sidebar and the users API already require. The list keeps only the latest request, and a failed load shows Try again. Company names load with that same view. The role catalog loads only when the user can assign roles. Create, update, delete, and role assignment stay on `users.create`, `users.update`, `users.delete`, and `users.assign_roles`. A form validation message stays separate from the list retry.
- Verification: frontend typecheck and the users acceptance tests. Live signed-in review is still open.

## Tasks — 23 September 2026

- Closed `/tasks`. The list stays closed until `tasks.view`, the permission the sidebar and the task APIs already require. My Tasks and All Tasks keep only the latest request, and a failed load shows Try again. Creating, editing, completing, cancelling, and deleting stay on `tasks.create`, `tasks.update`, `tasks.complete`, and `tasks.cancel`. The assignee list still requires `users.read`.
- Verification: frontend typecheck and the tasks acceptance tests. Live signed-in review is still open.

## Security — 22 September 2026

- Closed all six security routes. The dashboard requires `security.dashboard.view`. Policies open with `security.policies.view` or the sidebar leaf `security_policies.view`, and manage stays on `security.policies.manage`. User profiles require `user_security_profiles.view`. Events require `security_events.view`. Sessions require `active_sessions.view`. Two-factor has no separate view permission; the page stays closed until `two_factor.manage`. Each read keeps only the latest request, and a failed load shows Try again.
- Verification: frontend typecheck and the security-family acceptance tests. Live signed-in review is still open.

## Sales — 22 September 2026

- Closed `/sales/commissions`. The route is not a sidebar leaf. The list stays closed until `sales_orders.view`, the permission that API already requires. Creating and approving stay on `sales_orders.create` and `sales_orders.confirm`. The list keeps only the latest request, and a failed load shows Try again.
- Verification: frontend typecheck and the security-family acceptance tests. Live signed-in review is still open.

## Roles — 22 September 2026

- Closed `/roles`. The list already required `roles.read` and offered Try again. It now keeps only the latest request, and the permission catalog for the editor loads only when the user can create or update a role. Create, update, and delete stay on their existing permissions.
- Verification: frontend typecheck and the security-family acceptance tests. Live signed-in review is still open.

## Reports — 22 September 2026

- Closed the three report routes in this inventory. The catalog has no leaf permission and its API is authenticated-only, so a signed-in user is not shown Access Restricted and the catalog stays unread until a user is present. Run report stays closed until `report_runs.create`. Scheduled reports stay closed until `scheduled_reports.view`, with manage and run left on their existing action permissions. A failed load shows Try again. `/reports/library` is outside this inventory and was left unchanged.
- Verification: frontend typecheck and the security-family acceptance tests. Live signed-in review is still open.

## Record book — 22 September 2026

- Closed all eight record-book routes. Every read, including the daily-sale and expense details, stays closed until `record_book.view`. Each primary read keeps only the latest request, and a failed load shows Try again. Create, update, delete, finalize, void, restore, and export stay on their existing action permissions.
- Verification: frontend typecheck and the record-book acceptance tests. Live signed-in review is still open.

## Procurement — 22 September 2026

- Closed all five procurement routes. The dashboard requires `procurement.dashboard`. Requisitions require `purchase_requisitions.list`. Goods received notes require `grn.list`, and a goods-received detail stays on `grn.view`. Supplier invoices require `supplier_invoices.list` or `supplier_invoices.view`. Three-way matching requires `three_way_match.list`. Each primary read keeps only the latest request, and a failed load shows Try again. Create, update, approve, post, and void stay on their existing action permissions. Form messages stay separate from the list retry.
- Verification: frontend typecheck and the procurement acceptance tests. Live signed-in review is still open.

## Notifications — 22 September 2026

- Closed `/notifications`. The list and unread count stay closed until `notifications.view`. Each of those reads keeps its own latest request, and a failed list shows Try again. Deleting a notification stays on `notifications.manage`.
- Verification: frontend typecheck and the inventory-family acceptance tests. Live signed-in review is still open.

## Msaidizi — 22 September 2026

- Closed `/msaidizi`. The page already stays blank while auth is loading and refuses the assistant without `msaidizi.use`. The conversation list now keeps only the latest request and still offers Try again. Sending a message stays an action error.
- Verification: frontend typecheck and the inventory-family acceptance tests. Live signed-in review is still open.

## Mobile POS — 22 September 2026

- Closed both mobile POS routes. The terminal and the activation form stay closed until `mobile_pos_lite.use`. Catalog and session reads do not start without that permission, a failed boot shows Try again, and the activation form keeps validation and a failed activation as form messages.
- Verification: frontend typecheck and the inventory-family acceptance tests. Live signed-in review is still open.

## Inventory — 22 September 2026

- Closed both inventory routes. The workspace already waits for auth, shows Inventory access is restricted when the role has no inventory view, and its section reads already cancel stale results and offer Try again. The product detail re-exports the operations product profile, which already refuses the read until a product view permission and retries a failed load.
- Verification: frontend typecheck, the existing inventory workspace tests, and the inventory-family acceptance tests. Live signed-in review is still open.

## Integrations — 22 September 2026

- Closed all ten integration routes. None are in the sidebar. Each list stays closed until the view permission its API already requires: connections `integration_connections.view`, events `integration_events.view`, mappings `integration_mappings.view`, messages `external_messages.view`, payments `external_payments.view`, providers `integration_providers.view`, templates `message_templates.view`, webhook events `webhook_events.view`, and webhook endpoints `webhook_endpoints.view`. The dashboard reads only the endpoints the user can view, among `integration_providers.view`, `integration_connections.view`, `integration_events.view`, and `api_keys.view`. Each read keeps only the latest request, and a failed load shows Try again. Provider and template manage actions stay on their existing permissions.
- Verification: frontend typecheck and the integrations acceptance tests. Live signed-in review is still open.

## Group control — 22 September 2026

- Closed all ten group-control routes. Overview requires `group-control.view`. Bank accounts require `bank-accounts.read`. Loans and debts require `loans.read` or `debts.read`, and the loan detail requires `loans.read`. Contracts and the contract detail require `contracts.read`. Fixed assets and the asset detail require `fixed-assets.read`. Documents and the document detail require `documents.view`, the permission that API already enforces. List and detail reads keep only the latest request. A failed load shows Try again. The loans register already cancelled stale reads through the shared workspace hooks. Create, update, and delete stay on their existing action permissions.
- Verification: frontend typecheck and the group-control acceptance tests. Live signed-in review is still open.

## Fuel grid — 22 September 2026

- Closed `/fuel-grid`. The route renders the shared app launcher, which already refuses the status check until `fuel_grid.access`, keeps only the latest status request, and offers Check again. No page rewrite.
- Verification: the existing fuel-grid launcher tests. Live signed-in review is still open.

## Finance — 22 September 2026

- Closed all 15 finance routes. Each read stays closed until the sidebar view permission already on that page: dashboard `finance.view`, chart of accounts `chart_of_accounts.view`, fiscal years `fiscal_years.view`, accounting periods `accounting_periods.view`, journal entries `journal_entries.view`, cash accounts `cash_accounts.view`, expenses and expense categories `expenses.view`, receivables and credit notes `receivables.view`, customer payments `customer-payments.view`, refunds `refunds.view`, payables `payables.view`, intercompany `intercompany.view`, and reports `finance.reports.view`. Each primary read keeps only the latest request, and a failed load shows Try again. Manage, approve, post, and pay actions stay on their existing permissions. A report that is waiting for a company selection does not show a list retry.
- Verification: frontend typecheck and the finance acceptance tests. Live signed-in review is still open.

## Document templates — 22 September 2026

- Closed all four document-template routes. The sidebar group uses `document_templates.list`. The template list requires that same permission. Generated documents require `generated_documents.list`. Number sequences require `doc_sequences.list`. The print engine has no list read; the page stays closed until `print_engine.render`, and a second render ignores the previous request. Each list keeps only the latest read, and a failed load shows Try again. Create, update, and delete stay on their existing action permissions. Invalid JSON in the print form stays a form message.
- Verification: frontend typecheck and the document-template acceptance tests. Live signed-in review is still open.

## Data isolation — 22 September 2026

- Closed all three data-isolation routes. None are in the sidebar. The dashboard, issues, and test runs require `data_isolation.view`, the permission already enforced by those APIs. Each read keeps only the latest request, and a failed load shows Try again. Acknowledging, resolving, and dismissing an issue stay on `data_isolation.resolve_issues`. Starting, completing, and logging a test run stay on `data_isolation.run_tests`.
- Verification: frontend typecheck and the data-isolation acceptance tests. Live signed-in review is still open.

## Dashboard — 22 September 2026

- Closed `/dashboard`. The sidebar link has no leaf permission. The executive summary now stays unread until the signed-in user holds one of the permissions already accepted by that API: `group-control.view`, `operations.dashboard.view`, `operations.reports.view`, `finance.view`, `finance.reports.view`, `receivables.view`, `payables.view`, `procurement.dashboard`, `westsides.dashboard.view`, `petroleum.dashboard.view`, `hr.dashboard.view`, `compliance.dashboard.view`, `approvals.dashboard.view`, or `profit.view`. The read keeps only the latest request. A failed load shows Try Again. A signed-in user without one of those permissions sees the existing Access Restricted state. Group-control figures stay on `group-control.view`.
- Verification: frontend typecheck and the dashboard acceptance tests. Live signed-in review is still open.

## CRM — 22 September 2026

- Closed all five CRM routes. The dashboard requires `crm.dashboard`. Credit profiles require `credit_profiles.list`, supplier performance requires `supplier_performance.list`, and supplier statements require `supplier_statements.list`. Customer statements already required `customer_statements.list` or `customer_statements.view`. Each read keeps only the latest request, and a failed load shows Try again. Create and update stay on their existing action permissions. Statement generate stays on `customer_statements.generate`, and the statement-of-account read stays on `customer_statements.view`.
- Verification: frontend typecheck and the CRM acceptance tests. Live signed-in review is still open.

## Compliance — 22 September 2026

- Closed all 19 compliance routes. Each list, the dashboard, the calendar, tax returns, OSHA registrations, and the tax cockpit now keep only the latest read and refuse that read until the sidebar or API view permission is present. A failed load shows Try again. OSHA is not in the sidebar; its list uses `compliance.dashboard.view` and its create, edit, and delete stay on `compliance_obligations.manage`. The tax cockpit is not in the sidebar; filing periods use `tax_filing_periods.view`, and the anomaly scan, preview, compute, and auto-apply stay on `finance.reports.view`. Form validation messages stay separate from the list retry.
- Verification: frontend typecheck and the compliance acceptance tests. Live signed-in review is still open.

## Companies — 22 September 2026

- Closed all three company routes. The list already required `companies.read`, cancelled the previous page request, and offered Try again. Add company still requires `companies.create`. Its group choices now keep only the latest read, and a failed group load shows Try again without turning a form-validation message into a list retry. The company detail requires `companies.read` before it reads, keeps only the latest company request, and a failed load shows Try again. Edit, delete, division, branch, and legal-profile actions stay on their existing permissions.
- Verification: frontend typecheck and the company acceptance tests. Live signed-in review is still open.

## Backups — 22 September 2026

- Closed all four backup routes. The dashboard requires `backups.dashboard.view`, jobs require `backup_jobs.view`, runs require `backup_runs.view`, and the disaster-recovery runbook requires `disaster_recovery.view`. Dashboard, jobs, and runs keep only the latest read, and a failed load shows Try again. Create, edit, and delete on jobs stay on `backup_jobs.manage`. The disaster-recovery page is a static runbook and does not fetch.
- Verification: frontend typecheck and the backup acceptance tests. Live signed-in review is still open.

## Background jobs — 22 September 2026

- Closed both background-job routes. Neither is in the sidebar. The job list requires `background_jobs.view` and queue configuration requires `job_queue_configs.view`, the permissions already enforced by those APIs. Each read keeps only the latest request, and a failed load shows Try again. Retry and cancel stay on `background_jobs.retry` and `background_jobs.cancel`. Queue activate and deactivate stay on `job_queue_configs.manage`.
- Verification: frontend typecheck and the background-job acceptance tests. Live signed-in review is still open.

## Automation — 22 September 2026

- Closed both automation routes. Rules require `automation_rules.list` and runs require `automation_runs.list`. Each list keeps only the latest read, and a failed load shows Try Again through the shared table. Company choices abort with the page. Auth loading shows a loading shell before the permission check. Create, update, delete, and activate stay on their existing action permissions.
- Verification: frontend typecheck and the automation acceptance tests. Live signed-in review is still open.

## Audit logs — 22 September 2026

- Closed `/audit-logs`. The page already refused the read without `audit-logs.read` and aborted the previous list request. A superseded read no longer clears the newer request’s loading state. Filter choices abort with the page. A failed load shows Try again. Auth loading shows a loading shell before the access check.
- Verification: frontend typecheck and the audit-log acceptance tests. Live signed-in review is still open.

## Apps — 22 September 2026

- Closed both app routes on the code that already serves them. `/apps` is hosted by the OS shell as the app library. It waits for auth, then shows only apps the current role can open. It has no network read.
- `/apps/[appId]` opens an external app through the shared launcher. The status check aborts the previous request, stays idle until the app permission allows it, and the launcher offers Check again after a failed check. That label is the launcher’s existing retry.
- Verification: the existing app-library and Fuel Grid launcher tests, 9/9. Live signed-in review is still open.

## API gateway — 22 September 2026

- Closed `/api-gateway/logs`. The page is not in the sidebar. The read now requires `api_request_logs.view`, the permission already enforced by the request-log API. Only the latest read is kept, and a failed load shows Try again.
- Verification: frontend typecheck and the API gateway acceptance tests. Live signed-in review is still open.

## Alerts — 22 September 2026

- Closed both alert routes. Alert events require `alert_events.view` and alert rules require `alert_rules.view`. Each list keeps only the latest read. A failed load shows Try again. Rule edits still use `alert_rules.manage`; event actions still use acknowledge, resolve, and dismiss.
- Verification: frontend typecheck and the alerts acceptance tests. Live signed-in review is still open.

## Accounting engine — 22 September 2026

- Closed the 10 accounting-engine routes at the code bar. Posting runs, period close, accounting locks, depreciation, and audit adjustments already cancel stale reads, retry, and refuse the list without `posting_runs.list`, `period_close.list`, `accounting_locks.list`, `depreciation.list`, or `audit_adjustments.list`. Bank reconciliations already do the same with `bank_reconciliations.list` and `bank_reconciliations.view`.
- The dashboard, posting rules, financial statements, and loan repayments now keep only the latest read, show Try again after a failed load, and refuse the read without `accounting_engine.dashboard`.
- Verification: frontend typecheck and the accounting-engine acceptance tests. Live signed-in review is still open.

## Westsides — 22 September 2026

- Closed the remaining Westsides registers at the same code bar as Operations: cockpit, price lists, customer price agreements, returnable packages, package movements, quotations (list and print), proforma invoices (list and print), delivery notes (list and print), customers (list, profile, and profile print), reports, daily close, quick sale, and Mobile POS day reports and terminals.
- Each of those reads now keeps only the latest request. A failed page load shows Try again. The page refuses the read without the sidebar view permission (`westsides.dashboard.view`, `price_lists.view`, `customer_price_agreements.view`, `returnable_packages.view`, `package_movements.view`, `quotations.view`, `proformas.view`, `delivery_notes.view`, `customers.view`, `westsides.reports.view`, `sales.create`, `mobile_pos_lite.manage`). Quotation, proforma, and delivery-note prints keep the continuation sheet whenever overflow lines remain. Report print repeats the header and avoids splitting a row.
- Live stock and batches/expiry were already reviewed. Stock damage remains the existing inventory-damage workspace. The Mobile POS install page is a static server page with no data read.
- Verification: frontend typecheck and the Westsides acceptance tests. Live signed-in filter, draft Stay/Discard, reduced motion, and console review still depend on a fresh browser session.

## Operations — 22 September 2026

- Closed the remaining 13 Operations routes: hub, profit, operations reports, supplier 360, sales orders (list, detail, print), and purchase orders (list, detail, print, supplier drafts, draft detail, draft print).
- Each read now keeps only the latest request. A failed load shows Try again. Detail and print routes refuse the read without the matching view permission. Sales, purchase, and supplier-draft prints keep totals on page 1 and continue overflow lines. Operations report print repeats the header and avoids splitting a row; a 1,000-row cap is stated on screen.
- Verification: frontend typecheck and the operations acceptance tests. Live signed-in filter, draft Stay/Discard, reduced motion, and console review of these 13 still depend on a fresh browser session, the same open gate already recorded for stock damage.

## Stock damage — 18 September 2026 (live review pending)

- Rebuilt the damage register with the shared OS list/inspector, 20-row server pagination, combined company/division/branch/product/search/status/type filters and complete CSV/PDF exports. Selected reports retain quantity/unit, estimate, identifiers, scope, batch, reporter/approval names, timestamps and notes. Zero and unknown values remain distinct. Same-view URLs are authoritative; obsolete reads/exports are cancelled and failures expose retry.
- Added scoped search/type/division queries and named relations to the existing list/detail APIs. List totals share the same company-scoped predicate and pagination has a stable ID tie-breaker. Existing submit, approval, inventory posting, batch relief and accounting rules remain unchanged.
- New damage drafts use complete permission-aware choices, product and optional batch selection, four-decimal positive quantities, optional two-decimal estimates and Stay/Discard protection. Failed saves retain input. Submit, approve, reject and post follow exact statuses and permissions; named confirmations reload current details and explain their effect. Posting explicitly distinguishes estimated value from actual inventory value relieved. No live business record was created or changed.
- Verification: 19 damage frontend tests, three Inventory shell regressions and ten backend query/DTO/posting tests passed (32 total). Targeted ESLint, frontend production build (200 static pages, including TypeScript) and backend build passed. Coverage includes scope/paging, read failures, export completeness/failure/limits/cancellation, action eligibility, failed decisions, draft protection and create payloads.
- Compared inventory-damage-desktop.png with selected-reference.png at 1487×1058. Phone 390×844 evidence: inventory-damage-mobile.png, inventory-damage-details-mobile.png, inventory-damage-fields-mobile.png, inventory-damage-post-mobile.png, inventory-damage-editor-mobile.png and inventory-damage-editor-fields-mobile.png. Document width measured 390; details, lower form fields and actions remain reachable. inventory-damage-dark.png and inventory-damage-post-dark.png reviewed. These captures are synthetic React-test DOM with production CSS, not live-data verification. Restored normal viewport and closed the temporary preview tab/server.
- Local services were stopped at review time. Docker startup failed on inaccessible stale sockets in its runtime and secrets-engine socket directories. Preserved those directories under `.phase5-stale-20260918` / `.phase5-retry-20260918` siblings, recreated empty runtime directories and restarted Docker without changing its data volumes. Existing PostgreSQL/Redis containers became healthy. Restarted the compiled backend on 3014; `/api/v1/health` reports ok/database up and stderr is empty. Frontend development server runs on 3009.
- The previous browser session has expired; a fresh sign-in was requested. Live authenticated filters, real choice loading, draft Stay/Discard, reduced motion and console verification remain open. Do not count this route as fully reviewed yet: Operations remains 12/25 and Westsides 2/23. Full 215-route Phase 5 remains active, including native date/time popup and browser-print pagination gaps.

## Inventory reports — implementation checkpoint, live review pending

The reports increment was implemented before the user prioritised the independent Invoice Desk app. Frontend report/export/shell tests (34), backend report tests (7), and both builds passed. Desktop, phone and dark synthetic fixtures were reviewed; authenticated report review remains pending. Route completion counts are unchanged. The temporary reports preview server has been closed. Continue the ERP rollout after the app priority is addressed.

Source audit on 18 September identified the following work for the seven report views in `frontend/src/features/inventory/inventory-reports.tsx`:

- Replace the report-card grid and wide table with the OS report chooser/results/detail experience, preserving every report and export. Keep quantities with units and distinguish unknown values from zero; the current generic number formatter rounds quantities to two decimals.
- Read lifecycle currently has neither request cancellation nor stale-response protection. Scope changes can leave prior rows exportable while the next request loads. Use keyed, cancellable results and clear old report actions on scope/report changes.
- Movement reports return a paginated `{ rows, total, page, pageSize }` contract, defaulting to 20 rows. The frontend currently normalizes only `rows`, losing the total and exporting the first page. Add visible pagination and complete export handling, preserving server disclosure metadata for all report types.
- Westsides report requests currently send `divisionId` and `locationId` although `QueryReportDto` accepts neither and global validation forbids unknown fields. Support division deliberately for the two Inventory report endpoints, use their actual request contract, and verify branch/division scoping: `batchStatus` currently ignores its branch filter.
- The damage report groups quantities only by damage type/status, combining unlike products/units. Preserve useful money/count aggregates while making quantity groups meaningful. Verify this contract alongside the existing full Westsides reports page before changing the shared endpoint.

This is an audit and next-work list, not a completed report rollout. It can proceed independently while authenticated stock-damage review awaits sign-in.

## Stock adjustments — 18 September 2026

- Replaced the wide adjustment table with the OS list/inspector and a focused line-review modal. Branch, line count, reason, notes, company/division, creator and timestamp remain inspectable. Full review shows four-decimal system/count/difference quantities, units, recorded costs and the creation/approval/posting trail; unknown values remain distinct from zero. Phone rows retain branch and line count, with all review fields and actions reachable.
- Company, division and branch now reach the list API. Added combined number/reason/notes/company/branch search, stable pagination and readable division relations; list and total use the same scoped predicate. Dates include the whole selected UTC end day, invalid/reversed ranges are rejected, same-view URL changes take effect and obsolete reads/exports are cancelled. Failed list/detail reads expose retry instead of stale rows or a permanent spinner. CSV/PDF load every matching page; PDF explicitly refuses more than 5,000 rows.
- New adjustment uses complete permission-aware directory choices, stable line identities, cancellable branch/product balance reads, explicit missing-balance manual entry, finite four-decimal quantity/cost validation and Stay/Discard protection. Create-only users can enter a verified manual system count without an unauthorized balance read. Company changes clear dependent products and branch changes clear obsolete counts. Failed saves preserve the draft. Canonical create payload and existing backend approval/posting logic remain unchanged.
- Review actions follow the exact backend statuses and permissions, including create-only read access and deletion limited to Draft/Rejected. Submit, approve, reject, post, revert and delete show a named-record confirmation with the effect; rejection reasons are retained through failed operations and protected on exit. Posting remains the step that changes inventory/accounting. Destination links use the record's scope and their own permissions.
- Twenty frontend adjustment tests, three Inventory shell regressions and ten backend query/DTO/existing adjustment tests passed (33 total). Targeted lint, TypeScript, final frontend production build (200 static pages) and backend build passed. Restarted backend on 3014; health ok/database up, stderr empty. Tests cover complete export failures/limits/cancellation, scoped paging/dates, same-view URLs, all six statuses, permissions, detail retry, posting confirmation/failure recovery, rejection draft protection, create payload and obsolete balances.
- Live verification covered company/branch with inferred division, combined search/status/typed dates, reset/refresh, actual product/unit choices, missing-balance explanation, a four-decimal count and Stay/Discard. No business adjustment was saved, approved, posted or deleted. Browser console errors empty. Reduced-motion Refresh transition/animation measured 0s. Restored Light/Follow device, All companies and normal viewport.
- Compared inventory-adjustments-desktop.png with selected-reference.png at 1487×1058. Populated review evidence: inventory-adjustment-review-desktop.png, inventory-adjustment-review-mobile.png, inventory-adjustment-review-actions-mobile.png and inventory-adjustment-review-dark.png. Phone list/inspector: inventory-adjustments-mobile.png and inventory-adjustments-details-mobile.png at 390×844, document width 390. These populated captures use synthetic React-test DOM with production CSS because the real register is empty. inventory-adjustments-filters-mobile.png, inventory-adjustment-editor-live-mobile.png and inventory-adjustments-live-dark.png are live. Visual review corrected the inspector action width and product-link affordance/dark contrast. Temporary preview tabs/server closed.
- Operations now has 12/25 reviewed routes; Westsides remains 2/23. Stock damage and the remaining ERP families are still open. Full 215-route Phase 5 remains active, including the existing native date/time popup and browser-print pagination gaps.

## Batches and expiry — 18 September 2026

- Replaced the nine-column/100-record batch page with the OS list/inspector and 20-row server pagination. Expiry date and remaining quantity remain visible on phones; all prior fields plus unit, cost, identifiers, received date, purchase-order reference and notes remain inspectable. Backend list relations supply actual product, supplier, company, branch/division and unit labels. Unknown quantities/dates remain distinct from zero; four-decimal quantities retain their unit.
- Added combined search/status filters and unified paginated expiry review through the existing list endpoint. Company, division, branch and product now apply to both expiry views. The existing inclusive 30-day Active rule and strict-past Active/Expired rule remain unchanged; status filters intersect those rules. Counts match the complete filtered collection. Same-view URLs are authoritative, obsolete reads are cancelled, failed refreshes clear stale rows and expose retry, and pagination clamps after collection shrinkage. Destination links use the selected row's scope and their exact read permissions.
- Rebuilt New batch with complete permission-aware company/branch/supplier/unit choices, recoverable directory errors, company-dependent reference reset, positive four-decimal quantity/date-order validation, retained failed saves and Stay/Discard draft protection. Creation payload and auto-numbering remain unchanged; no new stock mutation workflow was introduced. Browser review found that the embedded Inventory shell hid the header action; moved New batch into its toolbar. Added shared section spacing after visual review.
- Eleven frontend batch workflow tests, three Inventory shell regressions and seven backend batch filter/scope tests passed (21 total). Targeted frontend lint, TypeScript and final production build passed (200 static pages); backend build passed. The initial backend test process hit Node's default heap limit; the verified terminated process was rerun with an 8 GB heap and passed. Backend restarted on 3014; health ok/database up, stderr empty.
- Live review covered company/branch and inferred division, search/status with both expiry views, refresh/reset, actual directory choices, typed manufacture/expiry dates and a draft retained through Stay then discarded. No business record was saved or deleted. Reduced-motion refresh transition/animation measured 0s, final console errors empty, Light/Follow device, All companies and normal viewport restored.
- Compared inventory-batches-desktop.png and inventory-batches-fields-desktop.png with selected-reference.png at 1487×1058. Phone 390×844: inventory-batches-mobile.png, inventory-batches-details-mobile.png and inventory-batches-fields-mobile.png are synthetic React-test DOM with production CSS; inventory-batches-filters-mobile.png and inventory-batch-editor-mobile.png are live. Both populated and live document widths measured 390. inventory-batches-live-dark.png reviewed at 1280×720. Populated evidence is synthetic because the real collection is empty. Temporary preview tab/server closed.
- Westsides is now 2/23 reviewed routes; Operations remains 11/25. Stock adjustments, damage and the remaining ERP route families are still open. Full 215-route Phase 5 remains active, including the existing native date/time popup and browser-print pagination gaps.

## Live stock — 18 September 2026

- Rebuilt live stock with the shared OS list/inspector, complete location groups and paginated stock positions. Attention, reservations, negative stock, 30-day movement age and missing movement history remain distinct. Summary money/counts cover the complete API collection; quantities and reservation shares stay with individual products so incompatible units are not added together. Unknown values remain distinct from zero. The register reads complete location items, not the capped twelve-item risk preview.
- Preserved company/division/branch and search scope, configurable fallback threshold, manual refresh and optional 30-second refresh. Invalid/empty thresholds suppress reads; zero is valid. Failed refreshes clear stale values and offer retry. Last successful update is explicit and ages even when automatic refresh is off. Scope/search changes cancel obsolete reads; refresh retains the local review and location selection. Complete directory choices and every destination obey their own read permissions.
- Backend live rows now include their actual company/division/branch for product, movement and batch links. Non-finite/negative fallback thresholds fail before database reads. Threshold precedence, valuation, posting and stock classifications remain unchanged. Damage/report links open scoped registers and do not claim unsupported product filtering.
- Eleven live-stock frontend tests, twelve shell/movement regressions and thirteen backend live-stock tests passed (36 total). Targeted ESLint, TypeScript, frontend production build (200 static pages) and backend build passed. Restarted backend on 3014; health reports ok/database up and stderr is empty.
- Live review verified company/branch selection with inferred division, combined search and attention filters, negative-threshold validation and zero recovery, manual refresh, reset and automatic-refresh controls against the empty real collection. During the backend restart, stock and directory reads displayed errors; their independent retry controls recovered successfully. No business records changed. Final browser console errors were empty.
- Compared inventory-live-desktop.png and inventory-live-inspector-desktop.png against selected-reference.png at 1487×1058. Phone captures inventory-live-mobile.png, inventory-live-details-mobile.png and inventory-live-fields-mobile.png preserve available quantity, value, all detail fields and reachable actions; inventory-live-filters-mobile.png is the live app. Both phone document widths measured 390 at 390×844. Populated and dark evidence (inventory-live-dark.png) uses synthetic React-test DOM with production CSS. Shared movement phone styling was also visually rechecked. Reduced-motion refresh transition/animation measured 0s. Restored Light/Follow device, All companies and the normal viewport; temporary fixture tab/server closed.
- Westsides is now 1/23 reviewed routes; Operations remains 11/25. Batches/expiry, adjustments, damage and other route families remain open. Full 215-route Phase 5 remains active, including previous native date/time popup and browser-print pagination gaps.

## Stock movements — 18 September 2026

- Replaced the eleven-column movement table with the shared OS list/inspector. Desktop keeps quantity, recorded cost and movement type prominent; phone rows now show labelled quantity and cost without opening details. The inspector preserves source identifiers, notes, creator, batch and expiry, and displays readable unit/division names. The backend list includes those two relations under its existing company scope; stock posting, valuation and mutation rules are unchanged.
- Preserved product, company/division/branch, movement-type, source and date filters, legacy location links and 20-row server pagination. Same-view URL changes update filters immediately. Product search and destination links respect their own read permissions. The existing complete-register summary replaces page-only receipt/issue/cost totals. Quantity directions distinguish inbound, outbound and unclassified types; unknown quantities/costs remain distinct from zero. Dates are labelled UTC to match API range boundaries; reversed dates suppress reads and show validation.
- CSV reads every matching page; PDF explicitly refuses more than 5,000 records. Later-page and PDF failures remain retryable without a partial download. Filter/scope changes cancel obsolete reads and exports. Summary and register errors retry independently. Product links preserve the row's scope; source links require the destination permission, and Same source applies the exact reference filters.
- Nine movement frontend tests, three Inventory shell regressions and five backend movement-summary/contract tests passed. Coverage includes keyboard product selection, combined filters/pagination, permissions, same-view deep links, stale reads/exports, independent failures, complete CSV/PDF, PDF limits, date ordering, shared API filter predicates and company denial before database reads. Targeted lint and TypeScript passed. Final frontend production build passed and generated 200 static pages; backend build passed. Backend restarted on 3014 and health reports ok/database up; stderr empty.
- Live company scope, combined type/source/typed date range, invalid-date recovery, refresh and reset were verified against the empty real collection. No live business records were changed. Opening the native calendar popup crashed the in-app browser again; recovered in a fresh tab. Native popup verification remains unresolved. Final recovered-tab console errors were empty. Light/Follow device, All companies and normal viewport were restored.
- Compared inventory-movements-desktop.png with selected-reference.png at 1487×1058; inventory-movements-source-desktop.png shows lower inspector fields and reachable actions/pagination. Phone 390×844: inventory-movements-mobile.png, inventory-movements-details-mobile.png and inventory-movements-actions-mobile.png use synthetic React-test DOM with production CSS; inventory-movements-filters-mobile.png is live. Width measured 390. Visual review corrected uneven filter widths and a CSS cascade that initially hid phone quantity/cost. inventory-movements-live-dark.png reviewed; Reduced motion refresh transition/animation measured 0s. Temporary fixture tab/server cleaned up.
- Operations is now 11/25 reviewed routes. Live stock, batches, adjustments, damage, reports and remaining ERP route families are still open. Full Phase 5 remains active across 215 routes, including native date/time popup and browser-print pagination gaps.

## Inventory balances — 18 September 2026

- Replaced the thirteen-column stock table with the shared OS list/inspector. Available quantity and valuation remain prominent; on-hand/reserved quantities, reorder level, average cost, stock/cost status, category/family, identifiers, organisation and movement age remain inspectable. Product and movement links require their own permissions and now preserve the selected balance's company, division and branch. Same-category/family actions remain available.
- Preserved company/division/branch, search, category/family, stock/cost and age filters, 25-row server pagination and legacy low-stock/location links. Complete directory choices replace first-page limits and obey their actual read permissions. Scope changes clear dependent filters and cancel obsolete reads. Summary and register failures retry independently instead of turning into zero/empty results. Unknown values remain distinct from zero and negative availability. Stale counts explicitly require an age threshold.
- CSV reads every matching page. PDF explicitly refuses more than 5,000 records; failed later-page exports never download a partial file. Filter changes cancel pending exports. All previous export fields remain, with SKU/barcode added; numeric zero and negative quantities are preserved.
- Eleven new frontend tests and three Inventory shell regressions passed. Three new backend contract tests plus five existing low-stock tests passed. Tests cover exact permissions, combined filters, complete aggregates versus pagination, scope-preserving links, selector pagination/retry, stale reads/exports, unknown/zero values, register and summary failure recovery, PDF failure/retry/limit and complete CSV. An initial backend assertion needed a fixed clock for its two age-cutoff reads; the corrected test passed. Backend runtime/business rules were not changed.
- Targeted ESLint, TypeScript and final production build passed (200 static pages). Backend health reports ok/database up. Live company plus search/stock/cost/age filtering, refresh and reset returned empty results without errors. No live stock/product/accounting record was changed. Browser console errors empty.
- Compared inventory-balances-desktop.png with selected-reference.png at 1487×1058. Reduced the inspector action stack to two columns and aligned detail labels/values after review. Phone 390×844: inventory-balances-mobile.png, inventory-balances-details-mobile.png, inventory-balances-fields-mobile.png (synthetic populated React-test DOM with production CSS), and inventory-balances-filters-mobile.png (live). Both document widths measured 390. inventory-balances-live-dark.png reviewed; Reduced motion refresh transition/animation measured 0s. Restored Light/Follow device, All companies and normal viewport. Temporary preview tab/server closed.
- Operations is now 10/25 reviewed routes. Movements, live stock, batches, adjustments, damage, reports and other Phase 5 route families remain open. Full Phase 5 remains active across 215 routes; earlier native date/time popup and browser-print pagination gaps remain open.

## Inventory shell and stock-health overview — 18 September 2026

- Rebuilt Inventory navigation with quiet section tabs, secondary views, a shared company/division/branch scope and an optional product finder. Scope choices read every page, respect directory permissions and offer retry. Selecting a branch resolves its division; changing a parent clears dependent scope. Existing scoped URLs and draft Stay/Discard protection remain connected. Child stock workflows still require their own rollout and permission review.
- Replaced the overview with a compact stock-health summary, pending adjustments and a recent-movement list/inspector. Stock positions explicitly mean product/branch pairs. Independent failed reads expose retry and never masquerade as zero; scope changes cancel obsolete reads. Movement direction and unknown quantities remain accurate. CSV/PDF export buttons explicitly export the latest-six preview, with full-register links alongside them.
- Product search now ignores stale responses, distinguishes unknown availability from zero, supports retry and keyboard access, and guards navigation against unsaved drafts. Browser review caught native search-input Escape clearing the query; Escape now closes the popup without clearing the search or losing its URL context.
- Verification: 19 frontend tests passed (seven overview, five scope, three shell and four search). These cover independent permissions, complete directory pagination, scope inheritance/reset, stale responses, independent failures/retries, preview exports, draft protection and keyboard navigation. Shell tests use isolated child views; the actual catalogue/units integration was reviewed separately in the browser. Ten existing backend live-stock/movement-summary checks passed in the implementation pass. Targeted lint and TypeScript passed. Backend health reports ok/database up; no live business records changed.
- Live review exercised real company and branch choices, automatic division selection, refresh, empty-state search, preserved scope/query across Products and Units, and restored All companies afterward. Populated overview evidence uses synthetic component-test DOM with production CSS because the live collection is empty. Reviewed inventory-overview-desktop.png against selected-reference.png at 1487×1058. Corrected stacked summary labels and dark link contrast after visual inspection.
- Phone evidence at 390×844: inventory-overview-mobile.png, inventory-overview-details-mobile.png (synthetic) and inventory-shell-mobile.png (live). Both measured document width 390. inventory-overview-dark.png is synthetic and precedes the final link-contrast correction; inventory-shell-dark.png records the final live contrast. Reduced-motion refresh transitions/animations measured 0s. Original Light/Follow device and normal viewport restored; console errors empty. Temporary preview tab/server closed.
- Final production build passed TypeScript and generated all 200 static pages after the Escape and contrast fixes. Operations now has nine of 25 routes reviewed. Inventory balances, movements, live stock, batches, adjustments, damage and reports remain open, along with the other Phase 5 route families. The full 215-route goal remains active; earlier native date/time popup and browser-print pagination verification gaps are unchanged.

## Products register and profile — 17 September 2026

- Replaced the products table with the shared searchable list/inspector, product thumbnails, server pagination, combined company/division/branch/category/family/type/status/price-source filters and scoped stock indicators. The embedded Inventory workspace supplies its scope; changing it clears dependent category/family choices. Full product identity, variants, units, prices, inventory settings, tax, description and status remain inspectable. Missing prices/quantities remain distinct from zero. Page-only status counts are labelled explicitly.
- Directory choices and CSV exports read every page. PDF refuses collections above 5,000 rows explicitly. Filter changes cancel stale reads and exports; failed later pages never download a partial export. Exact read/create/update/delete and directory permissions control access. Shared product editing, immediate image refresh, generated/skipped family-size notifications and named delete failures/retry remain connected to the register.
- The full product profile now uses the shared OS layout, compact price/margin summary, permission-aware Overview/Stock/Movement/Profitability sections and shared guarded editor. Stock totals include every balance page, with local display pagination. Movement history keeps server pagination; profitability preserves recorded unit cost, total cost of sales, gross profit, margin and cost source, and explicitly labels the API's latest-250-lines limit. Failed reads offer retry instead of pretending history is empty; obsolete requests are cancelled. Zero, unknown cost and negative availability are preserved. Refresh retains the selected section. Back navigation retains company/division/branch/search context.
- Related-workspace links now use the actual GRN route and destination read permissions. They describe opening registers, without claiming unsupported product-prefilled creation. Sales-order links require sales.view. Product detail reads now include division identity after the existing company access check; pricing, mutation and posting rules are unchanged.
- Verification: 21 new frontend workflow tests (11 register, 10 profile) and 27 editor/catalogue regression tests passed. Eight backend product read/pricing checks passed. Targeted ESLint, frontend production build/TypeScript (200 pages) and backend production build passed; the final inventory-movement navigation link also passed profile tests, lint and TypeScript. Backend restarted on 3014; health reports status ok and database up. No live business record or image was created, changed or deleted.
- Live review exercised company scope plus combined type/status/price-source/search filters in embedded Inventory. The real product collection is empty, so populated profiles, stock, movement and profit history are synthetic component-test DOM with production CSS, not live records. Live console errors were empty. Dark register and Reduced motion reviewed at 1280×720; New product transition/animation measured 0s. Original Light/Follow device and All companies restored.
- Desktop evidence at 1487×1058: product-register-desktop.png, product-profile-desktop.png, product-profile-movements-desktop.png and product-profile-profit-desktop.png, compared with selected-reference.png. Corrected profile page padding, vertical stretching and mobile summary density after visual inspection. Phone 390×844: product-register-mobile.png, product-register-details-mobile.png, product-register-actions-mobile.png, product-profile-mobile.png, product-profile-details-mobile.png, product-profile-stock-mobile.png, product-profile-movements-mobile.png and product-profile-profit-mobile.png. Document width measured 390; inspector actions appear near the phone heading and history columns become labelled rows. product-register-dark.png is live; product-profile-dark.png is synthetic. Screenshots precede the final text-link restoration to Inventory movements.
- Temporary preview tab/server closed and normal viewport restored. Operations now has eight of 25 routes reviewed. The full Inventory wrapper, remaining Operations workflows and other route families remain open. Full Phase 5 stays active across the 215-route inventory, including earlier native date/time popup and browser-print pagination verification gaps.

## Product editor — 17 September 2026

- Replaced the embedded product modal with a shared OS editor grouped into identity/organisation, family/variant, prices/tax and units/inventory. Preserved product codes, SKU/barcode, all variant fields, optional units, tax/tracking switches, status, description, family creation and automatic family-size generation; maximum stock is now editable alongside minimum/reorder levels. Inherited-price fields display family amounts while retaining unsaved overrides for toggling back. The estimated gross margin remains visible with its basis explained.
- Edits send changed fields only and explicitly clear nullable fields. Existing company-wide scope is preserved even when editing within a division. Draft Stay/Discard protects changed inputs; failed saves retain them. Complete, permission-gated selectors expose failures and retry, and company-wide products exclude division-specific families. Family-size creation explains its scope and the register now reports generated counts and skipped families/reasons. Backend pricing and mutation rules are unchanged.
- Images still save immediately through the dedicated endpoint; the editor explains this separately from the form and refreshes the parent register after image changes. MIME/size checks, image failures and pending-action guards remain explicit. The shared upload input now has an associated label, visible keyboard focus, disabled-drop protection and supports selecting the same file again after failure.
- Verification: 13 new product-editor tests passed, plus 14 existing catalogue workflow tests. Tests cover changed-field/nullable updates, retained company-wide scope, failed saves/retry, drafts, family price display and margin validation, complete family choices and later-page failure, sibling scope, inline family creation, tax/stock/unit data, distinct create/update/read permissions, and independent image upload/removal/failure/pending states. Twenty-six existing backend product-image, price-source, family-query and profit checks passed. Targeted ESLint and production build/TypeScript passed (200 static pages); a final success-notification callback restoration also passed TypeScript. Backend health HTTP 200.
- Live review opened the new editor through embedded Inventory, read real company/division/unit choices and verified draft Stay/Discard without saving. Products/categories are empty in the live data. No business record or image was created, updated or deleted. Console errors were empty. Dark appearance reviewed at 1280×720; reduced-motion save transitions/animations measured 0s. Light/Follow device and the normal viewport were restored.
- Evidence: product-editor-live.png and product-editor-dark.png (live); product-editor-desktop.png and product-editor-prices-desktop.png at 1487×1058, compared with selected-reference.png; product-editor-mobile.png, product-editor-prices-mobile.png, product-editor-inventory-mobile.png and product-editor-image-mobile.png at 390×844. Populated images use synthetic React test DOM and production CSS; captured checkbox/input states match the tested form. Phone document width was 390 and footer actions stayed reachable. Temporary preview tabs/server were closed.
- This completes the editor increment only. Products register filters, complete exports, list/inspector and full profile still require implementation and review; the full Inventory wrapper and remaining route inventory remain open. Operations stays at six of 25 fully reviewed routes. Full Phase 5 is active, including the earlier native date/time popup and browser-print pagination gaps.

## Product categories and families — 17 September 2026

- Replaced the nested category/family tables with a category list/inspector and a dedicated family workspace. Company, parent, type, description and status remain visible. Family details retain all four price defaults, division, product/inherited/override/missing/differing-price counts and description. Family reads respect the selected division and include company-wide families. Category totals now use the API's complete aggregates; their labels explain the status-filter distinction.
- Editors group identity, organisation and default prices, protect unsaved drafts and retain failed inputs. Updates send changed fields only; parent, description and family defaults can be cleared explicitly. Creating a parent followed by a child now retains the successful parent when the child fails, explains that partial result and reuses the parent on retry. Zero remains distinct from an empty price. Exact category, family and directory permissions control reads/actions. Named status/delete confirmations retain failures for retry.
- Parent/company/division choices and category exports read all pages. CSV exports the full filtered register; PDF explicitly refuses more than 5,000 rows. Product price review reads every product page, displays differing prices, overrides and missing defaults with effective prices, and provides local 20-row pagination. Failed later-page reads expose retry without showing a partial result as complete. Existing backend pricing, company-write checks, category-cycle/delete guards and audit operations remain unchanged.
- Verification: 14 frontend workflow tests and 17 backend checks passed, targeted ESLint and frontend production build/TypeScript passed (200 static pages). Backend health returned HTTP 200; no backend runtime change was needed for this increment. Tests cover permission separation, aggregate counts, combined scope/search/status and pagination, stale reads, full exports/PDF limits, optional clears, draft Stay, failed saves/actions, parent reuse, price rules, zero amounts, price-review pagination reads and backend company/division/count contracts.
- Live review exercised the embedded Inventory route, real company choices, combined company/type/status/search filters and category draft Stay/Discard. The real category collection is empty. No live category, family, product or price was created or changed. Browser console errors were empty. Live dark category editor reviewed at 1280×720; Reduced motion save-action transition computed 0s. Light/Follow device and All companies were restored.
- Desktop 1487×1058 evidence: catalogue-categories-desktop.png compared with selected-reference.png, catalogue-category-actions-desktop.png and catalogue-families-desktop.png. Initial category action density squeezed the detail scroll region; changed this workspace to one continuous inspector scroll and reviewed the result. Phone 390×844: catalogue-categories-mobile.png, catalogue-category-details-mobile.png, catalogue-category-editor-mobile.png, catalogue-families-mobile.png, catalogue-family-details-mobile.png, catalogue-family-editor-mobile.png, catalogue-family-prices-mobile.png and catalogue-price-review-mobile.png. Document width measured 390. Populated captures use synthetic component-test DOM and production CSS; synthetic counts now agree with their category/product records.
- Temporary fixture tab/server were closed and the normal viewport restored. Operations now has six of 25 routes with Phase 5 review evidence. Products, the full Inventory wrapper and remaining workflows are next. Full Phase 5 remains active across the route inventory. Earlier native date/time popup and browser-print pagination gaps remain open.

## Units and conversions — 17 September 2026

- Replaced the unit and conversion tables with the shared searchable list/inspector, company/type/status filters and server pagination. All unit properties, system-unit protections, conversion pairs, descriptions and decimal factors remain visible. Embedded Inventory uses its existing scope and exposes its own create action.
- Guarded editors retain failed inputs and protect drafts. Conversion edits keep the existing pair and company fixed, matching the API; creation loads every page of active unit choices and retries failed choice reads without presenting partial data. Factors must be positive, finite and within the API's six-decimal precision. Named deletion retains failures for retry. Existing mutation rules remain unchanged.
- CSV reads every matching page. PDF preserves factor precision and explicitly refuses collections above 5,000 records instead of silently truncating them. Backend conversion search/status filters preserve company access and matching counts. Inventory scope changes now protect drafts; an unchanged search no longer restores an obsolete company scope.
- Verification: 15 frontend workflow tests and 12 backend checks passed, targeted lint and both production builds passed (frontend TypeScript and 200 static pages). Backend health returned HTTP 200 after restart. Live review covered system-unit details, company/type/status/search combinations, empty conversions, real unit choices and an unsaved conversion draft with Stay/Discard. No live units or conversions were saved or deleted. Browser console errors were empty.
- Desktop evidence: units-desktop.png, units-conversions-desktop.png and units-conversion-details-desktop.png at 1487×1058, compared with selected-reference.png. Phone evidence at 390×844: units-conversions-mobile.png, units-conversion-details-mobile.png, units-conversion-editor-mobile.png and units-details-mobile.png; document width measured 390 and actions remained reachable. Populated screenshots use synthetic component-test DOM and production CSS. units-dark.png records live dark inspection at the browser's actual 696px width; Reduced motion action transitions were 0s. Light/Follow device and the normal viewport were restored.
- Operations now has five of 25 routes with Phase 5 review evidence. The Inventory wrapper has two integration fixes, but its complete visual rollout is still pending. Products and categories/families are next. Full Phase 5 remains active; earlier native date/time popup and browser-print pagination gaps remain open.

## Customer and supplier profiles — 17 September 2026

- Both full profiles now use the OS workspace header, quiet balance summary, wrapped keyboard-accessible section navigation and themed detail surfaces. All existing customer and supplier history sections remain, including order lines, receivables/payables, product history, statements, pricing/credit or performance, and audit. Bounded history is explicitly described as recent; complete summary balances remain distinct from those previews. Phone tables retain their fields as labelled rows.
- Profile reads cancel obsolete requests and expose retry without retaining the previous record. Customer aging loads separately with its own retry; a failed complete-aging read clearly identifies the partial invoice breakdown. Missing monetary/performance values remain distinct from recorded zero values.
- Customer editing opens the shared editor directly with the correct update permission. Navigation-only shortcuts use accurate labels. Statement generation validates local-calendar dates, protects changed dates on navigation and retains input after failure; its wording distinguishes generation from sending. Named block/delete confirmations retain errors and only refresh/navigate after success. Print/report destinations require their own permissions. Existing backend operations and business rules are unchanged.
- Verification: 13 profile tests plus 16 directory tests passed, targeted ESLint passed, and the production build passed TypeScript and generated 200 static pages. Checks cover all section contracts, zero values, exact permissions, date validation and generation payloads, failed actions, independent aging retry, stale response cancellation, keyboard activation and draft Stay/Discard. Corrected the synthetic aging fixture so its 11 invoice rows agree with its displayed count and bucket totals; all 13 profile tests passed again.
- Live review opened both existing profiles, inspected their editors without saving, checked customer statement controls, supplier performance/audit states, arrow-key plus Enter section navigation and customer Back navigation. Customer phone/email were visibly retained in the editor. No live business records were changed or statements generated. Browser console error log was empty.
- Compared partner-customer-profile-desktop.png against selected-reference.png at 1487×1058 and reviewed partner-supplier-profile-desktop.png. Phone 390×844 evidence covers customer profile header/details, supplier profile details, customer orders, supplier products and customer statement generation/history. Measured document width 390. Populated screenshots use isolated synthetic React test DOM and production CSS; real profile reads were reviewed separately.
- Both live dark profile captures were reviewed; Reduced motion section transitions compute 0s. Light/Follow device and the normal viewport were restored. Temporary fixture tab/server were closed. Operations now has four of 25 routes with Phase 5 review evidence. Products, product categories/families and units/conversions are next; their existing price inheritance, exports and inventory scope must be preserved. Full Phase 5 remains active, including the previously recorded native date/time popup and browser-print pagination verification gaps.

## Customer and supplier directories — 17 September 2026

- Replaced both wide workbench tables with the shared searchable OS list/inspector, scoped company/division/branch/category/type/status filters and 20-row server pagination. Balance summaries remain separate from list pagination. Contact, credit, terms, organizational scope, categories, tax identity, address and notes remain accessible, with links to the existing full profiles.
- Shared customer/supplier editors group scope, identity, contact/tax, categories and credit/terms. Draft guards cover dismissal and navigation, failed saves retain input and edits send changed fields only, including nullable clears. Codes are immutable in edit mode, matching the API. Customer contact edits preserve legacy unassigned scope; changing scope requires valid branch/division choices. Exact update permission no longer inherits create permission. Block/unblock/delete use named confirmations with retry and permission checks.
- Directory choices load every page, respect separate read permissions and expose failures/retry. Obsolete scoped reads are cancelled. The two summary services now use full filtered aggregates instead of selecting at most 5,000 directory IDs; accounting aggregates apply the same scoped relation filter. Existing posting and mutation business rules remain unchanged.
- Sixteen frontend workflow tests and thirteen backend checks passed, with targeted ESLint and both production builds (frontend TypeScript and 200 generated pages). Tests cover independent permissions, combined filters/pagination, complete directory choices, failed/stale reads, full aggregate scope, forbidden companies, draft Stay, failed/successful saves, optional clears, legacy customer scope, named actions and mobile focus restoration. An initial backend invocation exceeded the default Node heap; the repository's configured 8 GB test command passed. Backend restarted from the new build on port 3014; health HTTP 200 and stderr empty.
- Live review inspected existing customer details, opened its existing full profile and returned, verified scoped supplier filters and empty results, read real directory choices and opened/dismissed the supplier editor. Customer draft Stay retained a temporary note and Discard removed it. No customer, supplier, payment or accounting record was saved or changed; mutations were verified with isolated mocks.
- Compared partner-customers-desktop.png with selected-reference.png at 1487×1058. Reduced action-stack height and aligned detail labels/values after the initial visual pass; reviewed final customer and supplier desktop captures. Phone 390×844 captures cover customer/supplier inspectors, customer editor, supplier editor and lower category/credit fields; document width 390. Populated layout captures use synthetic test DOM and compiled production CSS, while live records were checked separately.
- partner-suppliers-dark.png reviewed; Reduced motion computes 0s on actions. Original Light/Follow device and normal viewport restored. Browser console errors empty. Temporary fixture tab closed and preview process confirmed terminal. Two of 25 Operations routes now have Phase 5 directory review evidence; both full profile routes, remaining Operations routes and the other ERP families still require rollout. Previously recorded native date/time popup and browser-print verification gaps remain open. Full Phase 5 remains active.

## Approval requests and pending inbox — 17 September 2026

- Requests and Pending now share the OS list/inspector with server search, company/entity filters, status filtering for the register, 15-row pagination and complete request details/history. Primary facts remain prominent; secondary routing metadata and recorded changes expand on demand. Mobile selection/back restores focus and text remains readable.
- Exact read and action permissions, company scope, current eligibility and requester separation control actions. Details failures disable decisions; scope changes cancel obsolete reads. Named approve/reject/cancel dialogs protect drafts, retain failed input and refresh the actual list after success. Existing decision and posting business rules remain unchanged.
- Thirteen frontend tests and twenty-two backend checks passed, with targeted lint and both production builds. Backend health returned HTTP 200 after restart. Live register and pending filters returned clean responses; real collections are empty. All decision mutations were tested with isolated mocks; no live business record was changed.
- Reviewed approval-requests-desktop.png against selected-reference.png at 1487×1058, plus approval-pending-desktop.png and approval-request-history-desktop.png. Phone captures approval-requests-mobile.png, approval-request-history-mobile.png and approval-request-decision-mobile.png cover details, history and reachable decision controls at 390×844 with document width 390. Populated captures use synthetic component-test DOM and production CSS.
- approval-inbox-dark.png reviewed; Reduced motion computes 0s. Light/Follow device and normal viewport restored, browser errors empty. Temporary fixture tab closed and preview server confirmed stopped.
- All five Approvals routes now have review evidence. Full Phase 5 remains active across the 215-route inventory; Operations is the next family. Previously recorded native date/time popup and browser-print verification gaps remain open.

## Approval delegations — 17 September 2026

- Replaced the first-page-only wide table with the shared searchable list/inspector, server pagination, company/status filters, complete people/scope/date/reason details and named cancel/delete confirmations. Guarded editors group people/scope and dates/context, preserve drafts after failures, retain untouched timestamp precision and send only changed fields. Exact start/end times use the displayed device time zone; optional values can be cleared.
- View/manage and company/user-directory permissions remain distinct. Company choices load all pages; the user directory uses its actual complete-array contract without unsupported pagination parameters. Changing company clears both participants and cancels stale reads. Failed selectors expose retry. Backend validates distinct existing participants and company membership, date order, nonnullable fields and company Write access on both old and new scope.
- Found and corrected a delegation scope bug: pending eligibility and approval decisions previously ignored the delegation's company and entity type. They now match both against each request while preserving the active date window, designated-user matching and maker-checker protection. Explicitly unrestricted scopes continue to work. Audit logging and soft deletion remain unchanged.
- Eight frontend tests and eighteen backend checks passed (nine delegation contracts, five delegated-approval checks and four existing readiness tests), with targeted frontend lint and both production builds. An initial ambiguous test selector and an incomplete test dependency were corrected; final runs passed. Backend restarted from the new build on port 3014; health HTTP 200 and stderr empty.
- Live review verified real scoped company/user choices, combined search/status/company filters, draft Stay/Discard and untouched editor dismissal. The collection is empty; populated list/details visuals are synthetic DOM exported by the real component tests, with compiled app CSS and the OS shell. No delegation or approval was created, changed, cancelled or deleted in the live system.
- Compared approval-delegations-desktop.png with selected-reference.png at 1487×1058. Phone 390×844 captures: approval-delegations-mobile.png, approval-delegations-details-mobile.png, approval-delegation-form-mobile.png and approval-delegation-form-details-mobile.png. Details and form actions remain reachable; measured document width 390. approval-delegations-dark.png reviewed; Reduced motion computes 0s. Restored Light/Follow device and normal viewport; final console errors empty. Temporary fixture tab closed and server confirmed stopped.
- Three of five Approvals routes reviewed. Request management and complete pending-inbox workflows remain, alongside the rest of the 215-route Phase 5 inventory. Previously recorded native date/time popup and browser-print verification gaps remain open.

## Approval workflows — 17 September 2026

- Replaced the old workflow page with searchable, paginated OS list/inspector, company/entity/status filters, full configuration details and guarded create/edit forms. Named activate/deactivate/delete confirmations preserve errors for retry. Editors retain failed input, send changed fields only and support clearing descriptions.
- Exact view/manage permissions and company-directory permission are enforced. Backend reads and mutations apply company access, including Write access for changes. Group users can see global workflows in the unfiltered list; company filters remain exact. Required fields, enum values and integer priorities are validated.
- Nine frontend tests and eleven backend tests passed, with targeted frontend lint and both production builds. Live review verified the existing global Purchase Order Approval Workflow, edit/discard restoring its description, and named deactivate/delete confirmations cancelled without mutation. Backend health returned 200 after restart. Final browser error log empty.
- Reviewed approval-workflows-desktop.png against selected-reference.png; phone list/details and live form captures at 390×844 show reachable fields and actions. Dark appearance and reduced motion checked; original Light/Follow device and normal viewport restored. Populated static fixtures use synthetic test records. Temporary preview server stopped. No live workflow was created, changed or deleted.
- Two of five Approvals routes now have review evidence. Requests, delegations and complete pending-inbox workflows remain. Full Phase 5 stays active.

## Approval overview — 17 September 2026

- Replaced the old dashboard cards with the OS summary, company scope, shared check list/inspector, control indicators and five permission-aware workspace destinations. Preserved the existing readiness score, target, maturity, update time, checks and eight control indicators. All check details remain available rather than truncating at four. Status labels now describe workflow readiness without claiming production deployment readiness.
- Requires both the existing overview navigation permission and the actual readiness API's request-view permission. Company choices require companies.read and load every page with retry. Reads cancel on scope changes; Refresh retains scope. Loading and failures hide outdated metrics instead of presenting zero-valued diagnostics. Backend scoring and approval actions are unchanged.
- Eight frontend tests and four backend readiness tests passed. Tests cover both read gates, destination permissions, complete diagnostics, empty and failed states, choice paging/retry, cancellation, scoped refresh, keyboard activation and phone inspector focus restoration. Backend checks verify company filters on aggregates, related action/attachment counts and status groups, and reject inaccessible companies before reads. Targeted ESLint and frontend production build passed, including TypeScript and 200 generated pages. No backend runtime change or restart needed for this increment.
- Live overview returned all six readiness checks. Company selection, Refresh, keyboard inspection, phone detail/back selection and navigation to Pending approvals then Back succeeded. Current approval records are empty; the API returned its actual diagnostic scores and counts. No requests were created, approved, rejected or otherwise mutated.
- Compared approval-overview-desktop.png with selected-reference.png at 1487×1058; approval-overview-summary-desktop.png covers the page top. Phone 390×844: approval-overview-mobile.png, approval-overview-details-mobile.png and approval-overview-controls-mobile.png; measured document width 390, all check fields and controls reachable. approval-overview-dark.png reviewed; Reduced motion computes 0s. Restored Light/Follow device and normal viewport; console error log empty.
- One of five Approvals routes now has Phase 5 review evidence. Requests, workflows, delegations and the pending inbox's complete workflows remain to review; other ERP families remain in scope. Full Phase 5 is active.

## People hub and WCF exposure — 17 September 2026

- The People hub now uses quiet OS surfaces for workforce, attention, attendance, payroll, employment records, company counts and recent employees. Its nine existing workspace destinations remain permission-aware. Company choices load all pages and support retry; failed reads do not display invented zero totals. Refresh retains the selected company. Recent employee and contract previews now require their respective read permissions in the backend as well as the UI. Withdrawn disputes are excluded from the open count.
- WCF exposure now uses explicit company/year/month generation, complete-period totals, a branch list/inspector and expandable monthly company totals. All recorded gross pay, WCF, locations, unassigned branches, distinct employee counts and missing-month distinctions remain available. Filters clear obsolete results and cancel their reads; local pagination does not truncate totals. The API rejects invalid company/year/month input before data reads and retains company boundaries and existing aggregation rules.
- Verification: 13 frontend checks and 15 backend checks passed, with targeted ESLint and both production builds. Backend restarted from the current build on port 3014; health HTTP 200 and stderr empty. Tests cover scoped reads, permission gates, fully paged choices, failures/retry, cancellation, whole-period totals, distinct employees and period boundaries.
- Live WCF generation checked Itemba Enterprises for January–September 2026 and Mwanjalisi Oil for January–March 2025. Changing company/year/month removes the old result; reversed months show validation; keyboard Enter generates. Actual WCF collections are empty. People company filtering and Refresh returned real workforce counts; a recent-employee link opened the correct profile and Back returned to People. No business records were changed.
- Compared people-hub-desktop.png alongside selected-reference.png at 1487×1058; people-hub-details-desktop.png records lower panels, expanded contract dates and workspace links. WCF desktop captures include the filter/summary, all-branch monthly totals and scrolled branch inspector. Phone 390×844 captures cover both workspaces, WCF totals/details and People payroll/details; measured document width 390. Populated visuals are synthetic React test DOM with production CSS, not live business data.
- people-hub-dark.png and wcf-exposure-dark.png show the live dark appearance; Reduced motion computes 0s on their filter controls. Light/Follow device and normal viewport restored. Browser error log empty. Temporary fixture tab and server closed; server session confirmed terminal.
- All 31 HR routes now have on-screen review evidence. Full Phase 5 remains active for the other ERP families. Previously recorded native date-control and browser print-pagination verification gaps remain open.

## Statutory returns — 17 September 2026

- All seven existing returns (PAYE, NSSF, PSSSF, WCF, SDL, NHIF and HESLB) now use the shared workspace shell, wrapped return selectors, company/year/month filters, complete-return totals and a paginated list/inspector. All existing identity and amount columns remain available; on-screen paging does not truncate the downloaded CSV. SDL's company-level CSV row count remains distinct from its employee-line count.
- Exact payroll.view permission gates the page. Company choices require companies.read, load every page and expose retry. A report user without directory permission can generate for their assigned company; accounts without either option get a clear explanation. Filter/type changes remove the previous result and download immediately and abort obsolete reads. Failed reads retain their filters and retry. Downloads preserve the API filename/content and expose a recoverable error.
- Removed hard-coded contribution percentages from UI labels; amounts and recorded rates come from the existing API. Copy accurately describes generation and downloading, without claiming approval, filing or submission. Existing aggregation and CSV business logic remain unchanged. The API now rejects non-integer/NaN years and months before scope or data lookup, retaining its existing year/month ranges and company guard.
- Verification: 15 frontend tests and 17 backend checks passed. They cover all seven column contracts, permission boundaries, assigned-company fallback, complete choice paging, local record paging, unchanged full CSV bytes/filename, download failure recovery, query retries, stale response cancellation, malformed periods, company denial before employee data reads, calendar boundaries and PAYE aggregation/CSV escaping. Targeted ESLint and both builds passed. Final frontend rebuild includes visual action hierarchy and selected-label contrast fixes. Backend restarted from this build on port 3014; health HTTP 200 and stderr empty.
- Live review generated all seven returns from the rebuilt API and changed company, year and month, confirming removal of the prior download and the new header scope. Keyboard Enter activates return selection and generation. The real collections are empty; populated layout and downloads use isolated synthetic fixtures. No returns were submitted, approved or filed and no business records were changed.
- Compared revised statutory-paye-desktop.png alongside selected-reference.png at 1487×1058. statutory-paye-details-desktop.png verifies the inspector and reachable pagination after scrolling. Phone 390×844 evidence: statutory-nssf-mobile.png, statutory-nssf-totals-mobile.png, statutory-nssf-details-mobile.png and statutory-sdl-mobile.png. No horizontal overflow (document width 390); complete amounts, member number, summary boolean and CSV action remain readable. Test DOM exports now preserve selected option attributes so the static preview accurately shows the selected company/period.
- Visual review corrected competing primary Generate/Download buttons and weak selected-label contrast in dark mode. The shared report selector now uses the theme's main text color. statutory-dark.png shows the revised live state; selected text rgb(233,235,239) on rgb(27,30,37), Reduced motion computes 0s. Restored Light/Follow device and normal viewport; browser error log empty. Preview server stopped.
- Full Phase 5 remains active: 29 of 31 HR routes reviewed. WCF exposure and the People hub remain, followed by other ERP families. Previously recorded native date-control and browser print-pagination gaps remain open.

## People reports — 17 September 2026

- Replaced the main reports page with four permission-aware report views using the shared list/inspector, 20-row server pagination, theme tokens and responsive filters. Generate is explicit; changing report type or filters clears prior results and cancels obsolete requests. Failed reads retain filters and expose retry. Company choices use the actual companies.read permission and load all pages; payroll period and record links require their own permissions.
- Corrected the frontend/API contract: employee relations and employment status, individual attendance records/hours, payroll runs and actual entry counts, and leave requests with status totals. Totals clearly cover every matching page. Payroll filters use pay period/status; attendance and leave use their supported date range. No invented attendance-day or leave-balance columns remain.
- Backend employee filtering now uses employmentStatus and selects that field; payroll returns counts of undeleted entries. Attendance/leave reject invalid or reversed dates. Existing company boundaries, pagination and whole-result aggregates remain. The UI includes the full selected end date.
- Eight frontend workflow tests and six backend report tests passed. Targeted ESLint and both production builds passed; final frontend rebuild includes the corrected company permission. Backend restarted from this build on port 3014, health HTTP 200 and stderr empty. Tests cover read gates, company scope, filtered pagination, whole-result totals, retries, cancellation, choice pagination and date validation.
- Live company/search/status filtering returned the expected employee and its status/detail. Attendance, selected-period payroll and leave returned their actual empty collections with zero totals. No business data was changed. Populated visuals use exported React test DOM and production CSS: hr-report-employees-desktop.png compared alongside selected-reference.png at 1487×1058; attendance/payroll/leave desktop captures reviewed as well. Phone 390×844 captures show wrapped filters, totals and inspectors without horizontal overflow. Lower desktop pagination is reachable through workspace scrolling. Static fixture preview stopped afterward.
- Dark appearance reviewed in hr-reports-dark.png; Reduced motion computes 0s for all report selectors. Light/Follow device and normal viewport restored; browser error log empty. Automated native date entry did not reliably persist in this preview host; cleared the temporary input by reload. Date validation/query behavior is covered by tests, but this does not close the existing native date-control verification gap.
- Full Phase 5 remains active: 28 of 31 HR routes have on-screen review evidence. Statutory returns, WCF exposure and the People hub are next, followed by remaining ERP families. Existing print pagination limitations remain open.

## CCM notice workspaces — 17 September 2026

- Termination notices and CMA referral drafts now have the shared workspace header, record-specific back links, explicit draft context, retryable errors, permission-gated reads/printing and cancellation of obsolete requests. Failed HTTP responses no longer become document data. Opening or printing is correctly described as a draft action, not termination, notification or filing.
- Preserved bilingual form content, employer/employee particulars, employment/dispute detail, existing operator blanks, signature lines and browser Print / Save as PDF action. Paper retains its serif document type and white background within the themed OS workspace. Phone identity fields and signatures stack, long text wraps and disciplinary history uses readable blocks. Recorded operators are no longer labelled as proof of filing. Existing legal template language is retained; no legal-compliance certification is claimed.
- Both backend document reads now receive the authenticated user and apply the shared company scope before retrieving records. Disciplinary history is omitted from both query and payload without disciplinary_actions.view, with an explicit omitted-history message. Existing permitted history selection remains: up to five active/expired actions for termination, all linked actions for referral. Agent exclusion remains in place.
- Verification: eight frontend tests and six backend tests passed, covering read gates, scoped direct reads, fail-closed empty membership, history permission, request cancellation, retry, bilingual content/blank fields, zero salary and print invocation. Targeted ESLint, backend build and frontend TypeScript/production build passed; a second frontend build incorporates the visual spacing fix. Backend restarted on port 3014, health HTTP 200 and stderr empty.
- Live review loaded an existing employee's termination draft from the rebuilt API. A deliberately nonexistent dispute returned the actual Dispute not found state, retained retry, and offered no print action. No employment change, referral filing, document transmission or live print was performed. Browser error log inspection returned no entries. Dark appearance and Reduced motion were reviewed (print action transition 0s); Light/Follow device and normal viewport restored.
- Visual evidence uses static React test DOM with synthetic content and production CSS for populated documents: ccm-termination-desktop.png compared alongside selected-reference.png at 1487×1058; ccm-referral-desktop.png at the same size. Corrected touching draft/paper surfaces with 24px separation and reviewed the revised capture. Phone 390×844: ccm-termination-mobile.png, ccm-termination-signatures-mobile.png, ccm-referral-mobile.png and ccm-referral-signatures-mobile.png. No horizontal document overflow; signature and blank areas remain readable. ccm-document-dark.png shows the live dark workspace. Static preview server stopped after review.
- Full Phase 5 remains active: 27 of 31 HR routes have on-screen review evidence; HR reports (three routes), People hub and other module families remain. Browser print pagination for CCM/payslips and the native date/time popup host gap remain unverified. Print checks here establish content and invocation, not physical pagination.

## Employment disputes — 17 September 2026

- Register and detail now use the shared searchable list/inspector, company/status filters, server pagination, grouped forms and responsive detail/history cards. Exact read/update/delete permissions and existing workflow eligibility govern actions. Linked disciplinary records require their own read permission. Document links retain their existing routes.
- Create/edit and workflow dialogs protect drafts, retain failed submissions and expose retry. Editing sends changed fields only and clears optional text with null without rewriting unchanged dates. Withdrawal and deletion require a named confirmation. CMA referral copy distinguishes recording from filing; resolution copy distinguishes recording an amount from payment. Zero-value resolutions are retained.
- Backend search retains company/hierarchy filters and matching counts. All six mutators now require company Write access. Identity reassignment and invalid/null raised dates are rejected; existing workflow, audit and notification effects remain. No live employment records or messages were submitted.
- Verification: 12 frontend and seven backend tests passed; targeted ESLint, backend build and frontend production build/TypeScript (200 static pages) passed. Final frontend rebuild includes the corrected secondary-link surface token. Backend health returned HTTP 200 with empty stderr. Tests cover scoped reads/writes, permission gates, stale responses, workflow eligibility, draft protection, failed submissions/retry, nullable clearing and zero amounts.
- Live review verified combined search/company/status filters, real company/employee choices, draft Stay/Discard and phone form layout. The live collection is empty. Populated register/detail/resolution visual evidence uses exported React test DOM with compiled application CSS and a static loopback preview, not live business mutations. That preview process was stopped after review.
- Evidence: dispute-register-desktop.png compared alongside selected-reference.png at 1487×1058; dispute-detail-desktop.png reviewed at the same viewport. Phone captures at 390×844 CSS pixels: dispute-register-mobile.png, dispute-detail-mobile.png, dispute-history-mobile.png, dispute-resolution-mobile.png and dispute-form-mobile.png. Actions remain reachable and the document width equals 390. disputes-dark.png reviewed; Reduced motion computes 0s. Light/Follow device and normal viewport restored; browser error log empty.
- Full Phase 5 remains active: 25 of 31 HR routes reviewed, six HR routes plus other module families pending. Next: CCM notices, HR reports and the People hub. Previously recorded browser-print pagination and native date/time popup verification gaps remain open.

## Disciplinary actions — 17 September 2026

- Replaced the table with the shared list/inspector, employee/action-number search, company/type/status filters and 20-row server pagination. Both pending approval statuses are now filterable. Details retain effective dates, reason, evidence, employee response, issuer/approval identity, dispute link, notes and recorded fine/deduction state. Read/create/update/delete/approval controls use their exact endpoint permissions.
- Fully paged company/employee/dispute choices expose errors and retry. Company and employee changes clear dependent links. Existing identity is fixed when editing; users without employee viewing permission can still edit other fields of an existing action, but cannot create one or change the dispute. Grouped dates and multiline supporting details protect drafts, retain failed inputs and send changed fields only; optional dates/links/text clear with null without rewriting untouched timestamps. No new fine-editing behaviour was introduced.
- Approval now opens a named review showing the employee, action, reason and any fine. Issuers cannot approve their own action; both pending HR and legacy GM states retain the existing single-reviewer endpoint. Deletion confirms the named action and correctly explains that it does not reverse a linked deduction. Both operations retain failures in their dialogs. Approval/fine business effects remain the existing service behaviour; no live approval or financial mutation was performed.
- Backend search preserves company/employee/type/status constraints and matching counts. Direct reads now use the shared company-scope helper, including additional-company access. Mutations enforce Write access; creation verifies employee and dispute membership, editing rejects identity reassignment, and date-order/null-issue-date checks reject invalid changes. Existing code generation, audit, activation and fine linkage remain.
- Verification: ten frontend workflow tests and six backend checks passed, including permissions, search/pagination, choice retry/dependency reset, draft Stay, nullable clearing, save/delete/approval failures, maker-checker, legacy approval eligibility, read/write company boundaries and fine-link reuse. Targeted ESLint, frontend TypeScript/production build (200 pages) and backend build passed. Backend restarted from the new build, health HTTP 200, stderr empty.
- Live browser review used actual company/employee choices and an unsaved draft; Stay retained its employee/type/reason and Discard removed it. Search and combined company/pending-status/type filters loaded against the rebuilt API. No real actions or deductions were created, edited, approved or deleted. Live collections are empty; populated detail and approval layouts use static DOM exported from isolated tests. A reusable loopback-only static preview helper now serves these fixtures without app JavaScript or business APIs; the temporary server was stopped after review.
- Evidence: disciplinary-fixture-desktop.png compared with selected-reference.png at 1487×1058; disciplinary-fixture-mobile.png, disciplinary-fixture-mobile-details.png, disciplinary-approval-mobile.png, disciplinary-form-mobile.png and disciplinary-form-mobile-details.png at 390×844 CSS pixels. Details and multiline notes remain readable, approval context and footer actions are visible, document width equals 390. disciplinary-dark.png reviewed; Reduced motion computes 0s filter transition. Light/Follow device and normal viewport restored; final console inspection clear.
- Full Phase 5 remains active: 23 of 31 HR routes reviewed, eight HR routes and other module families pending. Next: disputes and dispute detail, CCM notices, HR reports and the People hub. Browser-print pagination and native date/time popup verification gaps remain open.

## Medical examinations — 17 September 2026

- Replaced the wide table with the shared list/inspector, 20-row server pagination, employee/doctor/facility search, company/fitness filters and hazard-sector filtering. Renewal filters explicitly include expired records, matching the API's cutoff behaviour. The matching total comes from the server, not the loaded page. Details retain provider, department, position, restrictions and notes.
- Creation uses fully paged company/active-employee choices with visible failures and retry; company changes clear employee selection. Grouped editors protect unsaved drafts, preserve failed input and unchanged date timestamps, reject reversed date ranges, and allow optional provider/assessment notes to be cleared. Editing keeps the original employee/company identity. Named deletion confirmation retains failures and the existing soft-delete/audit operation.
- The old API lacked company enforcement on these routes. Collection and direct reads now use the existing company-scope helper; mutations require existing Write access. Creation verifies employee/company membership; updates reject identity reassignment. The existing agent exclusion is retained, so this work does not expand autonomous capability access. No medical assessment or employment outcome was decided by this implementation.
- Verification: seven frontend workflow tests and five backend tests passed. Tests cover permissions, combined query/count scope, pagination, failed reads/retry, fully paged choices, dependent resets, typed creation, nullable clearing without timestamp rewrites, draft Stay, failed save/delete retries, forbidden companies and write access, employee identity and invalid dates. Frontend lint, TypeScript/production build (200 pages) and backend build passed. The initial direct Jest command exhausted its default heap; the repository's configured 8 GB test command passed. Backend restarted from the new build; health returned HTTP 200.
- Live review verified actual company/employee choices, draft Stay/Discard, and search/company/fitness/renewal/hazard filters against the rebuilt API. The current collection is empty, so populated inspector visuals use synthetic DOM exported from actual tests, compiled application CSS and the OS shell. These captures prove layout, not live mutation execution. No live medical/employment records were created, edited or deleted.
- Evidence: medical-exam-fixture-desktop.png at 1487×1058; medical-exam-fixture-mobile.png and medical-exam-fixture-mobile-details.png; medical-exam-form-mobile.png and medical-exam-form-mobile-details.png at 390×844 CSS pixels. Phone document width equals 390, details remain legible, and form footer actions remain reachable. medical-exams-dark.png reviewed at 1487×1058; Reduced motion yields 0s filter transition. Light/Follow device and normal viewport restored, fixture server stopped, final console inspection clear.
- Full Phase 5 remains active: 22 of 31 HR routes now have on-screen rollout evidence; nine HR routes plus other families remain. Next: disciplinary actions, disputes/detail, CCM notices/detail, the three HR report routes and the People hub. Browser-print pagination and the native date/time popup verification gap remain open.

## Employee allowances and deductions — 17 September 2026

- Both allocation pages now use the shared searchable list/inspector, scoped company/type/status filters and 20-row pagination. Fully paged choices expose loading failures with retry; changing company clears dependent choices. Exact read/manage permissions remain enforced in the UI.
- Grouped, guarded editors preserve unchanged timestamps, validate date order and send changed fields only. Optional end dates, notes and deduction values can be cleared explicitly. Backend end-date handling now persists null correctly. Named deletion confirmations retain failures for retry.
- Existing payroll behaviour is described accurately: allocation selection currently uses Active status without applying effective dates; manual deduction percentages alone are not calculated. No calculation or payment rules changed.
- Verification: 14 frontend workflow checks and six backend contract/search checks passed, targeted lint and both builds passed. The rebuilt backend returned health HTTP 200. Live draft Stay/Discard, actual company/employee/type choices and search/filter requests were checked without saving or deleting business records.
- Visual evidence: employee-allowances-fixture-desktop.png was compared with the selected reference at 1487×1058. employee-deductions-fixture-mobile.png and its details capture show synthetic populated records exported from the actual tests. Employee allowance/deduction form mobile captures use live unsaved drafts at 390×844 CSS pixels. employee-deductions-dark.png records dark appearance; computed filter transition is 0s with Reduced motion. Light/Follow device and normal viewport restored; final console inspection contained no errors. The temporary fixture server is stopped.
- Full Phase 5 remains active: 21 HR routes reviewed, ten pending, plus other module families. Next: medical examinations, disciplinary actions, disputes, CCM notices, HR reports and the People hub. Browser print pagination and native date/time popup verification remain open.

## Allowance and deduction types — 17 September 2026

- Both type catalogues now share a searchable list/inspector, company filter and 20-row server pagination. Existing name search and company scope remain unchanged. Read/manage controls use the exact allowance/deduction permissions. Company choices load all pages and expose failures with retry. The inspector retains classification, recurring state and numeric defaults, distinguishing unset values from zero.
- Grouped editors preserve identity, taxable/statutory classification, active state and default amount/percentage. The existing recurring property is now visible and editable. Optional defaults can be cleared explicitly with null; edits send changed fields only, protecting untouched values. Blank defaults are omitted on creation. No payroll calculation or backend business rule changed.
- Unsaved forms support Stay/Discard; failures retain entered values. Deletion names the type/code/company, requires confirmation, retains failures in the dialog and uses the existing soft-delete endpoint. The initial prominent red list action was reduced to a quiet secondary action; the confirmation retains its danger treatment.
- Verification: ten frontend workflow tests and four backend contract tests passed. Coverage includes read/manage permissions, search/pagination/company filters, failed/successful saves, numeric conversion, explicit nullable clearing with omitted-field preservation, choice retry, draft Stay and failed deletion/retry. Targeted ESLint and frontend production build passed (TypeScript and 200 generated static pages); final TypeScript and lint passed after the action appearance refinement. No backend production code changed or restart was needed; backend health returned HTTP 200.
- Live review used existing allowance/deduction categories. Allowance search reduced nine records to Housing Allowance. Clearing amount and percentage using keyboard entry survived Stay and was discarded; untouched creation closes without prompting. Named deletion was cancelled with Escape. Desktop list/inspector, phone editor scrolling and action reachability, phone list/detail/back navigation, dark appearance and Reduced motion were checked (filter transition 0s). No category was created, saved or deleted. Original Light/Follow device and normal viewport restored.
- Evidence: allowance-types-desktop.png and deduction-types-desktop.png at 1487×1058; allowance-type-form-mobile.png, deduction-type-form-mobile.png, deduction-type-form-mobile-details.png and deduction-types-mobile.png at 390×844 CSS pixels, document width 390; deduction-types-dark.png. Revised allowance desktop was compared alongside the selected reference. Native automation fill did not retain a cleared numeric value on the first attempt; keyboard selection and Backspace did, with the guard visibly confirmed. The earlier native date/time popup and browser-print gaps remain distinct and unresolved.
- Full Phase 5 remains active: 19 HR routes now have on-screen review evidence; 12 HR routes and the remaining module families still require rollout. Next: employee allowance and deduction allocations, followed by the other People workflows and remaining ERP families.

## Salary advances and generated payslip verification — 17 September 2026

- Salary advances now use the shared list/inspector, scoped server search, company/status filters and 20-row pagination. All seven existing statuses remain accessible. Read/create/approve/pay controls follow their exact permissions. Recovery details retain record currency, repayment method, installment amount, recovered amount and remaining recovery; unpaid requests do not claim a recovery balance.
- Requests use grouped company/employee and amount/date/reason fields with fully paged, independently retryable lookups. Company changes clear the employee. Missing employee-view permission blocks selection and submission. Local request dates, unsaved drafts, failed input and success feedback are preserved.
- Approval exposes the existing optional reduced approval amount, validates it against the requested amount, names the employee/company/advance and protects changed amounts. Payment uses a named confirmation and accurately describes the existing journal posting without claiming a bank transfer. Failed actions remain open. Backend approval, posting and recovery rules are unchanged.
- Verification: eight frontend workflow tests and five backend tests passed. These cover permission gates, scoped search/count/pagination, failed/successful creation and approval, lookup retry/dependency clearing, draft Stay, amount bounds, payment confirmation/retry, recovery currency and existing payment idempotency. Targeted ESLint and frontend production build passed, including TypeScript and 200 static pages. The backend build completed successfully; service restarted from it on port 3014 and health returned HTTP 200.
- Live browser review: real company/employee choices, amount/reason draft Stay/Discard, scoped search and filters, phone form, dark appearance and Reduced motion (computed filter transition 0s). Light/Follow device and the normal viewport were restored. No salary advance was created, approved or paid. The live collection is empty; populated recovery and approval layouts use static synthetic DOM exported from the actual isolated React tests, compiled CSS and the approved shell. These static fixtures prove layout, not live interactions.
- Evidence: salary-advances-desktop.png and advance-recovery-fixture-desktop.png at 1487×1058; salary-advance-form-mobile.png, advance-approval-fixture-mobile.png and advance-recovery-fixture-mobile.png at 390×844 CSS pixels; salary-advances-dark.png. The selected reference was reviewed alongside the desktop result. Phone document width equals 390, and form/confirmation actions remain reachable.
- Generated payslip PDF output is now separately verified: backend/scripts/verify-payslip-layout.cjs calls the real compiled generation service with synthetic source data and in-memory persistence, without a database connection. Standard (two allowances) and long (32 allowances) PDFs each contain two pages. All four rendered pages were visually inspected; totals, table continuation, notes, signatures and page footers are legible without clipping. Text extraction confirms every allowance plus gross/deduction/net totals. Standard output places notes/signatures on its second page. Temporary evidence is in tmp/pdfs; this does not verify the different bilingual browser-print CSS or a physical printer.
- Full Phase 5 remains active: 17 HR routes have on-screen review evidence; the other 14 HR routes and the remaining module families still require rollout. Browser-print pagination and the previously recorded native date/time popup host limitation remain open. Next: allowance/deduction types and employee allocations.

## Verification evidence for the first increment

- 73 tests across 19 files passed, covering Settings, workspace guards, OS/app launch, approvals and connection routes. One additional real preference-form test passed for failed/successful saves and unsaved navigation (74 total across those runs).
- Targeted ESLint passed. Frontend production build passed, including TypeScript and 200 generated static pages. Clean browser reload produced no new console errors; earlier dependency-array warnings occurred only during hot replacement of the edited hook.
- Evidence: `settings-desktop.png`, `settings-mobile.png`, `settings-dark.png`. Native Settings reset was cancelled in the live UI; tests use isolated network responses. No business records were created or changed.

## Business Settings and People increment — 17 September 2026

- Company identity: grouped brand/legal/address/branch fields and live document preview; company changes, reset and reload protect drafts. Branch draft discard preserves identity edits. Permissions match company/profile/branch/document APIs. Failed saves preserve inputs; successful saves clear protection and retain visible success feedback. Uploaded logos only appear linked after the company update succeeds.
- Document numbers: paginated list/detail workspace replaces the eleven-column table. Create/update permissions, immutable fields, padding/start validation, draft dismissal and the advance confirmation are preserved. Update requests now contain only fields accepted by the update DTO. No number was consumed in browser verification.
- Departments: shared list/detail UI, backend search, company/status filters, 20-row pagination, explicit loading/error/retry, permission-aware actions and guarded forms. Failed deletion stays in its named confirmation with a visible error. The API now distinguishes explicit clearing of optional branch/division fields from omitted fields while retaining company/hierarchy validation.
- Shared HR organisation choices: load all API pages, cancel obsolete requests, clear stale hierarchy options, expose loading/error/retry, and respect resource-skip options. Departments disables editing until these choices are ready. Other HR pages still need their UI rollout and explicit error/retry integration.
- Shared Modal: focus now waits for the mounted surface on its first open, traps Tab, and restores the opener. Live keyboard verification confirmed first-open Close focus and Escape restoration. Settings nested confirmation regressions still pass.
- Layout adjustment: the new list pages use available workspace height, keeping desktop inspector actions inside the OS window. Mobile uses one pane with actions before details. No horizontal document overflow at 390 CSS pixels. Dark appearance and Reduced motion reviewed on Departments; original Light/Follow device preferences restored.
- Verification: 31 frontend checks across seven files passed after the modal fix; the earlier run additionally includes three RecordBrowser checks (34 distinct checks across those runs). Three backend hierarchy tests passed at the repository's 8 GB heap setting after the default 4 GB process exhausted its heap. Targeted ESLint passed. Frontend production build passed (200 static pages); final TypeScript passed after the focus/layout refinements. Backend build passed, service restarted from that build, and health returned HTTP 200.
- Live checks used existing records and discarded drafts only: numbering edit/Stay/Discard, company identity edit/company-switch/Stay/reset, Departments keyboard selection, new/edit form open and draft cancellation, real company/division/branch choices, desktop/mobile and dark/reduced-motion layout. Save/delete success and failure use isolated mocks. No business records, uploads or financial transactions were submitted.
- Evidence: `number-sequences-desktop.png`, `number-sequences-mobile.png`, `company-identity-desktop.png`, `company-identity-mobile.png`, `departments-desktop.png`, `departments-mobile.png`, `departments-dark.png`, `department-form-mobile.png`. Paired reference reviews used 1487×1058; mobile reviews used 390×844.
- Final clean navigation loaded Departments with no new console errors. Earlier hook dependency warnings occurred during hot replacement and did not recur after navigation. The normal browser viewport was restored.
- Full Phase 5 remains active. Settings and Departments do not prove completion of the remaining module inventory. Next work continues through People (positions/employees and related workflows), then the outstanding module families.

## Positions and employee journey increment — 17 September 2026

- Positions: shared list/inspector, server search, company/status filters and 20-row pagination. Forms preserve currency, allow the optional default salary to be cleared, require an active department, load all department pages and protect unsaved edits. Failed deletion remains in its named confirmation. Existing positions without a department are shown accurately; no placement was invented or written.
- Employee directory: shared list/inspector, permission-aware create/delete actions, server search and pagination, company/status filters and guarded creation. Identity, statutory and payment details use optional disclosures. PDF export reads every matching API page and fails as a whole if a later page fails, rather than exporting a silently incomplete register.
- Organisation choices: departments, positions and linkable accounts load independently. Live verification found that the signed-in account lacks the required company access level for linking user accounts. The restriction is retained and reported explicitly; successful department and position choices stay enabled. Retry preserves the draft. No permissions or company grants were changed.
- Employee profile: refreshed detail cards, responsive forms and keyboard-operable sections. Profile, statutory and banking edits are separate; saves send changed writable fields only, with explicit nullable-field clearing and typed numeric values. Unrelated profile fields and unavailable sensitive fields are not resent. Employee read/update/delete and termination permissions remain enforced by the UI and existing backend.
- Related employee sections now load real, permission-aware, employee-scoped, paginated contracts, assignments, attendance, leave, payroll and document records instead of placeholders. Each collection loads when opened and exposes loading/error/retry. Links to the existing full workspaces remain. This does not certify the separate related-workspace pages as migrated.
- Mobile money accounts use a responsive list/inspector and guarded editor. Failed saves/removals remain visible; primary-account removal stays unavailable. Termination drafts are guarded; network/approval failures remain visible. Save, delete and termination requests use the shared authenticated API client. Real employment, payment and deletion actions were not performed during browser verification.
- Verification: 27 frontend tests across six files passed together, then the profile suite passed all ten tests after adding termination-approval rejection/retry coverage (28 distinct checks across these runs). Coverage includes scoped pagination, read-only permissions, stale requests, whole-register export, partial lookup failure/retry, successful/failed saves, draft Stay/Discard, nullable clearing, deletion/account-removal failures and termination failures. Targeted ESLint passed. Final production frontend build passed, including TypeScript and 200 generated static pages. No backend source changed in this increment.
- Live review: Positions list/edit draft, employee list/create draft, profile draft Stay/Discard, independent banking editor, all six related sections, keyboard focus, phone layouts, dark appearance and Reduced motion. Related datasets for the inspected employee are empty; populated contracts and other list/action states use isolated test fixtures where covered. Final navigation showed no browser console errors. Light/Follow device and the normal viewport were restored; all preview drafts were discarded.
- Visual evidence: paired source/list/profile comparisons at 1487×1058; phone checks at 390×844 CSS pixels (capture output may round height to 843). `positions-desktop.png`, `position-form-mobile.png`, `employees-desktop.png`, `employees-mobile.png`, `employee-form-mobile.png`, `employee-profile-desktop.png`, `employee-profile-mobile.png`, `employee-profile-form-mobile.png`, `employee-bank-form-mobile.png`, `employee-profile-dark.png`. The form captures accurately show the account-link access restriction.
- Full Phase 5 remains active. Four HR routes now have rollout evidence: Departments, Positions, Employees and employee detail. The other 27 HR routes and the remaining module families require their own workflow rollout and verification. Next: assignments/contracts workspaces, then attendance/leave/payroll and the remaining ERP families.

## Contracts, assignments and attendance increment — 17 September 2026

- Employment contracts: shared list/inspector, scoped server search, company/status filters and 20-row pagination. Grouped creation fields cover the agreement, dates, probation, currency, payment frequency and terms. Draft dismissal protects edits; failed saves remain visible. Existing approval and termination actions use named confirmations. Termination reasons are guarded. Contract termination does not claim to terminate the employee record.
- Assignments: shared paginated list/inspector and employee/role search. The employee chooser loads all accessible pages independently of the destination company, so selecting another company retains the source employee for a transfer. Destination division/branch choices remain scoped. Editing preserves assignment identity; transfers continue through new assignments and the existing approval workflow. Pending transfers cannot be activated by the editor. Permission checks and maker/checker rejection remain intact. Blank optional branch/end date edits now explicitly clear those values; omitted values remain unchanged.
- Attendance: replaced the unpaginated table with the shared searchable list/inspector, company/status/date filters and 20-row pagination. Read, create, update and approve controls follow the backend permissions. Grouped forms protect drafts, show lookup failures/retry and keep failed saves visible. Edits send changed fields only, preserving untouched timestamp precision. Arrival/departure use complete local date-time controls, allowing overnight shifts, and send explicit UTC instants. Clearing timestamps now sends null and the backend recalculates hours against the resulting interval. Approval requires a named confirmation with retryable errors.
- Backend verification: ten tests across the attendance and people-workspace suites passed. They verify scoped search/count/pagination, contract and assignment query validation, nullable assignment clearing, transfer restrictions, nullable attendance clearing, omitted timestamp preservation, invalid partial clearing and overnight-hour calculation. Backend build passed. The service was restarted from the new build on port 3014; health returned HTTP 200.
- Frontend verification: contracts/assignments ten tests passed; attendance seven tests passed after correcting the test's pagination button locator. Seventeen distinct checks cover permissions, filtered pagination, failed/successful saves, draft Stay/Discard, cross-company transfer draft retention, nullable clearing, exact untouched timestamps, overnight requests and approval failures. Targeted ESLint passed. Final production build passed, including TypeScript and 200 static pages.
- Live browser review: contract/assignment creation drafts, assignment source-person retention across destination changes, real organisation choices, first-open focus, Stay/Discard, phone layouts, dark appearance and Reduced motion. Attendance notes and keyboard-entered timestamps survive Stay; drafts were discarded. Live attendance search succeeded against the rebuilt service. The reviewed collections are empty; populated inspectors, pagination and consequential actions are covered with isolated API fixtures rather than real business writes.
- Evidence: paired source comparisons at 1487×1058 using contracts-desktop.png, assignments-desktop.png and attendance-desktop.png. Form captures: contract-form-desktop.png, contract-form-mobile.png, assignment-form-desktop.png, assignment-form-mobile.png, attendance-form-desktop.png and attendance-form-mobile.png. Alternate appearance: assignments-dark.png and attendance-form-dark.png. Phone document width equals 390 CSS pixels; footer actions remain reachable. Light/Follow device preferences and normal viewport were restored.
- Verification limitation: automation fill did not persist values in native date/time controls; segmented keyboard input did persist through rerenders and Stay. Opening the native date-time popup crashed the in-app browser preview tab. A fresh preview tab recovered normally, with no console errors. Popup interaction remains unverified in this preview host; application date-time validation and request conversion are covered by the tests. No business records were saved, approved, terminated or deleted.
- Full Phase 5 remains active. Seven HR routes now have rollout evidence; the remaining 24 HR pages and other module families still require migration and workflow checks. Next: leave requests/types/balances, then payroll and the remaining People workflows.

## Leave management increment — 17 September 2026

- Leave requests, leave types and leave balances now share the searchable, paginated list/inspector and grouped, guarded forms. Company changes clear dependent employee/type choices; choices load all pages and expose retryable failures. Read and action controls follow the exact backend permissions.
- Requests retain draft submission, line approval, rejection and cancellation. The UI now exposes the existing separate Group HR approval for requests longer than five days, with recorded approval state and named confirmations. The backend still requires different approvers. Approved cancellation explains the balance reversal; no approval or balance-accounting logic was changed.
- Leave type edits can explicitly clear annual allowance with null. Balance allocation preserves recorded usage, explains total-versus-additional amounts, locks existing balance identity and previews the resulting remaining days. Failed saves and actions retain the dialog and input.
- Verification: 19 frontend checks (11 workspace, five existing allocation and three fully paged chooser tests) and four backend checks passed. Targeted ESLint, frontend production build (TypeScript and 200 static pages), and backend build passed. The backend was restarted from the leave build on port 3014; health returned HTTP 200. Scoped live request/balance searches and filters loaded without API errors.
- Browser review used real leave types and discarded request/allocation/type drafts. Stay retained person/type/notes and amounts; Discard removed drafts. Phone document width equalled 390 CSS pixels. Dark appearance and Reduced motion were reviewed; Light and Follow device restored. Final console check contained no errors. No business records were saved, submitted, approved, cancelled or deactivated. Requests and balances are empty in the live data; populated inspectors and mutation outcomes use isolated fixtures.
- Evidence: leave-types-desktop.png, leave-types-mobile.png, leave-type-form-mobile.png, leave-requests-desktop.png, leave-request-form-mobile.png, leave-balances-desktop.png, leave-allocation-mobile.png, leave-balances-dark.png and leave-allocation-dark.png. Paired reference comparison used 1487×1058; phone captures used 390×844 CSS pixels (image height rounds to 843).
- Full Phase 5 remains active: ten HR routes reviewed, 21 still pending. Next: Payroll periods and the remaining payroll journey, then other People and ERP families. The previously recorded native date-time popup verification limitation remains unresolved.

## Payroll periods increment — 17 September 2026

- Replaced the wide table with the shared list/inspector, scoped server search by name/code, company/status filters and 20-row pagination. Read/manage permissions now govern the UI. All six existing period statuses are filterable; the original approve/close status eligibility and PUT contract remain unchanged. View runs retains the period link.
- Creation groups identity and pay-cycle fields, preserves generated or user-entered codes, validates date order, guards unsaved drafts and retains failed inputs. Company lookup errors have retry and block saving until resolved. Approval and closure use named confirmations with company/date context and retryable failures; they do not claim to approve individual runs or pay salaries.
- Live review caught a one-day date-display regression from forcing UTC for existing locally seeded periods. Restored the prior local-date display; September now shows 1–30 September and payment date 28 September as before. No stored dates changed. Visual review found competing blue actions; approval is now a quieter action beneath View runs.
- Verification: eight frontend workflow checks and two backend scoped-search checks passed. Targeted ESLint and both production builds passed; frontend generated 200 static pages. Final frontend TypeScript passed after the button appearance refinement. Backend restarted from the payroll build on port 3014 and health returned HTTP 200. Live search reduced nine periods to the September result; the page recovered through Try again after the restart.
- Live browser checks: populated inspector, named approval confirmation cancelled, new-period draft Stay/Discard, real company choices, phone list/detail/form and dark appearance with Reduced motion (computed filter transition 0s). Restored Light, Follow device and the normal viewport. A clean reload showed no console errors. No periods were created, approved or closed, and no salary payments were made. Mutation success/failure and pagination use isolated mocks.
- Evidence: payroll-periods-desktop.png, payroll-periods-mobile.png, payroll-period-form-mobile.png and payroll-periods-dark.png. Revised desktop capture was compared with the selected reference at 1487×1058; phone checks used 390×844 CSS pixels with no horizontal document overflow.
- Full Phase 5 remains active: 11 HR routes reviewed, 20 pending, plus remaining module families. Next: payroll runs, entries, payslips and salary-payment workflows. The native date/time popup host verification gap is still open.

## Payroll runs and entries increment — 17 September 2026

- Runs and entries now use the shared searchable list/inspector, company filters and 20-row server pagination. Period/run deep links are retained; company changes clear dependent filters. Backend search preserves company access constraints, other filters and matching counts. Fully paged selectors cancel obsolete requests and expose lookup failures with retry.
- Run creation groups period and type, derives company from the selected period and protects drafts. Named confirmations retain calculation, submission, separate HR/Finance sign-offs, final approval, cancellation and payment permissions/status rules. Failures retain input. Payment accounts are company-scoped; the existing default Bank (1010) option is explicit. Recording payment describes the accounting action without claiming a provider transfer. File-generation failures remain visible with retry instead of closing the dialog.
- Entries retain the employee pay breakdown, allowances, deductions, attendance and payslip navigation. This workspace remains read-only. No payroll calculation, approval, posting or payment business rule changed.
- Verification: 18 frontend tests (14 workspace/action checks and four paged-choice checks) and nine backend tests (two search checks and seven existing dual-sign-off checks) passed. Targeted ESLint and both production builds passed; final frontend TypeScript passed after adding the phone company context. Backend restarted from the new build and health returned HTTP 200.
- Live review: run draft period/type survived Stay and was discarded; changing company cleared the prior period filter. Run and entry searches loaded against the rebuilt API. Desktop captures were compared with the selected reference at 1487×1058. Phone document width equalled 390 CSS pixels; a truncated period selector label prompted a separate, fully visible company line. Dark appearance and Reduced motion were reviewed (filter transition 0s). Light, Follow device and normal viewport restored; clean reload had no console errors.
- Evidence: payroll-runs-desktop.png, payroll-run-form-mobile.png, payroll-entries-desktop.png, payroll-entries-mobile.png and payroll-entries-dark.png. Live run/entry collections are empty; populated inspectors and consequential actions use isolated API mocks. No real runs were created, calculated, approved, cancelled or paid, and no disbursement files were generated live. Tests verify generation retry and returned download controls, not downloaded CSV contents.
- Full Phase 5 remains active: 13 HR routes reviewed, 18 pending, plus other module families. Next: payslips and salary-payment workflows. The native date/time popup host verification gap remains open.

## Payslips and salary payments increment — 17 September 2026

- Run payslips now use the shared list/inspector, employee name/code search and 20-row server pagination. Whole-run employee/gross/deduction/net totals remain independent of the search and current page. The read endpoint opts into the lightweight paginated response when pagination/search is supplied; existing callers without query parameters retain their full-document array response. Run and entry reads/counts/totals retain company scope, and unavailable runs fail before any entry query.
- Individual payslips now use the OS page header, permission-gated reads, abortable keyed loading and visible retryable errors. English/Swahili earnings, statutory and manual deductions, employer contributions, identity fields and existing print/generated-PDF actions remain. Phone identity fields stack, amounts stay on one line and the statutory table scrolls within its labelled region. Manual deduction labels follow their actual statutory flag; an absent bank account no longer asserts mobile money as the destination. Print CSS releases the OS shell's sizing/overflow and hides surrounding controls; physical print output remains unverified.
- Salary payments now use scoped search, company/status filters, pagination and a list/inspector. Creation and reversal follow their exact permissions. Fully paged company/employee/run/entry selectors show lookup failures and retries. Changing company, employee or run clears dependent entry/amount values; choosing an entry proposes its net pay. Grouped creation and reversal dialogs guard drafts, preserve failed input, and explain the existing API effect accurately: payment recording does not transfer funds or pay the whole run; reversing the record does not recover funds or reverse the run journal. Backend mutation/accounting behaviour is unchanged.
- Verification: 12 frontend tests and four backend tests passed. They cover read/mutation permission gates, whole-run totals across filtered pages, navigation, stale response cancellation, read failures/retry, bilingual document content, print/generated-PDF call contracts, dependent payment choices, draft Stay, save failures/retry, reversal confirmation/retry, and scoped query/count compatibility. Targeted ESLint and frontend/backend builds passed; final frontend TypeScript passed after the phone summary refinement. Backend restarted on port 3014 and health returned HTTP 200.
- Live browser review: salary payment company/employee choices, empty run choices, reference draft Stay/Discard, server search and company/status filtering, phone form, dark appearance and Reduced motion (filter transition 0s). A deliberately unavailable entry/run shows the actual retryable Not found states. No salary payments or payroll records were created, reversed, calculated or paid. Light/Follow device restored. Live collections are empty; populated document/list/reversal visuals use static DOM exported from the isolated tests, compiled application CSS and the existing shell, clearly labelled Synthetic fixture. Those captures prove layout, not live API execution or interactive fixture behaviour.
- Evidence: salary-payments-desktop.png, salary-payment-form-mobile.png, salary-payments-dark.png, run-payslips-fixture-desktop.png, run-payslips-fixture-mobile.png, payslip-fixture-desktop.png, payslip-fixture-mobile.png, payslip-fixture-mobile-detail.png and salary-reversal-fixture-mobile.png. Desktop review uses 1487×1058; phones use 390×844 CSS pixels without document overflow. Phone review corrected identity columns and split monetary amounts; compact two-column run summaries keep the inspector action visible sooner.
- Scope: 16 HR routes now have on-screen rollout evidence, with the individual payslip's physical print/PDF output still awaiting verification; 15 other HR routes and other module families remain. Print/PDF checks currently prove content and invocation contracts only, not pagination or generated file contents. The native date/time popup host gap remains open. Continue with the print verification gap, salary advances and remaining People workflows; full Phase 5 is active.

## Route inventory

Generated from the current dashboard source tree on 17 September 2026. Counts are inventory only, not completion evidence. Detailed routes are listed to keep coverage explicit.

| Module family | Pages | Phase 5 verification |
| --- | ---: | --- |
| accounting-engine | 10 | All 10 routes cancel stale reads and expose retry. Five control registers and bank reconciliations already gated on their list permissions. Dashboard, posting rules, financial statements, and loan repayments now require `accounting_engine.dashboard`. Live signed-in review is still open |
| alerts | 2 | Both routes cancel stale reads, show Try again, and refuse the list without `alert_events.view` or `alert_rules.view`. Live signed-in review is still open |
| api-gateway | 1 | Request logs cancel stale reads, show Try again, and refuse the read without `api_request_logs.view`. The route is not in the sidebar. Live signed-in review is still open |
| approvals | 5 | All five routes reviewed: overview, workflows, delegations, request register and pending inbox |
| apps | 2 | The OS shell hosts the app library and waits for auth before showing apps the role can open. External app launch already cancels the status check and offers Check again. Live signed-in review is still open |
| audit-logs | 1 | The trail requires `audit-logs.read`, keeps only the latest read, and shows Try again after a failed load. Live signed-in review is still open |
| automation | 2 | Rules and runs keep only the latest read, show Try Again, and refuse the list without `automation_rules.list` or `automation_runs.list`. Live signed-in review is still open |
| background-jobs | 2 | Jobs and queues keep only the latest read, show Try again, and refuse the list without `background_jobs.view` or `job_queue_configs.view`. Live signed-in review is still open |
| backups | 4 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| companies | 3 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| compliance | 19 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| crm | 5 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| dashboard | 1 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| data-isolation | 3 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| document-templates | 4 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| finance | 15 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| fuel-grid | 1 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| group-control | 10 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| hr | 31 | All 31 routes reviewed, including People hub, reports, statutory returns and WCF exposure. Generated payslip PDF fixtures reviewed; browser-print pagination and native date/time popup verification remain open |
| integrations | 10 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| inventory | 2 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| mobile-pos | 2 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| msaidizi | 1 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| notifications | 1 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| operations | 25 | All 25 routes now have cancelled reads, load retry, and view gates. Customer/supplier directories and profiles, units, categories/families, products, inventory overview, balances, movements, and stock adjustments were reviewed earlier (12). The remaining 13 (hub, profit, reports, supplier 360, sales orders, purchase orders, and supplier drafts, including their print routes) were closed on 22 September 2026. Live signed-in review of those 13 is still open |
| procurement | 5 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| record-book | 8 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| reports | 3 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| roles | 1 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| sales | 1 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| security | 6 | Code bar closed 22 September 2026. Live signed-in review is still open. |
| settings | 4 | Hub and business settings desktop/mobile verified; preferences, company identity and numbering draft/save contracts tested |
| tasks | 1 | Code bar closed 23 September 2026. Live signed-in review is still open. |
| users | 1 | Code bar closed 23 September 2026. Live signed-in review is still open. |
| westsides | 23 | All 23 routes now cancel stale reads or have no data read. Live stock and batches/expiry were reviewed earlier. The other 21 meet the code bar (guard, Try again, sidebar view gate, print overflow). Live signed-in review of those 21 is still open |

Total: 215 pages.

### accounting-engine

- `/accounting-engine/accounting-locks`
- `/accounting-engine/audit-adjustments`
- `/accounting-engine/bank-reconciliations`
- `/accounting-engine/depreciation`
- `/accounting-engine/financial-statements`
- `/accounting-engine/loan-repayments`
- `/accounting-engine`
- `/accounting-engine/period-close`
- `/accounting-engine/posting-rules`
- `/accounting-engine/posting-runs`

### alerts

- `/alerts`
- `/alerts/rules`

### api-gateway

- `/api-gateway/logs`

### approvals

- `/approvals/delegations`
- `/approvals`
- `/approvals/pending`
- `/approvals/requests`
- `/approvals/workflows`

### apps

- `/apps/[appId]`
- `/apps`

### audit-logs

- `/audit-logs`

### automation

- `/automation/rules`
- `/automation/runs`

### background-jobs

- `/background-jobs`
- `/background-jobs/queues`

### backups

- `/backups/disaster-recovery`
- `/backups/jobs`
- `/backups`
- `/backups/runs`

### companies

- `/companies/[id]`
- `/companies/new`
- `/companies`

### compliance

- `/compliance/calendar`
- `/compliance/cockpit`
- `/compliance/document-requirements`
- `/compliance/document-status`
- `/compliance/events`
- `/compliance/evidence-packs`
- `/compliance/exports`
- `/compliance/obligations`
- `/compliance/osha-registrations`
- `/compliance`
- `/compliance/statutory-rules`
- `/compliance/tax-authorities`
- `/compliance/tax-codes`
- `/compliance/tax-filing-periods`
- `/compliance/tax-rates`
- `/compliance/tax-registrations`
- `/compliance/tax-returns`
- `/compliance/tax-transactions`
- `/compliance/tax-types`

### crm

- `/crm/credit-profiles`
- `/crm/customer-statements`
- `/crm`
- `/crm/supplier-performance`
- `/crm/supplier-statements`

### dashboard

- `/dashboard`

### data-isolation

- `/data-isolation/issues`
- `/data-isolation`
- `/data-isolation/test-runs`

### document-templates

- `/document-templates/generated`
- `/document-templates`
- `/document-templates/print-engine`
- `/document-templates/sequences`

### finance

- `/finance/accounting-periods`
- `/finance/cash-accounts`
- `/finance/chart-of-accounts`
- `/finance/credit-notes`
- `/finance/expense-categories`
- `/finance/expenses`
- `/finance/fiscal-years`
- `/finance/intercompany`
- `/finance/journal-entries`
- `/finance`
- `/finance/payables`
- `/finance/payments`
- `/finance/receivables`
- `/finance/refunds`
- `/finance/reports`

### fuel-grid

- `/fuel-grid`

### group-control

- `/group-control/bank-accounts`
- `/group-control/contracts/[id]`
- `/group-control/contracts`
- `/group-control/documents/[id]`
- `/group-control/documents`
- `/group-control/fixed-assets/[id]`
- `/group-control/fixed-assets`
- `/group-control/loans-debts/loans/[id]`
- `/group-control/loans-debts`
- `/group-control`

### hr

- `/hr/allowance-types`
- `/hr/attendance`
- `/hr/ccm-notices/cma-referral/[disputeId]`
- `/hr/ccm-notices/termination/[employeeId]`
- `/hr/deduction-types`
- `/hr/departments`
- `/hr/disciplinary-actions`
- `/hr/disputes/[id]`
- `/hr/disputes`
- `/hr/employee-allowances`
- `/hr/employee-assignments`
- `/hr/employee-deductions`
- `/hr/employees/[id]`
- `/hr/employees`
- `/hr/employment-contracts`
- `/hr/leave-balances`
- `/hr/leave-requests`
- `/hr/leave-types`
- `/hr/medical-exams`
- `/hr`
- `/hr/payroll-entries`
- `/hr/payroll-periods`
- `/hr/payroll-runs/[id]/payslips`
- `/hr/payroll-runs`
- `/hr/payslips/[id]`
- `/hr/positions`
- `/hr/reports`
- `/hr/reports/statutory`
- `/hr/reports/wcf-exposure`
- `/hr/salary-advances`
- `/hr/salary-payments`

### integrations

- `/integrations/connections`
- `/integrations/events`
- `/integrations/mappings`
- `/integrations/messages`
- `/integrations`
- `/integrations/payments`
- `/integrations/providers`
- `/integrations/templates`
- `/integrations/webhook-events`
- `/integrations/webhooks`

### inventory

- `/inventory`
- `/inventory/products/[id]`

### mobile-pos

- `/mobile-pos/activate`
- `/mobile-pos`

### msaidizi

- `/msaidizi`

### notifications

- `/notifications`

### operations

- `/operations/customers/[id]`
- `/operations/customers`
- `/operations/inventory`
- `/operations/inventory-balances`
- `/operations/inventory-movements`
- `/operations`
- `/operations/product-categories`
- `/operations/products/[id]`
- `/operations/products`
- `/operations/profit`
- `/operations/purchase-orders/[id]`
- `/operations/purchase-orders/[id]/print`
- `/operations/purchase-orders/order-drafts/[id]`
- `/operations/purchase-orders/order-drafts/[id]/print`
- `/operations/purchase-orders/order-drafts`
- `/operations/purchase-orders`
- `/operations/reports`
- `/operations/reports/suppliers`
- `/operations/sales-orders/[id]`
- `/operations/sales-orders/[id]/print`
- `/operations/sales-orders`
- `/operations/stock-adjustments`
- `/operations/suppliers/[id]`
- `/operations/suppliers`
- `/operations/units`

### procurement

- `/procurement/grns`
- `/procurement`
- `/procurement/requisitions`
- `/procurement/supplier-invoices`
- `/procurement/three-way-matching`

### record-book

- `/record-book/categories`
- `/record-book/daily-sales/[id]`
- `/record-book/daily-sales`
- `/record-book/expenses/[id]`
- `/record-book/expenses`
- `/record-book`
- `/record-book/reports`
- `/record-book/trash`

### reports

- `/reports`
- `/reports/run`
- `/reports/scheduled`

### roles

- `/roles`

### sales

- `/sales/commissions`

### security

- `/security/events`
- `/security`
- `/security/policies`
- `/security/sessions`
- `/security/two-factor`
- `/security/user-profiles`

### settings

- `/settings/company-profile`
- `/settings/number-sequences`
- `/settings`
- `/settings/preferences`

### tasks

- `/tasks`

### users

- `/users`

### westsides

- `/westsides/customer-price-agreements`
- `/westsides/customers/[id]`
- `/westsides/customers/[id]/print`
- `/westsides/customers`
- `/westsides/daily-close`
- `/westsides/delivery-notes/[id]/print`
- `/westsides/delivery-notes`
- `/westsides/inventory/live`
- `/westsides/mobile-pos/day-reports`
- `/westsides/mobile-pos/install`
- `/westsides/mobile-pos/terminals`
- `/westsides/package-movements`
- `/westsides`
- `/westsides/price-lists`
- `/westsides/product-batches`
- `/westsides/proforma-invoices/[id]/print`
- `/westsides/proforma-invoices`
- `/westsides/quick-sale`
- `/westsides/quotations/[id]/print`
- `/westsides/quotations`
- `/westsides/reports`
- `/westsides/returnable-packages`
- `/westsides/stock-damage`

