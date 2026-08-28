# Windows egress boundary deployment contract

Network-capable launch and external-action effects remain disabled in every
packaged configuration. This includes raw PowerShell/CMD, browser-origin
effects, owned-process launch, MSI install/uninstall, scheduled-task run,
Windows-service start, and the typed email, messaging, publishing, and purchase
adapters. Status, read, stop, and task-owned termination paths remain available
for diagnosis and cleanup. The repository contains a separately signed
user-mode egress supervisor for the typed external-action fast path;
process-tree and browser enforcement still require the separately attested
WFP/browser boundary described below.
An independently deployed trusted-root isolation gate is also mandatory. Its
only production implementation in this repository always rejects and has no
configuration override, so implementing or enabling this egress boundary alone
still cannot make `command.privileged.execute` launch.

## Required companion integration protocol

`IEgressBoundaryClient` now opens a versioned, full-lifecycle session with
reserve/resume, typed process/direct/browser registration, settle/abort, and a
terminal signed receipt. The coordinator accepts terminal evidence only from
that session; a capability-supplied receipt is rejected. The named-pipe client
authenticates the exact compiled restricted LocalSystem service SID in both
enabled groups and `TokenRestrictedSids` before disclosing the action token. It
compares the authenticated process image mapping to the locked measured file
object, validates exact acknowledgements, and makes retries idempotent.
Packaged configuration still selects
`DisabledEgressBoundaryClient`.

The control protocol also carries a purpose-separated capability-activation
attestation for the Companion service and standard-user Agent. It binds a
single fresh request nonce to the supervisor boot, exact PID and process-start
identity, pinned image digest, reviewed capability-manifest digest, destination
policy, protocol/catalog versions, and the verified control-pipe DACL digest.
The Agent receives this envelope only inside the already authenticated
LocalSystem session-bridge challenge and verifies it independently against a
separate public-certificate pin. A replay, stale envelope, process/image or
manifest mismatch, kill switch, invalid HVCI/driver/service posture, or pipe
ACL mismatch leaves the classified capabilities absent. Configuration flags
are requests only and cannot self-attest.

This activation channel transports measured features; it does not invent
them. The checked-in Windows posture provider currently supplies the command
feature set only and supplies no browser-broker build or live-origin/completion
features. Browser navigation, form, upload, download, and UI invoke effects
therefore remain unavailable even if their booleans are changed. This source
slice is not a WFP driver, browser live-origin boundary, or deployment result.

Typed email, messaging, publishing, and purchase actions now use an outbound-
only direct-flow pipe. The Companion never owns the Internet socket or
`SslStream`: the supervisor resolves exact endpoint policy, validates the
canonical action body and HTTP template, resolves the policy-pinned credential
record read-only, constructs the authorization header, performs TLS certificate
pinning, and meters ciphertext. The supervisor exposes no TCP/UDP listener.
Other network-capable effects remain refused until their dedicated boundary
exists.

TLS retains system chain and hostname validation plus the exact leaf pin, but
deliberately uses offline revocation policy with certificate downloads disabled.
This prevents OS CRL/OCSP/AIA fetches from creating unmetered side-channel
egress; deployments must refresh trust/revocation state out of band.

A production integration must use one versioned session across the complete
effect lifecycle:

1. Open one idempotent reservation bound to the exact action token and
   `EgressActionBinding`.
2. For process effects, create the child suspended and register its PID,
   creation identity, executable digest, and owned job identity with the
   supervisor before resume. MSI, scheduled-task, and service effects need
   capability-specific attribution because their descendants may be created by
   other Windows services.
3. For direct HTTP effects, use a boundary-owned proxy/socket or equivalent WFP
   flow tag. Traffic from the shared LocalSystem companion process cannot be
   attributed safely from a caller-reported byte count.
4. On success, failure, cancellation, disconnect, or recovery, settle or abort
   the same lease and retrieve one signed terminal receipt. Ambiguous settlement
   remains `unknown` and charges the full reservation.
5. Verify the authorization and receipt locally against the independently
   enrolled public key, then commit the receipt to the replay journal before
   reporting a terminal action result.

Receipt contract v4 additionally binds the broker-signed argument digest,
expected pre-state, idempotency key, exact destination scope, canonical request
body, exact-request policy, reservation DNS-answer-set digest, connection-time
DNS-answer-set digest, and selected-address digest to the lease and receipt.
Direct registrations
include authenticated process creation identity, destination scope, and nonce
digests, so PID reuse or plaintext substitution is rejected. Crash
recovery that can resume and terminalize the same supervisor lease remains a
separate production blocker and is not implemented by the companion journal.

The standard-user tray needs the same verified semantics through the measured
WebView2 broker. Pipe ACLs or caller-supplied files are not trust anchors; a
local transport must authenticate the supervisor on the exact connection and
must never disclose the compact action token to an unauthenticated pipe server.

## Required external boundary

An enabling deployment requires all of the following outside the companion:

- a Windows 11 host with Secure Boot and HVCI enabled and independently
  measured;
- a separately signed LocalSystem boundary-supervisor service and a signed WFP
  callout driver that attribute the complete process tree to one action lease,
  enforce the centrally pinned destination policy, and hard-stop that tree at
  the signed per-action reservation (never more than 262,144,000 bytes);
- an independently enrolled, preferably hardware-backed, boundary-attestation
  key. The ordinary paired-device key is not an attestation key;
- a receipt key authorized only by a fresh boundary attestation, monotonic
  receipt sequence numbers within each boot UUID, durable lease/receipt replay
  protection, and deterministic terminal measurement after the process tree is
  stopped;
- for browser effects, a separately measured WebView2 broker that binds the
  exact origin and a deterministic completion acknowledgement to the same
  action, process tree, lease, and receipt; and
- protected deployment enrollment of the identical supervisor public-key,
  destination-policy, and execution-identity SHA-256 pins in the backend and
  companion configuration.

## Companion attestation trust

The companion can optionally resolve the separately enrolled supervisor's
attestation **public key** from a Windows certificate store. This remains only
a verification trust anchor; it is not a WFP client, driver, or byte meter.
The production named-pipe lifecycle client is selected only when its exact
protocol version, safe pipe name, LocalSystem supervisor image path and SHA-256
measurement, trusted attestation key ID, and the companion destination-policy
and execution-identity pins are all present. Any missing, duplicate, malformed,
or mismatched value selects `DisabledEgressBoundaryClient`.

```json
{
  "EgressSupervisorClient": {
    "Enabled": true,
    "Transport": "named-pipe-v2",
    "ProtocolVersion": 2,
    "PipeName": "Itemba.Msaidizi.EgressSupervisor.v2",
    "ExpectedSupervisorImagePath": "C:\\Program Files\\Itemba\\Msaidizi.EgressSupervisor.exe",
    "ExpectedSupervisorImageSha256": "REPLACE_WITH_LOWERCASE_SHA256",
    "ExpectedSupervisorServiceSid": "S-1-5-80-2691216044-51290016-1044150087-1430489630-3303720160",
    "ExpectedSupervisorPipeSecuritySha256": "REPLACE_WITH_EXACT_PIPE_DACL_SHA256",
    "AttestationKeyId": "boundary-supervisor-2026-01"
  }
}
```

The Agent additionally needs the same destination-policy and pipe-DACL pins,
plus a purpose-separated public certificate for activation signatures:

```json
{
  "Agent": {
    "EgressDestinationPolicySha256": "REPLACE_WITH_POLICY_SHA256"
  },
  "CapabilityBoundaryTrust": {
    "Enabled": true,
    "KeyId": "boundary-supervisor-2026-01",
    "CertificateThumbprint": "REPLACE_WITH_PUBLIC_ONLY_CERTIFICATE_THUMBPRINT",
    "CertificateStoreName": "TrustedPeople",
    "CertificateStoreLocation": "LocalMachine",
    "ExpectedSupervisorPipeSecuritySha256": "REPLACE_WITH_EXACT_PIPE_DACL_SHA256",
    "AllowedClockSkewSeconds": 30,
    "MaximumAttestationLifetimeSeconds": 120
  }
}
```

Pipe connect, remote connect, and overall flow deadlines are independent, and
the effective deadline never exceeds lease expiry. The shared trusted-root kill
switch is `C:\ProgramData\Itemba\Msaidizi\supervisor\DISABLED`; a missing or
unreadable trusted root, any indirect ancestor, or a present switch file fails
closed and cancels active flows through service shutdown.

Provision `EgressAttestationTrust` only after the external boundary has passed
the acceptance stages below. Each `KeyId` must map one-to-one to one exact
certificate thumbprint, store name, and store location. Install only the public
certificate in the companion-visible store: a matching certificate with an
accessible private key is rejected because it would collapse the independence
between the LocalSystem companion and the boundary supervisor. The certificate
must be a current, non-CA ECDSA P-256 signing certificate. Duplicate key IDs,
duplicate certificate thumbprints, ambiguous store results, invalid curves,
and empty enabled configurations fail closed.

```json
{
  "EgressAttestationTrust": {
    "Enabled": true,
    "TrustedSupervisorCertificates": [
      {
        "KeyId": "boundary-supervisor-2026-01",
        "Thumbprint": "REPLACE_WITH_PUBLIC_ONLY_CERTIFICATE_THUMBPRINT",
        "StoreName": "TrustedPeople",
        "StoreLocation": "LocalMachine"
      }
    ],
    "PairedDeviceCertificateThumbprints": [
      "REPLACE_WITH_BOOTSTRAPPED_DEVICE_CERTIFICATE_THUMBPRINT"
    ]
  }
}
```

The configured `BrokerChannel.DeviceCertificateThumbprint` is automatically
treated as a paired-device identity. Put any bootstrapped or rotated device
certificate thumbprints not present there in
`PairedDeviceCertificateThumbprints`; reuse of a known paired-device
certificate or its underlying ECDSA public key as a boundary-attestation
identity is rejected. These certificates are resolved from the exact
`BrokerChannel` device certificate store. This check cannot discover an
identity that has not been declared in either location, so deployment
enrollment must keep the list current.

Driver signing, EV/WHQL or Microsoft attestation signing, certificate issuance,
Secure Boot/HVCI policy, WFP filter ownership, WebView2 deployment, and VM/ring
orchestration are external infrastructure. They cannot be replaced by a
device-key signature or a user-mode byte counter.

## Acceptance stages

1. Contract tests must pass for canonical C#/TypeScript vectors, independent
   supervisor signatures, stale/false host claims, action and deployment-pin
   mismatch, unknown full-charge, browser claims, restart replay, and boot
   sequence rollback.
2. Driver/service tests on Windows 11 must prove process creation races cannot
   escape WFP attribution, descendant and broker traffic is charged exactly,
   the 250 MB ceiling is enforced under concurrency, and termination produces
   one durable receipt across crash and reboot.
3. Browser tests must prove redirects, popups, downloads, uploads, service
   workers, renderer/network processes, cancellation, and ambiguous completion
   retain the original origin/action binding. Ambiguity must produce `unknown`
   and charge the full reservation.
4. A disposable signed-installer VM run must validate ACLs, independent key
   enrollment, Secure Boot/HVCI/driver/service measurements, replay after
   restart, kill-switch behavior, and backend `NEEDS_ATTENTION` settlement for
   absent, invalid, mismatched, replayed, or non-completed evidence.
5. A controlled ring must validate telemetry and rollback before either flag is
   changed from false.

The installed defaults use a rejecting boundary client and have
`EgressAttestationTrust.Enabled: false` with an empty certificate list, which
selects the rejecting attestation-key resolver. `BrowserExternalEffectsEnabled`
and `EmergencyCommandEnabled` remain false. Empty deployment pins or the
absence of a fresh authoritative attestation therefore keep every classified
network-capable effect unavailable. Certificate trust alone does not enable an
effect. None can honestly be enabled before the applicable external driver,
certificate, browser broker, VM, and ring evidence above has been reviewed.

Verified receipt replay state is reserved at
`%ProgramData%\Itemba\Msaidizi\supervisor\egress-boundary\receipts.v1.jsonl`.
The installer creates that ledger and its ownership lock under a dedicated,
protected directory: SYSTEM has full control, the restricted companion service
SID has modify access, and Recovery Operators are read-only. Administrators,
ordinary users, and the other supervisor services receive no direct ACE. The
ledger path is separate from the privileged-command isolation ledger so each
trust boundary can be recovered and audited independently.

The receipt ledger is a bounded, strict-JSON, hash-chained append log. A single
process owns its companion `.lock` file, every accepted append is flushed to
stable storage, and startup rejects partial records, unknown fields, malformed
UTF-8, replay conflicts, sequence rollback, or hash tampering. Repeating the
exact same receipt is idempotent; reusing any receipt, digest, authorization
lease, boot sequence, or action identity with different evidence fails closed.

Production startup accepts only the exact installer-owned ProgramData path and
requires the SYSTEM-owned protected DACL for the directory, ledger, and lock.
Both files must already exist; the service never recreates a missing production
ledger as a new genesis. They are opened through non-following, single-link,
write-through handles whose final identities are pinned against rename and
replacement. Ledger validation runs as an ordered hosted-service fence before
broker intake. Any later commit, replay, receipt-integrity, or measurement
failure trips a one-way process latch, records conservative ambiguity, and
stops the worker before another egress-capable action can execute.
