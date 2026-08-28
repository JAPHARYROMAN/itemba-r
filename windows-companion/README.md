# Msaidizi Windows Companion

This directory is the security-first .NET 8 Windows execution boundary for
Msaidizi autonomy. It contains:

- `Msaidizi.Companion.Service`: a Windows Service intended to run as
  `LocalSystem` after enrollment and code-signing.
- `Msaidizi.Companion.Agent`: a standard-user WinForms tray process for the
  authenticated interactive-session, UI Automation, screen, clipboard, audio,
  local speech, camera, and browser boundaries.
- `Msaidizi.Companion.Contracts`: versioned action, capability, channel,
  journal, provenance, and trust contracts.
- `Msaidizi.Companion.Tests`: token, trusted-root, hash-chain, redaction, and
  idempotency regression tests.
- `Msaidizi.UpdateSupervisor`: a separately signed, pinned-key Windows Service
  for allowlisted atomic updates and automatic rollback. It is outside agent
  capability and self-modification namespaces.
- `Msaidizi.UpdateSupervisor.Tests`: manifest/lease tamper, protected-root,
  durable ACK/progress/result outbox, crash recovery, exact-version rollback
  soak, monotonic deadline, replay, and canary acceptance tests.
- `Msaidizi.RecoverySupervisor`: a separate signed, pinned-key Windows Service
  that consumes only exact operator-authorized recovery manifests and can read
  the protected recovery vault without exposing it to the model or companion.
- `Msaidizi.RecoverySupervisor.Tests`: signature, expiry, journal-before-write,
  kill-switch, typed-dispatch, immutable replay, and tamper tests.
- `Msaidizi.AuditSigner`: an outbound-only, direct-mTLS Windows Service that
  verifies exact database task-event canonical material and signs immutable
  checkpoints with a pinned non-exportable LocalMachine P-256 key.
- `Msaidizi.AuditSigner.Tests`: canonical-chain tamper, replay, rollback/fork,
  expiry, certificate pin, kill-switch, journal, and restart tests.

The companion is deliberately fail-closed. `BrokerChannel.Enabled`,
`ExecutionEnabled`, `HostCapabilities.Enabled`, `SecretProvisioning.Enabled`,
and every signing trust list
default to disabled/empty. When explicitly enabled, the service
uses an outbound HTTPS polling channel with a Windows-store client certificate,
normal server-chain validation, and an additional SHA-256 certificate pin. The
standard-user tray channel and authenticated service-to-user-session bridge
also default off and require an enrolled device certificate, pinned Agent
binary digest, and explicit capability configuration.

## Security invariants

- No component opens a network listener. Broker connectivity is outbound-only
  through `IOutboundCompanionChannel` and `IMutualTlsClientTransport`.
- The LocalSystem service owns a local named pipe and denies network logons.
  It verifies the kernel-reported tray PID, SID, active session, and pinned
  executable digest. The tray verifies a device-certificate challenge. P-256
  ECDH, monotonic sequence numbers, and HMAC authenticate every local frame.
- An ES256 `at+jwt` binds issuer, audience, global service principal, task,
  immutable plan version, step, mandate, device, capability/version, argument
  digest, optional pre-state/provenance digests, idempotency key, budgets,
  issue time, and expiry.
- Capability manifests declare data class, effect, consent, recovery,
  privilege, operating-system support, idempotency, schemas, and provenance as
  independent axes. A read is not inferred to be low risk.
- Argument/result schemas must be strict objects with
  `additionalProperties: false`; each adapter also performs local validation.
- The local journal is append-only and hash-chained. It stores digests and
  terminal receipts, never raw arguments, credentials, recovery handles,
  recovery paths, or raw output. The production recovery-vault decorator does
  not return a reversible recovery receipt until it has separately flushed a
  `RecoveryPrepared` digest checkpoint, and every reviewed in-tree adapter
  enters its target effect only after receiving that receipt. Registry value
  creation observes without creating the target key, requires its immediate
  parent to exist, checkpoints key/value absence, then accepts only a newly
  created-key disposition from the post-checkpoint native create call. Terminal
  results carry the prepared, recovery-checkpoint, and terminal links needed
  for central reconciliation.
- Protocol v3 closes the lost-initial-poll lease race with a broker-signed
  `fence+jwt`. A fence command and an execute command serialize through the
  same journal gate: either `Prepared` already exists, or the companion writes
  an exact-predecessor `ActionFenced` tombstone and permanently rejects that
  device fencing token and every older token. Redelivery changes only the
  signed delivery generation; it reuses the same durable tombstone and cannot
  create a lease, run an adapter, or authorize an external effect.
- Registry-value and Windows-service-start-mode state/recovery semantics are
  capability version `2.0.0`. Newly written protected recovery records carry an
  explicit `/v2` contract marker. No v1 adapter is registered, so an already
  signed v1 action fails capability resolution and must be replanned rather
  than being interpreted under changed state-digest semantics.
- Exact prior outputs and recovery records are stored separately with Windows
  DPAPI service-identity protection beneath supervisor-owned paths. This permits an
  idempotent replay to return the prior result without re-running the action or
  leaking plaintext into the journal.
- Mutations are refused while the central ledger is disconnected. Unknown
  write outcomes become `NeedsAttention` and are never automatically retried.
- Device identity, kill switch, recovery vault, bootstrap verifier, and the
  separately deployed audit signer are outside adapter and self-update
  namespaces.
- Production device identity provisioning accepts only a non-exportable P-256
  key from Microsoft Platform Crypto Provider. TPM failure stops pairing; it
  cannot fall back to Software KSP. TPM-less development/tests must set both
  `RequireHardwareBackedDeviceIdentity=false` and the conspicuous
  `DevelopmentOnlyAllowSoftwareDeviceIdentity=true` override. Packaged and
  production-example configurations explicitly prohibit that override. The
  metadata-only identity record remains LocalMachine-DPAPI protected.
- Backend task events form a database-enforced global SHA-256 chain. The
  database overwrites caller-supplied envelope values and rejects update,
  delete, truncate, out-of-order insertion, and task-cascade deletion. This is
  tamper-evident central reconciliation metadata. The separate audit signer
  now anchors bounded exact-chain checkpoints; real hardware identity and
  deployment attestation remain external provisioning requirements.
- Model-supplied filesystem locations are `(rootId, relativePath)` pairs. Root
  paths, quarantine paths, and executable paths come only from external
  supervisor configuration. NTFS traversal, namespaces, ADS, reserved names,
  reparse points, hard links, and target-identity races are rejected.
- NTFS permission changes select only a supervisor-authored DACL profile ID.
  Handle-bound reads expose canonical owner/group/DACL provenance; writes keep
  ownership and SACL state outside model control, require a LocalSystem
  recovery ACE, and snapshot the exact prior DACL for trusted compensation.
- Process launch is limited to exact supervisor-approved `.exe` files and a
  Windows argument array. Every launch is suspended, attached to its own
  kill-on-close Job Object, then resumed. Status and termination accept only
  the opaque handle of a task-owned job.
- Registry/environment/service/task/software operations use typed allowlisted
  LocalSystem adapters. Registry and environment state, service start/stop,
  task enable/disable, and MSI changes produce protected pre-action recovery
  records. Local identity, network-adapter, printer-queue, power, display-
  timeout, and time-zone mutations are typed and snapshot-backed as well.
  Curated local logon-right assignments use stable supervisor IDs and exact
  SID-bound LSA snapshots; raw account-right/privilege names are prohibited.
  Supervisor-only compensators cover every reversible mutation in those packs.
  The reviewed `schtasks.exe` and `msiexec.exe` paths are resolved only from
  System32, created suspended, reverified by file identity, placed in a
  kill-on-close Job Object before resume, and terminated with their complete
  process trees on cancellation, output overflow, disposal, or failure.
- Ordinary browser form text is limited to explicitly classified public/internal content and is bound to the allowlisted origin, exact UI element, and signed foreground pre-state. Browser form secrets and upload paths remain signed UUID vault handles only.
  The service binds each handle to the exact capability and normalized
  destination, resolves it ephemerally, and sends only AES-GCM ciphertext over
  the authenticated pipe. Raw values never enter action arguments, journals,
  results, logs, persisted memory, or clipboard; service and Agent plaintext
  buffers are zeroed immediately after the exact UI operation.
- Secret create/rotate/delete is available only through a separately enabled,
  LocalSystem-owned local pipe and an explicit tray confirmation showing the
  supervisor-authored exact destination and capability set. It uses
  LocalMachine DPAPI plus a service-only vault ACL, and writes a separate
  secret-free hash-chain audit. No CLI, broker/model input, environment value,
  configuration value, log, journal, or result can carry plaintext.
- A reviewed `command.emergency.execute` implementation exists in source, but
  it is absent from both packaged manifests. Enabling its config flag is
  rejected because a standard-user Job Object cannot enforce or measure the
  signed network-egress ceiling. It must remain unavailable until a separate
  deployment-owned egress supervisor can prove per-action enforcement. The
  action-result and hash-chain protocols now carry conservatively metered capability-side
  application egress separately from the broker-result reservation, whose
  signed serialization ceiling and delivery factors are fixed before dispatch;
  reporting alone is not an enforcement boundary.
- Versioned egress leases, receipts, and independent boundary-attestation
  contracts now fail closed in both LocalSystem and standard-user processes.
  They do not enable either external-effect gate; see
  [egress boundary deployment](docs/EGRESS-BOUNDARY.md) for the external
  WFP/driver, certificate, WebView2, VM, and ring prerequisites.
- Typed email, messaging, publishing, and purchase descriptors retain a pinned,
  bounded HTTPS executor for tests, but no shipped adapter exposes its execution
  entry point. They fail before adapter entry until a supervisor-owned
  socket/proxy or consumed flow handle can bind and independently meter the exact
  action flow; same-lease crash recovery is also still a production blocker.

## Production host capability pack

When `HostCapabilities.Enabled=true`, the manifest includes governed adapters
for filesystem CRUD/search/archive/quarantine, owned processes, HKLM registry
values, governed NTFS permission profiles, machine environment values, Windows
service state, scheduled tasks,
local account/group state and curated logon rights, bounded network-adapter inspection/state changes,
printer discovery/status/pause, display inventory, bounded confidential system
process inventory, bounded machine-wide installed-software inventory, power schemes/monitor
timeouts, time-zone settings, and pinned MSI install/update/uninstall.
The process inventory action requires a signed mandate and exposes only PID,
nullable session ID, and process basename. It is deterministically sorted and
truncated under `MaximumProcessInventoryEntries`; it never opens process handles
or returns command lines, environments, memory, owners, windows, modules, or
raw executable paths.
The installed-software inventory action reads only `DisplayName`,
`DisplayVersion`, and `Publisher` from the 64-bit and 32-bit HKLM uninstall
views and derives `productCode` only from an exact braced-GUID subkey. It never
enumerates per-user hives or reads/returns uninstall commands, install
locations, URLs, credentials, or raw registry paths. It is deterministically
bounded by `MaximumInstalledSoftwareInventoryEntries`, accounts the complete
raw observation, and binds the complete publishable inventory into pre-state
and provenance even when the returned slice is truncated.
Permanent deletion is a separate
irreversible adapter and is omitted unless `PermanentDeleteEnabled=true`; each
request must additionally carry a signed `emergency_operator` consent grant.

`command.privileged.execute` is a separate, default-off LocalSystem adapter and
is included only when both `HostCapabilities.Enabled=true` and
`PrivilegedCommand.Enabled=true`. It accepts a closed `cmd` /
`windows-powershell` enum, an argv array, and bounded timeout/output values. It
launches only fixed System32 images with a reconstructed environment and
atomically creates the suspended child inside a kill-on-close Job Object. It
returns digests rather than raw output. The descriptor is
Credential/Irreversible/OneShotApproval/LocalSystem and execution is routed
through the command egress-boundary requirement. Native creation also requires
a signed trusted-root reservation bound to the exact action, invocation,
executable and deployment measurements. The reservation is committed before
creation; the exact suspended process, thread, image and kernel job binding is
signed and committed before resume; and a signed terminal receipt is committed
before return. A hash-chained replay ledger preserves these transitions across
restart. Pending state is settled through a recovery-only startup surface before
broker intake. Missing settlement or signed evidence of discontinuous
enforcement durably produces `NEEDS_ATTENTION`, trips a process-lifetime dispatch
latch, and stops/restart-fences the service. The only production isolation-gate
implementation currently shipped always rejects and has no configuration
override. Packaged defaults keep the capability absent, and neither changing
its flag nor adding the WFP egress boundary can make it launch until a separately
trusted supervisor/driver implementation is deployed and verified.
The bounded stdout/stderr result is not local-I/O accounting: an arbitrary
LocalSystem shell could read or write unmetered disk data and inspect credentials
or process memory. Consequently the task 5-GB local-I/O ceiling and trusted-root
non-interference remain unenforceable for this capability until that independent
native isolation/metering boundary exists; the rejecting production gate must
remain in place.

When `SessionBridge.Enabled=true`, the reviewed standard-user manifest includes
session status, clipboard read/irreversible write, primary-screen capture, WAV playback,
camera JPEG capture, local installed-voice speech synthesis, and a composite
one-use-consent microphone-to-local-installed-recognizer transcription action.
Captured WAV bytes remain process-local and never enter arguments, bridge
frames, journals, results, or broker delivery; only a DLP-scrubbed untrusted
transcript plus action-bound digests and accounting leave the device. URI
navigation, UI invocation, browser form/upload/download effects, and emergency
commands are excluded by default; attempting to enable either external-effect
gate currently fails closed. The service accepts the manifest only when its
complete descriptor digest exactly matches that reviewed subset.
Clipboard write still requires the exact observed pre-state digest and charges
the prior and replacement UTF-8 byte counts, but retains no prior clipboard
value and publishes no recovery handle or recovery provenance.

See [host capability pack](docs/HOST-CAPABILITY-PACK.md) for exact schemas,
pre-state contracts, security boundaries, and remaining gaps.

See [governed external actions](docs/EXTERNAL-ACTIONS.md) for endpoint policy,
egress accounting, secret scope, and acknowledgement semantics.

See [trusted root](docs/TRUSTED-ROOT.md),
[broker protocol](docs/BROKER-CHANNEL.md), and
[trusted update supervisor](docs/UPDATE-SUPERVISOR.md), and
[trusted recovery supervisor](docs/RECOVERY-SUPERVISOR.md), and
[trusted audit signer](docs/AUDIT-SIGNER.md), and
[local secret provisioning](docs/SECRET-PROVISIONING.md), and
[egress boundary deployment](docs/EGRESS-BOUNDARY.md), and
[capability adapter rules](docs/CAPABILITY-ADAPTERS.md) before implementing any
real adapter.

## Build and test

Install PowerShell Core 7.4 or newer in the 7.x release line and the .NET 8 SDK
on a Windows build host, then run (the repository requires SDK `8.0.400` for
the protected gate):

```powershell
dotnet restore .\Msaidizi.WindowsCompanion.sln
dotnet build .\Msaidizi.WindowsCompanion.sln -c Release --no-restore
dotnet test .\Msaidizi.WindowsCompanion.sln -c Release --no-build
```

The protected CI and signed-release source gate run the exact SDK, formatting,
Release builds, the complete solution and installer-hardening xUnit tests,
Roslyn-required security static checks, installer/release authoring checks, and
the bootstrap, path, tool-trust, and operational-evidence dynamic policy
harnesses through one hash-pinned entry point:

```powershell
$dotnet = (Get-Command dotnet -CommandType Application -ErrorAction Stop).Source
.\scripts\Invoke-ProtectedSourceVerification.ps1 -DotNetPath $dotnet
```

The GitHub `Windows Companion — Protected Verification` check must be required
by branch protection. The signed release constructor independently invokes the
same runner before it creates or signs a candidate, so direct release-script
use cannot omit these checks. Windows PowerShell 5.1 is rejected because it
cannot execute the mandatory Roslyn syntax scan reliably.

Generate `packages.lock.json` files in the controlled build environment before
switching release/CI restores to `--locked-mode`. Publish explicit Windows
artifacts:

```powershell
dotnet publish .\src\Msaidizi.Companion.Service -c Release -r win-x64 --self-contained true
dotnet publish .\src\Msaidizi.Companion.Agent -c Release -r win-x64 --self-contained true
dotnet publish .\src\Msaidizi.UpdateSupervisor -c Release -r win-x64 --self-contained true
dotnet publish .\src\Msaidizi.RecoverySupervisor -c Release -r win-x64 --self-contained true
dotnet publish .\src\Msaidizi.AuditSigner -c Release -r win-x64 --self-contained true
```

When an SDK is unavailable, the checked-in fallback can still validate project
references, JSON, XML, C# syntax when Roslyn is installed, and forbidden APIs:

```powershell
.\scripts\verify-static.ps1
```

This fallback is not a substitute for the Release build and test commands.

## Runtime flow

1. The service verifies the journal before connecting.
   Any prior `Prepared` record with no terminal receipt is closed as
   `NeedsAttention`; it is never replayed automatically.
2. The outbound mTLS channel authenticates the device and central broker.
3. The service sends bounded digest-only journal ranges until the central
   append-only ledger acknowledges the exact local head. It repeats this gate
   after reconnect and before execute, replay-result, or fence handling; see
   [journal reconciliation](docs/JOURNAL-RECONCILIATION.md).
4. A command token is signature-, scope-, lifetime-, budget-, and
   exact-request-checked.
5. The adapter version and strict arguments are resolved locally.
6. Trusted-root policy, kill switch, execution flag, and ledger connectivity
   are checked independently.
7. A `Prepared` digest record is durably appended before execution.
8. Cancellation is cooperative; a mutation interrupted with an unknown result
   becomes `NeedsAttention`.
9. A terminal receipt is durably appended before the result is sent. A replay
   with the same idempotency key returns that receipt without executing again.

## Deployment

Do not install the binaries directly from a developer checkout. Use a signed,
reproducible release artifact and follow [installer/README.md](installer/README.md).
Installer VM acceptance is not production acceptance. The exact candidate must
also pass the separately signed [operational and staged-ring boundary](installer/operational/README.md);
missing, stale, skipped, mismatched, or unsigned evidence leaves deployment
eligibility false.
