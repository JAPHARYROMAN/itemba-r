# Turning on Msaidizi chat: the provider-contract attestation

Setting `MSAIDIZI_ENABLED=true` is no longer three lines in `.env.production`.
The backend now refuses to talk to the model API without a **signed
provider-contract attestation**, and it re-verifies that attestation before
*every single request* — not once at boot, so an expired or revoked contract
stops the next disclosure rather than waiting for a restart.

This is a paperwork-and-signature exercise, not a coding one. Budget an
afternoon, most of it spent deciding what the document says.

The signed attestation **replaced** the old
`MSAIDIZI_CLOUD_ZERO_RETENTION_CONFIRMED` flag — this ceremony does not
"satisfy" that boot gate, it is what exists instead of it. The backend now
rejects the flag outright: setting it fails boot with "no longer accepted;
configure signed provider-contract evidence". If an older checklist tells you
to set it, delete that line.

---

## What the attestation actually is

A short signed JSON file asserting, in a form the code can check, the terms you
are operating under with the model provider:

| Claim | Must be | Why the code cares |
|---|---|---|
| `provider` | `anthropic` | Pins who the counterparty is. |
| `apiOrigin` | `https://api.anthropic.com` | Must match the origin the SDK is pinned to. |
| `zeroTraining` | `true` | Refuses to run if the contract does not prohibit training. |
| `providerRetentionSeconds` | `0` | Refuses any non-zero retention. |
| `permittedModelIds` | sorted, no duplicates | Must exactly equal the set `{MSAIDIZI_MODEL, MSAIDIZI_CLASSIFIER_MODEL}`. |
| `coveredDataClasses` | all ten | credentials, documents, financial_data, personal_data, screenshots, clipboard, audio, email, browser_sessions, business_records. |
| `contractDocumentSha256` | digest of the real agreement | Binds the attestation to one exact document. |
| `immutableLegalReference` | `urn:sha256:<that digest>` | Content-addressed, so the reference cannot drift from the document. |
| `apiAccountId`, `apiCredentialKeyId` | your identifiers | The credential is only released when the runtime key-ID matches the attested one. |
| `issuedAt`, `effectiveAt`, `expiresAt` | ISO-8601 | Checked against the clock on every request. |

The signature is **ES256** (P-256 + SHA-256, IEEE-P1363 encoding) over a
domain-separated canonical JSON encoding. The file on disk must be byte-exact
canonical JSON — no pretty-printing, no trailing newline.

You do not need to know any of that: the tool below signs it with the same code
the verifier is written against.

---

## Step 1 — Write the contract document

The thing whose hash gets bound in. It should state plainly that the provider
does not train on your data and retains it for zero seconds, and it should be
the agreement you actually hold — not a summary someone typed for this purpose.
Any format; only its bytes are hashed.

Keep it somewhere durable. If it changes, the digest changes, and the
attestation must be reissued.

## Step 2 — Generate a signing keypair (once)

```bash
cd backend
npm run attestation:create -- --generate-key ~/keys/msaidizi-attestation
```

Writes `msaidizi-attestation.key.pem` (mode 600) and `.pub.pem`.

**The private key never goes on the application host.** The runtime only ever
reads the public half. Keep the private key offline; it is only needed again
when you reissue.

## Step 3 — Sign the attestation

```bash
cd backend
npm run attestation:create -- \
  --private-key      ~/keys/msaidizi-attestation.key.pem \
  --public-key       ~/keys/msaidizi-attestation.pub.pem \
  --key-id           itemba-attestation-2026-08 \
  --contract-document ~/legal/anthropic-zero-retention.pdf \
  --account-id       <your Anthropic account id> \
  --credential-key-id anthropic/prod-key-v1 \
  --models           claude-opus-5,claude-haiku-4-5 \
  --expires          2027-08-29T00:00:00.000Z \
  --out              ./attestation.json
```

The tool signs, then **verifies its own output through the real verifier** with
the exact values it is about to print. If that fails it writes nothing — an
attestation that does not verify is worse than none, because you would find out
when the service refused to boot.

On success it prints the seven environment variables, digests already computed.

### Notes on the arguments

- `--models` must **exactly equal** the set `{MSAIDIZI_MODEL,
  MSAIDIZI_CLASSIFIER_MODEL}` — the verifier demands set equality, not
  coverage. An extra model signs fine and passes the tool's self-verification,
  but the runtime refuses the attestation with
  `PROVIDER_CONTRACT_MODEL_SCOPE_MISMATCH`. The classifier model is attested
  even though no pre-filter calls it yet; changing it without a matching
  contract fails attestation and stops the agent. The tool sorts and dedupes
  for you.
- `--credential-key-id` is a *label* for the API key in your secret manager,
  never the key itself. The runtime releases the credential only when this
  matches `MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID`.
- `--expires` is a real deadline. Pick a date you will actually notice, and put
  a reminder somewhere: expiry stops the agent mid-flight, by design.

## Step 4 — Install on the host

Copy **the artifact and the public key only** to the droplet, to a host path
you choose (the example env file uses
`/etc/itemba-r/msaidizi/provider-contract/`). You do not create
`/run/msaidizi-provider-contract/` yourself: the compose file bind-mounts the
two host files you name in Step 5 onto those fixed container paths, read-only.
Both mounts use `create_host_path: false`, so a missing file fails the deploy
rather than being silently created as an empty directory.

## Step 5 — Set the environment and restart

The tool prints seven variables, but the two `*_PATH` ones are the
**container-side** names — the backend service in
`docker-compose.production.yml` has no `env_file:`, and compose derives the
container paths itself, so putting `MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_PATH`
or `MSAIDIZI_PROVIDER_CONTRACT_PUBLIC_KEY_PATH` in `.env.production` does
nothing. Add to `/opt/itemba-r/.env.production` the other five variables as
printed, plus the two operator-owned `*_HOST_PATH` variables pointing at the
files from Step 4:

```
MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_HOST_PATH=<host path to attestation.json>
MSAIDIZI_PROVIDER_CONTRACT_PUBLIC_KEY_HOST_PATH=<host path to the .pub.pem>
MSAIDIZI_PROVIDER_CONTRACT_KEY_ID=<as printed>
MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_SHA256=<as printed>
MSAIDIZI_PROVIDER_CONTRACT_SIGNER_SPKI_SHA256=<as printed>
MSAIDIZI_PROVIDER_ACCOUNT_ID=<as printed>
MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID=<as printed>
```

plus the three that actually switch it on:

```
MSAIDIZI_ENABLED=true
ANTHROPIC_API_KEY=<the key labelled by --credential-key-id>
MSAIDIZI_WRITE_MODE=read-only
```

Then:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d backend
```

**Not `docker restart`** — that does not re-read the environment, and the
service will come back with the old configuration and no clue why.

## Step 6 — Confirm

The backend refuses to start if the attestation is missing, malformed, expired,
signed by the wrong key, or names models the deployment is not configured for.
So a healthy container is itself most of the evidence. Beyond that:

- `GET /api/v1/msaidizi/capabilities` should answer rather than 403.
- The chat page should load and answer a read-only question.
- Deliberately break it once, in staging: point
  `MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_SHA256` at a wrong digest and confirm
  the service refuses to start. A gate you have never seen fail is a gate you do
  not know you have.

---

## Staging chat benchmark (explicit read-only overlay)

Ordinary `docker-compose.staging.yml` deliberately does not mount production
operator inputs. For an approved live chat test, add
`docker-compose.staging-msaidizi-chat.yml` after the staging base file. Do not
combine this overlay with production or add it to the production deployment
workflow.

Use real provider-contract evidence from steps 1–3 for the staging account,
credential label and exact model set. Install only the signed attestation and
public verification key on the staging host; keep the signing private key offline.
In the operator-owned `.env.staging`, populate the optional benchmark section
from `.env.staging.example`:

- `MSAIDIZI_STAGING_CONTRACT_ATTESTATION_HOST_PATH` and
  `MSAIDIZI_STAGING_CONTRACT_PUBLIC_KEY_HOST_PATH`: absolute paths to existing
  files on that host, distinct from production operator inputs.
- The five provider identity/digest variables printed by the signing tool.
- `ANTHROPIC_API_KEY` through the approved secret-management process, and the
  exact attested `MSAIDIZI_MODEL` and `MSAIDIZI_CLASSIFIER_MODEL` values.

The overlay fixes the two container paths, mounts those files read-only with
`create_host_path: false`, enables chat/tool search, and forces `read-only` mode.
All autonomous, workstation, enrollment, evaluator, recovery and update execution
switches remain false even if the environment attempts to enable them. It does
not override the global kill switch or human permission filtering.

Operator commands, from the repository on the approved staging host:

```bash
# Configuration validation only; avoid printing resolved credentials.
docker compose --env-file .env.staging -f docker-compose.staging.yml -f docker-compose.staging-msaidizi-chat.yml config --quiet
# Deploy only after the staging change has been approved.
docker compose --env-file .env.staging -f docker-compose.staging.yml -f docker-compose.staging-msaidizi-chat.yml up -d backend
```

Compose rejects empty required inputs and missing bind sources; the backend's
existing verifier additionally rejects invalid signatures, digests, account/model
scope, expiry or contract claims. Passing `config` is not evidence of a valid
contract or a healthy deployment.

Once backend readiness succeeds, run the seven prompts from a benchmark runner
with `MSAIDIZI_API` set to the approved staging API base (including `/api/v1`),
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` supplied securely for an authorized
fixture account, and `MSAIDIZI_BENCHMARK_REQUIRE_FAST_PATH=true`. Leave
`MSAIDIZI_BENCHMARK_CASE` unset to cover all seven:

```bash
node backend/test/benchmarks/tool-search-compare.mjs staging-fast-path.json
```

Use synthetic business fixtures, retain the report as test evidence, and review
the answers against those records. Reports may contain business data; keep them
out of public artifacts. See `backend/test/benchmarks/README.md` for scoring and
the scripted ERP write proof. A live read-only pass does not authorize writes or
workstation rollout.

To disable the experiment, set the base staging `MSAIDIZI_ENABLED=false` (and
leave autonomous switches false), then recreate the backend using only the base
staging file. Simply omitting the overlay does not override an independently
enabled base environment flag.

The deployment validator tests the merged overlay using synthetic config only,
including each missing input, attempted flag/path overrides, and unchanged
non-backend services. It never contacts the model or signs an attestation:

```bash
node scripts/validate-deployment.mjs --staging-only
```

## Reissuing

Whenever the contract document changes, the API account or credential label
changes, the model set changes, or the expiry approaches: repeat steps 3–5 with
the same private key. The `keyId` only changes if you rotate the signing key,
which also means updating `MSAIDIZI_PROVIDER_CONTRACT_SIGNER_SPKI_SHA256`.

## What this does not cover

This turns on **chat only**. The seven autonomous switches — autonomy, task
worker, autopilot, host execution, adaptive reasoning, update rollout, update
evaluator — additionally require a production ring, which needs the signing and
acceptance ceremonies described in the handover. Ordinary `MSAIDIZI_ENABLED`
deliberately does not.
