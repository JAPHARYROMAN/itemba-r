# ITEMBA-R — Module Roadmap

Phase 0 · **Monorepo Scaffold** ✅
  - Workspaces (apps/api, apps/web, packages/shared)
  - Base configs, Docker Postgres, Swagger, health endpoint

Phase 1 · **Governance Backbone**
  - Prisma schema: Group, Company, Division, Branch, Site, Department
  - User, Role, Permission, RolePermission, UserRole
  - AuditLog (polymorphic)
  - Seed: 1 Group, 3 Companies, Divisions, base Roles & Permissions

Phase 2 · **Auth & Access Control**
  - Local + JWT strategies, refresh tokens, password hashing (argon2)
  - RBAC guard, permission guard, scope guard (group/company/division/branch)
  - Login/logout/refresh, password policy, session revocation
  - Audit: logins, permission changes, sensitive reads

Phase 3 · **Group Control Layer (sensitive records)**
  - Bank accounts, loans, debts, contracts, fixed assets, guarantees,
    collateral, legal documents, licenses, insurance
  - Group-level-only access, every read/write audited, approval workflow

Phase 4 · **Finance & Accounting Core**
  - Chart of accounts, journals, ledger, periods, multi-company consolidation

Phase 5 · **Company-Specific Operations**
  - Mwanjalisi Oil: tanks, pumps, shifts, variance
  - Itemba Enterprises: Logistics, Agriculture, Construction modules
  - Westsides: POS, wholesale/retail, inventory, batch/expiry
