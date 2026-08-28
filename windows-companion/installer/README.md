# Signed Windows installer and release gate

This directory contains the production-oriented packaging boundary for the
Msaidizi Windows companion. It produces an x64, per-machine WiX Toolset 7.0.0
MSI for the companion service, standard-user tray agent, update supervisor,
recovery supervisor, trusted audit signer, independent egress supervisor, and
independent privileged-command supervisor. A built MSI is only a **release
candidate**. The signed VM
gate in this directory accepts only installer mechanics and fail-closed
bootstrap behavior; it never makes the autonomous companion production-ready.

The installer deliberately starts safe:

- binaries are self-contained .NET 8 `win-x64` publishes installed beneath
  `%ProgramFiles%\Itemba\Msaidizi Companion`;
- configuration is installed once beneath
  `%ProgramData%\Itemba\Msaidizi\config` and is preserved on upgrade and
  uninstall;
- the companion service is automatic-delayed but is not started by MSI and its
  shipped configuration has ERP/host execution, broker polling, session bridge,
  local secret provisioning, and every capability disabled;
- the update, recovery, and audit supervisors are demand-start and a protected
  `%ProgramData%\Itemba\Msaidizi\supervisor\DISABLED` kill-switch file is
  created before the MSI can complete;
- the egress and privileged-command supervisors are automatic, non-delayed
  dependencies of the delayed companion. Their preserved configurations are
  disabled and contain no usable driver, signing-key, device, or
  live-enforcement claim, so dependency startup remains non-accepting until
  deployment-owned trust is provisioned. The privileged-command baseline has
  four purpose-specific key slots (reservation lease, pre-bind release,
  suspended-process bind acknowledgement, and terminal receipt), with distinct
  placeholder IDs/thumbprints and empty public keys; it cannot be activated by
  reusing one key or merely flipping `Enabled`;
- the tray agent is registered in the per-machine `Run` key and therefore runs
  in each interactive user's ordinary filtered token. Its manifest is
  `asInvoker`, its shipped configuration is disabled, and it never receives an
  elevation trigger;
- all six Windows services use restricted service SIDs and explicit required
  privilege lists. The installer-only helper applies service DACLs after
  `InstallServices` so the companion service cannot control any supervisor;
- no inbound listener, URL reservation, or firewall allow rule is authored.
  Seven exact-program inbound block rules are created fail-closed.

## Layout and trust separation

`Itemba.Msaidizi.Installer.Hardening.exe` runs as a deferred, non-impersonated
custom action only after the services exist. It validates that the binary and
data roots are the exact canonical Program Files and ProgramData locations,
rejects reparse-point roots, creates the local
`Itemba Msaidizi Recovery Operators` group, applies protected ACLs, writes the
kill switch, and creates the seven block rules. It never removes a file,
directory, group, journal, configuration, vault, key, or certificate. During
uninstall it removes only firewall rules whose name and executable path both
match this package.

ProgramData ACLs are intentionally split:

- `config\service`, `config\agent`, `config\update`, `config\recovery`,
  `config\audit-signer`, `config\egress-supervisor`, and
  `config\privileged-command-supervisor` have distinct readers and
  deployment/SYSTEM writers;
- `journal`, `supervisor\result-cache`, and the dedicated
  `supervisor\privileged-command-isolation` replay root are writable only by
  the main service SID (plus SYSTEM); recovery operators receive audit read
  access, and the replay ledger never stores commands, tokens, output, or raw
  secrets;
- `supervisor\update`, `supervisor\recovery`, and `supervisor\audit-signer` are
  writable only by their matching supervisor service SID (plus SYSTEM);
- `supervisor\egress-supervisor` and
  `supervisor\privileged-command-supervisor` contain the independent
  hash-chained lifecycle journals. Only the matching restricted service SID
  and SYSTEM can mutate each root; neither supervisor can write the companion
  replay ledgers, the other supervisor's state, or autonomous-update state;
- `supervisor\recovery-vault` is shared only between the main service and
  recovery supervisor; `supervisor\secret-vault` is writable only by the main
  service and readable by the egress supervisor so it can unwrap the exact
  destination-scoped credential immediately before supervised TLS use. The
  active signed destination policy pins the exact unopened DPAPI v2 record
  SHA-256, so Companion-side record replacement cannot silently rotate an
  active credential; rotation requires a new record and trusted policy/config
  repin;
- `supervisor\secret-provisioning` contains only the hash-chained, secret-free
  provisioning audit; the main service may append and recovery operators may
  read, but operators have no access to `supervisor\secret-vault`;
- `supervisor\identity`, `application-versions`, quarantine, and package staging
  each receive the minimum declared service access; and
- the supervisor root, kill switch, recovery vault, secret vault, provisioning
  audit, journals, and configuration remain after normal uninstall.

Local Administrators can always take ownership by using Windows recovery
mechanisms, but the running restricted service tokens do not inherit
administrator write access: access must also be granted to the exact service
SID.

The installer does not create or bless production signing keys. Activation
must provision two distinct egress keys and all four distinct
privileged-command purpose keys in the TPM-backed Microsoft Platform Crypto
Provider, with non-exportable private keys and matching public-only Companion
pins. Isolation activation also provisions purpose-distinct, public-only
`LocalMachine\TrustedPeople` P-256 certificate/SPKI pins for the broker action
token and the signed native driver attestation; neither verifier certificate
may carry a private key. Each CNG private-key object must remain SYSTEM-owned with a protected
DACL containing exactly one explicit `GENERIC_ALL` ACE for its owning
supervisor service SID—no SYSTEM, Companion, administrator, or other-supervisor
DACL grant. The signed deployment-evidence checks remain blocked until an
external verifier proves those bindings and the live native enforcement; the
MSI baseline and service presence are not that proof.

## Release workflow

1. In a protected release-policy change, provision the exact pipeline/release
   signer thumbprints, VM, operational, and ring signer allowlists, .NET host
   SHA-256, and SBOM Tool SHA-256. Put the pipeline signer thumbprint and the
   resulting exact `release-policy.json` SHA-256 into **all three** entry scripts, review them, and
   Authenticode-sign/timestamp the entry scripts and `Release.Common.psm1` in
   the controlled signing process. The repository defaults are deliberate
   `PROVISIONING_REQUIRED`/empty values and cannot create a release.
2. Before launching any entry script, trusted CI, WDAC/UMCI, or a separate
   verifier outside the PowerShell process must validate the entry script
   against an independently pinned organizational signer or exact script hash.
   Starting a script and relying on its later self-check is circular and is not
   an accepted trust bootstrap.
3. Provision the prerequisites listed below as environment variables or
   explicit parameters, and launch the signed constructor from PowerShell Core
   7.4 or newer in the 7.x release line. Windows PowerShell 5.1 is rejected
   before source verification or candidate creation.
4. Run `scripts/New-SignedReleaseCandidate.ps1 -Version 1.2.3`. Before creating
   any candidate directory it runs the hash-pinned protected source verifier:
   exact SDK and formatting, Release builds, the complete Windows solution and
   installer-hardening xUnit test sets, Roslyn-required security checks,
   installer/release authoring checks, and the dynamic bootstrap, path,
   tool-trust, and operational-evidence policy harnesses.
   It then restores from committed lock files, publishes reproducibly, signs every previously
   unsigned PE and staged PowerShell script, verifies every signature, compiles
   and signs the MSI, runs WiX's stock Windows Installer SDK ICE/schema
   validation with pedantic diagnostics and all warnings fatal, performs NuGet
   vulnerability and Microsoft Defender scans, generates and validates an SPDX
   SBOM, and writes a hash manifest.
5. Boot a newly created Windows 11 x64 VM from the approved clean template,
   provision a short-lived evidence-signing certificate, copy the candidate,
   and run `vm/Invoke-MsaidiziVmAcceptance.ps1`. The caller must provide unique
   orchestration-issued VM run and clean-snapshot identifiers.
6. Export the JSON and detached CMS evidence, then destroy the VM or revert it
   to the exact approved clean source snapshot. The external VM orchestrator—not
   the guest—must emit and detached-CMS-sign a disposition record matching
   `vm/vm-disposition.schema.json`.
7. Run `scripts/Approve-SignedRelease.ps1` against the exact candidate, guest
   evidence, and orchestrator disposition. It writes
   `installer-vm-accepted.json` with status
   `INSTALLER_VM_ACCEPTED_AWAITING_OPERATIONAL_COMPANION_ACCEPTANCE` and
   `productionDeploymentEligible: false`.
8. Run the separately isolated operational acceptance matrix and emit a record
   matching `operational/operational-acceptance.schema.json`, detached-CMS
   signed by an allowlisted operational evidence identity.
9. Progress sequentially through ring 0, 5%, 25%, and 100%, then emit a record
   matching `operational/ring-acceptance.schema.json`, signed by a distinct
   allowlisted ring evidence identity.
10. Run `scripts/Approve-OperationalRelease.ps1` with the real provider-contract
    attestation, P-256 public key, and reviewed contract-document paths. The
    script uses the read-only verifier embedded in the exact signed candidate
    to verify those bytes, their signature/SPKI/digests and strict claims, the
    pinned Anthropic API origin, and validity across operational checks, every
    ring, and approval time. It cross-checks the result against CMS-signed
    operational evidence, then verifies the remaining release bindings,
    signatures, freshness, closed check sets, zero failure counters, immutable
    artifacts, ring populations, minimum health windows, and sequential timing
    before writing signed `production-accepted.json` with the provider binding.

This VM suite covers MSI integrity/signatures, Windows prerequisites, service
installation/start policy, disabled configuration, standard-user agent startup,
ACL/service-DACL separation, inbound firewall blocks, no listener, and
uninstall preservation. It does **not** cover device pairing/outbound mTLS,
signed action dispatch, live host/ERP mutation matrices, ledger reconciliation,
restart/reconnect/replay/idempotency, pause/cancel races, unknown outcomes,
recovery execution, kill-switch fleet drills, or ring rollout/rollback. Those
operational and ring tests remain red until the separate evidence defined in
`operational/` is produced and `Approve-OperationalRelease.ps1` accepts it.

The candidate and approval scripts are fail-closed. There are no `-SkipSign`,
`-SkipScan`, `-SkipSbom`, or `-SkipVm` switches.

Each externally signed entry script embeds the exact SHA-256 of
`release-policy.json` and the pipeline signer. It hashes the policy bytes before
parsing any fields, refuses a policy-signer mismatch, and then uses only the
built-in, fully qualified Authenticode command to validate the common module.
The module is held open without write/delete sharing from validation through
`Import-Module`, closing the local swap window. Caller-supplied release, VM,
orchestrator, and SBOM identities/hashes are assertions only: each must equal
the value or allowlist in the authenticated policy. They are never roots of
trust.

Changing any policy byte requires updating the embedded digest in all three
entry scripts and re-signing/timestamping them through the external ceremony. Merely
changing the policy, passing a different thumbprint/hash, or importing the
module manually cannot produce an accepted candidate.

## External prerequisites

- Windows 11 x64 build host and guest, NTFS, TPM 2.0, and an actual disposable
  Hyper-V/enterprise-VM lifecycle outside this repository.
- .NET SDK 8.0.400, matching `windows-companion/global.json`.
  `dotnet.exe` must have a valid Microsoft Authenticode chain and its exact
  SHA-256 must equal the authenticated-policy value. The SDK version must also
  report exactly 8.0.400; locked restore hashes bind all NuGet/WiX packages.
- WiX Toolset SDK 7.0.0 (restored from the pinned `.wixproj` and lock file).
- A recorded WiX 7 OSMF/legal determination by an authorized organization
  representative. WiX 7 compilation remains blocked unless the representative
  supplies all four release-build environment values:
  `MSAIDIZI_WIX7_EULA_ACCEPTED_BY_AUTHORIZED_ORG=wix7`,
  `MSAIDIZI_WIX7_AUTHORIZED_ACTOR`,
  `MSAIDIZI_WIX7_ACCEPTED_AT_UTC`, and
  `MSAIDIZI_WIX7_OSMF_COMPLIANCE_REFERENCE`. The pipeline passes
  `AcceptEula=wix7` only after validating that attestation. It never accepts the
  terms on behalf of a developer or organization. See `TOOLCHAIN.md` for the
  supported-alternative analysis.
- Windows SDK `signtool.exe`.
- A non-exportable organizational code-signing certificate with private key,
  a reachable RFC 3161 timestamp service, and a configured expected signer
  thumbprint.
- Microsoft SBOM Tool 4.1.5. Its Microsoft Authenticode signature, reported
  version, and exact authenticated-policy SHA-256 are all verified. A supplied
  hash is accepted only when it equals that protected value.
- Microsoft Defender enabled with real-time protection and definitions no more
  than 24 hours old. Signature update, candidate scan, and final MSI scan must
  all succeed.
- NuGet audit/vulnerability data access during the locked restore and package
  scan.
- A separate short-lived VM-evidence signing certificate and a third,
  allowlisted VM-orchestrator attestation certificate. The approval gate
  validates both chains and exact thumbprints. Neither is the release signer,
  companion device key, or update/recovery signing key.
- Distinct allowlisted operational-acceptance and ring-acceptance signing
  certificates. Neither may reuse the pipeline, release, VM, orchestrator,
  companion-device, update, recovery, or audit signing identity.
- A canonical provider-contract attestation signed with a separately managed
  P-256 key, that public key as a detached PEM artifact, and the exact reviewed
  contract-document bytes, each supplied as a distinct single-link file on a
  canonical local path whose exact casing matches the path derived from the
  opened handle. Each file identity, metadata, and single-link count must remain
  stable through its bounded read. The claims must name
  `https://api.anthropic.com`, the deployed API account and complete sorted
  model scope, all reviewed data classes, zero training, zero provider
  retention, and `urn:sha256:<contract-document-sha256>`, with validity long
  enough to cover operational testing, every rollout ring, and final approval.
- Human review and external enrollment of device mTLS, action-verification,
  update-bootstrap, recovery-verification, and audit-signer hardware-backed
  identities. The installer does not generate, import, attest, or remove those
  identities.
- A separately signed and enrolled WFP boundary driver/service, independent
  boundary-supervisor key, WebView2 broker measurement, and the staged evidence
  in `../docs/EGRESS-BOUNDARY.md` are required before raw-command or browser
  external-effect flags may be enabled. The installer ships neither a fake
  boundary nor an enabling attestation.

## Read-only production-prerequisite inventory

`scripts/Test-ProductionPrerequisites.ps1` emits a secret-free, read-only JSON
inventory for release operators. Select one or more scopes, or use `All` to
expand to all four:

- `BuildHost` checks Windows 11 x64, the ProgramData NTFS volume, ready TPM 2.0,
  Secure Boot, HVCI, complete release-policy provisioning, policy-bound and
  Authenticode-valid release entry points, pinned tools, Defender, the release
  certificate and signing-key attestation, HTTPS timestamp configuration, WiX
  legal-attestation inputs, and a clean committed `windows-companion` tree.
- `VmHost` checks for protected VM lifecycle control and clean-template
  evidence. Local Hyper-V or an Authenticode-valid orchestrator pinned by the
  release policy is required.
- `Operational` inventories the provider-contract artifacts, independently
  enforced egress and trusted-root boundaries, enrolled-device evidence,
  installer-VM approval, and operational acceptance inputs.
- `Rollout` inventories staged-ring and final production-acceptance inputs.

For example, after replacing the illustrative paths and provisioning the WiX
legal-attestation environment values described above:

```powershell
pwsh -NoProfile -File .\scripts\Test-ProductionPrerequisites.ps1 `
  -Scope BuildHost `
  -DotNetPath 'C:\release-tools\dotnet.exe' `
  -SignToolPath 'C:\release-tools\signtool.exe' `
  -SbomToolPath 'C:\release-tools\sbom-tool.exe' `
  -DefenderCommandPath 'C:\release-tools\MpCmdRun.exe' `
  -TimestampUri 'https://timestamp.example.invalid/' `
  -SigningKeyAttestationPath 'C:\release-evidence\signing-key-attestation.json'
```

The script writes one compressed JSON object to standard output. It does not
emit supplied paths, certificate subjects or thumbprints, environment values,
provider claims, document contents, or command output. Its artifact probes
accept only canonical local files, reject UNC/device/alternate-data-stream and
reparse-point paths, cap each input at 64 MiB, and report only presence, byte
count, and SHA-256. General claim probes perform bounded shape checks; the two
enforcement-deployment probes additionally require exact detached-CMS signer
verification, closed live-enforcement claims, and freshness. Those
results are deliberately marked
`NON_AUTHORITATIVE_READ_ONLY_INVENTORY` and never replace Authenticode, detached
CMS, provider-contract, VM-disposition, operational, ring, or deployment
verification by the externally trusted gates.

Exit code `0` means only that every input selected by the requested scopes was
present and passed this inventory. The JSON still reports
`productionDeploymentEligible: false` and state
`INPUT_SET_COMPLETE_REQUIRES_AUTHORITATIVE_SIGNED_GATES`. Exit code `2` means
one or more checks are `BLOCKED`; inspect their stable `reasonCode` values.

The current source contains the typed supervisor-consumed egress flow path and
the configured named-pipe privileged-command isolation client while retaining
safe rejecting fallbacks for disabled or incomplete configuration. Those source
checks are labelled `sourceInventoryOnly` and are never deployment proof.
Repository defaults still make `Operational` and `All` exit `2`: both separate
deployment checks require real, fresh, detached-CMS-signed evidence of the
measured native enforcement described in `operational/README.md`. Supplying an
unsigned JSON file, installing a service, or removing a rejecting fallback
cannot satisfy either gate. Each supervisor claim's canonical `vmRunId` must
also match `installer-vm-accepted.json.vmEvidence.runId` from the exact
release-signed installer approval; a free-standing signer-provided run ID or
an operator-supplied expected-run value cannot satisfy that binding.

No signed release, legal attestation, VM-acceptance evidence, or VM-disposition
evidence is committed here. Absence of any external identity or proof correctly
leaves the release gate red.

The WiX MSBuild SDK automatically runs its `WindowsInstallerValidation` target
with the stock MSI SDK ICEs when `SuppressValidation` is false. The project also
enables pedantic diagnostics, treats every compiler/ICE warning as an error,
forbids warning or ICE suppression, and writes a marker only after that target
succeeds. The candidate builder forces a clean `Rebuild`, requires the marker,
and retains the full build log. Merely finding an emitted `.msi` is never enough
to continue to signing or acceptance.

## Developer checks

These checks do not create a deployable release and do not weaken production
gates:

The protected source verifier runs this complete set automatically. The
individual commands remain useful for focused diagnosis.

```powershell
dotnet test .\tests\Itemba.Msaidizi.Installer.Hardening.Tests\Itemba.Msaidizi.Installer.Hardening.Tests.csproj -c Release
powershell -NoProfile -File .\scripts\Test-InstallerStatic.ps1
powershell -NoProfile -File .\scripts\Test-ReleaseBootstrapPolicy.ps1
powershell -NoProfile -File .\scripts\Test-ReleasePathPolicy.ps1
powershell -NoProfile -File .\scripts\Test-ReleaseToolTrustPolicy.ps1
powershell -NoProfile -File .\scripts\Test-OperationalEvidencePolicy.ps1
```

`Test-InstallerStatic.ps1` verifies WiX schema/version pins, service start and
SID policy, permanent disabled configuration, uninstall preservation,
firewall-only removal, release gates, bootstrap ordering/substitution cases,
and the absence of destructive helper APIs.
`Test-ReleaseBootstrapPolicy.ps1` exercises the real pre-import entry-script
path against unsigned, tampered, wrong-signer, tampered-policy,
policy-signer-substitution, and caller-signer-substitution fixtures, using an
already trusted/timestamped Windows module only as the signed test fixture.
`Test-ReleasePathPolicy.ps1` creates uniquely named temporary fixtures and
proves junction/reparse rejection, exact same-volume layout checks, hard-link
refusal, and locked-handle removal of only the exact staged configuration.
`Test-ReleaseToolTrustPolicy.ps1` exercises the shared production hash gate for
exact matches, caller substitution, unprovisioned policy, and post-pin byte
changes. The dynamic scripts intentionally retain their fixture directories
for inspection. None of these tests claims production entry-script trust,
Authenticode release evidence, Defender, SBOM, MSI, or VM evidence.
`Test-OperationalEvidencePolicy.ps1` exercises the second-stage verifier with
disposable unsigned fixtures and ephemeral P-256 test keys: the exact semantic
pass plus non-zero counters, missing checks, reordered rings, insufficient
health windows, release-binding mismatch, unbound artifacts, provider binding
substitution, provider-check misbinding, API-origin substitution, and actual
public-key/document byte tampering. Its CMS functions are explicitly stubbed;
an additional case proves post-approval unreviewed candidate files are
rejected. The fixture document labels itself non-legal test material, and the
harness proves validation behavior without creating release, legal, or ring
evidence.
