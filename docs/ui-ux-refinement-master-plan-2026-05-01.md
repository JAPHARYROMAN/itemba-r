# ITEMBA-R UI/UX Refinement Master Plan

Date opened: 2026-05-01

Status: active

Scope: frontend operator experience, Aurora design-system governance, dashboard clarity, data-entry speed, responsive behavior, accessibility, and UI consistency.

---

## 1. Product Position

ITEMBA-R already has a strong visual foundation. The next UX target is not a cosmetic redesign; it is an operator-efficiency programme. A top-grade ERP interface must make repeated daily work fast, predictable, recoverable, and safe.

The current system has these strengths:

- Aurora design tokens and reusable components exist.
- Dashboard and module surfaces already have a premium command-center direction.
- Dark mode, tables, feedback states, forms, timelines, and command palette primitives exist.

The current system still needs refinement in these areas:

- Consistent page actions, filters, and refresh/retry behavior.
- Consistent table/list workflows across high-traffic modules.
- Fewer page-local loading/error implementations.
- Better drill-down paths from dashboards into source records.
- Clearer next-step guidance on workflow records.
- Stronger responsive treatment for field and approval workflows.

---

## 2. Workstreams

### UX-0: Experience Audit

Create a screenshot-backed register for:

- Dashboard and command center.
- Users and roles.
- Finance journal entries.
- Petroleum fuel shifts.
- HR employees and payroll runs.
- Inventory movements and stock adjustments.
- Reports and exports.
- Approvals and audit logs.

Output:

- UX issue register with severity, owner, affected route, and acceptance criteria.
- Mobile and desktop screenshots for each high-traffic route.

### UX-1: Aurora Governance

Harden Aurora into a stricter application system:

- Standard action button.
- Standard toolbar / filter bar.
- Standard page loading, error, empty, and permission states.
- Standard form action footer.
- Standard record detail shell.
- Standard bulk action bar.

Acceptance criteria:

- New pages use Aurora primitives by default.
- High-traffic pages stop hand-rolling actions, filters, and error states.

### UX-2: Command Center Refinement

Improve executive and operator dashboards:

- Add operational focus queue.
- Add refresh and last-updated state.
- Add drill-down links for every critical number.
- Split executive, operator, and personal work-queue dashboards over time.

Acceptance criteria:

- Dashboard first screen answers: what is happening, what needs action, and where to go next.

### UX-3: High-Traffic List Modernization

Migrate list pages to shared API and table conventions:

- `users`
- `hr/employees`
- `finance/journal-entries`
- `petroleum/fuel-shifts`
- `operations/sales-orders`
- `operations/inventory-movements`

Acceptance criteria:

- Search, filters, pagination, retry, empty state, row actions, and permission handling behave consistently.

### UX-4: Workflow And Form Efficiency

Refine transaction flows:

- Sticky action footer for save/submit/approve/reject.
- Better validation summaries.
- Review step for destructive, financial, and irreversible actions.
- Drawer for quick edits; full page for complex records.

Acceptance criteria:

- Users can understand required fields, current status, allowed next actions, and consequences without leaving the page.

### UX-5: Record Detail Standard

Create a consistent detail shell:

- Header with status and primary actions.
- Key facts.
- Tabs or sections for lines, documents, audit, approvals, and related records.
- Timeline for workflow history.

Acceptance criteria:

- Record pages stop feeling like isolated module-specific layouts.

### UX-6: Responsive And Accessibility Pass

Prioritize:

- Approvals.
- Fuel shifts.
- Inventory checks.
- HR attendance.
- Dashboard alerts.

Acceptance criteria:

- Mobile users can complete field workflows without table overflow or hidden primary actions.
- Keyboard users can operate command palette, modal, drawer, forms, and major tables.

---

## 3. First Implementation Slice

This slice starts UX-1 and UX-2:

- Add `AuroraButton`.
- Add `AuroraToolbar`.
- Apply both to the main dashboard.
- Add dashboard refresh, last-updated state, and operational focus cards.
- Keep the existing visual language; improve clarity and operator control.

Verification:

- `cd frontend && npx tsc --noEmit`
- `cd frontend && npx vitest run`
- `npm run verify:frontend:local`

---

## 4. Governance Rule

From this point, UI work should be treated like backend remediation:

- Every significant UX fix gets a small acceptance criterion.
- Shared patterns are implemented once in Aurora, then adopted page by page.
- Visual polish must not reduce density, keyboard access, or operational speed.
