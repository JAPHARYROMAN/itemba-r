# Isolated update evaluator

`Msaidizi.UpdateEvaluator` is a separately deployable .NET 8 Windows worker for
the generated self-improvement pipeline. It is not the update supervisor and it
has no deployment, bootstrap-key, recovery-vault, audit-signer, or kill-switch
write capability.

## Exact broker protocol

The worker uses only the backend's dedicated client-certificate listener:

1. `POST runs/poll` leases one immutable generated evaluation.
2. `POST runs/{id}/start` consumes the exact lease UUID.
3. `POST runs/{id}/heartbeat` renews the lease with monotonic cumulative CPU,
   local I/O, egress, model-turn, token, and cost accounting.
4. `GET runs/{id}/generation-artifact` carries the lease only in the scrubbed
   `X-Msaidizi-Evaluation-Lease` header.
5. `POST artifacts` uploads separately signed SOURCE, ROLLBACK, and REPORT
   evidence through bounded multipart requests.
6. `POST candidates/{id}/evaluation` submits one runner attestation and exactly
   two review attestations. It never calls the human evaluation endpoint.

All transport calls are outbound HTTPS with a distinct mTLS certificate and
both broker certificate and SPKI pins. A broker rejection or heartbeat stop
cancels VM commands and both in-flight reviews.

## Trust identities

Provision five distinct P-256 identities:

- one mTLS transport certificate;
- one `ARTIFACT_VERIFIER` signing key;
- one `EVALUATION_RUNNER` signing key;
- two `MODEL_REVIEWER` signing keys.

Signing keys must be non-exportable CNG keys in the configured hardware
provider. Startup rejects reused key IDs, certificate thumbprints, or SPKI
fingerprints. It also rejects reviewers that reuse a provider ID, reviewer ID,
model ID, HTTPS origin, or credential reference. The two reviewer API secrets
are supplied only through their distinct environment-variable names; values
are placed on ephemeral Authorization headers and are never logged, journaled,
placed in evidence, or persisted in checkpoint state.

The backend evaluator key allowlist remains operator-owned and external. Add
only the four signing public keys with their exact roles. The mTLS public key
must remain absent from that registry.

## Disposable VM contract

The included `HyperVPowerShellEvaluationProvider` invokes
`Evaluation/Invoke-MsaidiziUpdateEvaluationVm.ps1` through the fixed Windows
PowerShell path. Production requires:

- a Windows 11 x64 Hyper-V guest and an operator-approved clean checkpoint;
- PowerShell Direct enabled for the evaluator service account;
- an NTFS guest repository with a lowercase 64-hex
  `.msaidizi-base-revision.sha256` marker;
- an operator-created PowerShell credential exported with DPAPI for the exact
  service identity;
- an Authenticode-signed provider script whose exact SHA-256 is pinned in
  configuration;
- no supervisor, recovery, audit, bootstrap, or device-key directory mounted
  into the guest workspace.

For every run the provider stops and restores the approved snapshot, starts the
guest, copies a baseline to a run-owned workspace, rejects reparse points and
multi-link files, applies only canonical pre-hash-bound changes with atomic file
replacement, executes only operator-configured commands, exports the evaluated
and rollback trees, then stops and restores the checkpoint again. Source and
rollback ZIP files are regenerated deterministically so an interrupted upload
can use the backend's exact artifact replay semantics.

The provider abstraction is intentionally injectable. Tests use a disposable
fake workspace; a deployment may supply another enterprise VM implementation
only if it preserves the same evidence and cleanup contract.

## Crash, cancellation, and budgets

Lease authority, cumulative usage, uploaded artifact purposes, model decisions,
and signed envelopes are checkpointed atomically under the evaluator root using
machine-scope DPAPI. The root must exist before startup and grant write access
only to the evaluator service identity and recovery operators. Restart resumes
an exact signed submission without rerunning a model. Reviewer requests carry a
deterministic idempotency key for the narrower crash window before a response is
checkpointed.

The shared trusted-root `supervisor\DISABLED` file stops new polling and cancels
active work at the next heartbeat boundary. Per-command timeouts, the task wall
deadline, cumulative resource ceilings, reviewer timeouts, and the broker lease
are all hard stops. Unknown outcomes are retained for reconciliation; the
worker does not invent successful VM, signature, or cleanup evidence.

## Build and installation readiness

Build and test from a machine with the pinned .NET SDK:

```powershell
dotnet test .\tests\Msaidizi.UpdateEvaluator.Tests\Msaidizi.UpdateEvaluator.Tests.csproj -c Release
dotnet publish .\src\Msaidizi.UpdateEvaluator\Msaidizi.UpdateEvaluator.csproj -c Release -r win-x64 --self-contained false
```

Authenticode-sign and timestamp the published executable and provider script in
the external release ceremony. Install it under a dedicated Windows service
identity that can operate only the named evaluation VM, its service-owned state
root, and its hardware signing keys. Start from
`config/update-evaluator.production.example.json`, provision every placeholder,
pin the actual provider-script digest, and only then set `Enabled` to `true`.

This repository does **not** contain production private keys, certificates,
reviewer credentials, a signed VM acceptance result, or a claim that the local
machine passed Hyper-V acceptance. Those remain required external rollout
evidence.
