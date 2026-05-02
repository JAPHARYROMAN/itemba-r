# ITEMBA-R Environment Variables Reference

This document lists all environment variables used by ITEMBA-R backend and frontend.

## Backend Variables

### Application

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| NODE_ENV | Yes | development | Runtime environment: development, staging, production, test |
| PORT | No | 3001 | HTTP port the backend listens on |
| API_PREFIX | No | api/v1 | URL prefix for all API routes |
| CORS_ORIGIN | No | http://localhost:3000 | Comma-separated frontend origins allowed to call the backend |

### Database

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| DATABASE_URL | Yes | — | Full PostgreSQL connection string |
| POSTGRES_USER | For Docker | itemba | Database username (Docker Compose only) |
| POSTGRES_PASSWORD | For Docker | — | Database password (Docker Compose only) |
| POSTGRES_DB | For Docker | itemba_r | Database name (Docker Compose only) |

### JWT Authentication

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| JWT_ACCESS_SECRET | Yes | — | Secret key for signing access tokens. Min 64 chars. |
| JWT_REFRESH_SECRET | Yes | — | Secret key for refresh tokens. Must differ from JWT_ACCESS_SECRET. |
| JWT_ACCESS_EXPIRES_IN | No | 15m | Access token lifespan (e.g. 15m, 1h) |
| JWT_REFRESH_EXPIRES_IN | No | 7d | Refresh token lifespan (e.g. 7d, 30d) |

### Security

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| THROTTLE_TTL | No | 60 | Rate limit window in seconds |
| THROTTLE_LIMIT | No | 100 | Max requests per window |
| MAX_LOGIN_ATTEMPTS | No | 5 | Failed logins before account lockout |
| ACCOUNT_LOCKOUT_MINUTES | No | 15 | Duration of account lockout |

### Email (SMTP)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| SMTP_HOST | No | — | SMTP server hostname. If blank, email is disabled. |
| SMTP_PORT | No | 587 | SMTP server port |
| SMTP_SECURE | No | false | Use TLS (true for port 465) |
| SMTP_USER | If SMTP_HOST set | — | SMTP authentication username |
| SMTP_PASS | If SMTP_HOST set | — | SMTP authentication password |
| SMTP_FROM | No | noreply@itemba-r.com | From address in sent emails |

### Redis

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| REDIS_HOST | No | localhost | Redis server hostname |
| REDIS_PORT | No | 6379 | Redis server port |
| REDIS_PASSWORD | No | — | Redis authentication password |
| REDIS_TTL | No | 300 | Default cache TTL in seconds |

### File Storage

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| STORAGE_DRIVER | No | local | Storage backend: local or s3 |
| STORAGE_LOCAL_PATH | No | ./storage | Local filesystem path for uploads |
| AWS_ACCESS_KEY_ID | If s3 | — | AWS/S3 access key |
| AWS_SECRET_ACCESS_KEY | If s3 | — | AWS/S3 secret key |
| AWS_REGION | If s3 | — | AWS region (e.g. af-south-1) |
| AWS_S3_BUCKET | If s3 | — | S3 bucket name |
| AWS_S3_ENDPOINT | If custom S3 | — | Custom S3-compatible endpoint URL |

### SMS (Africa's Talking)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| AT_API_KEY | No | — | Africa's Talking API key |
| AT_USERNAME | No | — | Africa's Talking username |
| AT_SENDER_ID | No | ITEMBA-R | SMS sender ID |
| AT_ENVIRONMENT | No | sandbox | sandbox or production |

## Frontend Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| BACKEND_INTERNAL_URL | Yes | http://localhost:3001/api/v1 | Server-side internal backend URL used by Next.js route handlers (proxy + auth). MUST include the API prefix. |
| NEXT_PUBLIC_API_URL | Yes | http://localhost:3001/api/v1 | Browser-public absolute backend URL. MUST include the API prefix. Most browser calls go through the `/api/backend/*` proxy and don't need this. |
| NEXT_PUBLIC_APP_NAME | No | ITEMBA-R | Application display name |
| NEXT_PUBLIC_APP_VERSION | No | — | Application version string |
| NEXT_PUBLIC_MAINTENANCE_MODE | No | false | Show maintenance page when true |
| NEXT_TELEMETRY_DISABLED | No | 1 | Disable Next.js anonymous telemetry |

## Generating Secrets

Generate secure random secrets for production:

```bash
# Using OpenSSL (Linux/Mac/Git Bash)
openssl rand -hex 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Using PowerShell (Windows)
[System.Web.Security.Membership]::GeneratePassword(64, 8)
```

## Important Security Notes

1. **Never commit** `.env.production` or `.env.production.local` to version control
2. Both files are listed in `.gitignore`
3. JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be **different** values
4. Rotate secrets immediately if they are exposed
5. Use a secrets manager (e.g. HashiCorp Vault, AWS Secrets Manager) in enterprise deployments
