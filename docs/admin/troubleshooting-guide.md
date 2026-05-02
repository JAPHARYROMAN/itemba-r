# Troubleshooting Guide

## Overview

This guide covers common issues encountered with ITEMBA-R and their solutions, organized by symptom category. For each issue, the probable causes and resolution steps are provided.

---

## 1. Login Failures

### Issue: "Invalid email or password" on correct credentials
**Probable causes:**
- User typed the wrong email or password.
- The user account uses a different email from what they remember.
- Password was changed by an admin and the user was not notified.

**Resolution:**
1. Verify the exact email in **Settings → Users** — check for typos or alternative emails.
2. Reset the password via **Settings → Users → [User] → Security → Reset Password**.
3. Confirm the user account is **Active**.

### Issue: "Account locked"
**Probable cause:** Too many failed login attempts.

**Resolution:**
1. Navigate to **Settings → Users → [User]**.
2. Click **Unlock Account**.
3. Review the Security Events log to see how many failed attempts occurred and from which IP.
4. If the failed attempts appear automated (brute force), consider blocking the source IP.

### Issue: "Invalid or expired token" when navigating after login
**Probable cause:** The JWT access token (15 min) expired and the refresh token failed to renew silently.

**Resolution:**
- Ask the user to log out and log back in.
- If it happens frequently, check that the server's system clock is synchronized (NTP). JWT validation depends on correct time comparison.
  ```bash
  timedatectl status  # Check NTP sync status
  ```

---

## 2. Permission Denied Errors

### Issue: User gets "403 Forbidden" on a page they should access
**Probable causes:**
- The role assigned to the user doesn't include the required permission.
- The role is scoped to a different company than the one being accessed.
- The permission was recently changed.

**Resolution:**
1. Navigate to **Settings → Users → [User] → Roles** — verify the role is assigned and the company scope is correct.
2. Navigate to **Settings → Roles → [Role] → Permissions** — verify the specific permission is enabled.
3. Ask the user to log out and log back in to refresh their permission token.

### Issue: User can see a menu item but gets "Access Denied" when clicking it
**Probable cause:** The menu is shown based on a broader permission, but the specific action requires a more specific permission.

**Resolution:**
Review which specific permission governs that action (see `docs/admin/role-permission-guide.md`) and add it to the user's role.

---

## 3. Slow Dashboard

### Issue: Dashboard takes > 5 seconds to load
**Probable causes:**
- Missing database indexes on frequently queried tables.
- Large data volume without proper pagination.
- Background jobs running during peak hours.

**Resolution:**

**Check database query performance:**
```sql
-- Find slow queries from pg_stat_statements
SELECT query, calls, mean_time, total_time
FROM pg_stat_statements
WHERE mean_time > 500
ORDER BY mean_time DESC
LIMIT 10;
```

**Check missing indexes:**
```sql
-- Find sequential scans on large tables
SELECT relname, seq_scan, seq_tup_read, idx_scan
FROM pg_stat_user_tables
WHERE seq_scan > 100
ORDER BY seq_tup_read DESC;
```

**Add missing index:**
```sql
-- Example: add index on companyId if missing
CREATE INDEX CONCURRENTLY idx_transactions_company_id ON transactions("companyId");
```

---

## 4. Failed Migrations

### Issue: `npx prisma migrate deploy` reports "failed migration"
**Probable causes:**
- SQL error in the migration file.
- Constraint violation (existing data violates a new constraint).
- Partial migration (migration failed midway).

**Resolution:**

**Check migration status:**
```bash
npx prisma migrate status --schema=../database/prisma/schema.prisma
```

**Manual rollback steps:**
1. Identify the failed migration name from the output.
2. Connect to the database:
   ```bash
   psql -U itembar_user -d itembar_db
   ```
3. Check the `_prisma_migrations` table:
   ```sql
   SELECT migration_name, started_at, finished_at, applied_steps_count, logs
   FROM "_prisma_migrations"
   WHERE finished_at IS NULL OR logs IS NOT NULL;
   ```
4. Fix the data issue causing the constraint violation, or modify the migration.
5. Delete the failed migration record:
   ```sql
   DELETE FROM "_prisma_migrations" WHERE migration_name = 'failed_migration_name';
   ```
6. Re-run: `npx prisma migrate deploy`

---

## 5. Docker Container Crashes

### Issue: Backend container exits immediately
**Probable causes:**
- Missing environment variables.
- Database not reachable.
- Port conflict.

**Resolution:**
```bash
# Check exit logs
docker compose -f docker-compose.production.yml logs --tail=50 backend

# Check for port conflicts
netstat -tlnp | grep 3001
```

Common fix: Ensure `DATABASE_URL` is correct and PostgreSQL is running.

### Issue: Container running but application not responding (OOM)
**Probable cause:** Out of Memory — Docker killed the container process.

**Resolution:**
```bash
# Check for OOM events
docker inspect itemba-backend | grep OOM
dmesg | grep "Out of memory"

# Increase container memory limit in docker-compose.production.yml
services:
  backend:
    mem_limit: 2g
    memswap_limit: 2g
```

---

## 6. Email/SMS Not Sending

### Issue: Emails not received by users
**Probable causes:**
- SMTP credentials are incorrect.
- Port is blocked by the server firewall.
- Sender email is rejected as spam.

**Resolution:**
1. Test SMTP from the command line:
   ```bash
   curl --url "smtp://smtp.gmail.com:587" --ssl-reqd \
     --mail-from "notifications@itemba.local" \
     --mail-rcpt "test@example.com" \
     --upload-file email.txt \
     --user "notifications@itemba.local:app-password"
   ```
2. Check **Settings → Integrations → Message Log** for delivery errors.
3. Verify SMTP settings at **Settings → Integrations → Providers → [Email Provider]**.
4. Check whether port 587 or 465 is open: `telnet smtp.gmail.com 587`.

### Issue: SMS messages not delivered
**Resolution:**
1. Navigate to **Settings → Integrations → Message Log** — check the HTTP response code from the SMS provider.
2. Common error codes: 401 (wrong API key), 402 (insufficient credits), 400 (invalid sender ID).
3. Log in to the SMS provider portal and verify account balance and API key.

---

## 7. Offline Sync Errors

### Issue: Device sync fails with "conflict detected"
**Probable cause:** A record was modified both offline and online simultaneously.

**Resolution:**
1. Navigate to **Settings → Integrations → Sync Conflicts**.
2. Review each conflict — compare the offline version and the server version.
3. Accept the correct version for each conflict.
4. The device will re-sync successfully after all conflicts are resolved.

### Issue: Sync upload returns "device not registered"
**Resolution:**
1. Navigate to **Settings → Integrations → Devices** — verify the device is listed.
2. If the device was deactivated: reactivate it.
3. If missing: re-register the device and reconfigure the device app with the new token.

---

## 8. Audit Log Gaps

### Issue: Expected audit events are missing from the log
**Probable causes:**
- The action was performed via a direct database query (bypassing the application).
- The `AuditLogsService` middleware was not applied to the affected route.

**Resolution:**
1. Check if the missing events correspond to a specific user or module.
2. If a developer performed database operations directly (e.g., during a migration), note this in the audit log manually via **Audit Logs → Add Note**.
3. For systematic gaps in a module, the development team should verify that the NestJS route guards and `AuditInterceptor` are applied to the affected endpoints.

---

## 9. Prisma Client Errors

### Issue: "Cannot find module '.prisma/client'" error on startup
**Resolution:**
```bash
cd backend
npx prisma generate --schema=../database/prisma/schema.prisma
npm run start:dev  # or restart the container
```

### Issue: "P2025: Record to update not found"
**Probable cause:** Attempting to update a record that doesn't exist (by ID).

**Resolution:**
1. Check whether the record exists in the database.
2. Check if the ID is correct in the request.
3. Check if the record was soft-deleted (`deletedAt IS NOT NULL`).

---

## 10. JWT Expiry Issues

### Issue: Users get logged out unexpectedly during the work day
**Probable cause:** Access token (15 min) expired and the refresh token renewal failed.

**Resolution:**
1. Verify the frontend is sending the refresh token correctly (check browser dev tools → Network → `/auth/refresh` requests).
2. Check that `JWT_REFRESH_SECRET` is identical across all backend instances (if running multiple).
3. Check the server clock synchronization — time drift causes JWT validation failures:
   ```bash
   date && curl -s http://worldtimeapi.org/api/timezone/Africa/Dar_es_Salaam | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['datetime'])"
   ```
4. If time drift is found, synchronize NTP: `sudo systemctl restart systemd-timesyncd`
