# ITEMBA-R Admin Manual

## Overview

This manual is for IT Administrators and System Administrators responsible for operating, maintaining, and supporting the ITEMBA-R Group Digital Governance and Enterprise Management System. It covers architecture, user and role management, company setup, database administration, backup and restore, monitoring, support escalation, and release management.

---

## 1. System Architecture Overview

ITEMBA-R is a web-based application built on a modern, containerized architecture:

```
┌────────────────────────────────────────────────────────────────┐
│  Users (Browser)                                               │
└─────────────────────────┬──────────────────────────────────────┘
                          │ HTTPS
┌─────────────────────────▼──────────────────────────────────────┐
│  Frontend: Next.js 14 (App Router)                             │
│  Port 3000 — TypeScript — Tailwind CSS — Aurora Design System  │
└─────────────────────────┬──────────────────────────────────────┘
                          │ REST API (JSON)
┌─────────────────────────▼──────────────────────────────────────┐
│  Backend: NestJS 10                                            │
│  Port 3001 — TypeScript — Passport (JWT) — class-validator     │
│  Modules: Auth, Users, Roles, Groups, Companies, Finance,      │
│  Procurement, Sales, Petroleum, Westsides, Itemba, Rentals,    │
│  Hospitality, HR, Compliance, Approvals, BI, Integrations,     │
│  Security, QA, Launch, Training, Support                       │
└─────────────────────────┬──────────────────────────────────────┘
                          │ Prisma ORM
┌─────────────────────────▼──────────────────────────────────────┐
│  Database: PostgreSQL 16                                        │
│  Port 5432 — Docker volume: postgres_data                      │
└────────────────────────────────────────────────────────────────┘
```

**Key architectural properties:**
- **Multi-company, data-isolated**: All data is scoped by `companyId`. Backend guards enforce company-level access at the middleware layer.
- **JWT authentication**: Access tokens (15 min) + Refresh tokens (7 days), both signed with separate secrets.
- **Audit logging**: Every sensitive action writes to the `AuditLogs` table via `AuditLogsService`.
- **Role-based access control (RBAC)**: 26 predefined roles with granular permissions per module.
- **Group Control layer**: Sensitive company records accessible only to authorized Group-level roles.

---

## 2. Managing Users

### Creating a User
1. Navigate to **Settings → Users → New User**.
2. Enter: full name, email address, company assignment (can be multi-company for Group admins).
3. Set initial password (or generate a temporary one — user must change on first login).
4. Assign roles (see section 3).
5. Click **Save**.

### Editing a User
1. Navigate to **Settings → Users → [User]**.
2. Update name, email, or company assignment.
3. Add or remove roles.
4. **Deactivating a User**: Toggle **Account Active** to off. The user cannot log in. All their data is retained.
5. **Re-activating a User**: Toggle **Account Active** back on.

### Deleting a User
Users should generally be **deactivated, not deleted**, to preserve audit trail integrity. Deletion is only appropriate for test accounts or onboarding errors. Deleted users are soft-deleted (their records remain in the database with a `deletedAt` timestamp).

### Password Reset
1. Navigate to **Settings → Users → [User] → Security**.
2. Click **Reset Password**.
3. Enter and confirm the new temporary password.
4. The user must change their password on next login.

---

## 3. Managing Roles

### Viewing Roles
Navigate to **Settings → Roles** to see all 26 predefined roles. Each role shows:
- Role name and description
- Number of permissions assigned
- Number of users assigned to this role

### Assigning Roles to Users
1. Open the user record.
2. Under the **Roles** tab, click **Add Role**.
3. Select from the list of roles.
4. Specify the **company scope** (if the role should apply to one company only) or select **Group Level** for group-wide roles.
5. Click **Save**.

### Custom Role Permissions
For advanced customization:
1. Navigate to **Settings → Roles → [Role] → Permissions**.
2. Toggle individual permissions on or off.
3. All changes are audit-logged.

> Avoid modifying the default system roles. Instead, create a copy of the role and modify the copy.

---

## 4. Company and Division Management

### Adding a New Company
See `docs/admin/company-setup-guide.md` for the full onboarding procedure.

### Managing Divisions
1. Navigate to **Settings → Companies → [Company] → Divisions**.
2. Add or edit divisions (Logistics, Agriculture, Construction, Fuel Retail, etc.).
3. Each division can have one or more **branches** (physical locations or project sites).

### Branch Management
1. From the division record, click **Add Branch**.
2. Enter branch name, location, and branch manager.
3. Branches are the most granular operational unit for reporting and access control.

---

## 5. Permissions Model

ITEMBA-R uses a flat permissions model where each permission is a string in the format `module.resource.action`:

Examples:
- `finance.journals.create`
- `petroleum.shifts.close`
- `group_control.bank_accounts.view`
- `hr.payroll.approve`
- `security.users.manage`

Permissions are grouped into roles. Users inherit all permissions from all roles they are assigned.

**Override rules:**
- A user denied at the company scope cannot access even if their group role has the permission.
- The most restrictive policy applies for conflicting role permissions.

---

## 6. Database Administration Basics

### Accessing the Database
**Development:** Use pgAdmin at `http://localhost:5050` (admin@itemba.local / admin).
**Production:** Use a secure SSH tunnel or pgAdmin over a VPN. Never expose port 5432 to the public internet.

### Running Migrations
```bash
cd backend
npx prisma migrate deploy --schema=../database/prisma/schema.prisma
```

### Checking Database Size
```sql
SELECT pg_size_pretty(pg_database_size('itembar_db')) AS db_size;
SELECT relname AS table, pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;
```

### Checking Active Connections
```sql
SELECT count(*) FROM pg_stat_activity WHERE state = 'active';
```

---

## 7. Backup and Restore

See `docs/admin/backup-restore-guide.md` for the full backup and restore procedure.

**Quick reference:**
```bash
# Manual backup
pg_dump -h localhost -U itembar_user -d itembar_db -F c -f backup_$(date +%Y%m%d).dump

# Restore
pg_restore -h localhost -U itembar_user -d itembar_db -F c backup_YYYYMMDD.dump
```

---

## 8. Monitoring and Alerting

### Health Check
```bash
curl https://[your-domain]/api/v1/health
```
Expected response: `{"status": "ok", "database": "connected", "timestamp": "..."}`

### Docker Container Status
```bash
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs --tail=100 backend
```

### Alerts to Configure
| Alert | Threshold | Action |
|---|---|---|
| Backup failure | Any failure | Immediate email to IT Admin |
| API error rate | > 1% in 5 min | Email IT Admin |
| Database disk usage | > 80% | Email IT Admin |
| Failed login spike | > 10 failures/5 min | Email Security Officer |
| Application down | Health check fails | Immediate escalation |

---

## 9. Support Escalation Path

| Level | Who | When |
|---|---|---|
| **L1** | IT Admin | General user issues, account resets, permissions |
| **L2** | Senior IT / Developer | Bug reports, data issues, migration problems |
| **L3** | Development Team | Critical bugs, security incidents, data corruption |

For **security incidents** (data breach, unauthorized access):
1. Immediately revoke affected sessions.
2. Lock affected accounts.
3. Escalate to L3 within 15 minutes.
4. Document the incident.
5. Notify Group Director.

---

## 10. Release Management

### Release Process
1. Test on staging environment.
2. Back up production database.
3. Apply migration: `npx prisma migrate deploy`
4. Deploy new Docker images.
5. Verify health check.
6. Record in release log.
7. Monitor error logs for 30 minutes post-deployment.

See `docs/admin/deployment-operations-guide.md` for detailed deployment procedures.
