# ITEMBA-R

**A multi-company governance and operations platform for the Itemba Group of Companies (Tanzania).** In plain terms: one system where the group's companies keep their books, buy and sell, track stock, run tills and pay staff, with each company's records separated by company scoping in the application and the group able to see across them through explicit grants. Under the hood it combines a group → company → division → branch model with a double-entry ledger, procure-to-pay and order-to-cash workflows, perpetual inventory, point of sale, Tanzanian payroll and tax, document printing, and an optional permission-bound AI assistant. It is built for the Itemba Group's own operations; see [License](#license).

[![CI](https://github.com/JAPHARYROMAN/itemba-r/actions/workflows/ci.yml/badge.svg)](https://github.com/JAPHARYROMAN/itemba-r/actions/workflows/ci.yml)

> Legal ownership at company level · Strategic oversight at group level · Day-to-day operations at branch level.

**Contents** — [What it is](#what-it-is) · [Organisation model](#organisation-model) · [What's in the box](#whats-in-the-box) · [What is gated or groundwork](#what-is-gated-or-groundwork) · [Architecture](#architecture) · [Frontend](#frontend) · [Msaidizi](#msaidizi-ai-assistant) · [Repository layout](#repository-layout) · [Getting started](#getting-started) · [Commands](#commands) · [Adding a feature](#adding-a-feature) · [Quality gates](#quality-gates) · [Deployment](#deployment) · [Documentation](#documentation) · [History](#history) · [License](#license)

---

## What it is

ITEMBA-R is one repository that holds everything the platform needs: the server (a NestJS API over PostgreSQL), the web app (Next.js), a public marketing site, a .NET companion for the AI assistant, and the Docker/Caddy kit that deploys it all.

| | |
|---|---|
| **Backend** | about 170 NestJS feature folders (over 200 Nest modules counting the nested HR, tax and compliance ones) and more than 1,000 API endpoints, all under the `/api/v1` prefix (configurable via `API_PREFIX`) |
| **Data** | one Prisma schema of about 390 models and about 160 migrations on PostgreSQL 16 |
| **Frontend** | 240+ pages in a Next.js 16 app, with two interchangeable shells (classic dashboard and the ITEMBA OS web desktop) |
| **Status** | actively developed; several headline capabilities are built but switched off by default (see [What is gated or groundwork](#what-is-gated-or-groundwork)) |
| **Not built** | TRA e-filing and EFD/VFD device integration, a multi-currency ledger, SMS, WhatsApp and mobile-money provider integrations |

---

## Organisation model

The platform models **Group → Company → Division → Branch**. Business documents and registers belong to a company (line items inherit it from their parent record). Company isolation is enforced in service code through shared scope helpers and covered by a company-isolation end-to-end suite and module-level isolation specs; it is not enforced by database row-level security, so new modules must apply the helpers themselves. A user sees other companies only through explicit access grants or group-scoped roles.

The seed creates one group (`ITEMBA`) and three companies:

| Company | Core business | What the product covers today |
|---|---|---|
| **Westsides Company Ltd** | Wholesale and retail (beverages, hardware and building materials) | The most developed operating company: the shared sales, procurement, inventory and POS modules are exercised here, plus Westsides-specific reports, dashboard and daily cash close. Price lists, batches and returnable packages exist as master data (see [groundwork](#what-is-gated-or-groundwork)) |
| **Mwanjalisi Oil** | Fuel retail | Fuel Reporting (station shift book with calculated reconciliation) and a launcher for the separate Fuel Grid application |
| **Itemba Enterprises Co. Ltd** | Logistics, agriculture, construction | The shared ERP (finance, procurement, inventory, HR, documents); no sector-specific modules |

Group-scoped roles see across companies, and some Group Control registers (for example bank accounts, loans and fixed assets) can be group-level records reachable only through those roles. Group-level features that exist today: group registry, **Group Control** registers (bank accounts, loans and debts, contracts, fixed assets), intercompany transactions, and group roll-up reports. The consolidated profit and loss, balance sheet and cash flow leave out journal entries created by intercompany transactions; the group trial balance is a plain sum before consolidation. There is no FX translation.

> **Scope note.** In June 2026 the product was deliberately narrowed to the shared ERP core plus Westsides. The backend modules and screens for petroleum operations, logistics, agriculture, construction, parking, rentals and hospitality were removed, as was the earlier QA/launch-readiness/help/training/support layer. Many of their database tables, division types and permission codes remain, and the seed still creates the sector divisions and permission codes in every environment (their demo rows only outside production, unless `SEED_DEMO_DATA=true`); nothing in the application drives them.

---

## What's in the box

This table shows what is built, not what is switched on or fully wired. Exceptions are listed in the next section.

| Domain | What it covers |
|---|---|
| **Organisation and settings** | Groups, companies, divisions, branches, per-user workspace and preferences, global search |
| **Identity and security** | argon2 password hashing, session-tracked JWT auth, optional TOTP two-factor, granular permissions and roles across four scopes (group, company, division, branch), an append-only audit log (a database trigger blocks direct updates and deletes on audit rows, apart from the referential nulling of a deleted user or company; it is not tamper-evident), security events, API keys and clients |
| **Accounting and finance** | Double-entry general ledger with auto-posting from operational documents; fiscal years, periods, locks and period close; manual journals (a different user must post than created them) with reversal-only corrections; bank reconciliation; expenses; receivables and payables; customer payments, credit notes and refunds; fixed assets and depreciation; loans; intercompany; trial balance, P&L, balance sheet, cash flow and ageing reports. Money is stored as `Decimal` (no floating-point columns) |
| **Tax and compliance** | Tanzanian tax model (VAT, withholding, PAYE, SDL, corporate income tax, City Service Levy), tax returns and a filing engine, compliance calendar and obligations, business licences |
| **Procurement and suppliers** | Purchase order → receipt → supplier invoice → three-way match → payable. A full receive posts stock, ledger and (for credit purchases) the payable in one transaction; partial receipts go through goods received notes, which post stock only, and the ledger entry and payable are posted when the supplier invoice is approved. Supplier statements and performance |
| **Sales, customers and CRM** | Quotation or proforma → sales order (issues stock at weighted-average cost, posts revenue, VAT and COGS in one journal), delivery notes, customer credit profiles and statements, commissions, and price lists and customer price agreements held as master data (not yet applied when pricing a sale) |
| **Inventory** | Products, categories, batches, units; perpetual ledger through insert-only stock movements (an application convention, not a database guard) at weighted-average cost; stock adjustments and damage with a submit/approve status flow and ledger posting; returnable packages |
| **POS, desks and field operations** | Mobile POS Lite (tills bound to registered devices; the server sets prices and computes VAT; sale submissions carry an idempotency key so a retry does not record the sale twice; the till does not receive product cost), Sales Desk, Invoice Desk, Cash Desk, Records (personal notebook plus company record book), Fuel Reporting |
| **HR and payroll** | Employees, contracts, attendance, leave, salary advances, payroll runs with mandatory HR and Finance sign-off and ledger accrual; Tanzanian statutory deductions (PAYE, NSSF, PSSSF, WCF, SDL, HESLB); bank and mobile-money disbursement files and statutory-return CSVs |
| **Documents and printing** | Templates, numbering sequences, generated documents, print engine (HTML, PDF and text rendering), PDF/Excel/Word/CSV exporters |
| **Reporting** | Report catalog, saved views, scheduled reports, exports, dashboards, Westsides reports |
| **Integrations** | Providers, connections and mappings; API-key integration endpoints (external payments, delivery callbacks) |
| **Platform** | Postgres-backed job queue and worker, backup jobs, cache management, health endpoints |
| **Msaidizi** | Optional AI assistant and autonomy platform (see [below](#msaidizi-ai-assistant)) |

**Not included:** no integration with TRA e-filing or EFD/VFD devices (returns are prepared in-app and references recorded manually). No multi-currency ledger: journals carry no currency or exchange rate and amounts are summed at face value, so each company is expected to keep its books in one currency, although documents may carry other currency codes. No SMS, WhatsApp or mobile-money provider adapters: email over SMTP (only when SMTP is configured) is the only outbound messaging channel, and supplier order drafts can open a prefilled WhatsApp click-to-chat link in the user's own browser. Tax and payroll rules are configurable reference data that an operator must verify with a qualified adviser; nothing here is a statement of statutory compliance.

---

## What is gated or groundwork

This section separates what runs out of the box from what is behind a switch, and from registers that exist in the API without an engine behind them.

**Behind a switch (defaults shown are the repo defaults)**

| Capability | Switch | Default |
|---|---|---|
| ITEMBA OS web desktop | `NEXT_PUBLIC_ITEMBA_OS_ENABLED=true`, read at frontend build time | Off in the Dockerfile and the production and staging compose files; on in `frontend/.env.example` for local development |
| Kaunta POS (the August 2026 till redesign) and the new OS-styled POS | Per-terminal `uiVersion` (1 classic, 2 Kaunta, 3 new POS), set by a user with `mobile_pos_lite.manage` | 1 (classic), so every terminal uses the classic till until it is changed |
| POS price editing | Permission `mobile_pos_lite.edit_price` (the editing screens are drawn only by `uiVersion` 3 terminals; the server re-checks every edited line either way) and a per-terminal `maxPriceDropPct` | Drop limit is 0, so a user with only `edit_price` can raise a price but cannot lower one until a limit is set. `mobile_pos_lite.edit_price_unlimited` lifts the limit; the below-cost guard still applies |
| POS offline cash sales; POS credit (on-account) sales | Per-terminal `offlineCashEnabled`; per-terminal `creditEnabled` | Both off |
| Msaidizi chat | `MSAIDIZI_ENABLED` | Off; also needs signed provider-contract evidence to boot when on |
| Msaidizi autonomy, task worker, device, update, recovery and audit-signer channels | Fifteen further `MSAIDIZI_*_ENABLED` switches (for example `MSAIDIZI_AUTONOMY_ENABLED`, `MSAIDIZI_DEVICE_CHANNEL_ENABLED`, `MSAIDIZI_UPDATE_SUPERVISOR_ENABLED`) | All off; the production deploy workflow refuses to finish unless each is exactly `false` |
| Background job worker | `JOB_WORKER_ENABLED` | Off in code; on in the production and staging compose files |
| Automation dispatch (overdue reminders, low-stock alerts, scheduled-report emails) | `AUTOMATION_DISPATCH_ENABLED`, which runs inside the job worker and so also needs `JOB_WORKER_ENABLED` | Off |
| Automatic tax capture (copies tax from confirmed sales and purchase orders and approved expenses into the tax ledger that filing reports read) | `TAX_AUTO_APPLY` | Off, so this tax data is not collected automatically until enabled |
| Public self-registration | `ALLOW_PUBLIC_REGISTRATION` | Off |
| Fuel Grid launcher | `FUELGRID_APP_URL` and `FUELGRID_HEALTH_URL`, read by the frontend server at runtime | No code default, so not configured when unset; `frontend/.env.example` points the app URL at `http://localhost:3000` and leaves the health URL empty |

The shipped production and staging compose files forward only some of these variables to the containers (for example `JOB_WORKER_ENABLED`, the `MSAIDIZI_*` switches and the frontend build argument `NEXT_PUBLIC_ITEMBA_OS_ENABLED`). `TAX_AUTO_APPLY`, `AUTOMATION_DISPATCH_ENABLED` and `ALLOW_PUBLIC_REGISTRATION` (backend service) and `FUELGRID_APP_URL` and `FUELGRID_HEALTH_URL` (frontend service) must be added to the service's `environment:` block before setting them in an env file has any effect. The `FUELGRID_*_HOST` variables are already forwarded, but only to Caddy.

**Groundwork: registers with no engine behind them yet**

<details>
<summary>APIs and screens that store data but do not yet drive other modules</summary>

- **Approval engine**: requests, workflows and delegations with enforced maker-checker, but no other module submits requests to it yet (the dashboard only reads pending counts). Expense, purchase and sales approvals use their own status flows.
- **Requisition → RFQ → supplier quotation → bid comparison**: linked status registers with no conversion to purchase orders. Requisitions have a screen and a submit/approve flow; RFQs, supplier quotations and bid comparisons are API-only. (Customer quotations in the Sales Desk are a different, working feature.)
- **Rule and policy records**: posting rules and posting runs, automation and alert rules, internal-control rules and security policies are configuration records that no engine evaluates.
- **Webhooks, external messages, offline sync and mobile sessions**: registries. There is no webhook receiver creating events, no outbound message provider adapter and no offline-sync client that produces batches. The only processing is the Integration API's provider delivery-status callback for external messages, plus manual reprocess and conflict-resolution actions.
- **Price lists and customer price agreements**: master data that is not yet applied when pricing a sale.
- **Batch and expiry tracking, unit conversions**: optional. A batch's remaining quantity is reduced when a sales order line names the batch or when damage is recorded against it, but nothing blocks selling expired stock or picks batches automatically. Unit conversions are master data that no stock or pricing calculation uses.

</details>

---

## Architecture

```mermaid
flowchart LR
  B["Browser: classic dashboard or ITEMBA OS"] --> FE
  T["POS terminal PWA"] --> FE
  FE["Next.js frontend: same-origin proxy, httpOnly cookies"] -->|"/api/v1"| API
  API["NestJS API: guards, RBAC, company scoping, audit"] --> PG[("PostgreSQL 16 via Prisma")]
  API -.->|"optional in dev, provisioned in prod"| R[("Redis 7: permission-cache invalidation")]
  API --> W["In-process job worker: backups, exports (scheduled-report emails when dispatch is on)"]
  MS["Msaidizi assistant, off by default"] -->|"loopback HTTP with the caller's own token"| API
```

**How a request is handled.** Global guards run in a fixed order, pinned by a spec: throttling, JWT authentication (default-deny; routes opt out with `@Public()`), Msaidizi task scope, role check, then per-route permission check. A route that declares no permission is open to any authenticated user, so new routes must declare one. A strict validation pipe rejects unknown fields. Ordinary JSON responses are wrapped in a `{ success, data, timestamp }` envelope (file downloads, SSE streams and the Msaidizi device channel are not), and a filter maps Prisma errors to HTTP statuses.

**Design notes**

- **Audit**: changes are logged by the services that make them, and audit writes are application-level. Read access is audited on the sensitive Group Control controllers (bank accounts, contracts, loans, debts, fixed assets), the Loans borrowings desk report and the dashboard's executive-summary endpoint, for both successful and denied attempts. Audit rows carry a channel (web, API key, agent, or system for background jobs).
- **Ledger invariants** (balanced journals, open periods, locks) are enforced in application code, not by database constraints or triggers on the journal tables.
- **Jobs** use a Postgres table with `FOR UPDATE SKIP LOCKED` leasing, not Redis or a message broker. Redis is used for cross-replica permission-cache invalidation; everything else, including jobs, works without it.
- **Files** are stored on local disk; object storage (S3 and similar) is not supported.
- **The API surface is introspected** into a capability manifest that the AI assistant builds its tools from; a drift test keeps every endpoint classified.
- **Swagger** is served at `<API_PREFIX>/docs` (default `/api/v1/docs`) whenever `NODE_ENV` is not `production`, which includes `staging`, so the shipped staging compose file exposes it too. Set `NODE_ENV=production`, or put the docs behind access control, on any host that is reachable from outside.

**Tech stack**

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 3 · react-aria-components · Motion · lucide-react |
| Backend | NestJS 11 on Express 5 · TypeScript · Passport JWT · class-validator · Swagger |
| Data | PostgreSQL 16 · Prisma 5.22 · Redis 7 (optional in development) |
| Security | argon2 · optional TOTP two-factor · Helmet · CORS allowlist · global throttling · strict DTO validation |
| Documents | pdfkit · exceljs · docx |
| Testing | Jest 29 (backend) · Vitest and Testing Library (frontend) · Node test runner (script gates) |
| AI | Anthropic SDK (Msaidizi, optional) |
| Delivery | Docker Compose · Caddy · GitHub Actions |
| Windows | .NET 8 (Msaidizi companion) |

---

## Frontend

The Next.js app talks to the API mainly through a same-origin proxy route and `/api/auth/*` handlers that keep the access and refresh tokens in httpOnly cookies, so page scripts cannot read them (a short-lived temporary token is returned only during a forced password change or two-factor step). The design system is **Aurora** (CSS-variable tokens with light, dark and system themes, reduced-motion support, and shared table, form, dialog and timeline components). The back office is English; the POS till is Swahili-first with an English toggle.

Two shells render the same pages:

- **Classic dashboard** (sidebar, topbar, breadcrumbs, global search): the default wherever the OS flag is off.
- **ITEMBA OS**: a browser web desktop with a menubar, dock, app launcher, movable and snappable windows, window overview, wallpapers and themes, server-synced sessions and drafts, and a notification centre. Global search (Ctrl/Cmd+K) is available in both shells. Its registered apps are **ITEMBA-R** (the classic ERP in a window), **Invoice Desk**, **Cash Desk**, **Sales Desk**, **Inventory**, **Point of Sale**, **Records**, **Payroll**, **Documents**, **Reports**, **Settings** and the external **Fuel Grid**.

Also in the frontend: an installable **POS terminal** (PWA with an offline cash-sale queue, HTML and PDF receipts), a standalone **Fuel Reporting** portal at `/fuel-reporting`, and the **Msaidizi** workspace at `/msaidizi`.

---

## Msaidizi (AI assistant)

*Msaidizi* is Swahili for "assistant". It is optional, off by default, and permission-bound by design.

- **Chat layer.** A user asks in plain language; a model loop built on the Anthropic SDK calls the platform's **own REST API** with the requesting user's bearer token, so every guard, permission check and audit interceptor applies. Tools are generated from the capability manifest, filtered per user, and **read-only by default**. When it is on, the user's questions and the platform data the assistant reads are sent to the Anthropic API. Conversations are stored in the platform database; by default the resume state, which includes retrieved business records, is encrypted and kept for 24 hours, and conversations stay readable for 90 days. Enabling it requires the operator to supply an ES256-signed provider-contract attestation (zero-training, zero-retention claims, bound to the API account and model ids) at boot, or the backend refuses to start. The signature, pinned key, validity window and bindings are re-verified before every provider call, so an expired attestation stops the next request. This proves the attestation is well-formed and current; it cannot prove the contract itself, which the operator must hold.
- **Autonomy platform.** Durable tasks with immutable plans, mandates, routines, memory, a task worker, a device broker on a dedicated mTLS listener, and signed update, recovery and audit-signing channels. It is implemented and tested, **every switch defaults to off**, and the production deploy path fails if any autonomy switch is on.
- **Windows companion** ([`windows-companion/`](windows-companion/README.md)). A .NET 8 fail-closed execution boundary: Windows services, a tray agent and an installer pipeline. All capabilities ship disabled, and its docs state that installer acceptance is not production acceptance: deployment eligibility stays false without separately signed operational and staged-ring evidence.

---

## Repository layout

```text
itemba-r/
├── backend/             NestJS API: feature folders in src/modules, Jest unit and e2e tests
├── frontend/            Next.js app: dashboard shell, ITEMBA OS shell, POS terminal PWA
├── website/             Public marketing site (independent Next.js 15 app)
├── database/            Canonical Prisma schema, migrations and seeds
├── windows-companion/   .NET 8 Msaidizi execution boundary
├── deploy/              Caddy config, production relaunch kit, Fuel Grid bridge
├── scripts/             Verification gates, smoke tests, release rehearsals, load tests
├── docs/                Current: deployment, release checklist, ITEMBA OS design. Older: May 2026 audits and roadmaps
├── docker-compose*.yml  Development, production, staging (plus a staging Msaidizi-chat overlay) and release-proof stacks
└── .github/workflows/   CI, plus manual deploy, evidence-release and ring-promotion workflows
```

`backend/`, `frontend/` and `website/` are **independent npm projects** with their own lockfiles. The root `package.json` holds the delivery and verification scripts, plus the Playwright, Prisma and TypeScript tooling they use. The Prisma schema lives in `database/`, not in `backend/`; backend unit specs sit beside the code as `*.spec.ts` and e2e suites are in `backend/test/*.e2e-spec.ts`. Root-level planning, review and runbook documents and the underscore-prefixed scratch files are internal working notes, may be outdated, and are not operating instructions.

---

## Getting started

### Prerequisites

- **Node.js 22** and npm (the version CI and the Dockerfiles use)
- **Docker** with Compose, for local PostgreSQL 16, Redis 7 and pgAdmin
- *Optional:* **PowerShell 7 (`pwsh`)** for the `npm run verify*` build scripts

### 1. Start the database

```bash
docker compose up -d
```

This starts PostgreSQL 16 on host port **5433**, Redis 7 on **6379** and pgAdmin on **5050** (pgAdmin runs with its own authentication switched off). The compose file works on its defaults, so you do not need a root `.env`. The API runs without Redis, so you can start only the database with `docker compose up -d postgres`; pgAdmin and Redis are optional.

> **Local development only.** The defaults are deliberately open: the database trusts all connections, Redis has no password, pgAdmin has no login, the ports are published on every interface, and the container names are fixed (so it cannot run beside another ITEMBA-R compose stack). Do not run this file on a shared network or a server, and never reuse its values elsewhere. On a laptop that joins untrusted networks, start only the database and bind it to loopback: `POSTGRES_PORT=127.0.0.1:5433 docker compose up -d postgres` (PowerShell: `$env:POSTGRES_PORT='127.0.0.1:5433'; docker compose up -d postgres`). pgAdmin's port cannot be rebound, so leave it out. Use `docker-compose.production.yml` for any real deployment.

### 2. Configure and start the backend

Create `backend/.env`. `backend/src/config/env.validation.ts` is the authoritative list of variables, and `backend/.env.example` documents most of them; copy individual variables from it rather than the whole file. The minimum for local development is:

```dotenv
# Local development only: these match the throwaway credentials in docker-compose.yml
DATABASE_URL=postgresql://itemba:itemba_dev_password@localhost:5433/itemba_r?schema=public
JWT_ACCESS_SECRET=<32+ random characters>
JWT_REFRESH_SECRET=<a different 32+ random characters>
APP_ENCRYPTION_KEY=<a third, distinct 32+ random characters; required at boot in every environment>
# TWO_FACTOR_ENCRYPTION_KEY=<32+ characters; only needed once someone enables two-factor sign-in>
# REDIS_HOST=localhost                   # optional: the API runs without Redis
```

Generate each secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (run it once per variable so every value is different). Then:

```bash
cd backend
npm ci
npm run prisma:generate      # can take a couple of minutes the first time on Windows; may print a harmless update notice
npm run prisma:deploy        # applies all migrations (about 160)
```

Set the admin password for the seed. Without it, a non-production seed falls back to a placeholder that is visible in this repository, so never skip this step on a machine anyone else can reach (production refuses to seed without it). The shell is the reliable route:

```bash
export SEED_ADMIN_PASSWORD='<a strong password of your own>'
```

```powershell
$env:SEED_ADMIN_PASSWORD = '<a strong password of your own>'
```

```bash
npm run db:seed              # group, companies, roles and permissions, chart of accounts, tax and payroll reference data, demo data
npm run start:dev            # the first start compiles the project, which can take one to two minutes; API on http://localhost:3001/api/v1
```

The API is ready when `http://localhost:3001/api/v1/health/ready` returns 200; Swagger is at `/api/v1/docs`. Expect a few harmless startup warnings: email sending disabled because SMTP is not configured, the permission cache in single-process mode without Redis, and a route-path legacy-converter notice. The seeded super-admin's email comes from `SEED_ADMIN_EMAIL` (default `admin@itemba.local`). The password is applied only when the admin is first created, so re-running the seed does not change it. The account is marked **must change password**: the first sign-in returns a password-change requirement instead of a session, and you choose a new password before you can continue. Demo data is seeded unless `NODE_ENV` is `production`, where `SEED_DEMO_DATA=true` opts in. Never run a non-production seed against a host that is reachable from the internet.

### 3. Start the frontend

In a second terminal (the API keeps running in the first):

```bash
cd frontend
cp .env.example .env.local    # PowerShell: Copy-Item .env.example .env.local
npm ci
npm run dev                   # http://localhost:3009
```

Open **http://localhost:3009/login**. The frontend listens on **3009** (port 3000 is only the container-internal port in the Docker image). `frontend/.env.example` turns the ITEMBA OS shell **on**; set `NEXT_PUBLIC_ITEMBA_OS_ENABLED=false` and restart the dev server to see the classic dashboard. `frontend/.env.example` is tuned for local development; do not reuse it for a hosted instance. The first `npm run dev` may modify the tracked `frontend/next-env.d.ts` (and, when Next.js detects an AI coding agent, generate `frontend/AGENTS.md` and `frontend/CLAUDE.md`); these are Next.js side effects, so do not commit them.

---

## Commands

**Backend** (run from `backend/`)

| Command | Description |
|---|---|
| `npm run start:dev` | API in watch mode (port 3001) |
| `npm run build` | Production build |
| `npm run lint` · `npm run format:check` | ESLint · formatting baseline check |
| `npm test` | Jest unit tests: colocated `src/**/*.spec.ts`, no database needed, run in band with an 8 GB heap. One file: `npm test -- src/modules/expenses/expenses.service.spec.ts` |
| `npm run test:ci` | The CI variant of the unit tests |
| `npm run test:e2e:ci` | End-to-end suites (`backend/test/*.e2e-spec.ts`). They create and delete rows in whatever database `DATABASE_URL` points at (the shell value, else `backend/.env`), so point it at a separate throwaway database that has been migrated with `npm run prisma:deploy` and not seeded, as CI does. Never use your dev database |
| `npm run prisma:generate` · `prisma:deploy` · `prisma:migrate` | Generate the client · apply migrations · create a dev migration |
| `npm run prisma:studio` · `prisma:reset` | Prisma Studio · drop, re-migrate and re-seed whatever database `DATABASE_URL` points at (development only; check it first) |
| `npm run db:seed` | Run the seed. Safe to repeat on a fresh dev database, but each run resets every system role's permissions to the seed matrix, so do not run it against a database whose roles you have customised |

**Frontend** (run from `frontend/`)

| Command | Description |
|---|---|
| `npm run dev` · `npm start` | Dev server · production server (both on port 3009) |
| `npm run build` | Production build |
| `npm run lint` · `npm run typecheck` · `npm run format:check` | ESLint · `tsc --noEmit` · formatting baseline check (CI runs all three) |
| `npm test` · `npm run test:ci` | Vitest |
| `npm run smoke:routes` | Request every page route (dynamic routes via sample fixtures) on a running frontend at `FRONTEND_BASE_URL` and fail on error pages; checks rendering only, not data |

The marketing site in `website/` is separate: `npm run dev` there listens on port 3001, the same as the API, so run one at a time or pass another port. CI audits its production dependencies on every run, and on pushes to `main` the compose-deployment smoke builds and boots its image; it has no lint or test job of its own.

**Root** (run from the repo root)

| Command | Description |
|---|---|
| `npm run verify` | Install, validate Prisma, generate the client, typecheck and build backend and frontend (needs `pwsh`; no tests, no lint) |
| `npm run verify:local` · `verify:backend:locked` | Same without installing · backend-only path for Windows when the Prisma DLL is locked |
| `npm run verify:env` | Env contract, ID strategy, migration safety, DTO contract and frontend-backend contract gates (plain Node, but run `npm ci` once in the repo root first: the frontend-backend contract gate imports `typescript` from the root `node_modules`) |
| `npm run verify:deploy` | `verify:env` plus compose and deployment validation (needs Docker Compose) |
| `npm run smoke:*` | Compose-deployment, backup-restore, auth-flow, registry and integration smokes (most need Docker or a running stack) |
| `npm run release:*` | Release rehearsals and audits: upgrade, restore and health rehearsals run against an isolated Docker stack (`docker-compose.release-proof.yml`); `release:opening-audit` reads (in a read-only transaction) the database named by `OPENING_AUDIT_DATABASE_URL`, else `DATABASE_URL` in `backend/.env` (the file must exist), and `release:contracts-audit` is a static manifest check. Both need backend dependencies installed and write their reports under the gitignored `.release/` |

---

## Adding a feature

**Backend module.** Create `backend/src/modules/<name>/` with `<name>.module.ts`, `.controller.ts`, `.service.ts` and `dto/`, and import the module in `backend/src/app.module.ts` (registration is by hand). Give every route `@RequirePermissions(...)` or `@RequireAnyPermissions(...)`. The capability-manifest drift spec (`src/common/capabilities/capability-manifest.spec.ts`) fails any write (non-GET) route that lacks one, but it does not catch a permission-less read, which is open to any authenticated user. The reversibility tier (`common/capabilities/reversibility.ts`) is derived from the verb and the permission code, so check that the tier it assigns is right, and decide whether the route should be `@AgentExcluded`. New permission codes go in `database/seeds/permission-matrix.ts` and, for existing databases, in a Prisma migration (deploys do not run the full seed). Scope queries to the caller's company with `common/services/company-scope.service.ts` and `organization-scope.service.ts`. DTOs are strictly validated: unknown fields are rejected. For schema changes, edit `database/prisma/schema.prisma`, run `npm run prisma:migrate` from `backend/`, use `@default(uuid())` for IDs, and follow [`docs/migration-safety-policy.md`](docs/migration-safety-policy.md).

**Frontend page.** Add `frontend/src/app/(dashboard)/<route>/page.tsx` and a nav entry in the `NAV` array in `frontend/src/components/layout/sidebar.tsx`; ITEMBA OS apps register in `frontend/src/lib/apps.ts` (see [`docs/design/itemba-os/app-contract.md`](docs/design/itemba-os/app-contract.md)). Call the API only through the `backend*` helpers in `frontend/src/lib/api-client.ts` (or `/api/backend/*`) so the contract gate can match the call to a controller route and verb. Any dynamic `[param]` route also needs an entry in `frontend/scripts/route-smoke-fixtures.json`, or the CI route smoke fails.

---

## Quality gates

GitHub Actions (`ITEMBA-R CI`, on push and pull request to `main` and `develop`) runs, among others:

- production dependency audit (fails on high or critical advisories) for backend, frontend and website
- Prisma schema validation, backend and frontend lint, typecheck, formatting-baseline check and builds (the frontend build job also boots the production server and runs `smoke:routes`)
- backend unit tests, plus end-to-end smoke against a PostgreSQL 16 service container
- a migration rehearsal, frontend tests, an unsafe-pattern scan, and deployment validation
- Windows companion protected verification on `windows-2022`
- on pushes to `main`, a compose-deployment smoke and Docker image builds

Custom gates under `scripts/` protect the contracts most likely to drift: every statically resolvable frontend backend-call must match a real controller route (dynamic call sites are skipped), Prisma IDs must use `uuid()`, destructive migrations need an approval marker and an archive step, and a named list of accounting and control modules may not declare `any`-typed request parameters (`@Body()`, `@Query()`, `dto`, `body`, `query`, `user`). See [`docs/migration-safety-policy.md`](docs/migration-safety-policy.md).

---

## Deployment

- **Topology.** `docker-compose.production.yml`: Caddy (TLS reverse proxy, the only service publishing public ports by default; the backend's two Msaidizi mTLS listener ports bind to loopback unless overridden), the Next.js frontend, the NestJS backend, a one-shot migration service, the public website, PostgreSQL 16 and a password-protected Redis 7. Staging has its own compose file, and `docker-compose.release-proof.yml` is an isolated stack for rehearsals.
- **Deploys are manual.** The `Deploy — Production` workflow runs only on `workflow_dispatch` with a typed confirmation and refuses commits that have not passed CI on `main`. The job uses the `production` GitHub environment, so required reviewers can be added in the repository's environment settings; the workflow has no approval step of its own. Merging never deploys.
- **Safety rails.** `deploy/relaunch/deploy.sh` takes a `pg_dump` and checks that it is readable before migrating, validates the new image's environment before migrating or restarting anything, and fails closed unless every Msaidizi autonomy, device and update switch is off and `MSAIDIZI_WRITE_MODE` is `read-only` (read-only chat may be on). The production seed is opt-in (`RUN_PRODUCTION_SEED=true`; on an existing database it is also refused unless `CONFIRM_ROLE_PERMISSION_RESEED=true`, because it replaces every system role's permissions). `deploy.sh` writes `SEED_DEMO_DATA=true` into a new `.env.production` and the compose default is also true, so set `SEED_DEMO_DATA=false` before an opted-in production seed unless you want demo data.
- **Backups.** `deploy/relaunch/` provides pre-migration and nightly database dumps with retention, and in-app backup jobs write database, file and full-system archives to local storage. Copying backups off the server is the operator's responsibility. Never run `prisma migrate reset` or `docker compose down -v` against production.
- **Fuel Grid** is a separate application deployed from its own repository. This stack's Caddy also terminates TLS and proxies its two hostnames over a shared edge network, and the app's launcher links to it (see the switch table above).

Operator documentation: [`docs/deployment.md`](docs/deployment.md) and [`docs/release-checklist.md`](docs/release-checklist.md). Some sections of `docs/deployment.md` (for example Rollback and Security Notes) pre-date the June 2026 scope change; where they disagree with the compose files, trust the compose files.

---

## Documentation

**Current**

| Topic | Where |
|---|---|
| Deploying and operating | [`docs/deployment.md`](docs/deployment.md) · [`docs/release-checklist.md`](docs/release-checklist.md) |
| Schema changes | [`docs/migration-safety-policy.md`](docs/migration-safety-policy.md) · [`database/README.md`](database/README.md) |
| ITEMBA OS design and app specs | [`docs/design/itemba-os/`](docs/design/itemba-os) (start with [`app-contract.md`](docs/design/itemba-os/app-contract.md)) · [`docs/os-business-connections.md`](docs/os-business-connections.md) |
| Backups and recovery | [`docs/admin/backup-restore-guide.md`](docs/admin/backup-restore-guide.md) |
| Design system | [`docs/aurora-design-system.md`](docs/aurora-design-system.md) |
| Fuel Reporting | [`docs/user-manuals/fuel-reporting.md`](docs/user-manuals/fuel-reporting.md) |
| Windows companion | [`windows-companion/README.md`](windows-companion/README.md) |

**Historical.** [`docs/architecture.md`](docs/architecture.md), [`docs/database-design.md`](docs/database-design.md), [`docs/permissions-model.md`](docs/permissions-model.md), [`docs/development-roadmap.md`](docs/development-roadmap.md), `docs/launch/`, `docs/qa/`, and the May 2026 audit and phase-progress files in `docs/` describe the original scaffold or earlier milestones and pre-date the current code. Other files under `docs/` that are not listed as Current, including the rest of `docs/admin/` and all of `docs/user-manuals/` except the Fuel Reporting manual, are older working material or dated point-in-time reviews (`docs/ui-review`, `docs/releases`, `docs/pos-reform`); check them against the code before relying on them. Where documents disagree with the code, trust the code.

---

## History

| When | What |
|---|---|
| Apr–May 2026 | Schema and monorepo scaffold; governance, multi-company access, finance and HR hardening |
| 10 Jun 2026 | Scope narrowed to the shared ERP core and Westsides; sector and QA/launch modules removed |
| Jun–Jul 2026 | Inventory, flow and ledger correctness audits and fixes; production relaunch kit |
| Aug 2026 | POS reform ("Kaunta"); Msaidizi chat and autonomy platform (off by default); Windows companion |
| Sep 2026 | ITEMBA OS web desktop (off by default in deployment configs); new POS with price editing (per-terminal pilot); Records unified; Cash Desk, Sales Desk and Invoice Desk connected to the ledger and canonical records through explicit, permission-gated actions |

---

## License

This repository is public for reference but is not open source. It does not currently include a licence file, so all rights are reserved by its owner. Beyond viewing and forking on GitHub, as GitHub's Terms of Service allow, you have no permission to use, copy, modify or redistribute the code. To ask for permission, contact the repository owner.
