# Governed external actions

`ExternalActions.Enabled` registers four LocalSystem capability descriptors.
Remote effects are available only through a consumed flow handle issued by
the independently attested egress supervisor:

| Capability | Effect | Payload |
| --- | --- | --- |
| `external.email.send` | `ExternalWrite` | recipients, subject, text, optional governed artifact attachment |
| `external.message.send` | `ExternalWrite` | conversation ID and text |
| `external.publish.create` | `ExternalWrite` | destination, title, content, visibility |
| `external.purchase.submit` | `Financial` | vendor, ISO currency, exact minor-unit total, line items |

Every descriptor is a mutation requiring a signed mandate, an idempotency key,
an expected pre-state digest, and explicit irreversible recovery metadata. A
purchase total must exactly equal the checked sum of each integer
`quantityMilli × unitAmountMinor / 1000`; fractional minor-currency results,
overflow, unknown fields, and mismatched totals are rejected before dispatch.

The optional email attachment is not a model-selected local path. It is one
exact, bounded governed-artifact envelope (currently at most 128 KiB decoded)
bound to the task, immutable plan version, target step, device, source step and
attempt, artifact ID, data class, MIME type, name, byte count, content SHA-256,
and a canonical scope SHA-256. The LocalSystem adapter revalidates that scope
and rehashes the decoded bytes at execution. The same exact attachment fields,
including the bounded content, participate in the signed action-arguments
digest and the canonical gateway request body. Raw attachment bytes are never
written to task attempts, host-action records, events, audit projections,
journals, or resume state. Attachments above this limit remain `NOT_READY`
until an opaque, authenticated artifact-stream contract provides equivalent
scope, digest, budget, and replay guarantees.

## Destination authority

Static compatibility is unchanged: an action supplies only `endpointId`, and
supervisor configuration binds it to one capability, exact HTTPS URI, normally
validated leaf-certificate SHA-256, and scoped DPAPI vault record.

The separately enabled `mandate_dynamic_https_v1` path is a bounded dynamic
authority for `external.*` capabilities. It is not a validation bypass. The
active mandate must explicitly grant that authority for the exact capability,
and the immutable action arguments must carry all of these fields together:

- `endpointId` and `destinationAuthority`;
- canonical public `destinationUri`;
- exact `serverCertificateSha256`;
- `vaultReferenceId`, `vaultRecordSha256`, and `headerPrefix`.

The complete arguments object is covered by the broker action-token digest.
The supervisor independently canonicalizes it, rechecks the mandate-derived
policy, request size, port, HTTPS scheme, public-network floor, certificate,
and scoped vault record. Partial dynamic envelopes and unknown fields fail
closed. Redirects and proxies are not used. DNS is resolved at reservation and
again immediately before connect; every A/AAAA answer must be public, and the
socket connects to the validated IP while TLS keeps the signed hostname for
SNI and normal PKI validation plus the exact leaf pin.

Raw credentials exist only in the ephemeral vault plaintext and request
buffers needed for the call; those buffers are zeroed after use. They never
enter action arguments, task records, journals, result JSON, logs, artifacts,
transcripts, or persisted Msaidizi memory.

Dynamic authority is safe-off in both companion configuration templates. To
provision it, operators must create the paired supervisor policy (the closed
authenticated example is
`config/egress-destination-policy.dynamic-authenticated.example.json`), load
that exact manifest through `EgressSupervisor:DestinationPolicyPath`, and pin
its canonical lowercase SHA-256 in `Companion:EgressDestinationPolicySha256`
and the signed backend device enrollment/action binding. Only then may
`ExternalActions:DynamicDestinationsEnabled` be set to `true`. Enabling the
flag without the exact provisioned policy digest fails companion startup; a
missing, mismatched, not signed into deployment evidence, or dynamically
disabled supervisor policy fails reservation/dispatch closed and is deployment
inventory `NOT_READY`.

This provisioning is necessary but not sufficient for production. Contract v4
now binds privacy-preserving digests for the reservation answer set,
connection-time answer set, and selected address through the durable lifecycle,
signed receipt, and central action ledger. Answers are normalized and sorted;
raw addresses are never persisted. The connection set must exactly match the
reservation set (a stricter containment rule), and the selected address must be
one of the validated connection answers before TLS begins. Missing, changed,
or stale route evidence fails closed. Production enablement remains
`NOT_READY` until the separate WFP driver, workstation enrollment, signing,
recovery-drill, and deployment evidence is supplied; browser dynamic authority
also remains outside this direct-socket contract.

The retained executor internals construct one canonical HTTP/1.1 POST, include the signed
idempotency key and request/pre-state digests, and writes it once over TLS
1.2/1.3. It does not follow redirects and never retries. It reserves result
capacity before sending and charges the complete bounded request buffer once a
write begins. A failed or partial write is conservatively charged as the full
request and becomes `NEEDS_ATTENTION`. Separately, the broker signs the maximum
result-delivery sessions, attempts per session, and serialized-body ceiling
before dispatch. Their exact product is reserved and journal-bound; changing
local retry configuration later cannot increase that issued allowance.

## Gateway acknowledgement contract

A successful 2xx response is considered committed only when it contains each
header exactly once with a valid SHA-256 value:

- `X-Itemba-Idempotency-Key-Sha256`: SHA-256 of the received idempotency key;
- `X-Itemba-Request-Sha256`: SHA-256 of the canonical JSON body;
- `X-Itemba-Expected-Pre-State-Sha256`: the received signed pre-state digest;
- `X-Itemba-Post-State-Sha256`: the gateway's resulting state digest.

Missing, duplicate, malformed, mismatched, non-2xx, truncated, oversized, or
ambiguous responses are never retried and settle as an unknown external
mutation requiring reconciliation. Response content is not returned; only its
byte count and SHA-256 digest enter the governed result.

## Explicit NOT_READY inventory

This tranche intentionally supports only pre-provisioned authenticated HTTPS
destinations with a current leaf pin and scoped vault record. General
unauthenticated public endpoints are `NOT_READY`: they require a governed,
read-only destination-inspection capability that independently resolves public
DNS, completes normal PKI hostname validation, returns the observed leaf
digest, and feeds a later immutable/replanned action. No model-supplied pin or
implicit authority escalation may substitute for that prerequisite.

Dynamic `browser.*` destinations are also `NOT_READY`. The current shell/UI
automation boundary cannot attest the live top-level origin after redirects.
Browser schemas therefore advertise and accept only deployment-configured
static origins; dynamic navigation, form, secret, upload, and download fields
are rejected at plan policy and capability validation.

`browser.file.upload` now has a closed compatibility branch for an existing
scoped secret reference and a separate exact SCREENSHOT artifact branch. The
artifact branch is execution-consumed: LocalSystem revalidates and rehashes the
token-bound artifact, the tray materializes it only inside the enrolled user's
ACL-hardened, non-reparse quarantine, UI Automation consumes that exact locked
file, and cleanup is outcome evidence rather than a reason to hide a possible
UI effect. LocalSystem pre-authorizes at least the raw artifact byte count as
the application-egress floor. Only a terminal receipt from the independently
attested supervisor may settle success, at the greater of that floor and the
trusted measurement; the tray cannot manufacture a receipt. A missing,
mismatched, or under-floor receipt after possible UI effect becomes uncertain
`NEEDS_ATTENTION`, trips dispatch, and is never retried.

The production egress supervisor checked into this repository intentionally
rejects browser registration with `egress_browser_boundary_not_implemented`.
Consequently this typed artifact path remains fail-closed and must not be
published in production until an independently deployed provider binds and
measures the exact browser process, origin, action, session, arguments digest,
route attestation, and completion. That provider also supplies the required
live-origin and redirect-containment evidence for the entire action sequence.
