# Trusted autonomous update supervisor

`Itemba.Msaidizi.UpdateSupervisor` is a separately signed Windows Service. It
is not a Msaidizi capability adapter and is not loaded into the companion
execution process. Its binary, configuration, bootstrap public key, result
cache, and journal live beneath the supervisor ACL and are excluded from every
agent-controlled update target.

## Trust and command protocol

1. An oversight-authorized rollout request creates one immutable
   `MsaidiziUpdateDeployment` per selected device. This does **not** change the
   candidate to `CANARY` or `ACTIVE`.
2. The broker signs the exact UTF-8 JSON manifest with a dedicated P-256 key
   loaded from an absolute deployment-secret path. This key is distinct from
   TLS and ordinary host-action keys.
3. The supervisor polls outbound over a dedicated update-supervisor mTLS
   identity. Its certificate and DER-SPKI pins are enrolled independently of
   both the ordinary companion and recovery supervisor. The manifest binds
   deployment, candidate, device, operation, delivery lease/attempt, ring,
   installer-enforced ring dwell, immutable target ID, source version/digest,
   rollback version/digest, health timeout, minimum continuous healthy-soak
   duration, expiry, and stable action idempotency key. Lease re-signing may
   change delivery metadata and the manifest digest, but cannot change the
   supervisor-computed immutable-action digest behind the result cache.
4. The supervisor checks the P-256 signature against a public key whose SPKI
   SHA-256 is pinned in its administrator-owned configuration. It verifies
   artifact SHA-256 values while downloading them over the same mTLS channel.
5. An installer-owned target allowlist maps `targetId` to a versions directory,
   atomic active-pointer file, exact Windows service (or external pointer
   watcher), and fixed file/HTTP health probe. Signed input
   cannot introduce a path, command, executable, or health criterion.
6. The exact verified command is retained in an administrator-owned pending
   store before acknowledgement. ACK, progress, and result records are fsynced
   to a trusted-root outbox before transmission. A lost response is retried
   after reconnect or service restart; broker APIs must be idempotent. A newly
   signed lease can replace a pending lease only when its attempt increases and
   its stable idempotency key and immutable-action digest are unchanged.
7. A hash-chained, write-through journal records `PREPARED` before activation.
   Package extraction rejects absolute paths, traversal, ADS paths, links, and
   reparse entries. Activation atomically replaces a small pointer file; the
   running application must resolve that pointer during restart/reload.
8. The supervisor persists `APPLYING_FENCED` and requires accepted,
   lease-fenced `APPLYING` progress before downloading or staging either
   package. This prevents supported large packages from consuming the delivery
   lease before the mutation fence. An ambiguous fence response records
   retryable `FENCE_DEFERRED`, performs no artifact read or mutation, and
   resumes only from the retained signed command. After restart, an expired
   retained command may bypass only the local delivery-expiry check and only
   when the exact manifest has one of those trusted journal phases; ACK and
   `APPLYING` must still replay successfully against the broker before artifact
   access. An expired `DISPATCHED` lease therefore gains no authority.
   `HEALTH_CHECK` is also lease-fenced; if it cannot be
   accepted after activation, the outcome is uncertain, so the supervisor
   restores and proves the signed rollback and emits `NEEDS_ATTENTION`.
9. For a service target, the updater restarts only the exact allowlisted Windows
   service after each pointer change. Production HTTP health probes require the
   configured version header to equal the signed version on every sample. The
   activated version must remain continuously healthy for the signed minimum
   soak and at least two samples. Deadline and soak duration use monotonic
   elapsed time; canonical health-evidence timestamps use UTC millisecond ISO
   strings and derive their interval from the same monotonic duration. Every
   HTTP request receives a cancellation token tied to the remaining signed
   deadline, and the caller stops waiting at that deadline.
   A timeout or any regression after the first healthy sample immediately
   activates the staged **signed rollback version/digest**, then requires that
   rollback to complete the same continuous exact-version soak before reporting
   `ROLLED_BACK`. An arbitrary previous pointer is usable only when its persisted
   version and artifact digest exactly equal the signed rollback claims.
   Explicit rollback and crash restoration obey the same proof; failed proof is
   `NEEDS_ATTENTION`. The signed soak may exceed, but can never reduce, the
   installer-owned minimum. Startup recovery never resumes a partially observed
   source soak or resets its clock.
10. The terminal result is cached durably by deployment, stable signed
   idempotency key, and immutable-action digest. Re-signed delivery attempts
   return the prior result without repeating activation. Terminal reasons are
   control-character sanitized and deterministically capped at the broker's
   2,000-character DTO limit before journaling, caching, or transmission.
   Terminal journal data
   includes enough result and health evidence to rebuild a cache write
   interrupted by a crash. Terminal enqueue removes obsolete ACK/progress for
   that exact attempt so rejected progress (including after a device kill)
   cannot head-of-line block the terminal reconciliation. Only the assigned mTLS
   supervisor result advances the central
   candidate to `CANARY`, `ACTIVE`, `ROLLED_BACK`, or `FAILED`.

The shared local `supervisor\DISABLED` file prevents polling, artifact reads,
and pointer activation. The central global kill switch independently prevents
manifest creation, poll dispatch, and update artifact delivery while still
allowing a previously dispatched supervisor to reconcile terminal evidence.

The artifact endpoints remain task-budgeted and accept only deployments in an
in-flight state for the certificate-bound device. Model/user health claims are
informational only and cannot settle deployment state.

## Package and target contract

Packages are ZIP files containing ordinary files/directories only. Entry count,
compressed bytes, and expanded bytes have installer-owned ceilings. The updater
never launches a package,
PowerShell, CMD, a script host, or a package-supplied health command.

The target's `VersionsRoot` and `ActivePointerPath` must be absolute and must
not overlap the supervisor root or any `ProtectedRoots` in either direction.
The pointer contains only one generated version-directory name. Activation is
either an exact allowlisted Windows-service restart or an explicitly configured
external pointer watcher; it is never inferred from package contents.

## Operational provisioning

- Create a non-CA P-256 client certificate whose private key ACL grants access
  only to the update-supervisor service identity. It must not reuse the
  companion, recovery-supervisor, evaluator, audit-signer, or egress key.
- With a recently authenticated `msaidizi.oversight` session, call
  `POST /msaidizi/devices/:id/supervisor-enrollment-codes` with role `UPDATE`.
  Inject them as `MsaidiziUpdateSupervisor__EnrollmentId` and
  `MsaidiziUpdateSupervisor__EnrollmentCode` through protected environment
  configuration, start the service once, verify enrollment, then
  remove both values. The broker persists only an HMAC of the code and the
  resulting certificate/SPKI pins; the raw code must never enter appsettings,
  source control, logs, or the database.
- Authenticode-sign the updater EXE/DLLs and installer; verify before service
  registration.
- Put the bootstrap public key, pinned digest, target map, and health policy in
  administrator/deployment-owned configuration beneath the supervisor ACL.
  Production targets use a 300-second installer minimum, a five-second sampling
  interval, and a 900-second maximum signed health timeout. Lower signed soak
  values are rejected before artifact access or pointer mutation.
- Provision the matching broker private key only through the central secret
  store (`MSAIDIZI_UPDATE_SIGNING_KEY_PATH`). Never store it in Itemba tables.
- Grant ordinary companion/tray identities no write or delete rights to the
  updater binary, configuration, pending-command store, outbox, journal,
  result cache, or bootstrap key.
- Run tamper, crash-between-pointer-and-journal, lost ACK/progress/result
  response, lease re-signing, exact-version mismatch, monotonic deadline,
  mid-soak regression, rollback-health failure, non-I/O restoration failure,
  health-timeout, duplicate delivery, rollback, and ring-0 drills in a
  disposable Windows VM before
  setting `MSAIDIZI_UPDATE_SUPERVISOR_ENABLED=true`.

Current limitation: the repository supplies the service and security protocol,
not a production Authenticode certificate, MSI, TPM attestation ceremony, or
application-specific health endpoint. Those deployment artifacts must remain
outside autonomous modification.
