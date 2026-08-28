# Capability adapter contract

Every host operation implements `IHostCapabilityAdapter`. Adapters are narrow,
versioned operations. Arbitrary executable paths, reflection, dynamic assembly
load, and unrestricted filesystem/registry adapters remain prohibited. A
reviewed standard-user `command.emergency.execute` implementation has an exact
executable enum and argv, signed EmergencyOperator consent, configured cwd
alias, reconstructed environment, native suspended launch, inherited-handle
list, Job Object ownership, hard local resource ceilings, digest-only output,
protected-root refusal, and an honest unknown/irreversible result. It is not
manifest-eligible: packaged config keeps it off and enablement is rejected
until deployment-owned per-action network-egress enforcement and measurement
exist.

The LocalSystem `command.privileged.execute` adapter is a distinct, separately
gated surface. It accepts only `cmd` or `windows-powershell`, a bounded argv
array, and bounded timeout/output integers. Executable paths, working directory,
environment, handles, profiles, and encoded-command switches are not action
input. The native runner locks the exact System32 image, uses an inherited-
handle allowlist, atomically creates the suspended child inside a bounded
kill-on-close Job Object, and terminates that job on cancellation, timeout, or
output overflow. Only output byte counts/digests and executable/isolation
provenance are returned. It is declared
Credential/Irreversible/OneShotApproval/LocalSystem; the action journal/result
cache and dedicated isolation replay ledger jointly supply at-most-once
behavior. An unknown mutation outcome remains uncertain because arbitrary shell
effects cannot be reconstructed or safely retried.

Direct trusted-root paths, common environment/path-discovery spellings, device
paths, and encoded payload switches are rejected, and the child receives no
ProgramData, profile, vault, broker, or inherited service environment. These
user-mode checks do not prove that a Turing-complete elevated interpreter
cannot synthesize an equivalent path. Production enablement therefore still
requires independently enforced trusted-root isolation in addition to the WFP
egress boundary. The checked-in consumer implements the signed reservation
lifecycle: purpose-separated P-256 reservation before creation, pre-bind release
when no child is bound, exact suspended-process/job binding before resume, and a
terminal enforcement receipt on every bound branch. Each verified transition is
committed to a write-through hash-chained replay ledger before progress. The
signed release outcome must match the local branch. Startup exposes only
settlement recovery and refuses broker intake while any lifecycle is pending.
Unresolved settlement or a receipt reporting discontinuous enforcement is
persisted as `NEEDS_ATTENTION`, trips a one-way dispatch latch, and restart-
fences the service rather than reopening execution. The
only production gate currently shipped always rejects and has no configuration
input; tests use cryptographically signed sessions through the production
verifier solely to exercise runner mechanics. Packaged defaults keep the
descriptor absent, and an egress implementation alone cannot enable it. The
separately signed supervisor and kernel enforcement producer remain an external
deployment requirement.
The output cap measures only stdout/stderr. A LocalSystem interpreter can read
or write local disk without passing through those streams and can inspect
credentials or other processes' memory. The task 5-GB local-I/O ceiling and
trusted-root non-interference therefore require the independent native boundary;
they are not claims made by the checked-in runner or argument screening.

Each descriptor must explicitly declare:

- data class (`Public` through `Credential`/`Biometric`);
- effect (`Observe` through `Irreversible`);
- consent requirement;
- recovery strategy;
- required Windows privilege;
- idempotency semantics;
- supported OS versions;
- strict Draft 2020-12 argument and result schemas;
- provenance outputs; and
- whether it declares direct targeting of the trusted root (which must always
  be `false`). For a general interpreter, this field is manifest metadata—not
  proof of containment or non-interference—and cannot replace the independent
  isolation gate.

The registry rejects schemas that are not object schemas with
`additionalProperties: false`. The adapter must still validate types, lengths,
ranges, enum membership, normalization, and cross-field rules. Reject unknown
fields. Validate resolved OS targets immediately before use. The registry
boundary also enforces the broker descriptor contract before a
manifest can be published: at most 500 descriptors; safe identifier IDs and
versions of at most 128 characters; display names of at most 160 characters;
descriptions of at most 1,000 characters; at most 20 supported-OS entries; and
at most 100 provenance-output entries. Trusted-root, unreviewed shell/powershell/
cmd/raw-command namespaces, and raw microphone descriptors are rejected locally
under the same rules as broker enrollment; the one reviewed privileged command
ID above remains subject to its separate deployment gate. Adapter validation
error codes must use the same safe-identifier
grammar so a terminal result cannot become undeliverable.

The first filesystem pack enforces volume and NTFS file identity, canonical local DOS
paths, reparse-point and hard-link rejection, alternate-data-stream/device/UNC
rejection, protected supervisor path exclusions, and handle-bound rename/delete
operations. File replacement retains and relocates the exact expected target
handle before an exact staged-handle no-overwrite commit; a concurrent child
swap is blocked or causes a bounded restore. NTFS permission reads and changes
operate on the same non-following handle. Changes accept only a supervisor-
authored DACL profile ID, preserve owner/group/SACL ownership, require a
LocalSystem recovery ACE, and snapshot the exact prior DACL before commit.
Local principal-right actions similarly accept only a supervisor binding ID.
The binding resolves one configured non-built-in local principal to its exact
SID and one curated logon-right constant; the SID hash participates in state,
and recovery refuses a same-name principal recreated with a different SID.
Raw LSA names and token privileges are not action inputs.

Mutation adapters must additionally:

1. require a central-ledger connection;
2. require an idempotency key and expected pre-state where the target supports
   one;
3. append `Prepared` before the first effect;
4. use snapshot/quarantine by default for deletion;
5. provide a bounded recovery/compensation operation;
6. checkpoint between bounded substeps and honor cancellation there;
7. return `OutcomeUncertain` if process death, timeout, or an API ambiguity can
   hide whether the effect committed; and
8. never implement an internal whole-action retry.

The coordinator revalidates item 1 at the adapter boundary: its
`action_started` message must be acknowledged by the authenticated broker and
the bounded ledger-connectivity state must still be fresh before a mutation
adapter is invoked. A failure after journal preparation is terminalized locally
as a known no-effect failure and is replayed without invoking the adapter.
Lease heartbeats cancel an already invoked adapter cooperatively on later
disconnect. These checks do not claim an atomic native commit-point fence; an
adapter must honor cancellation immediately before every effect, and stronger
process or network enforcement remains the responsibility of the separately
attested boundary described in `EGRESS-BOUNDARY.md`.

Outputs go over the authenticated channel in memory. Raw outputs are not
written to the journal; bounded typed provenance and output digests are. Exact
prior outputs normally live only in the DPAPI-protected supervisor result cache
so replays do not re-execute. Raw file-content results are a stricter exception:
`filesystem.file.read@1.0.0` is unpublished, registry-rejected, and independently
refused by every result-cache store/load/delivery entry point with
`REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY`. The backend also refuses planning,
queueing, settlement, artifact ingestion, and legacy adaptive reopening, moving
affected work to `NEEDS_ATTENTION`. Metadata-only stat/list/search remain
available while a non-durable, exact-authority ephemeral model channel is not
implemented. The reserved `filesystem.file.disclose.ephemeral@1.0.0` identity is
likewise absent from the catalog and rejected before ordinary dispatch or
result handling. Its metadata-only TS/C# contract is not an execution adapter;
see [EPHEMERAL-FILE-DISCLOSURE.md](EPHEMERAL-FILE-DISCLOSURE.md). Provenance identifiers must be
hashed or opaque and must not leak
credentials, usernames, paths, window titles, document content, or tokens.
Every adapter reports conservatively measured non-broker application-payload bytes in
`ExternalEgressBytes`. It excludes its result JSON. Before dispatch, the broker
signs and reserves the exact product of the serialized result-body ceiling,
delivery-session count, and attempts per session. The companion refuses an
oversized body and cannot expand those factors after restart or configuration
change. An adapter that cannot enforce and conservatively
measure its own external writes is not manifest-eligible merely because it can
return a counter.

`NoOpCapabilityAdapter`, `SystemStatusCapabilityAdapter`, and
`ForegroundSessionStatusCapability` are small examples. The shared
`StandardUserCapabilityCatalog` is the authoritative tray surface; both sides
derive the same config-selected reviewed manifest and reject a descriptor-
digest mismatch. `clipboard.text.write` is explicitly irreversible. It hashes
and verifies the exact current clipboard pre-state and accounts both the prior
and replacement UTF-8 bytes, but it does not retain the prior value or emit a
recovery handle, recovery provenance, or recoverability claim. Browser secrets must use scoped vault
handles, a signed digest of the supervisor-configured HTTPS origin, and the
encrypted session envelope—never a raw argument, result, log, journal,
artifact, clipboard transfer, or persistent Agent field. Any additional
observation or effect requires a new capability ID/version, closed schema,
positive control, security regression, and risk review.

ZIP extraction is a separate versioned effect:
`filesystem.archive.extract@1.0.0`. It does not call the framework convenience
extractor against an untrusted destination. A strict wire-format preflight
rejects ambiguous metadata and bombs, an exact-handle source read accounts the
compressed bytes once, a bounded sibling tree is committed by one no-overwrite
rename, and the committed tree is fully rehashed before success. Its aggregate
local-byte reservation includes archive read + expanded write + expanded
verification read. See [HOST-CAPABILITY-PACK.md](HOST-CAPABILITY-PACK.md) for
the accepted ZIP profile and recovery semantics.

Governed artifact inputs are a separate typed path, not an authorization
source. `external.email.send` accepts at most one FILE attachment and
`browser.file.upload` accepts one SCREENSHOT artifact. Each bounded envelope is
covered by the signed canonical arguments digest and binds its task, immutable
plan version, target step, device, source step and attempt, artifact ID, data
class, name, MIME type, byte count, content digest, and canonical scope digest.
Execution decodes and rehashes the bytes against those exact bindings. The
current inline transport is capped at 128 KiB decoded; larger inputs fail
closed pending an opaque authenticated stream. Inline bytes are ephemeral and
must never enter redacted attempts, host actions, events, audits, journals,
resume state, telemetry, or provenance output.

The browser adapter materializes a validated artifact only in the enrolled
user's pre-provisioned `%LocalAppData%\Itemba\Msaidizi\artifact-quarantine`
root. Enrollment creates the empty canonical non-reparse directory with the
exact reviewed user/System/Administrators ACL before the capability can be
published. Runtime uses a random per-action child, no-follow handles, file
identity checks, a locked leaf, handle-bound zero/delete cleanup, and refuses
an absent, replaced, populated, reparse, or incorrectly ACLed root. Cleanup
failure cannot convert a possible UI effect into a known failure; it remains
explicit result evidence and requires reconciliation.

For browser upload, LocalSystem—not the tray—owns terminal egress settlement.
It independently derives a conservative floor from the revalidated raw
artifact byte size before the tray action, passes only a pre-action signed
authorization to the tray, rejects any adapter-supplied receipt, and requires
the independently attested supervisor receipt to bind the exact action,
session, arguments digest, route attestation, and issued budget. Final usage is
the greater of the artifact floor and trusted supervisor measurement and is
charged once. A missing, mismatched, unknown, or under-floor receipt after a
possible UI effect is uncertain `NEEDS_ATTENTION`, disables further dispatch,
and is not retried. The checked-in production supervisor currently rejects all
browser registrations, so this capability remains unpublished until that
separate measurement boundary is deployed and attested.

The typed external gateway pack follows this rule: email, message, publish,
and purchase are distinct descriptors rather than a generic HTTP or webhook
tool. Their shared transport accepts only supervisor-resolved destinations and
never follows redirects or retries. See `EXTERNAL-ACTIONS.md`.

The separately gated system-power pack follows the same closed-surface rule.
`system.boot-session.read` returns only device-bound digests.
`system.power.restart.schedule` accepts `{}` only, requires that boot-session
digest as exact pre-state, and uses the supervisor-configured 120–600 second
delay. Its native manager calls `InitiateSystemShutdownExW` directly with a
fixed local message, planned reason, reboot enabled, and application force-
close disabled; it has no shell fallback or action-controlled timing/message.
The descriptor is `Irreversible`/`OneShotApproval`/`LocalSystem`, and a success
means Windows accepted the schedule—not that a later boot completed. Local
tests inject a fake native manager and prove coordinator replay does not invoke
it twice. Actual reboot, reconnect, and changed-boot evidence remain an
external signed-VM rollout gate.

The typed Windows-service configuration surface is similarly closed.
`windows.service.start-mode.read` accepts only a supervisor-configured service
ID and returns its base start mode plus a digest bound to the exact configured
ID/name, observed service type, and every other field returned by base
`QUERY_SERVICE_CONFIG`. `windows.service.start-mode.set` additionally
accepts one exact supervisor-allowed `automatic`, `manual`, or `disabled` value,
requires that read digest as signed pre-state, persists a protected snapshot,
rechecks the base mode/type/configuration fingerprint on the same service
handle, and checks cancellation again immediately before the native commit. It
permits
only Win32 own/share-process services; drivers fail closed. All Msaidizi
companion, supervisor, update, recovery, and audit service families are excluded
regardless of config. The native manager uses `QueryServiceConfigW` and
`ChangeServiceConfigW` directly, requests only query/change-config access, and
passes `SERVICE_NO_CHANGE` or null for every field except `dwStartType`; there
is no shell or PowerShell path. It intentionally does not inspect or change the
separate Automatic (Delayed Start) setting, so `automatic` and its recovery
digest describe the base type only. The restricted Companion and Recovery
Supervisor SIDs need explicitly reviewed query/change-config rights on each
non-trusted target service. Recovery configuration must separately mirror the
exact service ID/name; its mutation allowlist is not consulted as recovery
authority. The recheck is optimistic; Windows exposes no conditional
`ChangeServiceConfigW`, so an unrelated administrator can still race between
the final query and commit. Actual mutation, DACL enforcement, restart
persistence, recovery, and concurrent external-writer stress are external
signed disposable-VM gates; local tests use an injectable fake and do not claim
them. This state contract is capability version `2.0.0`; no v1 adapter remains
registered. New protected recovery records require
`windows-service-start-mode-recovery/v2`, and recovery rechecks the centrally
approved expected-current digest before binding that exact observed mode/type/
configuration fingerprint to the manager's same-handle guard. V1 actions must
be replanned, and unversioned service-start-mode recovery records fail closed.
