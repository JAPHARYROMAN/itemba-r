# ITEMBA OS — selected direction 2

## Phase 5 — Stock damage (18 September 2026; live review pending)

Current result: OS register, inspector, guarded draft editor and named action dialogs implemented; isolated checks and visual review passed. Authenticated live review is still required.

- Scoped search/status/type/product filters, stable server pagination, complete exports, retryable reads, permission-aware links and exact status actions are connected. Quantity/unit, estimated value, batch and approval details remain inspectable. Create input survives failed saves and protected dismissal; posting effects distinguish estimates from actual inventory valuation. Backend posting rules are unchanged.
- Compared inventory-damage-desktop.png against selected-reference.png at 1487×1058. Phone 390×844 captures cover register rows, inspector fields, posting confirmation and upper/lower draft form; document width is 390. inventory-damage-dark.png and inventory-damage-post-dark.png cover dark appearance. All populated captures use synthetic test DOM and production CSS. Normal viewport restored; temporary fixture tab/server closed.
- Nineteen damage tests, three Inventory shell regressions and ten backend tests passed (32 total). Targeted ESLint and both builds passed, with 200 frontend static pages and TypeScript checked.
- Recovered the stopped local database runtime by preserving inaccessible Docker socket directories and recreating empty runtime directories; no data volumes were removed or reset. PostgreSQL/Redis healthy, rebuilt backend on 3014 reports ok/database up, stderr empty, frontend on 3009.
- Browser sign-in expired. Live filters, choices, draft protection, reduced motion and console review remain pending fresh sign-in; no real damage report was saved or acted on. Counts remain Operations 12/25, Westsides 2/23 until this final gate is complete. The complete Phase 5 scope remains active.

## Phase 5 — Stock adjustments (18 September 2026)

final result: adjustment register, inspector, line review, actions and creation form reviewed; full Phase 5 remains active

- Shared OS list/inspector replaces the wide register; focused review presents quantities, units, cost, reason/notes and the approval/posting trail. Scoped search/status/date filters, full-register exports, retryable reads, cancelled obsolete requests and exact action/destination permissions are connected. New drafts use complete directory choices, stable line identities and cancellable balances; missing stock is not silently zero. Posting rules remain unchanged.
- Compared inventory-adjustments-desktop.png with selected-reference.png at 1487×1058. Phone 390×844: inventory-adjustments-mobile.png, inventory-adjustments-details-mobile.png, inventory-adjustment-review-mobile.png and inventory-adjustment-review-actions-mobile.png; document width 390. Populated review desktop/dark and phone evidence uses synthetic React-test DOM with production CSS. Live captures are inventory-adjustments-filters-mobile.png, inventory-adjustment-editor-live-mobile.png and inventory-adjustments-live-dark.png. Corrected narrow inspector action, product-link affordance and dark contrast after visual inspection.
- Live scope/search/status/typed dates, reset/refresh, real product/unit selection, missing-balance explanation, four-decimal entry and Stay/Discard verified without business-record mutation. Reduced-motion Refresh transition/animation measured 0s; browser errors empty. Restored Light/Follow device, All companies and normal viewport. Temporary preview tabs/server closed.
- Twenty adjustment tests, three shell regressions and ten backend checks passed (33 total). Targeted lint, TypeScript, final frontend build (200 static pages) and backend build passed; restarted backend healthy/database up. Operations 12/25 reviewed, Westsides 2/23. Stock damage and the remaining 215-route Phase 5 scope remain open, including native date/time popup and browser-print pagination gaps.

## Phase 5 — Batches and expiry (18 September 2026)

final result: batch register, expiry reviews, inspector and creation form reviewed; full Phase 5 remains active

- OS list/inspector replaces the first-100 table. Server pagination and matching counts retain company/division/branch/product/search/status filters in both expiry reviews without changing their date/status rules. Added backend relations restore readable labels. Four-decimal quantities keep their units, unknowns remain distinct from zero, and links respect their own permissions and row scope. Failed reads clear stale records; complete choice lists and failed saves retry safely. The creation form protects drafts and validates quantity precision/date ordering.
- Compared inventory-batches-desktop.png and inventory-batches-fields-desktop.png with selected-reference.png at 1487×1058; lower detail fields, actions and pagination remain reachable. Phone captures inventory-batches-mobile.png, inventory-batches-details-mobile.png and inventory-batches-fields-mobile.png use synthetic React-test DOM and production CSS. Live inventory-batches-filters-mobile.png and inventory-batch-editor-mobile.png show filters and the unsaved form. Both document widths measured 390 at 390×844. Fixed missing embedded New batch action and section spacing during review.
- Live combined scope/search/status/expiry review, refresh/reset, directory choices, typed dates and Stay/Discard verified without business-record mutations. inventory-batches-live-dark.png reviewed at 1280×720; Reduced-motion refresh computed 0s. Restored Light/Follow device, All companies and normal viewport; console errors empty; fixture tab/server closed. Native date popup remains an existing unverified browser limitation.
- Eleven frontend batch tests, three shell regressions and seven backend checks passed (21 total). Backend tests passed with an 8 GB heap after the initial default-heap process terminated. Targeted lint, TypeScript, final frontend production build (200 static pages) and backend build passed; restarted service healthy/database up. Westsides 2/23 reviewed, Operations 11/25; full 215-route Phase 5 remains active, including native date/time popup and browser-print pagination gaps.

## Phase 5 — Live stock (18 September 2026)

final result: live-stock register, locations and inspector reviewed; full Phase 5 remains active

- OS list/inspector exposes all location stock positions rather than the capped risk preview. Complete scope totals, stock review filters, per-product quantities/reservation shares, unknown values, exact permissions and scope-preserving destinations remain connected. Optional 30-second refresh and manual refresh expose successful-update age, validation and retry; failed reads clear stale values. Backend rows retain actual company/division/branch and reject invalid fallback thresholds without changing valuation/posting rules.
- Compared inventory-live-desktop.png and inventory-live-inspector-desktop.png with selected-reference.png at 1487×1058. Phone 390×844: inventory-live-mobile.png, inventory-live-details-mobile.png and inventory-live-fields-mobile.png show available quantity, stock value, complete details and actions. inventory-live-filters-mobile.png is live; populated/dark captures use synthetic React-test DOM and production CSS because the real collection is empty. Both phone widths measured 390. inventory-live-dark.png and shared movement phone styling reviewed. Reduced-motion refresh computed 0s transition/animation.
- Live company/branch scope, inferred division, combined search/review, invalid threshold and zero recovery, refresh/reset and auto-refresh controls verified. Read failures during backend restart recovered through separate stock/directory retries. Restored Light/Follow device, All companies and normal viewport; console errors empty. No business records changed; fixture tab/server cleaned up.
- Eleven live-stock frontend tests, twelve shell/movement regressions and thirteen backend tests passed (36 total). Targeted lint, TypeScript, frontend build (200 static pages) and backend build passed; restarted service healthy/database up. Westsides 1/23 reviewed; Operations 11/25. Full 215-route Phase 5 remains active; native date/time popup and browser-print pagination gaps remain open.

## Phase 5 — Stock movements (18 September 2026)

final result: movement ledger and inspector reviewed; live stock and full Phase 5 remain active

- Shared OS list/inspector replaces the wide ledger. Phone rows retain quantity and recorded cost. Filters, 20-row pagination, scope, exact permissions and source navigation remain connected. Complete filtered totals replace page-only metrics; all-page CSV/PDF exports expose errors, cancellation and the 5,000-row PDF limit. Readable unit/division names come from two added backend list relations; posting and valuation logic are unchanged.
- Compared inventory-movements-desktop.png with selected-reference.png at 1487×1058. inventory-movements-source-desktop.png covers source/batch/notes, actions and pagination. Phone 390×844 captures inventory-movements-mobile.png, inventory-movements-details-mobile.png and inventory-movements-actions-mobile.png use synthetic React-test DOM with production CSS. Live inventory-movements-filters-mobile.png confirms consistent full-width controls. Document width 390. Corrected filter alignment and phone quantity/cost visibility after review.
- Live combined type/source/typed dates, reversed-date recovery, company scope, refresh and reset returned clean empty results. inventory-movements-live-dark.png reviewed; Reduced motion computed 0s. Opening the native calendar popup crashed the in-app browser; this verification gap remains open. Recovered in a fresh tab, console errors empty. Restored Light/Follow device, All companies and normal viewport. No business records changed; preview fixture tab/server cleaned up.
- Nine frontend movement tests, three shell regressions and five backend summary/contract tests passed. Targeted lint, TypeScript, final frontend build (200 static pages) and backend build passed. Restarted backend healthy/database up. Operations 11/25 reviewed. Full 215-route Phase 5 remains active, including native date/time popup and browser-print pagination gaps.

## Phase 5 — Inventory balances (18 September 2026)

final result: balances register and inspector reviewed; movements and full Phase 5 remain active

- Replaced the wide stock table with the OS list/inspector, retaining all business fields, filters, server pagination, category/family actions and scoped product/movement destinations. Summary failures retry independently, directories read all pages with exact permissions, unknown values stay distinct from zero, and obsolete scoped reads are cancelled. CSV exports all matching pages; PDF refuses more than 5,000 explicitly. Export failures retain retry and filters cancel obsolete downloads.
- Reviewed inventory-balances-desktop.png against selected-reference.png at 1487×1058. Corrected cramped detail space by arranging actions in two columns and aligning labels/values. Phone captures at 390×844: inventory-balances-mobile.png, inventory-balances-details-mobile.png, inventory-balances-fields-mobile.png and inventory-balances-filters-mobile.png. Document width 390; actions and all stock fields remain reachable. Populated captures use synthetic component-test DOM with production CSS; the live collection is empty.
- Live company/search/stock/cost/age combinations, refresh and reset verified. inventory-balances-live-dark.png reviewed; Reduced motion refresh transition/animation computed 0s. Restored Light/Follow device, All companies and normal viewport. Console errors empty, backend ok/database up, no business record mutation. Temporary preview tab/server closed.
- Eleven balance tests, three shell regressions and eight backend balance contract/low-stock tests passed. Targeted ESLint and final production build/TypeScript passed (200 static pages). Operations 10/25 reviewed; full 215-route Phase 5 remains active, including the prior native date/time popup and browser-print pagination gaps.

## Phase 5 — Inventory shell and overview (18 September 2026)

final result: shell and stock-health overview reviewed; remaining stock workflows and full Phase 5 remain active

- Quiet section/secondary navigation, complete scoped directory choices and an optional product finder connect the existing catalogue and stock destinations. The overview uses a stock-health summary, pending adjustments and movement list/inspector with explicitly limited preview exports. Failed reads, unknown values, scope changes, permissions and unsaved drafts remain distinct.
- Compared inventory-overview-desktop.png with selected-reference.png at 1487×1058. Changed summary facts to stacked labels/values and improved dark link contrast. Phone 390×844 evidence: inventory-overview-mobile.png, inventory-overview-details-mobile.png and inventory-shell-mobile.png; document width 390. Populated overview captures are synthetic component-test DOM with production CSS; the actual live collection is empty.
- Live real company/branch selection, inferred division, refresh, empty search and Products/Units navigation verified. A native Escape issue found in browser testing was fixed and regression-tested: closing search now retains the query and URL scope. inventory-overview-dark.png precedes the final contrast correction; inventory-shell-dark.png records corrected live links. Reduced motion computed 0s transition/animation. Restored Light/Follow device, All companies and normal viewport. Console errors empty, API healthy, no business record mutation.
- Nineteen frontend tests passed; ten existing backend live-stock/movement-summary tests passed in the implementation pass. Targeted lint and final production build/TypeScript passed (200 static pages). Preview tab/server closed. Operations 9/25 reviewed; balances, movements and remaining stock workflows are next. Full 215-route Phase 5 remains active, including earlier date/time popup and browser-print pagination gaps.

## Phase 5 — Products register and profile (17 September 2026)

final result: register and full product profile reviewed; full Phase 5 remains active

- Shared list/inspector preserves combined filters, scope, thumbnails, complete CSV/PDF exports and all product fields. The full profile adds the shared editor and permission-aware overview, stock, movement and profit sections. Complete stock totals replace the 200-record cap; history failures expose retry. Unknown amounts remain distinct from zero; the profit history explains its 250-line API limit. Backend product reads include division identity without changing existing access or pricing rules.
- Reviewed product-register-desktop.png and product-profile-desktop.png against selected-reference.png at 1487×1058, plus product-profile-movements-desktop.png and product-profile-profit-desktop.png. Fixed missing profile page spacing, unwanted vertical stretching and overly tall phone price/stock summaries during review.
- Phone evidence at 390×844: product-register-mobile.png, product-register-details-mobile.png, product-register-actions-mobile.png, product-profile-mobile.png, product-profile-details-mobile.png, product-profile-stock-mobile.png, product-profile-movements-mobile.png and product-profile-profit-mobile.png. Document width 390; inspector actions remain near the heading, and history tables use readable labelled rows. Populated evidence uses synthetic component-test DOM with production CSS; the live product collection is empty. Captures precede a final tested link restoration to the Inventory movements register.
- Live company/type/status/price-source/search combinations returned empty results without failures. product-register-dark.png records the live dark review at 1280×720; product-profile-dark.png is a synthetic populated profile. Reduced-motion transition/animation measured 0s. Restored Light/Follow device, All companies and normal viewport. Console errors empty; no business record or image mutation performed.
- Twenty-one register/profile tests plus 27 existing editor/catalogue tests passed, as did eight backend product read/pricing checks, targeted lint and frontend/backend builds. Final navigation-link restoration passed profile tests, lint and TypeScript. Backend health reports ok/database up after restart. Temporary preview tab/server stopped. Operations 8/25 reviewed; Inventory and the remaining Phase 5 inventory remain open, including the earlier native date/time popup and browser-print pagination gaps.

## Phase 5 — Product editor (17 September 2026)

final result: grouped editor increment reviewed; Products register/profile and full Phase 5 remain active

- Shared editor groups identity, family/variants, prices/tax and units/inventory, with independent image controls. Existing business fields and family generation remain available. Family inheritance now displays the effective family prices rather than faded old overrides, and retains the margin preview. Optional clears and company-wide scope are preserved; drafts and failed requests retain input.
- Reviewed product-editor-desktop.png and product-editor-prices-desktop.png at 1487×1058 against selected-reference.png. Phone 390×844 evidence: product-editor-mobile.png, product-editor-prices-mobile.png, product-editor-inventory-mobile.png and product-editor-image-mobile.png. Measured document width 390; fields wrap into one column and save/cancel remain reachable. Populated captures are synthetic test DOM with production CSS and current checkbox/input values.
- Live editor/company/division/unit choices and draft Stay/Discard checked without saving; product-editor-live.png and product-editor-dark.png record 1280×720 reviews. Reduced-motion save transition/animation computed 0s. Light/Follow device and normal viewport restored. Products/categories are empty; no live record or image mutation occurred. Console errors empty and backend health HTTP 200.
- Thirteen product-editor tests, fourteen catalogue regression tests and twenty-six existing backend product/pricing checks passed. Targeted lint, production build and TypeScript passed; final parent success-toast restoration also passed TypeScript. Temporary preview tabs/server closed. Products register/profile and Inventory wrapper remain next; Operations still 6/25 fully reviewed. Earlier date/time popup and print-pagination verification gaps remain open.

## Phase 5 — Product categories and families (17 September 2026)

final result: reviewed category/family workspaces, editors and price review passed; full Phase 5 remains active

- Compared catalogue-categories-desktop.png with selected-reference.png at 1487×1058; reviewed catalogue-category-actions-desktop.png and catalogue-families-desktop.png. Corrected the initially cramped category inspector by giving details and actions one continuous scroll. Category totals use complete server aggregates; family counts and price sources remain distinct.
- Phone 390×844: catalogue-categories-mobile.png, catalogue-category-details-mobile.png, catalogue-category-editor-mobile.png, catalogue-families-mobile.png, catalogue-family-details-mobile.png, catalogue-family-editor-mobile.png, catalogue-family-prices-mobile.png and catalogue-price-review-mobile.png. Grouped fields, all price defaults, inheritance counts, descriptions and actions are readable; document width measured 390. Populated evidence uses synthetic test DOM and production CSS, with consistent fixture counts.
- Live embedded Inventory company/type/status/search filters and real company choices reviewed. Category draft Stay retained input, Discard removed it and returned focus to New category. No live business mutations performed; the live category collection is empty. catalogue-category-dark.png reviewed at 1280×720; Reduced motion computes 0s on save controls. Light/Follow device and All companies restored; browser errors empty.
- Fourteen frontend tests, seventeen backend checks, targeted lint and frontend production build/TypeScript (200 pages) passed. Backend health HTTP 200. Exact permissions, full choices/exports, stale reads, changed-field updates, parent reuse after partial failure, named actions, pricing validation and price-review failures were verified with isolated tests. Operations now 6/25 reviewed; products, Inventory wrapper and the remaining Phase 5 scope stay open, including earlier native date/time popup and print-pagination gaps.

## Phase 5 — Units and conversions (17 September 2026)

final result: reviewed register, inspector and conversion editor layouts passed; full Phase 5 remains active

- Desktop 1487×1058: units-desktop.png compared with selected-reference.png; units-conversions-desktop.png and units-conversion-details-desktop.png reviewed. Shared list/inspector, quiet summary, readable decimal factors and complete detail fields follow the OS layout.
- Phone 390×844: units-conversions-mobile.png, units-conversion-details-mobile.png, units-conversion-editor-mobile.png and units-details-mobile.png. Document width measured 390; details, equation, description and action controls remain readable and reachable. Populated captures use synthetic test DOM with production CSS; the editor capture was taken after its opening transition settled.
- Live embedded Inventory review covered system units, scoped search/type/status filters, active unit choices and conversion draft Stay/Discard. Fixed a scope/search navigation race and guarded scope changes against unsaved drafts. Live dark inspector captured in units-dark.png at actual 696px width; Reduced motion actions computed 0s. Light/Follow device and normal viewport restored. No live business mutations performed.
- Fifteen frontend workflow tests and twelve backend checks, targeted lint and both production builds passed. Backend health HTTP 200, console errors empty. Complete CSV export and explicit PDF 5,000-record limit tested with isolated mocks. Operations now 5/25 reviewed; full Inventory wrapper, products and categories/families remain. Earlier native date/time popup and print-pagination gaps remain open.

## Phase 5 — Customer and supplier profiles (17 September 2026)

final result: reviewed profile layouts passed; full Phase 5 remains active

- Reviewed partner-customer-profile-desktop.png against selected-reference.png at 1487×1058, plus partner-supplier-profile-desktop.png. Quiet financial summaries, wrapped section controls, direct editing and complete existing history fields follow the shared OS layout. Synthetic aging rows were corrected to agree with their count and totals before the final capture.
- Phone 390×844 evidence: partner-customer-profile-mobile.png, partner-customer-profile-details-mobile.png, partner-supplier-profile-details-mobile.png, partner-customer-orders-mobile.png, partner-supplier-products-mobile.png and partner-customer-statements-mobile.png. Fields, amounts, history and actions remain readable; measured document width 390. Populated captures use synthetic test DOM with production CSS.
- Live existing profiles and untouched editors reviewed; customer contact values retained, statement controls rendered, supplier keyboard section activation and customer Back navigation verified. Thirteen profile and sixteen directory tests passed, targeted ESLint and the production build passed. No live business mutations or statement generation performed.
- partner-customer-profile-dark.png and partner-supplier-profile-dark.png reviewed. Reduced motion section transitions compute 0s; Light/Follow device and normal viewport restored. Browser console errors empty; temporary preview tab/server closed. Native date/time popup and print-pagination gaps from earlier increments remain open. Operations is now 4/25 reviewed; next are products, categories/families and units/conversions.

## Phase 5 — Customer and supplier directories (17 September 2026)

final result: reviewed directory and editor layouts passed; full Phase 5 remains active

- Compared partner-customers-desktop.png with selected-reference.png at 1487×1058; final partner-suppliers-desktop.png also reviewed. Initial stacked actions crowded the inspector; revised two-column actions and label/value rows expose more useful details while retaining reachable controls.
- Phone 390×844: partner-suppliers-mobile.png, partner-suppliers-details-mobile.png, partner-customers-details-mobile.png, partner-customer-editor-mobile.png, partner-supplier-editor-mobile.png and partner-supplier-editor-details-mobile.png. Scope, contact/credit fields, categories and footer actions fit without horizontal overflow (document width 390). Populated visual fixtures are synthetic component-test DOM with production CSS.
- Live customer profile navigation, temporary draft Stay/Discard, supplier filters and untouched editor dismissal verified. Sixteen frontend and thirteen backend checks, targeted lint and both builds passed. Backend health HTTP 200. Dark appearance reviewed in partner-suppliers-dark.png; Reduced motion action transitions 0s. Light/Follow device and normal viewport restored; console errors empty; preview tab/server closed. No live business mutations performed. Full customer/supplier profiles remain a separate rollout item.

## Phase 5 — Approval requests and pending inbox (17 September 2026)

final result: reviewed request and inbox layouts passed; full Phase 5 remains active

- Compared approval-requests-desktop.png with selected-reference.png at 1487×1058. Tightened primary facts, moved routing metadata into an expander and retained visible desktop decision actions. Also reviewed pending and scrolled history desktop captures.
- Phone captures approval-requests-mobile.png, approval-request-history-mobile.png and approval-request-decision-mobile.png at 390×844 show readable details/history, named confirmations and reachable actions with document width 390. Populated evidence is synthetic component-test DOM; live collections are empty.
- Live filters and navigation verified without business mutations. Thirteen frontend and twenty-two backend checks, targeted lint and both builds passed. Dark appearance reviewed in approval-inbox-dark.png; Reduced motion computes 0s. Original Light/Follow device and viewport restored; console errors empty. Temporary preview tab closed and server confirmed stopped. No new blocking visual defect found in reviewed states.

## Phase 5 — Approval delegations (17 September 2026)

final result: reviewed delegation layouts passed; full Phase 5 remains active

- approval-delegations-desktop.png compared with selected-reference.png at 1487×1058. Shared OS shell, selected list row, detail inspector and action hierarchy retained. Fixture data is synthetic; the live collection is empty.
- Phone 390×844: approval-delegations-mobile.png, approval-delegations-details-mobile.png, approval-delegation-form-mobile.png and approval-delegation-form-details-mobile.png. Company, participants, exact date/time controls, reason and footer actions remain reachable. Document width 390. Native date/time popup verification remains a separate open host limitation.
- Dark appearance reviewed in approval-delegations-dark.png; Reduced motion computes 0s. Live company-scoped people, combined filters, draft Stay/Discard and unchanged form dismissal verified. Eight frontend and eighteen backend checks passed, with targeted lint and both builds. No live delegation or approval action submitted. Original Light/Follow device and normal viewport restored; console errors empty, preview tab/server closed. No new blocking visual defect found in the reviewed states.

## Phase 5 — Approval workflows (17 September 2026)

final result: reviewed workflow layouts passed; full Phase 5 remains active

- approval-workflows-desktop.png compared with selected-reference.png at 1487×1058. Shared list/inspector, restrained surfaces and clear action hierarchy retained. Populated fixture uses synthetic records exported from real component tests.
- Phone captures approval-workflows-mobile.png, approval-workflows-details-mobile.png, approval-workflow-form-mobile.png and approval-workflow-form-details-mobile.png at 390×844 cover complete details and reachable form actions. Dark appearance reviewed in approval-workflows-dark.png; reduced motion computes 0s.
- Live existing global workflow inspected; edit/discard, deactivate cancellation and delete Escape verified without changing configuration. Nine frontend and eleven backend tests passed, frontend lint and both builds passed. Browser console error log empty; Light/Follow device and viewport restored. Preview server stopped. No new blocking layout issue in reviewed states.

## Phase 5 — Approval overview (17 September 2026)

final result: reviewed overview layouts passed; remaining approval workflows and full Phase 5 remain active

- Compared approval-overview-desktop.png alongside selected-reference.png at 1487×1058. Shared OS shell, selection, typography and surfaces remain consistent; readiness diagnostics intentionally replace the reference's payment-request content. approval-overview-summary-desktop.png captures the top summary and scope control. Existing readiness scoring is unchanged.
- Phone 390×844: approval-overview-mobile.png, approval-overview-details-mobile.png and approval-overview-controls-mobile.png. Measured document width 390; summary, complete check details, lower indicators and workspace links fit. Live Back to list restored focus; selecting another check focused the inspector.
- Dark appearance reviewed in approval-overview-dark.png; Reduced motion computes 0s. Scope changes, Refresh, check inspection, Pending navigation and Back verified. Eight frontend tests and four backend checks passed; targeted lint and frontend production build passed. Restored Light/Follow device and normal viewport; console error log empty. No new blocking layout issue identified in reviewed states. No approval transaction was submitted.

## Phase 5 — People hub and WCF exposure (17 September 2026)

final result: reviewed desktop/mobile layouts passed; full Phase 5 remains active

- Compared people-hub-desktop.png with selected-reference.png at 1487×1058. The shared shell, quiet surfaces and typography remain consistent; workforce and attention panels intentionally replace the reference's approval list. Lower desktop review covers payroll, company counts, recent employees, nine destinations and the contract-expiry disclosure.
- WCF review covers all-branch monthly totals and the independently scrollable branch inspector, including recorded amounts, distinct employee counts and months without lines. Evidence: wcf-exposure-desktop.png, wcf-exposure-months-desktop.png and wcf-exposure-details-desktop.png.
- Phone 390×844: people-hub-mobile.png, people-hub-payroll-mobile.png, people-hub-details-mobile.png; wcf-exposure-mobile.png, wcf-exposure-totals-mobile.png, wcf-exposure-details-mobile.png. Filters, actions and monetary values fit; document width 390. Synthetic fixtures use actual React test DOM and compiled CSS.
- Live company/period generation, validation, company filtering, refresh and employee-profile navigation passed. Thirteen frontend and 15 backend checks, targeted ESLint and both builds passed. Backend restarted and healthy. Dark screenshots reviewed for both workspaces, Reduced motion computes 0s; restored Light/Follow device and viewport. Console error log empty; temporary preview stopped. All 31 HR routes now have visual evidence; existing native date and print-pagination gaps remain open.

## Phase 5 — Statutory returns (17 September 2026)

final result: reviewed statutory layouts passed; full Phase 5 remains active

- Compared revised statutory-paye-desktop.png and selected-reference.png together at 1487×1058. Reused OS shell, assets, typography and surfaces; report selection/filter/summary content intentionally differs from the approvals reference. No new imagery. statutory-paye-details-desktop.png shows the readable inspector and pagination after workspace scrolling.
- First-pass findings: competing primary Generate and Download actions, plus weak selected-label contrast in dark mode. Generate now becomes secondary after a result loads; Download remains primary. Shared report selectors use the theme's main text color. Rebuilt and recaptured both states. statutory-dark.png has selected text rgb(233,235,239) on rgb(27,30,37); Reduced motion computes 0s.
- Phone 390×844: statutory-nssf-mobile.png, statutory-nssf-totals-mobile.png, statutory-nssf-details-mobile.png and statutory-sdl-mobile.png. Three-column return choices and stacked filters fit; complete monetary totals, membership details, SDL boolean and actual CSV row count remain readable. Measured width 390. Populated visuals use real React test DOM with synthetic content and compiled CSS; serialized options preserve the actual selected values.
- All seven live API modes and company/year/month changes checked, with empty collections. Keyboard selection/generation, permission/CSV/retry/cancellation tests passed. Fifteen frontend and 17 backend checks plus targeted ESLint and both builds passed. No new P0/P1/P2 defect identified in reviewed states. Light/Follow device and viewport restored; browser error log empty; fixture server stopped. Remaining HR routes: WCF exposure and People hub. Existing date-control and print-pagination verification gaps remain.

## Phase 5 — People reports (17 September 2026)

final result: reviewed report layouts passed; native date entry remains a documented verification gap

- Compared selected-reference.png and hr-report-employees-desktop.png together at 1487×1058. Shared shell, typography, assets, restrained colors and list/inspector remain consistent. Report selectors, filters and whole-result summaries intentionally replace the reference's approval tabs. No new imagery.
- Reviewed hr-report-payroll-desktop.png, hr-report-attendance-desktop.png and hr-report-leave-desktop.png. Leave's scrolled capture verifies reachable pagination. At 390×844, hr-report-payroll-mobile.png, hr-report-payroll-details-mobile.png, hr-report-attendance-mobile.png and hr-report-leave-mobile.png show stacked filters and readable totals/details; measured document width 390. Populated states use synthetic React test DOM and compiled CSS, not live HR writes.
- hr-reports-dark.png reviewed; Reduced motion selectors compute 0s. Restored Light/Follow device and viewport. Live employee filtering and all four API report modes checked, with empty attendance/payroll/leave collections. Browser error log empty.
- Eight frontend and six backend tests, targeted ESLint and both builds passed. Native date automation did not persist reliably; validation is test-covered, not claimed as a successful live date-entry check. No new P0/P1/P2 visual defect identified in reviewed states. Phase 5 remains active: three HR routes plus other module families remain.

## Phase 5 — CCM documents (17 September 2026)

final result: passed

- Compared docs/design/itemba-os/selected-reference.png with revised ccm-termination-desktop.png in the same image input at 1487×1058 pixels/CSS viewport, without density normalization. The source is the approved OS shell; a centered serif document intentionally replaces its approvals list. Also reviewed ccm-referral-desktop.png. Shared workspace typography, hierarchy, assets and theme tokens remain consistent; document serif text and fixed white paper intentionally preserve the form's distinct presentation. No new imagery.
- First-pass [P2] finding: draft context and paper touched with no separation. Added a 24px margin above the paper. Rebuilt and captured the same state; the revised side-by-side comparison and phone captures show the separation. No remaining P0/P1/P2 visual issue identified in reviewed states.
- Phone evidence at 390×844 CSS pixels (image height rounds to 843): ccm-termination-mobile.png, ccm-termination-signatures-mobile.png, ccm-referral-mobile.png and ccm-referral-signatures-mobile.png. Document width equals viewport width. Identity fields, long content, operator blanks and signatures stack and wrap. These focused content captures supplement the full-view comparison. Fixtures are exported actual React test DOM, not live employment mutations.
- Copy preserves bilingual document content and adds accurate draft context; referral operator attribution says Recorded by. Live termination read, missing-referral retry and dark appearance reviewed. ccm-document-dark.png retains readable paper contrast. Reduced motion computes 0s; Light/Follow device and normal viewport restored. Browser error log empty.
- Eight frontend and six backend tests, targeted ESLint and both builds passed, including a final frontend rebuild after the spacing fix. No new P0/P1/P2 issue identified in reviewed states. Physical browser-print pagination remains unverified; invocation tests are not pagination evidence. Full Phase 5 remains active with four HR routes and other module families pending.

## Phase 5 — Employment disputes (17 September 2026)

final result: passed

- Scope is the reviewed dispute register, detail, draft and resolution states; full Phase 5 remains active. Source: docs/design/itemba-os/selected-reference.png. Compared in the same image input with dispute-register-desktop.png at 1487×1058 pixels/CSS viewport, no density normalization. Source shows approvals, so content and the filter/header structure intentionally differ; comparison covers the shared OS shell and visual language.
- Typography retains the existing UI family and hierarchy; spacing preserves quiet surfaces and readable list/detail separation; colors use existing theme tokens. Crest, wallpaper and dock reuse existing assets without new imagery. Dispute copy identifies the employee/case and distinguishes recorded referrals/amounts from filing/payment. Full-view text is readable; desktop detail and phone captures provide the focused content checks.
- Also inspected dispute-detail-desktop.png and phone captures dispute-register-mobile.png, dispute-detail-mobile.png, dispute-history-mobile.png, dispute-resolution-mobile.png and dispute-form-mobile.png. Phone CSS viewport 390×844 (captured height rounds to 843), no horizontal document overflow. Detail cards stack; workflow actions, confirmation context and form footer remain reachable. Synthetic fixtures prove rendering, not live mutation execution.
- Live combined filters and draft Stay/Discard passed. Dark appearance reviewed in disputes-dark.png and Reduced motion computes 0s. Original Light/Follow device and viewport restored; browser error log empty. Twelve frontend and seven backend tests plus both builds passed. No new P0/P1/P2 issue identified in reviewed states. Six HR routes and other module families remain; prior print/native-popup verification gaps remain open.

## Phase 5 — Disciplinary actions (17 September 2026)

final result: reviewed desktop, phone, approval and dark states passed; full Phase 5 remains active

- Compared selected-reference.png with disciplinary-fixture-desktop.png at 1487×1058. Reused the OS shell, assets, typography, list/inspector and restrained primary/secondary actions. No new imagery. The populated fixture comes from the actual React tests and proves layout only.
- disciplinary-fixture-mobile.png and disciplinary-fixture-mobile-details.png verify reachable record actions, readable supporting detail and full fine amounts. disciplinary-approval-mobile.png shows the named employee/action/reason, effect and fine context together with confirmation controls. Phone document width equals 390 CSS pixels.
- Live disciplinary-form-mobile.png and disciplinary-form-mobile-details.png show the grouped form and multiline notes. Stay retains the draft; Discard removes it. No employment action or deduction was submitted. The live register and dispute choices are empty, so populated mutation outcomes are tested with mocks.
- disciplinary-dark.png reviewed at 1487×1058; Reduced motion produces 0s filter transition. Light/Follow device and normal viewport restored. Final browser console inspection clear and backend health HTTP 200. Ten frontend and six backend checks, lint and both builds pass.
- No P0/P1/P2 visual issue identified in the captured states. Disputes/detail and the remaining ERP rollout continue. Browser-print pagination and native date/time popup verification remain open.

## Phase 5 — Medical examinations (17 September 2026)

final result: reviewed desktop, phone and dark states passed; full ERP rollout remains active

- Reused the approved OS shell, crest, wallpaper, dock, typography and shared list/inspector. The selected reference and desktop fixture were reviewed; the initial screenshot caught an unfinished viewport resize and was replaced with a settled 1487×1058 capture. No new artwork or substitute live data was introduced.
- medical-exam-fixture-desktop.png, medical-exam-fixture-mobile.png and medical-exam-fixture-mobile-details.png show synthetic records from actual React tests. They verify hierarchy, reachable actions and readable provider/assessment detail. They do not prove live medical writes.
- medical-exam-form-mobile.png and medical-exam-form-mobile-details.png show real unsaved form choices. Phone width is 390 with no document overflow; the form scrolls while its footer remains reachable. Stay preserves the draft and Discard removes it. medical-exams-dark.png is legible; Reduced motion computes 0s. Light/Follow device and normal viewport restored.
- Seven frontend and five backend checks, targeted frontend lint and both builds passed. Backend health is HTTP 200; real filters and choices loaded without API errors; final browser console inspection clear. No live medical or employment record changed. Details and limitations are recorded in the Phase 5 rollout document.
- No new P0/P1/P2 visual issue identified in these captured states. Nine HR routes and other module families remain, along with previously recorded browser-print and native date/time popup verification gaps.

## Phase 5 — Employee allowances and deductions (17 September 2026)

Reviewed desktop, phone, populated fixture details and live draft forms with the existing OS shell and approved reference. Reused shared typography, surfaces and grouped forms; no new assets. Phone forms scroll internally with reachable footer actions. Dark appearance is legible and Reduced motion yields a 0s filter transition. Light/Follow device and viewport restored.

Evidence is recorded in docs/design/itemba-os/phase-5-rollout.md. Fourteen frontend and six backend checks plus both builds passed. Synthetic populated fixtures prove layout; live empty collections and discarded drafts prove real choices and navigation. No business records were written. No new visual defect identified in reviewed states. Full Phase 5 remains active; browser print and native date/time popup gaps remain open.

## Phase 5 — Allowance and deduction types (17 September 2026)

final result: passed for the reviewed states

- Visual truth: reviewed the revised allowance-types-desktop.png alongside selected-reference.png at 1487×1058; also reviewed deduction-types-desktop.png and deduction-types-dark.png. Actual existing categories populate these captures. The crest, wallpaper, OS window, dock, typography and shared list/inspector are unchanged.
- Finding corrected (P2): a large red Delete action competed with Edit. It is now a quiet secondary action in the inspector; the named confirmation retains its danger button. The revised screenshot confirms the calmer hierarchy.
- Responsive evidence: allowance-type-form-mobile.png, deduction-type-form-mobile.png, deduction-type-form-mobile-details.png and deduction-types-mobile.png at 390×844 CSS pixels (843px image height). Document width equals 390. Forms scroll beneath stable headers and footer actions; the percentage, classification, recurring and active controls are reachable. Phone detail actions precede the field list. Scrolled captures intentionally show the current scroll position, not missing fields.
- Interaction evidence: real allowance search, existing record selection, amount/percentage drafts with Stay/Discard, untouched create/cancel, delete confirmation cancelled by Escape, mobile Back to list with focus restored, dark appearance and Reduced motion (0s filter transition). The first native automation fill did not retain an emptied number; keyboard selection and Backspace did, and Stay retained that value. No live business records changed.
- Verification: ten frontend and four backend tests passed. Tests cover separate read/manage gates, paged scoped search, defaults/boolean creation values, retryable choice failures, partial update payloads, nullable clearing, draft protection and failed/successful deletion. Targeted ESLint and production frontend build passed; TypeScript and lint passed again after the visual refinement. No backend production code changed. Original Light/Follow device and viewport restored.
- No remaining P0/P1/P2 issue identified in the reviewed states. Phase 5 remains active; employee-level allocations and other modules are still pending. Browser print and native date/time popup verification gaps remain open.

## Phase 5 — Salary advances and generated payslips (17 September 2026)

final result: salary advance reviewed states passed; generated PDF pagination reviewed; browser print remains open

- Visual truth: compared selected-reference.png and salary-advances-desktop.png together at 1487×1058. Reused the OS shell, crest, wallpaper, dock, typography and quiet surfaces. The live collection is empty; advance-recovery-fixture-desktop.png and advance-approval-fixture-mobile.png use actual React output exported from isolated tests with synthetic records and compiled application CSS. These fixtures are visual evidence only.
- Hierarchy and response: searchable list/inspector, grouped request form, explicit employee/company/amount in approval, and currency-correct recovery details. The detail pane scrolls to remaining recovery and recorded dates without expanding the document horizontally. Phone form and approval actions remain reachable. No new assets were needed.
- Evidence: salary-advance-form-mobile.png, advance-approval-fixture-mobile.png and advance-recovery-fixture-mobile.png at 390×844 CSS pixels (843px capture height), document width 390. salary-advances-dark.png reviewed at 1487×1058. Reduced motion yielded 0s filter transition; original Light/Follow device and viewport restored.
- Workflow checks: eight frontend and five backend tests passed, targeted ESLint and both builds passed. Live company/employee choices, request draft Stay/Discard and scoped search/filters were checked. Consequential create/approve/pay cases use isolated API mocks; no live financial or employment records changed.
- PDF gap narrowed: ran the real generated-document service against two synthetic payslips using backend/scripts/verify-payslip-layout.cjs. Inspected all four PNG pages from the two generated PDFs; monetary columns, continuation headers, totals, notes/signatures and footers are intact. Text extraction confirms all 32 allowances in the long case and totals in both. The standard document intentionally retains the existing two-page flow with notes/signatures on page two. This verifies generated PDF output for those fixtures, not the separate bilingual browser print layout.
- No remaining P0/P1/P2 visual defect identified in these captured salary advance states. Browser print pagination and native date/time popup verification remain open. Full Phase 5 is not complete; continue allowance/deduction types and employee allocations.

## Phase 5 — Payslips and salary payments (17 September 2026)

final result: on-screen review passed; print/PDF output verification remains open

- Visual truth: compared the selected reference with 1487×1058 desktop captures. Salary payments uses the live empty collection; populated payslip list/document and reversal captures use synthetic fixtures exported from the actual React tests, styled with the compiled application CSS and existing OS shell. The fixture server has no business API or mutation behaviour. It is visual evidence only; isolated workflow tests separately verify interactions.
- Hierarchy/assets: reused the existing wallpaper, crest, app icons, dock, Inter/system typography, surface tokens and list/inspector pattern. The individual bilingual payslip remains a white document surface with its own financial layout inside the OS. No new artwork, invented live records or substitute payroll rules were introduced.
- Findings corrected (P2): phone identity columns remained side by side due to style specificity; the revised rule stacks them. Employer contribution amounts split across lines; monetary cells now retain complete amounts. Run totals occupied too much phone height; a compact two-column summary brings View payslip into view. Revised captures confirm the corrections. Initial fixture shell wrapping and missing optimized-image routing were fixture-only problems corrected before final captures.
- Responsive evidence: run-payslips-fixture-mobile.png, payslip-fixture-mobile.png, payslip-fixture-mobile-detail.png, salary-payment-form-mobile.png and salary-reversal-fixture-mobile.png use 390×844 CSS pixels (843px image height). Document width equals 390. Long statutory tables have a labelled, keyboard-focusable horizontal scroll region inside the page; monetary totals and the primary action remain reachable.
- Desktop/appearance evidence: salary-payments-desktop.png, run-payslips-fixture-desktop.png and payslip-fixture-desktop.png at 1487×1058. salary-payments-dark.png records the alternate appearance; Reduced motion produced a computed filter transition of 0s. Light/Follow device restored.
- Interaction evidence: live payment reference draft survives Stay and is removed by Discard; scoped search/filters succeed; unavailable individual/run payslip routes expose recoverable errors. Twelve frontend and four backend tests cover content, permissions, pagination, whole-run aggregates, keyed request cancellation, dependency resets, failed/successful saves/reversals and existing print/PDF invocation contracts. No real payment, reversal or payroll calculation was performed.
- Open verification: browser print pagination and the contents of a generated PDF have not been visually inspected. The print CSS and controls must not be treated as verified physical output from on-screen screenshots or mocked invocations. The native date/time popup host limitation is unchanged. Full Phase 5 remains active.

## Phase 5 — Payroll runs and entries (17 September 2026)

final result: passed for the reviewed states

- Visual truth: opened selected-reference.png with payroll-runs-desktop.png and payroll-entries-desktop.png at 1487×1058. Reused the approved OS window, sidebar, crest, wallpaper and dock; payroll content and empty live collections intentionally differ from the populated Approvals reference. No sample business records were created for screenshots.
- Typography/layout: existing Inter/system type, clear headings and quiet metadata; list/inspector fills the available desktop workspace. Grouped creation fields and entry filters stack on phones. Existing theme tokens support light and dark surfaces; no new assets or fonts were introduced.
- Finding corrected (P2): the selected period label truncated company context on phones. Added a separate company line and reviewed the revised payroll-run-form-mobile.png; company identity and both footer actions are visible.
- Responsive evidence: payroll-run-form-mobile.png and payroll-entries-mobile.png at 390×844 CSS pixels (843px image height); document width 390. payroll-entries-dark.png records the dark review. Reduced motion produced a 0s filter transition. Light/Follow device and normal viewport restored.
- Interaction evidence: creation draft Stay/Discard, real period/company choices, dependent-filter reset, scoped live search and clean reload with no console errors. Populated inspectors, permission gates, paging, failed/successful actions, dual sign-off, company-scoped accounts and file-generation retry use isolated API tests. Live collections are empty; no real payroll writes or file generation occurred. Downloaded CSV contents were not verified.
- No remaining P0/P1/P2 visual issue identified in the captured states. This result covers these two routes only; the full Phase 5 rollout remains active. The previously recorded native date/time popup host gap is unchanged. Exact test/build evidence is in docs/design/itemba-os/phase-5-rollout.md.

## Phase 5 — Payroll periods (17 September 2026)

final result: passed

- Visual truth: opened selected-reference.png and revised payroll-periods-desktop.png together at 1487×1058. Both show a populated list with selected inspector. Payroll-specific dates, filters and actions intentionally replace Approvals content. Full-size captures were sufficient to read labels and review hierarchy without crops.
- Typography and layout: retained Inter/system type, section headings, metadata and available-height list/inspector. Identity and pay-cycle form groups collapse from two columns to one on phones. Inspector actions remain within the desktop window and precede details on mobile.
- Colors and assets: approved crest, wallpaper, dock and app icons reused. No new imagery or placeholders. Existing surface, border and text tokens support both themes. payroll-periods-dark.png shows the dark review; Reduced motion gave a computed 0s filter transition. Light and Follow device restored.
- Findings corrected: two similarly prominent blue inspector actions competed (P2); approval now uses a quiet action below View runs. Revised desktop/mobile captures confirm the hierarchy. Live content review caught UTC formatting shifting existing locally seeded dates back one day; restored the previous local display and verified September's dates without altering records.
- Responsive evidence: payroll-periods-mobile.png and payroll-period-form-mobile.png at 390×844 CSS pixels (843px image height), document width 390. Form fields stack, longer content scrolls, and footer actions remain reachable. No remaining P0/P1/P2 visual issue identified in reviewed states.
- Interaction evidence: real populated inspector, search reduced nine rows to one, approval confirmation cancelled, creation draft Stay/Discard, real company choices and backend restart recovery through Try again. Clean reload produced no console errors; normal viewport restored. All real payroll records remained unchanged. Isolated tests cover permission gates, server pagination/filtering, creation failure/retry, invalid date order and approval failure/retry. Native date popup remains unverified in this host.
- Scope: Payroll periods only. Runs, entries, payslips, salary payments and the full Phase 5 inventory remain pending. Exact tests/build evidence is in phase-5-rollout.md.

## Phase 5 — Leave management (17 September 2026)

final result: passed

This result covers the reviewed Leave screens, not the complete ERP rollout.

- Visual truth: opened selected-reference.png alongside leave-requests-desktop.png and leave-balances-desktop.png at matching 1487×1058 dimensions. The earlier paired leave-types-desktop.png review covers populated list/inspector state. The source depicts Approvals; Leave content, filters and empty datasets are intentional functional differences. No sample records were written to imitate the source.
- Typography: existing Inter/system stack, strong headings, quiet metadata, readable form labels and section titles. Full desktop and phone captures were readable without additional crops.
- Layout/spacing: retained OS window, navigation, wallpaper and dock composition. Lists fill available height; forms group person/policy, dates and amounts. Single-column phone forms keep footer actions reachable and scroll longer content internally. leave-request-form-mobile.png and leave-allocation-mobile.png use 390×844 CSS pixels with image height rounded to 843; document width is 390. Leave type inspector and edit form were also reviewed at phone width.
- Colors/tokens: quiet white surfaces, blue actions and existing theme borders. leave-balances-dark.png and leave-allocation-dark.png cover dark appearance with Reduced motion selected. Light and Follow device restored afterward.
- Images/assets: reused the approved crest, generated wallpaper, dock and app icon assets. No new artwork, placeholder imagery or approximated assets introduced.
- Copy/content: real employee/type selectors and server-backed totals; page-limited summaries say so. Draft versus submit, separate line/Group HR approval, allocation totals and unchanged recorded usage are explicit. Forms retain failed input and named actions show failures.
- Interaction evidence: leave type edit Stay/Discard, request and allocation drafts retain choices/notes/amounts on Stay, then discard cleanly. Scoped search/filter requests succeeded against the rebuilt backend. Empty requests/balances and real leave types were reviewed live; populated approval/allocation outcomes use isolated API fixtures. No real HR changes were submitted. Final browser console contained no errors.
- Findings: no actionable P0/P1/P2 visual mismatch identified in these states. No visual correction was required during this comparison. The native date-time popup host limitation from the previous increment remains a separate verification gap; no claim is made that it was fixed. Full Phase 5 and payroll remain pending. Tests/build evidence is in phase-5-rollout.md.

## Phase 5 — Contracts, assignments and attendance (17 September 2026)

final result: passed

This result covers the rendered states below. Full Phase 5 remains active; the native attendance date-time popup has a preview-host verification gap.

- Source visual truth: `docs/design/itemba-os/selected-reference.png`, 1487×1058 pixels. Opened in the same comparison inputs as `contracts-desktop.png`, `assignments-desktop.png` and `attendance-desktop.png` in that directory. Desktop captures use 1487×1058 CSS pixels and matching image dimensions, with no density rescaling. The source depicts populated Approvals; these are intentionally different People workspaces with real empty datasets. Empty panels, filters and forms are functional extensions, not substituted example records.
- Typography: existing Inter/system stack, strong page and section headings, quieter metadata and readable labels. Long names remain within native selectors. No new font or decorative type was introduced.
- Spacing/layout: the approved OS window, navigation and dock remain aligned. The list/detail composition fills the available workspace; forms group identity, dates and terms/time. Desktop forms use two columns and phone forms collapse to one. Full-view desktop comparisons and separate full-size form captures were sufficient to read labels and judge spacing, so additional crops were unnecessary.
- Colors/tokens: retained ivory wallpaper, white surfaces, quiet borders and blue actions. `assignments-dark.png` and `attendance-form-dark.png` show dark text/surface hierarchy. Reduced motion produced a computed 0s filter-button transition. Light appearance and Follow device were restored.
- Images/assets: reused the existing crest, wallpaper, dock and app icon assets; no new generated artwork, placeholder imagery or asset approximations were added. Wallpaper crop and asset proportions remain consistent with the reviewed shell.
- Copy/content: fields correspond to real APIs, permissions and statuses. Contract currency is retained. Assignment copy explains transfer approval. Attendance specifies local times and overnight date entry. API failures stay visible, and consequential confirmations name the record/person. Source business copy is intentionally replaced by each workspace's actual task.
- Responsive evidence: `contract-form-mobile.png`, `assignment-form-mobile.png` and `attendance-form-mobile.png` at 390×844 CSS pixels (image output rounds height to 843). Each has document width 390, stacked controls and reachable Cancel/Save actions. Native attendance date-time fields are 304px wide, within the phone form.
- Interaction evidence: contract/assignment draft Stay/Discard; selected employee retained while assignment destination changes; organisation choices loaded; first-open modal focus; attendance notes and a keyboard-entered timestamp persisted through a rerender and Stay. Drafts discarded, search cleared and normal viewport restored. All three live collections are empty. Populated pagination/inspectors and mutation success/failure use isolated API tests; no real HR records were written.
- Browser limitation: automated fill did not retain native date/time values. Segmented keyboard entry did retain them. Opening the native date-time picker crashed the in-app preview tab; a fresh tab recovered with no console errors and successful live backend search. Popup interaction is not certified by this report. This is recorded as a verification gap, not evidence that popup behaviour works in other browsers.
- Findings/history: no actionable P0/P1/P2 visual mismatch was found in the compared states, and no visual fixes were needed during this comparison. Timestamp clearing, timestamp precision and transfer-destination behaviour were implemented and checked through workflow tests rather than claimed as screenshot evidence. Build/test scope is recorded in `docs/design/itemba-os/phase-5-rollout.md`.
- Remaining work: verify the native picker in a supported browser host, then continue leave, payroll and the remaining module inventory. This visual pass does not certify those pages or the complete OS rollout.

## Phase 5 — Positions and employee journey increment (17 September 2026)

final result: passed for the reviewed increment; full Phase 5 remains active.

- Grounding: opened `selected-reference.png` together with `positions-desktop.png`, `employees-desktop.png` and, in a separate paired comparison, `employee-profile-desktop.png`. Each desktop artifact uses 1487×1058. The reference is the approved Approvals direction; employee-specific cards, section navigation, filters and real fields intentionally differ. This is an extension of the approved OS language, not identical business content.
- Typography and rhythm: existing Inter/system stack, strong record names, quiet metadata, clear form section headings and separated detail rows. Profile, statutory and bank forms use two columns on wide screens and one column on phones. List/inspector actions remain within the workspace; phone actions precede record facts. Full-view and phone captures were readable enough to review labels, controls and spacing without extra crops.
- Color and assets: existing ivory wallpaper, crest, dock and icon assets reused. Surfaces, borders and text use the existing theme. Profile entry actions for deletion/termination were too prominent (P2); changed them to quiet actions while preserving explicit danger confirmations. Revised desktop/mobile captures show the correction. Dark profile capture and a computed 0s tab transition in Reduced mode confirm the reviewed alternate appearance and motion state.
- Content and behavior: real API values replace placeholders; six employee sections now read scoped collections. Loading and access failures are explicit. An account-link lookup restriction incorrectly disabled successful department/position choices (P2); independent chooser failures and retry now preserve usable choices and input. The final mobile form captures show that restriction truthfully. No fabricated records or new decorative images were introduced.
- Responsive evidence: employee directory inspector, creation, profile, profile editor and bank editor captured at 390×844 CSS pixels. Document width equals the viewport, long content scrolls within the OS window/modal, and the footer remains reachable. Original viewport, Light appearance and Follow device motion restored afterward.
- Interaction checks: keyboard tabs, first-open modal focus, profile/creation Stay and Discard, optional disclosure expansion, all six live related sections and clean navigation. The inspected related collections are empty, so populated contract/pagination and mutation outcomes use isolated mocks. No business records, account links, employment actions or financial transactions were submitted.
- No remaining P0/P1/P2 issue was identified in the reviewed states. Other People and ERP workflows remain pending; this pass cannot certify them. Exact tests/build coverage and evidence paths are recorded in `docs/design/itemba-os/phase-5-rollout.md`.

## Phase 5 — Business Settings and Departments increment (17 September 2026)

final result: passed for the reviewed increment; full Phase 5 remains active.

- Reference: `docs/design/itemba-os/selected-reference.png`, paired with Company identity and the revised Departments screenshot at 1487×1058. Shared shell, ivory/white surfaces, blue selection, restrained type and dock follow the approved direction. Forms retain their real legal/organisation fields; the document preview and department summary/search controls intentionally differ from the Approvals reference.
- Desktop findings: inspector actions extended below the workspace (P2); changed these list pages to use available flex height. Revised Departments bounds end at 881.6px, inside the workspace bottom at 906.6px. Delete is a quiet secondary action until its confirmation. No remaining P0/P1/P2 was identified in these reviewed states.
- Mobile: number inspector, company identity, department inspector and new-department form reviewed at 390×844. Document width equals 390; controls and modal footer remain reachable, fields stack into one column. `department-form-mobile.png` demonstrates the complete form and footer.
- Behavior: real data, permissions, server pagination/search, draft preservation, explicit retry and failures covered by focused tests and live non-mutating flows. First-open dialog focus issue (P2) fixed and verified with Tab/Shift+Tab/Escape plus live focus inspection. Nested confirmations still retain keyboard ownership.
- Dark/reduced motion: Departments reviewed with explicit Reduced motion, then restored Light and Follow device. Existing crest, wallpaper and icon assets reused. No new raster assets or fake business records were introduced.
- Evidence and exact test/build scope are recorded in `docs/design/itemba-os/phase-5-rollout.md`. These checks do not certify the other pending module families.

## Phase 5 — Settings reference increment (17 September 2026)

final result: passed

This result covers the Settings hub/dock reference and reviewed shared controls. The full Phase 5 rollout remains active. The 215-page inventory and pending work are tracked in `docs/design/itemba-os/phase-5-rollout.md`.

- Source: `docs/design/itemba-os/selected-reference.png` (1487×1058). The source depicts Approvals, so the comparison evaluates the shared shell, type, whitespace, surfaces, selection and dock. Settings-specific categories and controls intentionally differ; this is not a claim of identical business content.
- Implementation: `/settings`, signed-in account. `settings-desktop.png` uses 1487×1058 CSS pixels; source and capture were displayed together in the same comparison input at matching desktop dimensions. `settings-mobile.png` is 390×844. The normal viewport was restored afterward.
- Findings and fixes: desktop text was too small (P2); primary labels now use 15px and secondary controls 14px at wide breakpoints. Selected dark controls had insufficient visual contrast (P2); these now use the theme text accent. Revised desktop comparison and `settings-dark.png` show both corrections. No remaining P0/P1/P2 issue was identified in these reviewed states.
- Typography/layout: existing Inter/system stack, medium labels, sentence case, wrapped descriptions, grouped rows, 12px surfaces and category navigation. Mobile categories scroll within their own strip; document width is exactly 390px. Settings content scrolls independently of the OS dock.
- Colors/assets: existing ivory wallpaper, brand crest and Lucide UI icons, white surfaces, blue selection and theme-aware dark surfaces. No synthetic records or new decorative assets. Full-view comparisons were sufficient to assess composition and controls; additional crops were not required.
- Behavior: searchable real catalog, permission-filtered categories/links, scope filters, inert planned entries, account/preferences links, immediate appearance/motion/startup controls and confirmation before restoring defaults. The live reset was cancelled. Failure/retry and successful/failed saves use isolated API mocks.
- Keyboard: confirmation focuses Cancel; Escape dismisses only that confirmation. Settings restores focus to its trigger; category selection focuses its heading. Unsaved account-preference edits survive a failed save and navigation Stay.
- Checks: 73 targeted regression tests across 19 files plus one additional preference-form test passed. Targeted lint and production build passed. Clean browser reload produced no new console errors; two earlier dependency-array warnings occurred during hot replacement of the edited hook and did not recur after reload.

Checklist: Settings page/dock unified; personal controls synchronized; permissions/search/retry checked; preference draft protection added; desktop/mobile/dark reviewed. Company profile, number sequences and the remaining modules are still pending.

## Core workspace extension — 17 September 2026

Phases 1–4 result: passed within the scope recorded in `docs/design/itemba-os/phase-plan.md`. The OS foundation, core workspace rollout, workspace continuity, app registry and local Fuel Grid connection have been implemented and verified.

- Final regression: 65 frontend tests across 17 files, three backend search tests, targeted ESLint and the production frontend build passed, including TypeScript and 200 generated static pages.
- Workspace guards: verified Stay/Discard, modal dismissal, internal navigation, repeated Back/Forward and retained drafts during app switching. Successful/failed saves use isolated API mocks. A live reload attempt retained edited input; native browser confirmation chrome was not visible to automation. Browser-dependent unload behavior also has event-level coverage.
- App registry: future-app tests cover library, pin, dock, permission and shared launch behavior. Desktop evidence is `docs/design/itemba-os/apps-registered.png`; mobile evidence is `apps-registered-mobile.png` at 390×844 with no horizontal document overflow.
- Fuel Grid: actual local application sign-in reached its command center. Stopping/restarting its API verified Unavailable → Available recovery. `docs/design/itemba-os/fuel-grid-connected.png` shows reachable launch/status/retry controls at 1280×720. ITEMBA backend health, Fuel Grid readiness and Fuel Grid login each returned HTTP 200 in the final check. Its authentication remains independent and this is not a production deployment.

- Compared the selected reference and the live Companies workspace together at 1487×1058 CSS pixels, 1× density. The reference depicts Approvals, so this comparison evaluates the shared OS composition, typography, palette, sidebar and inspector pattern; the business fields intentionally differ.
- Initial findings: excessive vertical spacing above records at 1280×720; small record typography on wide screens; inspector details expanded the page and hid primary actions. These were P2 usability issues.
- Fixes: compact summary/toolbar spacing, 15px record titles at wide breakpoints, a 340px inspector, independently scrolling list/detail fields, persistent desktop actions and actions before detail fields on mobile.
- Revised evidence: `docs/design/itemba-os/companies-desktop.png` and `companies-mobile.png`. The final paired desktop review shows readable record hierarchy, restrained selection, and visible Open/Archive actions. The mobile 390×844 review shows one-pane navigation, working Back to list, visible primary actions and a document width of exactly 390px.
- Additional live checks: Finance overview, Sales/Purchase form open/cancel, AR/AP/Expense form open/cancel, search/filter controls, real company selection. No records or financial operations were submitted. The financial lists are empty in the current database; isolated tests cover populated rows, confirmation cancellation and permission filtering.
- Supporting checks: frontend and backend builds passed; 34 frontend tests and three scoped backend-search tests passed. Browser console was empty of errors in the reviewed session. The backend is running the new build and health returned 200.

The earlier desktop-foundation review follows below. Its counts and connection status describe that earlier milestone; the current completion evidence is above.

final result: passed

## Target and evidence

- Source: `docs/design/itemba-os/selected-reference.png` (1487 × 1058 pixels).
- Live implementation: `http://localhost:3009/approvals/pending`.
- First comparison: `docs/design/itemba-os/approvals-first.png`.
- Revised comparison: `docs/design/itemba-os/approvals-desktop.png`.
- Additional captures: `desktop-mobile.png`, `login.png`, and `desktop.png` in the same directory.
- Reference comparison viewport: 1487 × 1058 CSS pixels, approximately 1× device pixel ratio; light theme. The source and implementation were displayed together in the same comparison input, then compared again after corrections.
- Additional browser checks: 1280 × 720 desktop; 390 × 844 mobile; dark appearance; search; navigation drawer; maximize/restore; desktop and Fuel Grid switching.

## Comparison history

1. **P1 — initial desktop typography and region proportions were too small.** The first implementation used a 220px sidebar, 300px inspector and compact labels. Corrected the comfortable desktop layout to a 260px sidebar, 380px inspector, larger navigation and heading type, a 460px dock, and the reference's window margins. The revised capture confirms the intended hierarchy and composition.
2. **P2 — collapsed mobile navigation remained in the accessibility tree.** Added visibility rules so the closed drawer is hidden visually and from keyboard/screen-reader navigation. Verified the mobile drawer can open and close, while the dock and main content remain reachable. The document width equals the 390px viewport.
3. **P2 — the legacy auth surface overrode the sign-in wallpaper.** Scoped the OS login background above the legacy fixed-light rule. Re-captured the login screen and confirmed the intended ivory wallpaper and light sign-in panel.

No outstanding P0/P1/P2 visual issues were found in the final reviewed states. Production build and tests are supporting functional evidence, not substitutes for the visual comparisons.

## Required fidelity surfaces

- **Typography:** Inter with system fallbacks, restrained medium weights, larger desktop headings and readable navigation. Heading hierarchy, wrapping and labels were checked in the rendered views. Compact density is retained on shorter screens.
- **Spacing/layout:** focused app window, subtle title bar, three-pane approval workspace, quiet sidebar, centered dock. Small screens use a collapsible navigation drawer and a single-pane detail view. No horizontal document overflow at the tested mobile width.
- **Color/tokens:** warm ivory wallpaper, pearl/white surfaces, restrained blue selection and primary actions. Dark appearance uses separate readable surface/text tokens. Cards and table headers inherit the OS treatment through scoped selectors.
- **Assets:** original Itemba brand image used for the crest; generated ivory wallpaper used as a real image asset; Lucide/library icons remain vector UI controls. No rasterized interface. The wallpaper has different waves from the concept, intentionally preserving its visual direction rather than presenting the concept as production UI.
- **Copy/content:** actual account data and service status replace sample records. No mock payment, attachment, company filter, unread badge, or request count was introduced. The live account has zero pending approvals, so the reviewed production state is the honest empty inbox.

Full-size paired images made the typography, logo, navigation and dock details readable; additional crops were not required to assess those surfaces.

## Accepted product differences

- The concept contains eight fictional pending requests. The live inbox is empty. Populated selection, detail loading, confirmation, own-request restrictions and API failures were verified with isolated component tests, not real financial decisions.
- “All requests” opens the existing request history/filter workflow instead of claiming a completed-only view. “Requested by” uses the API's actual requester data. Attachments are not fabricated.
- “All modules” preserves access to the complete ERP navigation tree and inherited permissions. The group/company scope indicator is informational; it does not pretend to apply a global filter.
- ERP navigation remains URL-based. Desktop/Fuel Grid switching retains the mounted ERP page and unsaved local state. This is a browser workspace; it does not claim native operating-system window management.
- At this earlier foundation milestone, Fuel Grid was not configured. Phase 4 subsequently connected and verified the actual local service, as recorded above. Fuel Grid remains an independent application available to permitted users.

## Functional checks

- Production Next.js build: passed, including TypeScript and generation of 200 static pages.
- Focused tests: 20 passed across five files. Includes permission filtering, search, pins, retained ERP draft during app switching, own-request action restrictions, confirmation before approval, failure/retry states, and POS-only offline authentication regression coverage.
- Targeted ESLint and TypeScript checks: passed.
- Browser: live overview and company records load; universal search opens Companies; a company search survives Fuel Grid switching; maximize changes to restore; mobile launcher fits the viewport; light appearance applies; sign-in renders with existing form behavior.
- No financial approval was submitted during browser verification.

## Implementation checklist

- [x] OS shell and desktop launcher
- [x] ERP navigation and complete module directory
- [x] Window minimize/restore/maximize and app switching
- [x] Appearance preferences and responsive layout
- [x] Live approval inbox with detail/actions and safeguards
- [x] Shared ERP surface styling and sign-in branding
- [x] Build, targeted tests and browser visual comparison
