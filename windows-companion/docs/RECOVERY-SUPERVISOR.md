# Trusted recovery supervisor

`Itemba.Msaidizi.RecoverySupervisor` is a separately installed and signed
LocalSystem Windows Service. It is not a capability adapter, is absent from the
model manifest, and receives no task JWT, prompt, plugin, shell, or arbitrary
path. Its only input is a short-lived exact recovery manifest signed by the
deployment-owned recovery key after a recently authenticated oversight user
types the original action-specific confirmation phrase.

The signed manifest binds the recovery command, device, original action,
protected recovery-record digest, expected current-state digest, idempotency
key, and expiry. The service pins both the signing-key ID and P-256 public-key
digest. It polls Itemba over an outbound-only, dedicated recovery-supervisor
mutual-TLS identity and exposes no local or network listener. The certificate
and DER-SPKI pins are distinct from the ordinary companion and update
supervisor identities.

Provision a non-CA P-256 client certificate whose private key ACL grants access
only to the recovery-supervisor service identity. With a recently authenticated
`msaidizi.oversight` session, call
`POST /msaidizi/devices/:id/supervisor-enrollment-codes` with role `RECOVERY`,
inject them as `MsaidiziRecoverySupervisor__EnrollmentId` and
`MsaidiziRecoverySupervisor__EnrollmentCode` through protected environment
configuration, start the service once, verify enrollment, and
remove both values. Never persist the raw code in appsettings, source control,
logs, or the database; the broker stores only its HMAC and the resulting
certificate/SPKI pins.

Before any restore, the service appends and write-through flushes a PREPARED
record to a local hash-chained journal. The encrypted recovery vault is read by
the existing CAS compensators. A restore proceeds only when the current state
equals the signed expected state; an exact already-restored pre-state is an
idempotent success; every other state is refused. The final state digest is
verified, journaled, cached immutably, and reconciled with the central command,
task event, audit record, and operator notification.

The shared `supervisor\DISABLED` file blocks polling and execution. The recovery
executable, pinned key, journal, and result cache live below
`supervisor\recovery` and the bootstrap validator refuses any model-addressable
filesystem root that contains that directory. The encrypted recovery vault is
a protected sibling, not an autonomous update target. Deploy the Service
assembly dependency as a private copy in this immutable directory; never load
it from the autonomously updated companion installation.

Supported recovery records currently cover quarantine, registry values,
machine environment variables, Windows service running state, scheduled-task
enabled state, local-account enablement, local-group membership, SID-bound
local logon rights, network-adapter enabled state, printer pause state, active
power schemes, monitor timeouts, time zones, and governed NTFS DACL profiles.
Unsupported and irreversible effects fail closed.

The recovery service's externally provisioned `HostCapabilities` target
bindings must match the companion service's stable IDs and concrete targets.
Packaged recovery configuration keeps every allowlist empty; a missing,
renamed, or mismatched binding makes compensation unavailable rather than
falling back to a raw Windows name, SID, registry path, or service identifier.
