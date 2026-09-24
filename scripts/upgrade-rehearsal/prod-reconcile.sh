#!/usr/bin/env bash
#
# Record the reconcile.sql numbers from PRODUCTION, read-only, over SSH.
#
#   bash scripts/upgrade-rehearsal/prod-reconcile.sh <user@droplet> > prod-before.txt
#
# Runs on your machine: the SQL is sent over SSH into the production Postgres
# container, so nothing needs to be copied to the server first. reconcile.sql
# only SELECTs. Run it just before the deploy and again just after, then
# compare the two files with compare.sh.
#
# Options: DEPLOY_DIR (default /opt/itemba-r), COMPOSE_FILE, ENV_FILE.

set -euo pipefail

TARGET="${1:-}"
[ -n "$TARGET" ] || {
  echo "usage: prod-reconcile.sh <user@droplet> > output.txt" >&2
  exit 2
}
DEPLOY_DIR="${DEPLOY_DIR:-/opt/itemba-r}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The inner command runs inside the postgres container, where POSTGRES_USER
# and POSTGRES_DB are set; \$ keeps them from expanding here or on the host.
ssh -o BatchMode=yes "$TARGET" \
  "cd '$DEPLOY_DIR' && docker compose --env-file '$ENV_FILE' -f '$COMPOSE_FILE' exec -T postgres \
    sh -c 'psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1 -At -F \"|\"'" \
  <"$HERE/reconcile.sql"
