# Local secret-vault provisioning

Secret creation, rotation, and deletion are deliberately outside the broker,
model, task-token, and host-capability namespaces. The only entry point is the
standard-user tray command **Manage local secrets**, connected to a separately
enabled LocalSystem named pipe. There is no secret provisioning CLI, HTTP
route, broker DTO, environment variable, or configuration value.

## Trust and confirmation flow

1. Deployment configures an allowlisted binding in the LocalSystem service:
   stable binding ID, display name, secret kind, exact human-readable
   destination, the capability-specific destination SHA-256, and the exact
   capability IDs allowed to consume it. The binding catalog is never supplied
   by a task or model.
2. The service pipe denies network logons and authenticates the kernel-reported
   tray PID, interactive user SID, active console session, and exact signed
   Agent executable SHA-256. It also verifies that it is LocalSystem and that
   the vault/audit directories have no broad write ACE.
3. The tray verifies the pipe server PID is session-zero LocalSystem, then
   verifies a paired device-certificate signature and an exact certificate
   thumbprint. A purpose-separated P-256 ECDH transcript derives the session
   key; monotonic sequence numbers and HMAC authenticate every frame.
4. The LocalSystem service returns the exact operation, destination, scope
   digest, reference, and capabilities. The user must check an explicit local
   confirmation box on that preview. Prose in chat cannot select or escalate
   this mode.
5. For create/rotate, the next local dialog captures keystrokes directly into
   `SecureString`; clipboard paste is disabled and no plaintext `TextBox` or
   managed `string` is created. A temporary UTF-8 buffer is AES-GCM encrypted
   for the authenticated pipe and then zeroed in both processes.
6. The service appends a hash-chained `prepared` audit record before mutation
   and a terminal record after it. Records contain caller/process attribution,
   exact operation/scope/capability digests, result metadata, and no plaintext
   or ciphertext. Exact completed request replay returns the prior metadata;
   an interrupted prepared request is refused as uncertain rather than
   repeated.

The global kill switch is checked before the confirmation challenge and again
inside the journaled mutation boundary. When engaged, no create, rotation, or
deletion is performed.

## Persistence and deletion semantics

Vault records are binary, versioned, and protected with Windows DPAPI using
`CRYPTPROTECT_LOCAL_MACHINE | CRYPTPROTECT_UI_FORBIDDEN`. Machine scope is
required so LocalSystem can recover the record across service/profile restart;
it is **not** an authorization boundary by itself. Any local principal that can
read the ciphertext may be able to ask DPAPI to decrypt it. Therefore the
installer gives `supervisor\secret-vault` SYSTEM/Companion provisioning access
and the restricted Egress Supervisor service SID read-only access; the service
rechecks owner/DACL safety before opening the provisioning pipe. Recovery
operators have read-only access to the
separate, secret-free `supervisor\secret-provisioning` audit journal and no
secret-vault access.

An active egress destination policy pins `CredentialRecordSha256`, the exact
SHA-256 of the unopened DPAPI-protected v2 record bytes. Egress checks that pin
in fixed time before DPAPI unprotect and includes it in trusted destination
policy and exact-request policy. It is intentionally not embedded in the
record's own destination scope, which would create a circular hash dependency.
Companion provisioning access therefore cannot substitute
a different credential under an active policy; rotation becomes active only
after a trusted policy/configuration repin. The Egress Supervisor has no create,
rotate, or delete API.

The activation order is fixed: first provision the v2 record against the
already canonical endpoint/reference destination scope, then hash the exact
unopened DPAPI ciphertext bytes, and finally repin the trusted destination
policy plus Companion endpoint configuration with that digest. Recomputing the
destination scope from the ciphertext digest is forbidden.

Rotation atomically replaces the same opaque UUID reference and increments its
version. Delete first removes the authoritative record name atomically, then
deletes its DPAPI ciphertext; a deletion failure is rolled back when possible
or reported as an uncertain outcome. Raw secret bytes never enter result JSON,
logs, journals, task artifacts, memory, or clipboard.

## Provisioning configuration

Both packaged sections ship `Enabled: false`, with empty certificate pins,
agent hashes, and bindings. A deployment-owned ceremony must enroll the device,
pin the exact installed Agent digest and device certificate, calculate the
same destination digest used by the consuming capability contract, install
the protected ACLs, and only then enable both sides. For example:

```json
{
  "SecretProvisioning": {
    "Enabled": true,
    "PipeName": "Itemba.Msaidizi.SecretProvisioning.v1",
    "AllowedAgentExecutableSha256": "<64 lowercase hex>",
    "AuditJournalPath": "%ProgramData%\\Itemba\\Msaidizi\\supervisor\\secret-provisioning\\audit.jsonl",
    "MaximumFrameBytes": 1048576,
    "ConfirmationTtlSeconds": 120,
    "RequireActiveConsoleSession": true,
    "Bindings": [
      {
        "BindingId": "finance-login",
        "DisplayName": "Finance portal login",
        "Kind": "browser-credential",
        "Destination": "https://finance.example.test/login",
        "DestinationScopeSha256": "<capability-specific 64 lowercase hex>",
        "AllowedCapabilities": ["browser.form.secret.set"]
      }
    ]
  }
}
```

The tray-side section additionally pins the service certificate and keeps a
DPAPI-protected, non-secret idempotency record:

```json
{
  "SecretProvisioning": {
    "Enabled": true,
    "PipeName": "Itemba.Msaidizi.SecretProvisioning.v1",
    "ServiceCertificateThumbprint": "<enrolled certificate thumbprint>",
    "ServiceCertificateStoreName": "My",
    "ServiceCertificateStoreLocation": "LocalMachine",
    "ConnectTimeoutSeconds": 15,
    "MaximumFrameBytes": 1048576,
    "PendingRequestPath": "%LocalAppData%\\Itemba\\Msaidizi\\secret-provisioning\\pending.bin"
  }
}
```

`PendingRequestPath` stores only the request identity, operation, binding ID,
opaque vault reference, and creation time. It contains no secret, ciphertext,
destination text, or capability data. Keeping the same request ID across tray
restarts makes a lost result an idempotent replay instead of a second mutation.

The repository cannot prove that a production certificate is hardware-backed,
that the installed binary really matches organizational signing policy, or
that WDAC/installer ACLs remain enforced on an employee workstation. Those are
external deployment-attestation and ring-acceptance requirements.
