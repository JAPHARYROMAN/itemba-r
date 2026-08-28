# Privileged-command isolation supervisor

`Itemba.Msaidizi.PrivilegedCommandSupervisor` is the independently deployed
trust owner for `command.privileged.execute`. It completes the service-side
half of the companion's existing
`NamedPipePrivilegedCommandTrustedRootIsolationClient` protocol without giving
the companion the supervisor signing keys, lifecycle ledger, driver device, or
policy state.

This boundary follows the NEXT constitution's independent-service, zero-trust,
observable, resilient, and strongly typed requirements (sections 3 and 6).
The supervisor references only `Msaidizi.Companion.Contracts`; it does not
reference or load the companion service assembly.

## Safe-off installation

The checked-in configuration has `Enabled=false`. In this state the Windows
service remains running so SCM dependencies are stable, but it opens no pipe,
signing keys, lifecycle journal, process, or driver handle. Installing the
binary cannot enable raw PowerShell/CMD.

An active deployment must atomically provision a signed configuration and set
`Enabled=true`. Every UUID, SID, local path, duration, certificate thumbprint,
and lowercase SHA-256 pin is then mandatory. Placeholder values fail runtime
image/driver/key validation. The companion must remain registered to
`RejectingPrivilegedCommandTrustedRootIsolationGate` until that measured
release is installed and verified; a model-controlled flag cannot select this
supervisor.

Active mode also requires the shared trusted-root
`%ProgramData%\Itemba\Msaidizi\supervisor\DISABLED` file to be absent. A
dedicated one-second monitor stops the service if the file reappears; host
shutdown closes the driver device, and the driver must kill every active tree.

## Trust separation

Active deployment requires two restricted LocalSystem Windows services:

- `Itemba Msaidizi Privileged Command Supervisor`, with its own restricted
  service SID; and
- `Itemba Msaidizi Companion`, with a different restricted service SID.

Each of the four lifecycle signature purposes has a distinct non-exportable
P-256 machine key in the Microsoft Platform Crypto Provider: reservation
lease, pre-bind reservation release, suspended-process bind acknowledgement,
and terminal enforcement receipt. Active configuration requires four distinct
key IDs, certificate thumbprints, and canonical public P-256 SPKIs. At startup
each certificate must match its configured SPKI and each private key must have
`ExportPolicy=None`. The service reads every CNG `Security Descr` property and
requires a protected, explicit DACL containing exactly one `GENERIC_ALL` ACE
for the fixed supervisor SID; neither the companion SID nor generic
LocalSystem receives key use. A key can sign only its fixed lifecycle method,
so no purpose can be substituted for another. Installer intent alone is not
accepted. Two additional purpose-distinct, public-only P-256 pins verify the
broker ES256 action token and the native driver's nonce-bound attestation.
Neither verifier certificate may contain a private key; its LocalMachine
TrustedPeople thumbprint and canonical SPKI must both match signed deployment
configuration. No signer/verifier key ID, certificate, or SPKI may be reused
across the six purposes. The driver device ACL is identical in principle: only
the supervisor SID may open it.

The SCM name and SID are compiled trust pins, not a configurable identity:

- `Itemba Msaidizi Privileged Command Supervisor`
- `S-1-5-80-1792805186-3282615177-1795010573-3676175622-4117989893`
- `Itemba Msaidizi Companion`
- `S-1-5-80-341263411-3719254221-1864525750-3877438856-2718495063`

Active startup requires the configured pin and the live restricted token to
match the respective exact SID. Renaming or replacing either service therefore
fails closed until a separately reviewed binary updates the pins. Both peer checks read
`TokenRestrictedSids` and require the relevant service SID in that restricting
set; merely adding the SID as a group on an unrestricted LocalSystem token is
not accepted.

The pipe is local-only and created from a protected DACL containing only `SY`
and the configured companion service SID. After connection the supervisor also
pins the live peer to:

- session zero and LocalSystem;
- the exact companion restricted service SID;
- the exact installed image path and SHA-256;
- a single-link, non-reparse image and ancestor chain;
- `ProcessImageFileMapping` equality between the retained file handle and the
  process's mapped executable section, plus exact final-handle path; and
- the process creation time, while retaining process and image handles for the
  connection lifetime.

The process claims the pipe namespace with `FILE_FLAG_FIRST_PIPE_INSTANCE` on
its first server handle and retains that process-local claim while creating
subsequent concurrent instances without the flag. Startup therefore fails if
another process already owns the configured namespace; every instance also
uses `PIPE_REJECT_REMOTE_CLIENTS`.

The companion performs the reciprocal check: session-zero LocalSystem server,
exact supervisor path/SHA, and purpose-pinned P-256 verification keys.
At startup this supervisor adds one process-object ACE granting the companion
SID only `PROCESS_QUERY_INFORMATION | SYNCHRONIZE`, which is required for the
mapped-image query and is sufficient
for that reciprocal check but cannot terminate or mutate the supervisor. The
companion must add the equivalent supervisor-SID ACE to its own process object
before active client registration. SCM service DACLs do not substitute for
these runtime process-object ACEs. Activation replaces every pre-existing ACE
for the fixed companion SID, preserves unrelated trustees, then rereads the
process DACL and requires exactly one direct non-callback allow ACE and exact
effective rights `0x00100400`; a broader, duplicate, inherited, object-specific,
or callback ACE fails closed.

The supervisor authenticates its own running executable the same way: it hashes
the retained single-link file handle only after proving that handle is the
image section mapped into the current service process. Replacing a clean path
beside a different running image cannot satisfy self-measurement.

## Exact lifecycle

The closed v2 framed protocol is intentionally incompatible with v1:

1. `reserve.request.v2` carries the compact token, exact `ActionRequest`, and
   canonical invocation only on the live pipe. The independently configured
   ES256 verifier requires issuer `itemba-msaidizi-broker`, audience
   `itemba-windows-companion`, and subject `msaidizi-global`. It binds every
   action/task/plan/step/device/mandate ID, capability/version, arguments,
   pre-state/provenance, idempotency, lease/fence/expiry, dispatch/mode, and the
   complete budget object to the reservation. Invalid signatures or any claim
   drift fail before a durable reservation. A public canonical validator also
   rejects noncanonical optional digests, malformed lease/fence identities,
   dispatch counts above the broker-session ceiling, and every budget outside
   its compiled hard bound before canonical hashing or lease creation.
2. The canonical invocation covers executable ID/path/file identity/image
   digest, every argv element, working directory, sorted environment block,
   requested/effective timeout and output ceilings, maximum process count, and
   process-memory ceiling. The supervisor independently derives permitted
   CMD/Windows PowerShell paths, working directory, environment, signed argv,
   and exact effective resource policy. Defaults are 300 seconds, 1 MiB output,
   16 processes, and 512 MiB per process, within compiled hard bounds.
3. The supervisor requires a fresh exact driver attestation before issuing a
   signed reservation and again immediately before kernel bind. The managed v3
   bridge first validates exact `GET_PROTOCOL` structure sizes/features and a
   nonce-bound `GET_HEALTH`, then requires the unchanged signed-v2 attestation
   verifier. Loss of signed evidence or live Secure Boot/HVCI/WDAC posture in
   that interval fences the service. The reservation alone permits only
   creation of a still suspended child.
4. `suspended-bind.request.v2` must identify the authenticated peer as parent
   by PID *and creation time*. The supervisor independently reopens the child,
   verifies creation time and live image path, then retains one no-write/no-delete
   executable handle across file identity, byte hashing, final NT-path capture,
   and path-derived WFP application-ID lookup. It rejects the bind unless that
   WFP ID names the still-locked handle and its volume/file/path identity remains
   unchanged. It derives the kernel process start key and exact process identity,
   retains the executable lock through settlement, and attaches the
   still-suspended child to a supervisor-owned nested
   kill-on-close job. It installs or reuses a generation-bound deny-all policy
   and calls v3 `ENROLL_PROCESS`; the driver independently reopens and binds the
   PID/create-time/start-key/live NT path before returning success. The signed
   attestation authority must still prove the complete filesystem/registry/SCM/
   supervisor-process feature set; the current production source rejects
   because that authority is not provisioned.
5. Only after the durable bind acknowledgement is signed and flushed may the
   companion resume the primary thread.
6. Settlement comes from the supervisor-owned nested job plus v3
   `REMOVE_PROCESS` and post-removal `GET_HEALTH`, not client assertions. A
   mismatch is downgraded to a signed `isolation-violation`, committed, returned
   to the companion for its own durable commit, and followed by a one-way
   dispatch fence.

Release and bind are mutually exclusive. Each request/action ID has one exact
canonical digest. Exact duplicates return the prior signed evidence; a changed
request, process identity, outcome, or receipt conflicts. Sequence numbers are
monotonic across the supervisor ledger. An expired duplicate reservation is
explicitly rejected rather than returning stale signed authority.

The initial request and each response use the bounded operation timeout. A
separate two-minute session-idle ceiling lets the companion create and inspect
the still-suspended child between reservation and bind without turning a pipe
read timeout into an authorization extension; the signed lease remains the
strictest of request expiry, supervisor policy lifetime, broker token expiry,
and central action-lease expiry, and can never exceed one minute by default.

## Durable recovery and process-tree ownership

`lifecycle.v1.jsonl` is a single-writer, write-through, hash-chained ledger
beneath:

`%ProgramData%\Itemba\Msaidizi\supervisor\privileged-command-supervisor`

This root is distinct from the companion-owned
`supervisor\privileged-command-isolation\replay.v1.jsonl`. Neither service may
write the other's root. Records contain signed identities and digests only;
they never contain command text, stdout/stderr, action tokens, credentials, or
model content.

The compact token, raw `ActionRequest`, argv, and environment exist only in
redacted `[JsonIgnore]` wrappers and bounded live request frames. Frame byte
arrays are zeroed after dispatch. Only token/invocation digests and signed
authorization facts reach the journal; the raw idempotency key is converted to
its canonical SHA-256 digest before that binding is created. Persistence
serializers cannot traverse the ephemeral wrapper.

Production never creates a missing journal or a new hash-chain genesis. The
installer must precreate both `lifecycle.v1.jsonl` and
`lifecycle.v1.jsonl.lock`. The directory and both files are owned by SYSTEM,
have protected non-inherited DACLs, and grant access only to SYSTEM, the fixed
privileged-command supervisor service SID, and the recovery-operators group.
The directory grants inheritable FullControl/Modify/ReadAndExecute respectively;
each file grants the same rights without inheritance flags. Startup requires
those exact descriptors, an NTFS volume, non-reparse ancestors, single-link
non-reparse file handles, exact final handle paths, and an exclusive ownership
lock. It rereads the handle ACLs after opening with `FileMode.Open` and
write-through semantics. Deletion, substitution, hard linking, inheritance,
or any extra administrator, companion, or other-supervisor ACE stops startup
instead of silently replacing evidence.

The high-level recovery contract requires the supervisor, before opening the
pipe after restart, to:

1. validates the complete local hash chain and obtains a fresh driver
   attestation;
2. asks the driver to terminate and settle every exact pending bound tree;
3. commits signed terminal receipts;
4. signs childless releases for every pending reservation; and
5. refuses startup if any state cannot be reconciled.

The v3 bridge owns its nested job handle inside the restricted supervisor. The
companion grants that exact fixed service SID reciprocal process-query rights;
the bridge reopens the still-suspended child, assigns it to the nested job, and
retains the handle through settlement. Service loss closes the job and kills
the tree while loss of the sole driver handle independently latches network
kill. The frozen driver keeps policy/enrollment only for its current load and
cannot clear a latched kill without reload. Therefore crash/restart recovery is
still safe-off, not accepting: missing historical native evidence is fatal and
never produces a success receipt. A signed VM matrix must prove restart,
driver-reload, and central-ledger reconciliation before activation.

## Required driver contract

The .NET service intentionally has no accepting fallback. The high-level pipe
and signed evidence remain v2-compatible, but
`WindowsKernelIsolationDriverClient` now dispatches only the frozen binary v3
surface:

- protocol negotiation (`GET_PROTOCOL`, `0x0022E040`);
- nonce-bound health (`GET_HEALTH`, `0x0022E044`);
- atomic policy replacement (`REPLACE_POLICY`, `0x0022E048`);
- suspended process enrollment (`ENROLL_PROCESS`, `0x0022E04C`);
- terminal process removal (`REMOVE_PROCESS`, `0x0022E050`); and
- one-way kill (`SET_KILL_STATE`, `0x0022E054`).

All integers are encoded explicitly little-endian. The client rejects any
wrong size/version/type/flag/reserved field, request ID, driver boot ID,
generation, sequence, policy digest, measurement, feature set, health challenge,
or status. The legacy JSON v2 IOCTLs remain explicit native denials and are
never dispatched by production source.

Before any reservation, the fixed SCM kernel-driver service must be running,
its exact `ImagePath` must match the pinned driver path, and that path must be
associated with a currently loaded kernel image. The supervisor independently
requires live Secure Boot, enforced HVCI (not audit), and enforced WDAC/UMCI
(not audit, test-signing, or debug mode). It sends a fresh 256-bit nonce and
accepts only a purpose-specific P-256 signed response whose pinned key/SPKI,
nonce digest, device, supervisor instance, boot ID, policy epoch, fixed service,
policy/driver/service measurements, image-path digest, posture, feature set,
and short validity window all match exactly.

The complete trusted boundary must independently enforce and attest the ordered feature set from
`PrivilegedCommandIsolationFeatures.Required`, including trusted-root
filesystem and registry denies, SCM and supervisor-process denies, nested job
kill-on-close, kernel process-tree binding, bind-before-resume, terminal
receipts, exact invocation measurement, signed driver attestation, Windows
posture, and boot replay protection. It must measure the exact policy, driver,
service, mapped executable file identity, command line, working directory, and
environment while the child is still suspended. The frozen network driver
alone does not satisfy those non-network claims and its measurement fields are
currently unprovisioned; `UnavailableV3SignedDriverAttestationSource` therefore
keeps the production service rejecting. A missing device, wrong measurement,
timeout, malformed
response, incomplete feature set, or uncertain tree state closes the device
and stops the supervisor fail-closed.

## Deployment order

1. Install signed supervisor and driver binaries into protected, non-reparse
   directories.
2. Create distinct restricted service SIDs and exact state/key/device/pipe
   ACLs, including the precreated lifecycle journal and ownership-lock files.
3. Provision four TPM-backed signing certificates and the matching four exact
   companion public-key purpose bindings:
   reservation lease, pre-bind release, suspended-bind acknowledgement, and
   terminal enforcement receipt.
4. Provision purpose-distinct public-only action-token and driver-attestation
   verifier certificates with exact thumbprint and SPKI pins. The native
   attestation signing key must be hardware-backed and inaccessible to the
   companion and supervisor service.
5. Provision exact device, boot-policy, driver, service, client-image, and
   server-image pins in a signed release.
6. Start the driver, then the supervisor. Verify safe active attestation and an
   empty/reconciled lifecycle ledger.
7. Replace the companion's rejecting DI binding only in that protected release,
   retaining its startup reconciler before broker intake.
8. Make the delayed-auto companion depend on the active supervisor. Safe-off
   first installs may retain a running supervisor but must keep the companion
   rejecting.

## Acceptance evidence still required

Unit tests cover exact signed lifecycle verification, every action-claim and
invocation-field mutation, independent observation/driver-measurement drift,
pure signed-attestation key/nonce/purpose/time/boot/policy/posture mutations,
mapped-image mismatch, ephemeral-token/idempotency-key non-persistence,
canonical optional-digest/lease/fence/budget rejection, authorization-lifetime
clamping, expired replay rejection, reserve-to-bind posture loss, idempotent replay,
release/bind exclusivity, action-ID conflict, parent creation-time binding,
single-writer and tamper rejection, driver loss, settlement loss, signed
violation fencing, pending reservation recovery, and exact bound-tree restart
recovery. Managed v3 regressions additionally parse the frozen C header and
portable ABI assertions, verify exact little-endian offsets/sizes/constants,
and exercise fake-device protocol/health/policy/enroll/remove/replay/kill,
supervisor-owned job bind/settle semantics, and executable replacement/identity
drift while the retained handle denies writes and deletion. They are source evidence, not a
kernel build, loaded-driver test, or restart proof.

Production activation additionally requires a signed disposable Windows 11
VM matrix proving:

- restricted-service-SID pipe and driver ACLs, including denied impersonation
  and same-user spoof processes;
- bind-before-resume under PID reuse and process-DACL stress;
- driver-owned descendants cannot escape the nested job;
- direct and indirect filesystem, registry, SCM, process-control, handle-
  duplication, device, reparse, hard-link, and TOCTOU attacks are denied;
- companion, supervisor, driver, network, and workstation restart at every
  lifecycle boundary never duplicates a mutation;
- cancellation/timeout/output overflow kill all descendants;
- service crash/device-handle close kills every owned tree and produces
  recoverable terminal evidence;
- journal truncation/rollback conflicts with driver replay protection;
- certificate and state ACLs exclude the companion and ordinary LocalSystem
  processes; and
- kill-switch and rollback drills preserve the supervisor, audit signer, and
  recovery roots.

The repository still contains no native driver implementation that can satisfy
the v2 nonce signature, live posture, exact suspended-invocation measurement,
and kernel enforcement contract. Consequently the managed service fails closed
against the legacy/absent driver. Until that native component, protected
installer wiring, purpose pins, and signed VM evidence exist, this project is
an independently deployable fail-closed supervisor implementation—not a claim
that privileged commands are production enabled.
