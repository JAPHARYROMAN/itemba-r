# ITEMBA-R — Database Design

Canonical schema: [`database/prisma/schema.prisma`](../database/prisma/schema.prisma).
Database: **PostgreSQL 16**. ORM: **Prisma 5**.

## 1. Entity map (Phase 0 — governance backbone)

```
Group (1) ──< Company (1) ──< Division (1) ──< Branch
                 │
                 └──< User
                 └──< Document

User (M) ──< UserRole >── (M) Role ──< RolePermission >── (M) Permission

AuditLog  ── (optional) User
Document  ── (optional) Company, User (uploadedBy)
```

## 2. Tables

### `groups`

Single parent. Owns many companies.

- `id` (uuid, PK), `name` (unique), `code` (unique), `description`, timestamps.

### `companies`

A BRELA-registered legal entity.

- `id`, `groupId` → `groups.id` (Restrict on delete — a group cannot lose companies accidentally),
  `name`, `code` (unique), `registrationNumber` (unique), `tin` (unique), `address`.
- Indexed on `groupId`.

### `divisions`

A business unit within a company (Logistics, Fuel Retail, Beverages…).

- `id`, `companyId` (Cascade), `name`, `code`, `type` (`DivisionType` enum), `description`.
- Composite unique `(companyId, code)`.

### `branches`

Physical or logical operational unit.

- `id`, `divisionId` (Cascade), `name`, `code`, `type` (`BranchType` enum), `location`.
- Composite unique `(divisionId, code)`.

### `users`

- `id`, `email` (unique), `passwordHash` (argon2), `fullName`, `isActive`,
  `companyId` (SetNull) — optional company assignment.

### `roles`

- `id`, `name` (unique), `description`, `scope` (`RoleScope` enum: GROUP | COMPANY | DIVISION | BRANCH).

### `permissions`

- `id`, `code` (unique, format `module.action` e.g. `companies.read`), `description`, `module`.

### `role_permissions` (join)

Composite PK `(roleId, permissionId)`. Both FKs cascade on delete.

### `user_roles` (join)

Composite PK `(userId, roleId)`. Both FKs cascade on delete.

### `audit_logs`

Append-only.

- `id`, `action`, `entity`, `entityId?`, `userId?`, `metadata` (Json), `ipAddress?`, `createdAt`.
- Indexed on `(entity, entityId)`, `userId`, `createdAt`.

### `documents`

Polymorphic metadata store. Binary payload lives in the storage driver (local in dev, S3 in prod) addressed by `storageKey`.

- `id`, `title`, `ownerType` + `ownerId` (points at any entity), `storageKey`, `mimeType`, `companyId?`, `uploadedById?`.

## 3. Enums

| Enum           | Values                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `RoleScope`    | GROUP, COMPANY, DIVISION, BRANCH                                                                                          |
| `DivisionType` | FUEL_RETAIL, LOGISTICS, AGRICULTURE, CONSTRUCTION, BEVERAGES_ALCOHOLIC, BEVERAGES_NON_ALCOHOLIC, HARDWARE_BUILDING, OTHER |
| `BranchType`   | BRANCH, SITE, PROJECT, FARM, WAREHOUSE, STATION, OFFICE                                                                   |

## 4. Deletion semantics

| Relationship                         | On delete                           |
| ------------------------------------ | ----------------------------------- |
| Group → Company                      | Restrict (must be manually removed) |
| Company → Division / User / Document | Cascade / SetNull                   |
| Division → Branch                    | Cascade                             |
| Role/Permission → join rows          | Cascade                             |
| User → AuditLog                      | SetNull (preserve audit trail)      |

## 5. Upcoming (not yet in schema)

Phase 1+ will add: `Department`, `Employee`, `Customer`, `Supplier`, `BankAccount`, `Loan`, `Debt`, `Contract`, `FixedAsset`, `License`, `Insurance`, `GuaranteeCollateral`, plus all operational entities for Mwanjalisi Oil, Itemba Enterprises divisions, and Westsides.
