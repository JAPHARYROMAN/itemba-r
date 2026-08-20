#!/usr/bin/env bash
# Create and verify an atomic logical backup of the live ITEMBA-R database.

set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/itemba-r}"
COMPOSE_FILE="${COMPOSE_FILE:-${DEPLOY_DIR}/docker-compose.production.yml}"
ENV_FILE="${ENV_FILE:-${DEPLOY_DIR}/.env.production}"
BACKUP_DIR="${BACKUP_DIR:-/opt/itemba-backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

log() { printf '[itemba-backup %s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

cd "$DEPLOY_DIR"
mkdir -p "$BACKUP_DIR"

if [ ! -f "$ENV_FILE" ]; then
  log "ERROR: environment file not found: ${ENV_FILE}"
  exit 1
fi

if [ -z "$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q postgres)" ]; then
  log 'ERROR: the ITEMBA-R postgres container is not running'
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FINAL_FILE="${BACKUP_DIR}/itemba_r-${STAMP}.dump.gz"
PARTIAL_FILE="${FINAL_FILE}.partial"
VERIFY_FILE="/tmp/itemba-backup-verify-${STAMP}.dump"
cleanup() {
  rm -f "$PARTIAL_FILE"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    rm -f "$VERIFY_FILE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "Creating ${FINAL_FILE}"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  sh -ec 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  | gzip -c > "$PARTIAL_FILE"

test -s "$PARTIAL_FILE"
gzip -t "$PARTIAL_FILE"
gunzip -c "$PARTIAL_FILE" \
  | docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
      sh -ec "cat > '${VERIFY_FILE}'"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_restore --list "$VERIFY_FILE" >/dev/null
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  rm -f "$VERIFY_FILE"

mv "$PARTIAL_FILE" "$FINAL_FILE"
trap - EXIT

find "$BACKUP_DIR" -name 'itemba_r-*.dump.gz' -type f \
  -mtime "+${BACKUP_KEEP_DAYS}" -delete

log "Verified backup complete: ${FINAL_FILE} ($(du -h "$FINAL_FILE" | cut -f1))"
printf '%s\n' "$FINAL_FILE"
