# Trusted supervisor boundary

The following components are outside Msaidizi capability adapters, task
content, memory, prompt updates, and autonomous code updates:

- hardware-backed companion, update-supervisor, and recovery-supervisor client
  identities, each with a distinct certificate, SPKI, and private key;
- local and central kill switches;
- audit/journal signing and reconciliation keys;
- recovery-vault encryption keys and recovery metadata;
- secret-reference vault, trusted local provisioner, and plaintext secret
  buffers outside their bounded use callbacks;
- bootstrap/update verification keys and updater executable.

`TrustedRootComponents` names this boundary. `TrustedRootGuard` rejects any
descriptor marked `TouchesTrustedRoot` and reserves capability namespaces such
as `supervisor.*`, `bootstrap.*`, `audit-signer.*`, `recovery-vault.*`, and
`device-identity.*`.

`TouchesTrustedRoot=false` declares that a typed operation does not directly
target this boundary; it is not proof that a general-purpose interpreter is
contained. Accordingly, `command.privileged.execute` uses one versioned signed
reservation lifecycle. Before any native child exists, the runner resolves and
hashes the exact system image and invocation, verifies a short-lived reservation
bound to the action, task, plan, step, device, mandate, token, invocation, image,
policy, driver, service, and required enforcement-feature digests, and durably
commits it. The child is then created suspended and atomically assigned to a
kill-on-close Job Object through `PROC_THREAD_ATTRIBUTE_JOB_LIST`. The runner
independently reads its process and creation identities, thread, image and job
membership, verifies a signed binding acknowledgement over those observations,
and durably commits that acknowledgement before `ResumeThread`.

Every branch must close the same lifecycle. A childless reservation receives a
signed pre-bind release whose authenticated outcome must match the exact local
branch. A bound child receives a signed terminal receipt that
truthfully distinguishes completed, failed, cancelled, timed-out, crashed,
isolation-violation, and unknown outcomes, including whether the child ever
resumed and whether an exit code is known. The runner commits the release or
receipt before reporting a terminal result. Missing, malformed, mismatched,
replayed, or uncommitted evidence fails closed; an uncertain terminal outcome is
never retried as a complete action.

The companion verifies four purpose-separated P-256 signature domains with
key-ID-bound canonical material. Verified reservation, release, bind and receipt
markers have internal constructors. A write-through, hash-chained replay ledger
enforces reservation-to-release or reservation-to-bind-to-terminal ordering,
exact idempotency, nonce/digest uniqueness, monotonic supervisor and boot
sequences, exclusive ownership, and corruption detection across restarts. Its
dedicated `supervisor\privileged-command-isolation` directory is writable only
by SYSTEM and the restricted companion service SID; recovery operators have
read-only audit access. Persisted records contain signed contracts and digests,
never raw tokens, commands, output, or secrets.

On restart, a settlement-only recovery surface exposes no reserve, launch, bind,
or resume operation. An ordered startup reconciler freezes the exact pending
IDs and digests, settles bound trees before unused reservations, rejects
unrelated evidence, rereads the ledger, and requires zero unresolved entries
before the broker worker starts. In-process, any release/receipt failure trips a
one-way dispatch latch. The coordinator durably reports `NEEDS_ATTENTION` with a
conservative mutation flag, then rethrows so the worker stops the service.

A valid signature is evidence, not proof that enforcement succeeded. Terminal
receipts are committed for audit before their integrity status is evaluated. A
receipt reporting discontinuous enforcement or `isolation-violation` trips the
same latch, and the durable ledger keeps the workstation startup-fenced across
restarts until a trusted out-of-band integrity-recovery ceremony intervenes.

These contracts and consuming-side checks do not emulate the trusted producer.
An enabling deployment still needs an independently signed supervisor and
kernel enforcement component that owns the purpose-separated signing key,
logical/kernel Job identity, durable boot sequence and policy measurements. The
deployment-owned gate is independent of action/configuration input and of the
egress boundary. The only production gate registered in this repository always
rejects and has no configuration override, so no configuration or egress client
can enable privileged command launch. Signed test sessions exist only to prove
the consuming runner and verifier. Until the external supervisor and driver
exist and pass VM/ring acceptance, the rejecting registration is the only sound
production behavior.

The production installer must ACL `%ProgramData%\Itemba\Msaidizi\supervisor`
and its parents so only `SYSTEM` and a dedicated administrator/operator group
can create or remove the `DISABLED` kill-switch file. No capability adapter may
receive a handle, path, registry key, certificate private key, service-control
right, or updater interface that can change this boundary indirectly.
Service policy therefore rejects canonical variants of the Companion, Update
Supervisor, and Recovery Supervisor SCM names. Registry policy rejects their
entire `HKLM\SYSTEM\CurrentControlSet\Services` subtrees and the broad
`HKLM\SOFTWARE\Itemba\Msaidizi` configuration tree. Local identity policy also
rejects canonical `Itemba Msaidizi` supervisor, recovery, and emergency account
or group names so an identity capability cannot grant recovery-vault access.
The update and recovery client private keys must be installed in LocalMachine
with role-specific ACLs: neither supervisor may read the other's key, and the
ordinary companion identity may read neither. Enrollment is an oversight-only,
recent-authenticated ceremony using a single-use challenge whose raw code is
returned once and never durably stored.

Engaging the local kill switch blocks new actions. Cancellation of an action
already inside an OS operation is cooperative; therefore mutating adapters must
use bounded substeps, check cancellation between them, journal expected state,
and classify uncertain interruption as `NeedsAttention`. The central switch
must independently stop dispatch and revoke device leases.

The action journal is evidence, not the recovery vault. It contains only
digests and receipts. Quarantine/snapshot metadata belongs in a separately
encrypted vault whose lookup credentials are not exposed to model context or
capability output.

`ITrustedSecretProvisioner`, `ITrustedHostRecoveryRecordReader`,
`ITrustedQuarantineRecoveryExecutor`, and
`ITrustedAdministrativeRecoveryExecutor` are deliberately not
`IHostCapabilityAdapter` implementations and never appear in a capability
manifest. Model-addressable browser operations receive only a UUID reference;
the service independently binds vault use to the exact capability and
normalized destination digest. Recovery similarly requires an operator path,
the protected record digest, and the exact current-state digest before one
compensation can run.

Before enabling self-update, place the updater and bootstrap verifier in a
separate signed service with a pinned verification key. The agent may submit a
candidate package but cannot choose the signing key, change acceptance policy,
disable rollback, edit canary health criteria, or promote itself.

That boundary is implemented by `Itemba.Msaidizi.UpdateSupervisor`. Its signed
manifest protocol, immutable target policy, durable rollback journal, and
mTLS result reconciliation are documented in [UPDATE-SUPERVISOR.md](UPDATE-SUPERVISOR.md).
The updater is intentionally absent from the capability registry.

Recovery is independently implemented by `Itemba.Msaidizi.RecoverySupervisor`.
The central broker signs one exact, recently-authenticated operator request
with a distinct recovery key; the outbound-only mTLS service verifies the
pinned key and current-state digest, journals before mutation, invokes only a
typed CAS compensator, verifies the restored state, and reconciles an immutable
result. Its executable, pinned key, journal, result cache, and private copy of
the compensator assembly are outside autonomous update targets. See
[RECOVERY-SUPERVISOR.md](RECOVERY-SUPERVISOR.md).

Audit anchoring is independently implemented by `Itemba.Msaidizi.AuditSigner`.
It fetches only exact database-provided task-event canonical material over a
pinned outbound direct-mTLS channel, verifies the v1 hash chain against its
protected local head, and signs a bounded versioned checkpoint with a
non-exportable LocalMachine P-256 key. The companion and model cannot invoke it
or alter its service, configuration, journal, key, or backend append-only
records. See [AUDIT-SIGNER.md](AUDIT-SIGNER.md). Real TPM certificate issuance,
hardware/deployment attestation, and Authenticode trust remain external.
