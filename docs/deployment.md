# ITEMBA-R Deployment Guide

## Overview
ITEMBA-R is a multi-company enterprise management platform. This guide covers deployment using Docker.

## Prerequisites
- Docker 24+ and Docker Compose v2
- Node.js 20+ (for local development)
- PostgreSQL 16 (via Docker or managed)
- 4GB RAM minimum (8GB recommended for production)

## Environment Variables

### Compose deployment
Copy `.env.production.example` to `.env.production` or `.env.staging.example` to `.env.staging`
and configure every deployment secret before starting Compose.

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | Yes | PostgreSQL password used by the app database |
| `REDIS_PASSWORD` | Yes | Redis password; Redis starts with `--requirepass` |
| `JWT_ACCESS_SECRET` | Yes | JWT access-token signing secret |
| `JWT_REFRESH_SECRET` | Yes | Refresh token signing secret |
| `TWO_FACTOR_ENCRYPTION_KEY` | Yes | TOTP/2FA encryption key |
| `REFRESH_TOKEN_PEPPER` | Yes | Refresh-token hash pepper |
| `APP_ENCRYPTION_KEY` | Yes | Field-level application encryption key |
| `FRONTEND_URL` | Yes | Public frontend origin |
| `CORS_ORIGIN` | Yes | Public frontend origin allowed by backend CORS |
| `BACKEND_INTERNAL_URL` | Yes | Server-side backend URL used by Next.js API routes; must include `/api/v1` |
| `NEXT_PUBLIC_API_URL` | Yes | Browser-public backend API URL; most browser calls should still use `/api/backend/*` |

## Development Setup

```bash
# Start services
docker-compose up -d

# Run migrations
cd backend && npx prisma migrate dev --schema=../database/prisma/schema.prisma

# Seed database
npm run db:seed

# Start backend
npm run start:dev

# Start frontend (separate terminal)
cd frontend && npm run dev
```

## Verification Before Deploy

Run the full verification pipeline from the repository root:

```bash
npm run verify
npm run verify:deploy
```

For local Windows environments where Prisma's query engine DLL is locked by a running process, use:

```bash
npm run verify:backend:locked
npm run verify:frontend:local
```

The verification pipeline validates the Prisma schema, typechecks backend and frontend code, and builds both applications.
`npm run verify:deploy` validates the staging and production env contract, required secret fail-fast
behavior, Compose shape, migration service dependency, and runtime healthcheck definitions.

To rehearse the production Compose runtime locally, use the guarded smoke script:

```bash
npm run smoke:deploy -- --allow-local
```

The smoke script creates disposable Compose volumes, applies migrations through `backend-migrate`,
waits for backend readiness, verifies the frontend login route, and then removes the stack.

## Production Deployment

```bash
# 1. Configure production environment values
# Required at minimum:
# POSTGRES_PASSWORD, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, REDIS_PASSWORD,
# TWO_FACTOR_ENCRYPTION_KEY, REFRESH_TOKEN_PEPPER, APP_ENCRYPTION_KEY,
# FRONTEND_URL, CORS_ORIGIN, BACKEND_INTERNAL_URL, NEXT_PUBLIC_API_URL

# 2. Validate deployment contract
npm run verify:deploy

# 3. Deploy with Docker Compose. The backend-migrate service applies migrations
# before the backend is allowed to start.
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build

# 4. Run seed only when intentionally bootstrapping a fresh environment
docker exec itemba_r_backend_prod npm run db:seed
```

## Health Checks
- Backend readiness: `GET /api/v1/health/ready`
- Frontend: `GET /login`
- PostgreSQL: `pg_isready` check built into Docker healthcheck
- Redis: authenticated `redis-cli ping` check built into Docker healthcheck

## Rollback
1. In the Deployment → Releases UI, click Rollback on the failed release
2. Re-deploy the previous release tag:
   ```bash
   docker compose --env-file .env.production -f docker-compose.production.yml down
   # Update image tags in compose file or .env
   docker compose --env-file .env.production -f docker-compose.production.yml up -d
   ```
3. If schema rollback needed, restore from backup before migrating

## Security Notes
- Never commit `.env` files to version control
- Use secrets manager (e.g., HashiCorp Vault, AWS Secrets Manager) in production
- Rotate `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` periodically
- Enable TLS termination at load balancer level
