# Msaidizi CRUD execution evidence

`npm run evidence:crud` is the only harness whose output the Msaidizi CRUD
coverage endpoint accepts as loopback execution evidence.

The runner creates a uniquely named PostgreSQL schema, deploys every migration
into it, starts the real Nest application on localhost, and invokes capabilities
selected by exact `ManifestProvider` IDs through `CapabilityInvoker`. Requests
therefore cross the same JWT guards, permission guards, validation pipe,
request-context middleware, controllers, services, and Prisma persistence path
as production requests. The schema is dropped in a `finally` block.

The fixture registry is composed from independently reviewable, additive packs:

- The base governed-CRUD pack contains explicit positive controls plus seven
  governance controls: three permission denials, company isolation, AGENT audit
  attribution, a Collaborative service-principal exact-action lane, and a
  GROUP Autopilot active-mandate lane through a controller-local JWT guard.
- Deterministic metadata-derived collection reads from the exact live manifest.
  A route qualifies only when it is permission-governed, not
  `@AgentExcluded`, uses `GET`, has no path identifier, has a strict query DTO
  (when it accepts a whole query object), and every required/named query value
  can be derived from the harness's own seeded company. Routes that require
  unrepresented terminal/device headers are excluded because the invocation
  contract is deliberately only `{ path, query, body }`.
- A reviewed exact-record read pack. Each fixture is admitted only while its
  live capability remains a permission-governed `GET` with exactly one `:id`,
  no query contract, and an explicit harness-owned seed binding plus response
  company path. A random identifier or 404 can never satisfy this pack.

Every generated read must return 2xx with a response payload and must leave the
seeded customer, journal, and company row counts unchanged. This is still a
bounded positive control, not a claim that `GET` is automatically low-risk.
Exact-record fixtures additionally require the response ID to equal the real
seeded UUID, require the response's declared company path to equal company A,
run as a company-scoped user, and compare a before/after snapshot of every exact
record seed, the audit ledger count, and core business counts across the whole
pack.
The registry and artifact report the current exact count; it changes whenever
the signed manifest changes.

Every other permission-governed operation remains `discoveryEligibility:
eligible` but is coverage-`excluded` with
`no_positive_fixture_registered`. A registered fixture that did not run or
failed is excluded with its own reason. `summary.included` therefore counts only
currently verified operations; it never means "the route exists" or "the agent
can discover it." An HTTP response merely below 500 is never a positive control;
positive and audit controls require 2xx, denial requires 403, isolation requires
403/404, and every case requires explicit state assertions.

Human-session controls cannot qualify service dispatch. The two service lanes
use real task-issued JWTs and independently reserved attempts. They prove the
live human/principal/deployment grant intersection, exact capability and
`{ path, query, body }` digest binding, consume-before-policy one-shot behavior,
strict replay/scope/permission denial audits, GROUP Autopilot mandate narrowing,
task counters and events, full principal/mandate/initiator/task/step attribution,
raw-bearer non-persistence, and exact whole-schema/sequence recovery. Both must
pass for `service_principal_task_scope` to satisfy the release gate.

## Generate evidence

Create a dedicated P-256 signing key for CI. The private key must not be copied
to the application host; only the public key and resulting artifact are runtime
inputs.

```powershell
openssl ecparam -name prime256v1 -genkey -noout -out C:\secure\crud-evidence-private.pem
openssl ec -in C:\secure\crud-evidence-private.pem -pubout -out C:\secure\crud-evidence-public.pem

$env:DATABASE_URL = 'postgresql://itemba:itemba_dev_password@127.0.0.1:5433/itemba_r'
$env:MSAIDIZI_CRUD_EVIDENCE_PRIVATE_KEY_PATH = 'C:\secure\crud-evidence-private.pem'
$env:MSAIDIZI_CRUD_EVIDENCE_OUTPUT_PATH = 'C:\evidence\msaidizi-crud-evidence.json'
$env:MSAIDIZI_CRUD_EVIDENCE_SIGNING_KEY_ID = 'msaidizi-crud-evidence-2026-01'
$env:CRUD_COVERAGE_DISPOSABLE_DATABASE_ACK = '127.0.0.1:5433/itemba_r'
npm run evidence:crud
```

The runner computes `provenance.applicationBuildDigest` itself. It hashes the
complete evidence execution bundle before and after the run: application and
harness source, runner code and configuration, the lockfile, all installed
`node_modules` bytes, generated Prisma code, and the native query engine. The
caller cannot supply or override that digest. The Jest/Nest child receives only
the run-unique unsigned-output path; the release output path, signing key path,
and signing key ID are removed from its environment. After the child exits and
the isolated schema is removed, the parent independently validates the closed
payload shape, run timestamps, schema-name digest, Prisma-tree digest, and every
successful case before it reads the P-256 key and signs.

The database URL supplies a PostgreSQL server only. The runner never executes
fixtures in its configured schema; it creates and later drops a narrowly
allowlisted `msaidizi_crud_evidence_*` schema.

### Disposable PostgreSQL 16 on Windows (without Docker)

For a workstation verification run, use the official portable PostgreSQL 16
binary archive in a unique temporary directory. The cluster below listens only
on loopback, is never registered as a Windows service, and can be stopped and
removed after evidence generation:

```powershell
$pgRoot = Join-Path $env:TEMP ("itemba-crud-pg16-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $pgRoot | Out-Null
# Expand postgresql-16.x-1-windows-x64-binaries.zip into $pgRoot\dist first.
$pgBin = Join-Path $pgRoot "dist\pgsql\bin"
$pgData = Join-Path $pgRoot "data"
& "$pgBin\initdb.exe" -D $pgData -U itemba -A trust --encoding=UTF8 --locale=C
& "$pgBin\pg_ctl.exe" -D $pgData -l "$pgRoot\postgres.log" -o "-h 127.0.0.1 -p 55432" start
& "$pgBin\createdb.exe" -h 127.0.0.1 -p 55432 -U itemba itemba_r
$env:DATABASE_URL = "postgresql://itemba@127.0.0.1:55432/itemba_r"
$env:CRUD_COVERAGE_DISPOSABLE_DATABASE_ACK = '127.0.0.1:55432/itemba_r'
npm run evidence:crud
& "$pgBin\pg_ctl.exe" -D $pgData stop
```

Choose an actually free port rather than assuming `55432` is unused. The
runner still creates and drops its own allowlisted schema inside this disposable
database; it does not run fixtures in `public`.

## Consume evidence

Configure all five runtime inputs together. Copy the application value from the
accepted artifact's `provenance.applicationBuildDigest`; it is the
runner-computed digest, not a caller-selected label. The Prisma value must equal
the artifact value and the digest recomputed from the exact `schema.prisma` and
migrations packaged in the runtime image:

```text
MSAIDIZI_CRUD_EVIDENCE_PATH=/run/msaidizi/crud-evidence.json
MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_PATH=/run/secrets/crud-evidence-public.pem
MSAIDIZI_CRUD_EVIDENCE_KEY_ID=msaidizi-crud-evidence-2026-01
MSAIDIZI_CRUD_EVIDENCE_APPLICATION_BUILD_DIGEST=<artifact provenance.applicationBuildDigest>
MSAIDIZI_CRUD_EVIDENCE_PRISMA_SCHEMA_MIGRATION_DIGEST=<deployed-tree Prisma digest>
MSAIDIZI_CRUD_EVIDENCE_MAX_AGE_HOURS=168
```

`GET /api/v1/msaidizi/crud-coverage` rejects the complete artifact when its
ES256 signature, SHA-256 payload digest, v2 contract, harness version, manifest
digest, capability digest, complete fixture-contract digest, application-build
digest, Prisma schema/migration digest, expiry, or maximum age does not match.
At runtime the store recomputes the Prisma digest from the deployed local tree;
it fails closed if that tree is absent or symlinked, or if the configured,
deployed, and artifact digests differ.

This source-level loopback harness does not by itself prove equivalence to the
compiled production container. The manual `Msaidizi CRUD Evidence Release`
workflow closes the release-binding gap without changing that claim: from one
clean commit already merged to `main`, it executes the complete real loopback
matrix, independently verifies the signed artifact, builds and pushes the
backend image, and signs a second closed envelope that binds all of these facts:

- the immutable Git commit and tree object IDs;
- a SHA-256 inventory of every tracked source byte used as build context;
- the pushed GHCR `repository@sha256:<manifest-digest>` reference;
- the complete evidence artifact SHA-256, signed-payload digest, manifest
  digest, harness execution-bundle digest, Prisma-tree digest, run ID, validity
  window, key ID, and executed-case count; and
- the exact GitHub repository, workflow run, and attempt that produced it.

The release envelope is independently ES256-signed with a purpose-separated
key and is re-read and verified from disk before publication. It is a
cryptographic co-binding, not a claim that source-level TypeScript execution is
byte-for-byte equivalent to compiled container execution. A deployment may
claim this release only when it pulls the exact digest-qualified image in the
binding and mounts the matching evidence artifact/public key. The existing
source-checkout production deploy does not yet make that image-consumption
claim automatically.
The artifact contains only test identifiers, bounded assertions, status codes,
and digests—never credentials or the database URL. The disposable schema-name
digest is retained only as run provenance; it is not presented as schema
attestation.

## Protected production ring promotion

`.github/workflows/msaidizi-ring-promotion.yml` is the only repository path that
may replace the dark production backend with the image bound above. It is
manual, uses the protected `msaidizi-production-ring-promotion` environment,
and defaults to `verify-only`. The default operation downloads and verifies the
release but cannot install an SSH key or contact the production target.

The promotion workflow accepts an immutable backend
`repository@sha256:<digest>`, the exact evidence-release workflow run ID and
attempt, and a rollout ring. It does not accept a Git ref, tag, source archive,
or mutable image tag and contains no application compilation or image build
step. Its checkout supplies only the reviewed verifier scripts.

Before any target action, the workflow independently:

- requires the exact completed, successful `Msaidizi CRUD Evidence Release`
  workflow run and its one closed six-file artifact;
- ignores bundled public keys as trust roots and instead loads purpose-separated
  P-256 public keys and key IDs from the protected promotion environment;
- verifies the evidence ES256 signature, release-binding ES256 signature,
  evidence expiry, every passing case, artifact digest, source commit, Git tree,
  tracked-byte inventory, backend repository digest, and exact repository,
  workflow, run, and attempt binding;
- derives a closed canonical production promotion inventory for the selected
  target and ring; and
- compares its SHA-256, the evidence artifact SHA-256, and image manifest digest
  to three independently provisioned production-accepted values.

The workflow cannot create or update those acceptance values. Configure these
as protected environment variables only after an operator has reviewed the
release coordinates:

```text
MSAIDIZI_PRODUCTION_TARGET_ID
MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256
MSAIDIZI_PRODUCTION_ACCEPTED_EVIDENCE_SHA256
MSAIDIZI_PRODUCTION_ACCEPTED_IMAGE_DIGEST
MSAIDIZI_RING_ENV_FILE
```

To obtain review candidates, an operator may run
`npm run inspect:evidence-promotion-candidate` offline with the same signed
artifact, release bundle, protected public keys/key IDs, immutable image, exact
release run coordinates, target ID, ring, and an absolute
`MSAIDIZI_PROMOTION_CANDIDATE_OUTPUT_PATH`. It verifies both signatures and
prints the three candidate digests with `ACCEPTANCE STATUS: NOT ACCEPTED`. The
protected workflow never calls this helper. Reviewing those coordinates and
provisioning the environment variables are separate operator actions.

Also provision the two public verification keys/key IDs and the existing
production SSH transport secrets in that environment. Required reviewers and
prevention of self-review are repository settings, not properties a workflow
file can manufacture.

For `promote-ring`, the same verifier package is copied to the target and both
signatures and all accepted digests are checked again there. The target pulls
the exact image digest, verifies its repository digest and OCI source/revision
labels, and refuses to continue unless the ordinary deployment is already at
the signed source commit, healthy, fully disabled, and read-only. The merged
Compose override removes the backend `build` definition. Promotion uses
`--no-build --pull never`; a missing image fails instead of falling back to
source compilation. After replacement, the live container configuration digest,
image reference, mounted evidence bytes, accepted digests, and readiness route
are checked again. A failure attempts to restore the ordinary dark backend
without rebuilding.

The canonical inventory is verifier-derived evidence, not an acceptance
record. A passing workflow does not claim that TPM enrollment, companion
signing, provider retention terms, device recovery, kill-switch drills, or a
rollout ring has been operationally accepted. Those remain separately
provisioned and tested prerequisites.

## CI and release workflow

Standard CI runs the evidence-runner and release-boundary unit suites. It never
creates execution evidence, because an ordinary push or pull request does not
have authority to use a release signing key. Real evidence is produced only by
manually dispatching `.github/workflows/crud-evidence-release.yml`, typing the
exact confirmation phrase, and passing the protected
`msaidizi-crud-evidence-release` environment gate.

That environment must explicitly provision six secrets:

```text
MSAIDIZI_CRUD_EVIDENCE_PRIVATE_KEY_PEM
MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_PEM
MSAIDIZI_CRUD_EVIDENCE_SIGNING_KEY_ID
MSAIDIZI_CRUD_RELEASE_PRIVATE_KEY_PEM
MSAIDIZI_CRUD_RELEASE_PUBLIC_KEY_PEM
MSAIDIZI_CRUD_RELEASE_SIGNING_KEY_ID
```

Both key pairs must be EC P-256, each public half must match its private half,
and neither the public key nor key ID may be reused across the two purposes.
Configure required reviewers on the protected environment.
The workflow uses only its ephemeral loopback PostgreSQL 16 service, requires
the runner's exact destructive-database acknowledgement, forces all external
and autonomy paths off inside the harness, and refuses dirty or non-`main`
source. Missing keys, a failed/skipped case, signature drift, source drift,
Prisma drift, image publication failure, a mutable image tag, release-binding
failure, or a missing upload file fails the job. There is no fallback artifact.

On success the workflow publishes one 30-day GitHub artifact named for the
source commit containing only:

```text
crud-evidence.json
crud-evidence-release.json
evidence-public.pem
release-public.pem
backend-image-reference.txt
source-commit.txt
```

Private keys are never uploaded. The evidence itself remains valid for exactly
seven days, regardless of the longer diagnostic retention of the GitHub
artifact. Regenerate it for a later promotion rather than extending or editing
its signed timestamps.

The report's `releaseGate.target` is
`all_discovery_eligible_operations`. It stays failed while any eligible
operation lacks current positive evidence, any registered fixture is missing or
failed, any service-principal lane is missing or failed, or any governance
control is incomplete. The blocker array contains
machine-readable counts suitable for CI; a large discovery inventory can never
be mistaken for a tested CRUD surface.

## Historical v1 development snapshot (2026-08-25; rejected by the v2 verifier)

A no-cache run of all 102 migrations against a disposable, loopback-only
PostgreSQL 16.15 cluster and a temporary P-256 signing key produced and then
successfully re-verified this production manifest digest:

`3a8ae093b5c958bbc2ff01715fa3ea4ddb11a91178e67dfaa4660c40eeeb1236`

- 1,290 routed operations inventoried.
- 1,166 permission-governed operations discovery-eligible; 124 ineligible.
- 219/219 positive fixtures passed and were accepted: 213 reads, 2 creates, 1
  update, 1 delete, and 2 financial actions.
- Permission denial, company isolation, and AGENT audit attribution all passed.
- All 24 exact-record controls returned 2xx for the exact seeded UUID, matched
  company A through their declared response scope, and left the complete exact
  seed/audit/core-business snapshot unchanged.
- 219 operations are release-included with signed loopback evidence.
- 947 eligible operations remain excluded with
  `no_positive_fixture_registered`; the all-operations release gate therefore
  remains failed rather than overstating complete Itemba CRUD proof.
- The remaining fixture work is 620 mutations/actions requiring explicit state
  controls, 197 path-record reads, 103 reads whose query contract is not strict,
  18 domain-specific query fixtures, and 9 terminal/device-header routes whose
  ambient inputs are not represented by `{ path, query, body }`.
- The signed payload digest is
  `2f0bd4093c2af8b1db69d7f81d83941baa9ce11c49acb08ef6812a1b38ca6e6e`.

The runner uses `--no-cache` intentionally. During development, a stale ts-jest
transform otherwise produced a valid signature for an older DTO contract; the
production verifier rejected it with `manifest_digest_mismatch`. Evidence must
describe current source, not merely be correctly signed.

## Current evidence tranche

The repository now carries manifest-bound loopback controls for collection and
path reads, creates, updates, deletes, financial actions, permission denial,
company isolation, audit attribution, and explicit exclusions. Registration is
not execution evidence: only a newly generated artifact can state what passed
for the exact source and migration set being released.

- Each registration binds the exact capability ID, normalized route path,
  strict `{ path, query, body }` schema, isolated seed data, expected state
  transition, response identity where exposed, and company/actor scope.
- The harness snapshots relevant state before and after each pack. Reads must
  preserve it; mutations must make the declared transition and no unrelated
  one. Hidden audit, cache, or business-table writes therefore fail rather than
  being accepted by an HTTP-status-only assertion.
- Routes whose ambient inputs are not represented—such as terminal/device
  credential headers—remain excluded with a machine-readable reason. Evidence
  code does not invent or persist those credentials to make a fixture pass.
- `ProfitController.exportReport` is intentionally blocked as
  `read_writes_audit_ledger`: although it uses GET, it appends an audit record and
  cannot truthfully pass a no-mutation read control.
- Every discovery-eligible operation without a passing control remains a release
  blocker. Exclusions retain their exact reason instead of disappearing from the
  inventory.

Do not copy registry totals or source digests into this document as a statement
of current coverage. They become stale whenever routes, DTO metadata, fixtures,
or evidence code changes. The signed artifact supplies the exact cases,
`manifestDigest`, and execution provenance; the live CRUD coverage endpoint
combines that verified artifact with the matching deployed manifest to produce
the authoritative `summary`, `releaseGate`, and per-capability records.
