# ITEMBA-R — Architecture

## 1. Purpose

ITEMBA-R is a **Group Digital Governance and Enterprise Management System** for the Itemba Group of Companies (Tanzania). It is not a generic ERP; it is a platform that encodes the legal, operational, and control structure of a group of BRELA-registered companies.

## 2. Governance hierarchy

```
Group
 └── Company (BRELA legal entity)
      └── Division / Business Unit
           └── Branch / Site / Project / Farm / Warehouse
                └── Department / User / Transaction
```

Every data row in the system belongs to a node in this tree. Authorization, reporting, and audit are all expressed in terms of this hierarchy.

## 3. Companies in scope

| Company                    | Core Business                        | Divisions                                                 |
| -------------------------- | ------------------------------------ | --------------------------------------------------------- |
| Mwanjalisi Oil             | Petroleum / fuel stations            | Fuel Retail                                               |
| Itemba Enterprises Co. Ltd | Logistics, Agriculture, Construction | Logistics · Agriculture · Construction                    |
| Westsides Company Ltd      | Wholesale & retail                   | Beverages (Alc / Non-Alc) · Hardware & Building Materials |

## 4. Repository layout

```
itemba-r/
├── backend/    NestJS 10 + Prisma 5 + PostgreSQL
├── frontend/   Next.js 14 (App Router) + TypeScript + Tailwind
├── database/   Prisma schema + seed (shared by backend)
├── docs/       Architecture, DB design, permissions, roadmap
└── docker-compose.yml   PostgreSQL 16 + pgAdmin
```

Backend and frontend are independent npm projects. The Prisma schema lives in `database/` so the schema-of-truth is clearly separated from backend code.

## 5. Runtime topology

```
┌────────────┐  HTTPS/JSON  ┌──────────────┐  SQL  ┌────────────┐
│  Next.js   │ ───────────▶ │   NestJS     │ ────▶ │ PostgreSQL │
│  Frontend  │              │   Backend    │       │            │
└────────────┘              └──────┬───────┘       └────────────┘
                                   │
                                   ├─ Audit Log writes (every sensitive op)
                                   └─ File storage (local in dev, S3 in prod)
```

All API calls pass through:

1. **Helmet** (security headers)
2. **CORS allowlist**
3. **Global ThrottlerGuard** (rate limiting)
4. **JwtAuthGuard** (on protected controllers)
5. **RolesGuard / Permission checks**
6. **ValidationPipe** (class-validator DTOs)
7. **Transform/Logging interceptors**
8. **Prisma + HttpException filters**

## 6. Backend module boundaries

| Module        | Responsibility                                   |
| ------------- | ------------------------------------------------ |
| `auth`        | Login, register, JWT access/refresh, strategies  |
| `users`       | User CRUD, password changes, activation          |
| `roles`       | Role CRUD + role-permission binding              |
| `permissions` | Permission catalog (module.action)               |
| `groups`      | Group entity (the root)                          |
| `companies`   | Company (BRELA entity) CRUD                      |
| `divisions`   | Business units within a company                  |
| `branches`    | Branches / sites / projects / farms / warehouses |
| `audit-logs`  | Central audit trail writer + read API            |
| `documents`   | Polymorphic document store metadata              |

Future modules (finance, HR, inventory, POS, fuel, logistics, agriculture, construction, Group Control) plug in alongside these without touching the backbone.

## 7. Frontend structure

Next.js 14 App Router with two route groups:

- `(auth)` — public routes (`/login`)
- `(dashboard)` — authenticated shell with persistent sidebar/topbar

All data fetching goes through `src/lib/api-client.ts`, which unwraps the `{ success, data }` envelope produced by the backend's `TransformInterceptor`.

## 8. Cross-cutting concerns

| Concern      | Implementation                                                             |
| ------------ | -------------------------------------------------------------------------- |
| Auth         | JWT access + refresh, argon2 password hashing                              |
| Authz        | RBAC + permission codes (`module.action`), scoped by `RoleScope`           |
| Audit        | Every login, sensitive read/write goes through `AuditLogsService.log()`    |
| Errors       | `HttpExceptionFilter` + `PrismaExceptionFilter` → consistent JSON envelope |
| Validation   | `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`      |
| Config       | `class-validator` env schema; app refuses to boot on missing secrets       |
| Rate limit   | Global `ThrottlerGuard`                                                    |
| File storage | `STORAGE_DRIVER=local` in dev → S3-compatible in prod (same interface)     |

## 9. Group Control layer

Sensitive records — bank accounts, loans, debts, contracts, fixed assets, guarantees, collateral, legal documents, licenses, insurance — are **company-owned but group-controlled**. Their modules (Phase 3) require:

- A role with `RoleScope.GROUP`
- A permission with module `group-control`
- A successful audit write _before_ the response is committed

This is enforced at the controller layer via a dedicated `GroupControlGuard` (stub added in Phase 3) on top of the standard JWT + role guards.
