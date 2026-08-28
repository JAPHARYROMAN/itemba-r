# Broker channel and action authorization

## Transport contract

`IOutboundCompanionChannel` is the only central-broker dependency of the
LocalSystem service. The Agent never connects to the broker. A production
implementation must:

1. initiate outbound TLS 1.2 or 1.3 requests to the configured HTTPS endpoint;
2. load the non-exportable device certificate from the appropriate Windows
   certificate store, or create the first device identity in a CNG provider;
3. validate the normal server certificate chain and hostname plus the
   configured certificate SHA-256 pin;
4. poll the broker's `poll` endpoint and post heartbeat, manifest, progress,
   terminal result, and durable action-fence receipt messages without starting
   a local listener;
5. authenticate every reconnect and reject device revocation before accepting
   commands;
6. preserve action and idempotency IDs across reconnects; and
7. report central-ledger connectivity as `true` only for a bounded interval
   after an authenticated broker acknowledgement, not merely after creating an
   HTTP client.

`HttpPollingCompanionChannel` is registered for the LocalSystem service only
when `BrokerChannel.Enabled` is true. The disabled service fallback accepts no
commands and always reports the ledger as disconnected. HTTP retries are
bounded, backoff is capped with jitter, responses are size-limited, and
malformed or unauthenticated responses clear ledger connectivity. Requests use
exact HTTP/1.1 with `Connection: close`, so HTTP/2 stream recovery cannot
invisibly replay a request body inside one counted attempt.

Before entering any mutation adapter, the coordinator requires the immediate
`action_started` progress message to receive an authenticated broker
acknowledgement and then rechecks the channel's bounded ledger-connectivity
state. Failure closes the already prepared journal entry as a known no-effect
failure; the adapter is not invoked and a later authorized redispatch replays
that terminal receipt. During an invoked mutation, acknowledged lease
heartbeats continue to cancel work cooperatively if connectivity is lost. This
adapter-boundary check narrows the offline race but is not a native commit-point
proof; each adapter must still check cancellation immediately before its effect,
and an external enforcement boundary is required where exact commit-time or
process-tree egress control is necessary.

## Authenticated interactive-session bridge

The LocalSystem service owns `Itemba.Msaidizi.Session.v1`; the standard-user
Agent connects outward to that local named pipe. No TCP listener is created.
The pipe DACL denies the Network SID and grants only LocalSystem plus local
authenticated users. Authentication then verifies the kernel-reported client
PID, impersonated SID, active-console session, and configured Agent SHA-256.
The Agent accepts the service only after verifying an ECDSA challenge from the
pinned paired-device certificate. An ephemeral P-256 ECDH key authenticates
strictly monotonic HMAC frames. The service accepts commands only after the
Agent submits the exact shared, config-selected standard-user manifest digest
and a healthy heartbeat. The packaged selection excludes browser external
effects and emergency command execution because no deployment-owned per-action
network-egress meter is currently attested.

The dormant secret-bearing browser action design keeps raw bytes outside
signed arguments. The action contains only `secretReferenceId` plus non-secret destination fields,
including the configured HTTPS origin's `originSha256`; the LocalSystem proxy
computes the normalized destination digest and calls
`IHostSecretReferenceVault.UseAsync` for the exact capability/scope. The Agent
independently matches that signed origin digest against its supervisor-owned
origin mapping before UI Automation. A session-derived AES-256-GCM envelope
binds action, capability, binding name, and destination as associated data.
Only its ciphertext is serialized into the local frame. The Agent zeroes the
decrypted action buffer after use and browser adapters prohibit clipboard
fallback.

## Message types

- `ExecuteActionCommand` carries an in-memory `ActionRequest` plus compact
  signed token and is accepted only when both request and token bind
  `executionMode`/`execution_mode` to `EXECUTE`.
- `ReplayResultCommand` uses wire kind `replay-result` and the same action
  envelope, but both request and token must bind the mode to
  `REPLAY_RESULT_ONLY`. It performs a read-only terminal-journal lookup and
  delivers only a matching DPAPI-protected result. A missing/conflicting
  receipt or protected binding is a hard no-op: the command cannot append a
  Prepared record, resolve or invoke an adapter, or prepare host recovery.
- `FenceActionCommand` uses wire kind `fence-action` and carries a separately
  typed `fence+jwt`. It grants no execution authority and creates no lease. It
  can append only one stable `ActionFenced` record at the broker-pinned journal
  predecessor while no matching Prepared or terminal record exists. The
  journal then rejects the old device fencing token and every lower token
  before both Prepared and adapter entry. `ActionFencedReceipt` echoes the
  exact immutable dispatch token over direct mTLS; the broker accepts only the
  sequence-next tombstone and settles the old action as a known no-effect
  failure without making its step runnable.
- `CancelActionCommand` requests cancellation between capability steps. The
  authenticated mTLS broker identity is the authorization boundary for cancel.
- `ActionProgress` is advisory; durable truth comes from `ActionResult` and the
  reconciled device/central journals.
- `CompanionHeartbeat` reports component version, kill switch, ledger state,
  running action count, journal head, and manifest digest.
- `CapabilityManifestSnapshot` is versioned by its digest. The broker must plan
  only against a manifest acknowledged by that device.

The polling implementation uses camel-case properties, string enums, strict
command deserialization, response-size limits, and bounded retry/backoff.
Never put client certificates, private keys, bearer tokens, action arguments,
or outputs in logs.

`ActionResult` includes the output digest, mutation/uncertainty flags,
provenance, journal sequence/head links, optional pre-state/recovery digests,
local byte counters, and the capability's conservatively measured non-broker
application-payload egress. Before first dispatch, the broker signs and
persists the maximum result delivery sessions, maximum attempts per session,
and serialized result-body upper bound. Their exact product is the immutable
prepaid broker egress charge; the companion journals all three factors,
refuses larger results, and treats later local configuration only as a tighter
ceiling. The broker also caps result-triggering redispatches centrally, because
a DPAPI file alone is not an anti-rollback counter. Completed writes are exact;
an ambiguous bounded write is charged in full. Capability and broker
measurements are digest-bound into the terminal receipt and replayed without
executing the action twice. The plaintext output
is transported in memory and is retained only in the DPAPI-protected
supervisor result cache for exact replay.

The egress attestation is an exact nested wire object. For a non-browser
effect, `browserBrokerBuildSha256` is serialized explicitly as JSON `null`;
omitting that property is not equivalent and the broker rejects the evidence.
This field has a property-level null-inclusion rule while unrelated optional
`ActionResult` fields continue to use the channel's normal null omission.
Result/progress error codes use the broker safe-identifier grammar (maximum
128 ASCII identifier characters), and provenance `sourceType` is bounded to
120 characters before terminal persistence.

`ActionRequest`, `ActionProgress`, and `ActionResult` carry the same lease ID,
canonical positive signed-64-bit decimal fencing token, and ISO lease expiry. The signed
token carries the equivalent expiry as epoch seconds. The companion rejects a
missing, expired, non-canonical, or mismatched lease fence before execution or
channel delivery; terminal replay refreshes these fields only from the newly
authorized request, never from an older cached result.

## Signed action token

The protected header is strict and accepts exactly:

```json
{ "alg": "ES256", "kid": "...", "typ": "at+jwt" }
```

The payload binds `iss`, `aud`, `sub`, `jti`, `action_id`, `task_id`,
`plan_version_id`, `step_id`, `device_id`, `mandate_id`, `capability_id`,
`capability_version`, `arguments_sha256`, optional pre-state and input
provenance digests, `idempotency_key`, optional `consent_grant`, budgets, `iat`,
`exp`, and the required `lease_id`, decimal-string `fencing_token`, and numeric
`lease_expires_at`. `execution_mode` is required, exact, and case-sensitive;
omission never defaults upward to execution authority. Execute and replay-result
commands require explicit `EXECUTE` and `REPLAY_RESULT_ONLY` values respectively. The token
expiry may not outlive the lease. Budgets include
the three broker result-delivery factors described
above. Unknown or duplicate protected-header/payload properties are
rejected. `consent_grant` is interpreted only when the selected descriptor
requires `active_user`, `one_shot_approval`, or `emergency_operator`; a signed
mandate ID remains mandatory for `SignedMandate` capabilities.

The deployed command protocol is version 3. The broker must emit the mode in
both the request and signed token for every dispatch. A missing mode is rejected
as an invalid authority-bearing claim; compatibility with pre-mode tokens is not
retained at this privileged boundary. Version 2 introduced signed
replay-result-only dispatch, and version 3 adds durable action fencing.

The strict fence header is exactly
`{ "alg": "ES256", "kid": "...", "typ": "fence+jwt" }`; its closed payload
binds `command_type=FENCE_ACTION`, fence/device/action/task/step identities, the
old lease ID and fencing token, the SHA-256 of the old action token, the exact
journal predecessor, delivery generation, `iat`, and `exp`. `jti` equals the
stable fence ID. The broker sends this command only after an authenticated,
fresh, idle v3 heartbeat proves the expected predecessor and no active device
lease exists. It persists each of at most three signed delivery generations,
but all generations bind the same tombstone. Receipt loss therefore permits
bounded redelivery without permitting a second journal write or host effect.
Deploy broker persistence, receipt settlement, and v3 manifest acceptance
before companions advertise version `3`.

The broker must serialize arguments in one stable UTF-8 representation and
hash those exact bytes. The companion verifies that the in-memory arguments,
request digest, and signed digest all match before parsing the JSON. Signing
keys are resolved by `kid` from a Windows certificate store; no PEM key is
accepted from action content or ordinary application configuration.

Token verification authorizes one dispatch only. It does not bypass adapter
schema checks, device hard ceilings, the trusted-root boundary, the kill
switch, central-ledger requirements, or active-user consent requirements.

## First-trust pairing

When no certificate thumbprint is configured, the LocalSystem service creates
one non-exportable P-256 key and self-signed client certificate. It tries the
Microsoft Platform Crypto Provider first (TPM-backed) and falls back to the
Microsoft Software Key Storage Provider only when the platform provider is not
available. The DPAPI-protected identity record contains identifiers and public
certificate material, never an exportable private key.

An operator first creates a short-lived one-time pairing code in Itemba and
places it in supervisor-owned bootstrap configuration. The companion presents
its new certificate on the outbound TLS connection and sends the code to
`pairing/complete`. The broker proves possession from the live TLS handshake,
then atomically binds the device row to both the certificate fingerprint and
SPKI digest. The self-signed certificate is intentionally not CA-authorized at
this first exchange; possession plus the peppered, expiring, single-use code is
the enrollment proof. Every later channel message must present the exact
stored fingerprint and SPKI pair.

The pairing code is never written to the device identity record or application
logs. A failed response does not mark the identity as paired, and a retry after
an ambiguous response succeeds only if the server already holds the identical
certificate binding. Changing the device ID or deleting/replacing the protected
identity requires a new operator-issued code. AI actions cannot create, read,
or modify this bootstrap identity.
