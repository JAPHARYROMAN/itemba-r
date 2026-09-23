# Phase 5 contribution — Grok 4.7

Author: **Grok 4.7** (xAI), working in Cursor on 22–23 September 2026.

This note is for the next person who picks up ITEMBA OS phase 5. The route-by-route record is [phase-5-rollout.md](phase-5-rollout.md). This file explains the bar that was applied, what was finished, what was deliberately left alone, and how to continue without undoing the work.

## What this contribution is

The phase 5 inventory of dashboard route families was closed at a **code bar**. A family is closed at that bar when each of its listed routes:

- keeps only the latest read, using `useRequestGuard` in `frontend/src/hooks/use-request-guard.ts`, or an existing abort that actually ignores a stale result (`AbortController`, or `useWorkspaceRecords` / `useWorkspaceResource` / `useWorkspaceChoices`);
- shows a retry after a failed **load** — the button is **Try again** from `@/components/ui` `ErrorState`, or **Try Again** from the aurora `ErrorState` when `onRetry` is set;
- refuses the read until the view permission that already exists on the sidebar leaf or, when the route is not in the sidebar, on the backend `@RequirePermissions` / `@RequireAnyPermissions` decorator;
- does not flash “Access Restricted” while `useAuth().loading` is true;
- does not turn a form-validation message into a list retry.

Action permissions (create, update, delete, approve, post, pay, and the rest) were left on the checks the pages already had. Permission names were not invented. Large pages were not split. Routes that already met the bar were not rewritten.

Live signed-in browser review was **not** done. No signed-in session was available. Each dated section in the rollout doc says that review is still open. Frontend checks were `npx vitest run --maxWorkers=2` on the family’s acceptance test (quote paths that contain parentheses in PowerShell) and `npm run typecheck` from `frontend/`.

## Earlier work in the same pass, already checkpointed

These are local `wip/` branches. They are not merged onto `signing-approver-checkset`.

| Branch | Commit | What it holds |
| --- | --- | --- |
| `wip/date-rollout-phase5` | `2c679c08` | Shared date field through the remaining native date inputs, including minute granularity for the nine `datetime-local` sites. Phases 1–4 sit on the earlier `wip/date-rollout-phase*` branches. |
| `wip/print-pagination` | `e7bcf723` | Page-budget splits for payslip and CCM notice prints. |
| `wip/print-docshell` | `b16b4891` | Page-budget splits for DocumentShell line-item prints (proforma, delivery note, sales order, purchase order, supplier draft). |
| `wip/pending-claim` | `fae726b8` | Editors that claimed `pending.current` only after an await, so a second click could start a second write. |

`HEAD` of `signing-approver-checkset` stayed at `55709aabfadb60f43cd83f9d8c6bd3e46e3877f1`. Do not move it to merge these branches unless someone asks. A checkpoint, if one is made later, must be `git add -A`, `git write-tree`, `git commit-tree`, then `git branch`. Do not chain `commit-tree` and `git branch` in one PowerShell line (Windows reports “filename or extension is too long”). If a checkpoint moves `HEAD`, recover with a mixed `git reset` back to `55709aab`, never `--hard`.

The route-family work below is in the working tree and is **not** on those `wip/` branches.

## Route families closed at the code bar

Dated sections and the inventory table in [phase-5-rollout.md](phase-5-rollout.md) name the permission used on each family. The acceptance test next to the routes is the evidence.

Closed in this pass, in the order they were taken:

- Operations: the remaining 13 routes (hub, profit, reports, supplier 360, sales orders, purchase orders, supplier drafts, including print routes). Twelve operations routes had already been reviewed before this pass.
- Westsides: 23 routes. `WestsidesGate` lives in `frontend/src/app/(dashboard)/westsides/_components/route-gate.tsx`.
- Accounting engine: 10. Control registers and bank reconciliations already retried and gated; they were left as they were, including the labels “Retry register” and “Retry companies”.
- Alerts, API gateway, apps, audit logs, automation, background jobs.
- Apps and fuel grid: the shared `AppLauncher` already aborts the status check, gates with `canOpenApp`, and retries with **Check again**. That label is locked by `fuel-grid-launcher.test.tsx`. Do not rename it to “Try again”.
- Backups, companies, compliance (19), CRM (5), home dashboard, data isolation (3), document templates (4).
- Finance (15), fuel grid (1), group control (10), integrations (10).
- Inventory (2), mobile POS (2), Msaidizi (1), notifications (1), procurement (5), record book (8), reports (3), roles (1), sales commissions (1), security (6).
- Tasks (1) and users (1), on 23 September 2026.

The inventory table has no remaining `Pending` family. HR (31), approvals (5), and settings (4) were already reviewed before this pass. This note does not claim a new signed-in review of those three.

## Decisions a later contributor needs

- Sidebar leaf permission wins when the route is in `frontend/src/components/layout/sidebar.tsx`. If the leaf has no permission, use the backend decorator. Home dashboard uses the `RequireAnyPermissions` list on `GET executive-summary`. The reports catalog (`/reports`) is authenticated-only; a signed-in user is not shown Access Restricted, and the catalog is not fetched before a user exists.
- Two permission strings both exist for security policies: the API uses `security.policies.view`, the sidebar leaf uses `security_policies.view`. The policies page opens when the user has either. Manage stays `security.policies.manage`.
- Two-factor has no `.view` permission. The page stays closed until `two_factor.manage`.
- `/reports/library` is not in the three-route reports inventory. It was not changed.
- Inventory `/inventory` already restricted the workspace and retried section reads. `/inventory/products/[id]` re-exports the operations product profile. Those implementations were left in place.
- Record-book pages are thin wrappers. The guards live in `record-book-client.tsx`, `record-book-detail-client.tsx`, `record-book-reports-client.tsx`, and `record-book-trash-client.tsx`. `useDocumentLetterhead` takes an optional `enabled` flag so a hidden report does not fetch letterhead. Existing callers keep the default `true`.
- Mobile POS bootstrap takes `enabled`. Catalog and session reads wait for `mobile_pos_lite.use`. Activation validation stays a form message.
- Print routes that were in scope keep totals on page 1 and continue when `overflowLines.length > 0`. Budgets live in `frontend/src/components/documents/document-line-budget.ts`.
- Do not wrap `FormDateField` in a `<label>`.

## How to continue

1. Live signed-in review of every family whose rollout row says that review is still open. Exercise the load, a forced failure and **Try again**, a role without the view permission, and the action buttons that should stay hidden.
2. Browser-print pagination and the native date/time popup are still open even on reviewed routes, including HR payslips.
3. Do not treat a green acceptance test as a signed-in review. The tests mock `useAuth` and `fetch` / the API client. They prove the gate and the retry. They do not prove layout, keyboard, or real data.
4. New routes should copy the nearest `*-acceptance.test.tsx` (for example `frontend/src/app/(dashboard)/users/users-acceptance.test.tsx`): no permission means no request and the restricted text; with the view permission, a rejected read shows **Try again** and a second attempt. Keep the mock rejected. Resolving a retry to `{}` can crash a page that expects nested fields.
5. Put hooks above any `if (authLoading || !canView) return`. A loading flag that starts `true`, combined with a spinner checked before the permission gate, spins forever when the load returns early.
