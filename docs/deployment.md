# ITEMBA-R Deployment Guide

## Overview
ITEMBA-R is a multi-company enterprise management platform. This guide covers deployment using Docker.

## Prerequisites
- Docker 24+ and Docker Compose v2
- Node.js 20+ (for local development)
- PostgreSQL 16 (via Docker or managed)
- 4GB RAM minimum (8GB recommended for production)

## Environment Variables

### Backend
Copy `backend/.env.example` to `backend/.env` and configure:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | Yes | JWT access-token signing secret (min 64 chars) |
| `JWT_REFRESH_SECRET` | Yes | Refresh token signing secret |
| `PORT` | No | Server port (default: 3001) |
| `NODE_ENV` | No | Environment (development/staging/production/test) |
| `CORS_ORIGIN` | Yes in staging/prod | Public frontend origin allowed by backend CORS |

### Frontend
Copy `frontend/.env.example` to `frontend/.env.local` and configure:

| Variable | Required | Description |
|---|---|---|
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
```

For local Windows environments where Prisma's query engine DLL is locked by a running process, use:

```bash
npm run verify:backend:locked
npm run verify:frontend:local
```

The verification pipeline validates the Prisma schema, typechecks backend and frontend code, and builds both applications.

## Production Deployment

```bash
# 1. Configure production environment values
# Required at minimum:
# POSTGRES_PASSWORD, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, REDIS_PASSWORD,
# CORS_ORIGIN, BACKEND_INTERNAL_URL, NEXT_PUBLIC_API_URL

# 2. Deploy with Docker Compose
docker-compose -f docker-compose.production.yml up -d

# 3. Run migrations (first deploy only)
docker exec itemba_r_backend_prod npx prisma migrate deploy --schema=../database/prisma/schema.prisma

# 4. Run seed (first deploy only)
docker exec itemba_r_backend_prod npm run db:seed
```

## Health Checks
- Backend: `GET /api/v1/health`
- PostgreSQL: `pg_isready` check built into Docker healthcheck

## Rollback
1. In the Deployment → Releases UI, click Rollback on the failed release
2. Re-deploy the previous release tag:
   ```bash
   docker-compose -f docker-compose.production.yml down
   # Update image tags in compose file or .env
   docker-compose -f docker-compose.production.yml up -d
   ```
3. If schema rollback needed, restore from backup before migrating

## Security Notes
- Never commit `.env` files to version control
- Use secrets manager (e.g., HashiCorp Vault, AWS Secrets Manager) in production
- Rotate `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` periodically
- Enable TLS termination at load balancer level
