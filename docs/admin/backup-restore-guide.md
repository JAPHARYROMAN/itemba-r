# Backup & Restore Guide

## Overview

This guide covers the PostgreSQL backup strategy for ITEMBA-R, including automated scheduling, backup storage, integrity verification, restoration procedures, point-in-time recovery, disaster recovery testing, and monitoring.

---

## 1. PostgreSQL Backup Strategy

ITEMBA-R uses **PostgreSQL 16** as the database engine. The primary backup tool is `pg_dump` for logical backups, supplemented by WAL archiving for point-in-time recovery (PITR) in production.

### Backup Types

| Type | Tool | When | Retention |
|---|---|---|---|
| **Daily Logical Backup** | `pg_dump` (custom format) | 2:00 AM EAT daily | 30 days |
| **Monthly Logical Backup** | `pg_dump` (custom format) | 1st of each month, 3:00 AM | 12 months |
| **Pre-Migration Backup** | `pg_dump` | Before any migration or update | Until next major release |
| **WAL Continuous Archive** | `pg_basebackup` + WAL | Continuous | 7 days of WAL segments |

### Database Connection Details (Production)
| Parameter | Value |
|---|---|
| Host | `localhost` (or internal Docker network) |
| Port | `5432` |
| Database | `itembar_db` |
| User | `itembar_user` |
| Password | Set in `DATABASE_URL` env variable |

---

## 2. Automated Backup Schedule

### Setting Up the Cron Job (Linux/Docker Host)

Add the following to the root crontab (`crontab -e`):

```bash
# Daily backup at 2:00 AM EAT (UTC+3, so 23:00 UTC)
0 23 * * * /opt/itemba/scripts/backup-daily.sh >> /var/log/itemba-backup.log 2>&1

# Monthly backup at 3:00 AM EAT on the 1st (22:00 UTC)
0 22 1 * * /opt/itemba/scripts/backup-monthly.sh >> /var/log/itemba-backup.log 2>&1
```

### Daily Backup Script (`backup-daily.sh`)
```bash
#!/bin/bash
BACKUP_DIR="/opt/itemba/backups/daily"
DATE=$(date +%Y%m%d)
DB_NAME="itembar_db"
DB_USER="itembar_user"
DB_HOST="localhost"

mkdir -p "$BACKUP_DIR"

pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" \
  -F c -Z 6 \
  -f "$BACKUP_DIR/itembar_${DATE}.dump"

if [ $? -eq 0 ]; then
  echo "$(date): Daily backup completed: itembar_${DATE}.dump"
  # Delete backups older than 30 days
  find "$BACKUP_DIR" -name "*.dump" -mtime +30 -delete
else
  echo "$(date): ERROR - Daily backup FAILED"
  # Send alert email
  echo "ITEMBA-R daily backup failed on $(hostname)" | \
    mail -s "ITEMBA-R Backup FAILED" admin@itemba.local
fi
```

### Monthly Backup Script (`backup-monthly.sh`)
```bash
#!/bin/bash
BACKUP_DIR="/opt/itemba/backups/monthly"
DATE=$(date +%Y%m)
DB_NAME="itembar_db"
DB_USER="itembar_user"

mkdir -p "$BACKUP_DIR"

pg_dump -h localhost -U "$DB_USER" -d "$DB_NAME" \
  -F c -Z 9 \
  -f "$BACKUP_DIR/itembar_monthly_${DATE}.dump"

echo "$(date): Monthly backup completed: itembar_monthly_${DATE}.dump"
# Delete monthly backups older than 365 days
find "$BACKUP_DIR" -name "*.dump" -mtime +365 -delete
```

---

## 3. Backup Storage Locations

### Primary: Local Storage
- Daily backups: `/opt/itemba/backups/daily/`
- Monthly backups: `/opt/itemba/backups/monthly/`
- Pre-migration backups: `/opt/itemba/backups/pre-migration/`

### Secondary: Off-Site Storage (Required for Production)
Configure daily rsync to a remote backup server or S3-compatible storage:

```bash
# rsync to remote server
rsync -avz /opt/itemba/backups/ backup-user@backup-server.itemba.local:/backups/itemba-r/

# Or upload to S3-compatible storage (e.g., AWS S3, MinIO)
aws s3 sync /opt/itemba/backups/ s3://itemba-backups/itemba-r/ \
  --exclude "*.tmp" \
  --storage-class STANDARD_IA
```

**Minimum requirement:** At least one off-site backup must exist at all times. If the production server fails completely, you must be able to restore from the off-site backup.

---

## 4. Verifying Backup Integrity

### Method 1: pg_restore Verify
Test that the backup file is a valid, readable dump:
```bash
pg_restore --list /opt/itemba/backups/daily/itembar_YYYYMMDD.dump > /dev/null
echo "Exit code: $?"  # Should be 0
```

### Method 2: Restore to Test Database
Weekly, restore the latest backup to a test database and verify:
```bash
# Create test database
createdb -U itembar_user itembar_verify_test

# Restore
pg_restore -h localhost -U itembar_user -d itembar_verify_test \
  -F c /opt/itemba/backups/daily/itembar_YYYYMMDD.dump

# Run a basic count check
psql -U itembar_user -d itembar_verify_test \
  -c "SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM companies;"

# Drop test database
dropdb -U itembar_user itembar_verify_test
```

Document the verification results in the **Backup Verification Log**.

---

## 5. Restoration Procedure

> **CRITICAL: Always take a backup of the current database state before performing a restore.**

### Full Restore (Production)

```bash
# Step 1: Backup current state
pg_dump -h localhost -U itembar_user -d itembar_db \
  -F c -f /opt/itemba/backups/pre-migration/itembar_pre_restore_$(date +%Y%m%d_%H%M).dump

# Step 2: Stop the application
docker compose -f docker-compose.production.yml stop backend frontend

# Step 3: Drop and recreate the database
psql -U postgres -c "DROP DATABASE IF EXISTS itembar_db;"
psql -U postgres -c "CREATE DATABASE itembar_db OWNER itembar_user;"

# Step 4: Restore from backup
pg_restore -h localhost -U itembar_user -d itembar_db \
  -F c --no-owner --role=itembar_user \
  /opt/itemba/backups/daily/itembar_YYYYMMDD.dump

# Step 5: Verify restore
psql -U itembar_user -d itembar_db \
  -c "SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM audit_logs;"

# Step 6: Restart application
docker compose -f docker-compose.production.yml up -d

# Step 7: Verify health check
curl https://[your-domain]/api/v1/health
```

---

## 6. Point-in-Time Recovery (PITR)

PITR allows you to restore the database to any point in time within the WAL archive window (7 days).

### Setting Up WAL Archiving
In `postgresql.conf`:
```
wal_level = replica
archive_mode = on
archive_command = 'cp %p /opt/itemba/wal_archive/%f'
restore_command = 'cp /opt/itemba/wal_archive/%f %p'
```

### Performing a PITR Restore
```bash
# 1. Restore the base backup
pg_basebackup -h localhost -U replication_user -D /opt/itemba/pg_pitr_restore -P

# 2. Create recovery.conf (or recovery settings in postgresql.conf for PG12+)
cat > /opt/itemba/pg_pitr_restore/recovery.conf << EOF
restore_command = 'cp /opt/itemba/wal_archive/%f %p'
recovery_target_time = '2025-08-15 14:30:00 Africa/Dar_es_Salaam'
recovery_target_action = promote
EOF

# 3. Start PostgreSQL with the restore directory and verify
```

---

## 7. Disaster Recovery Testing

**Frequency:** Quarterly full disaster recovery test required.

### DR Test Procedure
1. Notify the team that a DR test will be performed.
2. Provision a clean test server (or spin up a new VM).
3. Install PostgreSQL and Docker.
4. Transfer the latest off-site backup to the test server.
5. Follow the Full Restore procedure (Section 5) on the test server.
6. Start the application stack.
7. Verify: login, dashboard, sample transaction.
8. Document results: time taken, any issues encountered.
9. Record in the **DR Test Log** with the date and outcome.
10. Decommission the test server.

**Target Recovery Time Objective (RTO):** ≤ 4 hours from decision to restore to application operational.
**Target Recovery Point Objective (RPO):** ≤ 24 hours (last daily backup).

---

## 8. Backup Monitoring and Alerts

### Backup Completion Monitoring
Add to the cron job or backup scripts:
- Log successful completions with timestamp and file size.
- Send alert email if backup fails.
- Navigate to **Settings → System → Backup** in ITEMBA-R to see recent backup events.

### Backup Size Trend
Monitor backup file size daily. A sudden significant increase may indicate data issues or a large data import. A sudden decrease may indicate data loss.

### Alert Conditions
| Condition | Response |
|---|---|
| Backup not completed by 6:00 AM | Investigate and run manually |
| Backup file size < 50% of previous | Investigate data integrity |
| Off-site sync failed | Fix storage connectivity immediately |
| Restore verification failed | Investigate backup file corruption |

---

## 9. Recovery Time Objectives

| Scenario | RTO | RPO |
|---|---|---|
| Application crash (server still running) | 15 minutes | 0 (no data loss) |
| Database corruption (server intact) | 1 hour | Up to 24 hours (last daily backup) |
| Server hardware failure | 4 hours | Up to 24 hours |
| Complete site disaster | 8 hours | Up to 24 hours |
| Point-in-time recovery (WAL archive) | 2 hours | Up to 15 minutes |
