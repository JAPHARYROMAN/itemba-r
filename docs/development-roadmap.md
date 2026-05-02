# ITEMBA-R — Development Roadmap

For the forward-looking hardening and rollout plan, see
[`grand-roadmap-next-iterations.md`](grand-roadmap-next-iterations.md).

## Phase 0 · Monorepo scaffold ✅

- `backend/`, `frontend/`, `database/`, `docs/` top-level layout
- NestJS + Prisma + PostgreSQL backend with global pipes, filters, interceptors
- Next.js + Tailwind frontend with dashboard layout and all initial routes
- Prisma schema for governance backbone
- Seed: Group, 3 Companies, 7 Divisions, 6 Roles, full permission catalog, admin user

## Phase 1 · Governance data & wiring

- Connect frontend pages to real backend endpoints (list, detail, create, update, delete)
- Department entity + CRUD
- User ↔ Role ↔ Company assignment UI
- Basic search and pagination across list pages

## Phase 2 · Auth & access control hardening

- Move tokens to httpOnly cookies; add CSRF protection
- `RequirePermissions()` decorator + `PermissionsGuard`
- Scope-aware Prisma query helpers (auto-filter by user's company/division/branch)
- Password reset, account lockout after failed attempts, session revocation
- 2FA (TOTP) for GROUP-scoped roles

## Phase 3 · Group Control layer

- Modules: `bank-accounts`, `loans`, `debts`, `contracts`, `fixed-assets`, `guarantees-collateral`, `legal-documents`, `licenses`, `insurance`
- `GroupControlGuard`: scope + mandatory audit
- Approval workflow (maker/checker) for sensitive writes
- Document attachment with versioning

## Phase 4 · Finance & accounting core

- Chart of accounts, journals, ledger, periods
- Multi-company consolidation
- Bank reconciliation
- Payroll (employees, salaries, statutory deductions: PAYE / NSSF / WCF / SDL)

## Phase 5 · Company-specific operations

### Mwanjalisi Oil (Petroleum)

- Tanks, pumps, fuel stock, deliveries, variance
- Shift open/close, attendant reports
- Credit customers, supplier fuel purchases
- Fuel sales POS, daily audit control

### Itemba Enterprises — Logistics

- Fleet (vehicles, trailers), drivers
- Trips, fuel usage, maintenance schedule
- Trip profitability

### Itemba Enterprises — Agriculture

- Farms, crops, seasons, inputs, harvests
- Produce inventory, labor, equipment
- Crop-season profitability

### Itemba Enterprises — Construction

- Projects, sites, BOQ, material requests
- Labor, subcontractors, equipment hours
- Progress billing, project profitability

### Westsides

- POS (retail + wholesale)
- Unit conversions, batch/expiry tracking
- Customer credit, supplier purchases, stock valuation
- Quotations, delivery notes, product profitability

## Phase 6 · Reporting, dashboards, integrations

- Pre-built executive dashboards per company/division
- Scheduled report exports (PDF, XLSX)
- Mobile money (M-Pesa / Tigo Pesa / Airtel Money) integration
- TRA VFD (virtual fiscal device) integration for tax receipts
- SMS/email notifications

## Phase 7 · Scale & operations

- Observability: structured logs, metrics, traces (OpenTelemetry)
- Backup & disaster recovery runbooks
- S3-compatible storage driver
- Multi-tenant hardening for future sibling groups
- Performance tuning, read replicas, query budgets
