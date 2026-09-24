#!/usr/bin/env bash
#
# Rehearse the production upgrade on a COPY of the production database.
#
#   PROD_SSH=root@<droplet> bash scripts/upgrade-rehearsal/rehearse.sh <backup.dump[.gz]>
#
# Takes a production backup made by deploy/relaunch/backup-db.sh (pg_dump -Fc,
# optionally gzipped), restores it into a throwaway Postgres 16 container (the
# version production runs), and then, exactly as a real deploy would:
#
#   0. checks that the release's backend would accept production's settings:
#      the release's own startup validation (env.validation.ts) run against
#      the backend environment production would resolve for this release
#      (the release's docker-compose.production.yml + production's
#      .env.production, resolved on the droplet and streamed over SSH, never
#      written to disk here). Nothing is started, so no production credential
#      is used. On 2026-09-24 a release migrated production and then its
#      backend refused production's settings; this step would have stopped it.
#   1. records the numbers that must not change (reconcile.sql)
#   2. previews which existing rows the pending migrations will change (preview.sql)
#   3. runs `prisma migrate deploy`, the same command the production
#      backend-migrate job runs, and times it
#   4. records the numbers again and compares them
#
# Apart from step 0's read-only settings query, it never connects to
# production: the only database it touches is the one it creates. Run it from the repo root with the release commit checked out and
# backend dependencies installed (npm ci in backend/). Needs Docker.
#
# Options (environment variables):
#   PROD_SSH=user@host  production droplet for step 0 (required unless
#                     SKIP_BACKEND_ENV_CHECK=1, e.g. when rehearsing a local dump)
#   DEPLOY_DIR=/opt/itemba-r  checkout on the droplet holding .env.production
#   KEEP=1            leave the rehearsal database running afterwards, so the
#                     app can be pointed at it for spot checks
#   PORT=55432        host port for the rehearsal database
#   PG_IMAGE=postgres:16-alpine
#   OUT_DIR=...       where reports go (default tmp/upgrade-rehearsal/<time>)
#
# Exit code 0 means: every migration applied, and nothing changed except what
# the migrations are meant to change. Anything else fails, with the reason.

set -euo pipefail

DUMP="${1:-}"
PORT="${PORT:-55432}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
KEEP="${KEEP:-0}"
CONTAINER="itemba-upgrade-rehearsal"
DB="rehearsal"
PASSWORD="rehearsal-$(date +%s)"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$REPO_DIR/scripts/upgrade-rehearsal"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${OUT_DIR:-$REPO_DIR/tmp/upgrade-rehearsal/$STAMP}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() {
  printf '\n\033[1;31mREHEARSAL FAILED: %s\033[0m\n' "$*" >&2
  exit 1
}

[ -n "$DUMP" ] || fail "usage: bash scripts/upgrade-rehearsal/rehearse.sh <backup.dump[.gz]>"
[ -s "$DUMP" ] || fail "backup not found or empty: $DUMP"
command -v docker >/dev/null || fail "Docker is required"
[ -d "$REPO_DIR/backend/node_modules/prisma" ] || fail "run 'npm ci' in backend/ first"
if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  fail "a container named $CONTAINER already exists; remove it (docker rm -f $CONTAINER) and rerun"
fi

mkdir -p "$OUT_DIR"
cleanup() {
  if [ "$KEEP" != "1" ]; then docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

psql_in() { docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 "$@"; }

log "Release under test: $(git -C "$REPO_DIR" rev-parse --short HEAD) ($(git -C "$REPO_DIR" log -1 --format=%s))"
log "Reports: $OUT_DIR"

if [ "${SKIP_BACKEND_ENV_CHECK:-0}" = "1" ]; then
  log "SKIPPED: backend settings check (SKIP_BACKEND_ENV_CHECK=1). Do not deploy on this rehearsal alone."
else
  [ -n "${PROD_SSH:-}" ] ||
    fail "set PROD_SSH=user@droplet so the release's backend can be checked against production's settings (or SKIP_BACKEND_ENV_CHECK=1 for a local dump)"
  log "Would this release's backend accept production's settings?"
  # The droplet resolves THIS release's compose file (sent on stdin) against
  # its own .env.production; only the backend's environment comes back, and it
  # goes straight into the release's validator, never to a file.
  set +e
  ssh -o BatchMode=yes "$PROD_SSH"     "cd '${DEPLOY_DIR:-/opt/itemba-r}' && docker compose --env-file .env.production -f - config --format json"     <"$REPO_DIR/docker-compose.production.yml" 2>"$OUT_DIR/backend-env-resolve.log" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{if(!s){process.exit(3)}process.stdout.write(JSON.stringify(JSON.parse(s).services.backend.environment))})' |
    (cd "$REPO_DIR/backend" && npx ts-node --transpile-only -P tsconfig.json       ../scripts/upgrade-rehearsal/check-backend-env.ts) >"$OUT_DIR/backend-env-check.txt" 2>&1
  statuses=("${PIPESTATUS[@]}")
  set -e
  cat "$OUT_DIR/backend-env-check.txt"
  if [ "${statuses[0]}" != "0" ] || [ "${statuses[1]}" != "0" ]; then
    tail -5 "$OUT_DIR/backend-env-resolve.log" >&2
    fail "could not resolve production's backend settings over SSH (see $OUT_DIR/backend-env-resolve.log)"
  fi
  [ "${statuses[2]}" = "0" ] ||
    fail "this release's backend would refuse production's settings (above). Deploying it would migrate production and then leave the site down. Fix the settings or the release first."
fi

log "Starting a throwaway $PG_IMAGE on port $PORT"
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD="$PASSWORD" -e POSTGRES_DB="$DB" \
  -p "127.0.0.1:$PORT:5432" "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U postgres -d "$DB" >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U postgres -d "$DB" >/dev/null || fail "database did not start"

log "Restoring the backup ($(du -h "$DUMP" | cut -f1))"
restore() {
  case "$DUMP" in
    *.gz) gunzip -c "$DUMP" ;;
    *) cat "$DUMP" ;;
  esac | docker exec -i "$CONTAINER" pg_restore -U postgres -d "$DB" --no-owner --no-privileges
}
if ! restore >"$OUT_DIR/restore.log" 2>&1; then
  tail -20 "$OUT_DIR/restore.log" >&2
  fail "the backup did not restore cleanly (full log: $OUT_DIR/restore.log). A backup that cannot be restored is not a backup: fix this before deploying."
fi
log "Backup restored: this backup is proven restorable"

DATABASE_URL="postgresql://postgres:$PASSWORD@127.0.0.1:$PORT/$DB"
prisma() {
  (cd "$REPO_DIR/backend" && DATABASE_URL="$DATABASE_URL" npx prisma "$@" \
    --schema=../database/prisma/schema.prisma)
}

log "Migration status before the upgrade"
prisma migrate status >"$OUT_DIR/migrate-status-before.txt" 2>&1 || true
grep -iE "have not yet been applied|pending|up to date|following migration" \
  "$OUT_DIR/migrate-status-before.txt" | head -3 || true
if grep -qiE "failed|drift|not found locally|modified after" "$OUT_DIR/migrate-status-before.txt"; then
  cat "$OUT_DIR/migrate-status-before.txt" >&2
  fail "production's migration history does not match this release; resolve it before deploying"
fi

log "Recording the numbers that must not change (before)"
psql_in -At -F '|' <"$HERE/reconcile.sql" >"$OUT_DIR/reconcile-before.txt"
wc -l <"$OUT_DIR/reconcile-before.txt" | xargs printf '    %s checks recorded\n'

log "Previewing the existing rows the migrations will change"
psql_in -P pager=off <"$HERE/preview.sql" >"$OUT_DIR/preview.txt"
cat "$OUT_DIR/preview.txt"

log "Applying the pending migrations (prisma migrate deploy, as production does)"
started=$(date +%s)
if ! prisma migrate deploy >"$OUT_DIR/migrate-deploy.log" 2>&1; then
  tail -30 "$OUT_DIR/migrate-deploy.log" >&2
  fail "a migration failed on production data (full log: $OUT_DIR/migrate-deploy.log). Production would stop at the same point; do not deploy until this is fixed."
fi
seconds=$(($(date +%s) - started))
applied=$(grep -c "Applying migration" "$OUT_DIR/migrate-deploy.log" || true)
log "Applied $applied migrations in ${seconds}s (plan at least this long for the maintenance window)"

prisma migrate status >"$OUT_DIR/migrate-status-after.txt" 2>&1 ||
  fail "migration status is not clean after the upgrade (see $OUT_DIR/migrate-status-after.txt)"

log "Recording the numbers again (after)"
psql_in -At -F '|' <"$HERE/reconcile.sql" >"$OUT_DIR/reconcile-after.txt"

log "Comparing"
# compare.sh holds the list of checks the migrations are meant to change; the
# same script is used against production on deploy day.
set +e
comparison=$(bash "$HERE/compare.sh" "$OUT_DIR/reconcile-before.txt" "$OUT_DIR/reconcile-after.txt")
compared=$?
set -e
{
  echo "Upgrade rehearsal $STAMP"
  echo "Release: $(git -C "$REPO_DIR" rev-parse HEAD)"
  echo "Backup:  $DUMP"
  echo "Migrations applied: $applied in ${seconds}s"
  echo
  echo "$comparison"
} >"$OUT_DIR/summary.txt"
cat "$OUT_DIR/summary.txt"
[ "$compared" -eq 0 ] ||
  fail "numbers changed that the migrations should not change (see above and $OUT_DIR/summary.txt)"

printf '\n\033[1;32mREHEARSAL PASSED\033[0m: every migration applied to a copy of production, and\n'
printf 'trial balances, account balances, stock, customer, supplier and cash balances,\n'
printf 'sales and supplier invoices are unchanged. Reports: %s\n' "$OUT_DIR"
if [ "$KEEP" = "1" ]; then
  printf '\nThe upgraded copy is still running. Point a local backend at it with:\n'
  printf '  DATABASE_URL=%s\n' "$DATABASE_URL"
  printf 'and remove it afterwards with: docker rm -f %s\n' "$CONTAINER"
fi
