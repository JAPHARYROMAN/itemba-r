# ITEMBA OS visual rollout — 19 September 2026

The remaining legacy ERP lists now share OS surfaces, readable phone records, accessible row activation and consistent dialogs. Loans & Debts has a dedicated list and inspector; accounting workspaces share a responsive list/detail layout. Existing financial operations, routes and posting rules remain connected.

## Implemented

| Area | Result |
| --- | --- |
| Loans & Debts | Searchable loan/debt registers, combined filters, pagination, selected-record inspector, permission-aware actions, repayment/history links, explicit summary scope, read retry, save/delete feedback and guarded drafts. |
| Accounting | Responsive list/detail layouts in loan repayments, posting runs, period close, bank reconciliations, depreciation, financial statements and audit adjustments. |
| Repayment schedules | Compact installment list, principal/interest/fees in the inspector, separate payment-history loading/error/retry, and generation validation inside the form. |
| Journals | Labelled collapsible filters, mobile records and the shared keyboard-accessible detail drawer. |
| Legacy lists | `WorkspaceTable` adopted in 116 page files and five route components. Simple tables become labelled records on phones; complex matrices retain a focusable horizontal scroll region. A single set of controls preserves form state and existing actions. |
| Forms and feedback | Eight bespoke overlays moved to the shared dialog. Shared dialogs skip hidden controls, trap Tab, return focus, support Escape and retain scroll locking when nested. Phone fields stack, controls are larger, and errors are announced. |
| Shell | Mobile navigation focuses its links on open and returns to the trigger on Escape; the workspace skip-link target accepts focus. Theme-aware route error recovery replaces the full-screen legacy error. |

The table rollout covers accounting, finance, Group Control, compliance, CRM, operations, procurement, record book, reports, Westsides and administration. It preserves existing table data, callbacks and conditional controls. This is shared presentation coverage, not a claim that each business workflow has received a separate acceptance audit.

## Verification

- Production frontend build passed compilation, TypeScript and generation of 208 static pages. Final TypeScript check also passed after the last table fallback adjustment.
- ESLint reported no errors or warnings across the initial 136 changed files; the subsequent test-fixture and route-manifest updates also passed targeted lint.
- Forty focused tests passed for the responsive table/inspector, shared modal/toolbar, Loans & Debts, repayment schedules, financial history, installment creation, finance workspaces, shell and role editing.
- Forty additional tests passed for people, units, embedded stock adjustments and the Msaidizi launcher. Updated stale router/selector fixtures and modelled committed navigation. Keyboard fixtures start in visible content because jsdom incorrectly focuses an autofocus control inside a closed native dialog. Existing assertions for failed saves, draft protection, organisation scope, product lookup and keyboard launch remain intact.
- Route coverage checks include the OS app catalogue, Payroll navigation and Reports library link. Added the Apps dynamic-route fixture. The standalone Fuel Reporting login is intentionally outside ERP navigation. All five manifest checks pass.

### Browser evidence

| Evidence | Source and check |
| --- | --- |
| `loans-overhaul-desktop.png` | Synthetic React-test records, production CSS, 1487 × 1058. List and selected inspector. |
| `loans-overhaul-mobile.png` | Synthetic records, 390 × 844. Selected record and primary action; document width 390. |
| `schedules-overhaul-mobile-dark.png` | Synthetic installment, dark theme, 390 × 844. Principal, interest, fees and outstanding balance. |
| `journal-overhaul-mobile-live.png` | Authenticated live journal list, 390 × 844, scrolled to the existing journal. All columns remain available as labelled fields. |
| `installment-overhaul-mobile-live.png` | Authenticated live installment form, 390 × 844. Fields and action fit the dialog. Escape returned focus to Add installment. |

Live keyboard checks also covered journal-row Enter activation, drawer Escape and focus return, loan form Tab wrapping and Escape, mobile navigation and Ctrl+J/Escape. Live loan and schedule collections are empty; populated screenshots are clearly synthetic. No live financial record was saved, posted, reversed or deleted. The browser viewport was restored and the temporary preview tab/server were closed.

## Release acceptance still required

Shared visual coverage does not replace the route-by-route acceptance inventory in `phase-5-rollout.md`. Keep its reviewed-route counts unchanged until a workflow has actual evidence. Before production sign-off, complete remaining role-specific workflows with representative staging records, native date-picker checks and print pagination. Full-suite outcome is recorded in the final verification entry below; targeted passing tests alone do not establish a clean whole-project baseline.

## Final verification

- Fresh complete frontend run: **153 test files passed, 1,561 tests passed**, exit 0, 112.88 seconds (`npm test -- --maxWorkers=4`).
- Final production build: exit 0, including TypeScript and 208 generated static pages.
- Corrected fragment key prefixes in the shared table so grouped columns cannot collide with adjacent cell keys. The regression test checks for React's duplicate-key warning as well as intact labelled controls; the final full run includes this correction.
- Targeted lint and whitespace checks pass. Existing unrelated React `act(...)` warnings remain in some test fixtures; they are not test failures.
- Verification reports were saved locally under `tmp/os-full-regression-final.json` and `tmp/os-final-build.log`. This pass changes frontend presentation and regression fixtures; it does not deploy the application or certify the remaining staging acceptance items.
