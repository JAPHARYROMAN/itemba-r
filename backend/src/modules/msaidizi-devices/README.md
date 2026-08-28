# Msaidizi Windows device broker

This module is fail-closed. Pairing and polling are disabled independently,
and host dispatch additionally requires an external P-256 action-signing key,
a lease pepper, an active mandate, one exact device, a matching strict
capability manifest, fresh healthy heartbeat state, and no central kill switch.

## Direct mTLS listener

Device identity comes only from `request.socket` on a dedicated, route-isolated
HTTPS listener. The broker never reads `X-Forwarded-Client-Cert` or any other
forwarding header. The ordinary human API stays on its existing HTTP/reverse-
proxy topology and cannot serve a device channel because it has no client TLS
identity. Set `MSAIDIZI_DIRECT_MTLS_ENABLED=true` only with readable absolute
paths for:

- `MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH`
- `MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH`
- `MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH`

Configure its independently validated port and literal bind address with
`MSAIDIZI_DIRECT_MTLS_PORT` (default `3443`) and
`MSAIDIZI_DIRECT_MTLS_BIND_ADDRESS`. The port must differ from both the ordinary
API and signed-evaluator ports. The listener exposes only pairing completion,
device commands, update/recovery supervisor channels, and the audit-signer
channel; human administration and evaluator routes return 404 before Nest.
Compose publishes this port on loopback by default. A workstation ring must
explicitly set `MSAIDIZI_DIRECT_MTLS_HOST_BIND_ADDRESS` and place the listener
behind an L4 firewall/TCP pass-through; HTTP TLS termination is not supported.

`rejectUnauthorized` is false only at this dedicated first-trust handshake so a
new device may present its self-signed certificate. Every allowed route still
requires a direct `TLSSocket`, TLS 1.2/1.3 Finished proof, and a valid non-CA
P-256 peer certificate. Pairing additionally requires the short-lived,
peppered, single-use code; all later channel operations match both the peer's
SHA-256 certificate fingerprint and SPKI digest to the enrolled device row.
TLS termination at an HTTP reverse proxy cannot authenticate a device because
forwarded certificate assertions are intentionally ignored.

## Persistence and replay

Pending device rows contain only a peppered one-time-code digest. Pairing uses
an exact compare-and-swap to replace it with the direct peer key. Host leases
and action idempotency keys are deterministic per step. Terminal device results
store only digests and redacted summaries; a matching replay returns the prior
receipt and a conflicting replay moves unfinished work to `NEEDS_ATTENTION`.
Before first dispatch, the broker locks the task and device rows, reserves the
exact signed external-egress ceiling, and refuses a second active action for
the device. Artifact delivery uses the same task counter CAS, so spent plus
reserved egress can never cross the persisted task ceiling. A trustworthy
terminal result atomically converts its capability, immutable prepaid broker,
and uncertainty measurements to spent bytes and releases the rest. Any action
that crossed the device boundary without trustworthy terminal evidence converts
its full reservation to spent; a queued action reserves and spends zero.
The signed broker prepayment fixes the delivery-session count, attempts per
session, and complete serialized-result upper bound. Central `dispatchCount`
is authoritative and is bound into both the signed action token and request.
Device progress acknowledges that exact generation. A `DISPATCHED` redelivery
requires its matching persisted ACK; issuing the next generation atomically
clears it. A `RUNNING` redelivery additionally requires an idle heartbeat at
the action's exact terminal journal slot and pins the observed terminal head.
Arrival-time inference alone never spends a redelivery session.

Every dispatch also binds the persisted lease ID, its canonical positive
signed-64-bit decimal fencing token, and the authoritative lease expiry into the signed JWT
and action request. Progress and terminal results must echo those exact fields.
Missing, expired, or mismatched lease fences fail closed before an ACK or
result can advance central action state.

Terminal replays are revalidated in full and must reproduce the same immutable
receipt, including output digest, provenance, local usage, all three egress
components, and journal evidence. A digest-only output replay is allowed only
when it is explicitly idempotent and matches the output digest already accepted
for that terminal action. Prepaid broker egress is never charged twice.

### Credential-bearing file reads

The legacy `filesystem.file.read@1.0.0` wire shape is not enrollable or
dispatchable. It embedded raw Base64 file content in a terminal result, so even
DPAPI/encrypted persistence would violate the adaptive-reasoning requirement
that credential-bearing bytes remain ephemeral. Manifest validation, reasoning
context, policy evaluation, queue/claim, public and transactional result
settlement, output validation, artifact preparation, artifact reopening, and
companion result-cache replay all fail closed with
`REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY`. An already active or forged legacy
action is settled as `NEEDS_ATTENTION` without parsing or storing its result
body. The refusal is content-independent and therefore covers text, PDF,
archives, office containers, and unknown binary formats, including secrets not
recognized by a fingerprint set. `filesystem.entry.stat`,
`filesystem.folder.list`, and `filesystem.search` remain available. A future
replacement must reread under exact task/plan/step/device/path/digest authority
into a one-use model channel and must not copy bytes into artifacts, attempts,
host actions, events, transcripts, logs, memory, result caches, or resume state.
The reserved `filesystem.file.disclose.ephemeral@1.0.0` identifier is also
excluded from manifests, planning, policy acceptance, queueing, settlement, and
artifact handling. The current metadata-only protocol validates exact
capability/version, action/task/plan/step/device/mandate, argument/pre-state/file
identity/path digests, nonce/idempotency generation, MIME set, byte ceiling,
provider contract/model, and expiry. It is deliberately wired only to a
rejecting port: no authenticated atomic device-to-provider byte session and no
durable single-use nonce/budget ledger exist yet.

The terminal receipt includes the journal sequence, entry hash, and predecessor
hash. The broker rejects incomplete triples, compares an adjacent stored device
heartbeat to the predecessor or entry, and persists a machine-readable
reconciliation state in the redacted result summary. The next action binds to
the exact highest centrally accepted terminal journal hash under the device
lock. Only redelivery of that same active action may observe its proven
predecessor, prepare, or terminal slot; it cannot introduce an unreconciled
gap or authorize a different action from a stale heartbeat.

An ambiguous pairing retry is idempotent only when the stored device binding
already matches the same live certificate/SPKI pair. A different certificate,
an expired code, a consumed code for another peer, a forwarded certificate
header, or a socket without TLS Finished proof is rejected.

## Role-specific supervisor enrollment

The update and recovery channels do not accept the ordinary paired device
certificate. A recently authenticated oversight user creates a role-bound
challenge with `POST /msaidizi/devices/:id/supervisor-enrollment-codes`; the
raw code is returned once and only its HMAC is persisted. The supervisor then
completes first trust over direct mTLS at
`POST /msaidizi/devices/supervisor-enrollment/complete`. Completion binds both
the exact leaf-certificate SHA-256 and DER-SPKI SHA-256 to that device and role.

Enrollment is serialized under a database advisory transaction lock. The
certificate and SPKI must be distinct from every ordinary device, other
supervisor role, egress boundary, evaluator, and audit-signer identity. Exact
lost-response replay is accepted only for the same challenge code and the same
live TLS identity. Poll, progress, result, and update-artifact reads each have a
dedicated role guard and repeat the role/device binding in the service query.

Set `MSAIDIZI_SUPERVISOR_ENROLLMENT_ENABLED=true` only with a dedicated 32+
character `MSAIDIZI_SUPERVISOR_ENROLLMENT_PEPPER`, distinct from pairing and
lease peppers, and direct mTLS enabled. A deployment global kill immediately
revokes every active device lease; queued host actions become cancelled while
dispatched or running actions become `UNKNOWN` for operator reconciliation.
