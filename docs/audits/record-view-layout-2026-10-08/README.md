# Record view layout review — 8 October 2026

The stock screenshot showed an empty inspector taking up useful width, an expanded location summary above the records, and a short scrolling table. The same behavior came from two reusable layouts: `RecordBrowser` (48 consuming files) and `WorkspaceSplit` (5 consuming files, including one also using `RecordBrowser`). The source scan covered inventory, catalogue, finance, accounting, approvals, HR, payroll, reports, companies, and number sequences.

## Findings and changes

- Lists now use the full width until a record is selected. Empty inspectors are hidden from the visible interface and accessibility tree.
- Expand view uses native fullscreen without remounting records or forms. Where fullscreen is unavailable, the list expands inside the current app window. Restore view returns to the previous layout. Native Escape preserves selection; closing details returns focus to the record trigger.
- Record details can also use the whole workspace width, with a control to return to the list beside them.
- Compact rows start enabled. Lists retain every supplied field; the old two-field limit and CSS rules hiding values on narrow screens were removed. Narrow lists show labelled cards with the same data.
- Lists size to their content and allow a larger scroll area. Headers stay visible while scrolling. The inspector uses one scroll area instead of separate constrained sections for facts and actions.
- Stock by location starts collapsed. Expanded location cards adapt to their available width, including the single-location case.
- Forced blank height was removed from approvals, WCF exposure, statutory returns, employee profiles, and the accounting split view. The loan register uses the shared responsive layout.

## Checked steps

1. **Browse stock records — passed.** The list takes the available width, the location summary starts collapsed, and the desktop fixture shows eight complete rows where the old layout showed three. Pagination remains usable. [Before](01-before-desktop.png), [after](02-after-desktop.png).
2. **Expand the list and inspect a record — passed.** Expanded lists keep pagination and controls visible. Expanded details occupy the whole view; restoring the view preserves selection. [List](03-expanded-list.png), [details](04-expanded-details.png).
3. **Use a narrow workspace — passed.** Available quantity, stock value, on-hand quantity, and status remain visible. A 390-pixel viewport had no page-width overflow. Opening details focuses the inspector; Back to list restores focus to the selected record. [List](05-mobile-list.png), [details](06-mobile-details.png).
4. **Expand accounting records — passed.** A review note kept its value across expand and restore, using the same mounted input. Narrow accounting panes show details across their full width. [Accounting view](07-accounting-expanded.png).

## Validation and limits

- TypeScript checking and linting of changed TypeScript files passed.
- The final focused run passed 24 tests covering shared expansion, labelled fields, selection, pagination, keyboard focus, and live stock.
- The broader run passed 642 tests across 69 of 70 test files. Five tests in `finance-workspaces.test.tsx` failed. Running those tests with the original `RecordBrowser` reproduced the same five failures, confirming they belong to existing finance/account-view behavior and test fixtures. No finance logic was changed for this review.
- Screenshots use the real shared components with synthetic records in a local preview. The stock location markup in that preview is a fixture; the actual `InventoryLive` behavior was checked by its component tests. This is a source scan and representative component verification, not a live-data walkthrough of every route.
- Keyboard focus, labelled values, accessible controls, and hidden empty panes were checked. Screenshots and these tests do not establish complete accessibility compliance.
- The initial unrestricted parallel test run caused many timeouts. Repeating with two workers removed those timeouts; only the baseline finance failures remained.
