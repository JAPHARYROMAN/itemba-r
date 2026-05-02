# ITEMBA-R

**Group Digital Governance and Enterprise Management System** for the Itemba Group of Companies (Tanzania).

> Legal ownership at company level · Strategic control at group level · Operational activity at branch/site/project level · Sensitive access controlled through the Group Control layer.

---

## Companies in scope

| Company | Core Business | Divisions |
|---|---|---|
| **Mwanjalisi Oil** | Petroleum / fuel stations | Fuel Retail |
| **Itemba Enterprises Co. Ltd** | Logistics, Agriculture, Construction | Logistics · Agriculture · Construction |
| **Westsides Company Ltd** | Wholesale & retail | Beverages (Alc / Non-Alc) · Hardware & Building Materials |

Each company is a BRELA-registered legal entity. Sensitive records (bank accounts, loans, debts, contracts, fixed assets, guarantees, collateral, legal docs, licenses, insurance) are **owned by the company but accessed exclusively through the Group Control layer**.

---

## Repository layout

```
itemba-r/
├── backend/       NestJS 10 + Prisma 5 + PostgreSQL
├── frontend/      Next.js 14 + TypeScript + Tailwind CSS
├── database/      Prisma schema + seed (canonical DB source)
│   ├── prisma/schema.prisma
│   └── seeds/seed.ts
├── docs/          architecture · database-design · permissions-model · development-roadmap
├── docker-compose.yml   PostgreSQL 16 + pgAdmin
└── README.md
```

`backend/` and `frontend/` are **independent npm projects** — install and run them separately.

---

## Tech stack

- **Frontend:** Next.js 14 (App Router) · TypeScript · Tailwind CSS
- **Backend:** NestJS 10 · TypeScript · Passport (JWT + JWT-refresh) · class-validator
- **Database:** PostgreSQL 16 · Prisma 5
- **Auth:** argon2 password hashing · JWT access (15 min) + refresh (7 d)
- **Security:** Helmet · CORS allowlist · global ThrottlerGuard · ValidationPipe
- **Audit:** every sensitive action written via `AuditLogsService`
- **Docs:** Swagger auto-mounted at `/api/v1/docs` (non-prod)

---

## Prerequisites

- **Node.js ≥ 20** and **npm ≥ 10**
- **Docker Desktop** (for local PostgreSQL + pgAdmin)

---

## Setup — step by step

### 1. Clone and enter the repo

```bash
cd itemba-r
```

### 2. Configure environment files

```bash
# Root (for docker-compose)
cp .env.example .env

# Backend
cp backend/.env.example backend/.env

# Frontend
cp frontend/.env.example frontend/.env.local
```

Edit `backend/.env` and set at least:
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (any long random strings)
- `DATABASE_URL` (already correct for the default docker-compose setup)

### 3. Start PostgreSQL (Docker)

```bash
docker compose up -d
```

- Postgres → `localhost:5432`
- pgAdmin → http://localhost:5050  (`admin@itemba.local` / `admin`)

### 4. Install backend dependencies and run migrations

```bash
cd backend
npm install
npm run prisma:generate
npm run prisma:migrate    # creates the schema in PostgreSQL
npm run db:seed           # seeds Group, Companies, Divisions, Roles, Admin user
```

The seed creates a default admin:
- **Email:** `admin@itemba.local`
- **Password:** `ChangeMe!123`
  (override via `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` env vars)

### 5. Install frontend dependencies

```bash
cd ../frontend
npm install
```

### 6. Run both apps (two terminals)

**Terminal 1 — backend:**
```bash
cd backend
npm run start:dev
```
Backend runs at http://localhost:3001/api/v1 — Swagger at http://localhost:3001/api/v1/docs.

**Terminal 2 — frontend:**
```bash
cd frontend
npm run dev
```
Frontend runs at http://localhost:3000.

Log in at http://localhost:3000/login with the seeded admin credentials.

---

## Useful commands

### Backend (run from `backend/`)

| Command | Description |
|---|---|
| `npm run start:dev` | Start API in watch mode |
| `npm run build` | Production build |
| `npm run lint` | ESLint + autofix |
| `npm run test` | Run Jest unit tests |
| `npm run prisma:migrate` | Create + apply a new migration |
| `npm run prisma:studio` | Open Prisma Studio |
| `npm run prisma:reset` | Drop DB + re-apply all migrations + seed |
| `npm run db:seed` | Run seed only |

### Frontend (run from `frontend/`)

| Command | Description |
|---|---|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

### Root

| Command | Description |
|---|---|
| `docker compose up -d` | Start Postgres + pgAdmin |
| `docker compose down` | Stop them |
| `docker compose logs -f postgres` | Tail Postgres logs |
| `npm run verify` | Install dependencies, validate Prisma, typecheck, and build backend + frontend |
| `npm run verify:local` | Same verification using existing `node_modules` |
| `npm run verify:backend:locked` | Backend verification path for Windows when Prisma DLL regeneration is locked |

---

## Frontend routes

| Route | Purpose |
|---|---|
| `/login` | Sign in |
| `/dashboard` | Group overview |
| `/companies` | All companies in the group |
| `/group-control` | Sensitive records (restricted) |
| `/users` | User management |
| `/roles` | Roles & permissions |
| `/audit-logs` | Audit trail |

---

## Backend modules

`auth`, `users`, `roles`, `permissions`, `groups`, `companies`, `divisions`, `branches`, `audit-logs`, `documents` — all exposed under `/api/v1/*`, all listed in Swagger.

---

## Documentation

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/database-design.md`](docs/database-design.md)
- [`docs/permissions-model.md`](docs/permissions-model.md)
- [`docs/development-roadmap.md`](docs/development-roadmap.md)

---

## Status

**Phase 0 — Monorepo scaffold.** Governance backbone, auth, and all 10 base modules are in place. Group Control layer and company-specific operations (fuel, logistics, agriculture, construction, POS) arrive in Phases 3–5.

---

## Milestone 16: QA, Launch Readiness, Training & Support

### New in Milestone 16
- **QA Management**: 22 test suites, test cases, test runs, test results with launch blocker creation
- **Launch Readiness**: Launch blockers, readiness assessments, go-live sign-off
- **Documentation**: User manuals (16), help articles (10), help center search
- **Training Mode**: 10 courses, 8 guided walkthroughs, my-training, training environment
- **Support**: Support ticket system with comments and internal notes

### How to Run QA
1. Navigate to **QA & Launch → QA Dashboard**
2. Go to **Test Suites** to view the 22 seeded QA suites
3. Go to **Test Runs → New Test Run** to start a test run
4. Execute test cases, mark pass/fail/block, add evidence
5. Use **Create Blocker** on failed critical cases
6. Track overall readiness in **Launch Dashboard**

### How to Access Help Center
- Navigate to **Help & Training → Help Center**
- Use the search bar to find articles and manuals
- Browse by module category
- Rate articles as helpful or not helpful
- Admins can publish new articles at `/help/articles`

### How to Seed Training Content
Training courses, walkthroughs, and manuals are seeded automatically:
```bash
cd backend && npm run db:seed
```
Access training at **Help & Training → Training Courses** and **My Training**

### How to Run Launch Readiness Assessment
```bash
# 1. Ensure QA suites have been run
# 2. Access Launch Dashboard
GET /api/v1/launch/dashboard/summary

# 3. Create a new assessment
POST /api/v1/launch/assessments
{ "environment": "STAGING", "assessmentDate": "2026-04-27" }

# 4. Add readiness items, mark each passed/failed/waived
PATCH /api/v1/launch/readiness-items/:id/mark-passed

# 5. Calculate scores
PATCH /api/v1/launch/assessments/:id/calculate

# 6. Approve (requires launch.assessments.approve permission)
PATCH /api/v1/launch/assessments/:id/approve

# 7. Final sign-off
POST /api/v1/go-live/signoff
{ "notes": "All critical items passed. Approved for go-live.", "environment": "PRODUCTION" }
```

### Migration & Seed Commands
```bash
# Run M16 migration
cd backend && npx prisma migrate deploy --schema=../database/prisma/schema.prisma

# Run seed (includes M16 QA suites, manuals, courses, walkthroughs)
cd backend && npm run db:seed
```

### Support System
All users can submit support tickets:
- Navigate to **Support → My Tickets → New Ticket**
- Or via API: `POST /api/v1/support/tickets`
- Admins manage tickets at **Support → All Tickets**
