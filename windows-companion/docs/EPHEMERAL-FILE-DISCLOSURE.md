# Ephemeral host-file disclosure boundary

## Current production state

Host file content remains unavailable. Both
`filesystem.file.read@1.0.0` and the reserved
`filesystem.file.disclose.ephemeral@1.0.0` fail closed with
`REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY`. Neither capability is published,
enrollable, plannable, dispatchable, or result-cache eligible. Metadata-only
stat, list, and search operations remain available.

This is intentional. The existing companion contract returns a normal
`ActionResult`; exact results are DPAPI-cached for idempotent delivery, then the
backend settles them before adaptive reasoning starts. Raw file bytes cannot
enter that lifecycle. Uploading bytes before result settlement would wait on a
provider call that cannot begin until settlement. A separately acknowledged
upload would lose atomic same-session coupling across worker handoff, process
restart, and horizontal deployment. No authenticated device-to-provider stream
and no central atomic nonce/budget ledger currently close that gap.

The provider client also uses JavaScript strings and SDK request objects whose
copies cannot be deterministically zeroed. The signed zero-training,
zero-provider-retention contract is necessary but does not prove local heap
ephemerality or couple a particular device read to exactly one provider request.

## Implemented source primitives

The backend and .NET companion share a canonical v1 metadata grant and parity
vector. The grant contains no raw path, file bytes, decoded text, prompt, or
model response. Authorization exact-binds:

- capability ID and version;
- action, task, immutable plan version, step, device, and mandate IDs;
- action-argument, expected-pre-state, file-identity, and relative-path digests;
- one-use nonce, idempotency key, issuance generation, and expiry;
- sorted allowlisted MIME types and a maximum of 512 KiB;
- the verified provider-contract artifact digest and exact model ID.

The backend additionally rejects a provider contract unless the immediately
verified signed claims cover both credentials and documents, name the exact
model, assert zero training, and specify zero seconds of provider retention.
Unknown fields, noncanonical JSON/identifiers/digests/nonces, replay-shaped
normal action results, unsupported MIME types, oversized grants, stale grants,
and every authority drift fail closed. The production port is a rejecting port
and has no configuration switch. Restart and replay therefore remain closed.

Only digest-and-counter receipt fields are defined for future durable evidence.
Defining a receipt does not prove that a disclosure occurred and does not make
the reserved capability available.

## Missing source required before activation

A future activation must land and be reviewed as one complete security boundary:

1. A mutually authenticated, single-session stream that transfers bytes from a
   still handle-bound file directly into one provider request, without
   `ActionResult`, artifact, database, transcript, memory, audit, log,
   telemetry, resume-state, outbox, or DPAPI-cache serialization.
2. An atomic durable metadata ledger that reserves and consumes the nonce and
   idempotency key once, binds restart recovery to the exact generation, and
   never stores content or raw paths.
3. File-handle identity revalidation through EOF; MIME validation; bounded PDF,
   text, and structured-document parsing; binary rejection; DLP and
   known-secret fingerprint decisions; and conservative local-read/provider-
   egress accounting before any provider byte is accepted.
4. Cancellation and kill-switch checks immediately before the read, during the
   stream, and at provider commit, with unknown outcomes settled as
   `NEEDS_ATTENTION` and never retried automatically.
5. A provider transport that can prove the attested endpoint/model/account was
   used and that local request buffers are never copied into non-zeroable SDK,
   logging, tracing, retry, crash-dump, or telemetry state.
6. Adversarial restart, replay, cancellation, PDF/binary/polyglot, secret/DLP,
   TOCTOU, worker-handoff, provider-timeout, and storage-forensics evidence.

Until every item exists, the rejecting policy is the source-complete safe
behavior. No WDK, Windows VM, live provider, or deployment evidence is claimed
by the metadata tests.
