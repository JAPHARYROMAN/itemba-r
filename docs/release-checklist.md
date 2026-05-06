# ITEMBA-R Release Checklist

Use this checklist before deploying to production.

## Pre-Deployment

### Code Quality
- [ ] TypeScript: `npx tsc --noEmit` passes on both backend and frontend (0 errors)
- [ ] Linting passes on backend and frontend
- [ ] All PR reviews approved

### Database
- [ ] Prisma schema validated: `npx prisma validate --schema=database/prisma/schema.prisma`
- [ ] Migration tested on a disposable database with `npx prisma migrate deploy`
- [ ] `backend-migrate` Compose service completed successfully before backend startup
- [ ] Migration is backwards-compatible (no data-destroying changes)
- [ ] Seed data verified on staging

### Security
- [ ] No secrets committed to version control
- [ ] `.env` files not tracked in git
- [ ] JWT secrets rotated if required
- [ ] All new endpoints have permission guards
- [ ] Audit logging in place for all sensitive actions

### Public Domain & Email
- [ ] Domain purchased or transferred to managed DNS
- [ ] `staging.itembagrouptz.com`, `api-staging.itembagrouptz.com`, `app.itembagrouptz.com`, and `api.itembagrouptz.com` resolve to the deployment target
- [ ] TLS certificates are active for every public hostname
- [ ] Caddy is the only service exposing public web ports `80` and `443`
- [ ] `.env.staging` and `.env.production` use HTTPS public URLs, not localhost
- [ ] `npm run verify:public-env -- staging` passes
- [ ] `npm run verify:public-env -- production` passes
- [ ] `npm run verify:domain-dns -- staging` passes
- [ ] `npm run verify:domain-dns -- production` passes
- [ ] Domain email is configured with MX, SPF, DKIM, and DMARC
- [ ] `SMTP_FROM` uses the organization domain
- [ ] Live SMTP smoke passes for staging and production

### Performance
- [ ] New endpoints have pagination
- [ ] New queries use company scope filters
- [ ] No N+1 query patterns introduced
- [ ] Database indexes added for new high-traffic models

### Multi-Company Isolation
- [ ] New modules respect company scoping
- [ ] Data isolation tests pass on staging
- [ ] No cross-company data leaks detected

### Docker
- [ ] Backend Docker image builds successfully
- [ ] Frontend Docker image builds successfully
- [ ] `npm run verify:deploy` passes
- [ ] Production Compose smoke passes in CI, or locally with `npm run smoke:deploy -- --allow-local`

### Smoke Coverage
- [ ] Auth flow passes: `npm run smoke:auth-flow`
- [ ] Authenticated dashboard data passes: `npm run smoke:authenticated-dashboard-data`
- [ ] Current live staging dashboard correctness passes without deleting volumes: `npm run smoke:live-dashboard-data -- .env.staging`
- [ ] Registry API CRUD passes: `npm run smoke:registry-crud`
- [ ] Registry browser CRUD passes: `npm run smoke:registry-ui`
- [ ] Document print and generated PDF letterhead passes: `npm run smoke:document-print`
- [ ] Dynamic frontend records pass: `npm run smoke:dynamic-frontend-records`
- [ ] File persistence passes: `npm run smoke:file-persistence`
- [ ] Backup/restore artifact verification passes: `npm run smoke:backup-restore-artifact`
- [ ] Current live staging storage/backup check passes without deleting volumes: `npm run smoke:live-storage-backup -- .env.staging`

## Deployment

### Steps
1. Create a Deployment Release record in ITEMBA-R (Deployment → Releases → New Release)
2. Set `environment = STAGING`, run final checks
3. If staging passes, create a PRODUCTION release record
4. Run: `npm run verify:deploy`
5. Run: `docker compose --env-file .env.production -f docker-compose.production.yml pull && docker compose --env-file .env.production -f docker-compose.production.yml up -d`
6. Confirm `backend-migrate` exited successfully and backend/frontend are healthy
7. Mark release as Deployed in ITEMBA-R UI
8. Monitor error logs for 15 minutes post-deployment

### Health Verification
- [ ] Backend readiness check responds: `GET /api/v1/health/ready`
- [ ] Frontend loads correctly
- [ ] Login works
- [ ] Key dashboard loads (Executive, Finance, Petroleum)
- [ ] Background job queue is processing

## Post-Deployment

### Monitoring
- Check: Monitoring → System Health
- Check: Performance & Ops → Background Jobs (no DEAD_LETTER backlog)
- Check: Security → Security Events (no unexpected events)
- Check: Error Logs (no new critical errors)

### Rollback Trigger Conditions
- Health check failing after 3 retries
- Critical errors in error logs
- Login or auth failures
- Data corruption detected

### Rollback Steps
1. Mark release as ROLLED_BACK in ITEMBA-R UI
2. `docker compose --env-file .env.production -f docker-compose.production.yml down`
3. Restore previous image tags
4. `docker compose --env-file .env.production -f docker-compose.production.yml up -d`
5. If schema changes were made, restore from latest backup
6. Verify health check passes

## Environment Inventory

| Service | Production Port | Health Check |
|---|---|---|
| Backend API | 3001 | `GET /api/v1/health/ready` |
| Frontend | 3000 | HTTP 200 on `/login` |
| PostgreSQL | 5432 | `pg_isready` |
| Redis | 6379 | authenticated `redis-cli ping` |
| Caddy | 80/443 | `caddy validate` |
