# syntax=docker/dockerfile:1

# ── Dependencies ──────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ── Builder ───────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Public env vars are inlined into the client bundle AT BUILD TIME — they must
# be present here, not just at runtime. Pass with --build-arg (see DEPLOY.md).
ARG NEXT_PUBLIC_GA_MEASUREMENT_ID=""
ARG NEXT_PUBLIC_GTM_ID=""
ARG GOOGLE_SITE_VERIFICATION=""
ENV NEXT_PUBLIC_GA_MEASUREMENT_ID=$NEXT_PUBLIC_GA_MEASUREMENT_ID
ENV NEXT_PUBLIC_GTM_ID=$NEXT_PUBLIC_GTM_ID
ENV GOOGLE_SITE_VERIFICATION=$GOOGLE_SITE_VERIFICATION
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Produces .next/standalone (self-contained server + traced node_modules)
RUN npm run build

# ── Runner ────────────────────────────────────────────────────────────────
# Uses Next's standalone output: a minimal server with only the traced
# dependencies, plus the static assets and public files copied alongside.
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Enquiries are persisted to ENQUIRY_STORAGE_DIR (defaults to /app/data via
# process.cwd()/data). /app is root-owned, so this dir must be pre-created and
# owned by the non-root runtime user or every POST /api/enquiries would 500.
# Mount a volume here to persist enquiries across deploys.
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
VOLUME /app/data

USER nextjs
EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

# Liveness against the dedicated JSON endpoint (no curl in slim image — use node)
HEALTHCHECK --interval=30s --timeout=4s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# server.js is emitted by Next's standalone output
CMD ["node", "server.js"]
