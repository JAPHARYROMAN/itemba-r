# Trusted audit signer

`Itemba.Msaidizi.AuditSigner` is a separately built and installed .NET 8 Windows
Service. It is not a capability adapter, is not loaded by the companion, and is
outside Msaidizi's task, prompt, memory, policy, and autonomous-update
namespaces. It opens no listener. Its only network activity is an outbound
direct-mTLS channel to the configured Itemba broker.

## Checkpoint protocol

1. The signer loads exactly one valid ECDSA P-256 certificate from the
   `LocalMachine\My` store. The CNG private key must be non-exportable and its
   provider must equal the administrator-pinned hardware provider (production
   default: `Microsoft Platform Crypto Provider`). The same certificate proves
   direct mTLS identity and signs checkpoints.
2. Normal platform certificate-chain validation and exact SHA-256 pins for both
   the broker certificate and its DER SubjectPublicKeyInfo must succeed. A
   proxy header is never a signer or broker identity.
3. The service presents its last locally accepted cursor, event hash, and
   checkpoint-manifest hash. The broker returns at most the configured number
   of task-event rows after that exact head, including the exact canonical UTF-8
   material produced by PostgreSQL for each existing v1 event hash.
4. The signer rejects a broker rollback or fork, a non-monotonic cursor,
   unsupported integrity version, broken `previousHash` link, or any event whose
   SHA-256 does not match its exact canonical material.
5. It signs one sorted, versioned canonical JSON manifest binding the prior
   checkpoint, cursor range, prior and terminal event hashes, event count,
   SHA-256 of the newline-joined canonical materials, signer key ID, and bounded
   issue/expiry timestamps. ES256 signatures use fixed 64-byte IEEE P1363 form.
6. A write-through, hash-chained local journal records the exact manifest and
   signature before submission. A lost acknowledgement replays those exact
   bytes; it never re-signs or advances locally until the broker acknowledges
   that checkpoint ID. Restart reconstructs and verifies the entire local
   chain. A conflicting pending or accepted head fails closed.
7. The backend independently requires the configured client-CA chain,
   authenticates and pins the live client
   certificate, verifies the exact signature, re-reads the database canonical
   material, verifies every event link/hash and the checkpoint lifetime, then
   appends one immutable checkpoint row. An exact previously verified receipt
   is idempotent. Different bytes, a stale head, rollback, fork, expiry, or key
   mismatch are rejected.

The shared protected `supervisor\DISABLED` file prevents fetching, signing, and
submission. If it appears after the journaled signature but before submission,
the pending exact checkpoint remains locally durable for later reconciliation;
no alternative checkpoint can be signed over that head. The backend's separate
audit-signer kill-switch configuration independently stops both channel APIs.

## Deployment boundary

The MSI installs the service demand-start with a restricted service SID and only
`SeChangeNotifyPrivilege`. Its configuration is readable only through
`config\audit-signer`; only its service SID and SYSTEM can modify
`supervisor\audit-signer`. It has no recovery-vault or secret-vault access, and
the companion cannot control its service DACL.

This repository does **not** create or attest a real TPM key, issue the signer
certificate, enroll its backend certificate/SPKI pins, Authenticode-sign the
service, prove measured boot, or attest the deployed machine and service image.
Those are external deployment ceremonies. Production must provision a
non-exportable hardware key and client-auth certificate, independently record
its certificate and SPKI SHA-256 values in the broker's protected configuration,
pin the broker certificate/SPKI in the local protected configuration, verify
the Authenticode/MSI chain, and retain device/TPM/deployment attestation outside
model control. Until those proofs exist, keeping the service stopped and the
kill switch present is the only truthful state.

The file journal is tamper-evident and ACL-isolated but is not itself a TPM
monotonic counter or remote witness. Its accepted heads become rollback-resistant
only when the independently pinned backend has appended the signed checkpoint;
stronger offline rollback resistance requires an externally provisioned TPM
NV counter or equivalent deployment-owned witness.
