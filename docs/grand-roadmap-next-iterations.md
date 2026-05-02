# ITEMBA-R — Grand Roadmap for Next Iterations

## Purpose

This roadmap converts the current broad ITEMBA-R implementation into a staged plan for production hardening, operational depth, user adoption, and long-term scale. The key principle is to stabilize the core governance and financial platform before adding more surface area.

## Guiding priorities

1. Protect company isolation and group-control data before expanding workflows.
2. Make production deployment repeatable and testable.
3. Deepen the most valuable business flows before polishing secondary modules.
4. Move from scaffolded coverage to verified, role-tested workflows.
5. Keep every iteration shippable, with explicit acceptance criteria.

## Iteration 1 — Production Foundation

**Goal:** make the system reliably deployable and testable in staging and production-like environments.

### Scope

- Align production environment variables with backend validation.
- Verify Docker build contexts include the shared Prisma schema and generated client.
- Standardize backend API base URLs for frontend server routes and browser routes.
- Add a single documented deployment path for local, staging, and production.
- Ensure Prisma validate, generate, migrate deploy, backend build, and frontend build run in one repeatable command or CI workflow.
- Remove empty placeholder files and document which generated folders should not be committed.

### Acceptance criteria

- Fresh clone can build backend, frontend, and Prisma client without manual file copying.
- Production compose boots with backend, frontend, Postgres, and Redis healthy.
- Login, refresh, logout, and `/api/backend/*` proxy work in production-like Docker networking.
- CI or equivalent script fails on build, schema, migration, or test errors.

## Iteration 2 — Security and Tenant Isolation Hardening

**Goal:** make access control consistent across all company-owned and group-controlled records.

Implementation notes for the current hardening pattern are tracked in
[`security-tenant-isolation-hardening.md`](security-tenant-isolation-hardening.md).

### Scope

- Introduce a shared company-scope policy for list, detail, create, update, delete, and report queries.
- Audit all services that accept `companyId` from query/body and confirm the user may access that company.
- Standardize group-level versus company-level access behavior.
- Add tests for cross-company read/write denial.
- Add CSRF protection for cookie-authenticated mutation routes.
- Define high-risk modules that require recent-auth or 2FA: bank accounts, API keys, payroll, security policies, user roles, production config.

### Acceptance criteria

- A company-scoped user cannot access another company's records by changing `companyId` or record ID.
- Group-control records require explicit group-scope permission and are audited on sensitive reads/writes.
- Mutation routes using cookies are CSRF-protected.
- Auth, permissions, and company isolation e2e tests run in CI.

## Iteration 3 — Financial Control Depth

**Goal:** make finance the operational source of truth, not just a record registry.

Implementation notes for the current accounting-control pattern are tracked in
[`financial-control-hardening.md`](financial-control-hardening.md).

### Scope

- Validate chart of accounts setup per company.
- Harden journal posting, reversal, approval, and period locking.
- Complete bank reconciliation workflow with audit history.
- Define posting rules from petroleum, sales, procurement, payroll, rent, and expenses into journals.
- Add financial statement generation checks: trial balance, profit and loss, balance sheet, cash movement.
- Add test fixtures for multi-company accounting and intercompany transactions.

### Acceptance criteria

- Posted transactions cannot be edited without reversal/audit adjustment.
- Closed periods reject new postings except through approved adjustment flow.
- Reports reconcile to journal entries for seeded test cases.
- Finance e2e tests cover create, approve, post, reverse, close period, and report.

## Iteration 4 — Company Operations Workflows

**Goal:** deepen the highest-value operational flows for each company.

Implementation notes for the current petroleum workflow-control pattern are tracked in
[`company-operations-workflow-hardening.md`](company-operations-workflow-hardening.md).

### Scope

- Mwanjalisi Oil: shift open/close, nozzle readings, tank dips, fuel delivery, collections, variance, credit sale settlement.
- Westsides: quotation to sale, purchase to stock, batch/expiry, damage/returns, customer credit.
- Itemba Logistics: trip creation, dispatch, fuel usage, expenses, maintenance, profitability.
- Itemba Agriculture: season planning, input application, labor/equipment usage, harvest, crop profitability.
- Itemba Construction: BOQ, material issue, subcontractor progress, billing, project profitability.

### Acceptance criteria

- Each company has at least two complete end-to-end workflows tested with realistic data.
- Operational transactions generate audit logs and, where applicable, accounting entries.
- Dashboards reflect real transactional data instead of static or partial summaries.

## Iteration 5 — UX Consolidation and Operator Efficiency

**Goal:** make the web app efficient for daily use by finance, operations, HR, and group-control users.

Implementation notes for the current frontend API and shared state pattern are tracked in
[`ux-consolidation-operator-efficiency.md`](ux-consolidation-operator-efficiency.md).

### Scope

- Standardize list/detail/create/edit patterns across all modules.
- Replace inconsistent manual response parsing with one frontend API convention.
- Add role-aware empty states, disabled actions, and clear permission-denied states.
- Improve global search, breadcrumbs, company selector, filters, pagination, and saved views.
- Add bulk actions for safe admin workflows: import reference data, export lists, archive inactive records.

### Acceptance criteria

- Common table, form, modal, drawer, and status patterns are reused consistently.
- Users can complete primary workflows without manually copying IDs.
- Frontend build and smoke tests cover key dashboard pages.

## Iteration 6 — Reporting, BI, and Executive Controls

**Goal:** turn operational records into reliable management information.

Implementation notes for the current BI and data-quality control pattern are tracked in
[`reporting-bi-executive-controls.md`](reporting-bi-executive-controls.md).

### Scope

- Define KPI catalog by company and division.
- Add scheduled report runs and delivery tracking.
- Build executive dashboards for cash, sales, fuel variance, payroll cost, stock, tax obligations, overdue receivables/payables, and project profitability.
- Add data-quality checks for missing company scopes, orphan records, stale balances, negative stock, and unreconciled transactions.
- Add export governance: who exported what, when, and with which filters.

### Acceptance criteria

- Executive dashboard metrics trace back to source records.
- Scheduled report runs are auditable and retryable.
- Data-quality issues are visible, assigned, and resolvable.

## Iteration 7 — Integrations and Automation

**Goal:** connect ITEMBA-R to external systems without compromising auditability.

Implementation notes for the current webhook and integration-control pattern are tracked in
[`integrations-automation-hardening.md`](integrations-automation-hardening.md).

### Scope

- Payment providers: M-Pesa, Airtel Money, TigoPesa, bank payment imports.
- TRA/VFD or tax receipt integration path.
- Email/SMS notification configuration.
- Webhook signing, retry, replay, and dead-letter handling.
- API key lifecycle: create, rotate, revoke, scope, rate-limit.
- Business automation: recurring tasks, report delivery, alerts, escalation rules.

### Acceptance criteria

- External events are idempotent and auditable.
- Failed integrations are visible with retry/replay controls.
- API clients cannot exceed their assigned scope.

## Iteration 8 — Data Migration and Adoption

**Goal:** move real users and historical data into the system safely.

Implementation notes for the current staged import validation pattern are tracked in
[`data-migration-adoption-hardening.md`](data-migration-adoption-hardening.md).

### Scope

- CSV/XLSX import tools for customers, suppliers, products, employees, assets, opening balances, and stock.
- Validation reports before import commit.
- Training environment with realistic sample data.
- Role-based onboarding paths for group control, finance, operations, HR, and admins.
- UAT cycles with sign-off per company and division.

### Acceptance criteria

- Imports are reversible or staged before final commit.
- UAT findings are tracked to closure.
- Each role has a tested onboarding path and user guide coverage.

## Iteration 9 — Performance, Observability, and Resilience

**Goal:** make the platform observable and scalable under production load.

Implementation notes for the current observability budget and resilience-control pattern are tracked in
[`performance-observability-resilience.md`](performance-observability-resilience.md).

### Scope

- Add structured request logging, correlation IDs, and error tracing.
- Define dashboard/report query budgets.
- Cache heavy summaries and reports with explicit invalidation rules.
- Move heavy jobs to Redis/BullMQ or a proven queue when load justifies it.
- Run load tests for auth, petroleum, payroll, finance reports, and BI dashboards.
- Backup restore drills and disaster recovery time objectives.

### Acceptance criteria

- Slow endpoints are measurable and actionable.
- Restore tests prove backups are usable.
- Load tests have documented thresholds and pass/fail gates.

## Iteration 10 — Platform Expansion

**Goal:** expand only after the core platform is stable, secure, and adopted.

Implementation notes for the current platform expansion control pattern are tracked in
[`platform-expansion-hardening.md`](platform-expansion-hardening.md).

### Scope

- Swahili localization.
- Native mobile app or PWA hardening for field users.
- Offline sync conflict resolution UI.
- Biometric attendance integration.
- E-signature provider integration.
- Advanced forecasting and scenario planning.

### Acceptance criteria

- Expansion features do not bypass existing auth, audit, company-scope, and accounting controls.
- Each new capability has an owner, rollout plan, and measurable business value.

## Governance cadence

- Weekly delivery review: completed work, blockers, test status, deployment readiness.
- Biweekly UAT review with business users.
- Monthly security and data-isolation review.
- Monthly finance control review.
- Quarterly roadmap reset based on live usage, audit findings, and business priorities.

## Recommended immediate sequence

1. Execute Iteration 1 fully.
2. Execute Iteration 2 before adding new business modules.
3. Run Iterations 3 and 4 in parallel only if teams are separated by domain ownership.
4. Start Iteration 5 once the first real users complete UAT.
5. Delay Iterations 7-10 until core accounting, isolation, and operational workflows are proven.
