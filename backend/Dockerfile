# syntax=docker/dockerfile:1
# Build context: repository root.
# Compose must set:  context: .  /  dockerfile: backend/Dockerfile
# This is required because the Prisma schema lives at database/prisma/schema.prisma
# (sibling of backend/) and must be reachable at install/build time.

# ---- Build stage ---------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN apk add --no-cache openssl

# Install deps first for better layer caching.
COPY backend/package*.json backend/
WORKDIR /app/backend
RUN npm ci

# Bring in the Prisma schema before generation; the schema path is referenced
# from backend/package.json as ../database/prisma/schema.prisma.
WORKDIR /app
COPY database/prisma ./database/prisma

# Source for the backend build.
COPY backend/ ./backend/

WORKDIR /app/backend
RUN ln -s /app/backend/node_modules /app/node_modules \
 && PRISMA_GENERATE_SKIP_AUTOINSTALL=true npx prisma generate --schema=../database/prisma/schema.prisma \
 && npm run build

# ---- Migration stage -----------------------------------------------------
# Keeps the Prisma CLI out of the runtime API image while still allowing
# production compose to run `prisma migrate deploy` before API startup.
FROM builder AS migration
WORKDIR /app/backend
ENV NODE_ENV=production
CMD ["npx", "prisma", "migrate", "deploy", "--schema=../database/prisma/schema.prisma"]

# ---- Production stage ----------------------------------------------------
FROM node:20-alpine AS production
WORKDIR /app/backend
ENV NODE_ENV=production
RUN apk add --no-cache openssl postgresql-client
RUN addgroup -S app && adduser -S app -G app

COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Generated Prisma client (output lives under node_modules/.prisma + @prisma/client).
COPY --from=builder /app/backend/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/backend/node_modules/@prisma ./node_modules/@prisma

# Schema + migrations are needed at runtime for `prisma migrate deploy`.
COPY --from=builder /app/database/prisma /app/database/prisma

COPY --from=builder /app/backend/dist ./dist

RUN mkdir -p /app/storage /app/backups /app/backend/uploads \
 && chown -R app:app /app

USER app
EXPOSE 3001
CMD ["node", "dist/main"]
