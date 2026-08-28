# Operational and staged-ring acceptance boundary

The disposable-VM installer gate proves packaging and fail-closed bootstrap
only. This directory defines the separate evidence required before a signed
candidate may be labelled production-deployment eligible.

`operational-acceptance.schema.json` is emitted by an isolated operational
acceptance orchestrator after it exercises the exact signed candidate against
enrolled Windows 11 devices. The evidence is detached-CMS signed by an
allowlisted operational evidence identity. It binds the installer VM approval,
release manifest, source revision, MSI, every enrolled device identity, and an
immutable artifact for each required check. It must remain
`productionDeploymentEligible: false` because ring progression has not yet
been proven. The contract contains exactly the 15 reviewed operational checks
and requires at least 18 declared artifacts: one for each check, at least one
enrolled-device TPM attestation, the provider verification-key bytes, and the
provider contract-document bytes. The provider-contract check artifact is the
signed attestation itself. The strict top-level `providerContract` object binds
the attestation, public key, signer SPKI, contract document, exact Anthropic API
origin/account/model/data-class scope, zero-training/zero-retention claims,
content-addressed legal reference, and validity interval. The production
verifier independently enforces the same minimum and requires each referenced
check, device attestation, and provider artifact digest to occur in the
declared immutable-artifact set.

`ring-acceptance.schema.json` is emitted only after sequential ring 0, 5%, 25%,
and 100% trials. Every ring must meet the protected policy's minimum health
window and prove central/device kill switches, global Autopilot disable,
recovery, ledger reconciliation, autonomous-update rollback, and absence of
duplicate mutations or external actions. The record is detached-CMS signed by
a different allowlisted ring evidence identity and binds the exact operational
evidence bytes.

`scripts/Approve-OperationalRelease.ps1` requires paths to the real canonical
provider attestation, detached P-256 public key, and reviewed contract document;
declared hashes alone are insufficient. It invokes the read-only .NET 8
provider-contract verifier staged inside the exact signed release candidate.
That verifier locks and reads the actual bytes, checks canonical JSON,
domain-separated P1363 ES256, P-256/SPKI identity, document and artifact
digests, strict claims, the pinned `https://api.anthropic.com` origin, and
validity across the complete operational, staged-ring, and final-approval
window. Both the CMS approval wrapper and verifier require canonical local
paths without UNC/device/alternate-stream or reparse components. The verifier
holds all three inputs without write/delete sharing, rejects hard-linked files,
derives each final normalized DOS path from the opened handle, requires an
exact-case match to the requested canonical path, and rechecks the opened
identity, size, attributes, timestamps, and single-link count after every read.
This closes the pre-open reparse/path-swap window and proves that attestation,
public key, and contract document have three distinct stable Windows file
identities; its attestation ceiling is the backend's exact 64 KiB limit. The
approval script then
cross-checks every verifier result against the
CMS-signed operational binding. It also verifies both evidence signatures,
exact release bindings, evidence freshness, closed check sets, zero failure
counters, sequential non-overlapping health windows, population targets, and
immutable artifact digests. Only that externally trusted script can produce
`production-accepted.json`; the release-signed projection preserves the exact
provider binding and verified window. It refuses an existing output and never
offers a skip switch.

Repository defaults deliberately contain no trusted signer identities. No
sample pass or provider-contract evidence is included because a synthetic pass would be
indistinguishable from a security bypass. Until the protected policy is
provisioned and both external evidence ceremonies run, production eligibility
remains false.

The read-only prerequisite inventory treats the two enforcement deployments as
separate signed evidence contracts; service installation or source-code
presence is never deployment proof. Each JSON record must have an exact closed
field set, be fresh, and have a detached CMS signature from an identity in the
protected operational-evidence allowlist. Egress evidence must bind the exact
`Itemba Msaidizi Egress Supervisor` service and lowercase SHA-256 measurements,
the distinct attestation/receipt key IDs, certificate thumbprints and SPKI
digests, and affirm TPM-backed non-exportable keys, exact service-only CNG key
DACLs, live kernel/WFP enforcement, exact process-tree attribution, actual
consumption of the supervisor-owned data path, and a verified signed receipt.
The same signed record must bind a non-empty VM run ID plus the deployed
Companion, supervisor, driver, and destination-policy digests, and affirm the
shared trusted-root kill switch, supervisor-owned TLS/socket lifecycle,
restricted-service peer verification before any action token crosses the
pipe, process-creation identity continuity across the control/data flow, exact
request-policy enforcement, a read-only supervisor vault view, and the exact
unopened DPAPI v2 credential-record SHA-256. The same VM run must also prove
execute-only authorization by rejecting a replay/non-execute token, exact
deterministic broker-budget partitioning by rejecting mutations to every broker
dimension and the residual calculation, and mapped supervisor self-image
identity by rejecting a path-identical replaced image. The signed claim carries
only three typed PASS booleans and the corresponding negative-control result
SHA-256 values, bound to the existing VM run, deployed binary, and policy
measurements; raw control values must not enter the claim. These are live typed
claims; source or configuration presence cannot satisfy them.
Privileged-command evidence must bind the exact
`Itemba Msaidizi Privileged Command Supervisor` service and lowercase SHA-256
measurements; a non-empty VM run ID; the deployed Companion, supervisor,
driver image, driver measurement, and isolation-policy digests; the fixed
driver service and policy epoch; the four distinct reservation-lease, pre-bind-release,
suspended-process-bind-acknowledgement, and terminal-receipt key IDs,
certificate thumbprints, and SPKI digests; and the separate action-token and
driver-attestation verification key IDs, thumbprints, and SPKI digests. All six
bindings must be purpose-distinct and use the exact reviewed purpose IDs. The
record also binds protocol v2, the fixed restricted supervisor SID, exact broker
issuer/audience/subject, and per-invocation ceilings of 300 seconds, 1 MiB output,
16 processes, and 512 MiB process memory. The signed record must affirm matching Companion pins,
TPM-backed non-exportable keys, exact service-only CNG key DACLs, live native
enforcement, process-tree binding, filesystem/registry/SCM/supervisor-process
denies, and a verified signed receipt. It must additionally prove independent
action-token verification and exact claim/request binding, public-only verifier
certificates, a fresh nonce-bound signed driver attestation whose signing key
is hardware-backed rather than embedded/extractable and bound to the measured
boot, Secure Boot/HVCI/
WDAC posture, the shared kill switch, restricted peer verification before token
write, signed-argument-to-exact-invocation binding, exact suspended invocation
measurement, and mapped-image identity in both Companion-to-supervisor and
supervisor-to-Companion directions plus the supervisor self-image. It must also
bind the live driver service/loaded image and the driver device handle to the
signed attestation. Finally, the VM acceptance run must use unique nonsecret
canaries for the compact token, idempotency key, argv, and environment, restart
and recover the supervisor, then inspect the persisted isolation journal. The
signed claim contains only a digest-only-persistence boolean, the journal and
verification-result SHA-256 values, and the already bound VM run ID; it passes
only when every raw canary is absent and the expected action-token, invocation,
argument, and idempotency digests are present and mutually bound. Raw canaries
must never enter evidence. In both contracts, “exact service-only
CNG DACL” means a SYSTEM owner, protected DACL, and exactly one explicit
non-inherited `GENERIC_ALL` ACE for the owning restricted service SID with no
SYSTEM ACE. The corresponding evidence/signature/signer parameters to
`Test-ProductionPrerequisites.ps1` are independent for the two contracts.

For `restart-reconnect-replay-and-idempotency-matrix`, the external orchestrator
must enable the separately reviewed system-power policy on a disposable VM,
dispatch a signed one-shot restart against the current boot-session digest,
and retain evidence that Windows actually rebooted after the fixed delay. The
artifact must bind the changed boot-session digest, automatic service start,
authenticated reconnect, central/device journal reconciliation under a fresh
lease, terminal replay, and zero duplicate restart requests. Static config and
fake-native unit tests are not evidence of an actual reboot.

For the Windows-service start-mode slice, the
`unknown-outcome-needs-attention-and-recovery-matrix` and
`restart-reconnect-replay-and-idempotency-matrix` artifacts must also exercise a
disposable, non-Msaidizi test service from the exact signed candidate. Evidence
must bind its reviewed service DACL, base SCM start type before/after, protected
recovery record, base `QUERY_SERVICE_CONFIG` fingerprint before/after,
stale-prestate refusal, one successful restore, restart persistence, terminal
replay, concurrent external-configurator stress, and zero duplicate
`ChangeServiceConfigW` attempts. Both restricted Companion and Recovery
Supervisor SIDs must have only the reviewed query/change-config access to that
test service; every Msaidizi
companion/supervisor/update/recovery/audit service must remain ineligible. The
checked-in fake-backed tests and direct read positive control are not evidence
of an actual SCM mutation or restart survival.

For the registry creation/recovery slice, signed-VM evidence must use a
disposable HKLM target and prove that checkpoint failure leaves an absent key
absent, a concurrent creator is refused and preserved, a crash after
conditional key creation retains a recoverable checkpoint, exact recovery
removes the action-created leaf, and any unrelated value or subkey blocks
recovery without data loss. It must also stress unrelated writers across the
final pre-set state check and value write, and across the final empty-key check
and non-recursive delete. The checked-in isolated HKCU tests validate contract
and native-call behavior, but are not signed HKLM, service-identity, restart,
DACL, or concurrent-administrator evidence.

The same evidence set must show that registry-value and service-start-mode v1
tokens fail capability lookup after the v2 state-contract rollout and are
replanned, never interpreted by a v2 adapter. It must preserve value-only
legacy registry recovery without authorizing key deletion, reject unversioned
service-start-mode recovery, and inject a service start-mode change between the
central expected-state read and the operation's final guarded read without
overwriting that external change.
