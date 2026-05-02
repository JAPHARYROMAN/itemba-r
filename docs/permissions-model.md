# ITEMBA-R — Permissions Model

## 1. Model

Authorization combines three layers:

1. **Authentication** — JWT access token (15m) + refresh token (7d).
2. **Roles** — a user has one or more roles. Each role has a `RoleScope`: `GROUP`, `COMPANY`, `DIVISION`, or `BRANCH`.
3. **Permissions** — fine-grained codes in the format `module.action`, assigned to roles.

Permission checks are additive: a user's effective permission set is the union of all permission codes across their roles.

## 2. Scope semantics

| Scope      | Reach                                                                  |
| ---------- | ---------------------------------------------------------------------- |
| `GROUP`    | All companies in the group, including sensitive Group Control records. |
| `COMPANY`  | A single company (the one bound to the user's membership).             |
| `DIVISION` | A single division within one company.                                  |
| `BRANCH`   | A single branch/site/project/farm/warehouse.                           |

Scope is **additional** to permission codes — a `COMPANY_ADMIN` may have `users.read`, but only for users within their company. The scope filter is applied in service-layer Prisma `where` clauses.

## 3. Permission code format

`module.action` — all lowercase, dot-separated.

- **Modules (Phase 0 seeded):** `groups`, `companies`, `divisions`, `branches`, `users`, `roles`, `permissions`, `audit-logs`, `documents`, `group-control`.
- **Actions:** `read`, `create`, `update`, `delete`.

Examples: `companies.read`, `users.create`, `group-control.read`.

## 4. Seeded roles

| Role               | Scope    | Permissions                                   |
| ------------------ | -------- | --------------------------------------------- |
| `GROUP_ADMIN`      | GROUP    | All                                           |
| `COMPANY_ADMIN`    | COMPANY  | All except `group-control.*`                  |
| `DIVISION_MANAGER` | DIVISION | `divisions.*`, `branches.*`, `documents.*`    |
| `BRANCH_MANAGER`   | BRANCH   | `branches.*`, `documents.*`                   |
| `STAFF`            | BRANCH   | `*.read` only                                 |
| `AUDITOR`          | GROUP    | `*.read` only (includes `group-control.read`) |

## 5. Enforcement

At the controller layer:

```ts
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('GROUP_ADMIN', 'AUDITOR')
@Get()
findAll() { ... }
```

And/or through permission decorators (to be added in Phase 2):

```ts
@RequirePermissions('companies.read')
findAll() { ... }
```

`JwtStrategy.validate()` loads the user with all roles and permissions and attaches them to `req.user`. `CurrentUser()` decorator exposes them in handlers.

## 6. Group Control layer

The `group-control` module is special:

- Only roles scoped `GROUP` (`GROUP_ADMIN`, `AUDITOR`) may hold any `group-control.*` permission.
- Every request hitting Group Control endpoints writes an `AuditLog` entry **before** the response is sent.
- A dedicated `GroupControlGuard` (Phase 3) double-checks scope and audit success.

## 7. Auditing

Every sensitive action produces one `audit_logs` row via `AuditLogsService.log()`:

```ts
await audit.log({ action: 'USER_LOGIN', entity: 'User', entityId: user.id, userId: user.id });
```

Mandatory audit events (Phase 2+):

- `USER_REGISTERED`, `USER_LOGIN`, `USER_LOGIN_FAILED`, `USER_LOGOUT`
- `ROLE_ASSIGNED`, `ROLE_REVOKED`, `PERMISSION_GRANTED`
- All `CREATE / UPDATE / DELETE` on companies, divisions, branches
- **All reads and writes** on Group Control modules
