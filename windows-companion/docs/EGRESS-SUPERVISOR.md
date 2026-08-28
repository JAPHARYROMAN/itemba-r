# Msaidizi egress supervisor

`Msaidizi.EgressSupervisor` is an independently deployable .NET 8 Windows
service. It owns the socket used by a governed direct external action, meters
every companion-to-destination byte, enforces the signed reservation ceiling,
and signs the contract-v4 terminal receipt. It is deliberately separate from
the companion process and follows the modular, observable, resilient, and
zero-trust service boundaries required by the NEXT constitution (§3 and §6).

The packaged configuration is safe-off. With `EgressSupervisor.Enabled=false`
the service remains healthy but opens no named pipe, TCP listener, UDP socket,
driver handle, certificate private key, policy file, or lifecycle journal. It
cannot mint an attestation, lease, acknowledgement, or receipt.

## Boundary

Active mode has two local, byte-mode named pipes and no local network port:

- `Itemba.Msaidizi.EgressSupervisor.v2` carries the existing companion control
  protocol: reserve, capability activation attestation, direct registration,
  settle, and abort.
- `Itemba.Msaidizi.EgressSupervisor.Flow.v2` carries a one-time flow claim and
  then the raw TLS byte stream. Only the supervisor creates the outbound TCP
  socket. The companion never receives a socket or an address that permits it
  to bypass the meter.

Both pipes are created with a protected DACL containing only LocalSystem and
the restricted `NT SERVICE\Itemba Msaidizi Companion` SID. The native pipe mode
sets `PIPE_REJECT_REMOTE_CLIENTS`; the first instance sets
`FILE_FLAG_FIRST_PIPE_INSTANCE`. Every connection is also pinned for its whole
lifetime to session zero, the LocalSystem user, the companion service SID, the
configured companion image path and SHA-256, the live process handle, and a
read lock on the measured image. A matching SID or pipe name alone is not an
authentication decision. Both active startup and peer authentication call
`IsTokenRestricted` and require the corresponding compiled service SID in
`TokenRestrictedSids`; an unrestricted LocalSystem service with the SID only
as an enabled group is rejected.

Before either pipe can accept a peer, the active supervisor replaces every
ACE for the companion service SID on its own process object with exactly
`PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE`. This is the reciprocal
attestation grant; it includes no terminate, VM, token, debug, SCM, or process
control right. The companion makes the corresponding narrow grant to the
egress-supervisor SID on its process.

The flow claim contains the exact lease digest, registration ID, nonce
preimage, host, port, and destination-scope digest. The control journal stores
only the nonce digest. A successful claim consumes the registration in a
write-through record before DNS or connect, so the preimage is one-shot across
concurrency, disconnects, service crashes, and restarts. The nonce and proxied
bytes are zeroed or streamed; neither is written to logs or durable state.

Process and browser registrations remain unavailable. The direct-flow relay
does not claim to implement suspended-process attribution or browser-origin
completion. Those request kinds close fail-closed until separately measured
providers implement them.

The control plane can issue short-lived, purpose-separated startup evidence
for an exact measured Companion or Agent process. The signed envelope binds the
request nonce, boot, PID/start identity, pinned image digest, reviewed standard-
user manifest, destination policy, protocol/catalog versions, service SID, and
the canonical control-pipe DACL digest. It is issued only while the shared kill
switch is clear and live Secure Boot/HVCI/driver/service posture satisfies the
union of every requested feature. Duplicate request IDs are rejected, and the
Service and Agent each consume a response once. This evidence activates no
action by itself; each effect still requires its exact one-shot authorization
and terminal egress receipt.

The current host-posture provider has no measured browser broker and advertises
neither live-origin nor deterministic browser-completion evidence. The signed
transport can carry those features in a future independently measured
implementation, but browser capabilities remain fail-closed today. Nothing in
this protocol supplies a WFP driver, live-origin enforcement, VM evidence, or
production enrollment.

## Independent authorization and posture

The supervisor re-verifies the ES256 action JWT rather than trusting the
companion's prior decision. The token, binding, destination policy, device,
capability, dispatch count, and egress budget must match exactly. The raw JWT is
never persisted.

The destination policy preserves the immutable static allow-list of
capability, endpoint ID, IDN host, port, and destination-scope digest. Its
canonical SHA-256 is independently loaded by the supervisor and must equal the
deployment pin in the action binding and direct registration.

An optional policy section may explicitly grant
`mandate_dynamic_https_v1` to a closed capability set. A dynamic action must
carry one canonical public HTTPS URI, exact certificate digest, and exact
scoped vault metadata in its signed arguments. The supervisor derives a single
ephemeral policy entry from that immutable action, rather than adding a durable
allow-list entry. It resolves and rejects the complete A/AAAA set at
reservation, resolves again immediately before connect, connects to the
validated IP, and retains the signed hostname for SNI and normal PKI validation
plus the leaf pin. The raw one-request transport has no proxy or redirect
client. Dynamic browser authority and unauthenticated destination inspection
remain `NOT_READY`; see `EXTERNAL-ACTIONS.md`.

The companion's production templates leave dynamic destinations explicitly
disabled. `config/egress-destination-policy.dynamic-authenticated.example.json`
shows the paired supervisor-policy input; it is never auto-loaded or trusted
by filename. Its canonical digest must be provisioned consistently in the
supervisor, companion, backend device enrollment, and signed action binding.
Any absent or mismatched provision is `NOT_READY` and fails closed.

Contract v4 closes the source-level dynamic-route evidence gap. It canonicalizes
and sorts normalized IPv4/IPv6 answers, rejects the entire set if any address is
not public, persists only the reservation answer-set digest, and requires the
connection-time digest to equal it before dialing. That equality is a stricter
fail-closed form of containment that remains verifiable after restart without
persisting raw addresses. The selected address is chosen only from that
connection set; its digest and the connection-set digest are journaled before
TLS and carried in the signed terminal receipt and central ledger metadata.
Missing or changed evidence yields no completed receipt (an already consumed
ambiguous flow is terminalized as `unknown` and fully charged).

This contract slice is not evidence of a deployed WFP callout, live browser
origin boundary, or enrolled production workstation. Those inventory rows
remain `NOT_READY` until their independent build, VM, signing, enrollment, and
deployment evidence exists.

The live posture is re-probed before each new reservation and again before a
registration or flow can become effective. The attested boot identifier is
derived from the kernel's current `SystemTimeOfDayInformation.BootTime`, never
from persisted configuration. A lease from another boot or from a changed
driver/service measurement cannot open a flow; exact result replay and
terminal reconciliation remain available because they create no new egress.

A proxy alone is insufficient to mint `DriverActive` or
`process-tree-attributed`. Before the engine starts, the Windows posture
provider proves all of the following live:

- UEFI Secure Boot is enabled;
- HVCI is configured and the kernel code-integrity state reports enforcement,
  not audit mode;
- the configured kernel driver service is running and its exact pinned image
  is present in the loaded-driver table;
- the driver answers a random health challenge through its protected device
  handle; and
- this service image matches its protected SHA-256 pin.

The driver health IOCTL receives `nonce || destinationPolicySha256` (64 bytes)
and returns:

`SHA256("MSAIDIZI-EGRESS-DRIVER-HEALTH-V1\0" || nonce || driverImageSha256 || destinationPolicySha256)`

This challenge is a liveness and measurement binding, not a substitute for VM
tests that prove the driver's WFP policy and process attribution. If any live
probe or pin fails, no valid boundary attestation or lease is issued.

Attestation and receipt keys are purpose-separated ECDSA P-256 certificates in
`LocalMachine\My`. Active startup requires machine-scoped, non-exportable
`ECDsaCng` keys from the Microsoft Platform Crypto Provider and an exact private
key DACL containing one full-control grant only to the restricted
egress-supervisor service SID (with System remaining the owner, not a DACL
grantee). This lets the SID satisfy both the normal and restricting-token access
checks without granting direct key use to unrelated LocalSystem services. The
companion receives only the attestation public certificate in
`LocalMachine\TrustedPeople`; it must never receive either private key.

Different key IDs or certificate thumbprints are not accepted as proof of key
separation. Active startup exports the canonical public SPKI for the
attestation key, receipt key, and public-only broker action-verification key,
then rejects equality between any pair before either signer can be used. All
temporary SPKI buffers are zeroed. This also prevents the supervisor from
possessing an action-signing key under a different certificate wrapper.

## Durable lifecycle and crash recovery

The service owns a separate state root:

`%ProgramData%\Itemba\Msaidizi\supervisor\egress-supervisor\lifecycle.v2.jsonl`

It never writes the companion receipt-replay ledger. In active mode the
lifecycle journal and `.lock` file must already exist, have no reparse-point
target or ancestor, and be exclusively ownable. Missing files do not create a
new genesis. Active startup also requires NTFS, System ownership, a protected
exact DACL granting full control to LocalSystem, modify only to the egress
supervisor service SID, and read/execute only to the recovery-operators group.
After open, the service rechecks the ACL through each handle, the final resolved
path, non-reparse type, and link count of exactly one. The companion has no
write grant to this state root.

Every reservation, registration, consumed flow, route attestation, completed measurement,
recovery decision, and terminal receipt is an fsync-backed, strict-JSON,
hash-chained snapshot. Records contain no JWT, nonce preimage, credential, DNS
payload or raw address, HTTP data, or proxied bytes. Startup rejects malformed UTF-8, partial
tails, sequence gaps, hash changes, authorization-signature changes, receipt
signature changes, receipt-sequence rollback, and conflicting lifecycle
transitions.

If the service stops after consuming a flow but before durably closing its
measurement, startup changes that exact lease to `recovery-uncertain`. It can
only accept an `unknown` terminal disposition, and the signed receipt charges
the full reservation. It never reconnects, redispatches, or retries the
external action. An exact terminal retry returns the already journaled signed
receipt; a different disposition using the same operation is rejected.
Terminal reconciliation remains valid after lease expiry because it cannot
open a new flow and is required after an extended outage.

## Flow accounting

Only bytes successfully written from the authenticated data pipe to the
supervisor-owned remote socket count as measured external egress. A write that
throws may have partially reached the network, so it marks measurement
uncertain. No byte beyond the signed reservation is written. Unknown or
uncertain outcomes charge `reserved - measured` as uncertain bytes, making the
total charge exactly the reservation.

The flow-log digest incorporates the lease, flow, destination, and the exact
outbound byte stream without retaining that stream. Control logs contain only
stable refusal codes. They never contain tokens, nonces, destinations,
credentials, payloads, or response bodies.

Pipe teardown and settlement are ordered with a per-lease condition, not a
sleep or whole-action retry. An immediate terminal request releases the engine
gate and waits for the exact flow's durable close record for at most the
configured short bound. The condition is signalled only after `FlowClosed` or
`RecoveryUncertain` is fsync-journaled. Concurrent pipe sessions are also
bounded before a server instance is created, so reaching the configured limit
backpressures acceptance instead of crashing the service.

## Deployment gates

Enabling the service requires all of these external artifacts:

1. Signed x64 service and kernel-driver binaries with exact deployment pins.
2. Restricted service SIDs, an exact service DACL, and LocalSystem/session-zero
   configuration. The runtime tokens must prove the fixed egress and companion
   SIDs in their restricting-SID sets.
3. Preprovisioned lifecycle files whose protected ACL grants write only to the
   egress supervisor boundary and read-only recovery access.
4. TPM/CNG key enrollment and a public-only companion trust certificate.
5. A canonical destination-policy manifest whose digest matches backend and
   companion enrollment.
6. A companion adapter that retains the nonce preimage, sends the flow claim,
   and performs TLS over the flow pipe. Direct `TcpClient` execution remains a
   fail-closed integration error.
7. Windows 11 VM evidence for WFP escape resistance, descendant attribution,
   concurrent ceiling enforcement, crash/reboot recovery, replay, kill switch,
   and receipt reconciliation.

The service does not make the privileged-command isolation supervisor, browser
broker, signing infrastructure, installer evidence, or ring rollout complete.
Those independent gates remain mandatory.

Focused verification:

```powershell
& $dotnet test .\tests\Msaidizi.EgressSupervisor.Tests\Msaidizi.EgressSupervisor.Tests.csproj `
  --configuration Release
```

The suite covers exact contract-v2 hashes and signatures, control-wire
compatibility, one-time flow consumption, direct validated-IP socket ownership,
DNS rebinding rejection, SNI and certificate pinning, byte charging,
idempotency conflicts, active-flow restart recovery,
unknown full charge, journal tampering, exclusive ownership, missing-genesis
refusal, delayed post-restart settlement, live-posture drift, immediate-settle
ordering and replay, process/browser refusal, safe-off host startup, exact key
and process-object ACLs, first-instance creation, remote-client rejection, and
absence of a data-plane listener.
