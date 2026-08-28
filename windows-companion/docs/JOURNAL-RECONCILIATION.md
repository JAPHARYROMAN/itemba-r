# Device journal reconciliation

The companion's local action journal and Itemba's central ledger are separate,
append-only histories. Before an enabled companion reads broker commands, it
must prove that the central ledger has accepted the exact verified local head.
It repeats that proof before execute, replay-result, or action-fence handling,
so a transport reconnect cannot silently resume privileged work on a stale
central view.

## Wire contract

`POST /msaidizi/devices/channel/journal-reconcile` is available only on the
direct-mTLS device channel. The claimed `deviceId` must equal the enrolled
certificate and P-256 public-key identity.

Each request carries at most 128 `JournalRecord` values, plus:

- the starting predecessor sequence and hash;
- strictly contiguous digest-only records;
- the range's final sequence and hash; and
- the companion's complete local-head sequence and hash.

Records contain sequence, time, kind, stable action/idempotency identifiers,
predecessor hash, payload SHA-256, and entry hash. They never contain the
locally persisted payload JSON, action arguments, credentials, recovery
content, or tool output. The broker ACK echoes the device, predecessor, range
terminal, and local head and marks `exactHead` only for the terminal range.
The companion validates every echo before advancing its in-memory cursor.

Hash version 2 is canonical JSON over only the public digest fields (with the
entry kind represented by its append-only numeric code), so the backend
recomputes every new entry hash before persistence. Version-1 lines from an
existing installation remain locally restart-verifiable using their original
payload, but startup appends one version-2 `ChainUpgraded` bridge. The central
head may temporarily ingest authenticated legacy ranges, but it cannot set the
exact-head authorization marker until the terminal version-2 bridge is present.

## Central consistency rules

The server authenticates the live TLS peer, locks the per-device head, and
compares the request predecessor with the persisted chain. An identical replay
is accepted idempotently. New records are inserted and the head is advanced by
compare-and-swap in one database transaction. Gaps, forks, changed historical
fields, wrong-device requests, oversized ranges, a local head behind central,
or inconsistent terminal fields return an error. A database trigger rejects
updates and deletes to entry rows.

Neither side repairs, truncates, deletes, or rewrites history after a conflict.
Operator investigation and recovery are required.

Migrated and lazily created head rows start with no exact-head acknowledgement.
Only a completed terminal reconciliation range sets that marker; advancing the
head clears it. This prevents an older companion or a genesis backfill from
being mistaken for a successful reconciliation.

## Runtime behavior

- With the broker disabled, no command intake exists and the companion remains
  read-only with `centralLedgerConnected=false`.
- With the broker enabled, an unavailable or mismatched reconciliation ACK
  fails startup before command polling.
- Reconnect command handling re-enters the reconciliation gate before any
  execute, replay-result, or fence operation.
- A broker ping first reconciles any Prepared/terminal/fence advancement and
  only then emits a connected heartbeat, preventing a stale-head ping loop.
- Heartbeats report ledger connectivity only when the transport is fresh and
  the acknowledged head still equals the current local head.
- The broker derives heartbeat ledger connectivity from its persisted head and
  returns only ping/cancellation traffic until the heads match.

## Verification

Offline backend checks:

```powershell
cd backend
npm run test:msaidizi-device-journal-reconciliation
node --max-old-space-size=8192 node_modules/jest/bin/jest.js `
  src/modules/msaidizi-devices/device-journal-reconciliation.spec.ts --runInBand
```

On a host with the repository-pinned .NET 8 SDK:

```powershell
cd windows-companion
dotnet build .\Msaidizi.WindowsCompanion.sln -c Release --no-restore
dotnet test .\Msaidizi.WindowsCompanion.sln -c Release --no-build --no-restore
```

Production still requires migrated PostgreSQL, enrolled mTLS device identities,
an HTTPS broker certificate/pin, signed companion artifacts, TPM/secure-storage
provisioning, central ledger availability, and restart/reconnect drills on a
disposable Windows 11 VM. Local tests do not fabricate any of that evidence.
