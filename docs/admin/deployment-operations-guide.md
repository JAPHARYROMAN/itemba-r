# Deployment & Operations Guide

## Overview

This guide covers production deployment of ITEMBA-R using Docker Compose, environment variable configuration, database migration and seeding, health checks, log management, performance monitoring, and rollback procedures.

---

## 1. Production Docker Setup

ITEMBA-R uses `docker-compose.production.yml` for production deployment.

### Starting the Production Stack
```bash
cd /opt/itemba-r

# Pull the latest images (if using registry)
docker compose -f docker-compose.production.yml pull

# Start all services in detached mode
docker compose -f docker-compose.production.yml up -d

# Check all containers are running
docker compose -f docker-compose.production.yml ps
```

### Expected Running Containers
| Container | Image | Port | Description |
|---|---|---|---|
| `itemba-postgres` | postgres:16 | 5432 (internal) | PostgreSQL database |
| `itemba-backend` | itemba/backend:latest | 3001 | NestJS API |
| `itemba-frontend` | itemba/frontend:latest | 3000 | Next.js frontend |

### Stopping the Stack
```bash
docker compose -f docker-compose.production.yml down
```

### Viewing Container Logs
```bash
# All containers
docker compose -f docker-compose.production.yml logs -f --tail=200

# Specific container
docker compose -f docker-compose.production.yml logs -f backend
docker compose -f docker-compose.production.yml logs -f postgres
```

---

## 2. Environment Variables Reference

### Backend Environment Variables (`backend/.env`)

| Variable | Required | Description | Example |
|---|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string | `postgresql://itembar_user:password@localhost:5432/itembar_db` |
| `JWT_ACCESS_SECRET` | ✅ | Secret for signing access tokens (min 32 chars) | Long random string |
| `JWT_REFRESH_SECRET` | ✅ | Secret for signing refresh tokens (different from access) | Long random string |
| `JWT_ACCESS_EXPIRY` | ✅ | Access token lifetime | `15m` |
| `JWT_REFRESH_EXPIRY` | ✅ | Refresh token lifetime | `7d` |
| `PORT` | Optional | Backend API port | `3001` |
| `NODE_ENV` | ✅ | Environment | `production` |
| `FRONTEND_URL` | ✅ | Frontend origin for CORS | `https://app.itemba.local` |
| `SMTP_HOST` | Optional | SMTP server hostname | `smtp.gmail.com` |
| `SMTP_PORT` | Optional | SMTP port | `587` |
| `SMTP_USER` | Optional | SMTP username | `notifications@itemba.local` |
| `SMTP_PASS` | Optional | SMTP password | Secure value |
| `SMTP_FROM_NAME` | Optional | From name for emails | `ITEMBA-R System` |
| `SMTP_FROM_EMAIL` | Optional | From email address | `notifications@itemba.local` |
| `SEED_ADMIN_EMAIL` | Optional | Override seed admin email | `admin@itemba.local` |
| `SEED_ADMIN_PASSWORD` | Optional | Override seed admin password | Secure value |
| `BACKUP_DIR` | Optional | Path for backup storage | `/opt/itemba/backups` |

### Frontend Environment Variables (`frontend/.env.local`)

| Variable | Required | Description | Example |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | ✅ | Backend API base URL | `https://api.itemba.local/api/v1` |
| `NEXT_PUBLIC_APP_NAME` | Optional | Application name in UI | `ITEMBA-R` |
| `NEXT_PUBLIC_COMPANY_NAME` | Optional | Group name | `Itemba Group of Companies` |

### Generating Secure Secrets
```bash
# Generate JWT secrets (Linux/macOS)
openssl rand -base64 64

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
```

---

## 3. Running Migrations

Always run migrations before starting the application after an update.

```bash
cd /opt/itemba-r/backend

# Run all pending migrations
npx prisma migrate deploy --schema=../database/prisma/schema.prisma

# Verify migration status
npx prisma migrate status --schema=../database/prisma/schema.prisma
```

### Migration Output Interpretation
- `Database schema is up to date!` — No action needed.
- `N migrations have been applied.` — Migrations ran successfully.
- `Found failed migration` — A migration failed — see Section troubleshooting for manual rollback steps.

---

## 4. Running Seed Data

Seed data initializes the system with the group structure, companies, roles, admin user, and (optionally) demonstration/QA data.

```bash
cd /opt/itemba-r/backend

# Run the full seed
npm run db:seed

# The seed creates:
# - Itemba Group record
# - 3 companies: Mwanjalisi Oil, Westsides, Itemba Enterprises
# - All divisions and branches
# - 26 roles with permissions
# - Admin user (admin@itemba.local / ChangeMe!123 or env override)
# - QA test suites (22 suites for M16)
# - User manuals, help articles
# - Training courses and walkthroughs
# - Sample compliance obligations
```

> **Seed is idempotent** — running it multiple times will not create duplicate records. It uses upsert operations for all seed entities.

### Training Environment Seed
For the training environment, run with the training profile:
```bash
SEED_PROFILE=training npm run db:seed
```
This adds additional demo data (sample transactions, demo employees, sample fuel shifts).

---

## 5. Health Check Endpoints

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/v1/health` | GET | None | Full health check (DB, queue, storage) |
| `/api/v1/health/db` | GET | None | Database connectivity only |
| `/api/v1/health/ready` | GET | None | Kubernetes readiness probe |
| `/api/v1/health/live` | GET | None | Kubernetes liveness probe |

### Example Health Check Response
```json
{
  "status": "ok",
  "timestamp": "2025-08-15T10:30:00.000Z",
  "database": "connected",
  "responseTimeMs": 12,
  "version": "1.0.0",
  "environment": "production"
}
```

---

## 6. Log Aggregation

### Application Logs
NestJS logs are written to stdout. Docker captures them:
```bash
# Follow backend logs
docker compose -f docker-compose.production.yml logs -f backend | grep -v "DEBUG"

# Follow with timestamps
docker compose -f docker-compose.production.yml logs -f -t backend
```

### Log Levels
- `ERROR` — Application errors requiring attention
- `WARN` — Warnings (non-critical issues)
- `LOG` — General application events
- `DEBUG` — Verbose debugging (disable in production: set `LOG_LEVEL=warn`)

### Centralizing Logs
For production, configure log shipping to a centralized log system:
```bash
# Option: ship to syslog
docker run ... --log-driver=syslog --log-opt syslog-address=udp://logs.itemba.local:514

# Option: use a logging sidecar (Fluentd, Logstash)
```

---

## 7. Performance Monitoring

### Key Metrics to Monitor
| Metric | Tool | Alert Threshold |
|---|---|---|
| API response time (p95) | Application logs / APM | > 2 seconds |
| Database query time | pg_stat_statements | > 500ms per query |
| CPU usage | Docker stats | > 80% sustained |
| Memory usage | Docker stats | > 80% of available |
| Disk usage | Host monitoring | > 80% |
| Error rate | Application logs | > 1% of requests |

### Checking Docker Container Resources
```bash
docker stats --no-stream
```

### Identifying Slow Database Queries
```sql
SELECT query, calls, total_time, mean_time, rows
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 20;
```

---

## 8. Scaling Considerations

### Horizontal Scaling
When load requires multiple backend instances:
1. Deploy multiple `itemba-backend` containers.
2. Put a load balancer (Nginx, Traefik, AWS ALB) in front.
3. Ensure `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are identical across all instances.
4. Use a shared PostgreSQL instance (not per-container).

### Redis Queue (Phase 2)
When background job volume justifies it:
1. Add Redis service to `docker-compose.production.yml`.
2. Set `REDIS_URL` environment variable.
3. The job queue automatically switches from database-backed to Redis/BullMQ.

---

## 9. Rollback Procedure

If a deployment fails or causes a critical issue:

```bash
# Step 1: Take a backup of the current (broken) state for investigation
pg_dump -U itembar_user -d itembar_db -F c -f /opt/itemba/backups/pre-rollback-$(date +%Y%m%d_%H%M).dump

# Step 2: Stop the current containers
docker compose -f docker-compose.production.yml down

# Step 3: Restore the previous Docker images
# Tag the previous stable image before deploying (good practice)
docker tag itemba/backend:latest itemba/backend:rollback
docker pull itemba/backend:previous-version
docker tag itemba/backend:previous-version itemba/backend:latest

# Step 4: Restore the pre-migration database backup
pg_restore -U itembar_user -d itembar_db -F c \
  /opt/itemba/backups/pre-migration/itembar_pre_migration_YYYYMMDD.dump

# Step 5: Start the previous version
docker compose -f docker-compose.production.yml up -d

# Step 6: Verify health check
curl https://[your-domain]/api/v1/health

# Step 7: Document the rollback in the Release Log
```

> **Prevention:** Always tag the current stable image as `stable` before any upgrade. Always take a pre-migration backup.
