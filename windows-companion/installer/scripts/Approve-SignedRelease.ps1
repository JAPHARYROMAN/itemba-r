[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$CandidatePath,
    [Parameter(Mandatory)][string]$VmEvidencePath,
    [Parameter(Mandatory)][string]$VmEvidenceSignaturePath,
    [Parameter(Mandatory)][string]$VmDispositionPath,
    [Parameter(Mandatory)][string]$VmDispositionSignaturePath,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F-]{36}$')][string]$ExpectedVmRunId,
    [Parameter(Mandatory)][string]$ExpectedVmEvidenceSignerThumbprint,
    [Parameter(Mandatory)][string]$ExpectedVmOrchestratorSignerThumbprint,
    [Parameter(Mandatory)][string]$ReleaseSigningCertificateThumbprint,
    [Parameter(Mandatory)][string]$SignToolPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# SECURITY BOUNDARY: A trusted CI bootstrap, WDAC policy, or equivalent external
# verifier must validate this entry script before PowerShell parses/executes it.
# In-process self-verification cannot establish trust in an already-running file.
$embeddedPipelineSignerThumbprint = 'PROVISIONING_REQUIRED'
$embeddedReleasePolicySha256 = '2F58E627B61FF938663A91481E33E485486CE68D120438969F19202FC0BCD8B2'
$installerRoot = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot, '..'))
$policyPath = [IO.Path]::Combine($installerRoot, 'release-policy.json')
$policyBytes = [IO.File]::ReadAllBytes($policyPath)
$policyHasher = [Security.Cryptography.SHA256]::Create()
try {
    $actualReleasePolicySha256 = [BitConverter]::ToString($policyHasher.ComputeHash($policyBytes)).Replace('-', '')
}
finally {
    $policyHasher.Dispose()
}
if ($actualReleasePolicySha256 -cne $embeddedReleasePolicySha256) {
    throw 'release-policy.json differs from the exact digest embedded in this externally signed entry script.'
}
$policy = [Text.Encoding]::UTF8.GetString($policyBytes) | Microsoft.PowerShell.Utility\ConvertFrom-Json
$pinnedPipelineSigner = ([string]$policy.trust.pipelineSignerThumbprint -replace '\s', '').ToUpperInvariant()
$pinnedReleaseSigner = ([string]$policy.trust.releaseSignerThumbprint -replace '\s', '').ToUpperInvariant()
if ($embeddedPipelineSignerThumbprint -notmatch '^[0-9A-F]{40}$' -or
    $pinnedPipelineSigner -cne $embeddedPipelineSignerThumbprint -or
    $pinnedPipelineSigner -notmatch '^[0-9A-F]{40}$' -or $pinnedReleaseSigner -notmatch '^[0-9A-F]{40}$') {
    throw 'Protected release-policy.json must pin real pipeline and release signer thumbprints before acceptance.'
}
$requestedReleaseSigner = ($ReleaseSigningCertificateThumbprint -replace '\s', '').ToUpperInvariant()
if ($requestedReleaseSigner -ne $pinnedReleaseSigner) {
    throw 'Caller-controlled release signer substitution was refused by protected policy.'
}
$requestedVmSigner = ($ExpectedVmEvidenceSignerThumbprint -replace '\s', '').ToUpperInvariant()
$requestedOrchestratorSigner = ($ExpectedVmOrchestratorSignerThumbprint -replace '\s', '').ToUpperInvariant()
$allowedVmSigners = @($policy.trust.allowedVmEvidenceSignerThumbprints | ForEach-Object { ([string]$_ -replace '\s', '').ToUpperInvariant() })
$allowedOrchestratorSigners = @($policy.trust.allowedVmOrchestratorSignerThumbprints | ForEach-Object { ([string]$_ -replace '\s', '').ToUpperInvariant() })
if ($requestedVmSigner -notin $allowedVmSigners -or $requestedOrchestratorSigner -notin $allowedOrchestratorSigners) {
    throw 'Caller-controlled VM evidence/orchestrator signer substitution was refused by protected policy.'
}
$modulePath = [IO.Path]::Combine($PSScriptRoot, 'Release.Common.psm1')
$moduleReadLock = [IO.File]::Open($modulePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
    $moduleSignature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $modulePath
    if ($moduleSignature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
        -not $moduleSignature.SignerCertificate -or -not $moduleSignature.TimeStamperCertificate -or
        ($moduleSignature.SignerCertificate.Thumbprint -replace '\s', '').ToUpperInvariant() -ne $embeddedPipelineSignerThumbprint) {
        throw 'Release.Common.psm1 is unsigned, tampered, expired/untrusted, untimestamped, or signed by the wrong embedded pipeline identity.'
    }
    Microsoft.PowerShell.Core\Import-Module $modulePath -Force
}
finally {
    $moduleReadLock.Dispose()
}
Assert-WindowsReleaseHost
$releaseThumbprint = Normalize-Thumbprint -Thumbprint $pinnedReleaseSigner
$vmSignerThumbprint = Normalize-Thumbprint -Thumbprint $ExpectedVmEvidenceSignerThumbprint
$orchestratorThumbprint = Normalize-Thumbprint -Thumbprint $ExpectedVmOrchestratorSignerThumbprint
if (@(@($releaseThumbprint, $vmSignerThumbprint, $orchestratorThumbprint) | Select-Object -Unique).Count -ne 3) {
    throw 'Release, VM-evidence, and VM-orchestrator signing identities must be distinct.'
}
Assert-TrustedPipelineScript -Path $PSCommandPath -ExpectedThumbprint $pinnedPipelineSigner
Assert-TrustedPipelineScript -Path $modulePath -ExpectedThumbprint $pinnedPipelineSigner
$signTool = Assert-MicrosoftSignedTool -Path $SignToolPath -Description 'Windows SDK SignTool'
$releaseCertificate = Get-ExactSigningCertificate -Thumbprint $releaseThumbprint

$candidateRoot = Resolve-ExistingDirectoryPath -Path $CandidatePath -Description 'release candidate'
$manifestPath = Join-Path $candidateRoot 'release-manifest.json'
$manifestSignaturePath = "$manifestPath.p7s"
Assert-DetachedCmsSignature -ContentPath $manifestPath -SignaturePath $manifestSignaturePath -ExpectedThumbprint $releaseThumbprint | Out-Null
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | Microsoft.PowerShell.Utility\ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or $manifest.status -ne 'AWAITING_SIGNED_DISPOSABLE_VM_ACCEPTANCE') {
    throw 'Candidate manifest does not have the supported pending-acceptance state.'
}
if ([string]$manifest.codeSigningThumbprint -ne $releaseThumbprint) {
    throw 'Candidate manifest code signer is not the expected release identity.'
}
Assert-ManifestInventory -Root $candidateRoot -Manifest $manifest

$manifestPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($entry in @($manifest.files)) { [void]$manifestPaths.Add([string]$entry.path) }
$actualCandidateFiles = @(Get-ChildItem -LiteralPath $candidateRoot -Recurse -File | ForEach-Object {
    $_.FullName.Substring($candidateRoot.Length + 1).Replace('\', '/')
} | Where-Object { $_ -notin @('release-manifest.json', 'release-manifest.json.p7s') })
if ($actualCandidateFiles.Count -ne $manifestPaths.Count) {
    throw 'Candidate contains missing or unmanifested files before approval.'
}
foreach ($relative in $actualCandidateFiles) {
    if (-not $manifestPaths.Contains($relative)) { throw "Unmanifested candidate file: $relative" }
}

$msiPath = Join-Path $candidateRoot (([string]$manifest.msi.path) -replace '/', '\')
$msiPath = (Get-Item -LiteralPath $msiPath -Force -ErrorAction Stop).FullName
if ((Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $msiPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne ([string]$manifest.msi.sha256).ToLowerInvariant()) {
    throw 'MSI hash differs from the signed candidate manifest.'
}
Assert-AuthenticodeArtifact -SignToolPath $signTool -Path $msiPath -ExpectedThumbprint $releaseThumbprint -RequireTimestamp
foreach ($entry in @($manifest.files)) {
    if ([IO.Path]::GetExtension([string]$entry.path) -in '.exe', '.dll', '.sys', '.ps1', '.psm1', '.psd1', '.msi') {
        $artifactPath = Join-Path $candidateRoot (([string]$entry.path) -replace '/', '\')
        Assert-AuthenticodeArtifact -SignToolPath $signTool -Path $artifactPath
    }
}

$requiredReleaseEvidence = @(
    'evidence/defender-payload.log',
    'evidence/defender-candidate.log',
    'evidence/defender-msi.log',
    'evidence/defender-status.json',
    'evidence/sbom-generate.log',
    'evidence/sbom-validate.log',
    'evidence/sbom-validation.json',
    'evidence/wix-msi-validation.txt',
    'evidence/nuget-vulnerabilities-Msaidizi.Companion.Service.json',
    'evidence/nuget-vulnerabilities-Msaidizi.Companion.Agent.json',
    'evidence/nuget-vulnerabilities-Msaidizi.UpdateSupervisor.json',
    'evidence/nuget-vulnerabilities-Msaidizi.RecoverySupervisor.json',
    'evidence/nuget-vulnerabilities-Msaidizi.AuditSigner.json',
    'evidence/nuget-vulnerabilities-Itemba.Msaidizi.Installer.Hardening.json'
)
foreach ($relative in $requiredReleaseEvidence) {
    if (-not $manifestPaths.Contains($relative)) { throw "Required release evidence is missing: $relative" }
}
$sbomEntries = @($manifest.files | Where-Object { ([string]$_.path) -match '^evidence/_manifest/.+\.spdx\.json$' })
if ($sbomEntries.Count -eq 0) { throw 'The signed release candidate contains no generated SPDX manifest.' }
$defenderStatus = Get-Content -LiteralPath (Join-Path $candidateRoot 'evidence\defender-status.json') -Raw -Encoding utf8 | Microsoft.PowerShell.Utility\ConvertFrom-Json
if (-not $defenderStatus.antivirusEnabled -or -not $defenderStatus.antimalwareServiceEnabled -or -not $defenderStatus.realTimeProtectionEnabled) {
    throw 'Signed release evidence does not attest an enabled Microsoft Defender state.'
}
$defenderSignatureTime = [DateTimeOffset]::Parse([string]$defenderStatus.signatureLastUpdatedUtc).ToUniversalTime()
$manifestCreated = [DateTimeOffset]::Parse([string]$manifest.createdAtUtc).ToUniversalTime()
if (($manifestCreated - $defenderSignatureTime).TotalHours -gt 24 -or $defenderSignatureTime -gt $manifestCreated.AddMinutes(5)) {
    throw 'Microsoft Defender signature time in release evidence is stale or inconsistent.'
}

$evidenceFile = Resolve-ExistingLeafPath -Path $VmEvidencePath -Description 'VM acceptance evidence'
$evidenceSignatureFile = Resolve-ExistingLeafPath -Path $VmEvidenceSignaturePath -Description 'VM acceptance signature'
Assert-DetachedCmsSignature -ContentPath $evidenceFile -SignaturePath $evidenceSignatureFile -ExpectedThumbprint $vmSignerThumbprint | Out-Null
$vmEvidence = Get-Content -LiteralPath $evidenceFile -Raw -Encoding utf8 | Microsoft.PowerShell.Utility\ConvertFrom-Json
$expectedRunGuid = [Guid]::Empty
if (-not [Guid]::TryParseExact($ExpectedVmRunId, 'D', [ref]$expectedRunGuid) -or $expectedRunGuid -eq [Guid]::Empty) {
    throw 'ExpectedVmRunId must be a non-empty canonical GUID.'
}
if ($vmEvidence.schemaVersion -ne 1 -or $vmEvidence.status -ne 'PASS_PENDING_EXTERNAL_VM_DISPOSITION' -or -not $vmEvidence.noSkippedChecks) {
    throw 'VM acceptance evidence is not a complete, unskipped pass.'
}
if ([string]$vmEvidence.evidenceScope -ne 'MSI_INSTALL_FAIL_CLOSED_BOOTSTRAP_AND_UNINSTALL_ONLY' -or
    $vmEvidence.productionDeploymentEligible -or
    [string]$vmEvidence.operationalCoverage.status -ne 'NOT_EXECUTED') {
    throw 'VM evidence scope is ambiguous or incorrectly claims operational/production acceptance.'
}
$expectedOutstandingOperationalGates = @(
    'device-pairing-and-outbound-mtls',
    'signed-action-token-dispatch-and-ledger-reconciliation',
    'typed-host-and-erp-read-write-mutation-matrix',
    'restart-reconnect-replay-and-idempotency-matrix',
    'pause-cancel-owned-process-tree-and-late-completion-races',
    'unknown-outcome-needs-attention-and-recovery-matrix',
    'kill-switch-and-autopilot-disable-drills',
    'ring0-5-25-100-rollout-and-rollback-drills'
)
if ((@($vmEvidence.operationalCoverage.outstandingGates | Sort-Object) -join '|') -ne
    (($expectedOutstandingOperationalGates | Sort-Object) -join '|')) {
    throw 'VM evidence does not preserve the complete red operational-gate set.'
}
if ([string]$vmEvidence.evidenceSignerThumbprint -ne $vmSignerThumbprint -or
    [string]$vmEvidence.vm.runId -ne $expectedRunGuid.ToString('D')) {
    throw 'VM acceptance identity or run ID mismatch.'
}
$manifestSha256 = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ([string]$vmEvidence.releaseManifestSha256 -ne $manifestSha256 -or
    [string]$vmEvidence.releaseVersion -ne [string]$manifest.version -or
    [string]$vmEvidence.sourceRevision -ne [string]$manifest.sourceRevision -or
    [string]$vmEvidence.msiSha256 -ne ([string]$manifest.msi.sha256).ToLowerInvariant()) {
    throw 'VM evidence does not bind to this exact source, manifest, version, and MSI.'
}
$evidenceCompleted = [DateTimeOffset]::Parse([string]$vmEvidence.completedAtUtc).ToUniversalTime()
$now = [DateTimeOffset]::UtcNow
if ($evidenceCompleted -gt $now.AddMinutes(5) -or
    ($now - $evidenceCompleted).TotalHours -gt [int]$manifest.requiredAcceptance.vmEvidenceMaximumAgeHours) {
    throw 'VM acceptance evidence is future-dated or too old.'
}
if (-not $vmEvidence.vm.localHypervisorEvidence -or
    [string]$vmEvidence.vm.disposition -ne 'PENDING_EXTERNAL_ORCHESTRATOR_ATTESTATION') {
    throw 'VM evidence does not truthfully report a hypervisor guest and pending external disposition.'
}
# This list must stay in step with Add-PassedCheck in the guest script (vm/Invoke-MsaidiziVmAcceptance.ps1),
# because the count is compared exactly below. It named ten checks while the guest emitted
# twelve, so the cardinality throw fired on every honest run: 'install.adversarial-preplant'
# and 'reinstall.provenance-preservation' were absent. The guest CMS-signs its evidence and
# the orchestrator hash-binds it, so this could not be worked around at ceremony time -- it
# surfaced only at approval, after the VM run and its 24-hour window had been spent.
$requiredChecks = @(
    'candidate.integrity', 'candidate.authenticode', 'vm.prerequisites',
    'install.adversarial-preplant',
    'services.install-state', 'configuration.fail-closed', 'agent.standard-integrity',
    'acl.trust-separation', 'network.inbound-blocked', 'runtime.no-listener',
    'uninstall.preservation', 'reinstall.provenance-preservation'
)
$checkIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($check in @($vmEvidence.checks)) {
    if (-not $checkIds.Add([string]$check.id)) { throw "Duplicate VM acceptance check: $($check.id)" }
    if ([string]$check.status -ne 'PASS') { throw "VM acceptance check did not pass: $($check.id)" }
}
if ($checkIds.Count -ne $requiredChecks.Count) { throw 'VM acceptance check set is incomplete or contains unreviewed checks.' }
foreach ($requiredCheck in $requiredChecks) {
    if (-not $checkIds.Contains($requiredCheck)) { throw "Required VM acceptance check is missing: $requiredCheck" }
}

$dispositionFile = Resolve-ExistingLeafPath -Path $VmDispositionPath -Description 'VM disposition attestation'
$dispositionSignatureFile = Resolve-ExistingLeafPath -Path $VmDispositionSignaturePath -Description 'VM disposition signature'
Assert-DetachedCmsSignature -ContentPath $dispositionFile -SignaturePath $dispositionSignatureFile -ExpectedThumbprint $orchestratorThumbprint | Out-Null
$disposition = Get-Content -LiteralPath $dispositionFile -Raw -Encoding utf8 | Microsoft.PowerShell.Utility\ConvertFrom-Json
if ($disposition.schemaVersion -ne 1 -or
    [string]$disposition.status -notin @('DESTROYED', 'REVERTED_TO_APPROVED_CLEAN_SNAPSHOT')) {
    throw 'VM disposition must attest destruction or reversion to the approved clean snapshot.'
}
if ([string]$disposition.vmRunId -ne $expectedRunGuid.ToString('D') -or
    [string]$disposition.provider -ne [string]$vmEvidence.vm.provider -or
    [string]$disposition.cleanTemplateId -ne [string]$vmEvidence.vm.cleanTemplateId -or
    [string]$disposition.sourceSnapshotId -ne [string]$vmEvidence.vm.snapshotId) {
    throw 'External VM disposition does not bind to the exact tested VM orchestration record.'
}
$vmEvidenceSha256 = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $evidenceFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ([string]$disposition.vmEvidenceSha256 -ne $vmEvidenceSha256) {
    throw 'External VM disposition does not bind to the signed VM evidence bytes.'
}
if ([string]::IsNullOrWhiteSpace([string]$disposition.attestationId) -or
    [string]::IsNullOrWhiteSpace([string]$disposition.proofReference)) {
    throw 'External VM disposition is missing its immutable attestation/proof reference.'
}
$disposedAt = [DateTimeOffset]::Parse([string]$disposition.disposedAtUtc).ToUniversalTime()
if ($disposedAt -lt $evidenceCompleted -or $disposedAt -gt $now.AddMinutes(5) -or
    ($now - $disposedAt).TotalHours -gt [int]$manifest.requiredAcceptance.vmEvidenceMaximumAgeHours) {
    throw 'External VM disposition time is inconsistent, future-dated, or stale.'
}
if ([string]$disposition.status -eq 'REVERTED_TO_APPROVED_CLEAN_SNAPSHOT' -and
    [string]$disposition.revertedToSnapshotId -ne [string]$vmEvidence.vm.snapshotId) {
    throw 'VM reversion was not to the exact approved clean source snapshot.'
}

$approvalPath = Join-Path $candidateRoot 'installer-vm-accepted.json'
$approvalSignaturePath = "$approvalPath.p7s"
if ((Test-Path -LiteralPath $approvalPath) -or (Test-Path -LiteralPath $approvalSignaturePath)) {
    throw 'Refusing to overwrite an existing release approval.'
}
$approval = [ordered]@{
    schemaVersion = 1
    status = 'INSTALLER_VM_ACCEPTED_AWAITING_OPERATIONAL_COMPANION_ACCEPTANCE'
    evidenceScope = 'MSI_INSTALL_FAIL_CLOSED_BOOTSTRAP_AND_UNINSTALL_ONLY'
    productionDeploymentEligible = $false
    approvedAtUtc = $now.ToString('O')
    releaseManifestSha256 = $manifestSha256
    version = [string]$manifest.version
    sourceRevision = [string]$manifest.sourceRevision
    msiSha256 = ([string]$manifest.msi.sha256).ToLowerInvariant()
    releaseSignerThumbprint = $releaseThumbprint
    vmEvidence = [ordered]@{
        sha256 = $vmEvidenceSha256
        signerThumbprint = $vmSignerThumbprint
        runId = $expectedRunGuid.ToString('D')
        completedAtUtc = $evidenceCompleted.ToString('O')
    }
    vmDisposition = [ordered]@{
        sha256 = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $dispositionFile -Algorithm SHA256).Hash.ToLowerInvariant()
        signerThumbprint = $orchestratorThumbprint
        status = [string]$disposition.status
        disposedAtUtc = $disposedAt.ToString('O')
        attestationId = [string]$disposition.attestationId
        proofReference = [string]$disposition.proofReference
    }
    gates = [ordered]@{
        exactManifestInventory = $true
        authenticodeAndTimestamp = $true
        sbomPresentAndValidated = $true
        vulnerabilityEvidencePresent = $true
        malwareEvidencePresent = $true
        vmChecksComplete = $true
        vmDispositionExternallyAttested = $true
        noSkippedChecks = $true
        operationalCompanionAcceptance = 'NOT_EXECUTED'
        productionRingAcceptance = 'NOT_EXECUTED'
        outstandingOperationalGates = $expectedOutstandingOperationalGates
    }
}
$approval | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $approvalPath -Encoding utf8
New-DetachedCmsSignature -ContentPath $approvalPath -Certificate $releaseCertificate -SignaturePath $approvalSignaturePath
Assert-DetachedCmsSignature -ContentPath $approvalPath -SignaturePath $approvalSignaturePath -ExpectedThumbprint $releaseThumbprint | Out-Null

Write-Host "Installer VM acceptance recorded: $candidateRoot"
Write-Host 'Production deployment remains blocked until separately signed operational companion and ring acceptance gates pass.'
[pscustomobject]@{
    CandidatePath = $candidateRoot
    ApprovalPath = $approvalPath
    Status = 'INSTALLER_VM_ACCEPTED_AWAITING_OPERATIONAL_COMPANION_ACCEPTANCE'
}
