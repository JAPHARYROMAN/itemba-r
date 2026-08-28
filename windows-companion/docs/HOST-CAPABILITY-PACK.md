# Governed host capability pack

This pack is the first production Windows/NTFS adapter set. It follows the
modular, observable, resilient, and zero-trust boundaries in the NEXT Master
Build Constitution sections 3 and 6. The default pack is not a general command
interpreter; a distinct privileged-command adapter is separately gated and
absent from packaged defaults.

## Supervisor configuration

The model and broker never provide absolute paths. Every filesystem argument
uses a supervisor-owned `rootId` plus a relative path. Each configured root has
independent read, write, and delete flags and a same-volume quarantine path
outside the model-addressable root. Executables use an independent exact-path
allowlist. Shells and script hosts are rejected even if their path is added to
that list.

Windows services use exact supervisor-owned IDs and SCM names. Base start-mode
mutation is disabled unless that service also has an exact
`AllowedStartModes` subset of `automatic`, `manual`, and `disabled`; an action
cannot add a service or expand that set. Every service whose canonical name
contains `Msaidizi` and a companion, supervisor, update, recovery, or audit role
is rejected regardless of configuration. The restricted Companion and Recovery
Supervisor service SIDs must separately receive only the required target-service
`SERVICE_QUERY_CONFIG`/`SERVICE_CHANGE_CONFIG` DACL rights. Trusted Msaidizi
services must never receive those grants.
The Recovery Supervisor configuration must independently mirror the exact
service `Id` and `ServiceName` for compensation; its `AllowedStartModes` may
remain empty because recovery restores only the protected prior snapshot and
never derives authority from the current action allowlist.

The entire pack defaults off. Enabling `HostCapabilities.Enabled` is an
external deployment action. `PermanentDeleteEnabled` is a second independent
external flag and defaults off. Machine restart has a separate
`SystemPower.Enabled` flag which also defaults off and is effective only while
the host pack is enabled. Its deployment-owned `RestartDelaySeconds` must be
120–600 seconds; an action cannot select timing, message, force-close behavior,
shutdown reason, or a remote machine.
LocalSystem command execution has a third independent
`PrivilegedCommand.Enabled` flag and is effective only while the host pack is
enabled. Its timeout, aggregate stdout/stderr, process-count, and per-process
memory ceilings are deployment-owned hard maxima; an action may only request a
smaller timeout/output bound.
System process inventory is available only inside this same default-off
LocalSystem pack. `MaximumProcessInventoryEntries` is deployment-owned and is
never clamped: it must be 1–2,048 and an out-of-range deployment fails adapter
construction. It defaults to 512; an action may request only an equal or smaller
`maxEntries` value.

Installed-software inventory is also scoped to this default-off LocalSystem
pack. `software.installed.inventory.read@1.0.0` is registered in the packaged
catalog and broker manifest only when `HostCapabilities.Enabled` is externally
enabled. Its deployment-owned maximum must remain within the adapter's strict
bound and packaged configuration defaults it to 512 entries.

## Capability manifest

| Capability | Effect | Recovery | Consent |
| --- | --- | --- | --- |
| `filesystem.entry.stat` | LocalRead | NotApplicable | SignedMandate |
| `filesystem.folder.list` | LocalRead | NotApplicable | SignedMandate |
| `filesystem.search` | LocalRead | NotApplicable | SignedMandate |
| `filesystem.acl.read` | LocalRead | NotApplicable | SignedMandate |
| `filesystem.acl.set` | Administrative | Snapshot | OneShotApproval |
| `filesystem.file.write` | LocalWrite | Snapshot | SignedMandate |
| `filesystem.folder.create` | LocalWrite | CompensatingAction | SignedMandate |
| `filesystem.entry.copy` | LocalWrite | CompensatingAction | SignedMandate |
| `filesystem.entry.move` | LocalWrite | CompensatingAction | SignedMandate |
| `filesystem.archive.create` | LocalWrite | CompensatingAction | SignedMandate |
| `filesystem.archive.extract` | LocalWrite | CompensatingAction | SignedMandate |
| `filesystem.entry.quarantine` | LocalWrite | Quarantine | SignedMandate |
| `filesystem.entry.delete-permanently` | Irreversible | Irreversible | EmergencyOperator |
| `process.owned.launch` | Administrative | CompensatingAction | SignedMandate |
| `process.owned.status` | LocalRead | NotApplicable | SignedMandate |
| `process.owned.terminate` | Irreversible | Irreversible | SignedMandate |

Additional LocalSystem typed packs:

| Capability family | Operations | Boundary |
| --- | --- | --- |
| `registry.value.*` | read, set, delete | configured HKLM roots; supervisor/service keys excluded |
| `environment.machine.*` | read, set, delete | configured variable IDs; system and supervisor-sensitive names excluded |
| `windows.service.*` | status, start, stop; base start-mode read/set | exact configured SCM service IDs and start-mode values; every Msaidizi companion/supervisor/update/recovery/audit service excluded under canonical-name matching |
| `scheduled-task.*` | `definition.read@2.0.0`, `enabled.set@2.0.0`, `run@2.0.0` | exact configured task paths; digest-only results; supervisor namespace excluded |
| `software.msi.*` | status; irreversible install/update/uninstall | exact local MSI path, SHA-256, Authenticode signer, and product code; no recovery-supervisor compensator is claimed |
| `software.installed.inventory.read@1.0.0` | bounded installed-product inventory read | default-off host pack; HKLM 64/32 uninstall views only; no paths, URLs, commands, locations, or per-user hives |
| `local-account.*`, `local-group.*` | account status/enabled; exact membership read/set | configured non-built-in local identities; recovery/emergency/supervisor identities excluded |
| `local-principal.right.*` | curated logon-right read/set | stable binding to one exact local principal SID and one configured logon right; raw/dangerous privilege names excluded |
| `network.adapter.*` | inspect; enable/disable | exact configured interface GUID; bounded addresses, gateways, and DNS |
| `printer.*` | approved discovery, queue status, pause/resume | exact configured installed queue; never submits, purges, or deletes jobs |
| `display.inventory.read` | bounded monitor inventory | hashed display device identifiers; no service-session display mutation |
| `process.system.inventory.read` | bounded system process inventory | Confidential/SignedMandate read of PID, nullable session ID, and basename only; deterministic truncation and kernel-observed, untrusted-content provenance |
| `power.*`, `display.monitor-timeout.*` | active scheme and AC/DC timeout read/set | exact configured scheme GUID; recoverable prior scheme/value required |
| `settings.time-zone.*` | active time-zone read/set | exact configured installed Windows time-zone ID; recoverable prior value required |
| `system.boot-session.read`, `system.power.restart.schedule` | digest-only boot-session read; fixed-delay planned restart | current device-bound boot digest required; direct non-forcing native API; irreversible/one-shot restart |
| `command.privileged.execute` | exact `cmd`/Windows PowerShell argv execution | default-off; fixed System32 images/environment/cwd; bounded LocalSystem Job Object; irreversible one-shot consent; command egress plus independently attested trusted-root isolation required |

`process.system.inventory.read@1.0.0` uses the kernel Toolhelp process snapshot
without opening process handles. It never requests or returns command lines,
environments, memory, owner credentials, window text, modules, or executable
paths. Results are ordered by PID, nullable session ID, and process basename;
the result reports requested, returned, omitted, total, and truncation counts in
an exact returned-slice digest. A separate full-snapshot digest commits every
normalized observed process, including omitted identities, and is used for
pre-state and provenance. `LocalBytesRead` charges the exact UTF-8 byte length
of that domain-separated canonical full snapshot, so omitted entries are never
free reads. A kernel snapshot above 16,384 entries fails closed
instead of creating an unbounded sample. A session ID is `null` when the process
exits or Windows denies that lookup after the snapshot; no session value is
invented. The descriptor is
`Confidential/LocalRead/SignedMandate/LocalSystem`, and provenance is a hashed
governed device identity plus the exact full-snapshot digest.

`software.installed.inventory.read@1.0.0` is wired into the production host
capability pack and is published in the broker manifest only when
`HostCapabilities.Enabled` is externally enabled. Packaged configuration keeps
that switch `false` and caps the returned slice at 512 entries. Its descriptor is
`Confidential/LocalRead/SignedMandate/LocalSystem`. It observes only the
64-bit and 32-bit HKLM uninstall registry views and reads exactly
`DisplayName`, `DisplayVersion`, and `Publisher`. A `productCode` is emitted
only when it can be derived from a GUID-shaped product key. The adapter never
reads or returns install paths, locations, URLs, uninstall or quiet-uninstall
strings, commands, or per-user uninstall hives. Deployment-owned bounds limit
the full observation and returned slice. A domain-separated full-observation
digest commits every normalized product, including omitted entries; a separate
slice digest commits the returned subset and truncation metadata. Raw registry
observation bytes—not merely returned rows—are charged to `LocalBytesRead`.

## Scheduled-task secret boundary

`scheduled-task.definition.read@2.0.0` and
`scheduled-task.enabled.set@2.0.0` return exactly
`{ enabled, definitionSha256, stateSha256 }`. Both are
`Confidential/SignedMandate/LocalSystem`; the read is `LocalRead` with
`NotApplicable` recovery, while the set is `Administrative` with `Snapshot`
recovery. Read provenance names Windows Task Scheduler only. Set provenance
adds only the protected recovery receipt; it does not expose recovery content.

`definitionSha256` commits the complete raw Task Scheduler definition XML.
`stateSha256` is the SHA-256 digest of the domain-separated canonical value
`windows-scheduled-task-state/v2\n{enabled|disabled}\n{definitionSha256}`. This
binds enabled state to the exact task definition without disclosing the
definition. Reads charge every full XML observation to `LocalBytesRead`, so an
enabled-state mutation accounts for both its pre-change and post-change XML
queries. The mutation charges only its one-byte enabled-state effect to
`LocalBytesWritten`.

Raw task XML exists only inside the DPAPI service-identity-protected
`windows-scheduled-task-enabled-recovery/v2` recovery-vault payload. It never
enters an action result, broker message, result cache, central or device
journal, provenance, or error; action arguments are likewise never copied into
results, provenance, journals, caches, or errors. Recovery validates the
protected XML digest, the enabled semantic, the derived state digest, and the
outer signed pre-state before compensation. No v1 definition-read or
enabled-set adapter is registered, so queued v1 actions fail capability
resolution and require replanning instead of inheriting the new state
semantics.

`scheduled-task.run@2.0.0` remains a digest-only irreversible action. This
versioning does not broaden its authority, reveal task XML, or route a run to a
compensator.

`filesystem.file.read@1.0.0` is deliberately unpublished. Its legacy result
carried raw file bytes into the durable DPAPI replay cache and then into an
encrypted backend artifact, which cannot meet credential ephemerality for
adaptive reasoning. Registry construction, broker manifest enrollment,
planning, queue/dispatch, terminal-result settlement, artifact ingestion,
adaptive reopening, and result-cache replay each reject it independently with
`REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY`; an affected active task is moved
to `NEEDS_ATTENTION`. This applies equally to text, PDF, and arbitrary binary
files and does not rely on content sniffing or known-secret detection. Metadata-
only `filesystem.entry.stat`, `filesystem.folder.list`, and `filesystem.search`
remain published. The reserved replacement identifier
`filesystem.file.disclose.ephemeral@1.0.0` is also unpublished and independently
rejected at those boundaries. Cross-runtime metadata primitives bind its exact
capability identity, action, task, plan, step, device, mandate, arguments,
pre-state, file identity, path digest, nonce/idempotency generation, MIME set,
byte ceiling, provider contract/model, and expiry, but no production byte
transport or nonce ledger exists. [EPHEMERAL-FILE-DISCLOSURE.md](EPHEMERAL-FILE-DISCLOSURE.md)
records the precise source blocker.

The authenticated standard-user Agent exposes a config-selected subset of the
shared closed catalog: session status; clipboard text read/irreversible write; primary-
screen and exact-camera capture; WAV playback; local installed-voice synthesis;
a composite microphone-to-local-installed-recognizer transcription action; and
foreground UI Automation inspection. Camera uses active-user consent and local
transcription uses one-use approval bound to the exact task, plan, step, device,
action, arguments, and audio digest. Transcription accounts local capture/read
bytes and broker delivery separately, performs no speech network call, never
serializes raw microphone audio, and labels the scrubbed transcript untrusted
with no instruction or side-effect authority.

The descriptors and implementations for URI navigation, UI invocation,
vault-backed browser form/upload/download effects, and emergency command
execution remain in source for review, but packaged Service and Agent configs
exclude them. `SelectEnabled` rejects either enable flag until a deployment-
owned boundary can enforce and measure the signed per-action network-egress
budget and the result protocol can conservatively account for it. A bare model
flag, mandate, or config boolean is never treated as that attestation.

Every descriptor independently declares data class, effect, consent, recovery,
privilege, idempotency, supported OS, strict argument/result schemas, and
provenance. Registry construction rejects mutation descriptors without consent
or recovery and rejects inconsistent irreversible metadata.

## Exact pre-state contract

Mutation tokens must carry `expected_pre_state_sha256`. The value is the host
state digest, not a hash of the plan preconditions object.

- Absent file/folder destination:
  `a71dc5eec9aa44314c60966cc36f9cb2d1c1ef7251d15ac5321a25dad1962c0c`.
- Replace, move, quarantine, or permanent delete: use `stateSha256` returned by
  `filesystem.entry.stat` for the target/source.
- New owned process:
  `0efe664c30ed400a46251afc4f87c8fdd593e23af51c737721d2a8d75b33e851`.
- Owned process termination: use `stateSha256` returned by
  `process.owned.status`.
- Privileged command execution: use the versioned
  `msaidizi-privileged-command:unbounded-host-pre-state:v1` sentinel digest,
  `88323c68c98b95a7c22adccb1bd442c3ac1da0b06df6d582b7d747dacc3682c6`.
  This deliberately does not claim to summarize arbitrary machine state; it
  binds the signed action to the adapter's irreversible/unknown-state contract.
- Local logon-right assignment: use `stateSha256` returned by
  `local-principal.right.read`; the digest binds the stable right/principal IDs,
  exact resolved SID hash, and assigned state.
- Scheduled Windows restart: use `stateSha256` returned by
  `system.boot-session.read`. The digest binds the enrolled device ID and the
  current per-boot Windows identifier, so a token from a prior boot is stale.
- Windows service base start mode: use `stateSha256` returned by
  `windows.service.start-mode.read`. The digest binds the exact configured
  service ID/name, observed SCM service type, base `dwStartType`, and a digest
  of every other field returned by base `QUERY_SERVICE_CONFIG`; set refuses a
  missing or stale value before its native commit attempt.
- Scheduled-task enabled-state mutation or run: use `stateSha256` returned by
  `scheduled-task.definition.read@2.0.0`. The digest binds the canonical
  enabled semantic to the SHA-256 digest of the complete task definition XML;
  the XML itself remains confined to the protected recovery vault.

A mismatch is a known precondition failure with no automatic retry. Reads and
writes also report local byte counters; the coordinator enforces the signed
task budget against their sum.

## NTFS safety boundary

The resolver rejects relative traversal, absolute/UNC/device/global-root paths,
alternate data streams, DOS device names, invalid/trailing path syntax,
reparse points, hard-linked files, volume changes, and any overlap with the
kill switch, audit journal, result cache, or recovery vault. Existing objects
are resolved through `CreateFileW` handles with `OPEN_REPARSE_POINT`; canonical
paths, volume IDs, file IDs, attributes, and link counts are checked.

Create/copy/archive creation and ZIP extraction use unique sibling staging
entries and no-overwrite atomic
renames. Move and quarantine rename the already-validated NTFS object handle
while a separately validated destination-parent handle excludes parent renames;
the destination identity is checked before either lock is released.
Permanent deletion marks the exact validated handle for POSIX deletion. File
replace keeps the expected target handle open, relocates that exact NTFS object
into the recovery directory, and renames the exact staged-file handle into the
locked destination parent without overwrite. A concurrent child swap is either
blocked by the live target handle or causes the no-overwrite commit to fail; the
original exact handle is restored. A failed restore is an unknown write outcome
and therefore `NeedsAttention`.

`filesystem.archive.extract@1.0.0` accepts a root-relative ZIP file and an
absent root-relative destination directory. Before staging, it parses both
central and local records and supports only single-disk, non-ZIP64 store or
deflate entries with strict UTF-8 or ASCII names. It rejects encryption,
unknown compression/flags/extras, comments, rooted/traversing/UNC/device/ADS
names, reparse/symlink/special-file or hard-link-like metadata, case-insensitive
duplicates, case-ambiguous ancestors, file/directory conflicts, overlapping
local records, and CRC/length disagreement. Deployment-owned ceilings bound
entry count, path length, single-entry bytes, total expansion, and per-entry
plus aggregate compression ratio. The action budget must cover the compressed
archive read, the exact expanded write, and a full post-commit verification
read. Cancellation removes the exact staged tree or atomically quarantines its
root. Recovery moves only the exact state-matching created tree into the
supervisor quarantine; a failed post-commit rollback is an unknown write
outcome, never a retryable known failure.

Before the first target effect in each reviewed in-tree reversible adapter, a
DPAPI service-identity-protected recovery record is flushed beneath the
supervisor recovery vault. The production recovery-vault decorator then appends
and write-through flushes one `RecoveryPrepared` checkpoint for the active
action before returning its receipt to that adapter. Only the signed pre-state,
recovery-record, and opaque-handle digests enter that checkpoint; raw handles,
paths, and recovery content remain outside the journal. A missing, duplicate,
or conflicting checkpoint fails closed during restart synthesis, which
preserves its three-link `Prepared -> RecoveryPrepared -> NeedsAttention`
chain. The journal format still accepts legacy two-link terminal receipts, so
the journal alone cannot prove that a newly added adapter observed this
ordering. Quarantine payloads are outside every model-addressable root.

For registry value creation, pre-state inspection uses `OpenSubKey` and never
creates the target key. The v2 registry state digest records key existence
separately from value existence. If the key is absent, its immediate parent
must already exist; after the checkpoint, the adapter uses `RegCreateKeyExW`
and proceeds only for `REG_CREATED_NEW_KEY`, never `REG_OPENED_EXISTING_KEY`.
The recovery record preserves `keyExisted`. Recovery may remove an
action-created key only when it contains no unrelated values or subkeys and
uses non-recursive deletion; legacy value-only records never authorize key
deletion. Both the final pre-set state recheck and the final empty-state check
before non-recursive deletion are optimistic, not atomic registry
compare-and-set/compare-and-delete operations against an unrelated
administrator, so concurrent-writer stress remains a signed-VM acceptance
gate.

All `registry.value.*` adapters exposing that state contract are capability
version `2.0.0`, and new recovery records carry
`windows-registry-value-recovery/v2`. An explicit legacy parser retains the old
value-only digest and never authorizes deletion of a containing key. A record
that contains v2 key-existence fields without the v2 contract marker fails
closed. No v1 adapter is registered, so queued v1 actions require replanning
instead of silently inheriting the new digest semantics.

The checkpoint-aware backend must be deployed before this companion build. It
accepts both the legacy two-link terminal receipt and the new three-link
receipt. After a device has written journal kind `6`, rolling it back to a
binary that does not understand `RecoveryPrepared` fails journal verification
closed and is not a supported rollback path.

`ITrustedQuarantineRecoveryExecutor` restores the exact quarantined NTFS handle
only when the central expected-current-state digest still matches.
`ITrustedAdministrativeRecoveryExecutor` applies the same supervisor-only,
non-manifest rule to registry values, machine environment values, service
start/stop and base start-mode state, task enable/disable state, local-account enablement, local-
group membership, SID-bound local logon-right assignment, network-adapter state, printer pause state, active power
scheme, monitor timeout, time-zone state, and governed NTFS DACL profiles. It
re-reads the live state,
supports idempotent replay when the pre-state is already present, refuses stale
current state, performs one compensation, and verifies the exact recorded
pre-state afterwards. Irreversible task runs and other irreversible actions are
never routed to a compensator.

## Owned process boundary

`process.owned.launch` accepts an executable ID and JSON string array. It never
accepts a command line, shell fragment, executable path, environment block, or
PID. Windows necessarily receives a command-line buffer, so the companion
constructs it with the documented Windows argv quoting rules and passes the
exact application path separately to `CreateProcessW`.

An identity handle for every approved executable is retained for the manager's
lifetime and checked immediately before launch. The process starts suspended;
before it can run, the configured path is reopened and its volume/file ID must
still equal the retained approved identity. It is then attached to a dedicated
Job Object with `KILL_ON_JOB_CLOSE`, a two-hour aggregate CPU ceiling, at most
16 active processes, and a 512 MiB aggregate memory ceiling before it is
resumed. The child never inherits the LocalSystem service environment: it gets
only `PATH`, `SystemDrive`, `SystemRoot`, `TEMP`, `TMP`, and `WINDIR`, with the
validated working directory used for its temporary paths. Command and
environment buffers are cleared after native process creation. Descendants
remain in that job unless Windows itself rejects assignment. Status and
termination require the opaque job handle and the task ID that launched it;
termination cannot target an arbitrary or differently owned PID. Closing the
service kills retained jobs, so restart recovery never leaves an ungoverned
process tree.

## Privileged command boundary

`command.privileged.execute` accepts no command-line string or executable path.
It accepts a strict `{ executable, argv, timeoutSeconds, maximumOutputBytes }`
object; `executable` is exactly `cmd` or `windows-powershell`, and each shell
has a required non-interactive prefix. The policy fixes the absolute System32
image, System32 cwd, and a nine-entry reconstructed environment. It rejects
device/UNC forms, encoded payload switches, direct supervisor paths, and common
environment/path discovery spellings.

The native runner retains a no-write/no-delete handle to the exact Windows
image, reconstructs the Windows command-line buffer from individual argv
elements, uses an inherited-handle allowlist, and atomically creates the child
suspended inside a kill-on-close Job Object. It verifies the launched image,
file identity, and job membership before any resume. Cancellation, wall timeout,
output overflow, or disposal kills
the entire job. Only bounded byte counts and SHA-256 digests are returned.
Every invocation prepares an irreversible recovery record containing the argv
digest—not command text—and is always reported outcome-uncertain. Coordinator
journal/result replay prevents the same action from executing twice. Before
`CreateProcessW`, the runner verifies and commits a signed reservation bound to
the action, task, plan, step, device, mandate, action-token digest, complete
invocation, executable, and deployment measurements. It then verifies and
commits a signed binding over the exact suspended process, creation time,
thread, image, and job identities before `ResumeThread`, and commits a signed
terminal receipt before returning. Childless branches require a signed pre-bind
release. The write-through hash-chained ledger rejects replay and preserves
unresolved states across restart without storing command text, output, tokens,
or secrets. A settlement-only startup reconciler must clear every exact pending
entry before broker intake. Missing settlement, a false release outcome, or
signed discontinuous-enforcement evidence trips a one-way runtime latch,
produces `NEEDS_ATTENTION`, stops dispatch, and remains restart-fenced. Required
feature claims cover filesystem, registry, service-control,
supervisor-process, and kernel process-tree isolation. The only production gate
currently shipped always rejects and has no configuration override, so setting
`PrivilegedCommand.Enabled=true` or adding a real egress boundary cannot make
this adapter launch. Tests use purpose-separated signed sessions through the
production verifier; the trusted supervisor/driver that produces such evidence
remains external.

The descriptor's `TouchesTrustedRoot=false` means the typed action does not
declare direct trusted-root targeting. For this general interpreter it is not a
containment or non-interference claim; the independent isolation gate is the
required enforcement boundary.

## Remaining capability gaps

- MSI mutations create durable recovery records, but trusted MSI compensation
  is not enabled: restoring an earlier installed version requires a separately
  retained and re-verified original package. MSI install/uninstall, owned-
  process launch, scheduled-task run, and service start also fail closed before
  execution until an independent process-tree/WFP boundary can authorize and
  receipt their egress; status, stop, and owned termination stay available for
  cleanup. Clipboard write retains no prior value and is truthfully advertised
  as irreversible: it still verifies the exact pre-state digest and accounts
  prior/replacement bytes, but publishes no snapshot, recovery handle, or
  recovery provenance. The unused current-user recovery-store infrastructure
  is not recovery authority and no descriptor claims it. File write/copy/move/archive are
  covered by the handle-bound trusted filesystem recovery executor.
- Direct file content reads are unavailable. The former Base64 result adapter
  remains source-only and unpublished; both it and the reserved ephemeral
  identifier are rejected before dispatch and persistence. A production-safe
  single-session device-to-provider byte stream, atomic durable nonce/budget
  ledger, cancellation fence, in-stream DLP/known-secret policy, and provider
  heap-retention proof remain unimplemented, so no chunked, resumable, PDF, or
  binary disclosure is claimed.
- Strict bounded ZIP extraction now exists for unencrypted store/deflate
  archives. Password-protected/ZIP64/multi-disk ZIPs and other archive formats
  remain deliberately unsupported.
- Copy/archive do not preserve owner, ACL, audit ACL, EFS, compression, sparse
  ranges, or alternate streams. ADS are deliberately rejected.
- A whole-volume model-addressable root is not supported because quarantine
  must remain outside every addressable root. Supporting it is feasible only
  as a first-class deny-subtree design: quarantine, supervisor, vault, journal,
  signer, and bootstrap trees must be rejected before enumeration by every
  recursive/search/copy/archive/stat/mutation operation; root-level destructive
  operations must be prohibited; handle-canonical identity, reparse/hard-link
  checks, race handling, and quota tests must cover skipped subtrees. Exact
  protected-path checks alone are insufficient, so this was not enabled here.
- The LocalSystem owned-process pack has no stdout/stderr/stdin stream and no
  restart reattachment. Both command paths intentionally return only bounded
  output byte counts and SHA-256 digests so credentials or local data cannot be
  persisted in results.
- Local identity support does not create/delete accounts or groups or set
  passwords. Deleting a newly created SID can orphan ACL/service/task
  references, deleting an existing principal cannot recreate its SID/profile,
  and Windows cannot reveal a prior password for rollback; those operations
  therefore remain unsupported. Rights support is restricted to the ten
  Windows logon/deny-logon constants. Debug, TCB, backup, restore, ownership,
  impersonation, driver, audit, and other privileges remain unavailable.
  Built-in and trusted recovery/emergency identities are never eligible.
  Network support does not change routes, firewall,
  DNS, IP configuration, VPN, or Wi-Fi. Printer support does not submit,
  cancel, purge, install, or delete. Display/settings support does not change
  resolution, orientation, brightness, HDR, sleep/hibernate, locale, or clock.
  The system-power pack schedules only a local planned restart through
  `InitiateSystemShutdownExW` with application force-close disabled. Shutdown,
  power-off, sleep, and hibernate remain unsupported. Checked-in tests use an
  injected fake: an actual reboot, changed boot digest, service reconnect, and
  post-restart replay still require signed disposable-VM evidence.
  Service start-mode read/set uses direct `QueryServiceConfigW` and
  `ChangeServiceConfigW`; the native setter passes `SERVICE_NO_CHANGE` or null
  for every field other than `dwStartType`, with no shell fallback. Mutation is
  limited to Win32 own/share-process services; drivers fail closed. The signed
  pre-state and recovery record bind a base-configuration fingerprint excluding
  only the start type being changed, and the manager rechecks that fingerprint
  on the same service handle immediately before its commit attempt. This is an
  optimistic stale-state guard, not an atomic compare-and-swap against an
  unrelated administrator changing the service concurrently. This surface
  intentionally does not call `QueryServiceConfig2W`/`ChangeServiceConfig2W`, so
  `automatic` means only the base automatic type and neither observes nor
  promises recovery of Automatic (Delayed Start). Checked-in mutation and
  recovery tests use an injected fake. Actual SCM mutation, service-DACL
  enforcement, persistence across restart, stale recovery, concurrent external
  configuration stress, and zero-duplicate replay remain signed disposable-VM
  rollout gates.
  The read/set adapters are capability version `2.0.0`, and protected recovery
  records require `windows-service-start-mode-recovery/v2`. V1 actions therefore
  fail capability resolution and must be replanned; unversioned legacy recovery
  records cannot safely prove the base configuration and fail closed. During
  recovery, the operation re-reads and matches the exact centrally approved
  expected-current state before delegating to the manager, whose same-handle
  guard binds that observed start mode, service type, and configuration
  fingerprint. The remaining gap between the manager's final query and SCM
  commit is the optimistic external-administrator race described above.
- Camera capture requires a signed-installed active-user VM matrix for device
  privacy denial, concurrent use, session switch/lock, metadata stripping, and
  driver failure before rollout. Speech is limited to exact installed SAPI
  identities. A missing recognizer fails closed; the adapter makes no network
  call, but it cannot independently attest the internals of a third-party SAPI
  token, so deployment must approve only locally trusted recognizers/voices.
- Browser external effects remain disabled. The session handshake can now
  carry and independently verify fresh, process/boot/manifest/policy/version-
  bound supervisor evidence, but the current posture provider cannot truthfully
  emit the required browser-origin and completion features. The UIA path lacks live-tab origin
  attestation, deterministic remote completion, resumable transfer semantics,
  and upload/download/form/navigation byte metering against the signed ceiling.
  Raw emergency command activation is now wireable only from a signed measured
  command-boundary attestation; packaged configuration and deployment evidence
  remain safe-off. Privileged commands remain disabled even with that egress
  evidence because their process/output resources alone are insufficient. The
  privileged adapter is also awaiting independently enforced trusted-root
  isolation: argument/environment screening cannot prove that an elevated,
  Turing-complete interpreter will not synthesize a protected path. The checked-
  in production isolation gate is intentionally rejecting, so egress enablement
  alone cannot change this state. Its stdout/stderr ceiling also does not meter
  local filesystem I/O: a LocalSystem shell could read or write unbounded local
  data and inspect credentials or process memory. The task 5-GB local-I/O ceiling
  and trusted-root non-interference are therefore unenforceable for raw commands
  without the independent native isolation/metering boundary.
- Typed email, messaging, publishing, and purchase descriptors are wired to the
  coordinator through `ExternalActionTransportFactory` and the authenticated
  named-pipe egress-supervisor transport. They remain fail-closed when the
  independently attested control/flow boundary, destination policy, credentials,
  or terminal receipt is unavailable; the rejecting transport is the packaged
  fallback. Production still requires the signed WFP/flow, enrollment, and
  same-lease recovery evidence described in `EXTERNAL-ACTIONS.md`.
- Script hosts other than the explicit Command Prompt/Windows PowerShell enum,
  dynamic assembly loading, arbitrary executable paths, action-supplied
  environment variables, encoded PowerShell payloads, and script-file switches
  remain disabled.
- The service/tray bridge has unit and positive local execution coverage, but
  a signed-installed LocalSystem-to-active-user end-to-end VM test, session
  switch/lock/unlock matrix, installer-created pipe/process ACL evidence, and
  restart/reconnect soak remain rollout gates rather than checked-in evidence.
- Only Windows 11 x64 on NTFS is supported and tested; ReFS, FAT/exFAT, network
  filesystems, other Windows releases, and non-Windows hosts are not supported.
- Installer-enforced ACLs, release signing, TPM enrollment, and ring deployment
  are separate rollout work; developer checkout binaries must not be installed
  as a service.
