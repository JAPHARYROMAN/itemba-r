#!/usr/bin/env bash
set -euo pipefail
umask 077

# This script is intentionally a narrow consumer of an already signed release.
# It never generates evidence, changes acceptance digests, runs migrations, or
# rebuilds source. The ordinary deployment must first leave the same source
# commit healthy with every Msaidizi switch dark.

if [ "$#" -ne 1 ]; then
  echo 'ERROR: expected one absolute promotion-request path.' >&2
  exit 1
fi

REQUEST_FILE="$1"
if [[ "$REQUEST_FILE" != /* ]] || [ ! -f "$REQUEST_FILE" ] || [ -L "$REQUEST_FILE" ]; then
  echo 'ERROR: promotion request must be an absolute, real regular file.' >&2
  exit 1
fi

declare -A REQUEST_KEYS=()
while IFS= read -r LINE || [ -n "$LINE" ]; do
  if [[ ! "$LINE" =~ ^([A-Z0-9_]+)=([A-Za-z0-9_./:@-]+)$ ]]; then
    echo 'ERROR: promotion request contains a malformed line.' >&2
    exit 1
  fi
  KEY="${BASH_REMATCH[1]}"
  VALUE="${BASH_REMATCH[2]}"
  case "$KEY" in
    MSAIDIZI_CRUD_EVIDENCE_KEY_ID|MSAIDIZI_CRUD_EVIDENCE_PATH|MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_PATH|MSAIDIZI_CRUD_RELEASE_BUNDLE_PATH|MSAIDIZI_CRUD_RELEASE_KEY_ID|MSAIDIZI_CRUD_RELEASE_PUBLIC_KEY_PATH|MSAIDIZI_PRODUCTION_ACCEPTED_EVIDENCE_SHA256|MSAIDIZI_PRODUCTION_ACCEPTED_IMAGE_DIGEST|MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256|MSAIDIZI_PRODUCTION_TARGET_ID|MSAIDIZI_PROMOTION_BACKEND_IMAGE|MSAIDIZI_PROMOTION_CENTRAL_INVENTORY_PATH|MSAIDIZI_PROMOTION_RELEASE_RUN_ATTEMPT|MSAIDIZI_PROMOTION_RELEASE_RUN_ID|MSAIDIZI_PROMOTION_REPOSITORY|MSAIDIZI_PROMOTION_RING|MSAIDIZI_PROMOTION_STAGE|MSAIDIZI_REPOSITORY_ROOT|MSAIDIZI_RING_ENV_FILE) ;;
    *)
      echo "ERROR: unsupported promotion request field: $KEY" >&2
      exit 1
      ;;
  esac
  if [ -n "${REQUEST_KEYS[$KEY]:-}" ]; then
    echo "ERROR: duplicate promotion request field: $KEY" >&2
    exit 1
  fi
  REQUEST_KEYS[$KEY]=1
  printf -v "$KEY" '%s' "$VALUE"
  export "$KEY"
done < "$REQUEST_FILE"

REQUIRED_KEYS=(
  MSAIDIZI_CRUD_EVIDENCE_KEY_ID
  MSAIDIZI_CRUD_EVIDENCE_PATH
  MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_PATH
  MSAIDIZI_CRUD_RELEASE_BUNDLE_PATH
  MSAIDIZI_CRUD_RELEASE_KEY_ID
  MSAIDIZI_CRUD_RELEASE_PUBLIC_KEY_PATH
  MSAIDIZI_PRODUCTION_ACCEPTED_EVIDENCE_SHA256
  MSAIDIZI_PRODUCTION_ACCEPTED_IMAGE_DIGEST
  MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256
  MSAIDIZI_PRODUCTION_TARGET_ID
  MSAIDIZI_PROMOTION_BACKEND_IMAGE
  MSAIDIZI_PROMOTION_CENTRAL_INVENTORY_PATH
  MSAIDIZI_PROMOTION_RELEASE_RUN_ATTEMPT
  MSAIDIZI_PROMOTION_RELEASE_RUN_ID
  MSAIDIZI_PROMOTION_REPOSITORY
  MSAIDIZI_PROMOTION_RING
  MSAIDIZI_PROMOTION_STAGE
  MSAIDIZI_REPOSITORY_ROOT
  MSAIDIZI_RING_ENV_FILE
)
for KEY in "${REQUIRED_KEYS[@]}"; do
  if [ -z "${!KEY:-}" ]; then
    echo "ERROR: promotion request is missing $KEY." >&2
    exit 1
  fi
done
if [ "${#REQUEST_KEYS[@]}" -ne "${#REQUIRED_KEYS[@]}" ]; then
  echo 'ERROR: promotion request field inventory is not closed.' >&2
  exit 1
fi

for PATH_VALUE in \
  "$MSAIDIZI_CRUD_EVIDENCE_PATH" \
  "$MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_PATH" \
  "$MSAIDIZI_CRUD_RELEASE_BUNDLE_PATH" \
  "$MSAIDIZI_CRUD_RELEASE_PUBLIC_KEY_PATH" \
  "$MSAIDIZI_PROMOTION_CENTRAL_INVENTORY_PATH" \
  "$MSAIDIZI_PROMOTION_STAGE" \
  "$MSAIDIZI_REPOSITORY_ROOT" \
  "$MSAIDIZI_RING_ENV_FILE"; do
  if [[ "$PATH_VALUE" != /* ]]; then
    echo 'ERROR: all target promotion paths must be absolute.' >&2
    exit 1
  fi
done

for TOOL in cmp docker find flock git grep install node stat; do
  command -v "$TOOL" >/dev/null 2>&1 || {
    echo "ERROR: required target tool is unavailable: $TOOL" >&2
    exit 1
  }
done

if [ ! -d "$MSAIDIZI_REPOSITORY_ROOT" ] || [ -L "$MSAIDIZI_REPOSITORY_ROOT" ]; then
  echo 'ERROR: repository root is missing or symbolic.' >&2
  exit 1
fi
if [ ! -d "$MSAIDIZI_PROMOTION_STAGE" ] || [ -L "$MSAIDIZI_PROMOTION_STAGE" ]; then
  echo 'ERROR: promotion stage is missing or symbolic.' >&2
  exit 1
fi
if [ ! -f "$MSAIDIZI_RING_ENV_FILE" ] || [ -L "$MSAIDIZI_RING_ENV_FILE" ]; then
  echo 'ERROR: the operator-owned ring environment file is missing or symbolic.' >&2
  exit 1
fi
if [ "$(stat -c '%u' "$MSAIDIZI_RING_ENV_FILE")" != '0' ]; then
  echo 'ERROR: the ring environment file must be owned by root.' >&2
  exit 1
fi
if find "$MSAIDIZI_RING_ENV_FILE" -prune -perm /022 -print -quit | grep -q .; then
  echo 'ERROR: the ring environment file must not be group/world writable.' >&2
  exit 1
fi
while IFS= read -r RING_LINE || [ -n "$RING_LINE" ]; do
  if [[ "$RING_LINE" =~ ^[[:space:]]*$ ]] || [[ "$RING_LINE" =~ ^[[:space:]]*# ]]; then
    continue
  fi
  if [[ ! "$RING_LINE" =~ ^([A-Z][A-Z0-9_]*)= ]]; then
    echo 'ERROR: ring environment contains a malformed assignment.' >&2
    exit 1
  fi
  RING_KEY="${BASH_REMATCH[1]}"
  case "$RING_KEY" in
    ANTHROPIC_API_KEY) ;;
    MSAIDIZI_PROMOTION_*|MSAIDIZI_PRODUCTION_ACCEPTED_*|MSAIDIZI_CRUD_EVIDENCE_*)
      echo "ERROR: protected release binding owns ring environment field $RING_KEY." >&2
      exit 1
      ;;
    MSAIDIZI_*) ;;
    *)
      echo "ERROR: ring environment may not override non-Msaidizi field $RING_KEY." >&2
      exit 1
      ;;
  esac
done < "$MSAIDIZI_RING_ENV_FILE"

exec 9>/run/lock/itemba-msaidizi-ring-promotion.lock
if ! flock -n 9; then
  echo 'ERROR: another Msaidizi ring promotion is active.' >&2
  exit 1
fi

SCRIPT_ROOT="$MSAIDIZI_PROMOTION_STAGE/scripts"
TARGET_INVENTORY="$MSAIDIZI_PROMOTION_STAGE/target-promotion-inventory.json"
IMAGE_INSPECT="$MSAIDIZI_PROMOTION_STAGE/target-image-inspect.json"
CONTAINER_INSPECT="$MSAIDIZI_PROMOTION_STAGE/target-container-inspect.json"
if [ -e "$TARGET_INVENTORY" ]; then
  echo 'ERROR: target inventory output already exists.' >&2
  exit 1
fi
MSAIDIZI_PROMOTION_INVENTORY_OUTPUT_PATH="$TARGET_INVENTORY" \
  node "$SCRIPT_ROOT/verify-msaidizi-ring-promotion.mjs"
if ! cmp -s -- "$TARGET_INVENTORY" "$MSAIDIZI_PROMOTION_CENTRAL_INVENTORY_PATH"; then
  echo 'ERROR: target and protected-runner promotion inventories differ.' >&2
  exit 1
fi

EXPECTED_COMMIT="$(node -e "const i=require(process.argv[1]); process.stdout.write(i.source.commitSha)" "$TARGET_INVENTORY")"
if [ "$(git -C "$MSAIDIZI_REPOSITORY_ROOT" rev-parse HEAD)" != "$EXPECTED_COMMIT" ]; then
  echo 'ERROR: ordinary production deployment is not at the signed source commit.' >&2
  exit 1
fi

BASE_COMPOSE="$MSAIDIZI_REPOSITORY_ROOT/docker-compose.production.yml"
RING_COMPOSE="$MSAIDIZI_REPOSITORY_ROOT/deploy/relaunch/docker-compose.msaidizi-ring.yml"
BASE_ENV="$MSAIDIZI_REPOSITORY_ROOT/.env.production"
for REQUIRED_FILE in "$BASE_COMPOSE" "$RING_COMPOSE" "$BASE_ENV"; do
  if [ ! -f "$REQUIRED_FILE" ] || [ -L "$REQUIRED_FILE" ]; then
    echo "ERROR: required production file is missing or symbolic: $REQUIRED_FILE" >&2
    exit 1
  fi
done

COMPOSE_BASE=(docker compose --env-file "$BASE_ENV" -f "$BASE_COMPOSE")
if ! "${COMPOSE_BASE[@]}" exec -T backend node -e \
  "const keys='MSAIDIZI_ENABLED MSAIDIZI_AUTONOMY_ENABLED MSAIDIZI_TASK_WORKER_ENABLED MSAIDIZI_AUTOPILOT_ENABLED MSAIDIZI_HOST_EXECUTION_ENABLED MSAIDIZI_ADAPTIVE_REASONING_ENABLED MSAIDIZI_DEVICE_PAIRING_ENABLED MSAIDIZI_DEVICE_CHANNEL_ENABLED MSAIDIZI_DIRECT_MTLS_ENABLED MSAIDIZI_SUPERVISOR_ENROLLMENT_ENABLED MSAIDIZI_UPDATE_SUPERVISOR_ENABLED MSAIDIZI_UPDATE_AUTOMATIC_ROLLOUT_ENABLED MSAIDIZI_UPDATE_EVALUATOR_ENABLED MSAIDIZI_EVALUATOR_MTLS_ENABLED MSAIDIZI_RECOVERY_SUPERVISOR_ENABLED MSAIDIZI_AUDIT_SIGNER_ENABLED'.split(' '); const bad=keys.filter(k=>process.env[k]!=='false'); if(process.env.MSAIDIZI_WRITE_MODE!=='read-only') bad.push('MSAIDIZI_WRITE_MODE'); if(bad.length){console.error('unsafe pre-promotion posture: '+bad.join(','));process.exit(1)}" \
  </dev/null; then
  echo 'ERROR: ordinary deployment must be healthy, disabled, and read-only before promotion.' >&2
  exit 1
fi

docker pull "$MSAIDIZI_PROMOTION_BACKEND_IMAGE" >/dev/null
docker image inspect "$MSAIDIZI_PROMOTION_BACKEND_IMAGE" > "$IMAGE_INSPECT"
MSAIDIZI_PROMOTION_INVENTORY_PATH="$TARGET_INVENTORY" \
MSAIDIZI_PROMOTION_IMAGE_INSPECT_PATH="$IMAGE_INSPECT" \
  node "$SCRIPT_ROOT/verify-msaidizi-target-oci.mjs"

RELEASE_ROOT="/opt/itemba-msaidizi-releases/$MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256"
# These are signed public artifacts, not credentials. They remain root-owned and
# non-writable, but must be readable by the unprivileged backend user after the
# exact evidence/key files are bind-mounted into the container.
install -d -m 0755 "$RELEASE_ROOT"
install_once() {
  local SOURCE="$1"
  local DESTINATION="$2"
  if [ -e "$DESTINATION" ]; then
    if [ -L "$DESTINATION" ] || ! cmp -s -- "$SOURCE" "$DESTINATION"; then
      echo "ERROR: immutable release material already exists with different bytes: $DESTINATION" >&2
      exit 1
    fi
    return
  fi
  install -m 0444 "$SOURCE" "$DESTINATION"
}
install_once "$MSAIDIZI_CRUD_EVIDENCE_PATH" "$RELEASE_ROOT/crud-evidence.json"
install_once "$MSAIDIZI_CRUD_RELEASE_BUNDLE_PATH" "$RELEASE_ROOT/crud-evidence-release.json"
install_once "$TARGET_INVENTORY" "$RELEASE_ROOT/promotion-inventory.json"
install_once "$MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_PATH" "$RELEASE_ROOT/evidence-public.pem"
install_once "$MSAIDIZI_CRUD_RELEASE_PUBLIC_KEY_PATH" "$RELEASE_ROOT/release-public.pem"

RELEASE_ENV="$RELEASE_ROOT/promotion.env"
if [ -e "$RELEASE_ENV" ]; then
  echo 'ERROR: promotion environment already exists; immutable release will not be overwritten.' >&2
  exit 1
fi
cat > "$RELEASE_ENV" <<ENVEOF
MSAIDIZI_PROMOTION_BACKEND_IMAGE=$MSAIDIZI_PROMOTION_BACKEND_IMAGE
MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256=$MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256
MSAIDIZI_PRODUCTION_ACCEPTED_EVIDENCE_SHA256=$MSAIDIZI_PRODUCTION_ACCEPTED_EVIDENCE_SHA256
MSAIDIZI_PRODUCTION_ACCEPTED_IMAGE_DIGEST=$MSAIDIZI_PRODUCTION_ACCEPTED_IMAGE_DIGEST
MSAIDIZI_PRODUCTION_PROMOTION_INVENTORY_HOST_PATH=$RELEASE_ROOT/promotion-inventory.json
MSAIDIZI_DEPLOYED_BACKEND_IMAGE_REFERENCE=$MSAIDIZI_PROMOTION_BACKEND_IMAGE
MSAIDIZI_DEPLOYED_SOURCE_COMMIT=$EXPECTED_COMMIT
MSAIDIZI_DEPLOYED_SOURCE_REPOSITORY=$MSAIDIZI_PROMOTION_REPOSITORY
MSAIDIZI_CRUD_EVIDENCE_HOST_PATH=$RELEASE_ROOT/crud-evidence.json
MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_HOST_PATH=$RELEASE_ROOT/evidence-public.pem
MSAIDIZI_CRUD_EVIDENCE_KEY_ID=$MSAIDIZI_CRUD_EVIDENCE_KEY_ID
MSAIDIZI_CRUD_EVIDENCE_APPLICATION_BUILD_DIGEST=$(node -e "const i=require(process.argv[1]);process.stdout.write(i.evidence.applicationBuildDigest)" "$TARGET_INVENTORY")
MSAIDIZI_CRUD_EVIDENCE_PRISMA_SCHEMA_MIGRATION_DIGEST=$(node -e "const i=require(process.argv[1]);process.stdout.write(i.evidence.prismaSchemaMigrationDigest)" "$TARGET_INVENTORY")
ENVEOF
chmod 0600 "$RELEASE_ENV"

COMPOSE_RING=(
  docker compose
  --env-file "$BASE_ENV"
  --env-file "$MSAIDIZI_RING_ENV_FILE"
  --env-file "$RELEASE_ENV"
  -f "$BASE_COMPOSE"
  -f "$RING_COMPOSE"
)
RESOLVED_CONFIG="$MSAIDIZI_PROMOTION_STAGE/resolved-ring-compose.json"
"${COMPOSE_RING[@]}" config --format json > "$RESOLVED_CONFIG"
node - "$RESOLVED_CONFIG" "$MSAIDIZI_PROMOTION_BACKEND_IMAGE" \
  "$MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256" \
  "$MSAIDIZI_PRODUCTION_ACCEPTED_EVIDENCE_SHA256" \
  "$MSAIDIZI_PRODUCTION_ACCEPTED_IMAGE_DIGEST" \
  "$RELEASE_ROOT/promotion-inventory.json" \
  "$EXPECTED_COMMIT" \
  "$MSAIDIZI_PROMOTION_REPOSITORY" <<'NODE'
const fs = require('node:fs');
const [path, image, inventory, evidence, imageDigest, inventoryPath, sourceCommit, repository] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(path, 'utf8'));
const backend = config.services?.backend;
if (!backend || backend.image !== image || Object.hasOwn(backend, 'build')) {
  throw new Error('resolved ring backend is not an image-only immutable deployment');
}
const env = backend.environment ?? {};
const expected = {
  MSAIDIZI_ENABLED: 'true',
  MSAIDIZI_AUTONOMY_ENABLED: 'true',
  MSAIDIZI_TASK_WORKER_ENABLED: 'true',
  MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256: inventory,
  MSAIDIZI_PRODUCTION_ACCEPTED_EVIDENCE_SHA256: evidence,
  MSAIDIZI_PRODUCTION_ACCEPTED_IMAGE_DIGEST: imageDigest,
  MSAIDIZI_PRODUCTION_PROMOTION_INVENTORY_PATH: '/run/msaidizi/promotion-inventory.json',
  MSAIDIZI_DEPLOYED_BACKEND_IMAGE_REFERENCE: image,
  MSAIDIZI_DEPLOYED_SOURCE_COMMIT: sourceCommit,
  MSAIDIZI_DEPLOYED_SOURCE_REPOSITORY: repository,
};
const drift = Object.entries(expected).filter(([key, value]) => env[key] !== value);
if (drift.length) throw new Error(`resolved ring posture is incomplete: ${drift.map(([k]) => k).join(',')}`);
const inventoryMounts = (backend.volumes ?? []).filter(
  (volume) => volume.type === 'bind' && volume.target === '/run/msaidizi/promotion-inventory.json',
);
if (
  inventoryMounts.length !== 1 ||
  inventoryMounts[0].source !== inventoryPath ||
  inventoryMounts[0].read_only !== true
) {
  throw new Error('resolved ring backend does not have the exact read-only promotion inventory mount');
}
NODE

rollback() {
  STATUS="$?"
  trap - EXIT
  if [ "$STATUS" -eq 0 ]; then return; fi
  echo 'ERROR: ring promotion failed; restoring the ordinary dark backend without rebuilding.' >&2
  "${COMPOSE_BASE[@]}" up -d --no-build --no-deps --pull never backend >/dev/null 2>&1 || \
    echo 'ERROR: automatic dark-backend recovery also failed; operator attention is required.' >&2
  exit "$STATUS"
}
trap rollback EXIT

"${COMPOSE_RING[@]}" up -d --no-build --no-deps --pull never backend
docker inspect itemba_r_backend_prod > "$CONTAINER_INSPECT"
MSAIDIZI_PROMOTION_INVENTORY_PATH="$TARGET_INVENTORY" \
MSAIDIZI_PROMOTION_IMAGE_INSPECT_PATH="$IMAGE_INSPECT" \
MSAIDIZI_PROMOTION_CONTAINER_INSPECT_PATH="$CONTAINER_INSPECT" \
MSAIDIZI_CRUD_EVIDENCE_PATH="$RELEASE_ROOT/crud-evidence.json" \
  node "$SCRIPT_ROOT/verify-msaidizi-target-oci.mjs"

"${COMPOSE_RING[@]}" exec -T backend node -e \
  "fetch('http://127.0.0.1:3001/api/v1/health/ready').then(r=>{console.log('health HTTP',r.status);process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})" \
  </dev/null
"${COMPOSE_RING[@]}" exec -T backend node -e \
  "const fs=require('node:fs'),crypto=require('node:crypto');const p=process.env.MSAIDIZI_CRUD_EVIDENCE_PATH;const h=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');if(h!==process.env.MSAIDIZI_PRODUCTION_ACCEPTED_EVIDENCE_SHA256)process.exit(1);console.log('runtime evidence digest: PASS')" \
  </dev/null
"${COMPOSE_RING[@]}" exec -T backend node -e \
  "const fs=require('node:fs'),crypto=require('node:crypto');const p=process.env.MSAIDIZI_PRODUCTION_PROMOTION_INVENTORY_PATH;const h=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');if(h!==process.env.MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256)process.exit(1);console.log('runtime promotion inventory digest: PASS')" \
  </dev/null

trap - EXIT
echo "Msaidizi ring $MSAIDIZI_PROMOTION_RING promotion: PASS"
echo "Backend image: $MSAIDIZI_PROMOTION_BACKEND_IMAGE"
echo "Promotion inventory SHA-256: $MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256"
